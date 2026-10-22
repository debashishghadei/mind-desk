/* Mind Desk app (UI). Depends on MDCore. */
(() => {
  'use strict';
  const C = window.MDCore;
  const VERSION = '__VERSION__';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let S = null; // saved state
  const UI = { view: 'inbox', selNote: null, editing: null, search: '', showDone: false, flaggedOnly: false, focus: null, connResult: '' };
  const RUN = { active: false, stop: false, ctrl: null, label: '', done: 0, total: 0, surveyWait: null };
  const FOLDER = { handle: null, ok: false, name: '', msg: '' };

  /* ================= storage ================= */
  const store = {
    db: null, failed: '',
    async open() {
      if (typeof indexedDB === 'undefined') { this.db = null; return; } // simple storage mode
      try {
        this.db = await new Promise((res, rej) => {
          const r = indexedDB.open('mind-desk', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('kv');
          r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('storage is blocked by another window'));
        });
      } catch (e) { this.failed = (e && e.message) || 'unknown error'; }
    },
    async get(k) {
      if (!this.db) { try { const v = localStorage.getItem('mind-desk:' + k); return v ? JSON.parse(v) : undefined; } catch (e) { return undefined; } }
      return new Promise((res, rej) => { const q = this.db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    },
    async set(k, v) {
      if (!this.db) { localStorage.setItem('mind-desk:' + k, JSON.stringify(v)); return; }
      return new Promise((res, rej) => {
        const tx = this.db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k);
        tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error || new Error('write failed')); tx.onabort = () => rej(tx.error || new Error('write was aborted'));
      });
    },
    /** save the state only if nobody else saved a newer one since we loaded it */
    async putState(state, rev) {
      if (!this.db) {
        const cur = JSON.parse(localStorage.getItem('mind-desk:state') || 'null');
        if (cur && (cur.rev || 0) > rev) return false;
        localStorage.setItem('mind-desk:state', JSON.stringify(state)); return true;
      }
      return new Promise((res, rej) => {
        const tx = this.db.transaction('kv', 'readwrite'); const os = tx.objectStore('kv'); let ok = true;
        const q = os.get('state');
        q.onsuccess = () => { const cur = q.result; if (cur && (cur.rev || 0) > rev) { ok = false; return; } os.put(state, 'state'); };
        tx.oncomplete = () => res(ok); tx.onerror = () => rej(tx.error || new Error('write failed')); tx.onabort = () => rej(tx.error || new Error('write was aborted'));
      });
    },
    async del(k) {
      if (!this.db) { localStorage.removeItem('mind-desk:' + k); return; }
      return new Promise((res) => { const tx = this.db.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(k); tx.oncomplete = () => res(); tx.onerror = () => res(); });
    },
  };

  function defaultSettings() {
    return {
      provider: 'ollama', ollamaUrl: 'http://localhost:11434', model: 'qwen3.5:9b', numCtx: 8192, temperature: 0.2, timeoutSec: 300,
      mode: 'fast', thinkSplit: true, thinkSurvey: true, thinkOrganize: true, // Careful mode: which steps let the AI think first
      thinkLimitSec: 120, editStyle: 'typos', sidebar: 'show',
      oaUrl: 'http://localhost:3001/api/v1/openai', oaKey: '', oaModel: '', manualBatch: 20, survey: true, surveyMax: 8, theme: 'auto',
    };
  }
  function defaultState() {
    return {
      app: 'mind-desk', schema: 1, notes: [], items: [], tasks: [], categories: C.defaultCategories(),
      words: [{ id: C.uid('w'), term: 'Madhutech', meaning: 'Madhu Infotech, my job (not my own website)' }],
      rules: [], prompts: { split: null, survey: null, organize: null, fix: null }, settings: defaultSettings(), survey: null, folderFiles: [], folderOriginals: [], runLog: [],
    };
  }
  function migrate(s) {
    const d = defaultState();
    const out = Object.assign({}, d, s || {});
    out.settings = Object.assign(defaultSettings(), (s && s.settings) || {});
    if ('think' in out.settings) { if (out.settings.think === true && !(s.settings && s.settings.mode)) out.settings.mode = 'careful'; delete out.settings.think; } // 1.0.2 had one on/off switch
    if (!['fast', 'careful'].includes(out.settings.mode)) out.settings.mode = 'fast';
    out.prompts = Object.assign({ split: null, survey: null, organize: null, fix: null }, (s && s.prompts) || {});
    for (const k of ['notes', 'items', 'tasks', 'words', 'rules', 'folderFiles', 'folderOriginals', 'runLog']) if (!Array.isArray(out[k])) out[k] = [];
    if (!['typos', 'clean'].includes(out.settings.editStyle)) out.settings.editStyle = 'typos';
    // 1.0.4 one place rule: "also show in" tags made by the AI before 1.0.4 are removed once
    if (((s && s.schema) || 1) < 2) out.items.forEach((it) => { if (Array.isArray(it.tags)) it.tags = []; });
    if (!Array.isArray(out.categories) || !out.categories.length) out.categories = C.defaultCategories();
    for (const sys of ['todo', 'unsorted']) if (!out.categories.some((c) => c.id === sys)) out.categories.push(C.defaultCategories().find((c) => c.id === sys));
    out.app = 'mind-desk'; out.schema = 2;
    return out;
  }

  let saveTimer = null, folderTimer = null, saveState = 'saved';
  const LIFE = { ok: false, blocked: false, rev: 0 }; // ok = state loaded safely; blocked = another window took over
  function save(opts) {
    if (!LIFE.ok || LIFE.blocked || !S) return; // never write when the load failed or another window is in charge
    saveState = 'saving'; paintSaveState();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeState, 250);
    if (opts && opts.folder === false) return; // folder bookkeeping only: no new folder copy
    clearTimeout(folderTimer);
    folderTimer = setTimeout(syncFolder, 1500);
  }
  let writing = false, writeAgain = false;
  /** writes run one at a time, so a slow save cannot be mistaken for another window's save */
  async function writeState() {
    if (!LIFE.ok || LIFE.blocked) return;
    if (writing) { writeAgain = true; return; }
    writing = true;
    try {
      const next = LIFE.rev + 1; S.rev = next;
      const ok = await store.putState(S, LIFE.rev);
      if (ok) { LIFE.rev = next; saveState = writeAgain ? 'saving' : 'saved'; } else { saveState = 'error'; blockWindow('changed'); }
    } catch (e) { saveState = 'error'; toast('Could not save: ' + e.message + '. Mind Desk will try again with your next change.', 6000); } finally { writing = false; }
    paintSaveState();
    if (writeAgain && !LIFE.blocked) { writeAgain = false; writeState(); }
  }
  function paintSaveState() {
    const el = $('#savestate'); if (!el) return;
    const f = FOLDER.handle ? (FOLDER.ok ? ` · folder “${esc(FOLDER.name)}”` : ' · <a href="#" data-act="reconnectFolder">reconnect folder</a>') : '';
    el.innerHTML = (saveState === 'saved' ? 'Saved' : saveState === 'saving' ? 'Saving…' : '<span style="color:var(--bad)">Not saved</span>') + f + (LIFE.noLock ? ' · <span title="Only one Mind Desk window should be open">one-window check off</span>' : '');
  }

  /* ================= helpers ================= */
  const cats = () => S.categories;
  const cat = (id) => S.categories.find((c) => c.id === id);
  const noteOf = (it) => S.notes.find((n) => n.id === it.noteId);
  const itemTasks = (id) => S.tasks.filter((t) => t.itemId === id);
  const ctx = () => ({ cats: S.categories, words: S.words, rules: S.rules, max: S.settings.surveyMax, editStyle: S.settings.editStyle, noTags: true });
  const prompt = (k) => S.prompts[k] || C.DEFAULT_PROMPTS[k];

  function noteStatus(n) {
    if (n.status === 'new') return 'new';
    const its = S.items.filter((i) => i.noteId === n.id);
    if (its.some((i) => i.status === 'pending')) return 'split';
    if (its.some((i) => i.status === 'review')) return 'review';
    return 'done';
  }
  const NOTE_CHIP = { new: '<span class="chip acc">New</span>', split: '<span class="chip warn">Waiting</span>', review: '<span class="chip warn">To review</span>', done: '<span class="chip good">Organized</span>' };

  function itemsIn(catId) { return C.itemsIn(S, catId); }
  const busy = () => { if (RUN.active) { toast('Please wait until the AI run has finished, or press Stop.'); return true; } return false; };
  const alive = (it) => S.items.includes(it);
  const isLocal = (u) => { try { return /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0)$/i.test(new URL(u).hostname); } catch (e) { return false; } };
  const isCloudModel = (m) => /(^|[-:])cloud\b/i.test(String(m || ''));
  function remoteWarning() {
    const s = S.settings; const out = [];
    if (s.provider === 'ollama' && !isLocal(s.ollamaUrl)) out.push(`The Ollama address ${s.ollamaUrl} is not on this PC. Your notes will be sent to it.`);
    if (s.provider === 'openai' && !isLocal(s.oaUrl)) out.push(`The AI address ${s.oaUrl} is not on this PC. Your notes will be sent to it.`);
    if (s.provider === 'ollama' && isCloudModel(s.model)) out.push(`“${s.model}” is an Ollama cloud model: your notes leave your PC and go to Ollama's servers.`);
    if (s.provider === 'manual') out.push('Copy & paste mode: your notes leave your PC when you paste them into ChatGPT or Claude.');
    return out;
  }
  function openTaskCount() { return C.visibleTasks(S).filter((t) => !t.done).length; }

  function toast(msg, ms = 3500) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }
  function fmtTime(ts) { const d = new Date(ts); return C.fmtDate(ts) + ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }

  const FLAG_TEXT = {
    shortened: ['warn', 'Text got shorter. Check nothing is missing.'],
    bigchange: ['warn', 'Many words changed. Check the meaning is the same.'],
    lostword: ['bad', 'A protected word was changed'],
    unsorted: ['warn', 'AI could not choose a category'],
    aierror: ['bad', 'AI failed, your original text is kept'],
    notext: ['bad', 'AI gave no text, your original text is kept'],
    numbers: ['bad', 'A number or date changed'],
    negation: ['bad', 'A “not / never / don’t” word disappeared, so the meaning may have flipped'],
    taskcheck: ['warn', 'A task may not match your note. Check the tasks.'],
    thinkcut: ['warn', 'Careful thinking took too long, so this was answered in Fast mode'],
    splitguess: ['warn', 'Your original text was divided approximately (very long note). Check “Show my original”.'],
  };
  /** the AI's thinking, folded away by default */
  function thinkBox(text, label) {
    if (!text) return '';
    return `<details class="think"><summary>${esc(label || 'Show AI’s thinking')}</summary><div class="pre">${esc(text)}</div></details>`;
  }
  function flagChips(it) {
    const sv = it.surveyFailed ? `<span class="chip warn">The questions step failed for this note, so its shortcodes were not checked</span> <button class="btn small" data-act="resurvey" data-id="${esc(it.id)}">Ask questions again</button> ` : '';
    return sv + (it.flags || []).map((f) => {
      const [cls, txt] = FLAG_TEXT[f] || ['warn', f];
      const extra = f === 'lostword' && it.lost && it.lost.length ? ': ' + it.lost.join(', ') : f === 'aierror' && it.error ? ': ' + it.error : '';
      return `<span class="chip ${cls}">${esc(txt + extra)}</span>`;
    }).join(' ');
  }
  function catOptions(selected, list) {
    const all = list || C.assignableCats(cats());
    return all.map((c) => `<option value="${esc(c.id)}"${c.id === selected ? ' selected' : ''}>${esc(C.catPath(cats(), c.id))}</option>`).join('');
  }
  function diffHtml(a, b) {
    const d = C.diff(a, b);
    const left = d.filter((x) => x.t !== 'ins').map((x) => (x.t === 'del' ? `<del class="d">${esc(x.s)}</del>` : esc(x.s))).join('');
    const right = d.filter((x) => x.t !== 'del').map((x) => (x.t === 'ins' ? `<ins class="i">${esc(x.s)}</ins>` : esc(x.s))).join('');
    return { left, right };
  }

  /* ================= modal ================= */
  function modal(html, onClose, focusSel) {
    closeModal();
    const o = document.createElement('div'); o.className = 'overlay'; o.id = 'overlay';
    o.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    o.addEventListener('mousedown', (e) => { if (e.target === o && onClose) { onClose(); } });
    document.body.appendChild(o); const app = $('.app'); if (app) app.inert = true;
    const f = focusSel ? o.querySelector(focusSel) : o.querySelector('textarea:not([readonly]),input'); if (f) f.focus();
    return o;
  }
  function closeModal() { const o = $('#overlay'); if (o) o.remove(); const app = $('.app'); if (app && !LIFE.blocked) app.inert = false; }
  function showError(e) {
    const m = (e && e.message) || String(e);
    modal(`<h2>Something went wrong</h2><p class="pre">${esc(m)}</p>${e && e.conn ? connHelpHtml() : ''}<div class="actions"><button class="btn primary" data-act="closeModal">OK</button></div>`, closeModal);
  }
  function connHelpHtml() {
    return `<div class="banner info"><b>Quick fixes</b><ol class="steps">
      <li>Make sure Ollama is running: you should see the llama icon near the clock. If not, open <b>Ollama</b> from the Start menu.</li>
      <li>Allow Mind Desk to talk to Ollama (one-time): set <code>OLLAMA_ORIGINS</code> to <code>*</code>. See <b>Settings → First-time Ollama setup</b>.</li>
      <li>Or switch to <b>Copy &amp; paste</b> mode in Settings to use ChatGPT or Claude instead.</li></ol></div>`;
  }

  /* ================= AI providers ================= */
  function connError(where) { const e = new Error(`Mind Desk could not reach the AI at ${where}.`); e.conn = true; return e; }

  async function withTimeout(fn, factor = 1) {
    const ctrl = new AbortController(); RUN.ctrl = ctrl; let timedOut = false;
    const secs = (+S.settings.timeoutSec || 300) * factor;
    const t = setTimeout(() => { timedOut = true; ctrl.abort(); }, secs * 1000);
    try { return await fn(ctrl.signal); } catch (e) {
      if (timedOut) throw new Error(`The AI took longer than ${secs} seconds and was stopped. Fast mode, a smaller model or a bigger time limit (Settings) can help.`);
      throw e;
    } finally { clearTimeout(t); if (RUN.ctrl === ctrl) RUN.ctrl = null; }
  }

  /** context size big enough for prompt + answer (organize answers are as long as the note) */
  function ctxSize(system, user, outFactor, thinking) {
    const need = Math.ceil((system.length + user.length * (1 + outFactor)) / 3.2) + 768 + (thinking ? 4096 : 0); // room for the AI's thinking
    if (need > 32768) { const e = new Error(`This item is too long for the AI in one go (about ${Math.round(user.length / 6).toLocaleString()} words). Open it, use Edit and put --- lines to split it, then press “Ask AI again”.`); e.tooLong = true; throw e; }
    return Math.max(+S.settings.numCtx || 8192, Math.ceil(need / 1024) * 1024);
  }
  /** some models write their thinking inside <think> tags in the answer: move it out */
  function splitThink(content, thinking) {
    let th = thinking || '';
    const c = String(content || '').replace(/<think>([\s\S]*?)<\/think>/gi, (m, x) => { th += (th ? '\n' : '') + x.trim(); return ''; }).trim();
    return { content: c, thinking: th.trim().slice(0, 20000) };
  }
  const NO_THINK_SWITCH = new Set();
  /** read Ollama's answer piece by piece, so the live panel can show progress and long thinking can be stopped */
  async function readStream(r, thinking) {
    const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '', content = '', thought = '';
    const t0 = Date.now(); const limit = Math.max(10, +S.settings.thinkLimitSec || 120) * 1000;
    const eat = (line) => {
      line = line.trim(); if (!line) return;
      let o; try { o = JSON.parse(line); } catch (e) { return; }
      if (o.error) throw new Error('Ollama: ' + o.error);
      const m = o.message || {}; if (m.thinking) thought += m.thinking; if (m.content) content += m.content;
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf('\n')) >= 0) { eat(buf.slice(0, i)); buf = buf.slice(i + 1); }
      liveUpdate(thought, content);
      if (thinking && !content && Date.now() - t0 > limit) { // thinking for too long: stop and answer quickly instead
        try { await reader.cancel(); } catch (e) { /* ignore */ }
        const e = new Error('The AI was still thinking after ' + Math.round(limit / 1000) + ' seconds.'); e.thinkTooLong = true; e.thinking = thought; throw e;
      }
    }
    eat(buf);
    return splitThink(content, thought);
  }
  /* live panel: seconds counter and the last part of the AI's thinking while it works */
  const LIVE = { t0: 0, timer: null, thinking: '', content: '', step: '' };
  function liveStart(step) {
    LIVE.t0 = Date.now(); LIVE.thinking = ''; LIVE.content = ''; LIVE.step = step;
    clearInterval(LIVE.timer); LIVE.timer = setInterval(livePaint, 500); livePaint();
  }
  function liveUpdate(thinking, content) { LIVE.thinking = thinking; LIVE.content = content; }
  function liveStop() { clearInterval(LIVE.timer); LIVE.timer = null; LIVE.t0 = 0; livePaint(); }
  function livePaint() {
    const info = $('#liveinfo'); const panel = $('#livepanel');
    if (!LIVE.t0 || !RUN.active) { if (info) info.textContent = ''; if (panel) panel.hidden = true; return; }
    const sec = Math.round((Date.now() - LIVE.t0) / 1000);
    const state = LIVE.content ? 'writing the answer' : LIVE.thinking ? 'thinking' : 'waiting for the AI';
    if (info) info.textContent = `${sec} s · ${state}`;
    if (panel) {
      panel.hidden = !LIVE.thinking || UI.hideLive;
      if (!panel.hidden) $('#livetext').textContent = '…' + LIVE.thinking.slice(-600);
    }
  }
  async function ollamaChat(system, user, schema, outFactor = 1, think = false) {
    const s = S.settings; const base = s.ollamaUrl.replace(/\/+$/, '');
    const body = { model: s.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], stream: true, options: { temperature: +s.temperature, num_ctx: ctxSize(system, user, outFactor, think) }, keep_alive: '10m' };
    // Careful: the AI thinks first (thinking comes back separately). The JSON shape is then asked for in words only,
    // because a fixed JSON format can stop some models from thinking.
    const plain = NO_THINK_SWITCH.has(s.model); // this model rejected the thinking switch earlier: ask normally
    if (plain) { if (schema) body.format = schema; } else if (think) body.think = true; else { body.think = false; if (schema) body.format = schema; }
    return withTimeout(async (signal) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        let r;
        try { r = await fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }); } catch (e) { if (e.name === 'AbortError') throw e; throw connError(base); }
        if (r.ok) return await readStream(r, !!body.think);
        const t = await r.text();
        if ('think' in body && /think/i.test(t)) { // this model cannot switch thinking on/off: just ask normally
          if (body.think && schema) body.format = schema;
          delete body.think; NO_THINK_SWITCH.add(s.model); continue;
        }
        if (r.status === 404 && /model/i.test(t)) throw new Error(`The model “${s.model}” is not installed in Ollama.\nOpen Command Prompt and run:  ollama pull ${s.model}\n(or choose an installed model in Settings).`);
        if (r.status === 403) throw connError(base);
        throw new Error('Ollama answered with an error ' + r.status + ': ' + t.slice(0, 300));
      }
      throw new Error('Ollama could not run the request.');
    }, think ? 2 : 1);
  }
  async function openaiChat(system, user) {
    const s = S.settings; const base = s.oaUrl.replace(/\/+$/, '');
    const headers = { 'Content-Type': 'application/json' }; if (s.oaKey) headers.Authorization = 'Bearer ' + s.oaKey;
    return withTimeout(async (signal) => {
      let r;
      try { r = await fetch(base + '/chat/completions', { method: 'POST', headers, signal, body: JSON.stringify({ model: s.oaModel, temperature: +s.temperature, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) }); } catch (e) { if (e.name === 'AbortError') throw e; throw connError(base); }
      const t = await r.text();
      if (!r.ok) throw new Error('The AI answered with an error ' + r.status + ': ' + t.slice(0, 300));
      const j = JSON.parse(t); const m = (j.choices && j.choices[0] && j.choices[0].message) || {};
      return splitThink(m.content, m.reasoning_content || m.reasoning || '');
    });
  }
  const STEP_KEY = { split: 'thinkSplit', survey: 'thinkSurvey', organize: 'thinkOrganize' };
  /** does this step think in the current run? (Careful mode and the step is ticked in Settings) */
  const thinks = (step) => RUN.mode === 'careful' && S.settings[STEP_KEY[step]] !== false;
  /** one AI request that must return JSON; tries twice. Returns {data, thinking, ms, cut} and writes a line to the run log */
  async function aiJSON(step, system, user, noteName) {
    let last; let thinking = ''; let cut = false; const t0 = Date.now();
    let think = thinks(step);
    const log = (ok, err) => {
      S.runLog.push({ at: Date.now(), step, note: noteName || '', mode: think || cut ? 'careful' : 'fast', ms: Date.now() - t0, ok, err: err || '', cut, thinkChars: thinking.length });
      if (S.runLog.length > 300) S.runLog.splice(0, S.runLog.length - 300);
    };
    liveStart(step);
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (RUN.stop) throw abortErr();
        let r;
        try {
          r = S.settings.provider === 'openai' ? await openaiChat(system, user) : await ollamaChat(system, user, C.SCHEMAS[step], step === 'organize' || step === 'fix' ? 1 : 0.2, think);
        } catch (e) {
          if (!e.thinkTooLong) throw e;
          cut = true; think = false; thinking += (e.thinking || '') + '\n[Thinking stopped after the time limit; answered in Fast mode.]';
          r = await ollamaChat(system, user, C.SCHEMAS[step], step === 'organize' || step === 'fix' ? 1 : 0.2, false);
        }
        if (r.thinking) thinking += (thinking ? '\n\n— second try —\n' : '') + r.thinking;
        try { const data = C.parseJSON(r.content); log(true); return { data, thinking, ms: Date.now() - t0, cut }; } catch (e) { last = e; }
      }
      log(false, last && last.message); throw last;
    } catch (e) {
      if (e !== last) log(false, e.name === 'AbortError' ? 'stopped' : e.message);
      throw e;
    } finally { liveStop(); }
  }
  function abortErr() { const e = new Error('Stopped'); e.name = 'AbortError'; return e; }

  /** copy & paste mode: show the prompt, wait for the pasted answer */
  function askManual(title, text) {
    return new Promise((resolve, reject) => {
      RUN.manualReject = () => { RUN.manualReject = null; closeModal(); reject(abortErr()); };
      modal(`<h2>${esc(title)}</h2>
        <p class="hint">1. Copy this prompt. 2. Paste it into ChatGPT or Claude. 3. Copy the whole answer and paste it below.</p>
        <textarea id="mpPrompt" rows="8" readonly>${esc(text)}</textarea>
        <div class="row" style="margin:6px 0 14px"><button class="btn primary" id="mpCopy">Copy prompt</button><span class="muted small">${text.length.toLocaleString()} characters</span></div>
        <label for="mpAns">Paste the AI answer here</label>
        <textarea id="mpAns" rows="8" placeholder='{"..."}'></textarea>
        <div id="mpErr" class="banner bad" style="display:none;margin-top:8px"></div>
        <div class="actions"><button class="btn primary" id="mpOk">Continue</button><button class="btn" id="mpCancel">Stop</button></div>`, null, '#mpCopy');
      $('#mpCopy').onclick = async () => {
        try { await navigator.clipboard.writeText(text); toast('Prompt copied'); } catch (e) { const ta = $('#mpPrompt'); ta.select(); document.execCommand('copy'); toast('Prompt copied'); }
      };
      $('#mpOk').onclick = () => {
        const v = $('#mpAns').value;
        try { const obj = C.parseJSON(v); RUN.manualReject = null; closeModal(); resolve(obj); } catch (e) { const b = $('#mpErr'); b.style.display = 'block'; b.textContent = 'This does not look like the JSON answer. Copy the complete answer (it starts with { ) and try again.'; }
      };
      $('#mpCancel').onclick = () => { if (RUN.manualReject) RUN.manualReject(); };
    });
  }

  /* ================= the organize run ================= */
  function setProgress(label, done, total) {
    RUN.label = label; RUN.done = done; RUN.total = total;
    const p = $('#progress'); if (!p) return;
    if (!RUN.active) { p.innerHTML = ''; return; }
    const pct = total ? Math.round((done / total) * 100) : 0;
    p.innerHTML = `<span>${esc(label)}${total ? ` ${done}/${total}` : ''}</span><span class="muted" id="liveinfo"></span><span class="bar"><i style="width:${pct}%"></i></span><button class="btn small" data-act="stopRun">Stop</button>`;
    livePaint();
  }

  function newItem(note, k, text) {
    return { id: C.uid('i'), noteId: note.id, order: k, original: text, text, title: '', cat: 'unsorted', tags: [], status: 'pending', flags: [], lost: [], surveyed: false, createdAt: note.addedAt, updatedAt: Date.now() };
  }
  function addItemsFromGroups(note, blocks, groups) {
    if (!S.notes.includes(note)) return; // note was deleted meanwhile
    groups.forEach((g, k) => {
      let text = '';
      g.forEach((bi, j) => { text += (j === 0 ? '' : blocks[bi].same ? '\n' : '\n\n') + blocks[bi].text; });
      S.items.push(newItem(note, k, text));
    });
    note.status = 'split';
  }
  const hardStarts = (blocks, idxs) => idxs.map((bi, k) => (k > 0 && blocks[bi].hard ? k + 1 : 0)).filter(Boolean);

  async function splitNote(note) {
    const blocks = C.makeBlocks(note.text, true);
    if (!blocks.length) { note.status = 'split'; return; }
    if (blocks.length === 1) { addItemsFromGroups(note, blocks, [[0]]); return; }
    const groups = []; const thoughts = []; let splitMs = 0;
    for (const win of C.blockWindows(blocks)) {
      if (win.length === 1) { groups.push(win); continue; }
      let starts;
      try {
        const p = C.buildSplitPrompt(prompt('split'), blocks, win);
        const a = await aiJSON('split', p.system, p.user, note.name); starts = a.data.starts; splitMs += a.ms;
        if (a.thinking) thoughts.push(a.thinking);
      } catch (e) { if (e.name === 'AbortError' || e.conn) throw e; starts = win.map((_, k) => k + 1); }
      for (const g of C.groupsFromStarts(win.length, starts, hardStarts(blocks, win))) groups.push(g.map((k) => win[k]));
    }
    note.splitThinking = thoughts.join('\n\n').slice(0, 20000) || undefined; note.splitMs = splitMs || undefined;
    addItemsFromGroups(note, blocks, groups);
  }

  async function splitManual(notes) {
    const payload = [];
    for (const n of notes) {
      const blocks = C.makeBlocks(n.text, true);
      if (blocks.length <= 1) addItemsFromGroups(n, blocks, blocks.length ? [[0]] : []); else payload.push({ id: n.id, note: n, blocks });
    }
    if (!payload.length) return;
    const ans = await askManual('Step 1 of 3: split your notes', C.bulkSplitPrompt(prompt('split'), payload));
    const list = Array.isArray(ans.notes) ? ans.notes : [];
    for (const p of payload) {
      const hit = list.find((x) => x && String(x.id) === p.id);
      const all = p.blocks.map((_, k) => k);
      addItemsFromGroups(p.note, p.blocks, C.groupsFromStarts(p.blocks.length, hit ? hit.starts : all.map((k) => k + 1), hardStarts(p.blocks, all)));
    }
  }

  /** the questions step reads every item completely: long items are cut into pieces, all pieces are sent */
  async function runSurvey(items) {
    const manual = S.settings.provider === 'manual';
    const limit = manual ? 30000 : 8000;
    const chunks = []; let cur = { text: '', items: new Set() };
    const push = () => { if (cur.text) chunks.push(cur); cur = { text: '', items: new Set() }; };
    for (const it of items) {
      for (let pos = 0; pos < it.original.length; pos += limit - 200) {
        const piece = it.original.slice(pos, pos + limit - 200) + '\n\n---\n\n';
        if (cur.text && cur.text.length + piece.length > limit) push();
        cur.text += piece; cur.items.add(it);
      }
    }
    push();
    let all = []; const failed = new Set(); const thoughts = [];
    for (let i = 0; i < chunks.length; i++) {
      setProgress('Reading your notes for questions', i, chunks.length);
      try {
        if (manual) all = all.concat((await askManual(`Step 2 of 3: questions about your notes${chunks.length > 1 ? ` (part ${i + 1} of ${chunks.length})` : ''}`, C.bulkSurveyPrompt(prompt('survey'), chunks[i].text, ctx()))).questions || []);
        else {
          const p = C.buildSurveyPrompt(prompt('survey'), chunks[i].text, ctx()); const a = await aiJSON('survey', p.system, p.user, [...chunks[i].items].map((it) => (noteOf(it) || {}).name).filter(Boolean)[0]);
          all = all.concat(a.data.questions || []); if (a.thinking) thoughts.push(a.thinking);
        }
      } catch (e) { if (e.name === 'AbortError' || e.conn) throw e; chunks[i].items.forEach((it) => failed.add(it)); }
    }
    for (const it of items) it.surveyFailed = failed.has(it);
    if (failed.size) toast(`The questions step failed for ${failed.size} note(s) (the AI answer was not usable). They are marked in Review.`, 7000);
    RUN.surveyThinking = thoughts.join('\n\n').slice(0, 20000);
    return C.checkSurvey(all, ctx());
  }

  function applyResult(it, chk, thinking, ms, cut) {
    if (!alive(it)) return; // deleted or replaced meanwhile: drop the answer
    it.thinking = thinking ? String(thinking).slice(0, 20000) : undefined; it.mode = RUN.mode || 'fast'; it.ms = ms || undefined;
    if (cut) chk.flags.push('thinkcut');
    it.tags = Array.isArray(it.tags) ? it.tags : []; // one place rule: the AI no longer adds "also show in"; your own choices stay
    it.title = chk.title; it.cat = chk.category; it.text = chk.text; it.flags = chk.flags; it.lost = chk.lost; it.error = '';
    it.status = 'review'; it.updatedAt = Date.now();
    S.tasks = S.tasks.filter((t) => t.itemId !== it.id).concat(chk.tasks.map((t) => ({ id: C.uid('t'), itemId: it.id, text: t.text, done: t.done, cat: t.cat, createdAt: it.createdAt })));
  }
  function failItem(it, e) {
    if (!alive(it)) return;
    it.status = 'review'; it.flags = ['aierror']; it.error = (e && e.message) || 'unknown error'; it.text = it.original; it.cat = 'unsorted';
    it.title = it.title || it.original.split(/\s+/).slice(0, 7).join(' ');
  }
  const SERIOUS = ['shortened', 'lostword', 'bigchange', 'numbers', 'negation'];
  async function organizeOne(it) {
    const c = ctx(); const p = C.buildOrganizePrompt(prompt('organize'), it.original, c);
    const nm = (noteOf(it) || {}).name;
    const a1 = await aiJSON('organize', p.system, p.user, nm);
    let chk = C.checkOrganize(a1.data, it.original, c); let thinking = a1.thinking; let ms = a1.ms; let cut = a1.cut;
    if (chk.flags.some((f) => SERIOUS.includes(f))) {
      const strict = p.system + (S.settings.editStyle === 'clean'
        ? '\n\nIMPORTANT: a previous answer lost content or changed a fact (a number, a name, a "not"). Keep every point, number, name and "not" exactly; only fix typos and make sentences clearer.'
        : '\n\nIMPORTANT: a previous answer changed or removed words. Return the note with ONLY typo fixes. Every other word must stay exactly the same.');
      try {
        const a2 = await aiJSON('organize', strict, p.user, nm); ms += a2.ms; cut = cut || a2.cut;
        const chk2 = C.checkOrganize(a2.data, it.original, c);
        const bad = (x) => x.flags.filter((f) => SERIOUS.includes(f)).length;
        if (bad(chk2) <= bad(chk)) { chk = chk2; thinking = a2.thinking ? (a1.thinking ? a1.thinking + '\n\n— asked again, stricter —\n' : '') + a2.thinking : thinking; }
      } catch (e) { if (e.name === 'AbortError' || e.conn) throw e; }
    }
    applyResult(it, chk, thinking, ms, cut);
  }
  async function organizeManual(items) {
    const size = Math.max(1, +S.settings.manualBatch || 20); const parts = Math.ceil(items.length / size); let missing = 0;
    for (let k = 0; k < parts; k++) {
      const batch = items.slice(k * size, (k + 1) * size);
      const ans = await askManual(`Step 3 of 3: organize${parts > 1 ? ` (part ${k + 1} of ${parts})` : ''}`, C.bulkOrganizePrompt(prompt('organize'), batch.map((i) => ({ id: i.id, text: i.original })), ctx()));
      const res = Array.isArray(ans.results) ? ans.results : [];
      for (const it of batch) {
        const r = res.find((x) => x && String(x.id) === it.id);
        if (r) applyResult(it, C.checkOrganize(r, it.original, ctx())); else missing++;
      }
      save();
    }
    if (missing) toast(`${missing} note(s) were missing in the answer. Press “Organize all” again for them.`, 6000);
  }

  function waitSurvey() { return new Promise((resolve, reject) => { RUN.surveyWait = { resolve, reject }; }); }

  /** organize new notes; with noteIds, only those notes */
  async function organizeAll(noteIds) {
    if (RUN.active) return;
    const manual = S.settings.provider === 'manual';
    const mine = (n) => !noteIds || noteIds.includes(n.id);
    const mineItem = (i) => !noteIds || noteIds.includes(i.noteId);
    if (!S.notes.some((n) => n.status === 'new' && mine(n)) && !S.items.some((i) => i.status === 'pending' && mineItem(i))) { toast(noteIds ? 'This note is already organized.' : 'Nothing new to organize. Add notes first.'); return; }
    const warn = remoteWarning().filter((w) => !/Copy & paste/.test(w));
    if (warn.length && !window.confirm(warn.join('\n') + '\n\nContinue?')) return;
    RUN.active = true; RUN.stop = false; RUN.mode = S.settings.mode; paintTop();
    try {
      const fresh = S.notes.filter((n) => n.status === 'new' && mine(n));
      if (fresh.length) {
        if (manual) { setProgress('Splitting notes', 0, 0); await splitManual(fresh); save(); } else {
          for (let i = 0; i < fresh.length; i++) {
            if (RUN.stop) throw abortErr();
            setProgress('Splitting notes', i, fresh.length);
            await splitNote(fresh[i]); save(); render();
          }
        }
      }
      if (S.survey) { // questions from an earlier run are still open
        UI.view = 'survey'; render(); setProgress('Waiting for your answers', 0, 0);
        await waitSurvey();
      }
      const unsurveyed = S.items.filter((i) => i.status === 'pending' && !i.surveyed && mineItem(i));
      if (S.settings.survey && unsurveyed.length) {
        setProgress('Reading your notes for questions', 0, 0);
        const qs = await runSurvey(unsurveyed);
        unsurveyed.forEach((i) => { i.surveyed = true; }); save();
        if (qs.length) {
          S.survey = { questions: qs, createdAt: Date.now() }; if (RUN.surveyThinking) S.survey.thinking = RUN.surveyThinking; save();
          UI.view = 'survey'; render(); setProgress('Waiting for your answers', 0, 0);
          await waitSurvey();
        }
      } else unsurveyed.forEach((i) => { i.surveyed = true; });
      const todo = S.items.filter((i) => i.status === 'pending' && mineItem(i));
      if (manual) { setProgress('Organizing', 0, 0); await organizeManual(todo); } else {
        for (let i = 0; i < todo.length; i++) {
          if (RUN.stop) throw abortErr();
          setProgress('Organizing', i, todo.length);
          if (!alive(todo[i])) continue;
          try { await organizeOne(todo[i]); } catch (e) { if (e.name === 'AbortError' || e.conn) throw e; failItem(todo[i], e); }
          save(); if (UI.view === 'inbox') renderContent();
        }
      }
      const n = S.items.filter((i) => i.status === 'review').length;
      toast(n ? `Done. ${n} item(s) are ready for your review.` : 'Done.');
      if (n) { UI.view = 'review'; UI.editing = null; }
    } catch (e) {
      if (e.name !== 'AbortError') showError(e); else toast('Stopped. Press “Organize all” to continue later.');
    } finally {
      RUN.active = false; RUN.stop = false; RUN.surveyWait = null; RUN.manualReject = null; save(); render();
    }
  }

  /* ================= folder sync ================= */
  async function initFolder() {
    if (!('showDirectoryPicker' in window) || !store.db) return;
    try {
      const h = await store.get('folder'); if (!h) return;
      FOLDER.handle = h; FOLDER.name = h.name;
      FOLDER.ok = (await h.queryPermission({ mode: 'readwrite' })) === 'granted';
    } catch (e) { FOLDER.ok = false; }
  }
  const stillInCharge = () => LIFE.ok && !LIFE.blocked;
  function stopped() { const e = new Error('another window is in charge'); e.stopped = true; return e; }
  /** a file only replaces the old one at close(); if this window lost control meanwhile, the write is thrown away */
  async function writeFile(dir, name, content) {
    if (!stillInCharge()) throw stopped();
    const fh = await dir.getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.write(content);
    if (!stillInCharge()) { try { await w.abort(); } catch (e) { /* ignore */ } throw stopped(); }
    await w.close();
  }
  async function syncFolder() {
    if (!FOLDER.handle || !FOLDER.ok) return;
    try {
      const root = FOLDER.handle;
      await writeFile(root, 'Mind Desk backup.json', JSON.stringify(exportObj(), null, 1));
      const org = await root.getDirectoryHandle('Organized', { create: true });
      const files = []; const taken = new Set();
      for (const c of S.categories.filter((x) => !x.parent)) {
        const has = itemsIn(c.id).length || (c.id === 'todo' && C.visibleTasks(S).length) || C.linkedTasks(S, c.id).length;
        if (!has) continue;
        let base = C.safeName(c.name), name = base + '.md', k = 2;
        while (taken.has(name.toLowerCase())) name = `${base} (${k++}).md`; // Windows ignores upper/lower case
        taken.add(name.toLowerCase()); files.push(name);
        await writeFile(org, name, C.categoryMarkdown(S, c.id));
      }
      for (const old of S.folderFiles) if (!files.includes(old)) { if (!stillInCharge()) throw stopped(); try { await org.removeEntry(old); } catch (e) { /* gone */ } }
      S.folderFiles = files;
      const orig = await root.getDirectoryHandle('Originals', { create: true });
      for (const n of S.notes) {
        if (S.folderOriginals.includes(n.id)) continue;
        await writeFile(orig, `${new Date(n.addedAt).toISOString().slice(0, 10)} ${C.safeName(n.name)} [${n.id.slice(-6)}].txt`, n.text);
        S.folderOriginals.push(n.id);
      }
      save({ folder: false });
      FOLDER.msg = 'Last saved to folder at ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { if (e.stopped) return; FOLDER.ok = false; FOLDER.msg = 'Folder save failed: ' + e.message; }
    paintSaveState();
  }

  /* ================= export / import ================= */
  function exportObj() {
    const o = JSON.parse(JSON.stringify(S)); o.exportedAt = Date.now(); o.version = VERSION;
    delete o.folderFiles; delete o.folderOriginals; delete o.rev; delete o.runLog; if (o.settings) delete o.settings.oaKey; // never put the API key in a backup
    return o;
  }
  function download(name, text, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  const today = () => new Date().toISOString().slice(0, 10);

  /* ================= adding notes ================= */
  function addNote(name, text, source) {
    text = String(text || '').replace(/\r\n?/g, '\n');
    if (!text.trim()) return null;
    if (S.notes.some((n) => n.text === text)) return 'dup';
    const n = { id: C.uid('n'), name: String(name || 'Note').trim().slice(0, 120) || 'Note', text, addedAt: Date.now(), source, status: 'new' };
    S.notes.push(n); return n;
  }
  async function addFiles(fileList) {
    let added = 0, dup = 0, skipped = 0; let last = null;
    for (const f of fileList) {
      const okType = /\.(txt|md|markdown|text|log)$/i.test(f.name) || (f.type || '').startsWith('text/') || !f.type;
      if (!okType || f.size > 2 * 1024 * 1024) { skipped++; continue; }
      const r = addNote(f.name.replace(/\.[^.]+$/, ''), await f.text(), 'file');
      if (r === 'dup') dup++; else if (r) { added++; last = r; } else skipped++;
    }
    if (last) { UI.selNote = last.id; UI.view = 'inbox'; }
    save(); render();
    toast(`${added} note(s) added${dup ? `, ${dup} already here` : ''}${skipped ? `, ${skipped} skipped (empty, not text, or over 2 MB)` : ''}.`);
  }

  /* ================= rendering ================= */
  function render() { renderSide(); paintTop(); renderContent(); paintSaveState(); }

  function navBtn(view, label, extra = '', cls = '') {
    return `<button class="${cls}${UI.view === view ? ' on' : ''}" data-act="nav" data-v="${esc(view)}">${label}${extra}</button>`;
  }
  function renderSide() {
    const review = S.items.filter((i) => i.status === 'review').length;
    const newNotes = S.notes.filter((n) => n.status === 'new').length;
    let h = navBtn('inbox', '📥 Inbox', newNotes ? `<span class="badge">${newNotes}</span>` : `<span class="cnt">${S.notes.length}</span>`);
    if (S.survey) h += navBtn('survey', '❓ Questions for you', `<span class="badge warn">${S.survey.questions.length}</span>`);
    h += navBtn('review', '✔ Review', review ? `<span class="badge warn">${review}</span>` : '');
    h += navBtn('todo', '☑ To-do', `<span class="cnt">${openTaskCount()}</span>`);
    h += '<div class="sec">Categories</div>';
    for (const c of S.categories.filter((x) => !x.parent && x.id !== 'todo')) {
      h += navBtn('cat:' + c.id, esc(c.name), `<span class="cnt">${itemsIn(c.id).length}</span>`);
      for (const k of C.children(cats(), c.id)) h += navBtn('cat:' + k.id, esc(k.name), `<span class="cnt">${itemsIn(k.id).length}</span>`, 'sub');
    }
    h += '<div class="sec">You</div>';
    h += navBtn('words', '🔤 My words &amp; rules', `<span class="cnt">${S.words.length}</span>`);
    h += navBtn('settings', '⚙ Settings');
    $('#nav').innerHTML = h;
  }

  function viewTitle() {
    const v = UI.view;
    if (v === 'inbox') return 'Inbox';
    if (v === 'review') return 'Review';
    if (v === 'survey') return 'Questions for you';
    if (v === 'todo') return 'To-do';
    if (v === 'words') return 'My words & rules';
    if (v === 'settings') return 'Settings';
    if (v.startsWith('cat:')) return C.catPath(cats(), v.slice(4));
    return '';
  }
  function paintTop() {
    const pendingWork = S.notes.filter((n) => n.status === 'new').length + S.items.filter((i) => i.status === 'pending').length;
    const searchable = UI.view.startsWith('cat:') || UI.view === 'todo';
    $('#top').innerHTML = `<button class="btn small sidetoggle" data-act="toggleSide" title="${S.settings.sidebar === 'hide' ? 'Show' : 'Hide'} the menu" aria-label="Show or hide the menu">☰</button><h1>${esc(viewTitle())}</h1>
      ${searchable ? `<input type="search" id="search" placeholder="Search…" value="${esc(UI.search)}" aria-label="Search">` : ''}
      <div class="grow"></div><div class="progress" id="progress"></div>
      ${S.settings.provider === 'manual' ? '' : `<select id="modeSel" data-set="mode" aria-label="Fast or careful" ${RUN.active ? 'disabled' : ''} title="Fast: quick answers. Careful: the AI thinks first (slower, better at understanding what you meant).">
        <option value="fast"${S.settings.mode === 'fast' ? ' selected' : ''}>⚡ Fast</option><option value="careful"${S.settings.mode === 'careful' ? ' selected' : ''}>🧠 Careful</option></select>`}
      <button class="btn primary" data-act="organizeAll" ${RUN.active ? 'disabled' : ''} title="Split, ask questions and organize all new notes">✨ Organize all${pendingWork ? ` (${pendingWork})` : ''}</button>`;
    if (RUN.active) setProgress(RUN.label, RUN.done, RUN.total);
  }

  function renderContent() {
    const el = $('#content'); const v = UI.view;
    el.className = 'content' + (v === 'inbox' ? ' flush' : '');
    if (v === 'inbox') el.innerHTML = viewInbox();
    else if (v === 'review') el.innerHTML = viewReview();
    else if (v === 'survey') el.innerHTML = viewSurvey();
    else if (v === 'todo') el.innerHTML = viewTodo();
    else if (v === 'words') el.innerHTML = viewWords();
    else if (v === 'settings') el.innerHTML = viewSettings();
    else if (v.startsWith('cat:')) el.innerHTML = cat(v.slice(4)) ? viewCategory(v.slice(4)) : '<div class="empty">This category no longer exists.</div>';
    if (UI.focus) { const f = $(`[data-item="${CSS.escape(UI.focus)}"]`); if (f) { f.scrollIntoView({ block: 'center' }); f.style.outline = '2px solid var(--accent)'; } UI.focus = null; }
  }

  /* ---------- inbox ---------- */
  function viewInbox() {
    const notes = [...S.notes].sort((a, b) => b.addedAt - a.addedAt);
    if (!notes.find((n) => n.id === UI.selNote)) UI.selNote = notes[0] ? notes[0].id : null;
    const list = notes.map((n) => `<div class="noteitem${n.id === UI.selNote ? ' on' : ''}" data-act="selNote" data-id="${esc(n.id)}">
        <div class="nm">${esc(n.name)}</div><div class="sub">${NOTE_CHIP[noteStatus(n)]}<span>${esc(C.fmtDate(n.addedAt))}</span></div></div>`).join('');
    const tools = `<div class="tools"><button class="btn" data-act="addFiles">＋ Add files</button><button class="btn" data-act="pasteNote">📋 Paste a note</button></div>`;
    const n = S.notes.find((x) => x.id === UI.selNote);
    let mid, right;
    if (!n) {
      mid = `<div class="empty"><b>Your inbox is empty</b>Drag your .txt notes into this window, use <b>Add files</b>, or <b>Paste a note</b>.<br>Then press <b>✨ Organize all</b>.<br><br>
        <button class="btn primary" data-act="addFiles">＋ Add files</button> <button class="btn" data-act="pasteNote">📋 Paste a note</button></div>`;
      right = '<p class="muted">The AI results for a note show here.</p>';
    } else {
      const its = S.items.filter((i) => i.noteId === n.id).sort((a, b) => a.order - b.order);
      mid = `<div class="row" style="margin-bottom:10px"><h2 style="margin:0;font-size:16px;flex:1">${esc(n.name)}</h2>
          <button class="btn small" data-act="renameNote" data-id="${esc(n.id)}">Rename</button>
          ${noteStatus(n) === 'new' || noteStatus(n) === 'split' ? `<button class="btn small primary" data-act="organizeNote" data-id="${esc(n.id)}" ${RUN.active ? 'disabled' : ''}>✨ Organize this note</button>` : ''}
          ${n.status !== 'new' ? `<button class="btn small" data-act="reorganizeNote" data-id="${esc(n.id)}">Organize again</button>` : ''}
          <button class="btn small" data-act="report" data-id="${esc(n.id)}" title="Copy what Mind Desk shows for this note, to paste into a chat with Claude">📋 Report for Claude</button>
          <button class="btn small danger" data-act="deleteNote" data-id="${esc(n.id)}">Delete</button></div>
        <div class="muted small" style="margin-bottom:8px">Added ${esc(fmtTime(n.addedAt))} · ${n.text.length.toLocaleString()} characters · ${n.source === 'file' ? 'from a file' : 'pasted'}</div>
        <div class="notebody pre">${esc(n.text)}</div>${thinkBox(n.splitThinking, 'Show how the AI decided to split this note')}`;
      const st = { pending: '<span class="chip warn">Waiting</span>', review: '<span class="chip warn">To review</span>', approved: '<span class="chip good">Done</span>' };
      right = `<h2 style="font-size:15px;margin:0 0 10px">What the AI made</h2>` + (its.length ? its.map((i) => `<div class="mini" data-act="openItem" data-id="${esc(i.id)}">
          <div class="t">${esc(i.title || i.original.slice(0, 60))}</div><div class="row small" style="margin-top:4px">${st[i.status] || ''}${i.status !== 'pending' ? `<span class="muted">${esc(C.catPath(cats(), i.cat))}</span>` : ''}</div></div>`).join('')
        : `<p class="muted">Not organized yet. Press <b>✨ Organize all</b>.</p>`);
    }
    return `<div class="pane list notelist">${tools}${list}</div><div class="pane mid">${mid}</div><div class="pane right">${right}</div>`;
  }

  /* ---------- review ---------- */
  function captureDraft() {
    if (!UI.editing || !$('#editor')) return;
    UI.draft = {
      id: UI.editing, title: $('#edTitle').value, cat: $('#edCat').value, text: $('#edText').value,
      tags: $$('[data-tag]').filter((x) => x.checked).map((x) => x.dataset.tag),
      tasks: $$('#edTasks [data-taskrow]').map((r) => ({ text: $('[data-tf=text]', r).value, done: $('[data-tf=done]', r).checked, cat: $('[data-tf=cat]', r).value })),
    };
  }
  function editorHtml(item) {
    const d = UI.draft && UI.draft.id === item.id ? UI.draft : null; // unsaved changes win over the stored item
    const it = d ? Object.assign({}, item, { title: d.title, cat: d.cat, text: d.text, tags: d.tags }) : item;
    const tags = S.categories.filter((c) => !C.isTodoCat(cats(), c.id) && c.id !== 'todo' && c.id !== 'unsorted');
    const tasks = d ? d.tasks : itemTasks(it.id);
    const subs = C.todoSubs(cats());
    const taskRow = (t) => `<div class="row" data-taskrow style="margin-bottom:6px"><input type="checkbox" data-tf="done" ${t.done ? 'checked' : ''} aria-label="Done">
        <input type="text" data-tf="text" value="${esc(t.text)}" style="flex:1;min-width:200px"><select data-tf="cat">${catOptions(t.cat, subs)}</select>
        <button class="btn small" data-act="rmTaskRow" title="Remove">✕</button></div>`;
    return `<div class="card" data-item="${esc(it.id)}" id="editor">
      <div class="field"><label for="edTitle">Title</label><input type="text" id="edTitle" value="${esc(it.title)}"></div>
      <div class="grid2"><div class="field"><label for="edCat">Category</label><select id="edCat">${catOptions(it.cat)}</select></div>
        <div class="field"><label>Also show in</label><div class="row">${tags.map((c) => `<label class="small"><input type="checkbox" data-tag="${esc(c.id)}" ${it.tags.includes(c.id) ? 'checked' : ''}> ${esc(C.catPath(cats(), c.id))}</label>`).join('')}</div></div></div>
      <div class="field"><div class="row"><label for="edText" style="flex:1">Text</label>${S.settings.provider !== 'manual' ? '<button class="btn small" data-act="fixTyping" title="Let the AI fix the typing in this box (or only in the part you selected). You see the changes before they are used.">✨ Fix my typing</button>' : ''}</div><textarea id="edText" rows="${Math.min(24, it.text.split('\n').length + 3)}">${esc(it.text)}</textarea>
        <span class="hint">Tip: put <code>---</code> on its own line to split this into two items.</span></div>
      <div class="field"><label>Tasks</label><div id="edTasks">${tasks.map(taskRow).join('')}</div>
        <div><button class="btn small" data-act="addTaskRow">＋ Add task</button></div></div>
      <template id="taskRowTpl">${taskRow({ text: '', done: false, cat: subs[0] ? subs[0].id : 'todo' })}</template>
      <div class="actions"><button class="btn primary" data-act="saveEdit" data-id="${esc(it.id)}">Save</button><button class="btn" data-act="cancelEdit">Cancel</button></div></div>`;
  }
  function tasksPreview(it) {
    const ts = itemTasks(it.id); if (!ts.length) return '';
    return `<ul class="tasks">${ts.map((t) => `<li class="${t.done ? 'done' : ''}">☑ <span>${esc(t.text)}</span> <span class="chip">${esc(C.catPath(cats(), t.cat))}</span></li>`).join('')}</ul>`;
  }
  function prevInNote(it) {
    return S.items.filter((x) => x.noteId === it.noteId && x.order < it.order).sort((a, b) => b.order - a.order)[0];
  }
  function viewReview() {
    let list = S.items.filter((i) => i.status === 'review');
    const total = list.length;
    if (UI.flaggedOnly) list = list.filter((i) => i.flags && i.flags.length);
    list.sort((a, b) => ((noteOf(a) || {}).addedAt || 0) - ((noteOf(b) || {}).addedAt || 0) || a.order - b.order);
    if (!total) return `<div class="empty"><b>Nothing to review</b>When the AI has organized your notes, they wait here for your OK.</div>`;
    const flagged = S.items.filter((i) => i.status === 'review' && i.flags && i.flags.length).length;
    let h = `<div class="row" style="margin-bottom:14px"><span class="hint">${total} item(s) waiting. Check each one, then approve. Red = removed, green = added by the AI.</span><div style="flex:1"></div>
      <label class="small"><input type="checkbox" data-act="flaggedOnly" ${UI.flaggedOnly ? 'checked' : ''}> Only items with warnings (${flagged})</label>
      <button class="btn" data-act="approveAll">Approve all${UI.flaggedOnly ? ' shown' : ''} (${list.length})</button></div>`;
    for (const it of list) {
      if (UI.editing === it.id) { h += editorHtml(it); continue; }
      const d = diffHtml(it.original, it.text); const n = noteOf(it); const prev = prevInNote(it);
      h += `<div class="card" data-item="${esc(it.id)}">
        <div class="itemhead"><div class="grow"><h3>${esc(it.title)}</h3><div class="meta">${esc(n ? n.name : '')} · ${esc(C.fmtDate(it.createdAt))}${it.mode === 'careful' ? ' · 🧠 careful' : ''}</div></div>
          <select data-change="setCat" data-id="${esc(it.id)}" aria-label="Category">${catOptions(it.cat)}</select></div>
        <div class="row" style="margin-top:6px">${it.tags.map((t) => `<span class="chip acc">also: ${esc(C.catPath(cats(), t))}</span>`).join(' ')} ${flagChips(it)}</div>
        <div class="cmp"><div><div class="lbl">Your original</div><div class="pre">${d.left}</div></div><div><div class="lbl">Cleaned by AI</div><div class="pre">${d.right}</div></div></div>
        ${tasksPreview(it)}${thinkBox(it.thinking)}
        <div class="actions"><button class="btn primary" data-act="approve" data-id="${esc(it.id)}">✓ Approve</button>
          <button class="btn" data-act="edit" data-id="${esc(it.id)}">Edit</button>
          ${it.text !== it.original ? `<button class="btn" data-act="useOriginal" data-id="${esc(it.id)}">Use my original text</button>` : ''}
          ${prev ? `<button class="btn" data-act="mergePrev" data-id="${esc(it.id)}" title="Join with the item above from the same note">Join with previous</button>` : ''}
          ${S.settings.provider !== 'manual' ? `<span class="btngroup" role="group" aria-label="Ask AI again"><span class="lbl">Ask AI again:</span><button class="btn" data-act="rerun" data-mode="fast" data-id="${esc(it.id)}" title="Quick answer">⚡ Fast</button><button class="btn" data-act="rerun" data-mode="careful" data-id="${esc(it.id)}" title="The AI thinks first (slower)">🧠 Careful</button></span>` : ''}
          <button class="btn danger" data-act="deleteItem" data-id="${esc(it.id)}">Delete</button></div></div>`;
    }
    return h;
  }

  /* ---------- survey ---------- */
  function viewSurvey() {
    if (!S.survey) return '<div class="empty"><b>No questions right now</b>When you organize new notes, the AI may ask about words or notes it does not understand.</div>';
    const qs = S.survey.questions; const draft = S.survey.draft || {};
    return `<p class="hint">The AI found ${qs.length} thing(s) it could not understand. Your answers are saved in <b>My words &amp; rules</b> and used every time from now on. Leave a box empty to skip it.</p>
      ${qs.map((q, k) => q.kind === 'word'
    ? `<div class="q"><label for="sq${k}"><b>What does “${esc(q.term)}” mean?</b></label>
          <div class="row" style="margin-top:6px"><input type="text" id="sq${k}" data-q="${esc(q.id)}" value="${esc(draft[q.id] || '')}" style="flex:1;min-width:240px" placeholder="${esc(q.guess ? 'AI guess: ' + q.guess : 'Your meaning')}">
          ${q.guess ? `<button class="btn small" data-act="useGuess" data-k="${k}">Use the guess</button>` : ''}
          <button class="btn small" data-act="keepWord" data-k="${k}" title="Not a typo, keep it unchanged">Keep as is</button></div></div>`
    : `<div class="q"><div class="quote">“${esc(q.quote)}”</div><label for="sq${k}"><b>${esc(q.question)}</b></label>
          <div class="row" style="margin-top:6px"><input type="text" id="sq${k}" data-q="${esc(q.id)}" value="${esc(draft[q.id] || '')}" style="flex:1;min-width:240px" placeholder="${esc(q.guess ? 'AI guess: ' + q.guess : 'Your answer')}">
          ${q.guess ? `<button class="btn small" data-act="useGuess" data-k="${k}">Use the guess</button>` : ''}</div></div>`).join('')}
      ${thinkBox(S.survey.thinking, 'Show what the AI thought while reading your notes')}
      <div class="actions"><button class="btn primary" data-act="submitSurvey">Save answers and continue</button><button class="btn" data-act="skipSurvey">Skip questions</button></div>`;
  }

  /* ---------- to-do ---------- */
  function taskHtml(t) {
    const it = t.itemId ? S.items.find((i) => i.id === t.itemId) : null;
    return `<div class="todo${t.done ? ' done' : ''}"><input type="checkbox" data-act="toggleTask" data-id="${esc(t.id)}" ${t.done ? 'checked' : ''} aria-label="Done">
      <div class="tx">${esc(t.text)}${it ? `<div class="src">from: <a href="#" data-act="openItem" data-id="${esc(it.id)}">${esc(it.title)}</a></div>` : ''}</div>
      <button class="btn small link" data-act="editTask" data-id="${esc(t.id)}">Edit</button><button class="btn small link" data-act="deleteTask" data-id="${esc(t.id)}" title="Delete">✕</button></div>`;
  }
  function viewTodo() {
    const q = UI.search.toLowerCase();
    const all = C.visibleTasks(S).filter((t) => !q || t.text.toLowerCase().includes(q));
    const groups = [...C.todoSubs(cats()), cat('todo')];
    let h = `<div class="row" style="margin-bottom:14px"><span class="hint">${all.filter((t) => !t.done).length} open task(s).</span><div style="flex:1"></div>
      <label class="small"><input type="checkbox" data-act="toggleShowDone" ${UI.showDone ? 'checked' : ''}> Show done</label></div>`;
    for (const g of groups) {
      const open = all.filter((t) => t.cat === g.id && !t.done); const done = all.filter((t) => t.cat === g.id && t.done);
      if (g.id === 'todo' && !open.length && !done.length) continue;
      h += `<div class="todogroup"><h2>${esc(g.id === 'todo' ? 'Other tasks' : g.name)} <span class="chip">${open.length}</span></h2>
        ${open.map(taskHtml).join('')}${UI.showDone ? done.map(taskHtml).join('') : ''}
        <div class="row"><input type="text" placeholder="Add a task…" data-newtask="${esc(g.id)}" style="flex:1;max-width:520px"><button class="btn small" data-act="addTask" data-cat="${esc(g.id)}">Add</button></div></div>`;
    }
    const notes = S.items.filter((i) => i.status === 'approved' && i.cat === 'todo');
    if (notes.length) h += `<div class="todogroup"><h2>Notes filed under To-do</h2>${notes.map(itemCard).join('')}</div>`;
    return h;
  }

  /* ---------- category ---------- */
  function itemCard(it) {
    if (UI.editing === it.id) return editorHtml(it);
    const n = noteOf(it);
    return `<div class="card" data-item="${esc(it.id)}"><div class="itemhead"><div class="grow"><h3>${esc(it.title)}</h3>
        <div class="meta">${esc(C.fmtDate(it.createdAt))}${n ? ' · ' + esc(n.name) : ''} · ${esc(C.catPath(cats(), it.cat))}${it.tags.length ? ' · also: ' + esc(it.tags.map((t) => C.catPath(cats(), t)).join(', ')) : ''}</div></div>
        <button class="btn small" data-act="edit" data-id="${esc(it.id)}">Edit</button><button class="btn small danger" data-act="deleteItem" data-id="${esc(it.id)}">Delete</button></div>
      <div class="pre" style="margin-top:8px">${esc(it.text)}</div>${tasksPreview(it)}
      ${it.text !== it.original ? `<details style="margin-top:8px"><summary class="small">Show my original</summary><div class="pre muted" style="margin-top:6px">${esc(it.original)}</div></details>` : ''}${thinkBox(it.thinking)}</div>`;
  }
  function viewCategory(id) {
    const c = cat(id); const q = UI.search.toLowerCase();
    const kids = C.children(cats(), id);
    let items = itemsIn(id).filter((i) => !q || (i.title + ' ' + i.text).toLowerCase().includes(q)).sort((a, b) => b.createdAt - a.createdAt);
    let h = c.desc ? `<p class="hint" style="margin-top:0">${esc(c.desc)}</p>` : '';
    if (kids.length) h += `<div class="row" style="margin-bottom:14px">${kids.map((k) => `<button class="btn small" data-act="nav" data-v="cat:${esc(k.id)}">${esc(k.name)} (${itemsIn(k.id).length})</button>`).join('')}</div>`;
    const linked = C.todoSubs(cats()).filter((s) => s.area === id).map((s) => s.id);
    const tasks = C.visibleTasks(S).filter((t) => linked.includes(t.cat) && !t.done);
    if (tasks.length) h += `<p><a href="#" data-act="nav" data-v="todo">☑ ${tasks.length} open task${tasks.length > 1 ? 's' : ''} for this area ${tasks.length > 1 ? 'are' : 'is'} in To-do →</a></p>`; // one place rule
    if (!items.length) h += `<div class="empty"><b>${q ? 'No matches' : 'Nothing here yet'}</b>${q ? 'Try another search.' : 'Approved notes for this category show here.'}</div>`;
    h += items.map(itemCard).join('');
    return h;
  }

  /* ---------- words ---------- */
  function viewWords() {
    return `<div class="box"><h2>My words</h2><p class="hint">Your shortcodes, names and private words. The AI keeps them unchanged and uses the meaning to understand your notes.</p>
      <table class="words"><thead><tr><th style="width:28%">Word</th><th>Meaning</th><th style="width:40px"></th></tr></thead><tbody>
      ${S.words.map((w) => `<tr><td><input type="text" data-word="${esc(w.id)}" data-wf="term" value="${esc(w.term)}" style="width:100%"></td><td><input type="text" data-word="${esc(w.id)}" data-wf="meaning" value="${esc(w.meaning)}" style="width:100%"></td>
        <td><button class="btn small link" data-act="delWord" data-id="${esc(w.id)}" title="Delete">✕</button></td></tr>`).join('')}
      </tbody></table><div style="margin-top:10px"><button class="btn" data-act="addWord">＋ Add word</button></div></div>
      <div class="box"><h2>My rules</h2><p class="hint">Simple rules in your own words, for example: “anything about plugins or sites goes to My business”.</p>
      ${S.rules.map((r, k) => `<div class="row" style="margin-bottom:6px"><input type="text" data-rule="${k}" value="${esc(r)}" style="flex:1"><button class="btn small link" data-act="delRule" data-k="${k}" title="Delete">✕</button></div>`).join('')}
      <button class="btn" data-act="addRule">＋ Add rule</button></div>`;
  }

  /* ---------- settings ---------- */
  function sField(key, label, type = 'text', extra = '') {
    const v = S.settings[key];
    if (type === 'checkbox') return `<label><input type="checkbox" data-set="${key}" ${v ? 'checked' : ''}> ${label}</label>`;
    return `<div class="field"><label for="set-${key}">${label}</label><input type="${type}" id="set-${key}" data-set="${key}" value="${esc(v)}" ${extra}></div>`;
  }
  function viewSettings() {
    const s = S.settings; const p = s.provider;
    const radio = (v, label) => `<label style="display:block;margin-bottom:4px"><input type="radio" name="prov" data-set="provider" value="${v}" ${p === v ? 'checked' : ''}> ${label}</label>`;
    let ai = `<div class="box"><h2>AI connection</h2>${radio('ollama', '<b>Ollama</b> on this PC (private and free) — recommended')}${radio('manual', '<b>Copy &amp; paste</b> with ChatGPT or Claude (no setup; your notes leave your PC)')}${radio('openai', '<b>Other local AI</b> with an OpenAI-style API (AnythingLLM, LM Studio…)')}<hr style="border:0;border-top:1px solid var(--line);margin:12px 0">`;
    if (p === 'ollama') {
      ai += `<div class="grid2">${sField('ollamaUrl', 'Ollama address')}<div class="field"><label for="set-model">Model</label><input type="text" id="set-model" data-set="model" value="${esc(s.model)}" list="modelList"><datalist id="modelList"></datalist></div></div>
        <div class="row"><button class="btn" data-act="testConn">Test connection</button><button class="btn" data-act="testAI">Try a quick test note</button></div>
        <div id="connResult" style="margin-top:10px">${UI.connResult}</div>
        <details style="margin-top:12px"><summary>More options</summary><div class="grid2" style="margin-top:8px">${sField('numCtx', 'Context size (tokens)', 'number', 'min="2048" step="1024"')}${sField('temperature', 'Temperature (0 = strict)', 'number', 'min="0" max="1" step="0.1"')}${sField('timeoutSec', 'Time limit per request (seconds; doubled in Careful mode)', 'number', 'min="30"')}</div></details>
        <details style="margin-top:12px" ${UI.openHelp ? 'open' : ''}><summary><b>First-time Ollama setup</b></summary>${ollamaHelp()}</details>`;
    } else if (p === 'openai') {
      ai += `<div class="grid2">${sField('oaUrl', 'API address (ends before /chat/completions)')}${sField('oaModel', 'Model (for AnythingLLM: the workspace slug)')}</div>${sField('oaKey', 'API key (if needed)', 'password')}
        <div class="row"><button class="btn" data-act="testAI">Try a quick test note</button></div><div id="connResult" style="margin-top:10px">${UI.connResult}</div>
        <details style="margin-top:12px"><summary>More options</summary>${sField('timeoutSec', 'Time limit per request (seconds)', 'number', 'min="30"')}</details>`;
    } else {
      ai += `<p class="hint">Mind Desk shows you a prompt to copy into ChatGPT or Claude, and you paste the answer back. Three short rounds: split, questions, organize.</p>${sField('manualBatch', 'Notes per prompt in the organize step', 'number', 'min="1" max="100"')}`;
    }
    const warns = remoteWarning();
    if (warns.length) ai += warns.map((w) => `<div class="banner${/Copy & paste/.test(w) ? ' info' : ' bad'}" style="margin-top:12px">${esc(w)}</div>`).join('');
    ai += '</div>';
    const mode = s.provider === 'manual' ? '' : `<div class="box"><h2>Fast or Careful</h2>
      <p class="hint">Choose next to <b>✨ Organize all</b> each time. <b>⚡ Fast</b>: quick answers, no thinking. <b>🧠 Careful</b>: the AI thinks first. Slower (often 2–3 times), but better at understanding what you meant. The thinking is saved and folded away under <b>Show AI’s thinking</b>.</p>
      <p style="margin:8px 0 4px">In Careful mode, let the AI think in:</p>
      <div class="row">${sField('thinkSplit', 'Step 1: splitting notes', 'checkbox')}${sField('thinkSurvey', 'Step 2: questions', 'checkbox')}${sField('thinkOrganize', 'Step 3: organizing (typos, category, tasks)', 'checkbox')}</div>
      <div style="max-width:320px;margin-top:8px">${sField('thinkLimitSec', 'Stop thinking after (seconds) and answer in Fast mode instead', 'number', 'min="10" max="1800"')}</div>
      <p class="muted small" style="margin-top:6px">Some models cannot think. Careful mode then works like Fast mode.</p></div>`;
    const er = (v, label, hint) => `<label style="display:block;margin-bottom:6px"><input type="radio" name="editstyle" data-set="editStyle" value="${v}" ${s.editStyle === v ? 'checked' : ''}> <b>${label}</b> <span class="muted small">${hint}</span></label>`;
    const writing = `<div class="box"><h2>How much may the AI change your text?</h2>
      ${er('typos', 'Fix typos only', '— keeps your exact words and voice (recommended)')}
      ${er('clean', 'Clean up wording', '— fixes typos and makes sentences clearer; facts, numbers, names and “not” must stay')}
      <p class="muted small">Used when organizing and by <b>✨ Fix my typing</b> in the editor. Your original text is always kept.</p></div>`;
    const survey = `<div class="box"><h2>Questions before organizing</h2>${sField('survey', 'Let the AI ask me about words and notes it does not understand', 'checkbox')}<div style="max-width:220px;margin-top:8px">${sField('surveyMax', 'Maximum questions per run', 'number', 'min="1" max="20"')}</div></div>`;
    return ai + mode + writing + survey + reportBox() + catEditor() + promptEditor() + storageBox() + `<div class="box"><h2>Look</h2><div class="field" style="max-width:220px"><label for="set-theme">Theme</label>
      <select id="set-theme" data-set="theme"><option value="auto"${s.theme === 'auto' ? ' selected' : ''}>Same as Windows</option><option value="light"${s.theme === 'light' ? ' selected' : ''}>Light</option><option value="dark"${s.theme === 'dark' ? ' selected' : ''}>Dark</option></select></div></div>
      <div class="box"><h2>Danger zone</h2><button class="btn danger" data-act="deleteAll">Delete everything in Mind Desk</button><p class="muted small">Mind Desk ${esc(VERSION)}</p></div>`;
  }
  function ollamaHelp() {
    return `<ol class="steps">
      <li>If Ollama is not installed yet: download it from <b>ollama.com/download</b> (Windows), run the installer, and open <b>Ollama</b> from the Start menu.</li>
      <li>Download a model once. Press the <b>Windows key</b>, type <code>cmd</code>, press <b>Enter</b>, then type <code>ollama pull ${esc(S.settings.model || 'qwen3.5:9b')}</code> and press <b>Enter</b>. Wait for <b>success</b>.</li>
      <li>Allow Mind Desk to talk to Ollama (needed because Mind Desk is a file on your PC):<br>
        Press the <b>Windows key</b>, type <b>environment</b>, open <b>Edit environment variables for your account</b>. Under <b>User variables</b> click <b>New…</b>.<br>
        Variable name: <code>OLLAMA_ORIGINS</code> · Variable value: <code>*</code> · click <b>OK</b>, then <b>OK</b> again.</li>
      <li>Restart Ollama: right-click the llama icon near the clock → <b>Quit Ollama</b>, then open <b>Ollama</b> from the Start menu.</li>
      <li>Come back here and click <b>Test connection</b>.</li></ol>
      <p class="muted small">Note: with <code>*</code>, websites you visit could also use the AI on your PC (send it prompts, see your model list). They cannot read Mind Desk's notes or your files. You can remove the setting when you are not using Mind Desk.</p>`;
  }
  function catEditor() {
    const tops = S.categories.filter((c) => !c.parent);
    const parentOpts = (c) => {
      if (c.system || C.children(cats(), c.id).length) return '<option value="">(top level)</option>';
      return '<option value="">(top level)</option>' + tops.filter((t) => t.id !== c.id && t.id !== 'unsorted').map((t) => `<option value="${esc(t.id)}"${c.parent === t.id ? ' selected' : ''}>under ${esc(t.name)}</option>`).join('');
    };
    const row = (c, child) => {
      const isSub = c.parent === 'todo';
      return `<div class="catrow${child ? ' child' : ''}"><input type="text" class="nm" data-catf="name" data-id="${esc(c.id)}" value="${esc(c.name)}" aria-label="Name">
        <input type="text" data-catf="desc" data-id="${esc(c.id)}" value="${esc(c.desc || '')}" placeholder="What belongs here (helps the AI)" aria-label="Description">
        ${isSub ? `<select data-catf="area" data-id="${esc(c.id)}" title="Also show these tasks in"><option value="">tasks show only in To-do</option>${tops.filter((t) => t.id !== 'todo' && t.id !== 'unsorted').map((t) => `<option value="${esc(t.id)}"${c.area === t.id ? ' selected' : ''}>also show in ${esc(t.name)}</option>`).join('')}</select>`
    : `<select data-catf="parent" data-id="${esc(c.id)}" ${c.system ? 'disabled' : ''}>${parentOpts(c)}</select>`}
        <span class="row" style="gap:2px"><button class="btn small link" data-act="moveCat" data-id="${esc(c.id)}" data-d="-1" title="Move up">↑</button><button class="btn small link" data-act="moveCat" data-id="${esc(c.id)}" data-d="1" title="Move down">↓</button>
        ${c.system ? '' : `<button class="btn small link" data-act="delCat" data-id="${esc(c.id)}" title="Delete">✕</button>`}</span></div>`;
    };
    let h = '';
    for (const t of tops) { h += row(t, false); for (const k of C.children(cats(), t.id)) h += row(k, true); }
    return `<div class="box"><h2>Categories</h2><p class="hint">Rename, describe, move or add. Good descriptions help the AI choose.</p>${h}
      <div class="row" style="margin-top:12px"><input type="text" id="newCatName" placeholder="New category name"><select id="newCatParent"><option value="">(top level)</option>${tops.filter((t) => t.id !== 'unsorted').map((t) => `<option value="${esc(t.id)}">under ${esc(t.name)}</option>`).join('')}</select><button class="btn" data-act="addCat">＋ Add</button></div></div>`;
  }
  function promptEditor() {
    const names = { split: 'Step 1: split notes', survey: 'Step 2: questions', organize: 'Step 3: organize', fix: '✨ Fix my typing (editor)' };
    return `<div class="box"><h2>AI instructions (advanced)</h2><details><summary>Show and edit the prompts</summary>
      <p class="hint">Change these to tune how the AI behaves. Keep the parts in {{double braces}} and the JSON format line.</p>
      ${Object.keys(names).map((k) => `<div class="field"><label for="pr-${k}"><b>${names[k]}</b>${S.prompts[k] ? ' <span class="chip warn">edited</span>' : ''}</label>
        <textarea id="pr-${k}" data-prompt="${k}" rows="10">${esc(prompt(k))}</textarea><div><button class="btn small" data-act="resetPrompt" data-k="${k}">Reset to default</button></div></div>`).join('')}</details></div>`;
  }
  function reportBox() {
    return `<div class="box"><h2>Report for Claude</h2><p class="hint">Copies what Mind Desk shows (your notes, how the AI split and cleaned them, warnings, timings) as text, to paste into a chat with Claude when something looks wrong. You see it before copying and can hide names.</p>
      <div class="row"><button class="btn" data-act="report" data-scope="review">Report: items waiting for review</button><button class="btn" data-act="report" data-scope="all">Report: all notes</button></div></div>`;
  }
  function storageBox() {
    const can = 'showDirectoryPicker' in window && !!store.db;
    let f = '';
    if (can) {
      f = FOLDER.handle
        ? `<p>Also saving to folder <b>${esc(FOLDER.name)}</b> ${FOLDER.ok ? '<span class="chip good">connected</span>' : '<span class="chip warn">needs your OK</span>'}</p><p class="muted small">${esc(FOLDER.msg)}</p>
           <div class="row">${FOLDER.ok ? '' : '<button class="btn primary" data-act="reconnectFolder">Reconnect folder</button>'}<button class="btn" data-act="chooseFolder">Choose another folder</button><button class="btn" data-act="forgetFolder">Stop saving to folder</button></div>`
        : `<p class="hint">Optional: also keep everything as normal files in a folder you choose (organized Markdown files, your original notes, and a backup).</p><button class="btn" data-act="chooseFolder">Choose a folder…</button>`;
    } else f = '<p class="muted small">Saving to a folder needs Microsoft Edge or Google Chrome.</p>';
    return `<div class="box"><h2>Saving &amp; backup</h2><p class="hint">Everything is saved automatically in this browser on this PC${store.db ? '' : ' (simple storage mode)'}. Make a backup now and then.</p>
      ${f}<hr style="border:0;border-top:1px solid var(--line);margin:12px 0">
      <div class="row"><button class="btn" data-act="exportJSON">Download backup</button><button class="btn" data-act="importJSON">Restore from backup…</button><button class="btn" data-act="downloadMD">Download all as Markdown</button></div></div>`;
  }

  /* ================= actions ================= */
  const ACT = {
    nav(el) { if (!leaveEditor()) return; UI.view = el.dataset.v; UI.editing = null; UI.search = ''; render(); $('#content').scrollTop = 0; },
    closeModal() { closeModal(); },
    addFiles() { $('#fileInput').click(); },
    pasteNote() {
      const def = 'Pasted ' + fmtTime(Date.now());
      modal(`<h2>Paste a note</h2><div class="field"><label for="pnName">Name</label><input type="text" id="pnName" value="${esc(def)}"></div>
        <div class="field"><label for="pnText">Note</label><textarea id="pnText" rows="14" placeholder="Paste your note here (Ctrl+V)"></textarea></div>
        <div class="actions"><button class="btn primary" data-act="savePaste">Add to inbox</button><button class="btn" data-act="closeModal">Cancel</button></div>`, closeModal, '#pnText');
    },
    savePaste() {
      const r = addNote($('#pnName').value, $('#pnText').value, 'paste');
      if (r === 'dup') { toast('This note is already in your inbox.'); return; }
      if (!r) { toast('The note is empty.'); return; }
      closeModal(); UI.selNote = r.id; UI.view = 'inbox'; save(); render(); toast('Note added.');
    },
    selNote(el) { UI.selNote = el.dataset.id; renderContent(); },
    renameNote(el) { const n = S.notes.find((x) => x.id === el.dataset.id); const v = window.prompt('New name', n.name); if (v && v.trim()) { n.name = v.trim().slice(0, 120); save(); render(); } },
    deleteNote(el) {
      if (busy()) return;
      const n = S.notes.find((x) => x.id === el.dataset.id); const its = S.items.filter((i) => i.noteId === n.id);
      if (!window.confirm(`Delete “${n.name}”${its.length ? ` and the ${its.length} item(s) made from it` : ''}? This cannot be undone.`)) return;
      removeItems(its.map((i) => i.id)); S.notes = S.notes.filter((x) => x.id !== n.id); save(); render();
    },
    reorganizeNote(el) {
      if (busy()) return;
      const n = S.notes.find((x) => x.id === el.dataset.id); const its = S.items.filter((i) => i.noteId === n.id);
      if (its.length && !window.confirm(`This removes the ${its.length} item(s) made from this note (also approved ones and their tasks) and organizes the note again. Continue?`)) return;
      removeItems(its.map((i) => i.id)); n.status = 'new'; save(); render(); organizeAll([n.id]);
    },
    organizeAll() { organizeAll(); },
    organizeNote(el) { organizeAll([el.dataset.id]); },
    toggleSide() { S.settings.sidebar = S.settings.sidebar === 'hide' ? 'show' : 'hide'; applySide(); save(); paintTop(); },
    hideLive() { UI.hideLive = true; livePaint(); },
    stopRun() {
      RUN.stop = true; if (RUN.ctrl) RUN.ctrl.abort();
      if (RUN.surveyWait) RUN.surveyWait.reject(abortErr());
      if (RUN.manualReject) RUN.manualReject();
      closeModal(); toast('Stopping…');
    },
    openItem(el, e) {
      if (e) e.preventDefault();
      const it = S.items.find((i) => i.id === el.dataset.id); if (!it) return;
      if (it.status === 'pending') { toast('Not organized yet.'); return; }
      if (!leaveEditor()) return;
      UI.view = it.status === 'review' ? 'review' : 'cat:' + it.cat; UI.focus = it.id; UI.search = ''; render();
    },
    approve(el) { const it = S.items.find((i) => i.id === el.dataset.id); it.status = 'approved'; it.updatedAt = Date.now(); save(); render(); },
    approveAll() {
      let list = S.items.filter((i) => i.status === 'review'); if (UI.flaggedOnly) list = list.filter((i) => i.flags && i.flags.length);
      const warn = list.filter((i) => i.flags && i.flags.length).length;
      if (!window.confirm(`Approve ${list.length} item(s)?${warn ? `\n${warn} of them have warnings.` : ''}`)) return;
      list.forEach((i) => { i.status = 'approved'; i.updatedAt = Date.now(); }); save(); render();
    },
    edit(el) { if (UI.editing === el.dataset.id) return; if (!leaveEditor()) return; UI.editing = el.dataset.id; UI.dirty = false; UI.draft = null; renderContent(); const ed = $('#editor'); if (ed) ed.scrollIntoView({ block: 'nearest' }); },
    cancelEdit() { UI.editing = null; UI.dirty = false; UI.draft = null; renderContent(); },
    addTaskRow() { const tpl = $('#taskRowTpl'); $('#edTasks').appendChild(tpl.content.cloneNode(true)); UI.dirty = true; captureDraft(); },
    rmTaskRow(el) { el.closest('[data-taskrow]').remove(); UI.dirty = true; captureDraft(); },
    saveEdit(el) {
      const it = S.items.find((i) => i.id === el.dataset.id);
      it.title = $('#edTitle').value.trim() || it.title; it.cat = $('#edCat').value;
      it.tags = $$('[data-tag]').filter((x) => x.checked).map((x) => x.dataset.tag).filter((t) => t !== it.cat);
      const rows = $$('#edTasks [data-taskrow]').map((r) => ({ text: $('[data-tf=text]', r).value.trim(), done: $('[data-tf=done]', r).checked, cat: $('[data-tf=cat]', r).value })).filter((t) => t.text);
      const old = itemTasks(it.id);
      S.tasks = S.tasks.filter((t) => t.itemId !== it.id).concat(rows.map((t, k) => ({ id: (old[k] && old[k].id) || C.uid('t'), itemId: it.id, text: t.text, done: t.done, cat: t.cat, createdAt: it.createdAt })));
      const parts = $('#edText').value.split(/\n[ \t]*---[ \t]*\n/).map((x) => x.trim()).filter(Boolean);
      const origs = parts.length > 1 ? C.splitOriginal(it.original, parts) : [it.original];
      it.text = parts[0] || it.text; it.original = origs[0] || it.original; it.updatedAt = Date.now(); it.flags = []; it.lost = []; // you checked it yourself
      for (let k = 1; k < parts.length; k++) {
        const n = { id: C.uid('i'), noteId: it.noteId, order: it.order + k / 100, original: origs[k] || parts[k], text: parts[k], title: it.title + ` (part ${k + 1})`, cat: it.cat, tags: [...it.tags], status: it.status, flags: [], lost: [], surveyed: true, createdAt: it.createdAt, updatedAt: Date.now() };
        S.items.push(n);
      }
      if (parts.length > 1 && origs.approx) S.items.filter((x) => x.id === it.id || (x.noteId === it.noteId && x.order > it.order && x.order < it.order + 1)).forEach((x) => { if (!x.flags.includes('splitguess')) x.flags.push('splitguess'); });
      if (parts.length > 1) toast(`Split into ${parts.length} items.`);
      UI.editing = null; UI.dirty = false; UI.draft = null; save(); render();
    },
    useOriginal(el) { const it = S.items.find((i) => i.id === el.dataset.id); it.text = it.original; it.flags = it.flags.filter((f) => !['shortened', 'bigchange', 'lostword', 'notext', 'numbers', 'negation'].includes(f)); it.lost = []; save(); renderContent(); },
    mergePrev(el) {
      if (busy()) return;
      const it = S.items.find((i) => i.id === el.dataset.id); const prev = prevInNote(it); if (!prev) return;
      prev.original += '\n\n' + it.original; prev.text += '\n\n' + it.text; prev.tags = [...new Set([...prev.tags, ...it.tags])];
      prev.flags = [...new Set([...(prev.flags || []), ...(it.flags || [])])]; prev.status = prev.status === 'pending' ? 'pending' : 'review';
      S.tasks.forEach((t) => { if (t.itemId === it.id) t.itemId = prev.id; });
      S.items = S.items.filter((i) => i.id !== it.id); UI.focus = prev.id; save(); render();
    },
    async rerun(el) {
      if (RUN.active) return;
      const it = S.items.find((i) => i.id === el.dataset.id);
      RUN.active = true; RUN.stop = false; RUN.mode = el.dataset.mode === 'careful' ? 'careful' : el.dataset.mode === 'fast' ? 'fast' : S.settings.mode;
      paintTop(); setProgress(RUN.mode === 'careful' ? 'Asking AI again (careful)' : 'Asking AI again', 0, 0);
      try { await organizeOne(it); toast('Updated.'); } catch (e) { if (e.name !== 'AbortError') showError(e); } finally { RUN.active = false; UI.focus = it.id; save(); render(); }
    },
    async resurvey(el) {
      if (busy()) return;
      const it = S.items.find((i) => i.id === el.dataset.id); if (!it) return;
      RUN.active = true; RUN.stop = false; RUN.mode = S.settings.mode; paintTop(); setProgress('Reading the note for questions', 0, 0);
      try {
        const qs = await runSurvey([it]); save();
        if (it.surveyFailed) toast('The questions step failed again. You can still edit the note yourself.');
        else if (qs.length) { S.survey = { questions: qs, createdAt: Date.now() }; if (RUN.surveyThinking) S.survey.thinking = RUN.surveyThinking; UI.view = 'survey'; toast('Answer the questions, then use “Ask AI again” on the note.', 6000); } else toast('No questions this time.');
      } catch (e) { if (e.name !== 'AbortError') showError(e); } finally { RUN.active = false; save(); render(); }
    },
    async fixTyping() {
      if (busy()) return;
      const ta = $('#edText'); if (!ta) return;
      const a = ta.selectionStart, b = ta.selectionEnd; const part = a !== b;
      const text = part ? ta.value.slice(a, b) : ta.value;
      if (!text.trim()) { toast('Write something first.'); return; }
      captureDraft();
      RUN.active = true; RUN.stop = false; RUN.mode = 'fast'; paintTop(); setProgress('Fixing your typing', 0, 0);
      let fixed;
      try {
        const p = C.buildFixPrompt(prompt('fix'), text, ctx());
        const r = await aiJSON('fix', p.system, p.user, 'editor');
        fixed = String((r.data && r.data.text) || '').trim();
        if (!fixed) throw new Error('The AI gave no text back.');
      } catch (e) { if (e.name !== 'AbortError') showError(e); return; } finally { RUN.active = false; paintTop(); }
      const chk = C.checkOrganize({ title: 't', category: 'unsorted', tasks: [], text: fixed }, text, ctx());
      const warn = chk.flags.filter((f) => ['numbers', 'negation', 'lostword', 'shortened', 'bigchange'].includes(f));
      const d = diffHtml(text, fixed);
      modal(`<h2>✨ Fix my typing</h2><p class="hint">${part ? 'Only the part you selected.' : 'The whole text.'} Red = removed, green = added.</p>
        ${warn.length ? `<div class="row" style="margin-bottom:8px">${warn.map((f) => `<span class="chip ${FLAG_TEXT[f][0]}">${esc(FLAG_TEXT[f][1])}</span>`).join(' ')}</div>` : ''}
        <div class="cmp"><div><div class="lbl">You wrote</div><div class="pre">${d.left}</div></div><div><div class="lbl">Fixed</div><div class="pre">${d.right}</div></div></div>
        <div class="actions"><button class="btn primary" id="fxOk">Use the fixed text</button><button class="btn" data-act="closeModal">Keep mine</button></div>`, closeModal, '#fxOk');
      $('#fxOk').onclick = () => {
        closeModal(); const t = $('#edText'); if (!t) return;
        t.value = part ? t.value.slice(0, a) + fixed + t.value.slice(b) : fixed;
        UI.dirty = true; captureDraft(); t.focus();
      };
    },
    report(el) {
      const scope = el.dataset.id ? 'note' : el.dataset.scope || 'all';
      const ids = scope === 'note' ? [el.dataset.id] : scope === 'review' ? [...new Set(S.items.filter((i) => i.status === 'review').map((i) => i.noteId))] : null;
      if (ids && !ids.length) { toast('Nothing waiting for review.'); return; }
      const notes = S.notes.filter((n) => !ids || ids.includes(n.id));
      const cand = C.nameCandidates(notes.map((n) => n.text).join('\n'), S.words);
      modal(`<h2>📋 Report for Claude</h2>
        <p class="hint">${notes.length} note(s). This text contains your notes. Check it before you paste it anywhere.</p>
        <div class="row" style="margin-bottom:8px">
          <label class="small"><input type="checkbox" id="rpThink" checked> AI thinking</label>
          <label class="small"><input type="checkbox" id="rpSet" checked> categories, my words &amp; rules</label>
          <label class="small"><input type="checkbox" id="rpLog" checked> timings of the last AI requests</label></div>
        <div class="field"><label for="rpHide"><input type="checkbox" id="rpHideOn" ${cand.length ? 'checked' : ''}> Hide these names (replaced by Person 1, Person 2 …; edit the list, separate with commas)</label>
          <input type="text" id="rpHide" value="${esc(cand.join(', '))}" placeholder="for example: Ravi, Naveen"></div>
        <textarea id="rpText" rows="14" readonly></textarea>
        <div class="row" style="margin-top:6px"><span class="muted small" id="rpSize"></span></div>
        <div class="actions"><button class="btn primary" id="rpCopy">Copy</button><button class="btn" id="rpDl">Download .txt</button>${FOLDER.handle && FOLDER.ok ? '<button class="btn" id="rpSave">Save to my Mind Desk folder</button>' : ''}<button class="btn" data-act="closeModal">Close</button></div>`, closeModal, '#rpCopy');
      const make = () => {
        const hide = $('#rpHideOn').checked ? $('#rpHide').value.split(',').map((x) => x.trim()).filter(Boolean) : [];
        const txt = C.buildReport(S, { noteIds: ids, thinking: $('#rpThink').checked, settings: $('#rpSet').checked, prompts: $('#rpSet').checked, runLog: $('#rpLog').checked, hide, version: VERSION });
        $('#rpText').value = txt; $('#rpSize').textContent = `${txt.length.toLocaleString()} characters${txt.length > 60000 ? ' — large: Download is easier than Copy' : ''}`;
        return txt;
      };
      ['#rpThink', '#rpSet', '#rpLog', '#rpHideOn'].forEach((sel) => { $(sel).onchange = make; });
      $('#rpHide').oninput = make;
      make();
      const name = `mind-desk-report-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt`;
      $('#rpCopy').onclick = async () => { const t = make(); try { await navigator.clipboard.writeText(t); } catch (e) { $('#rpText').select(); document.execCommand('copy'); } toast('Report copied. Paste it into your chat with Claude.'); };
      $('#rpDl').onclick = () => download(name, make(), 'text/plain');
      if ($('#rpSave')) $('#rpSave').onclick = async () => {
        try { const dir = await FOLDER.handle.getDirectoryHandle('Reports', { create: true }); await writeFile(dir, name, make()); toast('Saved in your folder: Reports\\' + name, 6000); } catch (e) { showError(e); }
      };
    },
    deleteItem(el) { if (busy()) return; if (!window.confirm('Delete this item and its tasks? (Your original note stays in the Inbox.)')) return; removeItems([el.dataset.id]); save(); render(); },
    flaggedOnly(el) { UI.flaggedOnly = el.checked; renderContent(); },
    toggleTask(el) { const t = S.tasks.find((x) => x.id === el.dataset.id); t.done = el.checked; t.doneAt = t.done ? Date.now() : null; save(); render(); },
    editTask(el) { const t = S.tasks.find((x) => x.id === el.dataset.id); const v = window.prompt('Task', t.text); if (v && v.trim()) { t.text = v.trim(); save(); renderContent(); } },
    deleteTask(el) { S.tasks = S.tasks.filter((t) => t.id !== el.dataset.id); save(); render(); },
    addTask(el) {
      const inp = $(`[data-newtask="${CSS.escape(el.dataset.cat)}"]`); const v = inp.value.trim(); if (!v) return;
      S.tasks.push({ id: C.uid('t'), itemId: null, text: v, done: false, cat: el.dataset.cat, createdAt: Date.now() }); save(); render();
      const again = $(`[data-newtask="${CSS.escape(el.dataset.cat)}"]`); if (again) again.focus();
    },
    toggleShowDone(el) { UI.showDone = el.checked; renderContent(); },
    useGuess(el) { const q = S.survey.questions[+el.dataset.k]; $('#sq' + el.dataset.k).value = q.guess; draftAnswer(q.id, q.guess); },
    keepWord(el) { const q = S.survey.questions[+el.dataset.k]; $('#sq' + el.dataset.k).value = '(keep as is)'; draftAnswer(q.id, '(keep as is)'); },
    submitSurvey() {
      for (const q of S.survey.questions) {
        const v = ($(`[data-q="${CSS.escape(q.id)}"]`) || {}).value; if (!v || !v.trim()) continue;
        if (q.kind === 'word') {
          const ex = S.words.find((w) => w.term.toLowerCase() === q.term.toLowerCase());
          const meaning = v.trim() === '(keep as is)' ? '' : v.trim();
          if (ex) ex.meaning = meaning; else S.words.push({ id: C.uid('w'), term: q.term, meaning });
        } else S.rules.push(`About “${q.quote}”: ${v.trim()}`);
      }
      finishSurvey();
    },
    skipSurvey() { finishSurvey(); },
    addWord() { S.words.push({ id: C.uid('w'), term: '', meaning: '' }); save(); renderContent(); const ins = $$('[data-wf=term]'); if (ins.length) ins[ins.length - 1].focus(); },
    delWord(el) { S.words = S.words.filter((w) => w.id !== el.dataset.id); save(); render(); },
    addRule() { S.rules.push(''); save(); renderContent(); const ins = $$('[data-rule]'); if (ins.length) ins[ins.length - 1].focus(); },
    delRule(el) { S.rules.splice(+el.dataset.k, 1); save(); renderContent(); },
    async testConn() {
      const base = S.settings.ollamaUrl.replace(/\/+$/, ''); setConn('<span class="muted">Checking…</span>');
      let j;
      try { const r = await fetch(base + '/api/tags'); if (!r.ok) throw new Error(String(r.status)); j = await r.json(); } catch (e) {
        setConn(`<div class="banner bad">Could not reach Ollama at ${esc(base)}.</div>${connHelpHtml()}`); UI.openHelp = true; return;
      }
      const names = (j.models || []).map((m) => m.name);
      const dl = $('#modelList'); if (dl) dl.innerHTML = names.map((n) => `<option value="${esc(n)}">`).join('');
      const want = S.settings.model; const has = names.some((n) => n === want || n === want + ':latest' || n.replace(/:latest$/, '') === want);
      if (!names.length) setConn(`<div class="banner">Connected, but no model is installed yet. Open Command Prompt and run <code>ollama pull ${esc(want)}</code>.</div>`);
      else if (!has) setConn(`<div class="banner">Connected. The model <b>${esc(want)}</b> is not installed. Installed: ${names.map((n) => `<a href="#" data-act="pickModel" data-m="${esc(n)}">${esc(n)}</a>`).join(', ')}. Click one to use it, or run <code>ollama pull ${esc(want)}</code>.</div>`);
      else setConn(`<div class="banner info">✓ Connected to Ollama. Model <b>${esc(want)}</b> is ready.</div>`);
    },
    pickModel(el, e) { e.preventDefault(); S.settings.model = el.dataset.m; save(); UI.connResult = ''; renderContent(); ACT.testConn(); },
    async testAI() {
      if (RUN.active) return;
      setConn('<span class="muted">Sending a small test note to the AI… (the first time can take a minute while the model loads)</span>');
      const sample = 'i wnat to bulid a tool tomorow for my notes..also buy milk haha';
      const c = ctx(); const p = C.buildOrganizePrompt(prompt('organize'), sample, c); const t0 = Date.now();
      RUN.active = true; RUN.stop = false; RUN.mode = S.settings.mode;
      try {
        const a = await aiJSON('organize', p.system, p.user, 'test note'); const chk = C.checkOrganize(a.data, sample, c);
        setConn(`<div class="banner info">✓ The AI answered in ${((Date.now() - t0) / 1000).toFixed(1)} s (${RUN.mode === 'careful' ? 'Careful' : 'Fast'} mode).<br><b>Before:</b> ${esc(sample)}<br><b>After:</b> ${esc(chk.text)}<br><b>Category:</b> ${esc(C.catPath(cats(), chk.category))}${chk.tasks.length ? '<br><b>Tasks:</b> ' + esc(chk.tasks.map((x) => x.text).join(' · ')) : ''}</div>${thinkBox(a.thinking)}`);
      } catch (e) { setConn(`<div class="banner bad">${esc(e.message)}</div>${e.conn ? connHelpHtml() : ''}`); } finally { RUN.active = false; }
    },
    addCat() {
      const name = $('#newCatName').value.trim(); if (!name) { toast('Type a name first.'); return; }
      const parent = $('#newCatParent').value || null;
      const id = C.safeName(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) + '-' + Math.random().toString(36).slice(2, 6);
      S.categories.push({ id, name, parent, desc: '', area: null }); save(); render(); toast('Category added.');
    },
    delCat(el) {
      if (busy()) return;
      const c = cat(el.dataset.id); if (!c || c.system) return;
      if (C.children(cats(), c.id).length) { toast('Delete or move its subcategories first.'); return; }
      const n = S.items.filter((i) => i.cat === c.id).length; const tn = S.tasks.filter((t) => t.cat === c.id).length;
      if (!window.confirm(`Delete “${c.name}”?${n ? `\n${n} item(s) will move to Unsorted.` : ''}${tn ? `\n${tn} task(s) will move to Other tasks.` : ''}`)) return;
      S.items.forEach((i) => { if (i.cat === c.id) i.cat = 'unsorted'; i.tags = i.tags.filter((t) => t !== c.id); });
      S.tasks.forEach((t) => { if (t.cat === c.id) t.cat = 'todo'; });
      S.categories.forEach((x) => { if (x.area === c.id) x.area = null; });
      S.categories = S.categories.filter((x) => x.id !== c.id); save(); render();
    },
    moveCat(el) {
      const id = el.dataset.id; const d = +el.dataset.d; const c = cat(id);
      const sibs = S.categories.filter((x) => x.parent === c.parent); const k = sibs.indexOf(c); const other = sibs[k + d]; if (!other) return;
      const a = S.categories.indexOf(c), b = S.categories.indexOf(other); S.categories[a] = other; S.categories[b] = c; save(); render();
    },
    resetPrompt(el) { S.prompts[el.dataset.k] = null; save(); renderContent(); toast('Prompt reset.'); },
    async chooseFolder() {
      try {
        const h = await window.showDirectoryPicker({ mode: 'readwrite', id: 'mind-desk' });
        FOLDER.handle = h; FOLDER.name = h.name; FOLDER.ok = true; S.folderFiles = []; S.folderOriginals = [];
        await store.set('folder', h); save(); await syncFolder(); renderContent(); toast('Saving to folder “' + h.name + '”.');
      } catch (e) { if (e.name !== 'AbortError') showError(e); }
    },
    async reconnectFolder(el, e) {
      if (e) e.preventDefault(); if (!FOLDER.handle) return;
      try { FOLDER.ok = (await FOLDER.handle.requestPermission({ mode: 'readwrite' })) === 'granted'; } catch (err) { FOLDER.ok = false; }
      if (FOLDER.ok) await syncFolder(); render();
    },
    async forgetFolder() { FOLDER.handle = null; FOLDER.ok = false; FOLDER.name = ''; await store.del('folder'); render(); },
    exportJSON() { download(`mind-desk-backup-${today()}.json`, JSON.stringify(exportObj(), null, 1), 'application/json'); },
    importJSON() { if (busy()) return; $('#importInput').click(); },
    downloadMD() { download(`mind-desk-${today()}.md`, C.allMarkdown(S), 'text/markdown'); },
    recoveryDownload() { const r = UI.recovery; if (!r) return; const o = JSON.parse(JSON.stringify(r.state)); if (o.settings) delete o.settings.oaKey; o.app = 'mind-desk'; download(`mind-desk-unsaved-copy-${today()}.json`, JSON.stringify(o, null, 1), 'application/json'); },
    recoveryRestore() {
      if (busy()) return; const r = UI.recovery; if (!r) return;
      const o = Object.assign({ app: 'mind-desk' }, JSON.parse(JSON.stringify(r.state))); const problem = C.backupProblem(o);
      if (problem) { showError(new Error('That copy cannot be used: ' + problem)); return; }
      if (!window.confirm(`Replace everything here with the unsaved copy from ${fmtTime(r.at)}?\nChanges made here since then will be lost (download a backup first if unsure).`)) return;
      S = migrate(o); UI.recovery = null; store.del('recovery'); applyTheme(); UI.view = 'inbox'; save(); render(); paintNotice(); toast('The unsaved copy is back.');
    },
    async recoveryDismiss() { if (!window.confirm('Delete the unsaved copy from the other window? It cannot be brought back.')) return; await store.del('recovery'); UI.recovery = null; paintNotice(); },
    deleteAll() {
      if (busy()) return;
      if (!window.confirm('Delete ALL notes, items, tasks, words and settings in Mind Desk?\nMake a backup first if you are not sure.')) return;
      if (window.prompt('Type DELETE to confirm') !== 'DELETE') return;
      S = defaultState(); UI.view = 'inbox'; save(); render(); toast('Everything deleted.');
    },
  };
  function leaveEditor() {
    if (!UI.editing || !UI.dirty) return true;
    if (!window.confirm('You have changes in the editor that are not saved. Leave without saving them?')) return false;
    UI.editing = null; UI.dirty = false; UI.draft = null; return true;
  }
  function setConn(html) { UI.connResult = html; const el = $('#connResult'); if (el) el.innerHTML = html; }
  function removeItems(ids) {
    const set = new Set(ids); S.items = S.items.filter((i) => !set.has(i.id)); S.tasks = S.tasks.filter((t) => !set.has(t.itemId));
  }
  function draftAnswer(id, v) { if (!S.survey) return; S.survey.draft = Object.assign({}, S.survey.draft, { [id]: v }); save(); }
  function finishSurvey() {
    S.survey = null; save();
    if (RUN.surveyWait) { RUN.surveyWait.resolve(); UI.view = 'inbox'; } else { UI.view = 'inbox'; toast('Saved. Press “Organize all” to continue.'); }
    render();
  }
  function applySide() { const app = $('.app'); if (app) app.classList.toggle('noside', S.settings.sidebar === 'hide'); }
  function applyTheme() {
    applySide();
    const t = S.settings.theme; if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  }

  /* ================= events ================= */
  function wire() {
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]'); if (!el) return;
      const fn = ACT[el.dataset.act]; if (!fn) return;
      if (el.tagName === 'A') e.preventDefault();
      if (el.type === 'checkbox') { fn(el, e); return; }
      fn(el, e);
    });
    document.addEventListener('change', (e) => {
      const el = e.target;
      if (el.closest && el.closest('#editor')) { UI.dirty = true; captureDraft(); return; }
      if (el.dataset.set) {
        const k = el.dataset.set; let v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
        if (el.type === 'radio') v = el.value;
        S.settings[k] = v; save();
        if (k === 'provider') { UI.connResult = ''; renderContent(); }
        if (k === 'theme') applyTheme();
        if (k === 'model' || k === 'ollamaUrl' || k === 'oaUrl') { UI.connResult = ''; renderContent(); }
        return;
      }
      if (el.dataset.change === 'setCat') { const it = S.items.find((i) => i.id === el.dataset.id); it.cat = el.value; it.tags = it.tags.filter((t) => t !== it.cat); it.flags = it.flags.filter((f) => f !== 'unsorted'); save(); render(); return; }
      if (el.dataset.word) { const w = S.words.find((x) => x.id === el.dataset.word); if (w) { w[el.dataset.wf] = el.value.trim(); save(); renderSide(); } return; }
      if (el.dataset.rule !== undefined) { S.rules[+el.dataset.rule] = el.value.trim(); save(); return; }
      if (el.dataset.catf) {
        const c = cat(el.dataset.id); const f = el.dataset.catf;
        if (f === 'name') { if (el.value.trim()) c.name = el.value.trim(); else el.value = c.name; } else if (f === 'desc') c.desc = el.value.trim();
        else if (f === 'parent') { c.parent = el.value || null; } else if (f === 'area') c.area = el.value || null;
        save(); renderSide(); if (f === 'parent') renderContent(); return;
      }
      if (el.dataset.prompt) { const k = el.dataset.prompt; const v = el.value; S.prompts[k] = v.trim() && v.trim() !== C.DEFAULT_PROMPTS[k].trim() ? v : null; save(); return; }
      if (el.id === 'fileInput') { if (el.files.length) addFiles([...el.files]); el.value = ''; return; }
      if (el.id === 'importInput') { if (el.files[0]) importFile(el.files[0]); el.value = ''; }
    });
    document.addEventListener('input', (e) => {
      if (e.target.id === 'search') { UI.search = e.target.value; renderContent(); return; }
      if (e.target.dataset && e.target.dataset.q) { draftAnswer(e.target.dataset.q, e.target.value); return; }
      if (e.target.closest && e.target.closest('#editor')) { UI.dirty = true; captureDraft(); }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $('#overlay') && !$('#mpPrompt')) closeModal();
      if (e.key === 'Enter' && e.target.dataset && e.target.dataset.newtask) { const b = e.target.parentElement.querySelector('[data-act=addTask]'); if (b) b.click(); }
    });
    const drop = $('#drop'); let depth = 0;
    window.addEventListener('dragenter', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { depth++; drop.classList.add('on'); } });
    window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) drop.classList.remove('on'); });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => { e.preventDefault(); depth = 0; drop.classList.remove('on'); if (e.dataTransfer && e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]); });
    window.addEventListener('beforeunload', (e) => { if (RUN.active || saveState === 'saving' || UI.dirty) { e.preventDefault(); e.returnValue = ''; } });
  }
  const CONNECTION = ['provider', 'ollamaUrl', 'model', 'numCtx', 'temperature', 'timeoutSec', 'oaUrl', 'oaKey', 'oaModel'];
  async function importFile(f) {
    try {
      let o;
      try { o = JSON.parse(await f.text()); } catch (e) { throw new Error('This file is not a Mind Desk backup (it cannot be read).'); }
      const problem = C.backupProblem(o);
      if (problem) throw new Error('This backup cannot be restored. Nothing was changed.\n\n' + problem);
      if (RUN.active) throw new Error('Please wait until the AI run has finished.');
      if (!window.confirm(`Restore this backup from ${o.exportedAt ? fmtTime(o.exportedAt) : 'an unknown date'}?\nIt REPLACES everything in Mind Desk now (${o.notes.length} notes, ${o.items.length} items).\nYour AI connection settings on this PC stay as they are.`)) return;
      const keep = {}; for (const k of CONNECTION) keep[k] = S.settings[k];
      const next = migrate(o); Object.assign(next.settings, keep);
      delete next.exportedAt; delete next.version; next.folderFiles = []; next.folderOriginals = [];
      S = next; applyTheme(); UI.view = 'inbox'; UI.editing = null; save(); render(); toast('Backup restored.');
    } catch (e) { showError(e); }
  }

  /* ================= start ================= */
  function screen(html, attr) {
    const old = $('#blocker'); if (old) old.remove();
    const o = document.createElement('div'); o.className = 'overlay'; o.id = 'blocker'; o.setAttribute(attr, '');
    o.innerHTML = `<div class="modal" role="alertdialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(o); const app = $('.app'); if (app) app.inert = true;
    return o;
  }
  function fatal(title, msg) {
    screen(`<h2>${esc(title)}</h2><p class="pre">${esc(msg)}</p><p class="hint">Your notes have not been touched. Close other Mind Desk windows, then try again. If this keeps happening, restart the browser or the PC.</p>
      <div class="actions"><button class="btn primary" onclick="location.reload()">Try again</button></div>`, 'data-fatal');
  }
  /** another window is in charge (or saved newer data): stop writing, offer to take over */
  function blockWindow(reason) {
    const unsaved = LIFE.ok && S && (saveState !== 'saved' || UI.dirty);
    LIFE.blocked = true; clearTimeout(saveTimer); clearTimeout(folderTimer);
    if (unsaved) { // keep this window's work where the other window can find it (separate from the main data)
      store.set('recovery', { at: Date.now(), state: JSON.parse(JSON.stringify(S)) }).catch(() => {});
    }
    RUN.stop = true; if (RUN.ctrl) RUN.ctrl.abort(); if (RUN.manualReject) RUN.manualReject(); if (RUN.surveyWait) RUN.surveyWait.reject(abortErr());
    const text = reason === 'changed'
      ? 'Your notes were changed in another Mind Desk window. To avoid overwriting them, this window stopped saving.'
      : 'Mind Desk is open in another window or tab. Only one window can work at a time, so nothing gets overwritten.';
    const o = screen(`<h2>Mind Desk is open somewhere else</h2><p>${text}</p>
      ${unsaved ? '<p class="banner">This window had changes that were not saved yet. A copy was kept: the other window offers it, or download it here.</p>' : ''}
      <div class="actions"><button class="btn primary" id="takeOver">Use Mind Desk here</button>${S ? '<button class="btn" id="dlCopy">Download this window’s copy</button>' : ''}</div>
      <p class="muted small">The other window will then stop and show this message.</p>`, 'data-blocked');
    $('#takeOver', o).onclick = takeOver;
    if ($('#dlCopy', o)) $('#dlCopy', o).onclick = () => download(`mind-desk-window-copy-${today()}.json`, JSON.stringify(exportObj(), null, 1), 'application/json');
  }
  function tryLock(steal) {
    if (!navigator.locks || typeof navigator.locks.request !== 'function') { LIFE.noLock = true; return Promise.resolve(true); }
    return new Promise((resolve) => {
      let held = false;
      let req;
      try {
        req = navigator.locks.request('mind-desk-window', steal ? { steal: true } : { ifAvailable: true }, (lock) => {
          if (!lock) { resolve(false); return null; }
          held = true; LIFE.noLock = false; resolve(true); return new Promise(() => {}); // hold the lock while this window is open
        });
      } catch (e) { req = Promise.reject(e); }
      Promise.resolve(req).catch(() => {
        if (held) { if (!LIFE.blocked) blockWindow('other'); return; } // another window took over
        LIFE.noLock = true; resolve(true); // the lock feature failed: carry on, the save check still protects the data
      });
    });
  }
  /** a copy kept by a window that lost control with unsaved changes */
  async function checkRecovery() {
    if (!LIFE.ok || LIFE.blocked) return;
    let rec; try { rec = await store.get('recovery'); } catch (e) { return; }
    UI.recovery = rec && rec.state ? rec : null; paintNotice();
  }
  function paintNotice() {
    const el = $('#notice'); if (!el) return;
    const r = UI.recovery;
    el.innerHTML = r ? `<div class="banner" style="margin:12px 20px 0">Another Mind Desk window had changes that were not saved (copy from ${esc(fmtTime(r.at))}: ${r.state.notes.length} notes, ${r.state.items.length} items).
      <div class="row" style="margin-top:6px"><button class="btn small" data-act="recoveryDownload">Download that copy</button><button class="btn small" data-act="recoveryRestore">Use that copy instead</button><button class="btn small" data-act="recoveryDismiss">Delete that copy</button></div></div>` : '';
  }
  async function takeOver() {
    await tryLock(true);
    const b = $('#blocker'); if (b) b.remove(); const app = $('.app'); if (app) app.inert = false;
    LIFE.blocked = false;
    if (!wired) { wire(); wired = true; }
    if (await loadState()) { await initFolder(); paintSaveState(); }
  }
  async function loadState() {
    let raw;
    try { raw = await store.get('state'); } catch (e) { LIFE.ok = false; fatal('Could not read your saved notes', 'The browser storage did not answer (' + ((e && e.message) || e) + ').'); return false; }
    S = migrate(raw); LIFE.rev = (raw && raw.rev) || 0; LIFE.ok = true; RUN.stop = false;
    UI.editing = null; UI.dirty = false; UI.draft = null;
    applyTheme(); render(); checkRecovery();
    if (S.survey) toast('The AI has questions for you. Open “Questions for you”.', 5000);
    return true;
  }
  let wired = false;
  async function start() {
    window.MD = { get state() { return S; }, ACT, organizeAll, render, save, store, RUN, UI, FOLDER, LIFE, syncFolder, VERSION };
    await store.open();
    if (store.failed) { fatal('Could not open your saved notes', 'The browser storage could not be opened (' + store.failed + ').'); return; }
    if (!(await tryLock(false))) { blockWindow('other'); return; }
    if (!wired) { wire(); wired = true; }
    if (!(await loadState())) return;
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    await initFolder(); paintSaveState();
    window.addEventListener('focus', checkRecovery);
  }
  start();
})();
