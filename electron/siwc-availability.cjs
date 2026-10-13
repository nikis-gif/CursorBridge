'use strict';
// Never enable plan-sharing OAuth in an unlicensed public Windows installer.
// A native, unpackaged development build requires an explicit local opt-in.
const PUBLIC_BUILD_ENABLED = false;
const CHATGPT_SIGN_IN_UNAVAILABLE =
  'ChatGPT account connection is not enabled in v0.4.0. The public repository is UNLICENSED; distribution eligibility and native sign-in QA remain pending.';
function isChatGPTSignInEnabled({ packaged = true, developerOptIn = false } = {}) {
  return PUBLIC_BUILD_ENABLED || (!packaged && developerOptIn === true);
}
module.exports = { isChatGPTSignInEnabled, CHATGPT_SIGN_IN_UNAVAILABLE };
