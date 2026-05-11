'use strict';
const AI = require('../client');

const PROMPT = (doc, mode = 'standard') => `Tu es un professeur expert créant un quiz pédagogique de haute qualité.
Mode: ${mode === 'exam' ? 'EXAMEN OFFICIEL — questions précises, pièges réalistes' : mode === 'simple' ? 'DÉBUTANT — questions claires, distracteurs évidents' : 'STANDARD — équilibre pédagogie et challenge'}

DOCUMENT:
${doc}

Génère un JSON avec cette structure EXACTE (retourne UNIQUEMENT le JSON):
{
  "questions": [
    {
      "id": 1,
      "type": "mcq",
      "difficulty": "easy|medium|hard",
      "concept": "concept testé",
      "question": "Énoncé de la question ?",
      "options": ["A. Option 1", "B. Option 2", "C. Option 3", "D. Option 4"],
      "correct": "A",
      "explanation": "Explication détaillée de la bonne réponse",
      "trap": "Erreur typique à éviter"
    },
    {
      "id": 2,
      "type": "truefalse",
      "difficulty": "easy",
      "concept": "concept testé",
      "question": "Affirmation à évaluer.",
      "correct": true,
      "explanation": "Pourquoi c'est vrai/faux",
      "trap": null
    },
    {
      "id": 3,
      "type": "open",
      "difficulty": "hard",
      "concept": "concept testé",
      "question": "Question ouverte ?",
      "answer_guide": "Éléments clés attendus dans la réponse",
      "keywords": ["mot-clé 1", "mot-clé 2"],
      "trap": null
    }
  ]
}

Règles OBLIGATOIRES:
- Exactement 12 questions: 7 QCM + 3 vrai/faux + 2 ouvertes
- Répartition difficulté: 3 faciles + 6 moyennes + 3 difficiles
- QCM: 4 options toutes plausibles (pas de distracteurs évidents)
- Couvrir TOUS les thèmes majeurs du document
- Chaque question teste un concept DIFFÉRENT
- Questions progressives (faciles → difficiles)`;

async function generate(docSample, mode = 'standard') {
  return AI.call(PROMPT(docSample, mode), { maxTokens: 3500 });
}

module.exports = { generate };
