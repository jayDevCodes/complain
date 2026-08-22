require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { runInvestigation, REPORT_DIR, CASE_DIR } = require('./agents');

const app = express();
const PORT = Number(process.env.PORT || 5000);
const HOST = '0.0.0.0';

app.use(cors({ origin: true, methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json({ limit: '30mb' }));
app.use('/reports', express.static(REPORT_DIR, { maxAge: '1h', index: false }));
app.use('/cases', express.static(CASE_DIR, { maxAge: '1h', index: false }));

app.get('/', (req, res) => res.json({ status: 'ok', service: 'Government Work Evidence Investigation AI', version: '3.0' }));
app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'government-work-investigation-ai', version: '3.0', time: new Date().toISOString() }));

app.post('/api/start-investigation', async (req, res) => {
  try {
    const { latitude, longitude, timestamp, tender_id, photo, accuracy, object_hint, department } = req.body;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') return res.status(400).json({ status: 'error', error: 'Valid latitude and longitude are required.' });
    if (latitude < -90 || latitude > 90) return res.status(400).json({ status: 'error', error: 'Invalid latitude.' });
    if (longitude < -180 || longitude > 180) return res.status(400).json({ status: 'error', error: 'Invalid longitude.' });
    const result = await runInvestigation({ latitude, longitude, timestamp: timestamp || new Date().toISOString(), tenderId: tender_id || null, photo: photo || null, accuracy: accuracy ?? null, objectHint: object_hint || '', department: department || '' });
    result.reports = {
      pdf: `/reports/${path.basename(result.reports.pdf)}`,
      case: `/cases/${path.basename(result.reports.case)}`
    };
    res.json(result);
  } catch (error) {
    console.error('Investigation error:', error);
    res.status(500).json({ status: 'error', error: error.message || 'Internal server error' });
  }
});

app.get('/api/case/:id', (req, res) => {
  const file = path.join(CASE_DIR, `${path.basename(req.params.id)}.json`);
  if (!require('fs').existsSync(file)) return res.status(404).json({ status: 'error', error: 'Case not found' });
  res.sendFile(file);
});

app.use((req, res) => res.status(404).json({ status: 'error', error: `Route not found: ${req.method} ${req.originalUrl}` }));

const server = app.listen(PORT, HOST, () => console.log(`Government Work Investigation AI listening on ${PORT}`));
server.on('error', error => console.error('Server error:', error));
process.on('SIGINT', () => server.close(() => process.exit(0)));
