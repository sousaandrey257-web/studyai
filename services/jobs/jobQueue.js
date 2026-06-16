'use strict';
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const DIR     = path.join(__dirname, '../../data/jobs');
const TTL_MS  = 24 * 3600_000; // 24 hours
const MAX_MEM = 500;

try { if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true }); } catch {}

const mem = new Map(); // jobId → job (hot cache)

function genId() { return crypto.randomBytes(10).toString('hex'); }

function persist(job) {
  try {
    const tmp = path.join(DIR, `${job.id}.tmp`);
    const dst = path.join(DIR, `${job.id}.json`);
    fs.writeFileSync(tmp, JSON.stringify(job));
    fs.renameSync(tmp, dst);
  } catch {}
}

function load(id) {
  if (mem.has(id)) return mem.get(id);
  try {
    const j = JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8'));
    if (mem.size < MAX_MEM) mem.set(id, j);
    return j;
  } catch { return null; }
}

function create(data = {}) {
  const job = {
    id:            genId(),
    status:        'pending',   // pending|processing|done|failed
    progress:      0,
    progressLabel: 'En attente…',
    result:        null,
    error:         null,
    createdAt:     new Date().toISOString(),
    updatedAt:     new Date().toISOString(),
    ...data,
  };
  mem.set(job.id, job);
  persist(job);
  return job;
}

function update(id, patch) {
  const job = load(id);
  if (!job) return null;
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  mem.set(id, job);
  persist(job);
  return job;
}

function get(id) { return load(id); }

function getSafe(id) {
  const j = get(id);
  if (!j) return null;
  // Never expose full result to public — caller decides
  return {
    id:            j.id,
    status:        j.status,
    progress:      j.progress,
    progressLabel: j.progressLabel,
    error:         j.error,
    createdAt:     j.createdAt,
    updatedAt:     j.updatedAt,
    userId:        j.userId || null,
    mode:          j.mode || null,
    filename:      j.filename || null,
  };
}

// Cleanup expired jobs
function cleanup() {
  const cut = Date.now() - TTL_MS;
  for (const [id, j] of mem) {
    if (new Date(j.createdAt).getTime() < cut) mem.delete(id);
  }
  try {
    fs.readdirSync(DIR).filter(f => f.endsWith('.json')).forEach(f => {
      const fp = path.join(DIR, f);
      try {
        const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
        if (new Date(j.createdAt).getTime() < cut) { fs.unlinkSync(fp); mem.delete(j.id); }
      } catch {}
    });
  } catch {}
}
const cleanupTimer = setInterval(cleanup, 3600_000);
if (cleanupTimer.unref) cleanupTimer.unref();

module.exports = { create, update, get, getSafe };
