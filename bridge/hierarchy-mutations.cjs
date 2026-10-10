'use strict';

// Desktop mutations are requests, never direct edits of the mirrored tree.
// Studio remains the authority and verifies the optimistic metadata again.
// Deliberately explicit allowlist: prevents arbitrary service creation or unsafe classes.
const MUTABLE_CLASSES = new Set([
  'Script', 'LocalScript', 'ModuleScript', 'Folder', 'Model', 'Part',
  'MeshPart', 'SpawnLocation', 'Attachment', 'Configuration',
  'RemoteEvent', 'RemoteFunction', 'BindableEvent', 'BindableFunction',
  'BoolValue', 'IntValue', 'NumberValue', 'StringValue', 'ObjectValue',
  'ScreenGui', 'Frame', 'TextLabel', 'TextButton', 'ImageLabel',
  'ImageButton', 'UIListLayout', 'UICorner', 'UIPadding',
  'Sound', 'Animation',
]);
const ACTIONS = new Set(['create', 'rename', 'duplicate', 'move', 'delete']);
const MAX_TARGETS = 50;
const MAX_BACKUP_SCRIPTS = 200;

function reject(message) { throw new Error(message); }

function validName(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 100 || /[\u0000-\u001f\u007f]/u.test(value)) {
    reject('Name must be 1–100 characters without control characters.');
  }
  return value;
}

function isDescendant(nodes, candidateId, parentId) {
  const visited = new Set();
  let current = nodes.get(candidateId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    if (current.parentId === parentId) return true;
    current = nodes.get(current.parentId);
  }
  return false;
}

function uniqueTopLevel(nodes, ids) {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_TARGETS ||
      ids.some((id) => typeof id !== 'string')) reject(`Select 1–${MAX_TARGETS} existing instances.`);
  const unique = [...new Set(ids)];
  if (unique.some((id) => !nodes.has(id))) reject('The selection changed in Studio. Refresh the Explorer.');
  const selected = new Set(unique);
  return unique.filter((id) => {
    const visited = new Set();
    let current = nodes.get(id);
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      if (selected.has(current.parentId)) return false;
      current = nodes.get(current.parentId);
    }
    return true;
  });
}

function sourceFingerprint(source) {
  const bytes = Buffer.from(source, 'utf8');
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return `${(b * 65536 + a)}:${bytes.length}`;
}

function snapshot(node) {
  return { id: node.id, parentId: node.parentId, name: node.name, className: node.className };
}

function prepareMutation(nodes, request) {
  if (!request || !ACTIONS.has(request.action)) reject('Unsupported Explorer operation.');
  const { action } = request;
  let targets = [];
  let destination;
  if (action !== 'create') {
    const top = uniqueTopLevel(nodes, request.ids);
    if (action === 'rename' && (request.ids.length !== 1 || top.length !== 1)) reject('Rename exactly one instance.');
    targets = top.map((id) => {
      const node = nodes.get(id);
      if (node.parentId === 'game') reject('Built-in Roblox services cannot be changed from Cursor Bridge.');
      return snapshot(node);
    });
  }
  if (action === 'create' || action === 'move' || (action === 'duplicate' && request.parentId != null)) {
    const parent = nodes.get(request.parentId);
    if (!parent) reject('Choose a destination in the connected Studio hierarchy.');
    if (typeof parent.className !== 'string' || parent.parentId === undefined) reject('Invalid destination.');
    destination = snapshot(parent);
    if (action === 'move') {
      for (const target of targets) {
        if (target.id === destination.id || isDescendant(nodes, destination.id, target.id)) {
          reject('Cannot move an instance into itself or one of its descendants.');
        }
      }
    }
  }
  let name;
  let className;
  if (action === 'create' || action === 'rename') name = validName(request.name);
  if (action === 'create') {
    if (!MUTABLE_CLASSES.has(request.className)) reject('This instance class is not supported by Cursor Bridge.');
    className = request.className;
  }
  return { action, targets, destination, name, className };
}

function descendantsOf(nodes, ids) {
  const byParent = new Map();
  for (const node of nodes.values()) {
    if (!byParent.has(node.parentId)) byParent.set(node.parentId, []);
    byParent.get(node.parentId).push(node);
  }
  const collected = [];
  const visited = new Set();
  const pending = [...ids];
  while (pending.length) {
    const id = pending.pop();
    if (visited.has(id)) continue;
    visited.add(id);
    const node = nodes.get(id);
    if (node) collected.push(node);
    for (const child of byParent.get(id) || []) pending.push(child.id);
  }
  return collected;
}

module.exports = { MUTABLE_CLASSES, MAX_TARGETS, MAX_BACKUP_SCRIPTS, validName, sourceFingerprint, isDescendant, uniqueTopLevel, prepareMutation, descendantsOf };
