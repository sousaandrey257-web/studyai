'use strict';
// AI Proactive Coach — detects patterns and generates intelligent coaching messages
const MemoryEngine = require('../learning/memoryEngine');
const LearningDNA  = require('../learning/learningDNA');
const fs   = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../data/memory');
try { if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true }); } catch {}

// ── Coaching insight generators ───────────────────────────────
function generateInsights(userId, { sessions = [], weakPoints = [], masteryData = {} } = {}) {
  const insights = [];
  const dna = LearningDNA.getDNA(userId);
  const now = Date.now();

  // 1. Streak risk detection
  const lastSession = sessions[sessions.length - 1];
  if (lastSession) {
    const hoursSince = (now - new Date(lastSession.at).getTime()) / 3600_000;
    if (hoursSince > 20 && hoursSince < 48) {
      insights.push({
        type:     'streak_risk',
        priority: 'high',
        icon:     '🔥',
        title:    'Série en danger !',
        message:  `Tu n'as pas révisé depuis ${Math.round(hoursSince)}h. Fais une session rapide pour garder ta série !`,
        action:   { label: 'Réviser 5 min', href: '/' },
        expiresIn: 24 * 3600_000,
      });
    }
  }

  // 2. Weak point alert
  if (weakPoints.length > 0) {
    const top = weakPoints[0];
    insights.push({
      type:     'weak_point',
      priority: 'medium',
      icon:     '🎯',
      title:    'Point faible détecté',
      message:  `Tu bloques souvent sur ce concept. Une révision ciblée maintenant le fixera en mémoire.`,
      action:   { label: 'Réviser le point faible', href: '/' },
      cardId:   top.cardId,
      expiresIn: 48 * 3600_000,
    });
  }

  // 3. Best time alert
  if (dna.bestTimeOfDay) {
    const hour = new Date().getHours();
    const currentSlot = hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
    if (currentSlot === dna.bestTimeOfDay) {
      insights.push({
        type:     'optimal_time',
        priority: 'low',
        icon:     '⚡',
        title:    'Moment idéal pour toi',
        message:  `Tes données montrent que tu apprends mieux le ${translate(dna.bestTimeOfDay)}. C'est maintenant !`,
        action:   { label: 'Commencer', href: '/' },
        expiresIn: 3 * 3600_000,
      });
    }
  }

  // 4. Performance drop
  if (sessions.length >= 5) {
    const recent3  = sessions.slice(-3).reduce((s, x) => s + x.accuracy, 0) / 3;
    const previous5 = sessions.slice(-8, -3).reduce((s, x) => s + x.accuracy, 0) / Math.min(5, sessions.slice(-8, -3).length || 1);
    if (previous5 > 0 && recent3 < previous5 - 15) {
      insights.push({
        type:     'performance_drop',
        priority: 'high',
        icon:     '📉',
        title:    'Baisse de performance détectée',
        message:  `Tes dernières sessions sont en dessous de ta moyenne. Fatigue ou contenu difficile ?`,
        action:   { label: 'Mode facile', href: '/?mode=simple' },
        expiresIn: 24 * 3600_000,
      });
    }
  }

  // 5. Mastery milestone
  if (masteryData.score >= 25 && masteryData.score < 30) {
    insights.push({
      type:     'milestone',
      priority: 'low',
      icon:     '🏆',
      title:    `Tu approches les 30% de maîtrise !`,
      message:  `Continue comme ça — 5 sessions de plus et tu atteins le niveau intermédiaire.`,
      action:   { label: 'Voir ma progression', href: '/dashboard' },
      expiresIn: 48 * 3600_000,
    });
  }

  // 6. Spaced repetition reminder (cards due)
  if (masteryData.cardsLearned > 5) {
    insights.push({
      type:     'review_due',
      priority: 'medium',
      icon:     '🧠',
      title:    'Révision espacée disponible',
      message:  `Ton cerveau a besoin de consolider les apprentissages. Quelques cartes sont prêtes à être révisées.`,
      action:   { label: 'Révision express', href: '/' },
      expiresIn: 12 * 3600_000,
    });
  }

  return insights.sort((a, b) => priorityScore(b.priority) - priorityScore(a.priority));
}

function priorityScore(p) { return p === 'high' ? 3 : p === 'medium' ? 2 : 1; }
function translate(s) { return { morning: 'matin', afternoon: 'après-midi', evening: 'soir', night: 'nuit' }[s] || s; }

// ── Fatigue detection ─────────────────────────────────────────
function detectFatigue(sessions) {
  if (sessions.length < 3) return { fatigued: false, level: 0 };

  const recent = sessions.slice(-3);
  const avgAccuracy = recent.reduce((s, x) => s + x.accuracy, 0) / recent.length;
  const avgDuration = recent.reduce((s, x) => s + (x.durationMs || 0), 0) / recent.length;

  // Low accuracy + long sessions = cognitive overload
  const cogLoad = (100 - avgAccuracy) * 0.6 + (avgDuration > 3600_000 ? 40 : 0);
  const fatigued = cogLoad > 60;
  const level    = Math.min(100, Math.round(cogLoad));

  return {
    fatigued,
    level,
    recommendation: fatigued
      ? avgDuration > 3600_000
        ? 'Session trop longue — fais une pause de 15 minutes.'
        : 'Baisse de performance — passe en mode facile ou prends une pause.'
      : null,
  };
}

// ── Main coaching entry point ──────────────────────────────────
async function getCoaching(userId) {
  const mastery  = MemoryEngine.getMastery(userId);
  const weakPts  = MemoryEngine.getWeakPoints(userId, 3);
  const memData  = require('../learning/memoryEngine');

  // Load sessions from memory file
  const memFile = path.join(DIR, `${userId}.json`);
  let sessions = [];
  try { sessions = JSON.parse(fs.readFileSync(memFile, 'utf8')).sessions || []; } catch {}

  const fatigue  = detectFatigue(sessions);
  const insights = generateInsights(userId, { sessions, weakPoints: weakPts, masteryData: mastery });

  return {
    mastery,
    fatigue,
    insights,
    weakPoints: weakPts,
    dna: LearningDNA.getAdaptation(userId),
  };
}

module.exports = { getCoaching, generateInsights, detectFatigue };
