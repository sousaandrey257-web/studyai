#!/usr/bin/env node
'use strict';
// ============================================================
//  Restore Script — CLI tool for restoring data from backup
//  Usage:
//    node scripts/restore.js            # list available backups
//    node scripts/restore.js <name>     # restore specific backup
//    node scripts/restore.js --latest   # restore most recent backup
//  Safety:
//    - Validates SHA-256 checksums before overwriting anything
//    - Creates a pre-restore snapshot first
//    - Uses atomic rename (tmp → final) to prevent partial writes
// ============================================================

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const DATA_DIR    = path.join(__dirname, '..', 'data');
const BACKUP_ROOT = path.join(DATA_DIR, 'backups');

function sha256File(filePath) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch { return null; }
}

function listBackups() {
  if (!fs.existsSync(BACKUP_ROOT)) return [];
  return fs.readdirSync(BACKUP_ROOT)
    .filter(d => d.startsWith('backup-'))
    .sort()
    .reverse();
}

function loadManifest(backupDir) {
  const p = path.join(backupDir, 'manifest.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function validateBackup(backupDir, manifest) {
  const results = { ok: true, files: {} };
  for (const [file, meta] of Object.entries(manifest.files || {})) {
    const src      = path.join(backupDir, file);
    const expected = meta.sha256 || meta; // v1 manifest stored hash directly
    const actual   = sha256File(src);

    if (!actual) {
      results.files[file] = 'MISSING';
      results.ok = false;
    } else if (actual !== expected) {
      results.files[file] = `MISMATCH (expected ${expected?.slice(0,8)}, got ${actual?.slice(0,8)})`;
      results.ok = false;
    } else {
      results.files[file] = 'OK';
    }
  }
  return results;
}

function createPreRestoreSnapshot(fileList) {
  const ts     = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
  const preDir = path.join(BACKUP_ROOT, `pre-restore-${ts}`);
  fs.mkdirSync(preDir, { recursive: true });

  const manifest = { ts: new Date().toISOString(), type: 'pre-restore', files: {} };
  for (const file of fileList) {
    const src = path.join(DATA_DIR, file);
    if (!fs.existsSync(src)) continue;
    const dst  = path.join(preDir, file);
    fs.copyFileSync(src, dst);
    manifest.files[file] = sha256File(dst);
  }
  fs.writeFileSync(path.join(preDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return `pre-restore-${ts}`;
}

function restore(backupName) {
  const backupDir = path.join(BACKUP_ROOT, backupName);

  if (!fs.existsSync(backupDir)) {
    console.error(`\n❌  Backup not found: ${backupName}`);
    process.exit(1);
  }

  const manifest = loadManifest(backupDir);
  if (!manifest) {
    console.error(`\n❌  Manifest missing or corrupt — cannot restore ${backupName}`);
    process.exit(1);
  }

  console.log(`\nRestore from: ${backupName}  (ts: ${manifest.ts})`);
  console.log('─'.repeat(55));

  // Step 1: validate checksums
  console.log('Validating checksums...');
  const validation = validateBackup(backupDir, manifest);
  for (const [file, status] of Object.entries(validation.files)) {
    const icon = status === 'OK' ? '✓' : '✗';
    console.log(`  ${icon}  ${file}: ${status}`);
  }

  if (!validation.ok) {
    console.error('\n❌  Checksum validation failed — restore aborted. Backup may be corrupted.');
    process.exit(1);
  }

  // Step 2: pre-restore snapshot
  console.log('\nCreating pre-restore snapshot...');
  const snapshotName = createPreRestoreSnapshot(Object.keys(manifest.files));
  console.log(`  Saved: ${snapshotName}`);

  // Step 3: atomic restore
  console.log('\nRestoring files...');
  for (const file of Object.keys(manifest.files)) {
    const src = path.join(backupDir, file);
    const dst = path.join(DATA_DIR, file);
    if (!fs.existsSync(src)) {
      console.log(`  ⚠   ${file}: not in backup, skipped`);
      continue;
    }
    const tmp = dst + '.restore.tmp';
    fs.copyFileSync(src, tmp);
    fs.renameSync(tmp, dst);
    console.log(`  ✓   ${file}: restored`);
  }

  console.log(`\n✅  Restore complete from ${backupName}`);
  console.log(`    Pre-restore snapshot: ${snapshotName}`);
  console.log('    Restart the server for changes to take effect.\n');
}

// ── CLI entry point ──────────────────────────────────────────
const args = process.argv.slice(2);

if (!args[0]) {
  const backups = listBackups();
  if (!backups.length) {
    console.log('\nNo backups available. Run the server to create the first backup (30s after start).\n');
  } else {
    console.log('\nAvailable backups (most recent first):');
    backups.forEach((b, i) => {
      const manifest = loadManifest(path.join(BACKUP_ROOT, b));
      const ts = manifest?.ts || 'unknown';
      console.log(`  [${i + 1}] ${b}  (${ts})`);
    });
    console.log(`\nUsage: node scripts/restore.js <backup-name>`);
    console.log(`       node scripts/restore.js --latest\n`);
  }
} else if (args[0] === '--latest') {
  const backups = listBackups();
  if (!backups.length) {
    console.error('No backups available.');
    process.exit(1);
  }
  restore(backups[0]);
} else {
  restore(args[0]);
}
