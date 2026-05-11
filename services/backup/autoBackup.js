'use strict';
// ============================================================
//  Auto-Backup Service
//  - Snapshots data/ every 6h
//  - Keeps 20 backups max (FIFO rotation)
//  - SHA-256 checksum manifest per backup
//  - Never blocks server startup; first run is deferred 30s
// ============================================================

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const DATA_DIR    = path.join(__dirname, '..', '..', 'data');
const BACKUP_ROOT = path.join(DATA_DIR, 'backups');
const MAX_BACKUPS = 20;
const INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

const FILES_TO_BACKUP = [
  'users.json',
  'content.json',
  'premiums.json',
  'leaderboard_cache.json',
  'admin_audit.log',
];

let _lastBackupTs  = null;
let _lastBackupDir = null;
let _backupCount   = 0;
let _errorCount    = 0;

function _ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function _sha256File(filePath) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch { return null; }
}

function _safeCopy(src, dst) {
  const tmp = dst + '.tmp';
  fs.copyFileSync(src, tmp);
  fs.renameSync(tmp, dst);
}

function runBackup() {
  try {
    _ensureDir(BACKUP_ROOT);

    const ts        = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
    const backupDir = path.join(BACKUP_ROOT, `backup-${ts}`);
    fs.mkdirSync(backupDir);

    const manifest = {
      ts:        new Date().toISOString(),
      version:   2,
      files:     {},
      totalSize: 0,
    };

    for (const file of FILES_TO_BACKUP) {
      const src = path.join(DATA_DIR, file);
      if (!fs.existsSync(src)) continue;

      const dst = path.join(backupDir, file);
      _safeCopy(src, dst);

      const hash = _sha256File(dst);
      const size = fs.statSync(dst).size;
      manifest.files[file] = { sha256: hash, size };
      manifest.totalSize  += size;
    }

    // Write manifest with atomic rename
    const manifestPath = path.join(backupDir, 'manifest.json');
    const tmp          = manifestPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), 'utf8');
    fs.renameSync(tmp, manifestPath);

    _lastBackupTs  = manifest.ts;
    _lastBackupDir = backupDir;
    _backupCount++;

    // Rotation — delete oldest backups beyond MAX_BACKUPS
    _rotate();

    const totalKB = Math.round(manifest.totalSize / 1024);
    console.log(`[backup] Snapshot saved: backup-${ts} (${Object.keys(manifest.files).length} files, ${totalKB}KB)`);
    return { ok: true, ts: manifest.ts, dir: backupDir };
  } catch (err) {
    _errorCount++;
    console.error('[backup] Snapshot failed:', err.message);
    return { ok: false, error: err.message };
  }
}

function _rotate() {
  try {
    const entries = fs.readdirSync(BACKUP_ROOT)
      .filter(d => d.startsWith('backup-'))
      .sort(); // ascending — oldest first

    while (entries.length > MAX_BACKUPS) {
      const oldest = entries.shift();
      const oldDir = path.join(BACKUP_ROOT, oldest);
      fs.rmSync(oldDir, { recursive: true, force: true });
      console.log(`[backup] Rotated out old backup: ${oldest}`);
    }
  } catch (err) {
    console.error('[backup] Rotation error:', err.message);
  }
}

function listBackups() {
  try {
    _ensureDir(BACKUP_ROOT);
    return fs.readdirSync(BACKUP_ROOT)
      .filter(d => d.startsWith('backup-'))
      .sort()
      .reverse()
      .map(name => {
        const manifestPath = path.join(BACKUP_ROOT, name, 'manifest.json');
        let manifest = null;
        try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch {}
        return {
          name,
          ts:        manifest?.ts || null,
          fileCount: Object.keys(manifest?.files || {}).length,
          totalSize: manifest?.totalSize || 0,
        };
      });
  } catch { return []; }
}

function getStatus() {
  return {
    enabled:       true,
    intervalHours: 6,
    maxBackups:    MAX_BACKUPS,
    backupCount:   _backupCount,
    errorCount:    _errorCount,
    lastBackupTs:  _lastBackupTs,
    available:     listBackups().length,
  };
}

function start() {
  // Deferred first backup — let server fully initialize
  setTimeout(runBackup, 30_000);
  setInterval(runBackup, INTERVAL_MS);
  console.log('[backup] Auto-backup enabled (6h interval, max 20 snapshots)');
}

module.exports = { start, runBackup, listBackups, getStatus, BACKUP_ROOT, FILES_TO_BACKUP };
