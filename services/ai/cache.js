'use strict';
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const DIR     = path.join(__dirname, '../../data/ai_cache');
const TTL_MS  = parseInt(process.env.AI_CACHE_TTL_H || '72', 10) * 3600_000;
const MAX_FILES = 500;

try { if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true }); } catch {}

function hash(text) {
  return crypto.createHash('sha256').update(text.slice(0, 20000)).digest('hex').slice(0, 20);
}

function get(h) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(DIR, `${h}.json`), 'utf8'));
    if (Date.now() - data.at > TTL_MS) { del(h); return null; }
    return data.v;
  } catch { return null; }
}

function set(h, value) {
  try {
    fs.writeFileSync(path.join(DIR, `${h}.json`), JSON.stringify({ at: Date.now(), v: value }));
    prune();
  } catch {}
}

function del(h) {
  try { fs.unlinkSync(path.join(DIR, `${h}.json`)); } catch {}
}

function prune() {
  try {
    const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json'));
    if (files.length <= MAX_FILES) return;
    const sorted = files
      .map(f => ({ f, mt: fs.statSync(path.join(DIR, f)).mtimeMs }))
      .sort((a, b) => a.mt - b.mt);
    sorted.slice(0, files.length - MAX_FILES).forEach(({ f }) => fs.unlinkSync(path.join(DIR, f)));
  } catch {}
}

module.exports = { hash, get, set, del };
