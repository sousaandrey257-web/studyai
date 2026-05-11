'use strict';
// ============================================================
//  Secret Sanitizer — intercepts console output and HTTP errors
//  to prevent JWT_SECRET, ADMIN_KEY, API keys from leaking.
//  Install once at startup before any other logging.
// ============================================================

// Secrets collected at install-time (env vars may not exist yet when module loads)
let _patterns = [];

function _buildPatterns() {
  const vars = [
    'JWT_SECRET', 'ADMIN_KEY', 'REDIS_URL', 'REDIS_PASSWORD',
    'GROQ_API_KEY', 'OPENAI_API_KEY',
    'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
    'SUPER_ADMIN_EMAIL',
  ];
  _patterns = vars
    .map(v => process.env[v]?.trim())
    .filter(s => s && s.length >= 8)
    .map(s => ({ plain: s, re: new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g') }));
}

function _sanitizeString(str) {
  if (typeof str !== 'string') return str;
  let out = str;
  for (const { re } of _patterns) {
    out = out.replace(re, '[REDACTED]');
  }
  return out;
}

function _sanitizeValue(val) {
  if (typeof val === 'string') return _sanitizeString(val);
  if (val instanceof Error) {
    const e = new Error(_sanitizeString(val.message));
    e.stack = _sanitizeString(val.stack || '');
    e.code  = val.code;
    return e;
  }
  if (Array.isArray(val)) return val.map(_sanitizeValue);
  if (val && typeof val === 'object') {
    // Avoid mutating — create a sanitized copy
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = _sanitizeValue(v);
    }
    return out;
  }
  return val;
}

function _wrap(fn) {
  return (...args) => fn(...args.map(_sanitizeValue));
}

function install() {
  _buildPatterns();

  const orig = {
    log:   console.log.bind(console),
    error: console.error.bind(console),
    warn:  console.warn.bind(console),
    info:  console.info?.bind(console),
  };

  console.log   = _wrap(orig.log);
  console.error = _wrap(orig.error);
  console.warn  = _wrap(orig.warn);
  if (orig.info) console.info = _wrap(orig.info);

  // Re-build patterns if env changes (e.g. after dotenv late-load)
  setTimeout(_buildPatterns, 500);
}

// Express error-response sanitizer — strips secrets from error messages sent to clients
function sanitizeErrorResponse(err, _req, res, _next) {
  _buildPatterns(); // ensure patterns are fresh
  const isProd = process.env.NODE_ENV === 'production';
  const msg    = isProd ? 'Erreur interne du serveur.' : _sanitizeString(err?.message || 'Erreur inconnue.');
  res.status(err?.status || 500).json({ error: msg });
}

module.exports = { install, sanitizeErrorResponse };
