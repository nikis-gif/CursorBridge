'use strict';

const dimension = (value, fallback) => Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
const coordinate = (value) => Number.isFinite(value) ? Math.floor(value) : 0;

/** Center a compact window within the usable display, including scaled displays. */
function initialWindowBounds(workArea = {}) {
  const area = workArea && typeof workArea === 'object' ? workArea : {};
  const availableWidth = dimension(area.width, 1440);
  const availableHeight = dimension(area.height, 900);
  const width = Math.max(1, Math.min(1080, Math.floor(availableWidth * 0.9)));
  const height = Math.max(1, Math.min(700, Math.floor(availableHeight * 0.9)));
  return {
    width, height,
    minWidth: Math.min(840, width),
    minHeight: Math.min(540, height),
    x: coordinate(area.x) + Math.floor((availableWidth - width) / 2),
    y: coordinate(area.y) + Math.floor((availableHeight - height) / 2),
  };
}

module.exports = { initialWindowBounds };
