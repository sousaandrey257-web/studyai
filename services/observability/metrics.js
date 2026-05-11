'use strict';
// In-process observability metrics store.
// Tracks: event latency, Redis failure rate, BullMQ throughput, bot score distribution.
// Zero I/O — never blocks anything.

const _state = {
  startedAt: Date.now(),
  events:  {},   // name → { count, totalMs, maxMs, errors }
  redis:   { calls: 0, failures: 0, lastFailureAt: null },
  bullmq:  { enqueued: 0, enqueueFailed: 0, processed: 0, dlq: 0 },
  bot:     { total: 0, samples: [] }, // rolling 200-sample window
};

// ── Event latency ─────────────────────────────────────────────────────────────

function recordEventLatency(name, ms, isError = false) {
  if (!_state.events[name]) _state.events[name] = { count: 0, totalMs: 0, maxMs: 0, errors: 0 };
  const e = _state.events[name];
  e.count++;
  e.totalMs += ms;
  if (ms > e.maxMs) e.maxMs = ms;
  if (isError) e.errors++;
}

// ── Redis ─────────────────────────────────────────────────────────────────────

function recordRedisCall(success) {
  _state.redis.calls++;
  if (!success) { _state.redis.failures++; _state.redis.lastFailureAt = new Date().toISOString(); }
}

// ── BullMQ ────────────────────────────────────────────────────────────────────

function recordEnqueue(success) { if (success) _state.bullmq.enqueued++; else _state.bullmq.enqueueFailed++; }
function recordProcessed()      { _state.bullmq.processed++; }
function recordDLQ()            { _state.bullmq.dlq++; }

// ── Bot scores ────────────────────────────────────────────────────────────────

function recordBotScore(score) {
  _state.bot.total++;
  _state.bot.samples.push(score);
  if (_state.bot.samples.length > 200) _state.bot.samples.shift();
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

function getMetrics() {
  const eventStats = {};
  for (const [name, e] of Object.entries(_state.events)) {
    eventStats[name] = {
      count:    e.count,
      avgMs:    e.count ? Math.round(e.totalMs / e.count) : 0,
      maxMs:    e.maxMs,
      errors:   e.errors,
      errorPct: e.count ? Math.round(e.errors / e.count * 100) : 0,
    };
  }

  const { samples } = _state.bot;
  const botAvg  = samples.length ? Math.round(samples.reduce((s, v) => s + v, 0) / samples.length) : 0;
  const highRisk = samples.filter(s => s >= 60).length;
  const blocked  = samples.filter(s => s >= 95).length;

  const redisFailRate = _state.redis.calls
    ? `${Math.round(_state.redis.failures / _state.redis.calls * 100)}%` : '0%';

  return {
    uptimeSec:   Math.round((Date.now() - _state.startedAt) / 1000),
    events:      eventStats,
    redis:       { ..._state.redis, failureRate: redisFailRate },
    bullmq:      { ..._state.bullmq },
    bot: {
      totalSeen:    _state.bot.total,
      recentSamples: samples.length,
      avgScore:     botAvg,
      highRisk,
      blocked,
      distribution: {
        normal:    samples.filter(s => s <  40).length,
        shadow:    samples.filter(s => s >= 40 && s < 70).length,
        degraded:  samples.filter(s => s >= 70 && s < 90).length,
        hardBlock: blocked,
      },
    },
  };
}

module.exports = { recordEventLatency, recordRedisCall, recordEnqueue, recordProcessed, recordDLQ, recordBotScore, getMetrics };
