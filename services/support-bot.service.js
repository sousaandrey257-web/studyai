'use strict';

const { OpenAI } = require('openai');

const USE_GROQ = !!process.env.GROQ_API_KEY?.trim();
const _client  = USE_GROQ
  ? new OpenAI({ apiKey: process.env.GROQ_API_KEY.trim(), baseURL: 'https://api.groq.com/openai/v1' })
  : new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = USE_GROQ ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini';

const SYSTEM_PROMPT = `Tu es StudyAI Helper, l'assistant IA de studyai-production-5202.up.railway.app.

🎯 Tu aides les étudiants belges et francophones à :
- Comprendre comment fonctionne StudyAI
- Résoudre leurs problèmes techniques
- Naviguer vers les bonnes fonctionnalités
- Répondre aux questions sur les abonnements

📋 INFORMATIONS SUR STUDYAI :

StudyAI est une application d'aide aux révisions qui utilise l'IA (Llama 3.3 70B) pour créer des quizzes, flashcards et résumés personnalisés à partir de documents uploadés.

FONCTIONNALITÉS :
- Génération de quiz (QCM, vrai/faux, réponse libre)
- Flashcards style Anki
- Résumés intelligents
- Upload de PDF/texte
- Mode "Auto Study" : quiz automatique basé sur tes documents
- Gamification : XP, niveaux, badges, classement
- Streak quotidien
- Battle mode : affronter d'autres étudiants

PLANS TARIFAIRES :
- Gratuit : 5 générations/jour
- Premium Mensuel : 9,99€/mois — illimité
- Premium À Vie : 69,99€ (paiement unique)

RÈGLES :
- Réponses courtes et directes (max 3-4 lignes)
- Ton décontracté mais professionnel
- En français (sauf si l'utilisateur parle anglais)
- N'invente pas de fonctionnalités inexistantes
- Si tu ne sais pas → propose d'escalader vers un humain`;

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
    messages[0] = {
      role: 'system',
      content: SYSTEM_PROMPT + '\n\nATTENTION : L\'utilisateur semble avoir besoin d\'aide humaine. Réponds brièvement, sois empathique, et indique que tu vas le mettre en contact avec l\'équipe.',
    };
  }

  const completion = await _client.chat.completions.create({
    model: MODEL,
    messages,
    max_tokens: 500,
    temperature: 0.5,
  });

  const reply = completion.choices[0]?.message?.content?.trim() || 'Désolé, je n\'ai pas pu générer une réponse. Réessaie dans un instant.';

  return { reply, needsHuman };
}

module.exports = { askBot };
