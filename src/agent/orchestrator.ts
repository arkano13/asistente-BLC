import Anthropic from '@anthropic-ai/sdk';
import { config, type Effort } from '../config.js';
import type { Contacto, Empresa, Mensaje } from '../db/prisma.js';
import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';
import { ejecutarHerramienta, herramientasPara } from '../tools/index.js';
import { construirSistema } from './prompt.js';

export const anthropic = new Anthropic(); // lee ANTHROPIC_API_KEY

/** Historial guardado -> turnos user/assistant alternados (requisito de la API). */
export function aMensajes(historial: Mensaje[], pendientes: Mensaje[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const m of [...historial, ...pendientes]) {
    const role = m.direccion === 'ENTRANTE' ? 'user' : 'assistant';
    const ultimo = out.at(-1);
    if (ultimo && ultimo.role === role) ultimo.content = `${ultimo.content as string}\n${m.contenido}`;
    else out.push({ role, content: m.contenido });
  }
  while (out[0]?.role === 'assistant') out.shift(); // debe empezar con user
  return out;
}

export interface Resultado {
  texto: string;
  herramientas: string[];
  uso: { entrada: number; salida: number; cache: number };
}

/** Loop del agente: llama a Claude, ejecuta las herramientas que pida y repite hasta responder. */
export async function ejecutarAgente(empresa: Empresa, contacto: Contacto, messages: Anthropic.MessageParam[]): Promise<Resultado> {
  const log = logger.child({ empresa: empresa.id, contacto: contacto.id });
  const usadas: string[] = [];
  const uso = { entrada: 0, salida: 0, cache: 0 };
  const tools = herramientasPara(empresa, contacto.rol);
  const [leads, escalamientos] = await Promise.all([
    prisma.lead.findMany({ where: { contactoId: contacto.id }, select: { interes: true, creadoEn: true }, orderBy: { creadoEn: 'desc' }, take: 5 }),
    prisma.escalamiento.findMany({ where: { contactoId: contacto.id }, select: { motivo: true, estado: true, creadoEn: true }, orderBy: { creadoEn: 'desc' }, take: 5 }),
  ]);
  const system = construirSistema(empresa, contacto, { leads, escalamientos });

  for (let vuelta = 0; vuelta < config.MAX_TOOL_TURNS; vuelta++) {
    const res = await anthropic.messages.create({
      model: empresa.modelo ?? config.DEFAULT_MODEL,
      max_tokens: 16000,
      system,
      tools,
      messages,
      output_config: { effort: (empresa.esfuerzo as Effort | null) ?? config.DEFAULT_EFFORT },
    });
    uso.entrada += res.usage.input_tokens;
    uso.salida += res.usage.output_tokens;
    uso.cache += res.usage.cache_read_input_tokens ?? 0;

    // El clasificador de seguridad puede rechazar: respuesta segura y oferta de humano.
    if (res.stop_reason === 'refusal') {
      return { texto: 'Disculpa, no puedo ayudarte con eso por aquí. ¿Quieres que te comunique con una persona del equipo?', herramientas: usadas, uso };
    }

    // Se devuelve el contenido completo (incluye bloques de thinking) sin modificar.
    messages.push({ role: 'assistant', content: res.content });

    if (res.stop_reason !== 'tool_use') {
      const texto = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim();
      log.debug({ uso }, 'respuesta final');
      return { texto, herramientas: usadas, uso };
    }

    // Todas las herramientas pedidas, en paralelo, y TODOS los resultados en un solo mensaje.
    const llamadas = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    const resultados = await Promise.all(
      llamadas.map(async (c): Promise<Anthropic.ToolResultBlockParam> => {
        usadas.push(c.name);
        try {
          const out = await ejecutarHerramienta(c.name, c.input, { empresa, contacto });
          return { type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(out) };
        } catch (err) {
          log.error({ err, tool: c.name }, 'error en herramienta');
          return { type: 'tool_result', tool_use_id: c.id, content: `Error: ${(err as Error).message}`, is_error: true };
        }
      }),
    );
    messages.push({ role: 'user', content: resultados });
  }

  log.warn('se alcanzó MAX_TOOL_TURNS');
  return { texto: 'Déjame revisarlo con el equipo y te respondo en breve.', herramientas: usadas, uso };
}
