'use strict';

const express  = require('express');
const jwt      = require('jsonwebtoken');
const multer   = require('multer');
const { default: rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { chat }       = require('../services/tutor.service');
const VoiceService   = require('../services/tutor-voice.service');
const VisionService  = require('../services/tutor-vision.service');
const FileService    = require('../services/tutor-file.service');

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

// ── Multer instances (memory storage, per-type) ──────────────
const _voiceUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: VoiceService.MAX_AUDIO_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (VoiceService.ALLOWED_MIMES.has(file.mimetype.toLowerCase())) cb(null, true);
    else cb(new Error(`Format audio non supporté : ${file.mimetype}`));
  },
});

const _visionUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: VisionService.MAX_IMAGE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (VisionService.ALLOWED_MIMES.has(file.mimetype.toLowerCase())) cb(null, true);
    else cb(new Error(`Format image non supporté : ${file.mimetype}`));
  },
});

const _fileUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: FileService.MAX_FILE_BYTES, files: 1 },
});

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

// ── Rate limiters for media endpoints (10/hour per IP) ───────
const mediaLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => `tutor-media:${ipKeyGenerator(req)}`,
  handler: (_req, res) =>
    res.status(429).json({ error: 'Limite atteinte. Réessaie dans une heure.' }),
});

// ── POST /api/tutor/voice ─────────────────────────────────────
// multipart/form-data: field "audio" (audio file)
// optional field "lang" (language code)
router.post('/voice', mediaLimiter, optionalAuth, (req, res, next) => {
  _voiceUpload.single('audio')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier audio reçu (champ : audio).' });

  try {
    const text = await VoiceService.transcribe(req.file.buffer, req.file.mimetype);
    return res.json({ text, mimeType: req.file.mimetype, size: req.file.size });
  } catch (err) {
    console.error('[tutor/voice]', err.message);
    return res.status(502).json({ error: err.message });
  }
});

// ── POST /api/tutor/vision ────────────────────────────────────
// multipart/form-data: field "image" (image file)
// optional field "lang" (language code)
router.post('/vision', mediaLimiter, optionalAuth, (req, res, next) => {
  _visionUpload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucune image reçue (champ : image).' });

  const safeLang = (typeof req.body.lang === 'string' && /^[a-z]{2}(-BR)?$/.test(req.body.lang))
    ? req.body.lang : 'fr';

  try {
    const description = await VisionService.analyse(req.file.buffer, req.file.mimetype, safeLang);
    return res.json({ text: description, mimeType: req.file.mimetype, size: req.file.size });
  } catch (err) {
    console.error('[tutor/vision]', err.message);
    return res.status(502).json({ error: err.message });
  }
});

// ── POST /api/tutor/file ──────────────────────────────────────
// multipart/form-data: field "file" (PDF or plain text)
router.post('/file', mediaLimiter, optionalAuth, (req, res, next) => {
  _fileUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu (champ : file).' });

  try {
    const result = await FileService.extract(
      req.file.buffer, req.file.mimetype, req.file.originalname || ''
    );
    return res.json({
      text:      result.text,
      truncated: result.truncated,
      pages:     result.pages,
      charCount: result.text.length,
    });
  } catch (err) {
    console.error('[tutor/file]', err.message);
    return res.status(400).json({ error: err.message });
  }
});

module.exports = router;
