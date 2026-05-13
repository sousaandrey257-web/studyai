'use strict';
/* ============================================================
   StudyAI — Share Card  (Sprint 2)
   Canvas-based image card generated after quiz completion.
   No external dependencies.
   ============================================================ */
(function () {

  /* ── Inject "Partager mon score" button when quiz-score becomes visible ── */
  var quizScoreEl = document.getElementById('quiz-score');
  if (!quizScoreEl) return;

  var _observer = new MutationObserver(function (mutations) {
    mutations.forEach(function (m) {
      if (m.type === 'attributes' && m.attributeName === 'class') {
        if (!quizScoreEl.classList.contains('hidden')) {
          _injectBtn();
        }
      }
    });
  });
  _observer.observe(quizScoreEl, { attributes: true });

  function _injectBtn() {
    if (document.getElementById('share-card-btn')) return;

    var btn = document.createElement('button');
    btn.id = 'share-card-btn';
    btn.className = 'btn-share-card';
    btn.innerHTML = '📸 Partager mon score';
    btn.addEventListener('click', _openShareCard);

    /* Insert after the score buttons row */
    var scoreButtons = quizScoreEl.querySelector('.score-buttons');
    if (scoreButtons) {
      scoreButtons.parentNode.insertBefore(btn, scoreButtons.nextSibling);
    }
  }

  /* ── Gather score data & open modal ── */
  function _openShareCard() {
    var scoreVal   = parseInt(document.getElementById('score-value')?.textContent || '0', 10);
    var scoreTotEl = document.getElementById('score-total');
    var scoreTot   = parseInt((scoreTotEl?.textContent || '/10').replace(/\D/g, ''), 10) || 10;
    var pct        = Math.round((scoreVal / scoreTot) * 100);

    /* Try to grab topic from result title or quiz question */
    var topicEl = document.getElementById('result-title') ||
                  document.querySelector('.result-title');
    var topic   = (topicEl?.textContent || '').trim();

    /* XP gained this session — read from DOM if available */
    var xpEl  = document.getElementById('xp-gained') || document.querySelector('.xp-gained');
    var xpGain = xpEl ? xpEl.textContent : '';

    _showModal(_drawCard(pct, topic, xpGain), pct);
  }

  /* ── Canvas card 1080×1080 ── */
  function _drawCard(pct, topic, xpGain) {
    var W = 1080, H = 1080;
    var canvas = document.createElement('canvas');
    canvas.width  = W;
    canvas.height = H;
    var ctx = canvas.getContext('2d');

    /* Background */
    ctx.fillStyle = '#07070e';
    ctx.fillRect(0, 0, W, H);

    /* Radial glow */
    var glow = ctx.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, 580);
    glow.addColorStop(0, 'rgba(124,58,237,0.28)');
    glow.addColorStop(1, 'rgba(124,58,237,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    /* Border card */
    _roundRect(ctx, 40, 40, W - 80, H - 80, 32);
    ctx.strokeStyle = 'rgba(124,58,237,0.55)';
    ctx.lineWidth = 3;
    ctx.stroke();

    /* Logo */
    ctx.textAlign = 'left';
    ctx.font = 'bold 52px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#a78bfa';
    ctx.fillText('⚡ StudyAI', 100, 145);

    /* Score big number */
    var scoreGrad = ctx.createLinearGradient(0, 280, 0, 580);
    scoreGrad.addColorStop(0, '#f1f0ff');
    scoreGrad.addColorStop(1, '#a78bfa');
    ctx.fillStyle = scoreGrad;
    ctx.textAlign = 'center';
    ctx.font = 'bold 260px system-ui, -apple-system, sans-serif';
    ctx.fillText(pct + '%', W / 2, 545);

    /* Emoji + label */
    var label = pct >= 90 ? '🏆 Parfait !'
              : pct >= 75 ? '⭐ Excellent !'
              : pct >= 60 ? '👍 Bien joué !'
              : '📚 En progression !';
    ctx.font = 'bold 52px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(238,238,248,0.88)';
    ctx.fillText(label, W / 2, 628);

    /* Topic */
    if (topic) {
      var short = topic.length > 44 ? topic.slice(0, 44) + '…' : topic;
      ctx.font = '36px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = 'rgba(167,139,250,0.85)';
      ctx.fillText(short, W / 2, 698);
    }

    /* Divider */
    ctx.beginPath();
    ctx.moveTo(140, 762);
    ctx.lineTo(W - 140, 762);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 2;
    ctx.stroke();

    /* CTA text */
    ctx.font = 'bold 34px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(238,238,248,0.5)';
    ctx.fillText('Révise avec l\'IA — StudyAI', W / 2, 842);

    ctx.font = '26px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(238,238,248,0.28)';
    ctx.fillText('Gratuit · Quiz · Flashcards · Battle Mode', W / 2, 896);

    return canvas;
  }

  /* ── Rounded rect helper ── */
  function _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /* ── Share modal ── */
  function _showModal(canvas, pct) {
    var existing = document.getElementById('share-card-overlay');
    if (existing) existing.remove();

    /* Overlay */
    var overlay = document.createElement('div');
    overlay.id = 'share-card-overlay';
    overlay.className = 'share-card-overlay';
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.remove();
    });

    /* Modal box */
    var modal = document.createElement('div');
    modal.className = 'share-card-modal';

    /* Close */
    var closeBtn = document.createElement('button');
    closeBtn.className = 'share-card-close';
    closeBtn.innerHTML = '✕';
    closeBtn.addEventListener('click', function () { overlay.remove(); });

    /* Preview (scaled) */
    var preview = document.createElement('canvas');
    preview.className = 'share-card-preview-canvas';
    var size = Math.min(window.innerWidth - 80, 420);
    preview.width  = size;
    preview.height = size;
    preview.getContext('2d').drawImage(canvas, 0, 0, size, size);

    /* Title */
    var title = document.createElement('p');
    title.className = 'share-card-title';
    title.textContent = '🎉 Partage ton score !';

    /* Buttons */
    var btns = document.createElement('div');
    btns.className = 'share-card-btns';

    /* Download */
    var dlBtn = document.createElement('button');
    dlBtn.className = 'share-action-btn';
    dlBtn.innerHTML = '⬇️ Télécharger';
    dlBtn.addEventListener('click', function () {
      canvas.toBlob(function (blob) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'studyai-' + pct + 'pct.png';
        a.click();
        URL.revokeObjectURL(a.href);
      }, 'image/png');
    });

    /* Copy image */
    var copyBtn = document.createElement('button');
    copyBtn.className = 'share-action-btn';
    copyBtn.innerHTML = '📋 Copier l\'image';
    copyBtn.addEventListener('click', function () {
      canvas.toBlob(function (blob) {
        if (navigator.clipboard && window.ClipboardItem) {
          navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
            .then(function () {
              copyBtn.innerHTML = '✅ Copié !';
              setTimeout(function () { copyBtn.innerHTML = '📋 Copier l\'image'; }, 2500);
            })
            .catch(function () { _fallbackDl(canvas, pct); });
        } else {
          _fallbackDl(canvas, pct);
        }
      }, 'image/png');
    });

    /* Twitter */
    var twitterA = document.createElement('a');
    twitterA.className = 'share-action-btn share-action-twitter';
    twitterA.innerHTML = '𝕏 Twitter';
    twitterA.target = '_blank';
    twitterA.rel = 'noopener noreferrer';
    var tweetText = '🏆 J\'ai eu ' + pct + '% au quiz sur StudyAI !\nRévise avec l\'IA — quiz, flashcards, battle mode. Gratuit 👇\n' + window.location.origin;
    twitterA.href = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(tweetText);

    /* WhatsApp */
    var waA = document.createElement('a');
    waA.className = 'share-action-btn share-action-wa';
    waA.innerHTML = '💬 WhatsApp';
    waA.target = '_blank';
    waA.rel = 'noopener noreferrer';
    var waText = '🏆 J\'ai eu ' + pct + '% au quiz sur StudyAI ! Révise avec l\'IA — gratuit → ' + window.location.origin;
    waA.href = 'https://wa.me/?text=' + encodeURIComponent(waText);

    btns.appendChild(dlBtn);
    btns.appendChild(copyBtn);
    btns.appendChild(twitterA);
    btns.appendChild(waA);

    modal.appendChild(closeBtn);
    modal.appendChild(title);
    modal.appendChild(preview);
    modal.appendChild(btns);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  function _fallbackDl(canvas, pct) {
    var a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'studyai-' + pct + 'pct.png';
    a.click();
  }

}());
