'use strict';

const express   = require('express');
const crypto    = require('crypto');
const fs        = require('fs');
const path      = require('path');
const jwt       = require('jsonwebtoken');
const { default: rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { askBot } = require('../services/support-bot.service');
const EmailQueue = require('../services/email/emailQueue');

const router = express.Router();

const TICKETS_FILE = path.join(__dirname, '../data/support-tickets.json');

// ── Optional auth (mirrors server.js pattern) ────────────────
function optionalAuth(req, res, next) {
  const token = req.headers['x-auth-token'];
  if (token) {
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET || 'dev', { algorithms: ['HS256'] });
    } catch {}
  }
  next();
}

// ── Rate limit: 20 messages/hour per IP ──────────────────────
const chatLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => `support:${ipKeyGenerator(req)}`,
  handler: (_req, res) => res.status(429).json({ error: 'Trop de messages. Réessaie dans une heure.' }),
});

const escalateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => `escalate:${ipKeyGenerator(req)}`,
});

// ── Ticket storage helpers ────────────────────────────────────
function _loadTickets() {
  try {
    if (!fs.existsSync(TICKETS_FILE)) return [];
    return JSON.parse(fs.readFileSync(TICKETS_FILE, 'utf8'));
  } catch { return []; }
}

function _saveTickets(tickets) {
  try {
    const dir = path.dirname(TICKETS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(TICKETS_FILE, JSON.stringify(tickets, null, 2), 'utf8');
  } catch (err) {
    console.error('[support] Failed to save ticket:', err.message);
  }
}

// ── POST /api/support/chat ────────────────────────────────────
router.post('/chat', chatLimiter, optionalAuth, async (req, res) => {
  const { message, sessionId, conversationHistory = [], language } = req.body || {};

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Message requis.' });
  }
  if (message.length > 1000) {
    return res.status(400).json({ error: 'Message trop long (max 1000 caractères).' });
  }

  // Validate language: 2-letter code or pt-BR
  const safeLang = (typeof language === 'string' && /^[a-z]{2}(-BR)?$/.test(language))
    ? language : 'fr';

  const safeHistory = Array.isArray(conversationHistory)
    ? conversationHistory.slice(-10).filter(m => m && m.role && m.content)
    : [];

  try {
    const { reply, needsHuman } = await askBot(message.trim(), req.user || null, safeHistory, safeLang);

    const suggestions = [];

    return res.json({ reply, needsHuman, suggestions, sessionId: sessionId || null });
  } catch (err) {
    console.error('[support/chat] Error:', err.message);
    return res.status(503).json({
      error: 'Le bot est temporairement indisponible.',
      reply: 'Je suis temporairement indisponible. Si tu as une urgence, envoie un email directement à notre équipe.',
      needsHuman: true,
      suggestions: ['Réessayer'],
    });
  }
});

// ── POST /api/support/escalate ────────────────────────────────
router.post('/escalate', escalateLimiter, optionalAuth, async (req, res) => {
  const { sessionId, conversationHistory = [], userEmail, problem } = req.body || {};

  if (!problem || typeof problem !== 'string' || !problem.trim()) {
    return res.status(400).json({ error: 'Décris ton problème.' });
  }

  const ticketId = crypto.randomBytes(4).toString('hex').toUpperCase();
  const ticket = {
    id: ticketId,
    date: new Date().toISOString(),
    userEmail: userEmail || req.user?.email || 'Anonyme',
    problem: problem.trim(),
    conversation: Array.isArray(conversationHistory) ? conversationHistory.slice(-20) : [],
    status: 'open',
  };

  const tickets = _loadTickets();
  tickets.push(ticket);
  _saveTickets(tickets);

  const adminEmail = process.env.SUPER_ADMIN_EMAIL;
  if (adminEmail) {
    const historyHtml = ticket.conversation
      .map(m => `<p><strong>${m.role === 'user' ? '👤 User' : '🤖 Bot'}:</strong> ${m.content}</p>`)
      .join('') || '<p><em>Aucun historique disponible.</em></p>';

    try {
      await EmailQueue.send({
        to: adminEmail,
        subject: `[StudyAI Support] Ticket #${ticketId} — ${problem.trim().slice(0, 60)}`,
        html: `
          <h2>Nouveau ticket support #${ticketId}</h2>
          <p><strong>Date :</strong> ${new Date().toLocaleString('fr-BE')}</p>
          <p><strong>Utilisateur :</strong> ${ticket.userEmail}</p>
          <p><strong>Problème :</strong> ${problem.trim()}</p>
          <hr />
          <h3>Historique de conversation</h3>
          ${historyHtml}
        `,
      });
    } catch (emailErr) {
      console.error('[support/escalate] Email failed:', emailErr.message);
    }
  }

  return res.json({ ok: true, ticketId });
});

module.exports = router;
