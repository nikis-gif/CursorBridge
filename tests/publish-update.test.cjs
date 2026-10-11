'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {publish,blobHash}=require('../scripts/publish-update.cjs');
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cursor-publish-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const bytes=Buffer.from('tested source\n');fs.writeFileSync(path.join(root,'test.cjs'),bytes);
  fs.writeFileSync(path.join(root,'update-manifest.json'),JSON.stringify({repository:'nikis-gif/CursorBridge',version:'0.2.9',files:[{
    path:'test.cjs',baseBlob:'old-blob',blob:blobHash(bytes),sha256:crypto.createHash('sha256').update(bytes).digest('hex')}]}));
  return {root,bytes};
}
function mock(bytes,options={}){
  const calls=[];let reads=0;
  const client=(args,data)=>{calls.push({args,data});const endpoint=args[3];
    if(endpoint.endsWith('git/ref/heads/main'))return {object:{sha:++reads>1&&options.concurrent?'other-head':'head'}};
    if(endpoint.endsWith('git/commits/head'))return {tree:{sha:'base-tree'}};
    if(endpoint.includes('git/trees/base-tree'))return {tree:[{path:'test.cjs',type:'blob',sha:options.already?blobHash(bytes):options.conflict?'different':'old-blob'}]};
    if(endpoint.endsWith('git/blobs'))return {sha:blobHash(bytes)};
    if(endpoint.endsWith('git/trees'))return {sha:'new-tree'};
    if(endpoint.endsWith('git/commits'))return {sha:'new-commit'};
    if(endpoint.includes('dispatches')&&options.dispatchFail)throw Error('Actions permission missing');
    return null;};return {calls,client};
}
test('publisher verifies files, commits as one fast-forward and requests release',t=>{
  const {root,bytes}=fixture(t);const {client,calls}=mock(bytes);const result=publish({root,client,log:()=>{}});
  assert.equal(result.sha,'new-commit');
  const patch=calls.find(c=>c.args[2]==='PATCH');assert.deepEqual(patch.data,{sha:'new-commit',force:false});
  assert.ok(calls.some(c=>c.args[3].includes('dispatches')));
});
test('publisher refuses locally modified source before making network calls',t=>{
  const {root,bytes}=fixture(t);const {client,calls}=mock(bytes);fs.appendFileSync(path.join(root,'test.cjs'),'changed');
  assert.throws(()=>publish({root,client,log:()=>{}}),/Local file changed/);assert.equal(calls.length,0);
});
test('publisher refuses conflicting remote files and concurrent branch changes',t=>{
  const {root,bytes}=fixture(t);
  for(const option of [{conflict:true},{concurrent:true}]){
    const {client,calls}=mock(bytes,option);assert.throws(()=>publish({root,client,log:()=>{}}),/changed/);
    assert.ok(!calls.some(c=>c.args[2]==='PATCH'));
  }
});
test('publisher is idempotent and does not create duplicate version tags',t=>{
  const {root,bytes}=fixture(t);const {client,calls}=mock(bytes,{already:true});
  assert.equal(publish({root,client,log:()=>{}}).changed,false);assert.ok(!calls.some(c=>c.args[2]==='POST'));
});
test('publisher reports source success separately from release dispatch failure',t=>{
  const {root,bytes}=fixture(t);const {client}=mock(bytes,{dispatchFail:true});const logs=[];
  assert.equal(publish({root,client,log:x=>logs.push(x)}).changed,true);
  assert.ok(logs.some(x=>x.includes('Source upload succeeded, but')));
});
