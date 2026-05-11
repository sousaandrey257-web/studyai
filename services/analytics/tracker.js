'use strict';
// In-memory analytics tracker — passive listener on the global event emitter.
// Zero I/O — never blocks API responses.

const GamiService = require('../gamification.service');

// ── Rolling windows ───────────────────────────────────────────────────────────

const _state = {
  // Day-keyed counters (UTC date string)
  dau:          {},  // date → Set of userIds
  registrations:{},  // date → count
  quizzes:      {},  // date → count

  // All-time aggregates
  totalXP:        0,
  totalQuizzes:   0,
  totalRegisters: 0,

  // XP rate: sliding 5-min window
  _xpWindow:  [],   // [{ ts, amount }]

  // Streak distribution snapshot
  streakBuckets: { '0': 0, '1-2': 0, '3-6': 0, '7-13': 0, '14-29': 0, '30+': 0 },

  startedAt: Date.now(),
};

function _todayKey() {
  return new Date().toISOString().split('T')[0];
}

function _bucketStreak(streak) {
  if (streak === 0) return '0';
  if (streak <= 2)  return '1-2';
  if (streak <= 6)  return '3-6';
  if (streak <= 13) return '7-13';
  if (streak <= 29) return '14-29';
  return '30+';
}

function _pruneXPWindow() {
  const cutoff = Date.now() - 5 * 60 * 1000;
  while (_state._xpWindow.length && _state._xpWindow[0].ts < cutoff) {
    _state._xpWindow.shift();
  }
}

// ── Listeners ─────────────────────────────────────────────────────────────────

GamiService.emitter.on('XP_GAINED', ({ userId, amount, streak }) => {
  const d = _todayKey();
  if (userId) {
    if (!_state.dau[d]) _state.dau[d] = new Set();
    _state.dau[d].add(userId);
  }
  _state.totalXP += (amount || 0);
  _state._xpWindow.push({ ts: Date.now(), amount: amount || 0 });
  // Prune window opportunistically
  if (_state._xpWindow.length > 500) _pruneXPWindow();

  if (streak !== undefined) {
    const b = _bucketStreak(streak);
    _state.streakBuckets[b] = (_state.streakBuckets[b] || 0) + 1;
  }
});

GamiService.emitter.on('QUIZ_COMPLETED', ({ userId }) => {
  const d = _todayKey();
  _state.quizzes[d] = (_state.quizzes[d] || 0) + 1;
  _state.totalQuizzes++;
  if (userId) {
    if (!_state.dau[d]) _state.dau[d] = new Set();
    _state.dau[d].add(userId);
  }
});

GamiService.emitter.on('USER_REGISTERED', ({ userId }) => {
  const d = _todayKey();
  _state.registrations[d] = (_state.registrations[d] || 0) + 1;
  _state.totalRegisters++;
  if (userId) {
    if (!_state.dau[d]) _state.dau[d] = new Set();
    _state.dau[d].add(userId);
  }
});

// ── Public API ────────────────────────────────────────────────────────────────

function getSnapshot() {
  _pruneXPWindow();

  const today   = _todayKey();
  const dauToday = (_state.dau[today] || new Set()).size;

  // WAU = unique users across last 7 days
  const wauSet = new Set();
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() - i * 86400000).toISOString().split('T')[0];
    if (_state.dau[d]) _state.dau[d].forEach(id => wauSet.add(id));
  }

  // XP/min rate over last 5 minutes
  const windowXP = _state._xpWindow.reduce((s, e) => s + e.amount, 0);
  const windowMin = Math.max(1, (_state._xpWindow.length ? Date.now() - _state._xpWindow[0].ts : 300000) / 60000);
  const xpPerMin  = Math.round(windowXP / windowMin);

  // Registrations last 7 days
  const regsLast7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().split('T')[0];
    regsLast7.push({ date: d, count: _state.registrations[d] || 0 });
  }

  return {
    uptime:         Math.round((Date.now() - _state.startedAt) / 1000),
    dau:            dauToday,
    wau:            wauSet.size,
    xpPerMin,
    totalXP:        _state.totalXP,
    totalQuizzes:   _state.totalQuizzes,
    totalRegisters: _state.totalRegisters,
    quizzesToday:   _state.quizzes[today] || 0,
    streakBuckets:  { ..._state.streakBuckets },
    registrationsLast7: regsLast7,
  };
}

module.exports = { getSnapshot };
