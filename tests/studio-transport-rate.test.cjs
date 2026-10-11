'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const project=path.resolve(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(project,file),'utf8');

test('Studio HTTP polling respects an explicit rate budget',()=>{
  const defaults=read('plugin/source/Config/Defaults.lua');
  const match=(name)=>Number(defaults.match(new RegExp('\\b'+name+'\\s*=\\s*([\\d.]+)'))?.[1]);
  assert.ok(match('IdlePollInterval')>=1.0);
  assert.ok(match('ActivePollInterval')>=0.5);
  assert.ok(match('ActivePollInterval')<match('IdlePollInterval'));
  assert.ok(120/match('ActivePollInterval')<500);
  assert.ok(match('MaxOperationsPerBatch')>=256);
});

test('transient Studio HTTP throttling uses retry backoff',()=>{
  const lua=read('plugin/source/Services/StudioBridge.lua');
  const server=read('bridge/bridge-server.cjs');
  assert.match(lua,/requests exceeded limit/);
  assert.match(lua,/InitialRetryDelay/);
  assert.match(lua,/MaximumRetryDelay/);
  assert.doesNotMatch(lua,/failures >= Defaults\.MaxNetworkFailures/);
  assert.match(lua,/\/v2\/resume/);
  assert.match(lua,/\/v2\/exchange/);
  assert.match(lua,/Session authorization ended/);
  assert.match(server,/const TIMEOUT_MS = 120000/);
});

test('only one release is published and the updater manifest is checked',()=>{
  const workflow=read('.github/workflows/release.yml');
  const pkg=JSON.parse(read('package.json'));
  assert.match(workflow,/electron-builder --win nsis --publish never/);
  assert.match(workflow,/gh release create \$tag \$assets/);
  assert.doesNotMatch(workflow,/electron-builder --win nsis --publish always/);
  assert.equal(pkg.build.win.artifactName,'Cursor-Bridge-Setup-${version}.${ext}');
  assert.match(workflow,/Verify updater manifest matches installer/);
  assert.match(workflow,/latest\.yml checksum does not match installer/);
});
