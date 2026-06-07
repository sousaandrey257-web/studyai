'use strict';
// Anti-abuse middleware — applies to anonymous users only.
// Logged-in users (free or premium) are skipped entirely.

const antiAbuse = require('../services/anti-abuse.service');

function getClientIP(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress
    || 'unknown';
}

function antiAbuseMiddleware(req, res, next) {
  // Skip for any authenticated user (free or premium)
  if (req.user) return next();

  // Skip for authenticated admin requests (mirrors rate-limiter skip: isAdmin(req))
  const adminKey = process.env.ADMIN_KEY?.trim();
  if (req._adminAuth || (adminKey && req.headers['x-admin-key'] === adminKey)) return next();

  const fingerprint = (req.headers['x-device-fingerprint'] || '').trim().slice(0, 128);
  const ip          = getClientIP(req);

  // Si pas de fingerprint (script lent ou bloqué) → utilise l'IP seule, ne bloque jamais
  const result = antiAbuse.checkQuota(fingerprint || ip, ip);

  // Attach for downstream handlers and /api/quota
  req._abuseInfo = result;

  if (!result.allowed) {
    return res.status(429).json({
      error:     'quota_exceeded',
      message:   'Limite atteinte. Crée un compte gratuit pour continuer.',
      remaining: 0,
      resetAt:   result.resetAt,
    });
  }

  next();
}

module.exports = antiAbuseMiddleware;
