#!/usr/bin/env node
// Tests for the cloud version (server/ + server/public/app.html): server checks over HTTP, then the app in Chromium.
// The Claude and ChatGPT APIs are replaced by tests/fake-cloud-ai.js. The round trip uses the real artifact build
// (mind-desk-artifact.html) with tests/artifact-stub.js in place of claude.ai.
// Usage: PW=<playwright> node tests/cloud-tests.js        (ONLY=S3 or ONLY=B2 runs one test; CLOUD_DIR=… tests an unzipped release)
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const fake = require('./fake-cloud-ai');
const ROOT = path.join(__dirname, '..');

let browser; const results = [];
async function test(name, fn) {
  if (process.env.ONLY && !name.startsWith(process.env.ONLY + ' ')) return;
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log('  ✓', name); } catch (e) { results.push({ name, ok: false, ms: Date.now() - t0, error: e.stack || String(e) }); console.log('  ✗', name, '\n    ', String(e.message || e).split('\n')[0]); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- a fresh server per test, with a clock the test can move ---------- */
const AI_PORT = 11610;
process.env.MD_ANTHROPIC_URL = 'http://127.0.0.1:' + AI_PORT;
process.env.MD_OPENAI_URL = 'http://127.0.0.1:' + AI_PORT;
// CLOUD_DIR=<unzipped mind-desk-cloud folder> tests the release zip instead of server/
const SERVER_DIR = path.resolve(process.env.CLOUD_DIR || path.join(ROOT, 'server'));
const { createServer } = require(path.join(SERVER_DIR, 'server.js'));
const { totpAt, stepNow } = require(path.join(SERVER_DIR, 'lib', 'auth.js'));
async function server(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-cloud-'));
  const clock = { t: Date.now() };
  const s = createServer(Object.assign({ dataDir: dir, quiet: true, now: () => clock.t }, opts));
  await new Promise((r) => s.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + s.server.address().port;
  const c = { base, dir, clock, cookie: '', close: () => new Promise((r) => s.server.close(r)) };
  c.tick = () => { clock.t += 31000; }; // next 30-second code
  c.code = (secret) => totpAt(secret, stepNow(clock.t));
  c.call = async (method, url, body, extra = {}) => {
    const headers = Object.assign({ 'Content-Type': 'application/json', 'X-MD': '1' }, c.cookie ? { cookie: c.cookie } : {}, extra.headers || {});
    if (extra.noMd) delete headers['X-MD'];
    const r = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc && !extra.keepCookie) c.cookie = sc.split(';')[0];
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
    return { status: r.status, json, text, headers: r.headers };
  };
  c.setup = async () => {
    const code = fs.readFileSync(path.join(dir, 'SETUP-CODE.txt'), 'utf8').split(/\s/)[0];
    const a = await c.call('POST', '/api/setup', { code, user: 'debashish', password: 'correct horse battery' });
    c.secret = a.json.secret;
    const b = await c.call('POST', '/api/setup/confirm', { code: c.code(c.secret) });
    c.recovery = b.json.recovery; c.tick();
    return c;
  };
  return c;
}
function ndjson(text) { return text.split('\n').filter(Boolean).map((l) => JSON.parse(l)); }

(async () => {
  const aiServer = await fake.start(AI_PORT);
  console.log('Mind Desk cloud tests');

  /* ================= server ================= */
  await test('S1 first run: setup code, password and two-step code are required; then login works once per code', async () => {
    const c = await server();
    assert.strictEqual((await c.call('GET', '/')).headers.get('location'), '/setup');
    assert.strictEqual((await c.call('POST', '/api/setup', { code: 'WRONG', user: 'deb', password: 'x'.repeat(12) })).status, 403);
    const code = fs.readFileSync(path.join(c.dir, 'SETUP-CODE.txt'), 'utf8').split(/\s/)[0];
    assert.strictEqual((await c.call('POST', '/api/setup', { code, user: 'debashish', password: 'short' })).status, 400);
    const a = await c.call('POST', '/api/setup', { code, user: 'debashish', password: 'correct horse battery' });
    assert.strictEqual(a.status, 200); assert.ok(/^otpauth:\/\/totp\//.test(a.json.otpauth));
    assert.strictEqual((await c.call('POST', '/api/setup/confirm', { code: '000000' })).status, 400);
    const b = await c.call('POST', '/api/setup/confirm', { code: totpAt(a.json.secret, stepNow(c.clock.t)) });
    assert.strictEqual(b.status, 200); assert.strictEqual(b.json.recovery.length, 8); assert.ok(c.cookie.startsWith('md_s='), 'logged in after setup');
    assert.ok(!fs.existsSync(path.join(c.dir, 'SETUP-CODE.txt')), 'setup code removed');
    assert.strictEqual((await c.call('GET', '/api/me')).json.user, 'debashish');
    const acc = fs.readFileSync(path.join(c.dir, 'account.json'), 'utf8');
    assert.ok(!acc.includes('correct horse') && !acc.includes(b.json.recovery[0]), 'no password or recovery code in plain text');
    assert.strictEqual((await c.call('POST', '/api/setup', { code, user: 'x', password: 'x'.repeat(12) })).status, 409, 'setup only once');
    // login: the code used at setup cannot be used again; the next one works
    c.cookie = '';
    assert.strictEqual((await c.call('POST', '/api/login', { user: 'debashish', password: 'correct horse battery', code: totpAt(a.json.secret, stepNow(c.clock.t)) })).status, 401, 'same code twice is refused');
    c.tick(); const code2 = c.code(a.json.secret);
    assert.strictEqual((await c.call('POST', '/api/login', { user: 'debashish', password: 'correct horse battery', code: code2 })).status, 200);
    const keep = c.cookie; c.cookie = '';
    assert.strictEqual((await c.call('POST', '/api/login', { user: 'debashish', password: 'correct horse battery', code: code2 })).status, 401, 'replay refused');
    // a recovery code works once
    const r = await c.call('POST', '/api/login', { user: 'debashish', password: 'correct horse battery', code: b.json.recovery[0].toLowerCase() });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.json.recoveryLeft, 7);
    c.cookie = '';
    assert.strictEqual((await c.call('POST', '/api/login', { user: 'debashish', password: 'correct horse battery', code: b.json.recovery[0] })).status, 401);
    c.cookie = keep; await c.close();
  });

  await test('S2 wrong logins are limited; the API needs a login, the X-MD header and this site as origin', async () => {
    const c = await server(); await c.setup(); const cookie = c.cookie; c.cookie = '';
    for (let k = 0; k < 5; k++) assert.strictEqual((await c.call('POST', '/api/login', { user: 'debashish', password: 'wrong password!!', code: '123456' })).status, 401);
    c.tick();
    assert.strictEqual((await c.call('POST', '/api/login', { user: 'debashish', password: 'correct horse battery', code: c.code(c.secret) })).status, 429, 'locked after 5 wrong tries, even with the right password');
    c.clock.t += 16 * 60000;
    assert.strictEqual((await c.call('POST', '/api/login', { user: 'debashish', password: 'correct horse battery', code: c.code(c.secret) })).status, 200, 'open again after 15 minutes');
    c.cookie = '';
    assert.strictEqual((await c.call('GET', '/api/state')).status, 401);
    assert.strictEqual((await c.call('GET', '/')).headers.get('location'), '/login');
    c.cookie = cookie;
    assert.strictEqual((await c.call('PUT', '/api/state', { rev: 0, state: { notes: [], items: [] } }, { noMd: true })).status, 403, 'no X-MD header');
    assert.strictEqual((await c.call('PUT', '/api/state', { rev: 0, state: { notes: [], items: [] } }, { headers: { Origin: 'https://evil.example' } })).status, 403, 'other site');
    const page = await c.call('GET', '/');
    assert.strictEqual(page.status, 200);
    const csp = page.headers.get('content-security-policy');
    assert.ok(/script-src 'self' 'sha256-/.test(csp) && !/unsafe-inline'[^;]*script|script-src[^;]*unsafe-inline/.test(csp) && /frame-ancestors 'none'/.test(csp), csp);
    assert.strictEqual(page.headers.get('x-content-type-options'), 'nosniff');
    // behind the hosting's HTTPS proxy the cookie is Secure
    c.cookie = ''; c.tick();
    const l = await c.call('POST', '/api/login', { user: 'debashish', password: 'correct horse battery', code: c.code(c.secret) }, { headers: { 'X-Forwarded-Proto': 'https' } });
    assert.ok(/; Secure/.test(l.headers.get('set-cookie')) && /HttpOnly/.test(l.headers.get('set-cookie')), l.headers.get('set-cookie'));
    await c.close();
  });

  await test('S3 notes: a save with an old revision is refused; quick captures wait, are not saved twice, and leave after ack', async () => {
    const c = await server(); await c.setup();
    assert.deepStrictEqual((await c.call('GET', '/api/state')).json, { rev: 0, state: null });
    assert.strictEqual((await c.call('PUT', '/api/state', { rev: 0, state: { notes: [{ id: 'n1' }], items: [] } }, { headers: { 'X-MD-Session': 'pc' } })).json.rev, 1);
    assert.strictEqual((await c.call('PUT', '/api/state', { rev: 0, state: { notes: [], items: [] } })).status, 409, 'old revision');
    assert.strictEqual((await c.call('PUT', '/api/state', { rev: 1, state: { nope: 1 } })).status, 400, 'not Mind Desk data');
    assert.deepStrictEqual((await c.call('GET', '/api/status')).json.session, 'pc');
    const a = await c.call('POST', '/api/capture', { text: 'idea one', cid: 'p1' });
    assert.strictEqual(a.json.waiting, 1);
    assert.ok((await c.call('POST', '/api/capture', { text: 'idea one', cid: 'p1' })).json.duplicate, 'resend is not saved twice');
    assert.strictEqual((await c.call('POST', '/api/capture', { text: '   ' })).status, 400);
    const list = (await c.call('GET', '/api/captures')).json.captures; assert.strictEqual(list.length, 1);
    assert.strictEqual((await c.call('POST', '/api/captures/ack', { ids: [list[0].id] })).json.waiting, 0);
    // a damaged data file stops the server from starting empty
    await c.close();
    fs.writeFileSync(path.join(c.dir, 'state.json'), '{"rev":1,"state":');
    assert.throws(() => createServer({ dataDir: c.dir, quiet: true }), /cannot be read/);
  });

  await test('S4 API key: kept on the server only; Claude answer streamed and cost counted; the monthly limit stops requests', async () => {
    const c = await server(); await c.setup();
    let r = await c.call('POST', '/api/ai', { prompt: 'x', vendor: 'anthropic', model: 'claude-haiku-5-5' });
    assert.strictEqual(r.json.code, 'no_key');
    r = await c.call('PUT', '/api/ai/settings', { vendor: 'anthropic', key: fake.state.keyOk });
    assert.deepStrictEqual(r.json.keys.anthropic, { set: true, last4: 'abcd' });
    assert.ok(!JSON.stringify((await c.call('GET', '/api/ai/settings')).json).includes(fake.state.keyOk), 'the key never comes back');
    if (process.platform !== 'win32') assert.strictEqual(fs.statSync(path.join(c.dir, 'secrets.json')).mode & 0o777, 0o600);
    assert.strictEqual((await c.call('POST', '/api/ai', { prompt: 'x', vendor: 'anthropic', model: 'claude-made-up' })).status, 400);
    fake.state.log = [];
    r = await c.call('POST', '/api/ai', { prompt: 'Answer only with JSON: {"text":""}\nText:\n<<<\ni wnat it\n>>>', vendor: 'anthropic', model: 'claude-haiku-5-5', careful: false });
    const lines = ndjson(r.text); const end = lines[lines.length - 1];
    assert.strictEqual(lines.filter((l) => l.t).map((l) => l.t).join(''), '{"text":"i want it"}');
    assert.ok(!r.text.includes('secret thoughts'), 'thinking is not passed on');
    assert.ok(end.done && end.model === 'claude-haiku-5-5' && end.cost > 0 && end.cost < 0.001, JSON.stringify(end));
    const sent = fake.state.log[0];
    assert.strictEqual(sent.headers['anthropic-version'], '2023-06-01'); assert.deepStrictEqual(sent.body.output_config, { effort: 'low' }); assert.ok(!('temperature' in sent.body));
    r = await c.call('POST', '/api/ai', { prompt: 'hi', vendor: 'anthropic', model: 'claude-opus-5-5', careful: true });
    assert.ok(!('output_config' in fake.state.log[1].body), 'Careful uses the model\'s own effort');
    const s = (await c.call('GET', '/api/ai/settings')).json;
    assert.strictEqual(s.month.requests, 2); assert.ok(s.month.byModel['claude-opus-5-5'].inTok > 0);
    // limit
    await c.call('PUT', '/api/ai/settings', { limitUsd: 0 });
    r = await c.call('POST', '/api/ai', { prompt: 'hi', vendor: 'anthropic', model: 'claude-haiku-5-5' });
    assert.strictEqual(r.status, 402); assert.strictEqual(r.json.code, 'limit_reached');
    assert.strictEqual(fake.state.log.length, 2, 'nothing sent after the limit');
    // a refused key
    await c.call('PUT', '/api/ai/settings', { limitUsd: 5, vendor: 'anthropic', key: 'sk-ant-wrong-key-00000000000' });
    assert.strictEqual((await c.call('POST', '/api/ai', { prompt: 'hi', vendor: 'anthropic', model: 'claude-haiku-5-5' })).json.code, 'bad_key');
    // OpenAI
    await c.call('PUT', '/api/ai/settings', { vendor: 'openai', key: fake.state.openaiKey });
    r = await c.call('POST', '/api/ai', { prompt: 'Answer only with JSON: {"text":""}\nText:\n<<<\nteh end\n>>>', vendor: 'openai', model: 'gpt-6-luna' });
    const ol = ndjson(r.text); assert.strictEqual(ol.filter((l) => l.t).map((l) => l.t).join(''), '{"text":"the end"}'); assert.ok(ol[ol.length - 1].done && ol[ol.length - 1].cost > 0);
    assert.strictEqual(fake.state.log[fake.state.log.length - 1].body.stream_options.include_usage, true);
    // no credit
    fake.state.fail = { status: 400, message: 'Your credit balance is too low' };
    assert.strictEqual((await c.call('POST', '/api/ai', { prompt: 'hi', vendor: 'openai', model: 'gpt-6-luna' })).json.code, 'no_credit');
    fake.state.fail = null;
    await c.close();
  });

  await test('S5 backups: one per day, one before Bring back / restore; password change logs out other devices', async () => {
    const c = await server(); await c.setup();
    await c.call('PUT', '/api/state', { rev: 0, state: { notes: [], items: [] } });
    await c.call('PUT', '/api/state', { rev: 1, state: { notes: [], items: [] } });
    let files = fs.readdirSync(path.join(c.dir, 'backups'));
    assert.strictEqual(files.filter((f) => f.startsWith('day-')).length, 1);
    c.clock.t += 86400000; await c.call('PUT', '/api/state', { rev: 2, state: { notes: [], items: [] } });
    assert.strictEqual(fs.readdirSync(path.join(c.dir, 'backups')).filter((f) => f.startsWith('day-')).length, 2);
    assert.ok((await c.call('POST', '/api/backup-now', { why: 'before bring back' })).json.file.includes('before-bring-back'));
    // another device
    const phone = Object.assign({}, c); phone.cookie = ''; c.tick();
    const cookieMain = c.cookie; c.cookie = '';
    await c.call('POST', '/api/login', { user: 'debashish', password: 'correct horse battery', code: c.code(c.secret) }); const phoneCookie = c.cookie; c.cookie = cookieMain;
    assert.strictEqual((await c.call('POST', '/api/password', { old: 'wrong', password: 'a new long password' })).status, 403);
    assert.strictEqual((await c.call('POST', '/api/password', { old: 'correct horse battery', password: 'a new long password' })).status, 200);
    assert.strictEqual((await c.call('GET', '/api/me')).status, 200, 'this device stays logged in');
    const mine = c.cookie; c.cookie = phoneCookie;
    assert.strictEqual((await c.call('GET', '/api/me')).status, 401, 'the other device is logged out');
    c.cookie = mine; await c.close();
  });

  /* ================= the app in the browser ================= */
  const { chromium } = require(process.env.PW || 'playwright');
  browser = await chromium.launch();
  async function app(c, opts = {}) {
    const context = opts.context || await browser.newContext({ viewport: opts.viewport || { width: 1300, height: 860 }, acceptDownloads: true });
    await context.addCookies([{ name: 'md_s', value: decodeURIComponent(c.cookie.split('=')[1]), url: c.base }]);
    const p = await context.newPage(); p.errors = [];
    p.on('pageerror', (e) => p.errors.push(String(e)));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) p.errors.push(m.text()); });
    p.on('dialog', (d) => { if (d.type() === 'beforeunload') { d.accept(); return; } p.errors.push('native dialog: ' + d.message()); d.dismiss(); });
    await p.goto(c.base + (opts.path || '/'));
    if (!opts.path) await p.waitForFunction(() => window.MD && MD.state && MD.LIFE.ok, null, { timeout: 15000 });
    return p;
  }
  const saved = (p) => p.waitForFunction(() => /Saved/.test(document.querySelector('#savestate').textContent) && !/Saving/.test(document.querySelector('#savestate').textContent), null, { timeout: 8000 });
  async function paste(p, name, text) {
    if (await p.evaluate(() => MD.UI.view !== 'inbox')) await p.click('[data-act=nav][data-v=inbox]');
    await p.click('.notelist [data-act=pasteNote]'); await p.fill('#pnName', name); await p.fill('#pnText', text); await p.click('[data-act=savePaste]');
  }
  const waitRunEnd = (p, ms = 20000) => p.waitForFunction(() => !MD.RUN.active, null, { timeout: ms });

  await test('B1 setup in the browser, then the app: notes saved on the server, cloud Settings, no security-policy errors', async () => {
    const c = await server();
    const context = await browser.newContext({ viewport: { width: 1300, height: 860 } });
    const p = await context.newPage(); p.errors = []; p.on('pageerror', (e) => p.errors.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') p.errors.push(m.text()); });
    await p.goto(c.base + '/');
    assert.ok(p.url().endsWith('/setup'));
    const code = fs.readFileSync(path.join(c.dir, 'SETUP-CODE.txt'), 'utf8').split(/\s/)[0];
    await p.fill('#sc', code); await p.fill('#user', 'debashish'); await p.fill('#pw', 'correct horse battery'); await p.fill('#pw2', 'correct horse battery');
    await p.click('#go1'); await p.waitForSelector('#s2:not([hidden])');
    const secret = (await p.textContent('#secret')).replace(/\s/g, '');
    await p.fill('#code', totpAt(secret, stepNow(c.clock.t))); await p.click('#go2');
    await p.waitForSelector('#s3:not([hidden])'); assert.strictEqual((await p.$$('#codes div')).length, 8);
    await p.click('#go3'); await p.waitForFunction(() => window.MD && MD.LIFE.ok);
    assert.strictEqual(await p.evaluate(() => MD.TARGET), 'cloud');
    await paste(p, 'Tab 1', 'buy milk\n\ncall Ravi about PowerPoint'); await saved(p);
    const st = (await (await fetch(c.base + '/api/state', { headers: { cookie: (await context.cookies())[0].name + '=' + (await context.cookies())[0].value } })).json());
    assert.strictEqual(st.state.notes[0].name, 'Tab 1');
    await p.click('[data-act=nav][data-v=settings]');
    const t = await p.textContent('#content');
    assert.ok(/your own API key/.test(t) && /Organize free with Claude/.test(t) && /Logged in as debashish/.test(t) && /Mind Desk 1\.3\.0 \(cloud\)/.test(t), t.slice(0, 200));
    assert.ok(!/Choose a folder/.test(t), 'no folder saving');
    assert.deepStrictEqual(p.errors, [], 'no errors (incl. security policy)');
    await context.close(); await c.close();
  });

  await test('B2 organize with your API key: batches to Claude Haiku, items in Review, model and cost shown, limit stops the run', async () => {
    const c = await server(); await c.setup();
    await c.call('PUT', '/api/ai/settings', { vendor: 'anthropic', key: fake.state.keyOk });
    const p = await app(c);
    await p.click('[data-act=nav][data-v=settings]'); await p.click('input[name=prov][value=api]');
    await p.waitForSelector('#apiServer .chip.good');
    assert.ok(/saved \(…abcd\)/.test(await p.textContent('#apiServer')));
    assert.ok(/Fast · Haiku/.test(await p.textContent('#modeSel')) && /Careful · Sonnet/.test(await p.textContent('#modeSel')));
    await p.evaluate(() => { MD.state.settings.survey = false; MD.save(); });
    await p.click('[data-act=testAI]'); await p.waitForFunction(() => /The AI answered/.test(document.querySelector('#connResult').textContent));
    assert.ok(/Haiku 5\.5/.test(await p.textContent("#connResult")) && /\$/.test(await p.textContent('#connResult')));
    fake.state.log = [];
    await paste(p, 'n', 'buy milk\n\ncall Ravi about PowerPoint\n\ntrust the univers');
    await p.click('[data-act=organizeAll]'); await waitRunEnd(p);
    assert.deepStrictEqual(fake.state.log.map((x) => x.model), ['claude-haiku-5-5', 'claude-haiku-5-5'], 'one split + one batch for 3 notes');
    const st = await p.evaluate(() => MD.state.items.map((i) => [i.status, i.model]));
    assert.ok(st.length === 3 && st.every(([s, m]) => s === 'review' && m === 'claude-haiku-5-5'), JSON.stringify(st));
    assert.ok(/Haiku 5\.5/.test(await p.textContent("#content")));
    // ChatGPT for Careful
    await p.click('[data-act=nav][data-v=settings]'); await p.selectOption('#set-apiVendor', 'openai');
    await c.call('PUT', '/api/ai/settings', { vendor: 'openai', key: fake.state.openaiKey });
    assert.ok(/Careful · Sol/.test(await p.textContent('#modeSel')));
    // the limit: the run stops with a clear message, no loop
    await c.call('PUT', '/api/ai/settings', { limitUsd: 0 });
    await p.selectOption('#modeSel', 'careful'); fake.state.log = [];
    await paste(p, 'm', 'gym plan');
    await p.click('[data-act=organizeAll]'); await waitRunEnd(p);
    assert.ok(/limit of \$0 is reached/.test(await p.textContent('#overlay')), await p.textContent('#overlay'));
    assert.strictEqual(fake.state.log.length, 0);
    assert.deepStrictEqual(p.errors, []);
    await p.context().close(); await c.close();
  });

  await test('B3 round trip: Send to Claude → organize in the artifact → Bring back merges; an idea captured meanwhile is kept', async () => {
    const c = await server(); await c.setup();
    const p = await app(c);
    await p.evaluate(() => { MD.state.settings.survey = false; MD.state.memory.push({ id: 'm1', text: 'IGS means Instagram stories', at: 1, source: 'manual' }); MD.save(); });
    await paste(p, 'Tab 1', 'buy milk\n\ncall Ravi about PowerPoint'); await paste(p, 'Tab 2', 'stop thinkign so much'); await saved(p);
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('.notelist [data-act=sendToClaude]')]);
    assert.ok(/^mind-desk-for-claude-\d{4}-\d\d-\d\d\.json$/.test(dl.suggestedFilename()));
    const sentFile = path.join(c.dir, 'sent.json'); await dl.saveAs(sentFile);
    const sent = JSON.parse(fs.readFileSync(sentFile, 'utf8'));
    assert.ok(sent.roundTrip && sent.roundTrip.id && !sent.sentToClaude, 'carries the round-trip id, not the fingerprints');
    // the artifact (real build + claude.ai stand-in)
    const STUB = fs.readFileSync(path.join(__dirname, 'artifact-stub.js'), 'utf8');
    const PAGE = path.join(c.dir, 'artifact.html');
    fs.writeFileSync(PAGE, '<!doctype html><html><head><meta charset="utf-8"><style>[hidden]{display:none!important}</style></head><body>' + fs.readFileSync(path.join(ROOT, 'mind-desk-artifact.html'), 'utf8') + '</body></html>');
    const actx = await browser.newContext({ viewport: { width: 1300, height: 860 } }); const a = await actx.newPage(); const aerr = []; a.on('pageerror', (e) => aerr.push(String(e)));
    await a.addInitScript('window.__cfg = {};\n' + STUB); await a.goto('file://' + PAGE); await a.waitForFunction(() => window.MD && MD.LIFE.ok);
    await a.click('[data-act=nav][data-v=settings]'); await a.setInputFiles('#importInput', sentFile); await a.waitForSelector('#askbox'); await a.click('#askOk');
    await a.waitForFunction(() => MD.state.notes.length === 2);
    await a.click('[data-act=organizeAll]'); await a.waitForFunction(() => !MD.RUN.active && MD.state.items.length >= 3);
    await a.evaluate(() => { MD.state.memory.push({ id: 'm2', text: 'Ravi is my manager', at: Date.now(), source: 'chat' }); MD.save(); });
    await a.click('[data-act=nav][data-v=settings]'); await a.click('[data-act=exportJSON]'); await a.waitForFunction(() => window.__saves.length === 1);
    const back = path.join(c.dir, 'back.json'); fs.writeFileSync(back, await a.evaluate(() => window.__saves[0].data));
    assert.deepStrictEqual(aerr, []); await actx.close();
    // meanwhile: an idea from the phone
    await c.call('POST', '/api/capture', { text: 'idea from the bus', cid: 'bus1' });
    await p.evaluate(() => window.dispatchEvent(new Event('focus')));
    await p.waitForFunction(() => MD.state.notes.some((n) => n.text === 'idea from the bus'), null, { timeout: 8000 });
    await saved(p);
    // bring back
    await p.click('[data-act=nav][data-v=inbox]'); await p.setInputFiles('#mergeInput', back);
    await p.waitForSelector('#askbox');
    const summary = await p.textContent('#askbox');
    assert.ok(/3 new organized item\(s\)/.test(summary) && /1 idea\(s\) you added here since sending are kept/.test(summary) && /1 Memory change/.test(summary), summary);
    await p.click('#askOk');
    await p.waitForFunction(() => MD.UI.view === 'review');
    const st = await p.evaluate(() => ({ notes: MD.state.notes.map((n) => n.name + ':' + n.status), items: MD.state.items.length, mem: MD.state.memory.map((m) => m.text), provider: MD.state.settings.provider, sent: MD.state.sentToClaude }));
    assert.ok(st.notes.includes('Tab 1:split') && st.notes.some((n) => /:new$/.test(n)) && st.items === 3, JSON.stringify(st));
    assert.deepStrictEqual(st.mem, ['IGS means Instagram stories', 'Ravi is my manager']);
    assert.strictEqual(st.provider, 'manual', 'settings here stay'); assert.strictEqual(st.sent, null);
    assert.ok(fs.readdirSync(path.join(c.dir, 'backups')).some((f) => /before-.*bring-back/.test(f)), 'safety copy made first');
    await saved(p);
    // the same file again: nothing new, nothing lost
    await p.setInputFiles('#mergeInput', back); await p.waitForSelector('#askbox');
    assert.ok(/not come from your last|have not used/.test(await p.textContent('#askbox')));
    await p.click('#askOk'); await p.waitForSelector('#askbox'); await p.click('#askOk'); await sleep(300);
    assert.strictEqual(await p.evaluate(() => MD.state.items.length), 3, 'no duplicates');
    assert.deepStrictEqual(p.errors, []);
    await p.context().close(); await c.close();
  });

  await test('B4 quick capture on the phone: offline ideas wait on the phone, are sent when online, and reach the Inbox', async () => {
    const c = await server(); await c.setup();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, serviceWorkers: 'allow' });
    const p = await app(c, { context: ctx, path: '/capture' });
    await p.waitForSelector('#t');
    await p.fill('#t', 'first idea'); await p.click('#save'); await p.waitForSelector('.msg.ok');
    await ctx.setOffline(true);
    await p.fill('#t', 'idea without internet'); await p.click('#save');
    await p.waitForFunction(() => /1 waiting/.test(document.querySelector('#state').textContent));
    assert.strictEqual((await c.call('GET', '/api/captures')).json.captures.length, 1);
    await ctx.setOffline(false); await p.evaluate(() => window.dispatchEvent(new Event('online')));
    await p.waitForFunction(() => !/waiting/.test(document.querySelector('#state').textContent));
    const caps = (await c.call('GET', '/api/captures')).json.captures;
    assert.deepStrictEqual(caps.map((x) => x.text), ['first idea', 'idea without internet']);
    const w = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]); assert.ok(w[0] <= w[1]);
    // the app takes them into the Inbox and the server forgets them
    const m = await app(c);
    await m.waitForFunction(() => MD.state.notes.length === 2, null, { timeout: 8000 });
    await m.waitForFunction(async () => true); await sleep(500);
    assert.strictEqual((await c.call('GET', '/api/captures')).json.captures.length, 0);
    assert.ok(await m.evaluate(() => MD.state.notes.every((n) => n.source === 'capture' && n.status === 'new')));
    // not logged in: the capture page sends you to the login page
    const anon = await browser.newPage(); await anon.goto(c.base + '/capture'); assert.ok(/\/login\?next=\/capture$/.test(anon.url())); await anon.close();
    assert.deepStrictEqual(p.errors, []); assert.deepStrictEqual(m.errors, []);
    await ctx.close(); await m.context().close(); await c.close();
  });

  await test('B5 another device saves: this page stops saving and loads the newest; phone width has no sideways scroll', async () => {
    const c = await server(); await c.setup();
    const p = await app(c, { viewport: { width: 400, height: 820 } });
    await paste(p, 'n', 'buy milk'); await saved(p);
    for (const v of ['inbox', 'settings', 'chat', 'todo']) {
      await p.evaluate((v) => { MD.UI.view = v; MD.render(); }, v);
      const w = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]); assert.ok(w[0] <= w[1], v + ' ' + w);
    }
    const cur = (await c.call('GET', '/api/state')).json;
    cur.state.notes.push({ id: 'nP', name: 'From the phone', text: 'x', addedAt: Date.now(), source: 'paste', status: 'new' });
    await c.call('PUT', '/api/state', { rev: cur.rev, state: cur.state }, { headers: { 'X-MD-Session': 'phone' } });
    await p.evaluate(() => window.dispatchEvent(new Event('focus')));
    await p.waitForSelector('#blocker', { timeout: 8000 });
    assert.ok(/another device/.test(await p.textContent('#blocker')));
    await p.click('#takeOver'); await p.waitForFunction(() => MD.state.notes.some((n) => n.name === 'From the phone'));
    assert.deepStrictEqual(p.errors, []);
    await p.context().close(); await c.close();
  });

  await test('B6 log out from Settings ends the session', async () => {
    const c = await server(); await c.setup();
    const p = await app(c);
    await p.click('[data-act=nav][data-v=settings]'); await p.click('[data-act=logout]');
    await p.waitForURL(/\/login$/);
    assert.strictEqual((await c.call('GET', '/api/me')).status, 401);
    assert.deepStrictEqual(p.errors, []);
    await p.context().close(); await c.close();
  });

  await browser.close(); aiServer.close();
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} passed`);
  fs.writeFileSync(path.join(__dirname, 'last-cloud-results.json'), JSON.stringify(results, null, 1));
  process.exit(ok === results.length ? 0 : 1);
})();
