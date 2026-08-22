const crypto = require('crypto');
const ENTITY_TYPES = ['CASE','LOCATION','DEPARTMENT','TENDER','WORK_ORDER','CONTRACTOR','OFFICER','PAYMENT','COMPLAINT','AUDIT','COURT_CASE','DOCUMENT','SOURCE','WORK','DEFECT','MATERIAL','SPECIFICATION'];
function normalize(value = '') { return String(value).toLowerCase().replace(/https?:\/\/[^\s]+/g, ' ').replace(/[^a-z0-9\u0900-\u097f]+/gi, ' ').replace(/\s+/g, ' ').trim(); }
function idFor(type, key) { return `${type.toLowerCase()}:${crypto.createHash('sha256').update(`${type}|${normalize(key)}`).digest('hex').slice(0, 16)}`; }
function entity(type, key, label, props = {}) { const safeType = ENTITY_TYPES.includes(type) ? type : 'DOCUMENT'; return { id: idFor(safeType, key), type: safeType, key: normalize(key), label: label || key, props }; }
function edge(from, relation, to, confidence = 0.5, evidence = []) { return { id: crypto.createHash('sha256').update(`${from}|${relation}|${to}`).digest('hex').slice(0, 16), from, relation, to, confidence, evidence: [...new Set(evidence)] }; }
function addEntity(graph, e) { if (!e?.id) return; const existing = graph.nodes.find(n => n.id === e.id); if (!existing) graph.nodes.push(e); else existing.props = { ...(existing.props || {}), ...(e.props || {}) }; }
function addEdge(graph, e) { if (!e) return; const key = `${e.from}|${e.relation}|${e.to}`; if (!graph.edges.some(x => `${x.from}|${x.relation}|${x.to}` === key)) graph.edges.push(e); }
function ensureGraph(graph, caseData) {
  graph = graph || { version: 1, updatedAt: null, nodes: [], edges: [], leads: [] };
  const caseNode = entity('CASE', caseData.investigationId || caseData.title || 'case', caseData.title || caseData.investigationId || 'Investigation Case', { investigationId: caseData.investigationId }); addEntity(graph, caseNode);
  const location = caseData.location || {}; const locKey = location.display_name || [location.village, location.town, location.district, location.state].filter(Boolean).join('|');
  if (locKey) { const loc = entity('LOCATION', locKey, location.display_name || locKey, location); addEntity(graph, loc); addEdge(graph, edge(caseNode.id, 'LOCATED_AT', loc.id, 0.95, [])); }
  const tender = caseData.tender || {};
  if (tender.tenderId) { const t = entity('TENDER', tender.tenderId, tender.tenderId, tender); addEntity(graph, t); addEdge(graph, edge(caseNode.id, 'INVESTIGATES', t.id, 0.98, [])); }
  const object = caseData.objectIdentification || {};
  for (const candidate of object.candidates || []) { const r = candidate.result || candidate; const label = r.object || r.category || r.description; if (!label) continue; const w = entity('WORK', label, label, { provider: candidate.provider || null }); addEntity(graph, w); addEdge(graph, edge(caseNode.id, 'CONCERNS_WORK', w.id, 0.65, [])); }
  for (const s of caseData.sources || []) addSourceNode(graph, s, caseNode.id, 0.6, caseData);
  return graph;
}
function addSourceNode(graph, s, parentId = null, confidence = 0.55, caseData = null) {
  if (!s?.url) return null;
  const node = entity('SOURCE', s.url, s.title || s.url, { url: s.url, publisher: s.publisher, queryType: s.queryType, excerpt: s.excerpt, retrievedAt: s.retrievedAt }); addEntity(graph, node);
  if (parentId) addEdge(graph, edge(parentId, 'SUPPORTED_BY', node.id, confidence, [s.id].filter(Boolean)));
  const extracted = extractEntitiesFromSource(s); const caseNodeId = caseData ? idFor('CASE', caseData.investigationId || caseData.title || 'case') : parentId;
  for (const x of extracted) { addEntity(graph, x); if (caseNodeId) { addEdge(graph, edge(node.id, 'MENTIONS', x.id, 0.55, [s.id].filter(Boolean))); addEdge(graph, edge(caseNodeId, 'POSSIBLE_MATCH', x.id, 0.35, [s.id].filter(Boolean))); } }
  return node;
}
function extractEntitiesFromSource(s) {
  const text = [s.title, s.excerpt, s.url].filter(Boolean).join(' '); const out = [];
  for (const m of text.match(/\b(?:\d{4}_[A-Z]{2,15}_\d+_\d+|[A-Z]{2,10}[-/]?\d{2,8}[-/]?\d{0,8})\b/g) || []) out.push(entity('TENDER', m, m, { discoveredIn: s.url }));
  for (const m of text.match(/\b(?:₹|rs\.?|inr)\s?[\d,]+(?:\.\d+)?\s?(?:lakh|crore|cr)?\b/gi) || []) out.push(entity('PAYMENT', m, m, { discoveredIn: s.url, raw: m }));
  for (const m of text.match(/\b(?:FIR|case|petition|writ|complaint|notice|show cause|audit)\s*(?:no\.?|number)?\s*[A-Z0-9\-/]{2,30}\b/gi) || []) out.push(entity(/audit/i.test(m) ? 'AUDIT' : /complaint|notice|show cause/i.test(m) ? 'COMPLAINT' : 'COURT_CASE', m, m, { discoveredIn: s.url }));
  return out;
}
function extractTokens(text) { return [...new Set(normalize(text).split(' ').filter(w => w.length >= 4))].slice(0, 500); }
function scoreSourceRelevance(graph, caseData, s) {
  const corpus = normalize([s.title, s.publisher, s.excerpt, s.url, s.queryType].filter(Boolean).join(' ')); const important = new Set();
  for (const n of graph.nodes) { if (n.type === 'SOURCE') continue; for (const t of extractTokens(n.label)) important.add(t); for (const t of extractTokens(JSON.stringify(n.props || {}))) important.add(t); }
  const hits = [...important].filter(t => corpus.includes(t)); const exact = caseData.tender?.tenderId && corpus.includes(normalize(caseData.tender.tenderId)) ? 0.45 : 0; const typeBoost = /complaint|audit|court|tender|work order|measurement|inspection|payment|quality|defect|contractor|blacklist|notice|penalty|reconstruction/i.test(corpus) ? 0.12 : 0; const score = Math.min(1, exact + Math.min(0.48, hits.length * 0.04) + typeBoost);
  return { score, matchedTerms: hits.slice(0, 20) };
}
function ingestSources(graph, caseData, sources = []) {
  const leads = [];
  for (const s of sources) { const relevance = scoreSourceRelevance(graph, caseData, s); const node = addSourceNode(graph, s, null, relevance.score, caseData); if (!node) continue; const caseId = idFor('CASE', caseData.investigationId || caseData.title || 'case'); if (relevance.score >= Number(process.env.GRAPH_RELEVANCE_THRESHOLD || 0.28)) { addEdge(graph, edge(caseId, 'RELEVANT_SOURCE', node.id, relevance.score, [s.id].filter(Boolean))); leads.push({ sourceId: s.id || node.id, sourceNodeId: node.id, score: relevance.score, matchedTerms: relevance.matchedTerms, reason: 'matched case graph entities' }); } }
  graph.leads = [...(graph.leads || []), ...leads].sort((a, b) => b.score - a.score).filter((x, i, arr) => i < 150 && arr.findIndex(y => y.sourceId === x.sourceId) === i); graph.updatedAt = new Date().toISOString(); return graph;
}
function mergeGraph(previous, incoming) { const graph = previous || { version: 1, updatedAt: null, nodes: [], edges: [], leads: [] }; for (const n of incoming.nodes || []) addEntity(graph, n); for (const e of incoming.edges || []) addEdge(graph, e); graph.leads = [...(graph.leads || []), ...(incoming.leads || [])].sort((a, b) => b.score - a.score).filter((x, i, arr) => i < 150 && arr.findIndex(y => y.sourceId === x.sourceId) === i); graph.updatedAt = new Date().toISOString(); return graph; }
function graphStats(graph) { const byType = {}; for (const n of graph.nodes || []) byType[n.type] = (byType[n.type] || 0) + 1; return { nodes: graph.nodes?.length || 0, edges: graph.edges?.length || 0, leads: graph.leads?.length || 0, byType }; }
module.exports = { ENTITY_TYPES, entity, edge, ensureGraph, ingestSources, mergeGraph, graphStats, scoreSourceRelevance, normalize, extractEntitiesFromSource };