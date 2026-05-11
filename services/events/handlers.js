'use strict';
// ============================================================
//  Event Handlers — StudyAI
//  Side-effect module: require() once in server.js to activate.
//  Registers listeners on GamiService.emitter for:
//    XP_GAINED        → incremental leaderboard update
//    QUIZ_COMPLETED   → analytics + streak anomaly watch
//    STREAK_UPDATED   → milestone logging
//    SHIELD_EARNED    → logging
//    REFERRAL_COMPLETED → logging + future hooks
//    USER_REGISTERED  → onboarding logging
//
//  ⚠️  This file ONLY handles side-effects.
//  Business logic lives in services/*.  Do not move logic here.
// ============================================================

const GamiService        = require('../gamification.service');
const LeaderboardService = require('../leaderboard.service');
const HARedis            = require('../redis/ha.client'); // circuit-breaker + WAL
const Bus                = require('../event-log/bus');   // Kafka-like abstraction layer
const Outbox             = require('../event-log/outbox'); // Outbox pattern — durable publishing

const emitter = GamiService.emitter;

// ── Outbox interceptor — tap all events into the durable outbox ───────────────
// This listener fires AFTER existing handlers (EventEmitter is synchronous FIFO).
// Events are stored durably; background poller publishes them to the Bus.
const INTERCEPTED_EVENTS = ['XP_GAINED', 'QUIZ_COMPLETED', 'STREAK_UPDATED', 'SHIELD_EARNED', 'REFERRAL_COMPLETED', 'USER_REGISTERED'];
INTERCEPTED_EVENTS.forEach(type => {
  emitter.on(type, (data) => {
    Outbox.enqueueSync(type, data?.userId || data?.referrerEmail || null, data);
  });
});

// Start the outbox background poller, feeding processed events into the Bus.
// The Bus appends to the event log and dispatches to Bus subscribers.
Outbox.startPoller(Bus);

// ── XP_GAINED → incremental leaderboard update (local + Redis) ───────────────
// Local: avoids full recompute on every quiz; falls back to full compute after TTL.
// Redis: sync to sorted set if Redis available (async, fire-and-forget).
emitter.on('XP_GAINED', ({ userId, email, weeklyXP, weekKey, level, streak }) => {
  if (!userId || !weekKey || !weeklyXP) return;

  const label = email
    ? email.replace(/^(.{2}).*?(@.*)$/, '$1…$2')
    : '??…??';

  LeaderboardService.updateEntry({
    _userId:  userId,
    label,
    weeklyXP: weeklyXP || 0,
    level:    level     || 1,
    streak:   streak    || 0,
  }, weekKey);

  // Async Redis sync via HA client (circuit-breaker protected, WAL-buffered on failure)
  HARedis.safeSetXP(weekKey, userId, label, weeklyXP || 0, level || 1, streak || 0);
});

// ── QUIZ_COMPLETED → analytics + abuse watch ─────────────────────────────────
emitter.on('QUIZ_COMPLETED', ({ userId, score, total, streak, levelUp, newLevel, newBadgeCount }) => {
  const pct = total > 0 ? Math.round(score / total * 100) : 0;
  // Structured log for future integration with analytics pipeline
  if (process.env.NODE_ENV !== 'test') {
    console.log(`[event:QUIZ_COMPLETED] user=${userId} score=${score}/${total}(${pct}%) streak=${streak} levelUp=${levelUp} level=${newLevel} badges+${newBadgeCount}`);
  }
});

// ── STREAK_UPDATED → milestone watch ─────────────────────────────────────────
emitter.on('STREAK_UPDATED', ({ userId, streak, shieldUsed }) => {
  const milestones = [3, 7, 14, 30, 60, 100];
  if (milestones.includes(streak)) {
    console.log(`[event:STREAK_UPDATED] user=${userId} reached streak=${streak}${shieldUsed ? ' (shield used)' : ''}`);
  }
});

// ── SHIELD_EARNED ─────────────────────────────────────────────────────────────
emitter.on('SHIELD_EARNED', ({ userId, shields }) => {
  if (shields === 3) console.log(`[event:SHIELD_EARNED] user=${userId} maxed shields (${shields})`);
});

// ── REFERRAL_COMPLETED → future: send notification, CRM update ───────────────
emitter.on('REFERRAL_COMPLETED', ({ referrerEmail, newUserEmail, xpBonus }) => {
  console.log(`[event:REFERRAL_COMPLETED] ${referrerEmail} → ${newUserEmail} (+${xpBonus} XP each)`);
  // Future: send "your referral joined!" push notification to referrer
});

// ── USER_REGISTERED → onboarding hook ────────────────────────────────────────
emitter.on('USER_REGISTERED', ({ userId, email, hasReferral }) => {
  console.log(`[event:USER_REGISTERED] user=${userId} email=${email.replace(/^(.{2}).*?(@.*)$/, '$1…$2')} ref=${hasReferral}`);
  // Future: trigger welcome email, onboarding flow
});
