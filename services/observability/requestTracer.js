'use strict';
// ============================================================
//  Request Tracer — per-request IDs + latency percentiles
//  - Assigns X-Request-ID to every request
//  - Tracks p50/p95/p99 latency per endpoint group
//  - Detects memory/CPU spikes via periodic snapshots
//  - Zero I/O — pure in-memory, never blocks requests
// ============================================================

const crypto = require('crypto');
const os     = require('os');

// ── Latency store ─────────────────────────────────────────────
// Group endpoints: /api/generate, /api/quiz-result, /api/admin/*, /api/auth, other
const MAX_SAMPLES = 500; // per group, FIFO

const _latency = {
  generate:   [],
  quiz:       [],
  admin:      [],
  auth:       [],
  other:      [],
};

function _group(path) {
  if (path.startsWith('/api/generate'))     return 'generate';
  if (path.startsWith('/api/quiz-result'))  return 'quiz';
  if (path.startsWith('/api/admin'))        return 'admin';
  if (path.startsWith('/api/login') || path.startsWith('/api/register')) return 'auth';
  return 'other';
}

function _push(group, ms) {
  const arr = _latency[group];
  arr.push(ms);
  if (arr.length > MAX_SAMPLES) arr.shift();
}

function _percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

function _stats(arr) {
  if (!arr.length) return { p50: 0, p95: 0, p99: 0, avg: 0, max: 0, samples: 0 };
  return {
    p50:     _percentile(arr, 50),
    p95:     _percentile(arr, 95),
    p99:     _percentile(arr, 99),
    avg:     Math.round(arr.reduce((s, v) => s + v, 0) / arr.length),
    max:     Math.max(...arr),
    samples: arr.length,
  };
}

// ── Memory snapshots ──────────────────────────────────────────
const _memSnapshots = []; // {ts, heapUsedMB, rss MB}

function _takeSnapshot() {
  const m = process.memoryUsage();
  _memSnapshots.push({
    ts:          new Date().toISOString(),
    heapUsedMB:  Math.round(m.heapUsed / 1024 / 1024),
    heapTotalMB: Math.round(m.heapTotal / 1024 / 1024),
    rssMB:       Math.round(m.rss / 1024 / 1024),
    externalMB:  Math.round(m.external / 1024 / 1024),
  });
  if (_memSnapshots.length > 60) _memSnapshots.shift(); // keep 60 snapshots (1h at 1min interval)
}

setInterval(_takeSnapshot, 60_000); // every minute
_takeSnapshot(); // initial snapshot

// ── Request counters ──────────────────────────────────────────
let _totalRequests  = 0;
let _totalErrors    = 0;
let _startedAt      = Date.now();

// ── Middleware ────────────────────────────────────────────────
function tracerMiddleware(req, res, next) {
  // Assign unique request ID
  const reqId = crypto.randomUUID();
  req._reqId  = reqId;
  res.setHeader('X-Request-ID', reqId);

  _totalRequests++;
  const start = Date.now();

  // Hook into response finish to record latency
  res.on('finish', () => {
    const ms    = Date.now() - start;
    const grp   = _group(req.path);
    _push(grp, ms);
    if (res.statusCode >= 500) _totalErrors++;
  });

  next();
}

// ── Snapshot ──────────────────────────────────────────────────
function getMetrics() {
  const mem = process.memoryUsage();
  const load = os.loadavg();

  const latencyStats = {};
  for (const [group, arr] of Object.entries(_latency)) {
    latencyStats[group] = _stats(arr);
  }

  const recentMem = _memSnapshots.slice(-5);
  const heapTrend = recentMem.length >= 2
    ? recentMem[recentMem.length - 1].heapUsedMB - recentMem[0].heapUsedMB
    : 0;

  return {
    uptime:        Math.round((Date.now() - _startedAt) / 1000),
    totalRequests: _totalRequests,
    totalErrors:   _totalErrors,
    errorRate:     _totalRequests ? `${((_totalErrors / _totalRequests) * 100).toFixed(1)}%` : '0%',
    latency:       latencyStats,
    memory: {
      heapUsedMB:  Math.round(mem.heapUsed   / 1024 / 1024),
      heapTotalMB: Math.round(mem.heapTotal  / 1024 / 1024),
      rssMB:       Math.round(mem.rss        / 1024 / 1024),
      heapTrendMB: heapTrend, // positive = growing (potential leak)
      snapshots:   recentMem,
    },
    system: {
      load1m:   load[0].toFixed(2),
      load5m:   load[1].toFixed(2),
      load15m:  load[2].toFixed(2),
      cpuCount: os.cpus().length,
      freeMemMB: Math.round(os.freemem() / 1024 / 1024),
      totalMemMB:Math.round(os.totalmem() / 1024 / 1024),
    },
  };
}

module.exports = { tracerMiddleware, getMetrics };
