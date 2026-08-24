'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');

(async () => {
  const old = process.env.GLOBAL_FETCH_TIMEOUT_MS;
  process.env.GLOBAL_FETCH_TIMEOUT_MS = '300';
  const { timeoutMs } = require('./response-timeout-guard');
  assert.equal(timeoutMs, 300);

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.write('headers-ready');
    setTimeout(() => res.end('body-late'), 2000);
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const started = Date.now();

  try {
    const response = await fetch(url);
    await assert.rejects(() => response.text(), /timed out|aborted/i);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 1200, `response body timeout took too long: ${elapsed}ms`);
    console.log(JSON.stringify({ status: 'success', timeoutMs: 300, elapsedMs: elapsed }, null, 2));
  } finally {
    server.close();
    if (old == null) delete process.env.GLOBAL_FETCH_TIMEOUT_MS;
    else process.env.GLOBAL_FETCH_TIMEOUT_MS = old;
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
