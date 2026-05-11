'use strict';
// ============================================================
//  Entitlements & Feature Flags
//  - Defines what each tier (free/premium/admin) can access
//  - Feature flags via FEATURE_* env vars (zero restart needed)
//  - Never breaks existing behavior — routes check entitlements
//    in addition to, not instead of, existing auth checks
// ============================================================

// ── Feature flags (read live from env) ───────────────────────
// Set FEATURE_X=false to disable; default = enabled
function flag(name, defaultOn = true) {
  const v = process.env[`FEATURE_${name.toUpperCase()}`];
  if (v === undefined) return defaultOn;
  return v !== 'false' && v !== '0';
}

// ── Tier definitions ──────────────────────────────────────────
const TIERS = {
  guest:   'guest',
  free:    'free',
  premium: 'premium',
  admin:   'admin',
};

// ── Entitlement definitions ───────────────────────────────────
const ENTITLEMENTS = {
  guest: {
    generatePerDay:        3,
    quizEnabled:           true,
    consolidationEnabled:  false,
    leaderboardEnabled:    false,
    historyEnabled:        false,
    referralEnabled:       false,
    analyticsEnabled:      false,
    xpMultiplier:          1,
    streamingEnabled:      false,
    prioritySupport:       false,
  },
  free: {
    generatePerDay:        3,
    quizEnabled:           true,
    consolidationEnabled:  flag('CONSOLIDATION_FREE', false),
    leaderboardEnabled:    true,
    historyEnabled:        true,
    referralEnabled:       true,
    analyticsEnabled:      false,
    xpMultiplier:          1,
    streamingEnabled:      false,
    prioritySupport:       false,
  },
  premium: {
    generatePerDay:        null, // unlimited
    quizEnabled:           true,
    consolidationEnabled:  true,
    leaderboardEnabled:    true,
    historyEnabled:        true,
    referralEnabled:       true,
    analyticsEnabled:      false,
    xpMultiplier:          2,
    streamingEnabled:      flag('STREAMING'),
    prioritySupport:       true,
  },
  admin: {
    generatePerDay:        null,
    quizEnabled:           true,
    consolidationEnabled:  true,
    leaderboardEnabled:    true,
    historyEnabled:        true,
    referralEnabled:       true,
    analyticsEnabled:      true,
    xpMultiplier:          2,
    streamingEnabled:      true,
    prioritySupport:       true,
  },
};

// ── Public API ────────────────────────────────────────────────

function getTier(req, isPremium = false) {
  if (req._adminAuth || req._isSuperAdmin) return TIERS.admin;
  if (isPremium) return TIERS.premium;
  if (req.user?.userId)  return TIERS.free;
  return TIERS.guest;
}

function getEntitlements(req, isPremium = false) {
  const tier  = getTier(req, isPremium);
  const base  = { ...ENTITLEMENTS[tier] };

  // Live feature flag overrides
  if (!flag('LEADERBOARD'))    base.leaderboardEnabled   = false;
  if (!flag('REFERRAL'))       base.referralEnabled      = false;
  if (!flag('CONSOLIDATION'))  base.consolidationEnabled = false;

  return { tier, ...base };
}

// Lightweight check — use in middleware or route guards
function can(req, ability, isPremium = false) {
  const ent = getEntitlements(req, isPremium);
  return !!ent[ability];
}

// Public summary — safe to send to frontend (no server internals)
function publicSummary(req, isPremium = false) {
  const { tier, generatePerDay, quizEnabled, consolidationEnabled,
          leaderboardEnabled, referralEnabled, xpMultiplier,
          streamingEnabled, prioritySupport } = getEntitlements(req, isPremium);
  return {
    tier,
    generatePerDay,
    quizEnabled,
    consolidationEnabled,
    leaderboardEnabled,
    referralEnabled,
    xpMultiplier,
    streamingEnabled,
    prioritySupport,
    features: {
      leaderboard:   flag('LEADERBOARD'),
      referral:      flag('REFERRAL'),
      consolidation: flag('CONSOLIDATION'),
      streaming:     flag('STREAMING'),
    },
  };
}

module.exports = { getTier, getEntitlements, can, publicSummary, TIERS, flag };
