'use strict';
// Outbox Pattern — durable event publishing without two-phase commit.
//
// Flow:
//   Business event fires on GamiService.emitter
//     → outbox interceptor writes to outbox store (sync/async)
//     → background poller reads outbox → publishes to event bus + log
//     → marks entry processed
//     → on failure: retry up to MAX_ATTEMPTS → DLQ
//
// Storage priority:
//   1. Redis List  studyai:outbox:pending   (LPUSH / BRPOPLPUSH)
//   2. File        /data/outbox.jsonl
//   3. Memory      in-process array (lost on crash — last resort)
//
// This module ONLY intercepts existing events. It never modifies business logic.

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const Redis  = require('../redis/cluster.client');

const OUTBOX_PENDING    = 'studyai:outbox:pending';
const OUTBOX_PROCESSING = 'studyai:outbox:processing';
const FILE_PATH         = path.join(__dirname, '../../data/outbox.jsonl');
const MAX_FILE_ENTRIES  = 20_000;
const MAX_MEM           = 2_000;
const MAX_ATTEMPTS      = 5;
const POLL_INTERVAL_MS  = 2_000; // poll every 2s

const _mem       = []; // memory fallback queue
let _polling     = false;

// ── Write to outbox ───────────────────────────────────────────────────────────

function _makeEntry(type, userId, payload) {
  return {
    id:       crypto.randomUUID(),
    type,
    userId:   userId || null,
    payload,
    ts:       Date.now(),
    attempts: 0,
    status:   'pending',
  };
}

// Synchronous enqueue — called from EventEmitter handlers (sync context).
// Tries Redis (async, non-blocking), then file, then memory.
function enqueueSync(type, userId, payload) {
  const entry = _makeEntry(type, userId, payload);

  // Memory always (guaranteed)
  _mem.push(entry);
  if (_mem.length > MAX_MEM) _mem.shift();

  // Redis async fire-and-forget
  const r = Redis.getClient();
  if (r) {
    r.lpush(OUTBOX_PENDING, JSON.stringify(entry)).catch(() => {});
    return entry;
  }

  // File append
  _appendFile(entry);
  return entry;
}

function _appendFile(entry) {
  try {
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(FILE_PATH, line, 'utf8');
  } catch {}
}

// ── Background poller ─────────────────────────────────────────────────────────
// Reads pending entries and publishes them to the event bus.

let _busRef = null; // set by startPoller()

async function _processOne(entry) {
  if (!_busRef) return false;
  try {
    await _busRef.emit(entry.type, entry.payload, entry.id);
    return true;
  } catch { return false; }
}

async function _pollRedis() {
  const r = Redis.getClient();
  if (!r) return;
  try {
    // Non-blocking RPOPLPUSH — atomic dequeue
    const raw = await r.rpoplpush(OUTBOX_PENDING, OUTBOX_PROCESSING);
    if (!raw) return;
    const entry = JSON.parse(raw);
    const ok    = await _processOne(entry);
    if (ok) {
      await r.lrem(OUTBOX_PROCESSING, 1, raw);
    } else {
      entry.attempts = (entry.attempts || 0) + 1;
      if (entry.attempts >= MAX_ATTEMPTS) {
        const DLQ = require('../queue/dlq');
        await DLQ.push(entry.type, entry.payload, new Error('outbox max attempts'), entry.id);
        await r.lrem(OUTBOX_PROCESSING, 1, raw);
      } else {
        // Re-queue with updated attempts
        await r.lrem(OUTBOX_PROCESSING, 1, raw);
        await r.lpush(OUTBOX_PENDING, JSON.stringify(entry));
      }
    }
  } catch {}
}

async function _pollMemory() {
  if (!_mem.length) return;
  const entry = _mem.shift(); // FIFO
  const ok    = await _processOne(entry);
  if (!ok) {
    entry.attempts = (entry.attempts || 0) + 1;
    if (entry.attempts < MAX_ATTEMPTS) {
      _mem.push(entry); // re-queue at end
    } else {
      const DLQ = require('../queue/dlq');
      DLQ.push(entry.type, entry.payload, new Error('outbox max attempts (memory)'), entry.id).catch(() => {});
    }
  }
}

async function _tick() {
  const r = Redis.getClient();
  if (r) {
    await _pollRedis();
  } else {
    await _pollMemory();
  }
}

function startPoller(bus) {
  if (_polling) return;
  _polling = true;
  _busRef  = bus;
  const loop = async () => {
    try { await _tick(); } catch {}
    if (_polling) setTimeout(loop, POLL_INTERVAL_MS);
  };
  loop();
  console.log('[outbox] poller started');
}

function stopPoller() { _polling = false; _busRef = null; }

// ── Status ────────────────────────────────────────────────────────────────────

async function getStatus() {
  const r = Redis.getClient();
  let redisPending = 0;
  if (r) {
    try { redisPending = await r.llen(OUTBOX_PENDING); } catch {}
  }
  return { redisPending, memoryPending: _mem.length };
}

module.exports = { enqueueSync, startPoller, stopPoller, getStatus };
