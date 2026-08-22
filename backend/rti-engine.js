const crypto = require('crypto');

const RAJASTHAN_PROFILE = {
  state: 'Rajasthan',
  applicationFee: 10,
  copyFeePerPage: 2,
  inspection: 'First hour: no fee; thereafter Rs 5 per 15 minutes or fraction, subject to the applicable rules.',
  officialReference: 'Rajasthan Right to Information Rules, 2005',
  verificationNote: 'Confirm the current SPIO/FAA name, address, portal and fee/payment method before submission.'
};

const AUTHORITY_PROFILES = [
  { key: 'PWD_ENGINEERING', label: 'PWD / Engineering Division', role: 'State Public Information Officer, concerned PWD division', aliases: ['pwd','engineering','road','division'], covers: ['measurement','inspection','completion','technical sanction','estimate','boq','quality','material','work order'] },
  { key: 'PROCUREMENT_TENDER', label: 'Procurement / Tender Authority', role: 'State Public Information Officer, tender/procurement cell of the concerned public authority', aliases: ['procurement','tender','eprocurement','bid'], covers: ['tender','bid','comparative statement','technical bid','financial bid','contract','agreement','corrigendum','work order','contractor selection'] },
  { key: 'ACCOUNTS_FINANCE', label: 'Accounts / Finance / Payment Records', role: 'State Public Information Officer, accounts/finance section of the concerned public authority', aliases: ['finance','accounts','treasury','payment'], covers: ['bill','payment','running account bill','final bill','voucher','treasury','sanctioned amount','security deposit','earnest money','deduction'] },
  { key: 'QUALITY_LAB', label: 'Quality Control / Laboratory', role: 'State Public Information Officer, quality-control/laboratory authority maintaining the relevant records', aliases: ['quality','lab','laboratory','test'], covers: ['material test','test report','core test','density','bitumen','concrete','sample','quality certificate','laboratory'] },
  { key: 'DISTRICT_ADMIN', label: 'District Administration / Inquiry Authority', role: 'State Public Information Officer, concerned district administration / inquiry cell', aliases: ['collector','district','inquiry','complaint'], covers: ['complaint','inquiry','enquiry','notice','action taken','inspection report','committee','report','representation'] },
  { key: 'LOCAL_BODY', label: 'Local Body / Panchayat / Municipal Authority', role: 'State Public Information Officer, concerned local body / Panchayat office', aliases: ['panchayat','municipal','local body','ward'], covers: ['resolution','local proposal','site record','land/road register','meeting minutes','complaint','local estimate'] }
];

function id(text) { return crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 12); }
function textOf(value) { return String(value || '').toLowerCase(); }

function normalizeGap(gap) {
  if (typeof gap === 'string') return gap;
  return gap?.item || gap?.gap || gap?.finding || JSON.stringify(gap || {});
}

function collectInformationGaps(caseData) {
  const gaps = [];
  for (const x of caseData.gaps || []) gaps.push({ text: normalizeGap(x), source: 'case-gap', priority: 0.9 });
  for (const x of caseData.comparison || []) {
    if (!x?.refs?.length || /unknown|not established|requires|documentary/i.test(String(x.gap || ''))) {
      gaps.push({ text: `Specification/field comparison gap: ${x.item || 'unresolved comparison'}. Expected: ${x.expected || 'unknown'}. Observed: ${x.observed || 'unknown'}.`, source: 'comparison', priority: 0.88 });
    }
  }
  const tender = caseData.tender || {};
  if (!tender.tenderId || /NOT_ESTABLISHED|NEEDS_DOCUMENT/i.test(tender.status || '')) gaps.push({ text: 'Exact tender notice, tender ID and award trail are not fully established from primary records.', source: 'tender', priority: 1 });
  if (!caseData.execution || /REQUIRED|NOT_FOUND|UNKNOWN/i.test(JSON.stringify(caseData.execution))) gaps.push({ text: 'Execution records require verification: measurement, inspection and completion records.', source: 'execution', priority: 0.95 });
  if (!(caseData.comparativeResearch?.findings?.priorComplaints || []).length) gaps.push({ text: 'No sufficiently verified prior-complaint outcome is linked to this case yet; search and documentary confirmation may still be required.', source: 'comparative', priority: 0.55 });
  return gaps.filter((x, i, arr) => arr.findIndex(y => y.text === x.text) === i);
}

function classifyAuthority(gapText) {
  const lower = textOf(gapText);
  let best = AUTHORITY_PROFILES[0]; let bestScore = 0;
  for (const profile of AUTHORITY_PROFILES) {
    const terms = [...profile.aliases, ...profile.covers];
    const score = terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0);
    if (score > bestScore) { best = profile; bestScore = score; }
  }
  return { profile: best, score: bestScore };
}

function recordRequest(gap, authority, caseData) {
  const location = caseData.location?.display_name || [caseData.location?.village, caseData.location?.district, caseData.location?.state].filter(Boolean).join(', ');
  const tenderId = caseData.tender?.tenderId || '[if available]';
  const time = caseData.capture?.timestamp ? `around ${new Date(caseData.capture.timestamp).toISOString().slice(0,10)}` : 'the period relevant to the work';
  const common = `Please provide certified copies/records relating to ${location || 'the investigated government work'} (${tenderId}), for ${time}, including the portions/entries specifically described below.`;
  const lower = textOf(gap.text);
  let detail = `the complete record that addresses this evidence gap: ${gap.text}`;
  if (/tender|bid|procurement|award|contract|work order|agreement/i.test(lower)) detail = 'tender notice/NIT, bid document, corrigenda, bidder list, technical evaluation, financial bid/BOQ, comparative statement, approval/note sheet, letter of acceptance, work order and agreement, as applicable.';
  else if (/measurement|inspection|completion|technical sanction|estimate|boq/i.test(lower)) detail = 'administrative/technical sanction, detailed estimate, BOQ, Measurement Book/e-MB entries, site inspection reports, completion certificate, defect-liability records and relevant photographs maintained by the authority.';
  else if (/bill|payment|voucher|treasury|finance|sanctioned amount/i.test(lower)) detail = 'sanctioned amount, running/final bills, vouchers, payment advice, treasury/payment references, deductions, security deposit/retention and date-wise payment records.';
  else if (/quality|test|laboratory|sample|density|bitumen|concrete/i.test(lower)) detail = 'material/sample test reports, laboratory registers, test dates, sample identification, test results, acceptance/rejection records and correspondence relating to any failed or repeat tests.';
  else if (/complaint|inquiry|enquiry|notice|action taken|committee|report/i.test(lower)) detail = 'complaint/representation received, diary/receipt entry, forwarding letter, inquiry order, committee constitution, inspection note, inquiry report, action-taken note, show-cause notice and final disposal/order, as applicable.';
  else if (/panchayat|local|resolution|meeting|road register/i.test(lower)) detail = 'resolution/proposal, meeting minutes, local register entries, site/asset register, correspondence and records showing the origin, approval and execution status of the work.';
  return {
    id: id(`${authority.profile.key}|${gap.text}`),
    authorityKey: authority.profile.key,
    authorityLabel: authority.profile.label,
    addressee: `${authority.profile.role} (current designation/name/address to be verified before filing)`,
    subject: `Request for records concerning government work investigation – ${location || '[location]'}`,
    body: `${common}\n\nInformation/records requested:\n1. ${detail}\n2. Please identify the record/file number(s), date(s), issuing/recording authority and section where each record is maintained, where reflected in the records.\n3. Where the requested record is available electronically, please provide a copy in electronic form; otherwise provide certified copies.\n4. Where the record is maintained in a bundle/file, please permit inspection of the relevant record and allow copies/extracts of the identified pages/entries.\n5. If any part of the requested information is not held by this public authority, please indicate the actual custodian/public authority to the extent reflected in the records and deal with the request in accordance with the applicable RTI procedure.`,
    evidenceGap: gap.text,
    priority: gap.priority,
    sourceBasis: gap.source
  };
}

function buildRTIDrafts(caseData, graph = null) {
  const gaps = collectInformationGaps(caseData);
  if (graph?.leads?.length) {
    for (const lead of graph.leads.slice(0, 12)) gaps.push({ text: `Graph lead requiring documentary confirmation: ${lead.reason || 'relevant source match'} (score ${Number(lead.score || 0).toFixed(2)}).`, source: 'graph-lead', priority: Number(lead.score || 0.5) });
  }
  const grouped = new Map();
  for (const gap of gaps) {
    const authority = classifyAuthority(gap.text);
    if (!grouped.has(authority.profile.key)) grouped.set(authority.profile.key, { profile: authority.profile, requests: [] });
    grouped.get(authority.profile.key).requests.push(recordRequest(gap, authority, caseData));
  }
  const drafts = [...grouped.values()].map(group => ({
    authority: group.profile,
    drafts: group.requests,
    applicationProfile: RAJASTHAN_PROFILE,
    submissionChecklist: [
      'Verify the exact public authority and current SPIO/PIO address before filing.',
      'Keep the requested period narrow and tied to the work/case evidence.',
      'Prefer record-based questions and certified copies/inspection requests.',
      'Attach only necessary identifying context; avoid unsupported allegations.',
      'Save proof of submission, acknowledgement and any fee payment.',
      'Update the case graph with every reply, transferred request, rejection, inspection and disclosed record.'
    ]
  }));
  return { generatedAt: new Date().toISOString(), jurisdictionProfile: RAJASTHAN_PROFILE, gaps, drafts, totalRequests: drafts.reduce((n, x) => n + x.drafts.length, 0), readinessScore: Math.max(0, Math.round(100 - gaps.length * 7)) };
}

module.exports = { buildRTIDrafts, collectInformationGaps, classifyAuthority, AUTHORITY_PROFILES, RAJASTHAN_PROFILE };