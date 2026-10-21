#!/usr/bin/env node
// Tests for ChatGPT's review of 1.0.1 (points S1–S17). Each test fails on 1.0.1 if the point was right.
// Usage: PW=<playwright> node tests/review2-tests.js [path/to/mind-desk.html]
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
  p.on('dialog', (d) => { if (d.type() === 'beforeunload') { d.accept(); return; } const a = p.dialogAnswers.length ? p.dialogAnswers.shift() : true; if (a === false) d.dismiss(); else d.accept(typeof a === 'string' ? a : undefined); });
  if (opts.init) await p.addInitScript(opts.init);
  await p.goto(URL_);
  await p.waitForFunction(() => (window.MD && MD.state) || document.querySelector('[data-fatal],[data-blocked]'), null, { timeout: 8000 }).catch(() => {});
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
async function test(name, fn) {
  if (process.env.ONLY && !name.startsWith(process.env.ONLY + ' ')) return;
  const t0 = Date.now();
  try { await Promise.race([fn(), sleep(45000).then(() => { throw new Error('timed out (page may be stuck)'); })]); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log('  ✓', name); } catch (e) { results.push({ name, ok: false, ms: Date.now() - t0, error: e.stack || String(e) }); console.log('  ✗', name, '\n     ', String(e.message || e).split('\n')[0].slice(0, 170)); }
}
// in-memory folder with write counting; writes to "Mind Desk backup.json" can be paused with window.__gate
const fakeFolder = `(() => { window.__writes = 0; const mk = (name) => { const kids = new Map(); return { kind: 'directory', name, kids,
  async getDirectoryHandle(n) { if (!kids.has(n)) kids.set(n, mk(n)); return kids.get(n); },
  async getFileHandle(n) { if (!kids.has(n)) kids.set(n, { kind: 'file', data: '' }); const f = kids.get(n); return { async createWritable() { let b = ''; return {
    async write(d) { if (n === 'Mind Desk backup.json' && window.__gate) await window.__gate; b += d; },
    async close() { f.data = b; window.__writes++; }, async abort() { b = ''; } }; } }; },
  async removeEntry(n) { kids.delete(n); }, async queryPermission() { return 'granted'; }, async requestPermission() { return 'granted'; } }; }; return mk('MyNotes'); })()`;
const core = (p, fn, ...args) => p.evaluate(fn, ...args);

(async () => {
  const srv = await fake.start(11500, { origins: '*' });
  browser = await chromium.launch();
  console.log('Review 2 tests on', HTML);

  await test('S1 two quick saves in one window do not block it or lose the second change', async () => {
    const p = await page();
    await p.evaluate(() => { const real = MD.store.putState.bind(MD.store); let n = 0; MD.store.putState = async (s, r) => { const res = await real(s, r); if (n++ === 0) await new Promise((x) => setTimeout(x, 900)); return res; }; });
    await paste(p, 'one', 'first note'); await sleep(400); await paste(p, 'two', 'second note');
    await sleep(2500);
    assert.strictEqual(!!(await p.$('[data-blocked]')), false, 'window blocked itself');
    assert.strictEqual(await p.evaluate(async () => (await MD.store.get('state')).notes.length), 2);
    await p.context().close();
  });

  await test('S2 a note not yet saved when another window takes over can be recovered', async () => {
    const ctx = await newCtx();
    const a = await page({ context: ctx });
    await a.evaluate(() => { MD.store.putState = () => Promise.reject(new Error('disk full')); });
    await paste(a, 'unsaved', 'NOTE-NOT-SAVED-YET'); await sleep(600);
    const b = await page({ context: ctx, raw: true });
    await b.waitForSelector('[data-blocked]'); await b.click('#takeOver');
    await a.waitForSelector('[data-blocked]'); await sleep(800);
    await b.evaluate(() => window.dispatchEvent(new Event('focus'))); await sleep(500);
    const rec = await b.evaluate(async () => JSON.stringify(await MD.store.get('recovery') || null));
    assert.ok(rec.includes('NOTE-NOT-SAVED-YET'), 'unsaved note not kept anywhere');
    assert.ok(/not saved/i.test(await b.textContent('body')), 'the new window does not mention the unsaved copy');
    await ctx.close();
  });

  await test('S3 folder saving stops when nothing changes', async () => {
    const p = await page();
    await p.evaluate(async (ff) => { const root = eval(ff); MD.FOLDER.handle = root; MD.FOLDER.ok = true; await MD.syncFolder(); }, fakeFolder);
    await sleep(2000); const w0 = await p.evaluate(() => window.__writes); // let saves started before the folder was connected finish
    await sleep(4500); const w1 = await p.evaluate(() => window.__writes);
    assert.strictEqual(w1, w0, `folder kept writing: ${w1 - w0} extra writes while idle`);
    await p.context().close();
  });

  await test('S4 a window that lost control cannot finish an older folder backup over a newer one', async () => {
    const p = await page(); await paste(p, 'n', 'some note'); await saved(p);
    const data = await p.evaluate(async (ff) => {
      const root = eval(ff); MD.FOLDER.handle = root; MD.FOLDER.ok = true;
      let release; window.__gate = new Promise((r) => { release = r; });
      const run = MD.syncFolder();
      await new Promise((r) => setTimeout(r, 200));
      MD.LIFE.blocked = true; // another window took over …
      (await root.getFileHandle('Mind Desk backup.json')).createWritable; root.kids.get('Mind Desk backup.json').data = 'NEWER-FROM-OTHER-WINDOW';
      window.__gate = null; release(); await run;
      return root.kids.get('Mind Desk backup.json').data;
    }, fakeFolder);
    assert.strictEqual(data, 'NEWER-FROM-OTHER-WINDOW', 'old window overwrote the newer backup');
    await p.context().close();
  });

  await test('S5 after "Use Mind Desk here" the saved folder connection is picked up', async () => {
    const ctx = await newCtx();
    const a = await page({ context: ctx }); await a.evaluate(() => MD.store.set('folder', { name: 'MyNotes' }));
    const b = await page({ context: ctx, raw: true }); await b.waitForSelector('[data-blocked]'); await b.click('#takeOver');
    await b.waitForFunction(() => window.MD && MD.state); await sleep(400);
    assert.strictEqual(await b.evaluate(() => MD.FOLDER.name), 'MyNotes');
    await ctx.close();
  });

  await test('S6 backups with a damaged question list, prompts, words or settings are rejected', async () => {
    const p = await page(); await paste(p, 'keep', 'my real note'); await saved(p);
    const base = await p.evaluate(() => JSON.parse(JSON.stringify(MD.state)));
    const bads = [
      Object.assign({}, base, { survey: { questions: null } }),
      Object.assign({}, base, { prompts: { organize: 5 } }),
      Object.assign({}, base, { words: [{ id: 'w1', term: 'x', meaning: 5 }] }),
      Object.assign({}, base, { settings: { theme: { a: 1 } } }),
    ];
    for (const bad of bads) {
      p.dialogAnswers.push(true);
      await p.setInputFiles('#importInput', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
      await sleep(600);
      await p.evaluate(() => { const o = document.querySelector('#overlay'); if (o) o.remove(); const a = document.querySelector('.app'); if (a) a.inert = false; });
      assert.strictEqual(p.errors.length, 0, 'page error: ' + p.errors[0]);
      assert.strictEqual(await p.evaluate(() => (MD.state.survey === null || Array.isArray(MD.state.survey.questions)) && typeof MD.state.settings.theme === 'string'), true, 'damaged backup was taken: ' + JSON.stringify(bad).slice(0, 80));
    }
    await p.context().close();
  });

  await test('S7 ids in a backup cannot inject HTML', async () => {
    const p = await page(); await paste(p, 'keep', 'note'); await saved(p);
    const b = await p.evaluate(() => { const o = JSON.parse(JSON.stringify(MD.state)); o.notes[0].id = 'n"><img src=x onerror="window.__probe=1">'; return o; });
    p.dialogAnswers.push(true);
    await p.setInputFiles('#importInput', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(b)) });
    await sleep(800);
    assert.strictEqual(await p.evaluate(() => window.__probe || 0), 0, 'HTML from the backup ran');
    assert.strictEqual(await p.evaluate(() => document.querySelectorAll('.app img').length), 0);
    await p.context().close();
  });

  await test('S8 splitting finds the matching original words (and never calls the cleaned text "original")', async () => {
    const p = await page();
    const r = await core(p, () => {
      const a = MDCore.splitOriginal('i wnat to mov eon', ['i want to', 'move on']);
      const typo = (n, t) => Array.from({ length: n }, (_, i) => (i % 7 === 0 ? 'wnat' : 'word' + (i % 50) + t)).join(' ');
      const fix = (s) => s.replace(/wnat/g, 'want');
      const o1 = typo(2600, 'a'), o2 = typo(2600, 'b');
      const big = MDCore.splitOriginal(o1 + '\n' + o2, [fix(o1), fix(o2)]);
      return { a: [...a], bigFirst: big[0].slice(0, 30), bigIsClean: big[0] === fix(o1), bigStartsOrig: big[0].startsWith(o1.slice(0, 40)), bigEnd: big[1].endsWith(o2.slice(-40)) };
    });
    assert.deepStrictEqual(r.a, ['i wnat to', 'mov eon']);
    assert.ok(!r.bigIsClean && r.bigStartsOrig && r.bigEnd, JSON.stringify(r));
    await p.context().close();
  });

  await test('S9 other buttons do not throw away text you are editing', async () => {
    const p = await page(); await paste(p, 'n', 'a\n\nb');
    await p.evaluate(() => { const S = MD.state; const n = S.notes[0]; n.status = 'split'; for (const k of [0, 1]) S.items.push({ id: 'it' + k, noteId: n.id, order: k, original: 'x' + k, text: 'x' + k, title: 'T' + k, cat: 'mind', tags: [], status: 'review', flags: k ? ['numbers'] : [], lost: [], createdAt: 1 }); MD.UI.view = 'review'; MD.render(); });
    await p.click('[data-act=edit][data-id=it0]'); await p.fill('#edText', 'MY DRAFT TEXT');
    await p.click('[data-act=flaggedOnly]'); await p.click('[data-act=flaggedOnly]');
    assert.strictEqual(await p.inputValue('#edText').catch(() => ''), 'MY DRAFT TEXT', 'draft lost after the warning filter');
    await p.click('[data-act=approve][data-id=it1]');
    assert.strictEqual(await p.inputValue('#edText').catch(() => ''), 'MY DRAFT TEXT', 'draft lost after approving another card');
    await p.context().close();
  });

  await test('S10 long notes: unchanged text gives no warning; one fixed typo shows as one change', async () => {
    const p = await page();
    const r = await core(p, () => {
      const ctx = { cats: MD.state.categories, words: [], rules: [] };
      const same = 'hello '.repeat(2100).trim();
      const f1 = MDCore.checkOrganize({ title: 't', category: 'mind', tags: [], tasks: [], text: same }, same, ctx).flags;
      const d1 = MDCore.diff(same, same).filter((x) => x.t !== 'eq').length;
      const orig = 'hello '.repeat(1000) + 'wnat ' + 'hello '.repeat(1100);
      const f2 = MDCore.checkOrganize({ title: 't', category: 'mind', tags: [], tasks: [], text: orig.replace('wnat', 'want') }, orig, ctx).flags;
      const d2 = MDCore.diff(orig, orig.replace('wnat', 'want')).filter((x) => x.t !== 'eq').map((x) => x.s.trim());
      return { f1, d1, f2, d2 };
    });
    assert.deepStrictEqual(r.f1, []); assert.strictEqual(r.d1, 0);
    assert.deepStrictEqual(r.f2, []); assert.deepStrictEqual(r.d2, ['wnat', 'want']);
    await p.context().close();
  });

  await test('S11 swapped numbers, added "not" and moved "not" are caught; normal fixes of "dont"/"nto" are not', async () => {
    const p = await page();
    const r = await core(p, () => {
      const ctx = { cats: MD.state.categories, words: [], rules: [] };
      const f = (a, b) => MDCore.checkOrganize({ title: 't', category: 'mind', tags: [], tasks: [], text: b }, a, ctx).flags;
      return {
        swap: f('pay Ravi 500 and Amit 1000', 'pay Ravi 1000 and Amit 500'),
        added: f('call Ravi about the website tomorrow morning', 'do not call Ravi about the website tomorrow morning'),
        moved: f('do not call Ravi today\ncall Amit about the site', 'call Ravi today\ndo not call Amit about the site'),
        ok1: f('i dont wnat to go there', "i don't want to go there"),
        ok2: f('i nto organiz the notes now', 'i not organize the notes now'),
      };
    });
    assert.ok(r.swap.includes('numbers'), 'swap'); assert.ok(r.added.includes('negation'), 'added'); assert.ok(r.moved.includes('negation'), 'moved');
    assert.ok(!r.ok1.includes('negation') && !r.ok2.includes('negation'), 'false alarm: ' + r.ok1 + ' / ' + r.ok2);
    await p.context().close();
  });

  await test('S12 "done" is judged per task, and "not done" is not done', async () => {
    const p = await page();
    const r = await core(p, () => {
      const ctx = { cats: MD.state.categories, words: [], rules: [] };
      const c = (o, t) => MDCore.checkOrganize({ title: 't', category: 'todo', tags: [], tasks: [{ text: t, done: true, category: 'todo-chores' }], text: o }, o, ctx).tasks[0].done;
      return { mixed: c('paid rent; call Ravi tomorrow', 'Call Ravi'), rent: c('paid rent; call Ravi tomorrow', 'Pay rent'), notdone: c('not done: call Ravi', 'Call Ravi') };
    });
    assert.deepStrictEqual(r, { mixed: false, rent: true, notdone: false });
    await p.context().close();
  });

  await test('S13 task check: invented tasks sharing a word are flagged; a real task next to "not Amit" is not', async () => {
    const p = await page();
    const r = await core(p, () => {
      const ctx = { cats: MD.state.categories, words: [], rules: [] };
      const w = (o, t) => MDCore.checkOrganize({ title: 't', category: 'todo', tags: [], tasks: [{ text: t, done: false, category: 'todo-chores' }], text: o }, o, ctx).flags.includes('taskcheck');
      return { bread: w('buy milk', 'Buy bread and milk'), del: w('need to call Ravi tomorrow', 'Delete Ravi'), tv: w('buy milk', 'Buy TV'), amit: w('call Ravi, not Amit', 'Call Ravi'), ppt: w('make ppt for owner', 'Make PowerPoint for owner') };
    });
    assert.deepStrictEqual(r, { bread: true, del: true, tv: true, amit: false, ppt: false });
    await p.context().close();
  });

  await test("S14 no warning for a curly apostrophe, upper case, or '2day' → 'today'", async () => {
    const p = await page();
    const r = await core(p, () => {
      const ctx = { cats: MD.state.categories, words: [], rules: [] };
      const f = (a, b) => MDCore.checkOrganize({ title: 't', category: 'mind', tags: [], tasks: [], text: b }, a, ctx).flags;
      return [f("i can't do it now", 'i can’t do it now'), f('i CANT do it now', "i can't do it now"), f('buy milk 2day please', 'buy milk today please'), f('kaam nahi hua yaar', 'kaam nahi hua yaar')];
    });
    assert.deepStrictEqual(r, [[], [], [], []]);
    await p.context().close();
  });

  await test('S15 "Use my original" clears the number and "not" warnings too', async () => {
    const p = await page(); await paste(p, 'n', 'x');
    await p.evaluate(() => { const S = MD.state; S.notes[0].status = 'split'; S.items.push({ id: 'iu', noteId: S.notes[0].id, order: 0, original: 'pay 500', text: 'pay 5000', title: 't', cat: 'mind', tags: [], status: 'review', flags: ['numbers', 'negation'], lost: [], createdAt: 1 }); MD.UI.view = 'review'; MD.render(); });
    await p.click('[data-act=useOriginal][data-id=iu]');
    assert.deepStrictEqual(await p.evaluate(() => MD.state.items.find((i) => i.id === 'iu').flags), []);
    await p.context().close();
  });

  await test('S16 a failed questions step stays visible on the note after a reload, and can be repeated', async () => {
    const p = await page(); await settings(p, { survey: true });
    await paste(p, 'n', 'BADSURVEY my ZZQ code note about the site');
    await p.click('[data-act=organizeAll]'); await waitRunEnd(p); await saved(p);
    const ctx = p.context(); await p.close();
    const p2 = await page({ context: ctx, raw: true }); await p2.click('[data-act=nav][data-v=review]');
    const t = await p2.textContent('#content');
    assert.ok(/questions? (step )?(failed|were not)/i.test(t), 'no lasting warning on the item');
    assert.ok(!!(await p2.$('[data-act=resurvey]')), 'no way to repeat the questions');
    await ctx.close();
  });

  await test('S17 if the window-lock feature fails, Mind Desk still starts (protected by the save check)', async () => {
    const p = await page({ raw: true, init: () => { if (navigator.locks) navigator.locks.request = () => Promise.reject(new Error('locks broken')); } });
    await sleep(1000);
    assert.ok(await p.evaluate(() => !!(window.MD && MD.state)), 'app did not start');
    assert.strictEqual(!!(await p.$('[data-blocked]')), false, 'blocked screen shown');
    await p.context().close();
  });

  const ver = browser.version(); await browser.close(); srv.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed`);
  fs.writeFileSync(path.join(__dirname, 'last-review2-results.json'), JSON.stringify({ html: HTML, date: new Date().toISOString(), chromium: ver, results }, null, 1));
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
