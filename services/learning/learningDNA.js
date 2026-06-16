'use strict';
// Detect and evolve user learning profile from interaction signals
const fs   = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../data/memory');
try { if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true }); } catch {}

function file(userId) { return path.join(DIR, `dna_${userId}.json`); }

const DEFAULT_DNA = {
  // Learning style scores (0-100)
  visual:      50, verbal: 50, logical: 50, intuitive: 50,
  // Speed profile
  fastLearner: 50,
  // Session patterns
  bestTimeOfDay:   null,     // 'morning'|'afternoon'|'evening'|'night'
  avgSessionMin:   20,
  preferShort:     false,    // prefers many short sessions
  // Difficulty preference
  challengeSeeking: 50,      // 0=avoids hard, 100=loves hard
  // Retention signals
  retentionStrength: 50,     // 0=forgets fast, 100=retains well
  // Emotional engagement
  streakMotivated:  true,
  competitionDriven: false,
  // Signals accumulated
  signals:  [],
  updatedAt: null,
};

function load(userId) {
  try { return JSON.parse(fs.readFileSync(file(userId), 'utf8')); }
  catch { return { ...DEFAULT_DNA }; }
}

function save(userId, dna) {
  const tmp = file(userId) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ ...dna, updatedAt: new Date().toISOString() }));
  fs.renameSync(tmp, file(userId));
}

// ── Record an interaction signal ─────────────────────────────
function recordSignal(userId, { type, value, context = {} }) {
  const dna = load(userId);
  dna.signals = [...(dna.signals || []).slice(-200), { type, value, at: Date.now(), ...context }];

  const hour = new Date().getHours();
  const timeLabel = hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';

  switch (type) {
    case 'quiz_speed':
      // Fast answer (< 5s) = intuitive; slow (> 30s) = analytical
      dna.intuitive  = clamp(dna.intuitive  + (value < 5000  ? 2  : value > 30000 ? -1 : 0));
      dna.fastLearner = clamp(dna.fastLearner + (value < 8000  ? 1 : value > 25000 ? -1 : 0));
      break;
    case 'preferred_content':
      // value: 'flashcard'|'summary'|'quiz'|'mindmap'
      if (value === 'summary' || value === 'mindmap') dna.visual = clamp(dna.visual + 2);
      if (value === 'quiz')                           dna.logical = clamp(dna.logical + 2);
      if (value === 'flashcard')                      dna.verbal  = clamp(dna.verbal + 2);
      break;
    case 'difficulty_chosen':
      dna.challengeSeeking = clamp(dna.challengeSeeking + (value === 'hard' ? 3 : value === 'easy' ? -2 : 0));
      break;
    case 'session_completed':
      // Track time of day preference
      const counts = (dna._timeCounts = dna._timeCounts || {});
      counts[timeLabel] = (counts[timeLabel] || 0) + 1;
      const best = Object.entries(counts).sort(([, a], [, b]) => b - a)[0];
      if (best) dna.bestTimeOfDay = best[0];
      break;
    case 'streak_check':
      dna.streakMotivated = value;
      break;
    case 'retention_score':
      dna.retentionStrength = clamp(dna.retentionStrength * 0.9 + value * 0.1);
      break;
  }

  save(userId, dna);
}

function clamp(v) { return Math.max(0, Math.min(100, Math.round(v))); }

// ── Get adapted content settings ──────────────────────────────
function getAdaptation(userId) {
  const dna = load(userId);

  // Quiz mode recommendation
  let quizMode = 'standard';
  if (dna.challengeSeeking > 70) quizMode = 'exam';
  if (dna.challengeSeeking < 30) quizMode = 'simple';

  // Summary style
  let summaryStyle = 'balanced';
  if (dna.visual > 65)  summaryStyle = 'visual';   // more mindmaps/diagrams
  if (dna.logical > 65) summaryStyle = 'logical';  // more formulas/structure
  if (dna.verbal > 65)  summaryStyle = 'verbal';   // more definitions/text

  // Session length advice
  const sessionMinutes = dna.preferShort ? 15 : Math.max(20, Math.min(60, dna.avgSessionMin));

  // Dominant learning style
  const styles = { visual: dna.visual, verbal: dna.verbal, logical: dna.logical, intuitive: dna.intuitive };
  const dominant = Object.entries(styles).sort(([, a], [, b]) => b - a)[0][0];

  return {
    quizMode,
    summaryStyle,
    sessionMinutes,
    dominant,
    dna: {
      visual:   dna.visual,
      verbal:   dna.verbal,
      logical:  dna.logical,
      intuitive: dna.intuitive,
      fastLearner: dna.fastLearner,
      retentionStrength: dna.retentionStrength,
      challengeSeeking:  dna.challengeSeeking,
      bestTimeOfDay:     dna.bestTimeOfDay,
    },
  };
}

function getDNA(userId) { return load(userId); }

module.exports = { recordSignal, getAdaptation, getDNA };
