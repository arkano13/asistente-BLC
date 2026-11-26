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

/**
 * Memoria estructurada del prospecto. Se recalcula al llegar cada mensaje (antes de responder),
 * así el modelo ve en cada turno qué sabe, qué falta y si ya puede registrar o trasladar.
 */
export interface Prospecto {
  nombre: string;
  empresa: string;
  tamano: string;
  cargo: string;
  intencion: string;
  problema: string;
  impacto: string;
  brecha: string;
  urgencia: string;
  siguiente_paso: string;
  email: string;
}
export interface EstadoConversacion {
  prospecto: Prospecto;
  pide_humano: boolean;
  queja: boolean;
  urgente: boolean;
  ruta: 'servicios' | 'programa_online' | 'sin_definir';
  ultima_pregunta_asistente: string;
  preguntas_ya_hechas: string[];
}

const texto = (description: string) => ({ type: 'string', description }) as const;
const CAMPOS: Record<keyof Prospecto, string> = {
  nombre: 'Nombre de la persona.',
  empresa: 'Empresa u organización.',
  tamano: 'Tamaño de la organización o del grupo (colaboradores, asistentes, equipo afectado).',
  cargo: 'Cargo o rol de la persona.',
  intencion: 'Qué busca: conferencia, taller, programa, proceso, automatización, diagnóstico, programa online, precio u otra.',
  problema: 'Problema o necesidad, con sus palabras.',
  impacto: 'Qué efecto tiene hoy ese problema (en resultados, personas, tiempo, dinero).',
  brecha: 'Diferencia entre cómo está hoy y lo que quiere lograr (resultado esperado).',
  urgencia: 'Plazo o fecha (por ejemplo, evento en marzo, lo antes posible).',
  siguiente_paso: 'Lo que dijo que quiere hacer ahora: diagnóstico, propuesta, cotización, comprar, hablar con alguien.',
  email: 'Correo, si lo dio.',
};
const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['prospecto', 'pide_humano', 'queja', 'urgente', 'ruta', 'ultima_pregunta_asistente', 'preguntas_ya_hechas'],
  properties: {
    prospecto: {
      type: 'object',
      additionalProperties: false,
      required: Object.keys(CAMPOS),
      properties: Object.fromEntries(Object.entries(CAMPOS).map(([k, d]) => [k, texto(`${d} Cadena vacía si no lo dijo.`)])),
    },
    pide_humano: { type: 'boolean', description: 'Pidió hablar con una persona del equipo.' },
    queja: { type: 'boolean', description: 'Expresó una queja o molestia.' },
    urgente: { type: 'boolean', description: 'Planteó una urgencia que no puede esperar.' },
    ruta: { type: 'string', enum: ['servicios', 'programa_online', 'sin_definir'], description: 'programa_online si busca Líder Intencional o formarse por su cuenta; servicios si es para su organización o un evento.' },
    ultima_pregunta_asistente: texto('Última pregunta que hizo el asistente, resumida. Vacío si ninguna.'),
    preguntas_ya_hechas: { type: 'array', items: { type: 'string' }, description: 'Preguntas que el asistente ya hizo, cortas.' },
  },
};

/** nuevos: mensajes recién llegados que aún no están procesados (no salen en el historial). */
export async function actualizarEstado(empresa: Empresa, contacto: Contacto, nuevos: { contenido: string }[] = []) {
  const msgs = [...(await historial(contacto.id, 30)), ...nuevos.map((m) => ({ direccion: 'ENTRANTE', contenido: m.contenido }))];
  if (!msgs.length) return contacto.estado;
  const transcripcion = msgs.map((m) => `${m.direccion === 'ENTRANTE' ? 'Contacto' : 'Asistente'}: ${m.contenido}`).join('\n');
  const res = await anthropic.messages.create({
    model: empresa.modelo ?? config.DEFAULT_MODEL,
    max_tokens: 2000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA } },
    system:
      'Actualiza la ficha del prospecto con lo que dijo en esta conversación de WhatsApp. Solo hechos que el contacto dijo explícitamente; conserva los datos anteriores salvo que los corrija. Las opciones que ofreció el asistente no son intereses del contacto, y un "ok" o "adelante" no aporta datos.',
    messages: [{ role: 'user', content: `Ficha anterior: ${JSON.stringify(contacto.estado ?? null)}\n\nConversación:\n${transcripcion}` }],
  });
  if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens') return contacto.estado;
  const estado = JSON.parse(res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')) as EstadoConversacion;
  await prisma.contacto.update({ where: { id: contacto.id }, data: { estado: estado as object } });
  return estado as object;
}

/**
 * Regla de avance (determinística), ruta de servicios:
 *   entender            falta lo mínimo: intención, problema, impacto o brecha, empresa
 *   proponer_paso       ya está lo mínimo: ofrecer el siguiente paso (diagnóstico, coordinación)
 *   pedir_nombre        aceptó avanzar y falta el nombre
 *   registrar_y_trasladar  todo listo
 * Pide humano, queja o urgencia: trasladar_ya. Programa online: venta directa, sin traslado.
 */
export type Decision = 'entender' | 'proponer_paso' | 'pedir_nombre' | 'registrar_y_trasladar' | 'trasladar_ya' | 'vender_programa';
const PREGUNTA: Partial<Record<keyof Prospecto, string>> = {
  intencion: 'qué busca',
  problema: 'qué problema o necesidad quiere resolver',
  impacto: 'qué efecto tiene hoy ese problema o qué resultado quiere lograr',
  empresa: 'en qué empresa u organización',
  tamano: 'tamaño de la organización o del grupo',
  urgencia: 'para cuándo lo necesita',
  cargo: 'su cargo',
  nombre: 'su nombre',
};
export function reglaDeAvance(estado: unknown): { decision: Decision; faltan: string[]; opcionales: string[] } {
  const e = estado as Partial<EstadoConversacion> | null;
  const p = e?.prospecto;
  const tiene = (k: keyof Prospecto) => !!p?.[k]?.trim();
  if (e?.pide_humano || e?.queja || e?.urgente) return { decision: 'trasladar_ya', faltan: [], opcionales: [] };
  if (e?.ruta === 'programa_online') return { decision: 'vender_programa', faltan: tiene('problema') ? [] : ['qué quiere desarrollar como líder'], opcionales: [] };
  const faltan: string[] = [];
  if (!tiene('intencion')) faltan.push(PREGUNTA.intencion!);
  if (!tiene('problema')) faltan.push(PREGUNTA.problema!);
  if (!tiene('impacto') && !tiene('brecha')) faltan.push(PREGUNTA.impacto!);
  if (!tiene('empresa')) faltan.push(PREGUNTA.empresa!);
  const opcionales = (['tamano', 'urgencia', 'cargo'] as const).filter((k) => !tiene(k)).map((k) => PREGUNTA[k]!);
  if (faltan.length) return { decision: 'entender', faltan, opcionales };
  if (!tiene('siguiente_paso')) return { decision: 'proponer_paso', faltan: [], opcionales };
  if (!tiene('nombre')) return { decision: 'pedir_nombre', faltan: [PREGUNTA.nombre!], opcionales: [] };
  return { decision: 'registrar_y_trasladar', faltan: [], opcionales: [] };
}
