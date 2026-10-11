/** Deterministic Monaco contract double: model events are independent of views. */
const views = [];
const models = [];
const event = () => {
  const listeners = new Set();
  return {
    subscribe(fn) { listeners.add(fn); return { dispose: () => listeners.delete(fn) }; },
    fire(value) { for (const fn of [...listeners]) fn(value); },
    clear() { listeners.clear(); },
  };
};
window.__testEditorSource = () => views[0]?.getModel()?.getValue();
window.__testEditSource = (source) => views[0]?.getModel()?.setValue(source);
window.__testSecondarySource = () => views[1]?.getModel()?.getValue();
window.__testEditSecondary = (source) => views[1]?.getModel()?.setValue(source);
window.__testMonacoViews = views;
window.__testMonacoModels = models;
export const Uri = { parse: (text) => text };
export const languages = { register() {}, setLanguageConfiguration() {}, setMonarchTokensProvider() {}, registerCompletionItemProvider() {} };
export const editor = {
  create(host, options) {
    let model = options.model || null;
    let subscription = null;
    let position = { lineNumber: 1, column: 1 };
    let scrollTop = 0;
    const content = event(), cursor = event(), focus = event();
    const view = {
      host, options: { ...options },
      setModel(next) {
        subscription?.dispose();
        model = next;
        position = { lineNumber: 1, column: 1 };
        subscription = model?.onDidChangeContent((change) => content.fire(change));
      },
      getModel: () => model,
      updateOptions(patch) { Object.assign(this.options, patch); },
      layout() {},
      onDidChangeModelContent: content.subscribe,
      onDidChangeCursorPosition: cursor.subscribe,
      onDidFocusEditorText: focus.subscribe,
      setSelection(range) { window.__editorSelection = range; },
      revealRangeInCenter(range) { window.__editorReveal = range; },
      setPosition(next) { position = { ...next }; cursor.fire({ position }); },
      getPosition: () => position,
      setScrollTop(value) { scrollTop = value; },
      getScrollTop: () => scrollTop,
      saveViewState: () => ({ position: { ...position }, scrollTop }),
      restoreViewState(state) { if (state) { position = { ...state.position }; scrollTop = state.scrollTop; } },
      focus() { window.__editorFocused = true; focus.fire(); },
      dispose() { subscription?.dispose(); content.clear(); cursor.clear(); focus.clear(); model = null; },
    };
    views.push(view);
    return view;
  },
  createModel(value, language, uri) {
    const changes = event();
    const model = {
      value, language, uri, disposed: false,
      getValue() { return this.value; },
      setValue(next) { this.value = next; changes.fire({}); },
      onDidChangeContent: changes.subscribe,
      getLineCount() { return this.value.split(/\r?\n/).length; },
      getLineMaxColumn(line) { return (this.value.split(/\r?\n/)[line - 1] || '').length + 1; },
      dispose() { this.disposed = true; changes.clear(); },
      isDisposed() { return this.disposed; },
    };
    models.push(model);
    return model;
  },
  defineTheme() {}, setTheme() {},
};
