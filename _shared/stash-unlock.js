/* ─────────────────────────────────────────────────────────────────────────
   _shared/stash-unlock.js — "Jay's Secret Stash" easter-egg ENTRANCE (the doorway on the
   wiki page that reveals the stash). NOTE: distinct from stash/stash.js, which
   is the stash module engine. This file only hides/reveals the way in.
   ---------------------------------------------------------------------------
   Hides the entrance to the (non-canon) /stash/ module on Jay's wiki page.

   How it works:
     • A wincing Jay sticker (images/jaysticker.webp) is tucked at the bottom
       of Jay's character page. It looks like ordinary art, but on hover it
       FLINCHES — the only tell that it's interactive. Skimmers miss it;
       the curious can't resist it.
     • Clicking it opens a themed modal (images/jaywarning.webp — Jay holding
       a "Keep out! My stuff!" sign) that welcomes the finder and offers
       passage into the stash.
     • Once found, a localStorage "trophy" flag is set so a small persistent
       re-entry link appears beneath the sticker on future visits — no need
       to repeat the trick.

   Self-contained: injects its own scoped (jstash-) styles + markup and
   exposes one global, window.SinverseStash. Touches nothing else on the
   site. Called from wiki/index.html's loadCharPage() via:
       if (window.SinverseStash) window.SinverseStash.onCharPage(container, char);
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var STORAGE_KEY = 'sinverse_stash_found';
  var STICKER_SRC = '../images/jaysticker.webp';  // wincing Jay  (the trigger)
  var WARNING_SRC = '../images/jaywarning.webp';   // "Keep out!"  (the modal)
  var STASH_URL   = '../stash/';

  // ── helpers ──────────────────────────────────────────────────────────────
  function isJay(char) {
    if (!char) return false;
    var slug = char.wiki || (char.name ? char.name.toLowerCase() : '');
    return slug === 'jay' || (char.name && char.name.toLowerCase() === 'jay');
  }

  function markFound() {
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch (e) { /* private mode, etc. — fail open */ }
  }

  // ── styles (injected once) ────────────────────────────────────────────────
  var stylesInjected = false;
  function injectStyles() {
    if (stylesInjected || document.getElementById('jstash-styles')) return;
    stylesInjected = true;
    var s = document.createElement('style');
    s.id = 'jstash-styles';
    s.textContent = [
      /* the hidden trigger — small and tucked into the bottom-right of the
         content. In-flow (scrolls with the page, never overlays it) and little
         enough that a skimmer misses it. Softened at rest, perks up on hover. */
      '.jstash-trigger-wrap{margin:1.25rem 0 0.25rem;text-align:right;line-height:0;}',
      '.jstash-trigger{width:72px;max-width:28%;cursor:pointer;user-select:none;opacity:0.8;',
      '  -webkit-user-drag:none;transition:filter var(--transition,0.25s ease),transform 0.15s ease,opacity var(--transition,0.25s ease);',
      '  filter:drop-shadow(0 2px 6px rgba(0,0,0,0.4));}',
      '.jstash-trigger:hover{opacity:1;filter:drop-shadow(0 0 10px var(--accent-glow,rgba(196,154,120,0.5)));',
      '  animation:jstash-flinch 0.55s ease;}',
      '.jstash-trigger:active{transform:scale(0.94);}',
      '@keyframes jstash-flinch{',
      '  0%{transform:translateX(0) rotate(0);}',
      '  15%{transform:translateX(-5px) rotate(-3deg) scale(0.97);}',
      '  35%{transform:translateX(4px) rotate(2deg) scale(0.97);}',
      '  55%{transform:translateX(-3px) rotate(-1.5deg);}',
      '  75%{transform:translateX(2px) rotate(1deg);}',
      '  100%{transform:translateX(0) rotate(0);}}',
      /* overlay + modal */
      '.jstash-overlay{position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;',
      '  padding:1.25rem;background:rgba(8,5,4,0.78);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);}',
      '.jstash-overlay.jstash-open{display:flex;animation:jstash-fade 0.25s ease;}',
      '@keyframes jstash-fade{from{opacity:0;}to{opacity:1;}}',
      '.jstash-modal{position:relative;max-width:420px;width:100%;text-align:center;',
      '  background:var(--bg-panel,#1a1210);border:1px solid var(--border-bright,rgba(196,154,120,0.30));',
      '  border-radius:var(--radius-lg,10px);padding:1.75rem 1.5rem 1.5rem;',
      '  box-shadow:0 18px 50px rgba(0,0,0,0.6);animation:jstash-pop 0.3s cubic-bezier(0.18,0.9,0.32,1.2);}',
      '@keyframes jstash-pop{from{opacity:0;transform:translateY(12px) scale(0.95);}to{opacity:1;transform:none;}}',
      '.jstash-modal-img{width:240px;max-width:80%;height:auto;margin:0.25rem auto 0.85rem;display:block;',
      '  filter:drop-shadow(0 3px 8px rgba(0,0,0,0.45));}',
      '.jstash-modal-title{font-family:var(--font-display,Georgia,serif);font-weight:600;',
      '  font-size:1.7rem;line-height:1.15;margin:0.35rem 0 0.9rem;padding:0 0.75rem;color:var(--accent-light,#dbb89a);}',
      '.jstash-modal-text{font-family:var(--font-body,Georgia,serif);font-size:1rem;line-height:1.55;',
      '  color:var(--text-secondary,#c4a882);margin:0 auto 1.4rem;max-width:34ch;}',
      '.jstash-modal-actions{display:flex;gap:0.6rem;justify-content:center;flex-wrap:wrap;}',
      '.jstash-btn{font-family:var(--font-caps,Georgia,serif);letter-spacing:0.04em;font-size:0.95rem;',
      '  padding:0.6rem 1.3rem;border-radius:var(--radius,4px);cursor:pointer;text-decoration:none;',
      '  transition:all var(--transition,0.25s ease);border:1px solid transparent;}',
      '.jstash-btn-primary{background:var(--accent,#c49a78);color:#1a1210;border-color:var(--accent,#c49a78);}',
      '.jstash-btn-primary:hover{background:var(--accent-light,#dbb89a);border-color:var(--accent-light,#dbb89a);}',
      '.jstash-btn-secondary{background:transparent;color:var(--text-secondary,#c4a882);border-color:var(--border-mid,rgba(196,154,120,0.18));}',
      '.jstash-btn-secondary:hover{color:var(--text-primary,#f5ece0);border-color:var(--border-bright,rgba(196,154,120,0.30));}',
      '.jstash-close{position:absolute;top:0.5rem;right:0.65rem;background:none;border:none;cursor:pointer;',
      '  font-size:1.5rem;line-height:1;color:var(--text-muted,#a08870);padding:0.2rem 0.4rem;transition:color var(--transition,0.25s ease);}',
      '.jstash-close:hover{color:var(--text-primary,#f5ece0);}',
      'body.jstash-noscroll{overflow:hidden;}',
      '@media (prefers-reduced-motion: reduce){',
      '  .jstash-trigger:hover{animation:none;}',
      '  .jstash-overlay.jstash-open,.jstash-modal{animation:none;}}'
    ].join('');
    document.head.appendChild(s);
  }

  // ── modal ──────────────────────────────────────────────────────────────────
  var overlay = null;
  var lastFocus = null;

  function buildModal() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'jstash-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML =
      '<div class="jstash-modal" role="dialog" aria-modal="true" aria-labelledby="jstash-title">' +
        '<button class="jstash-close" type="button" aria-label="Close">\u00D7</button>' +
        '<h2 class="jstash-modal-title" id="jstash-title">You found Jay\u2019s secret stash!</h2>' +
        '<img class="jstash-modal-img" src="' + WARNING_SRC + '" alt="Jay holding a sign that reads: Keep out! My stuff!" />' +
        '<p class="jstash-modal-text">Inside is a collection of Jay\u2019s art and stories that never made it ' +
          'into Sinverse canon. He\u2019d prefer if you turned around, but ' +
          'since when has a toy\u2019s opinion ever mattered?</p>' +
        '<div class="jstash-modal-actions">' +
          '<a class="jstash-btn jstash-btn-primary" href="' + STASH_URL + '">Take a peek</a>' +
          '<button class="jstash-btn jstash-btn-secondary" type="button">Maybe later</button>' +
        '</div>' +
      '</div>';

    // close interactions
    overlay.querySelector('.jstash-close').addEventListener('click', closeModal);
    overlay.querySelector('.jstash-btn-secondary').addEventListener('click', closeModal);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeModal();   // backdrop click
    });
    document.body.appendChild(overlay);
    return overlay;
  }

  function onKeydown(e) {
    if (e.key === 'Escape' || e.keyCode === 27) closeModal();
  }

  function openModal() {
    markFound();                 // flag kept for a possible future site-wide entry; no visible effect now
    buildModal();
    lastFocus = document.activeElement;
    overlay.classList.add('jstash-open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('jstash-noscroll');
    document.addEventListener('keydown', onKeydown);
    var firstBtn = overlay.querySelector('.jstash-btn-primary');
    if (firstBtn) firstBtn.focus();
  }

  function closeModal() {
    if (!overlay) return;
    overlay.classList.remove('jstash-open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('jstash-noscroll');
    document.removeEventListener('keydown', onKeydown);
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
  }

  // ── trigger sticker on Jay's page ────────────────────────────────────────
  function mountSticker(container) {
    if (!container || container.querySelector('.jstash-trigger-wrap')) return;
    var wrap = document.createElement('div');
    wrap.className = 'jstash-trigger-wrap';
    var img = document.createElement('img');
    img.className = 'jstash-trigger';
    img.src = STICKER_SRC;
    img.alt = '';                       // decorative — keep the secret quiet
    img.setAttribute('draggable', 'false');
    img.setAttribute('title', '');      // no hover tooltip giving it away
    img.addEventListener('click', openModal);
    wrap.appendChild(img);
    container.appendChild(wrap);
  }

  // ── public API ───────────────────────────────────────────────────────────
  window.SinverseStash = {
    onCharPage: function (container, char) {
      if (!isJay(char)) return;
      injectStyles();
      mountSticker(container);
    }
  };
})();
