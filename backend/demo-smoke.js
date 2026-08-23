const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const CASE_DIR = path.join(__dirname, 'cases');
const REPORT_DIR = path.join(__dirname, 'reports');
const DEEP_RESEARCH_ROUND_LIMIT = Number(process.env.DEEP_RESEARCH_ROUNDS || 4);

const originalFetch = global.fetch;
global.fetch = async (url, options) => {
  const target = String(url);
  if (target.startsWith('https://nominatim.openstreetmap.org/reverse')) {
    return { ok: true, status: 200, async json() { return { display_name: 'Demo Work Site, Lunkaransar, Bikaner, Rajasthan, India', address: { village: 'Demo Village', town: 'Lunkaransar', county: 'Bikaner', state: 'Rajasthan', country: 'India', postcode: '334603' } }; } };
  }
  return originalFetch(url, options);
};

const png1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function request(port, method, route, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const req = http.request({ hostname: '127.0.0.1', port, path: route, method, headers: { Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) } }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => { let parsed = data; try { parsed = JSON.parse(data); } catch (_) {} resolve({ status: res.statusCode, headers: res.headers, body: parsed }); });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
function assertStatus(response, expected, label) { assert.equal(response.status, expected, `${label}: expected HTTP ${expected}, got ${response.status}: ${JSON.stringify(response.body)}`); }
async function waitForHealth(port) { for (let i = 0; i < 30; i++) { try { const result = await request(port, 'GET', '/api/health'); if (result.status === 200) return; } catch (_) {} await new Promise(resolve => setTimeout(resolve, 250)); } throw new Error('Server did not become healthy within 7.5 seconds'); }
function safeRemove(filePath) { try { fs.rmSync(filePath, { recursive: true, force: true }); } catch (_) {} }

(async () => {
  const port = Number(process.env.PORT || 5311);
  process.env.PORT = String(port);
  const { runDeepResearch, tenderFacts, queryVariants } = require('./deep-research-engine');
  const probe = { tender: { tenderId: '2025_CEPWD_490235_2', workName: 'Road renewal', contractor: 'Demo Contractor', estimatedCost: '5400000', workOrder: 'WO-123' }, location: { village: 'Malkisar', district: 'Bikaner', state: 'Rajasthan' }, department: 'PWD', comparison: [{ item: 'Road thickness', expected: 'as per BOQ', observed: 'unknown', gap: 'measurement required' }] };
  const probeFacts = tenderFacts(probe); const probeQueries = queryVariants(probeFacts, probe).map(x => x.query).join('\n');
  assert.match(probeQueries, /2025_CEPWD_490235_2/); assert.match(probeQueries, /work order/i); assert.match(probeQueries, /BOQ/i); assert.match(probeQueries, /measurement/i); assert.match(probeQueries, /payment/i);
  const probeResearch = await runDeepResearch(probe);
  assert.ok(probeResearch.rounds.length >= 1, 'deep research should execute at least one round');

  const { server } = require('./app');
  await waitForHealth(port);
  let investigationId = null; let success = false;

  try {
    assertStatus(await request(port, 'GET', '/api/health'), 200, 'health');
    const full = await request(port, 'POST', '/api/run-full-investigation', {
      latitude: 28.28,
      longitude: 73.73,
      timestamp: new Date().toISOString(),
      tender_id: '2025_CEPWD_490235_2',
      photo: png1x1,
      accuracy: 8,
      object_hint: 'road renewal work',
      department: 'PWD'
    });
    assertStatus(full, 200, 'run-full-investigation');
    assert.equal(full.body.status, 'success');
    investigationId = full.body.investigationId;
    assert.ok(investigationId, 'investigationId should be returned');
    assert.deepEqual(full.body.stages.map(x => x.status), ['success', 'success', 'success', 'success']);
    assert.ok(full.body.deepResearch?.rounds?.length >= 1, 'deep research rounds should be returned');
    assert.ok(full.body.evidenceLedger?.stats, 'evidence ledger stats should be returned');
    assert.ok(full.body.reports.basePdf, 'base PDF link should exist');
    assert.ok(full.body.reports.comparativePdf, 'comparative PDF link should exist');
    assert.ok(full.body.reports.rtiPdf, 'RTI PDF link should exist');
    assert.ok(full.body.reports.masterPdf, 'final master PDF link should exist');
    assert.ok(full.body.reports.evidenceLedger, 'evidence ledger link should exist');
    assert.ok(Number(full.body.deepResearch.rounds.length) <= DEEP_RESEARCH_ROUND_LIMIT + 1, 'deep research round count should respect configured limit plus contradiction pass');

    const reports = await request(port, 'GET', `/api/case/${encodeURIComponent(investigationId)}/reports`);
    assertStatus(reports, 200, 'report-manifest');
    assert.ok(reports.body.reports.length >= 8, 'report manifest should expose deep/final artifacts');

    const graph = await request(port, 'GET', `/api/case/${encodeURIComponent(investigationId)}/graph`);
    assertStatus(graph, 200, 'get-graph');
    assert.ok(graph.body.stats.nodes >= 1, 'graph should contain nodes');

    const rti = await request(port, 'GET', `/api/case/${encodeURIComponent(investigationId)}/rti`);
    assertStatus(rti, 200, 'get-rti');
    assert.ok(rti.body.rti.totalRequests >= 1, 'RTI plan should contain requests');

    assert.equal(fs.existsSync(path.join(REPORT_DIR, path.basename(decodeURIComponent(full.body.reports.masterPdf)))), true, 'master PDF file should exist');
    assert.equal(fs.existsSync(path.join(CASE_DIR, path.basename(decodeURIComponent(full.body.reports.evidenceLedger)))), true, 'evidence ledger file should exist');

    success = true;
    console.log(JSON.stringify({ status: 'success', investigationId, stages: full.body.stages, deepResearchRounds: full.body.deepResearch.rounds.length, reportCount: reports.body.reports.length, readinessScore: full.body.evidenceLedger.stats.readinessScore, rtiRequests: rti.body.rti.totalRequests }, null, 2));
  } finally {
    if (investigationId) {
      for (const name of ['cases', 'reports']) { const dir = path.join(__dirname, name); if (!fs.existsSync(dir)) continue; for (const entry of fs.readdirSync(dir)) if (entry.startsWith(investigationId) || entry.includes(investigationId)) safeRemove(path.join(dir, entry)); }
      const completionDir = path.join(CASE_DIR, 'completion'); if (fs.existsSync(completionDir)) for (const entry of fs.readdirSync(completionDir)) if (entry.includes(investigationId)) safeRemove(path.join(completionDir, entry));
    }
    if (server?.listening) await new Promise(resolve => server.close(resolve));
  }
  if (!success) process.exitCode = 1;
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });