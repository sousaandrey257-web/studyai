'use strict';

const MAX_SIZE_B    = parseInt(process.env.UPLOAD_MAX_MB || '20', 10) * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  'text/plain', 'text/markdown', 'text/html',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/x-markdown',
]);
const ALLOWED_EXTS  = new Set(['txt', 'md', 'pdf', 'html', 'htm', 'docx', 'doc', 'tex']);

const DANGEROUS_PATTERNS = [
  /^%PDF-.*\/JavaScript/i,           // PDF with embedded JS
  /<script/i,                        // Script tags in HTML
  /\/ObjStm/i,                       // PDF object streams (obfuscation)
  /\/EmbeddedFile/i,                  // Embedded files in PDF
];

function validateUpload({ base64, mimeType = '', filename = '', textLength = 0 }) {
  const ext = (filename.split('.').pop() || '').toLowerCase();

  // Size check (base64 is ~33% larger than binary)
  if (base64) {
    const estimatedBytes = Math.ceil(base64.length * 0.75);
    if (estimatedBytes > MAX_SIZE_B) {
      return { ok: false, error: `Fichier trop volumineux (max ${MAX_SIZE_B / 1024 / 1024}Mo).` };
    }
  }

  // Text content check
  if (textLength > 0 && textLength > MAX_SIZE_B) {
    return { ok: false, error: `Texte trop long (max ${MAX_SIZE_B / 1024}Ko).` };
  }

  // MIME type check (if provided)
  if (mimeType && !ALLOWED_TYPES.has(mimeType) && !mimeType.startsWith('text/')) {
    return { ok: false, error: `Type de fichier non supporté : ${mimeType}` };
  }

  // Extension check
  if (ext && !ALLOWED_EXTS.has(ext)) {
    return { ok: false, error: `Extension non supportée : .${ext}` };
  }

  // Anti zip-bomb: check base64 length vs reported type
  if (base64 && ext === 'pdf') {
    const bytes = Math.ceil(base64.length * 0.75);
    if (bytes < 100) return { ok: false, error: 'Fichier PDF invalide.' };
  }

  // Dangerous pattern scan (sample first 4KB)
  if (base64) {
    const sample = Buffer.from(base64.slice(0, 5500), 'base64').toString('latin1').slice(0, 4096);
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(sample)) {
        return { ok: false, error: 'Fichier rejeté pour raison de sécurité.' };
      }
    }
  }

  return { ok: true };
}

module.exports = { validateUpload };
