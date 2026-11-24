import { config } from '../config.js';
import { prisma, type Contacto, type Empresa } from '../db/prisma.js';
import { historial } from '../db/repo.js';
import { anthropic } from './orchestrator.js';

/**
 * Memoria de largo plazo: cada 20 mensajes se reescribe un resumen corto del contacto.
 * Va en el prompt; el historial crudo solo cubre los últimos HISTORY_LIMIT mensajes.
 */
const CADA = 20;

export async function actualizarResumen(empresa: Empresa, contacto: Contacto) {
  const total = await prisma.mensaje.count({ where: { contactoId: contacto.id } });
  if (total % CADA >= 2) return;
  const msgs = await historial(contacto.id, 40);
  const transcripcion = msgs.map((m) => `${m.direccion === 'ENTRANTE' ? 'Contacto' : 'Asistente'}: ${m.contenido}`).join('\n');
  const res = await anthropic.messages.create({
    model: empresa.modelo ?? config.DEFAULT_MODEL,
    max_tokens: 2000,
    output_config: { effort: 'low' },
    system:
      'Resume en máximo 8 viñetas lo que conviene recordar de este contacto: datos que dio, intereses, compromisos, citas y problemas abiertos. Solo hechos explícitos.',
    messages: [{ role: 'user', content: `Resumen anterior:\n${contacto.resumen ?? '(ninguno)'}\n\nConversación reciente:\n${transcripcion}` }],
  });
  if (res.stop_reason === 'refusal') return;
  const texto = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim();
  if (texto) await prisma.contacto.update({ where: { id: contacto.id }, data: { resumen: texto } });
}
