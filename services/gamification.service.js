'use strict';

const EventEmitter = require('events');

// ── Event bus ─────────────────────────────────────────────────────────────────
// Decouples gamification state mutations from side-effects (logging, cache
// invalidation, future push notifications, analytics).
const emitter = new EventEmitter();
emitter.setMaxListeners(20);

// Default monitoring handlers — log milestones, detect anomalies
emitter.on('XP_GAINED', ({ amount, totalXP, source }) => {
  if (amount > 300) console.log(`[gami] Large XP gain: +${amount} (total ${totalXP}, source: ${source})`);
});
emitter.on('STREAK_UPDATED', ({ streak }) => {
  if ([7, 14, 30].includes(streak)) console.log(`[gami] Streak milestone: ${streak} days`);
});
emitter.on('SHIELD_EARNED', ({ shields }) => {
  if (shields === 3) console.log('[gami] Max shields reached');
});
emitter.on('REFERRAL_COMPLETED', ({ referrerEmail, newUserEmail, xpBonus }) => {
  console.log(`[gami] Referral: ${referrerEmail} → ${newUserEmail} (+${xpBonus} XP each)`);
});

// ── Constants ────────────────────────────────────────────────────────────────

const BADGE_DEFS = {
  first_quiz:   { icon: '🎯', name: 'Premier quiz',    desc: 'Tu as complété ton premier quiz !' },
  perfect_quiz: { icon: '⭐', name: 'Score parfait',   desc: '10/10 — impeccable !' },
  streak_3:     { icon: '🔥', name: 'En feu !',        desc: '3 jours consécutifs — +50 XP bonus' },
  streak_7:     { icon: '⚡', name: 'Semaine de feu',  desc: '7 jours consécutifs' },
  streak_14:    { icon: '💪', name: 'Indestructible',  desc: '14 jours consécutifs' },
  streak_30:    { icon: '👑', name: 'Élite',            desc: '30 jours consécutifs' },
  quiz_5:       { icon: '📚', name: 'Studieux',         desc: '5 quiz complétés' },
  quiz_20:      { icon: '🧠', name: 'Cerveau actif',   desc: '20 quiz complétés' },
  quiz_50:      { icon: '🏆', name: 'Champion',         desc: '50 quiz complétés' },
  founder:      { icon: '💎', name: 'Fondateur',        desc: 'Accès Premium — merci !' },
};

const MISSION_DEFS = {
  generate: { icon: '📘', label: 'Générer 1 fiche de révision', xp: 10 },
  quiz:     { icon: '🧠', label: 'Compléter 1 quiz',            xp: 10 },
  review:   { icon: '✏️',  label: '3 bonnes réponses au quiz',   xp: 10, target: 3 },
};

const MISSION_ALL_BONUS = 50;
const XP_BY_DIFF        = { 1: 10, 2: 20, 3: 40 };

// ── Helpers ──────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().split('T')[0];
}

function getWeekKey() {
  const d   = new Date();
  const day = d.getDay() || 7;
  const mon = new Date(d);
  mon.setDate(d.getDate() - day + 1);
  return mon.toISOString().split('T')[0];
}

function xpForLevel(level) { return (level - 1) * 100; }
function getLevel(totalXP)  { return Math.min(100, Math.floor((totalXP || 0) / 100) + 1); }

function getStreakMultiplier(streak) {
  if ((streak || 0) >= 30) return 2.0;
  if ((streak || 0) >= 14) return 1.5;
  if ((streak || 0) >= 7)  return 1.2;
  return 1.0;
}

// ── Init ─────────────────────────────────────────────────────────────────────

function initGami() {
  return {
    xp: 0, level: 1, streak: 0, lastActiveDate: null,
    totalQuizzes: 0, perfectQuizzes: 0,
    badges: [],        // only BADGE_DEFS keys — no internal flags
    _shieldFlags: [],  // which shield milestones already awarded
    weeklyXP: 0, weeklyReset: null, xpByDay: {},
    dailyMissions: null, streakShields: 0,
  };
}

function ensureGami(user) {
  if (!user.gamification) user.gamification = initGami();
  if (!user.gamification._shieldFlags) user.gamification._shieldFlags = [];
  if (!user.gamification._antifraud)   user.gamification._antifraud   = {};
}

// ── XP ───────────────────────────────────────────────────────────────────────

function addXPToDay(gami, amount) {
  const d = today();
  if (!gami.xpByDay) gami.xpByDay = {};
  gami.xpByDay[d] = (gami.xpByDay[d] || 0) + amount;
  const keys = Object.keys(gami.xpByDay).sort();
  if (keys.length > 14) keys.slice(0, keys.length - 14).forEach(k => delete gami.xpByDay[k]);
}

// ctx is optional — { userId, email, source } — used for event emission only
function giveXP(gami, amount, ctx = {}) {
  if (amount <= 0) return;
  gami.xp = (gami.xp || 0) + amount;
  gami.level = getLevel(gami.xp);
  const tw = getWeekKey();
  if (gami.weeklyReset !== tw) { gami.weeklyXP = 0; gami.weeklyReset = tw; }
  gami.weeklyXP = (gami.weeklyXP || 0) + amount;
  addXPToDay(gami, amount);
  // Enriched payload — handlers.js uses weeklyXP + weekKey for incremental leaderboard update
  emitter.emit('XP_GAINED', {
    userId:   ctx.userId,
    email:    ctx.email,
    amount,
    totalXP:  gami.xp,
    weeklyXP: gami.weeklyXP,
    weekKey:  gami.weeklyReset,
    level:    gami.level,
    streak:   gami.streak,
    source:   ctx.source || 'unknown',
  });
}

function computeXPGain(score, total, streak, isFirstToday, correctByDiff) {
  let base = 0;
  const cbd = correctByDiff || {};
  for (const [diff, count] of Object.entries(cbd)) {
    base += (XP_BY_DIFF[parseInt(diff)] || 10) * (count || 0);
  }
  if (base === 0 && score > 0) base = Math.round((score / total) * 70);

  const perfect     = score === total ? Math.round(base * 0.2) : 0;
  const streakBonus = ((streak || 0) > 0 && (streak % 3 === 0)) ? 50 : 0;
  const daily       = isFirstToday ? 20 : 0;
  return { base, perfect, streakBonus, daily, total: base + perfect + streakBonus + daily };
}

// ── Streak ───────────────────────────────────────────────────────────────────

function applyStreak(gami, ctx = {}) {
  const todayStr   = today();
  const yesterday  = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0];
  if (gami.lastActiveDate === todayStr) return false;

  if (gami.lastActiveDate === twoDaysAgo && (gami.streakShields || 0) > 0) {
    gami.streakShields--;
    gami.lastActiveDate = todayStr;
    emitter.emit('STREAK_UPDATED', { userId: ctx.userId, streak: gami.streak, shieldUsed: true });
    return true;
  }

  gami.streak         = gami.lastActiveDate === yesterday ? (gami.streak || 0) + 1 : 1;
  gami.lastActiveDate = todayStr;
  emitter.emit('STREAK_UPDATED', { userId: ctx.userId, streak: gami.streak, shieldUsed: false });
  return true;
}

function awardStreakShield(gami, ctx = {}) {
  gami.streakShields = Math.min((gami.streakShields || 0) + 1, 3);
  emitter.emit('SHIELD_EARNED', { userId: ctx.userId, shields: gami.streakShields });
}

// ── Badges ───────────────────────────────────────────────────────────────────

function checkBadges(gami, premiumPlan) {
  const earned = new Set(gami.badges || []);
  if (!gami._shieldFlags) gami._shieldFlags = [];
  const shieldFlags = new Set(gami._shieldFlags);
  const newOnes = [];

  const give      = (id)     => { if (!earned.has(id))     { earned.add(id);     newOnes.push(id); } };
  const giveShield = (flagId) => { if (!shieldFlags.has(flagId)) { shieldFlags.add(flagId); awardStreakShield(gami); } };

  if ((gami.totalQuizzes   || 0) >= 1)  give('first_quiz');
  if ((gami.totalQuizzes   || 0) >= 5)  give('quiz_5');
  if ((gami.totalQuizzes   || 0) >= 20) give('quiz_20');
  if ((gami.totalQuizzes   || 0) >= 50) give('quiz_50');
  if ((gami.perfectQuizzes || 0) >= 1)  give('perfect_quiz');
  if ((gami.streak         || 0) >= 3)  give('streak_3');
  if ((gami.streak         || 0) >= 7)  { give('streak_7');  giveShield('streak_7_shield');  }
  if ((gami.streak         || 0) >= 14) { give('streak_14'); giveShield('streak_14_shield'); }
  if ((gami.streak         || 0) >= 30) { give('streak_30'); giveShield('streak_30_shield'); }
  if (premiumPlan === 'lifetime')        give('founder');

  gami.badges       = [...earned];
  gami._shieldFlags = [...shieldFlags];
  return newOnes;
}

// ── Missions ─────────────────────────────────────────────────────────────────

function initDailyMissions() {
  return { date: today(), generate: false, quiz: false,
           reviewCount: 0, reviewDone: false, bonusClaimed: false };
}

function resetMissionsIfNeeded(gami) {
  if (!gami.dailyMissions || gami.dailyMissions.date !== today()) {
    gami.dailyMissions = initDailyMissions();
  }
}

function checkAllMissionsBonus(gami, ctx = {}) {
  const dm = gami.dailyMissions;
  if (!dm || dm.bonusClaimed) return 0;
  if (!dm.generate || !dm.quiz || !dm.reviewDone) return 0;
  dm.bonusClaimed = true;
  giveXP(gami, MISSION_ALL_BONUS, { ...ctx, source: 'missions_bonus' });
  return MISSION_ALL_BONUS;
}

function buildMissionsPayload(dm) {
  if (!dm) dm = initDailyMissions();
  const doneCount = [dm.generate, dm.quiz, dm.reviewDone].filter(Boolean).length;
  return {
    date: dm.date,
    missions: [
      { id: 'generate', ...MISSION_DEFS.generate, done: !!dm.generate,   progress: dm.generate  ? 1 : 0, target: 1 },
      { id: 'quiz',     ...MISSION_DEFS.quiz,     done: !!dm.quiz,        progress: dm.quiz      ? 1 : 0, target: 1 },
      { id: 'review',   ...MISSION_DEFS.review,   done: !!dm.reviewDone,  progress: Math.min(dm.reviewCount || 0, 3), target: 3 },
    ],
    doneCount,
    allDone:      doneCount === 3,
    bonusClaimed: !!dm.bonusClaimed,
    bonusXP:      MISSION_ALL_BONUS,
  };
}

// ── UI helpers ───────────────────────────────────────────────────────────────

function buildGamiResponse(gami) {
  const lv    = getLevel(gami.xp || 0);
  const xpCur = (gami.xp || 0) - xpForLevel(lv);
  const xpNxt = xpForLevel(lv + 1) - xpForLevel(lv);
  return {
    xp:              gami.xp || 0,
    level:           lv,
    streak:          gami.streak || 0,
    streakMultiplier:getStreakMultiplier(gami.streak),
    streakWarning:   (gami.streak || 0) > 0 && gami.lastActiveDate !== today(),
    streakShields:   gami.streakShields || 0,
    lastActiveDate:  gami.lastActiveDate || null,
    totalQuizzes:    gami.totalQuizzes || 0,
    perfectQuizzes:  gami.perfectQuizzes || 0,
    weeklyXP:        gami.weeklyXP || 0,
    badges:          (gami.badges || []).map(id => ({ id, ...(BADGE_DEFS[id] || {}) })),
    allBadges:       Object.entries(BADGE_DEFS).map(([id, def]) => ({
                       id, ...def, earned: (gami.badges || []).includes(id),
                     })),
    progress: {
      current: xpCur,
      needed:  xpNxt,
      pct:     xpNxt > 0 ? Math.round(xpCur / xpNxt * 100) : 100,
    },
    xpByDay:  gami.xpByDay || {},
    missions: buildMissionsPayload(gami.dailyMissions),
  };
}

function buildMotivational(current, needed, level, streak) {
  const remaining = needed - current;
  if (remaining <= 10) return `🚀 Encore ${remaining} XP pour le niveau ${level + 1} !`;
  if (current >= 80)   return `💪 Tu es à ${current}% du niveau ${level + 1} — presque !`;
  if (current >= 50)   return `📈 Mi-chemin vers le niveau ${level + 1}. Continue !`;
  if ((streak || 0) >= 3) return `🔥 Série de ${streak} jours — garde le rythme !`;
  return `⚡ ${current} / ${needed} XP vers le niveau ${level + 1}`;
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  emitter,       // subscribe to: XP_GAINED, STREAK_UPDATED, SHIELD_EARNED, REFERRAL_COMPLETED
  BADGE_DEFS,
  MISSION_DEFS,
  MISSION_ALL_BONUS,
  XP_BY_DIFF,
  today,
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
  initDailyMissions,
  resetMissionsIfNeeded,
  checkAllMissionsBonus,
  buildMissionsPayload,
  buildGamiResponse,
  buildMotivational,
};
