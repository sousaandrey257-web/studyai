'use strict';
// BullMQ queue registry — graceful fallback when bullmq / ioredis not installed.

const redis = require('../redis/client');

let Queue;
try { ({ Queue } = require('bullmq')); } catch { Queue = null; }

const _queues = new Map();

const DEFAULT_JOB_OPTIONS = {
  removeOnComplete: { count: 500 },  // keep last 500 completed
  removeOnFail:     false,            // keep failed — worker routes them to DLQ
};

function getQueue(name) {
  if (!Queue || !redis.isAvailable()) return null;
  if (_queues.has(name)) return _queues.get(name);
  try {
    const q = new Queue(name, {
      connection:         redis.getClient(),
      defaultJobOptions:  DEFAULT_JOB_OPTIONS,
    });
    _queues.set(name, q);
    return q;
  } catch { return null; }
}

function isAvailable() { return Queue !== null && redis.isAvailable(); }

module.exports = { getQueue, isAvailable };
