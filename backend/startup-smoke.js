'use strict';
const assert = require('node:assert/strict');

(async () => {
  const port = Number(process.env.PORT || 5411);
  process.env.PORT = String(port);
  const { server } = require('./app');
  try {
    await new Promise((resolve, reject) => {
      if (server.listening) return resolve();
      const onError = error => { server.off('listening', onListening); reject(error); };
      const onListening = () => { server.off('error', onError); resolve(); };
      server.once('error', onError);
      server.once('listening', onListening);
    });
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, 'ok');
    console.log(JSON.stringify({ status: 'success', port, version: body.version }, null, 2));
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
