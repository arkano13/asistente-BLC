import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { redis } from '../queue/index.js';

/**
 * Autenticación del panel web.
 * - Contraseñas con scrypt (node:crypto, sin dependencias) y sal aleatoria.
 * - Sesión: token aleatorio en cookie HttpOnly + SameSite=Strict; el dato vive en Redis 7 días.
 * - La ADMIN_API_KEY sigue sirviendo para llamadas servidor a servidor (header x-api-key).
 */
const scrypt = promisify(scryptCb) as (p: string, s: Buffer, n: number) => Promise<Buffer>;
const COOKIE = 'blc_sesion';
const DURACION = 7 * 86400;
const sesionKey = (t: string) => `panel:sesion:${t}`;

export interface Sesion {
  usuarioId: string;
  empresaId: string;
  email: string;
  nombre: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    sesion?: Sesion;
    esAdminApi?: boolean;
  }
}

export async function hashear(password: string) {
  const sal = randomBytes(16);
  const h = await scrypt(password, sal, 64);
  return `scrypt$${sal.toString('base64')}$${h.toString('base64')}`;
}

export async function verificar(password: string, guardado: string) {
  const [alg, sal, h] = guardado.split('$');
  if (alg !== 'scrypt' || !sal || !h) return false;
  const esperado = Buffer.from(h, 'base64');
  const calc = await scrypt(password, Buffer.from(sal, 'base64'), esperado.length);
  return timingSafeEqual(calc, esperado);
}

const leerCookie = (req: Request) =>
  (req.headers.cookie ?? '')
    .split(';')
    .map((c) => c.trim().split('='))
    .find(([k]) => k === COOKIE)?.[1];

export async function abrirSesion(res: Response, s: Sesion) {
  const token = randomBytes(32).toString('base64url');
  await redis.set(sesionKey(token), JSON.stringify(s), 'EX', DURACION);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: DURACION * 1000,
    path: '/',
  });
}

export async function cerrarSesion(req: Request, res: Response) {
  const t = leerCookie(req);
  if (t) await redis.del(sesionKey(t));
  res.clearCookie(COOKIE, { path: '/' });
}

export async function leerSesion(req: Request): Promise<Sesion | null> {
  const t = leerCookie(req);
  if (!t || !/^[\w-]{20,}$/.test(t)) return null;
  const v = await redis.get(sesionKey(t));
  return v ? (JSON.parse(v) as Sesion) : null;
}

const clave = Buffer.from(config.ADMIN_API_KEY);
export function esClaveAdmin(req: Request) {
  const dada = Buffer.from(String(req.headers['x-api-key'] ?? ''));
  return dada.length === clave.length && timingSafeEqual(dada, clave);
}

/**
 * Protección CSRF básica: las escrituras con cookie deben venir del mismo origen.
 * (SameSite=Strict ya bloquea casi todo; esto cubre navegadores viejos.)
 */
function mismoOrigen(req: Request) {
  const origen = req.headers.origin;
  if (!origen) return true;
  try {
    return new URL(origen).host === req.headers.host;
  } catch {
    return false;
  }
}

/** Para rutas /empresas/:id: clave admin (todo) o sesión de un usuario de ESA empresa. */
export async function autorizarEmpresa(req: Request, res: Response, next: NextFunction) {
  if (esClaveAdmin(req)) {
    req.esAdminApi = true;
    return next();
  }
  const s = await leerSesion(req);
  if (!s) return void res.status(401).json({ error: 'no autorizado' });
  if (s.empresaId !== req.params.id) return void res.status(403).json({ error: 'sin acceso a esta empresa' });
  if (req.method !== 'GET' && !mismoOrigen(req)) return void res.status(403).json({ error: 'origen no permitido' });
  req.sesion = s;
  next();
}

/** Límite de intentos de login por IP + email: 10 cada 15 minutos. */
export async function intentoPermitido(ip: string, email: string) {
  const k = `panel:login:${ip}:${email.toLowerCase()}`;
  const n = await redis.incr(k);
  if (n === 1) await redis.expire(k, 900);
  return n <= 10;
}
