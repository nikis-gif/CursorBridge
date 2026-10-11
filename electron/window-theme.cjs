'use strict';

// Native caption controls retain Windows snap, maximize and accessibility behavior.
// Renderer input selects an allowlisted theme, never arbitrary BrowserWindow options.
const COLORS = Object.freeze({
  cursor: '#191a1c',
  obsidian: '#0b0b0d',
  graphite: '#161719',
  midnight: '#0d121a',
  aurora: '#0c1517',
});
function windowStyleForTheme(name) {
  if (typeof name !== 'string' || !Object.hasOwn(COLORS, name)) return null;
  return { color: COLORS[name], symbolColor: '#f2f3f5', height: 36 };
}
module.exports = { windowStyleForTheme };
