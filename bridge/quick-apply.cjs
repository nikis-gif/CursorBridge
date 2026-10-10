'use strict';

const { MAX_SCRIPT_BYTES } = require('./bridge-server-constants.cjs');

const BOUNDARY = '='.repeat(50);
const MAX_BUNDLE_BYTES = 512 * 1024;
const MAX_SCRIPTS = 20;
const SCRIPT_CLASSES = new Set(['Script', 'LocalScript', 'ModuleScript']);
const HEADER = /^={50}\nSCRIPT: ([^\n]+)\nPATH: ([^\n]+)\nSTATUS: (NEW|MODIFIED)\n(?:CLASS: (Script|LocalScript|ModuleScript)\n)?={50}\n/gm;

function error(message) { throw new Error(message); }

function parseBundle(raw) {
  if (typeof raw !== 'string' || !raw.trim()) error('Paste an AI script bundle before previewing.');
  if (Buffer.byteLength(raw, 'utf8') > MAX_BUNDLE_BYTES) error('Bundle exceeds the 512 KiB safety limit.');
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const markers = [...text.matchAll(HEADER)];
  if (!markers.length) {
    error('No valid script headers. Expected 50 equals signs, SCRIPT, PATH, STATUS, and 50 equals signs.');
  }
  if (markers.length > MAX_SCRIPTS) error(`A bundle can contain at most ${MAX_SCRIPTS} scripts.`);
  if (text.slice(0, markers[0].index).trim()) error('Remove text before the first SCRIPT header.');
  const entries = [];
  for (let index = 0; index < markers.length; index++) {
    const match = markers[index];
    const afterHeader = match.index + match[0].length;
    const beforeNext = markers[index + 1]?.index ?? text.length;
    const code = text.slice(afterHeader, beforeNext).replace(/^\n+/, '').replace(/\n+$/, '');
    if (!code.startsWith('--!strict\n') && code !== '--!strict') {
      error(`Script ${index + 1} (${match[1]}): the first code line must be --!strict.`);
    }
    if (code === '--!strict') error(`Script ${index + 1}: source is empty after --!strict.`);
    const source = code + '\n';
    if (Buffer.byteLength(source, 'utf8') > MAX_SCRIPT_BYTES) {
      error(`Script ${index + 1} (${match[1]}): source exceeds 256 KiB.`);
    }
    const name = match[1];
    const rawPath = match[2];
    if (!name || name.trim() !== name || name.length > 100 || /[\x00-\x1f\x7f/]/.test(name)) {
      error(`Script ${index + 1}: invalid SCRIPT name.`);
    }
    if (rawPath !== rawPath.trim() || rawPath.length > 2000 || rawPath.includes('\\')) {
      error(`Script ${index + 1}: PATH must use / separators without surrounding spaces.`);
    }
    const segments = rawPath.split('/');
    if (segments[0] === 'game') segments.shift();
    if (segments.length < 2 || segments.length > 30 || segments.some((part) => !part || part.trim() !== part ||
      part.length > 100 || part === '.' || part === '..' || /[\x00-\x1f\x7f]/.test(part))) {
      error(`Script ${index + 1}: expected game/Service/Folder/Script or Service/Script.`);
    }
    if (segments.at(-1) !== name) error(`Script ${index + 1}: SCRIPT must match the final PATH segment exactly.`);
    entries.push({ index, name, path: `game/${segments.join('/')}`, segments, status: match[3],
      className: match[4] || null, source });
  }
  return entries;
}

function snapshot(node) {
  return { id: node.id, parentId: node.parentId, name: node.name, className: node.className };
}

function buildQuickApplyPlan(raw, nodes, classOverrides = {}) {
  const parsed = parseBundle(raw);
  if (!classOverrides || Array.isArray(classOverrides) || typeof classOverrides !== 'object') {
    error('Invalid script type overrides.');
  }
  const children = new Map();
  for (const node of nodes.values()) {
    const key = node.parentId;
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(node);
  }
  const entries = [];
  const errors = [];
  const seenModified = new Set();
  const allPaths = new Set(parsed.filter((p) => p.status === 'NEW').map((p) => p.path));
  for (const entry of parsed) {
    try {
      const selectedClass = classOverrides[entry.index] ?? entry.className ?? 'Script';
      if (!SCRIPT_CLASSES.has(selectedClass) || (entry.status === 'MODIFIED' && entry.className && entry.className !== selectedClass)) {
        error('Only Script, LocalScript, and ModuleScript are supported.');
      }
      let currentParentId = 'game';
      const guards = [];
      const missingFolders = [];
      for (let i = 0; i < entry.segments.length - 1; i++) {
        const component = entry.segments[i];
        if (missingFolders.length) {
          missingFolders.push(component);
          continue;
        }
        const siblings = (children.get(currentParentId) || []).filter((child) => child.name === component);
        if (siblings.length !== 1) {
          if (siblings.length > 1) error(`Ambiguous folder: ${component}. Multiple instances have that name.`);
          if (i === 0) error(`Roblox service ${component} was not found in this Place.`);
          if (entry.status === 'MODIFIED') error(`Parent ${component} does not exist. Use STATUS: NEW to create it.`);
          missingFolders.push(component);
          continue;
        }
        const parent = siblings[0];
        if (i === 0 && parent.parentId !== 'game') error(`The path must begin with a Roblox service.`);
        guards.push(snapshot(parent));
        currentParentId = parent.id;
      }
      if (!guards.length) error('Path does not identify an existing Roblox service.');
      const parent = nodes.get(currentParentId);
      const leafMatches = missingFolders.length ? [] :
        (children.get(currentParentId) || []).filter((node) => node.name === entry.name);
      if (entry.status === 'MODIFIED') {
        if (seenModified.has(entry.path)) error('This script has already been included as MODIFIED.');
        seenModified.add(entry.path);
        if (allPaths.has(entry.path)) error('The same path cannot be both NEW and MODIFIED in one bundle.');
        if (leafMatches.length !== 1) error(leafMatches.length ? 'Ambiguous script path: multiple instances match.' :
          'Script not found. If creating a script, change STATUS to NEW.');
        const node = leafMatches[0];
        if (!node.isScript || !SCRIPT_CLASSES.has(node.className)) error('The destination is not a Lua script.');
        if (entry.className && entry.className !== node.className) error(`CLASS does not match existing ${node.className}.`);
        if (typeof node.source !== 'string' || node.sourceAvailable === false) error('Studio source is unavailable.');
        if (node.pendingWrite || typeof node.queuedSource === 'string') error('Finish existing editor changes before applying.');
        entries.push({ ...entry, className: node.className, action: node.source === entry.source ? 'unchanged' : 'modify',
          guards: [...guards, snapshot(node)], scriptId: node.id,
          revision: node.revision, expectedSource: node.source, missingFolders: [] });
      } else {
        entries.push({ ...entry, className: selectedClass, action: 'create',
          guards, anchorId: currentParentId, missingFolders,
          duplicateName: leafMatches.some((n) => n.isScript) });
      }
    } catch (caught) {
      errors.push({ index: entry.index, path: entry.path, message: caught.message });
      entries.push({ ...entry, action: 'error', className: entry.className || 'Script', message: caught.message });
    }
  }
  // A NEW script cannot simultaneously serve as an implicitly created parent
  // in the same bundle. The intermediate path builder creates only Folders.
  const newlyCreatedPaths = parsed.filter((entry) => entry.status === 'NEW').map((entry) => entry.path);
  for (const entry of entries) {
    if (entry.action === 'error') continue;
    if (newlyCreatedPaths.some((createdPath) => createdPath !== entry.path && entry.path.startsWith(`${createdPath}/`))) {
      entry.action = 'error';
      entry.message = 'A new script in this bundle is also used as a parent path. Apply its creation first.';
      errors.push({ index: entry.index, path: entry.path, message: entry.message });
    }
  }
  const summary = { create: entries.filter((e) => e.action === 'create').length,
    modify: entries.filter((e) => e.action === 'modify').length,
    unchanged: entries.filter((e) => e.action === 'unchanged').length,
    errors: errors.length };
  return { entries, summary, errors };
}

function publicPreview(plan) {
  return { summary: plan.summary, errors: plan.errors,
    entries: plan.entries.map((entry) => ({ index: entry.index, name: entry.name,
      path: entry.path, action: entry.action, className: entry.className,
      status: entry.status, missingFolders: entry.missingFolders || [],
      duplicateName: !!entry.duplicateName, message: entry.message || null,
      bytes: Buffer.byteLength(entry.source, 'utf8') })) };
}

module.exports = { parseBundle, buildQuickApplyPlan, publicPreview,
  MAX_BUNDLE_BYTES, MAX_SCRIPTS, BOUNDARY };
