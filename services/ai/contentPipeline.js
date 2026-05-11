'use strict';
const Chunker   = require('./chunker');
const Cache     = require('./cache');
const GenSummary    = require('./generators/summary');
const GenQuiz       = require('./generators/quiz');
const GenFlashcards = require('./generators/flashcards');
const GenConcepts   = require('./generators/concepts');

const PIPELINE_TIMEOUT = parseInt(process.env.AI_PIPELINE_TIMEOUT_MS || '180000', 10);

function withTimeout(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`Timeout: ${label}`)), ms)),
  ]);
}

async function run(text, { jobId, userId, mode = 'standard', onProgress, skipCache = false } = {}) {
  const tick = (pct, label) => { if (onProgress) onProgress(pct, label); };
  const t0 = Date.now();

  tick(5, 'Analyse du document…');
  const h = Cache.hash(text);
  if (!skipCache) {
    const cached = Cache.get(h);
    if (cached) { tick(100, 'Depuis le cache ✓'); return { ...cached, fromCache: true }; }
  }

  tick(12, 'Découpage intelligent…');
  const docSample = Chunker.sample(text);
  const charCount = text.length;
  const tokenEst  = Chunker.estimateTokens(text);

  tick(18, 'Génération IA en cours…');
  const GEN_MS = Math.min(120_000, PIPELINE_TIMEOUT - 20_000);

  // Run all generators in parallel, independent failures don't block others
  const [rSummary, rQuiz, rFlashcards, rConcepts] = await Promise.allSettled([
    withTimeout(GenSummary.generate(docSample), GEN_MS, 'summary'),
    withTimeout(GenQuiz.generate(docSample, mode), GEN_MS, 'quiz'),
    withTimeout(GenFlashcards.generate(docSample), GEN_MS, 'flashcards'),
    withTimeout(GenConcepts.generate(docSample), GEN_MS, 'concepts'),
  ]);

  tick(85, 'Assemblage du pack…');

  const ok  = (r) => r.status === 'fulfilled' ? r.value : null;
  const err = (r) => r.status === 'rejected'  ? r.reason?.message : null;

  const summary    = ok(rSummary);
  const quiz       = ok(rQuiz);
  const flashcards = ok(rFlashcards);
  const concepts   = ok(rConcepts);

  const result = {
    jobId,
    userId:    userId || null,
    mode,
    generatedAt: new Date().toISOString(),
    documentHash: h,
    charCount,
    tokenEstimate: tokenEst,

    // Meta
    title:        summary?.title    || concepts?.concepts?.[0]?.name || 'Document analysé',
    subject:      summary?.subject  || 'Non détecté',
    level:        summary?.level    || 'Non détecté',
    language:     summary?.language || 'fr',
    difficultyScore: summary?.difficulty_score ?? concepts?.mastery?.estimated_level ?? 60,
    studyTimeMin:    summary?.study_time_minutes || 45,

    // Content blocks
    summary: {
      executive: summary?.executive_summary || null,
      sections:  summary?.sections  || [],
      formulas:  summary?.key_formulas || [],
      vocabulary: summary?.vocabulary || [],
      mindMap:    { root: summary?.mind_map_root, branches: summary?.mind_map_branches || [] },
    },
    quiz: {
      questions:  quiz?.questions || [],
      mode,
    },
    flashcards: flashcards?.flashcards || [],
    memo:       flashcards?.memo       || null,
    concepts:   concepts?.concepts     || [],
    traps:      concepts?.traps        || [],
    examQuestions: concepts?.exam_questions || [],
    mastery:    concepts?.mastery      || null,
    roadmap:    concepts?.roadmap      || null,

    // Pipeline metadata
    processingMs: Date.now() - t0,
    errors: [
      err(rSummary)    && { generator: 'summary',    msg: err(rSummary)    },
      err(rQuiz)       && { generator: 'quiz',        msg: err(rQuiz)       },
      err(rFlashcards) && { generator: 'flashcards',  msg: err(rFlashcards) },
      err(rConcepts)   && { generator: 'concepts',    msg: err(rConcepts)   },
    ].filter(Boolean),
  };

  Cache.set(h, result);
  tick(100, 'Pack d\'étude prêt ✓');
  return result;
}

module.exports = { run };
