import { selectRange } from './explorer-model.mjs';

// Pure Explorer selection transitions. Item identity is always its Studio ID,
// never its display name: Roblox allows duplicate sibling names.
export function selectOnPointer(visibleIds, current, anchorId, targetId, { shift = false, toggle = false } = {}) {
  const selected = new Set(current);
  let nextAnchor = anchorId;
  if (shift && anchorId && visibleIds.includes(anchorId)) {
    const range = selectRange(visibleIds, anchorId, targetId);
    if (!toggle) selected.clear();
    for (const id of range) selected.add(id);
  } else if (toggle) {
    if (selected.has(targetId)) selected.delete(targetId);
    else selected.add(targetId);
    nextAnchor = targetId;
  } else {
    selected.clear();
    selected.add(targetId);
    nextAnchor = targetId;
  }
  return { selected, anchorId: nextAnchor, focusedId: targetId };
}

export function selectOnSweep(visibleIds, startId, endId) {
  return selectRange(visibleIds, startId, endId);
}
