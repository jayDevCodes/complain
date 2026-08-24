# Timeout hardening

The outbound timeout previously covered only fetch response headers. A server could send headers and then stall while response.text/json/arrayBuffer was still pending.

The response-timeout guard now covers the complete response lifecycle, including body consumption.

Regression coverage: `timeout-smoke.js` delays the response body and verifies the request is interrupted within the configured timeout.