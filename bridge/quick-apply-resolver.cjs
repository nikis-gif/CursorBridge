'use strict';

const { randomUUID } = require('node:crypto');
const { parseBundle, buildQuickApplyPlan, publicPreview } = require('./quick-apply.cjs');
const limits = require('../shared/limits.json');

function cancelResolution(bridge, message) {
  const pending = bridge.pathResolution;
  if (!pending) return;
  bridge.pathResolution = null;
  clearTimeout(pending.timer);
  pending.reject(new Error(message));
}

function startResolution(bridge, text, overrides) {
  const entries = parseBundle(text);
  if (!overrides || Array.isArray(overrides) || typeof overrides !== 'object') throw new Error('Invalid script type overrides.');
  if (bridge.pendingQuickApply || bridge.quickApplyPreparing) throw new Error('Wait for the current Quick Apply to finish.');
  cancelResolution(bridge, 'A newer preview replaced this request.');
  bridge.quickApplyPreviews.clear();
  const opId = randomUUID(), session = bridge.session;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (bridge.pathResolution?.opId === opId) cancelResolution(bridge,
        'Studio did not finish resolving paths within five minutes. Your TXT is preserved. Retry when Studio responds.');
    }, 5 * 60_000);
    timer.unref?.();
    bridge.pathResolution = { opId, session, text, overrides, resolve, reject, timer,
      command: {type:'resolvePaths', opId,
        paths:entries.map(({index,path,status,segments}) => ({index,path,status,segments}))} };
    bridge.emitWorkspaceEvent({type:'quickApplyProgress', message:'Resolving exact paths in Roblox Studio...'});
  });
}

async function acceptResolution(bridge, op) {
  const pending = bridge.pathResolution;
  if (!pending || pending.opId !== op.opId || pending.session !== bridge.session) return;
  if (op.error) { cancelResolution(bridge, String(op.error).slice(0,500)); return; }
  try {
    if (!Array.isArray(op.nodes) || op.nodes.length > limits.maxScripts * 30 ||
        !Array.isArray(op.errors) || op.errors.length > limits.maxScripts) throw new Error('Invalid resolved path response.');
    const resolved = new Map();
    let bytes = 0;
    for (const node of op.nodes) {
      if (!node || typeof node.id !== 'string' || typeof node.parentId !== 'string' ||
          typeof node.name !== 'string' || typeof node.className !== 'string') throw new Error('Invalid resolved instance.');
      bytes += typeof node.source === 'string' ? Buffer.byteLength(node.source, 'utf8') : 0;
      if (bytes > limits.maxResolvedSourceBytes) throw new Error('Existing destination sources exceed 16 MiB. Split the bundle.');
      if (pending.session !== bridge.session || bridge.pathResolution !== pending) return;
      await bridge.applyOperation({type:'upsert',node});
      resolved.set(node.id, {...bridge.nodes.get(node.id)});
    }
    if (bridge.pathResolution !== pending || pending.session !== bridge.session) return;
    const plan = buildQuickApplyPlan(pending.text, resolved, pending.overrides);
    for (const problem of op.errors) {
      if (!Number.isSafeInteger(problem.index) || !plan.entries[problem.index]) throw new Error('Invalid path error index.');
      const entry = plan.entries[problem.index];
      entry.action = 'error';
      entry.message = String(problem.message || 'Studio could not resolve this path.').slice(0,500);
    }
    plan.errors = plan.entries.filter(entry => entry.action === 'error').map(({index,path,message}) => ({index,path,message}));
    plan.summary = {create:0,modify:0,unchanged:0,errors:plan.errors.length};
    for (const entry of plan.entries) if (entry.action !== 'error') plan.summary[entry.action]++;
    clearTimeout(pending.timer);
    bridge.pathResolution = null;
    const token = randomUUID();
    bridge.quickApplyPreviews.clear();
    bridge.quickApplyPreviews.set(token, {...plan,text:pending.text,token,resolved:true,
      createdAt:bridge.now(),sessionId:bridge.session.sessionId});
    pending.resolve({ok:plan.errors.length === 0,token,...publicPreview(plan),placeName:bridge.session.placeName});
  } catch (error) {
    if (bridge.pathResolution === pending) cancelResolution(bridge, error.message);
  }
}

function validateResolvedPreview(bridge, preview) {
  for (const entry of preview.entries) {
    for (const guard of entry.guards || []) {
      const current = bridge.nodes.get(guard.id);
      if (!current || current.parentId !== guard.parentId || current.name !== guard.name || current.className !== guard.className) {
        throw new Error('A destination changed since preview. Preview the bundle again.');
      }
    }
    if (entry.scriptId) {
      const node = bridge.nodes.get(entry.scriptId);
      if (!node || node.revision !== entry.revision || node.source !== entry.expectedSource ||
          node.pendingWrite || typeof node.queuedSource === 'string') throw new Error('A destination source changed since preview. Preview the bundle again.');
    }
  }
  return preview;
}
module.exports = {startResolution,acceptResolution,cancelResolution,validateResolvedPreview};
