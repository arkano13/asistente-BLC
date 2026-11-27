import { config } from '../config.js';
import type { Empresa } from '../db/prisma.js';
import { logger } from '../logger.js';
import { anthropic } from './orchestrator.js';

/** Largo máximo de un mensaje de WhatsApp del bot (sin contar enlaces). Arriba de esto se reescribe. */
export const MAX_CARACTERES = 320;

// Fórmulas de relleno al inicio del mensaje: suenan a bot y alargan sin aportar.
const RELLENO = [
  /^¡?qu[ée] (bueno|buena|gusto|interesante|excelente)[^.!?\n]*[.!]\s*/i,
  /^¡?(excelente|perfecto|genial|claro|por supuesto|con gusto|entiendo|entiendo perfectamente|comprendo|muy bien|gracias por (compartir|contarme|escribir)[^.!?\n]*)[.,!]\s*/i,
];

export function quitarRelleno(texto: string) {
  let t = texto.trim();
  for (let i = 0; i < 2; i++) for (const r of RELLENO) t = t.replace(r, '');
  return t ? t.replace(/\p{L}/u, (c) => c.toUpperCase()) : texto.trim();
}

const largo = (t: string) => t.replace(/https?:\/\/\S+|\b[\w.-]+\.(com|org|net)\/\S*/g, '').length;

/** Ajusta la respuesta al estilo WhatsApp: sin relleno inicial y, si se pasa del límite, la reescribe más corta. */
export async function ajustarRespuesta(empresa: Empresa, texto: string) {
  let t = quitarRelleno(texto);
  if (largo(t) <= MAX_CARACTERES) return t;
  try {
    const res = await anthropic.messages.create({
      model: empresa.modelo ?? config.DEFAULT_MODEL,
      max_tokens: 1000,
      output_config: { effort: 'low' },
      system: `Reescribe este mensaje de WhatsApp de un asistente comercial para que tenga como máximo ${MAX_CARACTERES - 40} caracteres (sin contar enlaces). Conserva el dato clave, cualquier enlace tal cual y la pregunta final si la hay (una sola). Formal pero natural, como una persona del equipo escribiendo por WhatsApp. Sin saludos, relleno, listas ni negritas. Si hay dos ideas, sepáralas con una línea en blanco. Devuelve solo el mensaje.`,
      messages: [{ role: 'user', content: t }],
    });
    const corto = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim();
    if (res.stop_reason === 'end_turn' && corto && largo(corto) < largo(t)) {
      logger.info({ antes: largo(t), despues: largo(corto) }, 'respuesta acortada');
      t = quitarRelleno(corto);
    }
  } catch (err) {
    logger.error({ err }, 'no se pudo acortar la respuesta');
  }
  return t;
}
