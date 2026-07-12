'use strict';
/* ============================================================================
   Sinverse — Gallery viewer (single item view: viewer.html?id=N)
   ----------------------------------------------------------------------------
   Renders one gallery item. All single-image views (scene, charref, comic page,
   set lightbox) share the SAME .scene-image-panel UI, so they get identical
   zoom, drag-to-pan, scroll-wheel pan, and download controls.

   - setupImageZoom(): the shared zoom controller. scale 1 = fit (object-fit
     contain); fit-by-default. Grab-to-drag + wheel pan when zoomed. Pan clamp
     is computed from the image's natural dimensions (NOT live-measured) so a
     CSS transition can't make it drift off-screen. Two fit buttons: whole + width.
   - Comic: same panel + Prev/Next + a centered thumbnail jump-strip below.
   - Layout uses the global-nav-aware sizing (body height:100vh with the 52px
     nav padding absorbed via border-box; panels flex to fill).
   - On mobile the zoom controls are hidden (pinch-zoom covers it); comic page
     changes scroll the window to the top of the image, offset by fixed bars.
   ========================================================================== */

var item       = null;
var comicPage  = 0;

// ── Artist helpers (support single string OR array, for collabs) ─────────────
// `item.artist` may be a string or an array (collab). Normalize to an array and
// build a "by <links>" string where EACH artist links to their contributor page.
// (Mirrors the stash module's creator handling.)
function artistList(item) {
  if (!item) return [];
  var a = item.artist;
  if (Array.isArray(a)) return a.filter(function (n) { return n && String(n).trim(); }).map(String);
  if (a && String(a).trim()) return [String(a)];
  return [];
}
function artistLinksHtml(item) {
  var list = artistList(item);
  if (!list.length) return '';
  var links = list.map(function (name) {
    return '<a class="viewer-artist-link" href="../contributors/?creator=' +
      encodeURIComponent(name) + '">' + name + '</a>';
  });
  var joined;
  if (links.length === 1) joined = links[0];
  else if (links.length === 2) joined = links[0] + ' & ' + links[1];
  else joined = links.slice(0, -1).join(', ') + ' & ' + links[links.length - 1];
  return 'by ' + joined;
}

// Attach +/- / fit zoom to an image. Default state fits the screen (the CSS
// Fit-by-default image zoom with grab-to-drag panning.
// At scale 1 the image fits (object-fit:contain). Zooming scales it up and the
// user drags to pan — no scrollbars. Pan offset is clamped to the overflow.
function setupImageZoom(imgId, outId, resetId, inId, widthId, pctId) {
  var img   = document.getElementById(imgId);
  var panel = img && img.closest('.scene-image-panel');
  var out   = document.getElementById(outId);
  var reset = document.getElementById(resetId);
  var inc   = document.getElementById(inId);
  var widthBtn = widthId ? document.getElementById(widthId) : null;
  var pctEl = pctId ? document.getElementById(pctId) : null;
  if (!img || !panel) return;
  var scale = 1, tx = 0, ty = 0;
  var MIN = 1, MAX = 5;
  var drag = null;

  // Compute the image's letterboxed "fit" box (object-fit:contain at scale 1)
  // from natural dimensions + the image element's UNTRANSFORMED layout box.
  // Using getBoundingClientRect() here read the *transformed* rect, which made
  // clamp() recompute different limits every pointermove and produced a rapid
  // stutter at the edges. offsetWidth/Height and offset position are immune to
  // the CSS transform, so the geometry is stable while panning/zooming.
  function fitBox() {
    var pr = panel.getBoundingClientRect();
    var boxW = img.offsetWidth, boxH = img.offsetHeight;   // layout size (no transform)
    var nw = img.naturalWidth || boxW, nh = img.naturalHeight || boxH;
    if (!nw || !nh || !boxW || !boxH) return { w: boxW, h: boxH, cxRel: pr.width/2, cyRel: pr.height/2, pr: pr };
    var s = Math.min(boxW / nw, boxH / nh);   // contain scale
    var fw = nw * s, fh = nh * s;             // fitted (displayed) size at scale 1
    // Untransformed element position relative to the panel. Walk offsetParent
    // chain up to (and including) the panel so we get layout coords, not the
    // transformed rect. If the chain doesn't reach the panel, fall back to
    // assuming the image is centered in the panel (the object-fit:contain case).
    var ox = 0, oy = 0, node = img, reached = false;
    for (var guard = 0; node && guard < 12; guard++) {
      if (node === panel) { reached = true; break; }
      ox += node.offsetLeft; oy += node.offsetTop;
      node = node.offsetParent;
    }
    var boxCxRel, boxCyRel;
    if (reached) { boxCxRel = ox + boxW / 2; boxCyRel = oy + boxH / 2; }
    else         { boxCxRel = pr.width / 2;  boxCyRel = pr.height / 2; }
    return { w: fw, h: fh, cxRel: boxCxRel, cyRel: boxCyRel, pr: pr };
  }

  function fitWidthScale() {
    var f = fitBox();
    if (!f.w) return 1;
    return Math.min(MAX, Math.max(1, f.pr.width / f.w));
  }

  function maxOffset() {
    var f = fitBox();
    var pr = f.pr;
    var scaledW = f.w * scale, scaledH = f.h * scale;
    // Offset of the fitted image's center from the panel center at scale 1.
    // (translate scales about the element center, and the fitted image is
    // centered in the element, so the fitted center == element center.)
    var baseDx = (f.cxRel != null ? f.cxRel : pr.width / 2) - pr.width / 2;
    var baseDy = (f.cyRel != null ? f.cyRel : pr.height / 2) - pr.height / 2;
    return {
      xPos: Math.max(0, scaledW / 2 - pr.width  / 2 - baseDx),
      xNeg: Math.max(0, scaledW / 2 - pr.width  / 2 + baseDx),
      yPos: Math.max(0, scaledH / 2 - pr.height / 2 - baseDy),
      yNeg: Math.max(0, scaledH / 2 - pr.height / 2 + baseDy)
    };
  }
  function clamp() {
    var m = maxOffset();
    // Allow a little overscroll into the black (so fast scrolls don't slam into
    // a hard wall and bounce), but never enough to push the whole image away —
    // cap the slack at ~12% of the panel so a meaningful slice always shows.
    var pr = panel.getBoundingClientRect();
    var slackX = Math.min(pr.width, pr.height) * 0.12;
    var slackY = slackX;
    tx = Math.max(-(m.xNeg + slackX), Math.min(m.xPos + slackX, tx));
    ty = Math.max(-(m.yNeg + slackY), Math.min(m.yPos + slackY, ty));
  }
  // Toggle the CSS transition: smooth for button zoom, instant for drag/wheel
  function setSmooth(on) { img.style.transition = on ? '' : 'none'; }
  function apply() {
    if (scale === 1) { tx = 0; ty = 0; }
    else clamp();
    img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
    img.style.cursor = scale > 1 ? (drag ? 'grabbing' : 'grab') : '';
    if (pctEl) pctEl.textContent = Math.round(scale * 100) + '%';
  }
  function zoomTo(s) { scale = Math.max(MIN, Math.min(MAX, Math.round(s * 100) / 100)); apply(); }

  if (out)   out.addEventListener('click',   function(){ setSmooth(true); zoomTo(scale - 0.25); });
  if (inc)   inc.addEventListener('click',   function(){ setSmooth(true); zoomTo(scale + 0.25); });
  if (reset) reset.addEventListener('click', function(){ setSmooth(true); scale = 1; tx = 0; ty = 0; apply(); });
  if (widthBtn) widthBtn.addEventListener('click', function(){
    setSmooth(true);
    scale = fitWidthScale();
    tx = 0;
    apply();
    // Jump to the top of the (now taller-than-panel) image so reading starts there
    var m = maxOffset();
    ty = m.yPos;   // max positive ty reveals the top edge
    apply();
  });

  // Grab-to-drag panning (pointer events cover mouse + touch)
  img.addEventListener('pointerdown', function(e) {
    if (scale <= 1) return;
    setSmooth(false);
    drag = { x: e.clientX, y: e.clientY, tx: tx, ty: ty };
    img.setPointerCapture(e.pointerId);
    img.style.cursor = 'grabbing';
    e.preventDefault();
  });
  img.addEventListener('pointermove', function(e) {
    if (!drag) return;
    tx = drag.tx + (e.clientX - drag.x);
    ty = drag.ty + (e.clientY - drag.y);
    apply();
  });
  function endDrag(e) {
    if (!drag) return;
    drag = null;
    try { img.releasePointerCapture(e.pointerId); } catch(_) {}
    img.style.cursor = scale > 1 ? 'grab' : '';
  }
  img.addEventListener('pointerup', endDrag);
  img.addEventListener('pointercancel', endDrag);

  // Double-click toggles between fit and 2x
  img.addEventListener('dblclick', function(){ setSmooth(true); scale === 1 ? zoomTo(2) : (function(){ scale = 1; tx = 0; ty = 0; apply(); })(); });

  // Scroll wheel zooms toward the cursor (wheel up = zoom in, down = zoom out).
  panel.addEventListener('wheel', function(e) {
    e.preventDefault();
    setSmooth(false);   // instant zoom — no animated bounce on fast scroll
    var oldScale = scale;
    var factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    var newScale = Math.max(MIN, Math.min(MAX, Math.round(oldScale * factor * 100) / 100));
    if (newScale === oldScale) return;   // already at fit (min) or max
    // Keep the point under the cursor fixed while scaling about the element centre.
    var f = fitBox();
    var a = (e.clientX - f.pr.left) - f.cxRel;
    var b = (e.clientY - f.pr.top)  - f.cyRel;
    var r = newScale / oldScale;
    scale = newScale;
    tx = a - (a - tx) * r;
    ty = b - (b - ty) * r;
    apply();
  }, { passive: false });

  // Reset to fit whenever a new image loads
  img.addEventListener('load', function(){ scale = 1; tx = 0; ty = 0; apply(); });
  apply();
}

// -- Boot
async function init() {
  var params = new URLSearchParams(window.location.search);
  var id     = parseInt(params.get('id'), 10);
  if (!id) { window.location.href = 'index.html'; return; }

  try {
    var res = await fetch('./gallery.json');
    if (!res.ok) throw new Error('Could not load gallery.json');
    var items = await res.json();
    item = items.find(function(i) { return i.id === id; });
    if (!item) throw new Error('Item not found: ' + id);
    // Also load the library index so related-work links can resolve titles, and
    // build reciprocal links (a link declared on either side shows on both).
    window._galleryItems = items;
    try {
      var libRes = await fetch('../library/library.json');
      window._libraryItems = libRes.ok ? await libRes.json() : [];
    } catch(e) { window._libraryItems = []; }
    buildRelatedFor(item, 'gallery', window._galleryItems, window._libraryItems);
    if (window.SinverseDates) await SinverseDates.load('../wiki/eras.json');
    await loadInactiveFanKeys();
    render();
  } catch(e) {
    document.body.innerHTML = '<div style="padding:4rem;text-align:center;color:var(--text-muted)">' + e.message + '</div>';
  }
}

// Resolve the effective related-works list for an item, merging its own
// declared `relates_to` with any reciprocal links declared on the other side.
// Each entry is { module: 'gallery'|'library', id: N }. Single source of truth:
// you declare a link on ONE item and it appears on both.
function buildRelatedFor(target, targetModule, galleryItems, libraryItems) {
  var out = [];
  var seen = {};
  function add(module, id) {
    var key = module + ':' + id;
    if (seen[key]) return;
    if (module === targetModule && id === target.id) return; // no self-links
    seen[key] = true;
    out.push({ module: module, id: id });
  }
  // 1) Links this item declares directly.
  (target.relates_to || []).forEach(function(r) {
    if (r && r.module && r.id != null) add(r.module, parseInt(r.id, 10));
  });
  // 2) Reciprocals: any item (in either module) that points AT this one.
  function scan(list, module) {
    (list || []).forEach(function(it) {
      (it.relates_to || []).forEach(function(r) {
        if (r && r.module === targetModule && parseInt(r.id, 10) === target.id) {
          add(module, it.id);
        }
      });
    });
  }
  scan(galleryItems, 'gallery');
  scan(libraryItems, 'library');
  target._related = out;
}

function render() {
  document.title = item.title + ' — Sinverse Gallery';
  document.getElementById('viewer-title').textContent = item.title;

  if (item.type === 'comic')   renderComic();
  if (item.type === 'scene')   renderScene();
  if (item.type === 'charref') {
    // A charref with multiple versions (clothed/unclothed, etc.) reuses the
    // comic reader's polished page-by-page layout. Single-image references keep
    // their purpose-built reference page.
    var refImgs = (item.images && item.images.length) ? item.images
                : (item.image ? [item.image] : []);
    if (refImgs.length > 1) {
      item.pages = refImgs;   // feed the versions to the comic reader as pages
      renderComic();
    } else {
      renderCharRef();
    }
  }
  if (item.type === 'set')     renderSet();
}

// -- Comic
function renderComic() {
  document.getElementById('view-comic').style.display = '';

  // Populate sidebar
  document.getElementById('comic-title-reader').textContent   = item.title;
  var caEl = document.getElementById('comic-artist-reader');
  if (caEl) caEl.innerHTML = artistLinksHtml(item);
  document.getElementById('comic-synopsis-reader').textContent = item.synopsis || '';
  if (item.canonical) document.getElementById('comic-canonical-reader').style.display = '';
  renderTags('comic-tags-reader', item.tags);
  renderDates('comic-dates', item);
  renderCharacterLinks('comic-characters-reader', item.characters);
  renderLoreLinks('comic-lore-reader', item.lore);
  renderRelatedLinks('comic-related', item._related);

  // Start on page 0
  comicPage = 0;
  showPage(0);

  // Build the jump-to-page thumbnail strip
  buildComicStrip();

  // Zoom + grab-drag on the comic page (same behavior as scene/ref)
  setupImageZoom('comic-page-img', 'comic-zoom-out', 'comic-zoom-reset', 'comic-zoom-in', 'comic-zoom-width', 'comic-zoom-pct');

  document.getElementById('comic-prev').addEventListener('click', function() { showPage(comicPage - 1); });
  document.getElementById('comic-next').addEventListener('click', function() { showPage(comicPage + 1); });

  // Keyboard navigation
  document.addEventListener('keydown', function(e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') showPage(comicPage + 1);
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   showPage(comicPage - 1);
  });
}

function showPage(n) {
  var pages = item.pages || [];
  comicPage = Math.max(0, Math.min(n, pages.length - 1));
  var img = document.getElementById('comic-page-img');
  img.src = (window.SinverseImg ? SinverseImg.full(pages[comicPage]) : pages[comicPage]);
  document.getElementById('comic-page-counter').textContent = (comicPage + 1) + ' / ' + pages.length;
  document.getElementById('comic-prev').style.visibility = comicPage === 0 ? 'hidden' : '';
  document.getElementById('comic-next').style.visibility = comicPage === pages.length - 1 ? 'hidden' : '';
  // Download link for the current page
  var dl = document.getElementById('comic-download');
  if (dl) {
    dl.href = pages[comicPage] || '#';
    dl.download = (item.title || 'comic').replace(/\s+/g, '_') + '_p' + (comicPage + 1) + '.jpg';
  }
  // Highlight the active thumbnail. Center it within the strip horizontally
  // without yanking the page (use manual scrollLeft, not scrollIntoView which
  // can scroll the whole window on mobile).
  var strip = document.getElementById('comic-thumb-strip');
  if (strip) {
    var thumbs = strip.querySelectorAll('.comic-thumb');
    thumbs.forEach(function(t, i){ t.classList.toggle('active', i === comicPage); });
    var active = thumbs[comicPage];
    if (active) {
      var target = active.offsetLeft - (strip.clientWidth / 2) + (active.clientWidth / 2);
      strip.scrollTo({ left: target, behavior: 'smooth' });
    }
  }

  // On mobile the whole page scrolls, so jump back to the top of the comic
  // image when the page changes (matches prev/next behavior; lets readers go
  // top-to-bottom without manually scrolling up each time).
  if (window.matchMedia('(max-width: 900px)').matches) {
    var panel = document.querySelector('#view-comic .comic-image-panel');
    if (panel) {
      // After the new image starts loading, scroll so the TOP of the image sits
      // just below any fixed bars (global nav + viewer topbar), which
      // scrollIntoView ignores and would hide behind.
      img.addEventListener('load', function onLoad() {
        img.removeEventListener('load', onLoad);
        var nav = document.querySelector('.global-nav');
        var topbar = document.querySelector('.viewer-topbar');
        var offset = 0;
        if (nav && getComputedStyle(nav).position === 'fixed') offset += nav.offsetHeight;
        if (topbar && getComputedStyle(topbar).position === 'fixed') offset += topbar.offsetHeight;
        var top = panel.getBoundingClientRect().top + window.pageYOffset - offset;
        window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      });
    }
  }
}

// Build a clickable thumbnail strip for jumping to any comic page.
function buildComicStrip() {
  var strip = document.getElementById('comic-thumb-strip');
  if (!strip) return;
  var pages = item.pages || [];
  strip.innerHTML = '';
  if (pages.length <= 1) { strip.style.display = 'none'; return; }
  pages.forEach(function(src, idx) {
    var t = document.createElement('button');
    t.className = 'comic-thumb' + (idx === comicPage ? ' active' : '');
    t.setAttribute('aria-label', 'Jump to page ' + (idx + 1));
    var thumb = (window.SinverseImg ? SinverseImg.thumb(src, 120) : src);
    t.innerHTML = '<img src="' + thumb + '" alt="Page ' + (idx + 1) + '" loading="lazy" /><span class="comic-thumb-num">' + (idx + 1) + '</span>';
    t.addEventListener('click', function(){ showPage(idx); });
    strip.appendChild(t);
  });
}

// -- Scene
function renderScene() {
  document.getElementById('view-scene').style.display = '';
  var typeBadge = document.getElementById('scene-type-badge');
  if (typeBadge) typeBadge.textContent = item.type === 'charref' ? 'Reference' : 'World Scene';

  var img = document.getElementById('scene-img');
  img.src = (window.SinverseImg ? SinverseImg.full(item.image || '') : (item.image || ''));
  img.alt = item.title;

  document.getElementById('scene-title').textContent       = item.title;
  var sceneArtistEl = document.getElementById('scene-artist');
  if (sceneArtistEl) sceneArtistEl.innerHTML = artistLinksHtml(item);
  document.getElementById('scene-description').textContent = item.description || '';

  if (item.canonical) document.getElementById('scene-canonical').style.display = '';

  renderTags('scene-tags', item.tags);
  renderDates('scene-dates', item);
  renderCharacterLinks('scene-characters', item.characters);
  renderLoreLinks('scene-lore', item.lore);
  renderRelatedLinks('scene-related', item._related);

  var dl = document.getElementById('scene-download');
  dl.href     = item.image || '#';
  dl.download = item.title.replace(/\s+/g, '_') + '.jpg';

  setupImageZoom('scene-img', 'scene-zoom-out', 'scene-zoom-reset', 'scene-zoom-in', 'scene-zoom-width', 'scene-zoom-pct');
}

// -- Character Reference
function renderCharRef() {
  document.getElementById('view-charref').style.display = '';

  // A charref may carry a single `image` or an `images` array (e.g. clothed /
  // unclothed versions). Normalise to a list, and pick the first as the primary.
  var refImages = (item.images && item.images.length) ? item.images.slice()
                : (item.image ? [item.image] : []);
  var primary = refImages[0] || '';
  var refThumbs = document.getElementById('ref-version-thumbs');

  var img = document.getElementById('ref-img');
  img.src = (window.SinverseImg ? SinverseImg.full(primary) : primary);
  img.alt = item.title;

  document.getElementById('ref-title').textContent  = item.title;
  var refArtistEl = document.getElementById('ref-artist');
  if (refArtistEl) refArtistEl.innerHTML = artistLinksHtml(item);

  if (item.canonical) document.getElementById('ref-canonical').style.display = '';
  renderRelatedLinks('ref-related', item._related);

  renderTags('ref-tags', item.tags);
  renderDates('ref-dates', item);

  // Character wiki link
  if (item.characterId) {
    var charLink = document.getElementById('ref-char-link');
    var a = document.createElement('a');
    a.href      = '../wiki/#' + item.characterId;
    a.className = 'ref-wiki-link';
    a.textContent = 'View character wiki entry';
    charLink.appendChild(a);
  }

  // Height
  if (item.height) {
    document.getElementById('ref-height-block').style.display = '';
    document.getElementById('ref-height').textContent = item.height;
  }

  // Artist notes
  if (item.notes) {
    document.getElementById('ref-notes-block').style.display = '';
    document.getElementById('ref-notes').textContent = item.notes;
  }

  var dl = document.getElementById('ref-download');
  dl.href     = primary || '#';
  dl.download = item.title.replace(/\s+/g, '_') + '_ref.jpg';

  setupImageZoom('ref-img', 'ref-zoom-out', 'ref-zoom-reset', 'ref-zoom-in', 'ref-zoom-width', 'ref-zoom-pct');

  // Multi-version references (clothed/unclothed, etc.) are routed to the comic
  // reader in renderItem() for a clean page-by-page layout, so this function
  // only ever handles a single image. Hide any leftover version controls.
  if (refThumbs) refThumbs.style.display = 'none';
  var leftoverNav = document.getElementById('ref-version-nav');
  if (leftoverNav) leftoverNav.style.display = 'none';
}

// -- Set (a bundle of related images shown as a browsable grid)
var setImages = [];
var setLightboxIdx = 0;

function renderSet() {
  document.getElementById('view-set').style.display = '';
  setImages = item.images || [];

  document.getElementById('set-title').textContent = item.title;
  var saEl = document.getElementById('set-artist');
  if (saEl) saEl.innerHTML = artistLinksHtml(item);
  document.getElementById('set-synopsis').textContent = item.synopsis || item.description || '';
  document.getElementById('set-count').textContent = setImages.length + (setImages.length === 1 ? ' image' : ' images');
  if (item.canonical) document.getElementById('set-canonical').style.display = '';
  renderTags('set-tags', item.tags);
  renderDates('set-dates', item);
  renderCharacterLinks('set-characters', item.characters);
  renderLoreLinks('set-lore', item.lore);
  renderRelatedLinks('set-related', item._related);

  // Build the image grid
  var grid = document.getElementById('set-grid');
  grid.innerHTML = '';
  setImages.forEach(function(src, idx) {
    var cell = document.createElement('button');
    cell.className = 'set-grid-cell';
    cell.setAttribute('aria-label', 'View image ' + (idx + 1));
    var thumb = (window.SinverseImg ? SinverseImg.thumb(src, 500) : src);
    cell.innerHTML = '<img src="' + thumb + '" alt="' + item.title + ' ' + (idx + 1) + '" loading="lazy" />';
    cell.addEventListener('click', function() { openSetLightbox(idx); });
    grid.appendChild(cell);
  });

  wireSetLightbox();
}

function openSetLightbox(idx) {
  setLightboxIdx = idx;
  var lb = document.getElementById('set-lightbox');
  showSetLightboxImage();
  lb.style.display = 'flex';
}
function showSetLightboxImage() {
  var n = setImages.length;
  setLightboxIdx = (setLightboxIdx + n) % n;
  document.getElementById('set-lightbox-img').src = (window.SinverseImg ? SinverseImg.full(setImages[setLightboxIdx]) : setImages[setLightboxIdx]);
  document.getElementById('set-lightbox-counter').textContent = (setLightboxIdx + 1) + ' / ' + n;
  var dl = document.getElementById('set-lightbox-download');
  if (dl) {
    dl.href = setImages[setLightboxIdx] || '#';
    dl.download = (item.title || 'set').replace(/\s+/g, '_') + '_' + (setLightboxIdx + 1) + '.jpg';
  }
  var prev = document.getElementById('set-lightbox-prev');
  var next = document.getElementById('set-lightbox-next');
  prev.style.visibility = n > 1 ? '' : 'hidden';
  next.style.visibility = n > 1 ? '' : 'hidden';
}
function closeSetLightbox() {
  document.getElementById('set-lightbox').style.display = 'none';
}
function wireSetLightbox() {
  var lb = document.getElementById('set-lightbox');
  if (lb._wired) return;
  lb._wired = true;
  document.getElementById('set-lightbox-close').addEventListener('click', closeSetLightbox);
  document.getElementById('set-lightbox-prev').addEventListener('click', function(e){ e.stopPropagation(); setLightboxIdx--; showSetLightboxImage(); });
  document.getElementById('set-lightbox-next').addEventListener('click', function(e){ e.stopPropagation(); setLightboxIdx++; showSetLightboxImage(); });
  // Clicking the dark backdrop (outside the image panel) closes
  lb.addEventListener('click', function(e){ if (e.target === lb) closeSetLightbox(); });
  document.addEventListener('keydown', function(e) {
    if (lb.style.display === 'none') return;
    if (e.key === 'Escape') closeSetLightbox();
    if (e.key === 'ArrowRight') { setLightboxIdx++; showSetLightboxImage(); }
    if (e.key === 'ArrowLeft')  { setLightboxIdx--; showSetLightboxImage(); }
  });
  // Same zoom + grab-drag + wheel-pan as scene/comic
  setupImageZoom('set-lightbox-img', 'set-zoom-out', 'set-zoom-reset', 'set-zoom-in', 'set-zoom-width', 'set-zoom-pct');
}

// -- Helpers
function renderTags(containerId, tags) {
  var el = document.getElementById(containerId);
  if (!el || !tags || !tags.length) return;
  tags.forEach(function(tag) {
    var span = document.createElement('span');
    span.className   = 'content-tag';
    span.textContent = tag;
    el.appendChild(span);
  });
}

function formatPostedDate(s) {
  if (!s) return '';
  var parts = String(s).split('-');
  var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  if (parts.length >= 2) {
    var m = parseInt(parts[1], 10);
    if (m >= 1 && m <= 12) return months[m-1] + ' ' + parts[0];
  }
  return s;
}

function renderDates(containerId, it) {
  var el = document.getElementById(containerId);
  if (!el) return;
  var rows = '';
  if (it.date) {
    rows += '<div class="viewer-date-row"><span class="viewer-date-label">Posted</span><span class="viewer-date-val">' + formatPostedDate(it.date) + '</span></div>';
  }
  if (it.universe_date !== null && it.universe_date !== undefined && window.SinverseDates) {
    rows += '<div class="viewer-date-row"><span class="viewer-date-label">Set</span><span class="viewer-date-val">' + SinverseDates.labelHtml(it.universe_date, '../wiki/') + '</span></div>';
  }
  el.innerHTML = rows;
}

// Render "Related works" links in an info panel: cross-links to library stories
// or other gallery items. Resolves each link's title from the loaded indexes.
function renderRelatedLinks(containerId, related) {
  var el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '';
  if (!related || !related.length) { el.style.display = 'none'; return; }
  el.style.display = '';
  var label = document.createElement('span');
  label.className = 'viewer-related-label';
  label.textContent = 'Related: ';
  el.appendChild(label);
  var rendered = 0;
  related.forEach(function(r) {
    var title, href;
    if (r.module === 'library') {
      var s = (window._libraryItems || []).find(function(x){ return x.id === r.id; });
      if (!s) return;
      title = s.title;
      href  = '../library/reader.html?id=' + r.id;
    } else {
      var g = (window._galleryItems || []).find(function(x){ return x.id === r.id; });
      if (!g) return;
      title = g.title;
      href  = 'viewer.html?id=' + r.id;
    }
    if (rendered > 0) el.appendChild(document.createTextNode(', '));
    var a = document.createElement('a');
    a.className = 'viewer-related-link';
    a.href = href;
    a.textContent = title;
    el.appendChild(a);
    rendered++;
  });
  if (!rendered) el.style.display = 'none';
}

// ── Inactive fan characters + known-character roster ──────────
// Fan characters flagged "active": false are hidden site-wide. And any tag
// that doesn't resolve to a real character (canon or active fan) is shown as
// plain text rather than a link, so it never leads to a broken wiki page.
var _inactiveFanKeys = {};
var _knownCharKeys   = {};   // canon + ACTIVE fan: names and wiki slugs (lowercased)
function loadInactiveFanKeys() {
  function addKnown(c){
    if (!c) return;
    if (c.name) _knownCharKeys[String(c.name).toLowerCase()] = true;
    if (c.wiki) _knownCharKeys[String(c.wiki).toLowerCase()] = true;
  }
  var canonP = fetch('../_data/characters.json').then(function(r){ return r.ok ? r.json() : []; }).catch(function(){ return []; });
  var fanP   = fetch('../_data/fan-characters.json').then(function(r){ return r.ok ? r.json() : []; }).catch(function(){ return []; });
  return Promise.all([canonP, fanP]).then(function(res){
    (res[0] || []).forEach(addKnown);
    (res[1] || []).forEach(function(c){
      if (c && c.active === false) {
        if (c.name) _inactiveFanKeys[String(c.name).toLowerCase()] = true;
        if (c.wiki) _inactiveFanKeys[String(c.wiki).toLowerCase()] = true;
      } else { addKnown(c); }
    });
  }).catch(function(){});
}
function isInactiveFanTag(tag) {
  var m = String(tag).match(/^\s*(canon|fan)\s*:\s*(.+)$/i);
  if (m && m[1].toLowerCase() === 'canon') return false;
  var key = (m ? m[2] : String(tag)).replace(/_/g, ' ').trim().toLowerCase();
  return !!_inactiveFanKeys[key] || !!_inactiveFanKeys[key.replace(/\s+/g, '-')];
}
function activeCharacters(chars) {
  return (chars || []).filter(function(c){ return !isInactiveFanTag(c); });
}
function isKnownCharacter(tag) {
  var m = String(tag).match(/^\s*(canon|fan)\s*:\s*(.+)$/i);
  var key = (m ? m[2] : String(tag)).replace(/_/g, ' ').trim().toLowerCase();
  return !!_knownCharKeys[key] || !!_knownCharKeys[key.replace(/\s+/g, '-')];
}

function renderCharacterLinks(containerId, characters) {
  var el = document.getElementById(containerId);
  characters = activeCharacters(characters);   // drop inactive fan characters
  if (!el || !characters || !characters.length) return;
  var label = document.createElement('span');
  label.className   = 'viewer-chars-label';
  label.textContent = 'Characters: ';
  el.appendChild(label);
  characters.forEach(function(charId, i) {
    // A tag is a character handle: optional "canon:"/"fan:" prefix + name (or
    // slug). Link it only if it resolves to a real character; otherwise show
    // it as plain text so it never leads to a broken wiki page.
    var m = String(charId).match(/^\s*(canon|fan)\s*:\s*(.+)$/i);
    var pfx = m ? (m[1].toLowerCase() + ':') : '';
    var key = (m ? m[2] : String(charId)).replace(/_/g, ' ').trim();
    var displayName = key.charAt(0).toUpperCase() + key.slice(1);
    if (isKnownCharacter(charId)) {
      var a = document.createElement('a');
      a.className = 'viewer-char-link';
      a.href = '../wiki/?character=' + encodeURIComponent(pfx + key.toLowerCase());
      a.textContent = displayName;
      el.appendChild(a);
    } else {
      var span = document.createElement('span');
      span.className   = 'viewer-char-plain';
      span.style.color = 'var(--text-secondary, #b8a898)';
      span.title       = 'No wiki entry yet';
      span.textContent = displayName;
      el.appendChild(span);
    }
    if (i < characters.length - 1) el.appendChild(document.createTextNode(', '));
  });
}

// Lore links: maps each lore id to its label from wiki/lore.json (fetched once,
// cached) and links to the wiki lore page via its #lore-<id> hash. Mirrors the
// character row's styling. Async so labels resolve after the JSON loads.
var _loreLabels = null;
function loadLoreLabels() {
  if (_loreLabels) return Promise.resolve(_loreLabels);
  return fetch('../wiki/lore.json')
    .then(function(r){ return r.ok ? r.json() : []; })
    .then(function(list){
      _loreLabels = {};
      (list || []).forEach(function(p){ _loreLabels[p.id] = p.label; });
      return _loreLabels;
    })
    .catch(function(){ _loreLabels = {}; return _loreLabels; });
}
function prettyLoreId(id) {
  return String(id).replace(/-/g, ' ').replace(/\b\w/g, function(c){ return c.toUpperCase(); });
}
function renderLoreLinks(containerId, lore) {
  var el = document.getElementById(containerId);
  if (!el || !lore || !lore.length) { if (el) el.style.display = 'none'; return; }
  loadLoreLabels().then(function(labels) {
    el.innerHTML = '';
    el.style.display = '';
    var label = document.createElement('span');
    label.className   = 'viewer-chars-label';
    label.textContent = 'Related Lore: ';
    el.appendChild(label);
    lore.forEach(function(id, i) {
      var a = document.createElement('a');
      a.href      = '../wiki/#lore-' + id;
      a.className = 'viewer-char-link';
      a.textContent = labels[id] || prettyLoreId(id);
      el.appendChild(a);
      if (i < lore.length - 1) el.appendChild(document.createTextNode(', '));
    });
  });
}

init();
