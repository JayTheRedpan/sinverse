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

  // Scroll wheel pans the image while zoomed (vertical; shift = horizontal).
  // Falls through to normal page scroll when at fit (scale 1).
  panel.addEventListener('wheel', function(e) {
    if (scale <= 1) return;
    e.preventDefault();
    setSmooth(false);   // instant pan — no animated bounce on fast scroll
    if (e.shiftKey) { tx -= e.deltaY; }
    else { ty -= e.deltaY; tx -= e.deltaX; }
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
    var res = await fetch('./stash.json');
    if (!res.ok) throw new Error('Could not load stash.json');
    var raw = await res.json();
    window._stashAll = raw;   // full list (images + stories) for related-link resolution
    var items = raw.filter(function(i){ return i.kind === 'image'; }).map(normalizeStashImage);
    item = items.find(function(i) { return i.id === id; });
    if (!item) throw new Error('Item not found: ' + id);
    item._related = buildStashRelated(item, raw);
    await resolveExternalTitles(item._related);
    if (window.SinverseDates) await SinverseDates.load('../wiki/eras.json');
    render();
  } catch(e) {
    document.body.innerHTML = '<div style="padding:4rem;text-align:center;color:var(--text-muted)">' + e.message + '</div>';
  }
}

// External cross-links carry a module + id but no title; this fetches the
// source module's JSON (once, cached) and fills each title in by id. Only the
// modules actually referenced get loaded.
var _moduleCache = {};
function moduleDataPath(mod) {
  if (mod === 'gallery') return '../gallery/gallery.json';
  if (mod === 'library') return '../library/library.json';
  return null;
}
async function resolveExternalTitles(related) {
  var external = (related || []).filter(function(r){ return r.module; });
  if (!external.length) return;
  var mods = external.map(function(r){ return r.module; })
    .filter(function(m, i, a){ return a.indexOf(m) === i; });
  await Promise.all(mods.map(async function(mod){
    if (_moduleCache[mod]) return;
    var path = moduleDataPath(mod);
    if (!path) return;
    try {
      var res = await fetch(path);
      _moduleCache[mod] = res.ok ? await res.json() : [];
    } catch (e) { _moduleCache[mod] = []; }
  }));
  external.forEach(function(r){
    var list = _moduleCache[r.module] || [];
    var found = list.find(function(x){ return x.id === r.id; });
    r.title = (found && found.title) ||
      (r.module === 'library' ? 'Library story #' + r.id : 'Gallery image #' + r.id);
  });
}

// Resolve a stash item's related entries WITHIN the stash, with auto-reciprocity.
// `relates_to` entries may be a bare id (5) or an object ({ "id": 5 }). If item A
// lists B, B automatically shows A too — declare the link on either side only.
function buildStashRelated(target, all) {
  var ids = {}, order = [];
  function add(id) {
    id = parseInt(id, 10);
    if (isNaN(id) || id === target.id || ids[id]) return;
    ids[id] = true; order.push(id);
  }
  // In-stash refs only: skip entries that name an external module (gallery/
  // library) — those are resolved separately as cross-links below.
  function isExternal(r) { return r && typeof r === 'object' && r.module; }
  function refsOf(it) {
    return (it.relates_to || [])
      .filter(function(r){ return !isExternal(r); })
      .map(function(r){ return (r && typeof r === 'object') ? r.id : r; });
  }
  // 1) Links this item declares directly.
  refsOf(target).forEach(add);
  // 2) Reciprocals: any stash item that points AT this one.
  (all || []).forEach(function(it){
    if (refsOf(it).map(Number).indexOf(target.id) !== -1) add(it.id);
  });
  // Resolve to {id, title, kind} for rendering.
  var inStash = order.map(function(id){
    var found = (all || []).find(function(x){ return x.id === id; });
    return found ? { id: id, title: found.title, kind: found.kind } : null;
  }).filter(Boolean);

  // External cross-links out to the main gallery/library. The stash doesn't
  // load that data, so each entry carries its own title; module decides the
  // destination and id the target item.
  var external = (target.relates_to || []).filter(isExternal).map(function(r){
    var mod = r.module;
    return {
      id: r.id,
      module: mod,
      kind: mod === 'library' ? 'story' : 'image',
      title: r.title || ''   // resolved from the module JSON later (resolveExternalTitles)
    };
  });

  return inStash.concat(external);
}

// Map a stash image entry onto the gallery viewer's expected shape:
//   creator -> artist, blurb -> synopsis, and derive a viewer `type`:
//   - has `pages`  -> comic
//   - has `images` -> set
//   - otherwise    -> scene (single image)
function normalizeStashImage(it) {
  var out = {};
  for (var k in it) out[k] = it[k];
  out.artist   = it.artist || it.creator || '';
  out.synopsis = it.synopsis || it.blurb || '';
  if (!out.type || out.type === 'image') {
    if (it.pages && it.pages.length)       out.type = 'comic';
    else if (it.images && it.images.length) out.type = 'set';
    else                                    out.type = 'scene';
  }
  return out;
}

// (Cross-module related-links are not used in the stash. buildRelatedFor just
// clears the list; the original renderRelatedLinks hides the container when empty.)
function buildRelatedFor(target) { if (target) target._related = []; }
function _unusedBuildRelatedFor(target, targetModule, galleryItems, libraryItems) {
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
  document.title = item.title + ' — Jay\'s Stash';
  document.getElementById('viewer-title').textContent = item.title;

  if (item.type === 'comic')   renderComic();
  if (item.type === 'scene')   renderScene();
  if (item.type === 'charref') renderCharRef();
  if (item.type === 'set')     renderSet();
}

// -- Comic
function renderComic() {
  document.getElementById('view-comic').style.display = '';

  // Populate sidebar
  document.getElementById('comic-title-reader').textContent   = item.title;
  var caEl = document.getElementById('comic-artist-reader');
  if (caEl) caEl.innerHTML = item.artist ? 'by ' + '<a class="viewer-artist-link" href="../contributors/?creator=' + encodeURIComponent(item.artist) + '">' + item.artist + '</a>' : '';
  document.getElementById('comic-synopsis-reader').textContent = item.synopsis || '';
  if (item.canonical) document.getElementById('comic-canonical-reader').style.display = '';
  renderTags('comic-tags-reader', item.tags);
  renderDates('comic-dates', item);
  renderCharacterLinks('comic-characters-reader', item.characters);
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
  img.src = pages[comicPage];
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
  img.src = item.image || '';
  img.alt = item.title;

  document.getElementById('scene-title').textContent       = item.title;
  var sceneArtistEl = document.getElementById('scene-artist');
  if (sceneArtistEl) sceneArtistEl.innerHTML = item.artist ? 'by ' + '<a class="viewer-artist-link" href="../contributors/?creator=' + encodeURIComponent(item.artist) + '">' + item.artist + '</a>' : '';
  document.getElementById('scene-description').textContent = item.description || '';

  if (item.canonical) document.getElementById('scene-canonical').style.display = '';

  renderTags('scene-tags', item.tags);
  renderDates('scene-dates', item);
  renderCharacterLinks('scene-characters', item.characters);
  renderRelatedLinks('scene-related', item._related);

  var dl = document.getElementById('scene-download');
  dl.href     = item.image || '#';
  dl.download = item.title.replace(/\s+/g, '_') + '.jpg';

  setupImageZoom('scene-img', 'scene-zoom-out', 'scene-zoom-reset', 'scene-zoom-in', 'scene-zoom-width', 'scene-zoom-pct');
}

// -- Character Reference
function renderCharRef() {
  document.getElementById('view-charref').style.display = '';

  var img = document.getElementById('ref-img');
  img.src = item.image || '';
  img.alt = item.title;

  document.getElementById('ref-title').textContent  = item.title;
  var refArtistEl = document.getElementById('ref-artist');
  if (refArtistEl) refArtistEl.innerHTML = item.artist ? 'by ' + '<a class="viewer-artist-link" href="../contributors/?creator=' + encodeURIComponent(item.artist) + '">' + item.artist + '</a>' : '';

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
  dl.href     = item.image || '#';
  dl.download = item.title.replace(/\s+/g, '_') + '_ref.jpg';

  setupImageZoom('ref-img', 'ref-zoom-out', 'ref-zoom-reset', 'ref-zoom-in', 'ref-zoom-width', 'ref-zoom-pct');
}

// -- Set (a bundle of related images shown as a browsable grid)
var setImages = [];
var setLightboxIdx = 0;

function renderSet() {
  document.getElementById('view-set').style.display = '';
  setImages = item.images || [];

  document.getElementById('set-title').textContent = item.title;
  var saEl = document.getElementById('set-artist');
  if (saEl) saEl.innerHTML = item.artist ? 'by ' + '<a class="viewer-artist-link" href="../contributors/?creator=' + encodeURIComponent(item.artist) + '">' + item.artist + '</a>' : '';
  document.getElementById('set-synopsis').textContent = item.synopsis || item.description || '';
  document.getElementById('set-count').textContent = setImages.length + (setImages.length === 1 ? ' image' : ' images');
  if (item.canonical) document.getElementById('set-canonical').style.display = '';
  renderTags('set-tags', item.tags);
  renderDates('set-dates', item);
  renderCharacterLinks('set-characters', item.characters);
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
  document.getElementById('set-lightbox-img').src = setImages[setLightboxIdx];
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
    rows += '<div class="viewer-date-row"><span class="viewer-date-label">Set</span><span class="viewer-date-val">' + SinverseDates.label(it.universe_date) + '</span></div>';
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
    // External cross-links go out to the main gallery/library; in-stash links
    // stay local (images -> viewer.html, stories -> reader.html).
    var href;
    if (r.module === 'gallery')      href = '../gallery/viewer.html?id=' + r.id;
    else if (r.module === 'library') href = '../library/reader.html?id=' + r.id;
    else href = (r.kind === 'story' ? 'reader.html?id=' : 'viewer.html?id=') + r.id;
    if (rendered > 0) el.appendChild(document.createTextNode(', '));
    var a = document.createElement('a');
    a.className = 'viewer-related-link';
    a.href = href;
    a.textContent = r.title;
    el.appendChild(a);
    rendered++;
  });
  if (!rendered) el.style.display = 'none';
}

function renderCharacterLinks(containerId, characters) {
  var el = document.getElementById(containerId);
  if (!el || !characters || !characters.length) return;
  var label = document.createElement('span');
  label.className   = 'viewer-chars-label';
  label.textContent = 'Characters: ';
  el.appendChild(label);
  characters.forEach(function(charId, i) {
    var a = document.createElement('a');
    a.href      = '../wiki/#' + charId;
    a.className = 'viewer-char-link';
    var displayName = charId.replace(/_/g, ' ');
    a.textContent = displayName.charAt(0).toUpperCase() + displayName.slice(1);
    a.href = '../wiki/?character=' + encodeURIComponent(displayName.toLowerCase());
    el.appendChild(a);
    if (i < characters.length - 1) el.appendChild(document.createTextNode(', '));
  });
}

init();
