const { runInvestigation, runComparativeInvestigation, runCrossCaseIntelligence, runFinalEvidencePlan, loadCase } = require('./agents');

async function runFullInvestigation(input, onStage = () => {}) {
  const stages = [];
  let investigationId = null;
  const execute = async (name, fn) => {
    const startedAt = new Date().toISOString();
    onStage({ name, status: 'running', startedAt });
    try {
      const result = await fn();
      if (result?.investigationId) investigationId = result.investigationId;
      const stage = { name, status: 'success', startedAt, finishedAt: new Date().toISOString() };
      stages.push(stage); onStage(stage); return result;
    } catch (error) {
      if (investigationId && !error.investigationId) error.investigationId = investigationId;
      const stage = { name, status: 'error', startedAt, finishedAt: new Date().toISOString(), error: error.message || String(error) };
      stages.push(stage); onStage(stage); throw error;
    }
  };
  const base = await execute('base-investigation', () => runInvestigation(input));
  investigationId = base.investigationId;
  const comparative = await execute('comparative-research', () => runComparativeInvestigation(investigationId));
  const crossCase = await execute('cross-case-intelligence', () => runCrossCaseIntelligence(investigationId));
  const finalEvidence = await execute('evidence-completion-rti', () => runFinalEvidencePlan(investigationId));
  const finalCase = loadCase(investigationId);
  return {
    status: 'success', investigationId, stages,
    capture: base.capture, location: base.location, objectIdentification: base.objectIdentification, tender: finalCase.tender || base.tender,
    deepResearch: { rounds: finalCase.deepResearch?.rounds || [], sources: finalCase.deepResearch?.sources || [], stoppingReason: finalCase.deepResearch?.stoppingReason || null, researchHash: finalCase.deepResearch?.researchHash || null },
    graph: finalCase.graph || base.graph,
    comparative: { version: comparative.version, signals: comparative.signals, findings: comparative.findings, sources: comparative.sources, report: comparative.reports?.comparativePdf },
    crossCase: { stats: crossCase.graph.stats, matches: crossCase.matches, report: crossCase.path },
    rti: finalEvidence.rti,
    evidenceLedger: finalCase.evidenceLedger || finalEvidence.evidenceLedger || null,
    reports: finalCase.reports || {},
    case: { version: finalCase.version, gaps: finalCase.gaps || [], reportCount: Object.values(finalCase.reports || {}).filter(Boolean).length }
  };
}
module.exports = { runFullInvestigation };