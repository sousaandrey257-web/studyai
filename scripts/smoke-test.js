#!/usr/bin/env node
'use strict';
// Automated smoke tests — runs against a live server
// Usage: node scripts/smoke-test.js [base_url]

const http  = require('http');
const https = require('https');
const url   = require('url');

const BASE = process.argv[2] || process.env.APP_URL || 'http://localhost:3000';
const parsed = url.parse(BASE);
const lib  = parsed.protocol === 'https:' ? https : http;

let passed = 0;
let failed = 0;

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'StudyAI-SmokeTest/1.0',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    };
    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: data, json });
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

function pass(name) { console.log(`  ✓  ${name}`); passed++; }
function fail(name, reason) { console.error(`  ✗  ${name} — ${reason}`); failed++; }

async function test(name, fn) {
  try { await fn(); } catch (err) { fail(name, err.message); }
}

async function run() {
  console.log(`\n━━━ StudyAI Smoke Tests — ${BASE} ━━━\n`);

  // ── Static assets ──────────────────────────────────────────
  console.log('Static assets');
  await test('GET /', async () => {
    const r = await request('GET', '/');
    if (r.status !== 200) throw new Error(`Status ${r.status}`);
    if (!r.body.includes('StudyAI')) throw new Error('Missing StudyAI in body');
    pass('GET /');
  });
  await test('GET /dashboard', async () => {
    const r = await request('GET', '/dashboard');
    if (r.status !== 200) throw new Error(`Status ${r.status}`);
    pass('GET /dashboard');
  });
  await test('GET /privacy', async () => {
    const r = await request('GET', '/privacy');
    if (r.status !== 200) throw new Error(`Status ${r.status}`);
    pass('GET /privacy');
  });
  await test('GET /terms', async () => {
    const r = await request('GET', '/terms');
    if (r.status !== 200) throw new Error(`Status ${r.status}`);
    pass('GET /terms');
  });
  await test('GET /reset-password', async () => {
    const r = await request('GET', '/reset-password');
    if (r.status !== 200) throw new Error(`Status ${r.status}`);
    pass('GET /reset-password');
  });
  await test('GET /css/style.css', async () => {
    const r = await request('GET', '/css/style.css');
    if (r.status !== 200) throw new Error(`Status ${r.status}`);
    pass('GET /css/style.css');
  });
  await test('GET /css/premium.css', async () => {
    const r = await request('GET', '/css/premium.css');
    if (r.status !== 200) throw new Error(`Status ${r.status}`);
    pass('GET /css/premium.css');
  });
  await test('GET /js/app.js', async () => {
    const r = await request('GET', '/js/app.js');
    if (r.status !== 200) throw new Error(`Status ${r.status}`);
    pass('GET /js/app.js');
  });
  await test('GET /manifest.json', async () => {
    const r = await request('GET', '/manifest.json');
    if (r.status !== 200) throw new Error(`Status ${r.status}`);
    pass('GET /manifest.json');
  });
  await test('GET /sw.js', async () => {
    const r = await request('GET', '/sw.js');
    if (r.status !== 200) throw new Error(`Status ${r.status}`);
    pass('GET /sw.js');
  });
  await test('GET /sitemap.xml', async () => {
    const r = await request('GET', '/sitemap.xml');
    if (r.status !== 200) throw new Error(`Status ${r.status}`);
    if (!r.body.includes('<urlset')) throw new Error('Missing sitemap content');
    pass('GET /sitemap.xml');
  });
  await test('GET /robots.txt', async () => {
    const r = await request('GET', '/robots.txt');
    if (r.status !== 200) throw new Error(`Status ${r.status}`);
    pass('GET /robots.txt');
  });

  // ── API health ──────────────────────────────────────────────
  console.log('\nAPI health');
  await test('GET /api/health', async () => {
    const r = await request('GET', '/api/health');
    if (r.status !== 200) throw new Error(`Status ${r.status}`);
    if (!r.json || r.json.status !== 'ok') throw new Error('Unexpected health response');
    pass('GET /api/health');
  });
  await test('GET /api/config', async () => {
    const r = await request('GET', '/api/config');
    if (r.status !== 200) throw new Error(`Status ${r.status}`);
    pass('GET /api/config');
  });
  await test('GET /api/country', async () => {
    const r = await request('GET', '/api/country');
    if (r.status !== 200) throw new Error(`Status ${r.status}`);
    pass('GET /api/country');
  });
  await test('GET /api/entitlements (anon)', async () => {
    const r = await request('GET', '/api/entitlements');
    if (r.status !== 200) throw new Error(`Status ${r.status}`);
    pass('GET /api/entitlements (anon)');
  });

  // ── Auth ────────────────────────────────────────────────────
  console.log('\nAuth');
  await test('POST /api/register (missing fields)', async () => {
    const r = await request('POST', '/api/register', {});
    if (r.status !== 400) throw new Error(`Expected 400, got ${r.status}`);
    pass('POST /api/register (missing fields)');
  });
  await test('POST /api/login (wrong creds)', async () => {
    const r = await request('POST', '/api/login', { email: 'noone@example.com', password: 'wrong' });
    if (r.status !== 401) throw new Error(`Expected 401, got ${r.status}`);
    pass('POST /api/login (wrong creds)');
  });
  await test('GET /api/me (no auth)', async () => {
    const r = await request('GET', '/api/me');
    if (r.status !== 401) throw new Error(`Expected 401, got ${r.status}`);
    pass('GET /api/me (no auth)');
  });
  await test('POST /api/auth/forgot-password (missing email)', async () => {
    const r = await request('POST', '/api/auth/forgot-password', {});
    if (r.status !== 400) throw new Error(`Expected 400, got ${r.status}`);
    pass('POST /api/auth/forgot-password (missing email)');
  });
  await test('POST /api/auth/reset-password (invalid token)', async () => {
    const r = await request('POST', '/api/auth/reset-password', { token: 'invalid', password: 'newpass123' });
    if (r.status !== 400 && r.status !== 401) throw new Error(`Expected 400/401, got ${r.status}`);
    pass('POST /api/auth/reset-password (invalid token)');
  });

  // ── Beta ────────────────────────────────────────────────────
  console.log('\nBeta');
  await test('POST /api/beta/waitlist (missing email)', async () => {
    const r = await request('POST', '/api/beta/waitlist', {});
    if (r.status !== 400) throw new Error(`Expected 400, got ${r.status}`);
    pass('POST /api/beta/waitlist (missing email)');
  });
  await test('POST /api/beta/invite/verify (no code)', async () => {
    const r = await request('POST', '/api/beta/invite/verify', {});
    if (r.status !== 400) throw new Error(`Expected 400, got ${r.status}`);
    pass('POST /api/beta/invite/verify (no code)');
  });

  // ── Security headers ─────────────────────────────────────────
  console.log('\nSecurity headers');
  await test('X-Content-Type-Options', async () => {
    const r = await request('GET', '/');
    if (!r.headers['x-content-type-options']) throw new Error('Missing X-Content-Type-Options');
    pass('X-Content-Type-Options');
  });
  await test('X-Frame-Options / CSP frame-ancestors', async () => {
    const r = await request('GET', '/');
    const csp = r.headers['content-security-policy'] || '';
    const xfo = r.headers['x-frame-options'] || '';
    if (!csp.includes('frame-ancestors') && !xfo) throw new Error('No framing protection');
    pass('X-Frame-Options / CSP frame-ancestors');
  });

  // ── Admin (unauthorized) ─────────────────────────────────────
  console.log('\nAdmin protection');
  await test('GET /api/admin/users (no auth → 401)', async () => {
    const r = await request('GET', '/api/admin/users');
    if (r.status !== 401 && r.status !== 403) throw new Error(`Expected 401/403, got ${r.status}`);
    pass('GET /api/admin/users (no auth)');
  });
  await test('GET /api/admin/health/full (no auth → 401)', async () => {
    const r = await request('GET', '/api/admin/health/full');
    if (r.status !== 401 && r.status !== 403) throw new Error(`Expected 401/403, got ${r.status}`);
    pass('GET /api/admin/health/full (no auth)');
  });

  // ── Auto Study Engine ─────────────────────────────────────────
  console.log('\nAuto Study Engine');
  await test('GET /app (unified workspace) serves HTML', async () => {
    const r = await request('GET', '/app');
    if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
    if (!r.body.includes('panel-home')) throw new Error('Workspace missing panel-home');
    pass('GET /app');
  });
  await test('GET /upload page serves HTML', async () => {
    const r = await request('GET', '/upload');
    if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
    if (!r.body.includes('upload')) throw new Error('Upload page missing expected content');
    pass('GET /upload');
  });
  await test('GET /battle page serves HTML', async () => {
    const r = await request('GET', '/battle');
    if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
    pass('GET /battle');
  });
  await test('GET /brain page serves HTML', async () => {
    const r = await request('GET', '/brain');
    if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
    pass('GET /brain');
  });
  await test('POST /api/ai/analyze (no content → 400)', async () => {
    const r = await request('POST', '/api/ai/analyze', {});
    if (r.status !== 400) throw new Error(`Expected 400, got ${r.status}`);
    pass('POST /api/ai/analyze (no content)');
  });
  await test('POST /api/ai/analyze (invalid mode → 400)', async () => {
    const r = await request('POST', '/api/ai/analyze', { text: 'hello', mode: 'badmode' });
    if (r.status !== 400) throw new Error(`Expected 400, got ${r.status}`);
    pass('POST /api/ai/analyze (invalid mode)');
  });
  await test('POST /api/ai/analyze (valid → 200 with jobId)', async () => {
    const r = await request('POST', '/api/ai/analyze', { text: 'La photosynthèse est le processus par lequel les plantes produisent leur nourriture.', mode: 'standard' });
    if (![200, 429].includes(r.status)) throw new Error(`Expected 200 or 429, got ${r.status}`);
    if (r.status === 200 && !r.json?.jobId) throw new Error('Missing jobId in response');
    pass(`POST /api/ai/analyze → ${r.status}`);
  });
  await test('GET /api/ai/job/nonexistent → 404', async () => {
    const r = await request('GET', '/api/ai/job/nonexistent-id-xyz');
    if (r.status !== 404) throw new Error(`Expected 404, got ${r.status}`);
    pass('GET /api/ai/job/nonexistent');
  });
  await test('GET /api/ai/stats → 200', async () => {
    const r = await request('GET', '/api/ai/stats');
    if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
    pass('GET /api/ai/stats');
  });
  await test('POST /api/ai/deepen (no concept → 400)', async () => {
    const r = await request('POST', '/api/ai/deepen', {});
    if (r.status !== 400) throw new Error(`Expected 400, got ${r.status}`);
    pass('POST /api/ai/deepen (no concept)');
  });
  await test('GET /api/ai/memory/due (no auth → 401)', async () => {
    const r = await request('GET', '/api/ai/memory/due');
    if (r.status !== 401) throw new Error(`Expected 401, got ${r.status}`);
    pass('GET /api/ai/memory/due (no auth)');
  });
  await test('GET /api/ai/brain (no auth → 401)', async () => {
    const r = await request('GET', '/api/ai/brain');
    if (r.status !== 401) throw new Error(`Expected 401, got ${r.status}`);
    pass('GET /api/ai/brain (no auth)');
  });
  await test('POST /api/ai/battle (no auth → 401)', async () => {
    const r = await request('POST', '/api/ai/battle', { jobId: 'fake' });
    if (r.status !== 401) throw new Error(`Expected 401, got ${r.status}`);
    pass('POST /api/ai/battle (no auth)');
  });

  // ── Rate limiting ─────────────────────────────────────────────
  console.log('\nRate limiting');
  await test('/api/generate returns 200 or 429 (anon)', async () => {
    const r = await request('POST', '/api/generate', { text: 'test' });
    if (![200, 400, 429, 402].includes(r.status)) throw new Error(`Unexpected status ${r.status}`);
    pass('/api/generate reachable');
  });

  // ── Summary ───────────────────────────────────────────────────
  const total = passed + failed;
  console.log(`\n━━━ Results: ${passed}/${total} passed`);
  if (failed > 0) {
    console.error(`    ${failed} test(s) FAILED`);
    process.exit(1);
  } else {
    console.log('    All tests passed ✓');
    process.exit(0);
  }
}

run().catch(err => { console.error('Smoke test crashed:', err.message); process.exit(1); });
