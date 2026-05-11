'use strict';
// ============================================================
//  StudyAI — Referral Service
//  Viral loop : +50 XP parrain + +50 XP filleul
//  Anti-abus : 1 referral par compte, pas d'auto-referral
// ============================================================

const crypto = require('crypto');

const REFERRAL_XP     = 50;
const CODE_LENGTH     = 6; // caractères hex uppercase

function generateCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function ensureReferralCode(user) {
  if (!user.referral) {
    user.referral = {
      code:          generateCode(),
      referredBy:    null,
      referredUsers: [],
      totalXPEarned: 0,
    };
  }
  if (!user.referral.code) user.referral.code = generateCode();
  return user.referral.code;
}

/**
 * Tente de valider un parrainage.
 * @returns {{ ok: boolean, error?: string, referrerEmail?: string, xpBonus: number }}
 */
function claimReferral(users, newUserEmail, rawCode) {
  const code    = (rawCode || '').trim().toUpperCase();
  const newUser = users[newUserEmail];
  if (!newUser)          return { ok: false, error: 'user_not_found',  xpBonus: 0 };
  if (!code)             return { ok: false, error: 'invalid_code',    xpBonus: 0 };
  if (newUser.referral?.referredBy) return { ok: false, error: 'already_claimed', xpBonus: 0 };

  // Trouver le parrain
  const referrerEntry = Object.entries(users).find(
    ([, u]) => u.referral?.code === code,
  );
  if (!referrerEntry)    return { ok: false, error: 'code_not_found',  xpBonus: 0 };
  const [referrerEmail, referrer] = referrerEntry;
  if (referrerEmail === newUserEmail) return { ok: false, error: 'self_referral', xpBonus: 0 };

  // Circular referral detection: walk chain from referrer up, reject if newUser appears
  if (_isCircular(users, referrerEmail, newUserEmail)) {
    return { ok: false, error: 'circular_referral', xpBonus: 0 };
  }

  // Marquer le filleul
  ensureReferralCode(newUser);
  newUser.referral.referredBy = code;

  // Créditer le parrain
  ensureReferralCode(referrer);
  if (!referrer.referral.referredUsers.includes(newUserEmail)) {
    referrer.referral.referredUsers.push(newUserEmail);
    referrer.referral.totalXPEarned = (referrer.referral.totalXPEarned || 0) + REFERRAL_XP;
  }

  return { ok: true, referrerEmail, xpBonus: REFERRAL_XP };
}

function _isCircular(users, referrerEmail, newUserEmail) {
  const visited = new Set();
  let current   = referrerEmail;
  while (current && !visited.has(current)) {
    visited.add(current);
    const u = users[current];
    if (!u) break;
    const parentCode = u.referral?.referredBy;
    if (!parentCode) break;
    const parent = Object.entries(users).find(([, pu]) => pu.referral?.code === parentCode);
    if (!parent) break;
    const [parentEmail] = parent;
    if (parentEmail === newUserEmail) return true;
    current = parentEmail;
  }
  return false;
}

function getReferralStats(user) {
  const r = user?.referral || {};
  return {
    code:          r.code          || null,
    referredBy:    r.referredBy    || null,
    referredCount: (r.referredUsers || []).length,
    totalXPEarned: r.totalXPEarned || 0,
  };
}

module.exports = { REFERRAL_XP, generateCode, ensureReferralCode, claimReferral, getReferralStats };
