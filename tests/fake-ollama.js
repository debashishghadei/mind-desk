// Stand-in for Ollama's /api/tags and /api/chat, with Ollama-like CORS rules.
// FAKE_ORIGINS='*' allows every origin (like OLLAMA_ORIGINS=*); '' behaves like a default Ollama (rejects origin "null").
'use strict';
const http = require('http');

const FIX = { wnat: 'want', bulid: 'build', tomorow: 'tomorrow', thoguth: 'thought', mov: 'move', eon: 'on', teh: 'the', buisness: 'business', organiz: 'organize', meetign: 'meeting', abotu: 'about' };
function fixText(t) { return t.replace(/\b[a-z]+\b/gi, (w) => FIX[w.toLowerCase()] || w).replace(/\bmove on on\b/g, 'move on'); }
function pickCat(t) {
  const s = t.toLowerCase();
  if (/\b(buy|milk|shirt|clean)\b/.test(s)) return 'todo';
  if (/\b(ceo|salary|owner|meeting)\b/.test(s)) return 'job';
  if (/\b(client|invoice)\b/.test(s)) return 'clients';
  if (/\b(article|content)\b/.test(s)) return 'biz-content';
  if (/\btool\b/.test(s)) return 'biz-tools';
  if (/\b(website|plugin|site)\b/.test(s)) return 'biz-sites';
  if (/\b(gym|smoking|english|dating)\b/.test(s)) return 'personal';
  if (/\b(mind|fear|worry|universe)\b/.test(s)) return 'mind';
  return 'nowhere-cat';
}
function tasksOf(t) {
  const out = [];
  for (const line of t.split('\n')) {
    const m = line.match(/^\s*[-*]?\s*((buy|clean|make|call)\b.*?)(\s*\(done\))?\s*$/i);
    if (m) out.push({ text: fixText(m[1]).replace(/^./, (c) => c.toUpperCase()), done: !!m[3], category: /buy/i.test(m[1]) ? 'todo-shopping' : /make/i.test(m[1]) ? 'todo-job' : 'todo-chores' });
  }
  return out;
}

const state = { log: [], counts: {} };
function reply(res, code, body, origin, allowAll) {
  const h = { 'Content-Type': 'application/json' };
  if (allowAll) h['Access-Control-Allow-Origin'] = '*';
  else if (origin && origin !== 'null' && /^https?:\/\/(localhost|127\.0\.0\.1)/.test(origin)) h['Access-Control-Allow-Origin'] = origin;
  res.writeHead(code, h); res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function start(port, opts = {}) {
  const allowAll = opts.origins === '*';
  const srv = http.createServer((req, res) => {
    const origin = req.headers.origin;
    const allowed = !origin || allowAll || (origin !== 'null' && /^https?:\/\/(localhost|127\.0\.0\.1)/.test(origin));
    if (!allowed) { res.writeHead(403); res.end(); return; }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': allowAll ? '*' : origin, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'content-type,authorization' });
      res.end(); return;
    }
    if (req.url === '/__log') return reply(res, 200, state.log, origin, true);
    if (req.url === '/__reset') { state.log = []; state.counts = {}; return reply(res, 200, { ok: 1 }, origin, true); }
    if (req.url === '/api/tags') return reply(res, 200, { models: (opts.models || ['qwen3:8b', 'llama3.2:3b']).map((n) => ({ name: n })) }, origin, allowAll);
    if (req.url === '/api/chat' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        const j = JSON.parse(body); const sys = j.messages[0].content; const user = j.messages[1].content;
        state.log.push({ model: j.model, think: j.think, format: !!j.format, options: j.options, system: sys, user });
        if (!(opts.models || ['qwen3:8b', 'llama3.2:3b']).includes(j.model)) return reply(res, 404, { error: `model "${j.model}" not found, try pulling it first` }, origin, allowAll);
        if (/SLOW/.test(user)) await new Promise((r) => setTimeout(r, 1500));
        let out;
        if (/Decide where each NEW separate item starts/.test(sys)) {
          const blocks = [...user.matchAll(/\[(\d+)\][^\n]*\n([^\n]*)/g)].map((m) => ({ n: +m[1], first: m[2] }));
          out = /JOINALL/.test(user) ? { starts: [1] } : { starts: blocks.filter((b) => !/^(sol|and also)\b/i.test(b.first)).map((b) => b.n) };
        } else if (/Find at most/.test(sys) && /BADSURVEY/.test(user)) {
          return reply(res, 200, { message: { content: 'no idea, sorry' } }, origin, allowAll);
        } else if (/Find at most/.test(sys)) {
          const known = (sys.split('Already explained words:')[1] || '').split('\n').map((l) => l.split(' = ')[0].trim().toLowerCase());
          const terms = [...new Set([...user.matchAll(/\b[A-Z][A-Z0-9]{1,5}\b/g)].map((m) => m[0]))].filter((t) => !['CEO', 'SEO', 'AI'].includes(t) && !known.includes(t.toLowerCase()));
          out = { questions: terms.map((t) => ({ kind: 'word', term: t, guess: 'my guess for ' + t })) };
          if (/Ravi/.test(user)) out.questions.push({ kind: 'intent', quote: 'call Ravi about it', question: 'Is Ravi a client or a friend?', guess: 'client' });
        } else {
          const note = (user.match(/<<<\n([\s\S]*?)\n>>>/) || [])[1] || '';
          const key = note.slice(0, 40); state.counts[key] = (state.counts[key] || 0) + 1;
          if (/BADJSON/.test(note)) return reply(res, 200, { message: { content: 'sorry, I cannot do JSON' } }, origin, allowAll);
          let text = fixText(note);
          if (/BADSHORT/.test(note) && state.counts[key] === 1) text = text.split(/\s+/).slice(0, 3).join(' ');
          if (/BADWORD/.test(note)) text = text.replace(/IGS/g, 'eggs');
          out = { title: (text.split(/\s+/).slice(0, 5).join(' ') || 'Note').replace(/[^\w ]/g, ''), category: pickCat(note), tags: /\bsite\b/i.test(note) && /\bmind\b/i.test(note) ? ['biz-sites'] : [], tasks: tasksOf(note), text };
        }
        reply(res, 200, { model: j.model, message: { role: 'assistant', content: JSON.stringify(out) }, done: true }, origin, allowAll);
      });
      return;
    }
    reply(res, 404, { error: 'not found' }, origin, allowAll);
  });
  return new Promise((r) => srv.listen(port, '127.0.0.1', () => r(srv)));
}
module.exports = { start, state };
if (require.main === module) start(+process.argv[2] || 11500, { origins: process.argv[3] || '*' }).then(() => console.log('fake ollama up'));
