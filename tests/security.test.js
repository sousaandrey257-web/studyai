#!/usr/bin/env node
'use strict';
// ============================================================
//  Security Validation Tests — StudyAI
//  Run: node tests/security.test.js
//  No external dependencies — uses built-in http + assert.
// ============================================================

require('dotenv').config();
const http    = require('http');
const https   = require('https');
const assert  = require('assert');
const jwt     = require('jsonwebtoken');

const HOST    = process.env.TEST_HOST || 'localhost';
const PORT    = process.env.PORT      || 3000;
const PROTO   = HOST === 'localhost'  ? http : https;

const JWT_SECRET       = process.env.JWT_SECRET       || 'dev';
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || '';
const ADMIN_KEY        = process.env.ADMIN_KEY         || '';

let passed = 0;
let failed = 0;

// ── Helpers ──────────────────────────────────────────────────

function request(opts, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: HOST,
      port:     PORT,
      method:   opts.method || 'GET',
      path:     opts.path,
      headers:  { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    };
    const req = PROTO.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: json, raw: data });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function makeAdminJWT(email, options = {}) {
  return jwt.sign(
    { userId: 'test-admin', email },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '1h', ...options }
  );
}

function makeOldAdminJWT(email) {
  // Simulate a token issued 13h ago (should be rejected — beyond 12h admin session)
  const iat = Math.floor(Date.now() / 1000) - 13 * 3600;
  return jwt.sign({ userId: 'test-admin', email, iat }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '30d' });
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}`);
    console.error(`       ${err.message}`);
    failed++;
  }
}

// ── Test Suites ───────────────────────────────────────────────

async function testPublicRoutes() {
  console.log('\n[1] Public routes — must return 200');

  await test('GET /api/health returns 200', async () => {
    const r = await request({ path: '/api/health' });
    assert.strictEqual(r.status, 200);
  });

  await test('GET /api/config returns 200', async () => {
    const r = await request({ path: '/api/config' });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body, 'body must exist');
  });

  await test('GET / serves HTML', async () => {
    const r = await request({ path: '/' });
    assert.strictEqual(r.status, 200);
  });
}

async function testAdminRouteProtection() {
  console.log('\n[2] Admin routes — must require auth');

  const adminRoutes = [
    { method: 'GET',    path: '/api/admin/abuse-log' },
    { method: 'GET',    path: '/api/admin/analytics/realtime' },
    { method: 'GET',    path: '/api/admin/shadow-mode' },
    { method: 'GET',    path: '/api/admin/dlq' },
    { method: 'GET',    path: '/api/admin/health/full' },
    { method: 'GET',    path: '/api/admin/event-log' },
    { method: 'GET',    path: '/api/admin/outbox' },
    { method: 'GET',    path: '/api/admin/event-bus' },
    { method: 'GET',    path: '/api/admin/security-status' },
    { method: 'GET',    path: '/api/admin/backup' },
    { method: 'GET',    path: '/api/admin/safe-mode' },
    { method: 'GET',    path: '/api/admin/integrity' },
  ];

  for (const route of adminRoutes) {
    await test(`${route.method} ${route.path} — no auth → 403`, async () => {
      const r = await request({ method: route.method, path: route.path });
      assert.strictEqual(r.status, 403, `Expected 403, got ${r.status}`);
      assert.ok(r.body?.error, 'Must return error field');
    });
  }
}

async function testPrivilegeEscalation() {
  console.log('\n[3] Privilege escalation — must be blocked');

  await test('Normal user JWT cannot access admin routes', async () => {
    const token = makeAdminJWT('hacker@evil.com');
    const r = await request({
      method:  'GET',
      path:    '/api/admin/abuse-log',
      headers: { 'x-auth-token': token },
    });
    assert.strictEqual(r.status, 403);
  });

  await test('Wrong admin key → 403', async () => {
    const r = await request({
      method:  'GET',
      path:    '/api/admin/abuse-log',
      headers: { 'x-admin-key': 'wrongkey12345' },
    });
    assert.strictEqual(r.status, 403);
  });

  await test('Injecting admin=true in body → 403', async () => {
    const r = await request(
      { method: 'POST', path: '/api/admin/backup' },
      { admin: true, role: 'admin', isAdmin: true }
    );
    assert.strictEqual(r.status, 403);
  });

  if (SUPER_ADMIN_EMAIL) {
    await test('Expired admin session (13h old) → 403', async () => {
      const token = makeOldAdminJWT(SUPER_ADMIN_EMAIL);
      const r = await request({
        method:  'GET',
        path:    '/api/admin/abuse-log',
        headers: { 'x-auth-token': token },
      });
      assert.strictEqual(r.status, 403, 'Old admin token must be rejected');
    });
  }

  await test('Algorithm confusion (none) → 403', async () => {
    // Manually craft a token with alg=none
    const header  = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      userId: 'evil',
      email:  SUPER_ADMIN_EMAIL || 'admin@admin.com',
      iat:    Math.floor(Date.now() / 1000),
      exp:    Math.floor(Date.now() / 1000) + 3600,
    })).toString('base64url');
    const noneToken = `${header}.${payload}.`;

    const r = await request({
      method:  'GET',
      path:    '/api/admin/abuse-log',
      headers: { 'x-auth-token': noneToken },
    });
    assert.strictEqual(r.status, 403, 'none-algorithm token must be rejected');
  });
}

async function testSuperAdminAccess() {
  if (!SUPER_ADMIN_EMAIL || !JWT_SECRET || JWT_SECRET === 'dev') {
    console.log('\n[4] Super admin access — SKIPPED (SUPER_ADMIN_EMAIL or JWT_SECRET not set)');
    return;
  }
  console.log('\n[4] Super admin JWT access — must return 200');

  const token = makeAdminJWT(SUPER_ADMIN_EMAIL);

  await test('Super admin JWT → /api/admin/abuse-log returns 200', async () => {
    const r = await request({
      method:  'GET',
      path:    '/api/admin/abuse-log',
      headers: { 'x-auth-token': token },
    });
    assert.strictEqual(r.status, 200);
  });

  await test('Super admin JWT → /api/admin/security-status returns 200', async () => {
    const r = await request({
      method:  'GET',
      path:    '/api/admin/security-status',
      headers: { 'x-auth-token': token },
    });
    assert.strictEqual(r.status, 200);
    assert.ok(typeof r.body?.score === 'number', 'Must have numeric score');
  });

  await test('Super admin JWT → /api/admin/backup returns 200', async () => {
    const r = await request({
      method:  'GET',
      path:    '/api/admin/backup',
      headers: { 'x-auth-token': token },
    });
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body?.backups), 'Must return backups array');
  });

  await test('Super admin JWT → /api/admin/safe-mode returns 200', async () => {
    const r = await request({
      method:  'GET',
      path:    '/api/admin/safe-mode',
      headers: { 'x-auth-token': token },
    });
    assert.strictEqual(r.status, 200);
    assert.ok(typeof r.body?.active === 'boolean', 'Must have active boolean');
  });

  await test('Super admin JWT → /api/admin/integrity returns 200', async () => {
    const r = await request({
      method:  'GET',
      path:    '/api/admin/integrity',
      headers: { 'x-auth-token': token },
    });
    assert.strictEqual(r.status, 200);
    assert.ok(typeof r.body?.checkCount === 'number');
  });
}

async function testAdminKeyAccess() {
  if (!ADMIN_KEY) {
    console.log('\n[5] Admin key access — SKIPPED (ADMIN_KEY not set)');
    return;
  }
  console.log('\n[5] Admin key backward compat — must return 200');

  await test('Correct x-admin-key → /api/admin/abuse-log returns 200', async () => {
    const r = await request({
      method:  'GET',
      path:    '/api/admin/abuse-log',
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    assert.strictEqual(r.status, 200);
  });
}

async function testSecurityHeaders() {
  console.log('\n[6] Security headers');

  const r = await request({ path: '/' });

  await test('X-Frame-Options is set', async () => {
    assert.ok(
      r.headers['x-frame-options'] || r.headers['content-security-policy']?.includes('frame-ancestors'),
      'Must have X-Frame-Options or CSP frame-ancestors'
    );
  });

  await test('Strict-Transport-Security is set', async () => {
    assert.ok(r.headers['strict-transport-security'], 'HSTS header must be present');
  });

  await test('X-Content-Type-Options is set', async () => {
    assert.ok(r.headers['x-content-type-options'], 'Must have X-Content-Type-Options');
  });

  await test('X-Powered-By is absent', async () => {
    assert.ok(!r.headers['x-powered-by'], 'X-Powered-By must be removed');
  });

  await test('Permissions-Policy is set', async () => {
    assert.ok(r.headers['permissions-policy'], 'Permissions-Policy must be set');
  });
}

async function testSensitiveFileProtection() {
  console.log('\n[7] Sensitive file protection');

  await test('GET /.env → 404', async () => {
    const r = await request({ path: '/.env' });
    assert.strictEqual(r.status, 404);
  });

  await test('GET /.env.example → 404', async () => {
    const r = await request({ path: '/.env.example' });
    assert.strictEqual(r.status, 404);
  });

  await test('GET /../../etc/passwd path traversal → 404', async () => {
    const r = await request({ path: '/..%2F..%2Fetc%2Fpasswd' });
    assert.ok(r.status === 404 || r.status === 400, `Got ${r.status}`);
  });
}

async function testRateLimits() {
  console.log('\n[8] Rate limiting');

  await test('Auth endpoint has rate limiting', async () => {
    const promises = Array.from({ length: 15 }, () =>
      request({ method: 'POST', path: '/api/login' }, { email: 'x@x.com', password: 'wrong' })
    );
    const results = await Promise.all(promises);
    const limited = results.some(r => r.status === 429);
    assert.ok(limited, 'At least one request should be rate-limited after 15 attempts');
  });
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║   StudyAI — Security Validation Tests      ║');
  console.log(`╚════════════════════════════════════════════╝`);
  console.log(`\nTarget: ${PROTO === https ? 'https' : 'http'}://${HOST}:${PORT}`);

  // Check server is reachable
  try {
    await request({ path: '/api/health' });
  } catch {
    console.error(`\n❌  Server not reachable at ${HOST}:${PORT}`);
    console.error('   Start the server first: node server.js\n');
    process.exit(1);
  }

  await testPublicRoutes();
  await testAdminRouteProtection();
  await testPrivilegeEscalation();
  await testSuperAdminAccess();
  await testAdminKeyAccess();
  await testSecurityHeaders();
  await testSensitiveFileProtection();
  await testRateLimits();

  console.log('\n' + '─'.repeat(46));
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.error(`\n❌  ${failed} test(s) failed\n`);
    process.exit(1);
  } else {
    console.log(`\n✅  All ${passed} tests passed\n`);
  }
}

main().catch(err => {
  console.error('Test runner error:', err.message);
  process.exit(1);
});
