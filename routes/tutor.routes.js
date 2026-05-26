'use strict';

const express  = require('express');
const jwt      = require('jsonwebtoken');
const { default: rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { chat } = require('../services/tutor.service');

const router = express.Router();

// ── Optional auth (same pattern as routes/support.js) ────────
function optionalAuth(req, _res, next) {
  const token = req.headers['x-auth-token'] || req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET || 'dev', { algorithms: ['HS256'] });
    } catch {}
  }
  next();
}

// ── Rate limit: 30 messages/hour per IP ──────────────────────
const chatLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => `tutor:${ipKeyGenerator(req)}`,
  handler: (_req, res) =>
    res.status(429).json({ error: 'Trop de messages. Réessaie dans une heure.' }),
});

// ── POST /api/tutor/chat ─────────────────────────────────────
router.post('/chat', chatLimiter, optionalAuth, async (req, res) => {
  const { messages, lang, userLevel } = req.body || {};

  // Validate messages
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required.' });
  }
  if (messages.length > 40) {
    return res.status(400).json({ error: 'Conversation trop longue (max 40 messages).' });
  }

  // Sanitize each message: must have role + string content
  const safeMessages = messages
    .filter(m => m && typeof m.role === 'string' && typeof m.content === 'string')
    .map(m => ({
      role:    ['user', 'assistant', 'system'].includes(m.role) ? m.role : 'user',
      content: m.content.slice(0, 4000),
    }));

  if (safeMessages.length === 0) {
    return res.status(400).json({ error: 'Aucun message valide dans le tableau.' });
  }

  // Validate lang: 2-letter code or pt-BR
  const safeLang = (typeof lang === 'string' && /^[a-z]{2}(-BR)?$/.test(lang))
    ? lang : 'fr';

  // Validate userLevel: string, max 100 chars
  const safeLevel = (typeof userLevel === 'string' && userLevel.trim().length > 0)
    ? userLevel.trim().slice(0, 100) : null;

  try {
    const reply = await chat(safeMessages, safeLang, safeLevel);
    return res.json({ reply, lang: safeLang });
  } catch (err) {
    console.error('[tutor/chat] Error:', err.message);
    return res.status(503).json({
      error: 'tutor_unavailable',
      reply: 'Le tuteur est temporairement indisponible. Réessaie dans un instant.',
    });
  }
});

module.exports = router;
