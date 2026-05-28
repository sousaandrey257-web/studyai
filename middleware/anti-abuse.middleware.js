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

  const fingerprint = (req.headers['x-device-fingerprint'] || '').trim().slice(0, 128);
  if (!fingerprint) {
    return res.status(400).json({
      error: 'fingerprint_required',
      message: 'Identification requise pour les utilisateurs anonymes.',
    });
  }

  const ip     = getClientIP(req);
  const result = antiAbuse.checkQuota(fingerprint, ip);

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
