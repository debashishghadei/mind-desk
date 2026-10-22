#!/usr/bin/env node
// Builds both versions from src/ (and the PC release zip with --zip):
//   mind-desk.html           the PC app: one file you open in Chrome/Edge, works with Ollama on the PC
//   mind-desk-artifact.html  the claude.ai artifact: Claude answers with your plan, notes live in the artifact's private storage
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
const read = (f) => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const MODELS = fs.readFileSync(path.join(root, 'server', 'lib', 'models.json'), 'utf8');
const app = (target) => read('app.js').replace("'__VERSION__'", JSON.stringify(version)).replace("'__TARGET__'", JSON.stringify(target))
  .replace(/\/\*__API_MODELS__\*\/.*?; \/\/ filled/, () => JSON.stringify(JSON.parse(MODELS)) + '; // filled');

/* PC: the full page */
let html = read('index.html');
html = html.replace('/*__CSS__*/', () => read('style.css'))
  .replace('/*__CORE__*/', () => read('core.js'))
  .replace('/*__APP__*/', () => app('pc'));
fs.writeFileSync(path.join(root, 'mind-desk.html'), html);
console.log(`built mind-desk.html (${version}, ${(html.length / 1024).toFixed(0)} KB)`);

/* artifact: a page fragment (claude.ai adds doctype/html/head/body); title first, then styles, then the same body */
const src = read('index.html');
const body = src.slice(src.indexOf('<body>') + 6, src.lastIndexOf('</body>'));
let art = `<title>Mind Desk</title>
<style>
${read('style.css')}
${read('artifact.css')}
</style>
${body.trim()}
`;
art = art.replace('<script>\n/*__CORE__*/\n</script>', () => `<script>\n${read('core.js')}\n</script>\n<script>\n${read('platform-artifact.js')}\n</script>`)
  .replace('/*__APP__*/', () => app('artifact'))
  .replace('Please open it in Microsoft Edge or Google Chrome.', 'Please allow JavaScript for claude.ai.');
if (!art.includes('window.MDArtifact = P') || art.includes('/*__')) throw new Error('artifact build: a part is missing');
fs.writeFileSync(path.join(root, 'mind-desk-artifact.html'), art);
console.log(`built mind-desk-artifact.html (${version}, ${(art.length / 1024).toFixed(0)} KB)`);

/* cloud: the full page served by server/server.js after login, with the cloud platform instead of the artifact one */
let cloud = read('index.html');
cloud = cloud.replace('/*__CSS__*/', () => read('style.css'))
  .replace('<script>\n/*__CORE__*/\n</script>', () => `<script>\n${read('core.js')}\n</script>\n<script>\n${read('platform-cloud.js')}\n</script>`)
  .replace('/*__APP__*/', () => app('cloud'))
  .replace('<link rel="icon"', '<link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#1d6b5f"><link rel="icon"')
  .replace('Please open it in Microsoft Edge or Google Chrome.', 'Please allow JavaScript for this site.');
if (!cloud.includes('window.MDCloud = P') || cloud.includes('/*__')) throw new Error('cloud build: a part is missing');
fs.mkdirSync(path.join(root, 'server', 'public'), { recursive: true });
fs.writeFileSync(path.join(root, 'server', 'public', 'app.html'), cloud);
fs.writeFileSync(path.join(root, 'server', 'VERSION'), version + '\n');
console.log(`built server/public/app.html (${version}, ${(cloud.length / 1024).toFixed(0)} KB)`);

if (process.argv.includes('--zip')) {
  const dist = path.join(root, 'dist'); fs.mkdirSync(dist, { recursive: true });
  const stage = path.join(dist, 'mind-desk'); fs.rmSync(stage, { recursive: true, force: true }); fs.mkdirSync(stage);
  for (const f of ['mind-desk.html', 'Open Mind Desk.bat', 'README.md', 'CHANGELOG.md']) fs.copyFileSync(path.join(root, f), path.join(stage, f));
  const zip = path.join(dist, `mind-desk-${version}.zip`); fs.rmSync(zip, { force: true });
  execFileSync('python3', ['-c', `import shutil;shutil.make_archive(${JSON.stringify(zip.replace(/\.zip$/, ''))},'zip',${JSON.stringify(dist)},'mind-desk')`]);
  console.log('zip:', zip);

  /* cloud zip: the server folder without its data, plus the setup guide */
  const cstage = path.join(dist, 'mind-desk-cloud'); fs.rmSync(cstage, { recursive: true, force: true });
  fs.cpSync(path.join(root, 'server'), cstage, { recursive: true, filter: (src) => !/[\\/]data([\\/]|$)|\.tmp-/.test(path.relative(root, src)) });
  fs.copyFileSync(path.join(root, 'docs', 'CLOUD-SETUP.md'), path.join(cstage, 'README.md'));
  fs.copyFileSync(path.join(root, 'CHANGELOG.md'), path.join(cstage, 'CHANGELOG.md'));
  const czip = path.join(dist, `mind-desk-cloud-${version}.zip`); fs.rmSync(czip, { force: true });
  execFileSync('python3', ['-c', `import shutil;shutil.make_archive(${JSON.stringify(czip.replace(/\.zip$/, ''))},'zip',${JSON.stringify(dist)},'mind-desk-cloud')`]);
  console.log('zip:', czip);
}
