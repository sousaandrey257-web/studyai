'use strict';
// ============================================================
//  Environment Validator — checks required/recommended vars
//  Runs at startup. Warns but NEVER crashes the server.
//  Returns a report that can be included in /api/admin/health.
// ============================================================

const REQUIRED = [
  { key: 'JWT_SECRET',   minLen: 32, desc: 'JWT signing secret — must be long random string' },
  { key: 'ADMIN_KEY',    minLen: 16, desc: 'Admin key for x-admin-key header' },
];

const REQUIRED_ONE_OF = [
  { keys: ['GROQ_API_KEY', 'OPENAI_API_KEY'], desc: 'AI provider API key' },
];

const RECOMMENDED = [
  { key: 'SUPER_ADMIN_EMAIL', desc: 'Email of the sole super admin — required for JWT admin auth' },
  { key: 'STRIPE_SECRET_KEY', desc: 'Stripe integration — required for paid plans' },
  { key: 'STRIPE_WEBHOOK_SECRET', desc: 'Stripe webhook signature verification' },
  { key: 'ALLOWED_ORIGINS',  desc: 'CORS whitelist — required in production to lock down origins' },
  { key: 'NODE_ENV',         desc: 'Set to "production" in production' },
  { key: 'REDIS_URL',        desc: 'Redis for leaderboard + queues (optional but recommended)' },
];

const SECURITY_CHECKS = [
  {
    label: 'JWT_SECRET length ≥ 32',
    check: () => (process.env.JWT_SECRET?.length || 0) >= 32,
    severity: 'critical',
  },
  {
    label: 'JWT_SECRET is not default/example value',
    check: () => !['dev', 'secret', 'changeme', 'jwt_secret', ''].includes(process.env.JWT_SECRET || ''),
    severity: 'critical',
  },
  {
    label: 'SUPER_ADMIN_EMAIL configured',
    check: () => !!process.env.SUPER_ADMIN_EMAIL?.trim(),
    severity: 'high',
  },
  {
    label: 'NODE_ENV=production in production',
    check: () => {
      const port = parseInt(process.env.PORT || '3000');
      return port === 3000 || process.env.NODE_ENV === 'production';
    },
    severity: 'medium',
  },
  {
    label: 'ALLOWED_ORIGINS set in production',
    check: () => process.env.NODE_ENV !== 'production' || !!process.env.ALLOWED_ORIGINS?.trim(),
    severity: 'high',
  },
];

let _report = null;

function validate() {
  const issues   = [];
  const warnings = [];
  const info     = [];

  // Required vars
  for (const { key, minLen, desc } of REQUIRED) {
    const val = process.env[key]?.trim();
    if (!val) {
      issues.push(`MISSING ${key}: ${desc}`);
    } else if (minLen && val.length < minLen) {
      issues.push(`TOO_SHORT ${key}: must be ≥${minLen} chars (got ${val.length})`);
    } else {
      info.push(`✓ ${key}`);
    }
  }

  // Required one-of
  for (const { keys, desc } of REQUIRED_ONE_OF) {
    const hasOne = keys.some(k => !!process.env[k]?.trim());
    if (!hasOne) {
      issues.push(`MISSING one of [${keys.join(', ')}]: ${desc}`);
    } else {
      const found = keys.find(k => !!process.env[k]?.trim());
      info.push(`✓ ${found} (from [${keys.join('|')}])`);
    }
  }

  // Recommended vars
  for (const { key, desc } of RECOMMENDED) {
    if (!process.env[key]?.trim()) {
      warnings.push(`MISSING ${key}: ${desc}`);
    }
  }

  // Security checks
  const securityResults = SECURITY_CHECKS.map(({ label, check, severity }) => {
    let pass;
    try { pass = check(); } catch { pass = false; }
    if (!pass) {
      if (severity === 'critical') issues.push(`SECURITY ${label}`);
      else if (severity === 'high') warnings.push(`SECURITY ${label}`);
      else warnings.push(`SECURITY_NOTE ${label}`);
    }
    return { label, pass, severity };
  });

  const ok = issues.length === 0;

  _report = {
    ok,
    issues,
    warnings,
    info,
    security:    securityResults,
    checkedAt:   new Date().toISOString(),
  };

  // Log summary at startup
  if (issues.length) {
    console.error(`[env] ❌  ${issues.length} critical issue(s):`);
    issues.forEach(i => console.error(`  • ${i}`));
  }
  if (warnings.length) {
    console.warn(`[env] ⚠  ${warnings.length} warning(s):`);
    warnings.forEach(w => console.warn(`  • ${w}`));
  }
  if (ok && !warnings.length) {
    console.log('[env] ✓ All environment checks passed');
  }

  return _report;
}

function getReport() { return _report || validate(); }

module.exports = { validate, getReport };
