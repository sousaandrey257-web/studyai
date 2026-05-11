'use strict';
// ============================================================
//  Leaderboard Service — StudyAI
//  v2: versioned cache, corruption fallback, incremental updates
//  Persistent disk-backed cache: survives process restart.
//  Atomic writes: no corruption on crash.
//  TTL: 5 minutes (full recompute from users.json after expiry).
//  Incremental: updateEntry() avoids full recompute per quiz.
// ============================================================

const fs   = require('fs');
const path = require('path');

const CACHE_FILE    = path.join(__dirname, '../data/leaderboard_cache.json');
const BACKUP_FILE   = CACHE_FILE + '.bak';
const TTL_MS        = 5 * 60 * 1000; // 5 minutes
const CACHE_VERSION = 2;             // bump when cache shape changes

// In-memory state (restored from disk at load())
let _cache = null; // { _v, week, ts, entries[] }

// ── Atomic write + backup ─────────────────────────────────────────────────────
function _persist() {
  if (!_cache) return;
  const tmp = CACHE_FILE + '.tmp';
  try {
    // Rotate backup before overwrite (used for corruption recovery)
    if (fs.existsSync(CACHE_FILE)) {
      fs.copyFileSync(CACHE_FILE, BACKUP_FILE);
    }
    fs.writeFileSync(tmp, JSON.stringify({ ..._cache, _v: CACHE_VERSION }), 'utf8');
    fs.renameSync(tmp, CACHE_FILE); // atomic rename on same FS
  } catch (e) {
    console.warn('[leaderboard] Cache persist failed:', e.message);
  }
}

// ── Backup recovery ───────────────────────────────────────────────────────────
function _tryRecoverBackup() {
  try {
    const raw = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'));
    if (raw._v === CACHE_VERSION && raw.week && Array.isArray(raw.entries)) {
      _cache = raw;
      console.log(`[leaderboard] Recovered from backup (week ${raw.week})`);
    }
  } catch {
    // No backup or invalid — start fresh, will recompute on next request
  }
}

// ── Startup ───────────────────────────────────────────────────────────────────
function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));

    // Version check: reject incompatible cache shape
    if (raw._v !== CACHE_VERSION) {
      console.warn(`[leaderboard] Cache version mismatch (have ${raw._v}, need ${CACHE_VERSION}) — discarding`);
      _tryRecoverBackup();
      return;
    }

    // Structural validation
    if (!raw.week || !Array.isArray(raw.entries) || typeof raw.ts !== 'number') {
      throw new Error('invalid structure');
    }

    _cache = raw;
    console.log(`[leaderboard] Cache restored v${CACHE_VERSION} (week ${raw.week}, ${raw.entries.length} entries)`);
  } catch (e) {
    console.warn(`[leaderboard] Cache corrupt/missing (${e.message}) — attempting backup recovery`);
    _tryRecoverBackup();
  }
}

// ── Cache access ─────────────────────────────────────────────────────────────
function get(weekKey) {
  if (!_cache)                          return null;
  if (_cache.week !== weekKey)          return null;
  if (Date.now() - _cache.ts > TTL_MS) return null;
  return _cache.entries; // array of { _userId, label, level, weeklyXP, streak }
}

// Full update — used on cache-miss recompute, persists to disk
function update(entries, weekKey) {
  _cache = { _v: CACHE_VERSION, week: weekKey, ts: Date.now(), entries };
  _persist();
}

// Incremental update — updates/inserts one entry without full recompute.
// In-memory only: no disk persist (avoids N persists per quiz session).
// Falls back to full recompute naturally when TTL expires.
function updateEntry(entry, weekKey) {
  if (!_cache || _cache.week !== weekKey) return false;

  const idx = _cache.entries.findIndex(e => e._userId === entry._userId);
  if (idx >= 0) {
    _cache.entries[idx] = { ..._cache.entries[idx], ...entry };
  } else {
    _cache.entries.push(entry); // new user entering top-N
  }

  // Re-sort and trim to top 10
  _cache.entries.sort((a, b) => b.weeklyXP - a.weeklyXP);
  if (_cache.entries.length > 10) _cache.entries = _cache.entries.slice(0, 10);

  // Refresh TTL so stale requests don't trigger a full recompute after every quiz
  _cache.ts = Date.now();
  return true;
}

// Force next get() → null → triggers full recompute
function invalidate() {
  if (_cache) {
    _cache.ts = 0;
    _persist();
  }
}

module.exports = { load, get, update, updateEntry, invalidate };
