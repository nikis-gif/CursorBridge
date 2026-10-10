'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { BridgeServer } = require('../bridge/bridge-server.cjs');

async function setup() {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'cursor-sync-regression-'));
  const server = new BridgeServer({ storageDir: folder, port: 0 });
  await server.start();
  const send = async (ops, sequence, token) => {
    const response = await fetch(`http://127.0.0.1:${server.httpServer.address().port}/v1/changes`, {
      method: 'POST',
      headers: {'content-type': 'application/json', 'x-cursor-bridge': '1', authorization: `Bearer ${token}`},
      body: JSON.stringify({sequence, ops}),
    });
    assert.equal(response.status, 200, await response.text());
  };
  const paired = server.pair({code:server.pairingCode, studioRunId:'studio-sync-regression-12345',
    placeKey:'safe-100', placeName:'Safety Test'});
  await send([{type:'upsert', node:{id:'script-1', parentId:'game', name:'Main',
    className:'Script', source:'print("initial")'}}, {type:'ready'}],1,paired.token);
  return {server, send:(ops,sequence)=>send(ops,sequence,paired.token),
    cleanup:async()=>{await server.close();await fs.rm(folder,{recursive:true,force:true});}};
}

test('an old sync acknowledgment cannot delete a newer persisted draft', async () => {
  const {server, cleanup} = await setup();
  try {
    await server.saveDraft('script-1', 'local-v2');
    const deleted = await server.clearDraft('script-1', 'local-v1');
    assert.equal(deleted.ok, false);
    assert.equal((await server.getDraft('script-1')).source, 'local-v2');
    assert.equal((await server.clearDraft('script-1', 'local-v2')).ok, true);
    assert.equal(await server.getDraft('script-1'), null);
  } finally {await cleanup();}
});

test('pending disk saves and clears are processed in invocation order', async () => {
  const {server, cleanup} = await setup();
  try {
    const original = server.storage.saveDraft.bind(server.storage);
    let release;
    const blocked = new Promise((resolve) => {release = resolve;});
    server.storage.saveDraft = async (entry) => {
      if (entry.source === 'first') await blocked;
      return original(entry);
    };
    const first = server.saveDraft('script-1','first');
    const second = server.saveDraft('script-1','second');
    const outdatedClear = server.clearDraft('script-1','first');
    const third = server.saveDraft('script-1','final');
    release();
    await Promise.all([first,second,outdatedClear,third]);
    assert.equal((await server.getDraft('script-1')).source, 'final');
  } finally {await cleanup();}
});

test('Studio source notification arriving ahead of write result is an acknowledgment', async () => {
  const {server, send, cleanup} = await setup();
  try {
    const conflicts = [];
    server.on('event', (event)=> {if (event.type === 'conflict') conflicts.push(event);});
    assert.equal((await server.writeScript('script-1','print("local")',1)).status,'queued');
    const pending = server.nodes.get('script-1').pendingWrite;
    await send([{type:'source', id:'script-1', source:'print("local")'}],2);
    assert.equal(server.nodes.get('script-1').source,'print("local")');
    assert.equal(server.nodes.get('script-1').pendingWrite,null);
    assert.equal(conflicts.length,0);
    await send([{type:'result',id:'script-1',opId:pending.opId,status:'applied',source:'print("local")'}],3);
    assert.equal(server.nodes.get('script-1').revision,2);
    assert.equal(conflicts.length,0);
  } finally {await cleanup();}
});

test('two concurrent requests for one script do not discard the second edit', async () => {
  const {server, cleanup} = await setup();
  try {
    const first = server.writeScript('script-1','edit-A',1);
    const second = server.writeScript('script-1','edit-B',1);
    const [result1,result2] = await Promise.all([first,second]);
    assert.equal(result1.status,'queued');
    assert.equal(result2.status,'queued-behind-current');
    assert.equal(server.nodes.get('script-1').queuedSource,'edit-B');
    assert.equal(server.poll().commands.filter((item)=>item.type==='write').length,1);
  } finally {await cleanup();}
});

test('a rejected pending write cannot overwrite a newer recovery draft', async () => {
  const {server,send,cleanup} = await setup();
  try {
    await server.saveDraft('script-1','the-newest-local-code');
    assert.equal((await server.writeScript('script-1','an-earlier-local-code',1)).status,'queued');
    await send([{type:'source',id:'script-1',source:'studio-independent-edit'}],2);
    assert.equal((await server.getDraft('script-1')).source,'the-newest-local-code');
    assert.equal(server.nodes.get('script-1').source,'studio-independent-edit');
    assert.equal(server.nodes.get('script-1').pendingWrite,null);
    const versions = await server.listBackups('script-1');
    assert.ok(versions.some((item)=>item.reason==='unsent-write-recovered-after-conflict'));
  } finally {await cleanup();}
});

test('a delayed backup cannot queue a command after the script is replaced', async () => {
  const {server,cleanup} = await setup();
  try {
    const original = server.backup.bind(server);
    let release;
    const blocked = new Promise((resolve)=> {release=resolve;});
    server.backup = async (node,reason)=> {
      if (reason === 'before-app-edit') await blocked;
      return original(node,reason);
    };
    const writing = server.writeScript('script-1','stale-payload',1);
    await new Promise((resolve)=>setImmediate(resolve));
    server.nodes.get('script-1').revision = 2;
    server.nodes.get('script-1').source = 'newer source';
    release();
    const result = await writing;
    assert.equal(result.status,'conflict');
    assert.equal(server.poll().commands.filter((entry)=>entry.type==='write').length,0);
  } finally {await cleanup();}
});

test('drafts are recoverable by exact hierarchy path after reconnect changes instance IDs', async () => {
  const {server,send,cleanup} = await setup();
  try {
    await server.saveDraft('script-1','unsaved-before-studio-restart');
    await server.disconnect('reconnect-test');
    const paired = server.pair({code:server.pairingCode,studioRunId:'studio-new-run-123456789',
      placeKey:'safe-100',placeName:'Safety Test'});
    const response = await fetch(`http://127.0.0.1:${server.httpServer.address().port}/v1/changes`, {
      method:'POST',headers:{'content-type':'application/json','x-cursor-bridge':'1',
        authorization:`Bearer ${paired.token}`},
      body: JSON.stringify({sequence:1,ops:[
        {type:'upsert',node:{id:'script-new-id',parentId:'game',name:'Main',className:'Script',source:'studio-after-restart'}},
        {type:'ready'},
      ]}),
    });
    assert.equal(response.status,200);
    const oldDraft = await server.getDraft('script-new-id');
    assert.equal(oldDraft?.source,'unsaved-before-studio-restart');
    assert.equal(oldDraft?.fromPreviousSession,true);
  } finally {await cleanup();}
});

test('a draft already in flight can be preserved after Studio resets its tree', async () => {
  const {server,cleanup} = await setup();
  try {
    const oldSource = 'typed-before-disconnect';
    const originalPath = 'game/Main';
    await server.disconnect('reset-test');
    server.nodes.clear();
    await server.saveDraft('script-1',oldSource,originalPath,'safe-100');
    assert.equal((await server.storage.getDraft('safe-100','script-1')).source,oldSource);
  } finally {await cleanup();}
});

test('ambiguous duplicate hierarchy paths never choose an arbitrary previous draft', async () => {
  const {server,cleanup} = await setup();
  try {
    await server.storage.saveDraft({placeKey:'safe-100',scriptId:'another-id',
      nodePath:'game/Main',source:'different sibling source'});
    await server.saveDraft('script-1','first sibling source');
    const recovered = await server.storage.findDraftByPath('safe-100','fresh-id','game/Main');
    assert.equal(recovered,null);
  } finally {await cleanup();}
});
