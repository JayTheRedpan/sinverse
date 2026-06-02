'use strict';

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

  // The scale that makes the image's WIDTH fill the panel width. At scale 1 the
  // image is object-fit:contain (letterboxed); if it's already width-limited
  // this is ~1, if it's tall/narrow this is >1.
  function fitWidthScale() {
    var prev = img.style.transform;
    img.style.transform = 'none';
    var fit = img.getBoundingClientRect();
    img.style.transform = prev;
    var pr = panel.getBoundingClientRect();
    if (!fit.width) return 1;
    return Math.min(MAX, Math.max(1, pr.width / fit.width));
  }

  // Measure the image's "fit" box (its on-screen size/position at scale 1,
  // transform removed) so panning clamps to the actual image area — not the
  // whole panel, which in the comic view also contains controls + strip.
  function maxOffset() {
    var prevTransform = img.style.transform;
    img.style.transform = 'none';
    var fit = img.getBoundingClientRect();   // fitted, untransformed box
    img.style.transform = prevTransform;     // restore current transform
    var pr = panel.getBoundingClientRect();
    // Scaled image extends (scale-1)/2 of the fit size beyond each fit edge,
    // measured from the fit box's own center.
    var scaledW = fit.width * scale, scaledH = fit.height * scale;
    // Visible viewport for the image = the panel rect. The image's fit box is
    // centered on (fit.left+fit.width/2). Allowed pan keeps the scaled image
    // covering the panel: offset can move until a scaled edge meets a panel edge.
    var fitCx = fit.left + fit.width / 2,  prCx = pr.left + pr.width / 2;
    var fitCy = fit.top + fit.height / 2,  prCy = pr.top + pr.height / 2;
    var baseDx = fitCx - prCx;  // where the fit box center sits vs panel center
    var baseDy = fitCy - prCy;
    return {
      // max translate so the scaled image's edge reaches the panel's edge
      xPos: Math.max(0,  scaledW / 2 - (pr.width  / 2) - baseDx),
      xNeg: Math.max(0,  scaledW / 2 - (pr.width  / 2) + baseDx),
      yPos: Math.max(0,  scaledH / 2 - (pr.height / 2) - baseDy),
      yNeg: Math.max(0,  scaledH / 2 - (pr.height / 2) + baseDy)
    };
  }
  function clamp() {
    var m = maxOffset();
    tx = Math.max(-m.xNeg, Math.min(m.xPos, tx));
    ty = Math.max(-m.yNeg, Math.min(m.yPos, ty));
  }
  function apply() {
    if (scale === 1) { tx = 0; ty = 0; }
    else clamp();
    img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
    img.style.cursor = scale > 1 ? (drag ? 'grabbing' : 'grab') : '';
    if (pctEl) pctEl.textContent = Math.round(scale * 100) + '%';
  }
  function zoomTo(s) { scale = Math.max(MIN, Math.min(MAX, Math.round(s * 100) / 100)); apply(); }

  if (out)   out.addEventListener('click',   function(){ zoomTo(scale - 0.25); });
  if (inc)   inc.addEventListener('click',   function(){ zoomTo(scale + 0.25); });
  if (reset) reset.addEventListener('click', function(){ scale = 1; tx = 0; ty = 0; apply(); });
  if (widthBtn) widthBtn.addEventListener('click', function(){
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
  img.addEventListener('dblclick', function(){ scale === 1 ? zoomTo(2) : (function(){ scale = 1; tx = 0; ty = 0; apply(); })(); });

  // Scroll wheel pans the image while zoomed (vertical; shift = horizontal).
  // Falls through to normal page scroll when at fit (scale 1).
  panel.addEventListener('wheel', function(e) {
    if (scale <= 1) return;
    e.preventDefault();
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
    var res = await fetch('./gallery.json');
    if (!res.ok) throw new Error('Could not load gallery.json');
    var items = await res.json();
    item = items.find(function(i) { return i.id === id; });
    if (!item) throw new Error('Item not found: ' + id);
    if (window.SinverseDates) await SinverseDates.load('../wiki/eras.json');
    render();
  } catch(e) {
    document.body.innerHTML = '<div style="padding:4rem;text-align:center;color:var(--text-muted)">' + e.message + '</div>';
  }
}

function render() {
  document.title = item.title + ' — Sinverse Gallery';
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
  // Highlight the active thumbnail and scroll it into view within the strip
  var strip = document.getElementById('comic-thumb-strip');
  if (strip) {
    var thumbs = strip.querySelectorAll('.comic-thumb');
    thumbs.forEach(function(t, i){ t.classList.toggle('active', i === comicPage); });
    var active = thumbs[comicPage];
    if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
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
  document.getElementById('scene-artist').textContent      = item.artist ? 'by ' + item.artist : '';
  document.getElementById('scene-description').textContent = item.description || '';

  if (item.canonical) document.getElementById('scene-canonical').style.display = '';

  renderTags('scene-tags', item.tags);
  renderDates('scene-dates', item);
  renderCharacterLinks('scene-characters', item.characters);

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
  document.getElementById('ref-artist').textContent = item.artist ? 'by ' + item.artist : '';

  if (item.canonical) document.getElementById('ref-canonical').style.display = '';

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
