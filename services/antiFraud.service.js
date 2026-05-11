'use strict';
// ============================================================
//  AntiFraud Service — StudyAI
//  Protects against: XP farming, quiz flooding, score injection,
//  circular referrals, brute-force patterns.
//  Design: detect & log (non-blocking for legitimate users),
//  hard-block only unambiguous abuse.
// ============================================================

const crypto = require('crypto');

// ── Tuning constants ─────────────────────────────────────────────────────────
const MAX_QUIZZES_PER_DAY  = 20;  // generous cap — a real student won't hit this
const QUIZ_COOLDOWN_MS     = 15 * 1000; // 15 s min between quiz submissions
const MAX_QUIZ_QUESTIONS   = 50;  // sanity ceiling on `total`

// ── Device fingerprint ───────────────────────────────────────────────────────
// Lightweight hash for multi-account detection. Not a hard block — only logged.
function deviceFingerprint(req) {
  const ip   = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
              || (req.socket?.remoteAddress || '');
  const ua   = (req.headers['user-agent']      || '').slice(0, 200);
  const lang = (req.headers['accept-language'] || '').slice(0, 50);
  return crypto.createHash('sha256')
    .update(`${ip}|${ua}|${lang}`)
    .digest('hex')
    .slice(0, 16); // 64-bit — enough for detection, not PII
}

// ── Quiz input validation ─────────────────────────────────────────────────────
// Prevents client-injected score / XP inflation via manipulated correctByDiff.
function validateQuizInput(score, total, correctByDiff) {
  const t = parseInt(total) || 0;
  const s = parseInt(score) || 0;

  if (t < 1 || t > MAX_QUIZ_QUESTIONS) return { ok: false, reason: 'invalid_total' };
  if (s < 0 || s > t)                  return { ok: false, reason: 'invalid_score' };

  if (correctByDiff && typeof correctByDiff === 'object' && !Array.isArray(correctByDiff)) {
    let sum = 0;
    for (const [diff, count] of Object.entries(correctByDiff)) {
      const d = parseInt(diff);
      const c = parseInt(count) || 0;
      if (![1, 2, 3].includes(d)) return { ok: false, reason: 'invalid_difficulty' };
      if (c < 0)                  return { ok: false, reason: 'negative_count' };
      sum += c;
    }
    // Sum of per-difficulty corrects must not exceed total questions
    if (sum > t) return { ok: false, reason: 'xp_injection' };
  }
  return { ok: true };
}

// ── Quiz rate controls (stored in gami._antifraud) ────────────────────────────

function _getAFStats(gami) {
  const today = new Date().toISOString().split('T')[0];
  if (!gami._antifraud) gami._antifraud = {};
  const af = gami._antifraud;

  // Prune stale days
  for (const k of Object.keys(af)) {
    if (k !== '_lastQuizAt' && k < today) delete af[k];
  }

  if (!af[today]) af[today] = { quizCount: 0, xpEarned: 0 };
  return { af, today, stats: af[today] };
}

function checkQuizCooldown(gami) {
  const last = gami._antifraud?._lastQuizAt || 0;
  const age  = Date.now() - last;
  if (age < QUIZ_COOLDOWN_MS) {
    return { ok: false, reason: 'cooldown', retryAfter: Math.ceil((QUIZ_COOLDOWN_MS - age) / 1000) };
  }
  return { ok: true };
}

function checkDailyQuizLimit(gami) {
  const { stats } = _getAFStats(gami);
  if (stats.quizCount >= MAX_QUIZZES_PER_DAY) {
    return { ok: false, reason: 'daily_limit' };
  }
  return { ok: true };
}

function recordQuizCompletion(gami, xpAwarded) {
  const { af, today, stats } = _getAFStats(gami);
  stats.quizCount++;
  stats.xpEarned = (stats.xpEarned || 0) + xpAwarded;
  af._lastQuizAt  = Date.now();
}

// ── Referral graph integrity ──────────────────────────────────────────────────
// Walk the referral chain from referrerEmail upward.
// Returns true if newUserEmail already appears in the chain (circular).
function detectCircularReferral(users, referrerEmail, newUserEmail) {
  const visited = new Set();
  let   current = referrerEmail;

  while (current && !visited.has(current)) {
    visited.add(current);
    const u = users[current];
    if (!u) break;
    const parentCode = u.referral?.referredBy;
    if (!parentCode) break;
    const parentEntry = Object.entries(users).find(([, pu]) => pu.referral?.code === parentCode);
    if (!parentEntry) break;
    const [parentEmail] = parentEntry;
    if (parentEmail === newUserEmail) return true; // loop detected
    current = parentEmail;
  }
  return false;
}

// ── Device fingerprint V2 (richer signal) ────────────────────────────────────
// Adds optional client-side hints (timezone, screen) when sent by frontend.
// Headers x-client-tz and x-client-screen are added by auth.js (see below).
// Backward-compatible: if hints are absent, falls back to V1 fields.
function deviceFingerprintV2(req) {
  const ip   = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
              || (req.socket?.remoteAddress || '');
  const ua   = (req.headers['user-agent']         || '').slice(0, 200);
  const lang = (req.headers['accept-language']    || '').slice(0, 50);
  const enc  = (req.headers['accept-encoding']    || '').slice(0, 50);
  const acc  = (req.headers['accept']             || '').slice(0, 100);
  // Optional client-side hints (sent by frontend auth.js)
  const tz   = (req.headers['x-client-tz']        || '').slice(0, 50);
  const scr  = (req.headers['x-client-screen']    || '').slice(0, 20);
  return crypto.createHash('sha256')
    .update(`${ip}|${ua}|${lang}|${enc}|${acc}|${tz}|${scr}`)
    .digest('hex')
    .slice(0, 20); // 80-bit — more signal than V1 (16-char)
}

// ── Risk scoring ─────────────────────────────────────────────────────────────
// Returns { score: 0-100, reasons: string[], flagged: boolean }
// score 0-29: normal  |  30-59: watch  |  60-79: suspicious  |  80+: likely abuse
// DESIGN: never hard-block based on score alone — flag + monitor only.
function computeRiskScore(user, req, users) {
  let score   = 0;
  const reasons = [];

  // Factor 1: fingerprint collision (same device, different accounts)
  const fpV2 = deviceFingerprintV2(req);
  const collisions = Object.values(users).filter(
    u => u._fingerprint && u._fingerprint === (user._fingerprint || fpV2) && u.email !== user.email
  );
  if (collisions.length >= 1) { score += 35; reasons.push('fp_collision'); }
  if (collisions.length >= 3) { score += 25; reasons.push('fp_mass_collision'); }

  // Factor 2: referral farming
  const referredCount = user.referral?.referredUsers?.length || 0;
  if (referredCount >= 10) { score += 25; reasons.push('referral_farm'); }
  if (referredCount >= 25) { score += 20; reasons.push('referral_mass_farm'); }

  // Factor 3: new account (< 48h) immediately claiming referral + high XP
  const ageMs = user.createdAt ? Date.now() - new Date(user.createdAt).getTime() : Infinity;
  const xp    = user.gamification?.xp || 0;
  if (ageMs < 48 * 3600 * 1000 && xp > 500) { score += 15; reasons.push('new_high_xp'); }

  // Factor 4: request anomaly flag (set by anomalyDetect middleware)
  if (req._anomaly) { score += 10; reasons.push('rapid_requests'); }

  return { score, reasons, flagged: score >= 60 };
}

// ── Abuse log (in-memory ring-buffer; wire to external sink in prod) ──────────
const _abuseLog = [];

function logAbuse(type, details) {
  const entry = { ts: new Date().toISOString(), type, ...details };
  _abuseLog.push(entry);
  if (_abuseLog.length > 1000) _abuseLog.shift();
  console.warn('[antiFraud]', type, JSON.stringify(details));
}

function getAbuseLog() { return [..._abuseLog]; }

module.exports = {
  deviceFingerprint,
  deviceFingerprintV2,
  computeRiskScore,
  validateQuizInput,
  checkQuizCooldown,
  checkDailyQuizLimit,
  recordQuizCompletion,
  detectCircularReferral,
  logAbuse,
  getAbuseLog,
  MAX_QUIZZES_PER_DAY,
  QUIZ_COOLDOWN_MS,
};
