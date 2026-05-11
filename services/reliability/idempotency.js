'use strict';
// Event idempotency — prevents double-processing of the same logical event.
// Keeps a TTL-aware ring buffer of processed event IDs.
// No external deps — survives Redis/BullMQ absence.

const MAX_SIZE = 10_000;  // ~0.5 MB upper bound
const TTL_MS   = 24 * 60 * 60 * 1000; // 24 h

const _store = new Map(); // eventId → expiresAt (ms)

function _prune() {
  if (_store.size < MAX_SIZE) return;
  const now = Date.now();
  for (const [k, v] of _store) {
    if (v < now) _store.delete(k);
    if (_store.size < MAX_SIZE * 0.8) break;
  }
}

function isProcessed(eventId) {
  if (!eventId) return false;
  const exp = _store.get(eventId);
  if (exp === undefined) return false;
  if (exp < Date.now()) { _store.delete(eventId); return false; }
  return true;
}

function markProcessed(eventId, ttlMs = TTL_MS) {
  if (!eventId) return;
  _prune();
  _store.set(eventId, Date.now() + ttlMs);
}

function size() { return _store.size; }

module.exports = { isProcessed, markProcessed, size };
