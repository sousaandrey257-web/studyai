'use strict';
// Multi-level referral reward graph.
// L1 (direct referrer): +50 XP  — already done in referral.js
// L2 (referrer's referrer): streak shield
// L3 (3 levels up): 7-day premium trial flag set on user

function _findReferrer(users, email) {
  const u = users[email];
  if (!u?.referral?.referredBy) return null;
  const code = u.referral.referredBy;
  const entry = Object.entries(users).find(([, pu]) => pu.referral?.code === code);
  return entry ? entry[0] : null; // returns email of referrer
}

// Walk up the chain and compute who gets what reward.
// Returns array of { email, level, reward }
function computeChainRewards(users, newUserEmail) {
  const rewards = [];
  let current   = newUserEmail;

  for (let level = 1; level <= 3; level++) {
    const referrer = _findReferrer(users, current);
    if (!referrer) break;

    if (level === 1) {
      rewards.push({ email: referrer, level: 1, reward: 'xp', xpAmount: 50 });
    } else if (level === 2) {
      rewards.push({ email: referrer, level: 2, reward: 'streak_shield' });
    } else if (level === 3) {
      rewards.push({ email: referrer, level: 3, reward: 'premium_trial_7d' });
    }

    current = referrer;
  }

  return rewards;
}

// Apply computed rewards to the users object.
// Expects injected helpers to avoid circular deps.
function applyChainRewards(users, rewards, { giveXP, ensureGami, awardStreakShield }) {
  const applied = [];

  for (const r of rewards) {
    const user = users[r.email];
    if (!user) continue;
    ensureGami(user);

    if (r.reward === 'xp') {
      giveXP(user.gamification, r.xpAmount, { source: 'referral_l1' });
      applied.push({ ...r, ok: true });
    } else if (r.reward === 'streak_shield') {
      awardStreakShield(user.gamification);
      applied.push({ ...r, ok: true });
    } else if (r.reward === 'premium_trial_7d') {
      if (!user.premiumTrialExpiry || new Date(user.premiumTrialExpiry) < new Date()) {
        user.premiumTrialExpiry = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
        applied.push({ ...r, ok: true });
      }
    }
  }

  return applied;
}

module.exports = { computeChainRewards, applyChainRewards };
