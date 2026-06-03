// ── Sinverse age-gate guard ───────────────────────────────────
// Runs on every module page. If the visitor has not confirmed they are 18+
// this session, redirect them to the landing-page age gate, remembering
// where they were headed so they can be returned after confirming.
//
// Load this as the FIRST script in <head> (before any content renders) so
// gated content never flashes on screen for an unconfirmed visitor.

(function () {
  var KEY = 'sinverse_age_ok';

  // Bot/screenshot bypass: automated image-capture requests (e.g. the Discord
  // bot hitting ?screenshot=1) are not a human browsing the gated content, so
  // skip the age gate and let the page render the requested image directly.
  try {
    if (/[?&]screenshot=1(?:&|$)/.test(window.location.search)) return;
  } catch (e) {}

  try {
    if (sessionStorage.getItem(KEY) === '1') return; // already confirmed
  } catch (e) {
    return; // storage blocked — fail open rather than trapping the user
  }

  // Work out the site root relative to this page. Module pages live one
  // directory below root (e.g. /wiki/, /library/), so go up to the root.
  // The landing page is index.html at the root.
  var dest = encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
  var root = '../index.html';

  // Hide the page immediately to avoid a content flash, then redirect.
  try {
    document.documentElement.style.visibility = 'hidden';
  } catch (e) {}

  window.location.replace(root + '?return=' + dest);
})();
