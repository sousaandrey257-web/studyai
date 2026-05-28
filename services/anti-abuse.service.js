'use strict';
// Anti-abuse for anonymous users only.
// Keyed by SHA256(fingerprint + IP) for GDPR — no raw PII stored.

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const QUOTA_FILE   = path.join(__dirname, '../data/anonymous-quotas.json');
const MAX_PER_HOUR = 5;
const COOLDOWN_MS  = 24 * 60 * 60 * 1000; // 24h after quota exhausted
const WINDOW_MS    = 60 * 60 * 1000;       // 1h sliding window

// ── Persistence ──────────────────────────────────────────────────────────────

function loadStore() {
  try {
    const raw = fs.readFileSync(QUOTA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveStore(store) {
  try {
    fs.writeFileSync(QUOTA_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.error('[anti-abuse] saveStore error:', err.message);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDeviceId(fingerprint, ip) {
  return crypto.createHash('sha256')
    .update(`${fingerprint}|${ip}`)
    .digest('hex');
}

function pruneOldEntries(store) {
  const now = Date.now();
  let pruned = false;
  for (const [key, rec] of Object.entries(store)) {
    // Remove entries inactive for >48h to keep file lean
    const lastSeen = rec.cooldownUntil || (rec.timestamps?.[rec.timestamps.length - 1] ?? 0);
    if (now - lastSeen > 48 * 60 * 60 * 1000) {
      delete store[key];
      pruned = true;
    }
  }
  return pruned;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * checkQuota(fingerprint, ip)
 * Returns { allowed, remaining, resetAt }
 *   resetAt = Date.now() ms when slot opens (null if allowed and no cooldown)
 */
function checkQuota(fingerprint, ip) {
  const deviceId = makeDeviceId(fingerprint, ip);
  const store    = loadStore();
  const now      = Date.now();

  const rec = store[deviceId] || { timestamps: [], cooldownUntil: null };

  // If under active cooldown
  if (rec.cooldownUntil && now < rec.cooldownUntil) {
    return { allowed: false, remaining: 0, resetAt: rec.cooldownUntil, deviceId };
  }

  // Slide window: keep only timestamps within last 1h
  rec.timestamps = (rec.timestamps || []).filter(ts => now - ts < WINDOW_MS);

  const used      = rec.timestamps.length;
  const remaining = MAX_PER_HOUR - used;

  if (remaining <= 0) {
    // Set 24h cooldown from now
    rec.cooldownUntil = now + COOLDOWN_MS;
    store[deviceId] = rec;
    pruneOldEntries(store);
    saveStore(store);
    return { allowed: false, remaining: 0, resetAt: rec.cooldownUntil, deviceId };
  }

  // Compute when the oldest slot expires (next free slot if at limit)
  const resetAt = used > 0 ? rec.timestamps[0] + WINDOW_MS : null;

  return { allowed: true, remaining, resetAt, deviceId };
}

/**
 * recordGeneration(deviceId)
 * Call after a successful anonymous generation.
 */
function recordGeneration(deviceId) {
  const store = loadStore();
  const now   = Date.now();
  const rec   = store[deviceId] || { timestamps: [], cooldownUntil: null };

  // Slide window
  rec.timestamps = (rec.timestamps || []).filter(ts => now - ts < WINDOW_MS);
  rec.timestamps.push(now);

  // Clear any stale cooldown
  if (rec.cooldownUntil && now >= rec.cooldownUntil) rec.cooldownUntil = null;

  store[deviceId] = rec;
  pruneOldEntries(store);
  saveStore(store);
}

module.exports = { checkQuota, recordGeneration, makeDeviceId };
