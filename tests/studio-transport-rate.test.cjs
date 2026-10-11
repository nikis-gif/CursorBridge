'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('Studio HTTP polling stays under the per-plugin budget at idle and while busy', () => {
  const defaults = read('plugin/source/Config/Defaults.lua');
  const getValue = (key) => {
    const match = defaults.match(new RegExp('\\b' + key + '\\s*=\\s*([\\d.]+)'));
    assert.ok(match, key + ' is configured');
    return Number(match[1]);
  };
  const idle = getValue('IdlePollInterval');
  const active = getValue('ActivePollInterval');
  assert.ok(idle >= 1.0, 'idle polling must not hammer HttpService');
  assert.ok(active >= 0.5, 'up to two HTTP calls per busy cycle must remain bounded');
  assert.ok(active < idle, 'active sync should be more responsive than idle sync');
  assert.ok(120 / active < 500, 'worst-case polling must leave room for other Studio plugins');
});

test('rate limiting retries without disconnecting a session immediately', () => {
  const lua = read('plugin/source/Services/StudioBridge.lua');
  const server = read('bridge/bridge-server.cjs');
  assert.match(lua, /requests exceeded limit/);
  assert.match(lua, /InitialRetryDelay/);
  assert.match(lua, /MaximumRetryDelay/);
  assert.match(lua, /if not rateLimited and failures >= Defaults\.MaxNetworkFailures then/);
  assert.match(lua, /SourceAuditInterval/);
  assert.match(server, /const TIMEOUT_MS = 45000/);
});

test('release workflow publishes all artifacts through a single GitHub release', () => {
  const workflow = read('.github/workflows/release.yml');
  assert.match(workflow, /electron-builder --win nsis --publish never/);
  assert.match(workflow, /gh release create \$tag \$assets/);
  assert.doesNotMatch(workflow, /electron-builder --win nsis --publish always/);
});
