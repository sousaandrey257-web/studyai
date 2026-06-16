'use strict';
// SM-2 spaced repetition + forgetting curve + weak-point clustering
const fs   = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../data/memory');
try { if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true }); } catch {}

function file(userId) { return path.join(DIR, `${userId}.json`); }

function load(userId) {
  try { return JSON.parse(fs.readFileSync(file(userId), 'utf8')); }
  catch { return { cards: {}, sessions: [], weakPoints: {}, profile: {}, updatedAt: null }; }
}

function save(userId, data) {
  const tmp = file(userId) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file(userId));
}

// ── SM-2 algorithm ──────────────────────────────────────────────
// rating: 0-5 (0=blackout, 3=correct with effort, 5=perfect)
function sm2(card, rating) {
  if (rating < 3) {
    return { ...card, interval: 1, repetitions: 0, easiness: Math.max(1.3, card.easiness - 0.2) };
  }
  const e  = Math.max(1.3, card.easiness + 0.1 - (5 - rating) * (0.08 + (5 - rating) * 0.02));
  const n  = card.repetitions + 1;
  const i  = n === 1 ? 1 : n === 2 ? 6 : Math.round(card.interval * e);
  return { ...card, interval: i, repetitions: n, easiness: e };
}

// ── Record a flashcard review ───────────────────────────────────
function recordReview(userId, cardId, rating, responseMs) {
  const data  = load(userId);
  const now   = Date.now();
  const card  = data.cards[cardId] || {
    id: cardId, interval: 1, repetitions: 0, easiness: 2.5,
    nextReview: now, history: [],
  };

  const updated = sm2(card, rating);
  updated.nextReview = now + updated.interval * 86400_000;
  updated.lastReview = now;
  updated.history    = [...(card.history || []).slice(-20), { at: now, rating, responseMs }];
  updated.avgResponseMs = updated.history.reduce((s, h) => s + h.responseMs, 0) / updated.history.length;

  data.cards[cardId] = updated;

  // Track weak points
  if (rating < 3) {
    data.weakPoints[cardId] = (data.weakPoints[cardId] || 0) + 1;
  } else if (data.weakPoints[cardId]) {
    data.weakPoints[cardId] = Math.max(0, data.weakPoints[cardId] - 0.5);
  }

  data.updatedAt = new Date().toISOString();
  save(userId, data);
  return updated;
}

// ── Get cards due for review ────────────────────────────────────
function getDueCards(userId, cardIds = []) {
  const data = load(userId);
  const now  = Date.now();
  return cardIds.filter(id => {
    const c = data.cards[id];
    return !c || c.nextReview <= now;
  }).sort((a, b) => {
    const ca = data.cards[a], cb = data.cards[b];
    if (!ca && !cb) return 0;
    if (!ca) return -1;
    if (!cb) return 1;
    return ca.nextReview - cb.nextReview;
  });
}

// ── Weak-point clustering ───────────────────────────────────────
function getWeakPoints(userId, topN = 5) {
  const data = load(userId);
  return Object.entries(data.weakPoints)
    .sort(([, a], [, b]) => b - a)
    .slice(0, topN)
    .map(([id, score]) => ({ cardId: id, failureScore: Math.round(score * 10) / 10 }));
}

// ── Mastery score ───────────────────────────────────────────────
function getMastery(userId) {
  const data = load(userId);
  const cards = Object.values(data.cards);
  if (!cards.length) return { score: 0, level: 'débutant', cardsLearned: 0, avgEasiness: 2.5 };

  const avgEasiness = cards.reduce((s, c) => s + c.easiness, 0) / cards.length;
  const wellLearned = cards.filter(c => c.repetitions >= 3 && c.easiness >= 2.0).length;
  const score       = Math.round((wellLearned / Math.max(cards.length, 1)) * 100);

  const level = score < 25 ? 'débutant' : score < 50 ? 'intermédiaire' : score < 75 ? 'avancé' : 'maître';
  return { score, level, cardsLearned: wellLearned, totalCards: cards.length, avgEasiness: Math.round(avgEasiness * 100) / 100 };
}

// ── Session record ──────────────────────────────────────────────
function recordSession(userId, { correctCount, totalCount, durationMs, topicId }) {
  const data = load(userId);
  data.sessions = [
    ...(data.sessions || []).slice(-100),
    { at: new Date().toISOString(), correctCount, totalCount, durationMs, topicId,
      accuracy: totalCount ? Math.round(correctCount / totalCount * 100) : 0 }
  ];
  data.updatedAt = new Date().toISOString();
  save(userId, data);
}

// ── Forgetting curve prediction ─────────────────────────────────
function getForgettingRisk(userId, cardIds) {
  const data = load(userId);
  const now  = Date.now();
  return cardIds.map(id => {
    const c = data.cards[id];
    if (!c || !c.lastReview) return { cardId: id, risk: 0.9, daysOverdue: 0 };
    const overdue = Math.max(0, (now - c.nextReview) / 86400_000);
    // Ebbinghaus: R = e^(-t/S) where S = stability (related to interval)
    const stability = c.interval * c.easiness;
    const elapsed   = (now - c.lastReview) / 86400_000;
    const retention = Math.exp(-elapsed / stability);
    const risk      = Math.round((1 - retention) * 100) / 100;
    return { cardId: id, risk, retention: Math.round(retention * 100) / 100, daysOverdue: Math.round(overdue) };
  }).sort((a, b) => b.risk - a.risk);
}

module.exports = { recordReview, getDueCards, getWeakPoints, getMastery, recordSession, getForgettingRisk };
