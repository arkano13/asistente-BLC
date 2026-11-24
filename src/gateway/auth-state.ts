import { BufferJSON, initAuthCreds, proto, type AuthenticationCreds, type AuthenticationState, type SignalDataTypeMap } from 'baileys';
import { prisma } from '../db/prisma.js';

/**
 * Sesión de Baileys en Postgres (hotelbot la guardaba en DATA_DIR). Sobrevive a redeploys
 * de Railway sin volumen y permite mover una empresa entre instancias del gateway.
 */
export async function usarAuthPostgres(empresaId: string): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void>; borrar: () => Promise<void> }> {
  const leer = async (clave: string) => {
    const fila = await prisma.waAuth.findUnique({ where: { empresaId_clave: { empresaId, clave } } });
    return fila ? JSON.parse(fila.valor, BufferJSON.reviver) : null;
  };
  const escribir = (clave: string, dato: unknown) => {
    const valor = JSON.stringify(dato, BufferJSON.replacer);
    return prisma.waAuth.upsert({ where: { empresaId_clave: { empresaId, clave } }, create: { empresaId, clave, valor }, update: { valor } });
  };
  const quitar = (clave: string) => prisma.waAuth.deleteMany({ where: { empresaId, clave } });

  const creds: AuthenticationCreds = (await leer('creds')) ?? initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(tipo: T, ids: string[]) => {
          const out: { [id: string]: SignalDataTypeMap[T] } = {};
          await Promise.all(
            ids.map(async (id) => {
              let v = await leer(`${tipo}-${id}`);
              if (tipo === 'app-state-sync-key' && v) v = proto.Message.AppStateSyncKeyData.fromObject(v);
              if (v) out[id] = v;
            }),
          );
          return out;
        },
        set: async (data) => {
          const tareas: Promise<unknown>[] = [];
          for (const tipo of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
            for (const [id, v] of Object.entries(data[tipo] ?? {})) {
              tareas.push(v ? escribir(`${tipo}-${id}`, v) : quitar(`${tipo}-${id}`));
            }
          }
          await Promise.all(tareas);
        },
      },
    },
    saveCreds: async () => {
      await escribir('creds', creds);
    },
    borrar: async () => {
      await prisma.waAuth.deleteMany({ where: { empresaId } });
    },
  };
}
