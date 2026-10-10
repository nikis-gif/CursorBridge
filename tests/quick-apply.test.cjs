'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { BridgeServer } = require('../bridge/bridge-server.cjs');
const { parseBundle, buildQuickApplyPlan, MAX_BUNDLE_BYTES } = require('../bridge/quick-apply.cjs');

const BOUNDARY = '='.repeat(50);
function block({ name, dest, status, className = null, source = '--!strict\nprint("ready")' }) {
  return [BOUNDARY, `SCRIPT: ${name}`, `PATH: ${dest}`, `STATUS: ${status}`,
    ...(className ? [`CLASS: ${className}`] : []), BOUNDARY, '', source, ''].join('\n');
}
const existing = block({ name: 'Main', dest: 'game/ServerScriptService/Main', status: 'MODIFIED',
  source: '--!strict\nprint("updated")' });
const created = block({ name: 'UI', dest: 'game/StarterGui/Widgets/UI', status: 'NEW',
  className: 'LocalScript', source: '--!strict\nprint("new")' });
const nodes = new Map([
  ['sss', { id: 'sss', parentId: 'game', name: 'ServerScriptService', className: 'ServerScriptService' }],
  ['sg', { id: 'sg', parentId: 'game', name: 'StarterGui', className: 'StarterGui' }],
  ['main', { id: 'main', parentId: 'sss', name: 'Main', className: 'Script', isScript: true,
    source: '--!strict\nprint("old")\n', revision: 2 }],
]);

test('parses the supplied TXT contract, BOM/CRLF, and optional class line', () => {
  const raw = '\uFEFF' + (existing + '\n' + created).replace(/\n/g, '\r\n');
  const entries = parseBundle(raw);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].source, '--!strict\nprint("updated")\n');
  assert.equal(entries[0].path, 'game/ServerScriptService/Main');
  assert.equal(entries[1].className, 'LocalScript');
  assert.equal(entries[1].status, 'NEW');
});

test('rejects garbage before first header, title-path mismatches, or missing strict mode', () => {
  assert.throws(() => parseBundle('Hello\n' + created), /before the first SCRIPT/);
  assert.throws(() => parseBundle(block({name:'A', dest:'game/Workspace/B', status:'NEW'})), /final PATH/);
  assert.throws(() => parseBundle(block({name:'Bad',dest:'game/Workspace/Bad',status:'NEW',source:'print(10)'})), /--!strict/);
  assert.throws(() => parseBundle('a'.repeat(MAX_BUNDLE_BYTES + 1)), /512 KiB/);
});

test('resolves exact existing script paths and missing folders for NEW', () => {
  const plan = buildQuickApplyPlan(existing + '\n' + created, nodes);
  assert.equal(plan.errors.length, 0);
  assert.deepEqual(plan.summary, {create:1, modify:1, unchanged:0, errors:0});
  assert.equal(plan.entries[0].scriptId, 'main');
  assert.equal(plan.entries[0].revision, 2);
  assert.deepEqual(plan.entries[1].missingFolders, ['Widgets']);
  assert.equal(plan.entries[1].anchorId, 'sg');
  assert.equal(plan.entries[1].className, 'LocalScript');
});

test('a NEW script uses Script by default and can be changed in preview', () => {
  const plain = block({name:'UI',dest:'StarterGui/UI',status:'NEW'});
  assert.equal(buildQuickApplyPlan(plain, nodes).entries[0].className,'Script');
  assert.equal(buildQuickApplyPlan(plain, nodes, {0:'ModuleScript'}).entries[0].className,'ModuleScript');
  assert.equal(buildQuickApplyPlan(plain, nodes, {0:'Folder'}).summary.errors,1);
});

test('duplicate names cannot cause MODIFIED to write into an arbitrary script', () => {
  const ambiguous = new Map(nodes);
  ambiguous.set('main2',{id:'main2',parentId:'sss',name:'Main',className:'Script',isScript:true,source:'--!strict\nprint(2)',revision:1});
  const plan = buildQuickApplyPlan(existing, ambiguous);
  assert.equal(plan.summary.errors,1);
  assert.match(plan.errors[0].message, /Ambiguous script path/);
  const different = block({name:'Main',dest:'game/ReplicatedStorage/Main',status:'MODIFIED'});
  assert.match(buildQuickApplyPlan(different,nodes).errors[0].message,/not found/i);
});

test('NEW can deliberately create a same-name script without replacing the existing one', () => {
  const repeat = block({name:'Main',dest:'game/ServerScriptService/Main',status:'NEW'});
  const preview = buildQuickApplyPlan(repeat,nodes);
  assert.equal(preview.entries[0].action,'create');
  assert.equal(preview.entries[0].duplicateName,true);
});

test('same script cannot be created and modified in a single ambiguous bundle', () => {
  const repeat = block({name:'Main',dest:'game/ServerScriptService/Main',status:'NEW'});
  assert.equal(buildQuickApplyPlan(existing + '\n' + repeat,nodes).summary.errors,1);
});

async function harness() {
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(),'cursor-qa-test-'));
  const bridge = new BridgeServer({storageDir,port:0});
  await bridge.start();
  const port = bridge.httpServer.address().port;
  const call = async (route,body,token) => {
    const response = await fetch(`http://127.0.0.1:${port}/v1/${route}`, {
      method:'POST',headers:{'content-type':'application/json','x-cursor-bridge':'1',
        ...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body),
    });
    return {status:response.status,data:await response.json()};
  };
  const pairing = (await call('pair',{code:bridge.pairingCode,studioRunId:'quick-apply-test-instance',
    placeKey:'101-202',placeName:'Quick Apply Test'},null)).data;
  await call('changes',{sequence:1,ops:[
    {type:'upsert',node:{id:'sss',parentId:'game',name:'ServerScriptService',className:'ServerScriptService'}},
    {type:'upsert',node:{id:'sg',parentId:'game',name:'StarterGui',className:'StarterGui'}},
    {type:'upsert',node:{id:'main',parentId:'sss',name:'Main',className:'Script',source:'--!strict\nprint("old")\n'}},
    {type:'ready'},
  ]},pairing.token);
  return {bridge,storageDir,token:pairing.token,call,
    async close(){await bridge.close();await fs.rm(storageDir,{recursive:true,force:true});}};
}

test('one-click batch queues one command and backs up every modified script plus the TXT',async()=>{
  const h=await harness();
  try {
    const preview=h.bridge.previewQuickApply(existing+'\n'+created);
    assert.equal(preview.ok,true);
    const result=await h.bridge.applyQuickApply(preview.token);
    assert.equal(result.count,2);
    assert.ok((await fs.stat(result.backupPath)).size>0);
    const versions=await h.bridge.listBackups('main');
    assert.ok(versions.some(v=>v.reason==='before-quick-apply'));
    const commands=(await h.call('poll',{},h.token)).data.commands;
    assert.equal(commands.length,1);
    assert.equal(commands[0].type,'quickApply');
    assert.equal(commands[0].entries.length,2);
    assert.equal(commands[0].entries[0].expectedSource,'--!strict\nprint("old")\n');
    await assert.rejects(h.bridge.applyQuickApply(preview.token),/pending Studio operations/);
    await assert.rejects(h.bridge.writeScript('main','--!strict\nprint(9)',1),/Quick Apply/);
    const event=[];
    h.bridge.on('event',eventData=>{for(const e of eventData.type==='batch'?eventData.events:[eventData]) if(e.type==='quickApply')event.push(e);});
    const answer=await h.call('changes',{sequence:2,ops:[{type:'quickApplyResult',opId:result.opId,
      status:'applied',results:[{index:0,status:'applied'},{index:1,status:'applied'}]}]},h.token);
    assert.equal(answer.status,200);
    assert.equal(event.at(-1).status,'applied');
    assert.equal((await h.call('poll',{},h.token)).data.commands.length,0);
  }finally{await h.close();}
});

test('stale preview cannot overwrite a Studio edit; session disconnect preserves unknown result',async()=>{
  const h=await harness();
  try {
    const first=h.bridge.previewQuickApply(existing);
    await h.call('changes',{sequence:2,ops:[{type:'source',id:'main',source:'--!strict\nprint("elsewhere")\n'}]},h.token);
    await assert.rejects(h.bridge.applyQuickApply(first.token),/since the preview/);
    const second=h.bridge.previewQuickApply(existing);
    const queued=await h.bridge.applyQuickApply(second.token);
    const events=[];
    h.bridge.on('event',e=>{if(e.type==='quickApply')events.push(e);});
    await h.bridge.disconnect('test network lost');
    assert.equal(events.at(-1).status,'unknown');
    assert.ok((await fs.stat(queued.backupPath)).size>0);
  }finally{await h.close();}
});

test('offline and all-unchanged bundles cannot enqueue mutations',async()=>{
  const h=await harness();
  try {
    const same=block({name:'Main',dest:'game/ServerScriptService/Main',status:'MODIFIED',
      source:'--!strict\nprint("old")'});
    const preview=h.bridge.previewQuickApply(same);
    assert.equal(preview.summary.unchanged,1);
    await assert.rejects(h.bridge.applyQuickApply(preview.token),/Nothing to apply/);
    await h.bridge.disconnect('test');
    assert.throws(()=>h.bridge.previewQuickApply(existing),/Connect Roblox Studio/);
  }finally{await h.close();}
});

test('two simultaneous applies cannot queue the same bundle twice while backup is in flight',async()=>{
  const h=await harness();
  try {
    const preview=h.bridge.previewQuickApply(existing);
    const original=h.bridge.storage.saveQuickApplyBundle.bind(h.bridge.storage);
    let unblock;
    const waiting=new Promise(resolve=>{unblock=resolve;});
    h.bridge.storage.saveQuickApplyBundle=async opts=>{await waiting;return original(opts);};
    const first=h.bridge.applyQuickApply(preview.token);
    await assert.rejects(h.bridge.applyQuickApply(preview.token),/pending Studio operations/);
    unblock();
    const queued=await first;
    assert.equal(queued.count,1);
    const commands=(await h.call('poll',{},h.token)).data.commands;
    assert.equal(commands.filter(command=>command.type==='quickApply').length,1);
  }finally{await h.close();}
});

test('expired preview, pending writes and modified script CLASS mismatch fail safely', async()=>{
  const h=await harness();
  try {
    const wronglyTyped=block({name:'Main',dest:'game/ServerScriptService/Main',status:'MODIFIED',
      className:'ModuleScript'});
    assert.match(h.bridge.previewQuickApply(wronglyTyped).errors[0].message,/does not match/);
    const preview=h.bridge.previewQuickApply(existing);
    h.bridge.quickApplyPreviews.get(preview.token).createdAt -= 6*60_000;
    await assert.rejects(h.bridge.applyQuickApply(preview.token),/Preview expired/);
    const next=h.bridge.previewQuickApply(existing);
    await h.bridge.writeScript('main','--!strict\nprint("unsynced")\n',1);
    await assert.rejects(h.bridge.applyQuickApply(next.token),/pending Studio operations/);
  }finally{await h.close();}
});

test('a nested existing ModuleScript can contain another Luau script',()=>{
  const nested=new Map(nodes);
  nested.set('parent-module',{id:'parent-module',parentId:'sss',name:'ParentModule',className:'ModuleScript',isScript:true,source:'--!strict\nreturn {}\n',revision:1});
  const inner=block({name:'Child',dest:'game/ServerScriptService/ParentModule/Child',status:'NEW',className:'ModuleScript'});
  const result=buildQuickApplyPlan(inner,nested);
  assert.equal(result.summary.errors,0);
  assert.equal(result.entries[0].anchorId,'parent-module');
  assert.equal(result.entries[0].action,'create');
});

test('NEW script paths that depend on another NEW script are rejected in preview',()=>{
  const parent=block({name:'Parent',dest:'game/ServerScriptService/Parent',status:'NEW'});
  const child=block({name:'Child',dest:'game/ServerScriptService/Parent/Child',status:'NEW'});
  const result=buildQuickApplyPlan(parent+'\n'+child,nodes);
  assert.equal(result.summary.errors,1);
  assert.match(result.errors[0].message,/Apply its creation first/);
});
