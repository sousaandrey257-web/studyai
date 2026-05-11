'use strict';
// Bot detection — score-based, 4-tier adaptive response.
// Signals: UA analysis, request timing variance, client entropy headers,
//          fingerprint rotation, headless browser signals (via headless.js),
//          PoW absence penalty.
//
// Tier thresholds:
//   < 40  → normal
//   40–69 → shadow (20% XP)
//   70–89 → degraded (50% XP)
//   90+   → hard block

const crypto   = require('crypto');
const Headless = require('./headless');
const Metrics  = require('../observability/metrics');

// ── UA signals ────────────────────────────────────────────────────────────────

const BOT_UA_RE        = /bot|crawl|spider|scraper|headless|phantom|selenium|puppeteer|playwright|wget|curl/i;
const MISSING_UA_SCORE = 30;
const BOT_UA_SCORE     = 80;

// ── Request timing variance (per-IP sliding window) ──────────────────────────

const _timings = new Map(); // ip → [ts, ...]

function _recordTiming(ip) {
  const now = Date.now();
  if (!_timings.has(ip)) _timings.set(ip, []);
  const arr = _timings.get(ip);
  arr.push(now);
  if (arr.length > 20) arr.shift();

  if (_timings.size > 5_000) {
    const cutoff = now - 10 * 60_000;
    for (const [k, v] of _timings) {
      if (!v.length || v[v.length - 1] < cutoff) _timings.delete(k);
    }
  }
  return arr;
}

function _timingScore(arr) {
  if (arr.length < 5) return 0;
  const gaps = [];
  for (let i = 1; i < arr.length; i++) gaps.push(arr[i] - arr[i - 1]);
  const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  const cv   = mean > 0 ? Math.sqrt(gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length) / mean : 0;
  if (cv < 0.05 && mean < 2_000) return 40;
  if (cv < 0.15 && mean < 1_000) return 20;
  return 0;
}

// ── Human interaction entropy (client-supplied) ───────────────────────────────

function _entropyScore(req) {
  let score = 0;
  const mouseEntropy = parseFloat(req.headers['x-mouse-entropy'] || '');
  const typeTiming   = req.headers['x-type-timing'] || '';

  if (!isNaN(mouseEntropy)) {
    if      (mouseEntropy < 0.1) { score += 25; }
    else if (mouseEntropy < 0.3) { score += 10; }
  }
  if (typeTiming) {
    const delays = typeTiming.split(',').map(Number).filter(n => !isNaN(n) && n > 0);
    if (delays.length >= 3) {
      const mean = delays.reduce((s, d) => s + d, 0) / delays.length;
      const cv   = mean > 0 ? Math.sqrt(delays.reduce((s, d) => s + (d - mean) ** 2, 0) / delays.length) / mean : 0;
      if (cv < 0.05) score += 20;
    }
  }
  return score;
}

// ── Fingerprint rotation detection ───────────────────────────────────────────

const _fpHistory = new Map(); // ip → Set<fingerprint>

function _fpRotationScore(ip, fp) {
  if (!fp) return 0;
  if (!_fpHistory.has(ip)) _fpHistory.set(ip, new Set());
  const set = _fpHistory.get(ip);
  set.add(fp);
  if (set.size > 10) _fpHistory.set(ip, new Set([...set].slice(-10)));
  if (set.size >= 8) return 30;
  if (set.size >= 5) return 15;
  return 0;
}

// ── PoW absence penalty ───────────────────────────────────────────────────────
// Missing PoW is a soft signal — 10 points only on sensitive routes.

function _powScore(req) {
  if (req._powMissing === true)  return 10;
  if (req._powValid   === false) return 20; // attempted but wrong
  return 0;
}

// ── Core scoring ──────────────────────────────────────────────────────────────

function computeBotScore(req, fingerprint) {
  let score = 0;
  const reasons = [];

  const ua = req.headers['user-agent'] || '';
  if (!ua) {
    score += MISSING_UA_SCORE; reasons.push('no_ua');
  } else if (BOT_UA_RE.test(ua)) {
    score += BOT_UA_SCORE; reasons.push('bot_ua');
  }

  const ip      = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';
  const tvScore = _timingScore(_recordTiming(ip));
  if (tvScore > 0) { score += tvScore; reasons.push('uniform_timing'); }

  const ceScore = _entropyScore(req);
  if (ceScore > 0) { score += ceScore; reasons.push('low_entropy'); }

  const fpScore = _fpRotationScore(ip, fingerprint);
  if (fpScore > 0) { score += fpScore; reasons.push('fp_rotation'); }

  const pwScore = _powScore(req);
  if (pwScore > 0) { score += pwScore; reasons.push(req._powValid === false ? 'pow_failed' : 'no_pow'); }

  score = Math.min(100, score);

  // Enrich with headless browser signals
  const enriched = Headless.enrichBotScore(score, reasons, req);
  Metrics.recordBotScore(enriched.score);

  return enriched; // { score, reasons, isBot }
}

// Map score to 4-tier adaptive response
function adaptiveTier(score) {
  if (score >= 90) return 'block';
  if (score >= 70) return 'degraded';
  if (score >= 40) return 'shadow';
  return 'normal';
}

// XP multiplier per tier (applied on top of existing multipliers)
function xpFactorForTier(tier) {
  const map = { normal: 1.0, shadow: 0.2, degraded: 0.5, block: 0 };
  return map[tier] ?? 1.0;
}

// ── Express middleware ────────────────────────────────────────────────────────

function botDetectMiddleware(req, res, next) {
  const fp = req.headers['x-device-fp'] || '';
  const { score, isBot, reasons } = computeBotScore(req, fp);

  req._botScore  = score;
  req._botTier   = adaptiveTier(score);
  req._botReason = reasons;

  if (isBot) {
    console.warn(`[antiBot] BLOCK ip=${req.ip} score=${score} [${reasons.join(',')}]`);
    return res.status(403).json({ error: 'Accès refusé.' });
  }

  next();
}

module.exports = { computeBotScore, botDetectMiddleware, adaptiveTier, xpFactorForTier };
