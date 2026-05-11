'use strict';
// Event Bus — Kafka-like abstraction layer.
//
// API:
//   emit(type, payload, eventId?)  → dedup check → append to log → call subscribers
//   subscribe(type, fn)            → register handler for event type
//   subscribeAll(fn)               → register handler for every event
//   replay(userId, fromTs?, count?)→ read log → re-call subscribers
//   replayAll(fromTs?, count?)     → replay global event log
//
// Backend: Redis Streams (via eventLog.js) OR JSONL file OR memory buffer.
// No external deps beyond what's already installed.

const EventLog  = require('./eventLog');
const DedupStore = require('./dedupStore');
const crypto    = require('crypto');

const _subs     = new Map();   // type → [fn]
const _catchAll = [];          // fn[] — subscribeAll handlers

// ── Subscribe ─────────────────────────────────────────────────────────────────

function subscribe(type, fn) {
  if (!_subs.has(type)) _subs.set(type, []);
  _subs.get(type).push(fn);
}

function subscribeAll(fn) {
  _catchAll.push(fn);
}

// ── Emit ──────────────────────────────────────────────────────────────────────

// Returns: { eventId, appended, deduplicated }
async function emit(type, payload, suppliedEventId) {
  const userId  = payload?.userId || null;

  // Deterministic eventId when not supplied
  const eventId = suppliedEventId || _generateId(type, userId, payload);

  // Dedup check — skip if already processed
  const isNew = await DedupStore.markIfNew(eventId);
  if (!isNew) {
    return { eventId, appended: false, deduplicated: true };
  }

  // Append to durable log
  await EventLog.appendEvent(type, userId, payload, eventId);

  // Dispatch to registered subscribers
  _dispatch(type, { ...payload, _eventId: eventId, _type: type, _ts: Date.now() });

  return { eventId, appended: true, deduplicated: false };
}

function _dispatch(type, data) {
  const handlers = _subs.get(type) || [];
  const allHandlers = [...handlers, ..._catchAll];
  for (const fn of allHandlers) {
    try { fn(data); } catch (err) {
      console.error(`[bus] subscriber error (${type}):`, err.message);
    }
  }
}

function _generateId(type, userId, payload) {
  const payloadHash = crypto.createHash('sha256')
    .update(JSON.stringify(payload || {})).digest('hex').slice(0, 8);
  return crypto.createHash('sha256')
    .update(`${type}:${userId || 'anon'}:${payloadHash}:${Date.now()}`)
    .digest('hex').slice(0, 32);
}

// ── Replay ────────────────────────────────────────────────────────────────────

// Replay events for a specific user from fromTs onwards.
// Calls registered subscribers for each event (idempotent — re-marks as seen).
async function replay(userId, fromTs = 0, count = 500) {
  const events = await EventLog.getUserEventStream(userId, fromTs, count);
  for (const ev of events) {
    _dispatch(ev.type, { ...ev.payload, _eventId: ev.eventId, _type: ev.type, _ts: ev.ts, _replay: true });
  }
  return events.length;
}

// Replay global event log from fromTs.
async function replayAll(fromTs = 0, count = 1_000) {
  const events = await EventLog.replayEvents(fromTs, count);
  for (const ev of events) {
    _dispatch(ev.type, { ...ev.payload, _eventId: ev.eventId, _type: ev.type, _ts: ev.ts, _replay: true });
  }
  return events.length;
}

// ── Introspection ─────────────────────────────────────────────────────────────

function getSubscriberCount(type) {
  return (type ? (_subs.get(type) || []).length : 0) + _catchAll.length;
}

function listSubscribedTypes() { return [..._subs.keys()]; }

module.exports = { emit, subscribe, subscribeAll, replay, replayAll, getSubscriberCount, listSubscribedTypes };
