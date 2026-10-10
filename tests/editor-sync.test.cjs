'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');

test('fast edit is never replaced by an older draft loaded asynchronously', async () => {
  const { createDocumentState, recordLocalEdit, canRestoreDraft } = await import('../renderer/editor-sync.mjs');
  const state = createDocumentState(1);
  const start = state.editVersion;
  assert.equal(canRestoreDraft(state, start, 'studio', 'studio', 'studio'), true);
  recordLocalEdit(state, 'local keystroke', 'studio');
  assert.equal(canRestoreDraft(state, start, 'local keystroke', 'studio', 'studio'), false);
});

test('authoritative Studio changes never overwrite unsynced local edits', async () => {
  const { createDocumentState, recordLocalEdit, reconcileSource } = await import('../renderer/editor-sync.mjs');
  const state = createDocumentState(1);
  recordLocalEdit(state, 'local-v1', 'remote-v1');
  assert.equal(reconcileSource(state, 'local-v1', 'remote-v1', 'remote-v2', 2, 'studio'), 'conflict');
  assert.equal(state.manualResolve, true);
  assert.equal(state.dirty, true);
  assert.equal(state.knownRevision, 1);
});

test('acknowledging an older edit while typing a newer edit is not a conflict', async () => {
  const { createDocumentState, recordLocalEdit, reconcileSource } = await import('../renderer/editor-sync.mjs');
  const state = createDocumentState(1);
  recordLocalEdit(state, 'edit-v1', 'initial');
  state.outboundSources.add('edit-v1');
  recordLocalEdit(state, 'edit-v2', 'initial');
  assert.equal(reconcileSource(state, 'edit-v2', 'initial', 'edit-v1', 2, 'studio'), 'outgoing-acknowledged');
  assert.equal(state.manualResolve, false);
  assert.equal(state.dirty, true);
  assert.equal(state.knownRevision, 2);
  assert.equal(reconcileSource(state, 'edit-v2', 'edit-v1', 'edit-v2', 3, 'cursor'), 'acknowledged');
  assert.equal(state.dirty, false);
});

test('clean model accepts remote changes and equal-content acknowledgments', async () => {
  const { createDocumentState, reconcileSource } = await import('../renderer/editor-sync.mjs');
  const state = createDocumentState(1);
  assert.equal(reconcileSource(state, 'a', 'a', 'b', 2), 'replace');
  assert.equal(state.knownRevision, 2);
  assert.equal(reconcileSource(state, 'b', 'b', 'b', 2), 'acknowledged');
});
