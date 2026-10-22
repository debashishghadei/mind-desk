'use strict';
// Your own API key for Claude (Anthropic) or ChatGPT (OpenAI). The key stays on the server; the browser only gets the answer.
// Every request's cost is counted from the token counts the service reports; at the monthly limit requests stop.
const MODELS = require('./models.json');
const { httpErr } = require('./auth');

function makeAI(files, opts = {}) {
  const SECRETS = 'secrets.json'; const USAGE = 'usage.json';
  const now = opts.now || (() => Date.now());
  const urls = { anthropic: process.env.MD_ANTHROPIC_URL || 'https://api.anthropic.com', openai: process.env.MD_OPENAI_URL || 'https://api.openai.com' };
  let secrets = files.readJSON(SECRETS, {});
  let usage = files.readJSON(USAGE, { limitUsd: 5, months: {} });
  const month = () => new Date(now()).toISOString().slice(0, 7);
  const cur = () => usage.months[month()] || { usd: 0, requests: 0, byModel: {} };

  function settings() {
    const keys = {};
    for (const v of ['anthropic', 'openai']) { const k = secrets[v] && secrets[v].key; keys[v] = k ? { set: true, last4: k.slice(-4) } : { set: false }; }
    const m = cur();
    return { keys, limitUsd: usage.limitUsd, month: { name: month(), usd: round(m.usd), requests: m.requests, byModel: m.byModel } };
  }
  function update(body) {
    if (body.vendor !== undefined) {
      if (!MODELS[body.vendor] || body.vendor === 'defaults') throw httpErr(400, 'Unknown service.');
      const key = String(body.key || '').trim();
      if (key && (key.length < 20 || key.length > 300 || /\s/.test(key))) throw httpErr(400, 'That does not look like an API key.');
      if (key) secrets[body.vendor] = { key, savedAt: now() }; else delete secrets[body.vendor];
      files.writeNow(SECRETS, secrets, 0o600);
    }
    if (body.limitUsd !== undefined) {
      const v = Number(body.limitUsd); if (!(v >= 0 && v <= 10000)) throw httpErr(400, 'The limit must be between 0 and 10,000.');
      usage.limitUsd = v; files.writeJSON(USAGE, usage);
    }
    return settings();
  }
  function priceOf(vendor, model, inTok, outTok) {
    const m = MODELS[vendor].find((x) => x.id === model); if (!m) return 0;
    const p = m.longPrice && inTok > m.longFrom ? m.longPrice : m.price;
    return (inTok * p[0] + outTok * p[1]) / 1e6;
  }
  function record(vendor, model, inTok, outTok) {
    const usd = priceOf(vendor, model, inTok, outTok); const k = month();
    const m = usage.months[k] = usage.months[k] || { usd: 0, requests: 0, byModel: {} };
    m.usd += usd; m.requests++; const b = m.byModel[model] = m.byModel[model] || { usd: 0, requests: 0, inTok: 0, outTok: 0 };
    b.usd += usd; b.requests++; b.inTok += inTok; b.outTok += outTok;
    const keys = Object.keys(usage.months).sort(); while (keys.length > 24) delete usage.months[keys.shift()];
    files.writeJSON(USAGE, usage);
    return usd;
  }
  const round = (x) => Math.round(x * 1e8) / 1e8;

  /** run one request and stream the answer as lines of JSON: {"t":"text"} … then {"done":true,…} or {"error":…} */
  async function run(body, res, signal) {
    const vendor = body.vendor; const model = String(body.model || '');
    if (!MODELS[vendor] || vendor === 'defaults') throw httpErr(400, 'Unknown service.', 'bad_request');
    if (!MODELS[vendor].some((m) => m.id === model)) throw httpErr(400, 'Unknown model ' + model + '.', 'bad_request');
    const prompt = String(body.prompt || ''); if (!prompt.trim()) throw httpErr(400, 'Empty request.', 'bad_request');
    if (prompt.length > 1200000) throw httpErr(413, 'This is too much text for one request.', 'too_large');
    const key = secrets[vendor] && secrets[vendor].key;
    if (!key) throw httpErr(400, `No ${vendor === 'openai' ? 'OpenAI' : 'Anthropic'} API key is saved yet. Add it in Settings → AI connection.`, 'no_key');
    if (cur().usd >= usage.limitUsd) throw httpErr(402, `This month’s limit of $${usage.limitUsd} is reached ($${round(cur().usd)} used). Raise it in Settings or wait for next month.`, 'limit_reached');

    const upstream = vendor === 'anthropic'
      ? await fetch(urls.anthropic + '/v1/messages', {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(Object.assign({ model, max_tokens: 32000, stream: true, messages: [{ role: 'user', content: prompt }] }, body.careful ? {} : { output_config: { effort: 'low' } })),
      })
      : await fetch(urls.openai + '/v1/chat/completions', {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
        body: JSON.stringify({ model, stream: true, stream_options: { include_usage: true }, max_completion_tokens: 32000, messages: [{ role: 'user', content: prompt }] }),
      });
    if (!upstream.ok) {
      const t = await upstream.text().catch(() => '');
      let msg = ''; try { const j = JSON.parse(t); msg = (j.error && (j.error.message || j.error.type)) || ''; } catch (e) { msg = t.slice(0, 200); }
      const s = upstream.status;
      if (s === 401 || s === 403) throw httpErr(400, 'The API key was refused. Check it in Settings.', 'bad_key');
      if (s === 429) throw httpErr(429, 'The AI service says: too many requests or no quota left. Wait a little, or check your account there.', 'rate_limited');
      if (s === 402 || /credit|billing|quota/i.test(msg)) throw httpErr(402, 'Your API account has no credit left: ' + msg, 'no_credit');
      if (s === 400 || s === 404) throw httpErr(400, 'The AI service did not accept the request: ' + msg, 'bad_request');
      throw httpErr(502, 'The AI service had a problem (' + s + '). Try again in a moment.', 'upstream_error');
    }
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    let inTok = 0, outTok = 0, chars = 0, truncated = false, failure = null;
    const send = (o) => { try { res.write(JSON.stringify(o) + '\n'); } catch (e) { /* the browser left */ } };
    const dec = new TextDecoder(); let buf = '';
    const onData = (data) => {
      let o; try { o = JSON.parse(data); } catch (e) { return; }
      if (vendor === 'anthropic') {
        if (o.type === 'message_start' && o.message && o.message.usage) { const u = o.message.usage; inTok = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0); outTok = u.output_tokens || 0; }
        else if (o.type === 'content_block_delta' && o.delta && o.delta.type === 'text_delta') { chars += o.delta.text.length; send({ t: o.delta.text }); }
        else if (o.type === 'message_delta') { if (o.usage && o.usage.output_tokens != null) outTok = o.usage.output_tokens; if (o.delta && o.delta.stop_reason === 'max_tokens') truncated = true; if (o.delta && o.delta.stop_reason === 'refusal') failure = { code: 'refused', error: 'The AI declined to answer this text.' }; }
        else if (o.type === 'error') failure = { code: 'upstream_error', error: (o.error && o.error.message) || 'The AI service reported an error.' };
      } else {
        const ch = o.choices && o.choices[0];
        if (ch && ch.delta && typeof ch.delta.content === 'string' && ch.delta.content) { chars += ch.delta.content.length; send({ t: ch.delta.content }); }
        if (ch && ch.finish_reason === 'length') truncated = true;
        if (o.usage) { inTok = o.usage.prompt_tokens || 0; outTok = o.usage.completion_tokens || 0; }
        if (o.error) failure = { code: 'upstream_error', error: o.error.message || 'The AI service reported an error.' };
      }
    };
    try {
      for await (const chunk of upstream.body) {
        buf += dec.decode(chunk, { stream: true });
        let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line.startsWith('data:')) { const d = line.slice(5).trim(); if (d && d !== '[DONE]') onData(d); } }
      }
    } catch (e) { if (!failure) failure = { code: signal && signal.aborted ? 'cancelled' : 'upstream_error', error: 'The answer stopped before it was complete.' }; }
    // count the cost even when the stream broke; without token counts, estimate from the text (about 3.5 characters per token)
    if (!inTok) inTok = Math.ceil(prompt.length / 3.5);
    if (!outTok) outTok = Math.ceil(chars / 3.5);
    const cost = record(vendor, model, inTok, outTok);
    if (failure) send({ error: failure.error, code: failure.code });
    else send({ done: true, model, cost: round(cost), month: round(cur().usd), truncated, inTok, outTok });
    res.end();
  }
  return { settings, update, run, priceOf };
}
module.exports = { makeAI, MODELS };
