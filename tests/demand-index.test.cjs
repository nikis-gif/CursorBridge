'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { BridgeServer } = require('../bridge/bridge-server.cjs');

async function harness() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-demand-'));
  const bridge = new BridgeServer({storageDir:dir,port:0});
  await bridge.start();
  bridge.pair({code:bridge.pairingCode,studioRunId:'test-studio-hierarchy-2026',placeKey:'900-1',placeName:'Huge Place'});
  let seq=0;
  const changes=async ops=>bridge.receiveChanges({sequence:++seq,ops});
  await changes([{type:'reset'},{type:'scanBegin'},
    {type:'upsert',node:{id:'ws',name:'Workspace',parentId:'game',className:'Workspace',hasChildren:true}},
    {type:'ready'}]);
  return {bridge, changes, async close(){await bridge.close();await fs.rm(dir,{recursive:true,force:true});}};
}

test('millions of unvisited Studio nodes require no eager desktop mirror or cap',async()=>{
  const h=await harness();
  try {
    const {bridge,changes}=h;
    assert.equal(bridge.ready,true);
    assert.equal(bridge.nodes.size,1);
    assert.equal(bridge.requestChildren('ws').status,'loading');
    assert.equal(bridge.requestChildren('ws').status,'loading');
    const commands=bridge.poll().commands.filter(x=>x.type==='listChildren');
    assert.equal(commands.length,1);
    assert.equal(commands[0].offset,0);
    const first=Array.from({length:150},(_,i)=>({id:'part-'+i,parentId:'ws',name:'Part'+i,className:'Part',siblingOrder:i+1,hasChildren:false}));
    await changes([{type:'childrenPage',opId:commands[0].opId,parentId:'ws',offset:0,
      nextOffset:150,total:600000,children:first}]);
    assert.equal(bridge.nodes.size,151);
    assert.deepEqual(bridge.childPages.get('ws'),{offset:150,total:600000,complete:false});
    assert.equal(bridge.getState().childPages.ws.total,600000);
    assert.equal(bridge.requestChildren('ws').status,'loading');
    const second=bridge.poll().commands.find(x=>x.type==='listChildren');
    assert.equal(second.offset,150);
    const next=Array.from({length:150},(_,i)=>({id:'part-'+(i+150),parentId:'ws',name:'Part'+(i+150),className:'Part',siblingOrder:i+151,hasChildren:false}));
    await changes([{type:'childrenPage',opId:second.opId,parentId:'ws',offset:150,nextOffset:300,total:600000,children:next}]);
    assert.equal(bridge.nodes.size,301);
    assert.equal(bridge.getStatus().scanLimitReached,false);
    assert.equal(bridge.getStatus().ready,true);
  }finally{await h.close();}
});

test('Explorer refuses destructive changes to unknown branches until fully loaded',async()=>{
  const h=await harness();try {
    const {bridge,changes}=h;
    await changes([{type:'scanPaused',count:1}]);
    assert.equal(bridge.getStatus().onDemand,true);
    await changes([{type:'upsert',node:{id:'folder',parentId:'ws',name:'Folder',className:'Folder',hasChildren:true}}]);
    await assert.rejects(bridge.mutateHierarchy({action:'delete',ids:['folder']}),/fully load/i);
    bridge.requestChildren('ws');const req=bridge.poll().commands.find(c=>c.type==='listChildren');
    await changes([{type:'childrenPage',parentId:'ws',offset:0,nextOffset:1,total:1,opId:req.opId,
      children:[{id:'folder',parentId:'ws',name:'Folder',className:'Folder',hasChildren:true}]}]);
    await assert.rejects(bridge.mutateHierarchy({action:'delete',ids:['folder']}),/fully load/i);
    bridge.requestChildren('folder');const req2=bridge.poll().commands.find(c=>c.type==='listChildren');
    await changes([{type:'childrenPage',parentId:'folder',offset:0,nextOffset:1,total:1,opId:req2.opId,
      children:[{id:'part',parentId:'folder',name:'Part',className:'Part',hasChildren:false}]}]);
    assert.equal(bridge.isSubtreeFullyIndexed('folder'),true);
    const mutation=await bridge.mutateHierarchy({action:'delete',ids:['folder']});
    assert.equal(mutation.status,'queued');
  }finally{await h.close();}
});

test('invalid or unsolicited hierarchy pages do not inject instances',async()=>{
  const h=await harness();try{
    const {bridge,changes}=h;
    await changes([{type:'childrenPage',parentId:'ws',offset:0,nextOffset:1,total:1,opId:'fake',
      children:[{id:'evil',parentId:'ws',name:'Evil',className:'Part'}]}]);
    assert.equal(bridge.nodes.has('evil'),false);
    bridge.requestChildren('ws');const request=bridge.poll().commands.find(c=>c.type==='listChildren');
    await assert.rejects(changes([{type:'childrenPage',parentId:'ws',offset:0,nextOffset:1,total:1,
      opId:request.opId,children:[{id:'wrong',parentId:'game',name:'Wrong',className:'Part'}]}]),/another parent/i);
    assert.equal(bridge.nodes.has('wrong'),false);
  }finally{await h.close();}
});

test('Quick Apply in a large Place requires completely loaded target paths',async()=>{
  const h=await harness();
  try{
    const {bridge,changes}=h;
    await changes([{type:'scanPaused',count:1}]);
    const bundle=['='.repeat(50),'SCRIPT: NewScript','PATH: game/Workspace/NewScript',
      'STATUS: NEW','CLASS: Script','='.repeat(50),'','--!strict','print("hello")',''].join('\n');
    assert.throws(()=>bridge.previewQuickApply(bundle),/fully load the destination/);
    bridge.requestChildren('ws');
    const req=bridge.poll().commands.find(x=>x.type==='listChildren');
    await changes([{type:'childrenPage',opId:req.opId,parentId:'ws',offset:0,nextOffset:1,total:1,
      children:[{id:'part',parentId:'ws',name:'Part',className:'Part',hasChildren:false}]}]);
    const preview=bridge.previewQuickApply(bundle);
    assert.equal(preview.ok,true);
    assert.equal(preview.summary.create,1);
  }finally{await h.close();}
});
