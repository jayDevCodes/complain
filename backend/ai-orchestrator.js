require('dotenv').config();

const MODEL_CONFIGS = [
  { name: 'OpenAI', key: 'OPENAI_API_KEY', base: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1', model: process.env.OPENAI_MODEL || 'gpt-5.6' },
  { name: 'Gemini', key: 'GEMINI_API_KEY', base: process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai', model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' },
  { name: 'Anthropic', key: 'ANTHROPIC_API_KEY', base: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1', model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5' },
  { name: 'DeepSeek', key: 'DEEPSEEK_API_KEY', base: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com', model: process.env.DEEPSEEK_MODEL || 'deepseek-reasoner' }
];

function promptFor(stage, payload) {
  return `You are an evidence-first government-work investigator. Stage: ${stage}.\nRules: distinguish OBSERVED, DOCUMENTED, VERIFIED, INFERRED, ALLEGED and UNKNOWN. Never invent tender numbers, contractors, prices, officers, measurements or defects. A photo alone cannot prove corruption. State what evidence would confirm each inference. Prefer primary government records and exact source URLs.\nCase payload:\n${JSON.stringify(payload, null, 2)}`;
}

async function callOpenAICompatible(config, messages, imageDataUrl) {
  if (!process.env[config.key]) return { provider: config.name, status: 'not_configured' };
  const content = [{ type: 'text', text: messages }];
  if (imageDataUrl) content.push({ type: 'image_url', image_url: { url: imageDataUrl } });
  const response = await fetch(`${config.base.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env[config.key]}` },
    body: JSON.stringify({ model: config.model, temperature: 0.1, messages: [{ role: 'system', content: 'Return strict JSON where possible. Be conservative with claims.' }, { role: 'user', content }], response_format: { type: 'json_object' } })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${config.name} HTTP ${response.status}: ${text.slice(0, 500)}`);
  const data = JSON.parse(text);
  const raw = data.choices?.[0]?.message?.content || '{}';
  try { return { provider: config.name, model: config.model, status: 'ok', result: JSON.parse(raw) }; }
  catch { return { provider: config.name, model: config.model, status: 'ok', result: { raw } }; }
}

async function runParallelModels(stage, payload, imageDataUrl = null) {
  const prompt = promptFor(stage, payload);
  const results = await Promise.all(MODEL_CONFIGS.map(async cfg => {
    try { return await callOpenAICompatible(cfg, prompt, imageDataUrl); }
    catch (error) { return { provider: cfg.name, status: 'error', error: error.message }; }
  }));
  const usable = results.filter(x => x.status === 'ok');
  return { stage, results, configuredCount: usable.length };
}

function consensus(results) {
  const usable = results.filter(x => x.status === 'ok').map(x => x.result);
  if (!usable.length) return { status: 'unavailable', claims: [], note: 'No AI provider is configured.' };
  const claims = [];
  const buckets = new Map();
  for (const result of usable) {
    const candidates = result.claims || result.findings || [];
    for (const c of candidates) {
      const text = typeof c === 'string' ? c : (c.claim || c.finding || JSON.stringify(c));
      const key = text.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
      if (!key) continue;
      if (!buckets.has(key)) buckets.set(key, { claim: text, models: [] });
      buckets.get(key).models.push(result.provider || 'unknown');
    }
  }
  for (const b of buckets.values()) claims.push({ ...b, agreement: b.models.length / usable.length });
  return { status: 'ok', claims: claims.sort((a, b) => b.agreement - a.agreement) };
}

module.exports = { runParallelModels, consensus };
