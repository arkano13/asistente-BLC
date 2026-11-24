import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { config } from '../config.js';

// BullMQ exige maxRetriesPerRequest: null en conexiones que bloquean.
export const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });

/** Trabajo "hay mensajes pendientes en este chat". El contenido vive en Postgres. */
export interface InboundJob {
  empresaId: string;
  jid: string;
}

/** texto: enviar respuesta · no_leido: marcar el chat como no leído para que el equipo lo vea. */
export type OutboundJob = { accion?: 'texto'; jid: string; text: string; forzar?: boolean } | { accion: 'no_leido'; jid: string };

export const INBOUND = 'inbound';
/** Una cola de salida por empresa: el gateway que tiene el socket de ese número la consume. */
export const nombreSalida = (empresaId: string) => `outbound.${empresaId}`;

export const colaEntrada = new Queue<InboundJob>(INBOUND, { connection: redis });

const colaSalidas = new Map<string, Queue<OutboundJob>>();
export function colaSalida(empresaId: string) {
  let q = colaSalidas.get(empresaId);
  if (!q) {
    q = new Queue<OutboundJob>(nombreSalida(empresaId), { connection: redis });
    colaSalidas.set(empresaId, q);
  }
  return q;
}

/**
 * Agenda el procesamiento de un chat con debounce: si el cliente manda 3 mensajes seguidos,
 * el jobId fijo hace que solo exista un trabajo y el agente responde una vez a los 3.
 */
export async function agendarChat(job: InboundJob, delay: number) {
  await colaEntrada.add('chat', job, {
    jobId: `${job.empresaId}__${job.jid}`,
    delay,
    removeOnComplete: true,
    removeOnFail: 100,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  });
}

/** forzar: enviar aunque el chat ya esté en modo HUMANO (el mensaje de traspaso del propio agente). */
export const enviarTexto = (empresaId: string, jid: string, text: string, forzar = false) =>
  colaSalida(empresaId).add('send', { jid, text, forzar }, { removeOnComplete: true, removeOnFail: 100, attempts: 5, backoff: { type: 'exponential', delay: 3000 } });

export const marcarNoLeido = (empresaId: string, jid: string) =>
  colaSalida(empresaId).add('no_leido', { accion: 'no_leido', jid }, { removeOnComplete: true, removeOnFail: 100 });

/** Ids de mensajes que envió el bot: lo que salga del número y no esté aquí lo escribió una persona. */
export const enviadoKey = (empresaId: string, id: string) => `wa:enviado:${empresaId}:${id}`;
/** Último mensaje entrante por chat (necesario para marcarlo como no leído). */
export const ultimoKey = (empresaId: string, jid: string) => `wa:ultimo:${empresaId}:${jid}`;

export const qrKey = (empresaId: string) => `wa:qr:${empresaId}`;
export const statusKey = (empresaId: string) => `wa:status:${empresaId}`;

/**
 * Lock por empresa: un número de WhatsApp debe tener UN solo socket. Si dos instancias del gateway
 * se cruzan (redeploy, réplica de más), la segunda no conecta y no se rompe la sesión.
 */
const INSTANCIA = randomUUID();
const lockKey = (empresaId: string) => `wa:lock:${empresaId}`;
export const tomarLock = async (empresaId: string) => (await redis.set(lockKey(empresaId), INSTANCIA, 'EX', 30, 'NX')) === 'OK';
export const renovarLock = async (empresaId: string) =>
  (await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], 30) else return 0 end", 1, lockKey(empresaId), INSTANCIA)) === 1;
export const soltarLock = (empresaId: string) =>
  redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, lockKey(empresaId), INSTANCIA);
