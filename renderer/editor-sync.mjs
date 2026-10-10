/** Conflict-aware state transitions for a single live Luau document. */
export function createDocumentState(revision = 0) {
  return {
    knownRevision: revision,
    dirty: false,
    manualResolve: false,
    editVersion: 0,
    outboundSources: new Set(),
    flushRequested: false,
    recoveryChecked: false,
    recoveryLoading: false,
  };
}

export function recordLocalEdit(state, value, studioSource) {
  state.editVersion += 1;
  state.dirty = value !== studioSource || state.outboundSources.size > 0;
  if (!state.dirty) state.manualResolve = false;
  return state.dirty;
}

/**
 * This never returns `replace` while there are local edits or an unresolved conflict.
 * A Studio acknowledgment of an older outgoing source is not an external conflict.
 */
export function reconcileSource(state, currentValue, previousSource, nextSource, revision, origin = 'studio') {
  if (typeof nextSource !== 'string') return 'unchanged';
  const remoteChanged = typeof previousSource !== 'string' || previousSource !== nextSource;
  const isOutgoing = origin === 'cursor' || state.outboundSources.has(nextSource);

  if (nextSource === currentValue) {
    state.knownRevision = revision;
    state.outboundSources.delete(nextSource);
    state.dirty = state.outboundSources.size > 0;
    state.manualResolve = false;
    return state.dirty ? 'outgoing-acknowledged' : 'acknowledged';
  }
  if (!remoteChanged) return 'unchanged';
  if (!state.dirty && !state.manualResolve) {
    state.knownRevision = revision;
    return 'replace';
  }
  if (isOutgoing) {
    state.knownRevision = revision;
    state.outboundSources.delete(nextSource);
    return 'outgoing-acknowledged';
  }
  state.manualResolve = true;
  return 'conflict';
}

/** An async recovery lookup may finish after a user has already typed. */
export function canRestoreDraft(state, openingVersion, modelValue, openingSource, studioSource) {
  return state.editVersion === openingVersion && !state.dirty && !state.manualResolve &&
    modelValue === openingSource && studioSource === openingSource;
}
