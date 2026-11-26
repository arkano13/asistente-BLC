import { Worker } from 'bullmq';
import { config } from '../config.js';
import type { Contacto, Empresa } from '../db/prisma.js';
import { getContacto, getEmpresa, guardarSaliente, historial, marcarProcesados, pendientes } from '../db/repo.js';
import { logger } from '../logger.js';
import { agendarChat, enviarTexto, INBOUND, marcarNoLeido, redis, type InboundJob } from '../queue/index.js';
import { actualizarEstado, actualizarResumen } from './memory.js';
import { aMensajes, ejecutarAgente } from './orchestrator.js';

/** Procesa los mensajes pendientes de un chat y devuelve la respuesta (también lo usa /simular). */
export async function atenderChat(empresa: Empresa, contacto: Contacto) {
  const nuevos = await pendientes(contacto.id);
  if (!nuevos.length) return null;
  const ids = nuevos.map((m) => m.id);

  if (contacto.modo === 'HUMANO') {
    await marcarProcesados(ids); // atiende una persona: el bot solo registra
    return null;
  }

  // Ficha del prospecto y regla de avance al día, incluido lo que acaba de escribir.
  const estado = await actualizarEstado(empresa, contacto, nuevos).catch((err) => {
    logger.error({ err }, 'estado de la conversación');
    return contacto.estado;
  });
  contacto = { ...contacto, estado: estado as Contacto['estado'] };
  const previos = await historial(contacto.id, config.HISTORY_LIMIT);
  const r = await ejecutarAgente(empresa, contacto, aMensajes(previos, nuevos));
  await marcarProcesados(ids);
  if (r.texto) await guardarSaliente(empresa.id, contacto.id, r.texto);
  logger.info({ empresa: empresa.id, contacto: contacto.id, herramientas: r.herramientas, uso: r.uso }, 'respuesta generada');
  actualizarResumen(empresa, contacto).catch((err) => logger.error({ err }, 'resumen'));
  return { texto: r.texto, escalado: r.herramientas.includes('escalar_a_humano') };
}

export function iniciarWorkerAgente() {
  const worker = new Worker<InboundJob>(
    INBOUND,
    async (job) => {
      const { empresaId, jid } = job.data;
      const [empresa, contacto] = await Promise.all([getEmpresa(empresaId), getContacto(empresaId, jid)]);
      if (!empresa || !contacto) return;
      const r = await atenderChat(empresa, contacto);
      if (r?.texto) await enviarTexto(empresaId, jid, r.texto, r.escalado);
    },
    { connection: redis, concurrency: 10 },
  );
  // Mensajes que llegaron mientras Claude respondía: el jobId seguía ocupado, se agenda otra vuelta.
  worker.on('completed', async (job) => {
    const contacto = await getContacto(job.data.empresaId, job.data.jid);
    if (contacto && (await pendientes(contacto.id)).length) await agendarChat(job.data, 0);
  });
  worker.on('failed', async (job, err) => {
    logger.error({ err, jobId: job?.id }, 'fallo del agente');
    // Agotados los reintentos (p. ej. la API de Claude caída): el chat queda no leído para que lo vea el equipo.
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) await marcarNoLeido(job.data.empresaId, job.data.jid).catch(() => {});
  });
  return worker;
}
