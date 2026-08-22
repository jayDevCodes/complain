const crypto = require('crypto');

function createInvestigationId() {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}`;
}

function source(url, title, publisher, type = 'web', excerpt = '', retrievedAt = new Date().toISOString()) {
  return { id: crypto.createHash('sha256').update(`${url}|${title}`).digest('hex').slice(0, 12), url, title, publisher, type, excerpt, retrievedAt };
}

function evidence(item, kind, confidence = 0, refs = [], note = '') {
  return { item, kind, confidence, refs, note };
}

module.exports = { createInvestigationId, source, evidence };
