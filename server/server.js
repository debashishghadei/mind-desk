#!/usr/bin/env node
'use strict';
/*
 * Mind Desk cloud server. No outside packages: Node.js 18 or newer only.
 *   npm start            (or: node server.js)
 * Settings (environment variables):
 *   PORT=3000                 where it listens (hosting panels usually set this)
 *   MD_DATA_DIR=./data        where your notes, login and backups are kept (keep it outside the app folder on a server)
 *   MD_TRUST_PROXY=1          behind the hosting's HTTPS proxy: trust X-Forwarded-Proto / X-Forwarded-For (set 0 if not)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { makeFiles } = require('./lib/files');
const { makeAuth, httpErr } = require('./lib/auth');
const { makeAI } = require('./lib/ai');

const ROOT = __dirname;
const VERSION = (() => { try { return fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim(); } catch (e) { return 'dev'; } })();

function createServer(opts = {}) {
  const DATA = path.resolve(opts.dataDir || process.env.MD_DATA_DIR || path.join(ROOT, 'data'));
  const TRUST = (opts.trustProxy ?? process.env.MD_TRUST_PROXY ?? '1') !== '0';
  const files = makeFiles(DATA);
  const auth = makeAuth(files, opts);
  const ai = makeAI(files, opts);
  const now = opts.now || (() => Date.now());
  const code = auth.ensureSetupCode();
  if (code && !opts.quiet) console.log(`Mind Desk is not set up yet. Open it in a browser and use the setup code ${code} (also in ${path.join(DATA, 'SETUP-CODE.txt')}).`);

  /* ---------- notes: one state with a revision number ---------- */
  let st = files.readJSON('state.json', { rev: 0, session: '', savedAt: 0, state: null });
  let kv = files.readJSON('kv.json', {});
  let captures = files.readJSON('captures.json', []);
  const today = () => new Date(now()).toISOString().slice(0, 10);
  function keep(prefix, n) {
    const list = files.list('backups').filter((f) => f.startsWith(prefix)).sort();
    while (list.length > n) files.remove(path.join('backups', list.shift()));
  }
  function dailyBackup() {
    if (!st.state) return;
    const name = path.join('backups', `day-${today()}.json`);
    if (!files.exists(name)) { files.writeNow(name, st); keep('day-', 30); }
  }
  function backupNow(why) {
    if (!st.state) return null;
    const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-');
    const name = `before-${stamp}-${String(why || 'manual').replace(/[^a-z0-9]+/gi, '-').slice(0, 30)}.json`;
    files.writeNow(path.join('backups', name), st); keep('before-', 20);
    return name;
  }

  /* ---------- pages (built files, with a strict Content Security Policy that allows only their own scripts) ---------- */
  const pages = {};
  function page(name) {
    if (pages[name] && !opts.noCache) return pages[name];
    const html = fs.readFileSync(path.join(ROOT, 'public', name), 'utf8').replace('/*__PAGECSS__*/', () => fs.readFileSync(path.join(ROOT, 'public', '_page.css'), 'utf8'));
    const hashes = [];
    html.replace(/<script>([\s\S]*?)<\/script>/g, (m, js) => { hashes.push("'sha256-" + crypto.createHash('sha256').update(js, 'utf8').digest('base64') + "'"); return m; });
    const csp = ["default-src 'self'", "script-src 'self' " + hashes.join(' '), "style-src 'self' 'unsafe-inline'", "img-src 'self' data:",
      // Ollama on the PC (only used when the person picks it), everything else only this site
      "connect-src 'self' http://localhost:* http://127.0.0.1:*", "manifest-src 'self'", "worker-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'", "object-src 'none'"].join('; ');
    return (pages[name] = { html, csp });
  }

  /* ---------- helpers ---------- */
  const isHttps = (req) => !!req.socket.encrypted || (TRUST && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https');
  const ipOf = (req) => (TRUST && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress) || '?';
  function cookie(req, name) { const m = String(req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)')); return m ? decodeURIComponent(m[1]) : ''; }
  function setSession(req, res, token) {
    const parts = [`md_s=${token ? encodeURIComponent(token) : ''}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${token ? auth.SESSION_DAYS * 86400 : 0}`];
    if (isHttps(req)) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
  }
  function headers(req, res, extra) {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    for (const k of Object.keys(extra || {})) res.setHeader(k, extra[k]);
  }
  function json(req, res, status, body) { headers(req, res, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.statusCode = status; res.end(JSON.stringify(body)); }
  function sendPage(req, res, name) { const p = page(name); headers(req, res, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': p.csp }); res.end(p.html); }
  function redirect(res, to) { res.statusCode = 302; res.setHeader('Location', to); res.end(); }
  const STATIC = { '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'], '/sw.js': ['sw.js', 'text/javascript; charset=utf-8'], '/icon.svg': ['icon.svg', 'image/svg+xml'] };
  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > limit) { reject(httpErr(413, 'Too much data in one request.')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(httpErr(400, 'The request was not readable.')); } });
      req.on('error', reject);
    });
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x'); const p = url.pathname; const m = req.method;
    if (STATIC[p] && m === 'GET') { const [f, type] = STATIC[p]; headers(req, res, { 'Content-Type': type, 'Cache-Control': 'no-cache' }); res.end(fs.readFileSync(path.join(ROOT, 'public', f))); return; }
    if (p === '/health') return json(req, res, 200, { ok: true, version: VERSION });

    const token = cookie(req, 'md_s'); const who = auth.check(token);

    /* pages */
    if (m === 'GET' && !p.startsWith('/api/')) {
      if (auth.needsSetup() && p !== '/setup') return redirect(res, '/setup');
      if (p === '/setup') return auth.needsSetup() ? sendPage(req, res, 'setup.html') : redirect(res, '/');
      if (p === '/login') return who ? redirect(res, url.searchParams.get('next') === '/capture' ? '/capture' : '/') : sendPage(req, res, 'login.html');
      if (!who) return redirect(res, '/login' + (p === '/capture' ? '?next=/capture' : ''));
      if (p === '/' || p === '/index.html') return sendPage(req, res, 'app.html');
      if (p === '/capture') return sendPage(req, res, 'capture.html');
      res.statusCode = 404; return res.end('Not found');
    }

    /* API: every change needs the X-MD header (another website cannot send it) and, if the browser says where it comes from, this site */
    if (m !== 'GET') {
      if (req.headers['x-md'] !== '1') throw httpErr(403, 'Refused.');
      const origin = req.headers.origin; if (origin && new URL(origin).host !== req.headers.host) throw httpErr(403, 'Refused (another site).');
    }
    if (p === '/api/setup' && m === 'POST') { const b = await readBody(req, 10000); return json(req, res, 200, auth.setupStart(b.code, b.user, b.password)); }
    if (p === '/api/setup/confirm' && m === 'POST') {
      const b = await readBody(req, 10000); const r = auth.setupConfirm(b.code);
      setSession(req, res, r.token); return json(req, res, 200, { recovery: r.recovery, next: '/' });
    }
    if (p === '/api/login' && m === 'POST') {
      const b = await readBody(req, 10000); const r = auth.login(ipOf(req), b.user, b.password, b.code);
      setSession(req, res, r.token); return json(req, res, 200, { ok: true, usedRecovery: r.usedRecovery, recoveryLeft: r.recoveryLeft });
    }
    if (!who) throw httpErr(401, 'Please log in.');

    if (p === '/api/me' && m === 'GET') return json(req, res, 200, Object.assign({ version: VERSION }, auth.me()));
    if (p === '/api/logout' && m === 'POST') { auth.logout(token); setSession(req, res, ''); return json(req, res, 200, { ok: true }); }
    if (p === '/api/password' && m === 'POST') { const b = await readBody(req, 10000); const r = auth.changePassword(token, b.old, b.password); setSession(req, res, r.token); return json(req, res, 200, { ok: true }); }

    if (p === '/api/state' && m === 'GET') return json(req, res, 200, { rev: st.rev, state: st.state });
    if (p === '/api/state' && m === 'PUT') {
      const b = await readBody(req, 60 * 1024 * 1024);
      if (!b.state || typeof b.state !== 'object' || !Array.isArray(b.state.notes) || !Array.isArray(b.state.items)) throw httpErr(400, 'That is not Mind Desk data.');
      if (+b.rev !== st.rev) return json(req, res, 409, { error: 'Your notes were changed on another device.', rev: st.rev });
      const next = { rev: st.rev + 1, session: String(req.headers['x-md-session'] || '').slice(0, 40), savedAt: now(), state: Object.assign(b.state, { rev: st.rev + 1 }) };
      await files.writeJSON('state.json', next); st = next; dailyBackup();
      return json(req, res, 200, { rev: st.rev });
    }
    if (p === '/api/status' && m === 'GET') return json(req, res, 200, { rev: st.rev, session: st.session, captures: captures.length, version: VERSION });
    if (p === '/api/backup-now' && m === 'POST') { const b = await readBody(req, 10000); return json(req, res, 200, { ok: true, file: backupNow(b.why) }); }

    const kvm = p.match(/^\/api\/kv\/([A-Za-z0-9_-]{1,40})$/);
    if (kvm) {
      if (m === 'GET') return json(req, res, 200, { value: kv[kvm[1]] === undefined ? null : kv[kvm[1]] });
      if (m === 'PUT') { const b = await readBody(req, 60 * 1024 * 1024); kv[kvm[1]] = b.value; await files.writeJSON('kv.json', kv); return json(req, res, 200, { ok: true }); }
      if (m === 'DELETE') { delete kv[kvm[1]]; await files.writeJSON('kv.json', kv); return json(req, res, 200, { ok: true }); }
    }

    /* quick capture: ideas wait here until the open Mind Desk takes them into the Inbox */
    if (p === '/api/capture' && m === 'POST') {
      const b = await readBody(req, 400000); const text = String(b.text || '').replace(/\r\n?/g, '\n');
      if (!text.trim()) throw httpErr(400, 'The idea is empty.');
      if (text.length > 200000) throw httpErr(413, 'This idea is too long for quick capture. Paste it in Mind Desk instead.');
      const cid = String(b.cid || '').slice(0, 40); // the phone's own id, so a resend after a lost answer is not saved twice
      if (cid && captures.some((c) => c.cid === cid)) return json(req, res, 200, { ok: true, duplicate: true });
      if (captures.length >= 2000) throw httpErr(507, 'Too many ideas are waiting. Open Mind Desk once so they move into the Inbox.');
      const c = { id: 'c' + now().toString(36) + crypto.randomBytes(3).toString('hex'), cid, at: +b.at > 0 && +b.at <= now() ? +b.at : now(), text, name: String(b.name || '').slice(0, 120) };
      captures.push(c); await files.writeJSON('captures.json', captures);
      return json(req, res, 200, { ok: true, id: c.id, waiting: captures.length });
    }
    if (p === '/api/captures' && m === 'GET') return json(req, res, 200, { captures });
    if (p === '/api/captures/ack' && m === 'POST') {
      const b = await readBody(req, 100000); const ids = new Set(Array.isArray(b.ids) ? b.ids.map(String) : []);
      captures = captures.filter((c) => !ids.has(c.id)); await files.writeJSON('captures.json', captures);
      return json(req, res, 200, { ok: true, waiting: captures.length });
    }

    /* AI with your own key */
    if (p === '/api/ai/settings' && m === 'GET') return json(req, res, 200, ai.settings());
    if (p === '/api/ai/settings' && m === 'PUT') { const b = await readBody(req, 10000); return json(req, res, 200, ai.update(b)); }
    if (p === '/api/ai' && m === 'POST') {
      const b = await readBody(req, 6 * 1024 * 1024);
      const ctrl = new AbortController(); res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });
      await ai.run(b, res, ctrl.signal); return;
    }
    throw httpErr(404, 'Not found.');
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      const status = e.status || 500;
      if (status === 500 && !opts.quiet) console.error(e);
      if (res.headersSent) { try { res.end(JSON.stringify({ error: 'The server had a problem.', code: 'server_error' }) + '\n'); } catch (x) { /* ignore */ } return; }
      json(req, res, status, { error: status === 500 ? 'The server had a problem: ' + e.message : e.message, code: e.code || (status === 401 ? 'not_logged_in' : 'error') });
    });
  });
  server.requestTimeout = 0; // AI answers can stream for minutes
  return { server, DATA, auth };
}

if (require.main === module) {
  const { server, DATA } = createServer();
  const port = +process.env.PORT || 3000;
  server.listen(port, process.env.HOST || undefined, () => console.log(`Mind Desk ${VERSION} is running on port ${port}. Data folder: ${DATA}`));
}
module.exports = { createServer };
