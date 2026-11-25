import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import QRCode from 'qrcode';
import { z, ZodError } from 'zod';
import { atenderChat } from '../agent/worker.js';
import { prisma } from '../db/prisma.js';
import { getEmpresa, guardarEntrante, soloDigitos, upsertContacto } from '../db/repo.js';
import { cargarDocumento } from '../knowledge/index.js';
import { logger } from '../logger.js';
import { codigoKey, enviarControl, qrKey, redis, statusKey } from '../queue/index.js';
import { abrirSesion, autorizarEmpresa, cerrarSesion, esClaveAdmin, hashear, intentoPermitido, leerSesion, verificar } from './auth.js';

/**
 * API del core. Dos formas de entrar:
 * - Panel web: login con email y contraseña, sesión en cookie HttpOnly (la clave nunca llega al navegador).
 * - Servidor a servidor: header x-api-key con ADMIN_API_KEY.
 * El panel (React, carpeta panel/) se sirve desde aquí mismo: mismo dominio, sin CORS.
 */
export function crearServidor() {
  const app = express();
  app.set('trust proxy', 1); // Railway pone un proxy delante: req.ip real y cookies Secure
  app.use(express.json({ limit: '2mb' }));
  // BigInt (ids de mensajes) no es serializable por defecto.
  app.set('json replacer', (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Página mínima para vincular WhatsApp con la clave admin (respaldo si el panel no está disponible).
  app.get('/vincular', (_req, res) => {
    res.type('html').send(PAGINA_VINCULAR);
  });

  // ---------- Autenticación del panel ----------
  const Credenciales = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

  app.post('/auth/login', async (req, res) => {
    const { email, password } = Credenciales.parse(req.body);
    if (!(await intentoPermitido(req.ip ?? '', email))) return void res.status(429).json({ error: 'demasiados intentos, espera 15 minutos' });
    const u = await prisma.usuario.findUnique({ where: { email: email.toLowerCase() } });
    if (!u || !(await verificar(password, u.hash))) return void res.status(401).json({ error: 'email o contraseña incorrectos' });
    await prisma.usuario.update({ where: { id: u.id }, data: { ultimoAcceso: new Date() } });
    await abrirSesion(res, { usuarioId: u.id, empresaId: u.empresaId, email: u.email, nombre: u.nombre });
    res.json({ usuarioId: u.id, email: u.email, nombre: u.nombre, empresaId: u.empresaId });
  });

  app.post('/auth/logout', async (req, res) => {
    await cerrarSesion(req, res);
    res.json({ ok: true });
  });

  app.get('/auth/yo', async (req, res) => {
    const s = await leerSesion(req);
    if (!s) return void res.status(401).json({ error: 'sin sesión' });
    res.json(s);
  });

  // Primer acceso: crea el primer usuario de una empresa con la ADMIN_API_KEY (solo si no tiene ninguno).
  const NuevoUsuario = z.object({ nombre: z.string().min(1).max(100), email: z.string().email().max(200), password: z.string().min(10).max(200) });
  app.post('/auth/primer-admin', async (req, res) => {
    if (!esClaveAdmin(req)) return void res.status(401).json({ error: 'clave de administración incorrecta' });
    const b = NuevoUsuario.extend({ empresaId: z.string() }).parse(req.body);
    if (!(await getEmpresa(b.empresaId))) return void res.status(404).json({ error: 'empresa no existe' });
    if (await prisma.usuario.count({ where: { empresaId: b.empresaId } }))
      return void res.status(409).json({ error: 'esta empresa ya tiene usuarios: entra con tu cuenta' });
    const u = await prisma.usuario.create({
      data: { empresaId: b.empresaId, nombre: b.nombre, email: b.email.toLowerCase(), hash: await hashear(b.password) },
    });
    await abrirSesion(res, { usuarioId: u.id, empresaId: u.empresaId, email: u.email, nombre: u.nombre });
    res.json({ usuarioId: u.id, email: u.email, nombre: u.nombre, empresaId: u.empresaId });
  });

  // ---------- Rutas de una empresa (clave admin o sesión de esa empresa) ----------
  const r = express.Router({ mergeParams: true });
  app.use('/empresas/:id', autorizarEmpresa, r);
  const idEmpresa = (req: Request) => String(req.params.id);
  const param = (req: Request, k: string) => String(req.params[k]);

  const EmpresaBody = z.object({
    nombre: z.string(),
    zonaHoraria: z.string().default('America/Tegucigalpa'),
    modelo: z.string().nullish(),
    esfuerzo: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).nullish(),
    perfil: z.record(z.string(), z.unknown()).default({}),
    horario: z.record(z.string(), z.unknown()).default({}),
    avisarA: z.array(z.string()).default([]),
  });

  // Alta o actualización de una empresa (solo servidor a servidor).
  r.put('/', async (req, res) => {
    if (!req.esAdminApi) return void res.status(403).json({ error: 'solo con clave de administración' });
    const id = z.string().regex(/^[a-z0-9-]+$/).parse(idEmpresa(req));
    const b = EmpresaBody.parse(req.body);
    const data = { ...b, modelo: b.modelo ?? null, esfuerzo: b.esfuerzo ?? null, perfil: b.perfil as object, horario: b.horario as object };
    res.json(await prisma.empresa.upsert({ where: { id }, create: { id, ...data }, update: data }));
  });

  r.get('/', async (req, res) => {
    const e = await getEmpresa(idEmpresa(req));
    if (!e) return void res.status(404).json({ error: 'empresa no existe' });
    res.json({ id: e.id, nombre: e.nombre, zonaHoraria: e.zonaHoraria, filtroModo: e.filtroModo, filtroNumeros: e.filtroNumeros, pausaAutomatica: e.pausaAutomatica });
  });

  // Estado de WhatsApp y QR para vincular el número (WhatsApp > Dispositivos vinculados).
  r.get('/whatsapp', async (req, res) => {
    const id = idEmpresa(req);
    const codigo = await redis.get(codigoKey(id));
    res.json({
      estado: (await redis.get(statusKey(id))) ?? 'desconocido',
      qrPendiente: Boolean(await redis.get(qrKey(id))),
      numero: (await redis.get(`wa:numero:${id}`)) || null,
      emparejamiento: codigo ? JSON.parse(codigo) : null,
    });
  });
  // Alternativa al QR: código de 8 caracteres para "Vincular con número de teléfono".
  r.post('/whatsapp/codigo', async (req, res) => {
    const numero = soloDigitos(String(req.body?.numero ?? ''));
    if (numero.length < 8 || numero.length > 15) return void res.status(400).json({ error: 'número inválido: usa código de país y número, solo dígitos' });
    const id = idEmpresa(req);
    await redis.del(codigoKey(id));
    await enviarControl({ empresa: id, accion: 'codigo', numero });
    res.json({ ok: true });
  });
  r.post('/whatsapp/reiniciar', async (req, res) => {
    const id = idEmpresa(req);
    await enviarControl({ empresa: id, accion: 'reiniciar' });
    res.json({ ok: true });
  });
  r.get('/qr.png', async (req, res) => {
    const qr = await redis.get(qrKey(idEmpresa(req)));
    if (!qr) return void res.status(404).json({ error: 'sin QR pendiente (ya vinculado o gateway apagado)' });
    res.set('cache-control', 'no-store').type('image/png').send(await QRCode.toBuffer(qr, { width: 320 }));
  });

  r.put('/pausa-automatica', async (req, res) => {
    const activa = z.object({ activa: z.boolean() }).parse(req.body).activa;
    await prisma.empresa.update({ where: { id: idEmpresa(req) }, data: { pausaAutomatica: activa } });
    res.json({ pausaAutomatica: activa });
  });

  // Filtro de números: a quién atiende el agente.
  const Filtro = z.object({
    modo: z.enum(['TODOS', 'SOLO_LISTA', 'EXCLUIR_LISTA']),
    numeros: z.array(z.string().max(30)).max(500),
  });
  r.put('/filtro', async (req, res) => {
    const b = Filtro.parse(req.body);
    const numeros = [...new Set(b.numeros.map(soloDigitos).filter((n) => n.length >= 8))];
    if (b.modo === 'SOLO_LISTA' && !numeros.length)
      return void res.status(400).json({ error: 'En modo prueba agrega al menos un número válido; con la lista vacía el asistente no responde a nadie.' });
    const e = await prisma.empresa.update({ where: { id: idEmpresa(req) }, data: { filtroModo: b.modo, filtroNumeros: numeros } });
    res.json({ filtroModo: e.filtroModo, filtroNumeros: e.filtroNumeros, pausaAutomatica: e.pausaAutomatica });
  });

  // Chats: último mensaje, modo (BOT/HUMANO) y si hay un escalamiento abierto.
  r.get('/contactos', async (req, res) => {
    const filas = await prisma.$queryRaw<unknown[]>`
      SELECT c.id, c.nombre, c.telefono, c.jid, c.rol, c.modo,
             m.contenido AS "ultimoMensaje", m.direccion AS "ultimaDireccion", m.creado_en AS "ultimoEn",
             EXISTS (SELECT 1 FROM escalamientos e WHERE e.contacto_id = c.id AND e.estado = 'ABIERTO') AS escalado
      FROM contactos c
      LEFT JOIN LATERAL (SELECT contenido, direccion, creado_en FROM mensajes WHERE contacto_id = c.id ORDER BY id DESC LIMIT 1) m ON true
      WHERE c.empresa_id = ${idEmpresa(req)}
      ORDER BY m.creado_en DESC NULLS LAST
      LIMIT 300`;
    res.json(filas);
  });
  r.get('/contactos/:contactoId', async (req, res) => {
    const c = await prisma.contacto.findFirst({
      where: { id: param(req, 'contactoId'), empresaId: idEmpresa(req) },
      include: { mensajes: { orderBy: { id: 'desc' }, take: 200 }, leads: true, escalamientos: { where: { estado: 'ABIERTO' } } },
    });
    if (!c) return void res.status(404).json({ error: 'contacto no existe' });
    res.json({ ...c, mensajes: c.mensajes.reverse() });
  });
  r.post('/contactos/:contactoId/pausar', async (req, res) => {
    const n = await prisma.contacto.updateMany({ where: { id: param(req, 'contactoId'), empresaId: idEmpresa(req) }, data: { modo: 'HUMANO' } });
    res.json({ ok: n.count === 1 });
  });
  r.post('/contactos/:contactoId/devolver-al-bot', async (req, res) => {
    const id = idEmpresa(req);
    const contactoId = param(req, 'contactoId');
    await prisma.$transaction([
      prisma.contacto.updateMany({ where: { id: contactoId, empresaId: id }, data: { modo: 'BOT' } }),
      prisma.escalamiento.updateMany({ where: { contactoId, empresaId: id, estado: 'ABIERTO' }, data: { estado: 'CERRADO' } }),
      // Igual que /bot: lo que respondió la persona no lo vuelve a contestar el agente.
      prisma.mensaje.updateMany({ where: { contactoId, empresaId: id, direccion: 'ENTRANTE', procesado: false }, data: { procesado: true } }),
    ]);
    res.json({ ok: true });
  });
  // Pruebas: borra el contacto con todo su historial (mensajes, leads, escalamientos, memoria y estado).
  // El próximo mensaje de ese número empieza una conversación nueva desde cero.
  r.delete('/contactos/:contactoId', async (req, res) => {
    const id = idEmpresa(req);
    const c = await prisma.contacto.findFirst({ where: { id: param(req, 'contactoId'), empresaId: id } });
    if (!c) return void res.status(404).json({ error: 'contacto no existe' });
    await prisma.contacto.delete({ where: { id: c.id } });
    await redis.del(`wa:rate:${id}:${c.jid}`, `wa:ultimo:${id}:${c.jid}`);
    res.json({ ok: true });
  });
  r.patch('/contactos/:contactoId', async (req, res) => {
    const b = z.object({ rol: z.enum(['CLIENTE', 'EQUIPO']).optional(), nombre: z.string().max(100).optional() }).parse(req.body);
    const n = await prisma.contacto.updateMany({ where: { id: param(req, 'contactoId'), empresaId: idEmpresa(req) }, data: b });
    res.json({ actualizados: n.count });
  });

  // Bandeja de escalamientos y leads.
  r.get('/escalamientos', async (req, res) => {
    res.json(
      await prisma.escalamiento.findMany({
        where: { empresaId: idEmpresa(req), estado: 'ABIERTO' },
        include: { contacto: { select: { id: true, nombre: true, telefono: true, jid: true, modo: true } } },
        orderBy: { creadoEn: 'asc' },
      }),
    );
  });
  r.get('/leads', async (req, res) => {
    res.json(
      await prisma.lead.findMany({
        where: { empresaId: idEmpresa(req) },
        include: { contacto: { select: { id: true, nombre: true, telefono: true } } },
        orderBy: { creadoEn: 'desc' },
        take: 300,
      }),
    );
  });

  // Conocimiento (fase F5): documentos en texto plano o Markdown.
  const Doc = z.object({ titulo: z.string().min(1).max(200), contenido: z.string().min(1).max(100_000), audiencia: z.enum(['TODOS', 'EQUIPO']).default('TODOS') });
  r.get('/conocimiento', async (req, res) => {
    res.json(await prisma.documento.findMany({ where: { empresaId: idEmpresa(req) }, orderBy: { titulo: 'asc' } }));
  });
  r.post('/conocimiento', async (req, res) => {
    if (!(await getEmpresa(idEmpresa(req)))) return void res.status(404).json({ error: 'empresa no existe' });
    const b = Doc.parse(req.body);
    res.json({ id: await cargarDocumento(idEmpresa(req), b.titulo, b.contenido, b.audiencia) });
  });
  r.put('/conocimiento/:docId', async (req, res) => {
    const b = Doc.parse(req.body);
    const id = idEmpresa(req);
    const borrado = await prisma.documento.deleteMany({ where: { id: param(req, 'docId'), empresaId: id } });
    if (!borrado.count) return void res.status(404).json({ error: 'documento no existe' });
    res.json({ id: await cargarDocumento(id, b.titulo, b.contenido, b.audiencia) });
  });
  r.delete('/conocimiento/:docId', async (req, res) => {
    const n = await prisma.documento.deleteMany({ where: { id: param(req, 'docId'), empresaId: idEmpresa(req) } });
    res.json({ ok: n.count === 1 });
  });

  // Usuarios del panel de esta empresa.
  r.get('/usuarios', async (req, res) => {
    res.json(
      await prisma.usuario.findMany({
        where: { empresaId: idEmpresa(req) },
        select: { id: true, nombre: true, email: true, creadoEn: true, ultimoAcceso: true },
        orderBy: { creadoEn: 'asc' },
      }),
    );
  });
  r.post('/usuarios', async (req, res) => {
    const b = NuevoUsuario.parse(req.body);
    if (await prisma.usuario.findUnique({ where: { email: b.email.toLowerCase() } })) return void res.status(409).json({ error: 'ese email ya existe' });
    const u = await prisma.usuario.create({
      data: { empresaId: idEmpresa(req), nombre: b.nombre, email: b.email.toLowerCase(), hash: await hashear(b.password) },
      select: { id: true, nombre: true, email: true },
    });
    res.json(u);
  });
  r.delete('/usuarios/:usuarioId', async (req, res) => {
    if (req.sesion?.usuarioId === param(req, 'usuarioId')) return void res.status(400).json({ error: 'no puedes borrar tu propio usuario' });
    const n = await prisma.usuario.deleteMany({ where: { id: param(req, 'usuarioId'), empresaId: idEmpresa(req) } });
    res.json({ ok: n.count === 1 });
  });

  // Simulador: conversa con el agente sin WhatsApp. Base de las pruebas de la fase F9.
  r.post('/simular', async (req, res) => {
    const b = z.object({ telefono: z.string().max(30), texto: z.string().min(1).max(4000), rol: z.enum(['CLIENTE', 'EQUIPO']).optional() }).parse(req.body);
    const empresa = await getEmpresa(idEmpresa(req));
    if (!empresa) return void res.status(404).json({ error: 'empresa no existe' });
    let contacto = await upsertContacto(empresa.id, `sim-${b.telefono}@sim`, b.telefono, null);
    if (b.rol && b.rol !== contacto.rol) contacto = await prisma.contacto.update({ where: { id: contacto.id }, data: { rol: b.rol } });
    await guardarEntrante(empresa.id, contacto.id, b.texto, `sim-${Date.now()}-${Math.random()}`);
    const resp = await atenderChat(empresa, contacto);
    const actual = await prisma.contacto.findUnique({ where: { id: contacto.id } });
    res.json({ respuesta: resp?.texto ?? null, modo: actual?.modo });
  });

  // ---------- Panel web (build de Vite en panel/dist) ----------
  const panel = join(process.cwd(), 'panel', 'dist');
  if (existsSync(panel)) {
    app.use(express.static(panel, { index: false, maxAge: '1h' }));
    // SPA: cualquier otra ruta GET devuelve index.html
    app.get(/^\/(?!empresas\/|auth\/|health$|vincular$).*/, (_req, res) => res.sendFile(join(panel, 'index.html')));
  }

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
