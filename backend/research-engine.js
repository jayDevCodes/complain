require('dotenv').config();
const { source } = require('./investigation-schema');

const SEARCH_TIMEOUT_MS = Number(process.env.SEARCH_PROVIDER_TIMEOUT_MS || 20000);

async function fetchWithTimeout(url, options = {}, timeoutMs = SEARCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Search request timed out after ${timeoutMs}ms`)), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function searchWeb(query, limit = 8) {
  if (process.env.TAVILY_API_KEY) {
    const r = await fetchWithTimeout('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, search_depth: 'advanced', max_results: limit, include_answer: false }) });
    if (!r.ok) throw new Error(`Tavily HTTP ${r.status}`);
    const d = await r.json();
    return (d.results || []).map(x => source(x.url, x.title || '', new URL(x.url).hostname, 'web', x.content || ''));
  }
  if (process.env.SERPER_API_KEY) {
    const r = await fetchWithTimeout('https://google.serper.dev/search', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-KEY': process.env.SERPER_API_KEY }, body: JSON.stringify({ q: query, num: limit }) });
    if (!r.ok) throw new Error(`Serper HTTP ${r.status}`);
    const d = await r.json();
    return (d.organic || []).map(x => source(x.link, x.title || '', new URL(x.link).hostname, 'web', x.snippet || ''));
  }
  return [];
}

function buildQueries({ location, objectDescription = '', department = '', tenderId = '' }) {
  const place = [location?.village, location?.town, location?.district, location?.state].filter(Boolean).join(' ');
  const q = [objectDescription, place, department].filter(Boolean).join(' ');
  return [
    `${q} tender work order BOQ`,
    `${q} site inspection completion certificate measurement book`,
    `${q} contractor awarded tender amount`,
    `${q} quality test report payment bill`,
    `${q} eprocurement Rajasthan tender`,
    tenderId ? `"${tenderId}"` : `${q} tender notice PDF`
  ];
}

async function researchLocation(caseData) {
  const queries = buildQueries(caseData);
  const groups = await Promise.all(queries.map(q => searchWeb(q).catch(error => [{ error: error.message, query: q }])));
  const all = groups.flat();
  const unique = [...new Map(all.filter(x => x.url).map(x => [x.url, x])).values()];
  return { queries, sources: unique };
}

module.exports = { searchWeb, buildQueries, researchLocation };
