const fs = require('fs');
const path = require('path');
const { buildCrossCaseGraph } = require('./cross-case-graph');
const { buildRTIDrafts } = require('./rti-engine');
const { generateRTIPDFBundle } = require('./rti-pdf-report');
const { entity } = require('./evidence-graph');
const { runParallelModels, consensus } = require('./ai-orchestrator');

function loadCaseGraph(caseData, caseDir) {
  const id = caseData.investigationId;
  const file = path.join(caseDir, `${path.basename(id)}.graph.json`);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

async function buildFinalEvidencePlan({ caseData, caseDir }) {
  const globalGraph = buildCrossCaseGraph(caseDir);
  const caseNodeId = entity('CASE', caseData.investigationId || caseData.title || 'case', caseData.title || caseData.investigationId || 'Investigation Case').id;
  const matches = (globalGraph.matches || []).filter(m => m.caseA === caseNodeId || m.caseB === caseNodeId);
  const caseGraph = loadCaseGraph(caseData, caseDir);

  const modelReview = await runParallelModels('FINAL_EVIDENCE_GAP_AND_RTI_REVIEW', {
    case: caseData,
    caseGraph,
    crossCaseMatches: matches,
    globalGraphStats: globalGraph.stats,
    comparativeResearch: caseData.comparativeResearch || null,
    instruction: 'Identify only missing records and verifiable evidence needs. Do not invent PIO names, findings, financial loss, wrongdoing or legal conclusions. Recommend record categories and public-authority roles.'
  }, null);

  const rti = buildRTIDrafts(caseData, caseGraph);
  rti.modelReview = { models: modelReview, consensus: consensus(modelReview.results) };
  rti.crossCaseMatches = matches;
  rti.graphStats = globalGraph.stats;

  const outputDir = path.join(caseDir, 'completion');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, `rti-drafts-${caseData.investigationId}-v${caseData.version || 1}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(rti, null, 2));
  const pdfPath = await generateRTIPDFBundle(caseData, rti);

  return { globalGraph, matches, rti, files: { json: jsonPath, pdf: pdfPath } };
}

module.exports = { buildFinalEvidencePlan, loadCaseGraph };