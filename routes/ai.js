'use strict';
const express      = require('express');
const { default: rateLimit, ipKeyGenerator } = require('express-rate-limit');
const router       = express.Router();

const AutoStudy    = require('../services/ai/autoStudyEngine');
const JobQueue     = require('../services/jobs/jobQueue');
const MemoryEngine = require('../services/learning/memoryEngine');
const LearningDNA  = require('../services/learning/learningDNA');
const ProactiveCoach = require('../services/coach/proactiveCoach');
const ExamSim      = require('../services/exam/examSimulator');
const KnowledgeGraph = require('../services/brain/knowledgeGraph');
const StudyBattle  = require('../services/social/studyBattle');
const AiClient     = require('../services/ai/client');

// ── Rate limiters ────────────────────────────────────────────
const analyzeLimiter = rateLimit({
  windowMs: 60 * 60_000, max: parseInt(process.env.ANALYZE_LIMIT_HOUR || '20', 10),
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Trop de générations. Réessayez dans 1 heure.' },
  keyGenerator: (req) => req.user?.userId || ipKeyGenerator(req),
});
const apiLimiter = rateLimit({
  windowMs: 15 * 60_000, max: 100,
  standardHeaders: true, legacyHeaders: false,
});

// ── Auth middleware ──────────────────────────────────────────
const jwt = require('jsonwebtoken');
function optAuth(req, _res, next) {
  try {
    const h = req.headers.authorization || '';
    const t = h.startsWith('Bearer ') ? h.slice(7) : req.query.token;
    if (t) req.user = jwt.verify(t, (process.env.JWT_SECRET || 'dev').trim(), { algorithms: ['HS256'] });
  } catch {}
  next();
}
function reqAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentification requise.' });
  next();
}

// Parse Bearer token for every route in this router
router.use(optAuth);

// ============================================================
//  AUTO STUDY — file/text → full study pack
// ============================================================

// POST /api/ai/analyze
// Body: { text?, base64?, mimeType?, filename?, mode? }
router.post('/analyze', optAuth, analyzeLimiter, async (req, res) => {
  try {
    const ua = req.headers['user-agent'] || '';
    if (!ua || /bot|crawl|spider|scraper|headless|phantom|selenium|puppeteer|playwright|wget|curl|python-requests|axios|httpx|java\/|go-http|ruby|okhttp/i.test(ua))
      return res.status(403).json({ error: 'Accès refusé.' });

    const { text, base64, mimeType = 'text/plain', filename = '', mode = 'standard' } = req.body || {};
    if (!text && !base64) return res.status(400).json({ error: 'Aucun contenu fourni.' });
    if (!['standard', 'simple', 'expert', 'exam'].includes(mode))
      return res.status(400).json({ error: 'Mode invalide.' });

    const { jobId } = await AutoStudy.startJob({
      text, base64, mimeType, filename, mode,
      userId: req.user?.userId,
    });

    res.json({ jobId, status: 'processing', pollUrl: `/api/ai/job/${jobId}` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/ai/job/:id — poll status
router.get('/job/:id', optAuth, (req, res) => {
  const job = JobQueue.getSafe(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job introuvable.' });
  res.json(job);
});

// GET /api/ai/job/:id/result — full result
router.get('/job/:id/result', optAuth, (req, res) => {
  const job = JobQueue.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job introuvable.' });
  if (job.status !== 'done') return res.status(202).json({ status: job.status, progress: job.progress });

  // Wire knowledge graph if user authenticated (non-blocking)
  if (req.user?.userId && job.result?.concepts?.length) {
    setImmediate(() => {
      try {
        KnowledgeGraph.ingest(req.user.userId, {
          concepts: job.result.concepts,
          subject:  job.result.subject,
          jobId:    job.id,
          title:    job.result.title,
        });
        // Check for cross-session connections
        const related = KnowledgeGraph.findRelated(req.user.userId, job.result.concepts || []);
        if (related.length && job.result) job.result._brainLinks = related.slice(0, 5);
      } catch {}
    });
  }

  res.json({ status: 'done', result: job.result });
});

// POST /api/ai/job/:id/regenerate — force regenerate one section
router.post('/job/:id/regenerate', optAuth, analyzeLimiter, async (req, res) => {
  const { section = 'quiz' } = req.body || {};
  try {
    const fresh = await AutoStudy.regenerateSection(req.params.id, section, req.user?.userId);
    res.json({ section, result: fresh });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/ai/deepen — generate deeper explanation of a concept
router.post('/deepen', optAuth, analyzeLimiter, async (req, res) => {
  const { concept, context = '' } = req.body || {};
  if (!concept) return res.status(400).json({ error: 'Concept requis.' });
  try {
    const AI = AiClient;
    const result = await AI.call(
      `Explique en profondeur le concept "${concept}" dans le contexte suivant: ${context.slice(0, 2000)}\n\n` +
      `Génère un JSON: {"explanation": "...", "examples": ["..."], "common_mistakes": ["..."], "advanced_points": ["..."]}`,
      { maxTokens: 1500 }
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ai/stats
router.get('/stats', (req, res) => {
  res.json(AiClient.getStats());
});

// ============================================================
//  MEMORY ENGINE
// ============================================================

// POST /api/ai/memory/review — record flashcard review
router.post('/memory/review', reqAuth, (req, res) => {
  const { cardId, rating, responseMs } = req.body || {};
  if (!cardId || rating === undefined) return res.status(400).json({ error: 'cardId et rating requis.' });
  if (rating < 0 || rating > 5) return res.status(400).json({ error: 'rating entre 0 et 5.' });

  const updated = MemoryEngine.recordReview(req.user.userId, String(cardId), Number(rating), Number(responseMs) || 0);
  LearningDNA.recordSignal(req.user.userId, { type: 'quiz_speed', value: Number(responseMs) || 0 });

  res.json({ card: updated });
});

// POST /api/ai/memory/session — record a completed session
router.post('/memory/session', reqAuth, (req, res) => {
  const { correctCount, totalCount, durationMs, topicId } = req.body || {};
  MemoryEngine.recordSession(req.user.userId, { correctCount, totalCount, durationMs, topicId });
  LearningDNA.recordSignal(req.user.userId, { type: 'session_completed', value: true });
  res.json({ ok: true });
});

// GET /api/ai/memory/due — cards due for review
router.get('/memory/due', reqAuth, (req, res) => {
  const { cards } = req.query;
  const ids = cards ? String(cards).split(',') : [];
  res.json({ due: MemoryEngine.getDueCards(req.user.userId, ids) });
});

// GET /api/ai/memory/mastery — mastery score
router.get('/memory/mastery', reqAuth, (req, res) => {
  res.json(MemoryEngine.getMastery(req.user.userId));
});

// GET /api/ai/memory/forgetting — forgetting risk
router.get('/memory/forgetting', reqAuth, (req, res) => {
  const { cards } = req.query;
  const ids = cards ? String(cards).split(',') : [];
  res.json({ risks: MemoryEngine.getForgettingRisk(req.user.userId, ids) });
});

// ============================================================
//  LEARNING DNA
// ============================================================

// GET /api/ai/dna
router.get('/dna', reqAuth, (req, res) => {
  res.json(LearningDNA.getAdaptation(req.user.userId));
});

// POST /api/ai/dna/signal
router.post('/dna/signal', reqAuth, (req, res) => {
  const { type, value, context } = req.body || {};
  if (!type) return res.status(400).json({ error: 'type requis.' });
  LearningDNA.recordSignal(req.user.userId, { type, value, context });
  res.json({ ok: true });
});

// ============================================================
//  COACHING
// ============================================================

// GET /api/ai/coaching
router.get('/coaching', reqAuth, async (req, res) => {
  try {
    const data = await ProactiveCoach.getCoaching(req.user.userId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  EXAM SIMULATOR
// ============================================================

// POST /api/ai/exam — create exam session from a job's quiz
router.post('/exam', reqAuth, (req, res) => {
  const { jobId, config } = req.body || {};
  if (!jobId) return res.status(400).json({ error: 'jobId requis.' });
  const job = JobQueue.get(jobId);
  if (!job || job.status !== 'done') return res.status(404).json({ error: 'Job pas encore prêt.' });

  const questions = job.result?.quiz?.questions || [];
  if (!questions.length) return res.status(400).json({ error: 'Aucune question dans ce job.' });

  const exam = ExamSim.createExam({ userId: req.user.userId, questions, config });
  res.json(exam);
});

// GET /api/ai/exam/:id
router.get('/exam/:id', reqAuth, (req, res) => {
  const exam = ExamSim.getExam(req.params.id, req.user.userId);
  if (!exam) return res.status(404).json({ error: 'Examen introuvable.' });
  res.json(exam);
});

// POST /api/ai/exam/:id/answer
router.post('/exam/:id/answer', reqAuth, (req, res) => {
  try {
    const result = ExamSim.submitAnswer(req.params.id, req.user.userId, req.body);
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// POST /api/ai/exam/:id/finish
router.post('/exam/:id/finish', reqAuth, (req, res) => {
  try {
    const result = ExamSim.finishExam(req.params.id, req.user.userId);
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ============================================================
//  KNOWLEDGE GRAPH (Second Brain)
// ============================================================

// GET /api/ai/brain
router.get('/brain', reqAuth, (req, res) => {
  const { limit } = req.query;
  res.json(KnowledgeGraph.getGraph(req.user.userId, { limit: Number(limit) || 100 }));
});

// GET /api/ai/brain/:concept/connections
router.get('/brain/:concept/connections', reqAuth, (req, res) => {
  res.json({ connections: KnowledgeGraph.getConnections(req.user.userId, req.params.concept) });
});

// ============================================================
//  STUDY BATTLES
// ============================================================

// POST /api/ai/battle — create battle from job quiz
router.post('/battle', reqAuth, (req, res) => {
  const { jobId } = req.body || {};
  if (!jobId) return res.status(400).json({ error: 'jobId requis.' });
  const job = JobQueue.get(jobId);
  if (!job || job.status !== 'done') return res.status(404).json({ error: 'Job pas encore prêt.' });
  const questions = job.result?.quiz?.questions || [];
  if (!questions.length) return res.status(400).json({ error: 'Aucune question.' });
  const battle = StudyBattle.create({ creatorId: req.user.userId, questions, topicTitle: job.result.title });
  res.json(battle);
});

// POST /api/ai/battle/:id/join
router.post('/battle/:id/join', reqAuth, (req, res) => {
  try { res.json(StudyBattle.join(req.params.id, req.user.userId)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

// POST /api/ai/battle/:id/answer
router.post('/battle/:id/answer', reqAuth, (req, res) => {
  try { res.json(StudyBattle.answer(req.params.id, req.user.userId, req.body)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

// GET /api/ai/battle/:id/poll
router.get('/battle/:id/poll', reqAuth, (req, res) => {
  const state = StudyBattle.poll(req.params.id, req.user.userId);
  if (!state) return res.status(404).json({ error: 'Battle introuvable.' });
  res.json(state);
});

module.exports = router;
