'use strict';
// Shadow mode — suspicious users silently receive reduced XP.
// They see normal responses; their multiplier is quietly cut.
// Expires after 24h to allow rehabilitation.

const _shadows = new Map(); // userId → { factor: 0-1, expiresAt, reason }

const DEFAULT_FACTOR  = 0.2;  // 20% XP for shadow-mode users
const SHADOW_DURATION = 24 * 3600 * 1000;

function enableShadow(userId, factor = DEFAULT_FACTOR, reason = 'risk') {
  _shadows.set(userId, {
    factor,
    reason,
    enabledAt:  Date.now(),
    expiresAt:  Date.now() + SHADOW_DURATION,
  });
  console.warn(`[shadowMode] enabled userId=${userId} factor=${factor} reason=${reason}`);
}

function disableShadow(userId) {
  _shadows.delete(userId);
}

function getShadowFactor(userId) {
  const entry = _shadows.get(userId);
  if (!entry) return 1.0;
  if (Date.now() > entry.expiresAt) { _shadows.delete(userId); return 1.0; }
  return entry.factor;
}

// Evaluate whether a user should enter shadow mode based on risk + bot scores.
// Call after computing both scores; does nothing if user already in shadow mode.
function evaluateForShadow(userId, riskScore, botScore = 0) {
  if (_shadows.has(userId)) return; // already in shadow mode
  const combined = (riskScore || 0) + (botScore || 0) * 0.5;
  if (combined >= 80) {
    enableShadow(userId, DEFAULT_FACTOR, `risk=${riskScore},bot=${botScore}`);
  } else if (combined >= 60) {
    enableShadow(userId, 0.5, `watch_risk=${riskScore},bot=${botScore}`);
  }
}

function getStatus(userId) {
  const entry = _shadows.get(userId);
  if (!entry || Date.now() > entry.expiresAt) return null;
  return { ...entry, remainingMs: entry.expiresAt - Date.now() };
}

function listActive() {
  const now = Date.now();
  const result = [];
  for (const [userId, entry] of _shadows) {
    if (now > entry.expiresAt) { _shadows.delete(userId); continue; }
    result.push({ userId, ...entry });
  }
  return result;
}

module.exports = { enableShadow, disableShadow, getShadowFactor, evaluateForShadow, getStatus, listActive };
