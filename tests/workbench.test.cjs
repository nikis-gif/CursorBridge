'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { prepareMutation } = require('../bridge/hierarchy-mutations.cjs');

test('tab reordering preserves identities and stable relative order', async () => {
  const { moveTab } = await import('../renderer/workbench-commands.mjs');
  const original = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveTab(original, 'a', 'c'), ['b', 'a', 'c', 'd']);
  assert.deepEqual(moveTab(original, 'b', 'd', true), ['a', 'c', 'd', 'b']);
  assert.deepEqual(moveTab(original, 'b', 'b'), original);
  assert.deepEqual(original, ['a', 'b', 'c', 'd'], 'never mutates caller state');
});

test('clipboard copy and cut respect the Studio session and guard cycles', async () => {
  const { clipboardMutation } = await import('../renderer/workbench-commands.mjs');
  const nodes = new Map([
    ['ws', {id:'ws',parentId:'game',className:'Workspace',name:'Workspace'}],
    ['f', {id:'f',parentId:'ws',className:'Folder',name:'Folder'}],
    ['g', {id:'g',parentId:'f',className:'Folder',name:'Nested'}],
    ['s', {id:'s',parentId:'g',className:'Script',name:'Script'}],
  ]);
  const copy = {mode:'copy',ids:['s','s'],placeKey:'1-2'};
  const request = clipboardMutation(copy,nodes,'1-2','ws');
  assert.deepEqual(request,{action:'duplicate',ids:['s'],parentId:'ws'});
  assert.equal(prepareMutation(nodes,request).destination.id,'ws');
  const cut = {mode:'cut',ids:['f'],placeKey:'1-2'};
  assert.throws(()=>clipboardMutation(cut,nodes,'1-2','g'),/descendant/);
  assert.throws(()=>clipboardMutation(cut,nodes,'wrong','ws'),/another Studio session/);
  assert.deepEqual(clipboardMutation({mode:'cut',ids:['s'],placeKey:'1-2'},nodes,'1-2','ws'),
    {action:'move',ids:['s'],parentId:'ws'});
});

test('Explorer preserves Studio sibling order including nonalphabetical names', async () => {
  const {buildExplorerRows} = await import('../renderer/explorer-model.mjs');
  const nodes = new Map([
    ['ws',{id:'ws',className:'Workspace',name:'Workspace',parentId:'game',siblingOrder:1}],
    ['cam',{id:'cam',className:'Camera',name:'Camera',parentId:'ws',siblingOrder:1}],
    // GetChildren() can enumerate a user folder before Terrain; Studio keeps
    // built-in Camera and Terrain near the top of Workspace's Explorer tree.
    ['folder',{id:'folder',className:'Folder',name:'CursorViewport',parentId:'ws',siblingOrder:2}],
    ['terrain',{id:'terrain',className:'Terrain',name:'Terrain',parentId:'ws',siblingOrder:3}],
    ['world',{id:'world',className:'Folder',name:'World',parentId:'ws',siblingOrder:4}],
  ]);
  assert.deepEqual(buildExplorerRows(nodes,new Set(['ws'])).rows.map((r)=>r.id),
    ['ws','cam','terrain','folder','world']);
});

test('insert menu supported classes match Studio and server allowlists', async () => {
  const {INSERT_GROUPS} = await import('../renderer/workbench-commands.mjs');
  const fs=require('node:fs');
  const studio=fs.readFileSync(require('node:path').join(__dirname,'../plugin/source/Services/HierarchyMutations.lua'),'utf8');
  const nodes=new Map([['ws',{id:'ws',className:'Workspace',name:'Workspace',parentId:'game'}]]);
  for(const group of INSERT_GROUPS){
    for(const className of group.classes){
      assert.ok(studio.includes(`\t${className} = true,`),`Studio allowlist missing ${className}`);
      assert.equal(prepareMutation(nodes,{action:'create',parentId:'ws',className,name:className}).className,className);
    }
  }
});
