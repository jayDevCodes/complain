require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { runInvestigation, runComparativeInvestigation, loadCase, loadGraph, REPORT_DIR, CASE_DIR } = require('./agents');
const { graphStats } = require('./evidence-graph');

const app = express();
const PORT = Number(process.env.PORT || 5000);
const HOST = '0.0.0.0';
app.use(cors({ origin: true, methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json({ limit: '30mb' }));
app.use('/reports', express.static(REPORT_DIR, { maxAge: '1h', index: false }));
app.use('/cases', express.static(CASE_DIR, { maxAge: '1h', index: false }));

app.get('/', (req, res) => res.json({ status: 'ok', service: 'Government Work Evidence Investigation AI', version: '5.0' }));
app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'government-work-investigation-ai', version: '5.0', time: new Date().toISOString() }));

app.post('/api/start-investigation', async (req, res) => {
  try {
    const { latitude, longitude, timestamp, tender_id, photo, accuracy, object_hint, department } = req.body;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') return res.status(400).json({ status: 'error', error: 'Valid latitude and longitude are required.' });
    if (latitude < -90 || latitude > 90) return res.status(400).json({ status: 'error', error: 'Invalid latitude.' });
    if (longitude < -180 || longitude > 180) return res.status(400).json({ status: 'error', error: 'Invalid longitude.' });
    const result = await runInvestigation({ latitude, longitude, timestamp: timestamp || new Date().toISOString(), tenderId: tender_id || null, photo: photo || null, accuracy: accuracy ?? null, objectHint: object_hint || '', department: department || '' });
    result.reports = { pdf: `/reports/${path.basename(result.reports.pdf)}`, case: `/cases/${path.basename(result.reports.case)}`, graph: `/cases/${path.basename(result.reports.graph)}` };
    res.json(result);
  } catch (error) {
    console.error('Investigation error:', error); res.status(500).json({ status: 'error', error: error.message || 'Internal server error' });
  }
});

app.post('/api/case/:id/comparative-research', async (req, res) => {
  try {
    const result = await runComparativeInvestigation(req.params.id);
    result.reports = { comparativePdf: `/reports/${path.basename(result.reports.comparativePdf)}`, case: `/cases/${path.basename(result.reports.case)}`, graph: `/cases/${path.basename(result.reports.graph)}` };
    res.json({ status: 'success', ...result });
  } catch (error) {
    console.error('Comparative research error:', error); const status = /Case not found/i.test(error.message) ? 404 : 500;
    res.status(status).json({ status: 'error', error: error.message || 'Comparative research failed' });
  }
});

app.get('/api/case/:id', (req, res) => { try { res.json(loadCase(req.params.id)); } catch (_) { res.status(404).json({ status: 'error', error: 'Case not found' }); } });

app.get('/api/case/:id/comparative-report', (req, res) => {
  try {
    const data = loadCase(req.params.id);
    if (!data.comparativeResearch) return res.status(404).json({ status: 'error', error: 'Comparative research has not been run for this case.' });
    res.json({ status: 'success', investigationId: req.params.id, version: data.version, comparativeResearch: data.comparativeResearch, report: data.reports?.comparativePdf || null });
  } catch (_) { res.status(404).json({ status: 'error', error: 'Case not found' }); }
});

app.get('/api/case/:id/graph', (req, res) => {
  try {
    const graph = loadGraph(req.params.id);
    if (!graph) return res.status(404).json({ status: 'error', error: 'Evidence graph has not been created for this case.' });
    res.json({ status: 'success', investigationId: req.params.id, stats: graphStats(graph), graph });
  } catch (_) { res.status(404).json({ status: 'error', error: 'Evidence graph not found.' }); }
});

app.get('/api/case/:id/graph/leads', (req, res) => {
  try {
    const graph = loadGraph(req.params.id);
    if (!graph) return res.status(404).json({ status: 'error', error: 'Evidence graph has not been created for this case.' });
    const min = Number(req.query.min_score || 0.28);
    const leads = (graph.leads || []).filter(x => Number(x.score || 0) >= min).slice(0, 100);
    res.json({ status: 'success', investigationId: req.params.id, leads });
  } catch (_) { res.status(404).json({ status: 'error', error: 'Evidence graph not found.' }); }
});

app.use((req, res) => res.status(404).json({ status: 'error', error: `Route not found: ${req.method} ${req.originalUrl}` }));
const server = app.listen(PORT, HOST, () => console.log(`Government Work Investigation AI v5 listening on ${PORT}`));
server.on('error', error => console.error('Server error:', error));
process.on('SIGINT', () => server.close(() => process.exit(0)));
