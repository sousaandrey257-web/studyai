'use strict';
const crypto   = require('crypto');
const Provider = require('./emailProvider');
const Templates = require('./templates');

// Rate limiting: max emails per hour (to prevent abuse)
const RATE_LIMIT = parseInt(process.env.EMAIL_RATE_LIMIT_HOUR || '200', 10);
const RATE_WINDOW = 60 * 60 * 1000;
let sent = 0;
let windowStart = Date.now();

// Dedup window: prevent identical emails within 5 min
const DEDUP_TTL = 5 * 60 * 1000;
const dedup = new Map();

// Per-recipient cooldown (prevent spamming one address)
const PER_RECIPIENT_LIMIT = parseInt(process.env.EMAIL_PER_RECIPIENT_HOUR || '5', 10);
const recipientCounts = new Map();

function resetWindowIfNeeded() {
  const now = Date.now();
  if (now - windowStart > RATE_WINDOW) {
    sent = 0;
    windowStart = now;
    recipientCounts.clear();
  }
}

function dedupKey(to, subject) {
  return crypto.createHash('sha1').update(`${to.toLowerCase()}:${subject}`).digest('hex').slice(0, 12);
}

function checkAndRecord(to, subject) {
  resetWindowIfNeeded();

  if (sent >= RATE_LIMIT) throw new Error('Email global rate limit reached');

  const addr = to.toLowerCase();
  const count = recipientCounts.get(addr) || 0;
  if (count >= PER_RECIPIENT_LIMIT) throw new Error(`Email per-recipient limit reached for ${addr}`);

  const dk = dedupKey(to, subject);
  const lastSent = dedup.get(dk);
  if (lastSent && Date.now() - lastSent < DEDUP_TTL) throw new Error('Duplicate email suppressed');

  sent++;
  recipientCounts.set(addr, count + 1);
  dedup.set(dk, Date.now());

  // Prune dedup map
  if (dedup.size > 1000) {
    const cutoff = Date.now() - DEDUP_TTL;
    for (const [k, v] of dedup) { if (v < cutoff) dedup.delete(k); }
  }
}

async function send({ to, subject, html, skipDedup = false }) {
  if (!skipDedup) checkAndRecord(to, subject);
  try {
    return await Provider.send({ to, subject, html });
  } catch (err) {
    console.error(`[email] Failed to send to ${to}: ${err.message}`);
    throw err;
  }
}

// Convenience wrappers
async function sendWelcome(email)                   { const t = Templates.welcome({ email });          return send({ to: email, ...t }); }
async function sendPasswordReset(email, token)      { const t = Templates.passwordReset({ email, token }); return send({ to: email, ...t, skipDedup: true }); }
async function sendEmailVerification(email, token)  { const t = Templates.emailVerification({ email, token }); return send({ to: email, ...t, skipDedup: true }); }
async function sendStreakReminder(email, streak, bestStreak) { const t = Templates.streakReminder({ email, streak, bestStreak }); return send({ to: email, ...t }); }
async function sendReferralInvite(toEmail, inviterEmail, referralCode) { const t = Templates.referralInvite({ inviterEmail, referralCode }); return send({ to: toEmail, ...t }); }
async function sendComeback(email, daysSince, bonusXp) { const t = Templates.comeback({ email, daysSince, bonusXp }); return send({ to: email, ...t }); }
async function sendBetaInvite(email, code)          { const t = Templates.betaInvite({ email, code }); return send({ to: email, ...t, skipDedup: true }); }
async function sendWaitlistConfirm(email, position) { const t = Templates.waitlistConfirm({ email, position }); return send({ to: email, ...t, skipDedup: true }); }

module.exports = {
  send,
  sendWelcome,
  sendPasswordReset,
  sendEmailVerification,
  sendStreakReminder,
  sendReferralInvite,
  sendComeback,
  sendBetaInvite,
  sendWaitlistConfirm,
  getStats: () => ({ sent, rateLimit: RATE_LIMIT, windowStart, provider: Provider.PROVIDER }),
};
