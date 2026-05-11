'use strict';
// Event Deduplication Store — exactly-once best-effort.
//
// Primary:  Redis SET NX (atomic, cluster-safe)
// Fallback: In-memory Map with TTL
//
// eventId ownership: callers generate deterministic IDs (hash of userId+type+payload).
// The store simply checks if an ID was already seen and records newly seen ones.

const Redis = require('../redis/cluster.client');

const REDIS_PREFIX = 'studyai:dedup:';
const TTL_SECONDS  = 86_400; // 24 h
const TTL_MS       = TTL_SECONDS * 1_000;
const MAX_MEM      = 50_000;

const _mem = new Map(); // eventId → expiresAt

function _pruneMemory() {
  if (_mem.size < MAX_MEM) return;
  const now = Date.now();
  for (const [k, v] of _mem) {
    if (v < now) _mem.delete(k);
    if (_mem.size < MAX_MEM * 0.8) break;
  }
}

// Returns true if eventId was NOT seen before (and marks it as seen).
// Returns false if eventId was already processed.
async function markIfNew(eventId) {
  if (!eventId) return true; // no ID → treat as new (can't dedup without ID)

  const r = Redis.getClient();
  if (r) {
    try {
      // SET NX EX is atomic even in cluster mode (key-based routing)
      const result = await r.set(`${REDIS_PREFIX}${eventId}`, '1', 'EX', TTL_SECONDS, 'NX');
      return result === 'OK'; // 'OK' → new; null → already exists
    } catch {} // fall through to memory
  }

  // Memory fallback
  _pruneMemory();
  const now = Date.now();
  const exp = _mem.get(eventId);
  if (exp !== undefined && exp > now) return false; // already seen
  _mem.set(eventId, now + TTL_MS);
  return true; // new
}

// Synchronous memory-only check (for hot path where async is inconvenient).
// Less reliable than markIfNew — no Redis. Use only as secondary guard.
function isSeenInMemory(eventId) {
  if (!eventId) return false;
  const exp = _mem.get(eventId);
  if (exp === undefined) return false;
  if (exp < Date.now()) { _mem.delete(eventId); return false; }
  return true;
}

// Force-mark without check (used by replay to skip re-publishing)
async function forceMarkSeen(eventId) {
  if (!eventId) return;
  const r = Redis.getClient();
  if (r) { try { await r.set(`${REDIS_PREFIX}${eventId}`, '1', 'EX', TTL_SECONDS); return; } catch {} }
  _pruneMemory();
  _mem.set(eventId, Date.now() + TTL_MS);
}

function memorySize() { return _mem.size; }

module.exports = { markIfNew, isSeenInMemory, forceMarkSeen, memorySize };
