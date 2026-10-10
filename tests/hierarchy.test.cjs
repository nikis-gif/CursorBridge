'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { BridgeServer } = require('../bridge/bridge-server.cjs');
const { prepareMutation, uniqueTopLevel, descendantsOf, sourceFingerprint } = require('../bridge/hierarchy-mutations.cjs');

const nodes = new Map([
  ['workspace', {id:'workspace', parentId:'game', className:'Workspace', name:'Workspace'}],
  ['folder', {id:'folder', parentId:'workspace', className:'Folder', name:'Systems'}],
  ['module', {id:'module', parentId:'folder', className:'ModuleScript', name:'Inventory', isScript:true, source:'return {}'}],
  ['script', {id:'script', parentId:'folder', className:'Script', name:'Main', isScript:true, source:'print(1)'}],
  ['nested', {id:'nested', parentId:'module', className:'Folder', name:'Nested'}],
]);

test('source checksum uses the UTF-8 byte sequence expected by Studio', () => {
  assert.equal(sourceFingerprint(''), '1:0');
  assert.equal(sourceFingerprint('A'), `${(66 * 65536 + 66)}:1`);
  assert.equal(sourceFingerprint('á').split(':')[1], '2', 'Unicode counts bytes, not JavaScript characters');
  assert.notEqual(sourceFingerprint('print(1)'), sourceFingerprint('print(2)'));
});

test('mutation validator guards root services, target caps and hierarchy cycles', () => {
  assert.deepEqual(uniqueTopLevel(nodes,['folder','module','folder','nested']), ['folder']);
  assert.deepEqual(descendantsOf(nodes,['folder']).map((n)=>n.id).sort(), ['folder','module','nested','script']);
  assert.throws(()=>prepareMutation(nodes,{action:'delete',ids:['workspace']}), /Built-in/);
  assert.throws(()=>prepareMutation(nodes,{action:'move',ids:['folder'],parentId:'nested'}), /descendant/);
  assert.equal(prepareMutation(nodes,{action:'create',parentId:'workspace',className:'Part',name:'X'}).className, 'Part');
  assert.throws(()=>prepareMutation(nodes,{action:'create',parentId:'workspace',className:'DataModel',name:'X'}), /not supported/);
  assert.throws(()=>prepareMutation(nodes,{action:'rename',ids:['module'],name:'\u0000'}), /control/);
  assert.throws(()=>prepareMutation(nodes,{action:'delete',ids:Array(51).fill('script')}), /1–50/);
  assert.equal(prepareMutation(nodes,{action:'create',parentId:'workspace',className:'Folder',name:'Code'}).destination.id, 'workspace');
  assert.deepEqual(prepareMutation(nodes,{action:'move',parentId:'workspace',ids:['module','script']}).targets.map((t)=>t.name), ['Inventory','Main']);
});

test('Explorer rows, order, shift ranges and nested selection are deterministic', async () => {
  const { buildExplorerRows, selectRange, uniqueRoots, isNodeInside, pathForNode } = await import('../renderer/explorer-model.mjs');
  const expanded = new Set(['workspace','folder']);
  const visible = buildExplorerRows(nodes,expanded).rows.map((r)=>r.id);
  assert.deepEqual(visible,['workspace','folder','module','script']);
  assert.deepEqual([...selectRange(visible,'module','script')],['module','script']);
  assert.equal(pathForNode(nodes,'script'),'game / Workspace / Systems / Main');
  assert.equal(isNodeInside(nodes,'module','folder'),true);
  assert.equal(isNodeInside(nodes,'folder','module'),false);
  assert.deepEqual(uniqueRoots(nodes,new Set(['module','nested','script'])),['module','script']);
  const filtered = buildExplorerRows(nodes,new Set(),'invent').rows.map((r)=>r.id);
  assert.deepEqual(filtered,['workspace','folder','module']);
});

async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'cursor-mutation-test-'));
  const bridge = new BridgeServer({storageDir:dir,port:0});
  await bridge.start();
  const request = async (endpoint,data,token) => {
    const response=await fetch(`http://127.0.0.1:${bridge.httpServer.address().port}/v1/${endpoint}`,{
      method:'POST',headers:{'content-type':'application/json','x-cursor-bridge':'1',authorization:`Bearer ${token || ''}`},body:JSON.stringify(data)});
    return {status:response.status,data:await response.json()};
  };
  const paired = await request('pair',{code:bridge.pairingCode,studioRunId:'studio-mutation-tests-123',placeKey:'1-2',placeName:'Actions'},null);
  assert.equal(paired.status,200);
  const token = paired.data.token;
  await request('changes',{sequence:1,ops:[
    {type:'upsert',node: {id:'workspace',parentId:'game',name:'Workspace',className:'Workspace'}},
    {type:'upsert',node: {id:'folder',parentId:'workspace',name:'Systems',className:'Folder'}},
    {type:'upsert',node: {id:'script',parentId:'folder',name:'Main',className:'Script',source:'print(1)'}},
    {type:'ready'},
  ]},token);
  return {bridge,request,token,dir,async cleanup(){await bridge.close();await fs.rm(dir,{recursive:true,force:true});}};
}

test('desktop requests send guarded mutation commands and wait for Studio acknowledgements', async () => {
  const h=await setup();
  try {
    const events=[];h.bridge.on('event',(e)=>events.push(e));
    const create=await h.bridge.mutateHierarchy({action:'create',parentId:'folder',className:'ModuleScript',name:'Util'});
    assert.equal(create.status,'queued');
    assert.equal(h.bridge.nodes.size,3,'desktop does not invent unconfirmed instances');
    let commands=(await h.request('poll',{},h.token)).data.commands;
    assert.equal(commands.length,1);
    assert.equal(commands[0].action,'create');
    assert.equal(commands[0].destination.name,'Systems');
    assert.equal(commands[0].opId,create.opId);
    await h.request('changes',{sequence:2,ops:[{type:'mutationResult',opId:create.opId,status:'applied',results:[{id:'folder',status:'applied',message:''}]}]},h.token);
    assert.equal(h.bridge.pendingMutations.size,0);
    assert.ok(events.some((event)=>event.type==='batch' && event.events.some((entry)=>entry.type==='mutation' && entry.status==='applied')));
    const moved=await h.bridge.mutateHierarchy({action:'move',ids:['script'],parentId:'workspace'});
    commands=(await h.request('poll',{},h.token)).data.commands;
    assert.equal(commands[0].targets[0].parentId,'folder');
    assert.equal(commands[0].destination.id,'workspace');
    await assert.rejects(()=>h.bridge.mutateHierarchy({action:'duplicate',ids:['script']}), /pending/);
    await h.request('changes',{sequence:3,ops:[{type:'mutationResult',opId:moved.opId,status:'conflict',results:[{id:'script',status:'conflict',message:'Reparented'}]}]},h.token);
    assert.equal(h.bridge.mutationLocks.size,0);
  } finally { await h.cleanup(); }
});

test('deletion saves code before Studio receives any destructive command', async () => {
  const h=await setup();
  try {
    const deletion=await h.bridge.mutateHierarchy({action:'delete',ids:['folder']});
    assert.equal(deletion.count,1);
    const versions=await h.bridge.listBackups('script');
    assert.ok(versions.some((version)=>version.reason==='before-app-delete'));
    const commands=(await h.request('poll',{},h.token)).data.commands;
    assert.equal(commands[0].action,'delete');
    assert.deepEqual(commands[0].targets.map((t)=>t.id),['folder']);
    assert.deepEqual(commands[0].protectedScripts,[{id:'script',fingerprint:sourceFingerprint('print(1)')}]);
    await h.request('changes',{sequence:2,ops:[{type:'mutationResult',opId:deletion.opId,status:'applied',results:[{id:'folder',status:'applied'}]},{type:'remove',id:'folder'}]},h.token);
    assert.equal(h.bridge.nodes.has('script'),false);
    assert.equal(h.bridge.nodes.has('folder'),false);
  } finally {await h.cleanup();}
});

test('disconnecting during a hierarchy command records uncertain outcome and releases lock',async()=>{
  const h=await setup();
  try {
    const events=[];h.bridge.on('event',(event)=>events.push(event));
    await h.bridge.mutateHierarchy({action:'rename',ids:['script'],name:'Renamed'});
    await h.bridge.disconnect('test');
    assert.equal(h.bridge.pendingMutations.size,0);
    assert.equal(h.bridge.mutationLocks.size,0);
    assert.ok(events.some((event)=>event.type==='mutation' && event.status==='unknown'));
  }finally{await h.cleanup();}
});

test('missing Studio source prevents destructive delete',async()=>{
  const h=await setup();
  try {
    const reply=await h.request('changes',{sequence:2,ops:[{type:'upsert',node:{id:'unknown',parentId:'folder',name:'Secret',className:'Script',sourceAvailable:false}}]},h.token);
    assert.equal(reply.status,200);
    await assert.rejects(()=>h.bridge.mutateHierarchy({action:'delete',ids:['folder']}),/unavailable script source/);
    assert.equal(h.bridge.pendingMutations.size,0);
  }finally{await h.cleanup();}
});


test('sibling order is retained across the actual bridge protocol and Paste Into queues the new parent', async () => {
  const h = await setup();
  try {
    const updated = await h.request('changes', {sequence: 2, ops: [
      {type:'upsert', node:{id:'folder',parentId:'workspace',name:'Systems',className:'Folder',siblingOrder:9}},
      {type:'upsert', node:{id:'script',parentId:'folder',name:'Main',className:'Script',siblingOrder:2}},
    ]}, h.token);
    assert.equal(updated.status, 200);
    assert.equal(h.bridge.nodes.get('folder').siblingOrder, 9);
    assert.equal(h.bridge.serializeNode(h.bridge.nodes.get('script')).siblingOrder, 2);
    const duplication = await h.bridge.mutateHierarchy({action:'duplicate',ids:['script'],parentId:'workspace'});
    assert.equal(duplication.status,'queued');
    const commands=(await h.request('poll',{},h.token)).data.commands;
    const command=commands.find((entry)=>entry.opId===duplication.opId);
    assert.equal(command.action,'duplicate');
    assert.equal(command.destination.id,'workspace');
    assert.equal(command.targets[0].id,'script');
    assert.equal(h.bridge.nodes.size,3,'duplicate appears only after Studio sends authoritative upsert');
    await h.request('changes',{sequence:3,ops:[
      {type:'mutationResult',opId:duplication.opId,status:'applied',results:[{id:'new-guid',status:'applied'}]},
      {type:'upsert',node:{id:'new-guid',parentId:'workspace',name:'Main',className:'Script',source:'print(1)',siblingOrder:10}},
    ]},h.token);
    assert.equal(h.bridge.nodes.get('new-guid').name,'Main','name collision allowed');
    assert.equal(h.bridge.nodes.get('new-guid').parentId,'workspace');
    assert.equal(h.bridge.pendingMutations.size,0);
  } finally {await h.cleanup();}
});
