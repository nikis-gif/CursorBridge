import { LAYOUT_DEFAULTS, loadLayout, normalizeLayout, saveLayout, resizeSidebar, splitRatioAt } from './layout-state.mjs';

const TAB_MIME = 'application/x-cursor-bridge-tab';
const PANEL_MIME = 'application/x-cursor-bridge-panel';

/** Presentation controller. Documents and all writes remain owned by app.js. */
export function mountWorkspace(adapter) {
  const $ = (id) => document.getElementById(id);
  const abort = new AbortController();
  const subscriptions = [];
  let storage;
  try { storage = window.localStorage; } catch { /* Private storage can be disabled. */ }
  let layout = loadLayout(storage);
  let secondary = null;
  let secondaryId = null;
  let home = false;
  let focusedGroup = 'primary';
  let refreshFrame = 0;
  let disposed = false;
  let dragKind = null;
  const secondaryViews = new Map();
  const listen = (node, event, handler, options = {}) =>
    node.addEventListener(event, handler, { ...options, signal: abort.signal });
  const text = (id, value) => {
    const node = $(id);
    if (node.textContent !== String(value)) node.textContent = String(value);
  };
  const pressed = (id, value) => $(id).setAttribute('aria-pressed', String(value));
  const remember = (subscription) => { if (subscription?.dispose) subscriptions.push(subscription); };
  const snapshot = () => adapter.getSnapshot();

  function applyLayout(persist = true) {
    layout = normalizeLayout(layout);
    document.body.dataset.sidebarSide = layout.sidebarSide;
    document.body.dataset.explorerHidden = String(!layout.sidebarVisible);
    document.body.dataset.reduceMotion = String(layout.reduceMotion);
    $('editorArea').dataset.splitDirection = layout.splitDirection;
    document.documentElement.style.setProperty('--explorer-width', `${layout.sidebarWidth}px`);
    $('editorArea').style.setProperty('--split-ratio', String(layout.splitRatio));
    $('resizeDivider').setAttribute('aria-valuenow', String(Math.round(layout.sidebarWidth)));
    $('splitDivider').setAttribute('aria-valuenow', String(Math.round(layout.splitRatio * 100)));
    $('splitDivider').setAttribute('aria-orientation', layout.splitDirection === 'vertical' ? 'vertical' : 'horizontal');
    pressed('dockLeft', layout.sidebarSide === 'left');
    pressed('dockRight', layout.sidebarSide === 'right');
    pressed('layoutVertical', layout.splitDirection === 'vertical');
    pressed('layoutHorizontal', layout.splitDirection === 'horizontal');
    $('sidebarVisibleSetting').checked = layout.sidebarVisible;
    $('reduceMotionSetting').checked = layout.reduceMotion;
    if (persist) saveLayout(storage, layout);
    refresh();
  }

  function setLayout(patch, persist = true) {
    layout = normalizeLayout({ ...layout, ...patch });
    applyLayout(persist);
  }

  function showEditor() { home = false; focusedGroup = 'primary'; refresh(); }
  function revealExplorer() { setLayout({ sidebarVisible: true }); }
  function showHome() { home = true; refresh(); }
  function primaryDocument() { return snapshot().currentId; }
  function activeDocument() { return focusedGroup === 'secondary' && secondaryId ? secondaryId : primaryDocument(); }

  function closeSplit({ focus = true } = {}) {
    if (secondaryId && secondary) secondaryViews.set(secondaryId, secondary.saveViewState());
    secondary?.setModel(null);
    secondaryId = null;
    focusedGroup = 'primary';
    if (focus) adapter.editor.focus();
    refresh();
  }

  function syncPreferences(preferences) {
    secondary?.updateOptions({
      fontFamily: preferences.fontFamily,
      fontSize: preferences.fontSize,
      lineHeight: Math.round(preferences.fontSize * 1.65),
      wordWrap: preferences.wordWrap ? 'on' : 'off',
      minimap: { enabled: preferences.minimap },
    });
  }

  function ensureSecondary() {
    if (secondary) return secondary;
    secondary = adapter.monaco.editor.create($('secondaryMonacoHost'), {
      model: null,
      automaticLayout: true,
      fontLigatures: true,
      smoothScrolling: true,
      mouseWheelZoom: true,
      scrollBeyondLastLine: false,
      padding: { top: 17, bottom: 20 },
      minimap: { enabled: false },
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true, indentation: true },
      quickSuggestions: { other: true, comments: false, strings: false },
    });
    syncPreferences(adapter.getEditorPreferences());
    remember(secondary.onDidFocusEditorText(() => { focusedGroup = 'secondary'; refresh(); }));
    remember(secondary.onDidChangeCursorPosition((event) => {
      text('secondaryCursor', `Ln ${event.position.lineNumber}, Col ${event.position.column}`);
    }));
    // No edit listener here: each shared Monaco model has exactly one save pipeline.
    return secondary;
  }

  function openSplit(id = activeDocument(), direction = layout.splitDirection) {
    const doc = id && adapter.getDocument(id);
    if (!snapshot().ready || !doc?.model || doc.model.isDisposed()) {
      adapter.toast('Open a script before splitting the editor.');
      return false;
    }
    home = false;
    setLayout({ splitDirection: direction });
    const view = ensureSecondary();
    if (secondaryId && secondaryId !== id) secondaryViews.set(secondaryId, view.saveViewState());
    if (view.getModel() !== doc.model) {
      view.setModel(doc.model);
      view.restoreViewState(secondaryViews.get(id) || adapter.editor.saveViewState());
    }
    secondaryId = id;
    focusedGroup = 'secondary';
    render();
    requestAnimationFrame(() => { if (!disposed && secondaryId) { view.layout(); view.focus(); } });
    return true;
  }

  function removeDocument(id) {
    if (secondaryId === id) closeSplit({ focus: false });
    secondaryViews.delete(id);
  }

  function resetSession() {
    closeSplit({ focus: false });
    secondaryViews.clear();
    home = false;
    clearDrag();
  }

  function render() {
    if (disposed) return;
    const state = snapshot();
    const ready = state.ready;
    const current = state.currentId;
    if (!ready && secondaryId) closeSplit({ focus: false });
    const doc = secondaryId && adapter.getDocument(secondaryId);
    if (secondaryId && (!doc?.model || doc.model.isDisposed())) closeSplit({ focus: false });
    document.body.dataset.sessionReady = String(ready);
    const showCode = ready && !!current && !home;
    $('welcome').hidden = showCode;
    $('codePanel').hidden = !showCode;
    $('editorArea').dataset.home = String(home);
    const showSecond = ready && !!secondaryId && !home;
    $('secondaryPane').hidden = !showSecond;
    $('splitDivider').hidden = !showSecond;
    $('editorArea').classList.toggle('is-split', showSecond);
    $('secondaryPane').classList.toggle('group-focused', showSecond && focusedGroup === 'secondary');
    $('primaryPane').classList.toggle('group-focused', !showSecond || focusedGroup === 'primary');
    const onHome = home || !current;
    pressed('railHome', onHome);
    pressed('railExplorer', !onHome && layout.sidebarVisible && state.sidebarMode === 'explorer');
    pressed('railSearch', layout.sidebarVisible && state.sidebarMode === 'search');
    pressed('splitEditor', showSecond);
    $('splitEditor').disabled = !ready || !current;
    $('layoutVertical').disabled = !ready || (!current && !secondaryId);
    $('layoutHorizontal').disabled = !ready || (!current && !secondaryId);
    for (const id of ['railExplorer', 'railSearch', 'dashboardBrowse', 'dashboardSearch']) $(id).disabled = !ready;
    text('windowWorkspace', ready ? state.status.placeName || 'Workspace' : 'Local workspace');
    text('dashboardSession', ready ? state.status.placeName || 'Connected' : 'Not connected');
    text('dashboardSessionHint', ready ? 'Connected locally to Roblox Studio' : 'Pair your Studio to start building');
    text('dashboardScripts', ready ? state.scriptCount.toLocaleString('en-US') : '--');
    text('dashboardScriptsHint', ready && (state.status.indexing || state.status.onDemand) ? 'Indexed so far' : 'Scripts in this session');
    text('dashboardEditors', ready ? new Set([...state.openIds, ...(secondaryId ? [secondaryId] : [])]).size : '0');
    text('dashboardStatus', ready ? 'Workspace online' : 'Local-first workspace');
    $('dashboardStatus').classList.toggle('online', ready);
    if (showSecond && doc) {
      text('secondaryTabName', doc.name);
      text('secondaryPath', doc.path);
      text('secondaryType', `${doc.className} / Luau`);
      const label = doc.local.manualResolve ? 'Conflict - draft protected'
        : doc.local.dirty ? 'Unsynced local changes' : doc.pending ? 'Syncing...' : 'Synced';
      text('secondarySync', label);
      $('secondarySync').classList.toggle('warning', Boolean(doc.local.dirty || doc.local.manualResolve || doc.pending));
      $('secondaryReview').hidden = !doc.local.manualResolve;
      $('secondaryTab').title = `${doc.path} (shared document, independent view)`;
      secondary.updateOptions({ readOnly: !ready });
    }
  }

  function refresh() {
    if (refreshFrame || disposed) return;
    refreshFrame = requestAnimationFrame(() => { refreshFrame = 0; render(); });
  }

  function toggleLayout() {
    const open = $('layoutPanel').hidden;
    adapter.hidePopovers();
    $('layoutPanel').hidden = !open;
    $('layoutToggle').setAttribute('aria-expanded', String(open));
    if (open) $('dockLeft').focus();
  }

  for (const id of ['layoutToggle', 'railLayout', 'dashboardLayout']) listen($(id), 'click', toggleLayout);
  listen($('closeLayout'), 'click', adapter.hidePopovers);
  listen($('railHome'), 'click', showHome);
  listen($('railExplorer'), 'click', () => { revealExplorer(); adapter.setSidebarView('explorer', true); refresh(); });
  listen($('railSearch'), 'click', () => { revealExplorer(); adapter.openPlaceSearch(); refresh(); });
  for (const id of ['railQuickApply', 'dashboardCompose']) listen($(id), 'click', adapter.openQuickApply);
  listen($('dashboardBrowse'), 'click', adapter.openQuickOpen);
  listen($('dashboardSearch'), 'click', () => { revealExplorer(); adapter.openPlaceSearch(); });
  for (const id of ['dashboardRecovery', 'railRecovery']) listen($(id), 'click', () => $('openBackups').click());
  listen($('railAppearance'), 'click', () => $('themeToggle').click());
  listen($('railHelp'), 'click', () => $('explorerHelp').click());
  listen($('dockLeft'), 'click', () => setLayout({ sidebarSide: 'left', sidebarVisible: true }));
  listen($('dockRight'), 'click', () => setLayout({ sidebarSide: 'right', sidebarVisible: true }));
  listen($('sidebarVisibleSetting'), 'change', (event) => setLayout({ sidebarVisible: event.target.checked }));
  listen($('reduceMotionSetting'), 'change', (event) => setLayout({ reduceMotion: event.target.checked }));
  listen($('layoutVertical'), 'click', () => openSplit(activeDocument(), 'vertical'));
  listen($('layoutHorizontal'), 'click', () => openSplit(activeDocument(), 'horizontal'));
  listen($('resetLayout'), 'click', () => {
    closeSplit({ focus: false });
    layout = { ...LAYOUT_DEFAULTS };
    applyLayout();
    adapter.toast('Workspace layout reset. Scripts and drafts were not changed.');
  });
  listen($('splitEditor'), 'click', () => openSplit(primaryDocument()));
  listen($('closeSecondary'), 'click', () => closeSplit());
  const reviewSecondary = async () => {
    if (!secondaryId) return;
    await adapter.openScript(secondaryId);
    focusedGroup = 'primary';
    adapter.editor.focus();
    refresh();
  };
  for (const id of ['secondaryReview', 'focusPrimary']) listen($(id), 'click', () => reviewSecondary().catch(adapter.safeError));
  listen($('primaryPane'), 'pointerdown', () => { focusedGroup = 'primary'; refresh(); });
  listen($('secondaryPane'), 'pointerdown', () => { focusedGroup = 'secondary'; refresh(); });
  remember(adapter.editor.onDidFocusEditorText(() => { focusedGroup = 'primary'; refresh(); }));

  function bindResize(handle, move) {
    listen(handle, 'pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const initial = { x: event.clientX, y: event.clientY, width: layout.sidebarWidth };
      const pointer = event.pointerId;
      handle.setPointerCapture(pointer);
      handle.classList.add('resizing');
      document.body.classList.add('workspace-resizing');
      const drag = (next) => { if (next.pointerId === pointer) move(next, initial); };
      const finish = (next) => {
        if (next.pointerId !== undefined && next.pointerId !== pointer) return;
        handle.classList.remove('resizing');
        document.body.classList.remove('workspace-resizing');
        handle.removeEventListener('pointermove', drag);
        handle.removeEventListener('pointerup', finish);
        handle.removeEventListener('pointercancel', finish);
        handle.removeEventListener('lostpointercapture', finish);
        window.removeEventListener('blur', finish);
        if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer);
        saveLayout(storage, layout);
      };
      handle.addEventListener('pointermove', drag);
      handle.addEventListener('pointerup', finish);
      handle.addEventListener('pointercancel', finish);
      handle.addEventListener('lostpointercapture', finish);
      window.addEventListener('blur', finish);
    });
  }
  bindResize($('resizeDivider'), (event, start) => setLayout({
    sidebarWidth: resizeSidebar(start.width, event.clientX - start.x, layout.sidebarSide),
  }, false));
  bindResize($('splitDivider'), (event) => setLayout({
    splitRatio: splitRatioAt($('editorArea').getBoundingClientRect(), event.clientX, event.clientY, layout.splitDirection),
  }, false));
  listen($('resizeDivider'), 'keydown', (event) => {
    if (event.key === 'Home') { event.preventDefault(); setLayout({ sidebarWidth: 286 }); }
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    setLayout({ sidebarWidth: resizeSidebar(layout.sidebarWidth, event.key === 'ArrowRight' ? 15 : -15, layout.sidebarSide) });
  });
  listen($('splitDivider'), 'keydown', (event) => {
    const keys = layout.splitDirection === 'vertical' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    if (event.key === 'Home') { event.preventDefault(); setLayout({ splitRatio: 0.5 }); }
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    setLayout({ splitRatio: layout.splitRatio + (event.key === keys[1] ? 0.025 : -0.025) });
  });
  listen($('splitDivider'), 'dblclick', () => setLayout({ splitRatio: 0.5 }));
  listen($('resizeDivider'), 'dblclick', () => setLayout({ sidebarWidth: 286 }));

  function clearDrag() {
    dragKind = null;
    delete document.body.dataset.workspaceDrag;
    for (const node of document.querySelectorAll('.workspace-drop')) node.classList.remove('drag-over');
  }
  listen($('explorerDragHandle'), 'dragstart', (event) => {
    if (!snapshot().ready) { event.preventDefault(); return; }
    event.dataTransfer.setData(PANEL_MIME, 'explorer');
    event.dataTransfer.effectAllowed = 'move';
  });
  listen($('secondaryTab'), 'dragstart', (event) => {
    if (!secondaryId) { event.preventDefault(); return; }
    event.dataTransfer.setData(TAB_MIME, secondaryId);
    event.dataTransfer.effectAllowed = 'copyMove';
  });
  listen(document, 'dragstart', (event) => {
    const types = Array.from(event.dataTransfer?.types || []);
    if (types.includes(PANEL_MIME)) dragKind = 'panel';
    else if (types.includes(TAB_MIME)) { dragKind = 'tab'; event.dataTransfer.effectAllowed = 'copyMove'; }
    else return; // Never interfere with hierarchy instance reparenting.
    document.body.dataset.workspaceDrag = dragKind;
  });
  listen(document, 'dragend', clearDrag);
  listen(document, 'drop', clearDrag);
  listen(window, 'blur', clearDrag);
  for (const node of document.querySelectorAll('.workspace-drop')) {
    listen(node, 'dragover', (event) => {
      if (dragKind !== node.dataset.kind) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = dragKind === 'tab' ? 'copy' : 'move';
      node.classList.add('drag-over');
    });
    listen(node, 'dragleave', () => node.classList.remove('drag-over'));
    listen(node, 'drop', (event) => {
      if (dragKind !== node.dataset.kind) return;
      event.preventDefault();
      if (dragKind === 'panel' && event.dataTransfer.getData(PANEL_MIME) === 'explorer') {
        setLayout({ sidebarSide: node.dataset.side, sidebarVisible: true });
      } else if (dragKind === 'tab') {
        openSplit(event.dataTransfer.getData(TAB_MIME), node.dataset.direction);
      }
      clearDrag();
    });
  }
  listen(window, 'keydown', (event) => {
    if (event.key === 'Escape') { clearDrag(); adapter.hidePopovers(); }
    if (!(event.ctrlKey || event.metaKey) || event.altKey || document.querySelector('dialog[open]')) return;
    const key = event.key.toLowerCase();
    if (key === 'b' && !event.shiftKey) {
      event.preventDefault(); event.stopImmediatePropagation();
      setLayout({ sidebarVisible: !layout.sidebarVisible });
    } else if (event.code === 'Backslash' || key === '\\') {
      event.preventDefault(); event.stopImmediatePropagation();
      openSplit(activeDocument(), event.shiftKey ? 'horizontal' : 'vertical');
    } else if (key === 'w' && focusedGroup === 'secondary' && secondaryId) {
      event.preventDefault(); event.stopImmediatePropagation(); closeSplit();
    } else if (key === 's' && !event.shiftKey && activeDocument()) {
      event.preventDefault(); event.stopImmediatePropagation();
      adapter.saveDocument(activeDocument()).catch(adapter.safeError);
    }
  }, { capture: true });

  document.body.dataset.platform = adapter.platform || 'browser';
  applyLayout(false);
  return {
    openSplit, closeSplit, removeDocument, resetSession, refresh, syncPreferences,
    showEditor, showHome, revealExplorer,
    dispose() {
      if (disposed) return;
      disposed = true;
      abort.abort();
      cancelAnimationFrame(refreshFrame);
      subscriptions.forEach((subscription) => subscription.dispose());
      secondary?.setModel(null);
      secondary?.dispose();
      secondaryViews.clear();
    },
  };
}
