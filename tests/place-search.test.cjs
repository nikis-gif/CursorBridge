'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
let codeSearch, quickOpen;
async function modules() {
  codeSearch ??= await import('../renderer/place-search.mjs');
  quickOpen ??= await import('../renderer/quick-open.mjs');
  return { ...codeSearch,...quickOpen };
}
const scripts = [
  {id:'s1',name:'Main',className:'Script',path:'game.ServerScriptService.Main',source:'local Hello = 1\nprint(Hello)\nhello(Hello)'},
  {id:'s2',name:'Main',className:'LocalScript',path:'game.StarterPlayer.Main',source:'local Helium = 2\n-- Hello to you'},
  {id:'s3',name:'Helpers',className:'ModuleScript',path:'game.ReplicatedStorage.Helpers',source:'return {hello = true}'},
];
test('Find in Place counts matches and groups by exact instance identity, including repeated names',async()=>{
  const {searchScripts}=await modules();
  const response=searchScripts(scripts,'Hello');
  assert.equal(response.fileCount,3);
  assert.equal(response.matchCount,6);
  assert.deepEqual(response.groups.map(g=>g.id),['s1','s2','s3']);
  assert.deepEqual(response.groups[0].matches.map(m=>m.line),[1,2,3,3]);
});
test('case, whole word and regular expression modes are independent',async()=>{
  const {searchScripts}=await modules();
  assert.equal(searchScripts(scripts,'hello',{matchCase:true}).matchCount,2);
  assert.equal(searchScripts(scripts,'hello',{matchCase:true,wholeWord:true}).matchCount,2);
  assert.equal(searchScripts(scripts,'Hel',{matchCase:false,wholeWord:true}).matchCount,0);
  assert.equal(searchScripts(scripts,'Hel.*\\s?=\\s?\\d',{regex:true}).matchCount,2);
});
test('regex errors are reported, no empty matching loops, bounded results',async()=>{
  const {searchScripts}=await modules();
  assert.match(searchScripts(scripts,'(',{regex:true}).error,/Invalid regular expression/);
  assert.equal(searchScripts(scripts,'^',{regex:true}).matchCount,0);
  const capped=searchScripts(scripts,'Hello',{},2);
  assert.equal(capped.matchCount,2);
  assert.equal(capped.truncated,true);
});
test('search reports correct line/column and does not match across lines',async()=>{
  const {searchScripts}=await modules();
  const result=searchScripts([{id:'x',name:'X',path:'game.X',source:'first\r\n  abc abc\nlast'}],'abc');
  assert.deepEqual(result.groups[0].matches.map(m=>[m.line,m.column,m.length]),[[2,3,3],[2,7,3]]);
  assert.equal(searchScripts(scripts,'1\\nprint',{regex:true}).matchCount,0);
});
test('preview safely truncates long source lines around the match',async()=>{
  const {matchPreview}=await modules();
  const value=matchPreview('x'.repeat(120)+'Target'+'y'.repeat(120),121,6,70);
  assert.equal(value.matched,'Target');
  assert.ok(value.before.startsWith('…'));
  assert.ok(value.after.endsWith('…'));
});
test('Quick Open ranks exact filename above path matches and preserves duplicate identities',async()=>{
  const {quickOpenMatches,parseQuickOpenQuery}=await modules();
  assert.deepEqual(quickOpenMatches(scripts,'Main').map(m=>m.id),['s1','s2']);
  assert.equal(quickOpenMatches(scripts,'Repl Help')[0].id,'s3');
  assert.equal(quickOpenMatches(scripts,'Man').length,2);
  assert.deepEqual(parseQuickOpenQuery('Main:24:7'),{query:'Main',line:24,column:7});
  assert.deepEqual(parseQuickOpenQuery('Main'),{query:'Main',line:null,column:1});
});
test('Search never evaluates or changes source content',async()=>{
  const {searchScripts}=await modules();
  const before=JSON.stringify(scripts);
  assert.equal(searchScripts(scripts,'return').matchCount,1);
  assert.equal(JSON.stringify(scripts),before);
});
