'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const project = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(project, file), 'utf8');

const entries = [
  { id: 'workspace', name: 'Workspace', parentId: 'game', className: 'Workspace' },
  { id: 's1', name: 'Script', parentId: 'workspace', className: 'Script', isScript: true },
  { id: 's2', name: 'Script', parentId: 'workspace', className: 'Script', isScript: true },
  { id: 's3', name: 'Script', parentId: 'workspace', className: 'Script', isScript: true },
];

test('same-name scripts have independent Explorer identities and consistent selections', async () => {
  const { selectOnPointer, selectOnSweep } = await import('../renderer/explorer-selection.mjs');
  const { buildExplorerRows } = await import('../renderer/explorer-model.mjs');
  const visibleIds = buildExplorerRows(new Map(entries.map((n) => [n.id, n])), new Set(['workspace']))
    .rows.map((row) => row.id);
  assert.deepEqual(visibleIds, ['workspace', 's1', 's2', 's3']);
  let state = selectOnPointer(visibleIds, new Set(), null, 's1');
  assert.deepEqual([...state.selected], ['s1']);
  state = selectOnPointer(visibleIds, state.selected, state.anchorId, 's2', { toggle: true });
  assert.deepEqual([...state.selected], ['s1', 's2']);
  state = selectOnPointer(visibleIds, state.selected, state.anchorId, 's3', { shift: true });
  assert.deepEqual([...state.selected], ['s2', 's3']);
  state = selectOnPointer(visibleIds, state.selected, state.anchorId, 's2');
  assert.deepEqual([...state.selected], ['s2'], 'ordinary click collapses a multi-selection');
  assert.deepEqual([...selectOnSweep(visibleIds, 's1', 's3')], ['s1', 's2', 's3']);
  state = selectOnPointer(visibleIds, state.selected, state.anchorId, 's2', { toggle: true });
  assert.equal(state.selected.size, 0);
});

test('selection does not rebuild Explorer rows or change its vertical layout', () => {
  const app = read('renderer/app.js');
  const html = read('index.html');
  const css = read('renderer/styles.css');
  const rowPointer = app.split("row.addEventListener('pointerdown'")[1].split("row.addEventListener('click'")[0];
  assert.ok(rowPointer.includes('selectForRow('));
  assert.ok(!rowPointer.includes('scheduleRender()'));
  assert.ok(app.includes('function paintSelection()'));
  assert.ok(app.includes("row.classList.toggle('selected', active)"));
  assert.ok(html.indexOf('id="treeScroller"') < html.indexOf('id="selectionActions"'));
  assert.ok(html.includes('class="explorer-bottom"'));
  assert.ok(!html.includes('id="selectionBar"'));
  assert.match(css, /\.explorer-bottom\s*\{\s*height:\s*34px/);
});

test('offline and incomplete sessions cannot show cached Explorer data', () => {
  const app = read('renderer/app.js');
  const html = read('index.html');
  assert.ok(html.includes('id="explorerPane" hidden'));
  assert.ok(html.includes('id="resizeDivider" hidden'));
  assert.ok(app.includes("$('explorerPane').hidden = !ready"));
  assert.ok(app.includes("$('codePanel').hidden = !ready || !selectedId"));
  assert.ok(app.includes("if (state.status.connected) for (const node of state.nodes)"));
  assert.ok(app.includes('if (!canMutate()) {\n    treeRows = [];'));
});

test('Studio creation leaves Lua source intact and allows duplicate sibling names', () => {
  const plugin = read('plugin/source/Services/HierarchyMutations.lua');
  const studio = read('plugin/source/Services/StudioBridge.lua');
  const app = read('renderer/app.js');
  assert.ok(plugin.includes('createdId = idFor(created)'));
  assert.ok(plugin.includes('copy.Name = target.Name'));
  assert.ok(!plugin.includes('copy.Name = uniqueName'));
  assert.ok(!plugin.includes('updateSource(created, "")'));
  assert.ok(studio.includes('return self:_idFor(target)'));
  assert.ok(app.includes("runMutation({ action: 'create', parentId, className, name: className })"));
  assert.ok(app.includes('pendingFocusMutations.set(reply.opId'));
});

test('same-name creation requests can be queued multiple times without a collision', async () => {
  const { BridgeServer } = require('../bridge/bridge-server.cjs');
  const os = require('node:os');
  const promises = require('node:fs/promises');
  const storageDir = await promises.mkdtemp(path.join(os.tmpdir(), 'cursor-same-name-'));
  const bridge = new BridgeServer({ storageDir, port: 0 });
  try {
    await bridge.start();
    bridge.pair({ code: bridge.pairingCode, studioRunId: 'duplicate-name-studio-test', placeKey: '1-2', placeName: 'Place' });
    await bridge.receiveChanges({ sequence: 1, ops: [
      { type: 'upsert', node: { id: 'ws', parentId: 'game', className: 'Workspace', name: 'Workspace' } },
      { type: 'upsert', node: { id: 'existing', parentId: 'ws', className: 'Script', name: 'Script', source: '' } },
      { type: 'ready' },
    ] });
    const a = await bridge.mutateHierarchy({ action: 'create', parentId: 'ws', className: 'Script', name: 'Script' });
    const b = await bridge.mutateHierarchy({ action: 'create', parentId: 'ws', className: 'Script', name: 'Script' });
    assert.notEqual(a.opId, b.opId);
    assert.equal(bridge.poll().commands.length, 2);
    await bridge.receiveChanges({ sequence: 2, ops: [
      { type: 'mutationResult', opId: a.opId, status: 'applied', results: [{ id: 'new-a', status: 'applied' }] },
      { type: 'upsert', node: { id: 'new-a', parentId: 'ws', className: 'Script', name: 'Script', source: '' } },
      { type: 'mutationResult', opId: b.opId, status: 'applied', results: [{ id: 'new-b', status: 'applied' }] },
      { type: 'upsert', node: { id: 'new-b', parentId: 'ws', className: 'Script', name: 'Script', source: '' } },
    ] });
    assert.deepEqual(['existing', 'new-a', 'new-b'].map((id) => bridge.nodes.get(id).name), ['Script', 'Script', 'Script']);
  } finally {
    await bridge.close();
    await promises.rm(storageDir, { recursive: true, force: true });
  }
});
