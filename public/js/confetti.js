'use strict';
/* StudyAI — Canvas confetti (zero dependencies) */
window.StudyConfetti = (function () {
  var COLORS = ['#7c3aed', '#a78bfa', '#c4b5fd', '#f59e0b', '#34d399', '#60a5fa', '#f472b6', '#fff'];

  function launch(opts) {
    opts = opts || {};
    var count   = opts.count   || 90;
    var originY = opts.originY != null ? opts.originY : 0.45;

    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9000';
    document.body.appendChild(canvas);

    var ctx = canvas.getContext('2d');
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    var W = canvas.width, H = canvas.height;

    var particles = [];
    for (var i = 0; i < count; i++) {
      particles.push({
        x: W / 2 + (Math.random() - 0.5) * W * 0.55,
        y: H * originY,
        vx: (Math.random() - 0.5) * 14,
        vy: -(Math.random() * 9 + 5),
        size: Math.random() * 9 + 4,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        rot: Math.random() * Math.PI * 2,
        rotV: (Math.random() - 0.5) * 0.22,
        shape: Math.random() < 0.55 ? 'rect' : 'circle',
        alpha: 1,
      });
    }

    var start = null;
    var duration = 3600;

    function frame(ts) {
      if (!start) start = ts;
      var elapsed = ts - start;
      if (elapsed > duration) { canvas.remove(); return; }

      ctx.clearRect(0, 0, W, H);
      var progress = elapsed / duration;

      for (var j = 0; j < particles.length; j++) {
        var p = particles[j];
        p.x  += p.vx;
        p.y  += p.vy;
        p.vy += 0.28;
        p.vx *= 0.992;
        p.rot += p.rotV;
        p.alpha = Math.max(0, 1 - Math.pow(progress * 1.3, 2));

        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle   = p.color;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);

        if (p.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, 2 * Math.PI);
          ctx.fill();
        } else {
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        }
        ctx.restore();
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  return { launch: launch };
}());
