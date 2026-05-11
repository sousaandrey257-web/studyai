'use strict';
// Full system health check — Redis, BullMQ, circuit breakers, WAL, process.

const CB      = require('../reliability/circuitBreaker');
const Idempo  = require('../reliability/idempotency');
const Metrics = require('./metrics');
const HARedis = require('../redis/ha.client');
const DLQ     = require('../queue/dlq');

async function runFullCheck() {
  const mem = process.memoryUsage();

  // Redis ping
  let redisPing = false;
  try {
    const baseRedis = require('../redis/client');
    const r = baseRedis.getClient();
    if (r) { await r.ping(); redisPing = true; }
  } catch {}

  // BullMQ availability
  let bullmqOk = false;
  try { bullmqOk = require('../queue/queues').isAvailable(); } catch {}

  const circuits      = CB.getAllStates();
  const degraded      = circuits.some(b => b.state !== 'CLOSED');
  const walSize       = HARedis.getWALSize();
  const dlqSize       = DLQ.list().length;
  const idempSize     = Idempo.size();
  const metrics       = Metrics.getMetrics();

  let overallStatus = 'ok';
  if (!redisPing || degraded) overallStatus = 'degraded';

  return {
    status:    overallStatus,
    ts:        new Date().toISOString(),
    components: {
      redis:  { ok: redisPing, walBuffered: walSize, circuit: HARedis.getCircuitState() },
      bullmq: { ok: bullmqOk, dlqSize },
    },
    circuits,
    reliability: { idempotencyStoreSize: idempSize },
    process: {
      uptimeSec:  Math.round(process.uptime()),
      rss:        `${Math.round(mem.rss        / 1024 / 1024)}MB`,
      heapUsed:   `${Math.round(mem.heapUsed   / 1024 / 1024)}MB`,
      heapTotal:  `${Math.round(mem.heapTotal  / 1024 / 1024)}MB`,
      nodeVersion: process.version,
    },
    metrics,
  };
}

module.exports = { runFullCheck };
