import { GoogleGenAI } from '@google/genai';
import { downloadMediaMessage, type WAMessage, type WASocket } from 'baileys';
import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * Transcribe una nota de voz de WhatsApp con Gemini, igual que hotelbot (src/ai/gemini.js → transcribirAudio).
 * Devuelve null si no hay GEMINI_API_KEY, el audio es demasiado largo o algo falla; en ese caso el bot pide escribirlo.
 */
const ai = config.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: config.GEMINI_API_KEY }) : null;

export async function transcribirNota(msg: WAMessage, sock: WASocket): Promise<string | null> {
  const audio = msg.message?.audioMessage;
  if (!audio || !ai) return null;
  if ((audio.seconds ?? 0) > config.MAX_SEGUNDOS_AUDIO) return null;
  try {
    const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: logger as never, reuploadRequest: sock.updateMediaMessage });
    let ultimoError: unknown;
    for (let intento = 1; intento <= 3; intento++) {
      try {
        const res = await ai.models.generateContent({
          model: config.GEMINI_MODEL,
          contents: [
            {
              role: 'user',
              parts: [
                { inlineData: { mimeType: audio.mimetype ?? 'audio/ogg', data: Buffer.from(buffer).toString('base64') } },
                {
                  text:
                    'Transcribe este audio de WhatsApp a texto en español. ' +
                    'Responde únicamente con la transcripción, sin comentarios ni explicaciones adicionales. ' +
                    'Si no se entiende nada, responde solamente con: [audio no entendido]',
                },
              ],
            },
          ],
          config: { temperature: 0, maxOutputTokens: 300 },
        });
        const texto = res.text?.trim();
        logger.info({ segundos: audio.seconds, caracteres: texto?.length ?? 0 }, 'nota de voz transcrita');
        return texto && texto !== '[audio no entendido]' ? texto : null;
      } catch (err) {
        ultimoError = err;
        const status = (err as { status?: number }).status;
        if (!status || ![408, 429, 500, 502, 503, 504].includes(status)) break;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** (intento - 1)));
      }
    }
    logger.error({ err: ultimoError }, 'transcripción fallida');
    return null;
  } catch (err) {
    logger.error({ err }, 'no se pudo descargar la nota de voz');
    return null;
  }
}
