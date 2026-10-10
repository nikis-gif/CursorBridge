'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { BridgeServer } = require('../bridge/bridge-server.cjs');

async function createHarness() {
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cursor-bridge-test-'));
  const bridge = new BridgeServer({ storageDir, port: 0 });
  await bridge.start();
  const port = bridge.httpServer.address().port;
  const request = async (endpoint, data, token, extra = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}/v1/${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cursor-bridge': '1',
        ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra },
      body: JSON.stringify(data),
    });
    return { status: response.status, data: await response.json() };
  };
  return { bridge, request, storageDir, async cleanup() { await bridge.close();await fs.rm(storageDir,{recursive:true,force:true}); } };
}

test('pairing blocks multiple Studio sessions and unauthorized clients', async () => {
  const h = await createHarness();
  try {
    const wrong = await h.request('pair', { code: '000000', studioRunId: 'long-unique-studio-instance' });
    if (h.bridge.pairingCode !== '000000') assert.equal(wrong.status, 403);
    const paired = await h.request('pair', { code: h.bridge.pairingCode,
      studioRunId: 'studio-guid-12345678', placeKey: '10-20', placeName: 'Test Place' });
    assert.equal(paired.status, 200);
    const denied = await h.request('pair', { code: h.bridge.pairingCode,
      studioRunId: 'studio-guid-second', placeKey: '10-20', placeName: 'Other Place' });
    assert.equal(denied.status, 409);
    const unauthorized = await h.request('poll', {}, 'invalid');
    assert.equal(unauthorized.status, 401);
    const browser = await h.request('poll', {}, paired.data.token, { origin: 'https://malicious.example' });
    assert.equal(browser.status, 403);
    const valid = await h.request('poll', {}, paired.data.token);
    assert.equal(valid.status, 200);
    assert.deepEqual(valid.data.commands, []);
  } finally { await h.cleanup(); }
});

test('Studio snapshot, editor writes, conflicts, recovery and session closure', async () => {
  const h = await createHarness();
  try {
    const { data: paired } = await h.request('pair', { code: h.bridge.pairingCode,
      studioRunId: 'studio-guid-12345678', placeKey: '10-20', placeName: 'My Place' });
    const token = paired.token;
    const initial = await h.request('changes', { sequence: 1, ops: [
      { type: 'reset' },
      { type: 'upsert', node: { id: 'workspace-id', parentId: 'game', name: 'Workspace', className: 'Workspace' } },
      { type: 'upsert', node: { id: 'folder-id', parentId: 'workspace-id', name: 'Code', className: 'Folder' } },
      { type: 'upsert', node: { id: 'script-id', parentId: 'folder-id', name: 'GameCode', className: 'ModuleScript', source: 'print("studio")' } },
      { type: 'ready' },
    ] }, token);
    assert.equal(initial.status, 200);
    assert.equal(h.bridge.getStatus().ready, true);
    assert.equal(h.bridge.nodePath('script-id'), 'game/Workspace/Code/GameCode');
    const stale = await h.request('changes', { sequence: 1, ops: [{ type: 'source', id: 'script-id', source: 'unexpected' }] }, token);
    assert.equal(stale.data.receivedSequence, 1);
    assert.equal(h.bridge.getState().nodes.find((n) => n.id === 'script-id').source, 'print("studio")');
    const first = await h.bridge.writeScript('script-id', 'print("desktop")', 1);
    assert.equal(first.status, 'queued');
    const second = await h.bridge.writeScript('script-id', 'print("desktop-v2")', 1);
    assert.equal(second.status, 'queued-behind-current');
    const commands = (await h.request('poll', {}, token)).data.commands;
    assert.equal(commands.length, 1);
    assert.equal(commands[0].expectedSource, 'print("studio")');
    await h.request('changes', { sequence: 2, ops: [{ type: 'result', id: 'script-id',
      opId: commands[0].opId, status: 'applied', source: 'print("desktop")' }] }, token);
    assert.equal(h.bridge.nodes.get('script-id').revision, 2);
    const queuedCommand = (await h.request('poll', {}, token)).data.commands[0];
    assert.equal(queuedCommand.expectedSource, 'print("desktop")');
    assert.equal(queuedCommand.newSource, 'print("desktop-v2")');
    await h.request('changes', { sequence: 3, ops: [{ type: 'source', id: 'script-id', source: 'print("someone else")' }] }, token);
    assert.equal(h.bridge.nodes.get('script-id').source, 'print("someone else")');
    assert.equal(h.bridge.nodes.get('script-id').pendingWrite, null);
    const mismatch = await h.bridge.writeScript('script-id', 'print("stale")', 2);
    assert.equal(mismatch.status, 'conflict');
    await h.bridge.saveDraft('script-id', 'print("offline draft")');
    const draft = await h.bridge.getDraft('script-id');
    assert.equal(draft.source, 'print("offline draft")');
    const versions = await h.bridge.listBackups('script-id');
    assert.ok(versions.length >= 2);
    assert.ok((await h.bridge.restoreBackup('script-id', versions[0].id)).source);
    const gone = await h.request('disconnect', {}, token);
    assert.equal(gone.status, 200);
    assert.equal(h.bridge.getStatus().connected, false);
    assert.equal((await h.request('poll', {}, token)).status, 401);
    const readOnly = h.bridge.getState();
    assert.equal(readOnly.nodes.find((n) => n.id === 'script-id').source, 'print("someone else")');
    assert.ok(await fs.stat(path.join(h.storageDir, 'backups', 'recovery', 'latest.json.gz')));
  } finally { await h.cleanup(); }
});

test('offline workspace can be loaded from the last recovery snapshot', async () => {
  const h = await createHarness();
  try {
    const { data: paired } = await h.request('pair', { code: h.bridge.pairingCode,
      studioRunId: 'studio-guid-recovery', placeKey: '44-55', placeName: 'Recovered Place' });
    await h.request('changes', { sequence: 1, ops: [
      { type: 'upsert', node: { id: 'script-id', parentId: 'game', name: 'Recovered', className: 'Script', source: 'return true' } },
      { type: 'ready' },
    ] }, paired.token);
    await h.bridge.disconnect('test');
    const offline = new BridgeServer({ storageDir: h.storageDir, port: 0 });
    try {
      await offline.start();
      assert.equal(offline.getStatus().connected, false);
      assert.equal(offline.getStatus().placeName, 'Recovered Place');
      assert.equal(offline.getState().nodes[0].source, 'return true');
    } finally { await offline.close(); }
  } finally { await h.cleanup(); }
});

test('live Luau autocomplete resolves service hierarchy', async () => {
  const { resolveExpression, findHierarchyCompletion } = await import('../renderer/luau-completion.mjs');
  const nodes = new Map([
    ['workspace', { id:'workspace', parentId:'game', name:'Workspace' }],
    ['part', { id:'part', parentId:'workspace', name:'Part', className:'Part' }],
    ['folder', { id:'folder', parentId:'workspace', name:'Folder', className:'Folder' }],
    ['script', { id:'script', parentId:'folder', name:'Code', className:'Script' }],
  ]);
  assert.equal(resolveExpression('workspace.Part',nodes)?.id,'part');
  assert.equal(resolveExpression('script.Parent',nodes,'script')?.id,'folder');
  assert.equal(findHierarchyCompletion('works',nodes,'script').type,'roots');
  const suggestion = findHierarchyCompletion('workspace.P',nodes,'script');
  assert.equal(suggestion.type,'children');
  assert.equal(suggestion.values[1].name,'Part');
});

test('previous Studio session history matches the same exact hierarchy path', async () => {
  const h = await createHarness();
  try {
    const pairPlace = () => h.request('pair', {
      code: h.bridge.pairingCode, studioRunId: 'studio-history-run-12345',
      placeKey: '700-900', placeName: 'Persistent Place',
    });
    const first = (await pairPlace()).data;
    assert.equal((await h.request('changes', { sequence: 1, ops: [
      { type: 'upsert', node: { id: 'old-workspace', parentId: 'game', name: 'Workspace', className: 'Workspace' } },
      { type: 'upsert', node: { id: 'old-script', parentId: 'old-workspace', name: 'GameScript', className: 'Script', source: 'print("old")' } },
      { type: 'source', id: 'old-script', source: 'print("revised")' },
      { type: 'ready' },
    ] }, first.token)).status, 200);
    await h.bridge.disconnect('test-new-place-session');
    const second = (await pairPlace()).data;
    assert.equal((await h.request('changes', { sequence: 1, ops: [
      { type: 'upsert', node: { id: 'new-workspace', parentId: 'game', name: 'Workspace', className: 'Workspace' } },
      { type: 'upsert', node: { id: 'new-script', parentId: 'new-workspace', name: 'GameScript', className: 'Script', source: 'print("now")' } },
      { type: 'ready' },
    ] }, second.token)).status, 200);
    const oldVersions = await h.bridge.listBackups('new-script');
    assert.ok(oldVersions.some((version) => version.fromPreviousSession));
    const previous = oldVersions.find((version) => version.fromPreviousSession);
    const recovered = await h.bridge.restoreBackup('new-script', previous.id, previous.storageScriptId);
    assert.equal(recovered.source, 'print("old")');
    assert.equal(h.bridge.nodePath('new-script'), 'game/Workspace/GameScript');
  } finally { await h.cleanup(); }
});
