'use strict';
// ============================================================
//  Token Blacklist — revoke JWT sessions immediately.
//  Key = email:iat (no jti needed — works with existing tokens).
//  Persistent: data/revoked_tokens.json (survives restarts).
// ============================================================

const fs   = require('fs');
const path = require('path');

const STORE_FILE = path.join(__dirname, '..', 'data', 'revoked_tokens.json');
const MAX_ENTRIES = 10_000;

// _store: key → expiryMs (when the original token would expire)
const _store = new Map();
let _loaded  = false;

function _key(email, iat) {
  return `${String(email).toLowerCase()}:${iat}`;
}

function _load() {
  if (_loaded) return;
  _loaded = true;
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    const now = Date.now();
    for (const [k, exp] of Object.entries(raw)) {
      if (exp > now) _store.set(k, exp); // skip already-expired entries
    }
    if (_store.size) console.log(`[blacklist] ${_store.size} revoked token(s) loaded`);
  } catch { /* file may not exist yet */ }
}

function _persist() {
  try {
    const out = {};
    const now = Date.now();
    for (const [k, exp] of _store.entries()) {
      if (exp > now) out[k] = exp;
    }
    const tmp = STORE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(out), 'utf8');
    fs.renameSync(tmp, STORE_FILE);
  } catch { /* non-blocking */ }
}

function _pruneExpired() {
  const now = Date.now();
  for (const [k, exp] of _store.entries()) {
    if (exp <= now) _store.delete(k);
  }
}

// Revoke a decoded JWT payload (email + iat required).
// expMs = when the original token expires (ms since epoch).
function blacklistToken(decoded, expMs) {
  _load();
  if (_store.size >= MAX_ENTRIES) _pruneExpired();
  const k   = _key(decoded.email, decoded.iat);
  const exp = expMs ?? (decoded.exp ? decoded.exp * 1000 : Date.now() + 30 * 24 * 60 * 60 * 1000);
  _store.set(k, exp);
  _persist();
}

// Returns true if this decoded token has been revoked.
function isBlacklisted(decoded) {
  _load();
  if (!decoded?.email || !decoded?.iat) return false;
  return _store.has(_key(decoded.email, decoded.iat));
}

// Revoke ALL active tokens for a given email (full account logout).
function revokeAllForEmail(email) {
  _load();
  const prefix = `${String(email).toLowerCase()}:`;
  for (const k of _store.keys()) {
    // We don't delete — we can't enumerate all active keys.
    // Instead we store a sentinel: email:* = exp far in future.
  }
  // Sentinel approach: store "email:*" entry → isBlacklisted checks it too
  _store.set(`${String(email).toLowerCase()}:*`, Date.now() + 365 * 24 * 60 * 60 * 1000);
  _persist();
}

// isBlacklisted must also check the wildcard sentinel
const _origIsBlacklisted = isBlacklisted;
function isBlacklistedFull(decoded) {
  _load();
  if (!decoded?.email || !decoded?.iat) return false;
  const emailKey = `${String(decoded.email).toLowerCase()}:*`;
  if (_store.has(emailKey)) return true;
  return _origIsBlacklisted(decoded);
}

// Prune expired entries every hour
setInterval(() => { _pruneExpired(); _persist(); }, 60 * 60 * 1000);

module.exports = { blacklistToken, isBlacklisted: isBlacklistedFull, revokeAllForEmail, revokeUserSessions: revokeAllForEmail };
