'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('Monaco 0.57 renderer uses public package exports rather than removed private paths', () => {
  const source = fs.readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.devDependencies['monaco-editor'], '0.57.0');
  assert.match(source, /import \* as monaco from ['"]monaco-editor['"];/);
  assert.match(source, /import EditorWorker from ['"]monaco-editor\/editor\/editor\.worker\?worker['"];/);
  assert.match(source, /self\.MonacoEnvironment\s*=/);
  assert.doesNotMatch(source, /monaco-editor\/esm\/vs\//);
  assert.doesNotMatch(source, /monaco-editor\/editor\/editor\.main\.css/);
});

test('installed Monaco package provides its exported editor worker when dependencies exist', () => {
  const packageDir = path.join(root, 'node_modules', 'monaco-editor');
  if (!fs.existsSync(packageDir)) return;
  const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
  assert.ok(manifest.exports && manifest.exports['.'], 'Monaco main entry is not exported');
  const workerTarget = manifest.exports['./*'];
  assert.equal(typeof workerTarget, 'string', 'Monaco package exports changed');
  assert.ok(workerTarget.includes('*'), 'Monaco worker export path changed');
  const workerFile = path.join(packageDir, workerTarget.replace('*', 'editor/editor.worker'));
  assert.ok(fs.existsSync(workerFile), `Monaco worker does not exist: ${workerFile}`);
});
