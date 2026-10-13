'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const source = name => fs.readFileSync(path.join(root, name), 'utf8');

test('retired ChatGPT and project chat modules are absent from distributed source', () => {
  const obsolete = [
    'electron/ai-assistant.cjs', 'electron/ai-project-store.cjs',
    'electron/chatgpt-auth.cjs', 'electron/siwc-availability.cjs',
    'renderer/ai-panel.mjs', 'renderer/ai-panel.css',
    'renderer/place-project-key.mjs', 'shared/place-project-key.mjs',
    'docs/AI_PROJECTS.md',
  ];
  for (const file of obsolete) assert.equal(fs.existsSync(path.join(root, file)), false, file);
});

test('Electron no longer exposes ChatGPT login, inference or AI project IPC', () => {
  const main = source('electron/main.cjs'), preload = source('electron/preload.cjs');
  assert.doesNotMatch(main, /bridge:ai-|ChatGPTAuth|AIAssistant|AIProjectStore|siwc-availability|chatgpt-auth|CURSOR_BRIDGE_DEV_SIWC/);
  assert.doesNotMatch(preload, /bridge:ai-|aiSignIn|aiModels|aiSend|aiOpenChatGPT|aiEnsureProject/);
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /sandbox: true/);
});

test('no chat pane or stale ChatGPT shortcut remains in the renderer', () => {
  const html = source('index.html'), renderer = source('renderer/app.js');
  assert.doesNotMatch(renderer, /mountAssistant|ai-panel|assistant\?\.|aiProjects/);
  assert.doesNotMatch(html, /AI project conversations|Ctrl Shift A|aiPanel|railAssistant/);
  assert.match(html, /id="railQuickApply"/);
  assert.match(html, /id="quickApplyLauncher"/);
  assert.match(html, /id="quickApplyDialog"/);
  assert.match(renderer, /openQuickApply/);
});

test('Quick Apply IPC and safety pathway remain present', () => {
  const main = source('electron/main.cjs'), preload = source('electron/preload.cjs');
  const renderer = source('renderer/app.js'), html = source('index.html');
  for (const channel of ['bridge:save-quick-apply-draft', 'bridge:get-quick-apply-draft',
    'bridge:preview-quick-apply', 'bridge:apply-quick-apply']) {
    assert.ok(main.includes(channel) && preload.includes(channel), channel);
  }
  assert.match(renderer, /quickApplySessionChanged\(\)/);
  assert.match(renderer, /qa\('quickApplyDialog'\)/);
  assert.match(html, /Original scripts and the imported TXT are backed up before any change/);
});

test('future releases must not reintroduce assistant content into the packaged bundle', () => {
  const pkg = JSON.parse(source('package.json'));
  assert.equal(pkg.license, 'UNLICENSED');
  assert.equal(pkg.version, '0.4.2');
  assert.equal(pkg.build.files.some(x => x.includes('renderer/ai-panel')), false);
});
