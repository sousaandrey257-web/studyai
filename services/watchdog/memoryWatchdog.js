'use strict';

const WARN_MB  = parseInt(process.env.MEMORY_WARN_MB  || '400', 10);
const CRIT_MB  = parseInt(process.env.MEMORY_CRIT_MB  || '700', 10);
const INTERVAL = parseInt(process.env.MEMORY_CHECK_MS || '60000', 10);

let timer = null;
let lastWarnAt = 0;
const WARN_COOLDOWN = 5 * 60 * 1000;

function getMB() {
  return Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
}

function getRssMB() {
  return Math.round(process.memoryUsage().rss / 1024 / 1024);
}

function check() {
  const heap = getMB();
  const rss  = getRssMB();
  const now  = Date.now();

  if (heap >= CRIT_MB) {
    console.error(`[watchdog] CRITICAL memory: heap=${heap}MB rss=${rss}MB — threshold=${CRIT_MB}MB`);
    // Force GC if available (--expose-gc flag)
    if (global.gc) { global.gc(); console.log('[watchdog] GC triggered'); }
  } else if (heap >= WARN_MB && now - lastWarnAt > WARN_COOLDOWN) {
    console.warn(`[watchdog] HIGH memory: heap=${heap}MB rss=${rss}MB — threshold=${WARN_MB}MB`);
    lastWarnAt = now;
  }

  return { heap, rss, warnMb: WARN_MB, critMb: CRIT_MB };
}

function start() {
  if (timer) return;
  timer = setInterval(check, INTERVAL);
  if (timer.unref) timer.unref(); // don't keep process alive
  console.log(`[watchdog] Memory watchdog started (warn=${WARN_MB}MB crit=${CRIT_MB}MB interval=${INTERVAL}ms)`);
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

function getStats() {
  return { ...check(), interval: INTERVAL };
}

module.exports = { start, stop, getStats, getMB, getRssMB };
