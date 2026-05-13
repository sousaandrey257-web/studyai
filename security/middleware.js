'use strict';
// ============================================================
//  Security Middleware — StudyAI
//  Three independent, non-breaking middlewares:
//  1. sanitizeBody  — strips XSS vectors from req.body strings
//  2. anomalyDetect — sliding-window anomaly flagging (log only)
//  3. createDiffLimiter — adaptive rate limit by auth tier
// ============================================================

const { default: rateLimit, ipKeyGenerator } = require('express-rate-limit');

// ── 1. Body sanitizer ────────────────────────────────────────────────────────
// Removes script tags and inline event handlers from string values.
// Does NOT alter numbers, booleans, or arrays of non-strings.
// Applied after express.json() so the body is already parsed.

const RE_SCRIPT  = /<script[\s\S]*?>[\s\S]*?<\/script>/gi;
const RE_HANDLER = /\s+on\w+\s*=\s*["'][^"']*["']/gi;
const RE_JSPROTO = /javascript\s*:/gi;

function _sanitizeStr(val, maxLen = 20000) {
  if (typeof val !== 'string') return val;
  return val
    .slice(0, maxLen)
    .replace(RE_SCRIPT,  '')
    .replace(RE_HANDLER, '')
    .replace(RE_JSPROTO, '')
    .trim();
}

function _deepSanitize(value, depth = 0) {
  if (depth > 6) return value; // depth guard against deeply nested payloads
  if (typeof value === 'string')  return _sanitizeStr(value);
  if (typeof value === 'number')  return Number.isFinite(value) ? value : 0;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value))       return value.slice(0, 500).map(v => _deepSanitize(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[_sanitizeStr(k, 200)] = _deepSanitize(v, depth + 1);
    }
    return out;
  }
  return value;
}

function sanitizeBody(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = _deepSanitize(req.body);
  }
  next();
}

// ── 2. Anomaly detector ──────────────────────────────────────────────────────
// Sliding-window request counter per IP. Flags (does NOT block) anomalous IPs.
// Designed for monitoring + future integration with antiFraud risk scores.

const ANOMALY_WINDOW_MS  = 10 * 1000; // 10-second window
const ANOMALY_THRESHOLD  = 40;        // 40 req in 10s → flag
const ANOMALY_PRUNE_SIZE = 2000;      // prune map when it grows beyond this

const _ipWindows = new Map(); // ip → { ts: number[], flagged: boolean }

function _getIP(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress || 'unknown';
}

function anomalyDetect(req, res, next) {
  const ip  = _getIP(req);
  const now = Date.now();

  let rec = _ipWindows.get(ip);
  if (!rec) { rec = { ts: [], flagged: false }; _ipWindows.set(ip, rec); }

  // Prune timestamps outside the window
  rec.ts = rec.ts.filter(t => now - t < ANOMALY_WINDOW_MS);
  rec.ts.push(now);

  if (rec.ts.length > ANOMALY_THRESHOLD && !rec.flagged) {
    rec.flagged = true;
    req._anomaly = { ip, count: rec.ts.length };
    console.warn(`[security] Anomaly: ${ip} sent ${rec.ts.length} req in 10s`);
  } else if (rec.ts.length <= ANOMALY_THRESHOLD / 2) {
    rec.flagged = false; // calm down → un-flag
  }

  // Map size guard — prune IPs with no recent activity
  if (_ipWindows.size > ANOMALY_PRUNE_SIZE) {
    for (const [k, v] of _ipWindows.entries()) {
      if (!v.ts.length || now - v.ts[v.ts.length - 1] > 60 * 1000) _ipWindows.delete(k);
    }
  }

  next();
}

// ── 3. Differentiated rate limiter ───────────────────────────────────────────
// Premium → 500 req/15min | Auth user → 200 | Guest → 60
// Uses header presence as tier signal (actual token validation is in requireAuth).
// Invalid fake tokens still fail auth — this only affects the rate bucket.

function createDiffLimiter() {
  const message = { error: 'Trop de requêtes. Réessayez dans quelques minutes.' };

  const guestLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 60,
    standardHeaders: true, legacyHeaders: false, message,
    keyGenerator: req => `g:${ipKeyGenerator(req)}`,
  });
  const userLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 200,
    standardHeaders: true, legacyHeaders: false, message,
    keyGenerator: req => `u:${ipKeyGenerator(req)}`,
  });
  const premiumLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 500,
    standardHeaders: true, legacyHeaders: false, message,
    keyGenerator: req => `p:${ipKeyGenerator(req)}`,
  });

  return function diffLimiter(req, res, next) {
    if (req.headers['x-premium-token']) return premiumLimiter(req, res, next);
    if (req.headers['x-auth-token'])    return userLimiter(req, res, next);
    return guestLimiter(req, res, next);
  };
}

module.exports = { sanitizeBody, anomalyDetect, createDiffLimiter };
