require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { runInvestigation, runComparativeInvestigation, runCrossCaseIntelligence, runFinalEvidencePlan, loadCase, loadGraph, REPORT_DIR, CASE_DIR } = require('./agents');
const { runFullInvestigation } = require('./full-pipeline');
const { graphStats } = require('./evidence-graph');
const { buildCrossCaseGraph } = require('./cross-case-graph');

const app = express();
const PORT = Number(process.env.PORT || 5001);
const HOST = '0.0.0.0';
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');

app.use(cors({ origin: true, methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json({ limit: '30mb' }));
app.use('/reports', express.static(REPORT_DIR, { maxAge: '1h', index: false }));
app.use('/cases', express.static(CASE_DIR, { maxAge: '1h', index: false }));
app.use('/app', express.static(FRONTEND_DIR, { maxAge: '5m', index: 'index.html' }));

function reportUrlFromFile(filePath, rootDir, prefix) {
  if (!filePath) return null;
  const relative = path.relative(rootDir, filePath).replace(/\\/g, '/');
  return `${prefix}/${relative.split('/').map(encodeURIComponent).join('/')}`;
}

function publicReportLinks(caseData) {
  const reports = caseData?.reports || {};
  return {
    basePdf: reportUrlFromFile(reports.pdf, REPORT_DIR, '/reports'),
    comparativePdf: reportUrlFromFile(reports.comparativePdf, REPORT_DIR, '/reports'),
    rtiPdf: reportUrlFromFile(reports.rtiPdf, REPORT_DIR, '/reports'),
    masterPdf: reportUrlFromFile(reports.masterPdf, REPORT_DIR, '/reports'),
    caseJson: reportUrlFromFile(reports.case, CASE_DIR, '/cases'),
    graphJson: reportUrlFromFile(reports.graph, CASE_DIR, '/cases'),
    rtiJson: reportUrlFromFile(reports.rtiJson, CASE_DIR, '/cases'),
    crossCaseGraph: reportUrlFromFile(reports.crossCaseGraph, CASE_DIR, '/cases'),
    evidenceLedger: reportUrlFromFile(reports.evidenceLedger, CASE_DIR, '/cases')
  };
}

app.get('/', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));
app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'government-work-investigation-ai', version: '7.0', port: PORT, time: new Date().toISOString() }));

app.post('/api/start-investigation', async (req, res) => {
  try {
    const { latitude, longitude, timestamp, tender_id, photo, accuracy, object_hint, department } = req.body;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') return res.status(400).json({ status: 'error', error: 'Valid latitude and longitude are required.' });
    if (latitude < -90 || latitude > 90) return res.status(400).json({ status: 'error', error: 'Invalid latitude.' });
    if (longitude < -180 || longitude > 180) return res.status(400).json({ status: 'error', error: 'Invalid longitude.' });
    const result = await runInvestigation({ latitude, longitude, timestamp: timestamp || new Date().toISOString(), tenderId: tender_id || null, photo: photo || null, accuracy: accuracy ?? null, objectHint: object_hint || '', department: department || '' });
    result.reports = publicReportLinks({ reports: result.reports });
    res.json(result);
  } catch (error) { console.error('Investigation error:', error); res.status(500).json({ status: 'error', error: error.message || 'Internal server error' }); }
});

app.post('/api/run-full-investigation', async (req, res) => {
  try {
    const { latitude, longitude, timestamp, tender_id, photo, accuracy, object_hint, department } = req.body;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') return res.status(400).json({ status: 'error', error: 'Valid latitude and longitude are required.' });
    if (latitude < -90 || latitude > 90) return res.status(400).json({ status: 'error', error: 'Invalid latitude.' });
    if (longitude < -180 || longitude > 180) return res.status(400).json({ status: 'error', error: 'Invalid longitude.' });
    const result = await runFullInvestigation({ latitude, longitude, timestamp: timestamp || new Date().toISOString(), tenderId: tender_id || null, photo: photo || null, accuracy: accuracy ?? null, objectHint: object_hint || '', department: department || '' });
    result.reports = publicReportLinks({ reports: result.reports });
    res.json(result);
  } catch (error) {
    console.error('Full investigation error:', error);
    const investigationId = error?.investigationId || null;
    res.status(500).json({ status: 'error', error: error.message || 'Full investigation failed', investigationId });
  }
});

app.post('/api/case/:id/comparative-research', async (req, res) => {
  try { const result = await runComparativeInvestigation(req.params.id); result.reports = publicReportLinks({ reports: result.reports }); res.json({ status: 'success', ...result }); }
  catch (error) { console.error('Comparative research error:', error); const status = /Case not found/i.test(error.message) ? 404 : 500; res.status(status).json({ status: 'error', error: error.message || 'Comparative research failed' }); }
});

app.post('/api/case/:id/cross-case-intelligence', async (req, res) => {
  try { const result = await runCrossCaseIntelligence(req.params.id); res.json({ status: 'success', investigationId: req.params.id, stats: result.graph.stats, matches: result.matches, graphFile: `/cases/${path.basename(result.path)}` }); }
  catch (error) { res.status(/Case not found/i.test(error.message) ? 404 : 500).json({ status: 'error', error: error.message || 'Cross-case analysis failed' }); }
});

app.post('/api/case/:id/complete-evidence-plan', async (req, res) => {
  try { const result = await runFinalEvidencePlan(req.params.id); result.reports = publicReportLinks({ reports: result.reports }); res.json({ status: 'success', ...result }); }
  catch (error) { console.error('Evidence completion error:', error); const status = /Case not found/i.test(error.message) ? 404 : 500; res.status(status).json({ status: 'error', error: error.message || 'Evidence completion failed' }); }
});

app.get('/api/case/:id', (req, res) => { try { res.json(loadCase(req.params.id)); } catch (_) { res.status(404).json({ status: 'error', error: 'Case not found' }); } });

app.get('/api/case/:id/reports', (req, res) => {
  try {
    const data = loadCase(req.params.id); const links = publicReportLinks(data);
    const items = [
      { key: 'masterPdf', label: 'FINAL Master Evidence Dossier PDF', type: 'pdf', url: links.masterPdf },
      { key: 'basePdf', label: 'Base Investigation Dossier PDF', type: 'pdf', url: links.basePdf },
      { key: 'comparativePdf', label: 'Comparative Intelligence PDF', type: 'pdf', url: links.comparativePdf },
      { key: 'rtiPdf', label: 'Department-wise RTI Bundle PDF', type: 'pdf', url: links.rtiPdf },
      { key: 'caseJson', label: 'Case JSON', type: 'json', url: links.caseJson },
      { key: 'evidenceLedger', label: 'Evidence Ledger JSON', type: 'json', url: links.evidenceLedger },
      { key: 'graphJson', label: 'Evidence Graph JSON', type: 'json', url: links.graphJson },
      { key: 'rtiJson', label: 'RTI Draft JSON', type: 'json', url: links.rtiJson },
      { key: 'crossCaseGraph', label: 'Cross-case Graph JSON', type: 'json', url: links.crossCaseGraph }
    ].filter(item => item.url);
    res.json({ status: 'success', investigationId: req.params.id, reports: items });
  } catch (_) { res.status(404).json({ status: 'error', error: 'Case not found' }); }
});

app.get('/api/case/:id/comparative-report', (req, res) => {
  try { const data = loadCase(req.params.id); if (!data.comparativeResearch) return res.status(404).json({ status: 'error', error: 'Comparative research has not been run for this case.' }); res.json({ status: 'success', investigationId: req.params.id, version: data.version, comparativeResearch: data.comparativeResearch, report: publicReportLinks(data).comparativePdf }); }
  catch (_) { res.status(404).json({ status: 'error', error: 'Case not found' }); }
});

app.get('/api/case/:id/graph', (req, res) => { try { const graph = loadGraph(req.params.id); if (!graph) return res.status(404).json({ status: 'error', error: 'Evidence graph has not been created for this case.' }); res.json({ status: 'success', investigationId: req.params.id, stats: graphStats(graph), graph }); } catch (_) { res.status(404).json({ status: 'error', error: 'Evidence graph not found.' }); } });
app.get('/api/case/:id/graph/leads', (req, res) => { try { const graph = loadGraph(req.params.id); if (!graph) return res.status(404).json({ status: 'error', error: 'Evidence graph has not been created for this case.' }); const min = Number(req.query.min_score || 0.28); const leads = (graph.leads || []).filter(x => Number(x.score || 0) >= min).slice(0, 100); res.json({ status: 'success', investigationId: req.params.id, leads }); } catch (_) { res.status(404).json({ status: 'error', error: 'Evidence graph not found.' }); } });
app.get('/api/case/:id/rti', (req, res) => { try { const data = loadCase(req.params.id); if (!data.rti) return res.status(404).json({ status: 'error', error: 'RTI evidence plan has not been generated for this case.' }); res.json({ status: 'success', investigationId: req.params.id, rti: data.rti, report: publicReportLinks(data).rtiPdf }); } catch (_) { res.status(404).json({ status: 'error', error: 'Case not found' }); } });
app.get('/api/cross-case-graph', (req, res) => { try { const graph = buildCrossCaseGraph(CASE_DIR); res.json({ status: 'success', stats: graph.stats, graph }); } catch (error) { res.status(500).json({ status: 'error', error: error.message || 'Cross-case graph failed' }); } });
app.use((req, res) => res.status(404).json({ status: 'error', error: `Route not found: ${req.method} ${req.originalUrl}` }));
const server = app.listen(PORT, HOST, () => console.log(`Government Work Investigation AI v7 listening on ${PORT}`));
server.on('error', error => console.error('Server error:', error));
process.on('SIGINT', () => server.close(() => process.exit(0)));
module.exports = { app, server };