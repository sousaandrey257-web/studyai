'use strict';
const AI = require('../client');

const PROMPT = (doc) => `Tu es un expert en sciences cognitives et pédagogie. Analyse ce document en profondeur.

DOCUMENT:
${doc}

Génère un JSON avec cette structure EXACTE (retourne UNIQUEMENT le JSON):
{
  "concepts": [
    {
      "name": "Nom du concept",
      "definition": "Définition précise et accessible",
      "importance": "high|medium|low",
      "difficulty": 70,
      "prerequisites": ["prérequis 1"],
      "related": ["concept lié 1"],
      "mastery_question": "Question pour tester la maîtrise du concept",
      "real_world_example": "Exemple concret du quotidien"
    }
  ],
  "traps": [
    {
      "trap": "Erreur/confusion fréquente",
      "why_common": "Pourquoi les étudiants font cette erreur",
      "correction": "Ce qui est correct",
      "memory_tip": "Astuce pour ne plus se tromper"
    }
  ],
  "exam_questions": [
    {
      "question": "Question probable à l'examen",
      "type": "rédaction|calcul|analyse|définition",
      "keywords": ["mot-clé attendu 1", "mot-clé attendu 2"],
      "difficulty": "easy|medium|hard"
    }
  ],
  "mastery": {
    "estimated_level": 60,
    "time_to_master_hours": 8,
    "weak_areas": ["zone difficile 1"],
    "strong_areas": ["zone accessible 1"],
    "recommendation": "Conseil personnalisé pour maîtriser ce sujet"
  },
  "roadmap": {
    "total_days": 7,
    "sessions": [
      {
        "day": 1,
        "title": "Titre de la session",
        "duration_min": 45,
        "focus": "Concept principal",
        "activities": ["Lecture section X", "Flashcards concepts de base", "Quiz 5 questions faciles"],
        "goal": "Objectif mesurable de la session"
      }
    ]
  }
}

Règles OBLIGATOIRES:
- 8 à 14 concepts, ordonnés par importance
- difficulty: 0-100 par concept
- 5 à 8 pièges avec corrections détaillées
- 6 questions probables d'examen couvrant les types variés
- mastery.estimated_level: 45-65 pour première exposition
- Roadmap 7 jours réaliste (max 45min/session)`;

async function generate(docSample) {
  return AI.call(PROMPT(docSample), { maxTokens: 4000 });
}

module.exports = { generate };
