// Pure viewport math. Tree rows are fixed-height; DOM creation is bounded.
export function calculateExplorerWindow(total, scrollTop, viewportHeight, rowHeight = 25, overscan = 18) {
  if (!Number.isSafeInteger(total) || total < 0 || rowHeight <= 0) {
    throw new RangeError('Invalid Explorer geometry.');
  }
  const top = Math.max(0, Number(scrollTop) || 0);
  const height = Math.max(0, Number(viewportHeight) || 0);
  const first = Math.max(0, Math.floor(top / rowHeight) - overscan);
  const end = Math.min(total, Math.ceil((top + height) / rowHeight) + overscan);
  const start = Math.min(total, first);
  return { start, end: Math.max(start, end), topSpacer: start * rowHeight,
    bottomSpacer: Math.max(0, (total - Math.max(start, end)) * rowHeight) };
}
