'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('viewport stays bounded while scrolling through 250,000 visible instances', async () => {
  const {calculateExplorerWindow} = await import('../renderer/virtual-window.mjs');
  for (const offset of [0, 7000, 123456, 2400000, 6239000]) {
    const w = calculateExplorerWindow(250000, offset, 600);
    assert.ok(w.end - w.start <= 61);
    assert.equal(w.topSpacer + (w.end - w.start)*25 + w.bottomSpacer, 250000*25);
  }
  const end = calculateExplorerWindow(250000, 9_999_999, 600);
  assert.equal(end.end,250000);
  const empty = calculateExplorerWindow(0, 0, 600);
  assert.deepEqual(empty,{start:0,end:0,topSpacer:0,bottomSpacer:0});
});
