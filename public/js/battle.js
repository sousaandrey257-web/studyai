'use strict';
/* ===== Study Battle Frontend ===== */

const API = '/api/ai';
let battleId = null;
let myUserId = null;
let pollTimer = null;
let timerInterval = null;
let currentQ = 0;
let totalQ = 0;
let answered = false;
let myScore = 0;
let oppScore = 0;
let myAnswers = [];

// ── Section helpers ──────────────────────────────────────────
function showSection(id) {
  document.querySelectorAll('.battle-section').forEach(s => s.classList.add('hidden'));
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

// ── Auth token ───────────────────────────────────────────────
function getToken() {
  return localStorage.getItem('studyai_auth_token') || localStorage.getItem('token') || '';
}
function authHeaders() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// ── Parse URL params ─────────────────────────────────────────
function init() {
  const params = new URLSearchParams(location.search);
  const code = params.get('battle') || params.get('code') || params.get('id');
  if (code) {
    document.getElementById('join-code-input').value = code.toUpperCase();
    joinBattle(code.toUpperCase());
    return;
  }
  showSection('section-lobby');
  setupLobby();
}

// ── Lobby ────────────────────────────────────────────────────
function setupLobby() {
  document.getElementById('btn-join').addEventListener('click', () => {
    const code = document.getElementById('join-code-input').value.trim().toUpperCase();
    if (!code || code.length !== 6) return showJoinError('Saisis un code de 6 lettres.');
    joinBattle(code);
  });

  document.getElementById('join-code-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-join').click();
  });

  document.getElementById('btn-copy-code').addEventListener('click', () => {
    const code = document.getElementById('battle-code-display').textContent;
    navigator.clipboard.writeText(code).then(() => {
      document.getElementById('btn-copy-code').textContent = '✓ Copié !';
      setTimeout(() => { document.getElementById('btn-copy-code').textContent = '📋 Copier le code'; }, 2000);
    });
  });
}

function showJoinError(msg) {
  const el = document.getElementById('join-error');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

// ── Create battle (called from upload.js via URL param) ──────
// battle.html?battleId=ABC123
async function startAsCreator(id) {
  battleId = id;
  document.getElementById('battle-code-display').textContent = id;
  document.getElementById('create-info').classList.remove('hidden');
  document.getElementById('create-waiting').classList.remove('hidden');
  pollForOpponent();
}

// ── Join battle ──────────────────────────────────────────────
async function joinBattle(code) {
  try {
    const res = await fetch(`${API}/battle/${code}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!res.ok) return showJoinError(data.error || 'Code invalide.');
    battleId = code;
    myUserId = data.joinerId;
    localStorage.setItem('battlePlayerId', myUserId);
    startCountdown(data);
  } catch (err) {
    showJoinError('Erreur de connexion.');
  }
}

// ── Poll for opponent (creator side) ────────────────────────
function pollForOpponent() {
  let attempts = 0;
  const iv = setInterval(async () => {
    attempts++;
    if (attempts > 120) { clearInterval(iv); return; } // 4 min timeout
    try {
      const res = await fetch(`${API}/battle/${battleId}/poll`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      if (data.players && data.players.length >= 2) {
        clearInterval(iv);
        myUserId = data.players[0].id;
        localStorage.setItem('battlePlayerId', myUserId);
        startCountdown(data);
      }
    } catch {}
  }, 2000);
}

// ── Countdown ────────────────────────────────────────────────
function startCountdown(battleData) {
  showSection('section-countdown');
  const players = battleData.players || [];
  if (players[0]) document.getElementById('cd-name1').textContent = players[0].name || 'Joueur 1';
  if (players[1]) document.getElementById('cd-name2').textContent = players[1].name || 'Joueur 2';

  let count = 3;
  const el = document.getElementById('countdown-num');
  el.textContent = count;

  const iv = setInterval(() => {
    count--;
    if (count <= 0) {
      clearInterval(iv);
      el.textContent = '⚔️';
      setTimeout(() => startGame(battleData), 500);
    } else {
      el.textContent = count;
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = 'countdown-pop .8s ease';
    }
  }, 1000);
}

// ── Game ─────────────────────────────────────────────────────
function startGame(battleData) {
  showSection('section-game');
  totalQ = battleData.questions?.length || 6;
  currentQ = 0;
  myScore = 0;
  oppScore = 0;
  myAnswers = [];

  const players = battleData.players || [];
  document.getElementById('sb-name-me').textContent = 'Moi';
  document.getElementById('sb-name-opp').textContent = players.find(p => p.id !== myUserId)?.name || 'Adversaire';

  renderQuestion(battleData.questions[0]);
  startPollLoop();
}

function renderQuestion(q) {
  if (!q) return;
  answered = false;

  document.getElementById('sb-qnum').textContent = `Q${currentQ + 1}/${totalQ}`;
  document.getElementById('bq-diff').textContent =
    q.difficulty === 'hard' ? 'Difficile' : q.difficulty === 'easy' ? 'Facile' : 'Moyen';

  document.getElementById('bq-text').textContent = q.question;
  document.getElementById('bq-feedback').classList.add('hidden');

  const card = document.getElementById('battle-qcard');
  card.classList.remove('correct', 'wrong');

  const choicesEl = document.getElementById('bq-choices');
  choicesEl.innerHTML = '';

  const choices = q.choices || [];
  choices.forEach((choice, i) => {
    const btn = document.createElement('button');
    btn.className = 'bq-choice';
    btn.textContent = choice;
    btn.addEventListener('click', () => submitAnswer(i, q, btn, choices));
    choicesEl.appendChild(btn);
  });

  resetTimer(q);
  document.getElementById('opp-thinking').classList.remove('hidden');
  document.getElementById('opp-answered').classList.add('hidden');
}

let timerVal = 30;
function resetTimer(q) {
  clearInterval(timerInterval);
  timerVal = 30;
  const el = document.getElementById('sb-timer');
  el.textContent = timerVal;
  el.classList.remove('urgent');
  timerInterval = setInterval(() => {
    timerVal--;
    el.textContent = timerVal;
    if (timerVal <= 10) el.classList.add('urgent');
    if (timerVal <= 0) {
      clearInterval(timerInterval);
      if (!answered) submitAnswer(-1, q, null, q.choices || []);
    }
  }, 1000);
}

async function submitAnswer(choiceIdx, q, clickedBtn, choices) {
  if (answered) return;
  answered = true;
  clearInterval(timerInterval);

  const timeMs = (30 - timerVal) * 1000;
  const speedBonus = timerVal >= 20 ? 50 : timerVal >= 10 ? 25 : 0;

  // Disable all choices
  document.querySelectorAll('.bq-choice').forEach(b => b.disabled = true);

  try {
    const res = await fetch(`${API}/battle/${battleId}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        playerId: myUserId,
        questionIndex: currentQ,
        choiceIndex: choiceIdx,
        responseMs: timeMs,
      }),
    });
    const data = await res.json();

    const isCorrect = data.correct;
    const correctIdx = data.correctIndex;

    // Reveal answer
    choices.forEach((_, i) => {
      const btn = document.querySelectorAll('.bq-choice')[i];
      if (!btn) return;
      if (i === correctIdx) btn.classList.add('correct');
      else if (i === choiceIdx && !isCorrect) btn.classList.add('wrong');
    });

    const card = document.getElementById('battle-qcard');
    card.classList.add(isCorrect ? 'correct' : 'wrong');

    const feedbackEl = document.getElementById('bq-feedback');
    feedbackEl.classList.remove('hidden', 'correct', 'wrong');
    if (isCorrect) {
      const pts = (data.points || 100) + speedBonus;
      feedbackEl.textContent = `✓ Correct ! +${pts} pts${speedBonus ? ` (bonus vitesse: +${speedBonus})` : ''}`;
      feedbackEl.classList.add('correct');
      myScore += pts;
    } else {
      feedbackEl.textContent = `✗ Incorrect. ${q.explanation || ''}`;
      feedbackEl.classList.add('wrong');
    }

    document.getElementById('sb-score-me').textContent = myScore;
    document.getElementById('sb-score-me').classList.add('bump');
    setTimeout(() => document.getElementById('sb-score-me').classList.remove('bump'), 400);

    myAnswers.push({ questionIndex: currentQ, correct: isCorrect, choiceIdx });

  } catch (err) {
    console.error('Answer submit error:', err);
  }

  // Advance after delay
  setTimeout(() => advanceQuestion(), 2500);
}

function advanceQuestion() {
  currentQ++;
  if (currentQ >= totalQ) {
    finishGame();
    return;
  }
  // Fetch next question state from poll
  fetchBattleState();
}

async function fetchBattleState() {
  try {
    const res = await fetch(`${API}/battle/${battleId}/poll`, {
      headers: authHeaders(),
    });
    if (!res.ok) return;
    const state = await res.json();
    updateOppScore(state);
    const q = state.questions?.[currentQ];
    if (q) renderQuestion(q);
  } catch { /* réseau — ignoré, le prochain poll réessaie */ }
}

function startPollLoop() {
  let _loopErrors = 0;
  pollTimer = setInterval(async () => {
    try {
      const res = await fetch(`${API}/battle/${battleId}/poll`, {
        headers: authHeaders(),
      });
      if (!res.ok) { _loopErrors++; if (_loopErrors > 5) clearInterval(pollTimer); return; }
      _loopErrors = 0;
      const state = await res.json();
      if (state.status === 'finished') {
        clearInterval(pollTimer);
        showFinalResults(state);
        return;
      }
      updateOppScore(state);

      const oppPlayer = (state.players || []).find(p => p.id !== myUserId);
      if (oppPlayer) {
        const oppAnswered = (oppPlayer.answers || []).length > currentQ;
        document.getElementById('opp-thinking').classList.toggle('hidden', oppAnswered);
        document.getElementById('opp-answered').classList.toggle('hidden', !oppAnswered);
      }
    } catch { _loopErrors++; if (_loopErrors > 5) clearInterval(pollTimer); }
  }, 1800);
}

function updateOppScore(state) {
  const opp = (state.players || []).find(p => p.id !== myUserId);
  if (opp && opp.score !== oppScore) {
    oppScore = opp.score || 0;
    const el = document.getElementById('sb-score-opp');
    el.textContent = oppScore;
    el.classList.add('bump');
    setTimeout(() => el.classList.remove('bump'), 400);
  }
}

async function finishGame() {
  clearInterval(pollTimer);
  clearInterval(timerInterval);
  try {
    const res = await fetch(`${API}/battle/${battleId}/poll`, {
      headers: authHeaders(),
    });
    const state = await res.json();
    showFinalResults(state);
  } catch {
    showFinalResults({ players: [], status: 'finished' });
  }
}

function showFinalResults(state) {
  clearInterval(pollTimer);
  clearInterval(timerInterval);
  showSection('section-battle-results');

  const players = state.players || [];
  const me = players.find(p => p.id === myUserId) || { name: 'Moi', score: myScore, accuracy: 0 };
  const opp = players.find(p => p.id !== myUserId) || { name: 'Adversaire', score: oppScore, accuracy: 0 };

  const iWon = me.score > opp.score;
  const isDraw = me.score === opp.score;

  document.getElementById('result-crown').textContent = isDraw ? '🤝' : iWon ? '🏆' : '💪';
  document.getElementById('result-title').textContent = isDraw ? 'Égalité !' : iWon ? 'Tu as gagné !' : 'Défaite';
  document.getElementById('result-sub').textContent = isDraw
    ? 'Personne ne lâche rien — bonne revanche !'
    : iWon
    ? `Tu as battu ${opp.name} — excellent travail !`
    : `${opp.name} a gagné cette fois. Revanche ?`;

  document.getElementById('final-name-me').textContent = me.name || 'Moi';
  document.getElementById('final-pts-me').textContent = `${me.score || 0} pts`;
  document.getElementById('final-acc-me').textContent = `${Math.round((me.accuracy || 0) * 100)}% précision`;

  document.getElementById('final-name-opp').textContent = opp.name || 'Adversaire';
  document.getElementById('final-pts-opp').textContent = `${opp.score || 0} pts`;
  document.getElementById('final-acc-opp').textContent = `${Math.round((opp.accuracy || 0) * 100)}% précision`;

  if (iWon) document.getElementById('final-me').classList.add('winner');
  else if (!isDraw) document.getElementById('final-opp').classList.add('winner');

  // Breakdown
  const correct = myAnswers.filter(a => a.correct).length;
  document.getElementById('result-breakdown').innerHTML = `
    <div class="breakdown-row"><span>Tes bonnes réponses</span><strong>${correct} / ${totalQ}</strong></div>
    <div class="breakdown-row"><span>Ton score</span><strong>${me.score || 0} pts</strong></div>
    <div class="breakdown-row"><span>Score adversaire</span><strong>${opp.score || 0} pts</strong></div>
    <div class="breakdown-row"><span>Écart</span><strong>${Math.abs((me.score || 0) - (opp.score || 0))} pts</strong></div>
  `;

  document.getElementById('btn-rematch').addEventListener('click', () => {
    location.reload();
  });
}

// ── Boot ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!window.APP_MANAGED) {
    init();
    // If arrived via ?battleId= (creator flow from upload page)
    const params = new URLSearchParams(location.search);
    const bid = params.get('battleId');
    if (bid) {
      showSection('section-lobby');
      document.getElementById('create-info').classList.remove('hidden');
      document.getElementById('create-waiting').classList.remove('hidden');
      document.getElementById('battle-code-display').textContent = bid;
      battleId = bid;
      myUserId = localStorage.getItem('battlePlayerId') || null;
      pollForOpponent();
    }
  }
  window._battleAPI = { init, showSection };
});
