const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const REPORT_DIR = path.join(__dirname, 'reports');
if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

function header(doc, title, subtitle) {
  doc.rect(0, 0, doc.page.width, 96).fill('#020617');
  doc.fillColor('#fff').fontSize(20).font('Helvetica-Bold').text(title, 44, 23, { width: 510 });
  doc.fillColor('#94a3b8').fontSize(8.5).font('Helvetica').text(subtitle || '', 44, 64, { width: 510 });
  doc.fillColor('#0f172a').y = 116;
}
function section(doc, title, subtitle = '') {
  if (doc.y > 700) doc.addPage();
  doc.fillColor('#0f172a').fontSize(14).font('Helvetica-Bold').text(title);
  if (subtitle) doc.fillColor('#64748b').fontSize(8).font('Helvetica').text(subtitle);
  doc.moveDown(0.45).fillColor('#334155').fontSize(9).font('Helvetica');
}
function card(doc, title, text, accent = '#2563eb') {
  const x = doc.page.margins.left, width = doc.page.width - x - doc.page.margins.right, start = doc.y;
  const body = String(text || '').slice(0, 1300);
  const height = Math.max(58, 34 + Math.min(180, doc.heightOfString(body, { width: width - 36, fontSize: 8.2 }) + 20));
  if (start + height > doc.page.height - 48) { doc.addPage(); return card(doc, title, text, accent); }
  doc.roundedRect(x, start, width, height, 9).fill('#f8fafc');
  doc.roundedRect(x, start, 5, height, 2).fill(accent);
  doc.fillColor('#0f172a').fontSize(9.3).font('Helvetica-Bold').text(title, x + 15, start + 9, { width: width - 25 });
  doc.fillColor('#334155').fontSize(8.2).font('Helvetica').text(body, x + 15, start + 27, { width: width - 25 });
  doc.y = start + height + 8;
}
function bullet(doc, text) { doc.text(`• ${text}`, { indent: 8, paragraphGap: 3 }); }

async function generateMasterReport(caseData, ledger, rti) {
  const id = caseData.investigationId;
  const version = caseData.version || 1;
  const filename = `FINAL-MASTER-DOSSIER-${id}-v${version}.pdf`;
  const filePath = path.join(REPORT_DIR, filename);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 44, bufferPages: true, info: { Title: `Final Master Evidence Dossier - ${id}`, Author: 'Government Work Investigation AI' } });
    const stream = fs.createWriteStream(filePath); doc.pipe(stream);
    header(doc, 'Final Master Evidence Investigation Dossier', `Case ${id} · v${version} · generated ${new Date().toISOString()}`);

    section(doc, '1. Executive Assessment', 'This dossier consolidates field capture, tender-driven deep research, source verification, comparative intelligence, cross-case analysis, evidence gaps and RTI requirements.');
    card(doc, 'Evidence readiness', `${ledger?.stats?.readinessScore ?? 0}% · verified claims ${ledger?.stats?.verifiedClaims ?? 0} · documented claims ${ledger?.stats?.documentedClaims ?? 0} · unresolved claims ${ledger?.stats?.unresolvedClaims ?? 0} · verified primary sources ${ledger?.stats?.verifiedPrimarySources ?? 0}`, '#059669');
    card(doc, 'Research depth', `${caseData.deepResearch?.rounds?.length || 0} research rounds + contradiction pass · ${caseData.deepResearch?.sources?.length || 0} researched sources · research hash ${caseData.deepResearch?.researchHash || 'not available'}`, '#7c3aed');
    card(doc, 'Integrity position', 'AI output, search leads and graph relationships are investigative aids. A claim is not treated as established merely because models agree; primary records and independent corroboration control the final status.', '#0f172a');

    section(doc, '2. Field Capture & Location');
    doc.text(`Timestamp: ${caseData.capture?.timestamp || 'Unknown'}`);
    doc.text(`GPS: ${caseData.capture?.latitude ?? 'Unknown'}, ${caseData.capture?.longitude ?? 'Unknown'} · Accuracy: ${caseData.capture?.accuracy ?? 'Unknown'}`);
    doc.text(`Location: ${caseData.location?.display_name || 'Not resolved'}`);
    doc.text(`Department: ${caseData.department || caseData.tender?.department || 'Not specified'}`);
    if (caseData.photoPath && fs.existsSync(caseData.photoPath)) { try { doc.moveDown(0.5); doc.image(caseData.photoPath, { fit: [480, 250], align: 'center' }); doc.moveDown(0.4); } catch (_) {} }

    section(doc, '3. Complete Tender & Contract Field Inventory', 'Every discovered tender field is preserved as a research anchor and mapped to verification status.');
    const tender = caseData.tender || {};
    const tenderKeys = ['tenderId','noticeNo','bidNo','workName','description','department','division','district','estimatedCost','tenderValue','contractValue','bidValue','contractor','agency','awardedTo','workOrder','agreement','loa','nit','boq','specification','period','startDate','endDate','completionDate','security','emd','performance','payment','bill','measurement','test','inspection','completion','complaint','inquiry','audit','court'];
    for (const key of tenderKeys) if (tender[key] != null && tender[key] !== '') card(doc, `${key}`, String(tender[key]), /contract|tender|award|workorder|agreement|loa|boq|estimate|value|amount/i.test(key) ? '#2563eb' : '#64748b');
    if (!tenderKeys.some(k => tender[k])) card(doc, 'Tender fields not yet established', 'No structured primary tender field was confirmed at the time of report generation. Deep research and RTI tasks identify the missing records.', '#dc2626');

    section(doc, '4. Tender Lifecycle & Chronology');
    const timeline = caseData.timeline || [];
    if (timeline.length) for (const t of timeline) card(doc, `${t.date || 'Date unknown'} · ${t.event || 'Event'}`, t.description || JSON.stringify(t), '#0ea5e9');
    else card(doc, 'Timeline not fully established', 'The current case needs primary date records for NIT publication, bid submission/evaluation, award/LOA, work order, start, measurement, bills, payment and completion.', '#ea580c');

    section(doc, '5. Technical Evidence: Specification vs Reality');
    for (const row of caseData.comparison || []) card(doc, row.item || 'Technical comparison', `Expected: ${row.expected || 'Unknown'}\nObserved: ${row.observed || 'Unknown'}\nGap: ${row.gap || 'Not established'}\nReferences: ${(row.refs || []).join(', ') || 'None'}`, '#f59e0b');

    section(doc, '6. Claims & Evidence Ledger', 'Status and provenance are preserved for auditability.');
    for (const c of (ledger?.claims || []).slice(0, 120)) {
      const refs = (c.refs || []).join(', ') || 'No source reference';
      card(doc, `${c.status} · ${Math.round((c.confidence || 0) * 100)}% · ${c.category || 'general'}`, `${c.claim}\nEvidence refs: ${refs}\n${c.note || ''}${c.modelSupport?.length ? `\nModel support: ${c.modelSupport.join(', ')}` : ''}`, c.status === 'VERIFIED' ? '#059669' : c.status === 'CONTRADICTED' ? '#dc2626' : '#64748b');
    }

    section(doc, '7. Deep Research Ledger', 'Searches are iterative and expand from newly discovered tender/document identifiers.');
    for (const round of caseData.deepResearch?.rounds || []) card(doc, `Round ${round.round}`, `Queries: ${round.queries?.length || 0}\nCandidates: ${round.candidateCount || 0}\nVerified: ${round.verifiedCount || 0}\nHigh-value: ${round.highValueCount || 0}`, '#7c3aed');
    const highValue = (caseData.deepResearch?.sources || []).filter(s => s.verified && Number(s.sourceQuality || 0) >= 0.7).slice(0, 80);
    for (const s of highValue) card(doc, `[${s.id}] ${s.title || 'Source'}`, `${s.publisher || ''}\nTrack: ${s.track || ''}\nURL: ${s.finalUrl || s.url}\nRetrieved: ${s.fetchedAt || s.retrievedAt || ''}\nSHA256: ${s.contentSha256 || 'not captured'}\n${s.fetchedExcerpt || s.excerpt || ''}`, '#059669');

    section(doc, '8. Comparative Intelligence');
    const sig = caseData.comparativeResearch?.signals || {};
    card(doc, 'Research signals', `Sources ${sig.totalSources || 0} · official ${sig.officialSources || 0} · complaint ${sig.complaintSources || 0} · audit ${sig.auditSources || 0} · court ${sig.courtSources || 0} · outcomes ${sig.outcomeSources || 0}`, '#2563eb');
    for (const p of caseData.comparativeResearch?.findings?.patterns || []) card(doc, 'Pattern lead', typeof p === 'string' ? p : JSON.stringify(p), '#7c3aed');
    for (const p of caseData.comparativeResearch?.findings?.contradictions || []) card(doc, 'Contradiction / disagreement', typeof p === 'string' ? p : JSON.stringify(p), '#dc2626');

    section(doc, '9. Cross-Case Intelligence');
    card(doc, 'Cross-case graph', `Cases: ${caseData.crossCase?.stats?.cases || 0} · nodes: ${caseData.crossCase?.stats?.nodes || 0} · edges: ${caseData.crossCase?.stats?.edges || 0} · matches: ${(caseData.crossCase?.matches || []).length}`, '#0ea5e9');
    for (const m of caseData.crossCase?.matches || []) card(doc, `${m.similarity ?? 0} similarity`, `${m.reason || 'Related cases'}\nShared entities: ${(m.sharedEntityIds || []).join(', ')}`, '#0ea5e9');

    section(doc, '10. Evidence Gaps & RTI Closure Plan');
    for (const gap of rti?.gaps || []) card(doc, `${Math.round((gap.priority || 0) * 100)}% priority`, gap.text, '#ea580c');
    for (const group of rti?.drafts || []) {
      card(doc, `RTI authority: ${group.authority.label}`, `${group.drafts?.length || 0} request(s)\n${group.drafts?.[0]?.addressee || 'Current SPIO/PIO details must be verified.'}`, '#0891b2');
    }

    section(doc, '11. Final Verification Checklist');
    [
      'Verify exact tender/NIT, BOQ, estimate and sanctioned amount from primary records.',
      'Verify contractor identity and award/LOA/work-order chain from official records.',
      'Verify technical specification, drawings, quantities and measurable acceptance criteria.',
      'Verify Measurement Book/e-MB, inspection records, quality tests and completion certificate.',
      'Verify running/final bills, vouchers, payment dates, deductions and security records.',
      'Resolve every material contradiction before describing a defect, loss or misconduct as established.',
      'Preserve original source documents, retrieval timestamps and hashes where available.',
      'Attach RTI responses back to the case and regenerate the master dossier after new records arrive.'
    ].forEach(x => bullet(doc, x));

    section(doc, '12. Integrity & Limitations');
    doc.text('This report intentionally separates observations, documentary facts, verified claims, inference, allegations and unknowns. Absence of a public web record does not prove that an event did not occur. A missing primary record is an evidence gap to be resolved through the appropriate record custodian, inspection, testing or RTI process.');

    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) { doc.switchToPage(i); doc.fillColor('#64748b').fontSize(7).font('Helvetica').text(`Case ${id} · Final Master Dossier v${version} · Page ${i + 1} of ${pages.count}`, 44, doc.page.height - 25, { align: 'center', width: doc.page.width - 88 }); }
    doc.end(); stream.on('finish', () => resolve(filePath)); stream.on('error', reject);
  });
}

module.exports = { generateMasterReport, REPORT_DIR };
