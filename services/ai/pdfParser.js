'use strict';

const MAX_CHARS = parseInt(process.env.AI_MAX_CHARS || '80000', 10);

// ── Basic PDF text extractor (no external deps) ──────────────────────────────
// Works for native-text PDFs; scanned/image PDFs need pdf-parse or OCR
function extractPdfBasic(buf) {
  const s = buf.toString('latin1');
  const parts = [];

  // BT…ET blocks
  const bt = /BT([\s\S]*?)ET/g;
  let m;
  while ((m = bt.exec(s)) !== null) {
    const block = m[1];
    // (text) Tj
    const tj = /\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*Tj/g;
    let t;
    while ((t = tj.exec(block)) !== null) parts.push(unescape(t[1]));
    // [(text)]TJ
    const tjArr = /\[([^\]]*)\]\s*TJ/g;
    while ((t = tjArr.exec(block)) !== null) {
      const inner = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g;
      let inn;
      while ((inn = inner.exec(t[1])) !== null) parts.push(unescape(inn[1]));
    }
  }

  // Stream-level text scan (catches some PDFs the above misses)
  const streamText = s.replace(/[\x00-\x08\x0b\x0e-\x1f\x7f-\xff]/g, ' ');
  const words = streamText.match(/[A-Za-zÀ-ÿ]{3,}/g) || [];
  if (parts.length < 50 && words.length > 200) return words.join(' ');

  return parts
    .join(' ')
    .replace(/\\n/g, '\n').replace(/\\r/g, ' ').replace(/\\t/g, ' ')
    .replace(/\\([()\\])/g, '$1')
    .replace(/ {2,}/g, ' ')
    .trim();
}

function unescape(s) {
  return s.replace(/\\n/g, ' ').replace(/\\r/g, ' ').replace(/\\t/g, ' ')
          .replace(/\\([()\\])/g, '$1');
}

// ── HTML stripper ────────────────────────────────────────────────────────────
function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/ {2,}/g, ' ').trim();
}

// ── Main entry ───────────────────────────────────────────────────────────────
async function parseContent({ text, base64, mimeType = 'text/plain', filename = '' }) {
  let extracted = '';
  let method    = 'text';
  let pages     = null;

  if (text) {
    // Direct text (textarea or plain file)
    extracted = mimeType === 'text/html' || filename.endsWith('.html')
      ? stripHtml(text)
      : text.trim();
    method = 'text';

  } else if (base64) {
    const buf  = Buffer.from(base64, 'base64');
    const mime = mimeType.toLowerCase();
    const ext  = (filename.split('.').pop() || '').toLowerCase();
    const isPdf = mime.includes('pdf') || ext === 'pdf';

    if (isPdf) {
      // Try optional pdf-parse first
      try {
        const pp = require('pdf-parse');
        const d  = await pp(buf, { max: 0 });
        if (d.text && d.text.trim().length > 100) {
          extracted = d.text.trim();
          method    = 'pdf-parse';
          pages     = d.numpages;
        }
      } catch {}

      if (!extracted) {
        extracted = extractPdfBasic(buf);
        method = 'pdf-basic';
      }

      if (extracted.length < 80) {
        throw new Error(
          'Ce PDF contient des images scannées. Utilisez un PDF avec du texte natif, ' +
          'ou copiez-collez le texte directement.'
        );
      }
    } else {
      // Plain text, markdown, etc.
      extracted = buf.toString('utf8').trim();
      method = 'file-text';
    }
  } else {
    throw new Error('Aucun contenu fourni.');
  }

  if (!extracted || extracted.length < 20) throw new Error('Document trop court ou vide.');

  // Truncate if too long
  const truncated = extracted.length > MAX_CHARS;
  if (truncated) extracted = extracted.slice(0, MAX_CHARS);

  return { text: extracted, method, pages, truncated, charCount: extracted.length };
}

module.exports = { parseContent };
