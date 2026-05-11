'use strict';
const Parser   = require('./pdfParser');
const Security = require('./security');
const Pipeline = require('./contentPipeline');
const JobQueue = require('../jobs/jobQueue');

// ── Feature flag ──────────────────────────────────────────────
const ENABLED = process.env.FEATURE_AUTO_STUDY !== 'false';

// ── Start an async study-pack generation job ──────────────────
async function startJob({ text, base64, mimeType, filename, mode = 'standard', userId }) {
  if (!ENABLED) throw new Error('Auto Study Engine is disabled.');

  // Security validation
  const sec = Security.validateUpload({
    base64,
    mimeType,
    filename,
    textLength: text ? text.length : 0,
  });
  if (!sec.ok) throw new Error(sec.error);

  // Create pending job
  const job = JobQueue.create({ userId, mode, filename, status: 'pending' });

  // Process asynchronously
  setImmediate(async () => {
    try {
      JobQueue.update(job.id, { status: 'processing', progress: 2, progressLabel: 'Lecture du document…' });

      // Parse content
      const parsed = await Parser.parseContent({ text, base64, mimeType, filename });

      // Run AI pipeline
      const result = await Pipeline.run(parsed.text, {
        jobId: job.id,
        userId,
        mode,
        skipCache: false,
        onProgress: (pct, label) => JobQueue.update(job.id, { progress: pct, progressLabel: label }),
      });

      // Attach parse metadata
      result.parseMethod = parsed.method;
      result.pages       = parsed.pages;
      result.truncated   = parsed.truncated;

      JobQueue.update(job.id, {
        status:        'done',
        progress:      100,
        progressLabel: 'Pack d\'étude prêt ✓',
        result,
      });

      // Emit event (non-blocking)
      try {
        const EventBus = require('../event-log/bus');
        EventBus.emit('STUDY_PACK_GENERATED', {
          jobId: job.id, userId, mode,
          processingMs: result.processingMs,
          charCount: result.charCount,
        });
      } catch {}

    } catch (err) {
      console.error(`[autoStudy] Job ${job.id} failed:`, err.message);
      JobQueue.update(job.id, {
        status: 'failed',
        error:  err.message || 'Génération échouée.',
      });
    }
  });

  return { jobId: job.id };
}

// ── Regenerate one section of an existing result ──────────────
async function regenerateSection(jobId, section, userId) {
  const job = JobQueue.get(jobId);
  if (!job || job.status !== 'done') throw new Error('Job introuvable ou pas encore terminé.');
  if (job.userId && job.userId !== userId) throw new Error('Accès refusé.');

  const text = job.result?.summary?.executive;
  if (!text) throw new Error('Contenu source introuvable dans ce job.');

  const Generators = {
    quiz:       require('./generators/quiz'),
    flashcards: require('./generators/flashcards'),
    concepts:   require('./generators/concepts'),
    summary:    require('./generators/summary'),
  };
  const gen = Generators[section];
  if (!gen) throw new Error(`Section "${section}" non reconnue.`);

  const fresh = await gen.generate(text);
  return fresh;
}

module.exports = { startJob, regenerateSection, ENABLED };
