'use strict';
// ============================================================
//  requireSuperAdmin — Super Admin Gate Middleware  v2
//  Mechanisms (in order):
//    1. JWT: email must match SUPER_ADMIN_EMAIL + max 12h session
//    2. Admin key: x-admin-key header (backward compat)
//  Extra:
//    - Token blacklist check (immediate revocation support)
//    - IP change detection and logging
//    - Admin-specific rate limiter (30 req / 15 min)
//    - Full audit trail in data/admin_audit.log
// ============================================================

const jwt       = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const fs        = require('fs');
const path      = require('path');

const AUDIT_LOG        = path.join(__dirname, '..', 'data', 'admin_audit.log');
const ADMIN_SESSION_MAX = 12 * 60 * 60; // 12h in seconds

// Runtime reads — never cached (allows config hot-fix without restart)
const _superEmail = () => process.env.SUPER_ADMIN_EMAIL?.trim()?.toLowerCase() || null;
const _adminKey   = () => process.env.ADMIN_KEY?.trim() || null;
const _jwtSecret  = () => process.env.JWT_SECRET?.trim() || null;

// IP session map: uid → { ip, firstSeen, lastSeen }
const _sessionIPs = new Map();

// Lazy-load blacklist to avoid circular dependency issues at startup
let _blacklist = null;
function _getBlacklist() {
  if (!_blacklist) {
    try { _blacklist = require('./tokenBlacklist'); } catch { _blacklist = { isBlacklisted: () => false }; }
  }
  return _blacklist;
}

function _getIP(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress
    || 'unknown';
}

// ── Audit logger ─────────────────────────────────────────────
function _audit(entry) {
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
    fs.appendFileSync(AUDIT_LOG, line, 'utf8');
  } catch { /* never crash for a log write */ }
}

// ── JWT super-admin verification ─────────────────────────────
function _verifyJWT(req) {
  const token = req.headers['x-auth-token'];
  if (!token) return null;

  const secret     = _jwtSecret();
  const superEmail = _superEmail();
  if (!secret || !superEmail) return null;

  let decoded;
  try {
    decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
  } catch {
    return null; // expired, tampered, wrong algo
  }

  // Must be a string email matching SUPER_ADMIN_EMAIL — server-side only, never from body
  if (typeof decoded.email !== 'string') return null;
  if (decoded.email.toLowerCase() !== superEmail) return null;

  // Enforce 12h max session for admin access (even if token hasn't expired yet)
  const ageSeconds = Math.floor(Date.now() / 1000) - (decoded.iat || 0);
  if (ageSeconds > ADMIN_SESSION_MAX) {
    _audit({ event: 'admin_session_expired', email: decoded.email, ageSec: ageSeconds });
    return null;
  }

  // Blacklist check — revoked tokens never pass
  if (_getBlacklist().isBlacklisted(decoded)) {
    _audit({ event: 'admin_blacklisted_token', email: decoded.email });
    return null;
  }

  return decoded;
}

// ── Admin-key verification (constant-time) ───────────────────
function _verifyKey(req) {
  const key = _adminKey();
  if (!key) return false;
  const provided = String(req.headers['x-admin-key'] || '');
  if (provided.length !== key.length) return false;
  let diff = 0;
  for (let i = 0; i < key.length; i++) diff |= provided.charCodeAt(i) ^ key.charCodeAt(i);
  return diff === 0;
}

// ── Admin-specific rate limiter ───────────────────────────────
const adminRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => `sadmin:${_getIP(req)}`,
  message: { error: 'Trop de requêtes admin. Réessayez dans quelques minutes.' },
});

// ── Main middleware ───────────────────────────────────────────
function requireSuperAdmin(req, res, next) {
  const ip = _getIP(req);

  // 1. JWT super-admin (primary path)
  const decoded = _verifyJWT(req);
  if (decoded) {
    const uid = decoded.userId || decoded.email;
    const now = Date.now();

    // IP change detection
    const prev = _sessionIPs.get(uid);
    if (prev && prev.ip !== ip) {
      _audit({ event: 'admin_ip_change', uid, email: decoded.email, fromIp: prev.ip, toIp: ip });
      console.warn(`[superadmin] IP change: ${decoded.email} — ${prev.ip} → ${ip}`);
      // Update immediately — log only, don't block (NAT / mobile networks can cause this)
    }
    _sessionIPs.set(uid, { ip, firstSeen: prev?.firstSeen || now, lastSeen: now });

    req._adminAuth   = 'jwt';
    req._adminEmail  = decoded.email;
    req._adminDec    = decoded; // expose for revoke endpoint
    req.user         = req.user || decoded;

    _audit({ event: 'admin_access', method: req.method, path: req.path, email: decoded.email, ip, auth: 'jwt' });
    return next();
  }

  // 2. Admin-key fallback (backward compat — preserves all existing tooling)
  if (_verifyKey(req)) {
    req._adminAuth  = 'key';
    req._adminEmail = 'admin-key';

    _audit({ event: 'admin_access', method: req.method, path: req.path, email: 'admin-key', ip, auth: 'key' });
    return next();
  }

  // 3. Fail safe — deny, no internal details leaked
  _audit({ event: 'admin_access_denied', method: req.method, path: req.path, ip });
  return res.status(403).json({ error: 'Accès refusé.' });
}

// ── Audit helper ──────────────────────────────────────────────
function auditAction(req, action, details = {}) {
  _audit({
    event:  `admin_action:${action}`,
    email:  req._adminEmail || 'unknown',
    ip:     _getIP(req),
    ...details,
  });
}

module.exports = { requireSuperAdmin, adminRateLimiter, auditAction };
