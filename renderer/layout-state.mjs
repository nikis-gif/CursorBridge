/** Versioned visual preferences. No script source or Studio identity is stored here. */
export const LAYOUT_KEY = 'cursor-bridge-workspace-v1';
export const LAYOUT_DEFAULTS = Object.freeze({
  version: 1,
  sidebarSide: 'left',
  sidebarVisible: true,
  sidebarWidth: 248,
  splitDirection: 'vertical',
  splitRatio: 0.5,
  reduceMotion: false,
});

const bounded = (value, minimum, maximum, fallback) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, value)) : fallback;

export function normalizeLayout(value) {
  const data = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    version: 1,
    sidebarSide: data.sidebarSide === 'right' ? 'right' : 'left',
    sidebarVisible: data.sidebarVisible !== false,
    sidebarWidth: bounded(data.sidebarWidth, 210, 460, LAYOUT_DEFAULTS.sidebarWidth),
    splitDirection: data.splitDirection === 'horizontal' ? 'horizontal' : 'vertical',
    splitRatio: bounded(data.splitRatio, 0.25, 0.75, 0.5),
    reduceMotion: data.reduceMotion === true,
  };
}

export function loadLayout(storage) {
  try {
    const saved = storage?.getItem(LAYOUT_KEY);
    if (saved) return normalizeLayout(JSON.parse(saved));
    const legacyWidth = Number(storage?.getItem('cursor-bridge-explorer-width'));
    return normalizeLayout(legacyWidth > 0 ? { sidebarWidth: legacyWidth } : null);
  } catch { return { ...LAYOUT_DEFAULTS }; }
}

export function saveLayout(storage, value) {
  const normalized = normalizeLayout(value);
  try { storage?.setItem(LAYOUT_KEY, JSON.stringify(normalized)); } catch {
    // Full/disabled storage cannot interrupt an editing session.
  }
  return normalized;
}

export function resizeSidebar(width, movement, side = 'left') {
  return bounded(width + movement * (side === 'right' ? -1 : 1), 210, 460, LAYOUT_DEFAULTS.sidebarWidth);
}

export function splitRatioAt(bounds, x, y, direction) {
  const horizontal = direction === 'horizontal';
  const length = horizontal ? bounds.height : bounds.width;
  const offset = horizontal ? y - bounds.top : x - bounds.left;
  return length > 0 ? bounded(offset / length, 0.25, 0.75, 0.5) : 0.5;
}
