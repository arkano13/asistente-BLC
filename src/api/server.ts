import { timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import QRCode from 'qrcode';
import { z, ZodError } from 'zod';
import { atenderChat } from '../agent/worker.js';
import { config } from '../config.js';
import { prisma } from '../db/prisma.js';
import { getEmpresa, guardarEntrante, upsertContacto } from '../db/repo.js';
import { cargarDocumento } from '../knowledge/index.js';
import { logger } from '../logger.js';
import { qrKey, redis, statusKey } from '../queue/index.js';

/**
 * API administrativa (mismo estilo Express de hotelbot). La consumirá el panel web;
 * hoy se protege con x-api-key de servidor a servidor. El panel tendrá login propio: nunca
 * pongas esta clave en un frontend.
 */
export function crearServidor() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  // BigInt (ids de mensajes) no es serializable por defecto.
  app.set('json replacer', (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  const clave = Buffer.from(config.ADMIN_API_KEY);
  // Página para vincular WhatsApp: pide la clave en el navegador (no va en la URL) y refresca el QR cada 3 s.
  app.get('/vincular', (_req, res) => {
    res.type('html').send(PAGINA_VINCULAR);
  });

  app.use((req, res, next) => {
    const dada = Buffer.from(String(req.headers['x-api-key'] ?? ''));
    // Comparación en tiempo constante: no filtra la clave por tiempos de respuesta.
    if (dada.length !== clave.length || !timingSafeEqual(dada, clave)) return void res.status(401).json({ error: 'no autorizado' });
    next();
  });

  const EmpresaBody = z.object({
    nombre: z.string(),
    zonaHoraria: z.string().default('America/Tegucigalpa'),
    modelo: z.string().nullish(),
    esfuerzo: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).nullish(),
    perfil: z.record(z.string(), z.unknown()).default({}),
    horario: z.record(z.string(), z.unknown()).default({}),
    avisarA: z.array(z.string()).default([]),
  });

  // Alta o actualización de una empresa.
  app.put('/empresas/:id', async (req, res) => {
    const id = z.string().regex(/^[a-z0-9-]+$/).parse(req.params.id);
    const b = EmpresaBody.parse(req.body);
    const data = { ...b, modelo: b.modelo ?? null, esfuerzo: b.esfuerzo ?? null, perfil: b.perfil as object, horario: b.horario as object };
    res.json(await prisma.empresa.upsert({ where: { id }, create: { id, ...data }, update: data }));
  });

  // Estado de WhatsApp y QR para vincular el número (WhatsApp > Dispositivos vinculados).
  app.get('/empresas/:id/whatsapp', async (req, res) => {
    const { id } = req.params;
    res.json({ estado: (await redis.get(statusKey(id))) ?? 'desconocido', qrPendiente: Boolean(await redis.get(qrKey(id))) });
  });
  app.get('/empresas/:id/qr.png', async (req, res) => {
    const qr = await redis.get(qrKey(req.params.id));
    if (!qr) return void res.status(404).json({ error: 'sin QR pendiente (ya vinculado o gateway apagado)' });
    res.type('image/png').send(await QRCode.toBuffer(qr, { width: 320 }));
  });

  // Carga de conocimiento (fase F5): texto plano o Markdown.
  app.post('/empresas/:id/conocimiento', async (req, res) => {
    if (!(await getEmpresa(req.params.id))) return void res.status(404).json({ error: 'empresa no existe' });
    const b = z
      .object({ titulo: z.string(), contenido: z.string().min(1), audiencia: z.enum(['TODOS', 'EQUIPO']).default('TODOS') })
      .parse(req.body);
    res.json({ id: await cargarDocumento(req.params.id, b.titulo, b.contenido, b.audiencia) });
  });

  // Bandeja de escalamientos y devolución del chat al bot.
  app.get('/empresas/:id/escalamientos', async (req, res) => {
    res.json(
      await prisma.escalamiento.findMany({
        where: { empresaId: req.params.id, estado: 'ABIERTO' },
        include: { contacto: { select: { nombre: true, telefono: true, jid: true } } },
        orderBy: { creadoEn: 'asc' },
      }),
    );
  });
  app.post('/empresas/:id/contactos/:contactoId/devolver-al-bot', async (req, res) => {
    const { id, contactoId } = req.params;
    await prisma.$transaction([
      prisma.contacto.updateMany({ where: { id: contactoId, empresaId: id }, data: { modo: 'BOT' } }),
      prisma.escalamiento.updateMany({ where: { contactoId, empresaId: id, estado: 'ABIERTO' }, data: { estado: 'CERRADO' } }),
      // Igual que /bot: lo que respondió la persona no lo vuelve a contestar el agente.
      prisma.mensaje.updateMany({ where: { contactoId, empresaId: id, direccion: 'ENTRANTE', procesado: false }, data: { procesado: true } }),
    ]);
    res.json({ ok: true });
  });
  app.patch('/empresas/:id/contactos/:contactoId', async (req, res) => {
    const { rol } = z.object({ rol: z.enum(['CLIENTE', 'EQUIPO']) }).parse(req.body);
    const r = await prisma.contacto.updateMany({ where: { id: req.params.contactoId, empresaId: req.params.id }, data: { rol } });
    res.json({ actualizados: r.count });
  });

  // Simulador: conversa con el agente sin WhatsApp. Base de las pruebas de la fase F9.
  app.post('/empresas/:id/simular', async (req, res) => {
    const b = z.object({ telefono: z.string().max(30), texto: z.string().min(1).max(4000), rol: z.enum(['CLIENTE', 'EQUIPO']).optional() }).parse(req.body);
    const empresa = await getEmpresa(req.params.id);
    if (!empresa) return void res.status(404).json({ error: 'empresa no existe' });
    let contacto = await upsertContacto(empresa.id, `sim-${b.telefono}@sim`, b.telefono, null);
    if (b.rol && b.rol !== contacto.rol) contacto = await prisma.contacto.update({ where: { id: contacto.id }, data: { rol: b.rol } });
    await guardarEntrante(empresa.id, contacto.id, b.texto, `sim-${Date.now()}-${Math.random()}`);
    const r = await atenderChat(empresa, contacto);
    const actual = await prisma.contacto.findUnique({ where: { id: contacto.id } });
    res.json({ respuesta: r?.texto ?? null, modo: actual?.modo });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) return void res.status(400).json({ error: 'datos inválidos', detalle: err.issues });
    logger.error({ err }, 'error en la API');
    res.status(500).json({ error: 'error interno' }); // sin detalles internos hacia afuera
  });

  return app;
}

const PAGINA_VINCULAR = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vincular WhatsApp</title><style>body{font-family:system-ui,sans-serif;max-width:420px;margin:40px auto;padding:0 16px;color:#222}
input,button{font:inherit;padding:8px;width:100%;box-sizing:border-box;margin:4px 0}img{width:100%;max-width:320px;display:block;margin:16px auto}#e{font-weight:600}</style></head>
<body><h1>Vincular WhatsApp</h1><p>En el teléfono: WhatsApp → Dispositivos vinculados → Vincular dispositivo.</p>
<input id="emp" value="blc" placeholder="empresa"><input id="key" type="password" placeholder="ADMIN_API_KEY"><button id="go">Mostrar QR</button>
<p id="e"></p><img id="qr" alt="" hidden>
<script>
let t;const $=(i)=>document.getElementById(i);
async function tick(){const h={'x-api-key':$('key').value},id=encodeURIComponent($('emp').value);
 try{const s=await fetch('/empresas/'+id+'/whatsapp',{headers:h});if(s.status===401){$('e').textContent='Clave incorrecta';return}
 const j=await s.json();if(j.estado==='open'){$('e').textContent='Conectado ✔';$('qr').hidden=true;clearInterval(t);return}
 const r=await fetch('/empresas/'+id+'/qr.png',{headers:h});
 if(r.ok){$('qr').src=URL.createObjectURL(await r.blob());$('qr').hidden=false;$('e').textContent='Escanea el código (se renueva solo)'}
 else{$('e').textContent='Esperando QR del gateway… (estado: '+j.estado+')'}}catch(e){$('e').textContent='Error: '+e}}
$('go').onclick=()=>{clearInterval(t);tick();t=setInterval(tick,3000)};
</script></body></html>`;
