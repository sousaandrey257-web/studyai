'use strict';
// Study Battle — async quiz duels (polling-based, no WebSocket required)
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const DIR    = path.join(__dirname, '../../data/battles');
const TTL_MS = 24 * 3600_000;
try { if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true }); } catch {}

function file(id) { return path.join(DIR, `${id}.json`); }
function load(id) { try { return JSON.parse(fs.readFileSync(file(id), 'utf8')); } catch { return null; } }
function save(id, b) { fs.writeFileSync(file(id) + '.tmp', JSON.stringify(b)); fs.renameSync(file(id) + '.tmp', file(id)); }

// ── Create a battle ─────────────────────────────────────────
function create({ creatorId, questions, topicTitle = 'Duel Quiz' }) {
  const id = crypto.randomBytes(6).toString('hex').toUpperCase();
  const battle = {
    id,
    topicTitle,
    status:     'waiting',  // waiting|active|finished
    createdAt:  new Date().toISOString(),
    expiresAt:  new Date(Date.now() + TTL_MS).toISOString(),
    players: {
      [creatorId]: { id: creatorId, score: 0, answers: {}, finishedAt: null, ready: true },
    },
    questions: questions.slice(0, 10).map((q, i) => ({
      id: i + 1, type: q.type, question: q.question,
      options: q.options, correct: q.correct, difficulty: q.difficulty,
    })),
    winner: null,
  };
  save(id, battle);
  return { battleId: id, inviteUrl: `/battle?id=${id}`, totalQuestions: battle.questions.length };
}

// ── Join a battle ─────────────────────────────────────────────
function join(battleId, userId) {
  const b = load(battleId);
  if (!b) throw new Error('Battle introuvable.');
  if (b.status === 'finished') throw new Error('Battle déjà terminée.');
  if (new Date(b.expiresAt) < new Date()) throw new Error('Battle expirée.');
  if (Object.keys(b.players).length >= 2 && !b.players[userId])
    throw new Error('Battle complète.');

  if (!b.players[userId]) {
    b.players[userId] = { id: userId, score: 0, answers: {}, finishedAt: null, ready: true };
    if (Object.keys(b.players).length === 2) b.status = 'active';
  }

  save(battleId, b);
  return { status: b.status, players: Object.keys(b.players).length };
}

// ── Submit an answer ──────────────────────────────────────────
function answer(battleId, userId, { questionId, answer, timeMs }) {
  const b = load(battleId);
  if (!b || !b.players[userId]) throw new Error('Battle ou joueur introuvable.');

  const q = b.questions.find(q => q.id === questionId);
  if (!q) throw new Error('Question introuvable.');

  const isOk  = String(answer).toUpperCase() === String(q.correct).toUpperCase();
  const speed  = Math.max(0, 30000 - (timeMs || 30000)); // speed bonus: faster = more points
  const points = isOk ? (q.difficulty === 'hard' ? 30 : q.difficulty === 'medium' ? 20 : 10) + Math.round(speed / 3000) : 0;

  b.players[userId].answers[questionId] = { answer, correct: isOk, points, timeMs };
  b.players[userId].score += points;

  // Check if player finished all questions
  const answered = Object.keys(b.players[userId].answers).length;
  if (answered >= b.questions.length && !b.players[userId].finishedAt) {
    b.players[userId].finishedAt = new Date().toISOString();
    // Check if all players finished
    const allDone = Object.values(b.players).every(p => p.finishedAt);
    if (allDone) {
      b.status = 'finished';
      const scores = Object.entries(b.players).map(([id, p]) => ({ id, score: p.score }));
      scores.sort((a, x) => x.score - a.score);
      b.winner = scores[0].id;
    }
  }

  save(battleId, b);
  return { correct: isOk, points, totalScore: b.players[userId].score, status: b.status };
}

// ── Poll battle state ─────────────────────────────────────────
function poll(battleId, userId) {
  const b = load(battleId);
  if (!b) return null;

  const myPlayer  = b.players[userId];
  const opponents = Object.values(b.players).filter(p => p.id !== userId);

  // Strip correct answers unless finished
  const qs = b.status === 'finished'
    ? b.questions
    : b.questions.map(({ correct, ...q }) => q);

  return {
    battleId:   b.id,
    topicTitle: b.topicTitle,
    status:     b.status,
    winner:     b.winner,
    questions:  qs,
    me:         myPlayer ? { score: myPlayer.score, answered: Object.keys(myPlayer.answers).length } : null,
    opponent:   opponents[0] ? { score: opponents[0].score, answered: Object.keys(opponents[0].answers).length } : null,
    players:    Object.keys(b.players).length,
  };
}

module.exports = { create, join, answer, poll };
