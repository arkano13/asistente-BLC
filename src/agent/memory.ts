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

/** Estado estructurado de la conversación: el modelo lo recibe en cada turno como fuente de verdad. */
export interface EstadoConversacion {
  intencion: string;
  necesidad: string;
  brecha: string;
  siguiente_paso_deseado: string;
  contexto: string;
  objetivo: string;
  datos: { nombre: string; organizacion: string; cargo: string; email: string };
  ultima_pregunta_asistente: string;
  ultima_pregunta_respondida: boolean;
  preguntas_ya_hechas: string[];
  dato_pendiente: string;
  etapa: 'inicio' | 'explorando_necesidad' | 'necesidad_clara' | 'acepto_avanzar' | 'registrado' | 'trasladado' | 'cerrado';
  accion_pendiente: string;
}

const texto = { type: 'string' } as const;
const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['intencion', 'necesidad', 'brecha', 'siguiente_paso_deseado', 'contexto', 'objetivo', 'datos', 'ultima_pregunta_asistente', 'ultima_pregunta_respondida', 'preguntas_ya_hechas', 'dato_pendiente', 'etapa', 'accion_pendiente'],
  properties: {
    intencion: { type: 'string', description: 'Qué busca: conferencia, taller, programa, proceso, automatización, diagnóstico, programa en línea, precio, hablar con alguien, queja u otra. Vacío si no está claro.' },
    necesidad: { type: 'string', description: 'Lo que la persona dijo que necesita, con sus palabras. Vacío si aún no lo dijo.' },
    brecha: { type: 'string', description: 'Qué está ocurriendo hoy y qué impacto tiene, si lo explicó.' },
    siguiente_paso_deseado: { type: 'string', description: 'Lo que la persona dijo que quiere hacer a continuación (diagnóstico, propuesta, comprar, hablar con alguien). Vacío si no lo dijo.' },
    contexto: { type: 'string', description: 'Datos de su negocio o situación que explicó (rubro, tamaño, cómo trabaja hoy). Vacío si no dio.' },
    objetivo: { type: 'string', description: 'Resultado que espera lograr, si lo dijo.' },
    datos: {
      type: 'object',
      additionalProperties: false,
      required: ['nombre', 'organizacion', 'cargo', 'email'],
      properties: { nombre: texto, organizacion: texto, cargo: texto, email: texto },
    },
    ultima_pregunta_asistente: { type: 'string', description: 'La última pregunta que hizo el asistente, resumida.' },
    ultima_pregunta_respondida: { type: 'boolean' },
    preguntas_ya_hechas: { type: 'array', items: texto, description: 'Preguntas que el asistente ya hizo (cortas), para no repetirlas.' },
    dato_pendiente: { type: 'string', description: 'Dato que el asistente pidió y la persona aún no dio. Vacío si nada.' },
    etapa: { type: 'string', enum: ['inicio', 'explorando_necesidad', 'necesidad_clara', 'acepto_avanzar', 'registrado', 'trasladado', 'cerrado'] },
    accion_pendiente: { type: 'string', description: 'Siguiente paso razonable para el asistente, en una línea.' },
  },
};

export async function actualizarEstado(empresa: Empresa, contacto: Contacto) {
  const [msgs, leads, escalamientos] = await Promise.all([
    historial(contacto.id, 30),
    prisma.lead.count({ where: { contactoId: contacto.id } }),
    prisma.escalamiento.count({ where: { contactoId: contacto.id } }),
  ]);
  const transcripcion = msgs.map((m) => `${m.direccion === 'ENTRANTE' ? 'Contacto' : 'Asistente'}: ${m.contenido}`).join('\n');
  const res = await anthropic.messages.create({
    model: empresa.modelo ?? config.DEFAULT_MODEL,
    max_tokens: 2000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA } },
    system:
      'Extrae el estado de esta conversación de WhatsApp entre un asistente y un contacto. Solo hechos explícitos: no atribuyas intereses que el contacto no dijo con sus palabras (las opciones que el asistente ofreció no son intereses del contacto). Un "ok" o "adelante" no aporta datos: si el asistente pidió un dato y no llegó, queda en dato_pendiente.',
    messages: [
      {
        role: 'user',
        content: `Estado anterior: ${JSON.stringify(contacto.estado ?? null)}\nLeads registrados: ${leads}. Traslados al equipo: ${escalamientos}.\n\nConversación:\n${transcripcion}`,
      },
    ],
  });
  if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens') return;
  const json = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  const estado = JSON.parse(json) as EstadoConversacion;
  await prisma.contacto.update({ where: { id: contacto.id }, data: { estado: estado as object } });
}
