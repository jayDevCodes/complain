require('dotenv').config();
const crypto = require('crypto');
const { searchWeb } = require('./research-engine');
const { source } = require('./investigation-schema');

const MAX_ROUNDS = Number(process.env.DEEP_RESEARCH_ROUNDS || 4);
const MAX_RESULTS = Number(process.env.DEEP_RESEARCH_RESULTS_PER_QUERY || 8);
const MAX_QUERIES_PER_ROUND = Number(process.env.DEEP_RESEARCH_MAX_QUERIES_PER_ROUND || 24);
const FETCH_LIMIT = Number(process.env.DEEP_RESEARCH_FETCH_LIMIT || 120000);

const FIELD_LABELS = {
  tenderId: 'Tender ID', noticeNo: 'NIT/Notice Number', bidNo: 'Bid Number', workName: 'Work Name', object: 'Object', description: 'Description', department: 'Department', division: 'Division', district: 'District', estimatedCost: 'Estimated Cost', tenderValue: 'Tender Value', contractValue: 'Contract Value', bidValue: 'Bid Value', amount: 'Amount', contractor: 'Contractor', agency: 'Agency', awardedTo: 'Awarded To', workOrder: 'Work Order', agreement: 'Agreement', loa: 'Letter of Acceptance', nit: 'NIT', boq: 'BOQ', specification: 'Specification', period: 'Work Period', startDate: 'Start Date', endDate: 'End Date', completionDate: 'Completion Date', security: 'Security Deposit', emd: 'EMD', performance: 'Performance Security', payment: 'Payment', bill: 'Bill', measurement: 'Measurement Book', test: 'Test Report', inspection: 'Inspection Report', completion: 'Completion Certificate', complaint: 'Complaint', inquiry: 'Inquiry', audit: 'Audit', court: 'Court Case'
};

function sha(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function clean(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function flattenObject(value, prefix = '', out = [], depth = 0) {
  if (depth > 5 || out.length > 500) return out;
  if (value == null || value === '') return out;
  if (Array.isArray(value)) {
    value.slice(0, 40).forEach((x, i) => flattenObject(x, `${prefix}[${i}]`, out, depth + 1));
    return out;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) flattenObject(v, prefix ? `${prefix}.${k}` : k, out, depth + 1);
    return out;
  }
  const text = clean(value);
  if (text) out.push({ key: prefix, value: text });
  return out;
}

function tenderFacts(caseData) {
  const tender = caseData.tender || {};
  const roots = [
    ['tender', tender],
    ['location', caseData.location || {}],
    ['objectIdentification', caseData.objectIdentification || {}],
    ['comparison', caseData.comparison || []],
    ['execution', caseData.execution || {}],
    ['comparativeResearch', caseData.comparativeResearch || {}]
  ];
  const facts = roots.flatMap(([root, value]) => flattenObject(value, root));
  const seen = new Set();
  return facts.filter(f => {
    const key = `${f.key}|${f.value}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return f.value.length <= 600;
  });
}

function identifiers(facts) {
  const text = facts.map(x => x.value).join(' ');
  const patterns = [
    /\b\d{4}_[A-Z]{2,20}_\d+_\d+\b/g,
    /\b[A-Z]{2,15}[\-\/]\d{2,12}[\-\/]\d{1,12}\b/g,
    /\b(?:NIT|NIT\s*No|Tender\s*No|Bid\s*No|Work\s*Order|Agreement|LOA|MB|eMB|GEM)\s*[#:\-]?\s*[A-Z0-9\/_\-.]+/gi
  ];
  return [...new Set(patterns.flatMap(re => text.match(re) || []).map(clean))].slice(0, 80);
}

function importantFacts(facts) {
  const keywords = /tender|notice|nit|bid|work|contract|contractor|agency|award|agreement|loa|estimate|value|amount|boq|specification|measurement|payment|bill|inspection|completion|test|quality|emd|security|period|start|end|complaint|inquiry|audit|court|division|district/i;
  return facts.filter(f => keywords.test(f.key) || keywords.test(f.value)).slice(0, 160);
}

function queryVariants(facts, caseData) {
  const location = [caseData.location?.village, caseData.location?.town, caseData.location?.district, caseData.location?.state].filter(Boolean).join(' ');
  const ids = identifiers(facts);
  const useful = importantFacts(facts);
  const values = [...new Set(useful.map(f => f.value).filter(v => v.length >= 3 && v.length <= 180))].slice(0, 60);
  const queries = [];
  const add = (track, query, rationale) => { const q = clean(query); if (q.length >= 12) queries.push({ track, query: q, rationale }); };

  for (const id of ids.slice(0, 20)) {
    add('EXACT_IDENTIFIER', `"${id}"`, 'Exact tender/work/document identifier lookup.');
    add('EXACT_IDENTIFIER_CONTEXT', `"${id}" work order agreement contractor payment`, 'Trace the exact identifier into execution and payment records.');
    add('EXACT_IDENTIFIER_AUDIT', `"${id}" audit complaint inquiry court`, 'Trace the exact identifier into complaints, audits and proceedings.');
  }

  const tenderId = caseData.tender?.tenderId || ids.find(x => /_\d+_\d+$/.test(x)) || '';
  const work = caseData.tender?.workName || caseData.objectIdentification?.candidates?.map(x => x.result?.object || x.result?.description || x.result?.category).filter(Boolean).slice(0, 3).join(' ') || '';
  const contractor = caseData.tender?.contractor || caseData.tender?.awardedTo || '';
  const department = caseData.department || caseData.tender?.department || '';
  const anchor = [work, location, department].filter(Boolean).join(' ');

  add('TENDER_NOTICE', `${anchor} tender notice NIT BOQ estimate`, 'Find the tender notice and bidding documents.');
  add('WORK_ORDER', `${anchor} work order agreement LOA`, 'Trace award and contract execution documents.');
  add('BID_EVALUATION', `${anchor} technical bid financial bid comparative statement`, 'Find bid evaluation and selection trail.');
  add('COST_ESTIMATE', `${anchor} estimate sanctioned amount BOQ rates`, 'Establish sanctioned estimate and pricing basis.');
  add('CONTRACTOR', `${anchor} contractor awarded agency work order`, 'Verify the executing entity from official records.');
  add('SECURITY_EMD', `${anchor} EMD security deposit performance security`, 'Trace bid/contract security records.');
  add('TECHNICAL', `${anchor} technical specification drawing design quality standard`, 'Establish measurable technical requirements.');
  add('MEASUREMENT', `${anchor} Measurement Book MB e-MB measurement entries`, 'Find execution measurement records.');
  add('INSPECTION', `${anchor} inspection site inspection completion certificate`, 'Find inspection and completion records.');
  add('QUALITY', `${anchor} laboratory test material test quality control`, 'Find quality tests and acceptance records.');
  add('PAYMENT', `${anchor} running bill final bill payment voucher treasury`, 'Trace payment and billing trail.');
  add('COMPLAINT', `${anchor} complaint representation inquiry action taken notice`, 'Find complaints and administrative action.');
  add('AUDIT', `${anchor} audit CAG inspection irregularity recovery`, 'Find independent audit/control findings.');
  add('COURT', `${anchor} court case writ petition dispute`, 'Find judicial proceedings or orders.');
  add('REWORK', `${anchor} repair rework reconstruction penalty recovery`, 'Trace outcomes and corrective action.');
  add('CONTRACTOR_HISTORY', `${location} ${contractor} blacklisted show cause penalty`, 'Check documented contractor history without assuming identity.');

  for (const v of values.slice(0, 20)) {
    add('FIELD_ANCHOR', `"${v}" ${location}`, `Target a concrete tender field/value found in the case.`);
  }

  if (tenderId) {
    add('TENDER_ID_ALL_RECORDS', `"${tenderId}" tender work order BOQ agreement bill payment inspection`, 'Use the exact tender ID across the complete lifecycle.');
  }
  return [...new Map(queries.map(q => [`${q.track}|${q.query.toLowerCase()}`, q])).values()].slice(0, MAX_QUERIES_PER_ROUND);
}

function sourceQuality(url, publisher = '') {
  const host = String(publisher || url || '').toLowerCase();
  if (/cag\.gov\.in$|supremecourt\.gov\.in$|hc[a-z-]*\.nic\.in$|eprocurement\.gov\.in$|gov\.in$|nic\.in$/.test(host)) return 1;
  if (/gov\.|\.gov\./.test(host)) return 0.95;
  if (/reuters|thehindu|indianexpress|timesofindia|hindustantimes|ndtv|pti/.test(host)) return 0.75;
  return 0.45;
}

async function verifySource(row) {
  const base = { ...row, sourceQuality: sourceQuality(row.url, row.publisher) };
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(process.env.DEEP_RESEARCH_FETCH_TIMEOUT_MS || 10000));
    const response = await fetch(row.url, { redirect: 'follow', signal: controller.signal, headers: { 'User-Agent': 'GovernmentWorkInvestigationAI/7.0 DeepResearchBot' } });
    clearTimeout(timeout);
    const contentType = response.headers.get('content-type') || '';
    const buffer = await response.arrayBuffer();
    const bytes = Buffer.from(buffer).subarray(0, FETCH_LIMIT);
    const text = contentType.includes('text/html') || contentType.includes('text/plain') || contentType.includes('json') ? bytes.toString('utf8') : '';
    const cleanText = text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 18000);
    return { ...base, verified: response.ok, httpStatus: response.status, finalUrl: response.url, contentType, contentBytes: buffer.byteLength, contentSha256: sha(buffer), fetchedExcerpt: cleanText.slice(0, 5000), fetchedAt: new Date().toISOString() };
  } catch (error) {
    return { ...base, verified: false, verificationError: error.message, fetchedAt: new Date().toISOString() };
  }
}

async function runSearchRound(queries, existingIds = new Set()) {
  const rows = [];
  const groups = await Promise.all(queries.map(async meta => {
    try {
      const results = await searchWeb(meta.query, MAX_RESULTS);
      return results.map(r => ({ ...r, query: meta.query, track: meta.track, rationale: meta.rationale }));
    } catch (error) {
      return [{ error: error.message, query: meta.query, track: meta.track }];
    }
  }));
  for (const row of groups.flat()) {
    if (!row?.url || existingIds.has(row.id)) continue;
    existingIds.add(row.id);
    rows.push(row);
  }
  return rows;
}

function deriveFollowups(verifiedSources, caseData, round) {
  const out = [];
  for (const s of verifiedSources.slice(0, 40)) {
    const text = clean([s.title, s.fetchedExcerpt, s.excerpt].filter(Boolean).join(' '));
    const foundIds = identifiers([{ value: text }]);
    for (const id of foundIds.slice(0, 5)) out.push({ track: 'DISCOVERED_IDENTIFIER', query: `"${id}"`, rationale: `Identifier discovered from round ${round} source ${s.id}.` });
    if (/work order|agreement|letter of acceptance|award/i.test(text)) out.push({ track: 'DISCOVERED_AWARD_TRAIL', query: `${JSON.stringify(text.slice(0, 300))} contractor work order agreement`, rationale: 'Expand from an award/execution record.' });
    if (/bill|payment|voucher|treasury/i.test(text)) out.push({ track: 'DISCOVERED_PAYMENT_TRAIL', query: `${caseData.location?.district || ''} ${caseData.department || ''} bill payment voucher treasury`, rationale: 'Expand from a discovered payment reference.' });
    if (/complaint|inquiry|enquiry|notice|show cause|audit|court/i.test(text)) out.push({ track: 'DISCOVERED_PROCEEDING', query: `${caseData.location?.district || ''} ${caseData.department || ''} complaint inquiry audit court notice`, rationale: 'Expand from a discovered proceeding reference.' });
  }
  return [...new Map(out.map(x => [x.track + '|' + x.query.toLowerCase(), x])).values()].slice(0, MAX_QUERIES_PER_ROUND);
}

function contradictionQueries(caseData, facts) {
  const anchor = [caseData.tender?.workName, caseData.location?.district, caseData.department].filter(Boolean).join(' ');
  const out = [
    ['CONTRADICTION', `${anchor} completion certificate passed inspection despite complaint`, 'Search evidence that may disprove a suspected issue.'],
    ['CONTRADICTION', `${anchor} quality test passed accepted work`, 'Search contrary technical evidence.'],
    ['CONTRADICTION', `${anchor} payment made after final measurement completion`, 'Search chronological/payment corroboration.'],
    ['CONTRADICTION', `${anchor} complaint closed no irregularity action taken`, 'Search contrary administrative outcome.']
  ];
  for (const id of identifiers(facts).slice(0, 8)) out.push(['CONTRADICTION_EXACT', `"${id}" correction completion acceptance reply`, 'Search exact identifier for disconfirming documents.']);
  return out.map(([track, query, rationale]) => ({ track, query, rationale }));
}

async function runDeepResearch(caseData) {
  const startedAt = new Date().toISOString();
  const facts = tenderFacts(caseData);
  const ids = identifiers(facts);
  const research = { version: 1, startedAt, rounds: [], sources: [], facts, identifiers: ids, stoppingReason: null };
  const seen = new Set();
  let queries = queryVariants(facts, caseData);

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const candidates = await runSearchRound(queries, seen);
    const verified = await Promise.all(candidates.map(verifySource));
    const highValue = verified.filter(s => s.verified && s.sourceQuality >= 0.7);
    research.sources.push(...verified);
    research.rounds.push({ round, queries, candidateCount: candidates.length, verifiedCount: verified.filter(x => x.verified).length, highValueCount: highValue.length, generatedAt: new Date().toISOString() });
    const followups = deriveFollowups(highValue, caseData, round);
    queries = followups;
    if (!queries.length) { research.stoppingReason = 'No new high-value follow-up identifiers or research tracks were discovered.'; break; }
    if (round === MAX_ROUNDS) research.stoppingReason = 'Configured deep-research round limit reached.';
  }

  const contradiction = contradictionQueries(caseData, facts);
  const contradictionCandidates = await runSearchRound(contradiction, seen);
  const contradictionSources = await Promise.all(contradictionCandidates.map(verifySource));
  research.sources.push(...contradictionSources);
  research.rounds.push({ round: 'contradiction', queries: contradiction, candidateCount: contradictionCandidates.length, verifiedCount: contradictionSources.filter(x => x.verified).length, generatedAt: new Date().toISOString() });

  research.sources = [...new Map(research.sources.map(s => [s.url, s])).values()].sort((a, b) => (b.sourceQuality || 0) - (a.sourceQuality || 0));
  research.completedAt = new Date().toISOString();
  research.researchHash = sha(JSON.stringify({ facts, sources: research.sources.map(s => ({ url: s.url, contentSha256: s.contentSha256 })) }));
  return research;
}

module.exports = { runDeepResearch, tenderFacts, identifiers, queryVariants, verifySource, contradictionQueries };
