'use strict';

const { OpenAI } = require('openai');

const USE_GROQ = !!process.env.GROQ_API_KEY?.trim();
const _client  = USE_GROQ
  ? new OpenAI({ apiKey: process.env.GROQ_API_KEY.trim(), baseURL: 'https://api.groq.com/openai/v1' })
  : null;

// Same vision model as server.js /api/vision
const VISION_MODEL    = 'meta-llama/llama-4-scout-17b-16e-instruct';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIMES   = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const SYSTEM_PROMPT =
  'You are an expert at reading and analysing images related to school and university studies. ' +
  'Extract ALL visible text (questions, formulas, diagrams, handwriting) as accurately as possible. ' +
  'Describe diagrams, charts or figures that cannot be transcribed as text. ' +
  'Structure your output clearly. Respond in the same language as the text in the image.';

/**
 * Analyse a school-related image via Groq Vision.
 * @param {Buffer}  buffer    Raw image bytes
 * @param {string}  mimeType  e.g. "image/jpeg"
 * @param {string}  [lang]    Desired output language code (hint only)
 * @returns {Promise<string>} Description / extracted text
 */
async function analyse(buffer, mimeType, lang) {
  if (!_client) throw new Error('Vision indisponible (GROQ_API_KEY manquant).');
  if (!buffer || buffer.length === 0) throw new Error('Image vide.');
  if (buffer.length > MAX_IMAGE_BYTES)
    throw new Error('Image trop volumineuse (max 5 MB).');

  const safe = mimeType?.toLowerCase() || 'image/jpeg';
  if (!ALLOWED_MIMES.has(safe))
    throw new Error(`Format image non supporté : ${safe}`);

  const b64 = buffer.toString('base64');

  const userText = lang && lang !== 'en'
    ? `Extract all text and describe what you see. Reply in the language of the image content (hint: user's language is "${lang}").`
    : 'Extract all text and describe what you see.';

  const completion = await _client.chat.completions.create({
    model:      VISION_MODEL,
    messages:   [{
      role:    'user',
      content: [
        { type: 'text',      text: userText },
        { type: 'image_url', image_url: { url: `data:${safe};base64,${b64}` } },
      ],
    }],
    max_tokens: 2000,
  });

  const text = completion.choices?.[0]?.message?.content?.trim() || '';
  if (!text) throw new Error('Vision n\'a retourné aucune description.');
  return text;
}

module.exports = { analyse, MAX_IMAGE_BYTES, ALLOWED_MIMES };
