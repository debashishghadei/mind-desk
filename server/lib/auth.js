'use strict';
// One owner account: password (scrypt) + two-step code from an authenticator app (TOTP, RFC 6238) + 8 one-time recovery codes.
// Sessions are random tokens in an HttpOnly cookie; only their SHA-256 is stored.
const crypto = require('crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(buf) { let bits = 0, val = 0, out = ''; for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += B32[(val << (5 - bits)) & 31]; return out; }
function unbase32(s) { const clean = String(s).toUpperCase().replace(/[^A-Z2-7]/g, ''); let bits = 0, val = 0; const out = []; for (const c of clean) { val = (val << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); }
/** the 6-digit code for a 30-second time step */
function totpAt(secret, step) {
  const msg = Buffer.alloc(8); msg.writeUInt32BE(Math.floor(step / 2 ** 32), 0); msg.writeUInt32BE(step % 2 ** 32, 4);
  const h = crypto.createHmac('sha1', unbase32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15; const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, '0');
}
const stepNow = (now = Date.now()) => Math.floor(now / 30000);
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const eq = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
function hashPassword(pw, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex');
  return { salt, hash };
}

function makeAuth(files, opts = {}) {
  const ACCOUNT = 'account.json'; const SESSIONS = 'sessions.json';
  const now = opts.now || (() => Date.now());
  let account = files.readJSON(ACCOUNT, null);
  let sessions = files.readJSON(SESSIONS, {});
  const SESSION_DAYS = 30;

  /* ---------- first run: a one-time setup code in data/SETUP-CODE.txt (read it in the hosting file manager or the log) ---------- */
  let setupCode = null; let pending = null;
  function ensureSetupCode() {
    if (account) { setupCode = null; files.remove('SETUP-CODE.txt'); return null; }
    if (files.exists('SETUP-CODE.txt')) setupCode = String(require('fs').readFileSync(files.file('SETUP-CODE.txt'), 'utf8')).trim().split(/\s+/)[0];
    if (!setupCode) { setupCode = crypto.randomBytes(6).toString('hex').toUpperCase(); files.writeNow('SETUP-CODE.txt', setupCode + '\n\nType this code on the Mind Desk setup page. It works once.\n'); }
    return setupCode;
  }
  const needsSetup = () => !account;
  /** step 1: check the setup code, remember user + password, give back a new authenticator secret */
  function setupStart(code, user, password) {
    if (account) throw httpErr(409, 'Mind Desk is already set up.');
    if (!setupCode || !eq(String(code || '').trim().toUpperCase(), setupCode)) throw httpErr(403, 'The setup code is not right. Look in the file data/SETUP-CODE.txt on your server.');
    user = String(user || '').trim();
    if (!/^[A-Za-z0-9._@-]{3,40}$/.test(user)) throw httpErr(400, 'Choose a user name with 3–40 letters, numbers, dots or dashes.');
    if (String(password || '').length < 12) throw httpErr(400, 'Choose a password with 12 characters or more.');
    const secret = base32(crypto.randomBytes(20));
    pending = { user, pw: hashPassword(password), secret, at: now() };
    return { secret, otpauth: `otpauth://totp/Mind%20Desk:${encodeURIComponent(user)}?secret=${secret}&issuer=Mind%20Desk&digits=6&period=30` };
  }
  /** step 2: the first code from the authenticator app proves it was set up; the account is created */
  function setupConfirm(code) {
    if (account) throw httpErr(409, 'Mind Desk is already set up.');
    if (!pending || now() - pending.at > 15 * 60000) throw httpErr(400, 'Setup took too long. Start again.');
    const st = checkTotp(pending.secret, code, -1);
    if (st === false) throw httpErr(400, 'That code is not right. Check the time on your phone and type the newest code.');
    const recovery = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex').toUpperCase().replace(/(.{5})/, '$1-'));
    account = { user: pending.user, salt: pending.pw.salt, hash: pending.pw.hash, totp: { secret: pending.secret, lastStep: st }, recovery: recovery.map((r) => sha(r.replace('-', ''))), createdAt: now(), pwChangedAt: now() };
    files.writeNow(ACCOUNT, account); pending = null; ensureSetupCode();
    return { recovery, token: newSession() };
  }

  /** a code is accepted for the current 30 s step and one step either side, and never twice */
  function checkTotp(secret, code, lastStep) {
    code = String(code || '').replace(/\s/g, ''); if (!/^\d{6}$/.test(code)) return false;
    const s = stepNow(now());
    for (const st of [s, s - 1, s + 1]) if (st > lastStep && eq(totpAt(secret, st), code)) return st;
    return false;
  }

  /* ---------- login attempts: 5 wrong per address in 15 minutes, 30 in total per hour ---------- */
  const fails = new Map(); let globalFails = [];
  function limited(ip) {
    const t = now(); globalFails = globalFails.filter((x) => t - x < 3600000);
    const mine = (fails.get(ip) || []).filter((x) => t - x < 900000); fails.set(ip, mine);
    return mine.length >= 5 || globalFails.length >= 30;
  }
  function failed(ip) { const t = now(); fails.set(ip, (fails.get(ip) || []).concat(t)); globalFails.push(t); }

  function login(ip, user, password, code) {
    if (!account) throw httpErr(409, 'Mind Desk is not set up yet.');
    if (limited(ip)) throw httpErr(429, 'Too many wrong tries. Wait 15 minutes and try again.');
    const pwOk = eq(String(user || '').trim(), account.user) & eq(hashPassword(password || '', account.salt).hash, account.hash);
    let codeOk = false; let usedRecovery = false;
    if (pwOk) {
      const st = checkTotp(account.totp.secret, code, account.totp.lastStep || -1);
      if (st !== false) { codeOk = true; account.totp.lastStep = st; } else {
        const h = sha(String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
        const k = account.recovery.indexOf(h); if (k >= 0) { codeOk = true; usedRecovery = true; account.recovery.splice(k, 1); }
      }
    }
    if (!pwOk || !codeOk) { failed(ip); throw httpErr(401, 'The user name, password or code is not right.'); }
    files.writeNow(ACCOUNT, account);
    return { token: newSession(), usedRecovery, recoveryLeft: account.recovery.length };
  }
  function newSession() {
    const token = crypto.randomBytes(32).toString('base64url');
    sessions[sha(token)] = { created: now(), seen: now() }; saveSessions();
    return token;
  }
  let sessTimer = null;
  function saveSessions(soon) {
    if (soon) { if (!sessTimer) sessTimer = setTimeout(() => { sessTimer = null; files.writeJSON(SESSIONS, sessions); }, 5000); return; }
    files.writeJSON(SESSIONS, sessions);
  }
  /** the session behind a cookie, or null; old sessions end after 30 days without use */
  function check(token) {
    if (!token || !account) return null;
    const s = sessions[sha(token)]; if (!s) return null;
    if (now() - s.seen > SESSION_DAYS * 86400000 || s.created < (account.pwChangedAt || 0)) { delete sessions[sha(token)]; saveSessions(); return null; }
    if (now() - s.seen > 600000) { s.seen = now(); saveSessions(true); }
    return { user: account.user };
  }
  function logout(token) { if (token) { delete sessions[sha(token)]; saveSessions(); } }
  function changePassword(token, oldPw, newPw) {
    if (String(newPw || '').length < 12) throw httpErr(400, 'The new password needs 12 characters or more.');
    if (!eq(hashPassword(oldPw || '', account.salt).hash, account.hash)) throw httpErr(403, 'The current password is not right.');
    const pw = hashPassword(newPw); account.salt = pw.salt; account.hash = pw.hash; account.pwChangedAt = now();
    files.writeNow(ACCOUNT, account);
    sessions = {}; const t = newSession(); return { token: t }; // every other device is logged out
  }
  const me = () => (account ? { user: account.user, totp: true, recoveryLeft: account.recovery.length } : null);
  return { ensureSetupCode, needsSetup, setupStart, setupConfirm, login, check, logout, changePassword, me, SESSION_DAYS };
}
function httpErr(status, msg, code) { const e = new Error(msg); e.status = status; if (code) e.code = code; return e; }
module.exports = { makeAuth, totpAt, stepNow, base32, unbase32, httpErr };
