// ============================================================
//  StudyAI — Backend
//  Plans : Mensuel (4,99€/mois) + À vie (19,99€ one-time)
// ============================================================

require('dotenv').config();
const express    = require('express');
const path       = require('path');
const crypto     = require('crypto');
const { OpenAI } = require('openai');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const fs         = require('fs');
const helmet     = require('helmet');
const compression = require('compression');
const rateLimit  = require('express-rate-limit');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── /healthz : Railway healthcheck — répond AVANT tout autre middleware ──
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

// ============================================================
//  NETTOYAGE CLÉ API
// ============================================================
if (process.env.OPENAI_API_KEY) {
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY
    .trim().replace(/^﻿/, '').replace(/^["'`]|["'`]$/g, '');
}

// ============================================================
//  MODÈLE IA
// ============================================================
const USE_GROQ = !!process.env.GROQ_API_KEY?.trim();
const MODEL    = USE_GROQ
  ? (process.env.OPENAI_MODEL || 'llama-3.3-70b-versatile').trim()
  : (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();

const openai = USE_GROQ
  ? new OpenAI({ apiKey: process.env.GROQ_API_KEY.trim(), baseURL: 'https://api.groq.com/openai/v1' })
  : new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Fallback providers (OpenAI-compatible)
const geminiClient = process.env.GEMINI_API_KEY?.trim()
  ? new OpenAI({
      apiKey: process.env.GEMINI_API_KEY.trim(),
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    })
  : null;

const openrouterClient = process.env.OPENROUTER_API_KEY?.trim()
  ? new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY.trim(),
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://studyai-production-5202.up.railway.app',
        'X-Title': 'StudyAI',
      },
    })
  : null;

// ============================================================
//  SERVICES
// ============================================================
const PricingService     = require('./services/pricing');
const { detectSubject }  = require('./services/subject-detector.service');
const ReferralService    = require('./services/referral');
const GamiService        = require('./services/gamification.service');
const AntiFraud          = require('./services/antiFraud.service');
const LeaderboardService = require('./services/leaderboard.service');
const SecurityMW         = require('./security/middleware');
const { requireSuperAdmin, adminRateLimiter, auditAction } = require('./middleware/requireSuperAdmin');
const RedisLB            = require('./services/redis/leaderboard.redis');
const HARedis            = require('./services/redis/ha.client');
const Publisher          = require('./services/queue/publisher');
const Analytics          = require('./services/analytics/tracker'); // passive listener — just require
const BotDetect          = require('./services/antiBot/detector');
const ShadowMode         = require('./services/antiBot/shadowMode');
const ReferralGraph      = require('./services/referral/graph');
const PoW                = require('./services/antiBot/pow');
const DLQ                = require('./services/queue/dlq');
const HealthCheck        = require('./services/observability/healthCheck');
const Metrics            = require('./services/observability/metrics');
// Phase 6: event backbone + anti-bot multi-layer
const EventLog           = require('./services/event-log/eventLog');
const EventBus           = require('./services/event-log/bus');
const Outbox             = require('./services/event-log/outbox');
const ReplayEngine       = require('./services/event-log/replay');
const Attestation        = require('./services/antiBot/attestation');
const BehaviorModel      = require('./services/antiBot/behaviorModel');
const ChallengeRouter    = require('./services/antiBot/challengeRouter');
const BotSimulator       = require('./services/antiBot/simulator');
require('./services/events/handlers'); // side-effect: registers all event listeners + outbox poller
const SecretSanitizer = require('./middleware/secretSanitizer');
const TokenBlacklist  = require('./middleware/tokenBlacklist');
const AutoBackup      = require('./services/backup/autoBackup');
const SafeMode        = require('./services/safeMode');
const FileIntegrity   = require('./services/integrity/fileIntegrity');
const FunnelAnalytics = require('./services/analytics/funnel');
const Entitlements    = require('./services/entitlements');
const Retention       = require('./services/retention');
const RequestTracer   = require('./services/observability/requestTracer');
const EnvValidator    = require('./services/startup/envValidator');
const EmailQueue      = require('./services/email/emailQueue');
const Waitlist        = require('./services/beta/waitlist');
const InviteCodes     = require('./services/beta/inviteCodes');
const MemoryWatchdog  = require('./services/watchdog/memoryWatchdog');

// Install secret sanitizer immediately — before any logging of env vars
SecretSanitizer.install();
// Validate environment at startup (warns but never crashes)
EnvValidator.validate();

// ============================================================
//  STRIPE
// ============================================================
let stripe = null;
if (process.env.STRIPE_SECRET_KEY?.trim()) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY.trim());
}

// ── Pricing : délégué au service ──────────────────────────────
const {
  PRICE_MONTHLY, PRICE_YEARLY,
  CURRENCY_PRICES, ZERO_DECIMAL_CURRENCIES, EU_COUNTRIES, REGIONAL_PRICING,
  getCurrencyForCountry, getPricesForCurrency, getRegionalPricing,
} = PricingService;
const PRICE_LIFETIME = PRICE_YEARLY; // inutilisé (lifetime supprimé)

// ============================================================
//  CONTEXTE CURRICLAIRE PAR PAYS
// ============================================================
const CURRICULUM_MAP = {
  FR: 'Programme Éducation Nationale française (collège, lycée, Bac, Classes Prépa)',
  BE: 'Programme scolaire belge (secondaire, humanités, CESS)',
  CH: 'Programme suisse (secondaire, maturité fédérale)',
  DE: 'Deutsches Bildungssystem (Gymnasium, Abitur, Realschule)',
  AT: 'Österreichisches Bildungssystem (AHS, Matura)',
  GB: 'UK curriculum (GCSE, A-levels, Scottish Highers)',
  IE: 'Irish curriculum (Junior Cert, Leaving Cert)',
  US: 'US curriculum (Common Core, AP courses, SAT/ACT prep)',
  CA: 'Canadian curriculum (provincial programs, Ontario, Quebec)',
  AU: 'Australian curriculum (ATAR, HSC, VCE)',
  JP: '日本の学習指導要領（中学・高校・大学入学共通テスト対策）',
  KR: '한국 교육과정（수능 준비, 내신 관리）',
  CN: '中国课程标准（初高中、高考备考、新课标）',
  IN: 'Indian curriculum (CBSE, ICSE, State boards, JEE/NEET prep)',
  BR: 'Currículo brasileiro (BNCC, ENEM, vestibular)',
  MX: 'Currículo mexicano (SEP, preparatoria, UNAM)',
  ID: 'Kurikulum Indonesia (SMP, SMA, Merdeka Belajar)',
  SG: 'Singapore curriculum (O-levels, A-levels, IB)',
};

function buildCurriculumCtx(country) {
  return CURRICULUM_MAP[country] || null;
}

// ============================================================
//  DATA LAYER — stockage JSON local (dossier data/)
// ============================================================
const DATA_DIR         = path.join(__dirname, 'data');
const USERS_FILE       = path.join(DATA_DIR, 'users.json');
const CONTENT_FILE     = path.join(DATA_DIR, 'content.json');
const PREMIUMS_FILE    = path.join(DATA_DIR, 'premiums.json');
const RESET_TOKENS_FILE = path.join(DATA_DIR, 'reset_tokens.json');
const JWT_SECRET       = process.env.JWT_SECRET?.trim();

if (!JWT_SECRET) console.warn('[auth] JWT_SECRET absent du .env — sessions non persistantes au redémarrage.');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadJSON(file, def = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; }
}
// Atomic write: tmp file → rename. Prevents corruption if process crashes mid-write.
function saveJSON(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

// ============================================================
//  WEBHOOK STRIPE — doit être enregistré AVANT express.json()
//  car Stripe nécessite le corps brut (non parsé) pour vérifier
//  la signature.
// ============================================================
// Accepte les deux noms de route (webhooks Stripe Dashboard ou stripe CLI)
const webhookHandler = express.raw({ type: 'application/json' });
async function handleStripeWebhook(req, res) {
  if (!stripe) return res.status(503).send('Stripe non configuré');

  const sig    = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  const isProd = process.env.NODE_ENV === 'production';

  if (!secret) {
    if (isProd) {
      console.error('[webhook] STRIPE_WEBHOOK_SECRET manquant en production — requête rejetée');
      return res.status(400).send('Configuration webhook manquante');
    }
    console.warn('[webhook] STRIPE_WEBHOOK_SECRET non défini — signature non vérifiée (dev local)');
  }

  let event;
  try {
    event = secret
      ? stripe.webhooks.constructEvent(req.body, sig, secret)
      : JSON.parse(req.body.toString());
  } catch (err) {
    console.error('[webhook] Signature invalide :', err.message);
    return res.status(400).send('Signature invalide');
  }

  console.log('[webhook] Event reçu :', event.type);

  // Paiement complété → activer le premium (backup si le client ne revient pas)
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const isPaid  = session.payment_status === 'paid'
      || (session.mode === 'subscription' && session.status === 'complete');
    if (isPaid) {
      const plan  = session.metadata?.plan || (session.mode === 'subscription' ? 'monthly' : 'lifetime');
      const subId = session.subscription || null;
      // N'active que si aucun token n'existe déjà pour ce subId
      const exists = subId && [...premiumUsers.values()].some(u => u.subId === subId);
      if (!exists) {
        const token = crypto.randomUUID();
        premiumUsers.set(token, { type: plan, subId, active: true, createdAt: new Date().toISOString(), source: 'webhook' });
        savePremiums();
        FunnelAnalytics.track('upgrade_success', { plan, source: 'webhook' });
        console.log(`[webhook] Premium "${plan}" activé via webhook — sub: ${subId || 'N/A'}`);
      }
    }
  }

  // Abonnement annulé ou en pause → désactive
  if (event.type === 'customer.subscription.deleted' ||
      event.type === 'customer.subscription.paused') {
    deactivateSubscription(event.data.object.id);
  }

  // Paiement récurrent échoué → suspend après PAYMENT_FAILURE_THRESHOLD tentatives
  if (event.type === 'invoice.payment_failed') {
    const subId = event.data.object.subscription;
    if (subId) recordPaymentFailure(subId);
  }

  // Paiement récurrent réussi → remet à zéro le compteur et réactive si suspendu pour échecs
  if (event.type === 'invoice.paid') {
    const subId = event.data.object.subscription;
    if (subId) resetPaymentFailures(subId);
  }

  res.json({ received: true });
}
app.post('/api/webhook',        webhookHandler, handleStripeWebhook);
app.post('/api/stripe-webhook', webhookHandler, handleStripeWebhook);

// ============================================================
//  MIDDLEWARES (après le webhook)
// ============================================================

// Trust proxy — required for correct IP detection on Railway/Render/Fly.io
// '1' = trust first proxy hop only (prevents IP spoofing via X-Forwarded-For)
app.set('trust proxy', 1);

// Request tracer — assigns X-Request-ID and records latency percentiles
app.use(RequestTracer.tracerMiddleware);

// Block access to sensitive files before static middleware runs
app.use((req, res, next) => {
  const p = req.path.toLowerCase();
  if (p === '/.env' || p === '/.env.example' || p.includes('/.git') ||
      p.endsWith('.log') || p.includes('..')) {
    return res.status(404).end();
  }
  next();
});

// Sécurité HTTP headers
app.use(helmet({
  // CSP: 'unsafe-inline' required for inline event handlers (onclick=...) in existing HTML
  contentSecurityPolicy: {
    directives: {
      defaultSrc:      ["'self'"],
      scriptSrc:       ["'self'", "'unsafe-inline'"],
      styleSrc:        ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:         ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:          ["'self'", 'data:'],
      connectSrc:      ["'self'"],
      objectSrc:       ["'none'"],
      baseUri:         ["'self'"],
      formAction:      ["'self'"],
      frameAncestors:  ["'none'"],
    },
  },
  crossOriginEmbedderPolicy:    false,
  hsts:                         { maxAge: 31536000, includeSubDomains: true, preload: true },
  referrerPolicy:               { policy: 'strict-origin-when-cross-origin' },
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },
  crossOriginOpenerPolicy:      { policy: 'same-origin-allow-popups' },
}));
// Permissions-Policy — disable unused browser features
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  next();
});
// Remove X-Powered-By (belt-and-suspenders — helmet already does this)
app.disable('x-powered-by');

// Compression gzip → réduit le payload de 60-70%
app.use(compression());

// CORS — whitelist-based (fallback: open in dev, locked in prod)
app.use((req, res, next) => {
  const origin  = req.headers.origin || '';
  const allowed = (process.env.ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  const isProd     = process.env.NODE_ENV === 'production';
  const originOk   = !origin                          // same-origin (no origin header)
    || (!isProd && !allowed.length)                   // dev mode with no whitelist — open
    || allowed.includes(origin)                        // explicitly whitelisted
    || (!isProd && allowed.includes('*'));             // dev wildcard

  if (originOk && origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  // Expose only the headers our API actually uses
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-auth-token, x-premium-token, x-admin-key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Request timeout — 65s to allow multi-provider AI fallback chain (3 × 20s)
app.use((req, res, next) => {
  res.setTimeout(65_000, () => {
    if (!res.headersSent) res.status(408).json({ error: 'Request timeout.' });
  });
  next();
});

// Safe mode flag — tags req._safeMode for downstream handlers
app.use('/api/', SafeMode.safeModeMiddleware);

// Super-admin early flag — runs before rate limiters so isAdmin() can skip limits for JWT super admin
// Only sets a flag; full verification happens in requireSuperAdmin middleware on admin routes.
app.use('/api/', (req, _res, next) => {
  const superEmail = process.env.SUPER_ADMIN_EMAIL?.trim()?.toLowerCase();
  const secret     = process.env.JWT_SECRET?.trim();
  if (superEmail && secret) {
    const token = req.headers['x-auth-token'];
    if (token) {
      try {
        const d = jwt.verify(token, secret, { algorithms: ['HS256'] });
        if (typeof d.email === 'string' && d.email.toLowerCase() === superEmail) {
          req._isSuperAdmin = true;
        }
      } catch { /* invalid token — flag stays false */ }
    }
  }
  next();
});

// Rate-limiting API général : 150 req / 15 min par IP
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes. Réessayez dans quelques minutes.' },
  skip: (req) => isAdmin(req),
});
app.use('/api/', apiLimiter);

// Rate-limiting strict sur /api/generate : 20 req / 15 min (anti-abus freemium)
const generateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'limit_reached', message: 'Trop de requêtes. Réessayez dans quelques minutes.' },
  skip: (req) => isAdmin(req),
});
app.use('/api/generate', generateLimiter);

// Rate-limiting sur /api/consolidation-quiz : 10 appels IA / 15 min — même coût qu'une génération
const consolidationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'limit_reached', message: 'Trop de requêtes. Réessayez dans quelques minutes.' },
  skip: (req) => isAdmin(req),
});

// Rate-limiting sur /api/referral/claim : 5 tentatives / heure — anti-farming
const referralClaimLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Trop de tentatives. Réessayez dans 1 heure.' },
});

// Rate-limiting auth : 10 tentatives / 15 min par IP — anti brute-force
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Trop de tentatives. Réessayez dans 15 minutes.' },
  skipSuccessfulRequests: true, // don't count successful logins
});

// ============================================================
//  AI ROUTES — registered BEFORE global json middleware
//  so that /api/ai/analyze can receive up to 25MB payloads
// ============================================================
const AiRoutes      = require('./routes/ai');
const supportRoutes = require('./routes/support');
// Own JSON parser at 25MB for this router (runs before global 100kb limit)
app.use('/api/ai', express.json({ limit: '25mb' }), AiRoutes);
app.use('/api/support', express.json({ limit: '50kb' }), supportRoutes);

// Static routes for new pages
app.get('/app',    (_req, res) => res.sendFile(path.join(__dirname, 'public/app.html')));
app.get('/upload', (_req, res) => res.sendFile(path.join(__dirname, 'public/upload.html')));
app.get('/battle', (_req, res) => res.sendFile(path.join(__dirname, 'public/battle.html')));
app.get('/brain',  (_req, res) => res.sendFile(path.join(__dirname, 'public/brain.html')));
// Invite / referral landing page
app.get('/invite/:code', (_req, res) => res.sendFile(path.join(__dirname, 'public/invite.html')));
// Modal routes — auth/premium are inline modals on the homepage
app.get('/login',       (_req, res) => res.redirect('/#login'));
app.get('/register',    (_req, res) => res.redirect('/#register'));
app.get('/premium',     (_req, res) => res.redirect('/#pricing'));
app.get('/leaderboard', (_req, res) => res.redirect('/dashboard'));

// Body JSON — limite à 100 Ko pour éviter les attaques par payload massif
app.use(express.json({ limit: '100kb' }));

// Input sanitization — strip script tags / event handlers from all body strings
app.use(SecurityMW.sanitizeBody);

// Anomaly detection — sliding window per IP, flags (does not block) rapid bursts
app.use('/api/', SecurityMW.anomalyDetect);

// Differentiated rate limit — premium 500 / user 200 / guest 60 (per 15 min)
// Layered on top of the global apiLimiter (150 for all) as a more granular control
const diffLimiter = SecurityMW.createDiffLimiter();
app.use('/api/', diffLimiter);

// Cache headers for static assets (before express.static, purely additive)
// Versioned files (?v=N) → immutable 1 year | Other assets → 1 hour
app.use((req, res, next) => {
  const url = req.url;
  if (/\?v=\d/.test(url)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (/\.(css|js|svg|png|ico|woff2?|ttf|webp|jpg|jpeg)(\?|$)/.test(url)) {
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  } else if (url === '/manifest.json') {
    res.setHeader('Cache-Control', 'public, max-age=3600');
  } else if (url === '/sw.js') {
    // Service workers must not be cached long (browsers enforce this anyway)
    res.setHeader('Cache-Control', 'no-cache');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
//  SYSTÈME FREEMIUM
// ============================================================
const FREE_LIMIT  = 6;
const ADMIN_KEY   = process.env.ADMIN_KEY?.trim() || null;
const usageStore  = new Map(); // ip → { count, date }

function isAdmin(req) {
  // requireSuperAdmin middleware already validated this request (JWT or key)
  if (req._adminAuth) return true;
  // JWT super-admin pre-check (set by early middleware on /api/)
  if (req._isSuperAdmin) return true;
  // Legacy: x-admin-key header
  if (!ADMIN_KEY) return false;
  return req.headers['x-admin-key'] === ADMIN_KEY;
}

// token → { type: 'monthly'|'yearly'|'lifetime', subId: string|null, active: boolean, createdAt: string }
const premiumUsers = new Map();

function loadPremiums() {
  const data = loadJSON(PREMIUMS_FILE, {});
  for (const [token, info] of Object.entries(data)) {
    premiumUsers.set(token, info);
  }
  if (premiumUsers.size) console.log(`[premium] ${premiumUsers.size} token(s) chargé(s) depuis le disque.`);
}

function savePremiums() {
  const obj = {};
  for (const [token, info] of premiumUsers.entries()) obj[token] = info;
  saveJSON(PREMIUMS_FILE, obj);
}

function deactivateSubscription(subId) {
  for (const [, user] of premiumUsers.entries()) {
    if (user.subId === subId) {
      user.active = false;
      savePremiums();
      console.log(`[premium] Abonnement ${subId} désactivé`);
      break;
    }
  }
}

const PAYMENT_FAILURE_THRESHOLD = 3;

function recordPaymentFailure(subId) {
  for (const [, user] of premiumUsers.entries()) {
    if (user.subId !== subId) continue;
    user.paymentFailures = (user.paymentFailures || 0) + 1;
    console.log(`[premium] Échec paiement #${user.paymentFailures}/${PAYMENT_FAILURE_THRESHOLD} — sub: ${subId}`);
    if (user.paymentFailures >= PAYMENT_FAILURE_THRESHOLD) {
      user.active = false;
      console.warn(`[premium] Accès suspendu après ${PAYMENT_FAILURE_THRESHOLD} échecs — sub: ${subId}`);
    }
    savePremiums();
    break;
  }
}

function resetPaymentFailures(subId) {
  for (const [, user] of premiumUsers.entries()) {
    if (user.subId !== subId) continue;
    if (!user.paymentFailures) break;
    const wasSuspendedForFailures = !user.active && user.paymentFailures >= PAYMENT_FAILURE_THRESHOLD;
    user.paymentFailures = 0;
    if (wasSuspendedForFailures) {
      user.active = true;
      console.log(`[premium] Accès réactivé après paiement réussi — sub: ${subId}`);
    }
    savePremiums();
    console.log(`[premium] Compteur d'échecs remis à zéro — sub: ${subId}`);
    break;
  }
}

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket.remoteAddress || 'unknown';
}

function today() {
  return new Date().toISOString().split('T')[0];
}

function getRecord(ip) {
  const d = today();
  const existing = usageStore.get(ip);
  if (existing && existing.date === d) return existing;
  // Nouveau jour → repart à zéro (crée un nouvel objet pour éviter les mutations fantômes)
  const fresh = { count: 0, date: d };
  usageStore.set(ip, fresh);
  return fresh;
}

// userId prioritaire sur IP : plus juste, résiste au partage d'IP (NAT, VPN scolaire)
function getUsageKey(ip, userId) {
  return userId ? `u:${userId}` : ip;
}

function checkUsage(ip, token, userId) {
  if (token) {
    const user = premiumUsers.get(token);
    if (user?.active) return { allowed: true, remaining: null, isPremium: true, plan: user.type };
  }
  const key       = getUsageKey(ip, userId);
  const record    = getRecord(key);
  const remaining = FREE_LIMIT - record.count;
  return { allowed: remaining > 0, remaining, isPremium: false };
}

function incrementUsage(ip, userId) {
  const key    = getUsageKey(ip, userId);
  const record = getRecord(key);
  record.count++;
}

// ============================================================
//  GAMIFICATION — logic in services/gamification.service.js
// ============================================================
const {
  BADGE_DEFS,
  MISSION_DEFS,
  MISSION_ALL_BONUS,
  getWeekKey,
  xpForLevel,
  getLevel,
  getStreakMultiplier,
  initGami,
  ensureGami,
  giveXP,
  computeXPGain,
  applyStreak,
  awardStreakShield,
  checkBadges,
  resetMissionsIfNeeded,
  checkAllMissionsBonus,
  buildMissionsPayload,
  buildGamiResponse,
  buildMotivational,
} = GamiService;

// Leaderboard cache is managed by services/leaderboard.service.js (disk-persistent)

// ============================================================
//  AUTH MIDDLEWARE
// ============================================================
function requireAuth(req, res, next) {
  const token = req.headers['x-auth-token'];
  if (!token) return res.status(401).json({ error: 'Connexion requise.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET || 'dev', { algorithms: ['HS256'] });
    if (TokenBlacklist.isBlacklisted(req.user))
      return res.status(401).json({ error: 'Session révoquée. Reconnecte-toi.' });
    next();
  } catch {
    res.status(401).json({ error: 'Session expirée. Reconnecte-toi.' });
  }
}

function optionalAuth(req, res, next) {
  const token = req.headers['x-auth-token'];
  if (token) {
    try { req.user = jwt.verify(token, JWT_SECRET || 'dev', { algorithms: ['HS256'] }); } catch {}
  }
  next();
}

// ============================================================
//  OPENAI HELPER
// ============================================================
async function callOpenAI(messages) {
  const providers = [
    { client: openai,          model: MODEL,                                   name: 'Groq',        jsonMode: true  },
    ...(geminiClient     ? [{ client: geminiClient,     model: 'models/gemini-2.5-flash',                   name: 'Gemini',      jsonMode: true  }] : []),
    ...(openrouterClient ? [{ client: openrouterClient, model: 'meta-llama/llama-3.3-70b-instruct:free',    name: 'OpenRouter',  jsonMode: false }] : []),
  ];

  let lastErr;
  for (const { client, model, name, jsonMode } of providers) {
    try {
      const params = { model, messages, max_tokens: 4096, temperature: 0.6 };
      if (jsonMode) params.response_format = { type: 'json_object' };
      const res = await client.chat.completions.create(params, { timeout: 20000 });
      if (name !== 'Groq') console.info(`[AI] fallback provider: ${name}`);
      return res;
    } catch (err) {
      lastErr = err;
      const isSkippable = (err instanceof OpenAI.APIError && (err.status === 429 || err.status === 503 || err.status === 400 || err.status === 404))
                       || err.name === 'APIConnectionTimeoutError'
                       || err.code  === 'ETIMEDOUT';
      if (isSkippable) { console.warn(`[AI] ${name} failed (${err.status ?? err.code}), trying next provider`); continue; }
      throw err;
    }
  }
  throw lastErr || new Error('All AI providers unavailable');
}

function formatOpenAIError(err) {
  const map = {
    invalid_api_key:        'Clé API invalide. Vérifiez OPENAI_API_KEY / GROQ_API_KEY dans .env.',
    insufficient_quota:     'Quota épuisé. Rechargez votre compte sur platform.openai.com/account/billing.',
    model_not_found:        `Modèle "${MODEL}" inaccessible. Essayez OPENAI_MODEL=gpt-4o-mini.`,
    rate_limit_exceeded:    'Trop de requêtes. Réessayez dans quelques secondes.',
    context_length_exceeded:'Texte trop long pour ce modèle. Raccourcissez votre cours.',
  };
  return map[err.code] || `Erreur IA ${err.status ?? '?'} : ${err.message}`;
}

// ============================================================
//  ROUTES
// ============================================================

// GET /dashboard — espace client
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// GET /api/config — expose la clé publique Stripe au frontend (sans risque)
app.get('/api/config', (req, res) => {
  res.json({
    stripePublicKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
    plans: {
      monthly:  { price: PRICE_MONTHLY  / 100, currency: 'EUR' },
      yearly:   { price: PRICE_YEARLY   / 100, currency: 'EUR' },
      lifetime: { price: PRICE_LIFETIME / 100, currency: 'EUR' },
    },
  });
});

// GET /api/admin/abuse-log — journal des abus (admin uniquement)
app.get('/api/admin/abuse-log', adminRateLimiter, requireSuperAdmin, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Accès refusé.' });
  auditAction(req, 'view_abuse_log');
  res.json({ log: AntiFraud.getAbuseLog() });
});

// GET /api/admin/analytics/realtime — snapshot analytics en temps réel (admin)
app.get('/api/admin/analytics/realtime', adminRateLimiter, requireSuperAdmin, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Accès refusé.' });
  auditAction(req, 'view_analytics');
  res.json(Analytics.getSnapshot());
});

// GET /api/admin/shadow-mode — liste des utilisateurs en shadow mode (admin)
app.get('/api/admin/shadow-mode', adminRateLimiter, requireSuperAdmin, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Accès refusé.' });
  auditAction(req, 'view_shadow_mode');
  res.json({ active: ShadowMode.listActive() });
});

// GET /api/admin/dlq — Dead Letter Queue contents (admin)
app.get('/api/admin/dlq', adminRateLimiter, requireSuperAdmin, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Accès refusé.' });
  auditAction(req, 'view_dlq');
  const dlq = DLQ.list(); res.json({ dlq, total: dlq.length });
});

// DELETE /api/admin/dlq/:id — remove a DLQ entry (admin)
app.delete('/api/admin/dlq/:id', adminRateLimiter, requireSuperAdmin, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Accès refusé.' });
  auditAction(req, 'delete_dlq_entry', { id: req.params.id });
  const removed = DLQ.remove(req.params.id);
  res.json({ ok: removed });
});

// GET /api/admin/health/full — full system health (admin)
app.get('/api/admin/health/full', adminRateLimiter, requireSuperAdmin, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Accès refusé.' });
  auditAction(req, 'view_health_full');
  const report = await HealthCheck.runFullCheck();
  res.json(report);
});

// ── Phase 6: Event Log admin endpoints ───────────────────────────────────────

// GET /api/admin/event-log — recent global events
app.get('/api/admin/event-log', adminRateLimiter, requireSuperAdmin, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Accès refusé.' });
  auditAction(req, 'view_event_log');
  const fromTs = parseInt(req.query.from) || 0;
  const count  = Math.min(parseInt(req.query.count) || 100, 1_000);
  const events = await EventLog.replayEvents(fromTs, count);
  res.json({ events, total: events.length });
});

// GET /api/admin/event-log/user/:userId — user event stream
app.get('/api/admin/event-log/user/:userId', adminRateLimiter, requireSuperAdmin, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Accès refusé.' });
  auditAction(req, 'view_user_event_stream', { targetUserId: req.params.userId });
  const events = await EventLog.getUserEventStream(req.params.userId, 0, 500);
  res.json({ userId: req.params.userId, events, total: events.length });
});

// POST /api/admin/event-log/replay — replay events for a userId or time range
app.post('/api/admin/event-log/replay', adminRateLimiter, requireSuperAdmin, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Accès refusé.' });
  const { type, userId, fromTs, weekStr } = req.body || {};

  auditAction(req, 'replay_events', { type, userId, weekStr });
  try {
    let result;
    if (type === 'leaderboard' && weekStr) {
      result = await ReplayEngine.replayLeaderboard(weekStr, { fromTs: fromTs || 0 });
    } else if (type === 'user_xp' && userId) {
      result = await ReplayEngine.replayUserXP(userId);
    } else if (type === 'user_streak' && userId) {
      result = await ReplayEngine.replayUserStreak(userId);
    } else if (type === 'referral_graph') {
      result = await ReplayEngine.replayReferralGraph();
    } else if (type === 'user_profile' && userId) {
      result = await ReplayEngine.replayUserProfile(userId);
    } else if (type === 'bus' && userId) {
      const replayed = await EventBus.replay(userId, fromTs || 0);
      result = { replayed, userId };
    } else {
      return res.status(400).json({ error: 'type invalide. Options: leaderboard|user_xp|user_streak|referral_graph|user_profile|bus' });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Erreur interne.' : err.message });
  }
});

// GET /api/admin/outbox — outbox queue status
app.get('/api/admin/outbox', adminRateLimiter, requireSuperAdmin, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Accès refusé.' });
  auditAction(req, 'view_outbox');
  res.json(await Outbox.getStatus());
});

// GET /api/admin/event-bus — bus subscriber info
app.get('/api/admin/event-bus', adminRateLimiter, requireSuperAdmin, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Accès refusé.' });
  auditAction(req, 'view_event_bus');
  res.json({
    subscribedTypes: EventBus.listSubscribedTypes(),
    memoryBuffer:    EventLog.getMemoryBuffer().length,
  });
});

// ── Phase 6: Anti-bot multi-layer admin endpoints ─────────────────────────────

// POST /api/admin/bot-simulate — run bot simulation suite
app.post('/api/admin/bot-simulate', adminRateLimiter, requireSuperAdmin, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Accès refusé.' });
  const { profiles, customHeaders } = req.body || {};
  auditAction(req, 'bot_simulate', { profiles: Array.isArray(profiles) ? profiles : [] });

  try {
    if (customHeaders) {
      res.json(BotSimulator.simulateCustom(customHeaders, 'custom'));
    } else {
      res.json(BotSimulator.runSimulation(profiles || undefined));
    }
  } catch (err) {
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Erreur interne.' : err.message });
  }
});

// POST /api/admin/challenge-route — compute challenge tier for given scores
app.post('/api/admin/challenge-route', adminRateLimiter, requireSuperAdmin, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Accès refusé.' });
  auditAction(req, 'challenge_route_test');
  const { botScore = 0, attestationScore = 0, behaviorScore = 0 } = req.body || {};
  const fakeReq = {
    _botScore:    botScore,
    _attestation: { attestationScore },
    _behavior:    { score: behaviorScore },
    _powMissing:  true,
    _powValid:    false,
  };
  const composite = ChallengeRouter.aggregateScore(fakeReq);
  const tier      = ChallengeRouter.routeChallenge(composite);
  const challenge = ChallengeRouter.issueChallenge(composite);
  res.json({ composite, tier, challenge });
});

// ── Security Status ───────────────────────────────────────────

// GET /api/admin/security-status — global security score + system state
app.get('/api/admin/security-status', adminRateLimiter, requireSuperAdmin, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Accès refusé.' });
  auditAction(req, 'view_security_status');

  const sm          = SafeMode.getStatus();
  const integrity   = FileIntegrity.getStatus();
  const backup      = AutoBackup.getStatus();
  const healthReport = await HealthCheck.runFullCheck().catch(() => ({ status: 'error' }));

  const abuseLog    = AntiFraud.getAbuseLog() || [];
  const shadow      = ShadowMode.listActive()  || [];

  // Simple security score: starts at 100, deduct for issues
  let score = 100;
  if (sm.active)                    score -= 20;
  if (integrity.alertCount > 0)     score -= 15;
  if (backup.errorCount > 0)        score -= 10;
  if (!process.env.SUPER_ADMIN_EMAIL) score -= 25;
  if (!process.env.JWT_SECRET)      score -= 20;
  if (!process.env.ADMIN_KEY)       score -= 5;
  score = Math.max(0, score);

  res.json({
    score,
    scoreLabel:      score >= 80 ? 'good' : score >= 60 ? 'warning' : 'critical',
    safeMode:        sm,
    integrity,
    backup,
    health:          healthReport,
    abuseEvents:     abuseLog.length,
    shadowModeUsers: shadow.length,
    botBlocked:      sm.totalBots,
    attacksDetected: sm.totalAttacks,
    superAdmin: {
      configured: !!process.env.SUPER_ADMIN_EMAIL,
      email:      process.env.SUPER_ADMIN_EMAIL
        ? process.env.SUPER_ADMIN_EMAIL.replace(/^(.{3}).*(@.*)$/, '$1***$2')
        : null,
    },
  });
});

// POST /api/admin/revoke-session — immediately revoke the caller's JWT
app.post('/api/admin/revoke-session', adminRateLimiter, requireSuperAdmin, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Accès refusé.' });

  if (req._adminAuth === 'jwt' && req._adminDec) {
    TokenBlacklist.blacklistToken(req._adminDec);
    auditAction(req, 'revoke_own_session', { iat: req._adminDec.iat });
    return res.json({ ok: true, message: 'Session révoquée. Reconnectez-vous.' });
  }
  res.json({ ok: false, message: 'Révocation uniquement applicable aux sessions JWT.' });
});

// POST /api/admin/revoke-user-sessions — revoke ALL sessions for a target email
app.post('/api/admin/revoke-user-sessions', adminRateLimiter, requireSuperAdmin, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Accès refusé.' });

  const { email } = req.body || {};
  if (!email || typeof email !== 'string')
    return res.status(400).json({ error: 'email requis.' });

  // Prevent revoking super admin's own sessions via this endpoint (use revoke-session instead)
  const superEmail = process.env.SUPER_ADMIN_EMAIL?.trim()?.toLowerCase();
  if (email.toLowerCase() === superEmail)
    return res.status(400).json({ error: 'Utilisez /revoke-session pour révoquer votre propre session.' });

  TokenBlacklist.revokeAllForEmail(email);
  auditAction(req, 'revoke_user_sessions', { targetEmail: email });
  res.json({ ok: true, message: `Toutes les sessions de ${email} révoquées.` });
});

// ── Backup admin endpoints ────────────────────────────────────

// GET /api/admin/backup — list available backups
app.get('/api/admin/backup', adminRateLimiter, requireSuperAdmin, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Accès refusé.' });
  auditAction(req, 'list_backups');
  res.json({ backups: AutoBackup.listBackups(), status: AutoBackup.getStatus() });
});

// POST /api/admin/backup — trigger manual backup
app.post('/api/admin/backup', adminRateLimiter, requireSuperAdmin, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Accès refusé.' });
  auditAction(req, 'manual_backup');
  const result = AutoBackup.runBackup();
  res.json(result);
});

// ── Safe mode admin endpoints ─────────────────────────────────

// GET /api/admin/safe-mode — safe mode status
// POST /api/admin/reset-usage — vide le compteur IP de génération (admin)
app.post('/api/admin/reset-usage', adminRateLimiter, requireSuperAdmin, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Accès refusé.' });
  const count = usageStore.size;
  usageStore.clear();
  auditAction(req, 'reset_usage');
  res.json({ message: `${count} compteur(s) IP réinitialisé(s).`, cleared: count });
});

app.get('/api/admin/safe-mode', adminRateLimiter, requireSuperAdmin, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Accès refusé.' });
  auditAction(req, 'view_safe_mode');
  res.json(SafeMode.getStatus());
});

// POST /api/admin/safe-mode — activate or deactivate safe mode manually
app.post('/api/admin/safe-mode', adminRateLimiter, requireSuperAdmin, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Accès refusé.' });
  const { action, reason } = req.body || {};

  if (action === 'activate') {
    SafeMode.forceActivate(reason || 'manual_admin');
    auditAction(req, 'safe_mode_activate', { reason });
    return res.json({ ok: true, status: SafeMode.getStatus() });
  }
  if (action === 'deactivate') {
    SafeMode.forceDeactivate();
    auditAction(req, 'safe_mode_deactivate');
    return res.json({ ok: true, status: SafeMode.getStatus() });
  }
  res.status(400).json({ error: 'action doit être "activate" ou "deactivate".' });
});

// ── Integrity admin endpoint ──────────────────────────────────

// GET /api/admin/integrity — file integrity status + manual check trigger
app.get('/api/admin/integrity', adminRateLimiter, requireSuperAdmin, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Accès refusé.' });
  auditAction(req, 'view_integrity');
  const alerts = FileIntegrity.runCheck();
  res.json({ ...FileIntegrity.getStatus(), recentAlerts: alerts });
});

// ── Observability pro (admin) ──────────────────────────────────

// GET /api/admin/analytics/funnel — funnel + conversion analytics
app.get('/api/admin/analytics/funnel', adminRateLimiter, requireSuperAdmin, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Accès refusé.' });
  auditAction(req, 'view_funnel_analytics');
  res.json(FunnelAnalytics.getSnapshot());
});

// GET /api/admin/analytics/latency — request latency percentiles p50/p95/p99
app.get('/api/admin/analytics/latency', adminRateLimiter, requireSuperAdmin, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Accès refusé.' });
  auditAction(req, 'view_latency');
  res.json(RequestTracer.getMetrics());
});

// GET /api/admin/retention — user retention analytics
app.get('/api/admin/retention', adminRateLimiter, requireSuperAdmin, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Accès refusé.' });
  auditAction(req, 'view_retention');
  res.json(Retention.getRetentionSnapshot());
});

// GET /api/admin/env — environment validation report
app.get('/api/admin/env', adminRateLimiter, requireSuperAdmin, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Accès refusé.' });
  auditAction(req, 'view_env_report');
  res.json(EnvValidator.getReport());
});

// POST /api/admin/funnel-event — manual funnel event ingestion (from frontend beacons)
app.post('/api/admin/funnel-event', adminRateLimiter, requireSuperAdmin, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Accès refusé.' });
  const { event, meta } = req.body || {};
  if (!event || typeof event !== 'string') return res.status(400).json({ error: 'event requis.' });
  FunnelAnalytics.track(event, meta || {});
  res.json({ ok: true });
});

// ── Funnel beacon — called from frontend (public, lightweight) ───

// POST /api/beacon — lightweight client-side event tracking
const beaconLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
app.post('/api/beacon', beaconLimiter, optionalAuth, (req, res) => {
  const { event, meta } = req.body || {};
  const allowed = ['page_land', 'generate_attempt', 'quiz_start', 'register_start',
                   'upgrade_click', 'checkout_start', 'rage_click', 'session_end'];
  if (!event || !allowed.includes(event)) return res.status(400).json({ error: 'event invalide.' });

  if (event === 'rage_click') {
    FunnelAnalytics.recordRageClick();
  } else if (event === 'session_end' && typeof meta?.durationMs === 'number') {
    FunnelAnalytics.recordSessionEnd(meta.durationMs);
  } else {
    FunnelAnalytics.track(event, { userId: req.user?.userId, ...meta });
  }
  res.status(204).end();
});

// ── Entitlements ──────────────────────────────────────────────

// GET /api/entitlements — current user's feature entitlements
app.get('/api/entitlements', optionalAuth, (req, res) => {
  const premToken = req.headers['x-premium-token'] || '';
  const premRec   = premToken ? premiumUsers?.get(premToken) : null;
  const isPremium = premRec?.active || false;
  res.json(Entitlements.publicSummary(req, isPremium));
});

// ── SEO: sitemap ──────────────────────────────────────────────

// GET /sitemap.xml — dynamic sitemap for public pages
app.get('/sitemap.xml', (req, res) => {
  const base    = process.env.SITE_URL?.trim()
    || `${req.protocol}://${req.get('host')}`;
  const today   = new Date().toISOString().split('T')[0];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${base}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${base}/privacy</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.4</priority>
  </url>
  <url>
    <loc>${base}/terms</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.4</priority>
  </url>
</urlset>`;
  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(xml);
});

// GET /api/challenge — issue adaptive challenge (PoW, PoW+interact, or CAPTCHA)
// Accepts optional ?bot=N&att=N&beh=N to issue a scored challenge (client passes its own score estimate)
const challengeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 60,
  message: { error: 'Trop de requêtes.' },
  skip: (req) => isAdmin(req),
});
app.get('/api/challenge', challengeLimiter, (req, res) => {
  // Simple PoW is the default; scores upgrade the challenge if sent by trusted clients
  res.json(PoW.issue());
});

// GET /api/health — réservé à l'admin en production
app.get('/api/health', async (req, res) => {
  // En production, restreindre aux admins pour ne pas exposer d'infos système
  if (process.env.NODE_ENV === 'production' && !isAdmin(req)) {
    return res.json({ status: 'ok' });
  }
  const key = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY;
  const report = {
    status: 'ok', provider: USE_GROQ ? 'Groq' : 'OpenAI',
    key_preview: key ? `${key.slice(0, 8)}... (${key.length} chars)` : '❌ MANQUANTE',
    model: MODEL, stripe: !!stripe, node: process.version,
    uptime: `${Math.floor(process.uptime())}s`, openai_test: null,
  };
  if (key) {
    try {
      await openai.models.list();
      report.openai_test = `✓ Connexion OK`;
    } catch (err) {
      report.openai_test = `❌ ${err.status ?? '?'}: ${err.message}`;
      report.status = 'degraded';
    }
  }
  res.json(report);
});

// GET /api/country — détecte le pays via IP et retourne les prix régionaux
// Priorité de détection :
//   1. Header Cloudflare CF-IPCountry (si derrière CF)
//   2. Headers Railway / Vercel / Fly.io
//   3. Accept-Language heuristique
//   4. ipapi.co géolocalisation IP (fallback réseau)
//   5. Défaut EUR
app.get('/api/country', async (req, res) => {
  res.set('Cache-Control', 'private, max-age=300'); // cache 5 min côté client

  // ── 1. Headers cloud (Cloudflare, Railway, Vercel, Fly) ──
  const cloudCountry =
    req.headers['cf-ipcountry'] ||
    req.headers['x-vercel-ip-country'] ||
    req.headers['fly-client-ip-country'] ||
    req.headers['x-country-code'] ||
    null;

  if (cloudCountry && cloudCountry !== 'XX' && cloudCountry.length === 2) {
    return res.json(getRegionalPricing(cloudCountry.toUpperCase()));
  }

  // ── 2. Accept-Language heuristique (approximatif, sans réseau) ──
  const LANG_TO_COUNTRY = {
    'pt-br':'BR','pt-BR':'BR','zh-cn':'CN','zh-CN':'CN','zh-tw':'TW',
    'ja':'JP','ko':'KR','ru':'RU','uk':'UA','pl':'PL',
    'hi':'IN','bn':'BD','ur':'PK','id':'ID','ms':'MY',
    'th':'TH','vi':'VN','ar':'SA','tr':'TR',
  };
  const acceptLang = req.headers['accept-language'] || '';
  for (const [tag, cc] of Object.entries(LANG_TO_COUNTRY)) {
    if (acceptLang.toLowerCase().startsWith(tag.toLowerCase())) {
      return res.json(getRegionalPricing(cc));
    }
  }

  // ── 3. Fallback : ipapi.co par IP ──
  const ip = getClientIP(req);
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === 'unknown';
  if (isLocal) return res.json(getRegionalPricing('FR'));

  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 3000);
    const r   = await fetch(`https://ipapi.co/${ip}/json/`, {
      headers: { 'User-Agent': 'StudyAI/1.0' },
      signal:  controller.signal,
    });
    const geo = await r.json();
    if (geo.error) throw new Error(geo.reason || 'ipapi error');
    res.json(getRegionalPricing(geo.country_code || 'XX'));
  } catch {
    res.json(getRegionalPricing('XX'));
  }
});

// Alias /api/pricing → même réponse (hook pour le front)
app.get('/api/pricing', (req, res) => res.redirect(307, '/api/country'));

// POST /api/register
app.post('/api/register',
  authLimiter,
  PoW.powMiddleware,
  Attestation.attestationMiddleware,
  BehaviorModel.behaviorMiddleware,
  ChallengeRouter.challengeRouterMiddleware,
  BotDetect.botDetectMiddleware,
  async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: 'Email et mot de passe requis.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
    return res.status(400).json({ error: 'Adresse email invalide.' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Mot de passe trop court (6 caractères minimum).' });
  if (password.length > 128)
    return res.status(400).json({ error: 'Mot de passe trop long.' });

  const users = loadJSON(USERS_FILE);
  const key   = email.toLowerCase().trim();
  if (users[key]) return res.status(409).json({ error: 'Cet email est déjà utilisé.' });

  const passwordHash = await bcrypt.hash(password, 12);
  const userId       = crypto.randomUUID();
  const fingerprint  = AntiFraud.deviceFingerprintV2(req); // V2: richer signal

  // Multi-account detection (monitor, not block)
  const fpConflict = Object.values(users).find(u => u._fingerprint === fingerprint);
  if (fpConflict) {
    AntiFraud.logAbuse('multi_account_suspected', { fingerprint, existingEmail: fpConflict.email, newEmail: key });
  }

  users[key] = { id: userId, email: key, passwordHash, createdAt: new Date().toISOString(), _fingerprint: fingerprint };
  saveJSON(USERS_FILE, users);

  const token = jwt.sign({ userId, email: key }, JWT_SECRET || 'dev', { expiresIn: '30d', algorithm: 'HS256' });

  GamiService.emitter.emit('USER_REGISTERED', { userId, email: key, hasReferral: false });
  FunnelAnalytics.track('register_success', { userId });
  Retention.recordActivity(userId);

  res.json({ token, user: { id: userId, email: key } });
});

// POST /api/login
app.post('/api/login',
  authLimiter,
  PoW.powMiddleware,
  Attestation.attestationMiddleware,
  BehaviorModel.behaviorMiddleware,
  ChallengeRouter.challengeRouterMiddleware,
  BotDetect.botDetectMiddleware,
  async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: 'Email et mot de passe requis.' });

  const users = loadJSON(USERS_FILE);
  const key   = email.toLowerCase().trim();
  const user  = users[key];

  if (!user || !(await bcrypt.compare(password, user.passwordHash)))
    return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });

  if (user.banned)
    return res.status(403).json({ error: 'Compte suspendu. Contacte le support.' });

  const token = jwt.sign({ userId: user.id, email: key }, JWT_SECRET || 'dev', { expiresIn: '30d', algorithm: 'HS256' });
  Retention.recordNewSession(user.id);
  res.json({ token, user: { id: user.id, email: key, username: user.username || null } });
});

// GET /api/me
app.get('/api/me', requireAuth, (req, res) => {
  const content = loadJSON(CONTENT_FILE, {});
  const history = (content[req.user.userId] || []).slice(-20).reverse();
  const users   = loadJSON(USERS_FILE, {});
  const profile = users[req.user.email] || {};
  res.json({ user: { id: req.user.userId, email: req.user.email, username: profile.username || null, premium: !!profile.premium }, history });
});

// GET /api/history
app.get('/api/history', requireAuth, (req, res) => {
  const content = loadJSON(CONTENT_FILE, {});
  const history = (content[req.user.userId] || []).slice(-50).reverse();
  res.json({ history });
});

// POST /api/quiz-result — sauvegarde le score + met à jour la gamification
app.post('/api/quiz-result', requireAuth, (req, res) => {
  let { contentId, score, total, wrongConcepts, correctByDifficulty } = req.body || {};
  if (!contentId || score === undefined || !total)
    return res.status(400).json({ error: 'contentId, score et total requis.' });

  // Deep input validation — rejects score injection and impossible values
  const inputCheck = AntiFraud.validateQuizInput(score, total, correctByDifficulty);
  if (!inputCheck.ok) {
    AntiFraud.logAbuse('invalid_quiz_input', { reason: inputCheck.reason, userId: req.user.userId, score, total });
    return res.status(400).json({ error: 'Données de quiz invalides.' });
  }

  // Clamp score to [0, total] as final safety net
  score = Math.max(0, Math.min(parseInt(score) || 0, parseInt(total)));

  // 1. Sauvegarde du résultat dans content.json
  const content     = loadJSON(CONTENT_FILE, {});
  const userContent = content[req.user.userId] || [];
  const item        = userContent.find(c => c.id === contentId);
  if (!item) return res.status(404).json({ error: 'Contenu introuvable.' });

  item.quizResult = {
    score, total,
    wrongConcepts: Array.isArray(wrongConcepts) ? wrongConcepts.slice(0, 20) : [],
    completedAt: new Date().toISOString(),
  };
  content[req.user.userId] = userContent;
  saveJSON(CONTENT_FILE, content);

  // 2. Statut premium (multiplier XP x2 + badge Founder)
  const premTokenVal  = req.headers['x-premium-token'] || '';
  const premRecord    = premTokenVal ? premiumUsers.get(premTokenVal) : null;
  const isPremium     = premRecord?.active || false;
  const premiumPlan   = isPremium ? premRecord.type : null;
  const xpMultiplier  = isPremium ? 2 : 1;

  // 3. Gamification — met à jour XP, streak, badges
  const users = loadJSON(USERS_FILE);
  const uKey  = req.user.email;
  const user  = users[uKey];
  if (!user) return res.json({ ok: true });

  ensureGami(user);
  const gami = user.gamification;

  // Anti-farming: cooldown + daily cap
  const cooldownCheck = AntiFraud.checkQuizCooldown(gami);
  if (!cooldownCheck.ok) {
    return res.status(429).json({ error: `Attends encore ${cooldownCheck.retryAfter}s avant le prochain quiz.` });
  }
  const dailyCheck = AntiFraud.checkDailyQuizLimit(gami);
  if (!dailyCheck.ok) {
    AntiFraud.logAbuse('daily_quiz_limit_hit', { userId: req.user.userId });
    return res.status(429).json({ error: 'Limite quotidienne de quiz atteinte. Reviens demain !' });
  }

  const ctx = { userId: req.user.userId, email: req.user.email, source: 'quiz' };
  const isFirstToday = applyStreak(gami, ctx);
  gami.totalQuizzes  = (gami.totalQuizzes || 0) + 1;
  if (score === total) gami.perfectQuizzes = (gami.perfectQuizzes || 0) + 1;

  // XP de base selon difficultés
  const xpGain = computeXPGain(score, total, gami.streak, isFirstToday, correctByDifficulty);

  // Multiplicateur combiné : premium × streak (cap ×4)
  const strMult   = getStreakMultiplier(gami.streak);
  const totalMult = Math.min(4, xpMultiplier * strMult);
  if (totalMult > 1) {
    xpGain.base    = Math.round(xpGain.base    * totalMult);
    xpGain.perfect = Math.round(xpGain.perfect * totalMult);
    xpGain.multiplier = totalMult;
    if (strMult > 1) xpGain.streakMultiplier = strMult;
    xpGain.total   = xpGain.base + xpGain.perfect + xpGain.streakBonus + xpGain.daily;
  }

  // ── Adaptive XP factor (4-tier: normal / shadow / degraded / block) ──────────
  // Priority: shadow mode store > bot tier from current request.
  // Shadow mode is sticky (24h); bot tier is per-request.
  const shadowFactor  = ShadowMode.getShadowFactor(req.user.userId);
  const botTier       = req._botTier || 'normal'; // set by botDetectMiddleware if on this route
  const botXPFactor   = BotDetect.xpFactorForTier(botTier);
  const effectiveFactor = Math.min(shadowFactor, botXPFactor); // most restrictive wins

  if (effectiveFactor < 1) {
    xpGain.total   = Math.round(xpGain.total   * effectiveFactor);
    xpGain.base    = Math.round(xpGain.base    * effectiveFactor);
    xpGain.perfect = Math.round(xpGain.perfect * effectiveFactor);
  }

  // Evaluate risk for shadow mode promotion (uses all signals, non-blocking)
  const riskCheck = AntiFraud.computeRiskScore(user, req, loadJSON(USERS_FILE));
  ShadowMode.evaluateForShadow(req.user.userId, riskCheck.score, req._botScore || 0);

  const oldXP = gami.xp || 0;
  giveXP(gami, xpGain.total, ctx); // XP_GAINED fires here → handler does incremental leaderboard update
  const oldLevel = getLevel(oldXP);
  const newLevel = gami.level;

  // ── Missions quotidiennes ──────────────────────────────────
  resetMissionsIfNeeded(gami);
  const dm = gami.dailyMissions;
  const completedMissions = [];

  if (!dm.quiz) {
    dm.quiz = true;
    giveXP(gami, MISSION_DEFS.quiz.xp, { ...ctx, source: 'mission_quiz' });
    completedMissions.push({ id: 'quiz', ...MISSION_DEFS.quiz });
  }

  dm.reviewCount = (dm.reviewCount || 0) + (score || 0);
  if (!dm.reviewDone && dm.reviewCount >= 3) {
    dm.reviewDone = true;
    giveXP(gami, MISSION_DEFS.review.xp, { ...ctx, source: 'mission_review' });
    completedMissions.push({ id: 'review', ...MISSION_DEFS.review });
  }

  const allBonus = checkAllMissionsBonus(gami, ctx);
  if (allBonus > 0) completedMissions.push({ id: 'all_done', icon: '🎯', label: 'Toutes les missions !', xp: allBonus });

  const newBadges = checkBadges(gami, premiumPlan);

  // Record completion for anti-farming tracking
  AntiFraud.recordQuizCompletion(gami, xpGain.total);

  users[uKey] = user;
  saveJSON(USERS_FILE, users);
  // Note: leaderboard cache is kept fresh by the XP_GAINED event handler (incremental update).
  // No explicit invalidate() needed — full recompute happens naturally after TTL (5 min).

  const xpNeeded  = 100;
  const xpCurrent = gami.xp % 100;
  const levelUp   = gami.level > oldLevel;

  // Publish via BullMQ if available, otherwise falls back to direct EventEmitter emit
  Publisher.enqueue('QUIZ_COMPLETED', {
    userId:        req.user.userId,
    email:         req.user.email,
    score, total,
    streak:        gami.streak,
    levelUp,
    newLevel:      gami.level,
    newBadgeCount: newBadges.length,
  }).catch(() => {});

  res.json({
    ok: true,
    xpGain,
    totalXP:  gami.xp,
    level:    gami.level,
    levelUp,
    streak:   gami.streak,
    streakMultiplier: strMult,
    newBadges:newBadges.map(id => ({ id, ...BADGE_DEFS[id] })),
    completedMissions,
    missions: buildMissionsPayload(gami.dailyMissions),
    progress: { current: xpCurrent, needed: xpNeeded, pct: xpCurrent },
    motivational: buildMotivational(xpCurrent, xpNeeded, gami.level, gami.streak),
  });
});

// GET /api/gamification — profil gamification de l'utilisateur
app.get('/api/gamification', requireAuth, (req, res) => {
  const users = loadJSON(USERS_FILE);
  const user  = users[req.user.email];
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });

  const wasNew = !user.gamification;
  ensureGami(user);
  const gami = user.gamification;

  resetMissionsIfNeeded(gami);

  // Save on first init so the profile is not lost
  if (wasNew) saveJSON(USERS_FILE, users);

  res.json(buildGamiResponse(gami));
});

// GET /api/daily-missions — état des missions du jour
app.get('/api/daily-missions', requireAuth, (req, res) => {
  const users = loadJSON(USERS_FILE);
  const uKey  = req.user.email;
  const user  = users[uKey];
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  ensureGami(user);
  const gami = user.gamification;
  resetMissionsIfNeeded(gami);
  saveJSON(USERS_FILE, users);
  const streakWarning = (gami.streak || 0) > 0 && gami.lastActiveDate !== today();
  res.json({
    ...buildMissionsPayload(gami.dailyMissions),
    streak:          gami.streak || 0,
    streakMultiplier:getStreakMultiplier(gami.streak),
    streakWarning,
  });
});

// GET /api/leaderboard — classement hebdomadaire (top 10 XP cette semaine)
// Priority: Redis sorted set → local persistent cache → full recompute from users.json
app.get('/api/leaderboard', requireAuth, async (req, res) => {
  const thisWeek = getWeekKey();

  // 1. Try Redis via HA client (circuit-breaker protected)
  const redisEntries = await HARedis.safeGetTopN(thisWeek, 10);
  if (redisEntries) {
    const out = redisEntries.map(e => ({ ...e, isMe: e._userId === req.user.userId }))
                            .map(({ _userId, ...rest }) => rest);
    return res.json({ entries: out, week: thisWeek, source: 'redis' });
  }

  // 2. Local persistent cache (survives restart)
  const cached = LeaderboardService.get(thisWeek);
  if (cached) {
    const entries = cached.map(e => ({ ...e, isMe: e._userId === req.user.userId }))
                          .map(({ _userId, ...rest }) => rest);
    return res.json({ entries, week: thisWeek, source: 'cache' });
  }

  // 3. Full recompute from users.json (cache miss)
  const users   = loadJSON(USERS_FILE);
  const entries = Object.values(users)
    .filter(u => u.gamification?.weeklyReset === thisWeek && (u.gamification?.weeklyXP || 0) > 0)
    .map(u => ({
      _userId:  u.id,
      label:    u.email.replace(/^(.{2}).*?(@.*)$/, '$1…$2'),
      level:    u.gamification.level || 1,
      weeklyXP: u.gamification.weeklyXP || 0,
      streak:   u.gamification.streak || 0,
    }))
    .sort((a, b) => b.weeklyXP - a.weeklyXP)
    .slice(0, 10);

  LeaderboardService.update(entries, thisWeek);

  // Back-fill Redis with full recompute result (fire-and-forget)
  entries.forEach(e => {
    RedisLB.setXP(thisWeek, e._userId, e.label, e.weeklyXP, e.level, e.streak).catch(() => {});
  });

  const out = entries.map(e => ({ ...e, isMe: e._userId === req.user.userId }))
                     .map(({ _userId, ...rest }) => rest);
  res.json({ entries: out, week: thisWeek, source: 'recompute' });
});

// ============================================================
//  REFERRAL — viral loop
// ============================================================

// GET /api/referral/info/:code — public, returns referrer first name for invite page
app.get('/api/referral/info/:code', (req, res) => {
  const code = (req.params.code || '').trim().toUpperCase().slice(0, 10);
  if (!code) return res.json({ found: false });
  const users = loadJSON(USERS_FILE);
  const entry = Object.entries(users).find(([, u]) => u.referral?.code === code);
  if (!entry) return res.json({ found: false });
  const [email] = entry;
  const rawName  = email.split('@')[0].split(/[._-]/)[0];
  const firstName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
  res.json({ found: true, firstName });
});

// GET /api/referral — code + stats du parrainage
app.get('/api/referral', requireAuth, (req, res) => {
  const users = loadJSON(USERS_FILE);
  const user  = users[req.user.email];
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  ReferralService.ensureReferralCode(user);
  saveJSON(USERS_FILE, users);
  const host = req.get('host');
  const proto = req.protocol;
  res.json({
    ...ReferralService.getReferralStats(user),
    shareUrl:  `${proto}://${host}/invite/${user.referral.code}`,
    shareUrlLegacy: `${proto}://${host}/?ref=${user.referral.code}`,
  });
});

// POST /api/referral/claim — réclame un parrainage après inscription
app.post('/api/referral/claim', referralClaimLimiter, requireAuth, (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'code requis.' });

  const users  = loadJSON(USERS_FILE);
  const result = ReferralService.claimReferral(users, req.user.email, code);

  if (!result.ok) return res.json({ ok: false, reason: result.error });

  // XP filleul (+50)
  const newUser = users[req.user.email];
  if (newUser) {
    ensureGami(newUser);
    giveXP(newUser.gamification, result.xpBonus, { userId: req.user.userId, email: req.user.email, source: 'referral_new' });
  }

  // L1: XP parrain (+50) + shield — handled by claimReferral result
  // L2/L3: multi-level chain rewards (shield for L2, premium trial for L3)
  const referrer = users[result.referrerEmail];
  if (referrer) {
    ensureGami(referrer);
    giveXP(referrer.gamification, result.xpBonus, { source: 'referral_l1' });
    awardStreakShield(referrer.gamification);
  }

  const chainRewards = ReferralGraph.computeChainRewards(users, req.user.email);
  // Skip L1 (already applied above); apply L2+ only
  const upperChain = chainRewards.filter(r => r.level > 1);
  if (upperChain.length > 0) {
    ReferralGraph.applyChainRewards(users, upperChain, { giveXP, ensureGami, awardStreakShield });
  }

  saveJSON(USERS_FILE, users);

  Publisher.enqueue('REFERRAL_COMPLETED', {
    referrerEmail: result.referrerEmail,
    newUserEmail:  req.user.email,
    xpBonus:       result.xpBonus,
    chainLevels:   chainRewards.length,
  }).catch(() => {});

  res.json({ ok: true, xpBonus: result.xpBonus });
});

// POST /api/consolidation-quiz — génère 5 questions ciblées sur les points faibles
app.post('/api/consolidation-quiz', requireAuth, consolidationLimiter, async (req, res) => {
  const { wrongConcepts, topic } = req.body || {};
  if (!Array.isArray(wrongConcepts) || wrongConcepts.length === 0)
    return res.status(400).json({ error: 'wrongConcepts requis.' });

  const conceptsList = wrongConcepts.slice(0, 10).join('\n- ');
  const topicLine    = topic ? ` sur le thème "${topic.slice(0, 100)}"` : '';

  const prompt = `Tu es un tuteur pédagogique expert. L'étudiant a eu des difficultés${topicLine} sur ces concepts précis :
- ${conceptsList}

Génère EXACTEMENT 5 questions MCQ ciblées pour consolider ces points faibles.
Réponds UNIQUEMENT avec un tableau JSON valide, sans markdown, sans texte autour.
Format :
[
  { "type": "mcq", "difficulty": 2, "question": "...", "options": ["A","B","C","D"], "answer": 0, "explanation": "..." }
]
Règles :
- Chaque question cible directement l'un des concepts manqués
- Les 3 mauvaises réponses sont des erreurs fréquentes et plausibles
- L'explication corrige l'erreur commune ET ancre le bon concept`;

  try {
    const completion = await callOpenAI([
      { role: 'system', content: 'Tu génères uniquement du JSON valide, sans markdown.' },
      { role: 'user',   content: prompt },
    ]);
    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) throw new Error('Réponse vide.');

    let questions;
    try { questions = JSON.parse(raw); }
    catch {
      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) throw new Error('Format JSON invalide.');
      questions = JSON.parse(match[0]);
    }
    if (!Array.isArray(questions)) throw new Error('Tableau attendu.');

    res.json({ questions: questions.slice(0, 5) });
  } catch (err) {
    if (err instanceof OpenAI.APIError) {
      return res.status(502).json({ error: formatOpenAIError(err) });
    }
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Erreur interne.' : err.message });
  }
});

// GET /api/stats — statistiques personnalisées de l'utilisateur connecté
app.get('/api/stats', requireAuth, (req, res) => {
  const content     = loadJSON(CONTENT_FILE, {});
  const userContent = content[req.user.userId] || [];

  const completed = userContent.filter(c => c.quizResult);
  const totalSessions   = userContent.length;
  const completedQuizzes = completed.length;

  const averageScore = completedQuizzes === 0 ? null
    : Math.round(completed.reduce((sum, c) => sum + (c.quizResult.score / c.quizResult.total), 0) / completedQuizzes * 100);

  // Concepts les plus souvent ratés
  const conceptCount = {};
  completed.forEach(c => {
    (c.quizResult.wrongConcepts || []).forEach(concept => {
      conceptCount[concept] = (conceptCount[concept] || 0) + 1;
    });
  });
  const weakAreas = Object.entries(conceptCount)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([concept]) => concept);

  // Tendance : 5 derniers scores en %
  const trend = completed.slice(-5).map(c =>
    Math.round(c.quizResult.score / c.quizResult.total * 100)
  );

  res.json({ totalSessions, completedQuizzes, averageScore, weakAreas, trend });
});

// GET /api/usage
app.get('/api/usage', optionalAuth, (req, res) => {
  if (isAdmin(req)) return res.json({ allowed: true, remaining: null, isPremium: true });
  const ip     = getClientIP(req);
  const token  = req.headers['x-premium-token'] || '';
  const userId = req.user?.userId || null;
  res.json(checkUsage(ip, token, userId));
});

// POST /api/generate
app.get('/api/generate', (req, res) => {
  res.status(405).json({ error: 'Cette route doit être appelée en POST, pas en GET.' });
});
app.post('/api/generate', optionalAuth, async (req, res) => {
  const admin  = isAdmin(req);
  const ip     = getClientIP(req);
  const token  = req.headers['x-premium-token'] || '';
  const userId = req.user?.userId || null;
  const usage  = admin ? { allowed: true, remaining: null, isPremium: true } : checkUsage(ip, token, userId);

  if (!usage.allowed) {
    return res.status(429).json({ error: 'limit_reached',
      message: 'Limite quotidienne atteinte (6/jour). Passez Premium pour un accès illimité.' });
  }

  const { text, country, lang } = req.body;
  if (!text || text.trim().length < 10)
    return res.status(400).json({ error: 'Écris au moins quelques mots pour que je puisse t\'aider.' });
  if (text.length > 20000)
    return res.status(400).json({ error: 'Texte trop long (maximum 20 000 caractères).' });

  const curriculumLine = buildCurriculumCtx(country)
    ? `\n- Système éducatif : ${buildCurriculumCtx(country)} — adapte les exemples et le niveau.`
    : '';

  const LANG_NAMES_EN = {
    fr: 'French', en: 'English', es: 'Spanish', de: 'German',
    pt: 'Portuguese', 'pt-BR': 'Brazilian Portuguese',
    it: 'Italian', zh: 'Chinese (Simplified)', ja: 'Japanese',
    ko: 'Korean', id: 'Indonesian', ar: 'Arabic', tr: 'Turkish',
    th: 'Thai', nl: 'Dutch', ru: 'Russian', pl: 'Polish',
    vi: 'Vietnamese', hi: 'Hindi', uk: 'Ukrainian',
  };
  const langName = LANG_NAMES_EN[lang] || 'French';

  // ── Subject detection (multilingual) ──────────────────────────────────────
  const subjectInfo = detectSubject(text, lang);
  const detectedCat = subjectInfo.category;    // e.g. 'history', 'math', 'general'
  const allowsMath  = subjectInfo.allowsMath;  // true | false | null (general)

  // ── Intent detection ───────────────────────────────────────────────────────
  const EXAM_RE = /\b(exam|examen|exams|test|tests|évaluation|evaluation|contrôle|controle|bac\b|finals|midterm|prüfung|pruefung|exame|esame|ujian|sınav|sinav|toets|egzamin|іспит|экзамен|परीक्षा|สอบ|امتحان|시험|試験|考試|考试)\b/i;
  const HOMEWORK_RE = /\b(devoir|devoirs|dm\b|ds\b|homework|assignment|hausaufgabe|hausaufgaben|tarea|tareas|deberes|compito|compiti|huiswerk|opgave|praca domowa|домашнее задание|домашнє завдання|ДЗ\b|作业|宿題|숙제|واجب|गृहकार्य|bài tập|ödev|domácí úkol|läxa|temă|exercice à rendre|travail à rendre|remettre|à rendre|due date|à compléter)\b/i;
  const isExamMode     = EXAM_RE.test(text);
  const isHomeworkMode = !isExamMode && HOMEWORK_RE.test(text);

  // ── Subject-specific exam section templates ───────────────────────────────
  const SUBJECT_SECTION_GUIDES = {
    history:         `🔑 Key dates, events, figures & causes — NOT formulas\n💡 Model essay plan or source analysis (intro→arg1→arg2→conclusion)`,
    philosophy:      `🔑 Core concepts, key arguments, thinkers & texts — NOT equations\n💡 Model philosophical essay: thesis → supported argument → counter-argument → conclusion`,
    literature:      `🔑 Themes, literary devices, key quotes, context — NOT calculations\n💡 Model literary analysis: intro → textual evidence → device → interpretation → link to theme`,
    geography:       `🔑 Key concepts, maps, data facts, processes — NOT calculus\n💡 Model case study answer: context → process → impact → evaluation`,
    law:             `🔑 Key articles, legal principles, jurisprudence — NOT equations\n💡 Model legal analysis: rule → application → case law → conclusion`,
    language_learning:`🔑 Grammar rules, vocabulary lists, common errors — NOT math\n💡 Model grammar exercise with full annotation`,
    biology:         `🔑 Key processes, structures, mechanisms — minimal math, no calculus\n💡 Model diagram explanation or biological process walkthrough`,
    economics:       `🔑 Economic concepts, theories, definitions — light stats OK, no calculus\n💡 Model economic analysis with supply/demand reasoning`,
    math:            `🔑 Formulas, theorems, derivation steps\n💡 Fully worked calculation, every algebraic step shown`,
    physics:         `🔑 Laws, formulas, constants, units\n💡 Fully worked physics problem with numerical answer`,
    chemistry:       `🔑 Equations, reaction types, periodic table facts\n💡 Balanced reaction with mechanisms`,
    computer_science:`🔑 Concepts, algorithms, data structures\n💡 Pseudocode or code snippet with explanation`,
    medicine:        `🔑 Anatomy, physiology, pathology mechanisms, clinical signs — NOT math formulas\n💡 Model clinical case: presentation → diagnosis → pathophysiology → treatment`,
    general:         `🔑 Key concepts and rules relevant to this subject\n💡 One complete exam-style question with model answer`,
  };

  // ── Math prohibition block (injected for non-math subjects) ───────────────
  const MATH_PROHIBITION = allowsMath === false ? `
🚫 ABSOLUTE PROHIBITION — THIS IS A ${detectedCat.toUpperCase()} SUBJECT:
- NEVER write any mathematical formula (f'(x), ∫, Σ, LaTeX, etc.)
- NEVER use derivative, integral, trigonometry, algebra notation
- NEVER produce content appropriate for a math/science exam
- If you feel tempted to write a formula: STOP — replace with dates, quotes, arguments, or definitions instead
- Violation of this rule = complete failure of the task
` : '';

  const BASE_INSTRUCTIONS = `LANGUAGE — ABSOLUTE RULE: You are writing for a ${langName}-speaking student.
Every single character you produce — summary sentences, flashcard text, questions, answer options, explanations, section headers — MUST be written in ${langName}.
Do NOT copy any English phrase from this system prompt into your output. Zero English words in the JSON. Any English in the output = task failed.

You are StudyAI, an elite AI tutor combining Feynman technique, Bloom's taxonomy, and spaced repetition.
${MATH_PROHIBITION}
DETECTED SUBJECT: ${detectedCat} — ALL content must be relevant to THIS subject.

INPUT: The student may send course notes OR a short command.
If it is a short command, generate a complete study package from your knowledge on that exact topic. NEVER refuse.

OUTPUT — respond ONLY with valid JSON, no markdown, no extra text:
{
  "mode": "full",
  "summary": "...",
  "flashcard": ["..."],
  "quiz": [{ "type": "mcq", "difficulty": 1, "question": "...", "options": ["A","B","C","D"], "answer": 0, "explanation": "..." }]
}

MCQ QUALITY (mandatory):
- Wrong options = plausible common mistakes, NEVER absurd
- Explanation: explain in ${langName} why the correct answer is right, then why each wrong option is incorrect
- For open questions: expectedAnswer = complete model answer in ${langName}${curriculumLine}`;

  const STANDARD_INSTRUCTIONS = `

SUMMARY (10-14 lines, use \\n between lines):
▸ Open with the single most important concept of this topic — write naturally in ${langName}, no English labels
▸ Explain step by step in clear full sentences adapted to ${detectedCat}
▸ Include 1-2 real-world analogies
▸ Use natural transitions in ${langName}
▸ End with one typical mistake students make — written naturally in ${langName}

FLASHCARDS — exactly 8 items, each entirely in ${langName}:
Each item: key concept/term — clear definition with a concrete example
Order: fundamental → nuanced

QUIZ — exactly 10 questions relevant to ${detectedCat}:
Q1-Q3: type "mcq", difficulty 1
Q4-Q7: type "mcq", difficulty 2
Q8-Q9: type "mcq", difficulty 3
Q10:   type "open", difficulty 3`;

  const sectionGuide = SUBJECT_SECTION_GUIDES[detectedCat] || SUBJECT_SECTION_GUIDES.general;

  const EXAM_INSTRUCTIONS = `

You are generating an EXAM PREPARATION PACKAGE for the subject: ${detectedCat.toUpperCase()}.
The student needs to be fully ready for their ${detectedCat} exam.
Every single item you generate MUST be relevant to ${detectedCat} — not to any other subject.
${MATH_PROHIBITION}
SUMMARY — structured exam sheet, use \\n between lines, \\n\\n between sections.
Write EXACTLY 4 sections. Each section header must be written in ${langName} — translate these:
  📌 Essential Theory
  🔑 Key Points
  ⚠️ Classic Mistakes
  🎯 What The Examiner Looks For

📌 (header in ${langName})
4-6 sentences: essential theory for THIS ${detectedCat} topic. Precise, exam-ready, entirely in ${langName}.

🔑 (header in ${langName})
[These are topics to cover — write all content in ${langName}, do not copy English words]:
${sectionGuide}
For each item: name — definition/value — when to use. All in ${langName}.

⚠️ (header in ${langName})
5 concrete mistakes students lose marks on in ${detectedCat} exams. Write each in ${langName}.

🎯 (header in ${langName})
4 specific criteria that earn full marks. What separates 10/10 from 6/10. All in ${langName}.

FLASHCARDS — exactly 12 items, exam-focused on ${detectedCat}, each entirely in ${langName}:
Each item: concept/date/rule — context/situation — error to avoid

QUIZ — exactly 15 questions, all about ${detectedCat}:
Q1-Q3:   type "mcq", difficulty 1
Q4-Q8:   type "mcq", difficulty 2
Q9-Q12:  type "mcq", difficulty 3
Q13-Q14: type "mcq", difficulty 3
Q15:     type "open", difficulty 3`;

  const HOMEWORK_INSTRUCTIONS = `

You are generating a HOMEWORK HELP PACKAGE for the subject: ${detectedCat.toUpperCase()}.
The student has a homework assignment and needs to truly understand the concept — not just copy an answer.
${MATH_PROHIBITION}
SUMMARY — clear homework guide, use \\n between lines, \\n\\n between sections.
Write EXACTLY 3 sections with headers translated into ${langName}:
  📖 Concept Explained
  ✏️ Step-by-Step Example
  ⚠️ Common Mistakes

📖 (header in ${langName})
5-6 sentences: clear explanation of the core concept in plain language. Use a concrete analogy from everyday life.
No jargon — explain it as you would to a friend.

✏️ (header in ${langName})
2 fully worked examples related to the homework topic.
Show EVERY intermediate step. Format: Étape 1 → Étape 2 → Résultat (translated to ${langName}).
For each step, explain WHY you do it, not just WHAT.

⚠️ (header in ${langName})
3 concrete mistakes students make on this type of homework. For each:
❌ The mistake → ✅ What to do instead → 💡 Why it matters

FLASHCARDS — exactly 8 items, directly useful for this homework:
Each item: rule/formula/key concept — how to apply it — concrete mini-example

QUIZ — exactly 5 practice problems to verify understanding before submitting:
Q1-Q2: type "mcq", difficulty 1 — basic comprehension
Q3-Q4: type "mcq", difficulty 2 — application
Q5:    type "open", difficulty 2 — ask them to solve a problem similar to their homework, with a complete model answer`;

  let intentMode = 'standard';
  if (isExamMode)     intentMode = 'exam';
  if (isHomeworkMode) intentMode = 'homework';

  const systemPrompt = BASE_INSTRUCTIONS + (
    intentMode === 'exam'     ? EXAM_INSTRUCTIONS     :
    intentMode === 'homework' ? HOMEWORK_INSTRUCTIONS :
                                STANDARD_INSTRUCTIONS
  );


  try {
    const completion = await callOpenAI([
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: text },
    ]);

    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) throw new Error('Réponse vide de l\'IA.');

    let result;
    try { result = JSON.parse(raw); }
    catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('La réponse IA n\'est pas au format JSON.');
      result = JSON.parse(match[0]);
    }

    if (!result.summary || !Array.isArray(result.flashcard) || !Array.isArray(result.quiz))
      throw new Error('Réponse IA incomplète. Réessaie.');

    if (!admin && !usage.isPremium) incrementUsage(ip, userId);
    const remaining = (admin || usage.isPremium) ? null : checkUsage(ip, token, userId).remaining;

    // Funnel + retention tracking (fire-and-forget, never blocks response)
    FunnelAnalytics.track('generate_success', { userId: req.user?.userId, isPremium: usage.isPremium });
    if (req.user?.userId) Retention.recordActivity(req.user.userId);

    // Sauvegarde + XP génération si connecté
    const contentId = crypto.randomUUID();
    if (req.user) {
      const users = loadJSON(USERS_FILE);
      const uKey  = req.user.email;  // clé canonique = email
      if (users[uKey]) {
        if (!users[uKey].gamification) users[uKey].gamification = initGami();
        const g = users[uKey].gamification;
        const genCtx = { userId: req.user.userId, email: req.user.email, source: 'generate' };
        applyStreak(g, genCtx);
        // XP génération de base
        giveXP(g, usage.isPremium ? 10 : 5, genCtx);
        // Mission "générer 1 fiche"
        resetMissionsIfNeeded(g);
        if (!g.dailyMissions.generate) {
          g.dailyMissions.generate = true;
          giveXP(g, MISSION_DEFS.generate.xp);
          checkAllMissionsBonus(g);
        }
        // Garantit que l'utilisateur a un code referral
        ReferralService.ensureReferralCode(users[uKey]);
        saveJSON(USERS_FILE, users);
      }
    }
    if (req.user) {
      const content     = loadJSON(CONTENT_FILE, {});
      const userContent = content[req.user.userId] || [];
      userContent.push({
        id:         contentId,
        createdAt:  new Date().toISOString(),
        topic:      text.slice(0, 100),
        mode:       result.mode || 'full',
        summary:    result.summary,
        flashcard:  result.flashcard,
        quiz:       result.quiz,
        quizResult: null,
      });
      if (userContent.length > 50) userContent.splice(0, userContent.length - 50);
      content[req.user.userId] = userContent;
      saveJSON(CONTENT_FILE, content);
    }

    return res.json({
      contentId,
      mode: result.mode || 'full',
      summary: result.summary, flashcard: result.flashcard, quiz: result.quiz,
      remaining,
      isPremium: admin || usage.isPremium,
    });

  } catch (err) {
    if (err instanceof OpenAI.APIError) {
      console.error(`[OpenAI] ${err.status} ${err.code}:`, err.message);
      return res.status(502).json({ error: formatOpenAIError(err) });
    }
    console.error('[generate]', err.message);
    return res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Erreur interne.' : err.message });
  }
});

// ============================================================
//  STRIPE — 2 PLANS
// ============================================================

function stripeNotConfigured(res) {
  console.error('[Stripe] STRIPE_SECRET_KEY manquante dans .env');
  return res.status(503).json({ error: 'Paiement non disponible. Contactez le support.' });
}

// ============================================================
//  STRIPE SESSION — multi-devise, payment methods automatiques
// ============================================================
const PLAN_META = {
  monthly:  { name: 'StudyAI Premium',        desc: 'Accès illimité · Sans engagement',          recurring: { interval: 'month' } },
  yearly:   { name: 'StudyAI Premium Annuel',  desc: 'Accès illimité · Économise 50 %',           recurring: { interval: 'year'  } },
  lifetime: { name: 'StudyAI Premium À vie',   desc: 'Accès illimité permanent · Paiement unique', recurring: null                 },
};

async function createStripeSession({ plan, currency, origin, customerEmail, priceId }) {
  const { name, desc, recurring } = PLAN_META[plan];
  const mode = plan === 'lifetime' ? 'payment' : 'subscription';

  // Priorité : Price ID Stripe pré-créé (recommandé en production — devise fixée dans Dashboard)
  // Fallback  : price_data dynamique (multi-devises, dev/test sans Price IDs)
  let line_items;
  if (priceId) {
    line_items = [{ price: priceId, quantity: 1 }];
  } else {
    const prices = getPricesForCurrency(currency);
    line_items = [{
      price_data: {
        currency: currency.toLowerCase(),
        product_data: { name, description: desc },
        unit_amount: prices[plan === 'lifetime' ? 'yearly' : plan],
        ...(recurring ? { recurring } : {}),
      },
      quantity: 1,
    }];
  }

  const config = {
    mode,
    line_items,
    success_url: `${origin}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${origin}/`,
    allow_promotion_codes:      true,
    billing_address_collection: 'auto',
    metadata: { plan, currency },
    // Sans payment_method_types → Stripe affiche automatiquement Apple Pay,
    // Google Pay, SEPA, iDEAL, Klarna, etc. selon les activations Dashboard
  };

  if (customerEmail) config.customer_email = customerEmail;
  return stripe.checkout.sessions.create(config);
}

// Logique commune à toutes les routes de checkout
async function handleCheckout(plan, req, res) {
  if (!stripe) return stripeNotConfigured(res);
  if (!PLAN_META[plan]) return res.status(400).json({ error: 'Plan invalide.' });
  FunnelAnalytics.track('checkout_start', { plan, userId: req.user?.userId });

  const { country } = req.body || {};
  const currency    = getCurrencyForCountry(country || null);
  const origin      = process.env.SITE_URL?.trim() || `${req.protocol}://${req.get('host')}`;
  const customerEmail = req.user?.email || undefined;

  // Utilise le Price ID pré-créé si disponible, sinon price_data dynamique
  const priceId =
    plan === 'monthly'  ? (process.env.MONTHLY_PRICE_ID?.trim()  || null) :
    plan === 'yearly'   ? (process.env.YEARLY_PRICE_ID?.trim()   || null) :
    plan === 'lifetime' ? (process.env.LIFETIME_PRICE_ID?.trim() || null) : null;

  try {
    const session = await createStripeSession({ plan, currency, origin, customerEmail, priceId });
    console.log(`[Stripe] Session ${plan}/${currency.toUpperCase()} créée : ${session.id}`);
    res.json({ url: session.url });
  } catch (err) {
    console.error(`[Stripe ${plan}]`, err.type, err.message);
    res.status(500).json({ error: formatStripeError(err) });
  }
}

// POST /api/create-checkout/:plan — monthly | yearly | lifetime  (route générique)
app.post('/api/create-checkout/:plan', optionalAuth, (req, res) => handleCheckout(req.params.plan, req, res));

// POST /api/create-checkout-session — abonnement mensuel (alias explicite)
app.post('/api/create-checkout-session', optionalAuth, (req, res) => handleCheckout('monthly', req, res));

// POST /api/create-checkout-lifetime — paiement unique à vie (alias explicite)
app.post('/api/create-checkout-lifetime', optionalAuth, (req, res) => handleCheckout('lifetime', req, res));

function formatStripeError(err) {
  const map = {
    StripeCardError:            'Carte refusée. Vérifiez vos informations bancaires.',
    StripeRateLimitError:       'Trop de requêtes. Réessayez dans quelques secondes.',
    StripeInvalidRequestError:  'Erreur de configuration Stripe. Contactez le support.',
    StripeAuthenticationError:  'Clé Stripe invalide. Vérifiez STRIPE_SECRET_KEY dans .env.',
    StripeConnectionError:      'Impossible de joindre Stripe. Vérifiez votre connexion.',
  };
  return map[err.type] || `Erreur paiement : ${err.message}`;
}

// GET /api/verify-payment — appelé après redirection Stripe
app.get('/api/verify-payment', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe non configuré' });
  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ error: 'session_id manquant' });

  try {
    // Déduplication : si ce session_id a déjà été traité, retourne le token existant
    const existingEntry = [...premiumUsers.entries()].find(([, u]) => u.sessionId === session_id);
    if (existingEntry) {
      const [existingToken, existingUser] = existingEntry;
      console.log(`[verify-payment] Session déjà traitée — token existant retourné`);
      return res.json({ success: true, token: existingToken, plan: existingUser.type });
    }

    const session = await stripe.checkout.sessions.retrieve(session_id);

    const paid = session.payment_status === 'paid'
      || (session.mode === 'subscription' && session.status === 'complete');

    if (paid) {
      // Récupère le plan depuis les métadonnées (sinon fallback sur le mode)
      const plan  = session.metadata?.plan || (session.mode === 'subscription' ? 'monthly' : 'lifetime');
      const subId = session.subscription || null;
      const token = crypto.randomUUID();

      // Stocke sessionId pour dédupliquer les appels répétés (refresh, double-tap)
      premiumUsers.set(token, { type: plan, subId, sessionId: session_id, active: true, createdAt: new Date().toISOString() });
      savePremiums();
      console.log(`[premium] Nouveau token "${plan}" — sub: ${subId || 'N/A'}`);
      return res.json({ success: true, token, plan });
    }

    res.json({ success: false, message: 'Paiement non complété' });
  } catch (err) {
    console.error('[verify-payment]', err.message);
    res.status(500).json({ error: 'Impossible de vérifier le paiement.' });
  }
});

// ============================================================
//  AUTH — forgot/reset password
// ============================================================

// POST /api/auth/forgot-password
app.post('/api/auth/forgot-password', authLimiter, async (req, res) => {
  const { email } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
    return res.status(400).json({ error: 'Email invalide.' });

  const key   = email.toLowerCase().trim();
  const users = loadJSON(USERS_FILE);

  // Always respond 200 to prevent user enumeration
  if (!users[key]) return res.json({ ok: true });

  const token     = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour
  const tokens    = loadJSON(RESET_TOKENS_FILE, {});
  // Invalidate any existing token for this email
  for (const [k, v] of Object.entries(tokens)) { if (v.email === key) delete tokens[k]; }
  tokens[token]   = { email: key, expiresAt };
  saveJSON(RESET_TOKENS_FILE, tokens);

  try {
    await EmailQueue.sendPasswordReset(key, token);
  } catch (err) {
    console.error('[forgot-password] email error:', err.message);
  }

  res.json({ ok: true });
});

// POST /api/auth/reset-password
app.post('/api/auth/reset-password', authLimiter, async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'Données manquantes.' });
  if (password.length < 6)  return res.status(400).json({ error: 'Mot de passe trop court.' });
  if (password.length > 128) return res.status(400).json({ error: 'Mot de passe trop long.' });

  const tokens = loadJSON(RESET_TOKENS_FILE, {});
  const entry  = tokens[token];
  if (!entry || entry.expiresAt < Date.now())
    return res.status(400).json({ error: 'Lien invalide ou expiré.' });

  const users = loadJSON(USERS_FILE);
  if (!users[entry.email]) return res.status(400).json({ error: 'Utilisateur introuvable.' });

  users[entry.email].passwordHash = await bcrypt.hash(password, 12);
  saveJSON(USERS_FILE, users);

  delete tokens[token];
  saveJSON(RESET_TOKENS_FILE, tokens);

  // Invalidate all sessions for this user
  TokenBlacklist.revokeUserSessions(entry.email);

  res.json({ ok: true });
});

// GET /api/auth/verify-email — verify token from email link
app.get('/api/auth/verify-email', (req, res) => {
  // Email verification is optional; redirect to home with success param
  res.redirect('/?verified=1');
});

// ============================================================
//  GDPR — data export & account deletion
// ============================================================

// GET /api/auth/export-data — GDPR data portability
app.get('/api/auth/export-data', requireAuth, (req, res) => {
  const users   = loadJSON(USERS_FILE);
  const content = loadJSON(CONTENT_FILE, {});
  const user    = users[req.user.email] || {};
  const history = content[req.user.userId] || [];

  const gami = (() => {
    try { const u = loadJSON(USERS_FILE, {})[req.user.email] || {}; return u.gamification || {}; } catch { return {}; }
  })();

  const exportData = {
    exportedAt: new Date().toISOString(),
    account: {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt,
    },
    sessions: history,
    gamification: gami,
  };

  res.setHeader('Content-Disposition', `attachment; filename="studyai-data-${req.user.userId.slice(0,8)}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.json(exportData);
});

// POST /api/auth/delete-account — GDPR right to erasure
app.post('/api/auth/delete-account', requireAuth, async (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Mot de passe requis pour confirmer.' });

  const users = loadJSON(USERS_FILE);
  const user  = users[req.user.email];
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: 'Mot de passe incorrect.' });

  // Erase user data
  delete users[req.user.email];
  saveJSON(USERS_FILE, users);

  const content = loadJSON(CONTENT_FILE, {});
  delete content[req.user.userId];
  saveJSON(CONTENT_FILE, content);

  // Revoke all sessions
  TokenBlacklist.revokeUserSessions(req.user.email);

  auditAction(req, 'delete_account', { email: req.user.email });
  res.json({ ok: true, message: 'Compte et données supprimés.' });
});

// ============================================================
//  BETA SYSTEM — waitlist & invite codes
// ============================================================

// POST /api/beta/waitlist — join the waitlist
app.post('/api/beta/waitlist', rateLimit({ windowMs: 60 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false }), async (req, res) => {
  const { email } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
    return res.status(400).json({ error: 'Email invalide.' });

  const result = Waitlist.join(email.trim());

  if (!result.already) {
    try {
      await EmailQueue.sendWaitlistConfirm(email.trim(), result.position);
    } catch (err) {
      console.error('[waitlist] email error:', err.message);
    }
  }

  res.json({ ok: true, position: result.position, already: result.already });
});

// POST /api/beta/invite/verify — verify an invite code
app.post('/api/beta/invite/verify', (req, res) => {
  const { code, email } = req.body || {};
  if (!code) return res.status(400).json({ error: 'Code requis.' });
  const result = InviteCodes.verify(code, email);
  if (!result.valid) return res.status(400).json({ error: result.reason });
  res.json({ ok: true });
});

// ============================================================
//  ADMIN — user management
// ============================================================

// GET /api/admin/users — list/search users
app.get('/api/admin/users', adminRateLimiter, requireSuperAdmin, (req, res) => {
  const { q, limit = 50, offset = 0 } = req.query;
  const users = loadJSON(USERS_FILE);
  let list = Object.values(users).map(u => ({
    id:        u.id,
    email:     u.email,
    createdAt: u.createdAt,
    banned:    u.banned || false,
    shadowBanned: u.shadowBanned || false,
    betaAccess:   u.betaAccess || false,
    premium:   !!(u.premiumToken),
  }));
  if (q) {
    const qlo = q.toLowerCase();
    list = list.filter(u => u.email.toLowerCase().includes(qlo) || u.id.includes(qlo));
  }
  const total = list.length;
  list = list.slice(Number(offset), Number(offset) + Number(limit));
  auditAction('LIST_USERS', 'admin', { q, count: list.length });
  res.json({ total, users: list });
});

// GET /api/admin/users/:email — get user detail
app.get('/api/admin/users/:email', adminRateLimiter, requireSuperAdmin, (req, res) => {
  const users = loadJSON(USERS_FILE);
  const key   = req.params.email.toLowerCase().trim();
  const user  = users[key];
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  const { passwordHash: _, ...safe } = user;
  auditAction('VIEW_USER', key, { admin: req.adminEmail });
  res.json({ user: safe });
});

// POST /api/admin/users/:email/ban — ban a user
app.post('/api/admin/users/:email/ban', adminRateLimiter, requireSuperAdmin, (req, res) => {
  const users  = loadJSON(USERS_FILE);
  const key    = req.params.email.toLowerCase().trim();
  if (!users[key]) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  const { banned = true, reason = '' } = req.body || {};
  users[key].banned   = banned;
  users[key].banReason = reason;
  users[key].bannedAt  = banned ? new Date().toISOString() : null;
  saveJSON(USERS_FILE, users);
  if (banned) TokenBlacklist.revokeUserSessions(key);
  auditAction(banned ? 'BAN_USER' : 'UNBAN_USER', key, { reason });
  res.json({ ok: true, banned });
});

// POST /api/admin/users/:email/shadow-ban — shadow ban a user
app.post('/api/admin/users/:email/shadow-ban', adminRateLimiter, requireSuperAdmin, (req, res) => {
  const users = loadJSON(USERS_FILE);
  const key   = req.params.email.toLowerCase().trim();
  if (!users[key]) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  const { shadowBanned = true } = req.body || {};
  users[key].shadowBanned = shadowBanned;
  saveJSON(USERS_FILE, users);
  auditAction(shadowBanned ? 'SHADOW_BAN_USER' : 'UNSHADOW_BAN_USER', key, {});
  res.json({ ok: true, shadowBanned });
});

// POST /api/admin/users/:email/grant-premium — grant premium access
app.post('/api/admin/users/:email/grant-premium', adminRateLimiter, requireSuperAdmin, (req, res) => {
  const users = loadJSON(USERS_FILE);
  const key   = req.params.email.toLowerCase().trim();
  if (!users[key]) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  const { plan = 'monthly', revoke = false } = req.body || {};
  if (revoke) {
    delete users[key].premiumToken;
    delete users[key].premiumPlan;
    delete users[key].premiumGrantedAt;
  } else {
    users[key].premiumToken      = crypto.randomUUID();
    users[key].premiumPlan       = plan;
    users[key].premiumGrantedAt  = new Date().toISOString();
    users[key].premiumGrantedBy  = 'admin';
  }
  saveJSON(USERS_FILE, users);
  auditAction(revoke ? 'REVOKE_PREMIUM' : 'GRANT_PREMIUM', key, { plan });
  res.json({ ok: true, revoked: revoke });
});

// POST /api/admin/users/:email/grant-beta — grant beta access
app.post('/api/admin/users/:email/grant-beta', adminRateLimiter, requireSuperAdmin, (req, res) => {
  const users = loadJSON(USERS_FILE);
  const key   = req.params.email.toLowerCase().trim();
  if (!users[key]) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  users[key].betaAccess = true;
  saveJSON(USERS_FILE, users);
  auditAction('GRANT_BETA', key, {});
  res.json({ ok: true });
});

// POST /api/admin/beta/invite — generate invite codes
app.post('/api/admin/beta/invite', adminRateLimiter, requireSuperAdmin, async (req, res) => {
  const { email = null, count = 1, sendEmail = false } = req.body || {};
  const codes = count > 1
    ? InviteCodes.generateBatch(Math.min(count, 50))
    : [InviteCodes.generate({ email })];

  if (sendEmail && email && codes.length === 1) {
    try { await EmailQueue.sendBetaInvite(email, codes[0]); }
    catch (err) { console.error('[beta-invite] email error:', err.message); }
  }

  auditAction('GENERATE_INVITE_CODES', email || 'batch', { count: codes.length });
  res.json({ ok: true, codes });
});

// GET /api/admin/beta/waitlist — view waitlist
app.get('/api/admin/beta/waitlist', adminRateLimiter, requireSuperAdmin, (req, res) => {
  res.json({ waitlist: Waitlist.getAll() });
});

// POST /api/admin/beta/waitlist/notify — notify a user from waitlist
app.post('/api/admin/beta/waitlist/notify', adminRateLimiter, requireSuperAdmin, async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email requis' });
  const position = Waitlist.getPosition(email);
  if (position === null) return res.status(404).json({ error: 'Email not in waitlist' });
  const code = InviteCodes.generate({ email });
  try {
    await EmailQueue.sendBetaInvite(email, code);
    Waitlist.markNotified(email);
    auditAction('NOTIFY_WAITLIST', email, { code });
    res.json({ ok: true, code });
  } catch (err) {
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Erreur interne.' : err.message });
  }
});

// GET /api/admin/email-stats — email sending stats
app.get('/api/admin/email-stats', adminRateLimiter, requireSuperAdmin, (req, res) => {
  res.json(EmailQueue.getStats());
});

// GET /api/admin/memory — memory watchdog stats
app.get('/api/admin/memory', adminRateLimiter, requireSuperAdmin, (req, res) => {
  res.json(MemoryWatchdog.getStats());
});

// ============================================================
//  PUBLIC STATS — Sprint 4
// ============================================================
app.get('/api/public-stats', (req, res) => {
  try {
    const users   = loadJSON(USERS_FILE, {});
    const content = loadJSON(CONTENT_FILE, {});

    const totalUsers  = Object.keys(users).length;
    const totalPacks  = Object.values(content).reduce(
      (sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0
    );
    const totalQuizzes = Object.values(users).reduce(
      (sum, u) => sum + (u.gamification?.totalQuizzes || 0), 0
    );

    res.set('Cache-Control', 'public, max-age=60');
    res.json({ totalUsers, totalPacks, totalQuizzes });
  } catch {
    res.json({ totalUsers: 0, totalPacks: 0, totalQuizzes: 0 });
  }
});

// ============================================================
//  YOUTUBE TRANSCRIPT — Sprint 3
// ============================================================
const { ipKeyGenerator } = require('express-rate-limit');
const ytTranscriptLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 30,
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `yt:${ipKeyGenerator(req)}`,
  message: { error: 'Trop de requêtes transcript. Réessaie dans une heure.' },
});

app.get('/api/youtube-transcript', ytTranscriptLimiter, optionalAuth, async (req, res) => {
  const url = (req.query.url || '').trim();
  if (!url) return res.status(400).json({ error: 'Paramètre url manquant.' });

  // Extract video ID from various YouTube URL formats
  let videoId = null;
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') videoId = u.pathname.slice(1).split('?')[0];
    else videoId = u.searchParams.get('v');
  } catch {
    const m = url.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    if (m) videoId = m[1];
  }

  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'URL YouTube invalide ou ID vidéo introuvable.' });
  }

  // Fetch video title via oEmbed (no API key, public endpoint)
  let videoTitle = '';
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const oRes = await fetch(oembedUrl, { signal: AbortSignal.timeout(5000) });
    if (oRes.ok) {
      const oData = await oRes.json();
      if (oData.title) videoTitle = oData.title;
    }
  } catch (_) { /* title is optional — continue without it */ }

  try {
    const { YoutubeTranscript } = require('youtube-transcript');
    const segments = await YoutubeTranscript.fetchTranscript(videoId);
    if (!segments || !segments.length) {
      return res.status(404).json({ error: 'Aucun sous-titre disponible pour cette vidéo.' });
    }
    const rawText = segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
    // Prepend video title so the AI knows the exact subject
    const withTitle = videoTitle
      ? `Titre de la vidéo : "${videoTitle}"\n\nTranscript :\n${rawText}`
      : rawText;
    // Cap at ~15 000 chars to avoid oversized AI prompts
    const capped = withTitle.length > 15000 ? withTitle.slice(0, 15000) + '…' : withTitle;
    return res.json({ transcript: capped, videoId, title: videoTitle, segments: segments.length });
  } catch (err) {
    console.error('[youtube-transcript]', err.message);
    // Even if transcript fails, return the title so the client can build a better prompt
    if (videoTitle) {
      return res.status(502).json({ error: 'transcript_unavailable', title: videoTitle });
    }
    const msg = err.message?.includes('disabled') || err.message?.includes('subtitles')
      ? 'Les sous-titres sont désactivés sur cette vidéo.'
      : 'Impossible de récupérer le transcript. Vérifie que la vidéo est publique et a des sous-titres.';
    return res.status(502).json({ error: msg });
  }
});

// ============================================================
//  VISION — Photo de notes manuscrites  (Sprint 3)
// ============================================================
const multer = require('multer');
const upload_multer = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Seules les images sont acceptées.'));
  },
});

const visionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 20,
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `vision:${ipKeyGenerator(req)}`,
  message: { error: 'Limite vision atteinte. Réessaie dans une heure.' },
});

app.post('/api/vision', visionLimiter, optionalAuth, upload_multer.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucune image reçue.' });

  const groqVision = USE_GROQ
    ? new (require('openai').OpenAI)({
        apiKey: process.env.GROQ_API_KEY.trim(),
        baseURL: 'https://api.groq.com/openai/v1',
      })
    : null;

  if (!groqVision) {
    return res.status(503).json({ error: 'Vision non disponible (GROQ_API_KEY requis).' });
  }

  try {
    const b64 = req.file.buffer.toString('base64');
    const mime = req.file.mimetype;
    const completion = await groqVision.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Transcris exactement et intégralement le texte manuscrit ou imprimé visible sur cette image de notes de cours. Conserve la structure (titres, listes, formules). Réponds uniquement avec le texte transcrit, sans commentaire.',
          },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
        ],
      }],
      max_tokens: 2000,
    });
    const text = completion.choices?.[0]?.message?.content?.trim() || '';
    if (!text) return res.status(502).json({ error: 'Vision n\'a retourné aucun texte.' });
    return res.json({ text });
  } catch (err) {
    console.error('[vision]', err.message);
    return res.status(502).json({ error: 'Erreur vision : ' + err.message });
  }
});

// ============================================================
//  STATIC ROUTES FOR NEW PAGES
// ============================================================
app.get('/privacy',         (_req, res) => res.sendFile(path.join(__dirname, 'public/privacy.html')));
app.get('/terms',           (_req, res) => res.sendFile(path.join(__dirname, 'public/terms.html')));
app.get('/reset-password',  (_req, res) => res.sendFile(path.join(__dirname, 'public/reset-password.html')));

// ============================================================
//  GLOBAL ERROR HANDLER — masque les stack traces en production
// ============================================================
// eslint-disable-next-line no-unused-vars
app.use(SecretSanitizer.sanitizeErrorResponse);

// ============================================================
//  GRACEFUL SHUTDOWN
// ============================================================
function shutdown(signal) {
  console.log(`\n[server] ${signal} reçu — arrêt propre.`);
  savePremiums();
  MemoryWatchdog.stop();
  if (global._httpServer) {
    global._httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  } else {
    process.exit(0);
  }
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  // Sanitize before logging to prevent secret leaks in crash dumps
  const msg = (err.message || '').replace(process.env.JWT_SECRET || '', '[REDACTED]')
                                  .replace(process.env.ADMIN_KEY  || '', '[REDACTED]');
  console.error('[uncaughtException]', msg);
  // Give inflight requests 2s to complete, then exit (supervisor will restart)
  setTimeout(() => process.exit(1), 2000);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason instanceof Error ? reason.message : reason);
});

// ============================================================
//  DÉMARRAGE
// ============================================================
// Prune expired password-reset tokens at startup
(function pruneResetTokens() {
  try {
    const tokens = loadJSON(RESET_TOKENS_FILE, {});
    const now    = Date.now();
    const before = Object.keys(tokens).length;
    for (const [k, v] of Object.entries(tokens)) {
      if (!v.expiresAt || v.expiresAt < now) delete tokens[k];
    }
    if (Object.keys(tokens).length < before) saveJSON(RESET_TOKENS_FILE, tokens);
  } catch {}
})();

global._httpServer = app.listen(PORT, async () => {
  loadPremiums();            // Charge les tokens premium persistés
  LeaderboardService.load(); // Restore leaderboard cache from disk

  // Start security services
  AutoBackup.start();        // 6h auto-backup (first run deferred 30s)
  FileIntegrity.start();     // File integrity monitoring (30min interval)
  MemoryWatchdog.start();    // Memory watchdog (1min interval)

  // Auto-cleanup old jobs every hour (non-blocking)
  const JobQueue = require('./services/jobs/jobQueue');
  console.log('✓  Auto Study  : moteur IA actif');

  console.log('\n╔════════════════════════════════════╗');
  console.log('║   StudyAI — Serveur démarré ✓      ║');
  console.log(`║   http://localhost:${PORT}             ║`);
  console.log('╚════════════════════════════════════╝');

  const key = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY;
  console.log(`\n✓  Fournisseur : ${USE_GROQ ? 'Groq (gratuit)' : 'OpenAI'}`);
  if (key) console.log(`✓  Clé         : ${key.slice(0, 8)}... (${key.length} chars)`);
  else console.error('❌  Aucune clé IA trouvée dans .env !');
  console.log(`✓  Modèle      : ${MODEL}`);
  console.log(`✓  Plans       : Mensuel ${PRICE_MONTHLY/100}€/mois | À vie ${PRICE_LIFETIME/100}€`);

  if (!stripe) console.warn('ℹ  Stripe non configuré — paiement désactivé.');
  else         console.log('✓  Stripe      : configuré');

  if (process.env.SUPER_ADMIN_EMAIL)
    console.log(`✓  Super admin : configuré`);
  else
    console.warn('⚠  SUPER_ADMIN_EMAIL non défini — routes admin JWT désactivées');

  const envReport = EnvValidator.getReport();
  if (!envReport.ok) console.error(`⚠  Env: ${envReport.issues.length} problème(s) critique(s) — voir /api/admin/env`);

  try { await openai.models.list(); console.log('✓  IA          : connexion OK'); }
  catch (err) { console.error(`❌  IA : ${err.status ?? '?'} ${err.message}`); }

  console.log(`\n→  Diagnostic : http://localhost:${PORT}/api/health\n`);
});
