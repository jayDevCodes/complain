const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const REPORT_DIR = path.join(__dirname, 'reports');
if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

function addHeader(doc, title, subtitle) {
  doc.rect(0, 0, doc.page.width, 92).fill('#0f172a');
  doc.fillColor('#ffffff').fontSize(20).font('Helvetica-Bold').text(title, 48, 25);
  doc.fontSize(9).font('Helvetica').fillColor('#cbd5e1').text(subtitle || '', 48, 55);
  doc.fillColor('#0f172a');
  doc.y = 112;
}

function section(doc, title) {
  if (doc.y > 710) doc.addPage();
  doc.moveDown(0.5).fontSize(14).font('Helvetica-Bold').fillColor('#0f172a').text(title);
  doc.moveDown(0.35).fontSize(9).font('Helvetica').fillColor('#334155');
}

function writeEvidence(doc, e) {
  const refs = (e.refs || []).join(', ') || 'No source reference';
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#0f172a').text(`${e.kind || 'UNKNOWN'} · confidence ${Math.round((e.confidence || 0) * 100)}%`);
  doc.font('Helvetica').text(e.item || '');
  doc.fontSize(8).fillColor('#64748b').text(`References: ${refs}${e.note ? ` · ${e.note}` : ''}`);
  doc.moveDown(0.45).fillColor('#334155');
}

async function generateEvidencePDF(report) {
  const filename = `investigation-${report.investigationId}-v${report.version || 1}.pdf`;
  const filePath = path.join(REPORT_DIR, filename);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: report.title || 'Evidence Investigation Dossier', Author: 'Government Work Investigation AI' } });
    const stream = fs.createWriteStream(filePath); doc.pipe(stream);
    addHeader(doc, report.title || 'Evidence Investigation Dossier', `Case ${report.investigationId} · Report version ${report.version || 1}`);

    section(doc, '1. Field Evidence');
    if (report.photoPath && fs.existsSync(report.photoPath)) {
      try { doc.image(report.photoPath, { fit: [495, 270], align: 'center' }); doc.moveDown(0.5); } catch (_) {}
    }
    doc.fontSize(9).font('Helvetica').fillColor('#334155').text(`Captured: ${report.capture?.timestamp || 'Unknown'}`);
    doc.text(`GPS: ${report.capture?.latitude ?? 'Unknown'}, ${report.capture?.longitude ?? 'Unknown'} · Accuracy: ${report.capture?.accuracy ?? 'Unknown'}`);
    doc.text(`Location: ${report.location?.display_name || 'Not resolved'}`);

    section(doc, '2. What the Evidence Shows');
    for (const e of report.evidence || []) writeEvidence(doc, e);

    section(doc, '3. Object / Work Identification');
    doc.text(JSON.stringify(report.objectIdentification || { status: 'UNKNOWN' }, null, 2));

    section(doc, '4. Tender & Contract Trail');
    doc.text(JSON.stringify(report.tender || { status: 'NOT YET VERIFIED' }, null, 2));

    section(doc, '5. Specifications vs Reality');
    for (const row of report.comparison || []) {
      doc.font('Helvetica-Bold').text(row.item || 'Comparison');
      doc.font('Helvetica').text(`Expected: ${row.expected || 'Unknown'}`);
      doc.text(`Observed: ${row.observed || 'Unknown'}`);
      doc.text(`Gap: ${row.gap || 'Not established'}`);
      doc.text(`Evidence: ${(row.refs || []).join(', ') || 'None'}`).moveDown(0.5);
    }

    section(doc, '6. Inspection, Measurement & Payment Trail');
    doc.text(JSON.stringify(report.execution || { status: 'DOCUMENTS NOT FOUND' }, null, 2));

    section(doc, '7. Multi-Model Review');
    doc.text(JSON.stringify(report.modelReview || {}, null, 2));

    section(doc, '8. Sources & Evidence Registry');
    for (const s of report.sources || []) {
      doc.font('Helvetica-Bold').text(`[${s.id}] ${s.title || 'Untitled source'}`);
      doc.font('Helvetica').text(`${s.publisher || ''} · ${s.url || ''}`);
      if (s.excerpt) doc.fontSize(8).text(s.excerpt.slice(0, 650));
      doc.moveDown(0.4);
    }

    section(doc, '9. Evidence Gaps / Next Actions');
    for (const x of report.gaps || []) doc.text(`• ${x}`);

    section(doc, '10. Important Integrity Note');
    doc.text('This dossier separates observed evidence, documentary facts, corroborated findings, inference and unresolved allegations. A model consensus is not proof. Defect, financial loss, misconduct or corruption should only be stated as established when supported by primary records, measurements, testing or other independently verifiable evidence.');

    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i); doc.fontSize(7).fillColor('#64748b').text(`Case ${report.investigationId} · Page ${i + 1} of ${pages.count}`, 48, doc.page.height - 28, { align: 'center', width: doc.page.width - 96 });
    }
    doc.end(); stream.on('finish', () => resolve(filePath)); stream.on('error', reject);
  });
}

module.exports = { generateEvidencePDF, REPORT_DIR };
