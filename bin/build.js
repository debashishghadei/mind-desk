#!/usr/bin/env node
// Builds the single-file app mind-desk.html from src/ (and the release zip with --zip).
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
const read = (f) => fs.readFileSync(path.join(root, 'src', f), 'utf8');

let html = read('index.html');
html = html.replace('/*__CSS__*/', () => read('style.css'))
  .replace('/*__CORE__*/', () => read('core.js'))
  .replace('/*__APP__*/', () => read('app.js').replace("'__VERSION__'", JSON.stringify(version)));
fs.writeFileSync(path.join(root, 'mind-desk.html'), html);
console.log(`built mind-desk.html (${version}, ${(html.length / 1024).toFixed(0)} KB)`);

if (process.argv.includes('--zip')) {
  const dist = path.join(root, 'dist'); fs.mkdirSync(dist, { recursive: true });
  const stage = path.join(dist, 'mind-desk'); fs.rmSync(stage, { recursive: true, force: true }); fs.mkdirSync(stage);
  for (const f of ['mind-desk.html', 'Open Mind Desk.bat', 'README.md', 'CHANGELOG.md']) fs.copyFileSync(path.join(root, f), path.join(stage, f));
  const zip = path.join(dist, `mind-desk-${version}.zip`); fs.rmSync(zip, { force: true });
  execFileSync('python3', ['-c', `import shutil;shutil.make_archive(${JSON.stringify(zip.replace(/\.zip$/, ''))},'zip',${JSON.stringify(dist)},'mind-desk')`]);
  console.log('zip:', zip);
}
