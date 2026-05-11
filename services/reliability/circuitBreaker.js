'use strict';
// Circuit breaker — CLOSED → OPEN → HALF_OPEN → CLOSED.
// Prevents cascade failures when Redis / BullMQ degrade.

const FAILURE_THRESHOLD  = 5;            // failures within window → OPEN
const WINDOW_MS          = 10_000;       // failure counting window (10 s)
const RECOVERY_MS        = 30_000;       // wait before HALF_OPEN (30 s)
const HALF_OPEN_SUCCESS  = 2;            // consecutive successes to CLOSE

const _breakers = new Map();

function _get(name) {
  if (!_breakers.has(name)) {
    _breakers.set(name, {
      name, state: 'CLOSED',
      failures: 0, windowStart: Date.now(),
      successes: 0, openedAt: null,
    });
  }
  return _breakers.get(name);
}

function isOpen(name) {
  const b = _get(name);
  if (b.state === 'CLOSED') return false;
  if (b.state === 'OPEN') {
    if (Date.now() - b.openedAt > RECOVERY_MS) {
      b.state = 'HALF_OPEN'; b.successes = 0;
      return false; // allow one probe through
    }
    return true;
  }
  return false; // HALF_OPEN: let through
}

function recordSuccess(name) {
  const b = _get(name);
  if (b.state === 'HALF_OPEN') {
    b.successes++;
    if (b.successes >= HALF_OPEN_SUCCESS) {
      b.state = 'CLOSED'; b.failures = 0;
      console.log(`[circuit:${name}] CLOSED — recovered`);
    }
  } else {
    b.failures = 0;
  }
}

function recordFailure(name) {
  const b   = _get(name);
  const now = Date.now();
  if (now - b.windowStart > WINDOW_MS) { b.failures = 0; b.windowStart = now; }
  b.failures++;

  if (b.state === 'HALF_OPEN') {
    b.state = 'OPEN'; b.openedAt = now;
    console.warn(`[circuit:${name}] re-OPEN after half-open failure`);
    return;
  }
  if (b.state === 'CLOSED' && b.failures >= FAILURE_THRESHOLD) {
    b.state = 'OPEN'; b.openedAt = now;
    console.warn(`[circuit:${name}] OPEN (${b.failures} failures / ${WINDOW_MS}ms)`);
  }
}

// Wrap an async fn with circuit breaker. Falls back to `fallback` when open.
async function execute(name, fn, fallback = null) {
  if (isOpen(name)) {
    return typeof fallback === 'function' ? fallback() : fallback;
  }
  try {
    const result = await fn();
    recordSuccess(name);
    return result;
  } catch (err) {
    recordFailure(name);
    if (typeof fallback === 'function') return fallback();
    throw err;
  }
}

function getState(name)  { const b = _get(name); return { name: b.name, state: b.state, failures: b.failures }; }
function getAllStates()   { return [..._breakers.values()].map(b => ({ name: b.name, state: b.state, failures: b.failures })); }

module.exports = { isOpen, recordSuccess, recordFailure, execute, getState, getAllStates };
