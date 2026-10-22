'use strict';
// Stand-in for the Anthropic and OpenAI APIs (streaming), for tests/cloud-tests.js.
// Answers like the artifact stand-in: it reads the JSON format line in the prompt.
const http = require('http');

const state = { log: [], fail: null, hang: false, keyOk: 'sk-ant-test-key-1234567890abcd', openaiKey: 'sk-test-openai-key-1234567890' };
const sections = (s) => { const out = []; const re = /=== NOTE (\S+) ===\n([\s\S]*?)(?=\n=== NOTE |$)/g; let m; while ((m = re.exec(s))) out.push({ id: m[1], body: m[2] }); return out; };
const between = (s, a, b) => { const i = s.indexOf(a); if (i < 0) return ''; const j = s.indexOf(b, i + a.length); return s.slice(i + a.length, j < 0 ? undefined : j); };
const fix = (t) => t.replace(/\bteh\b/g, 'the').replace(/\bmov eon\b/g, 'move on').replace(/\bthinkign\b/g, 'thinking').replace(/\bmeetign\b/g, 'meeting').replace(/\buniver(s)\b/g, 'universe').replace(/\bwnat\b/g, 'want').replace(/\bbulid\b/g, 'build').replace(/\btomorow\b/g, 'tomorrow');
function organize(text) {
  const t = text.trim(); const lower = t.toLowerCase();
  const category = /buy|milk|shirt|clean/.test(lower) ? 'todo' : /ceo|owner|powerpoint|meeting|ravi/.test(lower) ? 'job' : /fear|mind|univers|trust/.test(lower) ? 'mind' : /gym/.test(lower) ? 'personal' : 'unsorted';
  const tasks = [];
  if (/buy milk/.test(lower)) tasks.push({ text: 'Buy milk and eggs', done: false, category: 'todo-shopping' });
  if (/powerpoint/.test(lower)) tasks.push({ text: 'Make PowerPoint for owner', done: false, category: 'todo-job' });
  return { title: fix(t).split(/\s+/).slice(0, 5).join(' ').replace(/[:.]+$/, ''), category, tasks, text: fix(t) };
}
function answer(s) {
  if (s.includes('{"notes":[{"id":"note id","starts"')) return JSON.stringify({ notes: sections(s).map((n) => { const starts = []; const re = /^\[(\d+)\]( \(same paragraph\))?$/gm; let m; while ((m = re.exec(n.body))) if (!m[2]) starts.push(+m[1]); return { id: n.id, starts }; }) });
  if (s.includes('{"questions":[')) return JSON.stringify({ questions: [] });
  if (s.includes('{"results":[{"id":"note id"')) return JSON.stringify({ results: sections(s).map((n) => Object.assign({ id: n.id }, organize(between(n.body, '<<<\n', '\n>>>')))) });
  if (s.includes('Answer only with JSON: {"title":""')) return JSON.stringify(organize(between(s, 'Note:\n<<<\n', '\n>>>')));
  if (s.includes('Answer only with JSON: {"text":""}')) return JSON.stringify({ text: fix(between(s, 'Text:\n<<<\n', '\n>>>')) });
  if (s.includes('Answer only with JSON: {"reply":""')) return JSON.stringify({ reply: 'I read your notes. All good.', actions: [], remember: [] });
  return 'hello';
}
const chunks = (t, n = 4) => { const k = Math.ceil(t.length / n) || 1; const out = []; for (let i = 0; i < t.length; i += k) out.push(t.slice(i, i + k)); return out; };

function start(port) {
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let j = {}; try { j = JSON.parse(body); } catch (e) { /* ignore */ }
      const prompt = (j.messages && j.messages[0] && j.messages[0].content) || '';
      const vendor = req.url.startsWith('/v1/messages') ? 'anthropic' : 'openai';
      state.log.push({ vendor, url: req.url, model: j.model, body: j, headers: req.headers, prompt });
      const keyOk = vendor === 'anthropic' ? req.headers['x-api-key'] === state.keyOk : req.headers.authorization === 'Bearer ' + state.openaiKey;
      if (!keyOk) { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { type: 'authentication_error', message: 'invalid x-api-key' } })); return; }
      if (state.fail) { const f = state.fail; res.writeHead(f.status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: f.message || 'fail' } })); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (state.hang) { res.write(vendor === 'anthropic' ? 'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":1}}}\n\n' : ''); return; }
      const text = answer(prompt); const inTok = Math.ceil(prompt.length / 4); const outTok = Math.ceil(text.length / 4);
      if (vendor === 'anthropic') {
        res.write(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: inTok, output_tokens: 1 } } })}\n\n`);
        res.write(`event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n`);
        res.write(`event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"secret thoughts"}}\n\n`);
        for (const c of chunks(text)) res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: c } })}\n\n`);
        res.write(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: outTok } })}\n\n`);
        res.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
      } else {
        for (const c of chunks(text)) res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: c } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: inTok, completion_tokens: outTok } })}\n\n`);
        res.write('data: [DONE]\n\n');
      }
      res.end();
    });
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r(server)));
}
module.exports = { start, state, answer };
