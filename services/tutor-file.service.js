'use strict';

const { parseContent } = require('./ai/pdfParser');

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_CHARS      = 50_000;
const ALLOWED_MIMES  = new Set([
  'application/pdf',
  'text/plain', 'text/markdown', 'text/x-markdown',
  'application/octet-stream', // some browsers send this for .txt
]);

/**
 * Extract text from a PDF or plain-text buffer.
 * @param {Buffer}  buffer    Raw file bytes
 * @param {string}  mimeType  e.g. "application/pdf"
 * @param {string}  filename  Original filename for extension hint
 * @returns {Promise<{text: string, truncated: boolean, pages: number|null}>}
 */
async function extract(buffer, mimeType, filename = '') {
  if (!buffer || buffer.length === 0) throw new Error('Fichier vide.');
  if (buffer.length > MAX_FILE_BYTES)
    throw new Error('Fichier trop volumineux (max 10 MB).');

  const safe = mimeType?.toLowerCase() || 'application/octet-stream';
  const ext  = (filename.split('.').pop() || '').toLowerCase();
  const isPdf = safe.includes('pdf') || ext === 'pdf';
  const isTxt = safe.includes('text') || ['txt','md','markdown'].includes(ext) || safe === 'application/octet-stream';

  if (!isPdf && !isTxt)
    throw new Error(`Type de fichier non supporté : ${safe}. Utilise un PDF ou fichier texte.`);

  // Reuse the existing pdfParser (handles PDF + plain text, no extra deps)
  const b64 = buffer.toString('base64');
  const result = await parseContent({
    base64:   b64,
    mimeType: isPdf ? 'application/pdf' : 'text/plain',
    filename,
  });

  // Additional truncation to tutor limit
  let text      = result.text;
  let truncated = result.truncated;
  if (text.length > MAX_CHARS) {
    text      = text.slice(0, MAX_CHARS);
    truncated = true;
  }

  return { text, truncated, pages: result.pages ?? null };
}

module.exports = { extract, MAX_FILE_BYTES, ALLOWED_MIMES };
