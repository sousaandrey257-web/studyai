# StudyAI — Guide d'installation

Micro-SaaS de révision étudiante avec IA (résumé + fiche + quiz).

## Prérequis

- Node.js 18+ installé sur Ubuntu
- Une clé API OpenAI (obligatoire)
- Une clé Stripe (optionnel — pour activer le paiement)

---

## Installation étape par étape

### 1. Ouvrir un terminal dans le dossier du projet

```bash
cd ~/studyai
```

### 2. Installer les dépendances Node.js

```bash
npm install
```

### 3. Créer le fichier de configuration

```bash
cp .env.example .env
```

Puis ouvre le fichier `.env` avec un éditeur :

```bash
nano .env
```

Remplis tes clés :

```
OPENAI_API_KEY=sk-...   ← ta clé OpenAI (obligatoire)
STRIPE_SECRET_KEY=sk_test_...   ← ta clé Stripe (optionnel)
PORT=3000
```

**Où obtenir la clé OpenAI :** https://platform.openai.com/api-keys
**Où obtenir la clé Stripe :** https://dashboard.stripe.com/apikeys (clé "test" pour tester)

Sauvegarde avec `Ctrl+O`, quitte avec `Ctrl+X`.

### 4. Lancer le serveur

```bash
npm start
```

Tu verras :
```
╔════════════════════════════════════╗
║   StudyAI — Serveur démarré ✓      ║
║   http://localhost:3000             ║
╚════════════════════════════════════╝
```

### 5. Ouvrir dans le navigateur

Va sur : **http://localhost:3000**

---

## Utilisation

1. Colle un texte de cours dans la zone de texte (min. 50 caractères)
2. Clique sur **"Analyser avec l'IA ⚡"**
3. Consulte le résumé, la fiche de révision ou le quiz

**Plan gratuit :** 3 générations par jour par IP
**Plan premium :** illimité après paiement Stripe

---

## Lancement en mode développement (avec rechargement automatique)

```bash
npm run dev
```

---

## Structure du projet

```
studyai/
├── server.js          ← Backend Express (IA + Stripe + freemium)
├── package.json       ← Dépendances
├── .env               ← Clés API (NE PAS partager !)
├── .env.example       ← Modèle de configuration
└── public/
    ├── index.html     ← Interface principale
    ├── css/
    │   └── style.css  ← Design
    └── js/
        └── app.js     ← Logique frontend
```

---

## Mise en ligne (optionnel)

Pour déployer sur Internet rapidement, utilise **Railway** (gratuit) :

1. Crée un compte sur https://railway.app
2. Connecte ton dépôt GitHub
3. Ajoute les variables d'environnement dans Railway (OPENAI_API_KEY, STRIPE_SECRET_KEY)
4. Railway déploie automatiquement

---

## Problèmes courants

| Erreur | Solution |
|--------|----------|
| `OPENAI_API_KEY manquante` | Vérifie ton fichier `.env` |
| `Cannot find module 'express'` | Relance `npm install` |
| `Port 3000 already in use` | Change `PORT=3001` dans `.env` |
| L'IA répond en anglais | Normal — elle répond dans la langue du cours |
