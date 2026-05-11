'use strict';
// Event Replay Engine — rebuild derived state from event log.
//
// Supports:
//   replayLeaderboard(weekStr)  → aggregate weeklyXP from XP_GAINED events
//   replayUserXP(userId)        → XP time-series for a user
//   replayUserStreak(userId)    → streak history from STREAK_UPDATED events
//   replayReferralGraph()       → referral chain from REFERRAL_COMPLETED events
//
// All functions read from eventLog — never from users.json.
// Use for: debugging, auditing, leaderboard rebuild after corruption.

const EventLog  = require('./eventLog');
const GamiService = require('../gamification.service');

// ── Leaderboard rebuild from XP_GAINED events ─────────────────────────────────

async function replayLeaderboard(weekStr, options = {}) {
  const { fromTs = 0, count = 50_000 } = options;
  const events = await EventLog.replayEvents(fromTs, count);

  const xpMap  = new Map(); // userId → { weeklyXP, level, streak, label }

  for (const ev of events) {
    if (ev.type !== 'XP_GAINED') continue;
    const p = ev.payload;

    if (p.weekKey !== weekStr) continue;
    if (!p.userId) continue;

    const existing = xpMap.get(p.userId) || { weeklyXP: 0, level: 1, streak: 0, label: p.email || '' };
    // weeklyXP in the payload is cumulative — take the latest value
    xpMap.set(p.userId, {
      weeklyXP: p.weeklyXP || existing.weeklyXP,
      level:    p.level    || existing.level,
      streak:   p.streak   || existing.streak,
      label:    p.email ? p.email.replace(/^(.{2}).*?(@.*)$/, '$1…$2') : existing.label,
    });
  }

  const entries = [...xpMap.entries()]
    .map(([userId, v]) => ({ _userId: userId, ...v }))
    .sort((a, b) => b.weeklyXP - a.weeklyXP)
    .slice(0, options.topN || 10);

  return { week: weekStr, entries, eventCount: events.length, replayedAt: new Date().toISOString() };
}

// ── XP time-series for a user ─────────────────────────────────────────────────

async function replayUserXP(userId, options = {}) {
  const { fromTs = 0, count = 1_000 } = options;
  const events = await EventLog.getUserEventStream(userId, fromTs, count);

  const timeline = events
    .filter(ev => ev.type === 'XP_GAINED')
    .map(ev => ({
      ts:       ev.ts,
      amount:   ev.payload.amount   || 0,
      totalXP:  ev.payload.totalXP  || 0,
      level:    ev.payload.level    || 1,
      source:   ev.payload.source   || 'unknown',
    }));

  const totalGained = timeline.reduce((s, e) => s + e.amount, 0);
  return { userId, totalGained, dataPoints: timeline.length, timeline };
}

// ── Streak history ────────────────────────────────────────────────────────────

async function replayUserStreak(userId, options = {}) {
  const { fromTs = 0, count = 500 } = options;
  const events = await EventLog.getUserEventStream(userId, fromTs, count);

  const history = events
    .filter(ev => ev.type === 'STREAK_UPDATED')
    .map(ev => ({
      ts:          ev.ts,
      streak:      ev.payload.streak      || 0,
      shieldUsed:  ev.payload.shieldUsed  || false,
    }));

  const maxStreak = history.reduce((m, e) => Math.max(m, e.streak), 0);
  return { userId, maxStreak, dataPoints: history.length, history };
}

// ── Referral graph from event log ─────────────────────────────────────────────

async function replayReferralGraph(options = {}) {
  const { fromTs = 0, count = 50_000 } = options;
  const events = await EventLog.replayEvents(fromTs, count);

  const graph   = [];
  const refMap  = new Map(); // referrerEmail → [newUserEmail]

  for (const ev of events) {
    if (ev.type !== 'REFERRAL_COMPLETED') continue;
    const { referrerEmail, newUserEmail, xpBonus, chainLevels } = ev.payload;
    if (!referrerEmail || !newUserEmail) continue;

    graph.push({ ts: ev.ts, referrer: referrerEmail, newUser: newUserEmail, xpBonus, chainLevels });
    if (!refMap.has(referrerEmail)) refMap.set(referrerEmail, []);
    refMap.get(referrerEmail).push(newUserEmail);
  }

  const topReferrers = [...refMap.entries()]
    .map(([email, users]) => ({ email, count: users.length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return { totalReferrals: graph.length, topReferrers, graph };
}

// ── Full user profile rebuild ─────────────────────────────────────────────────
// Reconstructs what a user's gamification state should be, purely from events.
// Useful for detecting discrepancies with stored state.

async function replayUserProfile(userId) {
  const [xp, streak, events] = await Promise.all([
    replayUserXP(userId,     { count: 10_000 }),
    replayUserStreak(userId, { count: 10_000 }),
    EventLog.getUserEventStream(userId, 0, 10_000),
  ]);

  const quizEvents = events.filter(e => e.type === 'QUIZ_COMPLETED');
  const totalQuizzes   = quizEvents.length;
  const perfectQuizzes = quizEvents.filter(e => e.payload.score === e.payload.total).length;

  // Derive level from total XP
  const totalXP  = xp.totalGained;
  const level    = GamiService.getLevel(totalXP);

  return {
    userId,
    derivedFrom: 'event-log',
    totalXP, level, totalQuizzes, perfectQuizzes,
    maxStreak:   streak.maxStreak,
    replayedAt:  new Date().toISOString(),
  };
}

module.exports = { replayLeaderboard, replayUserXP, replayUserStreak, replayReferralGraph, replayUserProfile };
