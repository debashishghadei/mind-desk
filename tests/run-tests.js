#!/usr/bin/env node
// Mind Desk browser tests. Opens mind-desk.html from a file:// URL (like on the user's PC) in Chromium.
// Usage: node tests/run-tests.js [path/to/mind-desk.html]   (needs Playwright; REAL_OLLAMA=http://127.0.0.1:11434 adds a check against a real Ollama)
'use strict';
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const pwPath = process.env.PW || 'playwright';
const { chromium } = require(pwPath);
const fake = require('./fake-ollama');

const HTML = path.resolve(process.argv[2] || path.join(__dirname, '..', 'mind-desk.html'));
const URL_ = 'file://' + HTML;
const OK = 'http://127.0.0.1:11500';        // like OLLAMA_ORIGINS=*
const STRICT = 'http://127.0.0.1:11501';    // like a default Ollama (blocks file pages)
const SAMPLE = fs.readFileSync(path.join(__dirname, 'samples', 'mixed-note.txt'), 'utf8');

let browser; const results = [];
async function page(opts = {}) {
  const context = opts.context || await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
  const p = await context.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|CORS|blocked/.test(m.text())) p.errors.push(m.text()); });
  p.dialogAnswers = [];
  p.on('dialog', (d) => { const a = p.dialogAnswers.length ? p.dialogAnswers.shift() : true; if (a === false) d.dismiss(); else d.accept(typeof a === 'string' ? a : undefined); });
  await p.goto(URL_);
  await p.waitForFunction(() => window.MD && window.MD.state);
  if (!opts.keepSettings) await settings(p, { ollamaUrl: OK, survey: true });
  return p;
}
async function settings(p, o) { await p.evaluate((o) => { Object.assign(MD.state.settings, o); MD.save(); MD.render(); }, o); }
async function paste(p, name, text) {
  if (await p.evaluate(() => MD.UI.view !== 'inbox')) await p.click('[data-act=nav][data-v=inbox]');
  await p.click('.notelist [data-act=pasteNote]');
  await p.fill('#pnName', name); await p.fill('#pnText', text);
  await p.click('[data-act=savePaste]');
}
async function waitRunEnd(p) { await p.waitForFunction(() => !MD.RUN.active, null, { timeout: 30000 }); }
async function log() { return fake.state.log; }
function reset() { fake.state.log = []; fake.state.counts = {}; }

async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log('  ✓', name); } catch (e) { results.push({ name, ok: false, ms: Date.now() - t0, error: e.stack || String(e) }); console.log('  ✗', name, '\n    ', String(e.message || e).split('\n')[0]); }
}

(async () => {
  const s1 = await fake.start(11500, { origins: '*' });
  const s2 = await fake.start(11501, { origins: '' });
  browser = await chromium.launch();
  console.log('Mind Desk tests on', HTML);

  /* ---------------- core logic ---------------- */
  await test('core: blocks keep heading+list, "sol:" and "//" lines together; divider splits', async () => {
    const p = await page();
    const blocks = await p.evaluate((t) => MDCore.makeBlocks(t), SAMPLE);
    // 1.0.1: lines of one paragraph are separate blocks (the AI may join them again); lists and follow-ups stay attached
    assert.strictEqual(blocks.length, 6, JSON.stringify(blocks, null, 1));
    assert.ok(blocks[1].startsWith('why i felt fear') && blocks[1].includes('- IGS was neg') && blocks[1].includes('sol: think'));
    assert.deepStrictEqual([blocks[2], blocks[3]], ['buy milk & eggs', 'clean white shirt (done)']);
    const det = await p.evaluate((t) => MDCore.makeBlocks(t, true), SAMPLE);
    assert.deepStrictEqual(det.map((b) => [b.hard, b.same]), [[true, false], [false, false], [false, false], [false, true], [true, false], [false, true]]);
    const b2 = await p.evaluate(() => MDCore.makeBlocks('My work desires:\n\n\n1) Br computer\n//end result: new server\n\n2) Job\n//ER: ceo happy\n\nother thought'));
    assert.deepStrictEqual(b2.length, 2); assert.ok(b2[0].includes('2) Job'));
    await p.context().close();
  });

  await test('core: bad AI split answers can never lose or reorder text', async () => {
    const p = await page();
    const r = await p.evaluate(() => [MDCore.groupsFromStarts(4, [3, 'x', 9, 3, -1]), MDCore.groupsFromStarts(3, null), MDCore.groupsFromStarts(2, [2, 1])]);
    assert.deepStrictEqual(r[0], [[0, 1], [2, 3]]); assert.deepStrictEqual(r[1], [[0, 1, 2]]); assert.deepStrictEqual(r[2], [[0], [1]]);
    await p.context().close();
  });

  await test('core: JSON is read from fenced / thinking answers', async () => {
    const p = await page();
    const r = await p.evaluate(() => [MDCore.parseJSON('<think>hmm</think>\n```json\n{"a":1}\n```').a, MDCore.parseJSON('Sure! {"b":2} hope it helps').b]);
    assert.deepStrictEqual(r, [1, 2]);
    const bad = await p.evaluate(() => { try { MDCore.parseJSON('no json'); return 'no error'; } catch (e) { return e.message; } });
    assert.ok(/not valid JSON/.test(bad));
    await p.context().close();
  });

  await test('core: guardrails flag shortened text, changed protected words, unknown category; tasks get a valid to-do list', async () => {
    const p = await page();
    const r = await p.evaluate(() => {
      const ctx = { cats: MD.state.categories, words: [{ term: 'IGS', meaning: 'signal' }], rules: [] };
      const orig = 'my IGS was neg today so i stoped and waited for the right time haha';
      const a = MDCore.checkOrganize({ title: 'x', category: 'nope', tags: ['job', 'todo-job', 'nope'], tasks: [{ text: 'do it', done: 'true', category: 'zzz' }], text: 'my eggs was neg' }, orig, ctx);
      const b = MDCore.checkOrganize({ title: '', category: 'Personal goals', tags: [], tasks: [], text: orig.replace('stoped', 'stopped') }, orig, ctx);
      return { a, b };
    });
    assert.deepStrictEqual(r.a.flags.sort(), ['bigchange', 'lostword', 'shortened', 'taskcheck', 'unsorted']); // 1.0.2: the made-up task "do it" is flagged
    assert.strictEqual(r.a.category, 'unsorted'); assert.deepStrictEqual(r.a.tags, ['job']); assert.deepStrictEqual(r.a.lost, ['IGS']);
    assert.strictEqual(r.a.tasks[0].done, false, '1.0.1: done needs a sign in the note'); assert.ok(r.a.tasks[0].cat.startsWith('todo-'));
    assert.deepStrictEqual(r.b.flags, []); assert.strictEqual(r.b.category, 'personal'); assert.ok(r.b.title.length > 0);
    await p.context().close();
  });

  await test('core: word diff marks only the fixed words', async () => {
    const p = await page();
    const d = await p.evaluate(() => MDCore.diff('i wnat to mov eon', 'i want to move on'));
    const del = d.filter((x) => x.t === 'del').map((x) => x.s).join('|'); const ins = d.filter((x) => x.t === 'ins').map((x) => x.s).join('|');
    assert.ok(del.includes('wnat') && ins.includes('want') && !del.includes(' to '), JSON.stringify(d));
    await p.context().close();
  });

  /* ---------------- adding notes ---------------- */
  await test('add: paste a note (date added automatically), duplicates refused, empty refused', async () => {
    const p = await page();
    await paste(p, 'Tab 1', 'first note text'); await p.waitForSelector('.noteitem');
    const n = await p.evaluate(() => MD.state.notes[0]);
    assert.strictEqual(n.name, 'Tab 1'); assert.ok(Date.now() - n.addedAt < 60000); assert.strictEqual(n.status, 'new');
    await paste(p, 'Again', 'first note text');
    await p.waitForSelector('text=already in your inbox');
    await p.fill('#pnText', '   '); await p.click('[data-act=savePaste]'); await p.waitForSelector('text=The note is empty');
    assert.strictEqual(await p.evaluate(() => MD.state.notes.length), 1);
    assert.deepStrictEqual(p.errors, []);
    await p.context().close();
  });

  await test('add: several files at once; non-text files skipped', async () => {
    const p = await page();
    await p.setInputFiles('#fileInput', [
      { name: 'ideas.txt', mimeType: 'text/plain', buffer: Buffer.from('tool idea: news tool') },
      { name: 'todo.md', mimeType: 'text/markdown', buffer: Buffer.from('buy milk') },
      { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from([137, 80, 78, 71]) },
    ]);
    await p.waitForFunction(() => MD.state.notes.length === 2);
    const names = await p.evaluate(() => MD.state.notes.map((n) => n.name).sort());
    assert.deepStrictEqual(names, ['ideas', 'todo']);
    await p.context().close();
  });

  /* ---------------- the main flow ---------------- */
  let flowCtx;
  await test('flow: Organize all → split → questions → answers saved → organize → review', async () => {
    reset();
    const p = await page(); flowCtx = p;
    await paste(p, 'Notepad tab 3', SAMPLE);
    await p.click('[data-act=organizeAll]');
    await p.waitForSelector('text=What does “IGS” mean?', { timeout: 15000 });
    assert.ok(!(await p.isVisible('text=What does “CEO” mean?')), 'well-known words are not asked');
    assert.ok(await p.isVisible('text=Is Ravi a client or a friend?'));
    await p.fill('input[placeholder="AI guess: my guess for IGS"]', 'inner guidance signal (good/bad feeling)');
    await p.click('[data-act=useGuess][data-k="1"]');
    await p.click('[data-act=submitSurvey]');
    await waitRunEnd(p);
    const st = await p.evaluate(() => ({ items: MD.state.items, words: MD.state.words, rules: MD.state.rules, tasks: MD.state.tasks, view: MD.UI.view }));
    assert.strictEqual(st.items.length, 6); assert.ok(st.items.every((i) => i.status === 'review'));
    assert.ok(st.words.some((w) => w.term === 'IGS' && /inner guidance/.test(w.meaning)));
    assert.ok(st.rules.some((r) => /Ravi/.test(r) && /client/.test(r)));
    assert.strictEqual(st.view, 'review');
    const L = await log();
    const org = L.filter((x) => /You organize one note/.test(x.system));
    assert.strictEqual(org.length, 6);
    assert.ok(L.every((x) => x.think === false && x.format && x.options.temperature === 0.2), 'think:false + JSON schema + low temperature');
    assert.ok(org[1].system.includes('IGS = inner guidance signal') && /Keep these words exactly as written: .*IGS/.test(org[1].system), 'answers are used and protected');
    assert.ok(org[0].system.includes('Madhutech = Madhu Infotech'), 'default word present');
    const it1 = st.items.find((i) => i.original.startsWith('stop thinkign'));
    assert.ok(it1.text.includes('move on') && it1.text.includes('the mind') && it1.cat === 'mind');
    const shop = st.tasks.find((t) => /milk/i.test(t.text)); const shirt = st.tasks.find((t) => /shirt/i.test(t.text));
    assert.strictEqual(shop.cat, 'todo-shopping'); assert.strictEqual(shirt.done, true);
    assert.strictEqual(st.items.find((i) => /PowerPoint/.test(i.original)).cat, 'job');
    assert.ok(await p.isVisible('text=Cleaned by AI')); assert.ok(await p.isVisible('del.d >> text=mov'));
    assert.deepStrictEqual(p.errors, []);
  });

  await test('review: tasks stay hidden until approved; approve → category + To-do; tick done', async () => {
    const p = flowCtx;
    assert.strictEqual(await p.evaluate(() => MDCore.visibleTasks(MD.state).length), 0);
    const id = await p.evaluate(() => MD.state.items.find((i) => /buy milk/.test(i.original)).id);
    await p.click(`[data-act=approve][data-id="${id}"]`);
    await p.click('[data-act=nav][data-v=todo]');
    await p.waitForSelector('.todo >> text=Buy milk');
    const tid = await p.evaluate(() => MD.state.tasks.find((t) => /milk/i.test(t.text)).id);
    await p.click(`[data-act=toggleTask][data-id="${tid}"]`);
    assert.strictEqual(await p.evaluate((t) => MD.state.tasks.find((x) => x.id === t).done, tid), true);
    assert.ok(!(await p.isVisible('.todo >> text=Buy milk')), 'done tasks hidden by default');
    await p.click('[data-act=toggleShowDone]'); await p.waitForSelector('.todo.done >> text=Buy milk');
    await p.fill('[data-newtask="todo-chores"]', 'pay electricity bill'); await p.press('[data-newtask="todo-chores"]', 'Enter');
    await p.waitForSelector('.todo >> text=pay electricity bill');
  });

  await test('review: Job page links to its open tasks in To-do (one place rule, 1.0.4); change category from the list', async () => {
    const p = flowCtx;
    await p.click('[data-act=nav][data-v=review]');
    const id = await p.evaluate(() => MD.state.items.find((i) => /PowerPoint/.test(i.original)).id);
    await p.selectOption(`select[data-id="${id}"]`, 'job');
    await p.click(`[data-act=approve][data-id="${id}"]`);
    await p.click('[data-act=nav][data-v="cat:job"]');
    await p.waitForSelector('text=1 open task for this area is in To-do'); assert.strictEqual(await p.locator('#content .todo').count(), 0, 'tasks are listed only in To-do');
    const it = await p.evaluate((id) => MD.state.items.find((i) => i.id === id), id);
    assert.strictEqual(it.cat, 'job'); assert.ok(!it.flags.includes('unsorted'));
  });

  await test('edit: "---" splits one item into two; "Join with previous" merges back; "Use my original" restores', async () => {
    const p = flowCtx;
    await p.click('[data-act=nav][data-v=review]');
    const id = await p.evaluate(() => MD.state.items.find((i) => /why i felt fear/.test(i.original)).id);
    await p.click(`[data-act=edit][data-id="${id}"]`);
    const txt = await p.inputValue('#edText');
    await p.fill('#edText', txt.replace('\n\nsol:', '\n---\nsol:'));
    await p.click('[data-act=saveEdit]');
    const parts = await p.evaluate((id) => { const a = MD.state.items.find((i) => i.id === id); return MD.state.items.filter((i) => i.noteId === a.noteId && i.order > a.order && i.order < a.order + 1); }, id);
    assert.strictEqual(parts.length, 1); assert.ok(parts[0].text.startsWith('sol:'));
    await p.click(`[data-act=mergePrev][data-id="${parts[0].id}"]`);
    const merged = await p.evaluate((id) => MD.state.items.find((i) => i.id === id).text, id);
    assert.ok(merged.includes('sol:') && merged.includes('- IGS was neg'));
    const id1 = await p.evaluate(() => MD.state.items.find((i) => /stop thinkign/.test(i.original)).id);
    await p.click(`[data-act=useOriginal][data-id="${id1}"]`);
    assert.ok(await p.evaluate((id) => { const i = MD.state.items.find((x) => x.id === id); return i.text === i.original; }, id1));
  });

  await test('persistence: everything is still there after closing and reopening the page', async () => {
    const p = flowCtx; const ctx = p.context();
    await p.waitForFunction(() => document.querySelector('#savestate').textContent.startsWith('Saved'));
    const before = await p.evaluate(() => JSON.stringify([MD.state.notes.length, MD.state.items.length, MD.state.tasks.length, MD.state.words.length]));
    await p.close();
    const p2 = await page({ context: ctx, keepSettings: true });
    const after = await p2.evaluate(() => JSON.stringify([MD.state.notes.length, MD.state.items.length, MD.state.tasks.length, MD.state.words.length]));
    assert.strictEqual(after, before);
    flowCtx = p2;
  });

  await test('export / restore backup round trip; Markdown export has categories and tasks', async () => {
    const p = flowCtx;
    await p.click('[data-act=nav][data-v=settings]');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-act=exportJSON]')]);
    const file = await dl.path(); const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(json.app, 'mind-desk'); assert.ok(json.items.length >= 4);
    const [dl2] = await Promise.all([p.waitForEvent('download'), p.click('[data-act=downloadMD]')]);
    const md = fs.readFileSync(await dl2.path(), 'utf8');
    assert.ok(md.includes('## To-do') && md.includes('- [x] Buy milk') && md.includes('Make PowerPoint'), md.slice(0, 600));
    const p2 = await page();
    p2.dialogAnswers.push(true);
    await p2.setInputFiles('#importInput', { name: 'b.json', mimeType: 'application/json', buffer: fs.readFileSync(file) });
    await p2.waitForFunction(() => MD.state.items.length >= 4);
    assert.strictEqual(await p2.evaluate(() => MD.state.words.some((w) => w.term === 'IGS')), true);
    await p2.setInputFiles('#importInput', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
    await p2.waitForSelector('text=not a Mind Desk backup');
    await p2.context().close();
  });

  await test('folder saving writes Markdown per category, originals and a backup', async () => {
    const p = flowCtx;
    const files = await p.evaluate(async () => {
      const mk = (name) => { const kids = new Map(); return {
        kind: 'directory', name, kids,
        async getDirectoryHandle(n) { if (!kids.has(n)) kids.set(n, mk(n)); return kids.get(n); },
        async getFileHandle(n) { if (!kids.has(n)) kids.set(n, { kind: 'file', data: '' }); const f = kids.get(n); return { async createWritable() { let buf = ''; return { async write(d) { buf += d; }, async close() { f.data = buf; } }; } }; },
        async removeEntry(n) { kids.delete(n); }, async queryPermission() { return 'granted'; }, async requestPermission() { return 'granted'; } }; };
      const root = mk('MyNotes'); MD.FOLDER.handle = root; MD.FOLDER.ok = true; MD.FOLDER.name = 'MyNotes';
      await MD.syncFolder();
      const list = (d, pre = '') => [...d.kids].flatMap(([n, v]) => (v.kind === 'directory' ? list(v, pre + n + '/') : [pre + n]));
      return { list: list(root), todo: root.kids.get('Organized').kids.get('To-do.md').data };
    });
    assert.ok(files.list.includes('Mind Desk backup.json') && files.list.includes('Organized/To-do.md') && files.list.some((f) => f.startsWith('Originals/') && /Notepad tab 3 \[\w{6}\]\.txt$/.test(f)), files.list.join(', '));
    assert.ok(files.todo.includes('Make PowerPoint for owner'));
  });

  await test('safety: note text with HTML is shown as text, never run', async () => {
    const p = await page();
    await paste(p, '<img src=x onerror="window.__x=1">', 'hello <script>window.__y=1</script><img src=x onerror="window.__x=1">');
    await p.waitForSelector('.notebody');
    assert.strictEqual(await p.evaluate(() => window.__x || window.__y || 0), 0);
    assert.ok((await p.textContent('.notebody')).includes('<script>'));
    await p.context().close();
  });

  /* ---------------- AI trouble ---------------- */
  await test('AI trouble: a shortened answer is retried with stricter rules; broken JSON keeps the original with a warning', async () => {
    reset();
    const p = await page();
    await settings(p, { survey: false });
    await paste(p, 'bad1', 'BADSHORT this note has quite a few words that must all stay here');
    await paste(p, 'bad2', 'BADJSON the model cannot answer this one properly at all');
    await paste(p, 'bad3', 'BADWORD my IGS was neg and the IGS stayed so for a while today');
    await p.click('[data-act=organizeAll]'); await waitRunEnd(p);
    const items = await p.evaluate(() => MD.state.items);
    const a = items.find((i) => i.original.startsWith('BADSHORT')); const b = items.find((i) => i.original.startsWith('BADJSON')); const c = items.find((i) => i.original.startsWith('BADWORD'));
    assert.ok(!a.flags.includes('shortened') && a.text.split(/\s+/).length > 8, 'retry fixed the short answer');
    assert.ok((await log()).some((x) => /a previous answer changed or removed words/.test(x.system)));
    assert.deepStrictEqual(b.flags, ['aierror']); assert.strictEqual(b.text, b.original); assert.strictEqual(b.status, 'review');
    assert.ok(c.flags.includes('lostword') && c.lost.includes('IGS'));
    await p.waitForSelector('text=A protected word was changed: IGS');
    await p.context().close();
  });

  await test('Stop: a run can be stopped, the rest waits, and "Organize all" continues later', async () => {
    reset();
    const p = await page(); await settings(p, { survey: false });
    for (let k = 1; k <= 4; k++) await paste(p, 'slow' + k, `SLOW note number ${k} about the website plugin`);
    await p.click('[data-act=organizeAll]');
    await p.waitForFunction(() => MD.state.items.some((i) => i.status === 'review'), null, { timeout: 15000 });
    await p.click('[data-act=stopRun]'); await waitRunEnd(p);
    const mid = await p.evaluate(() => MD.state.items.filter((i) => i.status === 'pending').length);
    assert.ok(mid >= 1, 'some items still waiting');
    await p.click('[data-act=organizeAll]'); await waitRunEnd(p);
    assert.strictEqual(await p.evaluate(() => MD.state.items.filter((i) => i.status === 'pending').length), 0);
    await p.context().close();
  });

  await test('connection: a default Ollama (blocking file pages) gives the OLLAMA_ORIGINS fix in plain words', async () => {
    const p = await page(); await settings(p, { ollamaUrl: STRICT });
    await p.click('[data-act=nav][data-v=settings]'); await p.click('[data-act=testConn]');
    await p.waitForSelector('text=Could not reach Ollama'); assert.ok(await p.isVisible('#connResult >> text=OLLAMA_ORIGINS'));
    await paste(p, 'x', 'some note');
    await p.click('[data-act=organizeAll]'); await waitRunEnd(p);
    await p.waitForSelector('.modal >> text=could not reach the AI'); assert.ok(await p.isVisible('.modal >> text=OLLAMA_ORIGINS'));
    const left = await p.evaluate(() => ({ note: MD.state.notes.length, waiting: MD.state.notes[0].status === 'new' || MD.state.items.every((i) => i.status === 'pending') }));
    assert.deepStrictEqual(left, { note: 1, waiting: true }, 'nothing lost, can try again');
    await p.context().close();
  });

  await test('connection: missing model is named, with the exact "ollama pull" command; installed models can be picked', async () => {
    const p = await page(); await settings(p, { model: 'gemma9:99b' });
    await p.click('[data-act=nav][data-v=settings]'); await p.click('[data-act=testConn]');
    await p.waitForSelector('text=is not installed'); assert.ok(await p.isVisible('code >> text=ollama pull gemma9:99b'));
    await p.click('[data-act=pickModel][data-m="qwen3:8b"]');
    await p.waitForSelector('text=Model qwen3:8b is ready');
    await p.click('[data-act=testAI]'); await p.waitForSelector('text=The AI answered in');
    assert.ok(await p.isVisible('#connResult >> text=want to build a tool tomorrow'));
    await p.context().close();
  });

  if (process.env.REAL_OLLAMA) {
    await test('real Ollama: Test connection from a file page works with OLLAMA_ORIGINS=*', async () => {
      const p = await page(); await settings(p, { ollamaUrl: process.env.REAL_OLLAMA });
      await p.click('[data-act=nav][data-v=settings]'); await p.click('[data-act=testConn]');
      await p.waitForSelector('#connResult .banner'); const t = await p.textContent('#connResult');
      assert.ok(/Connected/.test(t), t);
      await p.context().close();
    });
  }

  /* ---------------- copy & paste mode ---------------- */
  await test('copy & paste mode: three prompts for ChatGPT/Claude, pasted answers are used', async () => {
    reset();
    const p = await page(); await settings(p, { provider: 'manual' });
    await paste(p, 'cp1', 'thought one about mind\n\nsecond thing: buy milk');
    await paste(p, 'cp2', 'single note about IGS');
    await p.click('[data-act=organizeAll]');
    await p.waitForSelector('text=Step 1 of 3');
    let prm = await p.inputValue('#mpPrompt');
    const nid = prm.match(/=== NOTE (\S+) ===/)[1];
    await p.fill('#mpAns', 'not json'); await p.click('#mpOk'); await p.waitForSelector('text=does not look like the JSON');
    await p.fill('#mpAns', '```json\n' + JSON.stringify({ notes: [{ id: nid, starts: [1, 2] }] }) + '\n```'); await p.click('#mpOk');
    await p.waitForSelector('text=Step 2 of 3');
    await p.fill('#mpAns', JSON.stringify({ questions: [{ kind: 'word', term: 'IGS', guess: 'signal' }] })); await p.click('#mpOk');
    await p.waitForSelector('text=What does “IGS” mean?'); await p.click('[data-act=submitSurvey]');
    await p.waitForSelector('text=Step 3 of 3');
    prm = await p.inputValue('#mpPrompt');
    const ids = [...prm.matchAll(/=== NOTE (\S+) ===/g)].map((m) => m[1]);
    assert.strictEqual(ids.length, 3);
    await p.fill('#mpAns', JSON.stringify({ results: ids.slice(0, 2).map((id, k) => ({ id, title: 'T' + k, category: k ? 'todo' : 'mind', tags: [], tasks: k ? [{ text: 'Buy milk', done: false, category: 'todo-shopping' }] : [], text: 'fixed ' + k })) }));
    await p.click('#mpOk'); await waitRunEnd(p);
    const st = await p.evaluate(() => MD.state.items.map((i) => i.status).sort());
    assert.deepStrictEqual(st, ['pending', 'review', 'review'], 'missing result stays waiting');
    assert.strictEqual((await log()).length, 0, 'no request to Ollama in copy & paste mode');
    await p.context().close();
  });

  /* ---------------- settings ---------------- */
  await test('categories: add, rename, delete (items move to Unsorted); words and rules editable', async () => {
    const p = await page();
    await p.click('[data-act=nav][data-v=settings]');
    await p.fill('#newCatName', 'Travel log'); await p.click('[data-act=addCat]');
    const id = await p.evaluate(() => MD.state.categories.find((c) => c.name === 'Travel log').id);
    await p.waitForSelector('#nav >> text=Travel log');
    await p.fill(`input[data-catf=name][data-id="${id}"]`, 'Travel'); await p.press(`input[data-catf=name][data-id="${id}"]`, 'Tab');
    await p.waitForSelector('#nav >> text=Travel');
    await p.evaluate((id) => { MD.state.items.push({ id: 'i1', noteId: 'n0', order: 0, original: 'a', text: 'a', title: 'a', cat: id, tags: [], status: 'approved', flags: [], lost: [], createdAt: 1 }); }, id);
    p.dialogAnswers.push(true);
    await p.click(`[data-act=delCat][data-id="${id}"]`);
    assert.strictEqual(await p.evaluate(() => MD.state.items[0].cat), 'unsorted');
    await p.click('[data-act=nav][data-v=words]');
    await p.click('[data-act=addWord]'); await p.fill('[data-wf=term] >> nth=-1', 'HL2'); await p.fill('[data-wf=meaning] >> nth=-1', 'HappyLife247 site'); await p.press('[data-wf=meaning] >> nth=-1', 'Tab');
    await p.click('[data-act=addRule]'); await p.fill('[data-rule] >> nth=-1', 'plugin notes go to My business'); await p.press('[data-rule] >> nth=-1', 'Tab');
    const st = await p.evaluate(() => ({ w: MD.state.words, r: MD.state.rules }));
    assert.ok(st.w.some((w) => w.term === 'HL2' && w.meaning === 'HappyLife247 site')); assert.deepStrictEqual(st.r, ['plugin notes go to My business']);
    await p.context().close();
  });

  await test('settings: theme, edited prompt is used and can be reset', async () => {
    reset();
    const p = await page(); await settings(p, { survey: false });
    await p.click('[data-act=nav][data-v=settings]');
    await p.selectOption('#set-theme', 'dark'); assert.strictEqual(await p.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await p.click('text=Show and edit the prompts');
    const v = await p.inputValue('#pr-organize'); await p.fill('#pr-organize', v + '\nEXTRA RULE 42'); await p.press('#pr-organize', 'Tab');
    await paste(p, 'n', 'one more note about my site');
    await p.click('[data-act=organizeAll]'); await waitRunEnd(p);
    assert.ok((await log()).some((x) => x.system.includes('EXTRA RULE 42')));
    await p.click('[data-act=nav][data-v=settings]'); await p.click('text=Show and edit the prompts'); await p.click('[data-act=resetPrompt][data-k=organize]');
    assert.strictEqual(await p.evaluate(() => MD.state.prompts.organize), null);
    await p.context().close();
  });

  await test('inbox: "Organize again" and delete remove the note\'s items and tasks', async () => {
    reset();
    const p = await page(); await settings(p, { survey: false });
    await paste(p, 'n', 'buy milk\n\nmake report for owner');
    await p.click('[data-act=organizeAll]'); await waitRunEnd(p);
    const before = await p.evaluate(() => [MD.state.items.length, MD.state.tasks.length]);
    assert.ok(before[0] === 2 && before[1] === 2, JSON.stringify(before));
    await p.click('[data-act=nav][data-v=inbox]');
    p.dialogAnswers.push(true);
    await p.click('[data-act=reorganizeNote]'); await waitRunEnd(p);
    assert.deepStrictEqual(await p.evaluate(() => [MD.state.items.length, MD.state.tasks.length]), before, 'no duplicates after organizing again');
    await p.click('[data-act=nav][data-v=inbox]');
    p.dialogAnswers.push(true);
    await p.click('[data-act=deleteNote]');
    assert.deepStrictEqual(await p.evaluate(() => [MD.state.notes.length, MD.state.items.length, MD.state.tasks.length]), [0, 0, 0]);
    assert.deepStrictEqual(p.errors, []);
    await p.context().close();
  });

  const chromiumVersion = browser.version();
  await browser.close(); s1.close(); s2.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed`);
  fs.writeFileSync(path.join(__dirname, 'last-results.json'), JSON.stringify({ html: path.basename(HTML), date: new Date().toISOString(), chromium: chromiumVersion, results }, null, 1));
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
