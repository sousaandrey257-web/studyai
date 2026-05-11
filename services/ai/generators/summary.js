'use strict';
const AI = require('../client');

const PROMPT = (doc) => `Tu es un expert pédagogique de haut niveau. Analyse ce document et génère une fiche de synthèse complète.

DOCUMENT:
${doc}

Génère un JSON avec cette structure EXACTE (retourne UNIQUEMENT le JSON):
{
  "title": "titre du cours/sujet",
  "subject": "matière académique",
  "level": "Collège|Lycée|Supérieur|Professionnel",
  "language": "fr|en|es|de|...",
  "executive_summary": "Résumé en 4-6 phrases captant l'essentiel du document",
  "sections": [
    {
      "title": "Titre de section",
      "icon": "emoji représentatif",
      "content": "Explication claire en 3-5 phrases",
      "key_points": ["point essentiel 1", "point essentiel 2", "point essentiel 3"]
    }
  ],
  "key_formulas": [
    {"label": "Nom de la formule", "formula": "expression ou énoncé", "usage": "quand l'utiliser"}
  ],
  "vocabulary": [
    {"term": "terme clé", "definition": "définition précise et courte", "example": "exemple concret"}
  ],
  "mind_map_root": "concept central",
  "mind_map_branches": ["branche 1", "branche 2", "branche 3"],
  "study_time_minutes": 45,
  "difficulty_score": 65
}

Règles:
- 4 à 7 sections couvrant tous les thèmes majeurs
- 3 à 8 formules/dates/chiffres clés (uniquement les plus importants)
- 6 à 12 entrées vocabulaire
- difficulty_score: 0-100 (0=très facile, 100=très difficile)
- study_time_minutes: estimation réaliste pour un étudiant moyen`;

async function generate(docSample) {
  return AI.call(PROMPT(docSample), { maxTokens: 3000 });
}

module.exports = { generate };
