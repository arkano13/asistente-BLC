import { empresasActivas } from '../db/repo.js';
import { logger } from '../logger.js';
import { TenantSession } from './session.js';

/**
 * Proceso gateway: mantiene un socket Baileys por empresa activa.
 * Para escalar, SHARD=0/2, 1/2... reparte empresas entre instancias (hash del id).
 */
const sessions = new Map<string, TenantSession>();
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);

const owns = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % shards === shard;

async function reconcile() {
  const active = new Set((await empresasActivas()).map((t) => t.id).filter(owns));
  for (const id of active) {
    if (!sessions.has(id)) {
      const s = new TenantSession(id);
      sessions.set(id, s);
      s.start()
        .then((ok) => {
          if (ok) return;
          sessions.delete(id); // otra instancia tiene el número: se reintenta en el próximo ciclo
          logger.warn({ empresa: id }, 'sesión tomada por otra instancia; reintento en 30 s');
        })
        .catch((err) => {
          sessions.delete(id);
          logger.error({ err, empresa: id }, 'no se pudo iniciar la sesión');
        });
    }
  }
  for (const [id, s] of sessions) {
    if (!active.has(id)) {
      await s.stop();
      sessions.delete(id);
    }
  }
}

await reconcile();
setInterval(() => reconcile().catch((err) => logger.error({ err }, 'reconcile')), 30_000);
logger.info({ shard, shards }, 'gateway iniciado');

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await Promise.all([...sessions.values()].map((s) => s.stop()));
    process.exit(0);
  });
}
