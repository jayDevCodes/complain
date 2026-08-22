const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const REPORT_DIR = path.join(__dirname, 'reports');
if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

function header(doc, title, subtitle) {
  doc.rect(0, 0, doc.page.width, 88).fill('#111827');
  doc.fillColor('#fff').fontSize(19).font('Helvetica-Bold').text(title, 46, 24);
  doc.fontSize(9).font('Helvetica').fillColor('#cbd5e1').text(subtitle || '', 46, 54);
  doc.fillColor('#111827');
  doc.y = 105;
}

function heading(doc, text) {
  if (doc.y > 710) doc.addPage();
  doc.moveDown(0.4).fontSize(13).font('Helvetica-Bold').fillColor('#111827').text(text);
  doc.moveDown(0.25).fontSize(9).font('Helvetica').fillColor('#334155');
}

async function generateRTIPDFBundle(caseData, rti) {
  const id = caseData.investigationId;
  const version = caseData.version || 1;
  const filePath = path.join(REPORT_DIR, `rti-bundle-${id}-v${version}.pdf`);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 46, bufferPages: true, info: { Title: `RTI Evidence Request Bundle - ${id}`, Author: 'Government Work Investigation AI' } });
    const stream = fs.createWriteStream(filePath); doc.pipe(stream);
    header(doc, 'RTI Evidence Request Bundle', `Case ${id} · Evidence-readiness ${rti.readinessScore}%`);

    heading(doc, 'Purpose');
    doc.text('These drafts are record-seeking templates generated from unresolved evidence gaps. They should be reviewed, routed to the correct public authority and updated with the current SPIO/PIO details before filing. They are not findings of wrongdoing.');

    heading(doc, 'Case context');
    doc.text(`Location: ${caseData.location?.display_name || 'Not resolved'}`);
    doc.text(`Tender: ${caseData.tender?.tenderId || 'Not established'}`);
    doc.text(`Departments/keywords: ${caseData.department || 'Not specified'}`);

    heading(doc, 'Outstanding evidence gaps');
    for (const gap of rti.gaps || []) doc.text(`• ${gap.text} · priority ${Math.round((gap.priority || 0) * 100)}%`);

    for (const group of rti.drafts || []) {
      doc.addPage();
      header(doc, group.authority.label, `Authority key ${group.authority.key}`);
      heading(doc, 'Addressee');
      doc.text(group.drafts[0]?.addressee || 'Current SPIO/PIO details to be verified.');
      heading(doc, 'Subject');
      doc.text(group.drafts[0]?.subject || 'RTI request for records');
      heading(doc, 'Draft requests');
      group.drafts.forEach((draft, i) => {
        doc.font('Helvetica-Bold').text(`${i + 1}. Evidence gap`);
        doc.font('Helvetica').text(draft.evidenceGap || '');
        doc.moveDown(0.2).font('Helvetica-Bold').text('Proposed application text');
        doc.font('Helvetica').text(draft.body || '');
        doc.moveDown(0.5);
      });
      heading(doc, 'Submission checklist');
      for (const x of group.submissionChecklist || []) doc.text(`• ${x}`);
      heading(doc, 'Jurisdiction / fee profile');
      doc.text(`${rti.jurisdictionProfile?.officialReference || 'Applicable RTI rules'} · Application fee profile: Rs ${rti.jurisdictionProfile?.applicationFee ?? 'verify'} · Copy fee profile: Rs ${rti.jurisdictionProfile?.copyFeePerPage ?? 'verify'}/page · Inspection: ${rti.jurisdictionProfile?.inspection || 'verify'}`);
    }

    doc.addPage();
    header(doc, 'RTI Filing Integrity Checklist', `Case ${id}`);
    const checks = [
      'Confirm the actual public authority that holds the records.',
      'Confirm the current State/Central Public Information Officer designation and address from the authority\'s current official disclosure.',
      'Confirm the current application fee/payment method and any available online filing route.',
      'Keep the requested period and work identifiers precise.',
      'Request existing records, copies, inspection and file references rather than asking the authority to create explanations.',
      'Preserve acknowledgement, tracking number, payment proof and all responses in the case evidence store.',
      'When records arrive, feed them back into the evidence graph for cross-case matching and re-analysis.'
    ];
    checks.forEach(x => doc.text(`☐ ${x}`));

    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(7).fillColor('#64748b').text(`Case ${id} · RTI Bundle · Page ${i + 1} of ${pages.count}`, 46, doc.page.height - 27, { width: doc.page.width - 92, align: 'center' });
    }
    doc.end();
    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}

module.exports = { generateRTIPDFBundle, REPORT_DIR };