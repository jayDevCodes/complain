const crypto = require('crypto');
const { runInvestigation, runComparativeInvestigation, runCrossCaseIntelligence, runFinalEvidencePlan, loadCase } = require('./agents');

const JOBS = new Map();
const JOB_TTL_MS = Number(process.env.INVESTIGATION_JOB_TTL_MS || 6 * 60 * 60 * 1000);

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

function cleanupJobs() {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of JOBS) if (new Date(job.updatedAt || job.createdAt).getTime() < cutoff) JOBS.delete(id);
}

function startFullInvestigationJob(input) {
  cleanupJobs();
  const jobId = crypto.randomUUID();
  const job = { jobId, status: 'running', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), stages: [], investigationId: null, result: null, error: null };
  JOBS.set(jobId, job);
  setImmediate(async () => {
    try {
      const result = await runFullInvestigation(input, stage => { job.stages = [...job.stages, stage]; job.updatedAt = new Date().toISOString(); if (stage.status === 'running' && stage.name) job.currentStage = stage.name; });
      job.status = 'success'; job.result = result; job.investigationId = result.investigationId; job.updatedAt = new Date().toISOString();
    } catch (error) {
      job.status = 'error'; job.error = error.message || String(error); job.investigationId = error.investigationId || job.investigationId; job.updatedAt = new Date().toISOString();
    }
  });
  return { jobId, status: job.status, createdAt: job.createdAt };
}

function getFullInvestigationJob(jobId) {
  cleanupJobs();
  return JOBS.get(jobId) || null;
}

module.exports = { runFullInvestigation, startFullInvestigationJob, getFullInvestigationJob };