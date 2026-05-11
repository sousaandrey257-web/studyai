'use strict';
// Event Log Backbone — append-only durable event store.
//
// Storage priority:
//   1. Redis Streams  (studyai:events:v1)     — cluster/standalone aware, ordered, replayable
//   2. JSONL file     (/data/event-log.jsonl) — single-node persistent fallback
//   3. Memory buffer  (ring buffer 5k)        — last resort, survives only during process lifetime
//
// All public functions are async and never throw — failures are silently absorbed.

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const Redis  = require('../redis/cluster.client');

const STREAM_KEY    = 'studyai:events:v1';
const USER_KEY      = (uid) => `studyai:events:user:${uid}`;
const CKPT_KEY      = 'studyai:checkpoints';
const STREAM_MAXLEN = 100_000;  // MAXLEN ~ — approximate trim

const LOG_FILE      = path.join(__dirname, '../../data/event-log.jsonl');
const MAX_FILE_LINES = 10_000;
const MEM_MAX        = 5_000;

const _memBuf = []; // in-memory ring buffer
let _fileLineCount = 0;

// ── ID & canonical event shape ────────────────────────────────────────────────

function buildEvent(type, userId, payload, suppliedId) {
  const payloadHash = crypto.createHash('sha256')
    .update(JSON.stringify(payload)).digest('hex').slice(0, 8);
  const eventId = suppliedId || crypto.createHash('sha256')
    .update(`${type}:${userId || 'anon'}:${payloadHash}:${Date.now()}`)
    .digest('hex').slice(0, 32);
  return {
    eventId,
    type,
    userId:    userId || null,
    payload:   payload || {},
    ts:        Date.now(),
  };
}

// ── Append ────────────────────────────────────────────────────────────────────

async function appendEvent(type, userId, payload, suppliedEventId) {
  const ev = buildEvent(type, userId, payload, suppliedEventId);

  // Always write to memory buffer first (guaranteed)
  _memBuf.push(ev);
  if (_memBuf.length > MEM_MAX) _memBuf.shift();

  // Try Redis Streams
  const r = Redis.getClient();
  if (r) {
    try {
      const fields = [
        'eventId', ev.eventId,
        'type',    ev.type,
        'userId',  ev.userId || '',
        'ts',      String(ev.ts),
        'payload', JSON.stringify(ev.payload),
      ];
      await r.xadd(STREAM_KEY, 'MAXLEN', '~', STREAM_MAXLEN, '*', ...fields);
      // Per-user stream for O(1) user replay
      if (ev.userId) {
        await r.xadd(USER_KEY(ev.userId), 'MAXLEN', '~', 10_000, '*', ...fields);
      }
      return ev;
    } catch {} // fall through to file
  }

  // File fallback — append JSONL
  _appendToFile(ev);
  return ev;
}

function _appendToFile(ev) {
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(ev) + '\n', 'utf8');
    _fileLineCount++;
    if (_fileLineCount >= MAX_FILE_LINES) _rotateFile();
  } catch {}
}

function _rotateFile() {
  try {
    fs.renameSync(LOG_FILE, LOG_FILE + '.old');
    _fileLineCount = 0;
    console.log('[eventLog] rotated event-log.jsonl → .old');
  } catch {}
}

// ── Replay ────────────────────────────────────────────────────────────────────

// Returns array of canonical events from `fromTs` (ms epoch) onwards.
// count limits total returned entries (default 1000).
async function replayEvents(fromTs = 0, count = 1_000) {
  const r = Redis.getClient();
  if (r) {
    try {
      // Redis Streams: IDs are "{ms}-{seq}". fromTs-0 means "from this ms, seq 0".
      const minId  = `${fromTs}-0`;
      const raw    = await r.xrange(STREAM_KEY, minId, '+', 'COUNT', count);
      if (raw && raw.length) return raw.map(_parseStreamEntry);
    } catch {}
  }

  // File fallback
  return _readFileEvents(fromTs, count);
}

// Replay events for a specific user (per-user stream).
async function getUserEventStream(userId, fromTs = 0, count = 500) {
  if (!userId) return [];
  const r = Redis.getClient();
  if (r) {
    try {
      const raw = await r.xrange(USER_KEY(userId), `${fromTs}-0`, '+', 'COUNT', count);
      if (raw && raw.length) return raw.map(_parseStreamEntry);
    } catch {}
  }

  // Memory fallback — filter by userId
  return _memBuf.filter(e => e.userId === userId && e.ts >= fromTs).slice(-count);
}

function _parseStreamEntry([streamId, fields]) {
  const obj = {};
  for (let i = 0; i < fields.length; i += 2) obj[fields[i]] = fields[i + 1];
  return {
    _streamId: streamId,
    eventId:   obj.eventId || '',
    type:      obj.type    || '',
    userId:    obj.userId  || null,
    ts:        parseInt(obj.ts) || 0,
    payload:   _tryParse(obj.payload),
  };
}

function _tryParse(str) { try { return JSON.parse(str); } catch { return {}; } }

function _readFileEvents(fromTs, count) {
  try {
    const content = fs.readFileSync(LOG_FILE, 'utf8');
    return content.split('\n')
      .filter(Boolean)
      .map(l => _tryParse(l))
      .filter(e => e && e.ts >= fromTs)
      .slice(-count);
  } catch {
    return _memBuf.filter(e => e.ts >= fromTs).slice(-count);
  }
}

// ── Checkpoints (consumer group progress) ────────────────────────────────────

async function saveCheckpoint(group, streamId) {
  const r = Redis.getClient();
  if (r) { try { await r.hset(CKPT_KEY, group, streamId); return; } catch {} }
  // File checkpoint
  try {
    const cpFile = LOG_FILE + '.checkpoints';
    let cp = {};
    try { cp = _tryParse(fs.readFileSync(cpFile, 'utf8')); } catch {}
    cp[group] = streamId;
    fs.writeFileSync(cpFile, JSON.stringify(cp));
  } catch {}
}

async function loadCheckpoint(group) {
  const r = Redis.getClient();
  if (r) { try { return (await r.hget(CKPT_KEY, group)) || '0-0'; } catch {} }
  try {
    const cpFile = LOG_FILE + '.checkpoints';
    const cp = _tryParse(fs.readFileSync(cpFile, 'utf8'));
    return cp[group] || '0-0';
  } catch { return '0-0'; }
}

// ── Memory buffer access (testing / fallback) ─────────────────────────────────

function getMemoryBuffer() { return [..._memBuf]; }

module.exports = {
  appendEvent,
  replayEvents,
  getUserEventStream,
  saveCheckpoint,
  loadCheckpoint,
  buildEvent,
  getMemoryBuffer,
};
