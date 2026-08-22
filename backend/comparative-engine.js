require('dotenv').config();

const { searchWeb } = require('./research-engine');
const { runParallelModels, consensus } = require('./ai-orchestrator');
const { source } = require('./investigation-schema');

const MAX_SOURCES_PER_QUERY = Number(process.env.COMPARATIVE_SOURCES_PER_QUERY || 8);

function compactCase(caseData) {
  const location = caseData.location || {};
  const object = caseData.objectIdentification || {};
  const tender = caseData.tender || {};
  return {
    title: caseData.title || 'Government work investigation',
    location: { village: location.village, town: location.town, district: location.district, state: location.state, display_name: location.display_name },
    object: object.status,
    objectCandidates: (object.candidates || []).slice(0, 8),
    tenderId: tender.tenderId || null,
    tenderStatus: tender.status || 'UNKNOWN',
    tenderFindings: (tender.modelFindings || []).slice(0, 8),
    comparison: (caseData.comparison || []).slice(0, 20),
    execution: caseData.execution || {},
    evidence: (caseData.evidence || []).slice(0, 20),
    sourceCount: (caseData.sources || []).length
  };
}

function placeTerms(caseData) {
  const l = caseData.location || {};
  return [l.village, l.town, l.district, l.state].filter(Boolean).join(' ');
}

function objectTerms(caseData) {
  const candidates = caseData.objectIdentification?.candidates || [];
  const text = candidates.map(x => { const r = x.result || x; return r.object || r.description || r.category || ''; }).filter(Boolean).join(' ');
  return [text, JSON.stringify(caseData.tender || {}), JSON.stringify(caseData.comparison || []).slice(0, 2500)].join(' ').replace(/\s+/g, ' ').slice(0, 3500);
}

function buildComparativeQueries(caseData) {
  const place = placeTerms(caseData);
  const object = objectTerms(caseData);
  const tenderId = caseData.tender?.tenderId || '';
  const department = caseData.department || caseData.location?.department || '';
  const anchor = [object, place, department].filter(Boolean).join(' ');
  return [
    { type: 'SIMILAR_WORKS', query: `${anchor} similar road work tender work order`, rationale: 'Find comparable government works with similar scope, location and procurement pattern.' },
    { type: 'COMPLAINT_HISTORY', query: `${anchor} complaint road quality contractor irregularity inquiry`, rationale: 'Find prior public complaints or inquiries involving similar work.' },
    { type: 'AUDIT_PATTERN', query: `${anchor} CAG audit road quality testing measurement book payment`, rationale: 'Find audit findings with the same control-failure pattern.' },
    { type: 'COURT_OR_TRIBUNAL', query: `${anchor} court case road tender contractor dispute quality`, rationale: 'Find judicial or quasi-judicial outcomes that illuminate consequences.' },
    { type: 'CONTRACTOR_HISTORY', query: `${place} ${object} contractor tender awarded blacklisted show cause notice`, rationale: 'Look for documented contractor-level history; do not infer identity from weak matches.' },
    { type: 'INSPECTION_FAILURES', query: `${place} ${object} inspection report measurement book completion certificate defect notice`, rationale: 'Find examples of execution-stage failures and official responses.' },
    { type: 'LOOPHOLE_PATTERNS', query: `${anchor} tender loophole eligibility relaxation repeat work splitting maintenance contract`, rationale: 'Identify procurement structures that could create control gaps; not proof of misuse.' },
    { type: 'OUTCOMES', query: `${anchor} rework reconstruction recovery penalty contractor notice result`, rationale: 'Find actual outcomes from comparable cases.' },
    ...(tenderId ? [{ type: 'EXACT_TENDER_REFERENCES', query: `"${tenderId}" complaint audit dispute contractor`, rationale: 'Check whether the exact tender ID appears in other public records.' }] : [])
  ];
}

function normalizeSource(result, queryMeta) {
  if (!result || !result.url) return null;
  let host = '';
  try { host = new URL(result.url).hostname; } catch (_) {}
  return { ...source(result.url, result.title || '', host, 'comparative-web', result.excerpt || result.content || ''), queryType: queryMeta.type, rationale: queryMeta.rationale };
}

function dedupeSources(rows) {
  const map = new Map();
  for (const row of rows.filter(Boolean)) {
    const key = row.url.replace(/#.*$/, '').trim();
    if (!map.has(key)) map.set(key, row);
    else {
      const old = map.get(key);
      old.queryTypes = [...new Set([old.queryType, ...(old.queryTypes || []), row.queryType].filter(Boolean))];
      if (!old.excerpt && row.excerpt) old.excerpt = row.excerpt;
    }
  }
  return [...map.values()];
}

async function searchComparativeGroup(queryMeta) {
  try {
    const results = await searchWeb(queryMeta.query, MAX_SOURCES_PER_QUERY);
    return results.map(x => normalizeSource(x, queryMeta)).filter(Boolean);
  } catch (error) {
    return [{ error: error.message, queryType: queryMeta.type, query: queryMeta.query }];
  }
}

function calculateLeadSignals(sources, queryGroups) {
  const officialHosts = /(^|\.)(gov\.in|nic\.in|cag\.gov\.in|eprocurement\.gov\.in)$/i;
  const stats = {
    totalSources: sources.length,
    officialSources: sources.filter(s => officialHosts.test(s.publisher || '')).length,
    complaintSources: sources.filter(s => s.queryTypes?.includes('COMPLAINT_HISTORY') || s.queryType === 'COMPLAINT_HISTORY').length,
    auditSources: sources.filter(s => s.queryTypes?.includes('AUDIT_PATTERN') || s.queryType === 'AUDIT_PATTERN').length,
    courtSources: sources.filter(s => s.queryTypes?.includes('COURT_OR_TRIBUNAL') || s.queryType === 'COURT_OR_TRIBUNAL').length,
    outcomeSources: sources.filter(s => s.queryTypes?.includes('OUTCOMES') || s.queryType === 'OUTCOMES').length,
    loopholeSources: sources.filter(s => s.queryTypes?.includes('LOOPHOLE_PATTERNS') || s.queryType === 'LOOPHOLE_PATTERNS').length,
    failedGroups: queryGroups.filter(g => g.every?.(x => x?.error)).length
  };
  stats.followupPriority = Math.min(100, 25 * stats.complaintSources + 20 * stats.auditSources + 15 * stats.courtSources + 10 * stats.loopholeSources);
  return stats;
}

function buildChangeLog(previous, current) {
  if (!previous) return { previousVersion: null, newVersion: current.version, newSourceIds: current.sources.map(s => s.id), removedSourceIds: [], note: 'First comparative pass.' };
  const oldIds = new Set((previous.sources || []).map(s => s.id));
  const newIds = new Set((current.sources || []).map(s => s.id));
  return {
    previousVersion: previous.version || null,
    newVersion: current.version,
    newSourceIds: [...newIds].filter(id => !oldIds.has(id)),
    removedSourceIds: [...oldIds].filter(id => !newIds.has(id)),
    previousSourceCount: (previous.sources || []).length,
    currentSourceCount: (current.sources || []).length,
    findingCounts: {
      previousPatterns: previous.findings?.patterns?.length || 0,
      currentPatterns: current.findings?.patterns?.length || 0,
      previousComplaints: previous.findings?.priorComplaints?.length || 0,
      currentComplaints: current.findings?.priorComplaints?.length || 0,
      previousOutcomes: previous.findings?.outcomes?.length || 0,
      currentOutcomes: current.findings?.outcomes?.length || 0,
      previousLoopholes: previous.findings?.loopholes?.length || 0,
      currentLoopholes: current.findings?.loopholes?.length || 0
    }
  };
}

async function runComparativeResearch(caseData, previousResearch = null) {
  const queries = buildComparativeQueries(caseData);
  const queryResults = await Promise.all(queries.map(searchComparativeGroup));
  const sources = dedupeSources(queryResults.flat());
  const signals = calculateLeadSignals(sources, queryResults);
  const nextVersion = Math.max(2, Number(previousResearch?.version || 1) + 1);
  const synthesisInput = {
    case: compactCase(caseData),
    previousComparativeResearch: previousResearch || null,
    queries,
    comparativeSources: sources.slice(0, 80).map(s => ({ id: s.id, title: s.title, publisher: s.publisher, url: s.url, excerpt: s.excerpt, queryType: s.queryType, queryTypes: s.queryTypes })),
    signalCounts: signals
  };
  const models = await runParallelModels('COMPARATIVE_INTELLIGENCE_AND_LOOPHOLE_ANALYSIS', synthesisInput, null);
  const agreement = consensus(models.results);
  const usable = models.results.filter(x => x.status === 'ok').map(x => x.result);
  const report = {
    version: nextVersion,
    generatedAt: new Date().toISOString(),
    queries,
    sources,
    signals,
    modelReview: { models, consensus: agreement },
    findings: {
      patterns: usable.flatMap(x => x.patterns || x.similarCases || x.recurringPatterns || []).slice(0, 40),
      priorComplaints: usable.flatMap(x => x.priorComplaints || x.complaints || []).slice(0, 40),
      outcomes: usable.flatMap(x => x.outcomes || x.priorOutcomes || []).slice(0, 40),
      loopholes: usable.flatMap(x => x.loopholes || x.controlGaps || x.riskPatterns || []).slice(0, 40),
      contradictions: usable.flatMap(x => x.contradictions || x.disagreements || []).slice(0, 30)
    },
    methodology: {
      rule: 'Comparable cases are leads, not proof that the current case has the same facts.',
      evidenceHierarchy: ['primary government record', 'court/audit record', 'official notice/report', 'reputable reporting', 'secondary commentary'],
      nextStep: 'Every high-risk pattern must be converted into a case-specific verification task.'
    }
  };
  report.changeLog = buildChangeLog(previousResearch, report);
  return report;
}

module.exports = { buildComparativeQueries, runComparativeResearch, compactCase, buildChangeLog };
