import { iniciarWorkerAgente } from './agent/worker.js';
import { crearServidor } from './api/server.js';
import { config } from './config.js';
import { logger } from './logger.js';

/** Proceso core: worker del agente + API. Sin estado: se puede correr más de una réplica. */
// Sin key la API arranca igual (para vincular WhatsApp), pero el agente no responde.
if (!process.env.ANTHROPIC_API_KEY) logger.error('Falta ANTHROPIC_API_KEY: el agente no podrá responder hasta cargarla');
const worker = iniciarWorkerAgente();
const server = crearServidor().listen(config.PORT, '0.0.0.0', () => logger.info({ port: config.PORT }, 'core iniciado'));

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await worker.close();
    server.close(() => process.exit(0));
  });
}
