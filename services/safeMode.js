'use strict';
// ============================================================
//  Safe Mode Service
//  - Monitors bot blocks and attack patterns
//  - Activates degraded mode on mass attacks
//  - All existing flows remain functional in degraded mode
//  - Thresholds: 50 bots / 5min OR 100 attacks / 5min → safe mode 30min
// ============================================================

const EventEmitter = require('events');

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

const WINDOW_MS          = 5 * 60 * 1000;  // 5-minute sliding window
const BOT_THRESHOLD      = 50;
const ATTACK_THRESHOLD   = 100;
const SAFE_MODE_DURATION = 30 * 60 * 1000; // 30 minutes

let _active   = false;
let _reason   = null;
let _until    = 0;
let _timer    = null;

// Counters — total lifetime
let _totalBots    = 0;
let _totalAttacks = 0;

// Sliding windows — arrays of timestamps
const _recentBots    = [];
const _recentAttacks = [];

function _prune(arr) {
  const cutoff = Date.now() - WINDOW_MS;
  while (arr.length && arr[0] < cutoff) arr.shift();
}

function _activate(reason) {
  if (_active) return; // already active — don't reset timer
  _active = true;
  _reason = reason;
  _until  = Date.now() + SAFE_MODE_DURATION;

  console.warn(`[safeMode] ⚠  ACTIVATED — reason: ${reason} — duration: 30m`);
  emitter.emit('safeMode:activated', { reason, until: new Date(_until).toISOString() });

  clearTimeout(_timer);
  _timer = setTimeout(_deactivate, SAFE_MODE_DURATION);
}

function _deactivate() {
  _active = false;
  _reason = null;
  _until  = 0;
  console.log('[safeMode] ✓ Deactivated — normal operations resumed');
  emitter.emit('safeMode:deactivated');
}

// ── Public API ───────────────────────────────────────────────

function recordBotBlocked() {
  _totalBots++;
  _recentBots.push(Date.now());
  _prune(_recentBots);
  if (_recentBots.length >= BOT_THRESHOLD) _activate('mass_bot_attack');
}

function recordAttack() {
  _totalAttacks++;
  _recentAttacks.push(Date.now());
  _prune(_recentAttacks);
  if (_recentAttacks.length >= ATTACK_THRESHOLD) _activate('mass_attack');
}

function isActive() {
  // Auto-expire if timer somehow missed
  if (_active && Date.now() > _until) _deactivate();
  return _active;
}

function forceActivate(reason = 'manual_admin') {
  _activate(reason);
}

function forceDeactivate() {
  _deactivate();
}

function getStatus() {
  _prune(_recentBots);
  _prune(_recentAttacks);
  return {
    active:           _active,
    reason:           _reason,
    until:            _until ? new Date(_until).toISOString() : null,
    thresholds:       { bots: BOT_THRESHOLD, attacks: ATTACK_THRESHOLD, windowMin: 5 },
    totalBots:        _totalBots,
    totalAttacks:     _totalAttacks,
    recentBots5min:   _recentBots.length,
    recentAttacks5min:_recentAttacks.length,
  };
}

// Express middleware — tags req._safeMode for downstream handlers.
// Downstream code (quiz, generate, etc.) can check req._safeMode and apply restrictions.
function safeModeMiddleware(req, _res, next) {
  req._safeMode = isActive();
  next();
}

module.exports = {
  recordBotBlocked,
  recordAttack,
  isActive,
  forceActivate,
  forceDeactivate,
  getStatus,
  safeModeMiddleware,
  emitter,
};
