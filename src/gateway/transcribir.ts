import { downloadMediaMessage, type WAMessage, type WASocket } from 'baileys';
import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * Transcribe una nota de voz de WhatsApp con Whisper large v3 turbo en Groq (USD 0,04 por hora de audio:
 * una nota de 1 minuto cuesta menos de una milésima de dólar). Devuelve null si no hay clave, el audio
 * es demasiado largo o algo falla; en ese caso el bot le pide a la persona que lo escriba.
 */
export async function transcribirNota(msg: WAMessage, sock: WASocket): Promise<string | null> {
  const audio = msg.message?.audioMessage;
  if (!audio || !config.GROQ_API_KEY) return null;
  if ((audio.seconds ?? 0) > config.MAX_SEGUNDOS_AUDIO) return null;
  try {
    const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: logger as never, reuploadRequest: sock.updateMediaMessage });
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)], { type: 'audio/ogg' }), 'nota.ogg');
    form.append('model', 'whisper-large-v3-turbo');
    form.append('language', 'es');
    form.append('response_format', 'json');
    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.GROQ_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      logger.error({ status: res.status, cuerpo: (await res.text()).slice(0, 300) }, 'transcripción fallida');
      return null;
    }
    const texto = ((await res.json()) as { text?: string }).text?.trim();
    logger.info({ segundos: audio.seconds, caracteres: texto?.length ?? 0 }, 'nota de voz transcrita');
    return texto || null;
  } catch (err) {
    logger.error({ err }, 'transcripción fallida');
    return null;
  }
}
