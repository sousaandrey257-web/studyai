'use strict';
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, '../../data/exams');
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

// ── Exam session management ──────────────────────────────────
function createExam({ userId, questions, config = {} }) {
  const id = crypto.randomBytes(8).toString('hex');
  const exam = {
    id,
    userId:    userId || null,
    status:    'active',
    config: {
      durationMin:  config.durationMin  || 60,
      mode:         config.mode         || 'standard',  // standard|stress|concours
      shuffleQ:     config.shuffleQ     !== false,
      showTimer:    config.showTimer    !== false,
      allowReview:  config.allowReview  !== false,
    },
    questions: (config.shuffleQ !== false ? shuffle(questions) : questions).map((q, i) => ({
      ...q,
      _examIdx: i,
      _answered: false,
      _userAnswer: null,
      _timeMs: null,
    })),
    answers:    {},
    startedAt:  new Date().toISOString(),
    endedAt:    null,
    grade:      null,
    analytics:  null,
  };

  persist(id, exam);
  return { examId: id, totalQuestions: exam.questions.length, config: exam.config };
}

function submitAnswer(examId, userId, { questionId, answer, timeMs }) {
  const exam = load(examId);
  if (!exam) throw new Error('Examen introuvable.');
  if (exam.status !== 'active') throw new Error('Examen déjà terminé.');
  if (exam.userId && exam.userId !== userId) throw new Error('Accès refusé.');

  exam.answers[questionId] = { answer, timeMs: timeMs || 0, submittedAt: new Date().toISOString() };
  const q = exam.questions.find(x => String(x.id) === String(questionId));
  if (q) { q._answered = true; q._userAnswer = answer; q._timeMs = timeMs; }

  persist(examId, exam);
  const answered  = Object.keys(exam.answers).length;
  const remaining = exam.questions.length - answered;
  return { answered, remaining, total: exam.questions.length };
}

function finishExam(examId, userId) {
  const exam = load(examId);
  if (!exam) throw new Error('Examen introuvable.');
  if (exam.userId && exam.userId !== userId) throw new Error('Accès refusé.');

  exam.status  = 'finished';
  exam.endedAt = new Date().toISOString();

  const { grade, analytics } = GradingEngine.grade(exam);
  exam.grade    = grade;
  exam.analytics = analytics;

  persist(examId, exam);
  return { examId, grade, analytics };
}

function getExam(examId, userId, { includeAnswers = false } = {}) {
  const exam = load(examId);
  if (!exam) return null;
  if (exam.userId && exam.userId !== userId) return null;

  // Strip correct answers from active exams (anti-cheat)
  const qs = exam.status === 'active' && !includeAnswers
    ? exam.questions.map(q => {
        const { correct, explanation, answer_guide, ...safe } = q;
        return safe;
      })
    : exam.questions;

  return { ...exam, questions: qs };
}

function persist(id, exam) {
  const tmp = path.join(DIR, `${id}.tmp`);
  const dst = path.join(DIR, `${id}.json`);
  fs.writeFileSync(tmp, JSON.stringify(exam));
  fs.renameSync(tmp, dst);
}

function load(id) {
  try { return JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8')); }
  catch { return null; }
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Grading Engine ────────────────────────────────────────────
const GradingEngine = {
  grade(exam) {
    const qs   = exam.questions;
    const total = qs.length;
    if (!total) return { grade: null, analytics: null };

    let correct = 0, points = 0, totalPoints = 0;
    const byDifficulty = { easy: { c: 0, t: 0 }, medium: { c: 0, t: 0 }, hard: { c: 0, t: 0 } };
    const byType       = {};
    const slowest = [], missed = [];

    for (const q of qs) {
      const w   = q.difficulty === 'hard' ? 3 : q.difficulty === 'medium' ? 2 : 1;
      totalPoints += w;
      const diff = q.difficulty || 'medium';
      byDifficulty[diff].t++;
      byType[q.type] = byType[q.type] || { c: 0, t: 0 };
      byType[q.type].t++;

      const userAns = exam.answers[q.id]?.answer;
      const isOk    = this.isCorrect(q, userAns);

      if (isOk) {
        correct++; points += w;
        byDifficulty[diff].c++;
        byType[q.type].c++;
      } else {
        missed.push({ question: q.question, correct: q.correct || q.answer_guide, userAnswer: userAns });
      }

      if (q._timeMs > 30_000 && !isOk) {
        slowest.push({ question: q.question, timeMs: q._timeMs });
      }
    }

    const rawScore  = Math.round((correct / total) * 100);
    const weightedScore = Math.round((points / totalPoints) * 100);
    const estimated20 = Math.round(weightedScore / 100 * 20 * 10) / 10;

    return {
      grade: {
        correct, total, rawScore, weightedScore,
        estimated20,
        letter: this.letter(weightedScore),
        passed: weightedScore >= 50,
      },
      analytics: {
        byDifficulty,
        byType,
        missed: missed.slice(0, 5),
        slowestQuestions: slowest.slice(0, 3).sort((a, b) => b.timeMs - a.timeMs),
        avgTimeMs: qs.reduce((s, q) => s + (q._timeMs || 0), 0) / total,
        recommendation: this.recommend(weightedScore, byDifficulty),
      },
    };
  },

  isCorrect(q, answer) {
    if (!answer && answer !== false) return false;
    if (q.type === 'mcq')       return String(answer).toUpperCase() === String(q.correct).toUpperCase();
    if (q.type === 'truefalse') return Boolean(answer) === Boolean(q.correct);
    if (q.type === 'open')      return true; // auto-pass open questions
    return false;
  },

  letter(score) {
    if (score >= 90) return 'A'; if (score >= 80) return 'B';
    if (score >= 70) return 'C'; if (score >= 60) return 'D'; return 'F';
  },

  recommend(score, byDiff) {
    if (score >= 80) return 'Excellente maîtrise ! Passez au contenu suivant.';
    if (score >= 60) return 'Bonne base. Révisez les questions ratées et refaites un examen.';
    if (byDiff.hard.t > 0 && byDiff.hard.c / byDiff.hard.t < 0.3)
      return 'Concentrez-vous sur les concepts difficiles avant de refaire l\'examen.';
    return 'Revenez aux flashcards et au mémo, puis retentez dans 24h.';
  },
};

module.exports = { createExam, submitAnswer, finishExam, getExam };
