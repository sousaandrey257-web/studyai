'use strict';
// Fire-and-forget event publisher — production-grade reliability.
// Primary:  BullMQ with per-event retry config + DLQ on exhaustion.
// Fallback: synchronous EventEmitter emit (single-node mode).

const crypto      = require('crypto');
const Queues      = require('./queues');
const GamiService = require('../gamification.service');
const Metrics     = require('../observability/metrics');

const QUEUE_NAME = 'studyai-events';

// Per-event retry policy: { attempts, backoff }
// Exponential: delay × 2^(attempt-1) → 1s, 2s, 4s, 8s, 16s
const RETRY_POLICY = {
  XP_GAINED:          { attempts: 5, backoff: { type: 'exponential', delay: 1_000 } },
  REFERRAL_COMPLETED: { attempts: 5, backoff: { type: 'exponential', delay: 1_000 } },
  QUIZ_COMPLETED:     { attempts: 3, backoff: { type: 'exponential', delay: 2_000 } },
  USER_REGISTERED:    { attempts: 3, backoff: { type: 'fixed',       delay: 2_000 } },
  STREAK_UPDATED:     { attempts: 2, backoff: { type: 'fixed',       delay: 1_000 } },
  default:            { attempts: 3, backoff: { type: 'exponential', delay: 1_000 } },
};

// Stable eventId: caller can supply one for idempotent dedup across retries.
// If not supplied, generate a random UUID (idempotency within BullMQ job ID).
async function enqueue(event, data, eventId) {
  const _eventId = eventId || crypto.randomUUID();
  const payload  = { ...data, _eventId };
  const retry    = RETRY_POLICY[event] || RETRY_POLICY.default;

  const q = Queues.getQueue(QUEUE_NAME);
  if (q) {
    try {
      await q.add(event, payload, {
        jobId:      _eventId, // BullMQ deduplicates jobs with same jobId
        attempts:   retry.attempts,
        backoff:    retry.backoff,
        removeOnComplete: { count: 500 },
        removeOnFail:     false, // keep failed jobs for DLQ inspection
      });
      Metrics.recordEnqueue(true);
      return true;
    } catch (err) {
      Metrics.recordEnqueue(false);
      console.warn(`[queue] enqueue failed (${event}), falling back to emit:`, err.message);
    }
  }

  // Synchronous fallback — preserves pre-BullMQ behaviour
  GamiService.emitter.emit(event, payload);
  Metrics.recordEnqueue(false); // not a failure, but not queued either
  return false;
}

module.exports = { enqueue, QUEUE_NAME };
