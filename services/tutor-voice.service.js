'use strict';

const { OpenAI, toFile } = require('openai');

const USE_GROQ = !!process.env.GROQ_API_KEY?.trim();

// Whisper is only available on Groq (free tier) — fall back gracefully
const _client = USE_GROQ
  ? new OpenAI({ apiKey: process.env.GROQ_API_KEY.trim(), baseURL: 'https://api.groq.com/openai/v1' })
  : null;

const WHISPER_MODEL    = 'whisper-large-v3';
const MAX_AUDIO_BYTES  = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIMES    = new Set([
  'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4',
  'audio/wav', 'audio/x-wav', 'audio/flac', 'audio/mp3',
]);
const MIME_TO_EXT = {
  'audio/webm': 'webm', 'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',  'audio/mp3': 'mp3',
  'audio/mp4':  'm4a',  'audio/wav': 'wav',
  'audio/x-wav': 'wav', 'audio/flac': 'flac',
};

/**
 * Transcribe an audio buffer via Groq Whisper Large v3.
 * @param {Buffer}  buffer   Raw audio bytes
 * @param {string}  mimeType e.g. "audio/webm"
 * @returns {Promise<string>} Transcribed text
 */
async function transcribe(buffer, mimeType) {
  if (!_client) throw new Error('Transcription indisponible (GROQ_API_KEY manquant).');
  if (!buffer || buffer.length === 0) throw new Error('Fichier audio vide.');
  if (buffer.length > MAX_AUDIO_BYTES)
    throw new Error('Fichier audio trop volumineux (max 10 MB).');

  const safe = mimeType?.toLowerCase() || 'audio/webm';
  if (!ALLOWED_MIMES.has(safe))
    throw new Error(`Format audio non supporté : ${safe}`);

  const ext  = MIME_TO_EXT[safe] || 'webm';
  const file = await toFile(buffer, `audio.${ext}`, { type: safe });

  const result = await _client.audio.transcriptions.create({
    file,
    model:           WHISPER_MODEL,
    response_format: 'text',
  });

  const text = (typeof result === 'string' ? result : result?.text || '').trim();
  if (!text) throw new Error('Whisper n\'a retourné aucun texte.');
  return text;
}

module.exports = { transcribe, MAX_AUDIO_BYTES, ALLOWED_MIMES };
