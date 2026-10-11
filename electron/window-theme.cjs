'use strict';

// Native caption controls retain Windows snap, maximize and accessibility behavior.
// Renderer input selects an allowlisted theme, never arbitrary BrowserWindow options.
const COLORS = Object.freeze({
  discord: '#1e1f22',
  obsidian: '#19191d',
  graphite: '#202226',
  midnight: '#151c2a',
  aurora: '#152426',
});
function windowStyleForTheme(name) {
  if (typeof name !== 'string' || !Object.hasOwn(COLORS, name)) return null;
  return { color: COLORS[name], symbolColor: '#f2f3f5', height: 36 };
}
module.exports = { windowStyleForTheme };
