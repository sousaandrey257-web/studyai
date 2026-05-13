'use strict';
/* ============================================================
   StudyAI — Canvas Mind Map  (Sprint 3)
   Radial force-directed mind map using Canvas 2D API.
   Called by upload.js after study pack is rendered.
   Exposed as window.StudyMindMap(canvasId, { root, branches })
   ============================================================ */
window.StudyMindMap = (function () {

  function MindMap(canvasId, data) {
    var canvas = typeof canvasId === 'string'
      ? document.getElementById(canvasId)
      : canvasId;
    if (!canvas) return;
    if (!data || !data.root) return;

    var ctx = canvas.getContext('2d');
    var branches = data.branches || [];

    /* ── Layout constants ── */
    function _layout() {
      var W = canvas.clientWidth || canvas.width;
      var H = canvas.clientHeight || canvas.height;
      canvas.width  = W;
      canvas.height = H;
      return { W: W, H: H, cx: W / 2, cy: H / 2 };
    }

    var dim  = _layout();
    var ROOT_R   = Math.max(52, Math.min(72, dim.W * 0.075));
    var BRANCH_R = Math.max(38, Math.min(56, dim.W * 0.057));
    var ORBIT    = Math.max(130, Math.min(220, Math.min(dim.W, dim.H) * 0.32));

    /* ── Build node list ── */
    var nodes = [];
    nodes.push({ x: dim.cx, y: dim.cy, r: ROOT_R, label: data.root, type: 'root' });

    var n = branches.length;
    branches.forEach(function (br, i) {
      var angle = (2 * Math.PI * i / n) - Math.PI / 2;
      nodes.push({
        x: dim.cx + ORBIT * Math.cos(angle),
        y: dim.cy + ORBIT * Math.sin(angle),
        r: BRANCH_R,
        label: br,
        type: 'branch',
        angle: angle,
      });
    });

    var hovered = null;

    /* ── Draw ── */
    function _draw() {
      var W = dim.W, H = dim.H, cx = dim.cx, cy = dim.cy;
      ctx.clearRect(0, 0, W, H);

      /* Connections */
      nodes.slice(1).forEach(function (nd) {
        var cpx = (cx + nd.x) / 2 + 25 * Math.cos(nd.angle + Math.PI / 2);
        var cpy = (cy + nd.y) / 2 + 25 * Math.sin(nd.angle + Math.PI / 2);
        var grad = ctx.createLinearGradient(cx, cy, nd.x, nd.y);
        grad.addColorStop(0, 'rgba(124,58,237,0.5)');
        grad.addColorStop(1, 'rgba(124,58,237,0.15)');
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.quadraticCurveTo(cpx, cpy, nd.x, nd.y);
        ctx.strokeStyle = grad;
        ctx.lineWidth   = nd === hovered ? 2.5 : 1.5;
        ctx.stroke();
      });

      /* Nodes */
      nodes.forEach(function (nd) {
        var isHov  = nd === hovered;
        var r      = nd.r * (isHov ? 1.12 : 1);

        /* Glow */
        ctx.shadowBlur  = isHov ? 28 : 12;
        ctx.shadowColor = isHov ? 'rgba(124,58,237,0.8)' : 'rgba(124,58,237,0.3)';

        /* Fill gradient */
        var fg = ctx.createRadialGradient(nd.x - r * 0.3, nd.y - r * 0.35, 0, nd.x, nd.y, r);
        if (nd.type === 'root') {
          fg.addColorStop(0, '#b27eff');
          fg.addColorStop(1, '#5b21b6');
        } else {
          fg.addColorStop(0, '#7c3aed');
          fg.addColorStop(1, '#3c1088');
        }
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.arc(nd.x, nd.y, r, 0, 2 * Math.PI);
        ctx.fill();
        ctx.shadowBlur = 0;

        /* Border */
        ctx.strokeStyle = isHov ? 'rgba(167,139,250,0.9)' : 'rgba(167,139,250,0.3)';
        ctx.lineWidth   = 1.5;
        ctx.stroke();

        /* Label */
        ctx.fillStyle    = '#eeeef8';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        var fs = nd.type === 'root' ? 13 : 11;
        ctx.font = 'bold ' + fs + 'px system-ui,-apple-system,sans-serif';

        var words = (nd.label || '').trim().split(' ');
        var maxChars = Math.floor(r * 2.6 / (fs * 0.58));
        var line1 = '', line2 = '';
        words.forEach(function (w) {
          if (line1.length + w.length + 1 <= maxChars || !line1) line1 += (line1 ? ' ' : '') + w;
          else line2 += (line2 ? ' ' : '') + w;
        });
        if (line2.length > maxChars) line2 = line2.slice(0, maxChars - 1) + '…';

        if (line2) {
          ctx.fillText(line1, nd.x, nd.y - fs * 0.65);
          ctx.fillText(line2, nd.x, nd.y + fs * 0.65);
        } else {
          ctx.fillText(line1, nd.x, nd.y);
        }
      });
    }

    /* ── Hit test ── */
    function _hit(mx, my) {
      for (var i = 0; i < nodes.length; i++) {
        var nd = nodes[i];
        var dx = mx - nd.x, dy = my - nd.y;
        if (dx * dx + dy * dy < (nd.r * 1.2) * (nd.r * 1.2)) return nd;
      }
      return null;
    }

    /* ── Events ── */
    function _pointer(e) {
      var rect = canvas.getBoundingClientRect();
      var scaleX = canvas.width / rect.width;
      var scaleY = canvas.height / rect.height;
      var cx = e.clientX || (e.touches && e.touches[0].clientX);
      var cy = e.clientY || (e.touches && e.touches[0].clientY);
      return { x: (cx - rect.left) * scaleX, y: (cy - rect.top) * scaleY };
    }

    canvas.addEventListener('mousemove', function (e) {
      var p = _pointer(e);
      var hit = _hit(p.x, p.y);
      if (hit !== hovered) {
        hovered = hit;
        canvas.style.cursor = hit ? 'pointer' : 'default';
        _draw();
      }
    });
    canvas.addEventListener('mouseleave', function () {
      hovered = null;
      canvas.style.cursor = 'default';
      _draw();
    });

    /* ── Resize ── */
    var _resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(_resizeTimer);
      _resizeTimer = setTimeout(function () {
        dim = _layout();
        ROOT_R   = Math.max(52, Math.min(72, dim.W * 0.075));
        BRANCH_R = Math.max(38, Math.min(56, dim.W * 0.057));
        ORBIT    = Math.max(130, Math.min(220, Math.min(dim.W, dim.H) * 0.32));
        nodes[0].x = dim.cx; nodes[0].y = dim.cy; nodes[0].r = ROOT_R;
        nodes.slice(1).forEach(function (nd, i) {
          nd.x = dim.cx + ORBIT * Math.cos(nd.angle);
          nd.y = dim.cy + ORBIT * Math.sin(nd.angle);
          nd.r = BRANCH_R;
        });
        _draw();
      }, 150);
    });

    _draw();
  }

  return MindMap;
}());
