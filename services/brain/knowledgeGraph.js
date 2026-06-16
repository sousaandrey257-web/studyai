'use strict';
// Second Brain — knowledge graph connecting concepts across sessions
const fs   = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../data/brain');
try { if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true }); } catch {}

function file(userId) { return path.join(DIR, `graph_${userId}.json`); }

function load(userId) {
  try { return JSON.parse(fs.readFileSync(file(userId), 'utf8')); }
  catch { return { nodes: {}, edges: [], meta: { totalConcepts: 0, totalLinks: 0 } }; }
}

function save(userId, graph) {
  const tmp = file(userId) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ ...graph, updatedAt: new Date().toISOString() }));
  fs.renameSync(tmp, file(userId));
}

// ── Add concepts from a study pack ──────────────────────────
function ingest(userId, { concepts = [], subject, jobId, title }) {
  const graph = load(userId);
  const added = [];

  for (const c of concepts) {
    const key = normalize(c.name || c);
    if (!graph.nodes[key]) {
      graph.nodes[key] = {
        id:         key,
        label:      c.name || c,
        definition: c.definition || '',
        subject,
        jobId,
        title,
        importance: c.importance || 'medium',
        difficulty: c.difficulty || 50,
        addedAt:    new Date().toISOString(),
        reviewCount: 0,
      };
      graph.meta.totalConcepts++;
      added.push(key);
    } else {
      // Update with latest data
      graph.nodes[key].reviewCount++;
    }

    // Auto-link to related concepts from same ingestion
    for (const rel of (c.related || [])) {
      const relKey = normalize(rel);
      if (graph.nodes[relKey]) addEdge(graph, key, relKey, 'related', 0.7);
    }
  }

  // Cross-subject linking: detect similar concepts from different sessions
  autoLink(graph, added);

  graph.meta.totalLinks = graph.edges.length;
  save(userId, graph);
  return { added: added.length, totalNodes: Object.keys(graph.nodes).length };
}

function addEdge(graph, from, to, type, weight) {
  const exists = graph.edges.find(e => e.from === from && e.to === to);
  if (!exists) graph.edges.push({ from, to, type, weight, at: Date.now() });
  else exists.weight = Math.min(1, exists.weight + 0.1);
}

function autoLink(graph, newKeys) {
  const existing = Object.keys(graph.nodes).filter(k => !newKeys.includes(k));
  for (const nk of newKeys) {
    const nLabel = graph.nodes[nk]?.label?.toLowerCase() || '';
    for (const ek of existing) {
      const eLabel = graph.nodes[ek]?.label?.toLowerCase() || '';
      const sim = similarity(nLabel, eLabel);
      if (sim > 0.65) addEdge(graph, nk, ek, 'similar', sim);
    }
  }
}

// ── Jaccard similarity on word sets ──────────────────────────
function similarity(a, b) {
  const setA = new Set(a.split(/\W+/).filter(w => w.length > 3));
  const setB = new Set(b.split(/\W+/).filter(w => w.length > 3));
  const inter = [...setA].filter(w => setB.has(w)).length;
  const union  = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : inter / union;
}

function normalize(s) {
  return (s || '').toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_àâéèêëîïôùûü]/g, '');
}

// ── Query the graph ───────────────────────────────────────────
function getGraph(userId, { limit = 100 } = {}) {
  const g = load(userId);
  const nodes = Object.values(g.nodes).slice(0, limit);
  const edges = g.edges.filter(e =>
    nodes.find(n => n.id === e.from) && nodes.find(n => n.id === e.to)
  );
  return { nodes, edges, meta: g.meta };
}

function getConnections(userId, conceptId) {
  const g   = load(userId);
  const key = normalize(conceptId);
  const edges = g.edges.filter(e => e.from === key || e.to === key);
  return edges.map(e => {
    const other = e.from === key ? e.to : e.from;
    return { concept: g.nodes[other], type: e.type, weight: e.weight };
  }).filter(x => x.concept);
}

// ── "You've seen this before" detection ───────────────────────
function findRelated(userId, newConcepts) {
  const g = load(userId);
  const matches = [];
  for (const c of newConcepts) {
    const key = normalize(c.name || c);
    if (g.nodes[key]) {
      matches.push({
        concept:     g.nodes[key].label,
        seenIn:      g.nodes[key].title,
        subject:     g.nodes[key].subject,
        connections: getConnections(userId, key).slice(0, 3),
      });
    }
  }
  return matches;
}

module.exports = { ingest, getGraph, getConnections, findRelated };
