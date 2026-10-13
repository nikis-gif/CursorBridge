'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isChatGPTSignInEnabled, CHATGPT_SIGN_IN_UNAVAILABLE } = require('../electron/siwc-availability.cjs');
test('public packaged builds never enable account OAuth while distribution is unlicensed', () => {
  assert.equal(isChatGPTSignInEnabled({ packaged: true, developerOptIn: true }), false);
  assert.equal(isChatGPTSignInEnabled({ packaged: true, developerOptIn: false }), false);
  assert.equal(isChatGPTSignInEnabled(), false);
});
test('unfinished OAuth flow requires explicit opt-in on an unpackaged development build', () => {
  assert.equal(isChatGPTSignInEnabled({ packaged: false }), false);
  assert.equal(isChatGPTSignInEnabled({ packaged: false, developerOptIn: false }), false);
  assert.equal(isChatGPTSignInEnabled({ packaged: false, developerOptIn: true }), true);
  assert.match(CHATGPT_SIGN_IN_UNAVAILABLE, /UNLICENSED/);
});
