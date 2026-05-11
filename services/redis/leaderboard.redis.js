'use strict';
// Redis-backed leaderboard using sorted sets.
// Falls back silently when Redis unavailable.
// Keys: leaderboard:xp:{weekKey}   (score = weeklyXP)
//       leaderboard:meta:{userId}  (hash — label, level, streak)

const redis = require('./client');

const TTL_SECONDS = 8 * 24 * 3600; // 8 days — covers full week + buffer

function _weekKey(weekStr) {
  return `leaderboard:xp:${weekStr}`;
}
function _metaKey(userId) {
  return `leaderboard:meta:${userId}`;
}

// Add/increment weeklyXP for a user. Fire-and-forget — never throws.
async function incrXP(weekStr, userId, label, amount) {
  const r = redis.getClient();
  if (!r) return;
  try {
    const key = _weekKey(weekStr);
    await r.zincrby(key, amount, userId);
    await r.expire(key, TTL_SECONDS);
    await r.hset(_metaKey(userId), { label, ts: Date.now() });
    await r.expire(_metaKey(userId), TTL_SECONDS);
  } catch {}
}

// Overwrite total weeklyXP (used after local-node computes true value).
async function setXP(weekStr, userId, label, weeklyXP, level, streak) {
  const r = redis.getClient();
  if (!r) return;
  try {
    const key = _weekKey(weekStr);
    await r.zadd(key, weeklyXP, userId);
    await r.expire(key, TTL_SECONDS);
    await r.hset(_metaKey(userId), { label, level, streak, ts: Date.now() });
    await r.expire(_metaKey(userId), TTL_SECONDS);
  } catch {}
}

// Returns top-N entries as [{ _userId, label, weeklyXP, level, streak, rank }] or null on failure.
async function getTopN(weekStr, n = 10) {
  const r = redis.getClient();
  if (!r) return null;
  try {
    const key  = _weekKey(weekStr);
    const rows = await r.zrevrange(key, 0, n - 1, 'WITHSCORES');
    if (!rows || rows.length === 0) return null;

    const entries = [];
    for (let i = 0; i < rows.length; i += 2) {
      const userId = rows[i];
      const xp     = parseInt(rows[i + 1]) || 0;
      const meta   = await r.hgetall(_metaKey(userId)) || {};
      entries.push({
        _userId:   userId,
        label:     meta.label  || 'Anonyme',
        weeklyXP:  xp,
        level:     parseInt(meta.level)  || 1,
        streak:    parseInt(meta.streak) || 0,
        rank:      Math.floor(i / 2) + 1,
      });
    }
    return entries;
  } catch { return null; }
}

// Returns 1-based rank of userId in week, or null on failure.
async function getUserRank(weekStr, userId) {
  const r = redis.getClient();
  if (!r) return null;
  try {
    const rank = await r.zrevrank(_weekKey(weekStr), userId);
    return rank !== null ? rank + 1 : null;
  } catch { return null; }
}

module.exports = { incrXP, setXP, getTopN, getUserRank };
