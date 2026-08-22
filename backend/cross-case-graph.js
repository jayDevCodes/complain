const fs = require('fs');
const path = require('path');
const { entity, edge, graphStats } = require('./evidence-graph');

function caseFiles(caseDir) {
  if (!fs.existsSync(caseDir)) return [];
  return fs.readdirSync(caseDir)
    .filter(name => name.endsWith('.json'))
    .filter(name => name !== 'cross-case-graph.json')
    .filter(name => !name.endsWith('.graph.json'))
    .map(name => path.join(caseDir, name));
}

function loadCases(caseDir) {
  const cases = [];
  for (const file of caseFiles(caseDir)) {
    try { cases.push(JSON.parse(fs.readFileSync(file, 'utf8'))); }
    catch (_) {}
  }
  return cases;
}

function buildCrossCaseGraph(caseDir) {
  const cases = loadCases(caseDir);
  const graph = { version: 1, generatedAt: new Date().toISOString(), nodes: [], edges: [], matches: [], stats: {} };
  const addNode = node => { if (node && !graph.nodes.some(x => x.id === node.id)) graph.nodes.push(node); };
  const addEdge = e => { if (!e) return; const key = `${e.from}|${e.relation}|${e.to}`; if (!graph.edges.some(x => `${x.from}|${x.relation}|${x.to}` === key)) graph.edges.push(e); };

  const caseEntityLists = [];
  for (const c of cases) {
    if (!c || !c.investigationId) continue;
    const caseNode = entity('CASE', c.investigationId, c.title || c.investigationId, { investigationId: c.investigationId });
    addNode(caseNode);
    const ids = new Set();
    const g = c.graph && c.graph.nodes ? c.graph : null;
    if (g) {
      for (const n of g.nodes) { addNode(n); if (n.type !== 'SOURCE' && n.type !== 'CASE') ids.add(n.id); }
      for (const e of g.edges || []) addEdge(e);
    }
    const l = c.location || {};
    const locKey = l.display_name || [l.village,l.town,l.district,l.state].filter(Boolean).join('|');
    if (locKey) { const n = entity('LOCATION', locKey, l.display_name || locKey, l); addNode(n); addEdge(edge(caseNode.id, 'LOCATED_AT', n.id, 0.95)); ids.add(n.id); }
    const tenderId = c.tender?.tenderId;
    if (tenderId) { const n = entity('TENDER', tenderId, tenderId, c.tender); addNode(n); addEdge(edge(caseNode.id, 'INVESTIGATES', n.id, 0.98)); ids.add(n.id); }
    caseEntityLists.push({ node: caseNode, ids });
  }

  for (let i = 0; i < caseEntityLists.length; i++) {
    for (let j = i + 1; j < caseEntityLists.length; j++) {
      const a = caseEntityLists[i], b = caseEntityLists[j];
      const shared = [...a.ids].filter(id => b.ids.has(id));
      if (!shared.length) continue;
      const similarity = Math.min(1, shared.length / Math.max(3, Math.min(a.ids.size || 1, b.ids.size || 1)));
      addEdge(edge(a.node.id, 'RELATED_CASE', b.node.id, similarity, shared.slice(0, 30)));
      addEdge(edge(b.node.id, 'RELATED_CASE', a.node.id, similarity, shared.slice(0, 30)));
      graph.matches.push({ caseA: a.node.id, caseB: b.node.id, sharedEntityIds: shared, similarity, reason: 'shared stable graph entities' });
    }
  }

  graph.stats = { ...graphStats(graph), cases: cases.length, crossCaseMatches: graph.matches.length };
  return graph;
}

module.exports = { buildCrossCaseGraph, loadCases, caseFiles };