require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createInvestigationId, evidence } = require('./investigation-schema');
const { runParallelModels, consensus } = require('./ai-orchestrator');
const { researchLocation } = require('./research-engine');
const { runDeepResearch } = require('./deep-research-engine');
const { buildLedger, enrichModelConsensus, finalizeLedger } = require('./evidence-ledger');
const { generateEvidencePDF, REPORT_DIR } = require('./pdf-report');
const { generateMasterReport } = require('./master-report');
const { runComparativeResearch } = require('./comparative-engine');
const { generateComparativePDF } = require('./comparative-pdf-report');
const { ensureGraph, ingestSources, mergeGraph, graphStats, entity } = require('./evidence-graph');
const { buildCrossCaseGraph } = require('./cross-case-graph');
const { buildFinalEvidencePlan } = require('./evidence-completion');

const CASE_DIR = path.join(__dirname, 'cases');
if (!fs.existsSync(CASE_DIR)) fs.mkdirSync(CASE_DIR, { recursive: true });

const LOCATION_TIMEOUT_MS = Number(process.env.LOCATION_PROVIDER_TIMEOUT_MS || 12000);

async function getLocationDetails(latitude, longitude) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}&zoom=18&addressdetails=1`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Location service timed out after ${LOCATION_TIMEOUT_MS}ms`)), LOCATION_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'GovernmentWorkInvestigationAI/7.0' } });
    if (!response.ok) throw new Error(`Location service failed: HTTP ${response.status}`);
    const data = await response.json(); const a = data.address || {};
    return { latitude, longitude, display_name: data.display_name || null, village: a.village || a.hamlet || a.suburb || null, town: a.town || a.city || a.municipality || null, district: a.county || a.state_district || null, state: a.state || null, country: a.country || null, pincode: a.postcode || null, raw: data };
  } finally { clearTimeout(timer); }
}

function savePhoto(photo, investigationId) {
  if (!photo) return null;
  const match = String(photo).match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
  if (!match) return null;
  const ext = match[1].toLowerCase().replace('jpeg', 'jpg');
  const filePath = path.join(CASE_DIR, `${investigationId}.${ext}`);
  fs.writeFileSync(filePath, Buffer.from(match[2], 'base64'));
  return filePath;
}
function safeCaseWrite(id, data) { const p = path.join(CASE_DIR, `${id}.json`); fs.writeFileSync(p, JSON.stringify(data, null, 2)); return p; }
function graphFile(id) { return path.join(CASE_DIR, `${path.basename(id)}.graph.json`); }
function saveGraph(id, graph) { const p = graphFile(id); fs.writeFileSync(p, JSON.stringify(graph, null, 2)); return p; }
function loadGraph(id) { const p = graphFile(id); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; }
function safeCaseRead(id) { const p = path.join(CASE_DIR, `${path.basename(id)}.json`); if (!fs.existsSync(p)) throw new Error(`Case not found: ${id}`); return { path: p, data: JSON.parse(fs.readFileSync(p, 'utf8')) }; }

function buildTimeline(caseData) {
  const t = caseData.tender || {};
  const rows = [
    ['noticeDate', 'NIT / tender notice'], ['bidStartDate', 'Bid opening started'], ['bidEndDate', 'Bid submission ended'],
    ['awardDate', 'Award / selection'], ['loaDate', 'Letter of Acceptance'], ['agreementDate', 'Agreement'], ['workOrderDate', 'Work order'],
    ['startDate', 'Work start'], ['inspectionDate', 'Inspection'], ['measurementDate', 'Measurement'], ['billDate', 'Bill'],
    ['paymentDate', 'Payment'], ['completionDate', 'Completion']
  ];
  return rows.filter(([key]) => t[key]).map(([key, event]) => ({ key, date: t[key], event, description: `${event} date from tender/contract field; verify against the underlying record.` })).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

async function runInvestigation({ latitude, longitude, timestamp, tenderId, photo, accuracy, objectHint, department }) {
  const investigationId = createInvestigationId();
  const location = await getLocationDetails(latitude, longitude);
  const photoPath = savePhoto(photo, investigationId);
  const capture = { timestamp, latitude, longitude, accuracy: accuracy ?? null, photoCaptured: Boolean(photoPath) };
  const vision = await runParallelModels('PHOTO_OBJECT_IDENTIFICATION', { capture, location, tenderId, objectHint, department }, photo || null);
  const modelReview = { vision, consensus: consensus(vision.results) };
  const objectIdentification = { status: vision.configuredCount ? 'AI_REVIEWED_NEEDS_SOURCE_CORROBORATION' : 'UNKNOWN_NO_MODEL_CONFIGURED', candidates: vision.results.filter(x => x.status === 'ok').map(x => ({ provider: x.provider, result: x.result })) };
  const description = objectHint || objectIdentification.candidates.map(x => x.result?.object || x.result?.description || '').filter(Boolean).join(' | ');

  const research = await researchLocation({ location, objectDescription: description, department, tenderId });
  const initialSources = research.sources || [];
  const deepSeed = { investigationId, capture, location, department, tender: { tenderId: tenderId || null }, objectIdentification, sources: initialSources, researchQueries: research.queries };
  const deepResearch = await runDeepResearch(deepSeed);
  const deepSources = deepResearch.sources || [];
  const allSources = [...new Map([...initialSources, ...deepSources].filter(s => s?.url).map(s => [s.url, { ...s, ...(deepSources.find(d => d.url === s.url) || {}) }])).values()];

  const synthesis = await runParallelModels('TENDER_DEEP_RESEARCH_EXECUTION_QUALITY_AUDIT', {
    capture, location, department, tenderId, objectIdentification,
    tenderResearchFacts: deepResearch.facts,
    discoveredTenderIdentifiers: deepResearch.identifiers,
    deepResearchRounds: deepResearch.rounds,
    sources: allSources.slice(0, 120),
    researchQueries: research.queries
  }, photo || null);
  modelReview.synthesis = synthesis;
  modelReview.synthesisConsensus = consensus(synthesis.results);
  const evidenceItems = [
    evidence(`Photo captured at ${timestamp}`, 'OBSERVED', 1, [], 'Direct field capture metadata.'),
    evidence(`GPS coordinates ${latitude}, ${longitude}`, 'OBSERVED', 1, [], 'Device supplied coordinates; accuracy retained.'),
    evidence(location.display_name || 'Reverse-geocoded place not available', 'DOCUMENTED', location.display_name ? 0.9 : 0, [], 'Derived from reverse geocoding, not proof of ownership.')
  ];
  for (const s of allSources.slice(0, 60)) evidenceItems.push(evidence(`${s.title || s.url}`, s.verified && Number(s.sourceQuality || 0) >= 0.7 ? 'DOCUMENTED' : 'LEAD', Number(s.sourceQuality || 0.45), [s.id], s.fetchedExcerpt || s.excerpt || ''));

  const synthesized = synthesis.results.filter(x => x.status === 'ok').map(x => x.result);
  const tender = { status: tenderId ? 'USER_SUPPLIED_ID_DEEP_RESEARCH_REQUIRED' : 'NOT_ESTABLISHED', tenderId: tenderId || null, ...(synthesized.find(x => x.tender && typeof x.tender === 'object')?.tender || {}), modelFindings: synthesized.map(x => x.tender || x.contract || x.award || x.findings).filter(Boolean) };
  const comparison = synthesized.flatMap(x => x.comparison || x.defects || []).map(x => typeof x === 'string' ? { item: x, expected: 'Unknown', observed: 'AI finding only', gap: 'Requires documentary/technical verification', refs: [] } : x).slice(0, 60);
  const execution = { status: 'DOCUMENTARY_RESEARCH_REQUIRED', findings: synthesized.map(x => x.inspection || x.measurement || x.payment || x.execution).filter(Boolean) };
  const gaps = [
    'Verify exact NIT/tender notice, tender ID, BOQ, sanctioned estimate and tender value from the primary procurement record.',
    'Verify technical bid, financial bid, comparative statement, eligibility, award approval, LOA and work order.',
    'Verify agreement, contractor/agency identity, EMD, security/performance security and contract period.',
    'Verify drawings/specifications, quantities, rates, Measurement Book/e-MB, site inspections and completion records.',
    'Verify material/labor quality tests, laboratory certificates, sample registers and acceptance/rejection records.',
    'Verify running/final bills, vouchers, deductions, treasury/payment references and payment chronology.',
    'Verify complaints, inquiries, notices, audit observations, court proceedings and administrative outcomes.',
    'Convert every unresolved high-value research lead into a precise documentary or field verification task.',
    'Do not infer financial loss, collusion or misconduct without primary records and independent corroboration.'
  ];

  const baseReport = { investigationId, version: 1, title: 'Government Work Evidence Investigation Dossier', capture, location, department: department || '', photoPath, objectIdentification, tender, comparison, execution, evidence: evidenceItems, sources: allSources, modelReview, gaps, researchQueries: research.queries, deepResearch, timeline: buildTimeline({ tender }) };
  let ledger = buildLedger({ caseData: baseReport, deepResearch });
  ledger = enrichModelConsensus(ledger, modelReview);
  ledger = finalizeLedger(ledger);
  const ledgerPath = path.join(CASE_DIR, `${investigationId}.evidence-ledger.json`);
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
  baseReport.evidenceLedger = ledger;

  let graph = ensureGraph(null, baseReport);
  graph = ingestSources(graph, baseReport, allSources);
  const graphPath = saveGraph(investigationId, graph);
  baseReport.graph = { stats: graphStats(graph), path: graphPath };
  const pdfPath = await generateEvidencePDF(baseReport);
  const casePath = path.join(CASE_DIR, `${investigationId}.json`);
  baseReport.reports = { pdf: pdfPath, case: casePath, graph: graphPath, evidenceLedger: ledgerPath };
  safeCaseWrite(investigationId, baseReport);
  return { status: 'success', investigationId, version: 1, capture, location, objectIdentification, tender, comparison, execution, modelReview, sources: allSources, deepResearch, evidenceLedger: ledger, graph: { stats: graphStats(graph), path: graphPath }, gaps, researchQueries: research.queries, reports: baseReport.reports };
}

async function runComparativeInvestigation(investigationId) {
  const loaded = safeCaseRead(investigationId); const baseCase = loaded.data; const previousResearch = baseCase.comparativeResearch || null;
  const comparative = await runComparativeResearch(baseCase, previousResearch);
  let graph = loadGraph(investigationId) || ensureGraph(null, baseCase);
  graph = ingestSources(graph, baseCase, comparative.sources || []);
  graph = mergeGraph(graph, { nodes: [], edges: [], leads: comparative.findings?.patterns?.map((x, i) => ({ sourceId: `pattern-${i}`, score: 0.4, reason: typeof x === 'string' ? x : x?.pattern || x?.finding || 'model pattern' })) || [] });
  const graphPath = saveGraph(investigationId, graph);
  const history = Array.isArray(baseCase.comparativeHistory) ? baseCase.comparativeHistory.slice(-4) : [];
  if (previousResearch) history.push({ version: previousResearch.version, generatedAt: previousResearch.generatedAt, changeLog: previousResearch.changeLog, signals: previousResearch.signals });
  const updated = { ...baseCase, version: comparative.version, comparativeResearch: comparative, comparativeHistory: history, graph: { stats: graphStats(graph), path: graphPath }, reports: { ...(baseCase.reports || {}), comparativePdf: null, graph: graphPath } };
  const comparativePdf = await generateComparativePDF(comparative, updated);
  updated.reports.comparativePdf = comparativePdf;
  const casePath = safeCaseWrite(investigationId, updated);
  return { ...comparative, investigationId, graph: { stats: graphStats(graph), path: graphPath }, reports: { comparativePdf, case: casePath, graph: graphPath } };
}

async function runCrossCaseIntelligence(investigationId) {
  const loaded = safeCaseRead(investigationId); const globalGraph = buildCrossCaseGraph(CASE_DIR); const p = path.join(CASE_DIR, 'cross-case-graph.json'); fs.writeFileSync(p, JSON.stringify(globalGraph, null, 2));
  const caseNodeId = entity('CASE', loaded.data.investigationId || investigationId, loaded.data.title || loaded.data.investigationId || investigationId).id;
  const matches = (globalGraph.matches || []).filter(m => m.caseA === caseNodeId || m.caseB === caseNodeId);
  return { investigationId, matches, graph: globalGraph, path: p };
}

async function runFinalEvidencePlan(investigationId) {
  const loaded = safeCaseRead(investigationId); let caseData = loaded.data;
  if (!caseData.comparativeResearch) { await runComparativeInvestigation(investigationId); caseData = safeCaseRead(investigationId).data; }
  const result = await buildFinalEvidencePlan({ caseData, caseDir: CASE_DIR });
  const crossCasePath = path.join(CASE_DIR, 'cross-case-graph.json'); fs.writeFileSync(crossCasePath, JSON.stringify(result.globalGraph, null, 2));
  const updated = { ...caseData, timeline: buildTimeline(caseData), crossCase: { stats: result.globalGraph.stats, matches: result.matches }, rti: { totalRequests: result.rti.totalRequests, readinessScore: result.rti.readinessScore, path: result.files.json, pdf: result.files.pdf }, reports: { ...(caseData.reports || {}), rtiPdf: result.files.pdf, rtiJson: result.files.json, crossCaseGraph: crossCasePath } };
  let ledger = updated.evidenceLedger || buildLedger({ caseData: updated, deepResearch: updated.deepResearch });
  ledger = enrichModelConsensus(ledger, updated.modelReview);
  ledger = finalizeLedger(ledger);
  const ledgerPath = path.join(CASE_DIR, `${investigationId}.evidence-ledger.json`); fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
  updated.evidenceLedger = ledger;
  const masterPdf = await generateMasterReport(updated, ledger, result.rti);
  updated.reports.masterPdf = masterPdf;
  const casePath = safeCaseWrite(investigationId, updated);
  return { investigationId, crossCase: updated.crossCase, rti: result.rti, evidenceLedger: ledger, reports: { masterPdf, rtiPdf: result.files.pdf, rtiJson: result.files.json, crossCaseGraph: crossCasePath, evidenceLedger: ledgerPath, case: casePath } };
}

function loadCase(investigationId) { return safeCaseRead(investigationId).data; }
module.exports = { runInvestigation, runComparativeInvestigation, runCrossCaseIntelligence, runFinalEvidencePlan, loadCase, loadGraph, saveGraph, REPORT_DIR, CASE_DIR, graphStats };
