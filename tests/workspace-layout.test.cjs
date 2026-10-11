'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { windowStyleForTheme } = require('../electron/window-theme.cjs');
const layout = import('../renderer/layout-state.mjs');

test('layout preferences validate bounded numbers, enums and malformed storage', async () => {
  const { normalizeLayout, loadLayout, LAYOUT_DEFAULTS } = await layout;
  for (const input of [null, undefined, [], 'right', 3]) assert.deepEqual(normalizeLayout(input), LAYOUT_DEFAULTS);
  const result = normalizeLayout({ sidebarWidth: 9999, splitRatio: -2, sidebarSide: 'bad', splitDirection: 'bad', reduceMotion: 'true' });
  assert.equal(result.sidebarWidth, 460);
  assert.equal(result.splitRatio, .25);
  assert.equal(result.sidebarSide, 'left');
  assert.equal(result.splitDirection, 'vertical');
  assert.equal(result.reduceMotion, false);
  for (const n of [NaN, Infinity, -Infinity, '400']) assert.equal(normalizeLayout({ sidebarWidth: n }).sidebarWidth, 286);
  assert.deepEqual(loadLayout({ getItem: () => '{bad' }), LAYOUT_DEFAULTS);
  assert.deepEqual(loadLayout({ getItem() { throw Error('denied'); } }), LAYOUT_DEFAULTS);
});

test('layout migrates legacy width, persists only visual state and survives full storage', async () => {
  const { loadLayout, saveLayout, LAYOUT_KEY } = await layout;
  const data = new Map([['cursor-bridge-explorer-width', '340']]);
  const storage = { getItem: (key) => data.get(key), setItem: (key, value) => data.set(key, value) };
  assert.equal(loadLayout(storage).sidebarWidth, 340);
  saveLayout(storage, { sidebarSide: 'right', splitDirection: 'horizontal', source: 'private source', reduceMotion: true });
  assert.equal(loadLayout(storage).sidebarSide, 'right');
  assert.equal(loadLayout(storage).splitDirection, 'horizontal');
  assert.equal(loadLayout(storage).reduceMotion, true);
  assert.ok(!data.get(LAYOUT_KEY).includes('private source'));
  assert.doesNotThrow(() => saveLayout({ setItem() { throw Error('full'); } }, {}));
});

test('Explorer resize handles reversed docking and split geometry clamps safely', async () => {
  const { resizeSidebar, splitRatioAt } = await layout;
  assert.equal(resizeSidebar(286, 30, 'left'), 316);
  assert.equal(resizeSidebar(286, 30, 'right'), 256);
  assert.equal(resizeSidebar(286, -900, 'left'), 210);
  assert.equal(resizeSidebar(286, -900, 'right'), 460);
  const bounds = { left: 100, top: 50, width: 1000, height: 500 };
  assert.equal(splitRatioAt(bounds, 600, 100, 'vertical'), .5);
  assert.equal(splitRatioAt(bounds, 500, 300, 'horizontal'), .5);
  assert.equal(splitRatioAt(bounds, 10000, 900, 'vertical'), .75);
  assert.equal(splitRatioAt({ ...bounds, width: 0 }, 100, 100, 'vertical'), .5);
});

test('native title bar accepts only explicit workbench themes', () => {
  assert.deepEqual(windowStyleForTheme('discord'), { color: '#1e1f22', symbolColor: '#f2f3f5', height: 36 });
  for (const name of ['obsidian', 'graphite', 'midnight', 'aurora']) assert.match(windowStyleForTheme(name).color, /^#[a-f0-9]{6}$/);
  for (const input of [null, {}, '__proto__', 'constructor', 'red', '<script>']) assert.equal(windowStyleForTheme(input), null);
  const first = windowStyleForTheme('discord'); first.height = 100;
  assert.equal(windowStyleForTheme('discord').height, 36);
});
