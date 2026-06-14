'use strict';
/* ============================================================================
   Sinverse — Size Reference tool (the biggest single file on the site)
   ----------------------------------------------------------------------------
   Lets users compare characters at scale across three views: Height (scene),
   Length (anatomy), and Stats. Supports canon characters (from
   _data/characters.json) and user-created custom characters.

   KEY CONCEPTS
   - Heights are in INCHES throughout (72 = 6ft, 144 = 12ft).
   - `S` is the global state object (current view, zoom, characters, overrides).
   - Canon chars: loaded from _data/characters.json into S.chars.
   - Custom chars: stored in localStorage 'sinverse_custom_chars' as
     { chars: [ {id:'custom_1', name, height, default_silhouette, ...} ] }.
     Their images live separately in IndexedDB (store 'sizeref_images').
   - Config: defaults.json (silhouettes/poses/builds), objects.json (props),
     builds.json (body types).

   IMPORTANT BEHAVIORS
   - calcStats(): all the per-character numbers. Linear dims scale with height,
     volumes/masses with the cube. Penis girth/width scale from the char's
     LENGTH (not height). Fluid outputs use an intentional mass^1.5 exaggeration.
   - Copy image: doCopyImage() captures the scene via html2canvas. It briefly
     un-clips the scroll container so zoomed scenes capture fully, then restores.
   - Bot/screenshot API: applyURLParams() reads ?char1/h1/view/screenshot/scale
     and (in screenshot mode) replaces the page with a single PNG. See
     MAINTENANCE.md §10 for the full parameter list.
   - Layout: .sr-app is height:100vh but must subtract the 52px global nav via
     `body.has-global-nav .sr-app { height: calc(100vh - 52px) }` (see styles).
   ========================================================================== */

// ── State ─────────────────────────────────────────────────────
var sandboxMode    = false;
var sandboxOffsets = {};
var sandboxPendingSnapshot = null;
var sandboxRafPending = false;
var renderInProgress = false;
var sandboxPositions = {}; // slot index → {tx, ty}, persists across renders

var S = {
  heightOverrides: {},  // charId -> override inches (session only)
  gridLines:    false,  // show scale grid lines across viewer
  perspActive:  {},     // slotIdx -> active perspective tab index
  chars:       [],
  objects:     [],
  builds:      [],
  metric:      false,
  zoomH:       1,
  charFlips:   {},
  charRotations: {},
  zoomL:       0.75,
  view:        'height',
  pxPerIn:     2,
  pxPerInLen:  2,
  canvasH:     420,
  lenImgMode:  {},    // entityId -> 'length' | 'height'
};

var STORE     = 'sinverse_custom_chars';
var IMG_DB    = null;
var IMG_STORE = 'sizeref_images';

function openImgDB() {
  return new Promise(function(resolve, reject) {
    if (IMG_DB) { resolve(IMG_DB); return; }
    var req = indexedDB.open('sinverse_sizeref', 1);
    req.onupgradeneeded = function(e) {
      e.target.result.createObjectStore(IMG_STORE);
    };
    req.onsuccess = function(e) { IMG_DB = e.target.result; resolve(IMG_DB); };
    req.onerror   = function(e) { reject(e); };
  });
}
function storeImg(key, dataUrl) {
  return openImgDB().then(function(db) {
    return new Promise(function(resolve) {
      var tx = db.transaction(IMG_STORE, 'readwrite');
      tx.objectStore(IMG_STORE).put(dataUrl, key);
      tx.oncomplete = resolve;
    });
  });
}
function getImg(key) {
  return openImgDB().then(function(db) {
    return new Promise(function(resolve) {
      var tx = db.transaction(IMG_STORE, 'readonly');
      var req = tx.objectStore(IMG_STORE).get(key);
      req.onsuccess = function() { resolve(req.result || null); };
      req.onerror   = function() { resolve(null); };
    });
  });
}
function deleteImg(key) {
  return openImgDB().then(function(db) {
    return new Promise(function(resolve) {
      var tx = db.transaction(IMG_STORE, 'readwrite');
      tx.objectStore(IMG_STORE).delete(key);
      tx.oncomplete = resolve;
    });
  });
}
// Clean break: strip old base64 images from localStorage on load
(function() {
  try {
    var raw = localStorage.getItem('sinverse_custom_chars');
    if (!raw) return;
    var d = JSON.parse(raw);
    var changed = false;
    (d.chars||[]).forEach(function(c) {
      if (!c) return;
      ['image','length_image','profile_image'].forEach(function(f) {
        if (c[f] && c[f].startsWith('data:')) { c[f] = ''; changed = true; }
      });
    });
    if (changed) localStorage.setItem('sinverse_custom_chars', JSON.stringify(d));
  } catch(e) {}
})();

function compressToWebP(dataUrl, maxPx, quality) {
  return new Promise(function(resolve) {
    var img = new Image();
    img.onload = function() {
      var w = img.width, h = img.height;
      if (w > maxPx || h > maxPx) {
        if (w > h) { h = Math.round(h * maxPx / w); w = maxPx; }
        else       { w = Math.round(w * maxPx / h); h = maxPx; }
      }
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/webp', quality || 0.85));
    };
    img.onerror = function() { resolve(dataUrl); };
    img.src = dataUrl;
  });
}

// Populated from defaults.json at init time
var DEFAULTS = {
  heightSils:   [],  // [{id, label, url}]
  lengthSils:   [],
  headshotSils: [],
  height:   {},      // id -> url (convenience lookup)
  headshot: {},
  length:       '',  // first length silhouette URL
  lengthPresets: [], // [{id,label,inches}]
  poses: [],         // [{value, label}] height-correction pose options
};

function populateDefaults(data) {
  DEFAULTS.heightSils    = data.height_silhouettes   || [];
  DEFAULTS.lengthSils    = data.length_silhouettes   || [];
  DEFAULTS.headshotSils  = data.headshot_silhouettes || [];
  DEFAULTS.lengthPresets = data.length_presets       || [];
  S.builds              = data.builds              || [];
  // Pose options (height-correction multipliers). Fall back to the built-in
  // list if defaults.json doesn't define them, so the tool never breaks.
  if (data.poses && data.poses.length) {
    DEFAULTS.poses = data.poses.map(function(p) {
      return { v: String(p.value), l: p.label };
    });
  } else {
    DEFAULTS.poses = POSES_FALLBACK.slice();
  }
  DEFAULTS.heightSils.forEach(function(s)   { DEFAULTS.height[s.id]   = s.url; });
  DEFAULTS.headshotSils.forEach(function(s) { DEFAULTS.headshot[s.id] = s.url; });
  DEFAULTS.length = DEFAULTS.lengthSils.length ? DEFAULTS.lengthSils[0].url : '';
}
var LABEL_H = 0;   // no labels below ground
var ZSTEP   = 0.25;
var ZMIN    = 0.25;
var ZMAX    = 8;
var cropImgs = {};   // slot -> Image object

// Fallback pose list — used only if defaults.json doesn't define `poses`.
// The live list comes from DEFAULTS.poses (loaded from defaults.json).
var POSES_FALLBACK = [
  {v:'1',    l:'Standing (full height)'},
  {v:'0.85', l:'Standing, relaxed'},
  {v:'0.75', l:'Sitting upright'},
  {v:'0.60', l:'Seated / crouching'},
  {v:'0.45', l:'Kneeling'},
  {v:'0.30', l:'Lying down'},
];

// ── Init ──────────────────────────────────────────────────────
async function init() {
  async function fetchJSON(url, fallback) {
    try { var r = await fetch(url); return r.ok ? await r.json() : fallback; }
    catch(e) { console.warn('Could not load', url, e); return fallback; }
  }
  S.chars   = await fetchJSON('../_data/characters.json', []);
  S.objects = await fetchJSON('./objects.json', []);
  var defsData = await fetchJSON('./defaults.json?v=1780365037', {});
  populateDefaults(defsData);

  buildForms();

  // Create initial slot — buildSelectOptions runs inside and populates options
  var slotContainer = document.getElementById('sr-char-slots');
  if (slotContainer) {
    var firstRow = createSlotRow('char');
    slotContainer.appendChild(firstRow);
    updateSlotUI();
    // Set Jay directly on the select element right now, before anything else touches it
    var firstSel = firstRow.querySelector('.slot-select');
    if (firstSel && S.chars.length) {
      firstSel.value = 'canon_' + S.chars[0].id;
      }
  }
  // fillSelects refreshes all selects but preserves existing values via buildSelectOptions
  fillSelects();

  wireCharModal();

  var area = document.getElementById('sr-canvas-area');
  requestAnimationFrame(function() {
    applyURLParams();
    renderActive(); // respects S.view set by URL params
    window._sizeRefRO = new ResizeObserver(function() { if (!sandboxMode) renderActive(); });
    if (area) window._sizeRefRO.observe(area);
    // Keep the ruler scrolling in lockstep with the figures/grid when zoomed.
    var scrollSync = document.getElementById('sr-scroll');
    if (scrollSync) scrollSync.addEventListener('scroll', function(){ syncRulerScroll(); });
  });
}

// ── URL param handling (bot/deeplink support) ──────────────────
function applyURLParams() {
  var p = new URLSearchParams(window.location.search);
  if (!p.toString()) return;

  // ── Set view ──────────────────────────────────────────────
  var view = p.get('view');
  if (view && ['height','length','stats','compare'].indexOf(view) > -1) {
    // 'compare' is the legacy name for the height/scene view
    if (view === 'compare') view = 'height';
    // Click the actual view tab so all side effects (render, zoom, etc.) fire
    var viewBtn = document.querySelector('.sr-view-tab[data-view="' + view + '"]');
    if (viewBtn) viewBtn.click();
  }

  // ── Screenshot mode: render canvas area as full-page image ──
  if (p.get('screenshot') === '1') {
    // Scale (ruler) is hidden by default for the bot; opt in with ?scale=1
    var showScale = p.get('scale') === '1';
    // Wait for render to settle, then auto-capture like clipboard button
    setTimeout(function() {
      var target = S.view === 'length'
        ? document.getElementById('sr-length-area')
        : document.getElementById('sr-canvas-area');
      if (!target || typeof html2canvas === 'undefined') return;

      // Hide the scale ruler unless the caller opted in (display:none so it
      // leaves no blank column in the captured image)
      var rulerCol = document.getElementById('sr-ruler-col');
      var lenRulerWrap = document.getElementById('sr-length-ruler-wrap');
      if (!showScale) {
        if (rulerCol)     rulerCol.style.display = 'none';
        if (lenRulerWrap) lenRulerWrap.style.display = 'none';
      }

      var filteredImgs = Array.from(target.querySelectorAll('img.sr-char-img:not(.sr-img-real), img.sr-sil-filter'));
      var srcList = filteredImgs.map(function(img){ return img.src; });

      Promise.all(srcList.map(function(src){ return src ? bakedDataUrl(src) : Promise.resolve(null); }))
        .then(function(bakedUrls) {
          html2canvas(target, {
            backgroundColor: null,
            useCORS: true,
            allowTaint: false,
            scale: 2,
            onclone: function(doc) {
              var cloneImgs = Array.from(doc.querySelectorAll('img.sr-char-img:not(.sr-img-real), img.sr-sil-filter'));
              cloneImgs.forEach(function(img, i) {
                if (bakedUrls[i]) { img.src = bakedUrls[i]; img.style.filter = 'none'; }
              });
            }
          }).then(function(canvas) {
            // Replace entire page with just the captured image
            window._screenshotDone = true;  // suppress any deferred renders
            document.body.innerHTML = '';
            document.body.style.cssText = 'margin:0;padding:0;background:#0a0a0a;display:flex;align-items:center;justify-content:center;min-height:100vh;';
            var img = new Image();
            img.style.cssText = 'max-width:100%;display:block;';
            img.src = canvas.toDataURL('image/png');
            document.body.appendChild(img);
          });
        });
    }, 800); // give render time to settle
  }

  // ── Resolve character value ───────────────────────────────
  function resolveChar(nameParam, hParam, nParam, customSlot) {
    var name = p.get(nameParam), h = p.get(hParam), n = p.get(nParam);
    if (name) {
      var match = S.chars.find(function(c){ return c.name.toLowerCase() === name.toLowerCase(); });
      if (match) return 'canon_' + match.id;
    }
    if (h) {
      // Build a custom character in the CURRENT storage shape: an entry in
      // loadCustom().chars[] keyed id:'custom_N', with a default silhouette so
      // it renders without an uploaded image.
      var d = loadCustom();
      if (!Array.isArray(d.chars)) d.chars = [];
      var id = 'custom_' + customSlot;
      var defSil = (DEFAULTS.heightSils[0] && DEFAULTS.heightSils[0].id) || 'giantess';
      var lenParam = p.get(customSlot === 1 ? 'l1' : 'l2');   // optional length (inches)
      var wParam   = p.get(customSlot === 1 ? 'w1' : 'w2');   // optional weight (lbs)
      var rec = {
        id: id,
        name: n || ('Character ' + customSlot),
        height: parseFloat(h),
        height_correction: 1,
        headroom_pct: 0,
        weight: wParam ? parseFloat(wParam) : null,
        image: '',
        length: lenParam ? parseFloat(lenParam) : null,
        length_image: '',
        profile_image: '',
        default_silhouette: defSil,
        default_length_silhouette: (DEFAULTS.lengthSils && DEFAULTS.lengthSils[0] && DEFAULTS.lengthSils[0].id) || 'humanoid',
        default_headshot_silhouette: defSil,
        canonical: false,
        custom: true
      };
      // Replace any existing record for this slot id, else append
      var idx = d.chars.findIndex(function(c){ return c && c.id === id; });
      if (idx > -1) d.chars[idx] = rec; else d.chars.push(rec);
      saveCustom(d);
      return id;
    }
    return null;
  }

  var val1 = resolveChar('char1', 'h1', 'n1', 1);
  var val2 = resolveChar('char2', 'h2', 'n2', 2);

  // ── Apply to existing slots without triggering modal ──────
  // Get all existing slot selects (created by init)
  var sels = allSlotSelects().filter(function(s){ return s.getAttribute('data-type') === 'char'; });

  if (val1) {
    // Rebuild options so custom_1 appears if needed
    fillSelects();
    if (sels[0]) {
      sels[0].value = val1;
      var pb1 = sels[0].closest('.sr-slot-row') && sels[0].closest('.sr-slot-row').querySelector('.slot-picker-btn');
      if (pb1) {
        var opt1 = sels[0].options[sels[0].selectedIndex];
        pb1.textContent = opt1 && opt1.value ? opt1.textContent : '— Select character —';
      }
    }
  }

  if (val2) {
    if (sels[1]) {
      // Slot 2 already exists
      sels[1].value = val2;
      var pb2 = sels[1].closest('.sr-slot-row') && sels[1].closest('.sr-slot-row').querySelector('.slot-picker-btn');
      if (pb2) {
        fillSelects(); // rebuild options so custom_2 appears
        sels[1].value = val2;
        var opt2 = sels[1].options[sels[1].selectedIndex];
        pb2.textContent = opt2 && opt2.value ? opt2.textContent : '— Select character —';
      }
    } else {
      // Need to add a second slot — use createSlotRow directly (no modal)
      var container = document.getElementById('sr-char-slots');
      if (container) {
        var newRow = createSlotRow('char');
        container.appendChild(newRow);
        updateSlotUI();
        fillSelects();
        var newSel = newRow.querySelector('.slot-select');
        if (newSel) {
          newSel.value = val2;
          var pb3 = newRow.querySelector('.slot-picker-btn');
          if (pb3) {
            var opt3 = newSel.options[newSel.selectedIndex];
            pb3.textContent = opt3 && opt3.value ? opt3.textContent : '— Select character —';
          }
        }
      }
    }
  }
}

// ── Units ─────────────────────────────────────────────────────
function inToCm(i)  { return i * 2.54; }
// Safe ft/in split — Math.round can produce 12in, carry into feet
function safeHFt(inches) {
  var total = Math.round(inches);
  return Math.floor(total / 12);
}
function safeHIn(inches) {
  var total = Math.round(inches);
  var ins = total % 12;
  return ins; // modulo always 0-11
}
function lbsToKg(l) { return l * 0.453592; }
function ftIn(i) {
  if (i < 1) return i.toFixed(2) + '"';
  var t = Math.round(i), ft = Math.floor(t/12), ins = t%12;
  if (ft === 0) return ins + '"';
  return ft + "'" + ins + '"';
}
function fH(in_) {
  if (!in_ && in_ !== 0) return '—';
  if (S.metric) {
    var cm = inToCm(in_);
    if (cm < 0.1)  return (cm * 10).toFixed(1) + ' mm';
    if (cm < 1)    return cm.toFixed(1) + ' cm';
    if (cm >= 100) {
      var m = Math.floor(cm / 100);
      var rc = Math.round(cm % 100);
      return m + 'm ' + rc + 'cm';
    }
    return Math.round(cm) + ' cm';
  } else {
    if (in_ < 0.05)  return (in_ * 25.4).toFixed(1) + ' mm';
    if (in_ < 1)     return in_.toFixed(2) + '"';
    var total = Math.round(in_), ft = Math.floor(total/12), ins = total%12;
    if (ft === 0)    return ins + '"';
    return ft + "'" + ins + '"';
  }
}
function fW(lbs) {
  if (lbs === null || lbs === undefined) return '—';
  if (S.metric) {
    var kg = lbs * 0.453592;
    if (kg >= 1000000) return fmt(kg/1000000, 1, 'kt');
    if (kg >= 1000)    return fmt(kg/1000, 1, 't');
    if (kg >= 1)       return kg.toFixed(1) + ' kg';
    var g = kg * 1000;
    if (g >= 1)        return g.toFixed(1) + ' g';
    return (g * 1000).toFixed(2) + ' mg';
  } else {
    if (lbs >= 2000000000) return fmt(lbs/2000000, 0, 'kt');
    if (lbs >= 2000000)    return fmt(lbs/2000000, 1, 'kt');
    if (lbs >= 200000)     return fmt(lbs/2000, 1, 't');
    if (lbs >= 100000)     return fmt(lbs/2000, 1, 't');
    if (lbs >= 1)          return Math.round(lbs).toLocaleString() + ' lbs';
    var oz = lbs * 16;
    if (oz >= 1)           return oz.toFixed(1) + ' oz';
    return (oz * 437.5).toFixed(1) + ' gr';  // grains
  }
}
function fL(in_) {
  if (!in_ && in_ !== 0) return '—';
  if (S.metric) {
    var cm = inToCm(in_);
    if (cm < 0.1)  return (cm * 10).toFixed(1) + ' mm';
    if (cm < 1)    return cm.toFixed(1) + ' cm';
    if (cm >= 100) {
      var m = Math.floor(cm / 100);
      var rc = Math.round(cm % 100);
      return m + 'm ' + rc + 'cm';
    }
    return Math.round(cm) + ' cm';
  } else {
    if (in_ < 0.05) return (in_ * 25.4).toFixed(1) + ' mm';
    if (in_ < 1)    return in_.toFixed(2) + '"';
    var rounded = Math.round(in_);
    if (rounded >= 12) {
      var ft = Math.floor(rounded / 12);
      var ins = rounded % 12;
      return ft + "' " + ins + '"';
    }
    return rounded + '"';
  }
}

// ── Square-cube ───────────────────────────────────────────────
// Get a character's effective height — override takes precedence
function effectiveH(char) {
  var ov = S.heightOverrides[char.id];
  if (ov !== undefined) return ov;
  return char.height * (char.height_correction || 1);
}

function sc(hIn, buildId) {
  var b = S.builds.find(function(b){return b.id===buildId;});
  return (b && hIn) ? b.referenceWeight * Math.pow(hIn/72, 3) : null;
}

// ── Selects ───────────────────────────────────────────────────
function buildSelectOptions(sel, preserveValue) {
  var cur = preserveValue !== undefined ? preserveValue : sel.value;
  sel.innerHTML = '<option value="">-- Select --</option>';
  var cg = el('optgroup'); cg.label = 'Canon';
  S.chars.forEach(function(c) {
    var o = el('option'); o.value = 'canon_'+c.id; o.textContent = c.name; cg.appendChild(o);
  });
  sel.appendChild(cg);
  var customChars = (loadCustom().chars||[]).filter(function(c){return c&&c.name&&c.height;});
  if (customChars.length) {
    var custG = el('optgroup'); custG.label = 'Custom';
    customChars.forEach(function(c){
      var o=el('option'); o.value=c.id; o.textContent=c.name+' (custom)'; custG.appendChild(o);
    });
    sel.appendChild(custG);
  }
  if (cur) sel.value = cur;
}

function fillSelects() {
  allSlotSelects().forEach(function(sel) {
    if (sel.getAttribute('data-type') === 'char') {
      var cur = sel.value;
      buildSelectOptions(sel, cur);
      // If previously selected custom was cleared, cur is now invalid — reset
      if (cur && cur.startsWith('custom_') && !sel.value) {
        sel.value = '';
      }
      // Update picker button label
      var row = sel.closest('.sr-slot-row');
      var btn = row && row.querySelector('.slot-picker-btn');
      if (btn) {
        var opt = sel.options[sel.selectedIndex];
        btn.textContent = (opt && opt.value) ? opt.textContent : '— Select character —';
      }
    } else {
      // Object dropdown
      var cur = sel.value;
      sel.innerHTML = '<option value="">-- Select object --</option>';
      S.objects.forEach(function(o) {
        var opt = el('option'); opt.value = o.id; opt.textContent = o.label; sel.appendChild(opt);
      });
      if (cur) sel.value = cur;
    }
  });
}

function allSlotSelects() {
  return Array.from(document.querySelectorAll('.slot-select'));
}



// getChar replaced by allChars() + allSlotSelects()

function charFromValue(v) {
  if (!v) return null;
  if (v.startsWith('canon_')) {
    var id = parseInt(v.replace('canon_','')); return S.chars.find(function(c){return c.id===id;})||null;
  }
  if (v.startsWith('custom_')) {
    return getCustomChar(v);
  }
  return null;
}

function allChars() {
  return allSlotSelects().map(function(sel) {
    if (sel.getAttribute('data-type') === 'obj') return null;
    return charFromValue(sel.value);
  }).filter(Boolean);
}

// Returns [{char, slotIdx}] preserving slot position for per-slot overrides
function allCharSlots() {
  var result = [];
  allSlotSelects().forEach(function(sel, idx) {
    if (sel.getAttribute('data-type') === 'obj') return;
    var c = charFromValue(sel.value);
    if (c) result.push({char: c, slotIdx: idx});
  });
  return result;
}

function effectiveHSlot(char, slotIdx) {
  var key = charKeyForSlot(slotIdx);
  var ov = key ? S.heightOverrides[key] : S.heightOverrides[slotIdx];
  // An override is a TRUE (standing) height typed by the user. Apply the pose
  // correction the same way the canonical path does, so a posed character's
  // figure renders at the correct pose-adjusted size instead of full height.
  if (ov !== undefined) return ov * (char.height_correction || 1);
  return char.height * (char.height_correction || 1);
}

function allObjects() {
  return allSlotSelects().map(function(sel) {
    if (sel.getAttribute('data-type') !== 'obj') return null;
    var val = sel.value;
    return val ? S.objects.find(function(o){return o.id===val;}) : null;
  }).filter(Boolean);
}

// ── Render ────────────────────────────────────────────────────
function render() {
  // After screenshot/bot capture replaces the page with a single image, the
  // scene elements no longer exist — bail so deferred renders don't throw.
  if (window._screenshotDone) return;
  if (document.getElementById('sr-global-resize-popup')) return;
  if (renderInProgress) return; // prevent re-entrant render
  renderInProgress = true;
  var chars   = allChars();
  var scene   = document.getElementById('sr-scene');
  var empty   = document.getElementById('sr-empty');
  var figs    = document.getElementById('sr-figures');
  var stats   = document.getElementById('sr-stats');
  if (!figs || !stats) { renderInProgress = false; return; }

  // Sandbox positions are stored in sandboxPositions{} and applied after render
  figs.innerHTML = '';
  // Clear any sandbox-locked container box when not in sandbox so the normal
  // flex layout governs the scene again.
  if (!sandboxMode) { figs.style.height = ''; figs.style.width = ''; }
  stats.innerHTML = '';

  // Populate stats FIRST so their height is in the layout before we measure canvasH
  var charSlots = allCharSlots();
  if (charSlots.length || allObjects().length) {
    // Render stat blocks in true slot order (chars and objects interleaved)
    allSlotSelects().forEach(function(sel, idx) {
      var type = sel.getAttribute('data-type');
      var val  = sel.value;
      if (!val) return;
      if (type === 'obj') {
        var obj = S.objects.find(function(o){ return o.id === val; });
        if (obj) stats.appendChild(objStatBlock(obj, idx));
      } else {
        var c = charFromValue(val);
        if (c) stats.appendChild(statBlock(c, idx));
      }
    });
  }

  if (!chars.length && !allObjects().length) {
    scene.style.display = 'none'; empty.style.display = '';
    updateRuler();
    return;
  }
  scene.style.display = ''; empty.style.display = 'none';

  // Max DISPLAY height — includes headroom so ears/hair don't overflow at 100% zoom
  var maxH = 0;
  charSlots.forEach(function(cs) {
    var eff = effectiveHSlot(cs.char, cs.slotIdx);
    var disp = eff * (1 + ((cs.char.headroom_pct || 0) / 100));
    if (disp > maxH) maxH = disp;
  });
  allObjects().forEach(function(o) {
    if (o.height > maxH) maxH = o.height;
  });
  if (maxH < 1) maxH = 72;

  // Measure canvasH AFTER stats are in DOM so their height is already subtracted
  var areaEl = document.getElementById('sr-canvas-area');
  if (areaEl) {
    var freshH = areaEl.clientHeight;
    if (freshH > 100) S.canvasH = freshH - 4;
  }
  S.pxPerIn = (S.canvasH * S.zoomH) / maxH;


  // Render figures in slot order
  allSlotSelects().forEach(function(sel, idx) {
    var type = sel.getAttribute('data-type');
    var val  = sel.value; if (!val) return;
    if (type === 'obj') {
      var obj = S.objects.find(function(o){ return o.id === val; });
      if (obj) renderObj(figs, obj, idx);
    } else {
      var c = charFromValue(val);
      if (c) renderChar(figs, c, idx);
    }
  });

  // stat blocks already rendered at top of render() before canvasH measurement

  // Apply vertical scroll padding so user can scroll up to see character tops
  // Set sr-scene min-height to the zoomed character height so scroll container
  // has real layout height to scroll through — no overflow breakout
  var scene2 = document.getElementById('sr-scene');
  var scrollEl2 = document.getElementById('sr-scroll');
  if (scene2 && scrollEl2) {
    if (S.zoomH > 1) {
      var zoomed = Math.round(S.canvasH * S.zoomH);
      scene2.style.minHeight = zoomed + 'px';
      scrollEl2.style.overflowY = 'auto';
      // A flex container with align-items:flex-end CLIPS overflow above the top
      // and makes it unreachable by scroll. Switch the scroll box to top-aligned
      // flow when zoomed and pin the scene to the bottom via margin-top:auto, so
      // the overflowing tops of tall figures become scrollable instead of clipped.
      scrollEl2.style.alignItems = 'flex-start';
      scene2.style.marginTop = 'auto';
      // Restore the scroll position the user was at (centered fraction) across a
      // zoom change; only snap to the bottom on the very first zoom-in (no prior
      // fraction captured), so the ground is shown by default.
      var fracToRestore = _preserveHeightScrollFrac;
      requestAnimationFrame(function() {
        if (fracToRestore != null && scrollEl2.scrollHeight > scrollEl2.clientHeight) {
          var target = fracToRestore * scrollEl2.scrollHeight - scrollEl2.clientHeight / 2;
          scrollEl2.scrollTop = Math.max(0, Math.min(target, scrollEl2.scrollHeight - scrollEl2.clientHeight));
        } else {
          scrollEl2.scrollTop = scrollEl2.scrollHeight;
        }
      });
    } else {
      scene2.style.minHeight = '';
      scene2.style.marginTop = '';
      scrollEl2.style.alignItems = '';
      scrollEl2.style.overflowY = 'hidden';
    }
  }

  // Rebuild ruler (uses updated S.pxPerIn)
  updateRuler();
  updateHeightGrid();
  if (rulerActive) updateRulerSVG();

  document.getElementById('zoom-label').textContent = Math.round(S.zoomH*100)+'%';
  renderInProgress = false;
  // Re-apply sandbox positions after render. Hide the figures until they're
  // pinned so the user never sees them flash at their default flow positions
  // (the "bounce") or show alt text while images reload.
  if (sandboxMode) {
    var _figsEl = document.getElementById('sr-figures');
    if (_figsEl) _figsEl.style.visibility = 'hidden';
    applySandboxPositions();
  }
}

function renderChar(figs, char, slotIdx) {
  var effH = effectiveHSlot(char, slotIdx !== undefined ? slotIdx : -1);
  var pH   = Math.max(4, Math.round(effH * S.pxPerIn));
  // Add headroom for hair/ears/hats — extra px above skull, doesn't affect height scale
  var headroomPx = char.headroom_pct ? Math.round(pH * char.headroom_pct / 100) : 0;

  var iw = el('div'); iw.className = 'sr-img-wrap';
  iw.style.height = (pH + headroomPx) + 'px';
  iw.setAttribute('data-slot-idx', String(slotIdx !== undefined ? slotIdx : -1)); // layering/sandbox helper
  // Sandbox positions are keyed PER SLOT (slotIdx + '_' + value) so two slots
  // holding the SAME character stay independent — otherwise duplicates would
  // share a key, stack on the same spot, and the second would appear to vanish.
  (function(){
    var _sels = allSlotSelects();
    var _v = (slotIdx !== undefined && _sels[slotIdx]) ? _sels[slotIdx].value : '';
    var _key = _v ? (slotIdx + '_' + _v) : ('idx_' + (slotIdx !== undefined ? slotIdx : -1));
    iw.setAttribute('data-char-key', _key);
  })();
  iw.draggable = false;
  // Only constrain height — let width follow the image's natural aspect ratio
  var img = el('img');
  var defaultSil = (DEFAULTS.height[char.default_silhouette] || DEFAULTS.height.giantess || '../images/character-default.svg');
  var usingDefault = !char.image;
  img.crossOrigin = 'anonymous';   // allow alpha hit-testing without tainting canvas
  img.src = char.image || defaultSil;
  img.alt = char.name;
  // sr-img-real skips the brightening filter — only silhouettes need it
  img.className = 'sr-char-img' + (usingDefault ? '' : ' sr-img-real');
  img.draggable = false;
  // Apply flip + rotation — keyed by char value so state follows the character
  var _slotSels = allSlotSelects();
  var _ck = (slotIdx !== undefined && _slotSels[slotIdx] && _slotSels[slotIdx].value) ? (slotIdx+'_'+_slotSels[slotIdx].value) : ('slot_'+(slotIdx||0));
  var _flipped = S.charFlips && S.charFlips[_ck];
  var _rot = (S.charRotations && S.charRotations[_ck]) || 0;
  var _t = '';
  if (_flipped) _t += 'scaleX(-1) ';
  if (_rot) _t += 'rotate('+ (_flipped ? -_rot : _rot) +'deg)';
  if (_t) img.style.transform = _t.trim();
  iw.appendChild(img);
  figs.appendChild(iw);
}

// Draw image to canvas with flip/rotate for length view alignment
function orientedImgEl(src, flip, rotateDeg, filter) {
  var img = el('img');
  // Bake the rose-gold tint straight into a canvas when `filter` is set (even
  // with no flip/rotation), so the element holds real gold pixels — no CSS
  // filter for html2canvas to mishandle. sr-img-real => no extra CSS filter.
  var willBake = !!(flip || rotateDeg || filter);
  img.className = willBake ? 'sr-char-img sr-img-real' : 'sr-char-img sr-img-real';
  if (!flip && !rotateDeg && !filter) {
    img.className = 'sr-char-img sr-img-real';
    img.src = src;
    return img;
  }
  // Canvas pre-bake of transform (and gold filter, if requested).
  var loader = new Image();
  loader.crossOrigin = 'anonymous';
  loader.onload = function() {
    var w = loader.naturalWidth, h = loader.naturalHeight;
    var rad = rotateDeg ? rotateDeg * Math.PI / 180 : 0;
    var sin = Math.abs(Math.sin(rad)), cos = Math.abs(Math.cos(rad));
    var cw = Math.ceil(w * cos + h * sin) || w;
    var ch = Math.ceil(w * sin + h * cos) || h;
    var c = el('canvas'); c.width = cw; c.height = ch;
    var ctx = c.getContext('2d');
    if (filter) { try { ctx.filter = ROSE_GOLD_FILTER; } catch(e) {} }
    ctx.translate(cw/2, ch/2);
    if (flip) ctx.scale(-1, 1);
    if (rotateDeg) ctx.rotate(rad);
    ctx.drawImage(loader, -w/2, -h/2);
    try { img.src = c.toDataURL('image/png'); }
    catch(e) {
      // Canvas tainted (CORS) — fall back to the original src + CSS filter so it
      // at least shows gold on screen.
      img.src = src;
      img.className = filter ? 'sr-char-img' : 'sr-char-img sr-img-real';
      if (flip || rotateDeg) {
        var t=''; if(flip)t+='scaleX(-1) '; if(rotateDeg)t+='rotate('+(flip?-rotateDeg:rotateDeg)+'deg)';
        img.style.transform = t.trim();
      }
    }
  };
  loader.onerror = function() {
    // Couldn't load for baking (network/CORS) — show the raw image with the CSS
    // filter so it at least appears gold on screen.
    img.src = src;
    img.className = filter ? 'sr-char-img' : 'sr-char-img sr-img-real';
    if (flip || rotateDeg) {
      var t=''; if(flip)t+='scaleX(-1) '; if(rotateDeg)t+='rotate('+(flip?-rotateDeg:rotateDeg)+'deg)';
      img.style.transform = t.trim();
    }
  };
  loader.src = src;
  return img;
}

function renderObj(figs, obj, slotIdx) {
  var pH = Math.max(4, Math.round(obj.height * S.pxPerIn));
  var iw = el('div'); iw.className = 'sr-img-wrap';
  iw.style.height = pH + 'px';
  iw.setAttribute('data-slot-idx', String(slotIdx !== undefined ? slotIdx : -1));
  // Key sandbox position PER SLOT (slotIdx + '_' + value) so duplicate objects
  // in different slots stay independent (don't stack on one spot).
  (function(){
    var _sels = allSlotSelects();
    var _v = (slotIdx !== undefined && _sels[slotIdx]) ? _sels[slotIdx].value : '';
    var _key = _v ? (slotIdx + '_' + _v) : ('idx_' + (slotIdx !== undefined ? slotIdx : -1));
    iw.setAttribute('data-char-key', _key);
  })();
  iw.draggable = false;

  if (obj.image) {
    // Resolve flip/rotation state for this slot.
    var _objFlipped = false, _objRot = 0;
    if (slotIdx !== undefined) {
      var _objSels2 = allSlotSelects();
      var _objCk = _objSels2[slotIdx] && _objSels2[slotIdx].value ? (slotIdx+'_'+_objSels2[slotIdx].value) : '';
      _objFlipped = !!(_objCk && S.charFlips && S.charFlips[_objCk]);
      _objRot = (_objCk && S.charRotations && S.charRotations[_objCk]) || 0;
    }
    // Bake the rose-gold tint (and flip/rotation) straight into a canvas, so the
    // element holds real gold pixels — no CSS filter to break in html2canvas
    // exports (this is what made the length view copy correctly). orientedImgEl
    // returns sr-img-real (unfiltered) when it bakes; if it can't (taint), it
    // falls back to the CSS-filter path.
    var img = orientedImgEl(obj.image, _objFlipped, _objRot, true);
    img.alt = obj.label;
    img.draggable = false;
    iw.appendChild(img);
  } else {
    // Fallback: colored bar — apply flip/rotate to the wrap itself
    var shape = el('div'); shape.className = 'sr-obj-shape';
    shape.style.height = '100%'; shape.style.width = '44px';
    shape.style.background = obj.color || '#888';
    iw.style.width = '44px';
    if (slotIdx !== undefined) {
      var _shapeSels = allSlotSelects();
      var _shapeCk = _shapeSels[slotIdx] && _shapeSels[slotIdx].value ? (slotIdx+'_'+_shapeSels[slotIdx].value) : '';
      var _shapeFlipped = _shapeCk && S.charFlips && S.charFlips[_shapeCk];
      var _shapeRot = (_shapeCk && S.charRotations && S.charRotations[_shapeCk]) || 0;
      var _shapeT = '';
      if (_shapeFlipped) _shapeT += 'scaleX(-1) ';
      if (_shapeRot) _shapeT += 'rotate('+(_shapeFlipped ? -_shapeRot : _shapeRot)+'deg)';
      if (_shapeT) shape.style.transform = _shapeT.trim();
    }
    iw.appendChild(shape);
  }
  figs.appendChild(iw);
}

function silhouette(h, w) {
  var cx=Math.round(w/2),hR=Math.round(h*.10),bT=Math.round(h*.22),bH=Math.round(h*.35),bW=Math.round(w*.55);
  return '<svg width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'" xmlns="http://www.w3.org/2000/svg">'+
    '<circle cx="'+cx+'" cy="'+hR+'" r="'+hR+'" fill="var(--accent)" opacity=".7"/>'+
    '<rect x="'+(cx-Math.round(bW/2))+'" y="'+bT+'" width="'+bW+'" height="'+bH+'" rx="3" fill="var(--accent)" opacity=".7"/>'+
    '<rect x="'+(cx-Math.round(bW/2)-Math.round(w*.09))+'" y="'+(bT+4)+'" width="'+Math.round(w*.1)+'" height="'+Math.round(bH*.75)+'" rx="2" fill="var(--accent)" opacity=".6"/>'+
    '<rect x="'+(cx+Math.round(bW/2)-Math.round(w*.01))+'" y="'+(bT+4)+'" width="'+Math.round(w*.1)+'" height="'+Math.round(bH*.75)+'" rx="2" fill="var(--accent)" opacity=".6"/>'+
    '<rect x="'+(cx-Math.round(bW*.4))+'" y="'+(bT+bH)+'" width="'+Math.round(bW*.35)+'" height="'+Math.round(h*.33)+'" rx="2" fill="var(--accent)" opacity=".7"/>'+
    '<rect x="'+(cx+Math.round(bW*.05))+'" y="'+(bT+bH)+'" width="'+Math.round(bW*.35)+'" height="'+Math.round(h*.33)+'" rx="2" fill="var(--accent)" opacity=".7"/>'+
  '</svg>';
}

// ── Zoom ──────────────────────────────────────────────────────
// Zoom is baked into pxPerIn at render time — no CSS transform needed.
// Re-rendering at a larger pxPerIn naturally scales all images correctly.
function applyZoom() {
  document.getElementById('zoom-label').textContent = Math.round(S.zoomH*100)+'%';
  // Preserve the viewer's scroll position across the zoom (keep the same content
  // centered) instead of snapping to the bottom on every re-render.
  var scrollEl = document.getElementById('sr-scroll');
  var frac = 0.5;
  if (scrollEl && scrollEl.scrollHeight > scrollEl.clientHeight) {
    frac = (scrollEl.scrollTop + scrollEl.clientHeight / 2) / scrollEl.scrollHeight;
  }
  _preserveHeightScrollFrac = frac;
  render();  // re-render with new pxPerIn = canvasH * zoomH / maxH
  _preserveHeightScrollFrac = null;
}
var _preserveHeightScrollFrac = null;

// ── Ruler ─────────────────────────────────────────────────────
// Ruler is OUTSIDE zoom — tick positions calculated with zoom factor applied
function niceInterval(minPx, pxPerUnit) {
  var steps = [1,2,5,10,20,25,50,100,250,500,1000];
  for (var i=0; i<steps.length; i++) {
    if (pxPerUnit * steps[i] >= minPx) return steps[i];
  }
  return steps[steps.length-1];
}

function updateRuler() {
  var col   = document.getElementById('sr-ruler-col');
  var inner = document.getElementById('sr-ruler-inner');
  if (!inner || !col) return;
  inner.innerHTML = '';
  if (S.pxPerIn <= 0) return;

  var areaEl = document.getElementById('sr-canvas-area');
  var viewH = areaEl ? areaEl.clientHeight - 4 : col.offsetHeight;
  if (viewH < 10) return;

  // When zoomed in the scene scrolls; build ticks up to the FULL scrollable
  // height (not just the visible viewport) so the ruler can scroll along with
  // the figures and stay aligned with the grid. The ruler inner is offset by the
  // scroll position in syncRulerScroll().
  var scrollEl = document.getElementById('sr-scroll');
  var fullH = viewH;
  if (S.zoomH > 1) fullH = Math.max(viewH, Math.round(S.canvasH * S.zoomH));
  // In sandbox mode the figures container is sized by pin() (it may be taller
  // than canvasH*zoomH to fit a tall figure's top). The ruler must match THAT
  // height so its ticks line up with the figures and stay aligned while
  // scrolling — otherwise the scale "breaks" on scroll.
  if (sandboxMode) {
    var figsEl = document.getElementById('sr-figures');
    var figsH = figsEl ? (parseFloat(figsEl.style.height) || figsEl.getBoundingClientRect().height) : 0;
    if (figsH > fullH) fullH = Math.round(figsH);
  }
  inner.style.height = fullH + 'px';

  var effPx = S.pxPerIn; // zoom baked in

  if (S.metric) {
    var pxPerCm = effPx / 2.54;
    var step = niceInterval(48, pxPerCm);
    var maxCm = Math.ceil(fullH / pxPerCm) + step;
    for (var cm = 0; cm <= maxCm; cm += step) {
      var px = Math.round(cm * pxPerCm);
      if (px > fullH + 2) break;
      var tick = el('div'); tick.className = 'sr-ruler-tick';
      tick.style.bottom = px + 'px';
      tick.setAttribute('data-label', cm >= 100 ? (cm/100).toFixed(cm%100===0?0:1)+'m' : cm+'cm');
      inner.appendChild(tick);
    }
  } else {
    var pxPerFt = effPx * 12;
    var step = niceInterval(48, pxPerFt);
    var maxFt = Math.ceil(fullH / pxPerFt) + step;
    for (var f = 0; f <= maxFt; f += step) {
      var px = Math.round(f * pxPerFt);
      if (px > fullH + 2) break;
      var tick = el('div'); tick.className = 'sr-ruler-tick';
      tick.style.bottom = px + 'px';
      tick.setAttribute('data-label', f+"'");
      inner.appendChild(tick);
    }
  }
  syncRulerScroll();
}

// Offset the ruler's ticks to match the scene's scroll position, so when the
// user scrolls up to see tall figures the ruler scrolls with them (and with the
// grid, which also scrolls with the content). The ruler inner is bottom-anchored,
// so scrolling up (positive distance from bottom) shifts ticks DOWN by that much.
function syncRulerScroll() {
  var scrollEl = document.getElementById('sr-scroll');
  var inner = document.getElementById('sr-ruler-inner');
  if (!scrollEl || !inner) return;
  var fromBottom = scrollEl.scrollHeight - scrollEl.clientHeight - scrollEl.scrollTop;
  // translateY positive = move down; at the bottom (fromBottom=0) no shift.
  inner.style.transform = 'translateY(' + Math.round(fromBottom) + 'px)';
}

// ── Stat block ────────────────────────────────────────────────

function charKeyForSlot(slotIdx) {
  // Key includes slot index so same character in two slots are independent
  var sels = allSlotSelects();
  var sel = sels[slotIdx];
  return sel && sel.value ? (slotIdx + '_' + sel.value) : '';
}

function applyCharTransform(slotIdx) {
  var figs = document.getElementById('sr-figures');
  if (!figs) return;
  var wraps = figs.querySelectorAll('.sr-img-wrap');
  var wrap = wraps[slotIdx] || null;
  if (!wrap) return;
  var img = wrap.querySelector('img');
  if (!img) return;
  var key = charKeyForSlot(slotIdx);
  var flipped = key && S.charFlips && S.charFlips[key];
  var rot = (key && S.charRotations && S.charRotations[key]) || 0;
  var t = '';
  if (flipped) t += 'scaleX(-1) ';
  if (rot) t += 'rotate('+(flipped ? -rot : rot)+'deg)';
  img.style.transform = t.trim() || '';
}

function wireFlipRotate(block, slotIdx) {
  var flipBtn = block.querySelector('.sr-flip-btn');
  if (flipBtn) {
    flipBtn.addEventListener('click', function() {
      var s = parseInt(this.getAttribute('data-slot'));
      var key = charKeyForSlot(s);
      if (!key) return;
      if (!S.charFlips) S.charFlips = {};
      S.charFlips[key] = !S.charFlips[key];
      this.classList.toggle('active', S.charFlips[key]);
      applyCharTransform(s);
    });
  }
  block.querySelectorAll('.sr-rot-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var s = parseInt(this.getAttribute('data-slot'));
      var dir = parseInt(this.getAttribute('data-dir'));
      var key = charKeyForSlot(s);
      if (!key) return;
      if (!S.charRotations) S.charRotations = {};
      S.charRotations[key] = ((S.charRotations[key] || 0) + dir * 15 + 360) % 360;
      applyCharTransform(s);
    });
  });
  var resetBtn = block.querySelector('.sr-full-reset-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', function() {
      var s = parseInt(this.getAttribute('data-slot') || this.getAttribute('data-slotidx'));
      var key = charKeyForSlot(s);
      if (key) delete S.heightOverrides[key];
      delete S.heightOverrides[s];
      if (key) {
        if (S.charFlips) S.charFlips[key] = false;
        if (S.charRotations) S.charRotations[key] = 0;
      }
      applyCharTransform(s);
      if (sandboxMode) {
        setTimeout(function() {
          var _statsEl = document.getElementById('sr-stats');
          if (!_statsEl) return;
          _statsEl.innerHTML = '';
          allSlotSelects().forEach(function(sel, idx) {
            var type = sel.getAttribute('data-type');
            var val  = sel.value;
            if (!val) return;
            if (type === 'obj') {
              var obj = S.objects.find(function(o){ return o.id === val; });
              if (obj) _statsEl.appendChild(objStatBlock(obj, idx));
            } else {
              var c = charFromValue(val);
              if (c) _statsEl.appendChild(statBlock(c, idx));
            }
          });
        }, 0);
      } else {
        render();
      }
    });
  }
}

function objStatBlock(obj, slotIdx) {
  var block = el('div'); block.className = 'sr-stat-block';
  var _objSels = allSlotSelects();
  var _objKey = _objSels[slotIdx] && _objSels[slotIdx].value ? (slotIdx+'_'+_objSels[slotIdx].value) : ('slot_'+slotIdx);
  var isFlipped = S.charFlips && S.charFlips[_objKey];
  block.innerHTML =
    (allSlotSelects().filter(function(s){return s.value;}).length > 1
      ? '<button class="sr-stat-remove" data-slot="'+slotIdx+'" title="Remove from scene" aria-label="Remove from scene">&#10005;</button>'
      : '')+
    '<div class="sr-stat-name">'+obj.label+'</div>'+
    '<div class="sr-stat-pose-note sr-stat-pose-spacer">&nbsp;</div>'+
    '<div class="sr-stat-grid">'+
      '<div class="sr-stat-row"><span class="sr-stat-key">Height</span><span class="sr-stat-val">'+fH(obj.height)+'</span></div>'+
      '<div class="sr-stat-row sr-stat-row-spacer"><span class="sr-stat-key">Weight</span><span class="sr-stat-val">—</span></div>'+  
    '</div>'+
    '<div class="sr-stat-resize-wrap"><div class="sr-resize-row">'+
      '<button class="unit-btn sr-flip-btn'+(isFlipped?' active':'')+'" data-slot="'+slotIdx+'" title="Flip image">&#8644; Flip</button>'+
      '<button class="unit-btn sr-rot-btn" data-slot="'+slotIdx+'" data-dir="-1" title="Rotate left">&#8634;</button>'+
      '<button class="unit-btn sr-rot-btn" data-slot="'+slotIdx+'" data-dir="1" title="Rotate right">&#8635;</button>'+
      '<button class="unit-btn sr-full-reset-btn" data-slot="'+slotIdx+'" data-type="obj">Reset</button>'+
    '</div></div>';

  var rmBtnO = block.querySelector('.sr-stat-remove');
  if (rmBtnO) rmBtnO.addEventListener('click', function() {
    removeCharBySlotIndex(parseInt(this.getAttribute('data-slot'), 10));
  });

  wireFlipRotate(block, slotIdx);
  return block;
}

function scaledWeight(char, slotIdx) {
  var canonH = char.height * (char.height_correction || 1);
  var effH   = effectiveHSlot(char, slotIdx);
  var canonW = char.weight || sc(canonH, 'average');
  if (effH === canonH) return canonW;
  return canonW * Math.pow(effH / canonH, 3);
}

function scaledLength(char, slotIdx) {
  if (!char.length) return null;
  var canonH = char.height * (char.height_correction || 1);
  var effH   = effectiveHSlot(char, slotIdx);
  var canonL = char.length * (char.length_correction || 1);
  if (effH === canonH) return canonL;
  return canonL * (effH / canonH);
}

function resizeControlsFlipHTML(char, slotIdx, isFlipped) {
  var base = resizeControlsHTML(char, slotIdx);
  // Inject flip button into the sr-resize-row (or create one for custom chars)
  var rotKey = 'rot_'+slotIdx;
  var curRot = (S.charRotations && S.charRotations[rotKey]) || 0;
  var rotBtns =
    '<button class="unit-btn sr-rot-btn" data-slot="'+slotIdx+'" data-dir="-1" title="Rotate left">&#8634;</button>'+
    '<button class="unit-btn sr-rot-btn" data-slot="'+slotIdx+'" data-dir="1" title="Rotate right">&#8635;</button>';
  var flipBtn = '<button class="unit-btn sr-flip-btn'+(isFlipped?' active':'')+
    '" data-slot="'+slotIdx+'" title="Flip image">&#8644; Flip</button>';
  var resetBtn = '<button class="unit-btn sr-full-reset-btn" data-slot="'+slotIdx+'" data-slotidx="'+slotIdx+'">Reset</button>';
  var btns = flipBtn + rotBtns + resetBtn;
  if (base) {
    // Replace the existing Reset button (sv-resize-reset) with our unified one, add flip/rot before it
    return base.replace('<button class="unit-btn sr-full-reset-btn"', flipBtn + rotBtns + '<button class="unit-btn sr-full-reset-btn"').replace('</div>', '</div>');
  } else {
    return '<div class="sr-resize-row">'+btns+'</div>';
  }
}

function resizeControlsHTML(char, slotIdx) {
  if (char.custom) return '';
  var _rKey = charKeyForSlot(slotIdx);
  var ovH = _rKey ? S.heightOverrides[_rKey] : S.heightOverrides[slotIdx];
  var isOv = ovH !== undefined;
  // The resize popup edits TRUE (standing) height: the override value if set,
  // otherwise the character's canonical height. Not the pose-corrected render
  // height (effectiveHSlot), so the input prepopulates with a natural number.
  var trueH = isOv ? ovH : char.height;
  var curFt = Math.floor(trueH / 12);
  var curIn = Math.round(trueH % 12);
  var curCm = Math.round(trueH * 2.54);
  // Popup is built on document.body by the click handler to avoid fixed-position clipping
  // Data attributes carry the values to the handler
  return (
    '<div class="sr-resize-row">' +
      '<button class="unit-btn sr-resize-open-btn"' +
        ' data-slotidx="' + slotIdx + '"' +
        ' data-char-name="' + char.name + '"' +
        ' data-cur-ft="' + curFt + '"' +
        ' data-cur-in="' + curIn + '"' +
        ' data-cur-cm="' + curCm + '">' +
        'Resize' +
      '</button>' +
      '<button class="unit-btn sr-full-reset-btn" data-slotidx="' + slotIdx + '" data-slot="' + slotIdx + '">Reset</button>' +
    '</div>'
  );
}

function closeResizePopup() {
  var p = document.getElementById('sr-global-resize-popup');
  if (p) p.remove();
  var bd = document.getElementById('sr-resize-backdrop');
  if (bd) bd.classList.remove('open');
}

function wireResizeControls(block) {
  block.addEventListener('click', function(e) {
    var btn = e.target.closest('button');
    if (!btn) return;

    if (btn.classList.contains('sr-resize-open-btn')) {
      var idx   = btn.getAttribute('data-slotidx');
      var name  = btn.getAttribute('data-char-name') || '';
      var curFt2 = btn.getAttribute('data-cur-ft') || '';
      var curIn2 = btn.getAttribute('data-cur-in') || '';
      var curCm2 = btn.getAttribute('data-cur-cm') || '';
      // Split current cm into metres + remaining cm for the metric inputs
      var curCmTotal = parseFloat(curCm2) || 0;
      var curM2  = Math.floor(curCmTotal / 100);
      var curRc2 = Math.round(curCmTotal % 100);

      // Close any existing popup
      var oldPop = document.getElementById('sr-global-resize-popup');
      if (oldPop) oldPop.remove();

      // Build popup on body so fixed positioning always works
      var popup = document.createElement('div');
      popup.id = 'sr-global-resize-popup';
      popup.className = 'sr-resize-popup open';
      popup.innerHTML =
        '<div class="sr-resize-popup-header">' +
          '<span class="sr-resize-popup-title">Resize ' + name + '</span>' +
          '<button class="char-modal-close sr-resize-close">&#10005;</button>' +
        '</div>' +
        '<div class="sr-resize-popup-inputs">' +
          (S.metric
            ? '<input class="sr-resize-m builder-input numInput" type="number" min="0" max="9999" placeholder="m" value="' + curM2 + '" /><span class="sv-resize-unit">m</span>' +
              '<input class="sr-resize-cm builder-input numInput" type="number" min="0" max="99" placeholder="cm" value="' + curRc2 + '" /><span class="sv-resize-unit">cm</span>'
            : '<input class="sr-resize-ft builder-input numInput" type="number" min="0" max="9999" placeholder="ft" value="' + curFt2 + '" /><span class="sv-resize-unit">ft</span>' +
              '<input class="sr-resize-in builder-input numInput" type="number" min="0" max="11" placeholder="in" value="' + curIn2 + '" /><span class="sv-resize-unit">in</span>'
          ) +
          '<button class="unit-btn sv-resize-set" data-slotidx="' + idx + '">Set</button>' +
        '</div>';
      document.body.appendChild(popup);

      // Wire close and set on the new popup
      popup.querySelector('.sr-resize-close').addEventListener('click', closeResizePopup);
      popup.querySelector('.sv-resize-set').addEventListener('click', function() {
        var idx2 = parseInt(this.getAttribute('data-slotidx'));
        var inches;
        if (S.metric) {
          var m  = parseFloat(popup.querySelector('.sr-resize-m').value)  || 0;
          var cm = parseFloat(popup.querySelector('.sr-resize-cm').value) || 0;
          var totalCm = m * 100 + cm;
          if (totalCm <= 0) return;
          inches = totalCm / 2.54;
        } else {
          var ft  = parseFloat(popup.querySelector('.sr-resize-ft').value) || 0;
          var ins = parseFloat(popup.querySelector('.sr-resize-in').value) || 0;
          inches = ft * 12 + ins;
          if (inches <= 0) return;
        }
        var _k1 = charKeyForSlot(idx2); if(_k1) S.heightOverrides[_k1] = inches; else S.heightOverrides[idx2] = inches;
        closeResizePopup();
        renderActive();
        if (S.view !== 'stats') renderStatsView();
      });

      var bd = document.getElementById('sr-resize-backdrop');
      if (bd) bd.classList.add('open');
      return;
    }

    if (btn.classList.contains('sv-resize-set')) {
      var idx2 = parseInt(btn.getAttribute('data-slotidx'));
      var popup2 = block.querySelector('#sr-resize-popup-' + idx2) ||
                   document.getElementById('sr-resize-popup-' + idx2);
      var inches;
      if (S.metric) {
        var mEl  = popup2 && popup2.querySelector('.sr-resize-m');
        var cmEl = popup2 && popup2.querySelector('.sr-resize-cm');
        var m  = mEl  ? (parseFloat(mEl.value)  || 0) : 0;
        var cm = cmEl ? (parseFloat(cmEl.value) || 0) : 0;
        var totalCm = m * 100 + cm;
        if (totalCm <= 0) return;
        inches = totalCm / 2.54;
      } else {
        var ftEl = popup2 && popup2.querySelector('.sr-resize-ft');
        var inEl = popup2 && popup2.querySelector('.sr-resize-in');
        var ft  = ftEl ? (parseFloat(ftEl.value) || 0) : 0;
        var ins = inEl ? (parseFloat(inEl.value) || 0) : 0;
        inches = ft * 12 + ins;
        if (inches <= 0) return;
      }
      var _k2 = charKeyForSlot(idx2); if(_k2) S.heightOverrides[_k2] = inches; else S.heightOverrides[idx2] = inches;
      closeResizePopup();
      renderActive();
      if (S.view !== 'stats') renderStatsView();
      return;
    }

    if (btn.classList.contains('sr-resize-close')) { closeResizePopup(); return; }

    if (btn.classList.contains('sv-resize-reset') || btn.classList.contains('sr-full-reset-btn')) {
      var idx3 = parseInt(btn.getAttribute('data-slotidx'));
      var _k3 = charKeyForSlot(idx3); if(_k3) delete S.heightOverrides[_k3]; delete S.heightOverrides[idx3];
      closeResizePopup();
      renderActive();
      if (S.view !== 'stats') renderStatsView();
    }
  });
}

function statBlock(char, slotIdx) {
  var block = el('div'); block.className = 'sr-stat-block';

  var effH_in = effectiveHSlot(char, slotIdx);
  var _ovKey = charKeyForSlot(slotIdx);
  var _ovVal = _ovKey ? S.heightOverrides[_ovKey] : S.heightOverrides[slotIdx];
  var isOv = _ovVal !== undefined;
  // Displayed "Height" is the TRUE (standing) height: the raw override value if
  // set, else canonical. effH_in is the pose-corrected RENDER height, shown
  // separately in the "renders as ..." note below.
  var trueH = isOv ? _ovVal : char.height;
  var isPosed = char.height_correction && char.height_correction < 0.99;
  var poseNote = isPosed
    ? '<div class="sr-stat-pose-note">renders as '+fH(effH_in)+' (posed)</div>'
    : '<div class="sr-stat-pose-note sr-stat-pose-spacer">&nbsp;</div>';

  // Flip state - use same slot-prefixed key as charKeyForSlot
  var sels = allSlotSelects();
  var charKey = sels[slotIdx] && sels[slotIdx].value ? (slotIdx+'_'+sels[slotIdx].value) : ('slot_'+slotIdx);
  var isFlipped = S.charFlips && S.charFlips[charKey];

  block.innerHTML =
    (allSlotSelects().filter(function(s){return s.value;}).length > 1
      ? '<button class="sr-stat-remove" data-slot="'+slotIdx+'" title="Remove from scene" aria-label="Remove from scene">&#10005;</button>'
      : '')+
    '<div class="sr-stat-name">'+char.name+
      (char.canonical?' <span class="sr-stat-canon">&#10022;</span>':'')+
      (isOv?' <span class="sr-override-badge">&#x21D4;</span>':'')+
    '</div>'+
    poseNote+
    '<div class="sr-stat-grid">'+
      '<div class="sr-stat-row"><span class="sr-stat-key">Height</span><span class="sr-stat-val">'+fH(trueH)+'</span></div>'+
      '<div class="sr-stat-row"><span class="sr-stat-key">Weight</span><span class="sr-stat-val">'+fW(scaledWeight(char, slotIdx))+'</span></div>'+
    '</div>'+
    '<div class="sr-stat-resize-wrap">'+resizeControlsFlipHTML(char, slotIdx, isFlipped)+'</div>'+
    (char.wiki?'<a href="../wiki/?character='+char.name.toLowerCase()+'" class="sr-wiki-link">View wiki &rarr;</a>':'<div class="sr-wiki-spacer"></div>');

  var rmBtn = block.querySelector('.sr-stat-remove');
  if (rmBtn) rmBtn.addEventListener('click', function() {
    removeCharBySlotIndex(parseInt(this.getAttribute('data-slot'), 10));
  });

  wireResizeControls(block);

  wireFlipRotate(block, slotIdx);

  return block;
}


// ── Stats view ─────────────────────────────────────────────────
var REF_H_IN   = 72;   // reference height: 6ft
var REF_W_LB   = 170;  // reference weight: 170lbs
var REF_STD_H  = 72;   // standard person height for perspective section
var REF_ARM_IN = 24;   // intimate viewing distance (arm's length in inches)

// Bust size reference volumes at 5'6" (66in) in litres per breast.
// `cmp` is an everyday-object comparison shown in the picker so people who
// don't know cup sizes can pick by something they can actually picture.
var BUST_REFS = [
  {id:'flat',  label:'Flat',       volL:0.01, cmp:'flat'},
  {id:'a',     label:'A Cup',      volL:0.18, cmp:'a lemon'},
  {id:'b',     label:'B Cup',      volL:0.27, cmp:'an orange'},
  {id:'c',     label:'C Cup',      volL:0.42, cmp:'a grapefruit'},
  {id:'d',     label:'D Cup',      volL:0.60, cmp:'a coconut'},
  {id:'dd',    label:'DD / E Cup', volL:0.85, cmp:'a cantaloupe'},
  {id:'f',     label:'F Cup',      volL:1.20, cmp:'a honeydew melon'},
  {id:'g',     label:'G Cup',      volL:1.65, cmp:'a pineapple'},
  {id:'h',     label:'H Cup',      volL:2.30, cmp:'a soccer ball'},
  {id:'j',     label:'J Cup',      volL:3.20, cmp:'a basketball'},
  {id:'k',     label:'K Cup',      volL:4.40, cmp:'a watermelon'},
  {id:'l',     label:'L Cup',      volL:6.00, cmp:'a pumpkin'},
  {id:'m',     label:'M Cup',      volL:8.00, cmp:'a beach ball'},
  {id:'n',     label:'N Cup',      volL:11.0, cmp:'a microwave'},
  {id:'p',     label:'P Cup',      volL:15.0, cmp:'a water cooler jug'},
  {id:'r',     label:'R Cup',      volL:21.0, cmp:'a beer keg'},
  {id:'t',     label:'T Cup',      volL:30.0, cmp:'a kitchen trash can'},
  {id:'v',     label:'V Cup',      volL:45.0, cmp:'a mini-fridge'},
  {id:'z',     label:'Z Cup',      volL:70.0, cmp:'a dishwasher'},
  // Beyond standard lettering — named "extreme" tiers for the setting.
  {id:'titan', label:'Titanic',    volL:120,  cmp:'a washing machine'},
  {id:'colossal', label:'Colossal', volL:220, cmp:'an oil drum'},
  {id:'monstrous', label:'Monstrous', volL:400, cmp:'a chest freezer'},
  {id:'ruinous', label:'Ruinous',  volL:750,  cmp:'a refrigerator'},
  {id:'apocalyptic', label:'Apocalyptic', volL:1400, cmp:'a hot tub'},
];

function calcBreasts(char, slotIdx) {
  var h = trueH(char, slotIdx);
  var hR = h / 66; // scale relative to 5'6" reference
  var bustId = (char.anatomy && char.anatomy.bustSize) || 'c';
  var ref = BUST_REFS.find(function(b){ return b.id === bustId; }) || BUST_REFS[3];
  // Volume scales with hR^3 (linear dimensions scale with hR)
  var volL     = ref.volL * Math.pow(hR, 3);
  // Weight: breast tissue density ~0.9 kg/L, convert to lbs
  var weightLbs = volL * 0.9 * 2.20462;
  // Projection and width scale linearly with hR
  // Projection and width scale linearly with hR. One entry per BUST_REFS row,
  // continuing the growth through the extreme tiers so large busts get
  // proportionate projection/width rather than the small-cup fallback.
  var REF_PROJ = [0.5, 1.8, 2.3, 2.9, 3.5, 4.2, 5.0, 5.8, 6.8, 8.0,
                  9.2, 10.6, 12.2, 14.0, 16.2, 18.8, 21.6, 25.0, 29.0,
                  34, 42, 54, 70, 92];
  var REF_WID  = [1.5, 3.5, 4.2, 5.0, 5.8, 6.5, 7.2, 8.0, 9.0, 10.0,
                  11.4, 13.0, 14.8, 16.8, 19.2, 22.0, 25.0, 28.5, 32.5,
                  38, 47, 60, 78, 102];
  var idx = BUST_REFS.indexOf(ref);
  var projIn   = (REF_PROJ[idx] || 3.5) * hR;
  var widIn    = (REF_WID[idx]  || 5.0) * hR;
  var nipDiamIn = 0.6 * hR;
  var nipLenIn  = 0.4 * hR;
  // Milk production: ref ~30 mL/hr at C cup, scales with cup volume and mass
  var milkLperDay = (ref.volL / 0.42) * 0.72 * Math.pow(hR, 3);  // ~720mL/day ref, cube-scaled
  return { cupLabel: ref.label, volL: volL, weightLbs: weightLbs,
           projIn: projIn, widIn: widIn, nipDiamIn: nipDiamIn, nipLenIn: nipLenIn,
           milkLperDay: milkLperDay };
}

function trueH(char, slotIdx) {
  // Use resize override if set, otherwise true canonical height (no pose correction)
  if (slotIdx !== undefined) {
    var _ehKey = charKeyForSlot(slotIdx);
    var _ehOv = _ehKey ? S.heightOverrides[_ehKey] : S.heightOverrides[slotIdx];
    if (_ehOv !== undefined) return _ehOv;
  }
  return char.height || effectiveH(char);
}

function calcStats(char, slotIdx) {
  var h  = trueH(char, slotIdx);
  var w  = (slotIdx !== undefined) ? scaledWeight(char, slotIdx) : (char.weight || sc(h, 'average'));
  var wkg = w * 0.453592;
  var mR = w / REF_W_LB;
  var hR = h / REF_H_IN;
  return {
    // Scale
    heightTimes:    hR,
    weightTimes:    mR,
    skinM2:         1.9 * Math.pow(mR, 0.67),
    // Daily needs
    caloriesDay:    Math.round(2000 * Math.pow(mR, 0.75)),
    waterL:         2.5  * Math.pow(mR, 0.75),
    urineL:         1.5  * Math.pow(mR, 0.75),
    stomachL:       1.5  * mR,
    // Body
    caloriesStored: Math.round(90000 * mR),
    lungL:          6    * mR,
    exhaleL:        0.5  * mR,   // tidal volume (normal exhale) ~500mL
    bloodL:         wkg  * 0.0755,
    heartBpm:       Math.round(70 * Math.pow(mR, -0.25)),
    heartDay:       Math.round(70 * Math.pow(mR, -0.25) * 1440),
    bodyHeatW:      Math.round(2000 * Math.pow(mR, 0.75) * 4184 / 86400),
    // Movement
    strideIn:       Math.round(30 * hR),
    speedMph:       12 * Math.pow(hR, 0.5),
    gripLbs:        Math.round(110 * Math.pow(mR, 0.67)),
    stompPsi:       (w * 1.5) / (8 * hR * hR),
    // Kink
    ejacMl:         3.7 * Math.pow(mR, 1.5),
    preMl:          0.5 * Math.pow(mR, 1.5),   // pre, Sinverse scaled
    liftLbs:        Math.round(w * 1.5 * Math.pow(mR, -0.33)),
    crushLbs:       Math.round(1000 * mR),   // sustained weight before structural failure ~1000lb ref
    footLenIn:      10.5 * hR,
    footWidIn:       3.5 * hR,
    handLenIn:       7.6 * hR,
    handWidIn:       3.4 * hR,
    penisWidIn:      (scaledLength(char, slotIdx) || 0) * 0.266,   // diameter = girth/π, scaled from actual length
    // Tongue
    tongueLenIn:     3.3 * hR,
    tongueWidIn:     1.9 * hR,
    spitMl:         20   * hR,   // ~20mL baseline (building up for a good one), linear with head size
    salivaL:         1.5 * mR,   // avg ~1.5L/day, scales with mass
    // Female anatomy
    vagDepthIn:      7.0 * hR,    // upper aroused range ~7"
    vagWidIn:        2.5 * hR,    // avg width (fully aroused)
    clitLenIn:       0.7 * hR,
    clitWidIn:       0.5 * hR,
    labiaLenIn:      1.5 * hR,
    arousalMl:       5   * Math.pow(mR, 1.5),
    arousalPreMl:   1.0 * Math.pow(mR, 1.5),   // pre-arousal fluid, Sinverse scaled
    // Anal (shared male & female)
    analDiamIn:      1.2 * hR,
    analDepthIn:     7.0 * hR,
    // Throat
    throatDiamIn:    2.5 * hR,    // max dilated throat diameter ~2.5"
    // Breath
    breathForceMph:  12  * hR,    // exhalation wind speed scales with lung pressure & hR
    breathDurS:      Math.round(15 * Math.pow(mR, 0.25)), // how long they can breathe out (s)
    // Swallow
    swallowMl:       100 * mR,    // volume per swallow ~100mL, linear with throat size
    // Voice
    voiceDb:         Math.min(194, Math.round(70 * Math.pow(mR, 0.25))), // dB — scales with lung/throat size, capped at physical max
    // Body warmth
    warmthRadiusIn:  60  * hR,    // ~5ft at ref — distance where body heat is clearly felt
    // Anatomy — all linear dimensions scale with hR, volume/mass with hR^3
    penisGirthIn:    (scaledLength(char, slotIdx) || 0) * 0.836,   // circumference = length * (4.6/5.5), proportional to actual length
    testicleG:      20   * mR,   // avg 20g each, scale with mass
    penisG:        100   * Math.pow((scaledLength(char, slotIdx) || 5.5) / 5.5, 3), // volume ∝ length^3, anchored 100g at 5.5"
  };
}

function fmt(n, decimals, unit) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  var v = decimals === 0 ? Math.round(n) : n.toFixed(decimals);
  return unit ? v + ' ' + unit : String(v);
}

function fmtL(litres) {
  if (litres === null || litres === undefined || isNaN(litres)) return '—';
  if (S.metric) {
    if (litres >= 1000000) return fmt(litres/1000000, 1, 'ML');
    if (litres >= 1000)    return fmt(litres/1000, 1, 'kL');
    if (litres >= 100)     return Math.round(litres) + ' L';
    if (litres >= 1)       return litres.toFixed(1) + ' L';
    var ml = litres * 1000;
    if (ml >= 1)           return ml.toFixed(1) + ' mL';
    var ul = ml * 1000;
    if (ul >= 0.01)        return ul.toFixed(1) + ' µL';
    return (ul * 1000).toFixed(2) + ' nL';
  } else {
    var gal = litres * 0.264172;
    if (gal >= 1000000)  return fmt(gal/1000000, 1, 'million gal');
    if (gal >= 1000)     return fmt(gal/1000, 1, 'k gal');
    if (gal >= 1)        return fmt(gal, 1, ' gal');
    var floz = litres * 33.814;
    if (floz >= 1)       return fmt(floz, 1, ' fl oz');
    var tsp = litres * 202.884;
    if (tsp >= 0.1)      return fmt(tsp, 2, ' tsp');
    return fmt(litres * 1000000, 1, ' µL');
  }
}

// Format a distance measurement — like fH but explicit
function fmtDist(in_) {
  if (in_ === null || in_ === undefined) return '—';
  return fH(in_);
}

// Format grams (for anatomy weights)
function fmtG(g) {
  if (!g && g !== 0) return '—';
  if (S.metric) {
    if (g >= 1000)    return fmt(g/1000, 2, 'kg');
    if (g >= 1)       return fmt(g, 1, 'g');
    if (g >= 0.001)   return fmt(g*1000, 2, 'mg');
    return fmt(g*1000000, 1, 'µg');
  } else {
    var oz = g * 0.035274;
    if (oz >= 16)     return fmt(oz/16, 2, 'lbs');
    if (oz >= 0.01)   return fmt(oz, 2, 'oz');
    return fmt(g * 15.4324, 2, 'gr');
  }
}

function statRow(label, value, note) {
  return '<div class="sv-row">' +
    '<span class="sv-label">'+label+'</span>' +
    '<span class="sv-value">'+value+(note?'<span class="sv-note"> '+note+'</span>':'')+'</span>' +
  '</div>';
}

function statSection(title, rows) {
  return '<div class="sv-section"><div class="sv-section-title">'+title+'</div>'+rows.join('')+'</div>';
}

// ── Comparative stats ─────────────────────────────────────────
// Returns array of {label, value, note} rows comparing char to themselves
// and (if others provided) to other chars
function comparativeStats(char, s, allChars) {
  var h = char.height * (char.height_correction || 1);
  var w = char.weight || sc(h, 'average');
  var rows = [];

  // Self-referential
  rows.push({label: 'Height as % of stride',   value: Math.round(h / s.strideIn * 100) + '%', note: 'how tall vs one step'});
  rows.push({label: 'Foot vs door width',        value: fL(s.footLenIn) + ' vs 32"', note: s.footLenIn > 32 ? 'foot wider than door' : 'foot fits through door'});
  rows.push({label: 'Grip circ. vs human waist', value: fL(s.penisGirthIn) + ' vs 30"', note: s.penisGirthIn > 30 ? 'larger than a human waist' : 'smaller than a human waist'});
  rows.push({label: 'Stomp vs car tire PSI',     value: fmt(s.stompPsi, 1, 'PSI') + ' vs 32 PSI', note: s.stompPsi > 32 ? 'more than a car tire' : 'less than a car tire'});
  if (char.length) {
    var effLen = char.length * (char.length_correction || 1);
    rows.push({label: 'Length as % of height',   value: Math.round(effLen / h * 100) + '%'});
    rows.push({label: 'Ejac. vs stomach vol.',    value: fmtL(s.ejacMl/1000) + ' vs ' + fmtL(s.stomachL), note: 'one load vs stomach capacity'});
  }
  rows.push({label: 'Sip vs stomach vol.',       value: '355mL vs ' + fmtL(s.stomachL), note: 'a can of soda is a sip'});
  rows.push({label: 'Can be lifted by…',         value: null});  // filled below

  // Cross-character comparisons
  allChars.forEach(function(other) {
    if (other === char) return;
    var os = calcStats(other);
    var oh = other.height * (other.height_correction || 1);
    var ow = other.weight || sc(oh, 'average');

    // Can char lift other?
    var canLift = s.liftLbs >= ow;
    rows.push({label: 'Can lift ' + other.name + '?', value: canLift ? 'Yes' : 'No',
      note: fW(ow) + ' vs ' + fW(s.liftLbs) + ' capacity'});

    // Steps to cross other
    var stepsAcross = (oh / s.strideIn).toFixed(1);
    rows.push({label: 'Steps to cross ' + other.name, value: stepsAcross + ' steps'});

    // Other fits in hand?
    var palmPx = 0.007 * Math.pow(h/72, 2);
    var otherFootprint = 0.025;
    rows.push({label: other.name + ' on palm?', value: palmPx >= otherFootprint ? 'Yes (~' + Math.round(palmPx/otherFootprint) + ' fit)' : 'No',
      note: 'standing upright'});

    // Can other lift char?
    var otherCanLift = os.liftLbs >= w;
    rows.push({label: other.name + ' can lift me?', value: otherCanLift ? 'Yes' : 'No',
      note: fW(w) + ' vs ' + fW(os.liftLbs) + ' capacity'});
  });

  return rows.filter(function(r){ return r.value !== null; });
}

function fmtThousands(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,','); }


// ── Perspective / "To Their Eyes" ────────────────────────────
function calcPerspective(char, slotIdx, refH, refW) {
  var charH = effectiveHSlot(char, slotIdx);
  var charW = char.weight || sc(charH, 'average');
  var charS = calcStats(char, slotIdx);
  var refS  = calcStats({height: refH, height_correction: 1,
                         weight: refW, default_silhouette: 'giantess'});

  // Apparent height: direct proportion at char's own scale
  var apparentIn = refH * (REF_STD_H / charH);

  // Caloric % — ref person's stored calories as % of char's daily intake
  var refCals   = refS.caloriesStored;
  var charCals  = charS.caloriesDay;
  var caloricPct = charCals > 0 ? (refCals / charCals * 100) : 0;

  return {
    apparentIn:  apparentIn,
    caloricPct:  caloricPct,
    refH:        refH,
    refW:        refW,
  };
}

function renderPerspectiveSection(char, slotIdx, charSlots2) {
  var section = document.createElement('div');
  section.className = 'sv-section sv-perspective';

  // Build list of reference targets: standard person + other chars
  var targets = [{id:'std', label:'Human', h:REF_STD_H, w:REF_W_LB}];
  charSlots2.forEach(function(cs) {
    // Skip THIS slot (same char AND same slotIdx), but include same char in other slots
    if (cs.char === char && cs.slotIdx === slotIdx) return;
    var oh = effectiveHSlot(cs.char, cs.slotIdx);
    var ow = scaledWeight(cs.char, cs.slotIdx);
    var isOv = S.heightOverrides[cs.slotIdx] !== undefined;
    // If same name as current char or overridden, add height to label for clarity
    var nameConflict = cs.char.name === char.name;
    var label = cs.char.name;
    if (nameConflict || isOv) label += ' (' + fH(oh) + ')';
    targets.push({id:'slot_'+cs.slotIdx, label:label, h:oh, w:ow});
  });

  var activeIdx = S.perspActive[slotIdx] || 0;
  // Clamp to valid range in case targets changed
  if (activeIdx >= targets.length) activeIdx = 0;

  function renderContent(p) {
    var html = '<div class="sv-section-title">To Their Eyes</div>';
    html += '<div class="persp-tabs">';
    targets.forEach(function(t, i) {
      html += '<button class="unit-btn persp-tab'+(i===activeIdx?' active':'')+'" data-idx="'+i+'">'+t.label+'</button>';
    });
    html += '</div>';
    html += '<div class="sv-row"><span class="sv-label">Appears as:</span><span class="sv-value">' + fL(p.apparentIn) + ' tall</span></div>';
    var cPct = p.caloricPct;
    var cPctStr = cPct < 0.01 ? '< 0.01%' : cPct < 1 ? cPct.toFixed(2) + '%' : cPct.toFixed(1) + '%';
    html += '<div class="sv-row"><span class="sv-label">Caloric value</span><span class="sv-value">' + cPctStr + ' of daily intake</span></div>';
    return html;
  }

  function refresh() {
    var t = targets[activeIdx];
    var p = calcPerspective(char, slotIdx, t.h, t.w);
    section.innerHTML = renderContent(p);
    // Re-wire tab buttons
    section.querySelectorAll('.persp-tab').forEach(function(btn) {
      btn.addEventListener('click', function() {
        activeIdx = parseInt(this.getAttribute('data-idx'));
        S.perspActive[slotIdx] = activeIdx;
        refresh();
      });
    });
  }

  refresh();
  return section;
}

function renderStatsView() {
  // Don't re-render while a resize popup is open — would destroy the popup
  if (document.getElementById('sr-global-resize-popup')) return;

  var panel = document.getElementById('view-stats');
  if (!panel) return;
  // Save scroll position before rebuild
  var existingScroll = panel.querySelector('.sv-scroll');
  var savedScrollTop  = existingScroll ? existingScroll.scrollTop  : 0;
  var savedScrollLeft = existingScroll ? existingScroll.scrollLeft : 0;
  panel.innerHTML = '';

  var charSlots2 = allCharSlots();
  if (!charSlots2.length) {
    panel.innerHTML = '<div class="sr-empty">Select characters to see their stats</div>';
    return;
  }

  var scroll = document.createElement('div');
  scroll.className = 'sv-scroll';

  charSlots2.forEach(function(cs) {
    var char = cs.char; var slotIdx = cs.slotIdx;
    var s = calcStats(char, slotIdx);
    var card = document.createElement('div');
    card.className = 'sv-card';

    var hsSilId = char.default_headshot_silhouette || char.default_silhouette || (DEFAULTS.headshotSils[0]&&DEFAULTS.headshotSils[0].id) || 'giantess';
    var hsSilUrl = DEFAULTS.headshot[hsSilId] || '';
    var imgSrc = char.profile_image || hsSilUrl;
    var isReal = !!char.profile_image;

    // Body temp: mammals maintain ~98.6°F / 37°C regardless of size
    var bodyTemp = S.metric ? '37.0°C' : '98.6°F';

    // Grip: recalculate with better formula
    // Average male grip ~100 lbs; scales with forearm cross-section ∝ mR^0.67
    var gripDisp = S.metric ? Math.round(s.gripLbs * 0.453592) + ' kg' : s.gripLbs + ' lbs';

    // Lift estimate: avg untrained person lifts ~1.5× bodyweight; scales as mR^0.67
    var liftLbs = Math.round(s.weightTimes * 170 * 1.5 * Math.pow(s.weightTimes, -0.33));
    var liftDisp = S.metric ? Math.round(liftLbs * 0.453592) + ' kg' : liftLbs + ' lbs';





    // Speed
    var speedDisp = S.metric ? fmt(s.speedMph * 1.60934, 1, 'km/h') : fmt(s.speedMph, 1, 'mph');

    // Stomp
    var stompDisp = S.metric ? fmt(s.stompPsi * 0.0689476, 2, 'bar') : fmt(s.stompPsi, 1, 'PSI');

    // Calories
    var calsDay   = fmtThousands(s.caloriesDay)   + ' kcal';
    var calStored = fmtThousands(s.caloriesStored) + ' kcal';

    // Format linear measurements using fL (handles ft+in / m+cm thresholds)
    var strideDisp  = fL(s.strideIn);
    var footLenDisp = fL(s.footLenIn);
    var footWidDisp = fL(s.footWidIn);
    var handLenDisp = fL(s.handLenIn);
    var handWidDisp = fL(s.handWidIn);

    var penisWeightDisp = S.metric
      ? (s.penisG >= 1000 ? fmt(s.penisG/1000,2,'kg') : Math.round(s.penisG)+' g')
      : (s.penisG >= 453.6 ? fmt(s.penisG/453.6,2,'lbs') : Math.round(s.penisG/28.35)+' oz');
    var testWeightDisp = S.metric
      ? (s.testicleG >= 1000 ? fmt(s.testicleG/1000,2,'kg ea.') : Math.round(s.testicleG)+' g ea.')
      : (s.testicleG >= 453.6 ? fmt(s.testicleG/453.6,2,'lbs ea.') : Math.round(s.testicleG/28.35)+' oz ea.');

    var _ovKeyStats = charKeyForSlot(slotIdx);
    var isOvStats = (_ovKeyStats ? S.heightOverrides[_ovKeyStats] : S.heightOverrides[slotIdx]) !== undefined;

    card.innerHTML =
      '<div class="sv-header">' +
        '<img class="sv-portrait' + (isReal ? '' : ' sr-sil-filter') + '" src="' + imgSrc + '" alt="' + char.name + '" />' +
        '<div class="sv-name">' + char.name +
          (char.canonical ? ' <span class="sr-stat-canon">&#10022;</span>' : '') +
          (isOvStats ? ' <span class="sr-override-badge">&#x21D4;</span>' : '') +
        '</div>' +
        (!char.custom ? resizeControlsHTML(char, slotIdx) : '<div class="sv-header-spacer"></div>') +
      '</div>' +

      (function(){
        var _ovKeySV = charKeyForSlot(slotIdx);
        var _ovValSV = _ovKeySV ? S.heightOverrides[_ovKeySV] : S.heightOverrides[slotIdx];
        var isOvSV = _ovValSV !== undefined;
        // Display TRUE height: raw override if set, else canonical. The
        // pose-corrected render height is shown in the "renders as ..." note.
        var trueHSV = isOvSV ? _ovValSV : char.height;
        var poseNoteSV = (char.height_correction && char.height_correction < 0.99)
          ? 'renders as ' + fH(effectiveHSlot(char, slotIdx)) + ' posed' : '';
        return statSection('Scale', [
          statRow('Height', fH(trueHSV), poseNoteSV),
          statRow('vs. average human', fmt(s.heightTimes, 2, '×'), s.heightTimes >= 1 ? 'taller' : 'shorter'),
        statRow('Weight',              fW(scaledWeight(char, slotIdx))),
        statRow('vs. average human', fmt(s.weightTimes, 2, '×'), s.weightTimes >= 1 ? 'heavier' : 'lighter'),
        ]);
      })() +

      // ── To Their Eyes — inserted via DOM ──
      '<div class="sv-perspective-placeholder" data-slot="'+slotIdx+'"></div>' +

      statSection('Daily needs', [
        statRow('Calories / day',  calsDay),
        statRow('Calories stored', calStored),
        statRow('Water intake',    fmtL(s.waterL) + ' / day'),
        statRow('Urine output',    fmtL(s.urineL) + ' / day'),
        statRow('Stomach volume',  fmtL(s.stomachL)),
      ]) +

      statSection('Body', [
        statRow('Lung capacity',     fmtL(s.lungL)),
        statRow('Exhale volume',     fmtL(s.exhaleL), '(single breath)'),
        statRow('Breath force',      Math.round(s.breathForceMph) + (S.metric ? ' km/h' : ' mph'),
                                     '(wind speed of exhalation)'),
        statRow('Breath duration',   s.breathDurS + 's', '(sustained exhale)'),
        statRow('Saliva / day',      fmtL(s.salivaL)),
        statRow('Spit volume',       fmtL(s.spitMl / 1000)),
        statRow('Voice volume',      s.voiceDb + ' dB', s.voiceDb >= 140 ? '(threshold of pain)' : s.voiceDb >= 120 ? '(jet engine)' : s.voiceDb >= 100 ? '(jackhammer)' : ''),
        statRow('Body heat felt at',  fL(s.warmthRadiusIn), '(distance)'),
      ]) +

      statSection('Measurements', [
        statRow('Foot length',   footLenDisp),
        statRow('Foot width',    footWidDisp),
        statRow('Hand length',   handLenDisp),
        statRow('Hand width',    handWidDisp),
        statRow('Tongue length',   fL(s.tongueLenIn)),
        statRow('Tongue width',    fL(s.tongueWidIn)),
        statRow('Max throat diam.', fL(s.throatDiamIn)),
        statRow('Swallow volume',  fmtL(s.swallowMl / 1000)),
      ]) +

      statSection('Movement', [
        statRow('Stride length',    strideDisp),
        statRow('Top speed (est.)', speedDisp),
        statRow('Grip strength',    gripDisp),
        statRow('Lifting capacity', liftDisp, '(est. max)'),
        statRow('Stomp pressure',   stompDisp, '(heel strike)'),
        statRow('Crush threshold',  fW(s.crushLbs), '(survivable weight on body)'),
      ]) +

      (function() {
        // Anatomy flags: canon chars use anatomy field, custom use toggles
        var anat = char.anatomy || {};
        var hasPenis   = anat.penis   !== false && (char.custom ? true : anat.penis === true);
        var hasVag     = anat.vag     !== false && (char.custom ? true : anat.vag   === true);
        var hasBreasts = anat.breasts === true;
        // Custom fallback: if no anatomy set at all, use old length heuristic
        if (char.custom && !char.anatomy) {
          hasPenis = !!char.length; hasVag = !char.length; hasBreasts = false;
        }

        function dimSection(title, rows) {
          return '<div class="sv-section sv-section-dim"><div class="sv-section-title">'+title+
            '<span class="sv-section-na"> — N/A</span></div>'+rows.join('')+'</div>';
        }
        var dash = '<span class="sv-dim-dash">—</span>';

        var penisSection = hasPenis
          ? statSection('Penis', [
              statRow('Length',           fL(scaledLength(char, slotIdx) || 0)),
              statRow('Girth (circ.)',    fL(s.penisGirthIn)),
              statRow('Width (diam.)',    fL(s.penisWidIn)),
              statRow('Weight',           penisWeightDisp),
              statRow('Testicle weight',  testWeightDisp),
              statRow('Pre volume',       fmtL(s.preMl / 1000), '(Sinverse scaled)'),
              statRow('Ejaculate volume', fmtL(s.ejacMl / 1000), '(Sinverse scaled)'),
            ])
          : dimSection('Penis', [
              statRow('Length',           dash),
              statRow('Girth (circ.)',    dash),
              statRow('Width (diam.)',    dash),
              statRow('Weight',           dash),
              statRow('Testicle weight',  dash),
              statRow('Pre volume',       dash),
              statRow('Ejaculate volume', dash),
            ]);

        var vagSection = hasVag
          ? statSection('Vagina', [
              statRow('Depth',            fL(s.vagDepthIn)),
              statRow('Width',            fL(s.vagWidIn)),
              statRow('Clitoris length',  fL(s.clitLenIn)),
              statRow('Clitoris width',   fL(s.clitWidIn)),
              statRow('Labia length',     fL(s.labiaLenIn)),
              statRow('Pre-arousal',      fmtL(s.arousalPreMl / 1000), '(Sinverse scaled)'),
              statRow('Arousal volume',   fmtL(s.arousalMl / 1000), '(Sinverse scaled)'),
            ])
          : dimSection('Vagina', [
              statRow('Depth',         dash),
              statRow('Width',         dash),
              statRow('Clitoris length', dash),
              statRow('Clitoris width',  dash),
              statRow('Labia length',    dash),
              statRow('Pre-arousal',     dash),
              statRow('Arousal volume',  dash),
            ]);

        var analSection = statSection('Anal', [
          statRow('Diameter', fL(s.analDiamIn), '(dilated)'),
          statRow('Depth',    fL(s.analDepthIn)),
        ]);

        var bs = calcBreasts(char, slotIdx);
        var breastSection = hasBreasts
          ? statSection('Breasts', [
              statRow('Cup size equiv.',  bs.cupLabel),
              statRow('Volume (each)',    fmtL(bs.volL)),
              statRow('Weight (each)',    fW(bs.weightLbs)),
              statRow('Projection',       fL(bs.projIn), '(est. depth)'),
              statRow('Width (each)',     fL(bs.widIn)),
              statRow('Nipple diameter',  fL(bs.nipDiamIn)),
              statRow('Nipple length',    fL(bs.nipLenIn)),
              statRow('Milk production',  fmtL(bs.milkLperDay), '/ day (est. peak lactation)'),
            ])
          : dimSection('Breasts', [
              statRow('Cup size equiv.', dash),
              statRow('Volume (each)',   dash),
              statRow('Weight (each)',   dash),
              statRow('Projection',      dash),
              statRow('Width (each)',    dash),
              statRow('Nipple diameter', dash),
              statRow('Nipple length',   dash),
              statRow('Milk production', dash),
            ]);

        return breastSection + penisSection + vagSection + analSection;
      })();

    // Wire resize controls now that sv-header innerHTML is set
    if (!char.custom) {
      var svHeader = card.querySelector('.sv-header');
      if (svHeader) wireResizeControls(svHeader);
    }

    // Perspective section: insert into placeholder before anatomy sections
    var ph = card.querySelector('.sv-perspective-placeholder');
    var perspEl = renderPerspectiveSection(char, slotIdx, charSlots2);
    if (ph) ph.replaceWith(perspEl);
    else card.appendChild(perspEl);

    // Wiki link at very bottom
    if (char.wiki) {
      var wikiA = document.createElement('a');
      wikiA.href = '../wiki/?character=' + char.name.toLowerCase();
      wikiA.className = 'sr-wiki-link';
      wikiA.style.cssText = 'display:block;padding:1rem 1.25rem;';
      wikiA.textContent = 'View wiki →';
      card.appendChild(wikiA);
    } else {
      var wikiSpacer = document.createElement('div');
      wikiSpacer.className = 'sr-wiki-spacer';
      card.appendChild(wikiSpacer);
    }

    scroll.appendChild(card);
  });

  panel.appendChild(scroll);
  enableDragScrollSV(scroll);

  // Wire resize controls via event delegation
  scroll.addEventListener('click', function(e) {
    var btn = e.target.closest('.sv-resize-set, .sv-resize-reset');
    if (!btn) return;
    var charId = parseInt(btn.getAttribute('data-charid'));
    if (btn.classList.contains('sv-resize-reset') || btn.classList.contains('sr-full-reset-btn')) {
      delete S.heightOverrides[charId];
    } else {
      // Set
      var row = btn.closest('.sv-resize-row');
      var inp = row && row.querySelector('.sv-resize-input');
      if (!inp || !inp.value) return;
      var val = parseFloat(inp.value);
      if (!val || val <= 0) return;
      S.heightOverrides[charId] = S.metric ? val / 2.54 : val;
    }
    renderStatsView();
    renderActive();  // update height/length viewer too
  });

  // Restore scroll position after rebuild
  scroll.scrollTop  = savedScrollTop;
  scroll.scrollLeft = savedScrollLeft;
}


// ── Grid lines overlay ────────────────────────────────────────
function updateGridOverlay() {
  updateHeightGrid();
  updateLengthGrid();
  // Also clear length scroll if grid turned off
  if (!S.gridLines) {
    var ls = document.getElementById('sr-length-scroll');
    if (ls) ls.style.backgroundImage = 'none';
    var sc = document.getElementById('sr-scroll');
    if (sc) sc.style.backgroundImage = 'none';
  }
}

function updateHeightGrid() {
  var scrollEl = document.getElementById('sr-scroll');
  var sceneEl  = document.getElementById('sr-scene');
  // Paint the grid on the scroll VIEWPORT (fixed), not the scrollable scene, so
  // it stays aligned with the ruler — which is also fixed to the viewport bottom
  // and does not scroll. (Both anchor lines to the bottom / ground line.) Clear
  // any paint left on the scene from an earlier approach.
  if (sceneEl) { sceneEl.style.backgroundImage = 'none'; }
  if (!scrollEl) return;
  if (!S.gridLines || S.pxPerIn <= 0) {
    scrollEl.style.backgroundImage = 'none';
    return;
  }
  var lineColor = 'rgba(196,154,120,0.15)';
  var stepPx;
  if (S.metric) {
    var pxPerCm = S.pxPerIn / 2.54;
    var step = niceInterval(48, pxPerCm);
    stepPx = pxPerCm * step;
  } else {
    var pxPerFt = S.pxPerIn * 12;
    var step2 = niceInterval(48, pxPerFt);
    stepPx = pxPerFt * step2;
  }
  if (stepPx < 1) return;
  // repeating-linear-gradient draws horizontal lines from the bottom
  scrollEl.style.backgroundImage =
    'repeating-linear-gradient(to top, ' + lineColor + ' 0px, ' + lineColor + ' 1px, transparent 1px, transparent ' + stepPx + 'px)';
  scrollEl.style.backgroundSize = '100% 100%';
  scrollEl.style.backgroundPosition = 'bottom';
  // Scroll the grid WITH the content (local), so lines track the figures. The
  // ruler is scroll-synced to match (see syncRulerScroll), keeping the two aligned.
  scrollEl.style.backgroundAttachment = 'local';
  scrollEl.style.backgroundAttachment = 'local';
}

function updateLengthGrid() {
  var scrollEl = document.getElementById('sr-length-scroll');
  if (!scrollEl) return;
  if (!S.gridLines || S.pxPerInLen <= 0) {
    scrollEl.style.backgroundImage = 'none';
    return;
  }
  var lineColor = 'rgba(196,154,120,0.15)';
  var stepPx;
  if (S.metric) {
    var pxPerCm = S.pxPerInLen / 2.54;
    var step = niceInterval(48, pxPerCm);
    stepPx = pxPerCm * step;
  } else {
    var inchSteps = [1,2,3,6,12,24,36,60,120,240];
    var step2 = inchSteps[inchSteps.length-1];
    for (var si=0; si<inchSteps.length; si++) {
      if (S.pxPerInLen * inchSteps[si] >= 48) { step2 = inchSteps[si]; break; }
    }
    stepPx = S.pxPerInLen * step2;
  }
  if (stepPx < 1) return;
  // The length bars share a left origin (length = 0). Find that origin in the
  // scroll container's CONTENT space (independent of scroll): it's the left edge
  // of a length bar. Use the first row's bar; fall back to headshot width.
  var sx = scrollEl.scrollLeft || 0;
  var scrollRect = scrollEl.getBoundingClientRect();
  var bar = scrollEl.querySelector('.sr-length-img-wrap');
  var originContent;
  if (bar) {
    var br = bar.getBoundingClientRect();
    originContent = (br.left - scrollRect.left) + sx;   // content-space x of length 0
  } else {
    originContent = 90 + 24; // fallback: HEADSHOT_W + padding
  }
  // The background is attached to the (non-scrolling) container, so to make the
  // lines track the content we offset the position by -scrollLeft. This keeps
  // the grid aligned with both the bars and the ruler (which also shifts by
  // -scrollLeft).
  var viewOffset = originContent - sx;
  var blockColor = 'var(--bg)';  // same as viewer background
  scrollEl.style.backgroundImage =
    'linear-gradient(to right, ' + blockColor + ' ' + viewOffset + 'px, transparent ' + viewOffset + 'px), ' +
    'repeating-linear-gradient(to right, ' + lineColor + ' 0px, ' + lineColor + ' 1px, transparent 1px, transparent ' + stepPx + 'px)';
  scrollEl.style.backgroundSize = '100% 100%, ' + stepPx + 'px 100%';
  scrollEl.style.backgroundPosition = '0 0, ' + viewOffset + 'px 0';
  scrollEl.style.backgroundRepeat = 'no-repeat, repeat-x';
}

// ── View switching ────────────────────────────────────────────
function switchView(view) {
  S.view = view;
  document.querySelectorAll('.sr-view-tab').forEach(function(t) {
    t.classList.toggle('active', t.getAttribute('data-view') === view);
  });
  document.querySelectorAll('.sr-view').forEach(function(v) {
    v.style.display = 'none';
  });
  var panel = document.getElementById('view-' + view);
  if (panel) panel.style.display = (view === 'stats') ? 'flex' : '';
  // Update zoom label and show/hide zoom controls per view
  var lbl = document.getElementById('zoom-label');
  if (lbl) lbl.textContent = Math.round((view === 'length' ? S.zoomL : S.zoomH) * 100) + '%';
  var zc = document.querySelector('.zoom-controls');
  if (zc) zc.style.visibility = view === 'stats' ? 'hidden' : 'visible';
  var cb = document.getElementById('btn-copy-img');
  if (cb) cb.style.display = view === 'stats' ? 'none' : '';
  var gb = document.getElementById('btn-grid-lines');
  if (gb) gb.style.display = view === 'stats' ? 'none' : '';
  renderActive();
}

function renderActive() {
  if (S.view === 'height') render();
  else if (S.view === 'length') renderLengthView();
  else if (S.view === 'stats') renderStatsView();
}

// ── Length view ────────────────────────────────────────────────
var LENGTH_ROW_H = 160; // px per row
var HEADSHOT_W   = 90;  // px for headshot column

function renderLengthView() {
  if (document.getElementById('sr-global-resize-popup')) return;
  var rowsEl   = document.getElementById('sr-length-rows');
  var emptyEl  = document.getElementById('sr-length-empty');
  var zoomEl   = document.getElementById('sr-length-zoom');
  var statsEl  = document.getElementById('sr-length-stats');
  if (!rowsEl) return;
  rowsEl.innerHTML  = '';
  statsEl.innerHTML = '';

  // Collect entities — include all chars (length defaults to 0 if unset)
  // Only exclude objects with no length value
  var entities = [];
  allSlotSelects().forEach(function(sel, idx) {
    var type = sel.getAttribute('data-type');
    var val  = sel.value; if (!val) return;
    if (type === 'obj') {
      var obj = S.objects.find(function(o){return o.id===val;});
      if (obj && obj.length) entities.push({kind:'obj', data:obj, slotIdx:idx});
    } else {
      var c = charFromValue(val);
      if (c) {
        // noPenis flag: custom chars with penis off render as portrait+dash only
        var noPenis = c.custom && c.anatomy && c.anatomy.penis === false;
        entities.push({kind:'char', data:c, slotIdx:idx, hasLength: !!(c.length) && !noPenis, noPenis: noPenis});
      }
    }
  });

  if (!entities.length) {
    emptyEl.style.display = ''; zoomEl.style.display = 'none';
    updateLengthRuler(0, 1); return;
  }
  emptyEl.style.display = 'none'; zoomEl.style.display = '';

  // Find max effective length
  var maxLen = 0;
  entities.forEach(function(e) {
    var eid = e.kind === 'char' ? (e.data.id || e.data.name) : null;
    var eMode = eid ? (S.lenImgMode[eid] || 'length') : 'length';
    // No-length and no-penis chars only contribute to maxLen when in body mode
    if (e.kind === 'char' && (!e.data.length || e.noPenis) && eMode !== 'height') return;
    var len;
    if (eMode === 'height' && e.kind === 'char') {
      len = effectiveHSlot(e.data, e.slotIdx);
    } else {
      len = e.kind === 'char'
        ? (scaledLength(e.data, e.slotIdx) || 0)
        : (e.data.length || 0);
    }
    if (len > maxLen) maxLen = len;
  });
  if (maxLen < 0.1) maxLen = 1;

  var rulerEl = document.getElementById('sr-length-ruler');
  var availW  = rulerEl ? rulerEl.getBoundingClientRect().width : 400;
  if (availW < 10) availW = 400;
  // Bake zoom into pxPerInLen — same approach as height view, no CSS transform needed
  S.pxPerInLen = (availW * S.zoomL) / maxLen;

  entities.forEach(function(e) {
    rowsEl.appendChild(renderLengthRow(e));
  });

  // Stat blocks
  entities.forEach(function(e) {
    if (e.kind === 'obj') statsEl.appendChild(objLengthStatBlock(e.data));
    else                  statsEl.appendChild(lengthStatBlock(e.data, e.slotIdx));
  });

  // Update ruler after render (pxPerInLen is now set correctly)
  updateLengthRuler(0, S.pxPerInLen || 1);
  document.getElementById('zoom-label').textContent = Math.round(S.zoomL*100)+'%';
  updateLengthGrid();

  // Enable horizontal scrolling when zoomed in (rows are wider than the
  // viewport). The ruler + grid are kept aligned to the horizontal scroll
  // position by syncLengthRulerScroll (wired once).
  var lenScroll = document.getElementById('sr-length-scroll');
  if (lenScroll) {
    lenScroll.style.overflowX = (S.zoomL > 1) ? 'auto' : 'hidden';
    if (!lenScroll._hSyncWired) {
      lenScroll._hSyncWired = true;
      lenScroll.addEventListener('scroll', syncLengthRulerScroll);
    }
    syncLengthRulerScroll();
  }
}

// Keep the horizontal length ruler (and the grid lines) aligned with the
// content as it scrolls horizontally. The ruler lives outside the scroll
// container, so we translate its ticks by -scrollLeft to match.
function syncLengthRulerScroll() {
  var scrollEl = document.getElementById('sr-length-scroll');
  var rulerInner = document.getElementById('sr-length-ruler');
  if (!scrollEl || !rulerInner) return;
  var sx = scrollEl.scrollLeft || 0;
  rulerInner.style.transform = 'translateX(' + (-sx) + 'px)';
  // Re-align the grid background to the new scroll position.
  if (typeof updateLengthGrid === 'function') updateLengthGrid();
}

function renderLengthRow(entity) {
  var row = el('div'); row.className = 'sr-length-row';

  // Headshot — counter-scaled so it stays natural size inside the zoom container
  var hsWrap = el('div'); hsWrap.className = 'sr-headshot-wrap';
  if (entity.kind === 'char') {
    var hsImg = el('img'); hsImg.className = 'sr-headshot-img';
    var hsSilId = entity.data.default_headshot_silhouette || entity.data.default_silhouette || (DEFAULTS.headshotSils[0]&&DEFAULTS.headshotSils[0].id) || 'giantess';
    var hsSilUrl = DEFAULTS.headshot[hsSilId] || DEFAULTS.headshot.giantess || '';
    hsImg.src = entity.data.profile_image || hsSilUrl;
    if (!entity.data.profile_image) hsImg.classList.add('sr-sil-filter');
    hsWrap.appendChild(hsImg);
    var hsName = el('div'); hsName.className = 'sr-headshot-name';
    hsName.textContent = entity.data.name;
    hsWrap.appendChild(hsName);
  }
  // Objects: empty headshot cell (for alignment)

  // Length image row — goes inside zoom container
  // For chars with no length or penis off — portrait + dash only
  var noLengthChar = entity.kind === 'char' && (!entity.data.length || entity.noPenis);
  if (noLengthChar) {
    var femEntityId = entity.data.id || entity.data.name;
    var femMode = entity.noPenis ? 'length' : (S.lenImgMode[femEntityId] || 'length');
    if (femMode !== 'height') {
      row.appendChild(hsWrap);
      return row;
    }
    // Body mode: fall through
  }

  var effLen;
  if (entity.kind === 'char' && (!entity.data.length || entity.noPenis)) {
    effLen = effectiveHSlot(entity.data, entity.slotIdx);
  } else {
    effLen = entity.kind === 'char'
      ? (scaledLength(entity.data, entity.slotIdx) || 1)
      : (entity.data.length || 1);
  }

  // When showing height image rotated 90°, use the character's HEIGHT as the display width
  var entityId2 = entity.kind === 'char' ? (entity.data.id || entity.data.name) : null;
  var lenMode2 = entityId2 ? (S.lenImgMode[entityId2] || 'length') : 'length';
  var displayLen = (lenMode2 === 'height' && entity.kind === 'char')
    ? effectiveHSlot(entity.data, entity.slotIdx)
    : effLen;

  var pxW = Math.max(4, Math.round(displayLen * S.pxPerInLen));

  // The wrapper IS the length bar — width scales with character length.
  // The image fills it exactly so visual size always matches the data.
  var lenWrap = el('div'); lenWrap.className = 'sr-length-img-wrap';
  lenWrap.style.width = pxW + 'px';
  // Height is determined by CSS — let image natural proportions show fully

  var lenImg = el('img'); lenImg.className = 'sr-length-img'; // may be replaced for objects
  if (entity.kind === 'char') {
    var lenSilId = entity.data.default_length_silhouette || (DEFAULTS.lengthSils[0]&&DEFAULTS.lengthSils[0].id) || 'default';
    var lenSilUrl = '';
    DEFAULTS.lengthSils.forEach(function(s){if(s.id===lenSilId)lenSilUrl=s.url;});
    var entityId = entity.data.id || entity.data.name;
    var lenMode = S.lenImgMode[entityId] || 'length';
    var charFlip = entity.data.length_orient_flip   || false;
    var charRot  = entity.data.length_orient_rotate || 0;
    if (lenMode === 'height') {
      // Show height image rotated 90° so it lies on its side
      var hSrc = entity.data.image || (DEFAULTS.height[entity.data.default_silhouette] || DEFAULTS.height.giantess || '');
      lenImg = orientedImgEl(hSrc, false, 90, !entity.data.image);
    } else {
      var charLenSrc = entity.data.length_image || lenSilUrl || DEFAULTS.length || '';
      if (charFlip || charRot) {
        lenImg = orientedImgEl(charLenSrc, charFlip, charRot, !entity.data.length_image);
      } else {
        lenImg.src = charLenSrc;
        if (!entity.data.length_image) lenImg.classList.add('sr-sil-filter');
      }
    }
  } else {
    // Use canvas pre-baked orientation so image aligns correctly with scale
    lenImg = orientedImgEl(
      entity.data.image || '',
      entity.data.length_orient_flip   || false,
      entity.data.length_orient_rotate || 0,
      true  // apply rose-gold filter
    );
    lenImg.alt = entity.data.label;
  }

  lenImg.classList.add('sr-length-img');
  lenWrap.appendChild(lenImg);
  row.appendChild(hsWrap);
  row.appendChild(lenWrap);
  return row;
}

function applyLengthZoom() {
  // Preserve scroll position across the zoom (keep the same content centered)
  // instead of resetting to the start. Horizontal especially, since zooming the
  // length view mainly changes width.
  var scrollEl = document.getElementById('sr-length-scroll');
  var fracX = 0, fracY = 0;
  if (scrollEl) {
    if (scrollEl.scrollWidth > scrollEl.clientWidth)
      fracX = (scrollEl.scrollLeft + scrollEl.clientWidth / 2) / scrollEl.scrollWidth;
    if (scrollEl.scrollHeight > scrollEl.clientHeight)
      fracY = (scrollEl.scrollTop + scrollEl.clientHeight / 2) / scrollEl.scrollHeight;
  }
  // Zoom baked into pxPerInLen — renderLengthView recalculates and updates ruler
  renderLengthView();
  if (scrollEl) {
    requestAnimationFrame(function() {
      if (fracX > 0 && scrollEl.scrollWidth > scrollEl.clientWidth) {
        var tx = fracX * scrollEl.scrollWidth - scrollEl.clientWidth / 2;
        scrollEl.scrollLeft = Math.max(0, Math.min(tx, scrollEl.scrollWidth - scrollEl.clientWidth));
      }
      if (fracY > 0 && scrollEl.scrollHeight > scrollEl.clientHeight) {
        var ty = fracY * scrollEl.scrollHeight - scrollEl.clientHeight / 2;
        scrollEl.scrollTop = Math.max(0, Math.min(ty, scrollEl.scrollHeight - scrollEl.clientHeight));
      }
      syncLengthRulerScroll();
    });
  }
}

function updateLengthRuler(maxLen, pxPerIn) {
  var ruler = document.getElementById('sr-length-ruler');
  if (!ruler) return;
  ruler.innerHTML = '';
  var effPx = pxPerIn;  // zoom baked in
  // Build ticks across the FULL content width (the widest row), not just the
  // visible ruler width — otherwise ticks would be missing when the user scrolls
  // right while zoomed. The rows live in sr-length-zoom.
  var areaW = (function(){ var a=document.getElementById('sr-length-area'); return a?a.clientWidth:400; })();
  var rulerW = areaW || 400;
  var zoomEl = document.getElementById('sr-length-zoom');
  if (zoomEl) rulerW = Math.max(rulerW, zoomEl.scrollWidth, zoomEl.getBoundingClientRect().width);
  // The ruler element is normally only viewport-wide and clips its overflow, so
  // ticks past the viewport would be hidden even after we translate it. Give it
  // the full content width so its clip box contains every tick; the translate
  // (syncLengthRulerScroll) then reveals the right portion as the user scrolls.
  ruler.style.width = rulerW + 'px';
  ruler.style.flex = '0 0 auto';

  if (S.metric) {
    var pxPerCm = effPx / 2.54;
    var step = niceInterval(48, pxPerCm);
    var maxCm = Math.ceil(rulerW / pxPerCm) + step;
    for (var cm = 0; cm <= maxCm; cm += step) {
      var px = Math.round(cm * pxPerCm);
      if (px > rulerW + 4) break;
      var tick = el('div'); tick.className = 'sr-length-tick';
      tick.style.left = px + 'px';
      tick.setAttribute('data-label', cm >= 100 ? (cm/100).toFixed(cm%100===0?0:1)+'m' : cm+'cm');
      ruler.appendChild(tick);
    }
  } else {
    // Nice inch steps: 1,2,3,6,12,24,36,60,120 — natural for length comparison
    var inchSteps = [1,2,3,6,12,24,36,60,120,240];
    var step = inchSteps[inchSteps.length-1];
    for (var si=0; si<inchSteps.length; si++) {
      if (effPx * inchSteps[si] >= 48) { step = inchSteps[si]; break; }
    }
    var maxIn = Math.ceil(rulerW / effPx) + step;
    for (var i = 0; i <= maxIn; i += step) {
      var px = Math.round(i * effPx);
      if (px > rulerW + 4) break;
      var tick = el('div'); tick.className = 'sr-length-tick';
      tick.style.left = px + 'px';
      tick.setAttribute('data-label', i >= 12 ? Math.floor(i/12)+"' "+i%12+'"' : i+'"');
      ruler.appendChild(tick);
    }
  }
}

function updateLengthVisibility(slot) {
  // Check the live button state first (before save), fallback to saved data
  var penisBtn = g('anat-penis-'+slot);
  var hasPenis = penisBtn ? penisBtn.classList.contains('active') : true;
  if (!penisBtn) {
    var d = getCustomChar('custom_'+slot);
    hasPenis = !d || !d.anatomy || d.anatomy.penis !== false;
  }

  var lengthEl = document.querySelector('.custom'+slot+'-length-section');
  if (!lengthEl) return;

  var details = lengthEl.querySelector('.form-det');
  var summary = lengthEl.querySelector('.form-det-summary');

  if (!hasPenis) {
    // Collapse and lock
    if (details) details.removeAttribute('open');
    lengthEl.style.opacity = '0.4';
    lengthEl.style.pointerEvents = 'none';
    var lockSpan = summary ? summary.querySelector('.anat-lock-tip') : null;
    if (summary && !lockSpan) {
      var tip = document.createElement('span');
      tip.className = 'anat-lock-tip';
      tip.textContent = ' — enable Penis in Anatomy';
      tip.style.cssText = 'font-family:var(--font-body);font-size:0.62rem;letter-spacing:0;text-transform:none;color:var(--text-muted);font-style:italic;';
      summary.appendChild(tip);
    }
  } else {
    // Restore
    lengthEl.style.opacity = '';
    lengthEl.style.pointerEvents = '';
    var lockSpan2 = summary ? summary.querySelector('.anat-lock-tip') : null;
    if (lockSpan2) lockSpan2.remove();
  }
}

function lengthStatBlock(char, slotIdx) {
  var block = el('div'); block.className = 'sr-stat-block';
  var noPenisChar = char.custom && char.anatomy && char.anatomy.penis === false;
  var effLen = noPenisChar ? 0 : (scaledLength(char, slotIdx) || 0);
  var entityId = char.id || char.name;
  var mode = S.lenImgMode[entityId] || 'length';
  var _ovKey = charKeyForSlot(slotIdx);
  var isOv = (_ovKey ? S.heightOverrides[_ovKey] : S.heightOverrides[slotIdx]) !== undefined;

  var dispVal  = mode === 'height'
    ? fH(effectiveHSlot(char, slotIdx))
    : fL(effLen);
  var dispKey  = mode === 'height' ? 'Height' : 'Length';
  var dispNote = mode === 'length' && char.length_correction && char.length_correction < 0.99
    ? '<div class="sr-stat-row"><span class="sr-stat-key"></span><span class="sr-stat-val sr-stat-note">base: '+fL(char.length)+'</span></div>' : '';

  block.innerHTML =
    '<div class="sr-stat-name">'+char.name+
      (char.canonical?' <span class="sr-stat-canon">&#10022;</span>':'')+
      (isOv?' <span class="sr-override-badge">&#x21D4;</span>':'')+
    '</div>'+
    '<div class="sr-stat-grid">'+
      '<div class="sr-stat-row"><span class="sr-stat-key">'+dispKey+'</span><span class="sr-stat-val">'+dispVal+'</span></div>'+
      dispNote+
    '</div>'+
    '<div class="len-img-toggle">'+
      '<button class="unit-btn'+(mode==='length'?' active':'')+'" data-id="'+entityId+'" data-mode="length">Length</button>'+
      '<button class="unit-btn'+(mode==='height'?' active':'')+'" data-id="'+entityId+'" data-mode="height">Body</button>'+
    '</div>'+
    (char.wiki ? '<a href="../wiki/?character='+char.name.toLowerCase()+'" class="sr-wiki-link">View wiki &rarr;</a>' : '');

  block.querySelectorAll && setTimeout(function(){
    block.querySelectorAll('.len-img-toggle .unit-btn').forEach(function(btn){
      btn.addEventListener('click', function(){
        S.lenImgMode[this.getAttribute('data-id')] = this.getAttribute('data-mode');
        S.zoomL = 0.75;  // reset zoom so new content fits
        renderLengthView();
        document.getElementById('zoom-label').textContent = '50%';
      });
    });
  }, 0);

  return block;
}

function objLengthStatBlock(obj) {
  var block = el('div'); block.className = 'sr-stat-block';
  block.innerHTML =
    '<div class="sr-stat-name">'+obj.label+'</div>'+
    '<div class="sr-stat-grid">'+
      '<div class="sr-stat-row"><span class="sr-stat-key">Length</span><span class="sr-stat-val">'+fL(obj.length)+'</span></div>'+
    '</div>';
  return block;
}

// ── Custom forms ──────────────────────────────────────────────────
function buildForms() {
  var chars=loadCustom().chars||[];
  chars.forEach(function(c){
    var slot=parseInt((c.id||'').replace('custom_',''),10);
    if(slot) buildForm(slot);
  });
}

function buildForm(slot) {
  var wrap = document.getElementById('custom'+slot+'-form');
  if (!wrap) return;
  wrap.innerHTML = '';
  var ex = getCustomChar('custom_'+slot);
  var exCorr = ex ? String(ex.height_correction||'1') : '1';

  // Preload images into cropImgs for crop tool
  // Load images from IndexedDB and show upload section if image found
  ['i','l','p'].forEach(function(pfx) {
    var imgKey = 'custom_' + slot + '_' + pfx;
    getImg(imgKey).then(function(src) {
      if (!src) return;
      // Show upload section so the loaded image has somewhere to display
      if (pfx === 'i') {
        var hup = g('hupload-'+slot);
        if (hup) hup.style.display = '';
        // Switch dropdown to upload
        var hsilh = g('hsilh-'+slot);
        if (hsilh) hsilh.value = 'upload';
        // Show pose and headroom
        var hpo = g('hpose-'+slot);     if (hpo) hpo.style.display = '';
        var hhr = g('hheadroom-'+slot); if (hhr) hhr.style.display = '';
      }
      if (pfx === 'p') {
        var pup = g('pupload-'+slot);
        if (pup) pup.style.display = '';
        var psil = g('psil-'+slot);
        if (psil) psil.value = 'upload';
      }
      preloadCropImgP(slot, pfx, src);
    });
  });

  // ── Name (always visible) ───────────────────────
  wrap.appendChild(field('Name *', inp('text','n'+slot,'Character name',ex?ex.name:'')));

  // ── ANATOMY toggles ────────────────────────────
  var anatDet = makeDet('Anatomy', false, 'section-anatomy');
  var anatBody = anatDet.querySelector('.det-body');
  var anatF = cf('Features');

  var exAnat = ex && ex.anatomy ? ex.anatomy : {};
  var hasBreasts = exAnat.breasts !== false;   // default on
  var hasPenis   = exAnat.penis   !== false;   // default on
  var hasVag     = exAnat.vag     === true;    // default OFF

  var exBust = exAnat.bustSize || 'c';
  var bustOpts = BUST_REFS.map(function(b){
    // Show the cup label plus a tangible reference: volume + everyday object,
    // so people who don't think in cup sizes can still pick accurately.
    var extra = b.cmp === 'flat'
      ? ''
      : ' \u00b7 ~' + b.volL + ' L (' + b.cmp + ')';
    return '<option value="'+b.id+'"'+(b.id===exBust?' selected':'')+'>'+b.label+extra+'</option>';
  }).join('');

  anatF.innerHTML +=
    '<div class="anat-toggles">' +
      '<button class="anat-btn'+(hasBreasts?' active':'')+'" id="anat-breasts-'+slot+'" data-key="breasts">Breasts</button>' +
      '<button class="anat-btn'+(hasPenis?' active':'')+'" id="anat-penis-'+slot+'" data-key="penis">Penis</button>' +
      '<button class="anat-btn'+(hasVag?' active':'')+'" id="anat-vag-'+slot+'" data-key="vag">Vagina</button>' +
    '</div>' +
    '<div class="bust-size-row" id="bust-row-'+slot+'" style="'+(hasBreasts?'':'display:none')+'">' +
      '<span class="cf-label">Bust size</span>' +
      '<select class="builder-input" id="bust-sel-'+slot+'">'+bustOpts+'</select>' +
    '</div>';
  anatBody.appendChild(anatF);
  // ── HEIGHT inputs (inline, no collapsible wrapper) ────────
  var hf = cf('Height *');
  hf.innerHTML +=
    '<div class="row" id="hi-'+slot+'">' +
      '<input id="ft-'+slot+'" class="builder-input numInput" type="number" min="0" max="99" value="'+(ex?safeHFt(ex.height):6)+'" />' +
      '<span class="sep">ft</span>' +
      '<input id="in-'+slot+'" class="builder-input numInput" type="number" min="0" max="11" value="'+(ex?safeHIn(ex.height):0)+'" />' +
      '<span class="sep">in</span>' +
    '</div>' +
    '<div class="row" id="hm-'+slot+'" style="display:none">' +
      '<input id="cm-'+slot+'" class="builder-input numInput" type="number" min="0" max="999" value="'+(ex?Math.round(inToCm(ex.height)):183)+'" />' +
      '<span class="sep">cm</span>' +
    '</div>';
  wrap.appendChild(hf);

  // ── IMAGES section ──────────────────────────────────────────
  // Declare all image-related variables here for use across sub-tabs.
  // For a NEW character (no existing record) the image source defaults to
  // Upload / Link; an existing character keeps whatever it was saved with.
  // A character counts as "new" for defaulting purposes when it has no saved
  // image configuration yet (the "+ New Character" stub has none). Such chars
  // default every image source to Upload / Link; once a source/silhouette has
  // been chosen and saved, that choice is respected on re-open.
  var hasAnyImgConfig = !!(ex && (
    ex.image || ex.i_has_img || ex.default_silhouette ||
    ex.length_image || ex.default_length_silhouette ||
    ex.profile_image || ex.default_headshot_silhouette
  ));
  var isNewChar = !hasAnyImgConfig;
  var curHSilId = (ex && ex.default_silhouette) || (DEFAULTS.heightSils[0] && DEFAULTS.heightSils[0].id) || '';
  var hasHUpload = !!(ex && (ex.image || ex.i_has_img));
  var hselVal = hasHUpload ? 'upload' : (isNewChar ? 'upload' : curHSilId);
  var hasCustomLImg = ex && ex.length_image && ex.length_image.startsWith('data');
  var curLSil = (ex && ex.default_length_silhouette) || (DEFAULTS.lengthSils[0] && DEFAULTS.lengthSils[0].id) || '';
  var lsilVal = hasCustomLImg ? 'custom' : (isNewChar ? 'custom' : curLSil);
  var exFlip = ex && ex.length_orient_flip;
  var exRot  = ex && ex.length_orient_rotate ? ex.length_orient_rotate : 0;
  var exHeadroom = ex && ex.headroom_pct ? ex.headroom_pct : 0;
  // Restore saved crop values — applied after form is built
  var exCrops = { i: (ex&&ex.crop_i)||null, l: (ex&&ex.crop_l)||null, p: (ex&&ex.crop_p)||null };
  var curPSilId = (ex && ex.default_headshot_silhouette) || (DEFAULTS.headshotSils[0] && DEFAULTS.headshotSils[0].id) || '';
  var hasPUpload = !!(ex && ex.profile_image);
  var pselVal = hasPUpload ? 'upload' : (isNewChar ? 'upload' : curPSilId);

  var imagesDet = makeDet('Images', true, 'section-images');
  var imagesBody = imagesDet.querySelector('.det-body');

  // ── Sub-tab bar ─────────────────────────────────────────────
  var tabBar = el('div'); tabBar.className = 'img-subtab-bar';
  var tabs = ['height', 'length', 'profile'];
  var tabLabels = { height: 'Height', length: 'Length', profile: 'Profile' };
  tabs.forEach(function(t) {
    var btn = el('button');
    btn.className = 'img-subtab-btn' + (t === 'height' ? ' active' : '');
    btn.setAttribute('data-imgtab', t);
    btn.textContent = tabLabels[t];
    btn.addEventListener('click', function() {
      tabBar.querySelectorAll('.img-subtab-btn').forEach(function(b){ b.classList.remove('active'); });
      btn.classList.add('active');
      imagesBody.querySelectorAll('.img-subtab-panel').forEach(function(p){ p.style.display = 'none'; });
      var panel = imagesBody.querySelector('.img-subtab-panel[data-imgtab="'+t+'"]');
      if (panel) panel.style.display = '';
    });
    tabBar.appendChild(btn);
  });
  imagesBody.appendChild(tabBar);

  // ── HEIGHT sub-tab ──────────────────────────────────────────
  var htPanel = el('div');
  htPanel.className = 'img-subtab-panel';
  htPanel.setAttribute('data-imgtab', 'height');

  var himgF = cf('Height image');
  himgF.innerHTML +=
    '<select class="builder-input hsilh-sel" id="hsilh-'+slot+'">' +
      DEFAULTS.heightSils.map(function(s){return '<option value="'+s.id+'"'+(hselVal===s.id?' selected':'')+'>'+s.label+'</option>';}).join('') +
      '<option value="upload"'+(hselVal==='upload'?' selected':'')+'>Upload / Link image</option>' +
    '</select>';
  htPanel.appendChild(himgF);

  var hUpload = uploadSection(slot, 'i', 'Height image', ex&&ex.image?ex.image:'');
  hUpload.id = 'hupload-'+slot;
  hUpload.style.display = hselVal==='upload'?'':'none';
  htPanel.appendChild(hUpload);

  var hrf = cf('Top offset');
  hrf.id = 'hheadroom-'+slot;
  hrf.style.display = hasHUpload ? '' : 'none';
  hrf.innerHTML +=
    '<div class="cf-hint" style="margin-bottom:.3rem">Extra space above head for hair, ears, hats, etc.</div>' +
    '<div class="row" style="align-items:center;gap:.5rem">'+
      '<button class="unit-btn headroom-open" id="headroom-open-'+slot+'" data-slot="'+slot+'">✎ Set offset</button>'+
      '<span class="cf-hint" id="headroom-lbl-'+slot+'">'+exHeadroom+'%</span>'+
    '</div>'+
    '<input type="hidden" id="headroom-'+slot+'" step="0.5" value="'+exHeadroom+'" />';
  htPanel.appendChild(hrf);

  var pf = cf('Pose');
  pf.id = 'hpose-'+slot;
  pf.style.display = hasHUpload ? '' : 'none';
  pf.innerHTML += '<div class="cf-hint" style="margin-bottom:.3rem">Adjust if image shows seated or crouching</div>' +
    '<select class="builder-input" id="pose-'+slot+'">' +
    (DEFAULTS.poses.length ? DEFAULTS.poses : POSES_FALLBACK).map(function(p){return '<option value="'+p.v+'"'+(p.v===exCorr?' selected':'')+'>'+p.l+'</option>';}).join('') +
    '</select>';
  htPanel.appendChild(pf);
  imagesBody.appendChild(htPanel);

  // ── LENGTH sub-tab ──────────────────────────────────────────
  var lenPanel = el('div');
  lenPanel.className = 'img-subtab-panel';
  lenPanel.setAttribute('data-imgtab', 'length');
  lenPanel.style.display = 'none';

  var lsildWrap = el('div'); lsildWrap.id = 'lsild-'+slot;
  var lsf = cf('Length image');
  var lsilOpts = DEFAULTS.lengthSils.map(function(s){
    return '<option value="'+s.id+'"'+(lsilVal===s.id?' selected':'')+'>'+s.label+'</option>';
  }).join('');
  lsf.innerHTML +=
    '<select class="builder-input lsil-sel" id="lsil-'+slot+'">' +
      lsilOpts +
      '<option value="custom"'+(lsilVal==='custom'?' selected':'')+'>Upload / Link image</option>' +
    '</select>';
  lsildWrap.appendChild(lsf);

  var lUpload = uploadSection(slot, 'l', 'Custom length image', hasCustomLImg?(ex.length_image||''):'');
  lUpload.style.display = lsilVal === 'custom' ? '' : 'none';
  lUpload.id = 'lupload-'+slot;
  lsildWrap.appendChild(lUpload);

  var orientF = cf('Image orientation');
  orientF.id = 'lorient-'+slot;
  var hasLengthImg = lsilVal === 'custom' && !!(ex && ex.length_image);
  orientF.style.display = hasLengthImg ? '' : 'none';
  orientF.innerHTML +=
    '<div class="btn-row">' +
      '<label class="orient-check"><input type="checkbox" id="lflip-'+slot+'"'+(exFlip?' checked':'')+' /> Flip horizontally</label>' +
    '</div>' +
    '<div class="cf-label" style="margin-top:.5rem;margin-bottom:.3rem">Rotate</div>' +
    '<div class="btn-row">' +
      '<button class="unit-btn lrot-btn'+(exRot===0?' active':'')+'" data-slot="'+slot+'" data-rot="0">0°</button>' +
      '<button class="unit-btn lrot-btn'+(exRot===45?' active':'')+'" data-slot="'+slot+'" data-rot="45">45°</button>' +
      '<button class="unit-btn lrot-btn'+(exRot===90?' active':'')+'" data-slot="'+slot+'" data-rot="90">90°</button>' +
      '<button class="unit-btn lrot-btn'+(exRot===135?' active':'')+'" data-slot="'+slot+'" data-rot="135">135°</button>' +
      '<button class="unit-btn lrot-btn'+(exRot===180?' active':'')+'" data-slot="'+slot+'" data-rot="180">180°</button>' +
      '<button class="unit-btn lrot-btn'+(exRot===225?' active':'')+'" data-slot="'+slot+'" data-rot="225">225°</button>' +
      '<button class="unit-btn lrot-btn'+(exRot===270?' active':'')+'" data-slot="'+slot+'" data-rot="270">270°</button>' +
      '<button class="unit-btn lrot-btn'+(exRot===315?' active':'')+'" data-slot="'+slot+'" data-rot="315">315°</button>' +
    '</div>';
  lsildWrap.appendChild(orientF);
  lenPanel.appendChild(lsildWrap);
  imagesBody.appendChild(lenPanel);

  // ── PROFILE sub-tab ─────────────────────────────────────────
  var profPanel = el('div');
  profPanel.className = 'img-subtab-panel';
  profPanel.setAttribute('data-imgtab', 'profile');
  profPanel.style.display = 'none';

  var pimgF = cf('Profile image');
  pimgF.innerHTML +=
    '<select class="builder-input psil-sel" id="psil-'+slot+'">' +
      DEFAULTS.headshotSils.map(function(s){
        return '<option value="'+s.id+'"'+(pselVal===s.id?' selected':'')+'>'+s.label+'</option>';
      }).join('') +
      '<option value="upload"'+(pselVal==='upload'?' selected':'')+'>Upload / Link image</option>' +
    '</select>';
  profPanel.appendChild(pimgF);

  var pUpload = uploadSection(slot, 'p', 'Profile / Headshot', ex&&ex.profile_image?ex.profile_image:'');
  pUpload.id = 'pupload-'+slot;
  pUpload.style.display = pselVal==='upload'?'':'none';
  profPanel.appendChild(pUpload);
  imagesBody.appendChild(profPanel);
  wrap.appendChild(imagesDet);

  // ── LENGTH section ──────────────────────────────
  var lengthDet = makeDet('Length', false, 'section-length');
  lengthDet.classList.add('custom'+slot+'-length-section');
  var lengthBody = lengthDet.querySelector('.det-body');

  // Length — three modes (preset / calculate / manual)
  var lf = cf('Anatomy Length');
  var exLen = ex&&ex.length ? ex.length : null;
  lf.innerHTML +=
    // Mode toggle
    '<div class="btn-row" style="margin-bottom:.4rem">' +
      '<button class="unit-btn lmode'+((!ex||ex.length_mode==="preset")?" active":"")+'" data-slot="'+slot+'" data-m="preset">Preset</button>' +
      '<button class="unit-btn lmode'+(ex&&ex.length_mode==="calc"?" active":"")+'" data-slot="'+slot+'" data-m="calc">Calculate</button>' +
      '<button class="unit-btn lmode'+(ex&&ex.length_mode==="manual"?" active":"")+'" data-slot="'+slot+'" data-m="manual">Manual</button>' +
    '</div>' +
    // Preset panel
    '<div id="lprep-'+slot+'" style="'+(ex&&ex.length_mode&&ex.length_mode!=='preset'?'display:none':'')+'">' +
      '<select class="builder-input" id="lpsel-'+slot+'">' +
        DEFAULTS.lengthPresets.map(function(p){
          var defSel = ex&&ex.length_preset
            ? (String(p.inches)===String(ex.length_preset))
            : (exLen ? Math.abs(p.inches-exLen)<0.1 : (p.id==='average'||p.label==='Average'));
          return '<option value="'+p.inches+'"'+(defSel?' selected':'')+'>'+p.label+'</option>';
        }).join('') +
      '</select>' +
      '<div class="wt-est" id="lpest-'+slot+'"></div>' +
    '</div>' +
    // Calculate panel
    '<div id="lcalc-'+slot+'" style="'+(ex&&ex.length_mode==='calc'?'':'display:none')+'">' +
      '<div class="cf-hint" style="margin-bottom:.3rem">Length at 6ft — scales linearly to character height</div>' +
      '<div class="row">' +
        '<input id="lref-'+slot+'" class="builder-input numInput" type="number" min="0" step="1" value="'+(ex&&ex.length_calc_ref?ex.length_calc_ref:6)+'" />' +
        '<span class="sep" id="lrunit-'+slot+'">'+(!S.metric?'in at 6ft':'cm at 183cm')+'</span>' +
      '</div>' +
      '<div class="wt-est" id="lcres-'+slot+'"></div>' +
    '</div>' +
    // Manual panel
    '<div id="lman-'+slot+'" style="'+(ex&&ex.length_mode==='manual'?'':'display:none')+'">' +
      '<div class="row" id="li-'+slot+'">' +
        '<input id="lin-'+slot+'" class="builder-input numInput" type="number" min="0" step="1" value="'+(exLen?Math.round(exLen):6)+'" />' +
        '<span class="sep">in</span>' +
      '</div>' +
      '<div class="row" id="lmi-'+slot+'" style="display:none">' +
        '<input id="lcm-'+slot+'" class="builder-input numInput" type="number" min="0" step="1" value="'+(exLen?Math.round(inToCm(exLen)):Math.round(inToCm(6)))+'" />' +
        '<span class="sep">cm</span>' +
      '</div>' +
    '</div>';
  lengthBody.appendChild(lf);

  wrap.appendChild(anatDet);
  wrap.appendChild(lengthDet);

  // ── STATS section ───────────────────────────────
  var statsDet = makeDet('Stats', false, 'section-stats');
  var statsBody = statsDet.querySelector('.det-body');

  // Weight
  var wf = cf('Weight');
  wf.innerHTML +=
    '<div class="btn-row" style="margin-bottom:.4rem">' +
      '<button class="unit-btn wm'+((!ex||!ex.weight_mode||ex.weight_mode==="build")?" active":"")+'" data-slot="'+slot+'" data-m="build">From build</button>' +
      '<button class="unit-btn wm'+(ex&&ex.weight_mode==="calc"?" active":"")+'" data-slot="'+slot+'" data-m="calc">Calculate</button>' +
      '<button class="unit-btn wm'+(ex&&ex.weight_mode==="manual"?" active":"")+'" data-slot="'+slot+'" data-m="manual">Manual</button>' +
    '</div>' +
    '<div id="wb-'+slot+'" style="'+(ex&&ex.weight_mode&&ex.weight_mode!=='build'?'display:none':'')+'">'+
      '<select class="builder-input" id="bsel-'+slot+'"></select>' +
      '<div class="wt-est" id="best-'+slot+'"></div>' +
    '</div>' +
    '<div id="wc-'+slot+'" style="'+(ex&&ex.weight_mode==='calc'?'':'display:none')+'">'+
      '<div class="cf-hint" style="margin-bottom:.3rem">Weight at 6ft — scales to character height</div>' +
      '<div class="row">' +
        '<input id="ref-'+slot+'" class="builder-input numInput" type="number" min="0" value="'+(ex&&ex.weight_calc_ref?ex.weight_calc_ref:170)+'" />' +
        '<span class="sep" id="runit-'+slot+'">'+(!S.metric?'lbs at 6ft':'kg at 183cm')+'</span>' +
      '</div>' +
      '<div class="wt-est" id="cres-'+slot+'"></div>' +
    '</div>' +
    '<div id="wm-'+slot+'" style="'+(ex&&ex.weight_mode==='manual'?'':'display:none')+'">'+
      '<div class="row" id="wmi-'+slot+'">' +
        '<input id="lbs-'+slot+'" class="builder-input numInput" type="number" min="0" value="'+(ex&&ex.weight?Math.round(ex.weight):170)+'" />' +
        '<span class="sep">lbs</span>' +
      '</div>' +
      '<div class="row" id="wmm-'+slot+'" style="display:none">' +
        '<input id="kg-'+slot+'" class="builder-input numInput" type="number" min="0" value="'+(ex&&ex.weight?Math.round(lbsToKg(ex.weight)):Math.round(lbsToKg(170)))+'" />' +
        '<span class="sep">kg</span>' +
      '</div>' +
    '</div>';
  statsBody.appendChild(wf);
  wrap.appendChild(statsDet);

  // Populate builds AFTER statsDet is in the DOM so getElementById works
  var bsel = document.getElementById('bsel-'+slot);
  if (bsel) {
    S.builds.forEach(function(b){var o=el('option');o.value=b.id;o.textContent=b.label;bsel.appendChild(o);});
    bsel.value = (ex&&ex.weight_build) ? ex.weight_build : 'average';
  }

  wireForm(slot, wrap);
  refreshEst(slot);
  refreshLengthPreset(slot);
  refreshLengthCalc(slot);

  // ── Anatomy toggle wiring ──────────────────────
  ['breasts','penis','vag'].forEach(function(key) {
    var btn = g('anat-'+key+'-'+slot);
    if (!btn) return;
    btn.addEventListener('click', function() {
      btn.classList.toggle('active');
      autoSave(slot);
      if (key === 'penis') updateLengthVisibility(slot);
      if (key === 'breasts') {
        var bustRow = g('bust-row-'+slot);
        if (bustRow) bustRow.style.display = btn.classList.contains('active') ? '' : 'none';
      }
    });
  });
  var bustSel = g('bust-sel-'+slot);
  if (bustSel) bustSel.addEventListener('change', function(){ autoSave(slot); });
  updateLengthVisibility(slot);

  // Restore saved crop values into hidden inputs (only if image hasn't changed)
  ['i','l','p'].forEach(function(pfx) {
    var saved = exCrops[pfx];
    if (!saved) return;
    var fields = { ct: pfx+'ct-'+slot, cb: pfx+'cb-'+slot, cl2: pfx+'cl2-'+slot, cr: pfx+'cr-'+slot };
    Object.keys(fields).forEach(function(key) {
      var el2 = g(fields[key]);
      if (el2 && saved[key === 'cl2' ? 'cl' : key] !== undefined) {
        el2.value = saved[key === 'cl2' ? 'cl' : key];
      }
    });
    // Update the visible crop lines to match
    updateLinesP(slot, pfx);
  });
}

// Build a collapsible section
function makeDet(label, open, modifier) {
  var d = el('div'); d.className = 'form-section' + (modifier ? ' ' + modifier : '');
  d.innerHTML =
    '<details class="form-det"'+(open?' open':'')+'>'+
      '<summary class="form-det-summary">'+label+'</summary>'+
      '<div class="det-body"></div>'+
    '</details>';

  return d;
}

// Build one image upload block (no outer cf wrapper)
function uploadSection(slot, pfx, label, existingImg) {
  var d = el('div'); d.className = 'upload-block';
  var exCorr2 = ''; // not used here
  d.innerHTML =
    '<div class="cf-label" style="margin-bottom:.3rem">'+label+'</div>'+
    '<input id="'+pfx+'url-'+slot+'" class="builder-input" type="text" placeholder="Paste URL..." value="'+(existingImg&&existingImg.startsWith('http')?existingImg:'')+'" style="margin-bottom:.35rem" />'+
    '<div class="custom-or">or upload</div>'+
    '<input id="'+pfx+'file-'+slot+'" type="file" accept="image/*" class="file-input" />'+
    '<div id="'+pfx+'pw-'+slot+'" style="'+(existingImg?'':'display:none')+';margin-top:.5rem">'+
      '<div class="upload-preview-row">'+
        '<img id="'+pfx+'pre-'+slot+'" class="prev-img" src="'+(existingImg||'')+'" alt="preview" />'+
        '<div class="upload-preview-btns">'+
          '<button class="unit-btn '+pfx+'crop-open" data-slot="'+slot+'" data-pfx="'+pfx+'">✂ Crop</button>'+
          '<button class="unit-btn '+pfx+'remove-btn" data-slot="'+slot+'" data-pfx="'+pfx+'" style="color:var(--wine)">✕ Remove</button>'+
        '</div>'+
      '</div>'+
      // Hidden inputs so crop values persist (still read by applyCropP)
      '<input type="hidden" id="'+pfx+'ct-'+slot+'" value="0" />'+
      '<input type="hidden" id="'+pfx+'cb-'+slot+'" value="0" />'+
      '<input type="hidden" id="'+pfx+'cl2-'+slot+'" value="0" />'+
      '<input type="hidden" id="'+pfx+'cr-'+slot+'" value="0" />'+
      // Crop image source (used by applyCropP) — hidden from main UI
      '<div id="'+pfx+'ciwrap-'+slot+'" style="display:none">'+
        '<img id="'+pfx+'csrc-'+slot+'" class="crop-src" src="" alt="" />'+
        '<div class="crop-line crop-line-t" id="'+pfx+'cl-t-'+slot+'"></div>'+
        '<div class="crop-line crop-line-b" id="'+pfx+'cl-b-'+slot+'"></div>'+
        '<div class="crop-line crop-line-l" id="'+pfx+'cl-l-'+slot+'"></div>'+
        '<div class="crop-line crop-line-r" id="'+pfx+'cl-r-'+slot+'"></div>'+
      '</div>'+
    '</div>';
  return d;
}


// ── Form helpers ──────────────────────────────────────────────
function el(tag) { return document.createElement(tag); }
function inp(type,id,ph,val) {
  var i=el('input');i.type=type;i.id=id;i.className='builder-input';
  i.placeholder=ph||'';if(val!==undefined)i.value=val;return i;
}
function field(label, inputEl) {
  var f=cf(label); f.appendChild(inputEl); return f;
}
function cf(label) {
  var d=el('div');d.className='cf';
  var l=el('div');l.className='cf-label';l.textContent=label;d.appendChild(l);
  return d;
}


// ── Headroom popup ────────────────────────────────────────────
function openHeadroomPopup(slot) {
  var existing = document.getElementById('sr-headroom-popup');
  if (existing) existing.remove();

  var overlay = document.createElement('div');
  overlay.id = 'sr-headroom-popup';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:99999;display:flex;align-items:center;justify-content:center;padding:1.5rem;background:rgba(0,0,0,0.82);';

  var currentPct = parseFloat((document.getElementById('headroom-'+slot)||{}).value) || 0;

  var box = document.createElement('div');
  box.className = 'sr-crop-box';
  box.innerHTML =
    '<div class="sr-crop-header">'+
      '<span class="sr-crop-title">Set Top Offset</span>'+
      '<button id="sr-hr-close" class="unit-btn" style="color:var(--wine)">✕ Close</button>'+
    '</div>'+
    '<div class="sr-crop-preview">'+
      '<div class="sr-headroom-imgwrap" id="sr-hr-imgwrap">'+
        '<img id="sr-hr-img" src="" alt="" class="sr-crop-bigimg" />'+
        '<div class="sr-hr-shade" id="sr-hr-shade" style="height:'+currentPct+'%"></div>'+
        '<div class="sr-hr-line" id="sr-hr-line" style="top:'+currentPct+'%"></div>'+
      '</div>'+
    '</div>'+
    '<div class="sr-crop-controls">'+
      '<div class="cf-hint" style="margin-bottom:.5rem">Drag the green line to where the head begins. Shaded area above is headroom.</div>'+
      '<div class="crop-pct-grid">'+
        '<div class="crop-pct-row"><div class="crop-pct-label">Top offset %</div><input type="number" class="builder-input crop-pct-input" id="sr-hr-inp" min="0" max="99" step="0.5" value="'+currentPct+'" /></div>'+
      '</div>'+
      '<div class="sr-crop-actions">'+
        '<button id="sr-hr-reset" class="unit-btn">Reset</button>'+
        '<button id="sr-hr-apply" class="btn-primary">Apply</button>'+
      '</div>'+
    '</div>';

  overlay.appendChild(box);
  document.documentElement.appendChild(overlay);

  // Load cropped preview image
  var preImg = document.getElementById('ipre-'+slot) || document.getElementById('pre-'+slot);
  var hrImg = document.getElementById('sr-hr-img');
  if (preImg && preImg.src) hrImg.src = preImg.src;

  function updateLine() {
    var pct = Math.min(99, Math.max(0, parseFloat(document.getElementById('sr-hr-inp').value)||0));
    var line = document.getElementById('sr-hr-line');
    var shade = document.getElementById('sr-hr-shade');
    if (line)  line.style.top   = pct+'%';
    if (shade) shade.style.height = pct+'%';
  }
  updateLine();

  document.getElementById('sr-hr-inp').addEventListener('input', updateLine);

  // Draggable line
  var lineEl = document.getElementById('sr-hr-line');
  var startY = 0, startVal = 0, dragging = false;
  lineEl.addEventListener('mousedown', function(e) {
    e.preventDefault(); dragging = true;
    startY = e.clientY;
    startVal = parseFloat(document.getElementById('sr-hr-inp').value)||0;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
  });
  lineEl.addEventListener('touchstart', function(e) {
    e.preventDefault(); dragging = true;
    startY = e.touches[0].clientY;
    startVal = parseFloat(document.getElementById('sr-hr-inp').value)||0;
    document.addEventListener('touchmove', onMove, {passive:false});
    document.addEventListener('touchend', onEnd);
  }, {passive:false});

  function onMove(e) {
    if (!dragging) return;
    if (e.cancelable) e.preventDefault();
    var clientY = e.touches ? e.touches[0].clientY : e.clientY;
    var wrap = document.getElementById('sr-hr-imgwrap');
    var imgEl = document.getElementById('sr-hr-img');
    if (!wrap || !imgEl) return;
    var nat = getNaturalRenderedSize(imgEl, wrap);
    var delta = clientY - startY;
    var pct = Math.round(delta / nat.h * 200) / 2; // 0.5 intervals
    var inp = document.getElementById('sr-hr-inp');
    if (!inp) return;
    inp.value = Math.min(99, Math.max(0, Math.round((startVal + pct) * 2) / 2));
    updateLine();
  }
  function onEnd() {
    dragging = false;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onEnd);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onEnd);
  }

  document.getElementById('sr-hr-reset').addEventListener('click', function() {
    document.getElementById('sr-hr-inp').value = 0;
    updateLine();
  });

  document.getElementById('sr-hr-apply').addEventListener('click', function() {
    var val = Math.min(99, Math.max(0, Math.round((parseFloat(document.getElementById('sr-hr-inp').value)||0) * 2) / 2));
    var hidInp = document.getElementById('headroom-'+slot);
    if (hidInp) hidInp.value = val;
    var lbl = document.getElementById('headroom-lbl-'+slot);
    if (lbl) lbl.textContent = val+'%';
    autoSave(slot);
    render();
    overlay.remove();
  });

  document.getElementById('sr-hr-close').addEventListener('click', function() { overlay.remove(); });
  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
}

// ── Crop popup ───────────────────────────────────────────────
function openCropPopup(slot, pfx) {
  var existing = document.getElementById('sr-crop-popup');
  if (existing) existing.remove();

  var overlay = el('div');
  overlay.id = 'sr-crop-popup';
  overlay.className = 'sr-crop-overlay';
  // Ensure overlay escapes any CSS transform stacking context
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:99999;display:flex;align-items:center;justify-content:center;padding:1.5rem;background:rgba(0,0,0,0.82);';

  var box = el('div');
  box.className = 'sr-crop-box';

  // Read current crop values
  function getVal(id) { var el2 = g(pfx+id+'-'+slot); return el2 ? el2.value : '0'; }

  box.innerHTML =
    '<div class="sr-crop-header">'+
      '<span class="sr-crop-title">Crop Image</span>'+
      '<button id="sr-crop-close" class="unit-btn" style="color:var(--wine)">✕ Close</button>'+
    '</div>'+
    '<div class="sr-crop-preview">'+
      '<div class="sr-crop-imgwrap" id="sr-crop-imgwrap">'+
        '<img id="sr-crop-bigimg" src="" alt="" class="sr-crop-bigimg" />'+
        '<div class="crop-shade crop-shade-t" id="sr-cpop-shade-t"></div>'+
        '<div class="crop-shade crop-shade-b" id="sr-cpop-shade-b"></div>'+
        '<div class="crop-shade crop-shade-l" id="sr-cpop-shade-l"></div>'+
        '<div class="crop-shade crop-shade-r" id="sr-cpop-shade-r"></div>'+
        '<div class="crop-line crop-line-t" id="sr-cpop-cl-t"></div>'+
        '<div class="crop-line crop-line-b" id="sr-cpop-cl-b"></div>'+
        '<div class="crop-line crop-line-l" id="sr-cpop-cl-l"></div>'+
        '<div class="crop-line crop-line-r" id="sr-cpop-cl-r"></div>'+
      '</div>'+
    '</div>'+
    '<div class="sr-crop-controls">'+
      '<div class="crop-pct-grid">'+
        '<div class="crop-pct-row"><div class="crop-pct-label">Top %</div><input type="number" class="builder-input crop-pct-input" step="0.5" id="pop-ct-'+slot+pfx+'" min="0" max="99" value="'+getVal('ct')+'" /></div>'+
        '<div class="crop-pct-row"><div class="crop-pct-label">Bottom %</div><input type="number" class="builder-input crop-pct-input" step="0.5" id="pop-cb-'+slot+pfx+'" min="0" max="99" value="'+getVal('cb')+'" /></div>'+
        '<div class="crop-pct-row"><div class="crop-pct-label">Left %</div><input type="number" class="builder-input crop-pct-input" step="0.5" id="pop-cl2-'+slot+pfx+'" min="0" max="99" value="'+getVal('cl2')+'" /></div>'+
        '<div class="crop-pct-row"><div class="crop-pct-label">Right %</div><input type="number" class="builder-input crop-pct-input" step="0.5" id="pop-cr-'+slot+pfx+'" min="0" max="99" value="'+getVal('cr')+'" /></div>'+
      '</div>'+
      '<div class="sr-crop-actions">'+
        '<button id="sr-crop-reset" class="unit-btn">Reset</button>'+
        '<button id="sr-crop-apply" class="btn-primary">Apply crop</button>'+
      '</div>'+
    '</div>';

  overlay.appendChild(box);
  document.documentElement.appendChild(overlay); // outside any CSS transform stacking context

  // Load image into popup preview
  var bigImg = document.getElementById('sr-crop-bigimg');
  var srcImg = document.getElementById(pfx+'csrc-'+slot);
  // Try inline src first, then cropImgs cache (loaded from IndexedDB), then preview img
  var imgSrc = (srcImg && srcImg.src && !srcImg.src.endsWith('/')) ? srcImg.src
    : (cropImgs[pfx+slot] ? cropImgs[pfx+slot].src : '');
  if (!imgSrc) {
    // Fall back to preview img src (shown by IndexedDB load)
    var preEl = document.getElementById(pfx+'pre-'+slot);
    if (preEl && preEl.src && !preEl.src.endsWith('/')) imgSrc = preEl.src;
  }
  if (bigImg && imgSrc) {
    bigImg.src = imgSrc;
    // Also backfill csrc so future crop opens work without re-fetching
    if (srcImg && !srcImg.src) srcImg.src = imgSrc;
    if (!cropImgs[pfx+slot]) {
      var _ci = new Image(); _ci.crossOrigin = 'anonymous';
      _ci.onload = function() { cropImgs[pfx+slot] = _ci; };
      _ci.src = imgSrc;
    }
  }

  // Update popup crop lines
  function updatePopLines() {
    var ct  = parseFloat(document.getElementById('pop-ct-'+slot+pfx).value)||0;
    var cb  = parseFloat(document.getElementById('pop-cb-'+slot+pfx).value)||0;
    var cl2 = parseFloat(document.getElementById('pop-cl2-'+slot+pfx).value)||0;
    var cr  = parseFloat(document.getElementById('pop-cr-'+slot+pfx).value)||0;
    // Lines
    var t = document.getElementById('sr-cpop-cl-t'); if(t) t.style.top    = ct+'%';
    var b = document.getElementById('sr-cpop-cl-b'); if(b) b.style.bottom = cb+'%';
    var l = document.getElementById('sr-cpop-cl-l'); if(l) l.style.left   = cl2+'%';
    var r = document.getElementById('sr-cpop-cl-r'); if(r) r.style.right  = cr+'%';
    // Shade overlays
    var st = document.getElementById('sr-cpop-shade-t'); if(st) st.style.height = ct+'%';
    var sb = document.getElementById('sr-cpop-shade-b'); if(sb) sb.style.height = cb+'%';
    var sl = document.getElementById('sr-cpop-shade-l'); if(sl) { sl.style.top = ct+'%'; sl.style.bottom = cb+'%'; sl.style.width = cl2+'%'; }
    var sr2 = document.getElementById('sr-cpop-shade-r'); if(sr2) { sr2.style.top = ct+'%'; sr2.style.bottom = cb+'%'; sr2.style.width = cr+'%'; }
  }
  updatePopLines();

  ['pop-ct-','pop-cb-','pop-cl2-','pop-cr-'].forEach(function(p) {
    var inp2 = document.getElementById(p+slot+pfx);
    if (inp2) inp2.addEventListener('input', updatePopLines);
  });

  // Wire draggable crop lines in the popup
  var popLines = [
    {id:'sr-cpop-cl-t', inp:'pop-ct-'+slot+pfx,  axis:'y', dir:1},
    {id:'sr-cpop-cl-b', inp:'pop-cb-'+slot+pfx,  axis:'y', dir:-1},
    {id:'sr-cpop-cl-l', inp:'pop-cl2-'+slot+pfx, axis:'x', dir:1},
    {id:'sr-cpop-cl-r', inp:'pop-cr-'+slot+pfx,  axis:'x', dir:-1},
  ];
  popLines.forEach(function(line) {
    var lineEl = document.getElementById(line.id);
    if (!lineEl) return;
    var startPos=0, startVal=0, dragging=false;
    function clientPos(e) {
      return e.touches
        ? (line.axis==='x' ? e.touches[0].clientX : e.touches[0].clientY)
        : (line.axis==='x' ? e.clientX : e.clientY);
    }
    function onStart(e) {
      e.preventDefault(); e.stopPropagation();
      dragging = true;
      startPos = clientPos(e);
      startVal = parseFloat(document.getElementById(line.inp).value)||0;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onEnd);
      document.addEventListener('touchmove', onMove, {passive:false});
      document.addEventListener('touchend', onEnd);
    }
    function onMove(e) {
      if (!dragging) return;
      if (e.cancelable) e.preventDefault();
      var imgEl = document.getElementById('sr-crop-bigimg');
      var wrapEl = document.getElementById('sr-crop-imgwrap');
      var wrapSz = 200;
      if (imgEl && wrapEl) {
        var nat = getNaturalRenderedSize(imgEl, wrapEl);
        wrapSz = line.axis==='x' ? nat.w : nat.h;
      }
      if (!wrapSz) return;
      var delta = (clientPos(e) - startPos) * line.dir;
      var pct = Math.round(delta / wrapSz * 200) / 2; // 0.5 step
      var inpEl = document.getElementById(line.inp);
      if (!inpEl) return;
      inpEl.value = Math.min(99, Math.max(0, Math.round((startVal + pct) * 2) / 2));
      updatePopLines();
    }
    function onEnd() {
      dragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
    }
    lineEl.addEventListener('mousedown', onStart, {passive:false});
    lineEl.addEventListener('touchstart', onStart, {passive:false});
  });

  document.getElementById('sr-crop-reset').addEventListener('click', function() {
    ['pop-ct-','pop-cb-','pop-cl2-','pop-cr-'].forEach(function(p) {
      var inp2 = document.getElementById(p+slot+pfx);
      if (inp2) inp2.value = '0';
    });
    updatePopLines();
  });

  document.getElementById('sr-crop-apply').addEventListener('click', function() {
    // Write values back to hidden inputs
    var map = {ct:'pop-ct-', cb:'pop-cb-', cl2:'pop-cl2-', cr:'pop-cr-'};
    Object.keys(map).forEach(function(key) {
      var popInp = document.getElementById(map[key]+slot+pfx);
      var hidInp = g(pfx+key+'-'+slot);
      if (popInp && hidInp) hidInp.value = popInp.value;
    });
    updateLinesP(slot, pfx);
    applyCropP(slot, pfx);
    overlay.remove();
  });

  document.getElementById('sr-crop-close').addEventListener('click', function() { overlay.remove(); });
  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
}

// ── Wire form ─────────────────────────────────────────────────

var MAX_SLOTS = 10;

function createSlotRow(type) {
  type = type || 'char';
  var row = el('div'); row.className = 'sr-slot-row'; row.setAttribute('data-type', type);
  row.draggable = true;

  // Build all elements first, then append in correct order
  var handle = el('div'); handle.className = 'slot-drag-handle'; handle.title = 'Drag to reorder';
  handle.innerHTML = '&#8942;&#8942;';

  var typeLbl = el('span'); typeLbl.className = 'slot-type-lbl';
  typeLbl.textContent = type === 'char' ? 'char' : 'obj';

  var sel = el('select'); sel.className = 'sr-select slot-select';
  sel.setAttribute('data-type', type);

  var rmBtn = el('button'); rmBtn.className = 'slot-remove-btn'; rmBtn.title = 'Remove';
  rmBtn.innerHTML = '&#10005;';
  rmBtn.addEventListener('click', function() { removeSlot(row); });

  // Append in correct order: handle | type | content | remove
  row.appendChild(handle);
  row.appendChild(typeLbl);

  if (type === 'char') {
    buildSelectOptions(sel, '');
    sel.style.display = 'none';
    var pickerBtn = el('button');
    pickerBtn.className = 'sr-select slot-picker-btn';
    pickerBtn.type = 'button';
    pickerBtn.textContent = '— Select character —';
    pickerBtn.addEventListener('click', function() { openCharModal(sel); });
    sel.addEventListener('change', function() {
      var opt = sel.options[sel.selectedIndex];
      pickerBtn.textContent = opt && opt.value ? opt.textContent : '— Select character —';
    });
    row.appendChild(pickerBtn);
    row.appendChild(sel);
  } else {
    sel.innerHTML = '<option value=""></option>';
    S.objects.forEach(function(o) {
      var opt = el('option'); opt.value = o.id; opt.textContent = o.label; sel.appendChild(opt);
    });
    sel.style.display = 'none';
    var objPickerBtn = el('button');
    objPickerBtn.className = 'slot-picker-btn';
    objPickerBtn.textContent = '— Select object —';
    objPickerBtn.addEventListener('click', function() { openObjModal(sel); });
    sel.addEventListener('change', function() {
      var opt = sel.options[sel.selectedIndex];
      objPickerBtn.textContent = opt && opt.value ? opt.textContent : '— Select object —';
    });
    row.appendChild(objPickerBtn);
    row.appendChild(sel);
  }
  row.appendChild(rmBtn);

  sel.addEventListener('change', function() {
    var areaEl2 = document.getElementById('sr-canvas-area');
    if (areaEl2) {
      var h = areaEl2.clientHeight;
      if (h > 100) S.canvasH = h - 4;
    }
    renderActive();
  });

  // Drag events
  row.addEventListener('dragstart', onDragStart);
  row.addEventListener('dragover',  onDragOver);
  row.addEventListener('dragenter', onDragEnter);
  row.addEventListener('dragleave', onDragLeave);
  row.addEventListener('drop',      onDrop);
  row.addEventListener('dragend',   onDragEnd);

  return row;
}

// ── Drag-and-drop reordering ─────────────────────────────────
var dragSrc = null;

function onDragStart(e) {
  dragSrc = this;
  this.classList.add('slot-dragging');
  e.dataTransfer.effectAllowed = 'move';
  // Store empty string — we identify by reference not data
  e.dataTransfer.setData('text/plain', '');
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  return false;
}

function onDragEnter(e) {
  if (this !== dragSrc) this.classList.add('slot-drag-over');
}

function onDragLeave(e) {
  this.classList.remove('slot-drag-over');
}

function onDrop(e) {
  e.stopPropagation();
  e.preventDefault();
  if (dragSrc && dragSrc !== this) {
    var container = document.getElementById('sr-char-slots');
    var rows = Array.from(container.querySelectorAll('.sr-slot-row'));
    var srcIdx  = rows.indexOf(dragSrc);
    var destIdx = rows.indexOf(this);

    // Snapshot slot→charValue BEFORE reorder so we can migrate state keys after
    var sels = allSlotSelects();
    var slotVals = sels.map(function(sel, i) { return {idx: i, val: sel.value}; });
    if (srcIdx < destIdx) {
      container.insertBefore(dragSrc, this.nextSibling);
    } else {
      container.insertBefore(dragSrc, this);
    }
    // Reorder only changes the draw/layering order — each character keeps its
    // current sandbox position and the zoom level is unchanged. We just migrate
    // the per-slot state keys below and re-render with the new layering.

    // Migrate flip/rotation/resize state — keys include slot index, remap after reorder.
    // (Sandbox positions are keyed by character now, so they need no remapping.)
    (function() {
      var newSels = allSlotSelects();
      var moved = slotVals.slice();
      newSels.forEach(function(sel, newIdx) {
        var val = sel.value;
        if (!val) return;
        var oldEntry = null;
        for (var i = 0; i < moved.length; i++) {
          if (moved[i] && moved[i].val === val) { oldEntry = moved[i]; moved[i] = null; break; }
        }
        if (!oldEntry || oldEntry.idx === newIdx) return;
        var oldKey = oldEntry.idx + '_' + val;
        var newKey = newIdx + '_' + val;
        [S.charFlips, S.charRotations, S.heightOverrides].forEach(function(obj) {
          if (!obj) return;
          if (obj[oldKey] !== undefined) { obj[newKey] = obj[oldKey]; delete obj[oldKey]; }
        });
      });
    })();

    renderActive();
    if (S.view === 'stats') renderStatsView();
  }
}

function onDragEnd(e) {
  document.querySelectorAll('.sr-slot-row').forEach(function(r) {
    r.classList.remove('slot-dragging', 'slot-drag-over');
  });
  dragSrc = null;
}

// Place a custom character into the compare lineup: reuse an empty char slot
// if one exists, otherwise add a new slot (when under the max). Used after a
// character is first created or imported so it shows up immediately.
function addCharToLineup(charId) {
  var container = document.getElementById('sr-char-slots');
  if (!container) return;

  // Look for an existing empty char slot to fill
  var emptySel = null;
  allSlotSelects().forEach(function(sel) {
    if (emptySel) return;
    if (sel.getAttribute('data-type') === 'char' && !sel.value) emptySel = sel;
  });

  function assign(sel) {
    if (!sel) return;
    buildSelectOptions(sel, sel.value); // ensure the custom char is an option
    sel.value = charId;
    var row = sel.closest('.sr-slot-row');
    var pb = row && row.querySelector('.slot-picker-btn');
    var ch = getCustomChar(charId);
    if (pb && ch) pb.textContent = ch.name;
    sel.dispatchEvent(new Event('change'));
  }

  if (emptySel) {
    assign(emptySel);
    return;
  }
  // No empty slot — add one if there's room
  var slots = container.querySelectorAll('.sr-slot-row');
  if (slots.length >= MAX_SLOTS) return; // lineup full; leave as-is
  var row = createSlotRow('char');
  container.appendChild(row);
  updateSlotUI();
  assign(row.querySelector('.slot-select'));
}

function addSlot(type) {
  var container = document.getElementById('sr-char-slots');
  if (!container) return;
  var slots = container.querySelectorAll('.sr-slot-row');
  if (slots.length >= MAX_SLOTS) return;
  var row = createSlotRow(type || 'char');
  container.appendChild(row);
  updateSlotUI();
  // Auto-open modal for char slots so user can pick immediately
  var newSel = row.querySelector('.slot-select');
  if ((type || 'char') === 'char') {
    if (newSel) openCharModal(newSel);
  } else if (type === 'obj') {
    if (newSel) openObjModal(newSel);
  }
}

function removeSlot(row) {
  var container = document.getElementById('sr-char-slots');
  if (!container) return;
  if (container.querySelectorAll('.sr-slot-row').length <= 1) return;
  row.remove();
  updateSlotUI();
  renderActive();
}

// Remove the character occupying a given slot index (used by the X button on
// the bottom info cards). Removes the whole slot row if more than one exists,
// otherwise just clears the selection so the scene empties cleanly.
function removeCharBySlotIndex(slotIdx) {
  var sels = allSlotSelects();
  var sel = sels[slotIdx];
  if (!sel) return;

  // Count how many slots actually hold a character/object. Never allow the
  // scene to be emptied — the last remaining one can't be removed.
  var filled = sels.filter(function(s){ return s.value; }).length;
  if (filled <= 1) return;

  var row = sel.closest('.sr-slot-row');
  var container = document.getElementById('sr-char-slots');
  var rowCount = container ? container.querySelectorAll('.sr-slot-row').length : 1;
  if (row && rowCount > 1) {
    removeSlot(row);
  } else {
    // Only one slot row but multiple values shouldn't happen; clear safely.
    sel.value = '';
    var pb = row && row.querySelector('.slot-picker-btn');
    if (pb) pb.textContent = pb.getAttribute('data-placeholder') || 'Select…';
    sel.dispatchEvent(new Event('change'));
    renderActive();
  }
}

function updateSlotUI() {
  var container = document.getElementById('sr-char-slots');
  if (!container) return;
  var slots = Array.from(container.querySelectorAll('.sr-slot-row'));
  var only1 = slots.length <= 1;
  var atMax = slots.length >= MAX_SLOTS;
  slots.forEach(function(row) {
    var btn = row.querySelector('.slot-remove-btn');
    if (btn) btn.style.visibility = only1 ? 'hidden' : 'visible';
  });
  var addBtn = document.getElementById('btn-add-slot');
  if (addBtn) addBtn.style.display = atMax ? 'none' : '';
  // Grey out the add-char / add-obj buttons at max
  var addCharBtn = document.getElementById('btn-add-char');
  var addObjBtn  = document.getElementById('btn-add-obj');
  if (addCharBtn) { addCharBtn.disabled = atMax; addCharBtn.classList.toggle('slot-add-btn-disabled', atMax); }
  if (addObjBtn)  { addObjBtn.disabled  = atMax; addObjBtn.classList.toggle('slot-add-btn-disabled', atMax); }
}


// ── Character picker modal ─────────────────────────────────────
var modalTargetSel = null;  // the slot-select that triggered the modal
var charModalSort = 'name'; // 'name' | 'height-desc' | 'height-asc'

function openCharModal(sel) {
  modalTargetSel = sel;
  var overlay = document.getElementById('char-modal-overlay');
  var search  = document.getElementById('char-modal-search');
  if (!overlay) return;
  // Rebuild options so freshly created custom chars appear
  fillSelects();
  search.value = '';
  buildModalGrid('');
  overlay.style.display = 'flex';
  search.focus();
}

function closeCharModal() {
  var overlay = document.getElementById('char-modal-overlay');
  if (overlay) overlay.style.display = 'none';
  modalTargetSel = null;
}

function buildModalGrid(query) {
  var grid = document.getElementById('char-modal-grid');
  if (!grid) return;
  grid.innerHTML = '';
  var q = query.trim().toLowerCase();
  var sortMode = charModalSort || 'name';

  // Use the module's unit-aware height formatter (respects the metric toggle)
  function fmtHeight(inches) {
    if (!inches && inches !== 0) return '';
    return fH(inches);
  }

  // Sort a list of entries (each has .name and .height) by the active mode
  function applySort(list) {
    var arr = list.slice();
    if (sortMode === 'height-desc') {
      arr.sort(function(a,b){ return (b.height||0) - (a.height||0); });
    } else if (sortMode === 'height-asc') {
      arr.sort(function(a,b){ return (a.height||0) - (b.height||0); });
    } else {
      arr.sort(function(a,b){ return a.name.localeCompare(b.name); });
    }
    return arr;
  }

  function makeCard(entry) {
    var card = document.createElement('div');
    card.className = 'cpm-card';
    var imgUrl = entry.img || DEFAULTS.headshot[entry.sil] || DEFAULTS.headshot.giantess || '';
    var isReal = !!entry.img;
    var imgThumb = (window.SinverseImg ? SinverseImg.thumb(imgUrl, 160) : imgUrl);
    var heightLabel = fmtHeight(entry.height);
    card.innerHTML =
      '<div class="cpm-img-wrap">' +
        '<img class="cpm-img'+(isReal?'':' sr-sil-filter')+'" src="'+imgThumb+'" alt="'+entry.name+'" loading="lazy" />' +
      '</div>' +
      '<div class="cpm-name">'+entry.name+'</div>' +
      (heightLabel ? '<div class="cpm-height">'+heightLabel+'</div>' : '');
    card.addEventListener('click', function() {
      if (modalTargetSel) {
        // Rebuild options to ensure custom chars are present before setting value
        buildSelectOptions(modalTargetSel, modalTargetSel.value);
        modalTargetSel.value = entry.value;
        var pb = modalTargetSel.closest('.sr-slot-row') && modalTargetSel.closest('.sr-slot-row').querySelector('.slot-picker-btn');
        if (pb) pb.textContent = entry.name;
        modalTargetSel.dispatchEvent(new Event('change'));
      }
      closeCharModal();
    });
    return card;
  }

  // Custom characters
  var customChars2 = (loadCustom().chars||[]).filter(function(c){return c&&c.name&&c.height;});
  var filteredCustom = customChars2.filter(function(c){
    return !q || c.name.toLowerCase().indexOf(q) >= 0;
  }).map(function(c){
    return { value: c.id, name: c.name, img: c.profile_image||'', sil:'giantess', canon:false,
             height: c.height };  // true standing height, not pose-corrected
  });
  filteredCustom = applySort(filteredCustom);

  // Canon characters
  var canonEntries = [];
  S.chars.forEach(function(c) {
    canonEntries.push({value:'canon_'+c.id, name:c.name,
      img:c.profile_image||'',
      sil:c.default_headshot_silhouette||c.default_silhouette||'giantess', canon:true,
      height: c.height});  // true standing height, not pose-corrected
  });
  var filteredCanon = canonEntries.filter(function(e){
    return !q || e.name.toLowerCase().indexOf(q) >= 0;
  });
  filteredCanon = applySort(filteredCanon);

  if (!filteredCustom.length && !filteredCanon.length) {
    grid.innerHTML = '<div class="cpm-empty">No characters found</div>';
    return;
  }

  // ── Custom section (top) ─────────────────────────────────────
  if (filteredCustom.length) {
    var customLabel = document.createElement('div');
    customLabel.className = 'cpm-section-label';
    customLabel.textContent = 'My Characters';
    grid.appendChild(customLabel);
    filteredCustom.forEach(function(c) { grid.appendChild(makeCard(c)); });
  }

  // ── Canon section ────────────────────────────────────────────
  if (filteredCanon.length) {
    var canonLabel = document.createElement('div');
    canonLabel.className = 'cpm-section-label';
    canonLabel.textContent = 'Characters';
    grid.appendChild(canonLabel);
    filteredCanon.forEach(function(e) { grid.appendChild(makeCard(e)); });
  }
}

function wireCharModal() {
  var _cmc = document.getElementById('char-modal-close');
  if (_cmc) _cmc.addEventListener('click', closeCharModal);

  var resizeBd = document.getElementById('sr-resize-backdrop');
  if (resizeBd) resizeBd.addEventListener('click', closeResizePopup);
  var _cmo = document.getElementById('char-modal-overlay');
  if (_cmo) _cmo.addEventListener('click', function(e) {
    if (e.target === this) closeCharModal();
  });
  document.getElementById('char-modal-search').addEventListener('input', function() {
    buildModalGrid(this.value);
  });
  // Sort buttons
  var sortBtns = document.querySelectorAll('.char-modal-sort-btn');
  function reflectActiveSort() {
    sortBtns.forEach(function(b) {
      b.classList.toggle('active', b.getAttribute('data-sort') === charModalSort);
    });
  }
  sortBtns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      charModalSort = btn.getAttribute('data-sort');
      reflectActiveSort();
      var sv = document.getElementById('char-modal-search');
      buildModalGrid(sv ? sv.value : '');
    });
  });
  reflectActiveSort();
  // Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeCharModal();
  });
}

function wireForm(slot, wrap) {
  function save() { autoSave(slot); }

  // Name, pose
  var ni = document.getElementById('n'+slot); if(ni) ni.addEventListener('input',save);
  var ps = document.getElementById('pose-'+slot); if(ps) ps.addEventListener('change',save);
  var hr = document.getElementById('headroom-'+slot);
  if(hr) hr.addEventListener('input', function(){ save(); renderActive(); });

  // Height image dropdown
  var hsilhSel=g('hsilh-'+slot);
  if(hsilhSel) hsilhSel.addEventListener('change',function(){
    var isUp=this.value==='upload';
    var hup=g('hupload-'+slot); if(hup)hup.style.display=isUp?'':'none';
    if(isUp) {
      // Reveal pose+headroom only if an image is already loaded
      var ipw=g('ipw-'+slot);
      if(ipw && ipw.style.display!=='none') {
        var hpo=g('hpose-'+slot); if(hpo)hpo.style.display='';
        var hhr=g('hheadroom-'+slot); if(hhr)hhr.style.display='';
      }
    } else {
      // Hide and reset pose and headroom when switching away from upload
      var hpo=g('hpose-'+slot); if(hpo)hpo.style.display='none';
      var hhr=g('hheadroom-'+slot); if(hhr)hhr.style.display='none';
      // Reset headroom to 0
      var hrInp=g('headroom-'+slot); if(hrInp)hrInp.value='0';
      var hrLbl=g('headroom-lbl-'+slot); if(hrLbl)hrLbl.textContent='0%';
      // Reset pose to first option (default)
      var poseEl=g('pose-'+slot);
      if(poseEl){ poseEl.selectedIndex=0; poseEl.dispatchEvent(new Event('change')); }
    }
    save();
  });

  // Profile image dropdown
  var psilSel=g('psil-'+slot);
  if(psilSel) psilSel.addEventListener('change',function(){
    var isUp=this.value==='upload';
    var pup=g('pupload-'+slot); if(pup)pup.style.display=isUp?'':'none';
    save();
  });

  // Unit toggle handled globally via applyGlobalUnit()

  // Weight mode buttons
  wrap.querySelectorAll('.wm').forEach(function(btn){
    btn.addEventListener('click',function(){
      var m=this.getAttribute('data-m');
      wrap.querySelectorAll('.wm').forEach(function(b){b.classList.remove('active');});
      this.classList.add('active');
      g('wb-'+slot).style.display=m==='build'?'':'none';
      g('wc-'+slot).style.display=m==='calc'?'':'none';
      g('wm-'+slot).style.display=m==='manual'?'':'none';
      save();
    });
  });

  // Height inputs
  ['ft-','in-','cm-'].forEach(function(p){
    var inp2=g(p+slot); if(!inp2) return;
    inp2.addEventListener('input',function(){
      syncH(slot,S.metric); refreshEst(slot); refreshCalc(slot); refreshLengthCalc(slot); refreshLengthPreset(slot); save();
    });
  });

  // Length mode buttons
  wrap.querySelectorAll('.lmode').forEach(function(btn){
    btn.addEventListener('click',function(){
      var m=this.getAttribute('data-m');
      wrap.querySelectorAll('.lmode').forEach(function(b){b.classList.remove('active');});
      this.classList.add('active');
      g('lprep-'+slot).style.display = m==='preset'?'':'none';
      g('lcalc-'+slot).style.display = m==='calc'?'':'none';
      g('lman-'+slot).style.display  = m==='manual'?'':'none';
      refreshLengthCalc(slot); refreshLengthPreset(slot); save();
      if(S.view==='length') renderLengthView();
    updateLengthImgVisibility();
    });
  });

  // Length preset select — refresh display and force re-render of length view
  var lpsel=g('lpsel-'+slot);
  if(lpsel) lpsel.addEventListener('change',function(){
    refreshLengthPreset(slot);
    save();
    // Always re-render length view since length changed regardless of slot
    if(S.view==='length') renderLengthView();
    updateLengthImgVisibility();
  });

  // Length calc ref
  var lref=g('lref-'+slot);
  if(lref) lref.addEventListener('input',function(){
    refreshLengthCalc(slot); save();
    if(S.view==='length') renderLengthView();
  });

  // Length manual inputs — convert in one direction only, don't overwrite user input
  var linEl2=g('lin-'+slot);
  if(linEl2) linEl2.addEventListener('input',function(){
    var lcm=g('lcm-'+slot); if(lcm&&this.value) lcm.value=inToCm(parseFloat(this.value)||0).toFixed(1);
    save(); if(S.view==='length') renderLengthView();
  });
  var lcmEl2=g('lcm-'+slot);
  if(lcmEl2) lcmEl2.addEventListener('input',function(){
    var lin=g('lin-'+slot); if(lin&&this.value) lin.value=((parseFloat(this.value)||0)/2.54).toFixed(1);
    save(); if(S.view==='length') renderLengthView();
  });

  // Length silhouette selector
  var lsilSel=g('lsil-'+slot);
  if(lsilSel) lsilSel.addEventListener('change',function(){
    var isCustom=this.value==='custom';
    var lupload=g('lupload-'+slot); if(lupload)lupload.style.display=isCustom?'':'none';
    // Show orientation only if custom AND an image is already loaded
    var lpw=g('lpw-'+slot);
    var imgLoaded = !!(lpw && lpw.style.display !== 'none');
    var lorient=g('lorient-'+slot); if(lorient)lorient.style.display=(isCustom&&imgLoaded)?'':'none';
    // Reset orientation when switching away from custom (image preserved for when user returns)
    if(!isCustom) {
      // Reset flip
      var lflipEl=g('lflip-'+slot); if(lflipEl){ lflipEl.checked=false; }
      // Reset rotation to 0°
      var rotBtns=wrap.querySelectorAll('.lrot-btn');
      rotBtns.forEach(function(b){
        b.classList.toggle('active', b.getAttribute('data-rot')==='0');
      });
      // Reset preview transform
      var lpreEl=g('lpre-'+slot); if(lpreEl) lpreEl.style.transform='none';
    }
    save();
    if(S.view==='length') renderLengthView();
  });
  // Hide/show length image section based on whether character has length data
  function updateLengthImgVisibility() {
    var hasLen = getLengthIn(slot) > 0;
    var lsild = g('lsild-'+slot); if(lsild) lsild.style.display = hasLen ? '' : 'none';
  }
  updateLengthImgVisibility();

  // Length orientation — flip
  function updateLengthPreviewTransform() {
    var pre = g('lpre-'+slot); if(!pre) return;
    var flipEl = g('lflip-'+slot);
    var isFlip = flipEl && flipEl.checked;
    var rotBtn = wrap && wrap.querySelector('.lrot-btn.active');
    var rot = rotBtn ? parseInt(rotBtn.getAttribute('data-rot')) || 0 : 0;
    var transform = '';
    if (isFlip) transform += 'scaleX(-1) ';
    if (rot) transform += 'rotate('+rot+'deg)';
    pre.style.transform = transform.trim() || 'none';
    pre.style.transformOrigin = 'center center';
  }

  var lflip=g('lflip-'+slot);
  if(lflip) lflip.addEventListener('change',function(){
    updateLengthPreviewTransform();
    save(); if(S.view==='length') renderLengthView();
  });

  // Length orientation — rotate buttons
  var wrap3=document.getElementById('custom'+slot+'-form');
  if(wrap3) wrap3.querySelectorAll('.lrot-btn').forEach(function(btn){
    btn.addEventListener('click',function(){
      if(wrap3) wrap3.querySelectorAll('.lrot-btn').forEach(function(b){b.classList.remove('active');});
      this.classList.add('active');
      updateLengthPreviewTransform();
      save(); if(S.view==='length') renderLengthView();
    });
  });

  // Apply transform on initial build if values already set
  updateLengthPreviewTransform();

  // Headroom popup button
  var hrOpenBtn = g('headroom-open-'+slot);
  if (hrOpenBtn) hrOpenBtn.addEventListener('click', function() {
    openHeadroomPopup(slot);
  });

  // Build select
  var bs=g('bsel-'+slot); if(bs)bs.addEventListener('change',function(){refreshEst(slot);save();});

  // Calc ref
  var ri=g('ref-'+slot); if(ri)ri.addEventListener('input',function(){refreshCalc(slot);save();});

  // Manual weight
  ['lbs-','kg-'].forEach(function(p){var i=g(p+slot);if(i)i.addEventListener('input',save);});

  // Wire all three image upload sections via prefix
  ['i','l','p'].forEach(function(pfx) {
    // Auto-load URL on paste or after typing stops
    var urlInp=g(pfx+'url-'+slot);
    if(urlInp) {
      var urlDebounce;
      urlInp.addEventListener('paste', function() {
        clearTimeout(urlDebounce);
        urlDebounce = setTimeout(function() {
          var v = urlInp.value.trim();
          if (v) { loadImgP(slot, pfx, v); if(pfx==='l'){var lor=g('lorient-'+slot);if(lor)lor.style.display='';} }
        }, 100);
      });
      urlInp.addEventListener('input', function() {
        clearTimeout(urlDebounce);
        urlDebounce = setTimeout(function() {
          var v = urlInp.value.trim();
          if (v && (v.startsWith('http://') || v.startsWith('https://'))) { loadImgP(slot, pfx, v); if(pfx==='l'){var lor=g('lorient-'+slot);if(lor)lor.style.display='';} }
        }, 800);
      });
    }
    var rmBtn=wrap.querySelector('.'+pfx+'remove-btn');
    if(rmBtn) rmBtn.addEventListener('click',function(){
      var pw=g(pfx+'pw-'+slot); if(pw)pw.style.display='none';
      var pre=g(pfx+'pre-'+slot); if(pre)pre.src='';
      var ui=g(pfx+'url-'+slot); if(ui)ui.value='';
      cropImgs[pfx+slot]=null;
      if(pfx==='l'){var lor=g('lorient-'+slot);if(lor)lor.style.display='none';}
      deleteImg('custom_' + slot + '_' + pfx);
      // Clear the has_img flag
      var d2 = loadCustom();
      var sk2 = 'slot'+slot;
      if (d2[sk2]) { delete d2[sk2][pfx+'_has_img']; saveCustom(d2); }
      // Reset crop values
      [pfx+'ct-', pfx+'cb-', pfx+'cl2-', pfx+'cr-'].forEach(function(p) {
        var inp = g(p+slot); if (inp) inp.value = '0';
      });
      // Reset headroom + hide pose/top-offset sections if height image removed
      if (pfx === 'i') {
        var hrInp2 = g('headroom-'+slot);
        if (hrInp2) hrInp2.value = '0';
        var hrLbl2 = g('headroom-lbl-'+slot);
        if (hrLbl2) hrLbl2.textContent = '0%';
        var hpo = g('hpose-'+slot);     if(hpo) hpo.style.display = 'none';
        var hhr = g('hheadroom-'+slot); if(hhr) hhr.style.display = 'none';
      }
      save();
    });
    var fi=g(pfx+'file-'+slot);
    if(fi) fi.addEventListener('change',function(){
      var f=this.files[0]; if(!f)return;
      var r=new FileReader();
      r.onload=function(e){
        compressToWebP(e.target.result, 1200, 0.85).then(function(compressed) {
          var imgKey = 'custom_' + slot + '_' + pfx;
          storeImg(imgKey, compressed).then(function() {
            // Mark this image as stored so form build knows on next load
            var d = loadCustom();
            var key = 'slot'+slot;
            if (!d[key]) d[key] = {};
            d[key][pfx+'_has_img'] = true;
            saveCustom(d);
            loadImgP(slot, pfx, compressed);
          });
        });
      };
      r.readAsDataURL(f);
    });
    // Wire crop popup open button
    var cropOpenBtn = wrap.querySelector('.'+pfx+'crop-open');
    if (cropOpenBtn) cropOpenBtn.addEventListener('click', function() {
      openCropPopup(slot, pfx);
    });
  });
  // Draggable crop lines (height image only for now)
  // Wire crop lines for all three image prefixes
  ['i','l','p'].forEach(function(pfx2) { wireCropLinesP(slot, pfx2); });
}

// ── Height sync ───────────────────────────────────────────────
function refreshLengthPreset(slot) {
  var sel = g('lpsel-'+slot); if(!sel) return;
  var baseInches = parseFloat(sel.value)||0;
  var est = g('lpest-'+slot); if(!est) return;
  if (!baseInches) { est.textContent = 'None'; return; }
  var h = getHIn(slot) || 72;  // default to 6ft if no height set yet
  var scaled = baseInches * (h / 72);
  est.textContent = '= ' + fL(scaled) + (h !== 72 ? ' (scaled from ' + fL(baseInches) + ' at 6ft)' : '');
}

function refreshLengthCalc(slot) {
  var refEl=g('lref-'+slot), resEl=g('lcres-'+slot); if(!refEl||!resEl) return;
  var h=getHIn(slot); if(!h) return;
  var ruEl=g('lrunit-'+slot), isKg=ruEl&&ruEl.textContent.includes('cm');
  var rv=parseFloat(refEl.value)||0; if(!rv){resEl.textContent='';return;}
  var refIn = isKg ? rv/2.54 : rv;
  var scaled = refIn * (h/72);
  resEl.textContent = 'Estimated: '+fL(scaled);
}

function getLengthIn(slot) {
  var wrap=document.getElementById('custom'+slot+'-form');
  if(!wrap)return null;
  var active=wrap.querySelector('.lmode.active');
  var mode=active?active.getAttribute('data-m'):'preset';
  if(mode==='preset'){
    var sel=g('lpsel-'+slot); if(!sel){ console.log('[getLengthIn] no lpsel-'+slot); return 0; }
    var base=parseFloat(sel.value)||0;
    if(!base) return 0;
    var h=getHIn(slot)||72;
    return base*(h/72);
  }
  if(mode==='calc'){
    var refEl=g('lref-'+slot),h=getHIn(slot); if(!refEl||!h)return null;
    var ruEl=g('lrunit-'+slot),isKg=ruEl&&ruEl.textContent.includes('cm');
    var rv=parseFloat(refEl.value)||0; if(!rv)return null;
    var refIn=isKg?rv/2.54:rv; return refIn*(h/72);
  }
  // manual
  var linEl=g('lin-'+slot),lcmEl=g('lcm-'+slot);
  if(linEl&&parseFloat(linEl.value)) return parseFloat(linEl.value);
  if(lcmEl&&parseFloat(lcmEl.value)) return parseFloat(lcmEl.value)/2.54;
  return null;
}

function syncLen(slot, isM) {
  // Manual fields
  var liRow=g('li-'+slot), lmiRow=g('lmi-'+slot);
  if(liRow)  liRow.style.display  = isM?'none':'';
  if(lmiRow) lmiRow.style.display = isM?'':'none';
  var linEl=g('lin-'+slot), lcmEl=g('lcm-'+slot);
  if(linEl&&lcmEl){
    if(isM){var iv=parseFloat(linEl.value)||0;if(iv)lcmEl.value=inToCm(iv).toFixed(1);}
    else{var cv=parseFloat(lcmEl.value)||0;if(cv)linEl.value=(cv/2.54).toFixed(1);}
  }
  // Calc unit label
  var ruEl=g('lrunit-'+slot);
  if(ruEl) ruEl.textContent=isM?'cm at 183cm':'in at 6ft';
}

function syncH(slot, isM) {
  if (isM) {
    var cm=parseFloat(g('cm-'+slot).value)||0;
    var ti=cm/2.54, ft=Math.floor(ti/12), ins=Math.round(ti%12);
    if(ins===12){ft++;ins=0;}
    g('ft-'+slot).value=cm?ft:''; g('in-'+slot).value=cm?ins:'';
  } else {
    var ft2=parseFloat(g('ft-'+slot).value)||0;
    var in2=parseFloat(g('in-'+slot).value)||0;
    if(in2>=12){ft2+=Math.floor(in2/12);in2=in2%12;g('ft-'+slot).value=ft2;g('in-'+slot).value=in2;}
    g('cm-'+slot).value=(ft2||in2)?Math.round(inToCm(ft2*12+in2)):'';
  }
}

function getHIn(slot) {
  var cm=parseFloat((g('cm-'+slot)||{}).value)||0; if(cm) return cm/2.54;
  var ft=parseFloat((g('ft-'+slot)||{}).value)||0;
  var ins=parseFloat((g('in-'+slot)||{}).value)||0;
  return ft*12+ins;
}

// ── Weight ────────────────────────────────────────────────────
function isSlotMetric(slot) { return S.metric; }
function fWslot(lbs,slot) { return fW(lbs); }

function activeWeightMode(slot) {
  var wrap=document.getElementById('custom'+slot+'-form');
  if(!wrap)return'build';
  var a=wrap.querySelector('.wm.active'); return a?a.getAttribute('data-m'):'build';
}

function getWlbs(slot) {
  var m=activeWeightMode(slot);
  if(m==='manual'){
    var l=parseFloat((g('lbs-'+slot)||{}).value)||null;
    var k=parseFloat((g('kg-'+slot)||{}).value)||null;
    return l||(k?k/0.453592:null);
  }
  if(m==='calc'){
    var ri=g('ref-'+slot),h=getHIn(slot); if(!ri||!h)return null;
    var isKg=isSlotMetric(slot);
    var rv=parseFloat(ri.value)||0; if(!rv)return null;
    return (isKg?rv/0.453592:rv)*Math.pow(h/72,3);
  }
  var e=g('best-'+slot); return e&&e.getAttribute('data-lbs')?parseFloat(e.getAttribute('data-lbs')):null;
}

function refreshEst(slot) {
  var h=getHIn(slot),b=g('bsel-'+slot),e=g('best-'+slot); if(!e||!b)return;
  var w=h&&b.value?sc(h,b.value):null;
  e.textContent=w?'≈ '+fWslot(w,slot):''; if(w)e.setAttribute('data-lbs',w);else e.removeAttribute('data-lbs');
}

function refreshCalc(slot) {
  var h=getHIn(slot),ri=g('ref-'+slot),re=g('cres-'+slot); if(!re||!ri)return;
  var isKg=isSlotMetric(slot);
  var rv=parseFloat(ri.value)||0; if(!rv||!h){re.textContent='';return;}
  var rl=isKg?rv/0.453592:rv, sl=rl*Math.pow(h/72,3);
  re.textContent='Estimated: '+(isKg?Math.round(lbsToKg(sl))+' kg ('+Math.round(sl)+' lbs)':Math.round(sl)+' lbs ('+Math.round(lbsToKg(sl))+' kg)');
}

// ── Auto-save: saves data, refreshes selects, does NOT call render ──
function autoSave(slot) {
  var ni=g('n'+slot); if(!ni||!ni.value.trim())return;
  var h=getHIn(slot); if(!h)return;
  var ps=g('pose-'+slot);
  var corr=ps?parseFloat(ps.value)||1:1;
  var pi=g('ipre-'+slot);
  var img=pi&&pi.src&&!pi.src.endsWith(window.location.href)?pi.src:'';
  if(!img){var ui=g('iurl-'+slot);if(ui&&ui.value.trim().startsWith('http'))img=ui.value.trim();}

  var lsilElCheck=g('lsil-'+slot);
  var lpi=g('lpre-'+slot);
  // Only use the uploaded image if the dropdown is set to 'custom'
  var length_image='';
  if(lsilElCheck&&lsilElCheck.value==='custom'){
    length_image=lpi&&lpi.src&&!lpi.src.endsWith(window.location.href)?lpi.src:'';
    if(!length_image){var lui=g('lurl-'+slot);if(lui&&lui.value.trim().startsWith('http'))length_image=lui.value.trim();}
  }

  var ppi=g('ppre-'+slot);
  var profile_image=ppi&&ppi.src&&!ppi.src.endsWith(window.location.href)?ppi.src:'';
  if(!profile_image){var pui=g('purl-'+slot);if(pui&&pui.value.trim().startsWith('http'))profile_image=pui.value.trim();}
  var wrap2=document.getElementById('custom'+slot+'-form');
  var hsilhEl=g('hsilh-'+slot);
  var hsilhVal=hsilhEl?hsilhEl.value:'';
  var defaultSil=(hsilhVal&&hsilhVal!=='upload')?hsilhVal:((DEFAULTS.heightSils[0]&&DEFAULTS.heightSils[0].id)||'giantess');
  // If not upload, clear the height image
  if(hsilhVal&&hsilhVal!=='upload') img='';
  var psilEl=g('psil-'+slot);
  var psilVal=psilEl?psilEl.value:'';
  var defaultHSSil=(psilVal&&psilVal!=='upload')?psilVal:((DEFAULTS.headshotSils[0]&&DEFAULTS.headshotSils[0].id)||'giantess');
  if(psilVal&&psilVal!=='upload') profile_image='';

  // Save modes and selected dropdown values
  var activeLMode = (function(){
    var w2=document.getElementById('custom'+slot+'-form');
    var a=w2?w2.querySelector('.lmode.active'):null;
    return a?a.getAttribute('data-m'):'preset';
  })();
  var activeWMode = activeWeightMode(slot);
  var lpselEl = g('lpsel-'+slot);
  var bselEl  = g('bsel-'+slot);
  var lrefEl  = g('lref-'+slot);
  var wrefEl  = g('ref-'+slot);
  var lpselVal = lpselEl ? lpselEl.value : '';
  var bselVal  = bselEl  ? bselEl.value  : 'average';
  var lrefVal  = lrefEl  ? (parseFloat(lrefEl.value)||0) : 0;
  var wrefVal  = wrefEl  ? (parseFloat(wrefEl.value)||0) : 0;

  var charLen=getLengthIn(slot);

  // Length silhouette
  var lsilEl=g('lsil-'+slot);
  var defaultLenSil=lsilEl&&lsilEl.value!=='custom'?lsilEl.value:(DEFAULTS.lengthSils[0]&&DEFAULTS.lengthSils[0].id)||'default';
  var lflipEl=g('lflip-'+slot);
  var lFlip=lflipEl?lflipEl.checked:false;
  var activeLRot=wrap2?wrap2.querySelector('.lrot-btn.active'):null;
  var lRot=activeLRot?parseInt(activeLRot.getAttribute('data-rot'))||0:0;

  var hrEl=g('headroom-'+slot);
  var headroomPct=hrEl?Math.max(0,Math.min(100,parseInt(hrEl.value)||0)):0;

  // Don't overwrite good saved values with nulls from timing issues
  var prevSaved = getCustomChar('custom_'+slot) || {};
  var newWeight = getWlbs(slot);
  var newLength = charLen;
  if (newWeight === null && prevSaved.weight) newWeight = prevSaved.weight;
  if ((newLength === null || newLength === 0) && prevSaved.length) newLength = prevSaved.length;

  var char={
    id:'custom_'+slot, name:ni.value.trim(),
    height:h, height_correction:corr, headroom_pct:headroomPct,
    weight:newWeight, image:img,
    length:newLength, length_image:length_image,
    profile_image:profile_image,
    default_silhouette:defaultSil,
    default_length_silhouette:defaultLenSil,
    length_orient_flip:lFlip,
    length_orient_rotate:lRot,
    default_headshot_silhouette:defaultHSSil,
    length_mode:activeLMode, length_preset:lpselVal, length_calc_ref:lrefVal,
    weight_mode:activeWMode, weight_build:bselVal, weight_calc_ref:wrefVal,
    canonical:false, custom:true,
    crop_i:  { ct: parseFloat((g('ict-'+slot)||{}).value)||0, cb: parseFloat((g('icb-'+slot)||{}).value)||0,  cl: parseFloat((g('icl2-'+slot)||{}).value)||0, cr: parseFloat((g('icr-'+slot)||{}).value)||0  },
    crop_l:  { ct: parseFloat((g('lct-'+slot)||{}).value)||0, cb: parseFloat((g('lcb-'+slot)||{}).value)||0,  cl: parseFloat((g('lcl2-'+slot)||{}).value)||0, cr: parseFloat((g('lcr-'+slot)||{}).value)||0  },
    crop_p:  { ct: parseFloat((g('pct-'+slot)||{}).value)||0, cb: parseFloat((g('pcb-'+slot)||{}).value)||0,  cl: parseFloat((g('pcl2-'+slot)||{}).value)||0, cr: parseFloat((g('pcr-'+slot)||{}).value)||0  },
    anatomy: (function(){
      var prev = (getCustomChar('custom_'+slot)||{}).anatomy || {};
      ['breasts','penis','vag'].forEach(function(k){
        var b = g('anat-'+k+'-'+slot);
        if (b) prev[k] = b.classList.contains('active');
      });
      var bustSelEl = g('bust-sel-'+slot);
      if (bustSelEl) prev.bustSize = bustSelEl.value;
      return prev;
    })(),
  };
  var d=loadCustom(); var chars=d.chars||[];
  var idx=chars.findIndex(function(c){return c.id==='custom_'+slot;});
  if(idx>=0) chars[idx]=char; else chars.push(char);
  d.chars=chars; saveCustom(d);
  // Refresh selects preserving current values
  var sels=allSlotSelects();
  var vals=sels.map(function(s){return s.value;});
  fillSelects();
  allSlotSelects().forEach(function(s,i){s.value=vals[i]||'';});
  if(vals.some(function(v){return v==='custom_'+slot;})) {
    fillSelects();  // update picker button label if name changed
    renderActive();
    if(S.view!=='stats') renderStatsView();
  }
}

// ── Image / crop ──────────────────────────────────────────────
// ── Prefix-based image/crop functions ─────────────────────────
function loadImgP(slot, pfx, src) {
  var img=new Image(); img.crossOrigin='anonymous';
  img.onload=function(){
    cropImgs[pfx+slot]=img;
    // Reset crop and headroom when a new image is loaded
    [pfx+'ct-', pfx+'cb-', pfx+'cl2-', pfx+'cr-'].forEach(function(p) {
      var inp = g(p+slot); if (inp) inp.value = '0';
    });
    if (pfx === 'i') {
      var hrInp = g('headroom-'+slot);
      if (hrInp) hrInp.value = '0';
      var hrLbl = g('headroom-lbl-'+slot);
      if (hrLbl) hrLbl.textContent = '0%';
      var hpo = g('hpose-'+slot);     if(hpo) hpo.style.display = '';
      var hhr = g('hheadroom-'+slot); if(hhr) hhr.style.display = '';
    }
    var si=g(pfx+'csrc-'+slot);
    if(si){
      si.src=src;
      // Wait for the src image element to load so naturalWidth/Height are available
      // then re-position crop lines against actual image bounds
      si.onload=function(){
        [pfx+'ct-',pfx+'cb-',pfx+'cl2-',pfx+'cr-'].forEach(function(p){var el=g(p+slot);if(el)el.value='0';});
        updateLinesP(slot,pfx);
      };
      // If already loaded (cached), onload won't fire — handle immediately
      if(si.complete && si.naturalWidth) {
        [pfx+'ct-',pfx+'cb-',pfx+'cl2-',pfx+'cr-'].forEach(function(p){var el=g(p+slot);if(el)el.value='0';});
        updateLinesP(slot,pfx);
      }
    }
    var pre=g(pfx+'pre-'+slot); if(pre)pre.src=src;
    var pw=g(pfx+'pw-'+slot); if(pw)pw.style.display='';
    // Show orientation controls when a length image is loaded
    if(pfx==='l'){var lor=g('lorient-'+slot);if(lor)lor.style.display='';}
    autoSave(slot);
  };
  img.onerror=function(){alert('Could not load image.');};
  img.src=src;
}

function updateLinesP(slot,pfx) {
  // Position lines relative to actual rendered image, not the padded container
  var srcImg=g(pfx+'csrc-'+slot);
  var wrap=g(pfx+'ciwrap-'+slot);
  var off={w:0,h:0,offX:0,offY:0};
  if(srcImg&&wrap) off=getNaturalRenderedSize(srcImg,wrap);
  var cW=wrap?wrap.offsetWidth:0, cH=wrap?wrap.offsetHeight:0;
  var tPct=clampV(pfx+'ct-'+slot), bPct=clampV(pfx+'cb-'+slot);
  var lPct=clampV(pfx+'cl2-'+slot), rPct=clampV(pfx+'cr-'+slot);

  // Convert percentage of image to px from container edge
  var tPx=off.offY + off.h*(tPct/100);
  var bPx=(cH-off.offY) - off.h*(bPct/100);  // from bottom
  var lPx=off.offX + off.w*(lPct/100);
  var rPx=(cW-off.offX) - off.w*(rPct/100);  // from right

  // Position lines in px from their respective edges
  setLineStyle(pfx+'cl-t-'+slot,'top',    tPx+'px');
  setLineStyle(pfx+'cl-b-'+slot,'bottom', (cH-bPx)+'px');
  setLineStyle(pfx+'cl-l-'+slot,'left',   lPx+'px');
  setLineStyle(pfx+'cl-r-'+slot,'right',  (cW-rPx)+'px');
}

function setLineStyle(id, prop, val) {
  var el2=g(id); if(el2) el2.style[prop]=val;
}

function applyCropP(slot,pfx) {
  var img=cropImgs[pfx+slot]; if(!img)return;
  var t=clampV(pfx+'ct-'+slot),b=clampV(pfx+'cb-'+slot);
  var l=clampV(pfx+'cl2-'+slot),r=clampV(pfx+'cr-'+slot);
  var sx=Math.round(img.width*l/100),sy=Math.round(img.height*t/100);
  var sw=Math.max(2,Math.round(img.width*(100-l-r)/100));
  var sh=Math.max(2,Math.round(img.height*(100-t-b)/100));
  var out=el('canvas'); out.width=sw; out.height=sh;
  out.getContext('2d').drawImage(img,sx,sy,sw,sh,0,0,sw,sh);
  var pre=g(pfx+'pre-'+slot); if(pre)pre.src=out.toDataURL('image/png');
  autoSave(slot);
}

function resetCropP(slot,pfx) {
  var img=cropImgs[pfx+slot]; if(!img)return;
  [pfx+'ct-',pfx+'cb-',pfx+'cl2-',pfx+'cr-'].forEach(function(p){var el=g(p+slot);if(el)el.value='0';});
  updateLinesP(slot,pfx);
  var out=el('canvas');
  out.width=img.naturalWidth||img.width; out.height=img.naturalHeight||img.height;
  out.getContext('2d').drawImage(img,0,0);
  var pre=g(pfx+'pre-'+slot); if(pre)pre.src=out.toDataURL('image/png');
  autoSave(slot);
}

function preloadCropImgP(slot,pfx,src) {
  var img=new Image(); img.crossOrigin='anonymous';
  img.onload=function(){ cropImgs[pfx+slot]=img; var si=g(pfx+'csrc-'+slot);if(si)si.src=src; };
  img.src=src;
}

// Legacy single-image aliases (height image, prefix 'i')
function loadImg(slot,src)         { loadImgP(slot,'i',src); }
function updateLines(slot)         { updateLinesP(slot,'i'); }
function applyCrop(slot)           { applyCropP(slot,'i'); }
function resetCrop(slot)           { resetCropP(slot,'i'); }
function preloadCropImg(slot,src)  { preloadCropImgP(slot,'i',src); }

function loadImg(slot, src) {
  var img=new Image(); img.crossOrigin='anonymous';
  img.onload=function(){
    cropImgs[slot]=img;
    var si=g('csrc-'+slot); if(si)si.src=src;
    var pre=g('ipre-'+slot); if(pre)pre.src=src;
    g('ipw-'+slot).style.display='';
    ['ct-','cb-','cl2-','cr-'].forEach(function(p){var i=g(p+slot);if(i)i.value='0';});
    updateLines(slot);
    autoSave(slot);
  };
  img.onerror=function(){alert('Could not load image.');};
  img.src=src;
}

function preloadCropImg(slot, src) {
  // Load into cropImgs without changing UI
  var img=new Image(); img.crossOrigin='anonymous';
  img.onload=function(){
    cropImgs[slot]=img;
    var si=g('csrc-'+slot); if(si)si.src=src;
  };
  img.src=src;
}

function clampV(id) { var e=g(id);return e?Math.min(99,Math.max(0,parseInt(e.value)||0)):0; }
function setLine(id,prop,val){ var e=g(id);if(e)e.style[prop]=val; }

function updateLines(slot) {
  setLine('cl-t-'+slot,'top',clampV('ct-'+slot)+'%');
  setLine('cl-b-'+slot,'bottom',clampV('cb-'+slot)+'%');
  setLine('cl-l-'+slot,'left',clampV('cl2-'+slot)+'%');
  setLine('cl-r-'+slot,'right',clampV('cr-'+slot)+'%');
}

function applyCrop(slot) {
  var img=cropImgs[slot]; if(!img)return;
  var t=clampV('ct-'+slot),b=clampV('cb-'+slot),l=clampV('cl2-'+slot),r=clampV('cr-'+slot);
  var sx=Math.round(img.width*l/100), sy=Math.round(img.height*t/100);
  var sw=Math.max(2,Math.round(img.width*(100-l-r)/100));
  var sh=Math.max(2,Math.round(img.height*(100-t-b)/100));
  var out=el('canvas'); out.width=sw; out.height=sh;
  out.getContext('2d').drawImage(img,sx,sy,sw,sh,0,0,sw,sh);
  var pre=g('ipre-'+slot); if(pre)pre.src=out.toDataURL('image/png');
  autoSave(slot);
}

function resetCrop(slot) {
  var img=cropImgs[slot]; if(!img)return;
  ['ct-','cb-','cl2-','cr-'].forEach(function(p){var i=g(p+slot);if(i)i.value='0';});
  updateLines(slot);
  var out=el('canvas'); out.width=img.naturalWidth||img.width; out.height=img.naturalHeight||img.height;
  out.getContext('2d').drawImage(img,0,0);
  var pre=g('ipre-'+slot); if(pre)pre.src=out.toDataURL('image/png');
  autoSave(slot);
}

function wireCropLines(slot) { wireCropLinesP(slot,'i'); }

function wireCropLinesP(slot, pfx) {
  var lines=[
    {id:pfx+'cl-t-'+slot, inp:pfx+'ct-'+slot,  axis:'y', dir:1},
    {id:pfx+'cl-b-'+slot, inp:pfx+'cb-'+slot,  axis:'y', dir:-1},
    {id:pfx+'cl-l-'+slot, inp:pfx+'cl2-'+slot, axis:'x', dir:1},
    {id:pfx+'cl-r-'+slot, inp:pfx+'cr-'+slot,  axis:'x', dir:-1},
  ];
  lines.forEach(function(line){
    var el2=g(line.id); if(!el2)return;
    var startPos=0,startVal=0,dragging=false;
    function client(e){return e.touches?(line.axis==='x'?e.touches[0].clientX:e.touches[0].clientY):(line.axis==='x'?e.clientX:e.clientY);}
    function onStart(e){
      e.preventDefault();
      e.stopPropagation();
      dragging=true;
      startPos=client(e);
      startVal=clampV(line.inp);
      document.addEventListener('mousemove',onMove);
      document.addEventListener('mouseup',onEnd);
      document.addEventListener('touchmove',onMove,{passive:false});
      document.addEventListener('touchend',onEnd);
    }
    function onMove(e){
      if(!dragging)return;
      if(e.cancelable)e.preventDefault();
      // Measure the crop SOURCE IMAGE actual rendered dimensions (not the wrap)
      var srcImg=g(pfx+'csrc-'+slot);
      var iw=g(pfx+'ciwrap-'+slot);
      var wrapSz=200;
      if(srcImg&&iw){
        // Use natural rendered image size (not container size which may be padded)
        var nat=getNaturalRenderedSize(srcImg,iw);
        wrapSz=line.axis==='x'?nat.w:nat.h;
      }
      if(!wrapSz)return;
      var delta=(client(e)-startPos)*line.dir;
      var pct=Math.round(delta/wrapSz*100);
      var inp2=g(line.inp);
      if(!inp2)return;
      inp2.value=Math.min(99,Math.max(0,startVal+pct));
      updateLinesP(slot,pfx);
      applyCropP(slot,pfx);
    }
    function onEnd(){
      dragging=false;
      document.removeEventListener('mousemove',onMove);
      document.removeEventListener('mouseup',onEnd);
      document.removeEventListener('touchmove',onMove);
      document.removeEventListener('touchend',onEnd);
    }
    el2.addEventListener('mousedown',onStart,{passive:false});
    el2.addEventListener('touchstart',onStart,{passive:false});
  });
}

// Returns the actual rendered pixel dimensions of the image content within
// an object-fit:contain container, so crop percentages map to real image bounds.
function getNaturalRenderedSize(img, wrap) {
  var containerW = wrap.offsetWidth;
  var containerH = wrap.offsetHeight;
  var natW = img.naturalWidth  || containerW;
  var natH = img.naturalHeight || containerH;
  if (!natW||!natH) return {w:containerW,h:containerH,offX:0,offY:0};
  var scale = Math.min(containerW/natW, containerH/natH);
  var rendW = natW*scale;
  var rendH = natH*scale;
  return {
    w: rendW,
    h: rendH,
    offX: (containerW-rendW)/2,
    offY: (containerH-rendH)/2,
  };
}

// ── Storage ───────────────────────────────────────────────────
function loadCustom() {
  try {
    var d = JSON.parse(localStorage.getItem(STORE));
    if (d && Array.isArray(d.chars)) return d;
    return { chars: [] };
  } catch(e) {
    return { chars: [] };
  }
}
function getCustomChar(id){return (loadCustom().chars||[]).find(function(c){return c.id===id;})||null;}
function saveCustom(d){try{localStorage.setItem(STORE,JSON.stringify(d));}catch(e){}}

// ── Character share: export / import ──────────────────────────
// A shared character is ONE JSON file: the character record plus its up to
// three images (height/length/profile) embedded as base64 data URLs. No zip
// needed — it's a single double-clickable file.
var CHAR_EXPORT_VERSION = 1;
var IMG_PFXS = ['i', 'l', 'p']; // height-image, length-image, profile

function exportCustomChar(id) {
  var char = getCustomChar(id);
  if (!char) { alert('Character not found.'); return; }
  var slot = parseInt((char.id || '').replace('custom_', ''), 10);

  // Gather the three images from IndexedDB
  var imgGets = IMG_PFXS.map(function(pfx) {
    return getImg('custom_' + slot + '_' + pfx).then(function(dataUrl) {
      return { pfx: pfx, data: dataUrl || null };
    });
  });

  Promise.all(imgGets).then(function(results) {
    var images = {};
    results.forEach(function(r) { if (r.data) images[r.pfx] = r.data; });

    // Strip slot-specific identity from the record; import assigns a fresh slot
    var record = JSON.parse(JSON.stringify(char));
    delete record.id;

    var payload = {
      _sinverse: 'sizeref-character',
      version: CHAR_EXPORT_VERSION,
      exported: new Date().toISOString(),
      character: record,
      images: images   // { i?: dataURL, l?: dataURL, p?: dataURL }
    };

    var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var safeName = (char.name || 'character').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'character';
    a.href = url;
    a.download = 'sinverse_' + safeName + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  });
}

// Import: read a shared character JSON, claim a fresh slot, store its images,
// and add it to My Characters. Returns a promise resolving to the new char id.
function importCustomChar(fileText) {
  return new Promise(function(resolve, reject) {
    var payload;
    try { payload = JSON.parse(fileText); }
    catch (e) { reject(new Error('That file isn\u2019t valid JSON.')); return; }

    if (!payload || payload._sinverse !== 'sizeref-character' || !payload.character) {
      reject(new Error('That doesn\u2019t look like a Sinverse character file.'));
      return;
    }

    var d = loadCustom();
    var chars = d.chars || [];

    // Find the lowest free slot number (cap matches the roster limit)
    var used = {};
    chars.forEach(function(c){ var n = parseInt((c.id||'').replace('custom_',''),10); if (!isNaN(n)) used[n] = true; });
    var slot = 1;
    while (used[slot]) slot++;
    if (slot > MAX_CUSTOM) { reject(new Error('You\u2019ve reached the maximum of ' + MAX_CUSTOM + ' custom characters. Remove one first.')); return; }

    var record = payload.character;
    record.id = 'custom_' + slot;
    record.custom = true;
    record.canonical = false;

    // Avoid duplicate display names
    var baseName = record.name || 'Imported Character';
    var nameTaken = function(n){ return chars.some(function(c){ return (c.name||'').toLowerCase() === n.toLowerCase(); }); };
    if (nameTaken(baseName)) {
      var k = 2;
      while (nameTaken(baseName + ' (' + k + ')')) k++;
      record.name = baseName + ' (' + k + ')';
    }

    // Store images into IndexedDB under the new slot, and flag has_img
    var images = payload.images || {};
    if (!d['slot'+slot]) d['slot'+slot] = {};
    var imgPuts = IMG_PFXS.filter(function(pfx){ return images[pfx]; }).map(function(pfx) {
      d['slot'+slot][pfx+'_has_img'] = true;
      return storeImg('custom_' + slot + '_' + pfx, images[pfx]);
    });

    Promise.all(imgPuts).then(function() {
      chars.push(record);
      d.chars = chars;
      saveCustom(d);
      resolve(record.id);
    }).catch(function(err){ reject(err); });
  });
}

function clearSlot(slot){
  var d=loadCustom(); d.chars=(d.chars||[]).filter(function(c){return c.id!=='custom_'+slot;}); saveCustom(d);
  // Remove from all compare slots that had this custom char selected
  allSlotSelects().forEach(function(sel){
    if(sel.value==='custom_'+slot) {
      sel.value='';
      // Update picker button label
      var row = sel.closest('.sr-slot-row');
      var btn = row && row.querySelector('.slot-picker-btn');
      if (btn) btn.textContent = '— Select character —';
      sel.dispatchEvent(new Event('change'));
    }
  });
  fillSelects(); buildForms(); renderActive();
  if(S.view!=='stats') renderStatsView();
}


// ── My Characters roster ──────────────────────────────────────
var MAX_CUSTOM = 8;
var editingCustomId = null; // id of char being edited, null = new

function nextCustomId() {
  var chars = loadCustom().chars || [];
  for (var i = 1; i <= MAX_CUSTOM; i++) {
    if (!chars.find(function(c){ return c.id === 'custom_'+i; })) return 'custom_'+i;
  }
  return null;
}

function renderRoster() {
  var roster = document.getElementById('mychars-roster');
  var countEl = document.getElementById('mychars-count');
  var addBtn = document.getElementById('mychars-add-btn');
  if (!roster) return;

  var chars = loadCustom().chars || [];
  roster.innerHTML = '';

  if (countEl) countEl.textContent = chars.length + ' / ' + MAX_CUSTOM;
  if (addBtn) addBtn.style.display = chars.length >= MAX_CUSTOM ? 'none' : '';

  if (!chars.length) {
    roster.innerHTML = '<div class="mychars-empty">No custom characters yet. Add one to get started.</div>';
    return;
  }

  chars.forEach(function(c) {
    var card = el('div');
    card.className = 'mychars-card';

    var slot = parseInt((c.id||'').replace('custom_',''), 10);
    var heightStr = c.height ? fH(c.height) : '—';

    var img = c.profile_image || '';
    var avatarHtml = img
      ? '<img class="mychars-avatar" src="'+img+'" alt="'+c.name+'" />'
      : '<div class="mychars-avatar mychars-avatar-ph">'+(c.name||'?').charAt(0).toUpperCase()+'</div>';

    card.innerHTML =
      '<div class="mychars-card-left">'+avatarHtml+
        '<div class="mychars-card-info">'+
          '<div class="mychars-card-name">'+(c.name||'Unnamed')+'</div>'+
          '<div class="mychars-card-detail">'+heightStr+'</div>'+
        '</div>'+
      '</div>'+
      '<div class="mychars-card-actions">'+
        '<button class="mychars-export-btn" data-id="'+c.id+'" title="Export / share this character">&#8682; Export</button>'+
        '<button class="mychars-edit-btn" data-id="'+c.id+'">Edit</button>'+
        '<button class="mychars-del-btn" data-id="'+c.id+'">&#10005;</button>'+
      '</div>';

    card.querySelector('.mychars-export-btn').addEventListener('click', function() {
      exportCustomChar(c.id);
    });
    card.querySelector('.mychars-edit-btn').addEventListener('click', function() {
      openCustomModal(c.id);
    });
    card.querySelector('.mychars-del-btn').addEventListener('click', function() {
      deleteCustomChar(c.id);
    });

    roster.appendChild(card);
  });
}

function openCustomModal(id) {
  editingCustomId = id || null;
  var modal = document.getElementById('custom-modal');
  var titleEl = document.getElementById('custom-modal-title');
  var formEl = document.getElementById('custom-modal-form');
  if (!modal || !formEl) return;

  var slot = id ? parseInt(id.replace('custom_',''), 10) : null;
  if (!slot) slot = parseInt((nextCustomId()||'custom_1').replace('custom_',''), 10);

  if (titleEl) titleEl.textContent = id ? 'Edit Character' : 'New Character';

  // Give formEl the id buildForm expects, then build
  formEl.id = 'custom'+slot+'-form';
  formEl.setAttribute('data-slot', slot);
  formEl.innerHTML = '';

  modal.style.display = 'flex';
  buildForm(slot);

  // Wire a "Done" button at the bottom
  var doneBtn = el('button');
  doneBtn.className = 'btn-primary custom-modal-done';
  doneBtn.textContent = 'Save & Close';
  doneBtn.addEventListener('click', function() {
    var nameEl = document.getElementById('n'+slot);
    var ftEl   = document.getElementById('ft-'+slot);
    var inEl   = document.getElementById('in-'+slot);
    var cmEl   = document.getElementById('cm-'+slot);
    var name   = nameEl ? nameEl.value.trim() : '';
    var heightIn = 0;
    if (ftEl && ftEl.closest && ftEl.closest('[style*="display:none"]') === null && ftEl.offsetParent !== null) {
      heightIn = (parseInt(ftEl.value)||0)*12 + (parseInt(inEl&&inEl.value)||0);
    } else if (cmEl) {
      heightIn = (parseFloat(cmEl.value)||0) / 2.54;
    }
    if (!name) {
      nameEl && nameEl.focus();
      nameEl && (nameEl.style.outline = '2px solid var(--wine)');
      setTimeout(function(){ if(nameEl) nameEl.style.outline = ''; }, 2000);
      return;
    }
    if (heightIn <= 0) {
      ftEl && ftEl.focus();
      [ftEl, inEl, cmEl].forEach(function(el){
        if(el) { el.style.outline = '2px solid var(--wine)'; setTimeout(function(){ el.style.outline=''; },2000); }
      });
      return;
    }
    autoSave(slot);
    // On first save, drop the character into the compare lineup automatically.
    // (If it's already in a slot — i.e. this was an edit — don't add a dupe.)
    var charId = 'custom_' + slot;
    var alreadyInLineup = allSlotSelects().some(function(sel) {
      return sel.getAttribute('data-type') === 'char' && sel.value === charId;
    });
    if (!alreadyInLineup) addCharToLineup(charId);
    closeCustomModal();
  });
  formEl.appendChild(doneBtn);
}

function closeCustomModal() {
  var modal = document.getElementById('custom-modal');
  if (modal) modal.style.display = 'none';

  // If the character being edited was never given a name, it's an abandoned
  // stub (created by "+ New Character" but closed without saving) — discard it
  // so it doesn't linger as an "unnamed character" record.
  if (editingCustomId) {
    var ch = getCustomChar(editingCustomId);
    if (ch && (!ch.name || !ch.name.trim())) {
      var d = loadCustom();
      d.chars = (d.chars || []).filter(function(c){ return c.id !== editingCustomId; });
      saveCustom(d);
    }
  }

  // Restore modal-form id
  var formEl = document.getElementById('custom-modal-form') || document.querySelector('[data-slot]');
  if (formEl && formEl.id !== 'custom-modal-form') {
    formEl.id = 'custom-modal-form';
    formEl.removeAttribute('data-slot');
  }
  editingCustomId = null;
  renderRoster();
  fillSelects();
}

function deleteCustomChar(id) {
  var char = getCustomChar(id);
  var name = char ? char.name : id;
  if (!confirm('Remove "'+name+'" from My Characters?')) return;
  var d = loadCustom();
  d.chars = (d.chars||[]).filter(function(c){ return c.id !== id; });
  saveCustom(d);
  // Remove from any comparison slots
  allSlotSelects().forEach(function(sel){
    if (sel.value === id) {
      sel.value = '';
      var row = sel.closest('.sr-slot-row');
      var btn = row && row.querySelector('.slot-picker-btn');
      if (btn) btn.textContent = '— Select character —';
    }
  });
  fillSelects();
  renderRoster();
  renderActive();
}


// ── Tab switching ─────────────────────────────────────────────
function switchTab(tab){
  document.querySelectorAll('.sr-tab').forEach(function(t){t.classList.toggle('active',t.getAttribute('data-tab')===tab);});
  document.querySelectorAll('.sr-tab-panel').forEach(function(p){p.style.display='none';});
  var panel=document.getElementById('tab-'+tab); if(panel)panel.style.display='';
  if(tab==='mychars') renderRoster();
}

// ── Utility ───────────────────────────────────────────────────
function g(id){return document.getElementById(id);}

// ── Event wiring ──────────────────────────────────────────────
document.querySelectorAll('.sr-tab').forEach(function(t){t.addEventListener('click',function(){switchTab(this.getAttribute('data-tab'));});});

// My Characters — add button + modal close
var myAddBtn = document.getElementById('mychars-add-btn');
if (myAddBtn) myAddBtn.addEventListener('click', function() {
  var newId = nextCustomId();
  if (!newId) return;
  var d = loadCustom();
  d.chars = d.chars || [];
  if (!d.chars.find(function(c){ return c.id === newId; })) {
    d.chars.push({ id: newId, name: '', height: 72, canonical: false, custom: true }); // 6ft default
  }
  saveCustom(d);
  openCustomModal(newId);
});

// My Characters — import a shared character file
var myImportBtn  = document.getElementById('mychars-import-btn');
var myImportFile = document.getElementById('mychars-import-file');
if (myImportBtn && myImportFile) {
  myImportBtn.addEventListener('click', function() { myImportFile.click(); });
  myImportFile.addEventListener('change', function() {
    var f = this.files && this.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function(e) {
      importCustomChar(e.target.result).then(function(newId) {
        renderRoster();
        fillSelects();
        addCharToLineup(newId);   // show the imported character immediately
        var ch = getCustomChar(newId);
        alert('Imported "' + (ch ? ch.name : 'character') + '" into My Characters.');
      }).catch(function(err) {
        alert(err.message || 'Could not import that file.');
      });
    };
    reader.readAsText(f);
    this.value = ''; // allow re-importing the same file
  });
}

var modalClose = document.getElementById('custom-modal-close');
if (modalClose) modalClose.addEventListener('click', closeCustomModal);

var modalOverlay = document.getElementById('custom-modal');
if (modalOverlay) {
  // Track where the press started. Closing on a plain `click` is unreliable:
  // selecting text inside an input and releasing the mouse over the backdrop
  // resolves the click target to the overlay and closes the modal. We only
  // close when the press BEGAN on the overlay itself (a genuine backdrop click).
  var _customMouseDownOnOverlay = false;
  modalOverlay.addEventListener('mousedown', function(e) {
    _customMouseDownOnOverlay = (e.target === modalOverlay);
  });
  modalOverlay.addEventListener('click', function(e) {
    if (e.target === modalOverlay && _customMouseDownOnOverlay) closeCustomModal();
    _customMouseDownOnOverlay = false;
  });
}

document.querySelectorAll('.sr-view-tab').forEach(function(t){t.addEventListener('click',function(){switchView(this.getAttribute('data-view'));});});
// slot selects wired per-slot in createSlotRow()

function applyGlobalUnit(isM) {
  S.metric = isM;
  g('btn-imperial').classList.toggle('active', !isM);
  g('btn-metric').classList.toggle('active', isM);
  // Update each custom form: show correct fields, convert values, refresh estimates
  var _unitSlots = (loadCustom().chars||[]).map(function(c){return parseInt((c.id||'').replace('custom_',''),10);}).filter(Boolean);
  _unitSlots.forEach(function(slot) {
    var hi=g('hi-'+slot),hm=g('hm-'+slot);
    if(hi)hi.style.display=isM?'none':'';
    if(hm)hm.style.display=isM?'':'none';
    // Convert manual weight value
    var lbsEl=g('lbs-'+slot),kgEl=g('kg-'+slot);
    if(isM){var lv=parseFloat((lbsEl||{}).value)||0;if(lv&&kgEl)kgEl.value=Math.round(lbsToKg(lv));}
    else   {var kv=parseFloat((kgEl||{}).value)||0;if(kv&&lbsEl)lbsEl.value=Math.round(kv/0.453592);}
    var wmi=g('wmi-'+slot),wmm=g('wmm-'+slot);
    if(wmi)wmi.style.display=isM?'none':'';
    if(wmm)wmm.style.display=isM?'':'none';
    // Convert calculate reference weight
    var refEl=g('ref-'+slot),ruEl=g('runit-'+slot);
    if(refEl&&parseFloat(refEl.value)){
      var rv=parseFloat(refEl.value);
      refEl.value=isM?Math.round(lbsToKg(rv)):Math.round(rv/0.453592);
    }
    if(ruEl)ruEl.textContent=isM?'kg at 183cm':'lbs at 6ft';
    syncH(slot,isM);
    syncLen(slot,isM);
    // Convert length calc reference value (lref-) between in/cm
    var lrefEl=g('lref-'+slot), lruEl=g('lrunit-'+slot);
    if(lrefEl&&parseFloat(lrefEl.value)){
      var lrv=parseFloat(lrefEl.value);
      lrefEl.value=isM?inToCm(lrv).toFixed(1):(lrv/2.54).toFixed(1);
    }
    if(lruEl)lruEl.textContent=isM?'cm at 183cm':'in at 6ft';
    refreshEst(slot);
    refreshCalc(slot);
    refreshLengthCalc(slot);
    refreshLengthPreset(slot);
  });
  if(S.view==='stats') renderStatsView();
  renderActive();
  // If the character picker is open, rebuild it so heights reflect the new unit
  var _cmo = document.getElementById('char-modal-overlay');
  if (_cmo && _cmo.style.display !== 'none') {
    var _cms = document.getElementById('char-modal-search');
    buildModalGrid(_cms ? _cms.value : '');
  }
}
g('btn-imperial').addEventListener('click',function(){applyGlobalUnit(false);});

// Grid lines toggle
var gridBtn = g('btn-grid-lines');
if (gridBtn) gridBtn.addEventListener('click', function() {
  S.gridLines = !S.gridLines;
  this.classList.toggle('active', S.gridLines);
  updateGridOverlay();
});

// Copy viewer to clipboard
var copyWithScale = false; // default: scale hidden in copy
function syncScaleButtons() {
  ['btn-copy-scale', 'btn-copy-scale-length'].forEach(function(id) {
    var b = document.getElementById(id);
    if (!b) return;
    b.title = copyWithScale ? 'Scale included in copy' : 'Include scale in copy';
    b.classList.toggle('active', copyWithScale);
  });
}
['btn-copy-scale', 'btn-copy-scale-length'].forEach(function(id) {
  var btn = document.getElementById(id);
  if (btn) btn.addEventListener('click', function() {
    copyWithScale = !copyWithScale;
    syncScaleButtons();
  });
});

// ── Sandbox mode ──────────────────────────────────────────────
function initSandbox() {
  var btn = g('btn-sandbox');
  if (!btn) return;
  btn.addEventListener('click', function() {
    sandboxMode = !sandboxMode;
    this.textContent = sandboxMode ? 'Sandbox: On' : 'Sandbox: Off';
    this.classList.toggle('active', sandboxMode);
    if (sandboxMode) {
      document.body.classList.add('sandbox-active');
      S.gridLines = false;
      sandboxPositions = {}; // fresh positions on entry
      var gb = document.getElementById('btn-grid-lines');
      if (gb) { gb.classList.remove('active'); gb.style.display = 'none'; }
      render(); // clear grid, then applySandboxPositions runs at end of render
    } else {
      document.body.classList.remove('sandbox-active');
      sandboxOffsets = {};
      sandboxPositions = {}; // clear positions on exit
      // Restore grid button and reset zoom to 100%
      var gb2 = document.getElementById('btn-grid-lines');
      if (gb2) gb2.style.display = '';
      S.zoomH = 1;
      render();
    }
  });
}

function enableSandbox() {
  applySandboxPositions();
}

function applySandboxPositions() {
  var figs = document.getElementById('sr-figures');
  if (!figs) return;
  var wraps = Array.from(figs.querySelectorAll('.sr-img-wrap'));
  if (!wraps.length) return;

  function pin() {
    // Reset to flow and clear any prior locks so we measure the CURRENT scale
    // (figures grow on zoom; the container must be re-measured, not stale-locked).
    figs.style.height = '';
    figs.style.width  = '';
    wraps.forEach(function(w){
      w.style.position = '';
      w.style.left = ''; w.style.top = ''; w.style.bottom = ''; w.style.width = '';
    });
    void figs.offsetHeight; // force reflow before measuring

    var figsRect = figs.getBoundingClientRect();
    var containerH = figsRect.height;
    var containerW = figsRect.width;
    var geo = wraps.map(function(wrap) {
      var r = wrap.getBoundingClientRect();
      return {
        left:   r.left - figsRect.left,
        top:    r.top  - figsRect.top,
        width:  r.width,
        height: r.height
      };
    });

    // Lock the container box so the all-absolute flex parent can't collapse
    // (which previously zeroed its height and squished widths to min-width).
    figs.style.height = containerH + 'px';
    figs.style.width  = containerW + 'px';

    var ppi = (typeof S !== 'undefined' && S.pxPerIn) ? S.pxPerIn : 1;

    // First pass: compute each figure's target left/top and track the highest
    // top (which may be ABOVE the container's top edge when zoomed — that's the
    // part that was being clipped and made unscrollable).
    var placements = [];
    var minTop = 0;            // most-negative top across figures (0 if none overflow)
    wraps.forEach(function(wrap, i) {
      var sid = wrap.getAttribute('data-char-key') || wrap.getAttribute('data-slot-idx') || String(i);
      var g = geo[i];
      if (!sandboxPositions[sid] || sandboxPositions[sid].centerInches === undefined) {
        sandboxPositions[sid] = {
          centerInches: (g.left + g.width / 2) / ppi,
          groundInches: (containerH - g.height - g.top) / ppi
        };
      }
      var pos = sandboxPositions[sid];
      var leftPx = (pos.centerInches * ppi) - (g.width / 2);
      var groundPx = (pos.groundInches || 0) * ppi;
      var topPx = containerH - g.height - groundPx;
      if (topPx < minTop) minTop = topPx;
      placements.push({ wrap: wrap, g: g, leftPx: leftPx, topPx: topPx, i: i });
    });

    // If any figure's top is above the container (minTop < 0), grow the figures
    // box by that overflow and push everything DOWN by the same amount, so the
    // ground stays put but the tall tops now live inside a taller, scrollable
    // container instead of being clipped.
    var topPad = minTop < 0 ? -minTop : 0;
    var totalH = containerH + topPad;
    figs.style.height = totalH + 'px';

    placements.forEach(function(p) {
      var wrap = p.wrap;
      wrap.style.position = 'absolute';
      wrap.style.width  = p.g.width + 'px';
      wrap.style.left = p.leftPx + 'px';
      wrap.style.top  = (p.topPx + topPad) + 'px';   // shifted down by the overflow
      wrap.style.transform = '';
      wrap.style.cursor = '';   // cursor set dynamically on hover (only over opaque pixels)
      wrap.style.userSelect = 'none';
      wrap.style.zIndex = String(wraps.length - p.i);
      makeDraggable(wrap);
    });

    // Make sure the scroll container can actually reach the (now taller) top.
    var scrollC = document.getElementById('sr-scroll');
    var sceneC  = document.getElementById('sr-scene');
    if (scrollC && sceneC) {
      if (topPad > 0) {
        sceneC.style.minHeight = totalH + 'px';
        scrollC.style.overflowY = 'auto';
        scrollC.style.alignItems = 'flex-start';
        sceneC.style.marginTop = 'auto';
      }
    }
    // Rebuild the ruler to match the (possibly expanded) figures container, then
    // sync it to the current scroll position so the scale stays aligned.
    if (typeof updateRuler === 'function') updateRuler();
    if (typeof syncRulerScroll === 'function') syncRulerScroll();
    // Opacity-aware hover cursor: show the grab hand only when the pointer is
    // actually over a grabbable (opaque) part of some figure — not over the
    // transparent regions of a PNG's bounding box.
    if (!figs._hoverCursorWired) {
      figs._hoverCursorWired = true;
      figs.addEventListener('mousemove', function(e) {
        if (!sandboxMode) { figs.style.cursor = ''; return; }
        var t = topOpaqueWrapAt(e.clientX, e.clientY);
        figs.style.cursor = t ? 'grab' : '';
      });
      figs.addEventListener('mouseleave', function() { figs.style.cursor = ''; });
    }
    // Positions applied — reveal the figures (hidden during sandbox re-render).
    figs.style.visibility = '';
  }

  // Pin once images have a real laid-out size (so widths/positions are correct),
  // otherwise wait for them to load. Pinning happens on the next frame so flex
  // layout has settled.
  var imgs = wraps.map(function(w){ return w.querySelector('img'); }).filter(Boolean);
  var pending = imgs.filter(function(im){ return !(im.complete && im.naturalWidth > 0); });
  if (pending.length) {
    var remaining = pending.length;
    pending.forEach(function(im) {
      var done = function() {
        im.removeEventListener('load', done);
        im.removeEventListener('error', done);
        if (--remaining <= 0) requestAnimationFrame(pin);
      };
      im.addEventListener('load', done);
      im.addEventListener('error', done);
    });
  } else {
    requestAnimationFrame(pin);
  }
}

// Grab-to-drag panning for a scroll container (both axes). Ignores drags that
// start on interactive controls; an optional skipFn lets callers bail in
// contexts where dragging means something else (e.g. sandbox figure-dragging).
function enableDragScroll(container, skipFn) {
  if (!container || container._dragWired) return;
  container._dragWired = true;
  var down = false, moved = false, sx = 0, sy = 0, sl = 0, st = 0;
  container.style.cursor = 'grab';
  container.addEventListener('pointerdown', function(e) {
    if (skipFn && skipFn(e)) return;
    if (e.target.closest('button, input, a, select, textarea, .sr-img-wrap, .sr-obj-shape, .sr-obj-img, [style*="pointer-events:all"]')) return;
    down = true; moved = false;
    sx = e.clientX; sy = e.clientY;
    sl = container.scrollLeft; st = container.scrollTop;
    container.style.cursor = 'grabbing';
  });
  container.addEventListener('pointermove', function(e) {
    if (!down) return;
    var dx = e.clientX - sx, dy = e.clientY - sy;
    if (!moved && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) moved = true;
    if (moved) {
      container.scrollLeft = sl - dx;
      container.scrollTop  = st - dy;
    }
  });
  function endDS() {
    if (!down) return;
    down = false;
    container.style.cursor = 'grab';
  }
  container.addEventListener('pointerup', endDS);
  container.addEventListener('pointerleave', endDS);
  container.addEventListener('click', function(e) {
    if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; }
  }, true);
}

// Grab-to-drag panning for the stats scroll container (both axes). Ignores
// drags that start on interactive controls, and suppresses the click that
// would otherwise fire after a real drag.
function enableDragScrollSV(container) {
  enableDragScroll(container);
}

// ── Transparency-aware hit testing (sandbox) ──────────────────
// Builds a cached low-res alpha map per image so we can tell whether a click
// landed on a visible (opaque) pixel or a transparent gap. Lets clicks on empty
// space "fall through" to whatever figure is actually underneath.
var _alphaMaps = {}; // img.src -> {w,h,data:Uint8ClampedArray(alpha only)} | 'tainted'
function getAlphaMap(img) {
  var key = img.currentSrc || img.src;
  if (_alphaMaps[key] !== undefined) return _alphaMaps[key];
  if (!img.complete || !img.naturalWidth) return null; // not ready yet; treat as opaque
  try {
    var MAXD = 200; // sample resolution — plenty for hit testing, cheap to store
    var scale = Math.min(1, MAXD / Math.max(img.naturalWidth, img.naturalHeight));
    var w = Math.max(1, Math.round(img.naturalWidth * scale));
    var h = Math.max(1, Math.round(img.naturalHeight * scale));
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    var rgba = ctx.getImageData(0, 0, w, h).data;
    var alpha = new Uint8ClampedArray(w * h);
    for (var i = 0; i < w * h; i++) alpha[i] = rgba[i * 4 + 3];
    var map = { w: w, h: h, data: alpha };
    _alphaMaps[key] = map;
    return map;
  } catch (e) {
    // Canvas tainted (CORS) or other failure — fall back to treating as opaque.
    _alphaMaps[key] = 'tainted';
    return 'tainted';
  }
}

// Is the given client point over an opaque pixel of this wrap's image?
// Returns true if opaque (grabbable), or if we can't tell (fail safe to opaque).
function pointHitsOpaque(wrap, clientX, clientY) {
  var img = wrap.querySelector('img');
  if (!img) return true;
  var map = getAlphaMap(img);
  if (!map || map === 'tainted') return true; // can't test -> treat as solid

  // The image may be rotated/flipped via CSS transform. getBoundingClientRect()
  // returns the axis-aligned box of the *transformed* element, which is wrong for
  // sampling. Instead, work from the element's CENTRE (the rect centre is still
  // accurate) and the UNTRANSFORMED layout size, then apply the inverse of the
  // rotation/flip to map the click into the image's own local pixel space.
  var r = img.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return true;
  var cx = r.left + r.width / 2;
  var cy = r.top + r.height / 2;
  var lw = img.offsetWidth  || r.width;   // untransformed (layout) dimensions
  var lh = img.offsetHeight || r.height;
  if (lw <= 0 || lh <= 0) return true;

  // Parse the rotation + flip applied to this image (matches how render sets them).
  var deg = 0, flip = false;
  var tf = img.style.transform || '';
  var mRot = tf.match(/rotate\((-?[\d.]+)deg\)/);
  if (mRot) deg = parseFloat(mRot[1]);
  if (/scaleX\(\s*-1\s*\)/.test(tf)) flip = true;

  // Click point relative to the image centre.
  var dx = clientX - cx;
  var dy = clientY - cy;

  // Inverse-rotate the point back into the image's upright frame.
  if (deg) {
    var rad = -deg * Math.PI / 180;
    var cos = Math.cos(rad), sin = Math.sin(rad);
    var rx = dx * cos - dy * sin;
    var ry = dx * sin + dy * cos;
    dx = rx; dy = ry;
  }
  // Undo horizontal flip.
  if (flip) dx = -dx;

  // Now dx,dy are in upright local space; convert to 0..1 within the layout box.
  var fx = dx / lw + 0.5;
  var fy = dy / lh + 0.5;
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return false; // outside the actual image

  var sx = Math.min(map.w - 1, Math.max(0, Math.floor(fx * map.w)));
  var sy = Math.min(map.h - 1, Math.max(0, Math.floor(fy * map.h)));
  return map.data[sy * map.w + sx] > 12; // >~5% alpha counts as a hit
}

// Given a click point, return the topmost figure wrap whose image is opaque
// there — i.e. the figure the user actually sees and means to grab.
function topOpaqueWrapAt(clientX, clientY) {
  var figs = document.getElementById('sr-figures');
  if (!figs) return null;
  var wraps = Array.from(figs.querySelectorAll('.sr-img-wrap'));
  // Sort by z-index descending so we test front-to-back.
  wraps.sort(function(a, b){ return (parseInt(b.style.zIndex)||0) - (parseInt(a.style.zIndex)||0); });
  for (var i = 0; i < wraps.length; i++) {
    if (pointHitsOpaque(wraps[i], clientX, clientY)) return wraps[i];
  }
  return null;
}

// After a sandbox drag, a figure may sit above the figures box (lifted into the
// air). Grow the box + scene so its top is reachable by scroll and included in
// the copy, shifting all figures down so the ground stays put. Mirrors the
// expansion pin() does on render, but runs on drag-end (no re-render needed).
function reflowSandboxContainer() {
  if (!sandboxMode) return;
  var figs = document.getElementById('sr-figures');
  if (!figs) return;
  var wraps = Array.from(figs.querySelectorAll('.sr-img-wrap'));
  if (!wraps.length) return;

  var figsRect = figs.getBoundingClientRect();
  var curH = parseFloat(figs.style.height) || figsRect.height;
  var areaEl = document.getElementById('sr-canvas-area');
  var minH = areaEl ? areaEl.clientHeight : curH;

  // Highest current top relative to the figures box. Negative = above the top
  // (lifted into the air and currently clipped/unreachable).
  var minTop = Infinity;
  wraps.forEach(function(w) {
    var t = parseFloat(w.style.top);
    if (isNaN(t)) t = w.getBoundingClientRect().top - figsRect.top;
    if (t < minTop) minTop = t;
  });
  if (!isFinite(minTop)) return;

  var pad = 8;
  // Desired box height = current height adjusted so the highest figure has `pad`
  // headroom. If the highest top is already >= pad (nothing above), we can
  // shrink back toward the viewport height; if it's < pad, grow.
  var shift = pad - minTop;             // move so highest top becomes `pad`
  var newH = curH + shift;
  if (newH < minH) { shift += (minH - newH); newH = minH; }
  if (Math.abs(shift) < 1 && Math.abs(newH - curH) < 1) return;

  var scrollC = document.getElementById('sr-scroll');
  var sceneC  = document.getElementById('sr-scene');
  var prevScrollTop = scrollC ? scrollC.scrollTop : 0;
  var prevScrollH   = scrollC ? scrollC.scrollHeight : 0;

  figs.style.height = Math.round(newH) + 'px';
  wraps.forEach(function(w) {
    var t = parseFloat(w.style.top) || 0;
    w.style.top = Math.round(t + shift) + 'px';
  });

  if (scrollC && sceneC) {
    if (newH > minH + 1) {
      sceneC.style.minHeight = Math.round(newH) + 'px';
      scrollC.style.overflowY = 'auto';
      scrollC.style.alignItems = 'flex-start';
      sceneC.style.marginTop = 'auto';
    } else {
      sceneC.style.minHeight = '';
      scrollC.style.overflowY = (S.zoomH > 1) ? 'auto' : 'hidden';
      scrollC.style.alignItems = '';
      sceneC.style.marginTop = '';
    }
    // Keep the SAME content in view: the whole scene grew/shrank at the top by
    // (scrollHeight delta), so move the scroll position by the same delta rather
    // than letting the browser auto-jump.
    var newScrollH = scrollC.scrollHeight;
    var delta = newScrollH - prevScrollH;
    var targetTop = prevScrollTop + delta;
    targetTop = Math.max(0, Math.min(targetTop, newScrollH - scrollC.clientHeight));
    scrollC.scrollTop = targetTop;
  }
  if (typeof updateRuler === 'function') updateRuler();
  if (typeof syncRulerScroll === 'function') syncRulerScroll();
}

function makeDraggable(el) {
  var startX, startY, baseLeft, baseTop;
  function onDown(e) {
    if (!sandboxMode) return;
    var cx = e.touches ? e.touches[0].clientX : e.clientX;
    var cy = e.touches ? e.touches[0].clientY : e.clientY;
    // Transparency-aware grab: if the press landed on a transparent part of
    // THIS figure, hand off to whichever figure is actually visible at that
    // point (or ignore the press entirely if it's empty space everywhere).
    var target = topOpaqueWrapAt(cx, cy);
    if (target && target !== el) {
      // Re-dispatch to the correct figure's own handler and bail out here.
      if (target._srOnDown) target._srOnDown(e);
      return;
    }
    if (!target) return; // clicked empty space — don't grab anything
    e.preventDefault();
    startX = cx; startY = cy;
    baseLeft = parseFloat(el.style.left) || 0;
    baseTop  = parseFloat(el.style.top)  || 0;
    var _figs = document.getElementById('sr-figures');
    if (_figs) _figs.style.cursor = 'grabbing';
    var allWraps = document.querySelectorAll('#sr-figures .sr-img-wrap');
    el.style.zIndex = String(allWraps.length + 10);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
    document.addEventListener('touchmove', onMove, {passive: false});
    document.addEventListener('touchend',  onUp);
  }
  function onMove(e) {
    e.preventDefault();
    var cx = e.touches ? e.touches[0].clientX : e.clientX;
    var cy = e.touches ? e.touches[0].clientY : e.clientY;
    var figs = document.getElementById('sr-figures');
    if (!figs) return;
    var chH = parseFloat(figs.style.height) || figs.getBoundingClientRect().height || 1;
    var w = el.getBoundingClientRect().width;
    var h = el.getBoundingClientRect().height;
    var leftPx = baseLeft + (cx - startX);
    var topPx  = baseTop  + (cy - startY);
    // Clamp so the figure's BOTTOM never goes below the ground line (the bottom
    // of the figures box). topPx max = chH - h keeps the feet on the floor.
    var maxTop = chH - h;
    if (topPx > maxTop) topPx = maxTop;
    el.style.left = leftPx + 'px';
    el.style.top  = topPx + 'px';
    // Persist in SCALE- AND CONTENT-INDEPENDENT coordinates (inches via pxPerIn),
    // so the position survives zoom, resize, and reorder without jumping.
    var ppi = (typeof S !== 'undefined' && S.pxPerIn) ? S.pxPerIn : 1;
    var centerInches = (leftPx + w / 2) / ppi;
    var groundInches = Math.max(0, (chH - h - topPx) / ppi);   // never below the floor
    var sid = el.getAttribute('data-char-key') || el.getAttribute('data-slot-idx');
    if (sid !== null) sandboxPositions[sid] = { centerInches: centerInches, groundInches: groundInches };
  }
  function onUp() {
    var _figs = document.getElementById('sr-figures');
    if (_figs) _figs.style.cursor = '';   // hover handler re-applies grab when over opaque
    var allWraps = Array.from(document.querySelectorAll('#sr-figures .sr-img-wrap'));
    el.style.zIndex = String(allWraps.length - allWraps.indexOf(el));
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend',  onUp);
    // A figure may now sit above the container's top (lifted into the air).
    // Re-expand the figures box / scroll area so its top is reachable by scroll
    // and included in the copy — without waiting for a re-render.
    reflowSandboxContainer();
  }
  el._srOnDown = onDown;   // exposed so a transparent-hit on another figure can hand off here
  el.addEventListener('mousedown',  onDown);
  el.addEventListener('touchstart', onDown, {passive: false});
}


// ── Object picker modal ───────────────────────────────────────
var OBJ_SIZE_GROUPS = [
  { label: 'Tiny',      maxIn:   6  },  // up to 6in
  { label: 'Small',     maxIn:  24  },  // up to 2ft
  { label: 'Human-sized', maxIn: 84 },  // up to 7ft
  { label: 'Large',     maxIn: 480  },  // up to 40ft
  { label: 'Massive',   maxIn: 9999 },  // anything bigger
];

var objModalTargetSel = null;

function openObjModal(sel) {
  objModalTargetSel = sel;
  var overlay = document.getElementById('obj-modal-overlay');
  var search  = document.getElementById('obj-modal-search');
  if (!overlay) return;

  // Re-wire close each time in case wireObjModal missed
  var closeBtn = document.getElementById('obj-modal-close');
  if (closeBtn) { closeBtn.onclick = closeObjModal; }
  overlay.onclick = function(e) { if (e.target === overlay) closeObjModal(); };
  if (search) search.oninput = function() { buildObjModalGrid(this.value); };

  search.value = '';
  buildObjModalGrid('');
  overlay.style.display = 'flex';
  search.focus();
}

function closeObjModal() {
  var overlay = document.getElementById('obj-modal-overlay');
  if (overlay) overlay.style.display = 'none';
  objModalTargetSel = null;
}

function buildObjModalGrid(query) {
  var grid = document.getElementById('obj-modal-grid');
  if (!grid) return;
  grid.innerHTML = '';
  var q = query.trim().toLowerCase();

  var filtered = S.objects.filter(function(o) {
    return !q || o.label.toLowerCase().indexOf(q) >= 0;
  });

  // Sort by height
  filtered = filtered.slice().sort(function(a, b) { return a.height - b.height; });

  if (!filtered.length) {
    grid.innerHTML = '<div class="cpm-empty">No objects found</div>';
    return;
  }

  // Group by size bands
  var groups = {};
  filtered.forEach(function(o) {
    var grpLabel = 'Other';
    for (var i = 0; i < OBJ_SIZE_GROUPS.length; i++) {
      if (o.height <= OBJ_SIZE_GROUPS[i].maxIn) {
        grpLabel = OBJ_SIZE_GROUPS[i].label;
        break;
      }
    }
    if (!groups[grpLabel]) groups[grpLabel] = [];
    groups[grpLabel].push(o);
  });

  OBJ_SIZE_GROUPS.forEach(function(grp) {
    var items = groups[grp.label];
    if (!items || !items.length) return;

    var label = document.createElement('div');
    label.className = 'cpm-section-label';
    label.textContent = grp.label;
    grid.appendChild(label);

    items.forEach(function(o) {
      var card = document.createElement('div');
      card.className = 'cpm-card obj-cpm-card';

      var imgHtml;
      if (o.image) {
        var oThumb = (window.SinverseImg ? SinverseImg.thumb(o.image, 160) : o.image);
        imgHtml = '<div class="cpm-img-wrap"><img class="cpm-img sr-sil-filter" src="'+oThumb+'" alt="'+o.label+'" loading="lazy" /></div>';
      } else {
        imgHtml = '<div class="cpm-img-wrap obj-swatch-wrap"><div class="obj-cpm-swatch" style="background:'+o.color+'"></div></div>';
      }

      card.innerHTML = imgHtml +
        '<div class="cpm-name">'+o.label+'</div>'+
        '<div class="obj-cpm-height">'+fH(o.height)+'</div>';

      card.addEventListener('click', function() {
        if (objModalTargetSel) {
          objModalTargetSel.value = o.id;
          objModalTargetSel.dispatchEvent(new Event('change'));
        }
        closeObjModal();
      });

      grid.appendChild(card);
    });
  });
}

function wireObjModal() {
  // Wire eagerly — elements are in HTML so available at DOMContentLoaded
  var close = document.getElementById('obj-modal-close');
  if (close) close.addEventListener('click', closeObjModal);
  var overlay = document.getElementById('obj-modal-overlay');
  if (overlay) overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeObjModal();
  });
  var search = document.getElementById('obj-modal-search');
  if (search) search.addEventListener('input', function() {
    buildObjModalGrid(this.value);
  });
}

initSandbox();

// ── Ruler tool ────────────────────────────────────────────────
var rulerActive = false;
var rulerA = {x: 0.3, y: 0.5};
var rulerB = {x: 0.7, y: 0.5};

function initRuler() {
  var btn = g('btn-ruler');
  if (!btn) return;
  btn.addEventListener('click', function() {
    rulerActive = !rulerActive;
    this.textContent = rulerActive ? 'Ruler: On' : 'Ruler: Off';
    this.classList.toggle('active', rulerActive);
    var wrap = document.getElementById('sr-ruler-svg-wrap');
    if (wrap) wrap.style.display = rulerActive ? '' : 'none';
    // Reset nodes to visible area on each activation
    var _area = document.getElementById('sr-canvas-area');
    if (_area) {
      var _r = _area.getBoundingClientRect();
      // Place nodes at 30%/70% horizontally, vertically centred in current view
      var _scrollEl = document.getElementById('sr-scroll');
      var _scrollFrac = _scrollEl ? (_scrollEl.scrollTop / (_scrollEl.scrollHeight || 1)) : 0;
      var _vy = 0.4 + _scrollFrac * 0.2; // somewhere in the visible band
      rulerA = {x: 0.3, y: _vy};
      rulerB = {x: 0.7, y: _vy};
    }
    if (rulerActive) updateRulerSVG();
  });

  ['a','b'].forEach(function(id) {
    var dot = document.getElementById('ruler-dot-'+id);
    if (!dot) return;
    var dragging = false;
    function startDrag(e) {
      e.preventDefault();
      dragging = true;
      dot.setAttribute('opacity', '0');
      dot.style.cursor = 'none';
      document.body.style.cursor = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
      document.addEventListener('touchmove', onMove, {passive: false});
      document.addEventListener('touchend',  onUp);
    }
    dot.addEventListener('mousedown',  startDrag);
    dot.addEventListener('touchstart', startDrag, {passive: false});

    function onMove(e) {
      if (!dragging) return;
      e.preventDefault();
      var area = document.getElementById('sr-canvas-area');
      if (!area) return;
      var rect = area.getBoundingClientRect();
      var clientX = e.touches ? e.touches[0].clientX : e.clientX;
      var clientY = e.touches ? e.touches[0].clientY : e.clientY;
      var fx = (clientX - rect.left) / rect.width;
      var fy = (clientY - rect.top)  / rect.height;
      if (id === 'a') { rulerA.x = fx; rulerA.y = fy; }
      else            { rulerB.x = fx; rulerB.y = fy; }
      updateRulerSVG();
    }
    function onUp() {
      dragging = false;
      dot.setAttribute('opacity', '1');
      dot.style.cursor = 'grab';
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend',  onUp);
    }
  });
}

function updateRulerSVG() {
  var area = document.getElementById('sr-canvas-area');
  if (!area) return;
  var rect = area.getBoundingClientRect();
  var w = rect.width, h = rect.height;
  var ax = rulerA.x * w, ay = rulerA.y * h;
  var bx = rulerB.x * w, by = rulerB.y * h;
  var line  = document.getElementById('ruler-line');
  var dotA  = document.getElementById('ruler-dot-a');
  var dotB  = document.getElementById('ruler-dot-b');
  var label = document.getElementById('ruler-label');
  if (line)  { line.setAttribute('x1',ax); line.setAttribute('y1',ay); line.setAttribute('x2',bx); line.setAttribute('y2',by); }
  if (dotA)  { dotA.setAttribute('cx',ax); dotA.setAttribute('cy',ay); }
  if (dotB)  { dotB.setAttribute('cx',bx); dotB.setAttribute('cy',by); }
  var pxDist = Math.sqrt((bx-ax)*(bx-ax) + (by-ay)*(by-ay));
  var inDist = S.pxPerIn > 0 ? pxDist / S.pxPerIn : 0;
  var distStr = inDist > 0 ? fH(inDist) : '—';
  var mx = (ax+bx)/2, my = (ay+by)/2;
  var angle = Math.atan2(by-ay, bx-ax);
  var perpX = -Math.sin(angle) * 18;
  var perpY =  Math.cos(angle) * 18;
  if (label) { label.setAttribute('x', mx+perpX); label.setAttribute('y', my+perpY); label.textContent = distStr; }
}

initRuler();
wireObjModal();

var ROSE_GOLD_FILTER = 'invert(0.72) sepia(0.25) saturate(450%) hue-rotate(350deg) brightness(0.88)';

// Fetch image via XHR (bypasses image cache, gets proper CORS blob),
// draw to canvas with filter, return data URL.
function bakedDataUrl(src) {
  // Primary path: fetch + createImageBitmap, then draw through the rose-gold
  // filter. Falls back to an <img crossOrigin> draw if the fetch is blocked
  // (e.g. a cross-origin host that allows <img> but not fetch) so Cloudinary
  // object/silhouette images still bake to gold instead of exporting as black.
  function viaImage() {
    return new Promise(function(resolve){
      var im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = function(){
        try {
          var c = document.createElement('canvas');
          c.width = im.naturalWidth || im.width;
          c.height = im.naturalHeight || im.height;
          var ctx = c.getContext('2d');
          ctx.filter = ROSE_GOLD_FILTER;
          ctx.drawImage(im, 0, 0);
          resolve(c.toDataURL('image/png'));
        } catch(e) { resolve(null); }
      };
      im.onerror = function(){ resolve(null); };
      im.src = src;
    });
  }
  return fetch(src, {mode:'cors', credentials:'omit'})
    .then(function(r){ if (!r.ok) throw new Error('bad'); return r.blob(); })
    .then(function(blob){ return createImageBitmap(blob); })
    .then(function(bmp) {
      var c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      var ctx = c.getContext('2d');
      ctx.filter = ROSE_GOLD_FILTER;
      ctx.drawImage(bmp, 0, 0);
      bmp.close && bmp.close();
      return c.toDataURL('image/png');
    })
    .catch(function(){ return viaImage(); });
}

function doCopyImage() {
  var btn = this;
  // Both views capture an INNER content wrapper (not the scroll-clipped outer
  // area): html2canvas renders it and its children fully regardless of an
  // ancestor's overflow, so the whole scene is captured with no live un-clip
  // (hence no flash) and live/capture coordinates always match. The scale is
  // painted onto the canvas afterward for both views.
  var target = S.view === 'length'
    ? document.getElementById('sr-length-zoom')
    : document.getElementById('sr-zoom');
  if (!target || typeof html2canvas === 'undefined') return;

  btn.textContent = '…';
  btn.disabled = true;

  // Element refs + saved state (mutations are deferred until just before capture
  // so the page doesn't visibly "blink" while images are baking over the network).
  var rulerCol     = document.getElementById('sr-ruler-col');
  var lenRulerWrap = document.getElementById('sr-length-ruler-wrap');
  var scrollEl     = document.getElementById('sr-scroll');
  var rulerInner   = document.getElementById('sr-ruler-inner');
  var rulerHidden = false;
  var savedGridBg = scrollEl ? scrollEl.style.backgroundImage : '';
  var savedScroll = null;
  var savedRulerTransform = rulerInner ? rulerInner.style.transform : '';

  // Mutate the live DOM into capture state. Only the scroll un-clip happens on
  // the live page (the crop math measures live element rects, so the full scene
  // must be laid out). Ruler/grid hiding is done in the CLONE instead — see
  // onclone — so the live page never visibly flickers.
  var savedArea = null;
  var savedLenScroll = null;
  function enterCaptureState() {
    // Capturing the inner content wrapper means there's nothing to mutate on the
    // live DOM for the height view — so the page never visibly changes (no
    // flash). The height scale is painted onto the output canvas afterward,
    // computed from the crop's ground line, so it needs no live ruler changes.
  }

  // Pre-bake silhouette/object images (rose-gold filtered) so they render in
  // the capture. Match each baked result to its element by a unique tag rather
  // than array index — index matching broke when the clone's element set/order
  // differed (e.g. ruler present vs absent), which made objects export black.
  var filteredImgs = Array.from(target.querySelectorAll('img.sr-char-img:not(.sr-img-real), img.sr-sil-filter'));
  filteredImgs.forEach(function(img, i){ img.setAttribute('data-bake-id', 'bake' + i); });
  var bakeJobs = filteredImgs.map(function(img){
    var src = img.src;
    return (src ? bakedDataUrl(src) : Promise.resolve(null)).then(function(url){
      return { id: img.getAttribute('data-bake-id'), url: url };
    });
  });

  Promise.all(bakeJobs)
    .then(function(bakeResults) {
    var bakeMap = {};
    bakeResults.forEach(function(r){ bakeMap[r.id] = r.url; });
    // Enter capture state only now (bake finished) so there's no visible flash.
    enterCaptureState();

    // The inner wrapper reports its full content size (it isn't clipped), so
    // these dimensions already cover the whole scene at any zoom.
    var capW = Math.max(target.scrollWidth, target.offsetWidth);
    var capH = Math.max(target.scrollHeight, target.offsetHeight);

    html2canvas(target, {
      logging: false,
      backgroundColor: null,
      useCORS: true,
      allowTaint: false,
      scale: 2,
      width: capW,
      height: capH,
      windowWidth: Math.max(capW, document.documentElement.clientWidth),
      windowHeight: Math.max(capH, document.documentElement.clientHeight),
      scrollX: 0,
      scrollY: 0,
      onclone: function(doc) {
        // Length view: un-clip the area + scroll IN THE CLONE so the full rows
        // and the scale ruler render (no live DOM change, so no flash).
        if (S.view === 'length') {
          var cLenArea = doc.getElementById('sr-length-area');
          var cLenScroll = doc.getElementById('sr-length-scroll');
          if (cLenArea) { cLenArea.style.overflow = 'visible'; cLenArea.style.height = 'auto'; cLenArea.style.maxHeight = 'none'; }
          if (cLenScroll) {
            cLenScroll.style.overflow = 'visible';
            cLenScroll.style.height = 'auto';
            cLenScroll.scrollTop = 0;     // capture from the top, not the scrolled position
            cLenScroll.scrollLeft = 0;
          }
        }
        // The foot/cm scale is painted manually onto the output canvas (see
        // drawHeightScaleOnCanvas). Hide the DOM ruler column with VISIBILITY
        // (not display) so it disappears from the capture but KEEPS its layout
        // box — otherwise the figures would shift and domCropCanvas (which
        // measures the live DOM, where the ruler is still present) would crop
        // the wrong region and clip/overlap the image.
        var cRulerCol = doc.getElementById('sr-ruler-col');
        if (cRulerCol) cRulerCol.style.visibility = 'hidden';
        if (!copyWithScale) {
          var cLenRuler = doc.getElementById('sr-length-ruler-wrap');
          if (cLenRuler) cLenRuler.style.visibility = 'hidden';
        }
        var cScroll = doc.getElementById('sr-scroll');
        if (cScroll && S.gridLines) cScroll.style.backgroundImage = 'none';

        // Swap baked (gold) images in by id. If a bake failed, keep the CSS
        // filter so html2canvas at least attempts the tint.
        Array.from(doc.querySelectorAll('img[data-bake-id]')).forEach(function(img) {
          var url = bakeMap[img.getAttribute('data-bake-id')];
          if (url) { img.src = url; img.style.filter = 'none'; }
        });
      }
    }).then(function(canvas) {
// Paint the foot/cm scale up the left edge of an already-cropped capture canvas.
// We reproduce domCropCanvas's geometry: the crop runs from the content top
// (minY) down to the ground line, with `pad` of padding on every side, all at
// `scale`. So the ground sits at (croppedHeight - pad) and 1 inch = pxPerIn*scale
// canvas pixels. Ticks are drawn from the ground upward.
function drawHeightScaleOnCanvas(canvas, target, scale, padding) {
  var s = scale || 1;
  // The ruler column is a FIXED size relative to the export resolution (it does
  // not grow with zoom — same as the on-screen ruler, which stays ~44px while
  // only the figures scale). pxPerIn already has zoom baked in, so tick spacing
  // tracks the figures while the column thickness stays constant.
  var u = s;
  var pad = (padding || 16) * s;
  var ppi = (S.pxPerIn || 0) * s;     // canvas px per inch (zoom baked into pxPerIn)
  if (ppi <= 0) return canvas;

  var colW = Math.round(46 * u);      // fixed ruler column width
  var H = canvas.height;
  var groundY = H - pad;              // ground line y, measured on the ORIGINAL canvas

  // Build a wider canvas: [ ruler column | original capture ]. This adds the
  // scale to the SIDE rather than painting over the figures.
  var out = document.createElement('canvas');
  out.width = canvas.width + colW;
  out.height = H;
  var ctx = out.getContext('2d');

  // 1) Panel-colour background strip + right divider (matches .sr-ruler-col).
  ctx.fillStyle = '#1a1210';          // --bg-panel
  ctx.fillRect(0, 0, colW, H);
  ctx.strokeStyle = 'rgba(122,82,64,0.55)';   // subtle divider (~--border)
  ctx.lineWidth = Math.max(1, Math.round(1 * u));
  ctx.beginPath();
  ctx.moveTo(colW - 0.5, 0);
  ctx.lineTo(colW - 0.5, H);
  ctx.stroke();

  // 2) Blit the original capture to the right of the column.
  ctx.drawImage(canvas, colW, 0);

  // 3) Draw ticks + labels within the column (sized proportionally to zoom).
  ctx.save();
  ctx.font = Math.round(12 * u) + "px 'Cormorant SC', Georgia, serif";
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'right';
  ctx.lineWidth = Math.max(1, Math.round(1 * u));

  function tickAt(inches, label) {
    var y = groundY - inches * ppi;
    if (y < pad * 0.25 || y > H) return;
    // tick line along the right edge of the column
    ctx.strokeStyle = 'rgba(196,168,130,0.6)';
    ctx.beginPath();
    ctx.moveTo(colW - Math.round(11 * u), y);
    ctx.lineTo(colW, y);
    ctx.stroke();
    // label, right-aligned just inside the column
    ctx.fillStyle = '#c4a882';        // --text-secondary-ish gold
    ctx.fillText(label, colW - Math.round(13 * u), y - Math.round(3 * u));
  }

  if (S.metric) {
    var pxPerCm = ppi / 2.54;
    var stepCm = niceInterval(48 * s, pxPerCm);
    var maxCm = Math.ceil(groundY / pxPerCm) + stepCm;
    for (var cm = 0; cm <= maxCm; cm += stepCm) {
      tickAt(cm / 2.54, cm >= 100 ? (cm/100).toFixed(cm%100===0?0:1)+'m' : cm+'cm');
    }
  } else {
    var inchesPerFt = 12;
    var pxPerFt = ppi * inchesPerFt;
    var stepFt = niceInterval(48 * s, pxPerFt);
    var maxFt = Math.ceil(groundY / pxPerFt) + stepFt;
    for (var f = 0; f <= maxFt; f += stepFt) {
      tickAt(f * inchesPerFt, f + "'");
    }
  }
  ctx.restore();
  return out;
}

// Paint the horizontal length scale along the BOTTOM of an already-cropped
// length-view capture. The rows share a left origin (length = 0) which, after
// cropping with `pad` of left padding, sits at x = pad. Ticks march right at
// pxPerInLen (zoom baked in) * scale. Adds a panel strip below the rows.
function drawLengthScaleOnCanvas(canvas, target, scale, padding) {
  var s = scale || 1;
  var pad = (padding || 16) * s;
  var ppi = (S.pxPerInLen || 0) * s;   // canvas px per inch horizontally
  if (ppi <= 0) return canvas;

  var stripH = Math.round(30 * s);     // height of the scale strip
  var W = canvas.width;
  var H = canvas.height;
  var out = document.createElement('canvas');
  out.width = W;
  out.height = H + stripH;
  var ctx = out.getContext('2d');

  ctx.drawImage(canvas, 0, 0);
  ctx.fillStyle = '#1a1210';           // --bg-panel
  ctx.fillRect(0, H, W, stripH);
  ctx.strokeStyle = 'rgba(122,82,64,0.55)';
  ctx.lineWidth = Math.max(1, Math.round(1 * s));
  ctx.beginPath(); ctx.moveTo(0, H + 0.5); ctx.lineTo(W, H + 0.5); ctx.stroke();

  var originX = pad;   // length 0 sits at the left padding of the crop
  ctx.save();
  ctx.font = Math.round(11 * s) + "px 'Cormorant SC', Georgia, serif";
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#c4a882';
  ctx.strokeStyle = 'rgba(196,168,130,0.6)';

  function tickAt(inches, label) {
    var x = originX + inches * ppi;
    if (x < 0 || x > W) return;
    ctx.beginPath();
    ctx.moveTo(x, H);
    ctx.lineTo(x, H + Math.round(8 * s));
    ctx.stroke();
    ctx.fillText(label, x, H + Math.round(22 * s));
  }

  if (S.metric) {
    var pxPerCm = ppi / 2.54;
    var stepCm = niceInterval(48 * s, pxPerCm);
    var maxCm = Math.ceil((W - originX) / pxPerCm) + stepCm;
    for (var cm = 0; cm <= maxCm; cm += stepCm) {
      tickAt(cm / 2.54, cm >= 100 ? (cm/100).toFixed(cm%100===0?0:1)+'m' : cm+'cm');
    }
  } else {
    var inchSteps = [1,2,3,6,12,24,36,60,120,240];
    var step = inchSteps[inchSteps.length-1];
    for (var si=0; si<inchSteps.length; si++) {
      if (ppi * inchSteps[si] >= 48 * s) { step = inchSteps[si]; break; }
    }
    var maxIn = Math.ceil((W - originX) / ppi) + step;
    for (var i = 0; i <= maxIn; i += step) {
      tickAt(i, i >= 12 ? Math.floor(i/12)+"' "+(i%12)+'"' : i+'"');
    }
  }
  ctx.restore();
  return out;
}

function domCropCanvas(canvas, target, scale, padding) {
  var pad = (padding || 16) * (scale || 1);
  var targetRect = target.getBoundingClientRect();
  var s = scale || 1;
  var isLength = (S.view === 'length');

  // Measure content elements to find bounds on all 4 sides. Each view has its
  // own content elements: the height view uses figure/object wraps; the length
  // view uses its row image wraps.
  var sel = isLength
    ? '.sr-length-row'
    : '.sr-img-wrap, .sr-obj-shape, .sr-obj-img';
  var items = Array.from(target.querySelectorAll(sel));
  if (!items.length) return canvas;

  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  items.forEach(function(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    var x1 = r.left - targetRect.left;
    var y1 = r.top  - targetRect.top;
    var x2 = r.right  - targetRect.left;
    var y2 = r.bottom - targetRect.top;
    if (x1 < minX) minX = x1;
    if (y1 < minY) minY = y1;
    if (x2 > maxX) maxX = x2;
    if (y2 > maxY) maxY = y2;
  });

  if (!isFinite(minX) || maxX <= minX || maxY <= minY) return canvas;

  // Height view: snap the bottom to the ground line. Length view has no ground —
  // use the measured content bottom directly.
  if (!isLength) {
    var ground = target.querySelector('.sr-ground');
    if (ground) {
      var gr = ground.getBoundingClientRect();
      maxY = gr.bottom - targetRect.top;
    }
  }

  // Crop all 4 sides
  var cx  = Math.max(0, Math.round(minX * s - pad));
  var cy  = Math.max(0, Math.round(minY * s - pad));
  var cx2 = Math.min(canvas.width,  Math.round(maxX * s + pad));
  var cy2 = Math.min(canvas.height, Math.round(maxY * s + pad));
  var cw = cx2 - cx, ch = cy2 - cy;
  if (cw < 4 || ch < 4) return canvas;

  var out = document.createElement('canvas');
  out.width = cw; out.height = ch;
  out.getContext('2d').drawImage(canvas, cx, cy, cw, ch, 0, 0, cw, ch);
  return out;
}

      try { canvas = domCropCanvas(canvas, target, 2, 20); } catch(e) { console.warn('domCrop failed:', e); }
      // Draw the foot/cm scale directly onto the cropped canvas with the 2D
      // context. html2canvas does not reliably render the DOM ruler (its labels
      // are CSS ::after pseudo-elements and the column clips/transforms), so for
      // the height view we paint the scale ourselves — guaranteed to appear and
      // stay aligned to the ground line.
      if (copyWithScale && S.view !== 'length') {
        try { canvas = drawHeightScaleOnCanvas(canvas, target, 2, 20); } catch(e) { console.warn('scale draw failed:', e); }
      }
      if (copyWithScale && S.view === 'length') {
        try { canvas = drawLengthScaleOnCanvas(canvas, target, 2, 20); } catch(e) { console.warn('length scale draw failed:', e); }
      }
      canvas.toBlob(function(blob) {
        function restoreDom() {
          if (savedArea && savedArea.el) {
            savedArea.el.style.overflow = savedArea.overflow;
            savedArea.el.style.height = savedArea.height;
            savedArea.el.style.maxHeight = savedArea.maxHeight;
          }
          if (savedLenScroll && savedLenScroll.el) {
            savedLenScroll.el.style.overflowX = savedLenScroll.overflowX;
            savedLenScroll.el.style.overflowY = savedLenScroll.overflowY;
            savedLenScroll.el.style.height = savedLenScroll.height;
            savedLenScroll.el.scrollTop = savedLenScroll.scrollTop;
            savedLenScroll.el.scrollLeft = savedLenScroll.scrollLeft;
          }
          if (scrollEl && savedScroll) {
            scrollEl.style.overflowX = savedScroll.overflowX;
            scrollEl.style.overflowY = savedScroll.overflowY;
            scrollEl.style.height = savedScroll.height;
            scrollEl.scrollTop = savedScroll.scrollTop;
            scrollEl.scrollLeft = savedScroll.scrollLeft;
          }
          if (rulerInner) { rulerInner.style.transform = savedRulerTransform; syncRulerScroll(); }
          // Remove the temporary bake-id tags from the live DOM.
          Array.from(target.querySelectorAll('img[data-bake-id]')).forEach(function(img){ img.removeAttribute('data-bake-id'); });
        }
        if (!blob) { restoreDom(); btn.textContent = '✗'; setTimeout(function(){btn.innerHTML='&#128203;';btn.disabled=false;},1500); return; }
        restoreDom();

        function fallbackDownload() {
          var url = URL.createObjectURL(blob);
          window.open(url, '_blank');
          btn.innerHTML='&#128203;'; btn.disabled=false;
        }

        var canClipboard = typeof ClipboardItem !== 'undefined' &&
          navigator.clipboard && navigator.clipboard.write;

        if (canClipboard) {
          try {
            navigator.clipboard.write([new ClipboardItem({'image/png': blob})]).then(function() {
              btn.textContent = '✓';
              setTimeout(function(){ btn.innerHTML='&#128203;'; btn.disabled=false; }, 1500);
            }).catch(function() { fallbackDownload(); });
          } catch(e) { fallbackDownload(); }
        } else {
          fallbackDownload();
        }
      }, 'image/png');
    }).catch(function() {
      if (savedArea && savedArea.el) {
        savedArea.el.style.overflow = savedArea.overflow;
        savedArea.el.style.height = savedArea.height;
        savedArea.el.style.maxHeight = savedArea.maxHeight;
      }
      if (savedLenScroll && savedLenScroll.el) {
        savedLenScroll.el.style.overflowX = savedLenScroll.overflowX;
        savedLenScroll.el.style.overflowY = savedLenScroll.overflowY;
        savedLenScroll.el.style.height = savedLenScroll.height;
        savedLenScroll.el.scrollTop = savedLenScroll.scrollTop;
        savedLenScroll.el.scrollLeft = savedLenScroll.scrollLeft;
      }
      if (scrollEl && savedScroll) {
        scrollEl.style.overflowX = savedScroll.overflowX;
        scrollEl.style.overflowY = savedScroll.overflowY;
        scrollEl.style.height = savedScroll.height;
        scrollEl.scrollTop = savedScroll.scrollTop;
        scrollEl.scrollLeft = savedScroll.scrollLeft;
      }
      if (rulerInner) { rulerInner.style.transform = savedRulerTransform; syncRulerScroll(); }
      Array.from(target.querySelectorAll('img[data-bake-id]')).forEach(function(img){ img.removeAttribute('data-bake-id'); });
      btn.textContent = '✗';
      setTimeout(function(){ btn.innerHTML='&#128203;'; btn.disabled=false; }, 1500);
    });
  });
}
var _copyBtnH = g('btn-copy-img');
if (_copyBtnH) _copyBtnH.addEventListener('click', doCopyImage);
var _copyBtnL = g('btn-copy-img-length');
if (_copyBtnL) _copyBtnL.addEventListener('click', doCopyImage);
g('btn-metric').addEventListener('click',function(){applyGlobalUnit(true);});

function renderOrSandbox() {
  // Preserve the viewer's scroll position (both axes) across a zoom re-render so
  // it doesn't jump to the bottom-left. This is the function the height zoom
  // buttons actually call.
  var scrollEl = document.getElementById('sr-scroll');
  var frac = null, fracX = null;
  if (scrollEl) {
    if (scrollEl.scrollHeight > scrollEl.clientHeight + 1)
      frac = (scrollEl.scrollTop + scrollEl.clientHeight / 2) / scrollEl.scrollHeight;
    if (scrollEl.scrollWidth > scrollEl.clientWidth + 1)
      fracX = (scrollEl.scrollLeft + scrollEl.clientWidth / 2) / scrollEl.scrollWidth;
  }
  _preserveHeightScrollFrac = frac;
  _preserveHeightScrollFracX = fracX;
  render();
  // Restore horizontal position after the re-render/layout (vertical is handled
  // inside render's zoom block via _preserveHeightScrollFrac).
  if (scrollEl && fracX != null) {
    requestAnimationFrame(function() {
      if (scrollEl.scrollWidth > scrollEl.clientWidth + 1) {
        var tx = fracX * scrollEl.scrollWidth - scrollEl.clientWidth / 2;
        scrollEl.scrollLeft = Math.max(0, Math.min(tx, scrollEl.scrollWidth - scrollEl.clientWidth));
      }
    });
  }
  _preserveHeightScrollFrac = null;
  _preserveHeightScrollFracX = null;
}
var _preserveHeightScrollFracX = null;
g('btn-zoom-in').addEventListener('click',function(){
  if(S.view==='length'){S.zoomL=Math.min(ZMAX,parseFloat((S.zoomL+ZSTEP).toFixed(2)));applyLengthZoom();}
  else{S.zoomH=Math.min(ZMAX,parseFloat((S.zoomH+ZSTEP).toFixed(2)));renderOrSandbox();}
});
g('btn-zoom-out').addEventListener('click',function(){
  if(S.view==='length'){S.zoomL=Math.max(ZMIN,parseFloat((S.zoomL-ZSTEP).toFixed(2)));applyLengthZoom();}
  else{S.zoomH=Math.max(ZMIN,parseFloat((S.zoomH-ZSTEP).toFixed(2)));renderOrSandbox();}
});
g('btn-zoom-reset').addEventListener('click',function(){
  if(S.view==='length'){S.zoomL=0.75;applyLengthZoom();}
  else{S.zoomH=1;renderOrSandbox();}
});
document.querySelectorAll('.custom-clear-btn').forEach(function(btn){btn.addEventListener('click',function(){clearSlot(parseInt(this.getAttribute('data-slot')));});});
document.getElementById('btn-add-char').addEventListener('click', function(){ addSlot('char'); });
document.getElementById('btn-add-obj').addEventListener('click',  function(){ addSlot('obj');  });

// ── Clear all custom data on page load for a clean session ───
(function clearOnLoad() {
  // Clear localStorage custom data for both slots
  var empty = { chars: [] };
  saveCustom(empty);
  // Clear all images from IndexedDB
  openImgDB().then(function(db) {
    var tx = db.transaction(IMG_STORE, 'readwrite');
    tx.objectStore(IMG_STORE).clear();
  }).catch(function(){});
})();

init();
