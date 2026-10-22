'use strict';
// Small JSON file storage: every write goes to a temporary file first and then replaces the old one,
// so a crash or a full disk never leaves half a file. Writes to the same file run one after another.
const fs = require('fs');
const path = require('path');

function makeFiles(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const queues = new Map();
  const file = (name) => path.join(dir, name);

  function readJSON(name, fallback) {
    try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch (e) {
      if (e.code === 'ENOENT') return fallback;
      // a damaged file: keep it for inspection and say so loudly instead of starting empty
      throw new Error(`The data file ${name} cannot be read (${e.message}). Nothing was changed.`);
    }
  }
  function writeNow(name, data, mode) {
    const target = file(name); const tmp = target + '.tmp-' + process.pid;
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    const fd = fs.openSync(tmp, 'w', mode || 0o600);
    try { fs.writeSync(fd, typeof data === 'string' ? data : JSON.stringify(data)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, target);
  }
  /** queue a write so two writes to one file never overlap */
  function writeJSON(name, data, mode) {
    const prev = queues.get(name) || Promise.resolve();
    const next = prev.catch(() => {}).then(() => writeNow(name, data, mode));
    queues.set(name, next);
    return next;
  }
  const exists = (name) => fs.existsSync(file(name));
  const remove = (name) => { try { fs.unlinkSync(file(name)); } catch (e) { if (e.code !== 'ENOENT') throw e; } };
  const list = (sub) => { try { return fs.readdirSync(file(sub)); } catch (e) { return []; } };
  return { dir, file, readJSON, writeJSON, writeNow, exists, remove, list };
}
module.exports = { makeFiles };
