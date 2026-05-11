'use strict';
// Proof-of-Work challenge system — invisible friction for bots.
// Client must find nonce where SHA-256(prefix + nonce).startsWith('0'.repeat(difficulty)).
// Cost: ~50–200 ms CPU at difficulty 3.

const crypto = require('crypto');

const DEFAULT_DIFFICULTY = 3;       // 3 leading hex zeros → 1-in-4096 chance per try
const CHALLENGE_TTL_MS   = 5 * 60 * 1000; // 5 min to solve
const MAX_CHALLENGES     = 20_000;

const _store = new Map(); // challengeId → { prefix, difficulty, expiresAt }

function _prune() {
  if (_store.size < MAX_CHALLENGES) return;
  const now = Date.now();
  for (const [k, v] of _store) {
    if (v.expiresAt < now) _store.delete(k);
    if (_store.size < MAX_CHALLENGES * 0.8) break;
  }
}

// Issue a new challenge — returns { challengeId, prefix, difficulty, expiresAt }
function issue(difficulty = DEFAULT_DIFFICULTY) {
  _prune();
  const challengeId = crypto.randomBytes(16).toString('hex');
  const prefix      = crypto.randomBytes(8).toString('hex');
  const expiresAt   = Date.now() + CHALLENGE_TTL_MS;
  _store.set(challengeId, { prefix, difficulty, expiresAt });
  return { challengeId, prefix, difficulty, expiresAt };
}

// Verify a solution — returns { ok, reason }
function verify(challengeId, nonce) {
  if (!challengeId || nonce == null) return { ok: false, reason: 'missing_fields' };

  const ch = _store.get(challengeId);
  if (!ch)                      return { ok: false, reason: 'unknown_challenge' };
  if (Date.now() > ch.expiresAt) {
    _store.delete(challengeId);
    return { ok: false, reason: 'expired' };
  }

  const nonceStr = String(nonce);
  if (nonceStr.length > 32)     return { ok: false, reason: 'nonce_too_long' };

  const hash   = crypto.createHash('sha256').update(ch.prefix + nonceStr).digest('hex');
  const target = '0'.repeat(ch.difficulty);
  if (!hash.startsWith(target)) return { ok: false, reason: 'invalid_solution' };

  _store.delete(challengeId); // one-use
  return { ok: true };
}

// Soft middleware — reads x-pow-solution: "challengeId:nonce"
// Sets req._powValid / req._powMissing — never hard blocks (caller decides action)
function powMiddleware(req, res, next) {
  const header = req.headers['x-pow-solution'] || '';
  if (!header) { req._powMissing = true; return next(); }

  const colon = header.indexOf(':');
  if (colon < 0) { req._powMissing = false; req._powValid = false; req._powReason = 'bad_format'; return next(); }

  const challengeId = header.slice(0, colon);
  const nonce       = header.slice(colon + 1);
  const result      = verify(challengeId, nonce);

  req._powMissing = false;
  req._powValid   = result.ok;
  req._powReason  = result.reason;
  next();
}

module.exports = { issue, verify, powMiddleware, DEFAULT_DIFFICULTY };
