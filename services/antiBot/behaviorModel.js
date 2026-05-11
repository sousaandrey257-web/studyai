'use strict';
// Behavioral Analysis Model — simulated ML scoring.
// Extensible: replace _runModel() with a real ML inference call without changing the API.
//
// Inputs (all optional, sent by public/js/fingerprint.js):
//   x-mouse-entropy  : float 0.0–∞  (CV of mouse displacement distances)
//   x-type-timing    : comma-separated keystroke delays in ms
//   x-session-actions: count of user actions in session
//   x-time-to-action : ms from page load to first interaction
//   x-scroll-count   : number of scroll events in session
//   x-click-count    : number of click events in session
//
// Output: { score: 0-100, confidence: 0-1, category: 'human|suspicious|bot', features: {} }

// ── Feature extraction ────────────────────────────────────────────────────────

function extractFeatures(req) {
  const h = req.headers || {};

  const mouseEntropy   = parseFloat(h['x-mouse-entropy']    || '') || null;
  const typeTiming     = h['x-type-timing']    || '';
  const timeToAction   = parseInt(h['x-time-to-action']    || '') || null;
  const sessionActions = parseInt(h['x-session-actions']   || '') || null;
  const scrollCount    = parseInt(h['x-scroll-count']      || '') || null;
  const clickCount     = parseInt(h['x-click-count']       || '') || null;

  // Parse keystroke delays
  const delays = typeTiming
    ? typeTiming.split(',').map(Number).filter(n => !isNaN(n) && n > 0)
    : [];

  const keystrokeCV = _coefficientOfVariation(delays);
  const keystrokeMean = delays.length ? delays.reduce((s, d) => s + d, 0) / delays.length : null;

  return {
    mouseEntropy,
    keystrokeDelays:  delays.length,
    keystrokeCV,
    keystrokeMean,
    timeToAction,
    sessionActions,
    scrollCount,
    clickCount,
  };
}

function _coefficientOfVariation(arr) {
  if (arr.length < 3) return null;
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  if (mean === 0) return 0;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance) / mean;
}

// ── Simulated model ───────────────────────────────────────────────────────────
// Each feature contributes a partial bot-likelihood score.
// Positive contributions → more bot-like.
// Returns raw score 0-100 + confidence in [0, 1].

function _runModel(features) {
  let score      = 0;
  let confidence = 0;
  let signals    = 0; // how many features we actually have

  // Mouse entropy: CV of displacement. Bots → very low (<0.1) or absent.
  if (features.mouseEntropy !== null) {
    signals++;
    if      (features.mouseEntropy < 0.05) { score += 30; confidence += 0.8; }
    else if (features.mouseEntropy < 0.15) { score += 15; confidence += 0.5; }
    else if (features.mouseEntropy > 0.5)  { score -= 10; confidence += 0.3; } // very human
  }

  // Keystroke cadence: bots type with perfect uniformity (CV < 0.05)
  if (features.keystrokeCV !== null && features.keystrokeDelays >= 5) {
    signals++;
    const cv = features.keystrokeCV;
    if      (cv < 0.05)  { score += 25; confidence += 0.7; }
    else if (cv < 0.15)  { score += 10; confidence += 0.4; }
    else if (cv > 0.5)   { score -= 5;  confidence += 0.2; } // erratic human
    // Keystroke mean: humans typically 80-400ms; bots can be very fast (<20ms)
    if (features.keystrokeMean !== null && features.keystrokeMean < 20) {
      score += 20; confidence += 0.6;
    }
  }

  // Time-to-action: bots act immediately after page load
  if (features.timeToAction !== null) {
    signals++;
    if      (features.timeToAction < 200)   { score += 20; confidence += 0.6; }
    else if (features.timeToAction < 800)   { score += 5;  confidence += 0.2; }
    else if (features.timeToAction > 5_000) { score -= 5;  confidence += 0.1; } // human read time
  }

  // Scroll/click ratio: humans scroll and click in natural proportion
  if (features.scrollCount !== null && features.clickCount !== null) {
    signals++;
    const ratio = features.clickCount > 0 ? features.scrollCount / features.clickCount : 0;
    if (features.scrollCount === 0 && features.clickCount > 3) {
      score += 15; confidence += 0.5; // clicked without scrolling — form-filler bot
    } else if (ratio > 0 && ratio < 20) {
      score -= 5; confidence += 0.2; // normal human browsing pattern
    }
  }

  // Session actions: very high action count in short time = automation
  if (features.sessionActions !== null) {
    signals++;
    if (features.sessionActions > 50) { score += 10; confidence += 0.3; }
    if (features.sessionActions > 200){ score += 15; confidence += 0.4; }
  }

  // Normalise
  score = Math.max(0, Math.min(100, score));
  confidence = signals > 0 ? Math.min(1, confidence / signals) : 0.1;

  return { score, confidence };
}

// ── Public API ────────────────────────────────────────────────────────────────

function analyze(req) {
  const features = extractFeatures(req);
  const { score, confidence } = _runModel(features);

  const category =
    score >= 70 ? 'bot' :
    score >= 40 ? 'suspicious' : 'human';

  return { score, confidence: parseFloat(confidence.toFixed(2)), category, features };
}

// Express middleware — attaches req._behavior (never blocks)
function behaviorMiddleware(req, res, next) {
  req._behavior = analyze(req);
  next();
}

module.exports = { analyze, extractFeatures, behaviorMiddleware };
