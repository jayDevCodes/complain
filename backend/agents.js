require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createInvestigationId, source, evidence } = require('./investigation-schema');
const { runParallelModels, consensus } = require('./ai-orchestrator');
const { researchLocation } = require('./research-engine');
const { generateEvidencePDF, REPORT_DIR } = require('./pdf-report');

const CASE_DIR = path.join(__dirname, 'cases');
if (!fs.existsSync(CASE_DIR)) fs.mkdirSync(CASE_DIR, { recursive: true });

async function getLocationDetails(latitude, longitude) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}&zoom=18&addressdetails=1`;
  const response = await fetch(url, { headers: { 'User-Agent': 'GovernmentWorkInvestigationAI/3.0' } });
  if (!response.ok) throw new Error(`Location service failed: HTTP ${response.status}`);
  const data = await response.json(); const a = data.address || {};
  return { latitude, longitude, display_name: data.display_name || null, village: a.village || a.hamlet || a.suburb || null, town: a.town || a.city || a.municipality || null, district: a.county || a.state_district || null, state: a.state || null, country: a.country || null, pincode: a.postcode || null, raw: data };
}

function savePhoto(photo, investigationId) {
  if (!photo) return null;
  const match = String(photo).match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
  if (!match) return null;
  const ext = match[1].toLowerCase().replace('jpeg', 'jpg');
  const filePath = path.join(CASE_DIR, `${investigationId}.${ext}`);
  fs.writeFileSync(filePath, Buffer.from(match[2], 'base64'));
  return filePath;
}

function safeCaseWrite(id, data) {
  const p = path.join(CASE_DIR, `${id}.json`); fs.writeFileSync(p, JSON.stringify(data, null, 2)); return p;
}

async function runInvestigation({ latitude, longitude, timestamp, tenderId, photo, accuracy, objectHint, department }) {
  const investigationId = createInvestigationId();
  const location = await getLocationDetails(latitude, longitude);
  const photoPath = savePhoto(photo, investigationId);
  const capture = { timestamp, latitude, longitude, accuracy: accuracy ?? null, photoCaptured: Boolean(photoPath) };

  // Stage A: vision/field interpretation. No claim is accepted as fact at this stage.
  const vision = await runParallelModels('PHOTO_OBJECT_IDENTIFICATION', { capture, location, tenderId, objectHint, department }, photo || null);
  const modelReview = { vision, consensus: consensus(vision.results) };

  const objectIdentification = {
    status: vision.configuredCount ? 'AI_REVIEWED_NEEDS_SOURCE_CORROBORATION' : 'UNKNOWN_NO_MODEL_CONFIGURED',
    candidates: vision.results.filter(x => x.status === 'ok').map(x => ({ provider: x.provider, result: x.result }))
  };
  const description = objectHint || objectIdentification.candidates.map(x => x.result?.object || x.result?.description || '').filter(Boolean).join(' | ');

  // Stage B: source discovery. Search provider is optional and never fabricated.
  const research = await researchLocation({ location, objectDescription: description, department, tenderId });
  const sources = research.sources || [];

  // Stage C: evidence synthesis against discovered sources.
  const synthesis = await runParallelModels('TENDER_EXECUTION_QUALITY_AUDIT', { capture, location, objectIdentification, sources, tenderId, researchQueries: research.queries }, photo || null);
  modelReview.synthesis = synthesis;
  modelReview.synthesisConsensus = consensus(synthesis.results);

  const evidenceItems = [
    evidence(`Photo captured at ${timestamp}`, 'OBSERVED', 1, [], 'Direct field capture metadata.'),
    evidence(`GPS coordinates ${latitude}, ${longitude}`, 'OBSERVED', 1, [], 'Device supplied coordinates; accuracy should be retained.'),
    evidence(location.display_name || 'Reverse-geocoded place not available', 'DOCUMENTED', location.display_name ? 0.9 : 0, [], 'Derived from reverse geocoding, not proof of administrative ownership.'),
  ];
  for (const s of sources.slice(0, 30)) evidenceItems.push(evidence(`${s.title || s.url}`, 'DOCUMENTED', 0.65, [s.id], s.excerpt || ''));

  const synthesized = synthesis.results.filter(x => x.status === 'ok').map(x => x.result);
  const tender = { status: tenderId ? 'USER_SUPPLIED_ID_NEEDS_DOCUMENT_VERIFICATION' : 'NOT_ESTABLISHED', tenderId: tenderId || null, modelFindings: synthesized.map(x => x.tender || x.contract || x.findings).filter(Boolean) };
  const comparison = synthesized.flatMap(x => x.comparison || x.defects || []).map(x => typeof x === 'string' ? { item: x, expected: 'Unknown', observed: 'AI finding only', gap: 'Requires documentary/technical verification', refs: [] } : x).slice(0, 30);
  const execution = { status: 'DOCUMENTARY_RESEARCH_REQUIRED', findings: synthesized.map(x => x.inspection || x.measurement || x.payment || x.execution).filter(Boolean) };
  const gaps = [
    'Obtain the exact tender notice/work order and sanctioned amount from a primary government source.',
    'Obtain BOQ/SOW/specifications and identify measurable acceptance criteria.',
    'Obtain Measurement Book/e-MB entries, inspection notes and completion certificate.',
    'Obtain material test reports, laboratory certificates and relevant invoices.',
    'Match contractor, work order, payment/bill records and dates.',
    'Compare measured dimensions/material properties with the contractual specification.',
    'Identify the inspecting/recording officer only from official records.',
    'Do not infer financial loss or misconduct without measurements, records and corroboration.'
  ];

  const report = { investigationId, version: 1, title: 'Government Work Evidence Investigation Dossier', capture, location, photoPath, objectIdentification, tender, comparison, execution, evidence: evidenceItems, sources, modelReview, gaps, researchQueries: research.queries };
  const casePath = safeCaseWrite(investigationId, report);
  const pdfPath = await generateEvidencePDF(report);
  return { status: 'success', investigationId, version: 1, capture, location, objectIdentification, tender, comparison, execution, modelReview, sources, gaps, researchQueries: research.queries, reports: { pdf: pdfPath, case: casePath } };
}

module.exports = { runInvestigation, REPORT_DIR, CASE_DIR };
