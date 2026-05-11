'use strict';
// ============================================================
//  Retention Service
//  - Tracks last activity per user (in-memory, from events)
//  - Detects inactive users (7+ days without activity)
//  - Calculates streak recovery windows
//  - Comeback XP boosts for returning users
//  - Admin analytics endpoint data provider
// ============================================================

const GamiService = require('./gamification.service');
const path        = require('path');
const fs          = require('fs');

const INACTIVE_THRESHOLD_DAYS = 7;
const COMEBACK_XP_BONUS       = 50;

// In-memory: userId → { lastSeen (ISO), sessionCount, totalEvents }
const _activity = new Map();

// ── Event listeners (passive, no I/O blocking) ────────────────
function _touch(userId) {
  if (!userId) return;
  const rec = _activity.get(userId) || { lastSeen: null, sessionCount: 0, totalEvents: 0, firstSeen: new Date().toISOString() };
  rec.lastSeen   = new Date().toISOString();
  rec.totalEvents++;
  _activity.set(userId, rec);
}

GamiService.emitter.on('XP_GAINED',       ({ userId }) => _touch(userId));
GamiService.emitter.on('QUIZ_COMPLETED',  ({ userId }) => _touch(userId));
GamiService.emitter.on('USER_REGISTERED', ({ userId }) => {
  _touch(userId);
  const rec = _activity.get(userId);
  if (rec) { rec.sessionCount = 1; rec.firstSeen = new Date().toISOString(); }
});

// ── Public API ────────────────────────────────────────────────

// Called by auth/generate routes to track new sessions
function recordActivity(userId) {
  _touch(userId);
}

function recordNewSession(userId) {
  _touch(userId);
  const rec = _activity.get(userId);
  if (rec) rec.sessionCount = (rec.sessionCount || 0) + 1;
}

// Returns true if the user was inactive for INACTIVE_THRESHOLD_DAYS and just came back
function isComebackUser(userId) {
  const rec = _activity.get(userId);
  if (!rec?.lastSeen) return false;
  const daysSince = (Date.now() - new Date(rec.lastSeen).getTime()) / 86400000;
  return daysSince >= INACTIVE_THRESHOLD_DAYS;
}

// XP bonus amount for comeback users
function getComebackBonus() {
  return COMEBACK_XP_BONUS;
}

// Days since a user was last active (-1 if never seen)
function daysSinceActive(userId) {
  const rec = _activity.get(userId);
  if (!rec?.lastSeen) return -1;
  return Math.floor((Date.now() - new Date(rec.lastSeen).getTime()) / 86400000);
}

// Returns retention analytics snapshot for admin dashboard
function getRetentionSnapshot() {
  const now   = Date.now();
  const users = [..._activity.entries()];

  // Bucket users by inactivity
  const buckets = { active1d: 0, active7d: 0, active30d: 0, inactive30d: 0, never: 0 };
  for (const [, rec] of users) {
    if (!rec.lastSeen) { buckets.never++; continue; }
    const days = (now - new Date(rec.lastSeen).getTime()) / 86400000;
    if      (days <= 1)   buckets.active1d++;
    else if (days <= 7)   buckets.active7d++;
    else if (days <= 30)  buckets.active30d++;
    else                  buckets.inactive30d++;
  }

  // Average session count for returning users
  const withSessions = users.filter(([, r]) => (r.sessionCount || 0) > 1);
  const avgSessions  = withSessions.length
    ? Math.round(withSessions.reduce((s, [, r]) => s + r.sessionCount, 0) / withSessions.length)
    : 0;

  return {
    totalTracked:    _activity.size,
    buckets,
    avgSessionsReturnUsers: avgSessions,
    inactiveThresholdDays:  INACTIVE_THRESHOLD_DAYS,
    comebackBonus:          COMEBACK_XP_BONUS,
  };
}

module.exports = {
  recordActivity,
  recordNewSession,
  isComebackUser,
  getComebackBonus,
  daysSinceActive,
  getRetentionSnapshot,
};
