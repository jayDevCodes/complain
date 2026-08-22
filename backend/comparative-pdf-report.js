const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const REPORT_DIR = path.join(__dirname, 'reports');
if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

function header(doc, title, subtitle) {
  doc.rect(0, 0, doc.page.width, 96).fill('#020617');
  doc.fillColor('#ffffff').fontSize(21).font('Helvetica-Bold').text(title, 44, 23, { width: 510 });
  doc.fillColor('#94a3b8').fontSize(8.5).font('Helvetica').text(subtitle || '', 44, 64, { width: 510 });
  doc.fillColor('#0f172a').y = 116;
}

function section(doc, title, kicker = '') {
  if (doc.y > 700) doc.addPage();
  doc.fillColor('#0f172a').fontSize(15).font('Helvetica-Bold').text(title);
  if (kicker) doc.fillColor('#64748b').fontSize(8).font('Helvetica').text(kicker);
  doc.moveDown(0.55).fillColor('#334155').fontSize(9).font('Helvetica');
}

function card(doc, title, body, accent = '#2563eb') {
  const x = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const start = doc.y;
  const text = String(body || '').slice(0, 900);
  const height = Math.max(58, 32 + Math.min(160, doc.heightOfString(text, { width: width - 40, fontSize: 8.2 }) + 22));
  if (start + height > doc.page.height - 48) { doc.addPage(); return card(doc, title, body, accent); }
  doc.roundedRect(x, start, width, height, 10).fill('#f8fafc');
  doc.roundedRect(x, start, 5, height, 2).fill(accent);
  doc.fillColor('#0f172a').fontSize(9.5).font('Helvetica-Bold').text(title, x + 16, start + 10, { width: width - 28 });
  doc.fillColor('#334155').fontSize(8.2).font('Helvetica').text(text, x + 16, start + 28, { width: width - 28 });
  doc.y = start + height + 9;
}

function tableRow(doc, cells, widths, headerRow = false) {
  const x = doc.page.margins.left;
  const y = doc.y;
  const h = 30;
  if (y + h > doc.page.height - 48) { doc.addPage(); return tableRow(doc, cells, widths, headerRow); }
  let cursor = x;
  cells.forEach((cell, i) => {
    doc.rect(cursor, y, widths[i], h).fill(headerRow ? '#e2e8f0' : '#ffffff').stroke('#cbd5e1');
    doc.fillColor(headerRow ? '#0f172a' : '#334155').fontSize(headerRow ? 7.8 : 7.4).font(headerRow ? 'Helvetica-Bold' : 'Helvetica').text(String(cell ?? ''), cursor + 5, y + 8, { width: widths[i] - 10, height: h - 8 });
    cursor += widths[i];
  });
  doc.y += h;
}

function sourceCard(doc, s) {
  const host = s.publisher || '';
  const kind = s.queryType || (s.queryTypes || []).join(', ');
  const body = [`${host}`, kind ? `Research track: ${kind}` : '', s.excerpt || 'No excerpt returned.', s.url || ''].filter(Boolean).join('\n');
  card(doc, `[${s.id || 'SRC'}] ${s.title || 'Untitled source'}`, body, /^((www\.)?gov\.in|.*\.nic\.in|cag\.gov\.in)$/i.test(host) ? '#059669' : '#64748b');
  if (s.url) doc.link(doc.page.margins.left + 16, doc.y - 7, 480, 12, s.url);
}

async function generateComparativePDF(report, caseData) {
  const id = report.investigationId || caseData.investigationId || 'case';
  const version = report.version || 2;
  const filename = `comparative-intelligence-${id}-v${version}.pdf`;
  const filePath = path.join(REPORT_DIR, filename);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 44, bufferPages: true, info: { Title: 'Comparative Intelligence Investigation', Author: 'Government Work Investigation AI' } });
    const stream = fs.createWriteStream(filePath); doc.pipe(stream);

    header(doc, 'Comparative Intelligence Brief', `Case ${id} · intelligence report v${version} · generated ${report.generatedAt || new Date().toISOString()}`);

    section(doc, '1. Executive Intelligence Picture', 'The second-pass report starts from the original case evidence and searches for comparable patterns, prior complaints, official outcomes and control gaps.');
    const signals = report.signals || {};
    const lead = [
      ['Sources reviewed', signals.totalSources || 0],
      ['Official-source leads', signals.officialSources || 0],
      ['Complaint-history leads', signals.complaintSources || 0],
      ['Audit-pattern leads', signals.auditSources || 0],
      ['Court/tribunal leads', signals.courtSources || 0],
      ['Outcome leads', signals.outcomeSources || 0],
      ['Loop-hole/control-gap leads', signals.loopholeSources || 0]
    ];
    const widths = [210, 70, 210];
    tableRow(doc, ['Signal', 'Count', 'Interpretation'], widths, true);
    for (const [name, count] of lead) tableRow(doc, [name, count, count ? 'Lead requiring case-specific verification' : 'No public lead found in this pass'], widths);

    section(doc, '2. Similar-Case Pattern Matrix', 'A similarity is an investigative lead, not proof of identical conduct.');
    for (const p of report.findings?.patterns || []) {
      const text = typeof p === 'string' ? p : JSON.stringify(p);
      card(doc, 'Pattern lead', text, '#7c3aed');
    }

    section(doc, '3. Earlier Complaints & Prior Allegations', 'Only documented/public records should be promoted into the verified case file.');
    for (const p of report.findings?.priorComplaints || []) card(doc, 'Prior complaint lead', typeof p === 'string' ? p : JSON.stringify(p), '#dc2626');

    section(doc, '4. What Happened in Comparable Cases', 'Outcome research is used to identify realistic administrative, technical or legal consequences.');
    for (const p of report.findings?.outcomes || []) card(doc, 'Comparable outcome', typeof p === 'string' ? p : JSON.stringify(p), '#059669');

    section(doc, '5. Control-Gap / Loophole Analysis', 'The system flags structures that can create risk; it does not label a loophole as deliberate misuse without evidence.');
    for (const p of report.findings?.loopholes || []) card(doc, 'Control-gap lead', typeof p === 'string' ? p : JSON.stringify(p), '#ea580c');

    section(doc, '6. Model Disagreements', 'Disagreement is preserved instead of being silently collapsed into consensus.');
    for (const p of report.findings?.contradictions || []) card(doc, 'Contradiction', typeof p === 'string' ? p : JSON.stringify(p), '#475569');

    section(doc, '7. Source Intelligence Board', 'Each source is rendered as a visual reference card so the report can be audited without losing the provenance trail.');
    for (const s of (report.sources || []).slice(0, 60)) sourceCard(doc, s);

    section(doc, '8. Investigation Upgrade Queue', 'Every pattern becomes a concrete verification task for the original case.');
    const tasks = [
      'Find the exact primary record behind each high-confidence similar-case lead.',
      'Match contractor, department, work type, place, dates and contract structure before treating a case as comparable.',
      'Retrieve any public complaint, inspection notice, show-cause notice, audit paragraph or court order associated with the exact case entities.',
      'Test whether the same tender structure, eligibility clause, maintenance mechanism or documentation gap appears in the current case.',
      'For every suspected quality gap, define the measurement or test required to prove or disprove it.',
      'Record the administrative outcome of every comparable case: repair, recovery, penalty, closure, exoneration, litigation or unresolved.'
    ];
    for (const t of tasks) card(doc, 'NEXT', t, '#2563eb');

    section(doc, '9. Evidence Discipline', 'The report is intentionally conservative.');
    card(doc, 'Rule', 'A model agreement score increases investigative priority; it never turns an allegation into a fact. Comparable incidents, news reports and audit findings are contextual evidence until linked to the current case with primary documentation.', '#0f172a');

    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.fillColor('#64748b').fontSize(7).font('Helvetica').text(`Case ${id} · Comparative Intelligence v${version} · Page ${i + 1} of ${pages.count}`, 44, doc.page.height - 25, { align: 'center', width: doc.page.width - 88 });
    }

    doc.end();
    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}

module.exports = { generateComparativePDF, REPORT_DIR };
