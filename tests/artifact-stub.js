// Stand-in for claude.ai's artifact runtime (window.claude), used by tests/artifact-tests.js.
// Runs in the page before Mind Desk. Settings come from window.__cfg (set by the test):
//   { db: true|false, user: 'uid'|null, sample: true|false, downloads: true|false, dbData: {path: doc}, delay: ms }
// Records: window.__calls (sample calls), window.__saves (downloads), window.__dialogs (native dialogs: must stay empty).
(() => {
  const cfg = Object.assign({ db: true, user: 'u-owner', sample: true, downloads: true, dbData: {}, delay: 0 }, window.__cfg || {});
  window.__calls = []; window.__saves = []; window.__dialogs = [];
  // artifacts cannot show the browser's dialogs; Mind Desk must never call them in the artifact
  window.confirm = (m) => { window.__dialogs.push(['confirm', m]); return false; };
  window.prompt = (m) => { window.__dialogs.push(['prompt', m]); return null; };
  window.alert = (m) => { window.__dialogs.push(['alert', m]); };
  const tick = (ms = 1) => new Promise((r) => setTimeout(r, ms));
  const clone = (x) => JSON.parse(JSON.stringify(x));

  /* ---------- db: an in-memory document store with the artifact db's rules that matter here ---------- */
  const SEG = /^[A-Za-z0-9_.~:@+-]+$/;
  const checkPath = (p, even) => {
    const segs = p.split('/');
    if (segs.some((s) => !SEG.test(s) || s === '.' || s === '..')) throw new TypeError('bad path segment in ' + p);
    if ((segs.length % 2 === 0) !== even) throw new TypeError('wrong segment count for ' + p);
  };
  const store = new Map(Object.entries(cfg.dbData || {}));
  window.__db = { store, writes: 0, dump: () => Object.fromEntries(store), sizes: () => [...store.entries()].map(([k, v]) => [k, new TextEncoder().encode(JSON.stringify(v)).length]) };
  const listeners = new Map();
  const snap = (path, pending) => ({ id: path.split('/').pop(), exists: store.has(path), data: () => (store.has(path) ? clone(store.get(path)) : undefined), metadata: { fromCache: false, hasPendingWrites: !!pending } });
  const notify = (path, pending) => (listeners.get(path) || []).forEach((fn) => setTimeout(() => fn(snap(path, pending)), 5));
  // a write from "another device": same store, no pending flag
  window.__db.remote = (path, data) => { store.set(path, clone(data)); notify(path, false); };
  const docRef = (path) => {
    checkPath(path, true);
    return {
      id: path.split('/').pop(), path,
      async get() { await tick(); return snap(path); },
      async set(d) {
        await tick();
        if (!d || typeof d !== 'object' || Array.isArray(d)) throw { code: 'invalid_argument', message: 'body must be an object' };
        if (new TextEncoder().encode(JSON.stringify(d)).length > 262144) throw { code: 'invalid_argument', message: 'document over 256 KiB' };
        if (cfg.failWrites) throw { code: 'unavailable', message: 'stub: writes fail' };
        store.set(path, clone(d)); window.__db.writes++; notify(path, false);
      },
      async update(d) { if (!store.has(path)) throw { code: 'invalid_argument' }; store.set(path, Object.assign(clone(store.get(path)), clone(d))); notify(path); },
      async delete() { await tick(); store.delete(path); notify(path); },
      onSnapshot(next) { const l = listeners.get(path) || []; l.push(next); listeners.set(path, l); setTimeout(() => next(snap(path)), 5); return () => listeners.set(path, (listeners.get(path) || []).filter((f) => f !== next)); },
      collection: (sub) => colRef(path + '/' + sub),
    };
  };
  const colRef = (path) => {
    checkPath(path, false);
    const list = (n) => [...store.keys()].filter((k) => k.startsWith(path + '/') && !k.slice(path.length + 1).includes('/')).sort().slice(0, n).map((k) => snap(k));
    const q = (n) => ({ async get() { await tick(); const docs = list(n); return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: {} }; }, limit: (m) => q(Math.min(m, n)) });
    return Object.assign(q(1e9), { path, doc: (id) => docRef(path + '/' + (id || Math.random().toString(36).slice(2))) });
  };
  const db = { doc: docRef, collection: colRef };

  /* ---------- sample: answers like Claude would, from the prompt's own format line ---------- */
  const sections = (s) => { const out = []; const re = /=== NOTE (\S+) ===\n([\s\S]*?)(?=\n=== NOTE |$)/g; let m; while ((m = re.exec(s))) out.push({ id: m[1], body: m[2] }); return out; };
  const fix = (t) => t.replace(/\bteh\b/g, 'the').replace(/\bmov eon\b/g, 'move on').replace(/\bthinkign\b/g, 'thinking').replace(/\bmeetign\b/g, 'meeting').replace(/\buniver(s)\b/g, 'universe').replace(/\bwnat\b/g, 'want').replace(/\bbulid\b/g, 'build').replace(/\btomorow\b/g, 'tomorrow');
  const between = (s, a, b) => { const i = s.indexOf(a); if (i < 0) return ''; const j = s.indexOf(b, i + a.length); return s.slice(i + a.length, j < 0 ? undefined : j); };
  function organize(text) {
    const t = text.trim(); const lower = t.toLowerCase();
    const category = /buy|milk|shirt|clean/.test(lower) ? 'todo' : /ceo|owner|powerpoint|meeting|ravi/.test(lower) ? 'job' : /fear|mind|univers|trust/.test(lower) ? 'mind' : /gym/.test(lower) ? 'personal' : 'unsorted';
    const tasks = [];
    if (/buy milk/.test(lower)) tasks.push({ text: 'Buy milk and eggs', done: false, category: 'todo-shopping' });
    if (/clean white shirt/.test(lower)) tasks.push({ text: 'Clean white shirt', done: /\(done\)/.test(lower), category: 'todo-chores' });
    if (/powerpoint/.test(lower)) tasks.push({ text: 'Make PowerPoint for owner', done: false, category: 'todo-job' });
    let out = fix(t);
    if (window.__changeNumbers && /\d/.test(out)) out = out.replace(/\d+/, (n) => String(+n + 1)); // a wrong answer: a number changed
    return { title: fix(t).split(/\s+/).slice(0, 5).join(' ').replace(/[:.]+$/, ''), category, tasks, text: out };
  }
  function answer(input) {
    const s = typeof input === 'string' ? input : input.map((m) => m.content).join('\n');
    if (s.includes('{"notes":[{"id":"note id","starts"')) {
      return JSON.stringify({ notes: sections(s).map((n) => {
        const starts = []; const re = /^\[(\d+)\]( \(same paragraph\))?$/gm; let m;
        while ((m = re.exec(n.body))) if (!m[2]) starts.push(+m[1]);
        return { id: n.id, starts };
      }) });
    }
    if (s.includes('{"questions":[')) {
      const notes = between(s, 'Notes:\n<<<\n', '\n>>>'); const known = between(s, 'Already explained words:', '\n');
      return JSON.stringify({ questions: /\bIGS\b/.test(notes) && !/IGS =/.test(known) ? [{ kind: 'word', term: 'IGS', guess: 'Instagram stories' }] : [] });
    }
    if (s.includes('{"results":[{"id":"note id"')) {
      return 'Here you go:\n```json\n' + JSON.stringify({ results: sections(s).map((n) => Object.assign({ id: n.id }, organize(between(n.body, '<<<\n', '\n>>>')))) }) + '\n```';
    }
    if (s.includes('Answer only with JSON: {"title":""')) return JSON.stringify(organize(between(s, 'Note:\n<<<\n', '\n>>>')));
    if (s.includes('Answer only with JSON: {"text":""}')) return JSON.stringify({ text: fix(between(s, 'Text:\n<<<\n', '\n>>>')) });
    if (s.includes('Answer only with JSON: {"reply":""')) {
      const msg = s.slice(s.lastIndexOf('\n') + 1);
      const item = (s.match(/\[\[item:([A-Za-z0-9_-]+)\]\]|item ([A-Za-z0-9_-]+):|id[=:] ?"?(i[A-Za-z0-9_-]+)/) || []);
      return JSON.stringify({ reply: 'Here is what I found about your notes.\nThey look fine to me.', actions: window.__chatActions || [], remember: /remember/i.test(s.slice(-400)) ? ['BR is my client, not my own business'] : [] , _msg: msg, _item: item[1] || null });
    }
    return 'I am not sure what you want.';
  }
  function sample(input, opts = {}) {
    const call = { input: typeof input === 'string' ? input : JSON.stringify(input), tier: opts.modelTier || 'default', model: opts.model, effort: opts.effort, cache: opts.cache, t: Date.now() };
    // a named model answers only if this viewer's plan has it (cfg.models); otherwise the tier answers and modelApplied is absent
    const models = (window.__cfg && window.__cfg.models) || ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'];
    const applied = opts.model && models.includes(opts.model) ? opts.model : undefined;
    window.__calls.push(call);
    return new Promise((resolve, reject) => {
      const sig = opts.signal;
      if (sig && sig.aborted) { reject({ code: 'cancelled', message: 'aborted' }); return; }
      let done = false; const timers = [];
      const finish = (fn) => { if (done) return; done = true; timers.forEach(clearTimeout); fn(); };
      if (sig) sig.addEventListener('abort', () => finish(() => reject({ code: 'cancelled', message: 'aborted' })));
      const ov = window.__sampleOverride && window.__sampleOverride(call, window.__calls.length);
      if (ov && ov.hang) return; // never answers (until Stop)
      if (ov && ov.error) { timers.push(setTimeout(() => finish(() => reject(Object.assign({ message: 'stub error' }, ov.error))), 10)); return; }
      const text = ov && typeof ov.text === 'string' ? ov.text : answer(input);
      call.answer = text;
      const n = 3; const step = Math.ceil(text.length / n); const d = (window.__cfg && window.__cfg.delay) || 20;
      for (let k = 1; k <= n; k++) timers.push(setTimeout(() => { if (!done && opts.onText) opts.onText({ text: text.slice(0, k * step), delta: text.slice((k - 1) * step, k * step) }); }, d * k));
      timers.push(setTimeout(() => finish(() => resolve(Object.assign({ text, truncated: !!(ov && ov.truncated), modelTierApplied: opts.modelTier || 'default' }, applied ? { modelApplied: applied } : {}))), d * (n + 1)));
    });
  }
  sample.json = async (input, opts) => JSON.parse((await sample(input, opts)).text);
  sample.limits = async () => ({ maxPromptBytes: 262144 });

  const user = { id: async () => cfg.user, isOwner: async () => true, canEdit: async () => true, can: async () => true, me: async () => ({ id: cfg.user, name: '' }) };
  const downloads = { save: async (req) => { window.__saves.push({ filename: req.filename, data: String(req.data) }); if (window.__declineSave) throw { code: 'declined', message: 'no' }; return { status: 'saved' }; } };
  const caps = { db: cfg.db ? db : null, user: cfg.user ? user : null, sample: cfg.sample ? sample : null, downloads: cfg.downloads ? downloads : null };
  window.claude = { use: (name) => new Promise((r) => setTimeout(() => r(name in caps ? caps[name] : null), 15)) };
})();
