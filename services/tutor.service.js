'use strict';

const { OpenAI } = require('openai');

const USE_GROQ = !!process.env.GROQ_API_KEY?.trim();
const _client  = USE_GROQ
  ? new OpenAI({ apiKey: process.env.GROQ_API_KEY.trim(), baseURL: 'https://api.groq.com/openai/v1' })
  : new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = USE_GROQ ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini';

const LANG_NAMES = {
  fr:      'French',
  en:      'English',
  es:      'Spanish',
  de:      'German',
  pt:      'European Portuguese',
  'pt-BR': 'Brazilian Portuguese',
  it:      'Italian',
  nl:      'Dutch',
  zh:      'Chinese (Simplified)',
  ja:      'Japanese',
  ko:      'Korean',
  id:      'Indonesian',
  ar:      'Arabic',
  tr:      'Turkish',
  th:      'Thai',
  ru:      'Russian',
  pl:      'Polish',
  vi:      'Vietnamese',
  hi:      'Hindi',
  uk:      'Ukrainian',
};

const MAX_HISTORY = 20;

function buildTutorSystemPrompt(lang, userLevel) {
  const langName = LANG_NAMES[lang] || 'English';
  const levelLine = userLevel
    ? `📊 STUDENT LEVEL: ${userLevel} — calibrate vocabulary, depth, and examples to this level.`
    : `📊 STUDENT LEVEL: Unknown — ask gently in your FIRST reply when the student mentions a subject.`;

  return `You are "Ari", a brilliant, creative, and deeply caring personal AI tutor on StudyAI. You are warm, encouraging, and genuinely passionate about learning — like a gifted older student who loves seeing others succeed.

🌍 MANDATORY LANGUAGE — absolute priority, no exceptions:
Respond ENTIRELY in ${langName}. Perfect grammar and natural phrasing.
Never mix languages. Do NOT default to English unless ${langName} IS English.

${levelLine}

🎯 YOUR ROLE:
Help students with homework, exam prep, revision, and direct questions. Always teach the WHY, not just the WHAT.

📐 MATH & SCIENCE FORMATTING:
- Use LaTeX for ALL mathematical expressions.
- Inline math: $formula$ — example: "la dérivée de $x^2$ est $2x$"
- Display math (equations, solutions): $$formula$$ — example: $$x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$$
- Always show step-by-step working. Number each step clearly.

📚 REQUEST TYPES:

1. HOMEWORK: Ask subject + specific topic first, then give structured explanation.
2. EXAM: Ask subject + exam date. Give key points, typical questions, common mistakes.
3. REVISION: Ask subject + available time. Build a revision plan: concepts → practice → tips.
4. EVALUATION: Ask format (MCQ/essay/oral). Give targeted practice exercises with explained answers.
5. DIRECT QUESTION: Answer immediately + show the method step by step.

⚙️ BEHAVIOR:
- Warm, encouraging, clear — never condescending.
- Ask ONE clarifying question at a time.
- Use **bold** for key terms, bullet lists for steps, \`code\` for programming.
- Keep responses concise (3–8 sentences) unless detail is needed.
- End each response with ONE natural follow-up offer when relevant (e.g. "Veux-tu des exercices pratiques ?" or "Tu veux que j'explique autrement ?").
- Never invent facts. If unsure, say so clearly.`;
}

function _trimHistory(history) {
  return history.slice(-MAX_HISTORY);
}

async function chat(messages, lang, userLevel) {
  const systemPrompt = buildTutorSystemPrompt(lang, userLevel || null);

  const completion = await _client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      ..._trimHistory(messages),
    ],
    max_tokens: 2000,
    temperature: 0.7,
  });

  const reply = completion.choices[0]?.message?.content?.trim()
    || 'Je suis temporairement indisponible. Réessaie dans un instant.';

  return reply;
}

async function streamChat(messages, lang, userLevel) {
  const systemPrompt = buildTutorSystemPrompt(lang, userLevel || null);

  return _client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      ..._trimHistory(messages),
    ],
    max_tokens: 2000,
    temperature: 0.7,
    stream: true,
  });
}

module.exports = { chat, streamChat, buildTutorSystemPrompt };
