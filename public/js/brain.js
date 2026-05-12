'use strict';
/* ===== Second Brain — Knowledge Graph Frontend ===== */

const API = '/api/ai';
let graphData = { nodes: [], edges: [] };
let filteredNodes = [];
let filteredEdges = [];
let selectedSubject = 'all';
let searchQuery = '';
let viewMode = 'graph'; // 'graph' | 'list'
let selectedNode = null;

// Canvas state
let canvas, ctx;
let offsetX = 0, offsetY = 0;
let scale = 1;
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let nodePositions = new Map();
let hoveredNode = null;
let tooltip = null;
let animFrame = null;
let layoutFrame = null;

// ── Colour palette for subjects ──────────────────────────────
const SUBJECT_COLORS = [
  '#7c3aed', '#06b6d4', '#10b981', '#f59e0b',
  '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6',
];
const subjectColorMap = new Map();
function getSubjectColor(subject) {
  if (!subjectColorMap.has(subject)) {
    subjectColorMap.set(subject, SUBJECT_COLORS[subjectColorMap.size % SUBJECT_COLORS.length]);
  }
  return subjectColorMap.get(subject);
}

// ── Auth ─────────────────────────────────────────────────────
function getToken() {
  const ss = window.safeStore;
  if (ss) return ss.get('studyai_auth_token', null) || ss.get('token', null) || '';
  try { return localStorage.getItem('studyai_auth_token') || localStorage.getItem('token') || ''; } catch { return ''; }
}
function authHeaders() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// ── Fetch graph data ─────────────────────────────────────────
async function loadGraph() {
  document.getElementById('brain-loading').style.display = 'flex';
  document.getElementById('brain-empty').classList.add('hidden');

  try {
    const res = await fetch(`${API}/brain?limit=200`, { headers: authHeaders() });
    if (!res.ok) {
      if (res.status === 401) return showAuthPrompt();
      throw new Error(res.statusText);
    }
    const data = await res.json();
    graphData = data;
    processGraph();
  } catch (err) {
    console.error('Brain load error:', err);
    document.getElementById('brain-loading').style.display = 'none';
    document.getElementById('brain-empty').classList.remove('hidden');
  }
}

function showAuthPrompt() {
  document.getElementById('brain-loading').style.display = 'none';
  document.getElementById('brain-empty').classList.remove('hidden');
  document.querySelector('.brain-empty h3').textContent = 'Connexion requise';
  document.querySelector('.brain-empty p').textContent = 'Connecte-toi pour accéder à ton Second Brain.';
}

function processGraph() {
  const nodes = graphData.nodes || [];
  const edges = graphData.edges || [];

  // Update stats
  const subjects = [...new Set(nodes.map(n => n.subject).filter(Boolean))];
  const sessions = [...new Set(nodes.flatMap(n => n.sessions || []))];

  document.getElementById('stat-nodes').textContent = nodes.length;
  document.getElementById('stat-edges').textContent = edges.length;
  document.getElementById('stat-subjects').textContent = subjects.length;
  document.getElementById('stat-sessions').textContent = sessions.length;

  // Build filter pills
  buildFilterPills(subjects);

  // Assign colours
  nodes.forEach(n => { n._color = getSubjectColor(n.subject || 'Autre'); });

  applyFilters();
}

function buildFilterPills(subjects) {
  const container = document.getElementById('brain-filters');
  container.innerHTML = '<button class="brain-pill active" data-filter="all">Tout</button>';
  subjects.forEach(s => {
    const btn = document.createElement('button');
    btn.className = 'brain-pill';
    btn.dataset.filter = s;
    btn.textContent = s;
    btn.style.setProperty('--pill-color', getSubjectColor(s));
    container.appendChild(btn);
  });
  container.querySelectorAll('.brain-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.brain-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedSubject = btn.dataset.filter;
      applyFilters();
    });
  });
}

function applyFilters() {
  const nodes = graphData.nodes || [];
  const edges = graphData.edges || [];
  const q = searchQuery.toLowerCase();

  filteredNodes = nodes.filter(n => {
    const matchSubject = selectedSubject === 'all' || n.subject === selectedSubject;
    const matchSearch = !q || n.name?.toLowerCase().includes(q) || n.definition?.toLowerCase().includes(q);
    return matchSubject && matchSearch;
  });

  const nodeIds = new Set(filteredNodes.map(n => n.id));
  filteredEdges = edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));

  if (filteredNodes.length === 0) {
    document.getElementById('brain-loading').style.display = 'none';
    document.getElementById('brain-empty').classList.remove('hidden');
    return;
  }
  document.getElementById('brain-empty').classList.add('hidden');

  if (viewMode === 'graph') {
    layoutGraph(renderGraph);
  } else {
    renderList();
  }

  renderInsights();
}

// ── Force-directed layout (RAF-chunked — does not block main thread) ─
function layoutGraph(onDone) {
  if (layoutFrame) cancelAnimationFrame(layoutFrame);

  const W = canvas.width / window.devicePixelRatio;
  const H = canvas.height / window.devicePixelRatio;
  const cx = W / 2, cy = H / 2;

  filteredNodes.forEach((node, i) => {
    if (!nodePositions.has(node.id)) {
      const angle = (i / filteredNodes.length) * Math.PI * 2;
      const r = Math.min(W, H) * 0.3;
      nodePositions.set(node.id, {
        x: cx + Math.cos(angle) * r + (Math.random() - 0.5) * 60,
        y: cy + Math.sin(angle) * r + (Math.random() - 0.5) * 60,
        vx: 0, vy: 0,
      });
    }
  });

  const K = 80, REPULSION = 3000, ATTRACTION = 0.08;
  const TOTAL_ITERS = 80, PER_FRAME = 8;
  let iter = 0;

  function runChunk() {
    const end = Math.min(iter + PER_FRAME, TOTAL_ITERS);
    for (; iter < end; iter++) {
      for (let i = 0; i < filteredNodes.length; i++) {
        for (let j = i + 1; j < filteredNodes.length; j++) {
          const a = nodePositions.get(filteredNodes[i].id);
          const b = nodePositions.get(filteredNodes[j].id);
          if (!a || !b) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = REPULSION / (dist * dist);
          const fx = (dx / dist) * force, fy = (dy / dist) * force;
          a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
        }
      }
      filteredEdges.forEach(e => {
        const a = nodePositions.get(e.source), b = nodePositions.get(e.target);
        if (!a || !b) return;
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - K) * ATTRACTION;
        const fx = (dx / dist) * force, fy = (dy / dist) * force;
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      });
      filteredNodes.forEach(n => {
        const p = nodePositions.get(n.id);
        if (!p) return;
        p.vx += (cx - p.x) * 0.005;
        p.vy += (cy - p.y) * 0.005;
        p.x = Math.max(40, Math.min(W - 40, p.x + p.vx));
        p.y = Math.max(40, Math.min(H - 40, p.y + p.vy));
        p.vx *= 0.85; p.vy *= 0.85;
      });
    }
    if (iter < TOTAL_ITERS) {
      layoutFrame = requestAnimationFrame(runChunk);
    } else {
      layoutFrame = null;
      if (onDone) onDone();
    }
  }
  layoutFrame = requestAnimationFrame(runChunk);
}

// ── Canvas rendering ─────────────────────────────────────────
function renderGraph() {
  document.getElementById('brain-graph-wrap').style.display = 'block';
  document.getElementById('brain-list-wrap').classList.add('hidden');
  document.getElementById('brain-loading').style.display = 'none';

  if (animFrame) cancelAnimationFrame(animFrame);
  draw();
}

function draw() {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.width / dpr;
  const H = canvas.height / dpr;

  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  // Draw edges
  filteredEdges.forEach(e => {
    const a = nodePositions.get(e.source);
    const b = nodePositions.get(e.target);
    if (!a || !b) return;
    const strength = e.strength || 0.5;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = `rgba(100,100,150,${0.15 + strength * 0.25})`;
    ctx.lineWidth = 1 + strength;
    ctx.stroke();
  });

  // Draw nodes
  filteredNodes.forEach(node => {
    const p = nodePositions.get(node.id);
    if (!p) return;
    const r = 8 + Math.min((node.count || 1) * 2, 14);
    const isSelected = selectedNode?.id === node.id;
    const isHovered = hoveredNode?.id === node.id;
    const color = node._color || '#7c3aed';

    // Glow for selected
    if (isSelected || isHovered) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 6, 0, Math.PI * 2);
      ctx.fillStyle = color + '30';
      ctx.fill();
    }

    // Node circle
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = isSelected ? color : color + 'cc';
    ctx.fill();
    ctx.strokeStyle = isSelected ? '#fff' : color;
    ctx.lineWidth = isSelected ? 2.5 : 1.5;
    ctx.stroke();

    // Label (only if zoomed in enough or few nodes)
    if (scale > 0.7 || filteredNodes.length < 30) {
      ctx.fillStyle = '#e2e8f0';
      ctx.font = `${isSelected ? 600 : 500} ${Math.round(11 / scale)}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(node.name?.slice(0, 20) || '?', p.x, p.y + r + 14);
    }
  });

  ctx.restore();
  animFrame = requestAnimationFrame(draw);
}

// ── Hit test ─────────────────────────────────────────────────
function hitTest(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const cx = (clientX - rect.left - offsetX) / scale;
  const cy = (clientY - rect.top - offsetY) / scale;
  for (const node of filteredNodes) {
    const p = nodePositions.get(node.id);
    if (!p) continue;
    const r = 8 + Math.min((node.count || 1) * 2, 14) + 4;
    const dx = cx - p.x, dy = cy - p.y;
    if (dx * dx + dy * dy <= r * r) return node;
  }
  return null;
}

// ── Canvas interaction ────────────────────────────────────────
function initCanvas() {
  canvas = document.getElementById('brain-canvas');
  ctx = canvas.getContext('2d');
  tooltip = document.createElement('div');
  tooltip.className = 'brain-tooltip';
  tooltip.style.display = 'none';
  document.body.appendChild(tooltip);

  resizeCanvas();
  const _resizeCanvas = window.throttle ? window.throttle(resizeCanvas, 150) : resizeCanvas;
  window.addEventListener('resize', _resizeCanvas);
  window.registerCleanup && window.registerCleanup(() => {
    window.removeEventListener('resize', _resizeCanvas);
    if (animFrame)  cancelAnimationFrame(animFrame);
    if (layoutFrame) cancelAnimationFrame(layoutFrame);
    if (tooltip) tooltip.remove();
  });

  // Mouse
  canvas.addEventListener('mousedown', e => {
    isDragging = true;
    dragStart = { x: e.clientX - offsetX, y: e.clientY - offsetY };
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('mousemove', e => {
    if (isDragging) {
      offsetX = e.clientX - dragStart.x;
      offsetY = e.clientY - dragStart.y;
      return;
    }
    const node = hitTest(e.clientX, e.clientY);
    hoveredNode = node;
    canvas.style.cursor = node ? 'pointer' : 'grab';
    if (node) {
      tooltip.style.display = 'block';
      tooltip.style.left = (e.clientX + 14) + 'px';
      tooltip.style.top = (e.clientY - 20) + 'px';
      tooltip.textContent = node.name;
    } else {
      tooltip.style.display = 'none';
    }
  });
  canvas.addEventListener('mouseup', e => {
    if (!isDragging) return;
    const moved = Math.abs(e.clientX - dragStart.x - offsetX) < 5;
    isDragging = false;
    canvas.style.cursor = 'grab';
    if (moved) {
      const node = hitTest(e.clientX, e.clientY);
      if (node) selectNode(node);
    }
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    scale = Math.max(0.3, Math.min(3, scale * delta));
  }, { passive: false });

  // Touch
  let lastTouch = null;
  canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      isDragging = true;
      lastTouch = e.touches[0];
      dragStart = { x: e.touches[0].clientX - offsetX, y: e.touches[0].clientY - offsetY };
    }
  });
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 1 && isDragging) {
      offsetX = e.touches[0].clientX - dragStart.x;
      offsetY = e.touches[0].clientY - dragStart.y;
    }
  }, { passive: false });
  canvas.addEventListener('touchend', e => {
    if (isDragging && lastTouch) {
      const dx = Math.abs(lastTouch.clientX - (e.changedTouches[0]?.clientX || lastTouch.clientX));
      if (dx < 5) {
        const node = hitTest(lastTouch.clientX, lastTouch.clientY);
        if (node) selectNode(node);
      }
    }
    isDragging = false;
    lastTouch = null;
  });
}

function resizeCanvas() {
  const wrap = document.getElementById('brain-graph-wrap');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = wrap.clientWidth * dpr;
  canvas.height = wrap.clientHeight * dpr;
  canvas.style.width = wrap.clientWidth + 'px';
  canvas.style.height = wrap.clientHeight + 'px';
  ctx.scale(dpr, dpr);
}

// ── Node selection / sidebar ─────────────────────────────────
async function selectNode(node) {
  selectedNode = node;
  showSidebar(node);
}

async function showSidebar(node) {
  const sidebar = document.getElementById('brain-sidebar');
  sidebar.classList.remove('hidden');

  document.getElementById('sidebar-subject').textContent = node.subject || 'Concept';
  document.getElementById('sidebar-name').textContent = node.name;
  document.getElementById('sidebar-def').textContent = node.definition || '—';

  // Connections
  const connsEl = document.getElementById('sidebar-connections');
  connsEl.innerHTML = '';
  const connected = (graphData.edges || [])
    .filter(e => e.source === node.id || e.target === node.id)
    .map(e => e.source === node.id ? e.target : e.source)
    .map(id => (graphData.nodes || []).find(n => n.id === id))
    .filter(Boolean)
    .slice(0, 8);

  if (connected.length) {
    connected.forEach(n => {
      const chip = document.createElement('span');
      chip.className = 'sidebar-conn-chip';
      chip.textContent = n.name;
      chip.addEventListener('click', () => selectNode(n));
      connsEl.appendChild(chip);
    });
  } else {
    connsEl.innerHTML = '<span style="color:#475569;font-size:13px">Aucune connexion</span>';
  }

  // Sessions
  const sessionsEl = document.getElementById('sidebar-sessions');
  sessionsEl.innerHTML = '';
  (node.sessions || []).slice(0, 3).forEach(s => {
    const el = document.createElement('div');
    el.className = 'sidebar-session-item';
    el.innerHTML = `<strong>${s.title || 'Session'}</strong>${new Date(s.date).toLocaleDateString('fr-FR')}`;
    sessionsEl.appendChild(el);
  });
  if (!node.sessions?.length) {
    sessionsEl.innerHTML = '<div class="sidebar-session-item">Session unique</div>';
  }

  // Mastery
  const masterySection = document.getElementById('sidebar-mastery-section');
  if (node.mastery !== undefined) {
    masterySection.classList.remove('hidden');
    document.getElementById('sidebar-mastery-fill').style.width = `${node.mastery}%`;
    document.getElementById('sidebar-mastery-label').textContent =
      node.mastery >= 80 ? 'Maîtrisé' : node.mastery >= 50 ? 'En cours' : 'À réviser';
  } else {
    masterySection.classList.add('hidden');
  }

  // Deepen button
  document.getElementById('btn-deepen').onclick = () => deepenConcept(node);
  document.getElementById('btn-sidebar-close').onclick = () => {
    sidebar.classList.add('hidden');
    selectedNode = null;
  };

  document.getElementById('sidebar-deepen-result').classList.add('hidden');
}

async function deepenConcept(node) {
  const btn = document.getElementById('btn-deepen');
  btn.textContent = '⏳ Génération…';
  btn.disabled = true;
  try {
    const res = await fetch(`${API}/deepen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ concept: node.name, context: node.definition || '' }),
    });
    const data = await res.json();
    const el = document.getElementById('sidebar-deepen-result');
    el.classList.remove('hidden');
    el.innerHTML = `
      <h4>Explication approfondie</h4>
      <p>${data.explanation || data._raw || 'Aucune explication générée.'}</p>
      ${data.examples?.length ? `<h4 style="margin-top:12px">Exemples</h4><ul>${data.examples.map(e => `<li>${e}</li>`).join('')}</ul>` : ''}
      ${data.common_mistakes?.length ? `<h4 style="margin-top:12px">Erreurs fréquentes</h4><ul>${data.common_mistakes.map(m => `<li>${m}</li>`).join('')}</ul>` : ''}
    `;
  } catch (err) {
    console.error('Deepen error:', err);
  } finally {
    btn.textContent = '💡 Approfondir';
    btn.disabled = false;
  }
}

// ── List view ─────────────────────────────────────────────────
function renderList() {
  document.getElementById('brain-graph-wrap').style.display = 'none';
  const wrap = document.getElementById('brain-list-wrap');
  wrap.classList.remove('hidden');
  document.getElementById('brain-loading').style.display = 'none';

  const list = document.getElementById('brain-list');
  list.innerHTML = '';

  filteredNodes.forEach(node => {
    const connCount = (graphData.edges || [])
      .filter(e => e.source === node.id || e.target === node.id).length;
    const item = document.createElement('div');
    item.className = 'brain-list-item';
    item.innerHTML = `
      <div class="brain-list-dot" style="background:${node._color}"></div>
      <div class="brain-list-name">${node.name}</div>
      <div class="brain-list-subject">${node.subject || ''}</div>
      <div class="brain-list-connections">${connCount} lien${connCount !== 1 ? 's' : ''}</div>
    `;
    item.addEventListener('click', () => selectNode(node));
    list.appendChild(item);
  });
}

// ── Insights ─────────────────────────────────────────────────
function renderInsights() {
  const nodes = filteredNodes;
  const edges = filteredEdges;
  const grid = document.getElementById('brain-insights-grid');

  const insights = [];

  // Most connected
  if (nodes.length) {
    const connMap = new Map();
    edges.forEach(e => {
      connMap.set(e.source, (connMap.get(e.source) || 0) + 1);
      connMap.set(e.target, (connMap.get(e.target) || 0) + 1);
    });
    const top = nodes.slice().sort((a, b) => (connMap.get(b.id) || 0) - (connMap.get(a.id) || 0))[0];
    if (top) {
      insights.push({
        icon: '🌐',
        title: 'Concept central',
        body: `"${top.name}" est le plus connecté avec ${connMap.get(top.id) || 0} liens — c'est un pilier de tes connaissances.`,
      });
    }
  }

  // Subject with most concepts
  const subjectCounts = {};
  nodes.forEach(n => { subjectCounts[n.subject || 'Autre'] = (subjectCounts[n.subject || 'Autre'] || 0) + 1; });
  const topSubject = Object.entries(subjectCounts).sort((a, b) => b[1] - a[1])[0];
  if (topSubject) {
    insights.push({
      icon: '📚',
      title: 'Matière dominante',
      body: `Tu as le plus travaillé en ${topSubject[0]} avec ${topSubject[1]} concept${topSubject[1] > 1 ? 's' : ''} mémorisé${topSubject[1] > 1 ? 's' : ''}.`,
    });
  }

  // Cross-topic connections
  const crossEdges = edges.filter(e => {
    const a = nodes.find(n => n.id === e.source);
    const b = nodes.find(n => n.id === e.target);
    return a && b && a.subject !== b.subject;
  });
  if (crossEdges.length > 0) {
    insights.push({
      icon: '🔗',
      title: 'Connexions inter-matières',
      body: `${crossEdges.length} lien${crossEdges.length > 1 ? 's' : ''} identifié${crossEdges.length > 1 ? 's' : ''} entre tes matières — ton cerveau fait des rapprochements puissants.`,
    });
  }

  // Empty state
  if (!nodes.length) {
    insights.push({
      icon: '📄',
      title: 'Commence à apprendre',
      body: 'Génère ton premier pack d\'étude pour voir apparaître des insights personnalisés ici.',
    });
  }

  grid.innerHTML = '';
  insights.forEach(ins => {
    const card = document.createElement('div');
    card.className = 'brain-insight-card';
    card.innerHTML = `
      <div class="insight-icon">${ins.icon}</div>
      <div class="insight-title">${ins.title}</div>
      <div class="insight-body">${ins.body}</div>
    `;
    grid.appendChild(card);
  });
}

// ── Boot ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initCanvas();

  // Search (debounced — avoids re-layout on every keypress)
  const _onSearch = e => { searchQuery = e.target.value; applyFilters(); };
  document.getElementById('brain-search').addEventListener('input',
    window.debounce ? window.debounce(_onSearch, 200) : _onSearch
  );

  // View toggle
  document.getElementById('btn-view-graph').addEventListener('click', () => {
    viewMode = 'graph';
    document.getElementById('btn-view-graph').classList.add('active');
    document.getElementById('btn-view-list').classList.remove('active');
    if (filteredNodes.length) renderGraph();
  });
  document.getElementById('btn-view-list').addEventListener('click', () => {
    viewMode = 'list';
    document.getElementById('btn-view-list').classList.add('active');
    document.getElementById('btn-view-graph').classList.remove('active');
    if (animFrame) cancelAnimationFrame(animFrame);
    if (filteredNodes.length) renderList();
  });

  if (!window.APP_MANAGED) loadGraph();
});

// Expose API for unified workspace
window._brainAPI = { loadGraph, resizeCanvas };
