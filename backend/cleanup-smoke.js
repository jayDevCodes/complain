const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const CASE_DIR = path.join(__dirname, 'cases');
const REPORT_DIR = path.join(__dirname, 'reports');

function request(port, method, route, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: route,
      method,
      headers: { Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) }
    }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => { let parsed = data; try { parsed = JSON.parse(data); } catch (_) {} resolve({ status: res.statusCode, body: parsed }); });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

(async () => {
  const port = Number(process.env.PORT || 5322);
  process.env.PORT = String(port);
  const { server } = require('./app');
  const files = [path.join(CASE_DIR, '__cleanup_smoke_case.json'), path.join(REPORT_DIR, '__cleanup_smoke_report.txt')];
  try {
    fs.mkdirSync(CASE_DIR, { recursive: true });
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(files[0], JSON.stringify({ smoke: true }));
    fs.writeFileSync(files[1], 'smoke');

    const preview = await request(port, 'GET', '/api/data-status');
    assert.equal(preview.status, 200);
    assert.ok(preview.body.files >= 2);

    const blocked = await request(port, 'DELETE', '/api/cleanup-old-data', { confirm: false });
    assert.equal(blocked.status, 400);
    assert.equal(fs.existsSync(files[0]), true);
    assert.equal(fs.existsSync(files[1]), true);

    const cleaned = await request(port, 'DELETE', '/api/cleanup-old-data', { confirm: true });
    assert.equal(cleaned.status, 200);
    assert.equal(cleaned.body.status, 'success');

    const after = await request(port, 'GET', '/api/data-status');
    assert.equal(after.status, 200);
    assert.equal(after.body.files, 0);
    assert.equal(after.body.bytes, 0);

    console.log(JSON.stringify({ status: 'success', deletedFiles: cleaned.body.before.files, deletedBytes: cleaned.body.before.bytes }, null, 2));
  } finally {
    for (const file of files) { try { fs.rmSync(file, { force: true }); } catch (_) {} }
    if (server?.listening) await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });