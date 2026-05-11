'use strict';
const AI = require('../client');

const PROMPT = (doc) => `Tu es un spécialiste en mémorisation et répétition espacée. Crée des flashcards optimales.

DOCUMENT:
${doc}

Génère un JSON avec cette structure EXACTE (retourne UNIQUEMENT le JSON):
{
  "flashcards": [
    {
      "id": 1,
      "front": "Question précise ou terme",
      "back": "Réponse complète ou définition",
      "hint": "Indice mnémotechnique optionnel",
      "tags": ["tag1", "tag2"],
      "difficulty": "easy|medium|hard",
      "category": "définition|formule|concept|date|personnage|mécanisme",
      "spaced_interval_days": 1
    }
  ],
  "memo": {
    "title": "Mémo Express — [sujet]",
    "tagline": "L'essentiel en 2 minutes",
    "sections": [
      {
        "title": "🎯 L'essentiel",
        "items": ["point crucial 1", "point crucial 2", "point crucial 3"]
      },
      {
        "title": "⚡ Formules clés",
        "items": ["formule 1", "formule 2"]
      },
      {
        "title": "⚠️ Pièges à éviter",
        "items": ["piège 1", "piège 2"]
      },
      {
        "title": "💡 Astuces mémo",
        "items": ["astuce 1", "astuce 2"]
      }
    ],
    "exam_checklist": ["À vérifier 1", "À vérifier 2", "À vérifier 3"]
  }
}

Règles OBLIGATOIRES:
- 16 à 22 flashcards couvrant tous les concepts clés
- spaced_interval_days: 1 (easy→4), 2 (medium→2), 3 (hard→1) — algorithme SM-2 simplifié
- Mémo: maximum 5 items par section, langage ultra-concis
- Hints mnémotechniques originaux quand possible (acronymes, analogies, images mentales)
- Catégoriser chaque flashcard correctement`;

async function generate(docSample) {
  return AI.call(PROMPT(docSample), { maxTokens: 3500 });
}

module.exports = { generate };
