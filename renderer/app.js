import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import './styles.css';
import { icon } from './icons.js';
import { findHierarchyCompletion, makeMonacoSuggestions } from './luau-completion.mjs';
import { buildExplorerRows, uniqueRoots, isNodeInside, pathForNode } from './explorer-model.mjs';
import { selectOnPointer, selectOnSweep } from './explorer-selection.mjs';
import { INSERT_GROUPS, moveTab, clipboardMutation } from './workbench-commands.mjs';
import PlaceSearchWorker from './place-search.worker.mjs?worker';
import { parseQuickOpenQuery, quickOpenMatches } from './quick-open.mjs';
import { createDocumentState, recordLocalEdit, reconcileSource, canRestoreDraft } from './editor-sync.mjs';
import { calculateExplorerWindow } from './virtual-window.mjs';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

const api = window.cursorBridge;
const $ = (id) => document.getElementById(id);
const nodes = new Map();
const expanded = new Set();
const selected = new Set();
const models = new Map();
const localState = new Map();
const activeTabs = [];
const draftTimers = new Map();
let clipboardState = null;
let closedTabs = [];
const rowElements = new Map();
let paintedSelection = new Set();
let paintedFocus = null;
let tabDropId = null;
let isMarqueeSelecting = false;
const writeTimers = new Map();
const writesInFlight = new Set();
let sessionEpoch = 0;
let selectedId = null;
let currentStatus = {};
let renderQueued = false;
let lastTreeBuild = 0;
let renderDelayTimer = null;
let treeRows = [];
let treeRowIds = [];
let virtualStart = -1;
let virtualEnd = -1;
let virtualTruncated = false;
let virtualFrame = null;
let scriptNodeCount = 0;
let pendingScriptOpenId = null;
let anchorId = null;
let focusedId = null;
let pointerAnchor = null;
let currentActionIds = [];
let selectedDestinationId = null;
let createParentId = null;
let renameTargetId = null;
let suppressChange = false;
let toastTimer = null;
let openEpoch = 0;
let dragSelectionMoved = false;
const pendingFocusMutations = new Map();
const pendingFocusIds = new Set();
let sidebarMode = 'explorer';
let placeSearchWorker = null;
let placeSearchTimer = null;
let placeSearchTimeout = null;
let placeSearchRequestId = 0;
let placeSearchResult = null;
let placeSearchMatches = [];
let placeSearchActiveIndex = -1;
let receivingStudioBatch = false;
let placeSearchUnavailable = 0;
const collapsedSearchGroups = new Set();
let quickOpenActiveIndex = 0;


function addIcon(element, name, size = 15) { element.innerHTML = icon(name, size); return element; }
for (const element of document.querySelectorAll('[data-icon]')) addIcon(element, element.dataset.icon);
const setFooter = (message) => { $('bottomMessage').textContent = message; };
function toast(message, warning = false) {
  const element = $('toast');
  element.textContent = message; element.classList.toggle('warning', warning);
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.hidden = true; }, warning ? 6500 : 3100);
  setFooter(message);
}
function safeError(error) { toast(error?.message || String(error), true); }

monaco.languages.register({ id: 'luau', extensions: ['.luau'], aliases: ['Luau', 'Lua'] });
monaco.languages.setLanguageConfiguration('luau', {
  comments: { lineComment: '--', blockComment: ['--[[', ']]'] },
  brackets: [['{', '}'], ['[', ']'], ['(', ')']],
  autoClosingPairs: [{ open: '{', close: '}' }, { open: '[', close: ']' },
    { open: '(', close: ')' }, { open: '"', close: '"' }, { open: "'", close: "'" }],
  surroundingPairs: [{ open: '(', close: ')' }, { open: '[', close: ']' },
    { open: '{', close: '}' }, { open: '"', close: '"' }],
});
monaco.languages.setMonarchTokensProvider('luau', {
  keywords: ['local','function','end','if','then','else','elseif','for','in','while','do',
    'repeat','until','return','break','continue','nil','true','false','and','or','not',
    'type','export','typeof','self'],
  tokenizer: {
    root: [
      [/--\[\[/, 'comment', '@comment'], [/--.*$/, 'comment'],
      [/[A-Za-z_][\w]*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
      [/\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'],
      [/"/, 'string', '@doubleString'], [/'/, 'string', '@singleString'],
      [/[{}()\[\]]/, '@brackets'], [/[=+*\/%<>!~-]+/, 'operator'],
    ],
    comment: [[/\]\]/, 'comment', '@pop'], [/./, 'comment']],
    doubleString: [[/\\./, 'string.escape'], [/"/, 'string', '@pop'], [/[^\\"]+/, 'string']],
    singleString: [[/\\./, 'string.escape'], [/'/, 'string', '@pop'], [/[^\\']+/, 'string']],
  },
});

const themePalette = {
  obsidian: { background: '08080A', fg: 'F2F1EF', keyword: 'B6A3D6', string: 'B9CCA6', comment: '656677' },
  graphite: { background: '1B1D21', fg: 'ECEDF0', keyword: 'C1AFDB', string: 'B9CFAD', comment: '777F8C' },
  midnight: { background: '0D1420', fg: 'EAF0FB', keyword: 'A4BDED', string: 'AFD4BD', comment: '627D99' },
  aurora: { background: '0A161A', fg: 'EAF5F4', keyword: 'A4D6CF', string: 'B7D3AB', comment: '628B8B' },
};
for (const [name, palette] of Object.entries(themePalette)) {
  monaco.editor.defineTheme(`cursor-${name}`, {
    base: 'vs-dark', inherit: true,
    rules: [
      { token: 'keyword', foreground: palette.keyword, fontStyle: 'bold' },
      { token: 'string', foreground: palette.string },
      { token: 'comment', foreground: palette.comment, fontStyle: 'italic' },
      { token: 'number', foreground: 'D9B888' },
    ],
    colors: { 'editor.background': `#${palette.background}`,
      'editor.foreground': `#${palette.fg}`,
      'editorLineNumber.foreground': '#666874',
      'editor.lineHighlightBackground': '#FFFFFF07',
      'editor.selectionBackground': '#8A899050',
      'editorIndentGuide.background1': '#FFFFFF12',
    },
  });
}

let codeColorTheme = localStorage.getItem('cursor-bridge-code-theme') || 'auto';
const themeLabels = { obsidian: 'Obsidian', graphite: 'Graphite', midnight: 'Midnight', aurora: 'Aurora' };
const themeColors = { obsidian: '#0b0b0d', graphite: '#161719', midnight: '#0d121a', aurora: '#0c1517' };
function useTheme(name) {
  if (!themeLabels[name]) name = 'obsidian';
  document.body.dataset.theme = name;
  monaco.editor.setTheme(`cursor-${codeColorTheme === 'auto' ? name : codeColorTheme}`);
  localStorage.setItem('cursor-bridge-theme', name);
  renderThemeOptions();
}
function renderThemeOptions() {
  $('themeOptions').replaceChildren();
  for (const [key, label] of Object.entries(themeLabels)) {
    const button = document.createElement('button');
    button.className = `theme-option${document.body.dataset.theme === key ? ' active' : ''}`;
    const swatch = document.createElement('span'); swatch.className = 'theme-swatch';
    swatch.style.background = themeColors[key];
    const name = document.createElement('span'); name.textContent = label;
    button.append(swatch, name);
    if (document.body.dataset.theme === key) {
      const checked = document.createElement('span'); checked.className = 'check';
      addIcon(checked, 'check', 14); button.append(checked);
    }
    button.addEventListener('click', () => { useTheme(key); $('themePanel').hidden = true; });
    $('themeOptions').append(button);
  }
}
useTheme(localStorage.getItem('cursor-bridge-theme') || 'obsidian');

const editor = monaco.editor.create($('monacoHost'), {
  language: 'luau', value: '', theme: `cursor-${codeColorTheme === 'auto' ? document.body.dataset.theme : codeColorTheme}`, 
  fontFamily: 'Cascadia Code, JetBrains Mono, Consolas, monospace',
  fontSize: 13.5, lineHeight: 23, fontLigatures: true,
  automaticLayout: true, smoothScrolling: true, mouseWheelZoom: true,
  minimap: { enabled: false }, bracketPairColorization: { enabled: true },
  guides: { bracketPairs: true, indentation: true },
  scrollBeyondLastLine: false, padding: { top: 17, bottom: 20 },
  wordWrap: 'off', tabSize: 4,
  suggest: { preview: true, showKeywords: true },
  quickSuggestions: { other: true, comments: false, strings: false },
});
// Editor settings are independent from the workbench theme and survive restarts.
const preferencesKey = 'cursor-bridge-editor-prefs';
const preferenceDefaults = {
  fontSize: 14, fontFamily: 'Cascadia Code, JetBrains Mono, Consolas, monospace',
  wordWrap: false, minimap: false,
};
let editorPreferences = { ...preferenceDefaults };
try {
  const cached = JSON.parse(localStorage.getItem(preferencesKey) || '{}');
  if (cached && typeof cached === 'object') {
    if (Number.isFinite(cached.fontSize)) editorPreferences.fontSize = Math.max(11, Math.min(24, cached.fontSize));
    if (typeof cached.fontFamily === 'string' && cached.fontFamily.length < 100) editorPreferences.fontFamily = cached.fontFamily;
    editorPreferences.wordWrap = cached.wordWrap === true;
    editorPreferences.minimap = cached.minimap === true;
  }
} catch {}
function updateEditorPreferences() {
  editor.updateOptions({
    fontFamily: editorPreferences.fontFamily,
    fontSize: editorPreferences.fontSize,
    lineHeight: Math.round(editorPreferences.fontSize * 1.65),
    wordWrap: editorPreferences.wordWrap ? 'on' : 'off',
    minimap: {enabled: editorPreferences.minimap},
  });
  $('fontSizeSetting').value = String(editorPreferences.fontSize);
  $('fontFamilySetting').value = editorPreferences.fontFamily;
  $('wordWrapSetting').checked = editorPreferences.wordWrap;
  $('minimapSetting').checked = editorPreferences.minimap;
  $('codeThemeSetting').value = codeColorTheme;
  localStorage.setItem(preferencesKey, JSON.stringify(editorPreferences));
}
function changeEditorZoom(delta) {
  editorPreferences.fontSize = delta === 0 ? 14
    : Math.max(11, Math.min(24, editorPreferences.fontSize + delta));
  updateEditorPreferences();
}
for (const [id, property, parse] of [
  ['fontSizeSetting','fontSize', (node)=>Math.max(11,Math.min(24,Number(node.value)||14))],
  ['fontFamilySetting','fontFamily', (node)=>node.value],
  ['wordWrapSetting','wordWrap', (node)=>node.checked],
  ['minimapSetting','minimap', (node)=>node.checked],
]) {
  $(id).addEventListener('change', () => {
    editorPreferences[property] = parse($(id));
    updateEditorPreferences();
  });
}
$('codeThemeSetting').addEventListener('change', (event) => {
  codeColorTheme = event.target.value;
  if (codeColorTheme !== 'auto' && !themeLabels[codeColorTheme]) codeColorTheme='auto';
  localStorage.setItem('cursor-bridge-code-theme',codeColorTheme);
  monaco.editor.setTheme(`cursor-${codeColorTheme === 'auto' ? document.body.dataset.theme : codeColorTheme}`);
});
updateEditorPreferences();

monaco.languages.registerCompletionItemProvider('luau', {
  triggerCharacters: ['.', '"', "'"],
  provideCompletionItems(model, position) {
    const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
    return { suggestions: makeMonacoSuggestions(findHierarchyCompletion(line, nodes, selectedId), monaco, position) };
  },
});

const classIcon = (node) => node.className || 'service';
const iconKind = (node) => node.className === 'Script' ? 'script' : node.className === 'LocalScript' ? 'local' :
  node.className === 'ModuleScript' ? 'module' : node.className === 'Folder' ? 'folder' :
  node.className === 'Part' ? 'part' : node.className === 'Model' ? 'model' : node.parentId === 'game' ? `service svc-${node.className.toLowerCase()}` : '';
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  // Large background imports arrive in batches. Coalesce tree rebuilding to
  // avoid running an O(N) traversal hundreds of times during indexing.
  const wait = currentStatus.indexing ? Math.max(0, 260 - (performance.now() - lastTreeBuild)) : 0;
  clearTimeout(renderDelayTimer);
  renderDelayTimer = setTimeout(() => requestAnimationFrame(() => {
    renderQueued = false;
    lastTreeBuild = performance.now();
    renderTree(); updateCounts();
  }), wait);
}
function rowIds() { return treeRowIds; }
function mutableIds() { return uniqueRoots(nodes, selected); }
function canMutate() { return currentStatus.connected === true && currentStatus.ready === true; }
function refreshSelectionUI() {
  const count = selected.size;
  const actions = $('selectionActions');
  actions.hidden = count === 0 || !canMutate();
  const enabled = canMutate() && !currentStatus.indexing && !currentStatus.scanLimitReached && mutableIds().length > 0;
  $('duplicateSelected').disabled = !enabled;
  $('moveSelected').disabled = !enabled;
  $('deleteSelected').disabled = !enabled;
  $('explorerHelp').hidden = !actions.hidden;
  $('explorerSummary').textContent = count ? `${count} selected` : `${nodes.size.toLocaleString('en-US')} instances`;
}
// Selection only changes classes, never reconstructs the DOM underneath a pointer click.
// Reconstructing here used to destroy the clicked row before its click/dblclick event.
function paintSelection() {
  // Change only the rows whose state actually changed. This stays responsive
  // even when the Studio place has thousands of expanded instances.
  const changed = new Set([...paintedSelection, ...selected]);
  if (paintedFocus) changed.add(paintedFocus);
  if (focusedId) changed.add(focusedId);
  for (const id of changed) {
    const row = rowElements.get(id);
    if (!row) continue;
    const active = selected.has(id);
    row.classList.toggle('selected', active);
    row.classList.toggle('focused', focusedId === id);
    row.setAttribute('aria-selected', String(active));
  }
  paintedSelection = new Set(selected);
  paintedFocus = focusedId;
  refreshSelectionUI();
}
function selectOnly(id) {
  selected.clear(); selected.add(id); anchorId = id; focusedId = id;
  paintSelection();
}
function selectForRow(id, shift, toggle) {
  const next = selectOnPointer(rowIds(), selected, anchorId, id, { shift, toggle });
  selected.clear();
  for (const item of next.selected) selected.add(item);
  anchorId = next.anchorId;
  focusedId = next.focusedId;
  paintSelection();
}
function toggleExpand(id) {
  if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
  scheduleRender();
}
function renderTree() {
  if (!canMutate()) {
    treeRows = []; treeRowIds = [];
    virtualStart = -1; virtualEnd = -1;
    $('tree').replaceChildren();
    refreshSelectionUI();
    return;
  }
  const tree = buildExplorerRows(nodes, expanded, $('treeSearch').value, 1000000);
  treeRows = tree.rows;
  treeRowIds = treeRows.map((row) => row.id);
  virtualTruncated = tree.truncated;
  paintTreeWindow(true);
}
function paintTreeWindow(force = false) {
  if (!canMutate()) return;
  const scroll = $('treeScroller');
  const scrollTop = scroll.scrollTop;
  const visible = calculateExplorerWindow(treeRows.length, scrollTop, scroll.clientHeight);
  if (!force && visible.start === virtualStart && visible.end === virtualEnd) return;
  virtualStart = visible.start; virtualEnd = visible.end;
  const focusedRowId = document.activeElement?.closest('.tree-row')?.dataset.id;
  const fragment = document.createDocumentFragment();
  rowElements.clear();
  const topSpacer = document.createElement('div');
  topSpacer.className = 'tree-virtual-spacer';
  topSpacer.style.height = `${visible.topSpacer}px`;
  fragment.append(topSpacer);
  for (let index = visible.start; index < visible.end; index++) {
    const data = treeRows[index];
    const { node, id, depth, hasChildren, expanded: isExpanded } = data;
    const row = document.createElement('div');
    row.className = `tree-row${selected.has(id) ? ' selected' : ''}${focusedId === id ? ' focused' : ''}`;
    row.style.setProperty('--depth', depth);
    row.tabIndex = 0; row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-selected', String(selected.has(id)));
    row.setAttribute('aria-level', String(depth + 1));
    if (hasChildren) row.setAttribute('aria-expanded', String(isExpanded));
    row.dataset.id = id;
    row.draggable = node.parentId !== 'game';
    if (clipboardState?.mode === 'cut' && clipboardState.ids.includes(id)) row.classList.add('cut');
    rowElements.set(id, row);
    row.title = `${pathForNode(nodes, id)} · ${node.className}`;
    const expander = document.createElement('button');
    expander.type = 'button'; expander.tabIndex = -1;
    expander.className = `tree-expander${isExpanded ? ' expanded' : ''}${hasChildren ? '' : ' empty'}`;
    addIcon(expander, 'chevron', 12);
    expander.addEventListener('click', (event) => { event.stopPropagation(); toggleExpand(id); });
    const symbol = document.createElement('span');
    symbol.className = `tree-class ${iconKind(node)}`;
    addIcon(symbol, classIcon(node), 15);
    const label = document.createElement('span'); label.className = 'tree-name'; label.textContent = node.name;
    row.append(expander, symbol, label);
    // A plus button appears on hover, as in Roblox Studio Explorer.
    const quickAdd = document.createElement('button');
    quickAdd.className = 'tree-quick-add';
    quickAdd.type = 'button'; quickAdd.tabIndex = -1;
    quickAdd.title = `Insert object into ${node.name}`;
    quickAdd.setAttribute('aria-label', `Insert object into ${node.name}`);
    addIcon(quickAdd, 'plus', 13);
    quickAdd.addEventListener('pointerdown', (event) => event.stopPropagation());
    quickAdd.addEventListener('click', (event) => {
      event.stopPropagation();
      const box = quickAdd.getBoundingClientRect();
      showInsertMenu(box.right + 3, box.top, id);
    });
    row.append(quickAdd);
    row.addEventListener('dragstart', (event) => {
      pointerAnchor = null;
      if (!selected.has(id)) selectOnly(id);
      const ids = mutableIds();
      if (!canMutate() || !ids.length) { event.preventDefault(); return; }
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('application/x-cursor-bridge-nodeids', JSON.stringify(ids));
      event.dataTransfer.setData('text/plain', `${ids.length} Cursor Bridge instance(s)`);
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      for (const element of rowElements.values()) element.classList.remove('drop-target', 'dragging');
    });
    row.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('button')) return;
      dragSelectionMoved = false;
      pointerAnchor = (!event.shiftKey && !event.ctrlKey && !event.metaKey) ? id : null;
      selectForRow(id, event.shiftKey, event.ctrlKey || event.metaKey);
      row.focus({ preventScroll: true });
    });
    row.addEventListener('click', (event) => {
      if (event.target.closest('button') || event.shiftKey || event.ctrlKey || event.metaKey) return;
      if (dragSelectionMoved) { dragSelectionMoved = false; return; }
      if (node.isScript) openScript(id).catch(safeError);
    });
    row.addEventListener('dblclick', (event) => {
      if (event.target.closest('button')) return;
      if (node.isScript) openScript(id).catch(safeError);
      else if (hasChildren) toggleExpand(id);
    });
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (node.isScript) openScript(id).catch(safeError);
        else toggleExpand(id);
      }
    });
    row.addEventListener('contextmenu', (event) => {
      event.preventDefault(); pointerAnchor = null;
      if (!selected.has(id)) selectOnly(id);
      showContextMenu(event.clientX, event.clientY, id);
    });
    row.addEventListener('dragover', (event) => {
      if (!Array.from(event.dataTransfer.types).includes('application/x-cursor-bridge-nodeids')) return;
      event.preventDefault(); event.dataTransfer.dropEffect = 'move'; row.classList.add('drop-target');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
    row.addEventListener('drop', (event) => {
      row.classList.remove('drop-target'); event.preventDefault();
      let ids;
      try { ids = JSON.parse(event.dataTransfer.getData('application/x-cursor-bridge-nodeids')); } catch { return; }
      if (!Array.isArray(ids) || !canMutate()) return;
      if (ids.some((sourceId) => isNodeInside(nodes, id, sourceId))) {
        toast('You cannot move an instance into itself or its descendants.', true); return;
      }
      // Local feedback is immediate; the authoritative operation is asynchronous.
      expanded.add(id);
      runMutation({ action: 'move', ids, parentId: id }).catch(safeError);
    });
    fragment.append(row);
  }
  const bottomSpacer = document.createElement('div');
  bottomSpacer.className = 'tree-virtual-spacer';
  bottomSpacer.style.height = `${visible.bottomSpacer}px`;
  fragment.append(bottomSpacer);
  if (!treeRows.length || virtualTruncated) {
    const note = document.createElement('div'); note.className = 'tree-empty';
    note.textContent = virtualTruncated ? 'Explorer safety limit reached; narrow your search.' :
      nodes.size ? 'No matching instances.' : 'The hierarchy is still loading.';
    fragment.append(note);
  }
  $('tree').replaceChildren(fragment);
  paintedSelection = new Set(selected);
  paintedFocus = focusedId;
  if (focusedRowId) {
    const matching = [...$('tree').querySelectorAll('.tree-row')]
      .find((element) => element.dataset.id === focusedRowId);
    matching?.focus({ preventScroll: true });
  }
  scroll.scrollTop = scrollTop;
  refreshSelectionUI();
}
$('treeScroller').addEventListener('scroll', () => {
  if (virtualFrame !== null) return;
  virtualFrame = requestAnimationFrame(() => {
    virtualFrame = null;
    paintTreeWindow();
  });
}, {passive: true});
function revealTreeRow(id, focus = false) {
  const index = treeRowIds.indexOf(id);
  if (index < 0) return;
  const scroller = $('treeScroller');
  const top = index * 25;
  if (top < scroller.scrollTop) scroller.scrollTop = top;
  else if (top + 25 > scroller.scrollTop + scroller.clientHeight) {
    scroller.scrollTop = top + 25 - scroller.clientHeight;
  }
  paintTreeWindow();
  if (focus) rowElements.get(id)?.focus({preventScroll: true});
}
function setupMarqueeSelection() {
  const scroller = $('treeScroller');
  const marquee = $('marquee');
  const ROW_HEIGHT = 25; // Mirrors the fixed height of .tree-row in styles.css.
  let origin = null;
  let pointer = null;
  let initial = new Set();
  let tick = null;
  let additive = false;
  let activePointerId = null;
  let firstRowOffset = 0;
  const clamp = (v, low, high) => Math.max(low, Math.min(v, high));

  function paintMarquee() {
    if (!origin || !pointer) return;
    const viewport = scroller.getBoundingClientRect();
    const x = clamp(pointer.x, viewport.left, viewport.right);
    const y = clamp(pointer.y, viewport.top, viewport.bottom);
    const left = Math.min(origin.x, x), right = Math.max(origin.x, x);
    const pointerY = scroller.scrollTop + y - viewport.top;
    const topContent = Math.min(origin.contentY, pointerY);
    const bottomContent = Math.max(origin.contentY, pointerY);
    const visibleTop = clamp(viewport.top + topContent - scroller.scrollTop, viewport.top, viewport.bottom);
    const visibleBottom = clamp(viewport.top + bottomContent - scroller.scrollTop, viewport.top, viewport.bottom);
    marquee.style.left = `${left}px`;
    marquee.style.top = `${visibleTop}px`;
    marquee.style.width = `${right - left}px`;
    marquee.style.height = `${visibleBottom - visibleTop}px`;

    const next = additive ? new Set(initial) : new Set();
    if (right - left >= 3 && bottomContent - topContent >= 3) {
      // Row offsets are stable, so enumerate only the selected vertical range.
      // No thousands-of-rows getBoundingClientRect layout reads while dragging.
      // Content coordinates also retain selected off-screen rows when auto-scrolling.
      const start = clamp(Math.floor((topContent - firstRowOffset) / ROW_HEIGHT), 0, treeRows.length);
      const end = clamp(Math.ceil((bottomContent - firstRowOffset) / ROW_HEIGHT), 0, treeRows.length);
      for (let index = start; index < end; index++) next.add(treeRows[index].id);
    }
    selected.clear();
    for (const id of next) selected.add(id);
    focusedId = [...selected].at(-1) || null;
    paintSelection();
  }
  function frame() {
    if (!origin) { tick = null; return; }
    const view = scroller.getBoundingClientRect();
    if (pointer && pointer.y < view.bottom && pointer.y > view.bottom - 22) scroller.scrollTop += 9;
    if (pointer && pointer.y > view.top && pointer.y < view.top + 22) scroller.scrollTop -= 9;
    paintMarquee();
    tick = requestAnimationFrame(frame);
  }
  function finish() {
    if (!origin) return;
    if (tick !== null) cancelAnimationFrame(tick);
    tick = null;
    origin = null; pointer = null;
    marquee.hidden = true;
    isMarqueeSelecting = false;
    try { scroller.releasePointerCapture(activePointerId); } catch {}
    activePointerId = null;
  }
  scroller.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('.tree-row, button, input')) return;
    if (!canMutate()) return;
    event.preventDefault();
    const viewport = scroller.getBoundingClientRect();
    const x = clamp(event.clientX, viewport.left, viewport.right);
    const y = clamp(event.clientY, viewport.top, viewport.bottom);
    origin = { x, contentY: scroller.scrollTop + y - viewport.top };
    pointer = { x, y }; additive = event.ctrlKey || event.metaKey || event.shiftKey;
    // Virtual spacers do not alter row-index geometry.
    firstRowOffset = 0;
    initial = new Set(selected);
    activePointerId = event.pointerId;
    isMarqueeSelecting = true;
    scroller.setPointerCapture(event.pointerId);
    marquee.hidden = false;
    if (!additive) { selected.clear(); focusedId = null; paintSelection(); }
    tick = requestAnimationFrame(frame);
  });
  scroller.addEventListener('pointermove', (event) => {
    if (origin && event.pointerId === activePointerId) {
      pointer = { x: event.clientX, y: event.clientY };
      paintMarquee();
    }
  });
  scroller.addEventListener('pointerup', finish);
  scroller.addEventListener('pointercancel', finish);
  window.addEventListener('blur', finish);
}

window.addEventListener('pointerup', () => { pointerAnchor = null; });
setupMarqueeSelection();
$('treeSearch').addEventListener('input', scheduleRender);
$('treeScroller').addEventListener('contextmenu', (event) => {
  if (event.target.closest('.tree-row')) return;
  event.preventDefault(); showContextMenu(event.clientX, event.clientY, null);
});
$('collapseTree').addEventListener('click', () => { expanded.clear(); scheduleRender(); });
$('clearSelection').addEventListener('click', () => { selected.clear(); anchorId = null; focusedId = null; paintSelection(); });

function updateCounts() {
  $('instanceStat').textContent = `${nodes.size.toLocaleString('en-US')} instances`;
  $('scriptStat').textContent = `${scriptNodeCount.toLocaleString('en-US')} scripts`;
  refreshSelectionUI();
}
function getLocal(id) {
  if (!localState.has(id)) localState.set(id, createDocumentState(nodes.get(id)?.revision || 0));
  return localState.get(id);
}
function updateEditorStatus() {
  const node = nodes.get(selectedId);
  if (!node) return;
  const local = getLocal(selectedId);
  $('documentPath').textContent = pathForNode(nodes, selectedId);
  $('scriptType').textContent = `${node.className} · Luau`;
  let label = 'Synced';
  if (!currentStatus.connected) label = 'Studio offline';
  else if (local.manualResolve) label = 'Conflict · draft protected';
  else if (local.dirty) label = 'Unsynced local changes';
  else if (node.pending) label = 'Syncing...';
  $('syncIndicator').textContent = label;
  $('syncIndicator').classList.toggle('warning', local.dirty || local.manualResolve || node.pending);
  $('applyDraft').hidden = !local.manualResolve || !canMutate();
  $('reloadStudio').hidden = !local.manualResolve;
  editor.updateOptions({ readOnly: !canMutate() });
}
function renderTabs() {
  $('tabs').replaceChildren();
  if (!activeTabs.length) {
    const placeholder = document.createElement('span'); placeholder.className = 'tabs-placeholder';
    placeholder.textContent = 'No scripts open'; $('tabs').append(placeholder);
    return;
  }
  for (const id of activeTabs) {
    const node = nodes.get(id);
    if (!node) continue;
    const item = document.createElement('div'); item.className = `tab${selectedId === id ? ' active' : ''}`;
    item.title = pathForNode(nodes, id);
    item.draggable = true;
    item.dataset.id = id;
    item.setAttribute('role', 'tab');
    item.setAttribute('aria-selected', String(selectedId === id));
    const symbol = document.createElement('span'); symbol.className = 'tab-icon'; addIcon(symbol, classIcon(node), 15);
    const label = document.createElement('span'); label.className = 'tab-label'; label.textContent = node.name;
    item.append(symbol, label);
    if (getLocal(id).dirty) { const dot = document.createElement('span'); dot.className='tab-unsynced';item.append(dot); }
    const close = document.createElement('button'); close.className='tab-close';close.title='Close tab'; addIcon(close,'close',12);
    close.addEventListener('click',(event)=>{event.stopPropagation();closeTab(id);});
    item.append(close);
    item.addEventListener('click',()=>openScript(id).catch(safeError));
    item.addEventListener('auxclick', (event) => { if (event.button === 1) closeTab(id); });
    item.addEventListener('dragstart', (event) => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('application/x-cursor-bridge-tab', id);
      item.classList.add('tab-dragging');
      tabDropId = id;
    });
    item.addEventListener('dragover', (event) => {
      if (!tabDropId || tabDropId === id) return;
      event.preventDefault();
      const after = event.clientX > item.getBoundingClientRect().left + item.offsetWidth / 2;
      item.classList.toggle('tab-drop-after', after);
      item.classList.toggle('tab-drop-before', !after);
    });
    item.addEventListener('dragleave', () => item.classList.remove('tab-drop-before', 'tab-drop-after'));
    item.addEventListener('drop', (event) => {
      event.preventDefault();
      const from = tabDropId || event.dataTransfer.getData('application/x-cursor-bridge-tab');
      const after = event.clientX > item.getBoundingClientRect().left + item.offsetWidth / 2;
      const next = moveTab(activeTabs, from, id, after);
      activeTabs.splice(0, activeTabs.length, ...next);
      tabDropId = null;
      renderTabs();
    });
    item.addEventListener('dragend', () => {
      tabDropId = null;
      for (const tab of $('tabs').children) tab.classList.remove('tab-dragging', 'tab-drop-before', 'tab-drop-after');
    });
    item.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      showTabMenu(event.clientX, event.clientY, id);
    });
    $('tabs').append(item);
  }
}
const safetyJournalPrefix = 'cursor-bridge-safety-draft-v1:';
let safetyJournalWarningShown = false;
function safetyJournalKey(id) {
  return `${safetyJournalPrefix}${encodeURIComponent(currentStatus.placeKey || '')}:${encodeURIComponent(id)}`;
}
function storeSafetyJournal(id, source) {
  try {
    const node = nodes.get(id);
    if (!node) return;
    localStorage.setItem(safetyJournalKey(id), JSON.stringify({
      id, placeKey: currentStatus.placeKey, path: pathForNode(nodes, id),
      source, savedAt: new Date().toISOString(),
    }));
  } catch {
    // The on-disk recovery store is primary; report a full/unavailable cache.
    if (!safetyJournalWarningShown) {
      safetyJournalWarningShown = true;
      toast('Emergency recovery cache unavailable. Keep the app open until the local draft is saved.', true);
    }
  }
}
function readSafetyJournal(id) {
  try {
    const value = JSON.parse(localStorage.getItem(safetyJournalKey(id)) || 'null');
    if (value?.id === id && value.placeKey === currentStatus.placeKey &&
        value.path === pathForNode(nodes, id) && typeof value.source === 'string') return value;
  } catch {}
  return null;
}
function removeSafetyJournal(id) {
  try { localStorage.removeItem(safetyJournalKey(id)); } catch {}
}
function cancelScriptTimers(id) {
  clearTimeout(draftTimers.get(id)); draftTimers.delete(id);
  clearTimeout(writeTimers.get(id)); writeTimers.delete(id);
}
function saveScriptDraft(id, source) {
  const node = nodes.get(id);
  const path = node ? pathForNode(nodes, id) : null;
  return api.saveDraft(id, source, path, currentStatus.placeKey);
}
function persistUnsentDrafts() {
  // This is intentionally best-effort; the synchronous safety journal was
  // written on each keystroke and survives an abrupt renderer shutdown.
  for (const [id, state] of localState) {
    const model = models.get(id);
    if (state.dirty && model) {
      storeSafetyJournal(id, model.getValue());
      saveScriptDraft(id, model.getValue()).catch(() => {});
    }
  }
}
window.addEventListener('pagehide', persistUnsentDrafts);

async function clearAcknowledgedDraft(id, source) {
  const local = localState.get(id), model = models.get(id);
  if (!local || !model || local.dirty || local.manualResolve || model.getValue() !== source) return;
  const version = local.editVersion;
  // Compare-and-clear on disk: a slower Studio acknowledgment cannot delete a
  // newer file saved by the renderer while we were waiting.
  try {
    await api.clearDraft(id, source, local.editVersion > 0);
    if (localState.get(id) === local && local.editVersion === version &&
        !local.dirty && model.getValue() === source) removeSafetyJournal(id);
  } catch (error) { safeError(error); }
}

async function openScript(id) {
  const node = nodes.get(id);
  if (!canMutate() || !node?.isScript) {
    toast('The script is not indexed in the current Studio session.', true);
    return;
  }
  if (typeof node.source !== 'string') {
    pendingScriptOpenId = id;
    toast('Loading script source from Studio...');
    try { await api.requestSource(id); } catch (error) {
      if (pendingScriptOpenId === id) pendingScriptOpenId = null;
      safeError(error);
    }
    return;
  }
  pendingScriptOpenId = null;
  const epoch = ++openEpoch;
  if (!activeTabs.includes(id)) activeTabs.push(id);
  if (!models.has(id)) {
    const model = monaco.editor.createModel(node.source, 'luau',
      monaco.Uri.parse(`inmemory://cursor/${encodeURIComponent(id)}.luau`));
    models.set(id, model);
    getLocal(id).knownRevision = node.revision;
  }
  // Activate the editor synchronously; fetching recovery must not block typing.
  selectedId = id;
  editor.setModel(models.get(id));
  let parent = nodes.get(node.parentId);
  while (parent) { expanded.add(parent.id); parent = nodes.get(parent.parentId); }
  $('welcome').hidden = true;
  $('codePanel').hidden = false;
  updateEditorStatus(); renderTabs(); scheduleRender();
  requestAnimationFrame(() => editor.layout());

  const local = getLocal(id), model = models.get(id);
  if (local.recoveryChecked || local.recoveryLoading) return;
  local.recoveryLoading = true;
  const initialVersion = local.editVersion;
  const initialSource = model.getValue();
  const initialNode = nodes.get(id);
  try {
    const recovered = await api.getDraft(id);
    if (epoch !== openEpoch || selectedId !== id || nodes.get(id) !== initialNode ||
        localState.get(id) !== local || models.get(id) !== model) return;
    const journal = readSafetyJournal(id);
    const candidates = [recovered, journal].filter((item) =>
      typeof item?.source === 'string' && item.source !== initialNode.source);
    candidates.sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
    const candidate = candidates[0];
    if (!canRestoreDraft(local, initialVersion, model.getValue(), initialSource,
      nodes.get(id)?.source)) {
      // The user already typed or the Studio changed the script. Never replace it.
      local.recoveryChecked = true;
      return;
    }
    local.recoveryChecked = true;
    if (candidate && window.confirm(`A local recovery draft${candidate.fromPreviousSession ? ' from a previous Studio session' : ''} exists for ${node.name}. Open it instead of the Studio version?`)) {
      // Confirm again immediately before applying the draft.
      if (!canRestoreDraft(local, initialVersion, model.getValue(), initialSource,
          nodes.get(id)?.source)) return;
      suppressChange = true;
      try { model.setValue(candidate.source); } finally { suppressChange = false; }
      local.editVersion++;
      local.dirty = true;
      local.manualResolve = true;
      storeSafetyJournal(id, candidate.source);
      saveScriptDraft(id, candidate.source).catch(safeError);
      updateEditorStatus(); renderTabs();
    }
  } catch (error) { safeError(error); }
  finally { local.recoveryLoading = false; }
}
function closeTab(id) {
  const local = getLocal(id);
  if (local.dirty && !window.confirm('Close tab? Your unsynced draft is saved locally.')) return;
  if (nodes.get(id)?.isScript) closedTabs.push(id);
  const index = activeTabs.indexOf(id);
  if (index !== -1) activeTabs.splice(index, 1);
  if (selectedId === id) {
    selectedId = null; ++openEpoch; editor.setModel(null);
    if (activeTabs.length) openScript(activeTabs.at(-1)).catch(safeError);
    else { $('welcome').hidden = false; $('codePanel').hidden = true; }
  }
  renderTabs();
}
function scheduleDraftWrite(id, local, delay = 75) {
  clearTimeout(draftTimers.get(id));
  const version = local.editVersion;
  draftTimers.set(id, setTimeout(async () => {
    if (localState.get(id) !== local) return;
    const model = models.get(id);
    if (!model || !local.dirty || local.editVersion !== version) return;
    try { await saveScriptDraft(id, model.getValue()); }
    catch (error) { safeError(error); }
  }, delay));
}
function scheduleStudioWrite(id, delay = 480) {
  clearTimeout(writeTimers.get(id));
  writeTimers.set(id, setTimeout(() => flushStudioWrite(id).catch(safeError), delay));
}
async function flushStudioWrite(id) {
  const local = localState.get(id), model = models.get(id);
  if (!local || !model || !local.dirty || local.manualResolve || !canMutate()) return;
  if (writesInFlight.has(id)) { local.flushRequested = true; return; }
  const generation = local.editVersion;
  const source = model.getValue();
  const activeSession = sessionEpoch;
  writesInFlight.add(id);
  local.flushRequested = false;
  try {
    // Source is durable before any outgoing Studio command.
    await saveScriptDraft(id, source);
    if (sessionEpoch !== activeSession || localState.get(id) !== local || models.get(id) !== model) return;
    if (local.editVersion !== generation || model.getValue() !== source) {
      local.flushRequested = true;
      return;
    }
    if (!local.dirty || local.manualResolve || !canMutate()) return;
    if (source === nodes.get(id)?.source && local.outboundSources.size === 0) {
      local.dirty = false;
      clearAcknowledgedDraft(id, source).catch(safeError);
      return;
    }
    local.outboundSources.add(source);
    const reply = await api.writeScript(id, source, local.knownRevision);
    if (sessionEpoch !== activeSession || localState.get(id) !== local) return;
    if (reply.status === 'conflict') {
      local.outboundSources.delete(source);
      local.manualResolve = true;
      local.dirty = true;
      toast('Studio changed this script. Your local changes are protected; review the conflict.', true);
    } else if (reply.status === 'no-op') {
      local.outboundSources.delete(source);
      if (model.getValue() === nodes.get(id)?.source && local.outboundSources.size === 0) {
        local.dirty = false;
        clearAcknowledgedDraft(id, model.getValue()).catch(safeError);
      }
    } else if (reply.status !== 'queued' && reply.status !== 'queued-behind-current') {
      local.outboundSources.delete(source);
      local.manualResolve = true;
      toast('Studio did not accept the edit. The local draft was preserved.', true);
    } else setFooter('Edit queued for Roblox Studio.');
  } catch (error) {
    if (localState.get(id) === local) {
      local.outboundSources.delete(source);
      // A transient network problem must not authorize an overwrite on retry.
      local.manualResolve = true;
      safeError(error);
    }
  } finally {
    writesInFlight.delete(id);
    if (localState.get(id) === local) {
      if (local.flushRequested && !local.manualResolve && local.dirty && canMutate()) {
        local.flushRequested = false;
        scheduleStudioWrite(id, 80);
      }
      if (selectedId === id) updateEditorStatus();
      renderTabs();
    }
  }
}
editor.onDidChangeModelContent(() => {
  if (suppressChange || !selectedId) return;
  const id = selectedId, model = models.get(id);
  if (!model) return;
  const local = getLocal(id);
  recordLocalEdit(local, model.getValue(), nodes.get(id)?.source);
  cancelScriptTimers(id);
  if (local.dirty) {
    // Synchronous, best-effort last-resort journal: even a fast quit leaves a copy.
    storeSafetyJournal(id, model.getValue());
    scheduleDraftWrite(id, local);
    if (!local.manualResolve) scheduleStudioWrite(id);
  } else {
    clearAcknowledgedDraft(id, model.getValue()).catch(safeError);
  }
  updateEditorStatus(); renderTabs();
  if (sidebarMode === 'search') schedulePlaceSearch(260);
});
editor.onDidChangeCursorPosition((event) => {
  $('cursorPosition').textContent = `Ln ${event.position.lineNumber}, Col ${event.position.column}`;
});
$('applyDraft').addEventListener('click', async () => {
  if (!selectedId || !canMutate()) return;
  if (!window.confirm('Apply this recovery draft over the current Studio source? The existing Studio source is backed up first.')) return;
  const id = selectedId, local = getLocal(id), node = nodes.get(id);
  local.knownRevision = node.revision;
  local.manualResolve = false;
  local.dirty = true;
  await flushStudioWrite(id);
  updateEditorStatus();
});
$('reloadStudio').addEventListener('click', async () => {
  if (!selectedId) return;
  const id = selectedId, node = nodes.get(id), local = getLocal(id);
  if (writesInFlight.has(id) || node.pending) {
    toast('Wait for the pending Studio operation before discarding this draft.', true);
    return;
  }
  if (!window.confirm('Discard the local draft and load the latest Studio version?')) return;
  cancelScriptTimers(id);
  suppressChange = true;
  try { models.get(id).setValue(node.source); } finally { suppressChange = false; }
  local.editVersion++;
  local.manualResolve = false;
  local.dirty = false;
  local.outboundSources.clear();
  local.knownRevision = node.revision;
  try { await api.clearDraft(id, node.source, true); }
  catch (error) { safeError(error); }
  if (localState.get(id) === local && !local.dirty) removeSafetyJournal(id);
  updateEditorStatus(); renderTabs();
});
function focusCreatedNode(id) {
  const node = nodes.get(id);
  if (!node) { pendingFocusIds.add(id); return; }
  selected.clear(); selected.add(id); focusedId = id; anchorId = id;
  let parent = nodes.get(node.parentId);
  while (parent) { expanded.add(parent.id); parent = nodes.get(parent.parentId); }
  scheduleRender();
  if (node.isScript && typeof node.source !== 'string') {
    pendingFocusIds.add(id);
  } else {
    pendingFocusIds.delete(id);
    if (node.isScript) openScript(id).catch(safeError);
    else paintSelection();
  }
}
function receiveNode(node, origin='studio') {
  const old = nodes.get(node.id);
  // Source revisions come from the authoritative bridge; never replay a stale
  // update over a newer model (including delayed IPC event delivery).
  if (old && node.revision < old.revision) return;
  if (old?.isScript !== node.isScript) {
    scriptNodeCount += node.isScript ? 1 : -1;
  }
  nodes.set(node.id, node);
  if (node.id === pendingScriptOpenId && typeof node.source === 'string') {
    pendingScriptOpenId = null;
    queueMicrotask(() => openScript(node.id).catch(safeError));
  }
  if (typeof node.source === 'string' && models.has(node.id)) {
    const model = models.get(node.id), local = getLocal(node.id);
    const action = reconcileSource(local, model.getValue(), old?.source,
      node.source, node.revision, origin);
    if (action === 'replace') {
      suppressChange = true;
      try { model.setValue(node.source); } finally { suppressChange = false; }
      clearAcknowledgedDraft(node.id, node.source).catch(safeError);
    } else if (action === 'acknowledged') {
      clearAcknowledgedDraft(node.id, node.source).catch(safeError);
    } else if (action === 'outgoing-acknowledged' && local.dirty && !local.manualResolve) {
      // A previous edit landed while typing continued. Send the latest version.
      scheduleStudioWrite(node.id, 90);
    } else if (action === 'conflict') {
      toast(`${node.name} changed in Studio. Your local draft is preserved.`, true);
    }
  }
  if (selectedId === node.id) updateEditorStatus();
  const metadataChanged = !old || old.name !== node.name || old.parentId !== node.parentId ||
    old.className !== node.className || old.siblingOrder !== node.siblingOrder;
  if (metadataChanged) scheduleRender();
  if (pendingFocusIds.has(node.id) && (!node.isScript || typeof node.source === 'string')) {
    pendingFocusIds.delete(node.id);
    focusCreatedNode(node.id);
  }
  if (activeTabs.includes(node.id)) renderTabs();
  if (sidebarMode === 'search' && !receivingStudioBatch) schedulePlaceSearch(190);
}
function updateStatus(status) {
  const previouslyConnected = currentStatus.connected === true;
  currentStatus = status;
  const connected = status.connected === true;
  const ready = connected && status.ready === true;
  $('connectionState').textContent = ready ? (status.indexing ? 'Studio connected · indexing' : 'Studio connected') : connected ? 'Syncing Studio…' : 'Not connected';
  $('statusLight').classList.toggle('connected', ready);
  $('explorerLed').classList.toggle('connected', ready);
  $('headerPlace').textContent = connected ? status.placeName : 'No place';
  $('placeName').textContent = connected ? status.placeName : 'No place connected';
  $('placeKey').textContent = connected ? status.placeKey : 'Waiting for a local session';
  $('lastSeen').textContent = ready ? (status.indexing ? `Indexing ${Number(status.scanIndexed || status.nodeCount || 0).toLocaleString('en-US')} objects in the background. Destructive actions are temporarily locked.` : 'Studio is authoritative. All edits are synchronized locally.')
    : 'Recovery versions are stored locally. No Explorer data is shown offline.';
  $('pairingCard').hidden = connected;
  $('pairingCode').textContent = status.pairingCode || 'LINKED';
  $('disconnectButton').disabled = !connected;
  $('placeSearchPlace').textContent = ready ? status.placeName : 'Studio offline';
  if (!ready) {cancelPlaceSearch();setSidebarView('explorer');placeSearchResult=null;}
  else if (sidebarMode === 'search') schedulePlaceSearch(190);

  // A recovery snapshot is for backups, never an apparent live Explorer session.
  $('explorerPane').hidden = !ready;
  $('resizeDivider').hidden = !ready;
  $('tabs').hidden = !ready;
  $('codePanel').hidden = !ready || !selectedId;
  $('welcome').hidden = ready && !!selectedId;
  $('welcomeTitle').textContent = ready ? 'Ready when you are.'
    : connected ? 'Preparing your workspace.' : 'Connect your Studio.';
  $('welcomeDescription').textContent = ready
    ? 'Choose a script in Explorer to begin editing.'
    : connected ? 'Reading your place hierarchy. This usually takes a moment.'
      : 'Open Cursor Bridge in Roblox Studio and enter the pairing code below.';
  $('welcomeTip').hidden = !ready;

  if (previouslyConnected && !connected) {
    clipboardState = null;
    closedTabs = [];
    // Drafts remain in the recovery store, while code and Explorer are removed from view.
    persistUnsentDrafts();
    for (const id of models.keys()) cancelScriptTimers(id);
    hidePopovers();
    pendingFocusMutations.clear(); pendingFocusIds.clear();
  }
  if (selectedId) updateEditorStatus();
  quickApplySessionChanged();
  if (!ready) renderTree();
  else if (!previouslyConnected || !rowElements.size) scheduleRender();
  updateCounts();
  if (ready && selectedId) requestAnimationFrame(() => editor.layout());
  setFooter(ready ? (status.scanLimitReached ? 'Scan safety limit reached; hierarchy is incomplete.' : status.indexing ? `Indexing ${Number(status.scanIndexed || status.nodeCount || 0).toLocaleString('en-US')} instances in the background…` : `Connected to ${status.placeName}.`) : connected ? 'Preparing live Studio hierarchy…' : 'No active Studio session');
}
function resetWorkspace() {
  // Keep unsynced source before disposing Monaco models during a new pairing.
  persistUnsentDrafts();
  sessionEpoch++;
  for (const id of models.keys()) cancelScriptTimers(id);
  cancelPlaceSearch();
  placeSearchResult=null;placeSearchMatches=[];collapsedSearchGroups.clear();
  setSidebarView('explorer');
  clipboardState = null;
  closedTabs = [];
  nodes.clear();scriptNodeCount=0;pendingScriptOpenId=null;
  treeRows=[];treeRowIds=[];virtualStart=-1;virtualEnd=-1;
  selected.clear();anchorId=null;focusedId=null;expanded.clear();
  rowElements.clear();paintedSelection.clear();paintedFocus=null;
  pendingFocusMutations.clear();pendingFocusIds.clear();
  activeTabs.length=0;selectedId=null;++openEpoch;
  for (const model of models.values()) model.dispose();
  models.clear();localState.clear();editor.setModel(null);
  $('welcome').hidden=false;$('codePanel').hidden=true;
  renderTabs();scheduleRender();
}
function receiveServerEvent(event) {
  if (event.type === 'batch') {
    receivingStudioBatch = true;
    try {for (const entry of event.events) receiveServerEvent(entry);} finally {receivingStudioBatch = false;}
    if (sidebarMode === 'search') schedulePlaceSearch(190);
    return;
  }
  if (event.type === 'status') updateStatus(event.status);
  else if (event.type === 'upsert') receiveNode(event.node,event.origin);
  else if (event.type === 'reset') resetWorkspace();
  else if (event.type === 'sourceUnavailable') {
    if (event.id === pendingScriptOpenId) {
      pendingScriptOpenId = null;
      toast('Studio cannot read this script source. Check its permissions or size.', true);
    }
  }
  else if (event.type === 'remove') {
    for (const id of event.ids) {
      const local = localState.get(id), model = models.get(id);
      if (local?.dirty && model) {
        storeSafetyJournal(id, model.getValue());
        saveScriptDraft(id, model.getValue()).catch(safeError);
      }
      cancelScriptTimers(id);
      if (nodes.get(id)?.isScript) scriptNodeCount--;
      nodes.delete(id);selected.delete(id);expanded.delete(id);
      const tab = activeTabs.indexOf(id);
      if (tab !== -1) activeTabs.splice(tab,1);
      if (selectedId === id) { selectedId=null;++openEpoch;editor.setModel(null);$('welcome').hidden=false;$('codePanel').hidden=true; }
      if (models.has(id)) { models.get(id).dispose();models.delete(id); }
      localState.delete(id);
      pendingFocusIds.delete(id);
    }
    renderTabs();scheduleRender();
    if (sidebarMode === 'search') schedulePlaceSearch(190);
  }
  else if (event.type === 'conflict') {
    const local = getLocal(event.id);
    local.manualResolve = true;
    local.dirty = true;
    local.outboundSources.clear();
    cancelScriptTimers(event.id);
    const model = models.get(event.id);
    if (model) {
      storeSafetyJournal(event.id, model.getValue());
      saveScriptDraft(event.id, model.getValue()).catch(safeError);
    }
    if (event.id === selectedId) updateEditorStatus();
    renderTabs();toast(`Sync conflict: ${event.message}`,true);
  }
  else if (event.type === 'mutation') {
    if (event.status !== 'queued' && pendingClipboardMutations.has(event.opId)) {
      const clipboard = pendingClipboardMutations.get(event.opId);
      pendingClipboardMutations.delete(event.opId);
      if (event.status === 'applied' && clipboardState === clipboard) {
        clipboardState = null;
        for (const row of rowElements.values()) row.classList.remove('cut');
      }
    }
    if (event.status === 'queued') setFooter(`${event.action} queued for Studio.`);
    else {
      const pending = pendingFocusMutations.get(event.opId);
      pendingFocusMutations.delete(event.opId);
      if (pending && ['applied', 'partial'].includes(event.status)) {
        const createdIds = (event.results || []).filter((r) => r.status === 'applied').map((r) => r.id);
        if (createdIds.length) focusCreatedNode(createdIds.at(-1));
      }
      if (event.status === 'applied') setFooter(`${event.action} completed in Studio.`);
      else {
        const reason = event.results?.filter((r) => r.status !== 'applied').map((r) => r.message).find(Boolean) || event.message || 'Inspect Roblox Studio.';
        toast(`${event.action}: ${event.status}. ${reason}`,true);
      }
    }
  }
  else if (event.type === 'quickApply') handleQuickApplyEvent(event);
  else if (event.type === 'update') toast(event.message);
}

function hidePopovers() {
  $('contextMenu').hidden = true;
  $('sessionPanel').hidden = true;
  $('themePanel').hidden = true;
  $('insertMenu').hidden = true;
  $('sessionToggle').setAttribute('aria-expanded', 'false');
}
function togglePopover(name) {
  const panel = $(name), wasHidden = panel.hidden;
  hidePopovers(); panel.hidden = !wasHidden;
  $('sessionToggle').setAttribute('aria-expanded', String(name === 'sessionPanel' && wasHidden));
}
$('sessionToggle').addEventListener('click', (event) => { event.stopPropagation(); togglePopover('sessionPanel'); });
$('themeToggle').addEventListener('click', (event) => { event.stopPropagation(); togglePopover('themePanel'); });
$('closeSession').addEventListener('click', hidePopovers);
document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('.floating-panel, #sessionToggle, #themeToggle, #explorerMore, #newNode')) hidePopovers();
});
function menuItem(name, glyph, handler, { disabled = false, shortcut = '', danger = false } = {}) {
  const button = document.createElement('button');
  button.type = 'button';button.setAttribute('role','menuitem');
  button.className = `context-item${danger ? ' danger' : ''}`;
  button.disabled = disabled;
  const image = document.createElement('span'); addIcon(image, glyph, 15);
  const label = document.createElement('span');label.textContent = name;
  button.append(image, label);
  if (shortcut) { const key = document.createElement('kbd');key.textContent = shortcut;button.append(key); }
  button.addEventListener('click', () => { hidePopovers(); handler(); });
  return button;
}
function menuDivider() { const div = document.createElement('div');div.className='context-separator';return div; }
function preferredParent(id = null) {
  const chosen = nodes.get(id || focusedId || [...selected][0]);
  if (!chosen) return [...nodes.values()].find((node)=>node.className === 'Workspace')?.id ||
    [...nodes.values()].find((node)=>node.parentId === 'game')?.id || null;
  // Roblox permits descendants inside LuaSourceContainers as well as folders.
  return chosen.id;
}
// The supported classes are kept in sync with the server and Studio allowlists.
function positionMenu(menu, x, y, width = 230) {
  menu.hidden = false;
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 10))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 10))}px`;
}
function showInsertMenu(x, y, parentId) {
  if (!canMutate() || !nodes.has(parentId)) { toast('Connect Studio and select a destination.', true); return; }
  hidePopovers();
  const menu = $('insertMenu'); menu.replaceChildren();
  const caption = document.createElement('div'); caption.className = 'insert-caption';
  caption.textContent = `Insert into ${nodes.get(parentId).name}`;
  caption.title = pathForNode(nodes, parentId);
  menu.append(caption);
  const search = document.createElement('input');
  search.className = 'insert-search'; search.type = 'search';
  search.placeholder = 'Find a class…'; search.setAttribute('aria-label', 'Find an instance class');
  menu.append(search);
  const list = document.createElement('div'); list.className = 'insert-options'; menu.append(list);
  const render = () => {
    const term = search.value.trim().toLowerCase();
    list.replaceChildren();
    for (const group of INSERT_GROUPS) {
      const visible = group.classes.filter((className) => className.toLowerCase().includes(term));
      if (!visible.length) continue;
      const heading = document.createElement('div'); heading.className='insert-group'; heading.textContent=group.name;
      list.append(heading);
      for (const className of visible) {
        const item = menuItem(className, className, () => {
          runMutation({ action: 'create', parentId, className, name: className }).catch(safeError);
        });
        item.classList.add('insert-class-item');
        list.append(item);
      }
    }
    if (!list.childElementCount) {
      const empty=document.createElement('div'); empty.className='insert-group';
      empty.textContent='No matching classes';list.append(empty);
    }
  };
  search.addEventListener('input',render);
  search.addEventListener('keydown',(event)=>{
    if (event.key==='Enter') {
      const first=list.querySelector('.insert-class-item:not(:disabled)');
      if(first){event.preventDefault();first.click();}
    }
  });
  render();
  const custom=menuItem('Custom name…','edit',()=>openCreateDialog(parentId));
  menu.append(menuDivider(),custom);
  positionMenu(menu,x,y,284);
  search.focus();
}
function showContextMenu(x, y, targetId) {
  if (!canMutate()) return;
  hidePopovers();
  const menu = $('contextMenu'); menu.replaceChildren();
  const ids = mutableIds();
  const parentId = preferredParent(targetId);
  if (targetId && nodes.get(targetId)?.isScript) {
    menu.append(menuItem('Open script', 'open', () => openScript(targetId).catch(safeError)));
    menu.append(menuDivider());
  }
  menu.append(menuItem('Insert object…','plus', () => showInsertMenu(x, y, parentId), {disabled: !parentId}));
  menu.append(menuItem('Custom name…', 'edit', () => openCreateDialog(parentId), {disabled: !parentId}));
  menu.append(menuDivider());
  menu.append(menuItem('Rename','edit',openRenameDialog,{disabled:ids.length !== 1,shortcut:'F2'}));
  menu.append(menuItem('Copy', 'copy', () => copyExplorerSelection('copy'), {disabled: !ids.length, shortcut:'Ctrl C'}));
  menu.append(menuItem('Cut', 'edit', () => copyExplorerSelection('cut'), {disabled: !ids.length, shortcut:'Ctrl X'}));
  menu.append(menuItem('Paste', 'copy', () => pasteExplorer(false), {disabled: !clipboardState, shortcut:'Ctrl V'}));
  menu.append(menuItem('Paste Into', 'copy', () => pasteExplorer(true), {disabled: !clipboardState || !targetId, shortcut:'Ctrl Shift V'}));
  menu.append(menuDivider());
  menu.append(menuItem('Duplicate','duplicate',duplicateSelection,{disabled:!ids.length,shortcut:'Ctrl D'}));
  menu.append(menuItem('Move to…','move',openMoveDialog,{disabled:!ids.length}));
  menu.append(menuDivider());
  menu.append(menuItem('Delete','trash',openDeleteDialog,{disabled:!ids.length,shortcut:'Del',danger:true}));
  positionMenu(menu, x, y);
}
function showTabMenu(x, y, tabId) {
  hidePopovers();
  const menu = $('contextMenu'); menu.replaceChildren();
  menu.append(menuItem('Close tab', 'close', () => closeTab(tabId), {shortcut:'Ctrl W'}));
  menu.append(menuItem('Close other tabs', 'close', () => {
    for (const id of [...activeTabs]) if (id !== tabId) closeTab(id);
  }));
  menu.append(menuItem('Close tabs to the right', 'close', () => {
    const position = activeTabs.indexOf(tabId);
    for (const id of activeTabs.slice(position + 1)) closeTab(id);
  }));
  menu.append(menuDivider());
  menu.append(menuItem('Reveal in Explorer', 'search', () => revealInExplorer(tabId), {shortcut:'Ctrl Alt K'}));
  menu.append(menuItem('Copy hierarchy path', 'copy', () => {
    api.copyText(pathForNode(nodes, tabId)).then(() => toast('Script path copied.')).catch(safeError);
  }));
  positionMenu(menu, x, y, 220);
}
function revealInExplorer(id) {
  let current = nodes.get(id);
  const visited = new Set();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    expanded.add(current.id);
    current = nodes.get(current.parentId);
  }
  $('treeSearch').value = '';
  selected.clear(); selected.add(id); focusedId = id; anchorId = id;
  scheduleRender();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    revealTreeRow(id, true);
  }));
}
function copyExplorerSelection(mode) {
  if (!canMutate()) return;
  const ids = mutableIds();
  if (!ids.length) {toast('Select one or more child instances first.',true);return;}
  clipboardState = { mode, ids, placeKey: currentStatus.placeKey };
  for (const [id, row] of rowElements) row.classList.toggle('cut', mode === 'cut' && ids.includes(id));
  setFooter(`${ids.length} instance${ids.length===1?'':'s'} ${mode === 'cut' ? 'cut' : 'copied'}.`);
}
async function pasteExplorer(intoSelection) {
  if (!canMutate() || !clipboardState) return;
  const parent = intoSelection ? preferredParent() : [...nodes.values()].find((node)=>node.className==='Workspace')?.id;
  if (!parent) {toast('Workspace is not available.',true);return;}
  const command = clipboardMutation(clipboardState, nodes, currentStatus.placeKey, parent);
  const reply = await runMutation(command);
  if (reply?.status === 'queued') {
    expanded.add(parent);
    if (clipboardState.mode === 'cut') {
      // Clear cut styling when Studio acknowledges the move, not when queued.
      pendingClipboardMutations.set(reply.opId, clipboardState);
    }
  }
}
const pendingClipboardMutations = new Map();
function reopenLastTab() {
  while (closedTabs.length) {
    const id = closedTabs.pop();
    if (nodes.has(id) && !activeTabs.includes(id)) {openScript(id).catch(safeError);return;}
  }
  toast('No recently closed script.');
}
$('explorerMore').addEventListener('click',(event)=>{
  event.stopPropagation(); const box = event.currentTarget.getBoundingClientRect();
  showContextMenu(box.left, box.bottom + 5, focusedId);
});
$('newNode').addEventListener('click',(event)=>{
  event.stopPropagation(); const box = event.currentTarget.getBoundingClientRect();
  showInsertMenu(box.left, box.bottom + 5, preferredParent());
});
async function runMutation(request) {
  if (!canMutate()) { toast('Connect Roblox Studio before editing the hierarchy.',true); return; }
  if (['move', 'delete', 'duplicate'].includes(request.action)) {
    const ids = request.ids || [];
    const affectedUnsynced = [...localState].some(([scriptId, state]) =>
      (state.dirty || writesInFlight.has(scriptId)) &&
      ids.some((rootId) => isNodeInside(nodes, scriptId, rootId)));
    if (affectedUnsynced) {
      toast('Finish syncing or resolving changes before moving, duplicating, or deleting these scripts.', true);
      return;
    }
  }
  const reply = await api.mutateHierarchy(request);
  if (reply.status !== 'queued') { toast(`Studio did not queue ${request.action}.`,true); return; }
  if (request.action === 'create' || request.action === 'duplicate') {
    pendingFocusMutations.set(reply.opId, request.action);
  }
  setFooter(`${request.action[0].toUpperCase()}${request.action.slice(1)} sent to Studio.`);
  return reply;
}
function openCreateDialog(parentId, className = 'Script') {
  if (!canMutate() || !nodes.has(parentId)) { toast('Select a connected destination.',true); return; }
  createParentId = parentId;
  $('createClass').value = className;
  $('createName').value = className === 'Folder' ? 'New Folder' : className;
  $('createPath').textContent = `Inside ${pathForNode(nodes,parentId)}`;
  $('createDialog').showModal();
  $('createName').focus(); $('createName').select();
}
$('createClass').replaceChildren();
for (const group of INSERT_GROUPS) {
  const section = document.createElement('optgroup'); section.label = group.name;
  for (const className of group.classes) {
    const option=document.createElement('option');option.value=className;option.textContent=className;
    section.append(option);
  }
  $('createClass').append(section);
}
$('createForm').addEventListener('submit',(event)=>{
  event.preventDefault();
  const name = $('createName').value, className = $('createClass').value, parentId = createParentId;
  $('createDialog').close();
  runMutation({action:'create',parentId,className,name}).catch(safeError);
});
function openRenameDialog() {
  currentActionIds = mutableIds();
  if (currentActionIds.length !== 1 || !canMutate()) return;
  renameTargetId = currentActionIds[0];
  $('renameName').value = nodes.get(renameTargetId).name;
  $('renameDialog').showModal();$('renameName').focus();$('renameName').select();
}
$('renameForm').addEventListener('submit',(event)=>{
  event.preventDefault();
  const id = renameTargetId,name = $('renameName').value;
  $('renameDialog').close();
  runMutation({action:'rename',ids:[id],name}).catch(safeError);
});
function duplicateSelection() {
  const ids = mutableIds();
  if (!ids.length || !canMutate()) return;
  runMutation({action:'duplicate',ids}).catch(safeError);
}
function openDeleteDialog() {
  currentActionIds = mutableIds();
  if (!currentActionIds.length || !canMutate()) return;
  const count = currentActionIds.length;
  $('deleteTitle').textContent = `Delete ${count} instance${count === 1 ? '' : 's'}?`;
  $('deleteDescription').textContent =
    `This also deletes their descendants. Cursor Bridge will back up script sources before sending the request to Studio. The action is verified again in Studio.`;
  $('deleteDialog').showModal();
}
$('deleteForm').addEventListener('submit',(event)=>{
  event.preventDefault();
  const ids = [...currentActionIds];$('deleteDialog').close();
  runMutation({action:'delete',ids}).catch(safeError);
});
$('duplicateSelected').addEventListener('click',duplicateSelection);
$('moveSelected').addEventListener('click',openMoveDialog);
$('deleteSelected').addEventListener('click',openDeleteDialog);

function openMoveDialog() {
  currentActionIds = mutableIds();
  if (!currentActionIds.length || !canMutate()) return;
  selectedDestinationId = null;
  $('destinationSearch').value = '';
  $('confirmMove').disabled = true;
  renderDestinations();$('moveDialog').showModal();$('destinationSearch').focus();
}
function renderDestinations() {
  const term = $('destinationSearch').value.trim().toLowerCase();
  const chosen = currentActionIds;
  const rows = buildExplorerRows(nodes, new Set(nodes.keys()),term,7000).rows;
  const list = $('destinationList'); list.replaceChildren();
  let drawn=0;
  const fragment=document.createDocumentFragment();
  for (const row of rows) {
    const node=row.node;
    if (chosen.some((id)=>isNodeInside(nodes,node.id,id))) continue;
    if (term && !node.name.toLowerCase().includes(term) && !pathForNode(nodes,node.id).toLowerCase().includes(term)) continue;
    if (++drawn > 1500) break;
    const button=document.createElement('button'); button.className=`destination-row${selectedDestinationId===node.id ? ' active' : ''}`;
    button.setAttribute('role','option');button.setAttribute('aria-selected',String(selectedDestinationId===node.id));
    const symbol=document.createElement('span');addIcon(symbol,classIcon(node),15);
    const label=document.createElement('span');label.textContent=pathForNode(nodes,node.id);
    button.append(symbol,label);button.title=label.textContent;
    button.addEventListener('click',()=>{
      selectedDestinationId=node.id;$('confirmMove').disabled=false;
      renderDestinations();
    });
    fragment.append(button);
  }
  if (drawn===0) {const empty=document.createElement('div');empty.className='tree-empty';empty.textContent='No available destinations.';fragment.append(empty);}
  list.append(fragment);
}
$('destinationSearch').addEventListener('input',renderDestinations);
$('confirmMove').addEventListener('click',()=>{
  if (!selectedDestinationId) return;
  const parentId=selectedDestinationId,ids=[...currentActionIds];
  $('moveDialog').close();
  runMutation({action:'move',ids,parentId}).catch(safeError);
  expanded.add(parentId);scheduleRender();
});
for (const button of document.querySelectorAll('[data-close]')) {
  button.addEventListener('click',()=>$(button.dataset.close).close());
}
$('explorerHelp').addEventListener('click',()=>$('shortcutsDialog').showModal());
$('treeSearch').addEventListener('keydown',(event)=>{ if (event.key==='Escape') {$('treeSearch').value='';scheduleRender();} });
// Search operates on the actual script sources supplied by the connected Studio.
// The background worker prevents expensive searches from blocking editing/selection.
function setSidebarView(mode, focusInput = false) {
  sidebarMode = mode === 'search' ? 'search' : 'explorer';
  const searching = sidebarMode === 'search';
  $('explorerFilter').hidden = searching;
  $('treeScroller').hidden = searching;
  $('explorerBottom').hidden = searching;
  $('explorerToolbar').hidden = searching;
  $('placeSearchPanel').hidden = !searching;
  for (const [id, active] of [['explorerView', !searching], ['placeSearchView', searching]]) {
    $(id).classList.toggle('active', active);
    $(id).setAttribute('aria-selected', String(active));
  }
  if (searching) {
    if (focusInput) $('placeSearchInput').focus();
    if ($('placeSearchInput').value.trim()) schedulePlaceSearch(0);
  } else {
    cancelPlaceSearch(false);
    if (focusInput) $('treeSearch').focus();
  }
}
function openPlaceSearch() {
  if (!canMutate()) return;
  setSidebarView('search', true);
  $('placeSearchInput').select();
}
$('explorerView').addEventListener('click', () => setSidebarView('explorer'));
$('placeSearchView').addEventListener('click', openPlaceSearch);

function cancelPlaceSearch(invalidate = true) {
  clearTimeout(placeSearchTimer);
  clearTimeout(placeSearchTimeout);
  placeSearchTimer = null;
  if (placeSearchWorker) {placeSearchWorker.terminate();placeSearchWorker = null;}
  if (invalidate) ++placeSearchRequestId;
}
function placeSearchMessage(message, error = false) {
  const summary = $('placeSearchSummary');
  summary.textContent = message;
  summary.classList.toggle('error', error);
}
function placeSearchEmpty(title, subtitle = '') {
  const wrap = document.createElement('div');wrap.className = 'place-search-empty';
  const symbol = document.createElement('span');addIcon(symbol,'search',19);
  const p = document.createElement('p');p.textContent = title;
  const small = document.createElement('small');small.textContent = subtitle;
  wrap.append(symbol,p,small);
  $('placeSearchResults').replaceChildren(wrap);
}
function displayPlaceSearch(result) {
  placeSearchResult = result;
  placeSearchMatches = [];
  placeSearchActiveIndex = -1;
  $('placeSearchPrevious').disabled = !result.matchCount;
  $('placeSearchNext').disabled = !result.matchCount;
  if (result.error) {
    placeSearchMessage(result.error,true);
    placeSearchEmpty('Search pattern is not valid.', 'Review the expression and try again.');
    return;
  }
  if (!result.matchCount) {
    placeSearchMessage('No results');
    placeSearchEmpty('No matches in this Place.', 'Try a different keyword or search option.');
    return;
  }
  const skipped = placeSearchUnavailable ? ` · ${placeSearchUnavailable} unavailable` : '';
  placeSearchMessage(`${result.matchCount.toLocaleString()}${result.truncated ? '+' : ''} results in ${result.fileCount} ${result.fileCount === 1 ? 'script' : 'scripts'}${skipped}`);
  const fragment = document.createDocumentFragment();
  for (const group of result.groups) {
    const container = document.createElement('section');container.className = 'place-result-group';
    if (collapsedSearchGroups.has(group.id)) container.classList.add('collapsed');
    const header = document.createElement('button');header.type='button';header.className='place-result-header';
    header.setAttribute('aria-expanded',String(!collapsedSearchGroups.has(group.id)));
    header.title = group.path;
    const arrow = document.createElement('span');arrow.className='place-result-chevron';addIcon(arrow,'chevron',12);
    const symbol = document.createElement('span');symbol.className='place-result-class';addIcon(symbol,classIcon(group),16);
    const info = document.createElement('span');info.className='place-result-main';
    const heading = document.createElement('strong');heading.textContent=group.name;
    const path = document.createElement('small');path.textContent=group.path;
    info.append(heading,path);
    const count = document.createElement('span');count.className='place-result-count';count.textContent=String(group.matches.length);
    header.append(arrow,symbol,info,count);
    const matchesWrap = document.createElement('div');matchesWrap.className='place-result-matches';
    matchesWrap.hidden = collapsedSearchGroups.has(group.id);
    header.addEventListener('click',() => {
      const next = !container.classList.toggle('collapsed');
      matchesWrap.hidden = !next;
      header.setAttribute('aria-expanded',String(next));
      if (next) collapsedSearchGroups.delete(group.id);else collapsedSearchGroups.add(group.id);
    });
    for (const match of group.matches) {
      const index = placeSearchMatches.length;
      placeSearchMatches.push({ id:group.id, ...match });
      const row = document.createElement('button');row.type='button';row.className='place-match';
      row.dataset.searchIndex=String(index);
      row.setAttribute('aria-label', `${group.name}, line ${match.line}, column ${match.column}`);
      row.title = `${group.path}:${match.line}:${match.column}`;
      const number = document.createElement('span');number.className='place-match-line';number.textContent=match.line;
      const snippet = document.createElement('span');snippet.className='place-match-snippet';
      const preview = match.preview;
      snippet.append(document.createTextNode(preview.before));
      const mark = document.createElement('mark');mark.textContent=preview.matched;snippet.append(mark);
      snippet.append(document.createTextNode(preview.after));
      row.append(number,snippet);
      row.addEventListener('click',() => selectPlaceMatch(index));
      matchesWrap.append(row);
    }
    container.append(header,matchesWrap);
    fragment.append(container);
  }
  if (result.truncated) {
    const notice=document.createElement('div');notice.className='tree-empty';
    notice.textContent='Showing the first 3,000 matches. Narrow your search to see more.';
    fragment.append(notice);
  }
  $('placeSearchResults').replaceChildren(fragment);
}
function searchSnapshot() {
  const scripts = [];
  placeSearchUnavailable = 0;
  for (const node of nodes.values()) {
    if (!node.isScript) continue;
    const source = models.get(node.id)?.getValue() ?? node.source;
    if (typeof source !== 'string') {placeSearchUnavailable++;continue;}
    scripts.push({id: node.id, name: node.name, className:node.className,
      path: pathForNode(nodes,node.id), source });
  }
  return scripts;
}
function performPlaceSearch() {
  if (sidebarMode !== 'search' || !canMutate()) return;
  const query = $('placeSearchInput').value;
  if (!query.trim()) return;
  cancelPlaceSearch();
  const requestId = placeSearchRequestId;
  const settings = {
    matchCase: $('searchMatchCase').getAttribute('aria-pressed') === 'true',
    wholeWord: $('searchWholeWord').getAttribute('aria-pressed') === 'true',
    regex: $('searchRegex').getAttribute('aria-pressed') === 'true',
  };
  try {
    const worker = new PlaceSearchWorker();
    placeSearchWorker = worker;
    worker.onmessage = ({data}) => {
      if (requestId !== placeSearchRequestId || sidebarMode !== 'search') return;
      clearTimeout(placeSearchTimeout);
      placeSearchTimeout = null;
      displayPlaceSearch(data);
      worker.terminate();
      if (placeSearchWorker === worker) placeSearchWorker = null;
    };
    worker.onerror = () => {
      if (requestId !== placeSearchRequestId) return;
      cancelPlaceSearch();
      placeSearchMessage('Search could not be completed.',true);
    };
    placeSearchTimeout = setTimeout(() => {
      if (requestId !== placeSearchRequestId) return;
      cancelPlaceSearch();
      placeSearchMessage('Search timed out. Try a simpler expression.',true);
      placeSearchEmpty('Search stopped.', 'Use a more specific keyword or a simpler regular expression.');
    },3500);
    worker.postMessage({ type:'search',requestId,query,settings,scripts:searchSnapshot() });
  } catch (error) {
    cancelPlaceSearch();
    placeSearchMessage(error?.message || 'Search worker unavailable.',true);
  }
}
function schedulePlaceSearch(delay = 160) {
  if (sidebarMode !== 'search') return;
  cancelPlaceSearch();
  const query = $('placeSearchInput').value;
  if (!query.trim() || !canMutate()) {
    placeSearchResult = null;
    placeSearchMatches = [];
    placeSearchActiveIndex = -1;
    $('placeSearchPrevious').disabled = true;
    $('placeSearchNext').disabled = true;
    placeSearchMessage('Search every script in your connected Place.');
    placeSearchEmpty('Search across every script in your Place.', 'Results link directly to the matching line.');
    return;
  }
  placeSearchMessage('Searching scripts…');
  placeSearchTimer = setTimeout(performPlaceSearch,delay);
}
function navigateToScriptLocation(id, line = 1, column = 1, length = 1) {
  openScript(id).catch(safeError);
  if (selectedId !== id || !models.has(id)) return;
  const model = models.get(id);
  const safeLine = Math.max(1, Math.min(model.getLineCount(),line));
  const safeColumn = Math.max(1, Math.min(model.getLineMaxColumn(safeLine),column));
  const range = {startLineNumber:safeLine,startColumn:safeColumn,
    endLineNumber:safeLine,endColumn:Math.min(model.getLineMaxColumn(safeLine),safeColumn+Math.max(1,length))};
  editor.setSelection(range);
  editor.revealRangeInCenter(range);
  editor.focus();
}
function selectPlaceMatch(index) {
  if (!placeSearchMatches.length) return;
  placeSearchActiveIndex = (index + placeSearchMatches.length) % placeSearchMatches.length;
  const result = placeSearchMatches[placeSearchActiveIndex];
  if (!nodes.has(result.id)) {schedulePlaceSearch(0);return;}
  const button = $('placeSearchResults').querySelector(`[data-search-index="${placeSearchActiveIndex}"]`);
  if (button) {
    for (const active of $('placeSearchResults').querySelectorAll('.place-match.active')) active.classList.remove('active');
    button.classList.add('active');
    const group = button.closest('.place-result-group');
    if (group?.classList.contains('collapsed')) group.querySelector('.place-result-header').click();
    button.scrollIntoView({block:'nearest'});
  }
  navigateToScriptLocation(result.id,result.line,result.column,result.length);
}
function nextPlaceMatch(delta) {
  if (!placeSearchMatches.length) return;
  selectPlaceMatch(placeSearchActiveIndex < 0 ? (delta < 0 ? placeSearchMatches.length - 1 : 0) : placeSearchActiveIndex+delta);
}
$('placeSearchInput').addEventListener('input',() => schedulePlaceSearch());
$('placeSearchInput').addEventListener('keydown',(event) => {
  if (event.key === 'Enter' && placeSearchMatches.length) {event.preventDefault();nextPlaceMatch(1);}
  if (event.key === 'Escape') {event.preventDefault();$('placeSearchInput').value='';schedulePlaceSearch(0);}
});
for (const id of ['searchMatchCase','searchWholeWord','searchRegex']) {
  $(id).addEventListener('click',() => {
    const button=$(id);
    button.setAttribute('aria-pressed',String(button.getAttribute('aria-pressed') !== 'true'));
    schedulePlaceSearch(0);
    $('placeSearchInput').focus();
  });
}
$('placeSearchNext').addEventListener('click',() => nextPlaceMatch(1));
$('placeSearchPrevious').addEventListener('click',() => nextPlaceMatch(-1));

function openQuickOpen() {
  if (!canMutate()) return;
  const dialog = $('quickOpenDialog');
  $('quickOpenSearch').value = '';
  quickOpenActiveIndex = 0;
  renderQuickOpen();
  if (!dialog.open) dialog.showModal();
  $('quickOpenSearch').focus();
}
function renderQuickOpen() {
  const parsed = parseQuickOpenQuery($('quickOpenSearch').value);
  const entries = [...nodes.values()].filter((node)=>node.isScript && typeof node.source === 'string')
    .map((node)=>({id:node.id,name:node.name,className:node.className,path:pathForNode(nodes,node.id)}));
  const matching = quickOpenMatches(entries,parsed.query,activeTabs.slice().reverse());
  const list = $('quickOpenResults');list.replaceChildren();
  $('quickOpenCount').textContent = `${matching.length}${matching.length === 80 ? '+' : ''} matching of ${entries.length} scripts`;
  quickOpenActiveIndex = Math.min(quickOpenActiveIndex,Math.max(0,matching.length - 1));
  matching.forEach((node,index) => {
    const button = document.createElement('button');
    button.type='button';button.className=`quick-result${index===quickOpenActiveIndex?' active':''}`;
    button.dataset.quickIndex=String(index);
    button.setAttribute('role','option');
    button.setAttribute('aria-selected',String(index===quickOpenActiveIndex));
    const symbol=document.createElement('span');addIcon(symbol,classIcon(node),16);
    const labels=document.createElement('span');labels.className='quick-result-info';
    const heading=document.createElement('strong');heading.textContent=node.name;
    const sub=document.createElement('small');sub.textContent=node.path;sub.title=node.path;
    labels.append(heading,sub);button.append(symbol,labels);
    if (parsed.line) {
      const line=document.createElement('span');line.className='quick-result-line';line.textContent=`:${parsed.line}`;button.append(line);
    }
    button.addEventListener('mousemove',() => {
      if (quickOpenActiveIndex !== index) {quickOpenActiveIndex=index;paintQuickOpenSelection();}
    });
    button.addEventListener('click',()=> {
      $('quickOpenDialog').close();navigateToScriptLocation(node.id,parsed.line || 1,parsed.column);
    });
    list.append(button);
  });
  if (!matching.length) {
    const empty=document.createElement('div');empty.className='quick-result-empty';
    empty.textContent='No matching scripts in this Place.';list.append(empty);
  }
}
function paintQuickOpenSelection() {
  for (const button of $('quickOpenResults').querySelectorAll('.quick-result')) {
    const active=Number(button.dataset.quickIndex)===quickOpenActiveIndex;
    button.classList.toggle('active',active);
    button.setAttribute('aria-selected',String(active));
  }
  $('quickOpenResults').querySelector('.quick-result.active')?.scrollIntoView({block:'nearest'});
}
$('quickOpenSearch').addEventListener('input',()=>{quickOpenActiveIndex=0;renderQuickOpen();});
$('quickOpenSearch').addEventListener('keydown',(event)=>{
  const count=$('quickOpenResults').querySelectorAll('.quick-result').length;
  if (event.key==='Enter') {event.preventDefault();$('quickOpenResults').querySelector('.quick-result.active')?.click();}
  else if(['ArrowDown','ArrowUp'].includes(event.key)) {
    event.preventDefault();if(!count)return;
    quickOpenActiveIndex=(quickOpenActiveIndex+(event.key==='ArrowDown'?1:-1)+count)%count;
    paintQuickOpenSelection();
  }
});
$('quickOpenResults').addEventListener('keydown',(event)=>{
  if (!['ArrowDown','ArrowUp'].includes(event.key)) return;
  event.preventDefault();$('quickOpenSearch').focus();
  $('quickOpenSearch').dispatchEvent(new KeyboardEvent('keydown', {key:event.key,bubbles:false}));
});
// Capture editor-owned shortcuts before Monaco handles them, without replacing Ctrl+F.
window.addEventListener('keydown',(event) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  const key=event.key.toLowerCase();
  if (key==='p' && !event.shiftKey) {
    if (document.querySelector('dialog[open]') && !$('quickOpenDialog').open) return;
    event.preventDefault();event.stopImmediatePropagation();
    if ($('quickOpenDialog').open) $('quickOpenSearch').focus();else openQuickOpen();
  } else if (event.shiftKey && (key==='f'||key==='e')) {
    if (document.querySelector('dialog[open]')) return;
    event.preventDefault();event.stopImmediatePropagation();
    if (key==='f') openPlaceSearch(); else if (canMutate()) setSidebarView('explorer',true);
  }
},true);
window.addEventListener('keydown',(event)=>{
  if (event.key !== 'F4' || sidebarMode !== 'search' || document.querySelector('dialog[open]'))return;
  event.preventDefault();event.stopImmediatePropagation();nextPlaceMatch(event.shiftKey ? -1 : 1);
},true);

function focusRowByOffset(offset, extendSelection = false, absoluteIndex = null) {
  if (!treeRows.length) return;
  const currentIndex = rowIds().indexOf(focusedId);
  const nextIndex = absoluteIndex == null
    ? Math.max(0, Math.min(treeRows.length - 1, currentIndex + offset))
    : Math.max(0, Math.min(treeRows.length - 1, absoluteIndex));
  const id = treeRows[nextIndex].id;
  selectForRow(id, extendSelection, false);
  revealTreeRow(id, true);
}
window.addEventListener('keydown',(event)=>{
  if (document.querySelector('dialog[open]')) return;
  const key = event.key.toLowerCase();
  const mod = event.ctrlKey || event.metaKey;
  const focused = document.activeElement;
  const inForm = focused?.matches('input,textarea,select,[contenteditable="true"]');
  const inEditor = !!focused?.closest('.monaco-editor');
  const inExplorer = !!focused?.closest('.explorer-pane');
  if (mod && event.shiftKey && key === 'x') {
    event.preventDefault();
    if (canMutate()) {$('treeSearch').focus(); $('treeSearch').select();}
    return;
  }
  if (mod && key === 'k') {
    event.preventDefault();
    if (canMutate()) {$('treeSearch').focus(); $('treeSearch').select();}
    return;
  }
  if (mod && event.altKey && key === 'k' && selectedId) {
    event.preventDefault(); revealInExplorer(selectedId);return;
  }
  if (mod && key === 'w' && selectedId) {event.preventDefault();closeTab(selectedId);return;}
  if (mod && event.shiftKey && key === 't') {event.preventDefault();reopenLastTab();return;}
  if (mod && key === 'tab' && activeTabs.length) {
    event.preventDefault();
    const delta = event.shiftKey ? -1 : 1;
    const next=(activeTabs.indexOf(selectedId) + delta + activeTabs.length) % activeTabs.length;
    openScript(activeTabs[next]).catch(safeError);return;
  }
  if (mod && !event.shiftKey && !event.altKey && /^[1-9]$/.test(key) && activeTabs.length) {
    event.preventDefault();
    const id = activeTabs[Number(key) - 1];
    if (id) openScript(id).catch(safeError);
    return;
  }
  if (!inForm && !inEditor && mod && ['=','+','-','0'].includes(key)) {
    event.preventDefault();
    changeEditorZoom(key === '0' ? 0 : key === '-' ? -1 : 1);
    return;
  }
  if (key === 'escape') {
    hidePopovers();
    if (inExplorer && selected.size) {selected.clear();focusedId=null;anchorId=null;paintSelection();}
    return;
  }
  if (sidebarMode !== 'explorer' || !inExplorer || inForm || inEditor || !canMutate()) return;
  if (mod && key === 'a') {event.preventDefault();selected.clear();for(const row of treeRows)selected.add(row.id);paintSelection();return;}
  if (mod && key === 'c') {event.preventDefault();copyExplorerSelection('copy');return;}
  if (mod && key === 'x') {event.preventDefault();copyExplorerSelection('cut');return;}
  if (mod && key === 'v') {event.preventDefault();pasteExplorer(event.shiftKey).catch(safeError);return;}
  if (mod && key === 'i') {
    event.preventDefault();const parent=preferredParent();
    const row=rowElements.get(parent);
    const bounds=row?.getBoundingClientRect() || $('newNode').getBoundingClientRect();
    showInsertMenu(bounds.left+24,bounds.bottom+3,parent);return;
  }
  if (event.key === 'F2') {event.preventDefault();openRenameDialog();return;}
  if (event.key === 'Delete') {event.preventDefault();openDeleteDialog();return;}
  if (mod && key === 'd') {event.preventDefault();duplicateSelection();return;}
  if (event.key === 'ArrowDown') {event.preventDefault();focusRowByOffset(1,event.shiftKey);return;}
  if (event.key === 'ArrowUp') {event.preventDefault();focusRowByOffset(-1,event.shiftKey);return;}
  if (event.key === 'Home') {event.preventDefault();focusRowByOffset(0,event.shiftKey,0);return;}
  if (event.key === 'End') {event.preventDefault();focusRowByOffset(0,event.shiftKey,treeRows.length-1);return;}
  if (event.key === 'PageDown' || event.key === 'PageUp') {
    event.preventDefault();
    const pageCount=Math.max(1,Math.floor($('treeScroller').clientHeight/25));
    focusRowByOffset(event.key === 'PageDown'?pageCount:-pageCount,event.shiftKey);return;
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault();const node=treeRows.find((row)=>row.id===focusedId);
    if(node?.hasChildren && !expanded.has(focusedId)){expanded.add(focusedId);scheduleRender();}
    else if(node?.hasChildren){const index=rowIds().indexOf(focusedId);focusRowByOffset(0,false,index+1);}
    return;
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    if(expanded.has(focusedId)){expanded.delete(focusedId);scheduleRender();return;}
    const parentId=nodes.get(focusedId)?.parentId;
    if(rowElements.has(parentId)){selectOnly(parentId);rowElements.get(parentId)?.focus({preventScroll:true});}
  }
});

$('copyCode').addEventListener('click',async()=>{
  if (currentStatus.pairingCode) {await api.copyText(currentStatus.pairingCode);toast('Pairing code copied.');}
});
$('openBackups').addEventListener('click',()=>api.openBackupsFolder().then(()=>{hidePopovers();toast('Recovery folder opened.');}).catch(safeError));
$('checkUpdates').addEventListener('click',async()=>{
  const result=await api.checkForUpdates();hidePopovers();toast(result.reason || 'Checking for updates.');
});
$('disconnectButton').addEventListener('click',async()=>{
  if (!window.confirm('Disconnect this Studio session? All unconfirmed edits are preserved as local drafts.')) return;
  try {await api.disconnect();hidePopovers();toast('Studio session disconnected.');}catch(error){safeError(error);}
});
$('openStudio').addEventListener('click',async()=>{
  if (!selectedId) return;
  try {await api.openStudioScript(selectedId);toast('Requested Studio to open this script.');}catch(error){safeError(error);}
});
$('viewBackups').addEventListener('click',async()=>{
  if (!selectedId) return;
  const id=selectedId,entries=$('historyEntries');entries.replaceChildren();
  try {
    const versions=await api.getBackups(id);
    if (!versions.length) {const empty=document.createElement('p');empty.textContent='No script backups recorded yet.';entries.append(empty);}
    for (const version of versions) {
      const button=document.createElement('button');button.className='history-entry';
      const title=document.createElement('strong');title.textContent=version.reason+(version.fromPreviousSession ? ' · previous session' : '');
      const subtitle=document.createElement('small');subtitle.textContent=`${version.at} · ${version.bytes} bytes`;
      button.append(title,subtitle);
      button.addEventListener('click',async()=>{
        if (!window.confirm('Open this backup as a protected local draft? This does not overwrite Studio.'))return;
        try {
          const result=await api.restoreBackup(id,version.id,version.storageScriptId);
          await openScript(id);
          suppressChange=true;models.get(id).setValue(result.source);suppressChange=false;
          const local=getLocal(id);local.editVersion++;local.dirty=true;local.manualResolve=true;
          storeSafetyJournal(id,result.source);
          await saveScriptDraft(id,result.source);
          $('historyDialog').close();updateEditorStatus();renderTabs();
          toast('Backup loaded as a local draft. Use Apply draft when ready.');
        }catch(error){safeError(error);}
      });
      entries.append(button);
    }
    $('historyDialog').showModal();
  }catch(error){safeError(error);}
});

// Explorer width is stored locally; the divider works without native window chrome.
const widthKey='cursor-bridge-explorer-width';
function setExplorerWidth(width) {
  const safe=Math.max(210,Math.min(460,width));
  document.documentElement.style.setProperty('--explorer-width',`${safe}px`);
  localStorage.setItem(widthKey,String(safe));
}
setExplorerWidth(Number(localStorage.getItem(widthKey)) || 286);
$('resizeDivider').addEventListener('pointerdown',(event)=>{
  if (event.button!==0) return;
  const divider=$('resizeDivider'),startX=event.clientX,startWidth=$('explorerPane').getBoundingClientRect().width;
  divider.setPointerCapture(event.pointerId);divider.classList.add('resizing');
  const drag=(move)=>setExplorerWidth(startWidth+move.clientX-startX);
  const stop=()=>{divider.classList.remove('resizing');divider.removeEventListener('pointermove',drag);divider.removeEventListener('pointerup',stop);divider.removeEventListener('pointercancel',stop);};
  divider.addEventListener('pointermove',drag);divider.addEventListener('pointerup',stop);divider.addEventListener('pointercancel',stop);
});
$('resizeDivider').addEventListener('keydown',(event)=>{
  if (event.key==='ArrowLeft' || event.key==='ArrowRight') {event.preventDefault();setExplorerWidth($('explorerPane').getBoundingClientRect().width+(event.key==='ArrowRight'?15:-15));}
});

// Quick Apply uses the exact plain-text delivery contract; it never executes AI text.
const quickApplyDraftKey = 'cursor-bridge-quick-apply-draft';
const quickApplyFormat = [
  'Return all newly created or modified Roblox Luau scripts in ONE plain .txt document.',
  'Include ONLY scripts that must actually change. Supply their COMPLETE final source, not patches.',
  'Use exact, case-sensitive paths from the Roblox Studio Explorer.',
  'Each Luau source must begin on its first code line with --!strict.',
  'All script code and comments must be in English.',
  'Use STATUS: MODIFIED only for an existing script and STATUS: NEW for a new one.',
  'For every NEW script also include CLASS: Script, CLASS: LocalScript, or CLASS: ModuleScript.',
  'If CLASS is omitted for NEW, Cursor Bridge defaults to Script; users can change it in the preview.',
  'Paths must use forward slashes, beginning at game/Workspace, game/ServerScriptService, etc.',
  'Missing intermediate folders in NEW script paths will be created automatically.',
  'Do not use markdown fences, explanations, or text outside the script blocks.',
  'Repeat the following header for EVERY script, using exactly 50 equals signs:',
  '',
  '==================================================',
  'SCRIPT: ExampleScript',
  'PATH: game/ServerScriptService/Systems/ExampleScript',
  'STATUS: NEW',
  'CLASS: Script',
  '==================================================',
  '',
  '--!strict',
  '',
  'print("Hello from Cursor Bridge")',
].join('\n');

let quickApplyPreview = null;
let quickApplyTimer = null;
let quickApplyRequestEpoch = 0;
let quickApplyApplying = false;
let quickApplyPendingOpId = null;
const quickApplyOverrides = {};
const qa = (id) => $(id);

function quickApplyNotice(message, error = false) {
  qa('quickApplyMessage').textContent = message;
  qa('quickApplyMessage').classList.toggle('qa-error', error);
}
function quickApplyRefreshButton() {
  const summary = quickApplyPreview?.summary;
  qa('quickApplyConfirm').disabled = !canMutate() || quickApplyApplying || !quickApplyPreview?.token ||
    !quickApplyPreview.ok || !summary || summary.errors > 0 || summary.create + summary.modify === 0;
  qa('quickApplyConfirm').textContent = quickApplyApplying ? 'Waiting for Studio…' : 'Apply to Studio';
}
function quickApplyClearPreview() {
  quickApplyRequestEpoch++;
  clearTimeout(quickApplyTimer);
  quickApplyPreview = null;
  qa('quickApplyEntries').replaceChildren();
  qa('quickApplySummary').replaceChildren();
  quickApplyRefreshButton();
}
function quickApplyHelp(text) {
  const wrapper = document.createElement('div');
  wrapper.className = 'qa-hint';
  const glyph = document.createElement('span'); addIcon(glyph, 'help', 16);
  const label = document.createElement('p'); label.textContent = text;
  wrapper.append(glyph, label);
  qa('quickApplySummary').replaceChildren(wrapper);
}
function quickApplyRenderPreview(reply) {
  const summary = reply.summary;
  const metrics = document.createElement('div'); metrics.className = 'qa-metrics';
  for (const [value, label, invalid] of [
    [summary.create, 'To create', false],
    [summary.modify, 'To replace', false],
    [summary.unchanged, 'Unchanged', false],
    [summary.errors, 'Needs attention', true],
  ]) {
    if (!value && !invalid) continue;
    const item = document.createElement('div'); item.className = `qa-metric${invalid && value ? ' invalid' : ''}`;
    const number = document.createElement('strong'); number.textContent = String(value);
    const caption = document.createElement('span'); caption.textContent = label;
    item.append(number, caption); metrics.append(item);
  }
  qa('quickApplySummary').replaceChildren(metrics);
  const fragment = document.createDocumentFragment();
  for (const entry of reply.entries) {
    const row = document.createElement('div'); row.className = 'qa-entry'; row.setAttribute('role', 'listitem');
    const symbol = document.createElement('span'); symbol.className = 'qa-entry-icon'; addIcon(symbol, entry.className || 'Script', 17);
    const info = document.createElement('div'); info.className = 'qa-entry-main';
    const title = document.createElement('span'); title.className = 'qa-entry-name'; title.textContent = entry.name;
    const path = document.createElement('span'); path.className = 'qa-entry-path'; path.textContent = entry.path;
    const metadata = document.createElement('span'); metadata.className = `qa-entry-meta${entry.action === 'error' ? ' error' : ''}`;
    if (entry.action === 'create') {
      const folders = entry.missingFolders.length;
      metadata.textContent = folders ? `Creates ${folders} missing folder${folders > 1 ? 's' : ''}${entry.duplicateName ? ' · Same-name script exists' : ''}`
        : entry.duplicateName ? 'Creates a separate same-name script' : `New ${entry.className}`;
    } else if (entry.action === 'modify') metadata.textContent = `Existing ${entry.className} · ${Math.ceil(entry.bytes / 1024)} KiB`;
    else if (entry.action === 'unchanged') metadata.textContent = 'Source already matches Studio';
    else metadata.textContent = entry.message || 'Destination is unavailable';
    info.append(title, path, metadata);
    const controls = document.createElement('div');
    if (entry.status === 'NEW' && entry.action !== 'error') {
      const select = document.createElement('select'); select.className = 'qa-entry-type';
      select.setAttribute('aria-label', `Type for ${entry.name}`);
      for (const type of ['Script', 'LocalScript', 'ModuleScript']) {
        const option = document.createElement('option'); option.value = type; option.textContent = type;
        select.append(option);
      }
      select.value = entry.className;
      select.addEventListener('change', () => {
        quickApplyOverrides[entry.index] = select.value;
        quickApplySchedulePreview(0);
      });
      controls.append(select);
    } else {
      const state = document.createElement('span'); state.className = `qa-entry-state ${entry.action}`;
      state.textContent = ({ modify: 'REPLACE', create: 'CREATE', unchanged: 'MATCH', error: 'ERROR' })[entry.action] || 'CHECK';
      controls.append(state);
    }
    row.append(symbol, info, controls);
    fragment.append(row);
  }
  qa('quickApplyEntries').replaceChildren(fragment);
  if (summary.errors) quickApplyNotice(`Resolve ${summary.errors} destination error(s) before applying.`, true);
  else if (summary.create + summary.modify) quickApplyNotice('Review the exact paths. Nothing has been changed yet.');
  else quickApplyNotice('All script contents already match your Place.');
  quickApplyRefreshButton();
}
async function quickApplyPreviewText() {
  const epoch = ++quickApplyRequestEpoch;
  const value = qa('quickApplyText').value;
  quickApplyPreview = null;
  quickApplyRefreshButton();
  const bytes = new TextEncoder().encode(value).length;
  qa('quickApplySize').textContent = `${(bytes / 1024).toFixed(1)} / 512 KiB`;
  if (!value.trim()) {
    quickApplyHelp('Paste an AI-generated bundle. Every script will appear here with its resolved Studio destination.');
    qa('quickApplyEntries').replaceChildren();
    quickApplyNotice('Nothing is sent until you apply.');
    return;
  }
  if (bytes > 512 * 1024) {
    quickApplyHelp('Your bundle exceeds 512 KiB. Split it into smaller deliveries.');
    qa('quickApplyEntries').replaceChildren();
    quickApplyNotice('Maximum bundle size exceeded.', true);
    return;
  }
  if (!canMutate()) {
    quickApplyHelp('Connect to a Roblox Studio Place to resolve script paths. Your pasted text remains saved locally.');
    qa('quickApplyEntries').replaceChildren();
    quickApplyNotice('Waiting for Roblox Studio connection.');
    return;
  }
  quickApplyNotice('Checking the live Explorer…');
  try {
    const response = await api.previewQuickApply(value, { ...quickApplyOverrides });
    if (epoch !== quickApplyRequestEpoch) return;
    quickApplyPreview = response;
    quickApplyRenderPreview(response);
  } catch (error) {
    if (epoch !== quickApplyRequestEpoch) return;
    quickApplyHelp(error?.message || 'Cannot read this bundle.');
    qa('quickApplyEntries').replaceChildren();
    quickApplyNotice(error?.message || 'Invalid bundle.', true);
  }
}
function quickApplySchedulePreview(wait = 280) {
  clearTimeout(quickApplyTimer);
  quickApplyPreview = null;
  quickApplyRefreshButton();
  quickApplyTimer = setTimeout(quickApplyPreviewText, wait);
}
function openQuickApply() {
  if (!qa('quickApplyDialog').open) qa('quickApplyDialog').showModal();
  qa('quickApplyPlace').textContent = canMutate() ? currentStatus.placeName : 'Studio offline';
  qa('quickApplyText').focus();
  if (!quickApplyApplying) quickApplySchedulePreview(0);
}
function quickApplySessionChanged() {
  qa('quickApplyPlace').textContent = canMutate() ? currentStatus.placeName : 'Studio offline';
  quickApplyPreview = null;
  quickApplyRefreshButton();
  if (qa('quickApplyDialog').open && !quickApplyApplying) quickApplySchedulePreview(0);
}
function handleQuickApplyEvent(event) {
  if (event.status === 'queued') {
    if (!quickApplyPendingOpId) quickApplyPendingOpId = event.opId;
    quickApplyApplying = true;
    quickApplyRefreshButton();
    quickApplyNotice(`Applying ${event.count} scripts in Studio. Keep the Place open.`);
    return;
  }
  if (quickApplyPendingOpId && event.opId !== quickApplyPendingOpId) return;
  quickApplyPendingOpId = null;
  quickApplyApplying = false;
  quickApplyRefreshButton();
  if (event.status === 'applied') {
    qa('quickApplyText').value = '';
    localStorage.removeItem(quickApplyDraftKey);
    quickApplyClearPreview();
    quickApplyHelp('All changes were confirmed by Roblox Studio. Select any script in Explorer to inspect it.');
    quickApplyNotice(`${event.count} script(s) applied in Studio.`);
    toast(`Quick Apply completed: ${event.count} scripts.`);
  } else {
    const reason = event.results?.map((r) => r.message).find(Boolean) || event.message ||
      'Studio could not confirm the operation.';
    quickApplyClearPreview();
    quickApplyHelp(`Studio status: ${event.status}. ${reason}`);
    quickApplyNotice(`Not completed: ${event.status}. Original bundle is saved in recovery.`, true);
    toast(`Quick Apply: ${event.status}. ${reason}`, true);
  }
}

qa('quickApplyLauncher').addEventListener('click', openQuickApply);
qa('quickCopyFormat').addEventListener('click', async () => {
  try { await api.copyText(quickApplyFormat); toast('AI delivery instructions copied.'); }
  catch (error) { safeError(error); }
});
qa('quickApplyClear').addEventListener('click', () => {
  if (quickApplyApplying) return;
  qa('quickApplyText').value = '';
  for (const key of Object.keys(quickApplyOverrides)) delete quickApplyOverrides[key];
  localStorage.removeItem(quickApplyDraftKey);
  quickApplySchedulePreview(0);
});
qa('quickApplyText').addEventListener('input', () => {
  if (quickApplyApplying) return;
  for (const key of Object.keys(quickApplyOverrides)) delete quickApplyOverrides[key];
  if (new TextEncoder().encode(qa('quickApplyText').value).length < 520 * 1024) {
    try { localStorage.setItem(quickApplyDraftKey, qa('quickApplyText').value); } catch {}
  }
  quickApplySchedulePreview();
});
qa('quickApplyFile').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file || quickApplyApplying) return;
  if (file.size > 512 * 1024) { quickApplyNotice('The selected TXT exceeds 512 KiB.', true); return; }
  try {
    qa('quickApplyText').value = await file.text();
    qa('quickApplyText').dispatchEvent(new Event('input', { bubbles: true }));
  } catch (error) { safeError(error); }
});
qa('quickApplyConfirm').addEventListener('click', async () => {
  const preview = quickApplyPreview;
  if (!preview?.ok || !preview.token || !canMutate() || quickApplyApplying) return;
  if ([...localState.values()].some((state) => state.dirty) || writesInFlight.size > 0) {
    quickApplyNotice('Finish syncing or resolving local editor changes before Quick Apply.', true);
    return;
  }
  if (!window.confirm(`Apply ${preview.summary.create} new and ${preview.summary.modify} modified script(s) to ${currentStatus.placeName}?\n\nAll modified script sources will be backed up first.`)) return;
  quickApplyApplying = true;
  quickApplyRefreshButton();
  quickApplyNotice('Saving recovery data before applying…');
  try {
    const queued = await api.applyQuickApply(preview.token);
    if (quickApplyApplying) {
      quickApplyPendingOpId = queued.opId;
      quickApplyNotice(`Queued ${queued.count} script(s). Waiting for the Studio confirmation…`);
    }
  } catch (error) {
    quickApplyApplying = false;
    quickApplyClearPreview();
    quickApplyNotice(error?.message || 'Quick Apply failed before any Studio changes.', true);
    quickApplyRefreshButton();
  }
});
try { qa('quickApplyText').value = localStorage.getItem(quickApplyDraftKey) || ''; } catch {}
window.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'l') return;
  if (document.querySelector('dialog[open]') && !qa('quickApplyDialog').open) return;
  event.preventDefault(); event.stopImmediatePropagation();
  openQuickApply();
}, true);

async function start() {
  if (!api) {setFooter('Launch Cursor Bridge through the Windows application.');return;}
  const initialEvents = [];
  let initializing = true;
  api.onEvent((event) => {
    if (initializing) initialEvents.push(event);
    else receiveServerEvent(event);
  });
  const state=await api.getState();
  if (state.status.connected) for (const node of state.nodes) { nodes.set(node.id,node); if (node.isScript) scriptNodeCount++; }
  for (const node of nodes.values()) if (node.parentId === 'game') expanded.add(node.id);
  updateStatus(state.status);renderTree();renderTabs();
  initializing = false;
  for (const event of initialEvents) receiveServerEvent(event);
  $('appVersion').textContent=`v${await api.getAppVersion()}`;
}
start().catch(safeError);
