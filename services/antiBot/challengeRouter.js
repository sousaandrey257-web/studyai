'use strict';
// Adaptive Challenge Router — selects appropriate friction level based on composite risk score.
//
// Score aggregation (weighted average):
//   botDetector score   : 40%  (existing heuristics + headless)
//   attestation score   : 35%  (device signals)
//   behavior score      : 25%  (interaction patterns)
//
// Challenge tiers:
//   < 30   → none          (low friction, pass-through)
//   30–59  → pow           (PoW only, ~50-200ms client CPU)
//   60–84  → pow+interact  (PoW + interaction check — not yet implemented, returns flag)
//   85+    → captcha        (pluggable CAPTCHA provider — mock by default)
//
// CAPTCHA provider is pluggable: set process.env.CAPTCHA_PROVIDER = 'recaptcha|hcaptcha|mock'

const PoW = require('./pow');

// ── Score aggregation ─────────────────────────────────────────────────────────

function aggregateScore(req) {
  const botScore         = req._botScore          || 0;
  const attestationScore = req._attestation?.attestationScore || 0;
  const behaviorScore    = req._behavior?.score   || 0;

  // Weighted composite — only include signals that were actually computed
  const hasAttestation = !!req._attestation;
  const hasBehavior    = !!req._behavior;

  let totalWeight = 0.40; // bot always present (set by botDetectMiddleware)
  let weighted    = botScore * 0.40;

  if (hasAttestation) { weighted += attestationScore * 0.35; totalWeight += 0.35; }
  if (hasBehavior)    { weighted += behaviorScore    * 0.25; totalWeight += 0.25; }

  const composite = totalWeight > 0 ? Math.round(weighted / totalWeight) : botScore;
  return Math.min(100, composite);
}

// ── Challenge tier ────────────────────────────────────────────────────────────

function routeChallenge(compositeScore) {
  if (compositeScore >= 85) return 'captcha';
  if (compositeScore >= 60) return 'pow+interact';
  if (compositeScore >= 30) return 'pow';
  return 'none';
}

// ── CAPTCHA mock provider ─────────────────────────────────────────────────────

const _CAPTCHA_PROVIDERS = {
  // In production: replace with real provider implementations
  mock: {
    name: 'mock',
    issue: () => ({ token: `mock-${Date.now()}`, provider: 'mock', expiresIn: 300 }),
    verify: (token) => token && token.startsWith('mock-'),
  },
  // Future real providers:
  // recaptcha: require('./providers/recaptcha'),
  // hcaptcha:  require('./providers/hcaptcha'),
};

function _getCaptchaProvider() {
  const name = process.env.CAPTCHA_PROVIDER || 'mock';
  return _CAPTCHA_PROVIDERS[name] || _CAPTCHA_PROVIDERS.mock;
}

// ── Express middleware ────────────────────────────────────────────────────────
// Computes composite score + attaches challenge guidance to req._challengeRoute.
// Does NOT hard block — upstream route handlers decide whether to enforce.

function challengeRouterMiddleware(req, res, next) {
  const compositeScore = aggregateScore(req);
  const tier           = routeChallenge(compositeScore);

  req._challengeRoute = {
    compositeScore,
    tier,
    requiresPoW:        tier !== 'none',
    requiresInteract:   tier === 'pow+interact' || tier === 'captcha',
    requiresCaptcha:    tier === 'captcha',
    powValid:           req._powValid === true,
    powMissing:         req._powMissing === true,
  };

  next();
}

// Issue the appropriate challenge for a given request (called from /api/challenge route)
function issueChallenge(compositeScore) {
  const tier = routeChallenge(compositeScore);
  const result = { tier };

  if (tier !== 'none') {
    Object.assign(result, PoW.issue()); // always include PoW challenge
  }
  if (tier === 'captcha') {
    const provider = _getCaptchaProvider();
    result.captcha = provider.issue();
  }
  return result;
}

// Verify challenge response (for explicit verification endpoint)
function verifyChallenge({ challengeId, nonce, captchaToken } = {}) {
  const results = { pow: null, captcha: null };

  if (challengeId && nonce != null) {
    results.pow = PoW.verify(challengeId, nonce);
  }
  if (captchaToken) {
    const provider = _getCaptchaProvider();
    results.captcha = { ok: provider.verify(captchaToken) };
  }

  const allOk = Object.values(results).every(r => r === null || r?.ok);
  return { ok: allOk, results };
}

module.exports = { aggregateScore, routeChallenge, challengeRouterMiddleware, issueChallenge, verifyChallenge };
