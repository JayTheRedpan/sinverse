// ── Sinverse age-gate guard ───────────────────────────────────
// Runs on every module page. If the visitor has not confirmed they are 18+
// this session, redirect them to the landing-page age gate, remembering
// where they were headed so they can be returned after confirming.
//
// Load this as the FIRST script in <head> (before any content renders) so
// gated content never flashes on screen for an unconfirmed visitor.

(function () {
  var KEY = 'sinverse_age_ok';
  var MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // re-confirm after 30 days

  // Bot/screenshot bypass: automated image-capture requests (e.g. the Discord
  // bot hitting ?screenshot=1) are not a human browsing the gated content, so
  // skip the age gate and let the page render the requested image directly.
  try {
    if (/[?&]screenshot=1(?:&|$)/.test(window.location.search)) return;
  } catch (e) {}

  // Confirmation is stored in localStorage (shared across all tabs and persists
  // across visits) as a timestamp, so opening a link in a NEW TAB no longer
  // re-triggers the gate. The timestamp lets us expire it after MAX_AGE_MS.
  try {
    var raw = localStorage.getItem(KEY);
    if (raw) {
      // Back-compat: an old value of '1' (no timestamp) counts as confirmed.
      var ts = (raw === '1') ? Date.now() : parseInt(raw, 10);
      if (raw === '1' || (!isNaN(ts) && (Date.now() - ts) < MAX_AGE_MS)) {
        if (raw === '1') { try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {} }
        return; // already confirmed and not expired
      }
      // Expired — drop it and fall through to the gate.
      try { localStorage.removeItem(KEY); } catch (e) {}
    }
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
