require('dotenv').config();

const MODEL_CONFIGS = [
  { name: 'OpenAI', key: 'OPENAI_API_KEY', base: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1', model: process.env.OPENAI_MODEL || 'gpt-5.6' },
  { name: 'Gemini', key: 'GEMINI_API_KEY', base: process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai', model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' },
  { name: 'Anthropic', key: 'ANTHROPIC_API_KEY', base: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1', model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5' },
  { name: 'DeepSeek', key: 'DEEPSEEK_API_KEY', base: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com', model: process.env.DEEPSEEK_MODEL || 'deepseek-reasoner' }
];

const MODEL_TIMEOUT_MS = Number(process.env.AI_PROVIDER_TIMEOUT_MS || 45000);

function promptFor(stage, payload) {
  return `You are an evidence-first government-work investigator. Stage: ${stage}.\n\nPHOTO ROBUSTNESS RULES:\n- The supplied field photo may be portrait, landscape, rotated, tilted, taken from the side, close-up, wide-angle, partially obstructed, low-light, or framed imperfectly.\n- Never reject or downgrade a photo merely because its camera angle/orientation is unusual.\n- First inspect whatever portion of the work/object is actually visible and extract only defensible observations.\n- Perspective distortion is normal in field photography. Do not treat perspective alone as a defect.\n- If a measurement, material property, identity, or other fact cannot be established from the visible image, mark it UNKNOWN/NEEDS_SOURCE_CORROBORATION instead of guessing.\n- When the view is insufficient, explain exactly what additional record, measurement, second photograph, or test would resolve the uncertainty.\n- Do not invent tender numbers, contractors, prices, officers, measurements or defects. A photo alone cannot prove corruption.\n- Distinguish OBSERVED, DOCUMENTED, VERIFIED, INFERRED, ALLEGED and UNKNOWN.\n- Prefer primary government records and exact source URLs.\n\nCase payload:\n${JSON.stringify(payload, null, 2)}`;
}

function parseModelJSON(raw) {
  try { return JSON.parse(raw); } catch (_) {
    const m = String(raw).match(/```(?:json)?\\s*([\\s\\S]*?)\\s*```/i);
    if (m) { try { return JSON.parse(m[1]); } catch (_) {} }
    return { raw };
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = MODEL_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function callOpenAICompatible(config, prompt, imageDataUrl) {
  if (!process.env[config.key]) return { provider: config.name, status: 'not_configured' };
  const content = [{ type: 'text', text: prompt }];
  if (imageDataUrl) content.push({ type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } });
  const response = await fetchWithTimeout(`${config.base.replace(/\\/$/, '')}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env[config.key]}` }, body: JSON.stringify({ model: config.model, temperature: 0.1, messages: [{ role: 'system', content: 'Return strict JSON where possible. Be conservative with claims and tolerant of normal field-photo orientation/perspective.' }, { role: 'user', content }], response_format: { type: 'json_object' } }) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${config.name} HTTP ${response.status}: ${text.slice(0, 500)}`);
  const data = JSON.parse(text);
  return { provider: config.name, model: config.model, status: 'ok', result: parseModelJSON(data.choices?.[0]?.message?.content || '{}') };
}

async function callAnthropic(config, prompt, imageDataUrl) {
  if (!process.env[config.key]) return { provider: config.name, status: 'not_configured' };
  const content = [{ type: 'text', text: prompt }];
  const m = imageDataUrl?.match(/^data:image\\/(png|jpe?g|webp);base64,(.+)$/i);
  if (m) content.unshift({ type: 'image', source: { type: 'base64', media_type: `image/${m[1].toLowerCase() === 'jpg' ? 'jpeg' : m[1].toLowerCase()}`, data: m[2] } });
  const response = await fetchWithTimeout(`${config.base.replace(/\\/$/, '')}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': process.env[config.key], 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: config.model, max_tokens: 4096, temperature: 0.1, system: 'Return strict JSON where possible. Be conservative with claims and tolerant of normal field-photo orientation/perspective.', messages: [{ role: 'user', content }] }) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${config.name} HTTP ${response.status}: ${text.slice(0, 500)}`);
  const data = JSON.parse(text);
  return { provider: config.name, model: config.model, status: 'ok', result: parseModelJSON(data.content?.map(x => x.text || '').join('') || '{}') };
}

async function runProvider(config, prompt, imageDataUrl) { return config.name === 'Anthropic' ? callAnthropic(config, prompt, imageDataUrl) : callOpenAICompatible(config, prompt, imageDataUrl); }

async function runParallelModels(stage, payload, imageDataUrl = null) {
  const prompt = promptFor(stage, payload);
  const results = await Promise.all(MODEL_CONFIGS.map(async cfg => {
    try { return await runProvider(cfg, prompt, imageDataUrl); }
    catch (error) {
      const message = error?.name === 'AbortError' ? `timeout after ${MODEL_TIMEOUT_MS}ms` : (error.message || String(error));
      return { provider: cfg.name, status: 'error', error: message };
    }
  }));
  return { stage, results, configuredCount: results.filter(x => x.status === 'ok').length };
}

function consensus(results) {
  const usable = results.filter(x => x.status === 'ok');
  if (!usable.length) return { status: 'unavailable', claims: [], note: 'No AI provider is configured.' };
  const buckets = new Map();
  for (const item of usable) {
    const result = item.result || {};
    const candidates = result.claims || result.findings || result.defects || result.comparison || [];
    for (const c of candidates) {
      const text = typeof c === 'string' ? c : (c.claim || c.finding || c.defect || JSON.stringify(c));
      const key = text.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
      if (!key) continue;
      if (!buckets.has(key)) buckets.set(key, { claim: text, models: [] });
      buckets.get(key).models.push(item.provider);
    }
  }
  const claims = [...buckets.values()].map(b => ({ ...b, agreement: b.models.length / usable.length })).sort((a, b) => b.agreement - a.agreement);
  return { status: 'ok', claims };
}

module.exports = { runParallelModels, consensus };
