'use strict';
// Dead Letter Queue — stores events that exhausted all retry attempts.
// Primary: BullMQ 'events:dead' queue.
// Fallback: in-memory ring buffer (1 000 entries, survives process restart via console log).

const crypto = require('crypto');

const DLQ_NAME   = 'events:dead';
const MAX_MEMORY = 1_000;

const _buffer = []; // fallback ring buffer

function _entry(event, data, error, jobId) {
  return {
    id:       jobId || crypto.randomUUID(),
    event,
    data,
    error:    error?.message || String(error),
    stack:    error?.stack?.split('\n').slice(0, 5).join('\n') || '',
    failedAt: new Date().toISOString(),
    retried:  false,
  };
}

async function push(event, data, error, jobId) {
  const entry = _entry(event, data, error, jobId);
  console.error(`[dlq] DEAD event="${event}" id=${entry.id} err="${entry.error}"`);

  // Try BullMQ DLQ queue (lazy require to avoid circular deps)
  try {
    const Queues = require('./queues');
    const q      = Queues.getQueue(DLQ_NAME);
    if (q) {
      await q.add(event, { ...data, _dlq: { error: entry.error, failedAt: entry.failedAt } },
        { removeOnComplete: false, removeOnFail: false, attempts: 1 });
      return entry;
    }
  } catch {}

  _buffer.push(entry);
  if (_buffer.length > MAX_MEMORY) _buffer.shift();
  return entry;
}

function list()       { return [..._buffer]; }
function remove(id)   { const i = _buffer.findIndex(e => e.id === id); if (i >= 0) { _buffer.splice(i, 1); return true; } return false; }
function markRetried(id) { const e = _buffer.find(e => e.id === id); if (e) e.retried = true; }

module.exports = { push, list, remove, markRetried, DLQ_NAME };
