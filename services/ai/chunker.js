'use strict';

const CHUNK_CHARS  = parseInt(process.env.AI_CHUNK_CHARS  || '14000', 10);
const SAMPLE_CHARS = parseInt(process.env.AI_SAMPLE_CHARS || '20000', 10);

function chunk(text) {
  if (text.length <= CHUNK_CHARS) return [text];

  const chunks = [];
  // Split on double newline (paragraphs) first
  const paras = text.split(/\n{2,}/);
  let buf = '';

  for (const para of paras) {
    if (buf.length + para.length > CHUNK_CHARS && buf.length > 0) {
      chunks.push(buf.trim());
      buf = '';
    }
    if (para.length > CHUNK_CHARS) {
      // Split long paragraph at sentence boundaries
      const sents = para.match(/[^.!?]+[.!?]+\s*/g) || [para];
      for (const s of sents) {
        if (buf.length + s.length > CHUNK_CHARS && buf.length > 0) {
          chunks.push(buf.trim());
          buf = '';
        }
        buf += s;
      }
    } else {
      buf += para + '\n\n';
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks;
}

// Representative sample for AI analysis — start + middle + end
function sample(text) {
  if (text.length <= SAMPLE_CHARS) return text;

  const third = Math.floor(SAMPLE_CHARS / 3);
  const start  = text.slice(0, third);
  const midOff = Math.floor(text.length / 2 - third / 2);
  const middle = text.slice(midOff, midOff + third);
  const end    = text.slice(-third);

  return [start, middle, end].join('\n\n[...]\n\n');
}

// Context window estimation (~4 chars/token)
function estimateTokens(text) { return Math.ceil(text.length / 4); }

module.exports = { chunk, sample, estimateTokens };
