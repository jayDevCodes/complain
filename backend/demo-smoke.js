const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const CASE_DIR = path.join(__dirname, 'cases');
const REPORT_DIR = path.join(__dirname, 'reports');

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

function assertStatus(response, expected, label) {
  assert.equal(response.status, expected, `${label}: expected HTTP ${expected}, got ${response.status}: ${JSON.stringify(response.body)}`);
}

async function waitForHealth(port) {
  for (let i = 0; i < 30; i++) {
    try { const result = await request(port, 'GET', '/api/health'); if (result.status === 200) return; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Server did not become healthy within 7.5 seconds');
}

function safeRemove(filePath) { try { fs.rmSync(filePath, { recursive: true, force: true }); } catch (_) {} }

(async () => {
  const port = Number(process.env.PORT || 5311);
  process.env.PORT = String(port);
  const { server } = require('./app');
  await waitForHealth(port);
  let investigationId = null;
  let success = false;

  try {
    assertStatus(await request(port, 'GET', '/api/health'), 200, 'health');

    const full = await request(port, 'POST', '/api/run-full-investigation', {
      latitude: 28.28,
      longitude: 73.73,
      timestamp: new Date().toISOString(),
      photo: png1x1,
      accuracy: 8,
      object_hint: 'road work',
      department: 'PWD'
    });
    assertStatus(full, 200, 'run-full-investigation');
    assert.equal(full.body.status, 'success');
    investigationId = full.body.investigationId;
    assert.ok(investigationId, 'investigationId should be returned');
    assert.deepEqual(full.body.stages.map(x => x.status), ['success', 'success', 'success', 'success']);
    assert.ok(full.body.reports.basePdf, 'base PDF link should exist');
    assert.ok(full.body.reports.comparativePdf, 'comparative PDF link should exist');
    assert.ok(full.body.reports.rtiPdf, 'RTI PDF link should exist');
    assert.ok(full.body.reports.rtiJson, 'RTI JSON link should exist');

    const reports = await request(port, 'GET', `/api/case/${encodeURIComponent(investigationId)}/reports`);
    assertStatus(reports, 200, 'report-manifest');
    assert.ok(reports.body.reports.length >= 6, 'report manifest should expose generated files');

    const graph = await request(port, 'GET', `/api/case/${encodeURIComponent(investigationId)}/graph`);
    assertStatus(graph, 200, 'get-graph');
    assert.ok(graph.body.stats.nodes >= 1, 'graph should contain nodes');

    const rti = await request(port, 'GET', `/api/case/${encodeURIComponent(investigationId)}/rti`);
    assertStatus(rti, 200, 'get-rti');
    assert.ok(rti.body.rti.totalRequests >= 1, 'RTI plan should contain requests');

    assert.equal(fs.existsSync(path.join(REPORT_DIR, path.basename(decodeURIComponent(full.body.reports.basePdf)))), true);

    success = true;
    console.log(JSON.stringify({ status: 'success', investigationId, stages: full.body.stages, reportCount: reports.body.reports.length, rtiRequests: rti.body.rti.totalRequests }, null, 2));
  } finally {
    if (investigationId) {
      for (const name of ['cases', 'reports']) {
        const dir = path.join(__dirname, name);
        if (!fs.existsSync(dir)) continue;
        for (const entry of fs.readdirSync(dir)) if (entry.startsWith(investigationId) || entry.includes(investigationId)) safeRemove(path.join(dir, entry));
      }
      const completionDir = path.join(CASE_DIR, 'completion');
      if (fs.existsSync(completionDir)) for (const entry of fs.readdirSync(completionDir)) if (entry.includes(investigationId)) safeRemove(path.join(completionDir, entry));
    }
    if (server?.listening) await new Promise(resolve => server.close(resolve));
  }

  if (!success) process.exitCode = 1;
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });