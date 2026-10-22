/* Mind Desk cloud platform (only in the cloud build, served by server/server.js).
   - storage: your server (one state with a revision number; a save with an old revision is refused)
   - quick captures from the phone page wait on the server and are pulled into the Inbox here
   - AI with your own API key (Claude or ChatGPT): requests go through the server, which holds the key and counts the cost */
(() => {
  'use strict';
  const P = {
    mode: 'server', reason: '', session: Date.now().toString(36) + Math.random().toString(36).slice(2, 10),
    onRemoteChange: null, onCaptures: null, knownRev: () => 0, downloads: null, sample: null, pollTimer: null, account: null,
  };
  const H = { 'Content-Type': 'application/json', 'X-MD': '1' };
  /** call the server; a lost login sends the person to the login page */
  async function api(method, url, body, opts = {}) {
    const r = await fetch(url, { method, headers: Object.assign({ 'X-MD-Session': P.session }, H), body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', signal: opts.signal });
    if (r.status === 401) { location.href = '/login'; throw new Error('Your login has ended. Please log in again.'); }
    if (opts.raw) return r;
    const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { /* not JSON */ }
    if (!r.ok) { const e = new Error((j && j.error) || ('The server answered ' + r.status)); e.status = r.status; e.body = j; throw e; }
    return j;
  }
  P.api = api;

  P.init = async function init() {
    try { P.account = await api('GET', '/api/me'); } catch (e) { P.reason = e.message; }
  };

  /** check every 20 s (and when the window gets focus) for a newer save from another device and for new quick captures */
  P.startPolling = function startPolling() {
    if (P.pollTimer) return;
    const tick = async () => {
      try {
        const s = await api('GET', '/api/status');
        if (s.rev > P.knownRev() && s.session !== P.session && P.onRemoteChange) P.onRemoteChange();
        if (s.captures > 0 && P.onCaptures) P.onCaptures();
      } catch (e) { /* offline for a moment: try again later */ }
    };
    P.pollTimer = setInterval(tick, 20000);
    window.addEventListener('focus', tick);
    setTimeout(tick, 1500);
  };
  P.takeCaptures = () => api('GET', '/api/captures');
  P.ackCaptures = (ids) => api('POST', '/api/captures/ack', { ids });

  const serverStore = {
    db: null, failed: '',
    async open() { /* nothing to open */ },
    async get(k) {
      if (k === 'state') { const r = await api('GET', '/api/state'); return r && r.state ? Object.assign(r.state, { rev: r.rev }) : undefined; }
      if (k === 'folder') return undefined;
      const r = await api('GET', '/api/kv/' + encodeURIComponent(k)); return r ? r.value : undefined;
    },
    async set(k, v) { if (k === 'folder') return; await api('PUT', '/api/kv/' + encodeURIComponent(k), { value: v }); },
    async del(k) { await api('DELETE', '/api/kv/' + encodeURIComponent(k)); },
    /** save only if nobody saved a newer version since this page loaded it */
    async putState(state, rev) {
      try { await api('PUT', '/api/state', { state, rev }); return true; } catch (e) { if (e.status === 409) return false; throw e; }
    },
  };
  P.makeStore = () => serverStore;

  /* ---------- AI through the server (API key never reaches the browser) ---------- */
  /** streams the answer; resolves {text, model, cost, truncated}; rejects with {code, message} */
  P.aiChat = async function aiChat(prompt, opts) {
    const r = await api('POST', '/api/ai', { prompt, vendor: opts.vendor, model: opts.model, careful: !!opts.careful }, { raw: true, signal: opts.signal });
    if (!r.ok) {
      let j = null; try { j = await r.json(); } catch (e) { /* ignore */ }
      throw { code: (j && j.code) || 'server_error', message: (j && j.error) || ('The server answered ' + r.status) };
    }
    const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = ''; let text = ''; let end = null;
    const eat = (line) => {
      if (!line.trim()) return; let o; try { o = JSON.parse(line); } catch (e) { return; }
      if (o.t) { text += o.t; if (opts.onText) opts.onText(text); }
      if (o.error) end = { error: o };
      if (o.done) end = o;
    };
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf('\n')) >= 0) { eat(buf.slice(0, i)); buf = buf.slice(i + 1); }
    }
    eat(buf);
    if (!end) throw { code: 'upstream_error', message: 'The answer stopped before it was complete.', text };
    if (end.error) throw { code: end.error.code || 'upstream_error', message: end.error.error || 'The AI service reported an error.', text };
    return { text, model: end.model, cost: end.cost, truncated: !!end.truncated, month: end.month };
  };
  P.aiSettings = () => api('GET', '/api/ai/settings');
  P.saveAiSettings = (o) => api('PUT', '/api/ai/settings', o);
  P.logout = () => api('POST', '/api/logout', {});
  P.changePassword = (o) => api('POST', '/api/password', o);
  P.backupNow = (why) => api('POST', '/api/backup-now', { why });
  window.MDCloud = P;
})();
