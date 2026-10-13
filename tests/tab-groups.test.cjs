'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const helper = import('../renderer/tab-groups.mjs');

test('pinned secondary document does not duplicate an unrelated primary tab', async () => {
  const { primaryTabIds } = await helper;
  assert.deepEqual(primaryTabIds(['inventory', 'datastore', 'ui'], 'inventory', 'datastore'), ['inventory', 'ui']);
});
test('shared document appears as primary when both views show it', async () => {
  const { primaryTabIds } = await helper;
  assert.deepEqual(primaryTabIds(['inventory', 'ui'], 'inventory', 'inventory'), ['inventory', 'ui']);
});
test('closing secondary editor restores all script tabs', async () => {
  const { primaryTabIds } = await helper;
  assert.deepEqual(primaryTabIds(['inventory', 'datastore'], 'inventory', null), ['inventory', 'datastore']);
});
test('tab projection never mutates editor ownership', async () => {
  const { primaryTabIds } = await helper;
  const tabs = ['one', 'two', 'three'];
  primaryTabIds(tabs, 'one', 'two');
  assert.deepEqual(tabs, ['one', 'two', 'three']);
});
