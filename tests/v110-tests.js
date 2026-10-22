#!/usr/bin/env node
// Tests for 1.1.0: Chat (history, context, Apply/Cancel actions) and Memory.
// Usage: PW=<playwright> node tests/v110-tests.js [path/to/mind-desk.html]
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
  p.dialogAnswers = [];
  p.on('dialog', (d) => { const a = p.dialogAnswers.length ? p.dialogAnswers.shift() : true; if (a === false) d.dismiss(); else d.accept(); });
  await p.goto('file://' + HTML); await p.waitForFunction(() => window.MD && MD.state);
  if (!opts.raw) await p.evaluate((u) => { Object.assign(MD.state.settings, { ollamaUrl: u, survey: false }); MD.save(); MD.render(); }, OK);
  return p;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitRunEnd = (p, ms = 30000) => p.waitForFunction(() => !MD.RUN.active, null, { timeout: ms });
const reset = () => { fake.state.log = []; fake.state.counts = {}; };
const chatReqs = () => fake.state.log.filter((x) => /You are the assistant inside Mind Desk/.test(x.system));
/** a small library of approved notes to chat about */
async function seed(p) {
  await p.evaluate(() => {
    const S = MD.state; const now = Date.now();
    S.notes.push({ id: 'n1', name: '4', text: 'ceo meeting prep and gym plan', addedAt: now - 3000, source: 'paste', status: 'split' });
    S.notes.push({ id: 'n2', name: 'Notepad tab 3', text: 'private diary about Ravi', addedAt: now - 2000, source: 'paste', status: 'split' });
    S.items.push({ id: 'i1', noteId: 'n1', order: 0, original: 'ceo meeting prep, salary talk', text: 'ceo meeting prep, salary talk', title: 'CEO meeting prep', cat: 'job', tags: [], status: 'approved', flags: [], lost: [], createdAt: now, updatedAt: now });
    S.items.push({ id: 'i2', noteId: 'n1', order: 1, original: 'gym plan every morning', text: 'gym plan every morning', title: 'Gym plan', cat: 'unsorted', tags: [], status: 'approved', flags: [], lost: [], createdAt: now, updatedAt: now });
    S.items.push({ id: 'i3', noteId: 'n2', order: 0, original: 'SECRETDIARY text here', text: 'SECRETDIARY text here', title: 'Diary', cat: 'mind', tags: [], status: 'approved', flags: [], lost: [], createdAt: now, updatedAt: now });
    S.tasks.push({ id: 't1', itemId: 'i1', text: 'Make PowerPoint for owner', done: false, cat: 'todo-job', createdAt: now });
    S.tasks.push({ id: 't2', itemId: null, text: 'Buy milk', done: false, cat: 'todo-shopping', createdAt: now });
    MD.save(); MD.render();
  });
}
async function ask(p, text) {
  if (await p.evaluate(() => MD.UI.view !== 'chat')) await p.click('[data-act=nav][data-v=chat]');
  await p.fill('#chatIn', text); await p.press('#chatIn', 'Enter'); await waitRunEnd(p);
}
async function test(name, fn) {
  if (process.env.ONLY && !name.startsWith(process.env.ONLY + ' ')) return;
  const t0 = Date.now();
  try { await Promise.race([fn(), sleep(50000).then(() => { throw new Error('timed out'); })]); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log('  ✓', name); } catch (e) { results.push({ name, ok: false, ms: Date.now() - t0, error: e.stack || String(e) }); console.log('  ✗', name, '\n     ', String(e.message || e).split('\n')[0].slice(0, 170)); }
}

(async () => {
  const srv = await fake.start(11500, { origins: '*' });
  browser = await chromium.launch();
  console.log('1.1.0 tests on', HTML);

  await test('C1 Chat page: send with Enter, answer appears, chats are kept after reopening', async () => {
    reset(); const ctx = await browser.newContext({ viewport: { width: 1300, height: 860 } });
    const p = await page({ context: ctx }); await seed(p);
    await p.click('[data-act=nav][data-v=chat]');
    assert.ok(await p.isVisible('text=Chat with Mind Desk'));
    await ask(p, 'what are my job to-dos?');
    assert.ok(await p.isVisible('.msg.me >> text=what are my job to-dos?'));
    assert.ok(await p.isVisible('.msg.ai >> text=I found'));
    await ask(p, 'and anything else?');
    assert.strictEqual(chatReqs().length, 2);
    assert.ok(chatReqs()[1].user.includes('Person: what are my job to-dos?') && chatReqs()[1].user.includes('You: I found'), 'history is sent');
    await sleep(500); await p.close();
    const p2 = await page({ context: ctx, raw: true });
    await p2.click('[data-act=nav][data-v=chat]');
    assert.strictEqual(await p2.locator('.msg').count(), 4);
    assert.ok(await p2.isVisible('.chatlist >> text=what are my job to-dos?'));
    await p2.click('[data-act=newChat]'); await p2.fill('#chatIn', 'second chat'); await p2.press('#chatIn', 'Enter'); await waitRunEnd(p2);
    assert.strictEqual(await p2.locator('.chatlist .noteitem').count(), 2);
    assert.deepStrictEqual(p2.errors, []);
    await ctx.close();
  });

  await test('C2 the AI gets Memory, words and only the notes that match (not everything)', async () => {
    reset(); const p = await page(); await seed(p);
    await p.evaluate(() => { MD.state.memory.push({ id: 'm1', text: 'BR is my client, not my business', at: 1, source: 'manual' }); MD.save(); });
    await ask(p, 'what are my job to-dos?');
    const r = chatReqs()[0];
    assert.ok(r.system.includes('BR is my client') && r.system.includes('Madhutech = Madhu Infotech'));
    assert.ok(r.system.includes('ITEM [i1]') && r.system.includes('TASK [t1]'), 'job item and task');
    assert.ok(!r.system.includes('SECRETDIARY'), 'unrelated note text must not be sent');
    assert.ok(!r.system.includes('TASK [t2]'), 'shopping task is not a job task');
    await p.context().close();
  });

  await test('C3 suggested changes need Apply; Cancel changes nothing; made-up ids are left out', async () => {
    reset(); const p = await page(); await seed(p);
    await ask(p, 'move the gym plan please');
    assert.ok(await p.isVisible('.acard >> text=Move “Gym plan” to'));
    assert.ok(await p.isVisible('text=1 suggestion(s) were left out'));
    assert.strictEqual(await p.evaluate(() => MD.state.items.find((i) => i.id === 'i2').cat), 'unsorted', 'nothing changes before Apply');
    await p.click('[data-act=applyAction]');
    assert.strictEqual(await p.evaluate(() => MD.state.items.find((i) => i.id === 'i2').cat), 'personal');
    assert.ok(await p.isVisible('.chip >> text=✓ Applied'));
    await ask(p, 'move the gym plan to job');
    await p.click('[data-act=cancelAction]');
    assert.strictEqual(await p.evaluate(() => MD.state.items.find((i) => i.id === 'i2').cat), 'personal');
    assert.ok(await p.isVisible('.chip >> text=Cancelled'));
    await p.context().close();
  });

  await test('C4 tasks: mark done and add a task from the chat', async () => {
    reset(); const p = await page(); await seed(p);
    await ask(p, 'my job to-do powerpoint is done');
    await p.click('[data-act=applyAction]');
    assert.strictEqual(await p.evaluate(() => MD.state.tasks.find((t) => t.id === 't1').done), true);
    await ask(p, 'add task: call the plumber');
    await p.click('[data-act=applyAction]');
    assert.ok(await p.evaluate(() => MD.state.tasks.some((t) => t.text === 'call the plumber' && t.cat === 'todo-chores')));
    await p.context().close();
  });

  await test('C5 "remember …" becomes a Memory card; saved memory is used when organizing', async () => {
    reset(); const p = await page(); await seed(p);
    await ask(p, 'remember: HL2 is my mental health website');
    await p.fill('[data-remtext]', 'HL2 is my mental health website (HappyLife247)');
    await p.click('[data-act=saveRemember]');
    assert.ok(await p.evaluate(() => MD.state.memory.some((m) => m.text === 'HL2 is my mental health website (HappyLife247)' && m.source === 'chat')));
    await p.click('[data-act=nav][data-v=words]');
    assert.strictEqual(await p.inputValue('[data-mem]'), 'HL2 is my mental health website (HappyLife247)');
    await p.click('[data-act=nav][data-v=inbox]');
    await p.click('.notelist [data-act=pasteNote]'); await p.fill('#pnText', 'note about my site'); await p.click('[data-act=savePaste]');
    reset(); await p.click('[data-act=organizeNote]'); await waitRunEnd(p);
    const o = fake.state.log.find((x) => /You organize one note/.test(x.system));
    assert.ok(o.system.includes('HL2 is my mental health website'), 'memory not used in organizing');
    await p.context().close();
  });

  await test('C6 "organize again" from the chat redoes only that note, with the instruction', async () => {
    reset(); const p = await page(); await seed(p);
    await ask(p, 'organize note 4 again please');
    assert.ok(await p.isVisible('.acard >> text=This replaces the 2 item(s)'));
    reset(); await p.click('[data-act=applyAction]'); await sleep(300); await waitRunEnd(p);
    const o = fake.state.log.filter((x) => /You organize one note/.test(x.system));
    assert.ok(o.length >= 1 && o.every((x) => x.system.includes('Extra instruction from the person for this note: keep Hinglish words')));
    assert.ok(o.every((x) => !/SECRETDIARY/.test(x.user)), 'other notes untouched');
    assert.ok(await p.evaluate(() => MD.state.items.some((i) => i.id === 'i3')));
    await p.click('[data-act=nav][data-v=inbox]'); await p.click('.noteitem >> text=4');
    assert.ok(await p.isVisible('text=Your instruction for this note'));
    await p.context().close();
  });

  await test('C7 "show me note 4" shows its items inline; links open the item or note', async () => {
    reset(); const p = await page(); await seed(p);
    await ask(p, 'show me how you organized note 4');
    assert.ok(await p.isVisible('.acard >> text=Note “4”'));
    assert.strictEqual(await p.locator('[data-act=applyAction]').count(), 0, 'showing needs no Apply');
    await p.click('.msg.ai .pre a[data-act=openItem]');
    assert.ok(await p.evaluate(() => MD.UI.view.startsWith('cat:')));
    await p.click('[data-act=nav][data-v=chat]'); await p.click('.msg.ai .pre a[data-act=openNote]');
    assert.deepStrictEqual(await p.evaluate(() => [MD.UI.view, MD.UI.selNote]), ['inbox', 'n1']);
    await p.context().close();
  });

  await test('C8 changing a category in Review offers to teach Mind Desk', async () => {
    const p = await page(); await seed(p);
    await p.evaluate(() => { MD.state.items.find((i) => i.id === 'i2').status = 'review'; MD.UI.view = 'review'; MD.render(); });
    await p.selectOption('select[data-id=i2]', 'personal');
    assert.ok(/Notes like “Gym plan” belong in Personal goals, not Unsorted/.test(await p.inputValue('#teachText')));
    await p.click('[data-act=saveTeach]');
    assert.ok(await p.evaluate(() => MD.state.memory.some((m) => m.source === 'review' && /Gym plan/.test(m.text))));
    assert.strictEqual(await p.locator('#teachText').count(), 0);
    await p.context().close();
  });

  await test('C9 Memory page: add, edit, delete; old "My rules" move into Memory once', async () => {
    const ctx = await browser.newContext();
    const p = await page({ context: ctx });
    await p.click('[data-act=nav][data-v=words]');
    await p.click('[data-act=addMem]'); await p.fill('[data-mem]', 'I write in Hinglish sometimes'); await p.press('[data-mem]', 'Tab');
    assert.strictEqual(await p.evaluate(() => MD.state.memory[0].text), 'I write in Hinglish sometimes');
    await p.click('[data-act=delMem]'); assert.strictEqual(await p.evaluate(() => MD.state.memory.length), 0);
    await p.evaluate(async () => { const s = JSON.parse(JSON.stringify(MD.state)); s.schema = 2; s.rules = ['plugin notes go to My business', '']; s.rev = 900; await MD.store.set('state', s); });
    await p.close();
    const p2 = await page({ context: ctx, raw: true });
    assert.deepStrictEqual(await p2.evaluate(() => [MD.state.rules.length, MD.state.memory.map((m) => m.text)]), [0, ['plugin notes go to My business']]);
    await p2.evaluate(() => { for (let k = 0; k < 40; k++) MD.state.memory.push({ id: 'mm' + k, text: 'a long memory sentence that repeats '.repeat(3), at: 1, source: 'manual' }); MD.UI.view = 'words'; MD.render(); });
    assert.ok(await p2.isVisible('text=Memory is getting long'));
    await ctx.close();
  });

  await test('C10 chats and memory are in backups; damaged chats are refused; ids cannot inject HTML', async () => {
    reset(); const p = await page(); await seed(p);
    await ask(p, 'remember: test memory');
    await p.click('[data-act=saveRemember]');
    await p.click('[data-act=nav][data-v=settings]');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-act=exportJSON]')]);
    const b = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    assert.ok(b.chats.length === 1 && b.memory.length === 1);
    assert.strictEqual(await p.evaluate((o) => MDCore.backupProblem(o), b), '');
    const bad = JSON.parse(JSON.stringify(b)); bad.chats[0].messages[0].role = 'admin';
    assert.ok(/chat message/.test(await p.evaluate((o) => MDCore.backupProblem(o), bad)));
    const evil = JSON.parse(JSON.stringify(b)); evil.chats[0].id = 'c"><img src=x onerror="window.__p=1">';
    assert.ok(/chat/.test(await p.evaluate((o) => MDCore.backupProblem(o), evil)));
    const html = JSON.parse(JSON.stringify(b)); html.chats[0].messages[1].text = '<img src=x onerror="window.__p=2"> [[item:i1]]';
    p.dialogAnswers.push(true);
    await p.setInputFiles('#importInput', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(html)) });
    await sleep(600); await p.click('[data-act=nav][data-v=chat]');
    assert.strictEqual(await p.evaluate(() => window.__p || 0), 0);
    assert.ok(await p.isVisible('.msg.ai a[data-act=openItem]'));
    await p.context().close();
  });

  await test('C11 Careful in chat: thinking folded under the answer; Stop works mid-answer', async () => {
    reset(); const p = await page(); await seed(p);
    await p.evaluate(() => { MD.state.settings.mode = 'careful'; MD.save(); MD.render(); });
    await ask(p, 'what are my job to-dos?');
    assert.ok(chatReqs()[0].think === true);
    assert.strictEqual(await p.locator('.msg.ai details.think').count(), 1);
    await p.evaluate(() => { MD.state.settings.thinkLimitSec = 600; });
    await p.fill('#chatIn', 'LONGTHINK tell me everything'); await p.press('#chatIn', 'Enter');
    await p.waitForSelector('#livepanel:not([hidden])');
    await p.click('[data-act=stopRun]'); await waitRunEnd(p);
    assert.ok(await p.isVisible('.msg.ai >> text=(stopped)'));
    assert.deepStrictEqual(p.errors, []);
    await p.context().close();
  });

  await test('C12 copy & paste mode: chat prompt to copy, pasted answer is used', async () => {
    reset(); const p = await page(); await seed(p);
    await p.evaluate(() => { MD.state.settings.provider = 'manual'; MD.save(); MD.render(); });
    await p.click('[data-act=nav][data-v=chat]');
    await p.fill('#chatIn', 'rename the ceo item'); await p.press('#chatIn', 'Enter');
    await p.waitForSelector('#mpPrompt');
    assert.ok((await p.inputValue('#mpPrompt')).includes('ITEM [i1]'));
    await p.fill('#mpAns', JSON.stringify({ reply: 'Done thinking.', actions: [{ type: 'rename_item', item: 'i1', title: 'Talk with CEO' }], remember: [] }));
    await p.click('#mpOk'); await waitRunEnd(p);
    await p.click('[data-act=applyAction]');
    assert.strictEqual(await p.evaluate(() => MD.state.items.find((i) => i.id === 'i1').title), 'Talk with CEO');
    assert.strictEqual(chatReqs().length, 0);
    await p.context().close();
  });

  const ver = browser.version(); await browser.close(); srv.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed`);
  fs.writeFileSync(path.join(__dirname, 'last-v110-results.json'), JSON.stringify({ html: HTML, date: new Date().toISOString(), chromium: ver, results }, null, 1));
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
