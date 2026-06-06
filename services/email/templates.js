'use strict';

const APP_URL  = process.env.SITE_URL?.trim() || process.env.APP_URL?.trim() || 'https://studyai.app';
const APP_NAME = 'StudyAI';

const BASE = (content) => `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${APP_NAME}</title>
<style>
  body{margin:0;padding:0;background:#07070e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e2e8f0;}
  .wrap{max-width:560px;margin:0 auto;padding:40px 20px;}
  .card{background:#0e0e19;border:1px solid rgba(255,255,255,0.07);border-radius:16px;overflow:hidden;}
  .header{background:linear-gradient(135deg,#7c3aed,#6366f1);padding:28px 32px;text-align:center;}
  .logo{font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.03em;}
  .body{padding:32px;}
  h1{font-size:22px;font-weight:700;color:#f1f5f9;margin:0 0 12px;letter-spacing:-0.02em;}
  p{font-size:15px;color:#94a3b8;line-height:1.7;margin:0 0 16px;}
  .btn{display:inline-block;background:linear-gradient(135deg,#7c3aed,#6366f1);color:#fff;font-size:15px;font-weight:700;padding:14px 28px;border-radius:10px;text-decoration:none;margin:8px 0 20px;letter-spacing:-0.01em;}
  .divider{height:1px;background:rgba(255,255,255,0.07);margin:24px 0;}
  .small{font-size:12px;color:#475569;line-height:1.6;}
  .footer{padding:20px 32px;text-align:center;}
  .footer p{font-size:12px;color:#334155;margin:4px 0;}
  .footer a{color:#7c3aed;text-decoration:none;}
  .badge{display:inline-block;background:rgba(124,58,237,0.15);border:1px solid rgba(124,58,237,0.25);border-radius:20px;padding:4px 12px;font-size:12px;font-weight:600;color:#a78bfa;margin-bottom:20px;}
  .stat-row{display:flex;gap:12px;margin:20px 0;}
  .stat{flex:1;background:#161622;border:1px solid rgba(255,255,255,0.05);border-radius:10px;padding:14px;text-align:center;}
  .stat-val{font-size:22px;font-weight:800;color:#a78bfa;letter-spacing:-0.03em;}
  .stat-lbl{font-size:11px;color:#475569;text-transform:uppercase;letter-spacing:0.06em;margin-top:4px;}
</style>
</head>
<body>
<div class="wrap">
<div class="card">
<div class="header"><div class="logo">⚡ ${APP_NAME}</div></div>
<div class="body">${content}</div>
</div>
<div class="footer">
<p>© ${new Date().getFullYear()} ${APP_NAME} — Tous droits réservés</p>
<p><a href="${APP_URL}/privacy">Politique de confidentialité</a> · <a href="${APP_URL}/terms">CGU</a></p>
<p style="margin-top:8px;font-size:11px;color:#1e293b;">Si vous n'êtes pas à l'origine de cette action, ignorez cet email.</p>
</div>
</div>
</body></html>`;

function welcome({ email }) {
  return {
    subject: `Bienvenue sur ${APP_NAME} ! 🎉`,
    html: BASE(`
      <div class="badge">✨ Nouveau compte créé</div>
      <h1>Bienvenue, ${email.split('@')[0]} !</h1>
      <p>Votre compte a été créé avec succès. Commencez à réviser intelligemment dès maintenant — IA, quiz, flashcards et bien plus.</p>
      <a href="${APP_URL}" class="btn">→ Commencer à réviser</a>
      <div class="divider"></div>
      <p class="small">Des questions ? Répondez à cet email ou contactez-nous à <a href="mailto:support@studyai.app" style="color:#7c3aed">support@studyai.app</a></p>
    `)
  };
}

function passwordReset({ email, token }) {
  const link = `${APP_URL}/reset-password?token=${token}`;
  return {
    subject: `Réinitialisation de votre mot de passe — ${APP_NAME}`,
    html: BASE(`
      <div class="badge">🔒 Sécurité du compte</div>
      <h1>Réinitialiser votre mot de passe</h1>
      <p>Vous avez demandé à réinitialiser le mot de passe associé à <strong style="color:#e2e8f0">${email}</strong>.</p>
      <p>Cliquez sur le bouton ci-dessous — ce lien expire dans <strong style="color:#e2e8f0">1 heure</strong>.</p>
      <a href="${link}" class="btn">→ Réinitialiser mon mot de passe</a>
      <div class="divider"></div>
      <p class="small">Si vous n'avez pas demandé cette réinitialisation, ignorez cet email. Votre mot de passe ne sera pas modifié.</p>
      <p class="small" style="word-break:break-all;margin-top:8px;">Lien : <a href="${link}" style="color:#7c3aed">${link}</a></p>
    `)
  };
}

function emailVerification({ email, token }) {
  const link = `${APP_URL}/api/auth/verify-email?token=${token}`;
  return {
    subject: `Vérifiez votre adresse email — ${APP_NAME}`,
    html: BASE(`
      <div class="badge">📧 Vérification d'email</div>
      <h1>Confirmez votre adresse</h1>
      <p>Bienvenue ! Cliquez ci-dessous pour confirmer l'adresse <strong style="color:#e2e8f0">${email}</strong> et activer votre compte.</p>
      <a href="${link}" class="btn">→ Vérifier mon email</a>
      <div class="divider"></div>
      <p class="small">Ce lien expire dans 24 heures. Si vous n'avez pas créé de compte, ignorez cet email.</p>
    `)
  };
}

function streakReminder({ email, streak, bestStreak }) {
  return {
    subject: `🔥 Ne cassez pas votre série de ${streak} jour${streak > 1 ? 's' : ''} !`,
    html: BASE(`
      <div class="badge">🔥 Rappel de série</div>
      <h1>Votre série est en danger !</h1>
      <p>Vous avez travaillé <strong style="color:#e2e8f0">${streak} jour${streak > 1 ? 's' : ''}</strong> d'affilée. Ne cassez pas votre élan !</p>
      <div class="stat-row">
        <div class="stat"><div class="stat-val">${streak}</div><div class="stat-lbl">Série actuelle</div></div>
        <div class="stat"><div class="stat-val">${bestStreak}</div><div class="stat-lbl">Meilleure série</div></div>
      </div>
      <p>Prenez 5 minutes ce soir pour faire une session et garder votre série vivante.</p>
      <a href="${APP_URL}" class="btn">→ Réviser maintenant</a>
    `)
  };
}

function referralInvite({ inviterEmail, referralCode }) {
  const link = `${APP_URL}?ref=${referralCode}`;
  return {
    subject: `${inviterEmail.split('@')[0]} t'a invité sur ${APP_NAME} ⚡`,
    html: BASE(`
      <div class="badge">🎁 Invitation personnelle</div>
      <h1>Tu as été invité !</h1>
      <p><strong style="color:#e2e8f0">${inviterEmail.split('@')[0]}</strong> t'invite à rejoindre ${APP_NAME}, la plateforme de révision intelligente alimentée par l'IA.</p>
      <p>En créant ton compte via ce lien, vous obtenez <strong style="color:#e2e8f0">tous les deux</strong> des avantages exclusifs !</p>
      <a href="${link}" class="btn">→ Rejoindre StudyAI</a>
      <div class="divider"></div>
      <p class="small">Quiz personnalisés, flashcards IA, gamification et bien plus. Gratuit pour commencer.</p>
    `)
  };
}

function comeback({ email, daysSince, bonusXp }) {
  return {
    subject: `Vous nous manquez, ${email.split('@')[0]} ! +${bonusXp} XP vous attendent ⚡`,
    html: BASE(`
      <div class="badge">💜 On pense à vous</div>
      <h1>Vous nous avez manqué !</h1>
      <p>Ça fait <strong style="color:#e2e8f0">${daysSince} jours</strong> que vous n'avez pas révisé. C'est le bon moment pour reprendre !</p>
      <div class="stat-row">
        <div class="stat"><div class="stat-val">+${bonusXp}</div><div class="stat-lbl">XP de retour</div></div>
        <div class="stat"><div class="stat-val">🎁</div><div class="stat-lbl">Cadeau retour</div></div>
      </div>
      <p>On vous a préparé <strong style="color:#e2e8f0">${bonusXp} XP de bonus</strong> pour votre retour. Il suffit de vous connecter !</p>
      <a href="${APP_URL}" class="btn">→ Récupérer mes XP</a>
    `)
  };
}

function betaInvite({ email, code }) {
  const link = `${APP_URL}?beta=${code}`;
  return {
    subject: `🎉 Vous êtes invité en bêta — ${APP_NAME}`,
    html: BASE(`
      <div class="badge">🚀 Accès bêta exclusif</div>
      <h1>Bienvenue dans la bêta !</h1>
      <p>Bonne nouvelle ! Vous avez été sélectionné pour accéder à la bêta privée de <strong style="color:#e2e8f0">${APP_NAME}</strong>.</p>
      <p>Votre code d'accès exclusif :</p>
      <div style="background:#161622;border:1px solid rgba(124,58,237,0.3);border-radius:10px;padding:16px;text-align:center;margin:16px 0;">
        <span style="font-size:24px;font-weight:800;color:#a78bfa;letter-spacing:0.1em;">${code}</span>
      </div>
      <a href="${link}" class="btn">→ Accéder à la bêta</a>
      <div class="divider"></div>
      <p class="small">Ce code est personnel et à usage unique. Merci de ne pas le partager.</p>
    `)
  };
}

function waitlistConfirm({ email, position }) {
  return {
    subject: `Vous êtes sur la liste d'attente ! (#${position}) — ${APP_NAME}`,
    html: BASE(`
      <div class="badge">📋 Liste d'attente</div>
      <h1>Vous êtes inscrit !</h1>
      <p>Super ! Vous avez rejoint la liste d'attente de <strong style="color:#e2e8f0">${APP_NAME}</strong>.</p>
      <div class="stat-row">
        <div class="stat"><div class="stat-val">#${position}</div><div class="stat-lbl">Votre position</div></div>
      </div>
      <p>Vous serez notifié à l'adresse <strong style="color:#e2e8f0">${email}</strong> dès que votre accès sera disponible.</p>
      <p>En attendant, partagez StudyAI à vos amis pour monter dans la liste !</p>
    `)
  };
}

module.exports = {
  welcome,
  passwordReset,
  emailVerification,
  streakReminder,
  referralInvite,
  comeback,
  betaInvite,
  waitlistConfirm,
};
