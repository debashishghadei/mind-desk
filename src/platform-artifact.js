/* Mind Desk artifact platform (only in mind-desk-artifact.html).
   - storage: the artifact's database, in the viewer's private subtree data/users/<id> (only that viewer can read it)
   - Claude: the "sample" capability (the viewer's own Claude plan)
   - files: the "downloads" capability (the viewer confirms each file)
   Each capability may be missing (signed out, preview, old app): Mind Desk then falls back and says so. */
(() => {
  'use strict';
  const P = {
    mode: 'memory', reason: '', db: null, uid: null, sample: null, downloads: null, user: null,
    session: Date.now().toString(36) + Math.random().toString(36).slice(2, 10), // this page load
    onRemoteChange: null, knownRev: () => 0, unsub: null,
  };

  function use(name) {
    try {
      if (!window.claude || typeof window.claude.use !== 'function') return Promise.resolve(null);
      return Promise.resolve(window.claude.use(name)).catch(() => null);
    } catch (e) { return Promise.resolve(null); }
  }

  /** ask claude.ai for everything at once (each answer can take until the viewer is ready; null after ~10 s outside a viewer) */
  P.init = async function init() {
    const [db, user, sample, downloads] = await Promise.all(['db', 'user', 'sample', 'downloads'].map(use));
    P.sample = sample; P.downloads = downloads; P.user = user;
    let uid = null;
    if (db && user) { try { uid = await user.id(); } catch (e) { uid = null; } }
    if (db && uid) {
      try { db.collection('data/users/' + uid); P.db = db; P.uid = String(uid); P.mode = 'db'; return; } catch (e) { P.reason = 'your account id cannot be used for storage'; }
    } else P.reason = !db ? 'the artifact storage is not available in this view' : 'you are not signed in to claude.ai';
    P.mode = 'local';
  };

  /* ---------- the database: records split into documents of at most ~60,000 characters ---------- */
  const PART = 60000; // a document may hold 256 KiB; 60,000 characters stay under that even for Hindi/Odia text (3 bytes each)
  const col = () => P.db.collection('data/users/' + P.uid);
  const docId = (key, i) => 'k.' + String(key).replace(/[^A-Za-z0-9_.~:@+-]/g, '_') + (i ? '+' + i : '');
  const parts = {}; // key -> number of documents it has in the database (to delete leftovers)
  const last = {};  // key -> text last written (only changed records are written again)
  let lastMetaRev = 0;

  async function writeRecord(key, str, extra) {
    const n = Math.max(1, Math.ceil(str.length / PART));
    const rev = (extra && extra.rev) || 0;
    // write the extra parts first and part 0 (which says how many parts there are) last
    for (let i = n - 1; i >= 0; i--) await col().doc(docId(key, i)).set(Object.assign({ k: key, i, n, rev, s: str.slice(i * PART, (i + 1) * PART) }, i === 0 ? extra || {} : {}));
    for (let i = n; i < (parts[key] || 0); i++) await col().doc(docId(key, i)).delete();
    parts[key] = n; last[key] = str;
  }
  async function deleteRecord(key) {
    for (let i = (parts[key] || 1) - 1; i >= 0; i--) await col().doc(docId(key, i)).delete();
    delete parts[key]; delete last[key];
  }
  /** read every document once and join the parts: key -> text (or an error) */
  async function readAll() {
    const snap = await col().limit(1000).get();
    if (snap.size >= 1000) throw new Error('Mind Desk has too many records to read safely (1,000 or more).');
    const by = {};
    for (const d of snap.docs) { const v = d.data(); if (!v || typeof v.k !== 'string') continue; (by[v.k] = by[v.k] || []).push(v); }
    const out = {};
    for (const key of Object.keys(by)) {
      const list = by[key]; const p0 = list.find((x) => x.i === 0);
      parts[key] = Math.max(...list.map((x) => (x.i || 0) + 1));
      if (!p0) { out[key] = { error: 'its first part is missing' }; continue; }
      let str = ''; let ok = true;
      for (let i = 0; i < p0.n; i++) { const x = list.find((y) => y.i === i && y.rev === p0.rev); if (!x) { ok = false; break; } str += x.s || ''; }
      out[key] = ok ? { str, head: p0 } : { error: 'some of its parts are missing' };
    }
    return out;
  }
  async function readOne(key) {
    const d0 = await col().doc(docId(key, 0)).get(); if (!d0.exists) return undefined;
    const p0 = d0.data(); let str = p0.s || '';
    for (let i = 1; i < p0.n; i++) { const d = await col().doc(docId(key, i)).get(); if (!d.exists || d.data().rev !== p0.rev) return undefined; str += d.data().s || ''; }
    parts[key] = p0.n; return JSON.parse(str);
  }

  /** the state as records: meta (settings, categories, words, memory, …), one per note (with its items and tasks), one per chat */
  function toRecords(state) {
    const rec = {};
    const noteOfItem = {}; const itemsBy = {}; const tasksBy = {}; const looseTasks = [];
    for (const it of state.items || []) { noteOfItem[it.id] = it.noteId; (itemsBy[it.noteId] = itemsBy[it.noteId] || []).push(it); }
    const noteIds = new Set((state.notes || []).map((n) => n.id));
    for (const t of state.tasks || []) { const nid = t.itemId && noteOfItem[t.itemId]; if (nid && noteIds.has(nid)) (tasksBy[nid] = tasksBy[nid] || []).push(t); else looseTasks.push(t); }
    const orphanItems = (state.items || []).filter((it) => !noteIds.has(it.noteId));
    const order = [];
    for (const n of state.notes || []) { const key = 'note:' + n.id; order.push(key); rec[key] = JSON.stringify({ note: n, items: itemsBy[n.id] || [], tasks: tasksBy[n.id] || [] }); }
    rec.loose = JSON.stringify({ tasks: looseTasks, items: orphanItems }); order.push('loose');
    for (const c of state.chats || []) { const key = 'chat:' + c.id; order.push(key); rec[key] = JSON.stringify(c); }
    const meta = Object.assign({}, state); delete meta.notes; delete meta.items; delete meta.tasks; delete meta.chats;
    meta.keys = order;
    return { rec, meta };
  }
  function fromRecords(all) {
    const m = all.meta; if (!m) return undefined;
    if (m.error) throw new Error('Your saved settings could not be read (' + m.error + ').');
    const meta = JSON.parse(m.str);
    const state = Object.assign({}, meta, { notes: [], items: [], tasks: [], chats: [] }); delete state.keys;
    const missing = [];
    for (const key of meta.keys || []) {
      const r = all[key]; if (!r || r.error) { missing.push(key); continue; }
      const v = JSON.parse(r.str); last[key] = r.str;
      if (key.startsWith('note:')) { state.notes.push(v.note); state.items.push(...(v.items || [])); state.tasks.push(...(v.tasks || [])); }
      else if (key === 'loose') { state.tasks.push(...(v.tasks || [])); state.items.push(...(v.items || [])); }
      else if (key.startsWith('chat:')) state.chats.push(v);
    }
    if (missing.length) throw new Error(missing.length + ' saved record(s) could not be read (' + missing.slice(0, 3).join(', ') + '). Nothing was changed. Try again in a moment.');
    last.meta = m.str; lastMetaRev = state.rev || 0;
    return state;
  }

  function watchMeta() {
    if (P.unsub) return;
    try {
      P.unsub = col().doc(docId('meta', 0)).onSnapshot((snap) => {
        if (!snap.exists || (snap.metadata && snap.metadata.hasPendingWrites)) return;
        const d = snap.data() || {};
        if (d.session && d.session !== P.session && (d.rev || 0) > P.knownRev() && P.onRemoteChange) P.onRemoteChange();
      }, () => { P.unsub = null; });
    } catch (e) { P.unsub = null; }
  }

  const dbStore = {
    db: true, failed: '',
    async open() { /* nothing to open */ },
    async get(k) {
      if (k === 'state') { const s = fromRecords(await readAll()); watchMeta(); return s; }
      if (k === 'folder') return undefined;
      return readOne(k);
    },
    async set(k, v) { if (k === 'folder') return; await writeRecord(k, JSON.stringify(v), { rev: Date.now() }); },
    async del(k) { const d0 = await col().doc(docId(k, 0)).get(); if (d0.exists) parts[k] = d0.data().n || 1; await deleteRecord(k); },
    /** save only if nobody saved a newer version since this page loaded it (other device, other tab) */
    async putState(state, rev) {
      const cur = await col().doc(docId('meta', 0)).get();
      if (cur.exists && (cur.data().rev || 0) > rev) return false;
      const { rec, meta } = toRecords(state);
      for (const key of Object.keys(rec)) if (rec[key] !== last[key]) await writeRecord(key, rec[key], { rev: state.rev || 0 });
      await writeRecord('meta', JSON.stringify(meta), { rev: state.rev || 0, session: P.session, savedAt: Date.now() });
      lastMetaRev = state.rev || 0;
      for (const key of Object.keys(parts)) if (key !== 'meta' && key !== 'recovery' && !(key in rec)) await deleteRecord(key); // deleted notes and chats
      return true;
    },
  };

  /** storage for app.js: the database when there is one, otherwise this browser's storage (IndexedDB) */
  P.makeStore = function makeStore(local) {
    return new Proxy({}, {
      get(_, prop) {
        const s = P.mode === 'db' ? dbStore : local;
        const v = s[prop];
        return typeof v === 'function' ? v.bind(s) : v;
      },
      set(_, prop, value) { (P.mode === 'db' ? dbStore : local)[prop] = value; return true; },
    });
  };
  P._test = { toRecords, fromRecords, PART, docId };
  window.MDArtifact = P;
})();
