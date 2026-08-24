# Backend startup and timeout fix

The previous timeout implementation stopped its timer as soon as `fetch()` returned response headers. Slow/stalled response bodies could therefore bypass the timeout.

The repository now loads `response-timeout-guard.js` before `app.js`, protects response body consumption as well as headers, and includes startup/health and timeout regression smoke tests in CI.
