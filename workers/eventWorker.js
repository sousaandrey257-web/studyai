'use strict';
// Standalone BullMQ worker: node workers/eventWorker.js
// Features: idempotent processing, DLQ on exhaustion, metrics, graceful shutdown.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

let Worker;
try { ({ Worker } = require('bullmq')); }
catch { console.error('[worker] bullmq not installed — run: npm i bullmq ioredis'); process.exit(1); }

const redis      = require('../services/redis/client');
const RedisLB    = require('../services/redis/leaderboard.redis');
const Idempotent = require('../services/reliability/idempotency');
const DLQ        = require('../services/queue/dlq');
const Metrics    = require('../services/observability/metrics');
const { QUEUE_NAME } = require('../services/queue/publisher');

// Wait up to 5 s for Redis to become available
function waitRedis(ms = 5_000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + ms;
    const poll = () => {
      if (redis.isAvailable()) return resolve();
      if (Date.now() > deadline) return reject(new Error('Redis not available after 5s'));
      setTimeout(poll, 200);
    };
    poll();
  });
}

// ── Job handler — idempotent ──────────────────────────────────────────────────

async function processJob(job) {
  const t0      = Date.now();
  const eventId = job.data?._eventId || job.id;

  // Idempotency: skip if already processed (handles BullMQ retries + duplicate enqueue)
  if (Idempotent.isProcessed(eventId)) {
    console.log(`[worker] duplicate skipped: ${job.name} id=${eventId}`);
    return;
  }

  try {
    await _dispatch(job.name, job.data);
    Idempotent.markProcessed(eventId);
    Metrics.recordProcessed();
    Metrics.recordEventLatency(job.name, Date.now() - t0);
  } catch (err) {
    Metrics.recordEventLatency(job.name, Date.now() - t0, true);
    throw err; // let BullMQ retry
  }
}

async function _dispatch(name, data) {
  switch (name) {
    case 'XP_GAINED':
      if (data.userId && data.weekKey && data.weeklyXP != null) {
        await RedisLB.setXP(
          data.weekKey, data.userId,
          data.email || 'Anonyme',
          data.weeklyXP, data.level || 1, data.streak || 0,
        );
      }
      break;

    case 'QUIZ_COMPLETED':
      console.log(`[worker] QUIZ_COMPLETED user=${data.userId} score=${data.score}/${data.total} streak=${data.streak}`);
      break;

    case 'USER_REGISTERED':
      console.log(`[worker] USER_REGISTERED user=${data.userId} email=${(data.email || '').slice(0, 2)}…`);
      break;

    case 'REFERRAL_COMPLETED':
      console.log(`[worker] REFERRAL ${data.referrerEmail} → ${data.newUserEmail} +${data.xpBonus} XP chain=${data.chainLevels || 1}`);
      break;

    case 'STREAK_UPDATED':
      if ([7, 14, 30, 60, 100].includes(data.streak)) {
        console.log(`[worker] STREAK_MILESTONE user=${data.userId} streak=${data.streak}`);
      }
      break;

    default:
      // Unknown event types are silently acknowledged (forward-compatible)
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

(async () => {
  try {
    await waitRedis();
    console.log('[worker] Redis ready — starting BullMQ worker');
  } catch (err) {
    console.error('[worker]', err.message);
    process.exit(1);
  }

  const worker = new Worker(QUEUE_NAME, processJob, {
    connection:  redis.getClient(),
    concurrency: 5,
  });

  // Route exhausted jobs to DLQ
  worker.on('failed', async (job, err) => {
    const maxReached = (job?.attemptsMade || 0) >= (job?.opts?.attempts || 1);
    if (maxReached) {
      await DLQ.push(job.name, job.data, err, job.id);
      Metrics.recordDLQ();
    } else {
      console.warn(`[worker] job ${job?.name} failed (attempt ${job?.attemptsMade}/${job?.opts?.attempts}):`, err.message);
    }
  });

  worker.on('error', (err) => {
    console.error('[worker] connection error:', err.message);
  });

  console.log(`[worker] listening on queue "${QUEUE_NAME}" (concurrency=5)`);

  const shutdown = async () => { await worker.close(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);
})();
