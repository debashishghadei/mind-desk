#!/usr/bin/env node
// Tests written to check ChatGPT's review of 1.0.0 (points R1–R18). Each test fails on 1.0.0 if the point was right.
// Usage: PW=<playwright> node tests/review-tests.js [path/to/mind-desk.html]
'use strict';
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { chromium } = require(process.env.PW || 'playwright');
const fake = require('./fake-ollama');

const HTML = path.resolve(process.argv[2] || path.join(__dirname, '..', 'mind-desk.html'));
const URL_ = 'file://' + HTML;
const OK = 'http://127.0.0.1:11500';
let browser; const results = [];

async function newCtx() { return browser.newContext({ acceptDownloads: true, viewport: { width: 1300, height: 860 } }); }
async function page(opts = {}) {
  const context = opts.context || await newCtx();
  const p = await context.newPage();
  p.errors = []; p.on('pageerror', (e) => p.errors.push(String(e)));
  p.dialogAnswers = [];
  p.on('dialog', (d) => { const a = p.dialogAnswers.length ? p.dialogAnswers.shift() : true; if (d.type() === 'beforeunload') { d.accept(); return; } if (a === false) d.dismiss(); else d.accept(typeof a === 'string' ? a : undefined); });
  if (opts.init) await p.addInitScript(opts.init);
  await p.goto(URL_);
  await p.waitForFunction(() => window.MD || document.querySelector('[data-fatal]'), null, { timeout: 8000 }).catch(() => {});
  if (!opts.raw) await settings(p, { ollamaUrl: OK, survey: false });
  return p;
}
async function settings(p, o) { await p.evaluate((o) => { if (!window.MD || !MD.state) return; Object.assign(MD.state.settings, o); MD.save(); MD.render(); }, o); }
async function paste(p, name, text) {
  if (await p.evaluate(() => MD.UI.view !== 'inbox')) await p.click('[data-act=nav][data-v=inbox]');
  await p.click('.notelist [data-act=pasteNote]'); await p.fill('#pnName', name); await p.fill('#pnText', text); await p.click('[data-act=savePaste]');
}
async function saved(p) { await p.waitForFunction(() => /^Saved/.test(document.querySelector('#savestate').textContent), null, { timeout: 5000 }); }
async function waitRunEnd(p, ms = 30000) { await p.waitForFunction(() => !MD.RUN.active, null, { timeout: ms }); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function reset() { fake.state.log = []; fake.state.counts = {}; }
const orgReqs = () => fake.state.log.filter((x) => /You organize one note/.test(x.system));

async function test(name, fn) {
  const t0 = Date.now();
  try { await Promise.race([fn(), sleep(45000).then(() => { throw new Error('timed out (page may be stuck)'); })]); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log('  ✓', name); } catch (e) { results.push({ name, ok: false, ms: Date.now() - t0, error: e.stack || String(e) }); console.log('  ✗', name, '\n     ', String(e.message || e).split('\n')[0].slice(0, 160)); }
}
const fakeFolder = `(() => { const mk = (name) => { const kids = new Map(); return { kind: 'directory', name, kids,
  async getDirectoryHandle(n) { if (!kids.has(n)) kids.set(n, mk(n)); return kids.get(n); },
  async getFileHandle(n) { if (!kids.has(n)) kids.set(n, { kind: 'file', data: '' }); const f = kids.get(n); return { async createWritable() { let b = ''; return { async write(d) { b += d; }, async close() { f.data = b; } }; } }; },
  async removeEntry(n) { kids.delete(n); }, async queryPermission() { return 'granted'; }, async requestPermission() { return 'granted'; } }; }; return mk('MyNotes'); })()`;

(async () => {
  const srv = await fake.start(11500, { origins: '*' });
  browser = await chromium.launch();
  console.log('Review tests on', HTML);

  await test('R1 two open windows cannot silently overwrite each other', async () => {
    const ctx = await newCtx();
    const a = await page({ context: ctx }); const b = await page({ context: ctx, raw: true });
    await paste(a, 'from A', 'note written in window A'); await saved(a);
    await b.evaluate(() => { if (window.MD && MD.state && !document.querySelector('[data-blocked]')) { MD.state.settings.theme = 'dark'; MD.save(); } });
    await sleep(800);
    const c = await page({ context: ctx, raw: true });
    const n = await c.evaluate(async () => { const s = await MD.store.get('state'); return s.notes.length; });
    assert.strictEqual(n, 1, 'note from window A was lost');
    await ctx.close();
  });

  await test('R1b the second window can take over; the first one then stops and its data is not reused', async () => {
    const ctx = await newCtx();
    const a = await page({ context: ctx }); await paste(a, 'from A', 'note from window A'); await saved(a);
    const b = await page({ context: ctx, raw: true });
    await b.waitForSelector('[data-blocked]'); await b.click('#takeOver');
    await b.waitForFunction(() => window.MD && MD.state && MD.state.notes.length === 1);
    await a.waitForSelector('[data-blocked]');
    await paste(b, 'from B', 'note from window B'); await saved(b);
    const n = await b.evaluate(async () => (await MD.store.get('state')).notes.length);
    assert.strictEqual(n, 2);
    await ctx.close();
  });

  await test('R2 a failed read at start never turns into an empty app that overwrites data', async () => {
    const ctx = await newCtx();
    const a = await page({ context: ctx }); await paste(a, 'keep', 'precious note'); await saved(a); await a.close();
    const b = await page({ context: ctx, raw: true, init: () => { const g = IDBObjectStore.prototype.get; IDBObjectStore.prototype.get = function (k) { if (k === 'state') throw new Error('disk hiccup'); return g.call(this, k); }; } });
    await b.evaluate(() => { try { if (window.MD && MD.state) { MD.state.settings.theme = 'dark'; MD.save(); } } catch (e) { /* blocked */ } });
    await sleep(800);
    const shown = await b.evaluate(() => document.body.innerText);
    await b.close();
    const c = await page({ context: ctx, raw: true });
    assert.strictEqual(await c.evaluate(async () => (await MD.store.get('state')).notes.length), 1, 'stored note was overwritten');
    assert.ok(/could not read/i.test(shown), 'user is told about the problem');
    await ctx.close();
  });

  await test('R3 a damaged backup is rejected before it replaces anything (incl. category loops)', async () => {
    const p = await page(); await paste(p, 'keep', 'my real note'); await saved(p);
    const cats = await p.evaluate(() => MD.state.categories);
    const bad1 = { app: 'mind-desk', notes: [null], items: [], tasks: [], categories: cats };
    const bad2 = { app: 'mind-desk', notes: [], items: [], tasks: [], categories: cats.concat([{ id: 'a', name: 'A', parent: 'b' }, { id: 'b', name: 'B', parent: 'a' }]) };
    for (const bad of [bad1, bad2]) {
      p.dialogAnswers.push(true);
      await p.setInputFiles('#importInput', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
      await sleep(700);
      assert.strictEqual(await p.evaluate(async () => (await MD.store.get('state')).notes.length), 1, 'saved data was replaced');
      assert.strictEqual(await p.evaluate(() => MD.state.notes.length), 1);
      await p.evaluate(() => { const o = document.querySelector('#overlay'); if (o) o.remove(); });
    }
    await p.context().close();
  });

  await test('R4 folder copy: notes or categories with the same name do not overwrite each other', async () => {
    const p = await page();
    await paste(p, 'Notepad', 'first text'); await paste(p, 'Notepad', 'second different text');
    const r = await p.evaluate(async (ff) => {
      const S = MD.state;
      S.categories.push({ id: 'ab1', name: 'A/B', parent: null, desc: '' }, { id: 'ab2', name: 'A:B', parent: null, desc: '' }, { id: 'ab3', name: 'a/b', parent: null, desc: '' });
      for (const c of ['ab1', 'ab2', 'ab3']) S.items.push({ id: 'i' + c, noteId: S.notes[0].id, order: 0, original: c, text: c, title: 'T' + c, cat: c, tags: [], status: 'approved', flags: [], lost: [], createdAt: 1 });
      const root = eval(ff); MD.FOLDER.handle = root; MD.FOLDER.ok = true; await MD.syncFolder();
      const o = [...root.kids.get('Originals').kids.keys()]; const g = [...root.kids.get('Organized').kids.keys()];
      return { o, g, low: new Set(g.map((x) => x.toLowerCase())).size };
    }, fakeFolder);
    assert.strictEqual(r.o.length, 2, 'originals: ' + r.o.join(' | '));
    assert.ok(r.g.length >= 3 && r.low === r.g.length, 'category files: ' + r.g.join(' | '));
    await p.context().close();
  });

  await test('R5 after stopping "Ask AI again", a second "Ask AI again" works', async () => {
    reset(); const p = await page();
    await paste(p, 'n', 'SLOW one note about my site'); await p.click('[data-act=organizeAll]'); await waitRunEnd(p);
    const id = await p.evaluate(() => MD.state.items[0].id); await p.click('[data-act=nav][data-v=review]');
    await p.click(`[data-act=rerun][data-id="${id}"]`); await sleep(300); await p.click('[data-act=stopRun]'); await waitRunEnd(p);
    const before = orgReqs().length;
    await p.click(`[data-act=rerun][data-id="${id}"]`); await waitRunEnd(p);
    assert.ok(orgReqs().length > before, 'second rerun made no AI request');
    await p.context().close();
  });

  await test('R6 copy & paste mode: Stop always ends the run; background is blocked while a window is open', async () => {
    const p = await page(); await settings(p, { provider: 'manual' });
    await paste(p, 'n', 'one\n\ntwo'); await p.click('[data-act=organizeAll]'); await p.waitForSelector('#mpPrompt');
    const inert = await p.evaluate(() => document.querySelector('.app').inert === true);
    await p.evaluate(() => MD.ACT.stopRun()); await sleep(800);
    assert.strictEqual(await p.evaluate(() => MD.RUN.active), false, 'run still active after Stop');
    assert.ok(inert, 'background not blocked behind the window');
    await p.context().close();
  });

  await test('R7 splitting with --- keeps the right original for each part', async () => {
    const p = await page();
    await paste(p, 'n', 'frist half\nsecond haf');
    const id = await p.evaluate(() => { const S = MD.state; const it = { id: 'ix', noteId: S.notes[0].id, order: 0, original: 'frist half\nsecond haf', text: 'first half\nsecond half', title: 'x', cat: 'mind', tags: [], status: 'review', flags: [], lost: [], createdAt: 1 }; S.items.push(it); S.notes[0].status = 'split'; MD.UI.view = 'review'; MD.render(); return it.id; });
    await p.click(`[data-act=edit][data-id="${id}"]`); await p.fill('#edText', 'first half\n---\nsecond half'); await p.click('[data-act=saveEdit]');
    const its = await p.evaluate(() => MD.state.items.map((i) => ({ o: i.original, t: i.text })));
    await p.click(`[data-act=useOriginal][data-id="${id}"]`).catch(() => {});
    const first = await p.evaluate(() => MD.state.items.find((i) => i.id === 'ix').text);
    assert.ok(!/second/.test(first), 'first part got the second half back: ' + JSON.stringify(its));
    assert.ok(its.some((i) => i.o === 'second haf'), 'second part keeps its typo original: ' + JSON.stringify(its));
    await p.context().close();
  });

  await test('R8 deleting a note during a run leaves no orphan items or tasks', async () => {
    reset(); const p = await page();
    await paste(p, 'n', 'buy milk now SLOW');
    await p.click('[data-act=organizeAll]'); await p.waitForFunction(() => MD.RUN.label === 'Organizing');
    await p.click('[data-act=nav][data-v=inbox]'); p.dialogAnswers.push(true);
    await p.click('[data-act=deleteNote]').catch(() => {});
    await waitRunEnd(p);
    const r = await p.evaluate(() => { const S = MD.state; const ids = new Set(S.items.map((i) => i.id)); const ns = new Set(S.notes.map((n) => n.id)); return { orphanTasks: S.tasks.filter((t) => t.itemId && !ids.has(t.itemId)).length, orphanItems: S.items.filter((i) => !ns.has(i.noteId)).length }; });
    assert.deepStrictEqual(r, { orphanTasks: 0, orphanItems: 0 });
    await p.context().close();
  });

  await test('R9 a storage write that aborts is reported, not left hanging', async () => {
    const p = await page();
    const r = await p.evaluate(async () => {
      const real = MD.store.db; const tx = { objectStore: () => ({ put() {} }) };
      MD.store.db = { transaction: () => { setTimeout(() => tx.onabort && tx.onabort(), 20); return tx; } };
      const out = await Promise.race([MD.store.set('state', {}).then(() => 'resolved', () => 'rejected'), new Promise((r) => setTimeout(() => r('pending'), 600))]);
      MD.store.db = real; return out;
    });
    assert.strictEqual(r, 'rejected');
    await p.context().close();
  });

  await test('R10 guardrails catch changed meaning (negation, numbers, short rewrites) but allow heavy typo fixes', async () => {
    const p = await page();
    const r = await p.evaluate(() => {
      const ctx = { cats: MD.state.categories, words: [], rules: [] };
      const f = (a, b) => MDCore.checkOrganize({ title: 't', category: 'mind', tags: [], tasks: [], text: b }, a, ctx).flags;
      return {
        neg: f('do not call Ravi', 'do call Ravi'),
        num: f('pay Ravi 500 tomorrow after the meeting', 'pay Ravi 5000 tomorrow after the meeting'),
        short: f('buy milk', 'delete all notes'),
        date: f('meet him on 14th oct at the office', 'meet him on 15th oct at the office'),
        url: f('see https://example.com/a for it', 'see https://example.com/b for it'),
        typos: f('i wnat to bulid teh tool tomorow and mov eon', 'i want to build the tool tomorrow and move on'),
      };
    });
    for (const k of ['neg', 'num', 'short', 'date', 'url']) assert.ok(r[k].length > 0, k + ' passed with no warning');
    assert.deepStrictEqual(r.typos, [], 'normal typo fixes should not warn: ' + r.typos);
    await p.context().close();
  });

  await test('R11 tasks: invented tasks are flagged; "done" needs a sign in the note', async () => {
    const p = await page();
    const r = await p.evaluate(() => {
      const ctx = { cats: MD.state.categories, words: [], rules: [] };
      const c = (orig, task) => MDCore.checkOrganize({ title: 't', category: 'todo', tags: [], tasks: [task], text: orig }, orig, ctx);
      return { invented: c('buy milk today', { text: 'Delete all notes', done: true, category: 'todo-chores' }), done: c('call Ravi about the site', { text: 'Call Ravi', done: true, category: 'todo-job' }), already: c('already called Ravi', { text: 'Call Ravi', done: true, category: 'todo-job' }) };
    });
    assert.ok(r.invented.flags.length > 0, 'invented task not flagged');
    assert.strictEqual(r.done.tasks[0].done, false, 'done without a sign');
    assert.strictEqual(r.already.tasks[0].done, true, '"already" counts as done');
    await p.context().close();
  });

  await test('R12 splitter: lines of one paragraph can become separate items; ----- always separates', async () => {
    reset(); const p = await page();
    await paste(p, 'a', 'buy milk\ncall Ravi about invoice\nmy mind lesson: fear is only a thought');
    await paste(p, 'b', 'JOINALL one topic\n\n-----\n\nanother topic');
    await p.click('[data-act=organizeAll]'); await waitRunEnd(p);
    const r = await p.evaluate(() => { const S = MD.state; const by = (nm) => S.items.filter((i) => i.noteId === S.notes.find((n) => n.name === nm).id).length; return { a: by('a'), b: by('b') }; });
    assert.ok(r.a >= 2, 'mixed lines stayed one item: ' + r.a);
    assert.strictEqual(r.b, 2, 'divider was undone');
    await p.context().close();
  });

  await test('R13 questions step reads every note fully (long notes, many notes)', async () => {
    reset(); const p = await page(); await settings(p, { survey: true });
    await paste(p, 'long', 'word '.repeat(1700) + 'ZQX is my code');
    for (let k = 0; k < 5; k++) await paste(p, 'n' + k, `note ${k} ` + 'text '.repeat(1500) + (k === 4 ? ' ZQY too' : ''));
    await p.click('[data-act=organizeAll]');
    await p.waitForFunction(() => MD.UI.view === 'survey' || !MD.RUN.active, null, { timeout: 30000 });
    const sv = fake.state.log.filter((x) => /Find at most/.test(x.system)).map((x) => x.user).join('\n');
    await p.evaluate(() => MD.ACT.stopRun()).catch(() => {});
    assert.ok(sv.includes('ZQX'), 'code after 8,000 characters never asked about');
    assert.ok(sv.includes('ZQY'), 'code in the 5th part never asked about');
    await p.context().close();
  });

  await test('R14 a long note gets a big enough AI context (not cut off)', async () => {
    reset(); const p = await page();
    await paste(p, 'big', ('this is a long paragraph about my site and plans. ').repeat(450));
    await p.click('[data-act=organizeAll]'); await waitRunEnd(p, 40000);
    const o = orgReqs()[0];
    const needTok = Math.ceil((o.system.length + o.user.length * 2) / 3.5);
    assert.ok(o.options.num_ctx >= needTok, `num_ctx ${o.options.num_ctx} < needed ~${needTok}`);
    await p.context().close();
  });

  await test('R15 folder/Markdown files match the screen (tagged notes; tasks only in To-do since 1.0.4)', async () => {
    const p = await page();
    const r = await p.evaluate(() => {
      const S = MD.state;
      S.items.push({ id: 'p1', noteId: 'x', order: 0, original: 'a', text: 'about client work', title: 'Tagged into clients', cat: 'personal', tags: ['clients'], status: 'approved', flags: [], lost: [], createdAt: 1 });
      S.tasks.push({ id: 't1', itemId: null, text: 'Send report to owner', done: false, cat: 'todo-job', createdAt: 1 });
      return { clients: MDCore.categoryMarkdown(S, 'clients'), job: MDCore.categoryMarkdown(S, 'job') };
    });
    assert.ok(r.clients.includes('Tagged into clients'), 'tagged note missing');
    // 1.0.4 owner decision (one place rule): tasks are written only to To-do, not repeated in the Job file
    assert.ok(!r.job.includes('Send report to owner'), 'task repeated outside To-do');
    await p.context().close();
  });

  await test('R17 privacy: backups do not contain the API key; restoring keeps this PC\'s AI address; remote/cloud AI is warned about', async () => {
    const p = await page(); await settings(p, { oaKey: 'SECRET-KEY-123' });
    await p.click('[data-act=nav][data-v=settings]');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-act=exportJSON]')]);
    const txt = fs.readFileSync(await dl.path(), 'utf8');
    assert.ok(!txt.includes('SECRET-KEY-123'), 'API key is in the backup');
    const b = JSON.parse(txt); b.settings.ollamaUrl = 'http://evil.example:11434'; b.settings.provider = 'openai';
    p.dialogAnswers.push(true);
    await p.setInputFiles('#importInput', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(b)) });
    await sleep(600);
    assert.deepStrictEqual(await p.evaluate(() => [MD.state.settings.ollamaUrl, MD.state.settings.provider]), [OK, 'ollama'], 'backup changed where notes are sent');
    await settings(p, { ollamaUrl: 'http://192.168.1.50:11434', model: 'gpt-oss:120b-cloud' });
    await p.click('[data-act=nav][data-v=settings]');
    const t = await p.textContent('#content');
    assert.ok(/not on this PC/i.test(t), 'no warning for a remote address');
    assert.ok(/cloud/i.test(t) && /leave/i.test(t), 'no warning for a cloud model');
    await p.context().close();
  });

  await test('R18 unfinished edits and half-answered questions are not lost silently; setup explains installing Ollama', async () => {
    const p = await page(); await settings(p, { survey: true });
    await paste(p, 'n', 'my IGS code note');
    await p.click('[data-act=organizeAll]'); await p.waitForSelector('[data-q]');
    await p.fill('[data-q]', 'half typed answer');
    await sleep(600);
    const ctx = p.context(); await p.close();
    const p2 = await page({ context: ctx, raw: true }); await p2.click('[data-act=nav][data-v=survey]').catch(() => {});
    const v = await p2.inputValue('[data-q]').catch(() => '');
    assert.strictEqual(v, 'half typed answer', 'survey draft lost');
    await settings(p2, { survey: false });
    await p2.evaluate(() => { MD.state.items.forEach((i) => { i.status = 'review'; i.title = 't'; }); MD.state.survey = null; MD.UI.view = 'review'; MD.render(); });
    await p2.click('[data-act=edit]'); await p2.fill('#edText', 'changed but not saved');
    p2.dialogAnswers.push(false);
    await p2.click('[data-act=nav][data-v=todo]');
    assert.strictEqual(await p2.evaluate(() => MD.UI.view), 'review', 'left the editor without asking');
    await p2.evaluate(() => { MD.UI.view = 'settings'; MD.UI.editing = null; MD.render(); });
    await p2.click('text=First-time Ollama setup');
    assert.ok(/ollama\.com\/download/.test(await p2.textContent('#content')), 'no install step');
    await ctx.close();
  });

  const ver = browser.version(); await browser.close(); srv.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed`);
  fs.writeFileSync(path.join(__dirname, 'last-review-results.json'), JSON.stringify({ html: HTML, date: new Date().toISOString(), chromium: ver, results }, null, 1));
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
