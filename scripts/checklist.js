#!/usr/bin/env node
'use strict';
// Beta launch checklist — verifies environment and configuration
// Usage: node scripts/checklist.js

const fs   = require('fs');
const path = require('path');

require('dotenv').config();

let ok = 0;
let warn = 0;
let fail = 0;

function check(label, condition, severity = 'fail', hint = '') {
  if (condition) {
    console.log(`  ✓  ${label}`);
    ok++;
  } else if (severity === 'warn') {
    console.warn(`  ⚠  ${label}${hint ? ' — ' + hint : ''}`);
    warn++;
  } else {
    console.error(`  ✗  ${label}${hint ? ' — ' + hint : ''}`);
    fail++;
  }
}

function fileExists(p) {
  return fs.existsSync(path.join(__dirname, '..', p));
}

function envSet(key) {
  const v = process.env[key];
  return !!(v && v.trim());
}

console.log('\n━━━ StudyAI — Beta Launch Checklist ━━━\n');

// ── Environment ──────────────────────────────────────────────
console.log('Environment');
check('NODE_ENV is production',    process.env.NODE_ENV === 'production', 'warn', 'Set NODE_ENV=production');
check('JWT_SECRET set',            envSet('JWT_SECRET'), 'fail', 'Required for auth security');
check('JWT_SECRET length >= 32',   (process.env.JWT_SECRET || '').length >= 32, 'fail', 'Use a long random secret');
check('SUPER_ADMIN_EMAIL set',     envSet('SUPER_ADMIN_EMAIL'), 'warn', 'Admin routes won\'t be accessible');
check('ADMIN_KEY set',             envSet('ADMIN_KEY'), 'warn', 'Legacy admin auth disabled');
check('PORT set',                  envSet('PORT'), 'warn', 'Will default to 3000');
check('APP_URL set',               envSet('APP_URL'), 'warn', 'Email links will use localhost');
check('FROM_EMAIL set',            envSet('FROM_EMAIL'), 'warn', 'Email from address not configured');

// ── AI Provider ───────────────────────────────────────────────
console.log('\nAI Provider');
const hasGroq   = envSet('GROQ_API_KEY');
const hasOpenAI = envSet('OPENAI_API_KEY');
check('AI provider configured (Groq or OpenAI)', hasGroq || hasOpenAI, 'fail', 'Service won\'t generate content');
check('Using Groq (free tier)', hasGroq, 'warn', 'Consider Groq for cost savings');

// ── Email ─────────────────────────────────────────────────────
console.log('\nEmail');
const hasResend   = envSet('RESEND_API_KEY');
const hasSendgrid = envSet('SENDGRID_API_KEY');
const hasPostmark = envSet('POSTMARK_API_KEY');
check('Email provider configured', hasResend || hasSendgrid || hasPostmark, 'warn',
  'Password reset & notifications will only log to console');
if (hasResend)   console.log('    → Using Resend');
if (hasSendgrid) console.log('    → Using Sendgrid');
if (hasPostmark) console.log('    → Using Postmark');

// ── Stripe ────────────────────────────────────────────────────
console.log('\nStripe');
check('STRIPE_SECRET_KEY set',    envSet('STRIPE_SECRET_KEY'), 'warn', 'Payments disabled');
check('STRIPE_WEBHOOK_SECRET set', envSet('STRIPE_WEBHOOK_SECRET'), 'warn', 'Webhook verification disabled');
check('No test keys in production', process.env.NODE_ENV !== 'production' || !(process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_'), 'warn', 'Using Stripe test key in production');

// ── Files & Structure ─────────────────────────────────────────
console.log('\nFiles & Structure');
check('public/index.html exists',       fileExists('public/index.html'));
check('public/dashboard.html exists',   fileExists('public/dashboard.html'));
check('public/privacy.html exists',     fileExists('public/privacy.html'));
check('public/terms.html exists',       fileExists('public/terms.html'));
check('public/reset-password.html exists', fileExists('public/reset-password.html'));
check('public/manifest.json exists',    fileExists('public/manifest.json'));
check('public/sw.js exists',            fileExists('public/sw.js'));
check('public/robots.txt exists',       fileExists('public/robots.txt'));
check('public/css/style.css exists',    fileExists('public/css/style.css'));
check('public/css/premium.css exists',  fileExists('public/css/premium.css'));
check('data/ directory exists',         fileExists('data'));
check('server.js exists',              fileExists('server.js'));

// ── Security ──────────────────────────────────────────────────
console.log('\nSecurity');
check('BCRYPT_ROUNDS not too low', parseInt(process.env.BCRYPT_ROUNDS || '12') >= 10, 'warn', 'Use at least 10 rounds');
check('Not using default JWT secret',  (process.env.JWT_SECRET || 'dev') !== 'dev', 'fail', 'Change from default "dev" secret');
check('SUPER_ADMIN_EMAIL is specific', !['admin@example.com', 'test@test.com'].includes(process.env.SUPER_ADMIN_EMAIL || ''), 'warn');

// ── PWA ───────────────────────────────────────────────────────
console.log('\nPWA');
const manifest = fileExists('public/manifest.json') ? (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '../public/manifest.json'), 'utf8')); } catch { return null; } })() : null;
check('manifest.json valid JSON', manifest !== null);
check('manifest.json has icons', manifest && Array.isArray(manifest.icons) && manifest.icons.length > 0, 'warn');
check('manifest.json has name', manifest && manifest.name, 'warn');
check('Service worker exists', fileExists('public/sw.js'));

// ── Backup ────────────────────────────────────────────────────
console.log('\nBackup');
const backupDir = path.join(__dirname, '../data/backups');
const hasBackups = fs.existsSync(backupDir) && fs.readdirSync(backupDir).length > 0;
check('At least one backup exists', hasBackups, 'warn', 'Run: npm run backup');
check('data/users.json exists', fileExists('data/users.json'), 'warn', 'Created on first register');

// ── SEO ───────────────────────────────────────────────────────
console.log('\nSEO');
const indexHtml = fileExists('public/index.html') ? fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8') : '';
check('index.html has OG tags',    indexHtml.includes('og:title'), 'warn');
check('index.html has description', indexHtml.includes('meta name="description"'), 'warn');
check('sitemap accessible (route present in server.js)', fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8').includes('/sitemap.xml'));

// ── Summary ───────────────────────────────────────────────────
const total = ok + warn + fail;
console.log(`\n━━━ Results: ${ok}/${total} checks passed`);
if (warn > 0)  console.warn(`    ${warn} warning(s) — review before launch`);
if (fail > 0)  { console.error(`    ${fail} critical issue(s) — MUST fix before launch`); process.exit(1); }
else if (warn > 0) { console.log('    Launch possible but warnings should be addressed'); process.exit(0); }
else { console.log('\n  🚀 All checks passed — ready for launch!'); process.exit(0); }
