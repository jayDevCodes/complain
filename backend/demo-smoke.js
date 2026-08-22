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
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          display_name: 'Demo Work Site, Lunkaransar, Bikaner, Rajasthan, India',
          address: {
            village: 'Demo Village',
            town: 'Lunkaransar',
            county: 'Bikaner',
            state: 'Rajasthan',
            country: 'India',
            postcode: '334603'
          }
        };
      }
    };
  }
  return originalFetch(url, options);
};

const png1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function request(port, method, route, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port, path: route, method,
      headers: {
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = data;
        try { parsed = JSON.parse(data); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
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
    try {
      const result = await request(port, 'GET', '/api/health');
      if (result.status === 200) return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Server did not become healthy within 7.5 seconds');
}

function safeRemove(filePath) {
  try { fs.rmSync(filePath, { recursive: true, force: true }); } catch (_) {}
}

(async () => {
  const port = Number(process.env.PORT || 5311);
  process.env.PORT = String(port);

  const { server } = require('./app');
  await waitForHealth(port);

  let investigationId = null;
  let success = false;

  try {
    const health = await request(port, 'GET', '/api/health');
    assertStatus(health, 200, 'health');
    assert.equal(health.body.status, 'ok');

    const started = await request(port, 'POST', '/api/start-investigation', {
      latitude: 28.28,
      longitude: 73.73,
      timestamp: new Date().toISOString(),
      photo: png1x1,
      accuracy: 8,
      object_hint: 'road work',
      department: 'PWD'
    });
    assertStatus(started, 200, 'start-investigation');
    assert.equal(started.body.status, 'success');
    investigationId = started.body.investigationId;
    assert.ok(investigationId, 'investigationId should be returned');

    const pdfPath = path.join(REPORT_DIR, path.basename(started.body.reports.pdf));
    const casePath = path.join(CASE_DIR, path.basename(started.body.reports.case));
    const graphPath = path.join(CASE_DIR, path.basename(started.body.reports.graph));
    assert.ok(fs.existsSync(pdfPath), 'initial PDF should be generated');
    assert.ok(fs.existsSync(casePath), 'case JSON should be generated');
    assert.ok(fs.existsSync(graphPath), 'graph JSON should be generated');

    assertStatus(await request(port, 'GET', `/api/case/${encodeURIComponent(investigationId)}`), 200, 'get-case');

    const graphResponse = await request(port, 'GET', `/api/case/${encodeURIComponent(investigationId)}/graph`);
    assertStatus(graphResponse, 200, 'get-graph');
    assert.ok(graphResponse.body.stats.nodes >= 1, 'graph should contain nodes');

    assertStatus(await request(port, 'GET', `/api/case/${encodeURIComponent(investigationId)}/graph/leads?min_score=0`), 200, 'get-graph-leads');

    const comparative = await request(port, 'POST', `/api/case/${encodeURIComponent(investigationId)}/comparative-research`);
    assertStatus(comparative, 200, 'comparative-research');
    assert.ok(comparative.body.reports.comparativePdf, 'comparative PDF URL should be returned');
    assertStatus(await request(port, 'GET', `/api/case/${encodeURIComponent(investigationId)}/comparative-report`), 200, 'comparative-report');

    const crossCase = await request(port, 'POST', `/api/case/${encodeURIComponent(investigationId)}/cross-case-intelligence`);
    assertStatus(crossCase, 200, 'cross-case-intelligence');
    assert.ok(crossCase.body.graphFile, 'cross-case graph URL should be returned');

    const complete = await request(port, 'POST', `/api/case/${encodeURIComponent(investigationId)}/complete-evidence-plan`);
    assertStatus(complete, 200, 'complete-evidence-plan');
    assert.ok(complete.body.reports.rtiPdf, 'RTI PDF URL should be returned');
    assert.ok(complete.body.reports.rtiJson, 'RTI JSON URL should be returned');

    const rti = await request(port, 'GET', `/api/case/${encodeURIComponent(investigationId)}/rti`);
    assertStatus(rti, 200, 'get-rti');
    assert.ok(rti.body.rti.totalRequests >= 1, 'RTI plan should contain requests');

    const globalGraph = await request(port, 'GET', '/api/cross-case-graph');
    assertStatus(globalGraph, 200, 'cross-case-graph');
    assert.equal(typeof globalGraph.body.stats.cases, 'number');

    success = true;
    console.log(JSON.stringify({
      status: 'success',
      investigationId,
      checks: [
        'health', 'start-investigation', 'PDF generation', 'case persistence',
        'evidence graph', 'graph leads', 'comparative research + PDF',
        'cross-case intelligence', 'RTI evidence completion + PDF/JSON',
        'cross-case graph endpoint'
      ]
    }, null, 2));
  } finally {
    if (investigationId) {
      for (const name of ['cases', 'reports']) {
        const dir = path.join(__dirname, name);
        if (!fs.existsSync(dir)) continue;
        for (const entry of fs.readdirSync(dir)) {
          if (entry.startsWith(investigationId) || entry.includes(investigationId)) safeRemove(path.join(dir, entry));
        }
      }
      const completionDir = path.join(CASE_DIR, 'completion');
      if (fs.existsSync(completionDir)) {
        for (const entry of fs.readdirSync(completionDir)) {
          if (entry.includes(investigationId)) safeRemove(path.join(completionDir, entry));
        }
      }
    }
    if (server?.listening) {
      await new Promise(resolve => server.close(resolve));
    }
  }

  if (!success) process.exitCode = 1;
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
