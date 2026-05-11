'use strict';
const { OpenAI } = require('openai');

if (process.env.OPENAI_API_KEY) {
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY.trim().replace(/^﻿/, '').replace(/^["'`]|["'`]$/g, '');
}

const USE_GROQ = !!process.env.GROQ_API_KEY?.trim();
const MODEL    = USE_GROQ
  ? (process.env.OPENAI_MODEL || 'llama-3.3-70b-versatile').trim()
  : (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();

const client = USE_GROQ
  ? new OpenAI({ apiKey: process.env.GROQ_API_KEY.trim(), baseURL: 'https://api.groq.com/openai/v1' })
  : new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TIMEOUT_MS   = parseInt(process.env.AI_TIMEOUT_MS    || '90000', 10);
const DAILY_TOKENS = parseInt(process.env.AI_DAILY_TOKENS  || '2000000', 10);

let tokensToday = 0;
let tokenDay    = new Date().toDateString();

async function call(prompt, { maxTokens = 2500, temperature = 0.3, retries = 1 } = {}) {
  // Reset daily counter on new day
  const today = new Date().toDateString();
  if (today !== tokenDay) { tokensToday = 0; tokenDay = today; }
  if (tokensToday >= DAILY_TOKENS) throw new Error('Limite quotidienne IA atteinte — réessayez demain.');

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 1500 * attempt));
    try {
      const resp = await Promise.race([
        client.chat.completions.create({
          model: MODEL,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: maxTokens,
          temperature,
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('AI_TIMEOUT')), TIMEOUT_MS)),
      ]);

      const usage = resp.usage || {};
      tokensToday += (usage.total_tokens || 0);

      const raw = resp.choices?.[0]?.message?.content || '';
      return parseJSON(raw);
    } catch (err) {
      lastErr = err;
      // Retry on rate-limit (429) or timeout
      if (err.status !== 429 && err.message !== 'AI_TIMEOUT' && attempt >= retries) break;
    }
  }
  throw lastErr || new Error('AI unavailable');
}

function parseJSON(raw) {
  // Direct parse
  try { return JSON.parse(raw); } catch {}
  // Extract JSON object/array from prose
  const m = raw.match(/```json\s*([\s\S]*?)```/) || raw.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (m) { try { return JSON.parse(m[1] || m[0]); } catch {} }
  // Return as text fallback
  return { _raw: raw };
}

function getStats() {
  return { tokensToday, dailyLimit: DAILY_TOKENS, provider: USE_GROQ ? 'groq' : 'openai', model: MODEL };
}

module.exports = { call, getStats, MODEL, USE_GROQ };
