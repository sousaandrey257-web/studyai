'use strict';
// Redis HA client — adds WAL buffer + circuit breaker on top of the base client.
// Writes that fail during outage are buffered and flushed on reconnect.

const baseRedis = require('./client');
const CB        = require('../reliability/circuitBreaker');
const Metrics   = require('../observability/metrics');

const CIRCUIT    = 'redis';
const MAX_WAL    = 500;
const FLUSH_MS   = 60_000; // try to flush WAL every 60 s

// WAL = write-ahead-log buffer for leaderboard XP updates
const _wal = []; // [{ weekStr, userId, label, weeklyXP, level, streak, ts }]

function isAvailable() {
  return baseRedis.isAvailable() && !CB.isOpen(CIRCUIT);
}

// ── Guarded leaderboard operations ───────────────────────────────────────────

async function safeSetXP(weekStr, userId, label, weeklyXP, level, streak) {
  if (!isAvailable()) {
    _bufferWAL({ weekStr, userId, label, weeklyXP, level, streak });
    return;
  }
  const LB = require('./leaderboard.redis');
  return CB.execute(
    CIRCUIT,
    async () => {
      await LB.setXP(weekStr, userId, label, weeklyXP, level, streak);
      Metrics.recordRedisCall(true);
    },
    () => _bufferWAL({ weekStr, userId, label, weeklyXP, level, streak }),
  );
}

async function safeGetTopN(weekStr, n = 10) {
  if (!isAvailable()) return null;
  const LB = require('./leaderboard.redis');
  return CB.execute(
    CIRCUIT,
    async () => {
      const r = await LB.getTopN(weekStr, n);
      Metrics.recordRedisCall(true);
      return r;
    },
    () => { Metrics.recordRedisCall(false); return null; },
  );
}

async function safeGetUserRank(weekStr, userId) {
  if (!isAvailable()) return null;
  const LB = require('./leaderboard.redis');
  return CB.execute(
    CIRCUIT,
    async () => { Metrics.recordRedisCall(true); return LB.getUserRank(weekStr, userId); },
    () => { Metrics.recordRedisCall(false); return null; },
  );
}

// ── WAL buffer ────────────────────────────────────────────────────────────────

function _bufferWAL(entry) {
  Metrics.recordRedisCall(false);
  _wal.push({ ...entry, ts: Date.now() });
  if (_wal.length > MAX_WAL) _wal.shift();
}

async function _flushWAL() {
  if (!_wal.length || !baseRedis.isAvailable()) return;
  const LB     = require('./leaderboard.redis');
  const batch  = _wal.splice(0, Math.min(50, _wal.length));
  let flushed  = 0;
  for (const e of batch) {
    try {
      await LB.setXP(e.weekStr, e.userId, e.label, e.weeklyXP, e.level, e.streak);
      flushed++;
    } catch {
      _wal.unshift(e); // push back to front; stop flushing this cycle
      break;
    }
  }
  if (flushed) console.log(`[redis:ha] WAL flushed ${flushed} entries (${_wal.length} remaining)`);
}

setInterval(_flushWAL, FLUSH_MS);

function getWALSize() { return _wal.length; }

// ── Circuit-breaker state for health checks ───────────────────────────────────

function getCircuitState() { return CB.getState(CIRCUIT); }

module.exports = { isAvailable, safeSetXP, safeGetTopN, safeGetUserRank, getWALSize, getCircuitState };
