import { Boom } from '@hapi/boom';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  generateMessageIDV2,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isJidStatusBroadcast,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  type WAMessage,
  type WASocket,
} from 'baileys';
import { Worker } from 'bullmq';
import { config } from '../config.js';
import { prisma } from '../db/prisma.js';
import { buscarContacto, getContacto, getEmpresa, guardarEntrante, numeroPermitido, sincronizarRol, upsertContacto } from '../db/repo.js';
import { logger } from '../logger.js';
import { agendarChat, codigoKey, enviadoKey, nombreSalida, qrKey, redis, renovarLock, soltarLock, statusKey, tomarLock, ultimoKey, type OutboundJob } from '../queue/index.js';
import { usarAuthPostgres } from './auth-state.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Comandos que el equipo escribe desde el teléfono, dentro del chat del cliente. Se borran al instante. */
const CMD_DEVOLVER = '/bot';
const CMD_PAUSAR = '/pausa';

/** Tope de caracteres por mensaje: evita que un texto enorme dispare el costo de tokens. */
const MAX_TEXTO = 4000;
/** Mensajes por chat cada 10 minutos que el agente atiende; el resto solo se guarda (anti-spam y costo). */
const MAX_POR_VENTANA = 40;

/** Extrae texto útil de un mensaje. Multimedia sin texto se describe para que el agente pida escribirlo. */
function extraerTexto(msg: WAMessage): string | null {
  const m = msg.message;
  if (!m) return null;
  const texto =
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.caption ??
    m.buttonsResponseMessage?.selectedDisplayText ??
    m.listResponseMessage?.title ??
    (m.audioMessage ? '[El contacto envió una nota de voz. El asistente no puede escucharla.]'
      : m.imageMessage ? '[El contacto envió una imagen sin texto.]'
      : m.videoMessage ? '[El contacto envió un video sin texto.]'
      : m.documentMessage ? '[El contacto envió un documento sin texto.]'
      : null);
  return texto ? texto.slice(0, MAX_TEXTO) : null;
}

/** Mensajes del sistema (borrados, ediciones, reacciones, llaves): no son una respuesta de una persona. */
const esSistema = (msg: WAMessage) => {
  const m = msg.message;
  return !m || Boolean(m.protocolMessage || m.reactionMessage || m.senderKeyDistributionMessage || m.pollUpdateMessage);
};

const esChatPrivado = (jid: string) => !(isJidGroup(jid) || isJidBroadcast(jid) || isJidStatusBroadcast(jid) || isJidNewsletter(jid));

/** Una sesión = un número de WhatsApp de una empresa. */
export class TenantSession {
  private sock?: WASocket;
  private outWorker?: Worker<OutboundJob>;
  private stopped = false;
  private renovar?: NodeJS.Timeout;
  private borrarAuth?: () => Promise<void>;
  private log;

  constructor(readonly empresaId: string) {
    this.log = logger.child({ empresa: empresaId });
  }

  /**
   * Chat canónico: el número (@s.whatsapp.net) cuando se conoce, si no el LID. Así el mismo cliente
   * no queda partido en dos contactos y la toma humana se detecta aunque el teléfono use el LID.
   */
  private async resolverChat(key: WAMessage['key']) {
    const jid = key.remoteJid!;
    let pn = [key.remoteJidAlt, jid].find((j) => j?.endsWith('@s.whatsapp.net')) ?? null;
    if (!pn && jid.endsWith('@lid')) pn = (await this.sock?.signalRepository.lidMapping.getPNForLID(jid).catch(() => null)) ?? null;
    const canonico = pn ? jidNormalizedUser(pn) : jid;
    return { canonico, original: jid, telefono: pn ? canonico.split('@')[0] : null };
  }

  /** true si se tomó el lock; false si otra instancia ya tiene el socket de esta empresa. */
  async start(): Promise<boolean> {
    if (!(await tomarLock(this.empresaId))) return false;
    this.renovar ??= setInterval(async () => {
      if (!(await renovarLock(this.empresaId).catch(() => true))) {
        this.log.error('se perdió el lock de la sesión: otra instancia tomó este número; se detiene');
        await this.stop();
      }
    }, 10_000);
    await this.conectar();
    return true;
  }

  private async conectar() {
    const { state, saveCreds, borrar } = await usarAuthPostgres(this.empresaId);
    this.borrarAuth = borrar;
    const { version, isLatest } = await fetchLatestBaileysVersion();
    if (!state.creds.me) this.log.info({ version, isLatest }, 'sin vincular: esperando QR o código');

    const sock = makeWASocket({
      version,
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, this.log as never) },
      logger: this.log.child({ mod: 'baileys' }, { level: 'warn' }) as never,
      browser: Browsers.ubuntu('Chrome'), // un nombre inventado como sistema operativo hace que WhatsApp rechace el vínculo
      markOnlineOnConnect: false, // no marcar "en línea" siempre: así el teléfono sigue recibiendo notificaciones
      syncFullHistory: false,
      // Estados y difusiones: no se usan y generan errores de descifrado en los logs.
      shouldIgnoreJid: (jid) => isJidStatusBroadcast(jid) || isJidBroadcast(jid) || isJidNewsletter(jid),
    });
    this.sock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) await redis.set(qrKey(this.empresaId), qr, 'EX', 60); // el panel lo muestra; WhatsApp lo rota cada ~20 s
      if (connection) await redis.set(statusKey(this.empresaId), connection);
      if (connection === 'open') {
        await redis.del(qrKey(this.empresaId), codigoKey(this.empresaId));
        const numero = sock.user?.id ? jidNormalizedUser(sock.user.id).split('@')[0] : '';
        await redis.set(`wa:numero:${this.empresaId}`, numero);
        this.log.info({ numero }, 'WhatsApp conectado');
        this.startOutbound();
      }
      if (connection === 'close') {
        const code = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
        if (code !== DisconnectReason.timedOut) this.log.warn({ code, motivo: lastDisconnect?.error?.message }, 'conexión cerrada');
        await this.outWorker?.close();
        this.outWorker = undefined;
        if (code === DisconnectReason.loggedOut) {
          this.log.warn('Sesión cerrada desde el teléfono: se borra la autenticación y se pide QR nuevo');
          await borrar();
        }
        if (!this.stopped) {
          this.log.info({ code }, 'reconectando');
          await sleep(code === DisconnectReason.restartRequired ? 0 : 3000);
          if (this.stopped) return;
          this.conectar().catch((err) => this.log.error({ err }, 'fallo al reconectar'));
        }
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      for (const msg of messages) {
        try {
          if (msg.key.fromMe) await this.handlePropio(msg);
          else if (type === 'notify') await this.handleInbound(msg); // 'append' = sincronización de historial
        } catch (err) {
          this.log.error({ err }, 'error procesando mensaje');
        }
      }
    });
  }

  private async handleInbound(msg: WAMessage) {
    if (!msg.key.remoteJid || !esChatPrivado(msg.key.remoteJid) || esSistema(msg)) return;
    const text = extraerTexto(msg)?.trim();
    if (!text || !msg.key.id) return;

    // En Baileys 7 el chat puede llegar como LID; se guarda con el número cuando se conoce.
    const { canonico: jid, original, telefono } = await this.resolverChat(msg.key);

    const empresa = await getEmpresa(this.empresaId);
    if (!empresa) return;
    // Filtro de números del panel: fuera del filtro, el bot ni guarda ni marca como leído (el chat queda intacto).
    if (!numeroPermitido(empresa, telefono)) {
      this.log.info({ chat: original, telefono }, telefono ? 'mensaje fuera del filtro: ignorado' : 'mensaje sin número conocido (LID): el filtro no lo deja pasar');
      return;
    }
    this.log.info({ chat: jid }, 'mensaje recibido');
    const contacto = await sincronizarRol(await upsertContacto(this.empresaId, jid, telefono, msg.pushName ?? null, original), empresa);
    if (!(await guardarEntrante(this.empresaId, contacto.id, text, msg.key.id))) return;

    await redis.set(ultimoKey(this.empresaId, contacto.jid), JSON.stringify({ key: msg.key, messageTimestamp: msg.messageTimestamp }), 'EX', 7 * 86400);
    // En modo HUMANO o con un traslado abierto no se marca como leído: el equipo ve el chat pendiente en su teléfono.
    const trasladado = await prisma.escalamiento.count({ where: { contactoId: contacto.id, estado: 'ABIERTO' } });
    if (contacto.modo === 'BOT' && !trasladado) await this.sock?.readMessages([msg.key]);

    const rk = `wa:rate:${this.empresaId}:${contacto.jid}`;
    const n = await redis.incr(rk);
    if (n === 1) await redis.expire(rk, 600);
    if (n > MAX_POR_VENTANA) {
      if (n === MAX_POR_VENTANA + 1) this.log.warn({ jid: contacto.jid }, 'límite de mensajes por chat: el agente deja de responder 10 min');
      return;
    }
    await agendarChat({ empresaId: this.empresaId, jid: contacto.jid }, config.DEBOUNCE_MS);
  }

  /**
   * Mensajes que salen del número de la empresa. Si no los envió el bot, los escribió una persona
   * desde el teléfono o WhatsApp Web: el chat pasa a modo HUMANO y el agente queda pausado
   * (pausa técnica, no depende del prompt). /bot lo devuelve al agente y /pausa lo pausa sin escribir.
   */
  private async handlePropio(msg: WAMessage) {
    const id = msg.key.id;
    if (!msg.key.remoteJid || !id || !esChatPrivado(msg.key.remoteJid) || esSistema(msg)) return;
    if (await redis.get(enviadoKey(this.empresaId, id))) return; // lo envió el bot
    // Mensajes viejos que llegan al resincronizar no son una toma humana nueva.
    if (Date.now() / 1000 - Number(msg.messageTimestamp ?? 0) > 86400) return;
    const { canonico, original } = await this.resolverChat(msg.key);
    const propios = [this.sock?.user?.id, this.sock?.user?.lid].filter(Boolean).map((j) => jidNormalizedUser(j!));
    if (propios.includes(jidNormalizedUser(original))) return; // chat consigo mismo

    const texto = extraerTexto(msg)?.trim().toLowerCase();
    const contacto = await buscarContacto(this.empresaId, [canonico, original]);
    if (!contacto) return; // chat que el bot nunca atendió
    const jid = contacto.jid;

    if (texto === CMD_DEVOLVER || texto === CMD_PAUSAR) {
      // que el cliente no vea el comando; el id se registra para que el borrado no cuente como toma humana
      const messageId = generateMessageIDV2(this.sock?.user?.id);
      await redis.set(enviadoKey(this.empresaId, messageId), '1', 'EX', 86400);
      await this.sock?.sendMessage(original, { delete: msg.key }, { messageId }).catch(() => {});
    }
    if (texto === CMD_DEVOLVER) {
      await prisma.$transaction([
        prisma.contacto.update({ where: { id: contacto.id }, data: { modo: 'BOT' } }),
        prisma.escalamiento.updateMany({ where: { contactoId: contacto.id, estado: 'ABIERTO' }, data: { estado: 'CERRADO' } }),
        // Lo que el cliente escribió mientras atendía la persona ya está respondido: no lo procesa el bot.
        prisma.mensaje.updateMany({ where: { contactoId: contacto.id, direccion: 'ENTRANTE', procesado: false }, data: { procesado: true } }),
      ]);
      this.log.info({ jid }, 'chat devuelto al agente');
      return;
    }
    // Con la pausa automática apagada (pruebas), escribir desde el número no pausa; /pausa sí.
    const pausar = texto === CMD_PAUSAR || (await getEmpresa(this.empresaId))?.pausaAutomatica !== false;
    if (pausar && contacto.modo !== 'HUMANO') {
      await prisma.contacto.update({ where: { id: contacto.id }, data: { modo: 'HUMANO' } });
      this.log.info({ jid, msgId: id, tipo: Object.keys(msg.message ?? {}).join(',') }, 'una persona tomó el chat: agente pausado');
    }
    if (texto && texto !== CMD_PAUSAR) {
      await prisma.mensaje.create({
        data: { empresaId: this.empresaId, contactoId: contacto.id, direccion: 'SALIENTE', contenido: extraerTexto(msg)!.trim(), waId: id, procesado: true },
      }).catch(() => {}); // queda en el historial para cuando el agente retome
    }
  }

  private startOutbound() {
    if (this.outWorker) return;
    this.outWorker = new Worker<OutboundJob>(
      nombreSalida(this.empresaId),
      async (job) => {
        const sock = this.sock;
        if (!sock) throw new Error('socket no disponible');
        const data = job.data;
        if (data.accion === 'no_leido') {
          const ultimo = await redis.get(ultimoKey(this.empresaId, data.jid));
          if (ultimo) await sock.chatModify({ markRead: false, lastMessages: [JSON.parse(ultimo)] }, data.jid);
          return;
        }
        // Si una persona tomó el chat mientras el agente respondía, no se envía.
        const contacto = await getContacto(this.empresaId, data.jid);
        if (contacto?.modo === 'HUMANO' && !data.forzar) return;
        // "escribiendo..." proporcional al largo: más natural y menos patrón de bot.
        await sock.presenceSubscribe(data.jid);
        await sock.sendPresenceUpdate('composing', data.jid);
        await sleep(Math.min(1000 + data.text.length * 25, 6000));
        await sock.sendPresenceUpdate('paused', data.jid);
        const messageId = generateMessageIDV2(sock.user?.id);
        await redis.set(enviadoKey(this.empresaId, messageId), '1', 'EX', 86400); // antes de enviar: evita la carrera con el evento
        await sock.sendMessage(data.jid, { text: data.text }, { messageId });
        this.log.info({ jid: data.jid, msgId: messageId }, 'respuesta enviada');
      },
      { connection: redis, concurrency: 1, limiter: { max: 20, duration: 60_000 } },
    );
    this.outWorker.on('failed', (job, err) => this.log.error({ err, jobId: job?.id }, 'fallo enviando mensaje'));
  }

  /** Vincular sin QR: WhatsApp > Dispositivos vinculados > Vincular con número de teléfono. */
  async pedirCodigo(numero: string) {
    const sock = this.sock;
    let valor: object;
    if (!sock) valor = { error: 'El gateway todavía está conectando. Intenta en unos segundos.' };
    else if ((await redis.get(statusKey(this.empresaId))) === 'open') valor = { error: 'Este número ya está vinculado.' };
    else {
      try {
        valor = { codigo: await sock.requestPairingCode(numero) };
        this.log.info('código de emparejamiento generado');
      } catch (err) {
        this.log.error({ err }, 'no se pudo pedir el código');
        valor = { error: 'WhatsApp no entregó el código. Intenta de nuevo.' };
      }
    }
    await redis.set(codigoKey(this.empresaId), JSON.stringify(valor), 'EX', 170);
  }

  /** Borra la sesión guardada y arranca de cero (QR nuevo). Sirve si quedó a medio vincular. */
  async reiniciar() {
    this.log.warn('vinculación reiniciada desde el panel');
    await redis.del(qrKey(this.empresaId), codigoKey(this.empresaId));
    await redis.del(`wa:numero:${this.empresaId}`);
    // Si estaba vinculado, se cierra la sesión en WhatsApp (desaparece de Dispositivos vinculados).
    await this.sock?.logout().catch(() => {});
    await this.borrarAuth?.();
    this.sock?.end(new Boom('reinicio desde el panel', { statusCode: DisconnectReason.restartRequired }));
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.renovar);
    await soltarLock(this.empresaId).catch(() => {});
    await this.outWorker?.close();
    this.sock?.end(undefined);
  }
}
