import { downloadMediaMessage, type WAMessage, type WASocket } from 'baileys';
import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * Transcribe una nota de voz de WhatsApp con Whisper propio, en el servicio "whisper" de Railway
 * (red privada, sin API key ni costo por uso). Devuelve null si no está configurado, el audio es
 * demasiado largo o algo falla; en ese caso el bot pide escribir el mensaje.
 */
export async function transcribirNota(msg: WAMessage, sock: WASocket): Promise<string | null> {
  const audio = msg.message?.audioMessage;
  if (!audio || !config.WHISPER_URL) return null;
  if ((audio.seconds ?? 0) > config.MAX_SEGUNDOS_AUDIO) return null;
  const inicio = Date.now();
  try {
    const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: logger as never, reuploadRequest: sock.updateMediaMessage });
    const form = new FormData();
    form.append('audio_file', new Blob([new Uint8Array(buffer)], { type: audio.mimetype ?? 'audio/ogg' }), 'nota.ogg');
    const url = `${config.WHISPER_URL.replace(/\/$/, '')}/asr?task=transcribe&language=es&output=json&encode=true`;
    const res = await fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(120_000) });
    if (!res.ok) {
      logger.error({ status: res.status, cuerpo: (await res.text()).slice(0, 300) }, 'transcripción fallida');
      return null;
    }
    const texto = ((await res.json()) as { text?: string }).text?.trim();
    logger.info({ segundos: audio.seconds, caracteres: texto?.length ?? 0, ms: Date.now() - inicio }, 'nota de voz transcrita');
    return texto || null;
  } catch (err) {
    logger.error({ err, ms: Date.now() - inicio }, 'transcripción fallida');
    return null;
  }
}
