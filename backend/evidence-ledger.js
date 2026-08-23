const crypto = require('crypto');

const STATUSES = ['OBSERVED', 'DOCUMENTED', 'VERIFIED', 'INFERRED', 'ALLEGED', 'UNKNOWN', 'CONTRADICTED', 'NEEDS_PRIMARY_RECORD'];

function id(value) { return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16); }
function normalize(text = '') { return String(text).toLowerCase().replace(/[^a-z0-9\u0900-\u097f]+/gi, ' ').replace(/\s+/g, ' ').trim(); }
function sourceTier(source = {}) {
  const host = String(source.publisher || source.url || '').toLowerCase();
  if (/cag\.gov\.in$|supremecourt\.gov\.in$|eprocurement\.gov\.in$|gov\.in$|nic\.in$/.test(host)) return 'PRIMARY_OFFICIAL';
  if (/gov\.|\.gov\./.test(host)) return 'OFFICIAL';
  if (/reuters|thehindu|indianexpress|pti|timesofindia|hindustantimes|ndtv/.test(host)) return 'REPUTABLE_SECONDARY';
  return 'SECONDARY';
}

function extractClaims(result, provider) {
  if (!result) return [];
  const candidates = result.claims || result.findings || result.defects || result.comparison || result.patterns || [];
  return (Array.isArray(candidates) ? candidates : [candidates]).map(x => {
    if (typeof x === 'string') return { claim: x, provider };
    return { claim: x.claim || x.finding || x.defect || x.pattern || JSON.stringify(x), status: x.status, refs: x.refs || x.evidence || [], provider };
  }).filter(x => x.claim && x.claim !== '{}');
}

function buildLedger({ caseData, deepResearch = null }) {
  const sources = [...(caseData.sources || []), ...(deepResearch?.sources || [])];
  const sourceMap = new Map(sources.filter(s => s?.url).map(s => [s.url, s]));
  const claims = [];
  const add = (claim, status, refs = [], note = '', confidence = 0, category = 'general') => {
    if (!claim) return;
    const refsClean = [...new Set(refs.filter(Boolean))];
    const key = normalize(claim);
    const existing = claims.find(x => x.normalized === key);
    if (existing) {
      existing.refs = [...new Set([...existing.refs, ...refsClean])];
      existing.confidence = Math.max(existing.confidence, confidence);
      if (existing.status !== 'VERIFIED' && status === 'VERIFIED') existing.status = status;
      return;
    }
    claims.push({ id: id(`${category}|${claim}`), claim, normalized: key, status: STATUSES.includes(status) ? status : 'UNKNOWN', refs: refsClean, note, confidence, category });
  };

  const c = caseData.capture || {};
  add(`Field photo was captured at ${c.timestamp || 'unknown time'}.`, c.photoCaptured ? 'OBSERVED' : 'UNKNOWN', [], 'Device capture metadata.', 1, 'field');
  add(`GPS coordinates are ${c.latitude ?? 'unknown'}, ${c.longitude ?? 'unknown'}.`, Number.isFinite(c.latitude) && Number.isFinite(c.longitude) ? 'OBSERVED' : 'UNKNOWN', [], 'Device supplied coordinates.', 1, 'field');
  if (caseData.location?.display_name) add(`Reverse-geocoded location: ${caseData.location.display_name}.`, 'DOCUMENTED', [], 'Reverse geocoding identifies a place label; it does not establish land ownership.', 0.9, 'location');
  const tender = caseData.tender || {};
  for (const [k, label] of Object.entries({ tenderId: 'Tender ID', workName: 'Work name', contractor: 'Contractor', awardedTo: 'Awarded agency', estimate: 'Estimate', estimatedCost: 'Estimated cost', contractValue: 'Contract value', workOrder: 'Work order', agreement: 'Agreement', loa: 'Letter of Acceptance', boq: 'BOQ', specification: 'Specification', startDate: 'Start date', endDate: 'End date' })) {
    if (tender[k]) add(`${label}: ${tender[k]}`, k === 'tenderId' && !caseData.deepResearch?.sources?.length ? 'NEEDS_PRIMARY_RECORD' : 'DOCUMENTED', [], 'Tender field currently supplied by case synthesis; verify against the original tender/contract record.', 0.55, 'tender');
  }
  for (const e of caseData.evidence || []) add(e.item, e.kind, e.refs, e.note, e.confidence, 'case-evidence');
  for (const p of caseData.comparison || []) add(`${p.item || 'Specification comparison'} — expected: ${p.expected || 'unknown'}; observed: ${p.observed || 'unknown'}; gap: ${p.gap || 'unknown'}`, p.refs?.length ? 'DOCUMENTED' : 'NEEDS_PRIMARY_RECORD', p.refs || [], 'Technical comparison requires primary specification/measurement evidence.', p.refs?.length ? 0.7 : 0.35, 'technical');

  for (const s of sources.filter(x => x?.url)) {
    const quality = sourceTier(s);
    if (s.verified && quality === 'PRIMARY_OFFICIAL') add(`Official source: ${s.title || s.url}`, 'DOCUMENTED', [s.id], `Retrieved ${s.retrievedAt || s.fetchedAt || 'unknown'}; source verified by HTTP retrieval.`, Math.max(0.75, Number(s.sourceQuality || 0)), 'source');
    else add(`Research lead: ${s.title || s.url}`, s.verified ? 'DOCUMENTED' : 'UNKNOWN', [s.id], s.verificationError || 'Search result/source lead; underlying record should be inspected.', s.verified ? Number(s.sourceQuality || 0.55) : 0.25, 'research');
  }
  return { generatedAt: new Date().toISOString(), claims, sources: sources.map(s => ({ id: s.id, url: s.url, title: s.title, publisher: s.publisher, tier: sourceTier(s), verified: Boolean(s.verified), contentSha256: s.contentSha256 || null })), stats: {}, version: 1 };
}

function enrichModelConsensus(ledger, modelReview = {}) {
  const modelResults = [
    ...(modelReview.vision?.results || []),
    ...(modelReview.synthesis?.results || []),
    ...(modelReview.synthesisConsensus?.claims || []).map(x => ({ provider: 'consensus', result: x }))
  ];
  for (const r of modelResults.filter(x => x.status === 'ok')) {
    for (const c of extractClaims(r.result, r.provider)) {
      const key = normalize(c.claim);
      const match = ledger.claims.find(x => x.normalized === key || key.includes(x.normalized) || x.normalized.includes(key));
      if (match) { match.modelSupport = [...new Set([...(match.modelSupport || []), r.provider])]; match.confidence = Math.max(match.confidence, 0.35 + 0.12 * match.modelSupport.length); }
    }
  }
  return ledger;
}

function finalizeLedger(ledger) {
  const verifiedClaims = ledger.claims.filter(c => c.status === 'VERIFIED').length;
  const documentedClaims = ledger.claims.filter(c => c.status === 'DOCUMENTED').length;
  const primarySources = ledger.sources.filter(s => s.tier === 'PRIMARY_OFFICIAL' && s.verified).length;
  const contradictions = ledger.claims.filter(c => c.status === 'CONTRADICTED').length;
  const unresolved = ledger.claims.filter(c => c.status === 'UNKNOWN' || c.status === 'NEEDS_PRIMARY_RECORD').length;
  const byCategory = {};
  for (const c of ledger.claims) byCategory[c.category] = (byCategory[c.category] || 0) + 1;
  const weights = { identity: 10, tender: 20, technical: 15, field: 10, source: 10, research: 10, location: 5, general: 5, 'case-evidence': 15 };
  let coverage = 0;
  for (const [cat, weight] of Object.entries(weights)) {
    const subset = ledger.claims.filter(c => c.category === cat);
    if (!subset.length) continue;
    const good = subset.filter(c => c.status === 'VERIFIED' || c.status === 'DOCUMENTED').length / subset.length;
    coverage += weight * good;
  }
  ledger.stats = { totalClaims: ledger.claims.length, verifiedClaims, documentedClaims, unresolvedClaims: unresolved, contradictions, verifiedPrimarySources: primarySources, byCategory, readinessScore: Math.max(0, Math.min(100, Math.round(coverage))) };
  ledger.claims = ledger.claims.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  ledger.updatedAt = new Date().toISOString();
  return ledger;
}

module.exports = { buildLedger, enrichModelConsensus, finalizeLedger, sourceTier, STATUSES };
