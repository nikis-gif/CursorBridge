'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { BridgeServer } = require('../bridge/bridge-server.cjs');

// Model a large Studio Place without downloading Roblox data or starting a game.
test('progressive indexing retains 100,000 instances without silent truncation', { timeout: 120_000 }, async () => {
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cursor-large-place-'));
  const bridge = new BridgeServer({ storageDir, port: 0 });
  try {
    await bridge.start();
    bridge.pair({ code: bridge.pairingCode, studioRunId: 'large-place-load-test-studio', placeKey: '999-1000', placeName: 'Large Place' });
    let sequence = 0;
    await bridge.receiveChanges({ sequence: ++sequence, ops: [
      { type: 'reset' }, { type: 'scanBegin' },
      { type: 'upsert', node: { id: 'ws', parentId: 'game', name: 'Workspace', className: 'Workspace' } },
      { type: 'ready' },
    ] });
    assert.equal(bridge.ready, true);
    assert.equal(bridge.getStatus().indexing, true);
    const started = performance.now();
    let scriptId;
    for (let start = 0; start < 100_000; start += 350) {
      const ops = [];
      for (let i = start; i < Math.min(100_000, start + 350); i++) {
        const isScript = i % 1000 === 0;
        const id = `node-${i}`;
        if (isScript && !scriptId) scriptId = id;
        ops.push({ type: 'upsert', node: {
          id, parentId: 'ws', name: isScript ? `Script${i}` : `Part${i}`,
          className: isScript ? 'Script' : 'Part', siblingOrder: i + 1,
          ...(isScript ? { sourceAvailable: false } : {}),
        } });
      }
      await bridge.receiveChanges({ sequence: ++sequence, ops });
    }
    await bridge.receiveChanges({ sequence: ++sequence, ops: [
      { type: 'scanProgress', count: 100_001 },
      { type: 'scanComplete', count: 100_001 },
    ] });
    assert.equal(bridge.nodes.size, 100_001);
    assert.equal(bridge.getStatus().scanComplete, true);
    assert.equal(bridge.getStatus().indexing, false);
    assert.equal(bridge.getStatus().scanLimitReached, false);
    assert.equal(bridge.scriptNodeCount, 100);
    const id = scriptId;
    assert.equal(bridge.requestSource(id).status, 'loading');
    assert.ok(bridge.poll().commands.some((command) => command.type === 'loadSource' && command.scriptId === id));
    await bridge.receiveChanges({ sequence: ++sequence, ops: [
      { type: 'source', id, source: 'print("loaded on demand")' },
    ] });
    assert.equal(bridge.requestSource(id).status, 'ready');
    assert.equal(bridge.session.sourceRequests.size, 0);
    assert.equal(bridge.sourceReadyCount, 1);
    assert.ok(performance.now() - started < 60_000, '100k in-memory indexing should not take a minute');
    await bridge.saveSnapshot();
    const recovered = await bridge.storage.loadRecoverySnapshot();
    assert.equal(recovered.nodes.length, 100_001);
    assert.equal(recovered.nodes.at(-1).id, 'node-99999');
  } finally {
    await bridge.close();
    await fs.rm(storageDir, { recursive: true, force: true });
  }
});

test('partial scans disallow destructive operations and Quick Apply', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cursor-progress-safe-'));
  const bridge = new BridgeServer({storageDir: root, port: 0});
  try {
    await bridge.start();
    bridge.pair({code: bridge.pairingCode, studioRunId: 'studio-large-safety-test', placeKey: '7-9', placeName: 'Safety'});
    await bridge.receiveChanges({sequence:1, ops:[
      {type:'reset'}, {type:'scanBegin'},
      {type:'upsert',node:{id:'ws',parentId:'game',name:'Workspace',className:'Workspace'}},
      {type:'upsert',node:{id:'part',parentId:'ws',name:'Part',className:'Part'}},
      {type:'ready'},
    ]});
    await assert.rejects(bridge.mutateHierarchy({action:'delete',ids:['part']}), /full hierarchy scan/);
    assert.throws(() => bridge.previewQuickApply(''), /complete hierarchy/);
    await bridge.receiveChanges({sequence:2,ops:[{type:'scanLimit',count:250000}]});
    assert.equal(bridge.getStatus().scanLimitReached,true);
    assert.equal(bridge.getStatus().scanComplete,false);
  } finally {
    await bridge.close();
    await fs.rm(root,{recursive:true,force:true});
  }
});
