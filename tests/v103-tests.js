#!/usr/bin/env node
// Tests for 1.0.3: Fast/Careful mode, hidden AI thinking, default model.
// Usage: PW=<playwright> node tests/v103-tests.js [path/to/mind-desk.html]
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
  const context = opts.context || await browser.newContext({ viewport: { width: 1300, height: 860 }, acceptDownloads: true });
  const p = await context.newPage(); p.errors = []; p.on('pageerror', (e) => p.errors.push(String(e)));
  p.on('dialog', (d) => d.accept());
  if (opts.init) await p.addInitScript(opts.init);
  await p.goto('file://' + HTML); await p.waitForFunction(() => window.MD && MD.state);
  if (!opts.raw) await p.evaluate((u) => { Object.assign(MD.state.settings, { ollamaUrl: u, survey: false }); MD.save(); MD.render(); }, OK);
  return p;
}
async function paste(p, name, text) {
  if (await p.evaluate(() => MD.UI.view !== 'inbox')) await p.click('[data-act=nav][data-v=inbox]');
  await p.click('.notelist [data-act=pasteNote]'); await p.fill('#pnName', name); await p.fill('#pnText', text); await p.click('[data-act=savePaste]');
}
const waitRunEnd = (p) => p.waitForFunction(() => !MD.RUN.active, null, { timeout: 30000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reset = () => { fake.state.log = []; fake.state.counts = {}; };
const org = () => fake.state.log.filter((x) => /You organize one note/.test(x.system));
async function test(name, fn) {
  if (process.env.ONLY && !name.startsWith(process.env.ONLY + ' ')) return;
  const t0 = Date.now();
  try { await Promise.race([fn(), sleep(45000).then(() => { throw new Error('timed out'); })]); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log('  ✓', name); } catch (e) { results.push({ name, ok: false, ms: Date.now() - t0, error: e.stack || String(e) }); console.log('  ✗', name, '\n     ', String(e.message || e).split('\n')[0].slice(0, 170)); }
}

(async () => {
  const srv = await fake.start(11500, { origins: '*' });
  browser = await chromium.launch();
  console.log('1.0.3 tests on', HTML);

  await test('T1 new install: model qwen3.5:9b, Fast mode, Fast/Careful choice next to Organize all', async () => {
    const p = await page({ raw: true });
    assert.deepStrictEqual(await p.evaluate(() => [MD.state.settings.model, MD.state.settings.mode]), ['qwen3.5:9b', 'fast']);
    assert.strictEqual(await p.inputValue('#modeSel'), 'fast');
    await p.selectOption('#modeSel', 'careful');
    assert.strictEqual(await p.evaluate(() => MD.state.settings.mode), 'careful');
    await p.context().close();
  });

  await test('T2 Fast: no thinking, fixed JSON format; nothing to show', async () => {
    reset(); const p = await page();
    await paste(p, 'n', 'buy milk\n\nmy mind lesson about fear');
    await p.click('[data-act=organizeAll]'); await waitRunEnd(p);
    assert.ok(fake.state.log.length > 0 && fake.state.log.every((x) => x.think === false && x.format));
    assert.strictEqual(await p.evaluate(() => MD.state.items.filter((i) => i.thinking).length), 0);
    assert.strictEqual(await p.locator('details.think').count(), 0);
    await p.context().close();
  });

  await test('T3 Careful: the AI thinks in every step; thinking is saved and folded away', async () => {
    reset(); const p = await page();
    await p.evaluate(() => { MD.state.settings.survey = true; MD.save(); });
    await paste(p, 'n', 'buy milk\n\nmy ZQK lesson about fear');
    await p.selectOption('#modeSel', 'careful');
    await p.click('[data-act=organizeAll]');
    await p.waitForSelector('[data-q]');
    assert.ok(await p.locator('details.think >> text=Show what the AI thought').count() === 1, 'survey thinking missing');
    await p.click('[data-act=skipSurvey]'); await waitRunEnd(p);
    const L = fake.state.log;
    assert.ok(L.length >= 4 && L.every((x) => x.think === true && !x.format), JSON.stringify(L.map((x) => [x.think, x.format])));
    const its = await p.evaluate(() => MD.state.items.map((i) => ({ th: i.thinking, mode: i.mode })));
    assert.ok(its.length === 2 && its.every((i) => /^THINKING/.test(i.th) && i.mode === 'careful'));
    await p.click('[data-act=nav][data-v=review]');
    const box = p.locator('details.think').first();
    assert.strictEqual(await box.evaluate((d) => d.open), false, 'thinking must be hidden by default');
    assert.strictEqual(await box.locator('.pre').isVisible(), false);
    await box.locator('summary').click();
    assert.ok(/THINKING/.test(await box.locator('.pre').textContent()));
    await p.click('[data-act=nav][data-v=inbox]');
    assert.ok(await p.locator('details.think >> text=Show how the AI decided to split').count() === 1, 'split thinking missing');
    assert.deepStrictEqual(p.errors, []);
    await p.context().close();
  });

  await test('T4 Careful steps can be switched off one by one in Settings', async () => {
    reset(); const p = await page();
    await p.evaluate(() => { Object.assign(MD.state.settings, { mode: 'careful', thinkSplit: false, thinkOrganize: true }); MD.save(); MD.render(); });
    await paste(p, 'n', 'one thing\n\nanother thing about my site');
    await p.click('[data-act=organizeAll]'); await waitRunEnd(p);
    const split = fake.state.log.filter((x) => /Decide where each NEW/.test(x.system));
    assert.ok(split.length && split.every((x) => x.think === false), 'split should not think');
    assert.ok(org().every((x) => x.think === true), 'organize should think');
    await p.click('[data-act=nav][data-v=settings]');
    assert.ok(await p.isVisible('text=In Careful mode, let the AI think in:'));
    await p.context().close();
  });

  await test('T5 "Ask AI again" offers Fast and Careful for one item', async () => {
    reset(); const p = await page();
    await paste(p, 'n', 'just one note about my site'); await p.click('[data-act=organizeAll]'); await waitRunEnd(p);
    await p.click('[data-act=nav][data-v=review]');
    const id = await p.evaluate(() => MD.state.items[0].id);
    reset();
    await p.click(`[data-act=rerun][data-mode=careful][data-id="${id}"]`); await waitRunEnd(p);
    assert.ok(org().length === 1 && org()[0].think === true);
    assert.strictEqual(await p.evaluate(() => MD.state.items[0].mode), 'careful');
    assert.strictEqual(await p.evaluate(() => MD.state.settings.mode), 'fast', 'the main choice stays as it was');
    reset();
    await p.click(`[data-act=rerun][data-mode=fast][data-id="${id}"]`); await waitRunEnd(p);
    assert.ok(org()[0].think === false);
    assert.strictEqual(await p.evaluate(() => MD.state.items[0].thinking), undefined, 'old thinking removed after a fast answer');
    await p.context().close();
  });

  await test('T6 a model that cannot think still works in Careful mode', async () => {
    reset(); const p = await page();
    await p.evaluate(() => { Object.assign(MD.state.settings, { model: 'nothink:1b', mode: 'careful' }); MD.save(); MD.render(); });
    await paste(p, 'n', 'one note about my site'); await p.click('[data-act=organizeAll]'); await waitRunEnd(p);
    const it = await p.evaluate(() => MD.state.items[0]);
    assert.strictEqual(it.status, 'review'); assert.ok(!it.flags.includes('aierror'), JSON.stringify(it.flags));
    const second = org()[1];
    assert.ok(second && !('think' in second && second.think !== undefined) && second.format, 'retry without think, with format');
    await p.context().close();
  });

  await test('T7 thinking written inside <think> tags is moved out of the answer', async () => {
    reset(); const p = await page();
    await paste(p, 'n', 'TAGTHINK one note about my site'); await p.click('[data-act=organizeAll]'); await waitRunEnd(p);
    const it = await p.evaluate(() => MD.state.items[0]);
    assert.ok(!it.flags.includes('aierror'));
    assert.ok(/INLINE THOUGHTS/.test(it.thinking || ''), 'thinking not kept');
    assert.ok(!/INLINE/.test(it.text));
    await p.context().close();
  });

  await test('T8 1.0.2 setting "think" on becomes Careful; off stays Fast', async () => {
    const ctx = await browser.newContext();
    const p = await page({ context: ctx, raw: true });
    await p.evaluate(async () => { const s = JSON.parse(JSON.stringify(MD.state)); s.settings.think = true; delete s.settings.mode; s.rev = 99; await MD.store.set('state', s); });
    await p.close();
    const p2 = await page({ context: ctx, raw: true });
    assert.deepStrictEqual(await p2.evaluate(() => [MD.state.settings.mode, 'think' in MD.state.settings]), ['careful', false]);
    await ctx.close();
  });

  await test('T9 thinking survives backup and restore; damaged thinking is refused', async () => {
    const p = await page();
    await paste(p, 'n', 'note'); await p.evaluate(() => { MD.state.notes[0].splitThinking = 'why I split'; MD.save(); });
    await p.click('[data-act=nav][data-v=settings]');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-act=exportJSON]')]);
    const b = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    assert.strictEqual(b.notes[0].splitThinking, 'why I split');
    assert.strictEqual(await p.evaluate((o) => MDCore.backupProblem(o), b), '');
    b.notes[0].splitThinking = { x: 1 };
    assert.ok(/thinking/i.test(await p.evaluate((o) => MDCore.backupProblem(o), b)));
    await p.context().close();
  });

  await test('T10 Careful mode gives the AI more room for long notes', async () => {
    reset(); const p = await page();
    await paste(p, 'n', 'a long paragraph about my site and plans. '.repeat(280)); await p.click('[data-act=organizeAll]'); await waitRunEnd(p);
    const fast = org()[0].options.num_ctx;
    await p.evaluate(() => { MD.state.items = []; MD.state.notes[0].status = 'new'; MD.state.settings.mode = 'careful'; MD.save(); MD.render(); });
    reset(); await p.click('[data-act=organizeAll]'); await waitRunEnd(p);
    assert.ok(org()[0].options.num_ctx > fast, `careful ${org()[0].options.num_ctx} vs fast ${fast}`);
    await p.context().close();
  });

  await test('T11 the quick test note in Settings shows the mode and folded thinking', async () => {
    const p = await page();
    await p.evaluate(() => { MD.state.settings.mode = 'careful'; MD.save(); });
    await p.click('[data-act=nav][data-v=settings]'); await p.click('[data-act=testAI]');
    await p.waitForSelector('text=The AI answered in');
    assert.ok(/Careful mode/.test(await p.textContent('#connResult')));
    assert.strictEqual(await p.locator('#connResult details.think').count(), 1);
    await p.context().close();
  });

  const ver = browser.version(); await browser.close(); srv.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed`);
  fs.writeFileSync(path.join(__dirname, 'last-v103-results.json'), JSON.stringify({ html: HTML, date: new Date().toISOString(), chromium: ver, results }, null, 1));
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
