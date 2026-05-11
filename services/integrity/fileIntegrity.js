'use strict';
// ============================================================
//  File Integrity Monitor
//  - Computes SHA-256 baseline on startup for critical files
//  - Checks every 30 minutes, logs alerts on changes
//  - Does NOT block the server — monitoring only
// ============================================================

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');

const CRITICAL_FILES = [
  'server.js',
  'middleware/requireSuperAdmin.js',
  'middleware/secretSanitizer.js',
  'middleware/tokenBlacklist.js',
  'security/middleware.js',
];

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

const _baseline = new Map(); // rel path → sha256 hash
let _checkCount  = 0;
let _alertCount  = 0;
let _lastCheckTs = null;

function _sha256(filePath) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch { return null; }
}

function initBaseline() {
  _baseline.clear();
  let ok = 0;
  for (const rel of CRITICAL_FILES) {
    const abs  = path.join(ROOT, rel);
    const hash = _sha256(abs);
    if (hash) {
      _baseline.set(rel, hash);
      ok++;
    } else {
      console.warn(`[integrity] Could not hash ${rel} — file missing?`);
    }
  }
  console.log(`[integrity] Baseline ready (${ok}/${CRITICAL_FILES.length} files)`);
}

function runCheck() {
  _checkCount++;
  _lastCheckTs = new Date().toISOString();
  const alerts = [];

  for (const [rel, expected] of _baseline.entries()) {
    const abs    = path.join(ROOT, rel);
    const actual = _sha256(abs);

    if (actual === null) {
      alerts.push({ file: rel, issue: 'unreadable_or_deleted' });
    } else if (actual !== expected) {
      alerts.push({ file: rel, issue: 'hash_changed', prev: expected.slice(0, 12), curr: actual.slice(0, 12) });
      // Update baseline to avoid repeated alerts for intentional changes
      _baseline.set(rel, actual);
    }
  }

  if (alerts.length > 0) {
    _alertCount += alerts.length;
    for (const a of alerts) {
      console.warn(`[integrity] ALERT: ${a.file} — ${a.issue}`);
    }
  }

  return alerts;
}

function getStatus() {
  return {
    monitoredFiles: CRITICAL_FILES.length,
    baselineReady:  _baseline.size > 0,
    checkCount:     _checkCount,
    alertCount:     _alertCount,
    lastCheckTs:    _lastCheckTs,
    intervalMin:    CHECK_INTERVAL_MS / 60000,
  };
}

function start() {
  initBaseline();
  setInterval(runCheck, CHECK_INTERVAL_MS);
  console.log(`[integrity] File integrity monitoring started (${CHECK_INTERVAL_MS / 60000}m interval)`);
}

module.exports = { start, runCheck, getStatus, initBaseline };
