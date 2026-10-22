#!/usr/bin/env node
// Tests for the claude.ai artifact build (mind-desk-artifact.html).
// The page is wrapped like claude.ai wraps it, and window.claude is replaced by tests/artifact-stub.js
// (an in-memory artifact database, a stand-in Claude that answers from the prompt's format line, downloads).
// Usage: PW=<playwright> node tests/artifact-tests.js [path/to/mind-desk-artifact.html]   (ONLY=A3 runs one test)
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { chromium } = require(process.env.PW || 'playwright');

const FRAG = path.resolve(process.argv[2] || path.join(__dirname, '..', 'mind-desk-artifact.html'));
const STUB = fs.readFileSync(path.join(__dirname, 'artifact-stub.js'), 'utf8');
const SAMPLE = fs.readFileSync(path.join(__dirname, 'samples', 'mixed-note.txt'), 'utf8');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'md-art-'));
// the same skeleton claude.ai puts around a published page
const PAGE = path.join(TMP, 'artifact.html');
fs.writeFileSync(PAGE, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>'
  + fs.readFileSync(FRAG, 'utf8') + '</body></html>');

let browser; const results = [];
async function page(cfg = {}, opts = {}) {
  const context = opts.context || await browser.newContext({ viewport: opts.viewport || { width: 1300, height: 860 }, colorScheme: opts.colorScheme || 'light' });
  const p = await context.newPage(); p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  p.on('dialog', (d) => { if (d.type() === 'beforeunload') { d.accept(); return; } p.errors.push('native dialog: ' + d.message()); d.dismiss(); });
  await p.addInitScript(`window.__cfg = ${JSON.stringify(cfg)};\n${STUB}`);
  await p.goto('file://' + PAGE);
  await p.waitForFunction(() => window.MD && MD.state && MD.LIFE.ok, null, { timeout: 15000 });
  if (!opts.raw) await p.evaluate(() => { MD.state.settings.survey = false; MD.save(); MD.render(); });
  return p;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitRunEnd = (p, ms = 20000) => p.waitForFunction(() => !MD.RUN.active, null, { timeout: ms });
const saved = (p) => p.waitForFunction(() => /Saved/.test(document.querySelector('#savestate').textContent) && !/Saving/.test(document.querySelector('#savestate').textContent), null, { timeout: 8000 });
async function paste(p, name, text) {
  if (await p.evaluate(() => MD.UI.view !== 'inbox')) await p.click('[data-act=nav][data-v=inbox]');
  await p.click('.notelist [data-act=pasteNote]');
  await p.fill('#pnName', name); await p.fill('#pnText', text);
  await p.click('[data-act=savePaste]');
}
const calls = (p) => p.evaluate(() => window.__calls.map((c) => ({ tier: c.tier, kind: /"notes":\[\{"id":"note id"/.test(c.input) ? 'split' : /\{"questions":\[/.test(c.input) ? 'survey' : /"results":\[\{"id"/.test(c.input) ? 'organizeBatch' : /\{"reply":""/.test(c.input) ? 'chat' : /\{"text":""\}/.test(c.input) ? 'fix' : /\{"title":""/.test(c.input) ? 'organize' : 'other', cache: c.cache, input: c.input })));
const dump = (p) => p.evaluate(() => window.__db.dump());

async function test(name, fn) {
  if (process.env.ONLY && !name.startsWith(process.env.ONLY + ' ')) return;
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log('  ✓', name); } catch (e) { results.push({ name, ok: false, ms: Date.now() - t0, error: e.stack || String(e) }); console.log('  ✗', name, '\n    ', String(e.message || e).split('\n')[0]); }
}

(async () => {
  browser = await chromium.launch();
  console.log('Mind Desk artifact tests on', FRAG);

  await test('A1 the fragment loads like an artifact: title first, no doctype, Claude in Settings, no PC-only parts', async () => {
    const src = fs.readFileSync(FRAG, 'utf8');
    assert.ok(src.startsWith('<title>Mind Desk</title>'), 'title first'); assert.ok(!/<!doctype|<html[\s>]|<head[\s>]|<body[\s>]/i.test(src), 'a fragment');
    assert.ok(!/window\.(confirm|prompt|alert)\(/.test(src.replace("window.prompt(message, opts.input) : window.confirm(message)", '')), 'no native dialogs outside the PC branch');
    const p = await page();
    assert.strictEqual(await p.evaluate(() => MD.TARGET), 'artifact');
    assert.strictEqual(await p.evaluate(() => MD.state.settings.provider), 'claude');
    await p.click('[data-act=nav][data-v=settings]');
    const t = await p.textContent('#content');
    assert.ok(/AI: Claude/.test(t) && /your own Claude plan/.test(t), 'Claude box');
    assert.ok(!/Ollama|OLLAMA_ORIGINS|Choose a folder|Theme/.test(t), 'no Ollama / folder / theme settings: ' + (t.match(/Ollama|OLLAMA_ORIGINS|Choose a folder|Theme/) || [])[0]);
    assert.ok(/private storage on your Claude account/.test(t), 'storage text');
    assert.ok(/Claude artifact/.test(t));
    assert.deepStrictEqual(p.errors, []);
  });

  await test('A2 Organize all (Fast): batched split + questions + organize through Claude’s quick model, items reach Review', async () => {
    const p = await page({}, { raw: true });
    await paste(p, 'Tab 1', SAMPLE); await paste(p, 'Tab 2', 'i wnat to bulid a gym plan tomorow\n\nbuy milk');
    await p.click('[data-act=organizeAll]');
    await p.waitForFunction(() => MD.UI.view === 'survey', null, { timeout: 10000 });
    assert.ok(/What does “IGS” mean/.test(await p.textContent('#content')), 'question about IGS');
    await p.fill('[data-q]', 'Instagram stories'); await p.click('[data-act=submitSurvey]');
    await waitRunEnd(p);
    const c = await calls(p);
    assert.deepStrictEqual(c.map((x) => x.kind), ['split', 'survey', 'organizeBatch'], JSON.stringify(c.map((x) => x.kind)));
    assert.ok(c.every((x) => x.tier === 'quick' && x.cache === false), 'Fast = quick model, no cache');
    const st = await p.evaluate(() => ({ review: MD.state.items.filter((i) => i.status === 'review').length, items: MD.state.items.length, view: MD.UI.view, word: MD.state.words.find((w) => w.term === 'IGS'), tasks: MD.state.tasks.map((t) => t.text), flags: MD.state.items.flatMap((i) => i.flags) }));
    assert.ok(st.items >= 5 && st.review === st.items, JSON.stringify(st));
    assert.strictEqual(st.view, 'review');
    assert.ok(st.word && st.word.meaning === 'Instagram stories');
    assert.ok(st.tasks.includes('Buy milk and eggs') && st.tasks.includes('Make PowerPoint for owner'), st.tasks.join('|'));
    assert.ok(!st.flags.includes('aierror'), 'no AI errors');
    const t = await p.textContent('#content');
    assert.ok(/move on/.test(t) && /the mind will settle/.test(t), 'typos fixed and shown');
    assert.deepStrictEqual(p.errors, []);
  });

  await test('A3 Careful mode uses Claude’s default model; Ask AI again (single note) works both ways', async () => {
    const p = await page();
    await p.selectOption('#modeSel', 'careful');
    await paste(p, 'gym', 'go to gym evry morning\n\ncall Ravi about PowerPoint');
    await p.click('[data-act=organizeAll]'); await waitRunEnd(p);
    let c = await calls(p);
    assert.ok(c.length && c.every((x) => x.tier === 'default'), JSON.stringify(c.map((x) => x.tier)));
    await p.evaluate(() => { window.__calls.length = 0; });
    await p.click('[data-act=rerun][data-mode=fast] >> nth=0'); await waitRunEnd(p);
    c = await calls(p);
    assert.deepStrictEqual(c.map((x) => [x.kind, x.tier]), [['organize', 'quick']]);
    await p.evaluate(() => { window.__calls.length = 0; });
    await p.click('[data-act=rerun][data-mode=careful] >> nth=0'); await waitRunEnd(p);
    c = await calls(p);
    assert.deepStrictEqual(c.map((x) => [x.kind, x.tier]), [['organize', 'default']]);
    assert.deepStrictEqual(p.errors, []);
  });

  await test('A4 notes are kept in the private database (data/users/<id>) and come back after a reload; big non-English note split into parts', async () => {
    const p = await page();
    const big = ('ମୁଁ ଭଲ ଅଛି, आज मैं ठीक हूँ. teh day was long. ').repeat(2600); // ~120k characters, 3 bytes each for Odia/Hindi
    await paste(p, 'Big', big); await paste(p, 'Small', SAMPLE);
    await p.click('[data-act=organizeAll]'); await waitRunEnd(p, 30000); await saved(p);
    const d = await dump(p);
    const keys = Object.keys(d);
    assert.ok(keys.length && keys.every((k) => k.startsWith('data/users/u-owner/')), 'only in the private subtree: ' + keys.slice(0, 3));
    const sizes = await p.evaluate(() => window.__db.sizes());
    assert.ok(sizes.every(([, n]) => n <= 262144), 'every document under 256 KiB');
    assert.ok(keys.some((k) => /\+1$/.test(k)), 'the big note was split into parts');
    const before = await p.evaluate(() => JSON.stringify({ n: MD.state.notes, i: MD.state.items, t: MD.state.tasks }));
    await p.context().close();
    const p2 = await page({ dbData: d }, { raw: true });
    const after = await p2.evaluate(() => JSON.stringify({ n: MD.state.notes, i: MD.state.items, t: MD.state.tasks }));
    assert.strictEqual(after, before, 'same notes, items and tasks after reload');
    assert.ok(await p2.evaluate(() => MD.state.notes.some((n) => n.text.length > 100000 && n.text.includes('ମୁଁ ଭଲ'))));
    assert.deepStrictEqual(p.errors, []); assert.deepStrictEqual(p2.errors, []);
  });

  await test('A5 questions use the in-page dialog (no browser dialogs); Cancel keeps, Delete removes the note and its records', async () => {
    const p = await page();
    await paste(p, 'Keep me', 'buy milk'); await paste(p, 'Delete me', 'clean white shirt');
    await saved(p);
    const n = await p.evaluate(() => MD.state.notes.find((x) => x.name === 'Delete me').id);
    assert.ok(Object.keys(await dump(p)).some((k) => k.includes('note:' + n)));
    await p.click(`[data-act=selNote][data-id="${n}"]`);
    await p.click(`[data-act=deleteNote][data-id="${n}"]`);
    await p.waitForSelector('#askbox');
    assert.ok(/Delete “Delete me”/.test(await p.textContent('#askbox')));
    await p.click('#askNo'); await sleep(50);
    assert.ok(await p.evaluate((id) => MD.state.notes.some((x) => x.id === id), n), 'Cancel keeps it');
    await p.click(`[data-act=deleteNote][data-id="${n}"]`); await p.waitForSelector('#askbox');
    await p.keyboard.press('Escape'); await sleep(50);
    assert.ok(await p.evaluate((id) => MD.state.notes.some((x) => x.id === id), n), 'Escape keeps it');
    await p.click(`[data-act=deleteNote][data-id="${n}"]`); await p.waitForSelector('#askbox');
    await p.click('#askOk'); await saved(p); await sleep(200);
    assert.ok(!(await p.evaluate((id) => MD.state.notes.some((x) => x.id === id), n)), 'deleted');
    assert.ok(!Object.keys(await dump(p)).some((k) => k.includes('note:' + n)), 'its records are gone from the database');
    // a text question: rename
    const k = await p.evaluate(() => MD.state.notes[0].id);
    await p.click(`[data-act=selNote][data-id="${k}"]`); await p.click(`[data-act=renameNote][data-id="${k}"]`);
    await p.waitForSelector('#askIn'); await p.fill('#askIn', 'Renamed here'); await p.keyboard.press('Enter'); await sleep(50);
    assert.strictEqual(await p.evaluate(() => MD.state.notes[0].name), 'Renamed here');
    assert.deepStrictEqual(await p.evaluate(() => window.__dialogs), [], 'never a browser dialog');
    assert.deepStrictEqual(p.errors, []);
  });

  await test('A6 another device saves newer notes: this page stops saving, then loads the newest version', async () => {
    const p = await page();
    await paste(p, 'Mine', 'buy milk'); await saved(p);
    const d = await dump(p);
    // the other device: same records plus one more note, a higher rev, another session
    const meta = Object.keys(d).find((k) => /\/k\.meta$/.test(k));
    const m = JSON.parse(d[meta].s); m.rev = d[meta].rev + 5; m.keys = m.keys.concat(['note:nX']);
    await p.evaluate(({ meta, m, rev }) => {
      const base = meta.replace(/k\.meta$/, '');
      window.__db.remote(base + 'k.note:nX', { k: 'note:nX', i: 0, n: 1, rev, s: JSON.stringify({ note: { id: 'nX', name: 'From my phone', text: 'phone idea', addedAt: Date.now(), source: 'paste', status: 'new' }, items: [], tasks: [] }) });
      window.__db.remote(meta, { k: 'meta', i: 0, n: 1, rev, session: 'other-device', savedAt: Date.now(), s: JSON.stringify(Object.assign(m, { rev })) });
    }, { meta, m, rev: m.rev });
    await p.waitForSelector('#blocker [data-blocked], #blocker', { timeout: 5000 });
    assert.ok(/another device/.test(await p.textContent('#blocker')));
    // this page must not write any more
    const w0 = await p.evaluate(() => window.__db.writes);
    await p.evaluate(() => { MD.state.notes[0].name = 'changed here'; MD.save(); }); await sleep(1200);
    assert.strictEqual(await p.evaluate(() => window.__db.writes), w0, 'no writes while blocked');
    await p.click('#takeOver');
    await p.waitForFunction(() => MD.state.notes.some((n) => n.name === 'From my phone') && !document.querySelector('#blocker'));
    assert.deepStrictEqual(p.errors, []);
  });

  await test('A7 Claude errors: not allowed / usage limit stop the run with a clear message; nothing is lost', async () => {
    const p = await page();
    await paste(p, 'n', 'buy milk\n\ncall Ravi');
    await p.evaluate(() => { window.__sampleOverride = () => ({ error: { code: 'not_granted' } }); });
    await p.click('[data-act=organizeAll]'); await waitRunEnd(p);
    let t = await p.textContent('#overlay');
    assert.ok(/not allowed to use Claude/.test(t), t); assert.ok(!/Ollama/.test(t), 'no Ollama help');
    assert.strictEqual((await calls(p)).length, 1, 'stopped after the first refusal (no loop)');
    await p.click('[data-act=closeModal]');
    await p.evaluate(() => { window.__calls.length = 0; window.__sampleOverride = () => ({ error: { code: 'rate_limited' } }); });
    await p.click('[data-act=organizeAll]'); await waitRunEnd(p);
    t = await p.textContent('#overlay');
    assert.ok(/usage limit/.test(t), t);
    assert.strictEqual((await calls(p)).length, 1);
    await p.click('[data-act=closeModal]');
    assert.ok(await p.evaluate(() => MD.state.notes.length === 1 && MD.state.notes[0].text.includes('buy milk')));
    // Claude available again: the same button finishes the job
    await p.evaluate(() => { window.__sampleOverride = null; });
    await p.click('[data-act=organizeAll]'); await waitRunEnd(p);
    assert.ok(await p.evaluate(() => MD.state.items.length >= 2 && MD.state.items.every((i) => i.status === 'review')));
    assert.deepStrictEqual(p.errors, []);
  });

  await test('A8 an unreadable answer is asked again once; a part that fails twice is organized note by note', async () => {
    const p = await page();
    await paste(p, 'n', 'buy milk\n\ncall Ravi about PowerPoint\n\ntrust the univers');
    // the batch organize request answers nonsense twice; single requests work
    await p.evaluate(() => { window.__sampleOverride = (c) => (/"results":\[\{"id"/.test(c.input) ? { text: 'Sorry, I cannot do JSON today.' } : null); });
    await p.click('[data-act=organizeAll]'); await waitRunEnd(p);
    const c = await calls(p);
    const kinds = c.map((x) => x.kind);
    assert.strictEqual(kinds.filter((k) => k === 'organizeBatch').length, 2, 'batch asked twice, not more: ' + kinds);
    assert.strictEqual(kinds.filter((k) => k === 'organize').length, 3, 'then each note on its own: ' + kinds);
    assert.ok(await p.evaluate(() => MD.state.items.length === 3 && MD.state.items.every((i) => i.status === 'review' && !i.flags.includes('aierror'))));
    assert.deepStrictEqual(p.errors, []);
  });

  await test('A9 Stop ends a long Claude answer at once; an item that keeps failing is marked and keeps its text', async () => {
    const p = await page();
    await paste(p, 'n', 'buy milk\n\ncall Ravi');
    await p.evaluate(() => { window.__sampleOverride = () => ({ hang: true }); });
    await p.click('[data-act=organizeAll]');
    await p.waitForFunction(() => window.__calls.length === 1);
    await p.click('[data-act=stopRun]'); await waitRunEnd(p, 3000);
    assert.ok(await p.evaluate(() => MD.state.notes[0].status === 'new' || MD.state.items.every((i) => i.status === 'pending')), 'nothing organized');
    await p.evaluate(() => { window.__calls.length = 0; window.__sampleOverride = (c) => (/"title":""/.test(c.input) || /"results"/.test(c.input) ? { error: { code: 'upstream_error' } } : null); });
    await p.click('[data-act=organizeAll]'); await waitRunEnd(p);
    const st = await p.evaluate(() => MD.state.items.map((i) => ({ s: i.status, f: i.flags, t: i.text, o: i.original, e: i.error })));
    assert.ok(st.length === 2 && st.every((i) => i.s === 'review' && i.f.includes('aierror') && i.t === i.o && /could not be reached/.test(i.e)), JSON.stringify(st));
    assert.ok((await calls(p)).length <= 8, 'bounded number of requests');
    assert.deepStrictEqual(p.errors, []);
  });

  await test('A10 Download backup / Markdown / report go through the viewer’s save prompt; a PC backup restores', async () => {
    const p = await page();
    await paste(p, 'n', 'buy milk'); await saved(p);
    await p.click('[data-act=nav][data-v=settings]');
    await p.click('[data-act=exportJSON]'); await p.click('[data-act=downloadMD]');
    await p.waitForFunction(() => window.__saves.length === 2);
    const s = await p.evaluate(() => window.__saves);
    assert.ok(/^mind-desk-backup-\d{4}-\d\d-\d\d\.json$/.test(s[0].filename), s[0].filename);
    const b = JSON.parse(s[0].data); assert.strictEqual(b.app, 'mind-desk'); assert.strictEqual(b.notes.length, 1);
    assert.ok(/\.md$/.test(s[1].filename));
    // a backup made by the PC version (Ollama settings) is restored; the AI stays Claude
    const pc = Object.assign({}, b, { notes: [{ id: 'npc', name: 'From the PC', text: 'pc note', addedAt: Date.now(), source: 'file', status: 'new' }], settings: Object.assign({}, b.settings, { provider: 'ollama', model: 'qwen3.5:9b' }), version: '1.1.0' });
    const f = path.join(TMP, 'pc-backup.json'); fs.writeFileSync(f, JSON.stringify(pc));
    await p.setInputFiles('#importInput', f);
    await p.waitForSelector('#askbox'); assert.ok(/REPLACES everything/.test(await p.textContent('#askbox')));
    await p.click('#askOk');
    await p.waitForFunction(() => MD.state.notes.length === 1 && MD.state.notes[0].name === 'From the PC');
    assert.strictEqual(await p.evaluate(() => MD.state.settings.provider), 'claude');
    await saved(p);
    assert.ok(Object.keys(await dump(p)).some((k) => k.endsWith('k.note:npc')), 'restored note saved to the database');
    // report
    await p.click('[data-act=nav][data-v=inbox]'); await p.click('[data-act=report][data-id=npc]');
    await p.click('#rpDl'); await p.waitForFunction(() => window.__saves.length === 3);
    assert.ok(/^mind-desk-report-.*\.txt$/.test(await p.evaluate(() => window.__saves[2].filename)));
    assert.deepStrictEqual(p.errors, []);
  });

  await test('A11 Chat: the reply streams in while Claude writes; actions still need Apply; Remember works', async () => {
    const p = await page();
    await p.evaluate(() => {
      const S = MD.state; const now = Date.now();
      S.notes.push({ id: 'n1', name: 'gym', text: 'gym plan', addedAt: now, source: 'paste', status: 'split' });
      S.items.push({ id: 'i1', noteId: 'n1', order: 0, original: 'gym plan every morning', text: 'gym plan every morning', title: 'Gym plan', cat: 'unsorted', tags: [], status: 'approved', flags: [], lost: [], createdAt: now, updatedAt: now });
      window.__chatActions = [{ type: 'move_item', item: 'i1', category: 'personal' }];
      window.__cfg.delay = 250; MD.save(); MD.render();
    });
    await p.click('[data-act=nav][data-v=chat]');
    await p.fill('#chatIn', 'Move my gym notes to Personal goals and remember: BR is my client');
    await p.click('[data-act=sendChat]');
    await p.waitForFunction(() => { const el = document.querySelector('#liveReply'); return el && /Here is what I found/.test(el.textContent) && MD.RUN.active; }, null, { timeout: 5000 });
    await waitRunEnd(p);
    const t = await p.textContent('#msgs');
    assert.ok(/They look fine to me/.test(t) && /Move “Gym plan” to/.test(t), t.slice(0, 300));
    assert.strictEqual(await p.evaluate(() => MD.state.items[0].cat), 'unsorted', 'nothing changed before Apply');
    await p.click('[data-act=applyAction]');
    assert.strictEqual(await p.evaluate(() => MD.state.items[0].cat), 'personal');
    await p.click('[data-act=saveRemember]');
    assert.ok(await p.evaluate(() => MD.state.memory.some((m) => /BR is my client/.test(m.text))));
    assert.deepStrictEqual((await calls(p)).map((c) => [c.kind, c.cache]), [['chat', false]]);
    assert.deepStrictEqual(p.errors, []);
  });

  await test('A12 Fix my typing in the editor uses Claude and shows the changes first', async () => {
    const p = await page();
    await p.evaluate(() => { const S = MD.state; const now = Date.now(); S.notes.push({ id: 'n1', name: 'x', text: 'x', addedAt: now, source: 'paste', status: 'split' }); S.items.push({ id: 'i1', noteId: 'n1', order: 0, original: 'i wnat to bulid it', text: 'i wnat to bulid it', title: 'T', cat: 'mind', tags: [], status: 'review', flags: [], lost: [], createdAt: now, updatedAt: now }); MD.save(); MD.UI.view = 'review'; MD.render(); });
    await p.click('[data-act=edit][data-id=i1]'); await p.click('[data-act=fixTyping]');
    await p.waitForSelector('#fxOk'); assert.ok(/want/.test(await p.textContent('.modal')));
    await p.click('#fxOk');
    assert.strictEqual(await p.inputValue('#edText'), 'i want to build it');
    // leaving with unsaved changes asks in the page
    await p.click('[data-act=nav][data-v=todo]'); await p.waitForSelector('#askbox');
    await p.click('#askNo'); assert.strictEqual(await p.evaluate(() => MD.UI.view), 'review');
    await p.click('[data-act=saveEdit]');
    assert.strictEqual(await p.evaluate(() => MD.state.items[0].text), 'i want to build it');
    assert.deepStrictEqual(p.errors, []);
  });

  await test('A13 a changed number is caught and asked again on its own, stricter', async () => {
    const p = await page();
    await paste(p, 'n', 'pay 500 rent on 5th\n\ncall Ravi');
    await p.evaluate(() => { window.__changeNumbers = true; });
    await p.click('[data-act=organizeAll]'); await waitRunEnd(p);
    const c = await calls(p);
    const strict = c.filter((x) => x.kind === 'organize');
    assert.strictEqual(strict.length, 1, c.map((x) => x.kind).join());
    assert.ok(/IMPORTANT: a previous answer changed or removed words/.test(strict[0].input));
    const it = await p.evaluate(() => MD.state.items.find((i) => /rent/.test(i.original)));
    assert.ok(it.flags.includes('numbers'), 'the warning stays visible because the stand-in keeps changing it');
    assert.deepStrictEqual(p.errors, []);
  });

  await test('A14 phone width (400px): no sideways scroll, ☰ opens the menu over the page, choosing closes it', async () => {
    const p = await page({}, { viewport: { width: 400, height: 800 } });
    await paste(p, 'n', SAMPLE);
    for (const v of ['inbox', 'chat', 'settings', 'review', 'todo']) {
      await p.evaluate((v) => { MD.UI.view = v; MD.render(); }, v);
      const w = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth, document.body.scrollWidth]);
      assert.ok(w[0] <= w[1] && w[2] <= w[1], v + ' scrolls sideways: ' + w);
    }
    assert.ok(!(await p.isVisible('.side')), 'menu hidden at first');
    await p.click('[data-act=toggleSide]');
    assert.ok(await p.isVisible('.side'), 'menu open');
    await p.click('.side [data-act=nav][data-v=todo]');
    assert.ok(!(await p.isVisible('.side')), 'menu closed after choosing');
    assert.strictEqual(await p.evaluate(() => MD.UI.view), 'todo');
    await p.click('[data-act=toggleSide]'); await p.click('.sideshade', { position: { x: 380, y: 400 } });
    assert.ok(!(await p.isVisible('.side')), 'tap outside closes');
    assert.deepStrictEqual(p.errors, []);
  });

  await test('A15 theme follows the viewer: dark scheme and data-theme set by claude.ai are left alone', async () => {
    const p = await page({}, { colorScheme: 'dark' });
    assert.strictEqual(await p.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(23, 22, 20)');
    await p.evaluate(() => { document.documentElement.dataset.theme = 'light'; MD.state.settings.theme = 'dark'; MD.render(); });
    await p.evaluate(() => MD.ACT.nav({ dataset: { v: 'settings' } }));
    assert.strictEqual(await p.evaluate(() => document.documentElement.dataset.theme), 'light', 'viewer choice kept');
    assert.strictEqual(await p.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(245, 242, 236)');
    assert.deepStrictEqual(p.errors, []);
  });

  await test('A16 without the database (signed out / preview) it still works and says the notes stay in this browser', async () => {
    const p = await page({ db: false });
    assert.strictEqual(await p.evaluate(() => MDArtifact.mode), 'local');
    assert.ok(/only in this browser/.test(await p.textContent('#savestate')));
    await paste(p, 'n', 'buy milk'); await p.click('[data-act=organizeAll]'); await waitRunEnd(p);
    assert.ok(await p.evaluate(() => MD.state.items.length === 1));
    await saved(p); await p.reload(); await p.waitForFunction(() => window.MD && MD.LIFE.ok);
    assert.ok(await p.evaluate(() => MD.state.notes.length === 1), 'kept in this browser');
    assert.deepStrictEqual(p.errors, []);
  });

  await test('A17 without Claude (sample missing) Organize explains instead of failing silently', async () => {
    const p = await page({ sample: false });
    await paste(p, 'n', 'buy milk\n\ncall Ravi'); await p.click('[data-act=organizeAll]'); await waitRunEnd(p);
    assert.ok(/Claude is not available here/.test(await p.textContent('#overlay')));
    assert.deepStrictEqual(p.errors, []);
  });

  await test('A18 the test note in Settings answers through Claude', async () => {
    const p = await page();
    await p.click('[data-act=nav][data-v=settings]'); await p.click('[data-act=testAI]');
    await p.waitForFunction(() => /The AI answered/.test(document.querySelector('#connResult').textContent));
    const t = await p.textContent('#connResult'); assert.ok(/want to build/.test(t), t);
    assert.deepStrictEqual(p.errors, []);
  });

  await browser.close();
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} passed`);
  fs.writeFileSync(path.join(__dirname, 'last-artifact-results.json'), JSON.stringify(results, null, 1));
  process.exit(ok === results.length ? 0 : 1);
})();
