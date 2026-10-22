#!/usr/bin/env node
// Tests for 1.0.4: live progress + thinking limit, one place rule, organize one note, menu toggle,
// typos-only / clean-up, Fix my typing, Report for Claude.
// Usage: PW=<playwright> node tests/v104-tests.js [path/to/mind-desk.html]
'use strict';
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { chromium } = require(process.env.PW || 'playwright');
const fake = require('./fake-ollama');

const HTML = path.resolve(process.argv[2] || path.join(__dirname, '..', 'mind-desk.html'));
const OK = 'http://127.0.0.1:11500';
let browser; const results = [];
async function page(opts = {}) {
  const context = opts.context || await browser.newContext({ viewport: { width: 1300, height: 860 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await context.newPage(); p.errors = []; p.on('pageerror', (e) => p.errors.push(String(e)));
  p.dialogAnswers = [];
  p.on('dialog', (d) => { const a = p.dialogAnswers.length ? p.dialogAnswers.shift() : true; if (a === false) d.dismiss(); else d.accept(); });
  await p.goto('file://' + HTML); await p.waitForFunction(() => window.MD && MD.state);
  if (!opts.raw) await p.evaluate((u) => { Object.assign(MD.state.settings, { ollamaUrl: u, survey: false }); MD.save(); MD.render(); }, OK);
  return p;
}
async function paste(p, name, text) {
  if (await p.evaluate(() => MD.UI.view !== 'inbox')) await p.click('[data-act=nav][data-v=inbox]');
  await p.click('.notelist [data-act=pasteNote]'); await p.fill('#pnName', name); await p.fill('#pnText', text); await p.click('[data-act=savePaste]');
}
const waitRunEnd = (p, ms = 30000) => p.waitForFunction(() => !MD.RUN.active, null, { timeout: ms });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reset = () => { fake.state.log = []; fake.state.counts = {}; };
const org = () => fake.state.log.filter((x) => /You organize one note/.test(x.system));
async function test(name, fn) {
  if (process.env.ONLY && !name.startsWith(process.env.ONLY + ' ')) return;
  const t0 = Date.now();
  try { await Promise.race([fn(), sleep(50000).then(() => { throw new Error('timed out'); })]); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log('  ✓', name); } catch (e) { results.push({ name, ok: false, ms: Date.now() - t0, error: e.stack || String(e) }); console.log('  ✗', name, '\n     ', String(e.message || e).split('\n')[0].slice(0, 170)); }
}

(async () => {
  const srv = await fake.start(11500, { origins: '*' });
  browser = await chromium.launch();
  console.log('1.0.4 tests on', HTML);

  await test('U1 answers are streamed; while the AI works a seconds counter and its live thinking are shown', async () => {
    reset(); const p = await page();
    await p.evaluate(() => { MD.state.settings.mode = 'careful'; MD.save(); MD.render(); });
    await paste(p, 'n', 'LONGTHINK one note about my site');
    await p.evaluate(() => { MD.state.settings.thinkLimitSec = 60; });
    await p.click('[data-act=organizeNote]');
    await p.waitForSelector('#livepanel:not([hidden])', { timeout: 10000 });
    await p.waitForFunction(() => /\d+ s · thinking/.test(document.querySelector('#liveinfo').textContent), null, { timeout: 5000 });
    assert.ok(/still thinking/.test(await p.textContent('#livetext')));
    await p.click('[data-act=hideLive]'); assert.strictEqual(await p.isVisible('#livepanel'), false);
    await p.click('[data-act=stopRun]'); await waitRunEnd(p);
    assert.ok(fake.state.log.every((x) => x.stream === true));
    assert.strictEqual(await p.isVisible('#livepanel'), false);
    await p.context().close();
  });

  await test('U2 thinking longer than the limit is stopped and answered in Fast mode, with a note on the item', async () => {
    reset(); const p = await page();
    await p.evaluate(() => { Object.assign(MD.state.settings, { mode: 'careful', thinkLimitSec: 10, thinkSplit: false }); MD.save(); MD.render(); });
    await paste(p, 'n', 'LONGTHINK one note about my site');
    await p.click('[data-act=organizeNote]'); await waitRunEnd(p, 40000);
    const it = await p.evaluate(() => MD.state.items[0]);
    assert.ok(it.flags.includes('thinkcut'), JSON.stringify(it.flags));
    assert.ok(/stopped after the time limit/.test(it.thinking));
    const o = org(); assert.ok(o.length === 2 && o[0].think === true && o[1].think === false);
    const log = await p.evaluate(() => MD.state.runLog.slice(-1)[0]);
    assert.ok(log.cut === true && log.ok === true && log.ms >= 10000);
    await p.context().close();
  });

  await test('U3 one place rule: AI tags ignored, old AI tags removed once, tasks only in To-do', async () => {
    reset(); const p = await page();
    await paste(p, 'n', 'my mind and my site plan'); // the stand-in AI returns a tag for this note
    await p.click('[data-act=organizeNote]'); await waitRunEnd(p);
    assert.deepStrictEqual(await p.evaluate(() => MD.state.items[0].tags), []);
    assert.ok(!org()[0].system.includes('"tags"'), 'prompt still asks for tags');
    const ctx = p.context();
    await p.evaluate(async () => { const s = JSON.parse(JSON.stringify(MD.state)); s.schema = 1; s.items[0].tags = ['job']; s.rev = 500; await MD.store.set('state', s); });
    await p.close();
    const p2 = await page({ context: ctx, raw: true });
    assert.deepStrictEqual(await p2.evaluate(() => [MD.state.schema >= 2, MD.state.items[0].tags]), [true, []]); // schema is 3 since 1.1.0
    await p2.evaluate(() => { MD.state.items[0].tags = ['job']; MD.save(); }); await sleep(400);
    await p2.close();
    const p3 = await page({ context: ctx, raw: true });
    assert.deepStrictEqual(await p3.evaluate(() => MD.state.items[0].tags), ['job'], 'your own tags after 1.0.4 stay');
    await ctx.close();
  });

  await test('U4 "Organize this note" organizes only that note', async () => {
    reset(); const p = await page();
    await paste(p, 'first', 'note one about my site'); await paste(p, 'second', 'note two about my gym');
    const id = await p.evaluate(() => MD.state.notes.find((n) => n.name === 'first').id);
    await p.click(`.noteitem[data-id="${id}"]`);
    await p.click(`[data-act=organizeNote][data-id="${id}"]`); await waitRunEnd(p);
    const st = await p.evaluate(() => MD.state.notes.map((n) => [n.name, n.status]));
    assert.deepStrictEqual(st.sort(), [['first', 'split'], ['second', 'new']]);
    assert.ok(org().every((x) => /note one/.test(x.user)));
    await p.click('[data-act=nav][data-v=inbox]'); await p.click('.noteitem >> text=second');
    assert.ok(await p.isVisible('[data-act=organizeNote]'));
    await p.click('.noteitem >> text=first');
    assert.strictEqual(await p.locator('[data-act=organizeNote]').count(), 0, 'no button once organized');
    await p.context().close();
  });

  await test('U5 the menu can be hidden and shown; the choice is remembered', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1300, height: 860 } });
    const p = await page({ context: ctx });
    assert.ok(await p.isVisible('.side'));
    await p.click('[data-act=toggleSide]'); assert.strictEqual(await p.isVisible('.side'), false);
    await sleep(500); await p.close();
    const p2 = await page({ context: ctx, raw: true });
    assert.strictEqual(await p2.isVisible('.side'), false);
    await p2.click('[data-act=toggleSide]'); assert.ok(await p2.isVisible('.side'));
    await ctx.close();
  });

  await test('U6 "Clean up wording" changes the prompt and allows rewording, but still guards facts', async () => {
    reset(); const p = await page();
    await p.click('[data-act=nav][data-v=settings]');
    await p.check('input[name=editstyle][value=clean]');
    assert.strictEqual(await p.evaluate(() => MD.state.settings.editStyle), 'clean');
    await paste(p, 'n', 'note about my site');
    await p.click('[data-act=organizeNote]'); await waitRunEnd(p);
    assert.ok(/clearer and easier to read/.test(org()[0].system));
    const r = await p.evaluate(() => {
      const c = { cats: MD.state.categories, words: [], rules: [], editStyle: 'clean' };
      const f = (a, b) => MDCore.checkOrganize({ title: 't', category: 'mind', tasks: [], text: b }, a, c).flags;
      return { reword: f('i thnk i shoud talk to him abt the site tmrw haha', 'I think I should talk to him about the site tomorrow, haha.'), num: f('pay 500 now', 'Pay 5000 now.'), neg: f('do not call him today', 'Call him today.') };
    });
    assert.deepStrictEqual(r.reword, []); assert.ok(r.num.includes('numbers')); assert.ok(r.neg.includes('negation'));
    await p.context().close();
  });

  await test('U7 "Fix my typing" in the editor: preview, then use it (whole text or only the selected part)', async () => {
    reset(); const p = await page();
    await paste(p, 'n', 'x');
    await p.evaluate(() => { const S = MD.state; S.notes[0].status = 'split'; S.items.push({ id: 'ie', noteId: S.notes[0].id, order: 0, original: 'x', text: 'x', title: 't', cat: 'mind', tags: [], status: 'approved', flags: [], lost: [], createdAt: 1 }); MD.UI.view = 'cat:mind'; MD.render(); });
    await p.click('[data-act=edit][data-id=ie]');
    await p.fill('#edText', 'i wnat to bulid it tomorow');
    await p.click('[data-act=fixTyping]');
    await p.waitForSelector('#fxOk');
    assert.ok(await p.isVisible('.modal ins.i >> text=want'));
    await p.click('#fxOk');
    assert.strictEqual(await p.inputValue('#edText'), 'i want to build it tomorow'.replace('tomorow', 'tomorrow'));
    await p.fill('#edText', 'keep thsi\nfix wnat here');
    await p.evaluate(() => { const t = document.querySelector('#edText'); t.selectionStart = t.value.indexOf('fix'); t.selectionEnd = t.value.length; });
    await p.click('[data-act=fixTyping]'); await p.waitForSelector('#fxOk'); await p.click('#fxOk');
    assert.strictEqual(await p.inputValue('#edText'), 'keep thsi\nfix want here');
    await p.click('[data-act=saveEdit]');
    assert.strictEqual(await p.evaluate(() => MD.state.items[0].text), 'keep thsi\nfix want here');
    await p.click('[data-act=edit][data-id=ie]'); await p.fill('#edText', 'wnat');
    await p.click('[data-act=fixTyping]'); await p.waitForSelector('#fxOk'); await p.click('.modal [data-act=closeModal]');
    assert.strictEqual(await p.inputValue('#edText'), 'wnat', '"Keep mine" keeps your text');
    assert.deepStrictEqual(p.errors, []);
    await p.context().close();
  });

  await test('U8 Report for Claude: one note, with original, items, warnings, thinking, timings; names hidden', async () => {
    reset(); const p = await page();
    await p.evaluate(() => { MD.state.settings.mode = 'careful'; MD.save(); });
    await paste(p, 'Tab 3', 'call Ravi about the site\n\nmy mind lesson today');
    await paste(p, 'Other', 'secret other note about gym');
    const id = await p.evaluate(() => MD.state.notes.find((n) => n.name === 'Tab 3').id);
    await p.click(`.noteitem[data-id="${id}"]`);
    await p.click(`[data-act=organizeNote][data-id="${id}"]`); await waitRunEnd(p);
    await p.click('[data-act=nav][data-v=inbox]'); await p.click(`.noteitem[data-id="${id}"]`);
    await p.click(`[data-act=report][data-id="${id}"]`);
    await p.waitForSelector('#rpText');
    const t = await p.inputValue('#rpText');
    assert.ok(t.includes('MIND DESK REPORT') && t.includes('=== NOTE "Tab 3"') && t.includes('--- ITEM 1/'));
    assert.ok(t.includes('AI thinking:') && t.includes('Last AI requests') && /organize "Tab 3" · careful · \d/.test(t));
    assert.ok(!t.includes('secret other note'), 'other notes must not be in a one-note report');
    assert.ok(!/Ravi/i.test(t) && t.includes('Person 1'), 'name not hidden');
    assert.strictEqual(await p.inputValue('#rpHide'), 'Ravi');
    await p.uncheck('#rpThink'); assert.ok(!(await p.inputValue('#rpText')).includes('AI thinking:'));
    await p.uncheck('#rpHideOn'); assert.ok((await p.inputValue('#rpText')).includes('Ravi'));
    await p.click('#rpCopy');
    const clip = await p.evaluate(() => navigator.clipboard.readText());
    assert.ok(clip.includes('=== NOTE "Tab 3"'));
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#rpDl')]);
    assert.ok(/mind-desk-report-.*\.txt$/.test(dl.suggestedFilename()));
    await p.context().close();
  });

  await test('U9 Report from Settings: items waiting for review; API key never included; runLog not in backups', async () => {
    reset(); const p = await page();
    await p.evaluate(() => { MD.state.settings.oaKey = 'SECRET-KEY-9'; MD.save(); });
    await paste(p, 'a', 'note about my site'); await p.click('[data-act=organizeNote]'); await waitRunEnd(p);
    await paste(p, 'b', 'never organized note');
    await p.click('[data-act=nav][data-v=settings]');
    await p.click('[data-act=report][data-scope=review]'); await p.waitForSelector('#rpText');
    const t = await p.inputValue('#rpText');
    assert.ok(t.includes('"a"') && !t.includes('never organized') && !t.includes('SECRET-KEY-9'));
    await p.click('.modal [data-act=closeModal]');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-act=exportJSON]')]);
    const b = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    assert.ok(!('runLog' in b));
    await p.context().close();
  });

  await test('U10 report can be saved into the connected Mind Desk folder (Reports)', async () => {
    const p = await page(); await paste(p, 'n', 'a note');
    await p.evaluate(() => { const mk = (name) => { const kids = new Map(); return { kind: 'directory', name, kids, async getDirectoryHandle(n) { if (!kids.has(n)) kids.set(n, mk(n)); return kids.get(n); }, async getFileHandle(n) { if (!kids.has(n)) kids.set(n, { data: '' }); const f = kids.get(n); return { async createWritable() { let b = ''; return { async write(d) { b += d; }, async close() { f.data = b; } }; } }; }, async removeEntry() {}, async queryPermission() { return 'granted'; } }; }; window.__root = mk('MyNotes'); MD.FOLDER.handle = window.__root; MD.FOLDER.ok = true; });
    await p.click('[data-act=report]'); await p.waitForSelector('#rpSave'); await p.click('#rpSave');
    await p.waitForSelector('text=Saved in your folder');
    const files = await p.evaluate(() => [...window.__root.kids.get('Reports').kids.keys()]);
    assert.ok(files.length === 1 && /^mind-desk-report-.*\.txt$/.test(files[0]));
    await p.context().close();
  });

  const ver = browser.version(); await browser.close(); srv.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed`);
  fs.writeFileSync(path.join(__dirname, 'last-v104-results.json'), JSON.stringify({ html: HTML, date: new Date().toISOString(), chromium: ver, results }, null, 1));
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
