'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const modulePromise = import('../renderer/place-project-key.mjs');

test('published Place identity is stable across names and Studio sessions', async () => {
  const { projectKeyForPlace } = await modulePromise;
  assert.equal(projectKeyForPlace({ placeKey: '123-456', placeName: 'Baseplate1' }), '123-456');
  assert.equal(projectKeyForPlace({ placeKey: '123-456', placeName: 'Renamed' }), '123-456');
});
test('differently named unpublished Places have distinct local AI projects', async () => {
  const { projectKeyForPlace } = await modulePromise;
  assert.equal(projectKeyForPlace({ placeKey: '0-0', placeName: 'Baseplate1' }), 'unsaved:baseplate1');
  assert.equal(projectKeyForPlace({ placeKey: '0-0', placeName: 'Baseplate2' }), 'unsaved:baseplate2');
  assert.equal(projectKeyForPlace({ placeKey: '0-0', placeName: '  BASEPLATE1  ' }), 'unsaved:baseplate1');
});
test('offline or unknown Place never becomes a persistent project', async () => {
  const { projectKeyForPlace } = await modulePromise;
  assert.equal(projectKeyForPlace({ placeKey: 'offline' }), null);
  assert.equal(projectKeyForPlace({ placeKey: '' }), null);
  assert.equal(projectKeyForPlace(null), null);
  assert.equal(projectKeyForPlace({ placeKey: '0-0', placeName: '' }), null);
});

test('script context is limited to the currently connected Place', async () => {
  const { canUseScriptContext } = await modulePromise;
  const live = { connected: true, ready: true, placeKey: '123-456', placeName: 'Current' };
  assert.equal(canUseScriptContext('123-456', live), true);
  assert.equal(canUseScriptContext('789-456', live), false);
  assert.equal(canUseScriptContext('123-456', { ...live, ready: false }), false);
  assert.equal(canUseScriptContext('123-456', { ...live, connected: false }), false);
  assert.equal(canUseScriptContext('123-456', { ...live, protocolVersion: 1 }), false);
  assert.equal(canUseScriptContext('unsaved:baseplate1', { connected: true, ready: true, placeKey: '0-0', placeName: 'Baseplate1' }), true);
  assert.equal(canUseScriptContext('unsaved:baseplate2', { connected: true, ready: true, placeKey: '0-0', placeName: 'Baseplate1' }), false);
});
