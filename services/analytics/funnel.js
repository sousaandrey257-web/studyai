'use strict';
// ============================================================
//  Funnel Analytics — conversion + retention tracking
//  Zero I/O, zero blocking. Passive listener on GamiService events
//  + explicit track() calls from route handlers.
// ============================================================

const GamiService = require('../gamification.service');

// ── Event definitions ─────────────────────────────────────────
// Funnel A: Content generation → quiz
//   page_land → generate_attempt → generate_success → quiz_start → quiz_complete
// Funnel B: Acquisition → activation
//   page_land → register_start → register_success → first_generate
// Funnel C: Upgrade
//   upgrade_click → checkout_start → upgrade_success
// ─────────────────────────────────────────────────────────────

const _state = {
  events:   {},   // eventName → { total, byDate: { date → count } }
  sessions: new Map(), // sessionId → { start, events: [], userId?, lastSeen }
  funnelA:  { page_land: 0, generate_attempt: 0, generate_success: 0, quiz_start: 0, quiz_complete: 0 },
  funnelB:  { page_land: 0, register_start: 0, register_success: 0, first_generate: 0 },
  funnelC:  { upgrade_click: 0, checkout_start: 0, upgrade_success: 0 },
  dropoffs: {},   // step → count where user dropped
  rageclicks:  0,
  sessionDurations: [], // ms — capped at 1000 samples
  startedAt: Date.now(),
};

const FUNNELS = {
  A: ['page_land', 'generate_attempt', 'generate_success', 'quiz_start', 'quiz_complete'],
  B: ['page_land', 'register_start', 'register_success', 'first_generate'],
  C: ['upgrade_click', 'checkout_start', 'upgrade_success'],
};

function _today() { return new Date().toISOString().split('T')[0]; }

function _record(eventName, meta = {}) {
  if (!_state.events[eventName]) {
    _state.events[eventName] = { total: 0, byDate: {} };
  }
  _state.events[eventName].total++;
  const d = _today();
  _state.events[eventName].byDate[d] = (_state.events[eventName].byDate[d] || 0) + 1;

  // Update funnel counters
  for (const [key, steps] of Object.entries(FUNNELS)) {
    if (steps.includes(eventName)) {
      _state[`funnel${key}`][eventName] = (_state[`funnel${key}`][eventName] || 0) + 1;
    }
  }
}

// ── Passive event listeners ───────────────────────────────────
GamiService.emitter.on('USER_REGISTERED',  ({ userId }) => {
  _record('register_success', { userId });
});
GamiService.emitter.on('QUIZ_COMPLETED',   ({ userId }) => {
  _record('quiz_complete', { userId });
});

// ── Public API ────────────────────────────────────────────────

// Call from route handlers to track explicit funnel steps
function track(eventName, meta = {}) {
  _record(eventName, meta);
}

function recordSessionEnd(durationMs) {
  if (durationMs > 0 && durationMs < 4 * 60 * 60 * 1000) { // cap at 4h
    _state.sessionDurations.push(durationMs);
    if (_state.sessionDurations.length > 1000) _state.sessionDurations.shift();
  }
}

function recordRageClick() {
  _state.rageclicks++;
}

function _conversionRate(a, b) {
  if (!a || !b) return 0;
  return Math.round((b / a) * 100);
}

function _percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx    = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function getSnapshot() {
  const { funnelA, funnelB, funnelC } = _state;

  const sessionDurs = _state.sessionDurations;
  const avgSession  = sessionDurs.length
    ? Math.round(sessionDurs.reduce((s, v) => s + v, 0) / sessionDurs.length / 1000) : 0;

  // Last 7 days for key events
  const last7 = {};
  for (const [name, e] of Object.entries(_state.events)) {
    last7[name] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().split('T')[0];
      last7[name].push({ date: d, count: e.byDate[d] || 0 });
    }
  }

  return {
    uptime: Math.round((Date.now() - _state.startedAt) / 1000),
    totals: Object.fromEntries(Object.entries(_state.events).map(([k, v]) => [k, v.total])),
    funnels: {
      A: {
        label: 'Landing → Quiz Complete',
        steps: funnelA,
        conversions: {
          land_to_generate:  _conversionRate(funnelA.page_land,        funnelA.generate_attempt),
          gen_to_success:    _conversionRate(funnelA.generate_attempt,  funnelA.generate_success),
          success_to_quiz:   _conversionRate(funnelA.generate_success,  funnelA.quiz_start),
          quiz_completion:   _conversionRate(funnelA.quiz_start,        funnelA.quiz_complete),
          overall:           _conversionRate(funnelA.page_land,         funnelA.quiz_complete),
        },
      },
      B: {
        label: 'Landing → First Generate (post-signup)',
        steps: funnelB,
        conversions: {
          land_to_register_start:   _conversionRate(funnelB.page_land,       funnelB.register_start),
          register_start_to_done:   _conversionRate(funnelB.register_start,   funnelB.register_success),
          registered_to_generate:   _conversionRate(funnelB.register_success, funnelB.first_generate),
          overall:                  _conversionRate(funnelB.page_land,        funnelB.first_generate),
        },
      },
      C: {
        label: 'Upgrade Click → Paid',
        steps: funnelC,
        conversions: {
          click_to_checkout: _conversionRate(funnelC.upgrade_click,   funnelC.checkout_start),
          checkout_to_paid:  _conversionRate(funnelC.checkout_start,  funnelC.upgrade_success),
          overall:           _conversionRate(funnelC.upgrade_click,   funnelC.upgrade_success),
        },
      },
    },
    sessions: {
      avgDurationSec: avgSession,
      p50Sec: Math.round(_percentile(sessionDurs, 50) / 1000),
      p95Sec: Math.round(_percentile(sessionDurs, 95) / 1000),
      sampleCount: sessionDurs.length,
    },
    ux: { rageclicks: _state.rageclicks },
    last7DaysEvents: last7,
  };
}

module.exports = { track, recordSessionEnd, recordRageClick, getSnapshot };
