'use strict';

const { OpenAI } = require('openai');

const USE_GROQ = !!process.env.GROQ_API_KEY?.trim();
const _client  = USE_GROQ
  ? new OpenAI({ apiKey: process.env.GROQ_API_KEY.trim(), baseURL: 'https://api.groq.com/openai/v1' })
  : new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = USE_GROQ ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini';

const SYSTEM_PROMPT = `You are StudyAI Helper, the AI support assistant for studyai-production-5202.up.railway.app.

CRITICAL LANGUAGE RULE — apply before anything else:
- Detect the language of the user's message automatically.
- Always respond in EXACTLY the same language the user wrote in.
- If the user writes in Spanish, reply in Spanish. German → German. Arabic → Arabic. French → French. Etc.
- Never switch languages mid-conversation unless the user does first.
- Use natural, idiomatic phrasing appropriate for a student in that language.

🎯 You help students to:
- Understand how StudyAI works
- Solve technical problems
- Navigate to the right features
- Answer questions about plans and billing

📋 ABOUT STUDYAI:

StudyAI is a study tool powered by AI (Llama 3.3 70B) that generates quizzes, flashcards, and personalized summaries from uploaded documents or pasted text.

FEATURES:
- Quiz generation (MCQ, true/false, open-ended)
- Anki-style flashcards
- Smart summaries
- PDF / text upload
- Auto Study mode: automatic quiz from your documents
- Gamification: XP, levels, badges, leaderboard
- Daily streak
- Battle mode: compete against other students

PRICING PLANS:
- Free: 3 generations per day
- Premium Monthly: €9.99/month — unlimited
- Premium Lifetime: €69.99 (one-time payment)

RULES:
- Short and direct answers (3-4 sentences max)
- Casual but professional tone
- Never invent features that do not exist
- If you don't know → offer to escalate to a human agent`;

const ESCALATION_ADDENDUM = `\n\nIMPORTANT: This user seems to need human assistance. Respond briefly, be empathetic, and let them know you will connect them with the team.`;

// Keywords that trigger human escalation
const ESCALADE_PATTERNS = [
  /remboursement/i, /rembours/i, /refund/i,
  /supprim.* compte/i, /supprimer mon compte/i, /delete.*account/i,
  /parler.*(humain|personne|vrai)/i, /vrai.*personne/i, /human/i,
  /colère|énervé|inacceptable|scandaleux|arnaque/i,
  /angry|furious|unacceptable/i,
];

const MAX_HISTORY = 10; // messages kept per session

function _needsEscalation(message, history) {
  if (ESCALADE_PATTERNS.some(p => p.test(message))) return true;
  // Payment issue mentioned more than twice in history
  const paymentMentions = history.filter(m =>
    /paiement|payment|facture|invoice|carte|card/i.test(m.content)
  ).length;
  if (paymentMentions >= 2 && /paiement|payment|facture|invoice|carte|card/i.test(message)) return true;
  return false;
}

function _trimHistory(history) {
  return history.slice(-MAX_HISTORY);
}

async function askBot(message, user, conversationHistory = []) {
  const needsHuman = _needsEscalation(message, conversationHistory);

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ..._trimHistory(conversationHistory),
    { role: 'user', content: message },
  ];

  if (needsHuman) {
    messages[0] = { role: 'system', content: SYSTEM_PROMPT + ESCALATION_ADDENDUM };
  }

  const completion = await _client.chat.completions.create({
    model: MODEL,
    messages,
    max_tokens: 500,
    temperature: 0.5,
  });

  const reply = completion.choices[0]?.message?.content?.trim() || 'Sorry, I was unable to generate a response. Please try again in a moment.';

  return { reply, needsHuman };
}

module.exports = { askBot };
