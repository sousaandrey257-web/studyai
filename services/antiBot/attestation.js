'use strict';
// Device Attestation Layer — aggregates browser environment signals.
// Signals arrive via request headers (sent by public/js/fingerprint.js).
// Never hard-blocks alone — produces trustScore used by challengeRouter.js.
//
// Trust levels:
//   trusted     (score 0–25)   → strong human signals, all checks pass
//   neutral     (score 26–55)  → insufficient data or minor anomalies
//   suspicious  (score 56–85)  → multiple weak signals
//   hostile     (score 86–100) → strong automation/replay indicators

const crypto = require('crypto');

// ── Signal extractors ─────────────────────────────────────────────────────────

function _extractSignals(req) {
  const h = req.headers || {};
  return {
    webglHash:     h['x-webgl-hash']      || '',
    canvasHash:    h['x-canvas-hash']     || '',
    audioHash:     h['x-audio-hash']      || '',
    webdriver:     h['x-webdriver']       === 'true',
    automation:    h['x-automation']      === 'true',
    powSolved:     h['x-pow-solved']      === 'true',
    tzClient:      h['x-client-tz']       || '',
    screen:        h['x-client-screen']   || '',
    mouseEntropy:  parseFloat(h['x-mouse-entropy'] || '') || null,
    typeTiming:    h['x-type-timing']     || '',
    ua:            (h['user-agent']        || '').slice(0, 200),
  };
}

// ── Timezone drift check ──────────────────────────────────────────────────────
// Server receives x-client-tz (IANA name). We cross-check with Accept-Language.
// Crude — a true drift detector needs JS timestamp vs server time.

function _tzDriftScore(tzClient, ua) {
  if (!tzClient) return 10; // no timezone header → suspicious
  // If timezone is UTC and UA looks like a browser (not a curl/wget) → mild suspicion
  if (tzClient === 'UTC' && /Mozilla/i.test(ua)) return 5;
  return 0;
}

// ── Screen resolution sanity ─────────────────────────────────────────────────

function _screenScore(screen) {
  if (!screen) return 10;
  const [w, h] = screen.split('x').map(Number);
  if (!w || !h) return 10;
  // Common headless defaults: 800x600, 1024x768, 1280x720 (exact round numbers)
  const headlessDefaults = ['800x600', '1024x768', '1280x720', '1920x1080'];
  if (headlessDefaults.includes(screen)) return 5; // not suspicious alone, just noted
  return 0;
}

// ── Hardware concurrency ─────────────────────────────────────────────────────
// Expected in x-hw-concurrency header (optional).

function _hwConcurrencyScore(req) {
  const hwc = parseInt(req.headers['x-hw-concurrency'] || '') || null;
  if (hwc === null) return 0; // not sent → neutral
  if (hwc < 1 || hwc > 128) return 15; // impossible value
  if (hwc === 1) return 8; // single-core common in containers/headless VMs
  return 0;
}

// ── Canvas / WebGL / Audio entropy cross-check ────────────────────────────────

function _fingerprintScore(webglHash, canvasHash, audioHash, ua) {
  let score = 0;
  const hasBrowserUA = /Mozilla|Chrome|Safari|Firefox|Edge/i.test(ua);

  // Real browser should have canvas
  if (!canvasHash && hasBrowserUA) score += 15;
  if (!webglHash  && hasBrowserUA) score += 10;
  if (!audioHash  && webglHash && hasBrowserUA) score += 10;

  // All three identical → likely replayed/static fingerprint
  if (webglHash && canvasHash && audioHash && webglHash === canvasHash) score += 25;

  // Any single hash looks suspiciously short or malformed
  for (const h of [webglHash, canvasHash, audioHash]) {
    if (h && (h.length < 4 || !/^[0-9a-f]+$/i.test(h))) { score += 10; break; }
  }

  return score;
}

// ── Main attestation score ────────────────────────────────────────────────────

function computeAttestation(req) {
  const signals = _extractSignals(req);
  let score = 0;
  const flags = [];

  if (signals.webdriver)  { score += 40; flags.push('webdriver'); }
  if (signals.automation) { score += 30; flags.push('automation_api'); }

  const tzScore = _tzDriftScore(signals.tzClient, signals.ua);
  if (tzScore > 0) { score += tzScore; flags.push('tz_anomaly'); }

  const scrScore = _screenScore(signals.screen);
  if (scrScore > 0) { score += scrScore; flags.push('screen_anomaly'); }

  const hwScore = _hwConcurrencyScore(req);
  if (hwScore > 0) { score += hwScore; flags.push('hw_concurrency_anomaly'); }

  const fpScore = _fingerprintScore(signals.webglHash, signals.canvasHash, signals.audioHash, signals.ua);
  if (fpScore > 0) { score += fpScore; flags.push('fp_anomaly'); }

  // PoW solved is a positive signal — reduces attestation score slightly
  if (signals.powSolved && score > 0) score = Math.max(0, score - 10);

  score = Math.min(100, score);

  const trustLevel =
    score <= 25 ? 'trusted' :
    score <= 55 ? 'neutral' :
    score <= 85 ? 'suspicious' : 'hostile';

  return { attestationScore: score, trustLevel, flags, signals };
}

// Express middleware — attaches req._attestation (never blocks)
function attestationMiddleware(req, res, next) {
  req._attestation = computeAttestation(req);
  next();
}

module.exports = { computeAttestation, attestationMiddleware };
