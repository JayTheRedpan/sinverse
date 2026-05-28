'use strict';

// ── State ─────────────────────────────────────────────────────
var S = {
  heightOverrides: {},  // charId -> override inches (session only)
  gridLines:    false,  // show scale grid lines across viewer
  perspActive:  {},     // slotIdx -> active perspective tab index
  chars:       [],
  objects:     [],
  builds:      [],
  metric:      false,
  zoomH:       1,
  zoomL:       0.5,
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
    ['slot1','slot2'].forEach(function(k) {
      if (!d[k]) return;
      ['image','length_image','profile_image'].forEach(function(f) {
        if (d[k][f] && d[k][f].startsWith('data:')) { d[k][f] = ''; changed = true; }
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
};

function populateDefaults(data) {
  DEFAULTS.heightSils    = data.height_silhouettes   || [];
  DEFAULTS.lengthSils    = data.length_silhouettes   || [];
  DEFAULTS.headshotSils  = data.headshot_silhouettes || [];
  DEFAULTS.lengthPresets = data.length_presets       || [];
  S.builds              = data.builds              || [];
  DEFAULTS.heightSils.forEach(function(s)   { DEFAULTS.height[s.id]   = s.url; });
  DEFAULTS.headshotSils.forEach(function(s) { DEFAULTS.headshot[s.id] = s.url; });
  DEFAULTS.length = DEFAULTS.lengthSils.length ? DEFAULTS.lengthSils[0].url : '';
}
var LABEL_H = 0;   // no labels below ground
var ZSTEP   = 0.25;
var ZMIN    = 0.25;
var ZMAX    = 8;
var cropImgs = {};   // slot -> Image object

var POSES = [
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
  var defsData = await fetchJSON('./defaults.json', {});
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
    var ro = new ResizeObserver(function() { renderActive(); });
    if (area) ro.observe(area);
  });
}

// ── URL param handling (bot/deeplink support) ──────────────────
function applyURLParams() {
  var p = new URLSearchParams(window.location.search);
  if (!p.toString()) return;

  // ── Set view ──────────────────────────────────────────────
  var view = p.get('view');
  if (view && ['height','length','stats','compare'].indexOf(view) > -1) {
    // Click the actual view button so all side effects (render, zoom, etc.) fire
    var viewBtn = document.querySelector('.sr-view-btn[data-view="' + view + '"]');
    if (viewBtn) viewBtn.click();
  }

  // ── Screenshot mode: render canvas area as full-page image ──
  if (p.get('screenshot') === '1') {
    // Wait for render to settle, then auto-capture like clipboard button
    setTimeout(function() {
      var target = S.view === 'length'
        ? document.getElementById('sr-length-area')
        : document.getElementById('sr-canvas-area');
      if (!target || typeof html2canvas === 'undefined') return;

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
      var d = loadCustom();
      var key = customSlot === 1 ? 'slot1' : 'slot2';
      if (!d[key]) d[key] = {};
      d[key].name   = n || (customSlot === 1 ? 'Character 1' : 'Character 2');
      d[key].height = parseFloat(h);
      d[key].i_has_img = false;
      saveCustom(d);
      return 'custom_' + customSlot;
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
    if (kg >= 907184)  return fmt(kg/907184, 1, 'kt');
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
  var customs = loadCustom();
  var cur = preserveValue !== undefined ? preserveValue : sel.value;
  sel.innerHTML = '<option value="">-- Select --</option>';
  var cg = el('optgroup'); cg.label = 'Canon';
  S.chars.forEach(function(c) {
    var o = el('option'); o.value = 'canon_'+c.id; o.textContent = c.name; cg.appendChild(o);
  });
  sel.appendChild(cg);
  var c1 = loadCustom().slot1, c2 = loadCustom().slot2;
  var c1valid = c1 && c1.name && c1.height;
  var c2valid = c2 && c2.name && c2.height;
  if (c1valid || c2valid) {
    var custG = el('optgroup'); custG.label = 'Custom';
    if(c1valid){var o=el('option');o.value='custom_1';o.textContent=c1.name+' (custom)';custG.appendChild(o);}
    if(c2valid){var o=el('option');o.value='custom_2';o.textContent=c2.name+' (custom)';custG.appendChild(o);}
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
    var d = loadCustom(); return d[v==='custom_1'?'slot1':'slot2']||null;
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
  var ov = S.heightOverrides[slotIdx];
  if (ov !== undefined) return ov;
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
  if (document.getElementById('sr-global-resize-popup')) return;
  var chars   = allChars();
  var scene   = document.getElementById('sr-scene');
  var empty   = document.getElementById('sr-empty');
  var figs    = document.getElementById('sr-figures');
  var stats   = document.getElementById('sr-stats');

  figs.innerHTML = '';
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
        if (obj) stats.appendChild(objStatBlock(obj));
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
      if (obj) renderObj(figs, obj);
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
      requestAnimationFrame(function() { scrollEl2.scrollTop = scrollEl2.scrollHeight; });
    } else {
      scene2.style.minHeight = '';
      scrollEl2.style.overflowY = 'hidden';
    }
  }

  // Rebuild ruler (uses updated S.pxPerIn)
  updateRuler();
  updateHeightGrid();

  document.getElementById('zoom-label').textContent = Math.round(S.zoomH*100)+'%';
}

function renderChar(figs, char, slotIdx) {
  var effH = effectiveHSlot(char, slotIdx !== undefined ? slotIdx : -1);
  var pH   = Math.max(4, Math.round(effH * S.pxPerIn));
  // Add headroom for hair/ears/hats — extra px above skull, doesn't affect height scale
  var headroomPx = char.headroom_pct ? Math.round(pH * char.headroom_pct / 100) : 0;

  var iw = el('div'); iw.className = 'sr-img-wrap';
  iw.style.height = (pH + headroomPx) + 'px';
  // Only constrain height — let width follow the image's natural aspect ratio
  var img = el('img');
  var defaultSil = (DEFAULTS.height[char.default_silhouette] || DEFAULTS.height.giantess || '../images/character-default.svg');
  var usingDefault = !char.image;
  img.src = char.image || defaultSil;
  img.alt = char.name;
  // sr-img-real skips the brightening filter — only silhouettes need it
  img.className = 'sr-char-img' + (usingDefault ? '' : ' sr-img-real');
  iw.appendChild(img);
  figs.appendChild(iw);
}

// Draw image to canvas with flip/rotate for length view alignment
function orientedImgEl(src, flip, rotateDeg, filter) {
  var img = el('img');
  img.className = filter ? 'sr-char-img' : 'sr-char-img sr-img-real';
  if (!flip && !rotateDeg) {
    img.src = src;
    return img;
  }
  // Use canvas to pre-bake the transform so layout is correct
  var loader = new Image();
  loader.crossOrigin = 'anonymous';
  loader.onload = function() {
    var w = loader.naturalWidth, h = loader.naturalHeight;
    var rotated = (rotateDeg === 90 || rotateDeg === 270);
    var cw = rotated ? h : w;
    var ch = rotated ? w : h;
    var c = el('canvas'); c.width = cw; c.height = ch;
    var ctx = c.getContext('2d');
    ctx.translate(cw/2, ch/2);
    if (rotateDeg) ctx.rotate(rotateDeg * Math.PI / 180);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(loader, -w/2, -h/2);
    img.src = c.toDataURL('image/png');
  };
  loader.src = src;
  return img;
}

function renderObj(figs, obj) {
  var pH = Math.max(4, Math.round(obj.height * S.pxPerIn));
  var iw = el('div'); iw.className = 'sr-img-wrap';
  iw.style.height = pH + 'px';

  if (obj.image) {
    var img = el('img');
    img.src = obj.image; img.alt = obj.label;
    // Object silhouettes get the same rose-gold filter as character silhouettes
    img.className = 'sr-char-img';  // filter applied by default via CSS
    iw.appendChild(img);
  } else {
    // Fallback: colored bar
    var shape = el('div'); shape.className = 'sr-obj-shape';
    shape.style.height = '100%'; shape.style.width = '44px';
    shape.style.background = obj.color || '#888';
    iw.style.width = '44px';
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
  render();  // re-render with new pxPerIn = canvasH * zoomH / maxH
}

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
  var colH = areaEl ? areaEl.clientHeight - 4 : col.offsetHeight;
  if (colH < 10) return;

  var effPx = S.pxPerIn; // zoom baked in

  if (S.metric) {
    var pxPerCm = effPx / 2.54;
    var step = niceInterval(48, pxPerCm);
    var maxCm = Math.ceil(colH / pxPerCm) + step;
    for (var cm = 0; cm <= maxCm; cm += step) {
      var px = Math.round(cm * pxPerCm);
      if (px > colH + 2) break;
      var tick = el('div'); tick.className = 'sr-ruler-tick';
      tick.style.bottom = px + 'px';
      tick.setAttribute('data-label', cm >= 100 ? (cm/100).toFixed(cm%100===0?0:1)+'m' : cm+'cm');
      inner.appendChild(tick);
    }
  } else {
    var pxPerFt = effPx * 12;
    var step = niceInterval(48, pxPerFt);
    var maxFt = Math.ceil(colH / pxPerFt) + step;
    for (var f = 0; f <= maxFt; f += step) {
      var px = Math.round(f * pxPerFt);
      if (px > colH + 2) break;
      var tick = el('div'); tick.className = 'sr-ruler-tick';
      tick.style.bottom = px + 'px';
      tick.setAttribute('data-label', f+"'");
      inner.appendChild(tick);
    }
  }
}

// ── Stat block ────────────────────────────────────────────────
function objStatBlock(obj) {
  var block = el('div'); block.className = 'sr-stat-block';
  block.innerHTML =
    '<div class="sr-stat-name">'+obj.label+'</div>'+
    '<div class="sr-stat-grid">'+
      '<div class="sr-stat-row"><span class="sr-stat-key">Height</span><span class="sr-stat-val">'+fH(obj.height)+'</span></div>'+
    '</div>';
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

function resizeControlsHTML(char, slotIdx) {
  if (char.custom) return '';
  var ovH = S.heightOverrides[slotIdx];
  var isOv = ovH !== undefined;
  var effH = effectiveHSlot(char, slotIdx);
  var curFt = Math.floor(effH / 12);
  var curIn = Math.round(effH % 12);
  var curCm = Math.round(effH * 2.54);
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
      (isOv ? '<button class="unit-btn sv-resize-reset" data-slotidx="' + slotIdx + '">Reset</button>' : '') +
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
            ? '<input class="sr-resize-cm builder-input numInput" type="number" min="0" placeholder="cm" value="' + curCm2 + '" /><span class="sv-resize-unit">cm</span>'
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
          var cm = parseFloat(popup.querySelector('.sr-resize-cm').value);
          if (!cm || cm <= 0) return;
          inches = cm / 2.54;
        } else {
          var ft  = parseFloat(popup.querySelector('.sr-resize-ft').value) || 0;
          var ins = parseFloat(popup.querySelector('.sr-resize-in').value) || 0;
          inches = ft * 12 + ins;
          if (inches <= 0) return;
        }
        S.heightOverrides[idx2] = inches;
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
        var cmEl = popup2 && popup2.querySelector('.sr-resize-cm');
        var cm = cmEl ? parseFloat(cmEl.value) : 0;
        if (!cm || cm <= 0) return;
        inches = cm / 2.54;
      } else {
        var ftEl = popup2 && popup2.querySelector('.sr-resize-ft');
        var inEl = popup2 && popup2.querySelector('.sr-resize-in');
        var ft  = ftEl ? (parseFloat(ftEl.value) || 0) : 0;
        var ins = inEl ? (parseFloat(inEl.value) || 0) : 0;
        inches = ft * 12 + ins;
        if (inches <= 0) return;
      }
      S.heightOverrides[idx2] = inches;
      closeResizePopup();
      renderActive();
      if (S.view !== 'stats') renderStatsView();
      return;
    }

    if (btn.classList.contains('sr-resize-close')) { closeResizePopup(); return; }

    if (btn.classList.contains('sv-resize-reset')) {
      var idx3 = parseInt(btn.getAttribute('data-slotidx'));
      delete S.heightOverrides[idx3];
      closeResizePopup();
      renderActive();
      if (S.view !== 'stats') renderStatsView();
    }
  });
}

function statBlock(char, slotIdx) {
  var block = el('div'); block.className = 'sr-stat-block';

  var effH_in = effectiveHSlot(char, slotIdx);
  var isOv = S.heightOverrides[slotIdx] !== undefined;
  var trueH = isOv ? effH_in : char.height;  // true canonical height
  var isPosed = char.height_correction && char.height_correction < 0.99;
  var poseRow = isPosed
    ? '<div class="sr-stat-row"><span class="sr-stat-key"></span><span class="sr-stat-val sr-stat-note">renders as '+fH(effH_in)+' (posed)</span></div>' : '';

  block.innerHTML =
    '<div class="sr-stat-name">'+char.name+
      (char.canonical?' <span class="sr-stat-canon">&#10022;</span>':'')+
      (isOv?' <span class="sr-override-badge">&#x21D4;</span>':'')+
    '</div>'+
    '<div class="sr-stat-grid">'+
      '<div class="sr-stat-row"><span class="sr-stat-key">Height</span><span class="sr-stat-val">'+fH(trueH)+'</span></div>'+
      poseRow+
      '<div class="sr-stat-row"><span class="sr-stat-key">Weight</span><span class="sr-stat-val">'+fW(scaledWeight(char, slotIdx))+'</span></div>'+
    '</div>'+
    '<div class="sr-stat-resize-wrap">'+resizeControlsHTML(char, slotIdx)+'</div>'+
    (char.wiki?'<a href="../wiki/?character='+char.name.toLowerCase()+'" class="sr-wiki-link">View wiki &rarr;</a>':'<div class="sr-wiki-spacer"></div>');

  wireResizeControls(block);
  return block;
}


// ── Stats view ─────────────────────────────────────────────────
var REF_H_IN   = 72;   // reference height: 6ft
var REF_W_LB   = 170;  // reference weight: 170lbs
var REF_STD_H  = 72;   // standard person height for perspective section
var REF_ARM_IN = 24;   // intimate viewing distance (arm's length in inches)

// Bust size reference volumes at 5'6" (66in) in litres per breast
var BUST_REFS = [
  {id:'flat',  label:'Flat',      volL:0.01},
  {id:'a',     label:'A Cup',     volL:0.18},
  {id:'b',     label:'B Cup',     volL:0.27},
  {id:'c',     label:'C Cup',     volL:0.42},
  {id:'d',     label:'D Cup',     volL:0.60},
  {id:'dd',    label:'DD / E Cup',volL:0.85},
  {id:'f',     label:'F Cup',     volL:1.20},
  {id:'g',     label:'G Cup',     volL:1.65},
  {id:'h',     label:'H Cup',     volL:2.30},
  {id:'j',     label:'J Cup',     volL:3.20},
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
  var REF_PROJ = [0.5, 1.8, 2.3, 2.9, 3.5, 4.2, 5.0, 5.8, 6.8, 8.0];
  var REF_WID  = [1.5, 3.5, 4.2, 5.0, 5.8, 6.5, 7.2, 8.0, 9.0,10.0];
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
  if (slotIdx !== undefined && S.heightOverrides[slotIdx] !== undefined) return S.heightOverrides[slotIdx];
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
    penisWidIn:      1.45 * hR,   // avg erect diameter ~1.45" (girth/π)
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
    penisGirthIn:    4.6 * hR,   // avg circumference 4.6" scaled by height
    testicleG:      20   * mR,   // avg 20g each, scale with mass
    penisG:        100   * Math.pow(hR, 3), // avg 100g, volume scales hR^3
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

    var isOvStats = S.heightOverrides[slotIdx] !== undefined;

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
        var isOvSV = S.heightOverrides[slotIdx] !== undefined;
        var trueHSV = isOvSV ? effectiveHSlot(char, slotIdx) : char.height;
        var poseNoteSV = (!isOvSV && char.height_correction && char.height_correction < 0.99)
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

  // Wire resize controls via event delegation
  scroll.addEventListener('click', function(e) {
    var btn = e.target.closest('.sv-resize-set, .sv-resize-reset');
    if (!btn) return;
    var charId = parseInt(btn.getAttribute('data-charid'));
    if (btn.classList.contains('sv-resize-reset')) {
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
  if (!scrollEl) return;
  if (!S.gridLines || S.pxPerIn <= 0) {
    scrollEl.style.backgroundImage = 'none';
    return;
  }
  // Use CSS repeating-linear-gradient on sr-scroll — no DOM elements,
  // covers the full scroll area, anchored to bottom like the ruler
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
  // Measure the ruler element's actual left edge relative to the scroll container
  // to get the precise 0-mark offset
  var rulerEl = document.getElementById('sr-length-ruler');
  var offsetPx = 90 + 24; // fallback: HEADSHOT_W + 1.5rem padding
  if (rulerEl && scrollEl) {
    var rulerRect  = rulerEl.getBoundingClientRect();
    var scrollRect = scrollEl.getBoundingClientRect();
    offsetPx = rulerRect.left - scrollRect.left + scrollEl.scrollLeft;
  }
  // Use two backgrounds: solid block to hide lines left of 0, then repeating lines
  var blockColor = 'var(--bg)';  // same as viewer background
  scrollEl.style.backgroundImage =
    'linear-gradient(to right, ' + blockColor + ' ' + offsetPx + 'px, transparent ' + offsetPx + 'px), ' +
    'repeating-linear-gradient(to right, ' + lineColor + ' 0px, ' + lineColor + ' 1px, transparent 1px, transparent ' + stepPx + 'px)';
  scrollEl.style.backgroundSize = '100% 100%, ' + stepPx + 'px 100%';
  scrollEl.style.backgroundPosition = '0 0, ' + offsetPx + 'px 0';
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
      if (c) entities.push({kind:'char', data:c, slotIdx:idx, hasLength: !!(c.length)});
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
    // No-length chars only contribute to maxLen when in body mode
    if (e.kind === 'char' && !e.data.length && eMode !== 'height') return;
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
  // For chars with no length (fem chars):
  // - length mode: portrait only row (no length bar)
  // - body mode: fall through to normal render with height as display length
  if (entity.kind === 'char' && !entity.data.length) {
    var femEntityId = entity.data.id || entity.data.name;
    var femMode = S.lenImgMode[femEntityId] || 'length';
    if (femMode !== 'height') {
      // Portrait-only — hsWrap already built above, just wrap and return
      row.appendChild(hsWrap);
      return row;
    }
    // Body mode: fall through — effLen will use height, lenMode will trigger height image
  }

  // For no-length chars in body mode, use their height as the display length
  var effLen;
  if (entity.kind === 'char' && !entity.data.length) {
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
  // Zoom baked into pxPerInLen — renderLengthView recalculates and updates ruler
  renderLengthView();
}

function updateLengthRuler(maxLen, pxPerIn) {
  var ruler = document.getElementById('sr-length-ruler');
  if (!ruler) return;
  ruler.innerHTML = '';
  var effPx = pxPerIn;  // zoom baked in
  var rulerW = ruler.getBoundingClientRect().width || 400;

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
  var d = loadCustom()['slot'+slot];
  var hasPenis = !d || !d.anatomy || d.anatomy.penis !== false;
  var lengthEl = document.querySelector('.custom'+slot+'-length-section');
  if (!lengthEl) return;
  lengthEl.style.opacity = hasPenis ? '' : '0.35';
  lengthEl.style.pointerEvents = hasPenis ? '' : 'none';
  // Put tip in the summary header
  var summary = lengthEl.querySelector('.form-det-summary');
  var lockSpan = summary ? summary.querySelector('.anat-lock-tip') : null;
  if (summary && !hasPenis && !lockSpan) {
    var tip = document.createElement('span');
    tip.className = 'anat-lock-tip';
    tip.textContent = ' — enable "Penis" in Anatomy to edit';
    tip.style.cssText = 'font-family:var(--font-body);font-size:0.62rem;letter-spacing:0;text-transform:none;color:var(--text-muted);font-style:italic;';
    summary.appendChild(tip);
  } else if (lockSpan && hasPenis) {
    lockSpan.remove();
  }
}

function lengthStatBlock(char, slotIdx) {
  var block = el('div'); block.className = 'sr-stat-block';
  var effLen = scaledLength(char, slotIdx) || 0;
  var entityId = char.id || char.name;
  var mode = S.lenImgMode[entityId] || 'length';
  var isOv = S.heightOverrides[slotIdx] !== undefined;

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
        S.zoomL = 0.5;  // reset zoom so new content fits
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
  [1,2].forEach(buildForm);
}

function buildForm(slot) {
  var wrap = document.getElementById('custom'+slot+'-form');
  if (!wrap) return;
  wrap.innerHTML = '';
  var ex = loadCustom()['slot'+slot];
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
  var anatDet = makeDet('Anatomy', false, 'section-stats');
  var anatBody = anatDet.querySelector('.det-body');
  var anatF = cf('Features');

  var exAnat = ex && ex.anatomy ? ex.anatomy : {};
  var hasBreasts = exAnat.breasts !== false;   // default on
  var hasPenis   = exAnat.penis   !== false;   // default on
  var hasVag     = exAnat.vag     === true;    // default OFF

  var exBust = exAnat.bustSize || 'c';
  var bustOpts = BUST_REFS.map(function(b){
    return '<option value="'+b.id+'"'+(b.id===exBust?' selected':'')+'>'+b.label+'</option>';
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
  wrap.appendChild(anatDet);

  // ── HEIGHT section ──────────────────────────────
  var heightDet = makeDet('Height', false, 'section-height');
  var heightBody = heightDet.querySelector('.det-body');

  // Height input
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
  heightBody.appendChild(hf);

  // Height image: silhouette dropdown + upload option
  var curHSilId = (ex && ex.default_silhouette) || (DEFAULTS.heightSils[0] && DEFAULTS.heightSils[0].id) || '';
  var hasHUpload = !!(ex && (ex.image || ex.i_has_img));
  var hselVal = hasHUpload ? 'upload' : curHSilId;
  var himgF = cf('Height image');
  himgF.innerHTML +=
    '<select class="builder-input hsilh-sel" id="hsilh-'+slot+'">' +
      DEFAULTS.heightSils.map(function(s){return '<option value="'+s.id+'"'+(hselVal===s.id?' selected':'')+'>'+s.label+'</option>';}).join('') +
      '<option value="upload"'+(hselVal==='upload'?' selected':'')+'>Upload / Link image</option>' +
    '</select>';
  heightBody.appendChild(himgF);

  // Upload + pose — only shown when Upload selected
  var hUpload = uploadSection(slot, 'i', 'Height image', ex&&ex.image?ex.image:'');
  hUpload.id = 'hupload-'+slot;
  hUpload.style.display = hselVal==='upload'?'':'none';
  heightBody.appendChild(hUpload);

  // Headroom offset — extra space above skull for hair, ears, hats etc.
  var exHeadroom = ex && ex.headroom_pct ? ex.headroom_pct : 0;
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
  heightBody.appendChild(hrf);

  var pf = cf('Pose');
  pf.id = 'hpose-'+slot;
  pf.style.display = hasHUpload ? '' : 'none';
  pf.innerHTML += '<div class="cf-hint" style="margin-bottom:.3rem">Adjust if image shows seated or crouching</div>' +
    '<select class="builder-input" id="pose-'+slot+'">' +
    POSES.map(function(p){return '<option value="'+p.v+'"'+(p.v===exCorr?' selected':'')+'>'+p.l+'</option>';}).join('') +
    '</select>';
  heightBody.appendChild(pf);

  wrap.appendChild(heightDet);

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

  // Length image section — wrapped so it can be hidden for fem characters
  var lsildWrap = el('div'); lsildWrap.id = 'lsild-'+slot;
  var lsf = cf('Length image');
  var curLSil = (ex && ex.default_length_silhouette) || (DEFAULTS.lengthSils[0] && DEFAULTS.lengthSils[0].id) || '';
  var hasCustomLImg = ex && ex.length_image && ex.length_image.startsWith('data');
  var lsilVal = hasCustomLImg ? 'custom' : curLSil;
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

  var exFlip = ex && ex.length_orient_flip;
  var exRot  = ex && ex.length_orient_rotate ? ex.length_orient_rotate : 0;
  var orientF = cf('Image orientation');
  orientF.id = 'lorient-'+slot;
  orientF.style.display = lsilVal === 'custom' ? '' : 'none';
  orientF.innerHTML +=
    '<div class="btn-row">' +
      '<label class="orient-check"><input type="checkbox" id="lflip-'+slot+'"'+(exFlip?' checked':'')+' /> Flip horizontally</label>' +
    '</div>' +
    '<div class="cf-label" style="margin-top:.5rem;margin-bottom:.3rem">Rotate</div>' +
    '<div class="btn-row">' +
      '<button class="unit-btn lrot-btn'+(exRot===0?' active':'')+'" data-slot="'+slot+'" data-rot="0">0°</button>' +
      '<button class="unit-btn lrot-btn'+(exRot===90?' active':'')+'" data-slot="'+slot+'" data-rot="90">90°</button>' +
      '<button class="unit-btn lrot-btn'+(exRot===180?' active':'')+'" data-slot="'+slot+'" data-rot="180">180°</button>' +
      '<button class="unit-btn lrot-btn'+(exRot===270?' active':'')+'" data-slot="'+slot+'" data-rot="270">270°</button>' +
    '</div>';
  lsildWrap.appendChild(orientF);
  lengthBody.appendChild(lsildWrap);

  wrap.appendChild(lengthDet);

  // ── STATS section ───────────────────────────────
  var statsDet = makeDet('Stats', false, 'section-stats');
  var statsBody = statsDet.querySelector('.det-body');

  // Profile image: dropdown (silhouette or upload)
  var curPSilId = (ex && ex.default_headshot_silhouette) || (DEFAULTS.headshotSils[0] && DEFAULTS.headshotSils[0].id) || '';
  var hasPUpload = !!(ex && ex.profile_image);
  var pselVal = hasPUpload ? 'upload' : curPSilId;
  var pimgF = cf('Profile image');
  pimgF.innerHTML +=
    '<select class="builder-input psil-sel" id="psil-'+slot+'">' +
      DEFAULTS.headshotSils.map(function(s){
        return '<option value="'+s.id+'"'+(pselVal===s.id?' selected':'')+'>'+s.label+'</option>';
      }).join('') +
      '<option value="upload"'+(pselVal==='upload'?' selected':'')+'>Upload / Link image</option>' +
    '</select>';
  statsBody.appendChild(pimgF);

  // Profile upload — immediately after dropdown
  var pUpload = uploadSection(slot, 'p', 'Profile / Headshot', ex&&ex.profile_image?ex.profile_image:'');
  pUpload.id = 'pupload-'+slot;
  pUpload.style.display = pselVal==='upload'?'':'none';
  statsBody.appendChild(pUpload);

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

  // Profile upload (only shown when 'upload' selected)
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
  if (srcImg && srcImg.src) bigImg.src = srcImg.src;

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
    sel.innerHTML = '<option value="">-- Select object --</option>';
    S.objects.forEach(function(o) {
      var opt = el('option'); opt.value = o.id; opt.textContent = o.label; sel.appendChild(opt);
    });
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
    if (srcIdx < destIdx) {
      container.insertBefore(dragSrc, this.nextSibling);
    } else {
      container.insertBefore(dragSrc, this);
    }
    renderActive();
    // Re-render stats cards in new slot order if stats view active
    if (S.view === 'stats') renderStatsView();
  }
  this.classList.remove('slot-drag-over');
  return false;
}

function onDragEnd(e) {
  document.querySelectorAll('.sr-slot-row').forEach(function(r) {
    r.classList.remove('slot-dragging', 'slot-drag-over');
  });
  dragSrc = null;
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
  if ((type || 'char') === 'char') {
    var sel = row.querySelector('.slot-select');
    if (sel) openCharModal(sel);
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

function openCharModal(sel) {
  modalTargetSel = sel;
  var overlay = document.getElementById('char-modal-overlay');
  var search  = document.getElementById('char-modal-search');
  if (!overlay) return;
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
  var grid    = document.getElementById('char-modal-grid');
  var customs = loadCustom();
  if (!grid) return;
  grid.innerHTML = '';
  var q = query.trim().toLowerCase();

  // Collect all character entries
  var entries = [];
  S.chars.forEach(function(c) {
    entries.push({value:'canon_'+c.id, name:c.name,
      img:c.profile_image||'',
      sil:c.default_headshot_silhouette||c.default_silhouette||'giantess', canon:true});
  });
  if (customs.slot1 && customs.slot1.name && customs.slot1.height)
    entries.push({value:'custom_1', name:customs.slot1.name+' (custom)',
      img:customs.slot1.profile_image||'',
      sil:'giantess', canon:false});
  if (customs.slot2 && customs.slot2.name && customs.slot2.height)
    entries.push({value:'custom_2', name:customs.slot2.name+' (custom)',
      img:customs.slot2.profile_image||'',
      sil:'giantess', canon:false});

  var filtered = q ? entries.filter(function(e){ return e.name.toLowerCase().indexOf(q) >= 0; }) : entries;

  filtered.forEach(function(entry) {
    var card = document.createElement('div');
    card.className = 'cpm-card';
    var imgUrl = entry.img || DEFAULTS.headshot[entry.sil] || DEFAULTS.headshot.giantess || '';
    var isReal = !!entry.img;
    card.innerHTML =
      '<div class="cpm-img-wrap">' +
        '<img class="cpm-img'+(isReal?'':' sr-sil-filter')+'" src="'+imgUrl+'" alt="'+entry.name+'" />' +
      '</div>' +
      '<div class="cpm-name">'+entry.name+'</div>';
    card.addEventListener('click', function() {
      if (modalTargetSel) {
        modalTargetSel.value = entry.value;
        modalTargetSel.dispatchEvent(new Event('change'));
      }
      closeCharModal();
    });
    grid.appendChild(card);
  });

  if (!filtered.length) {
    grid.innerHTML = '<div class="cpm-empty">No characters found</div>';
  }
}

function wireCharModal() {
  document.getElementById('char-modal-close').addEventListener('click', closeCharModal);

  // Resize popup backdrop
  var resizeBd = document.getElementById('sr-resize-backdrop');
  if (resizeBd) resizeBd.addEventListener('click', closeResizePopup);
  document.getElementById('char-modal-overlay').addEventListener('click', function(e) {
    if (e.target === this) closeCharModal();
  });
  document.getElementById('char-modal-search').addEventListener('input', function() {
    buildModalGrid(this.value);
  });
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
    // pose and headroom only shown after an image is actually loaded
    var hpo=g('hpose-'+slot);     if(hpo)hpo.style.display='none';
    var hhr=g('hheadroom-'+slot); if(hhr)hhr.style.display='none';
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
    var lorient=g('lorient-'+slot); if(lorient)lorient.style.display=isCustom?'':'none';
    // Clear the uploaded image when switching back to a silhouette
    if(!isCustom) {
      var lpre=g('lpre-'+slot); if(lpre) lpre.src='';
      var lurl=g('lurl-'+slot); if(lurl) lurl.value='';
      delete cropImgs['l'+slot];
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
  var lflip=g('lflip-'+slot);
  if(lflip) lflip.addEventListener('change',function(){
    save(); if(S.view==='length') renderLengthView();
  });

  // Length orientation — rotate buttons
  var wrap3=document.getElementById('custom'+slot+'-form');
  if(wrap3) wrap3.querySelectorAll('.lrot-btn').forEach(function(btn){
    btn.addEventListener('click',function(){
      if(wrap3) wrap3.querySelectorAll('.lrot-btn').forEach(function(b){b.classList.remove('active');});
      this.classList.add('active');
      save(); if(S.view==='length') renderLengthView();
    });
  });

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
          if (v) loadImgP(slot, pfx, v);
        }, 100);
      });
      urlInp.addEventListener('input', function() {
        clearTimeout(urlDebounce);
        urlDebounce = setTimeout(function() {
          var v = urlInp.value.trim();
          if (v && (v.startsWith('http://') || v.startsWith('https://'))) loadImgP(slot, pfx, v);
        }, 800);
      });
    }
    var rmBtn=wrap.querySelector('.'+pfx+'remove-btn');
    if(rmBtn) rmBtn.addEventListener('click',function(){
      var pw=g(pfx+'pw-'+slot); if(pw)pw.style.display='none';
      var pre=g(pfx+'pre-'+slot); if(pre)pre.src='';
      var ui=g(pfx+'url-'+slot); if(ui)ui.value='';
      cropImgs[pfx+slot]=null;
      deleteImg('custom_' + slot + '_' + pfx);
      // Clear the has_img flag
      var d2 = loadCustom();
      var sk2 = 'slot'+slot;
      if (d2[sk2]) { delete d2[sk2][pfx+'_has_img']; saveCustom(d2); }
      // Reset crop values
      [pfx+'ct-', pfx+'cb-', pfx+'cl2-', pfx+'cr-'].forEach(function(p) {
        var inp = g(p+slot); if (inp) inp.value = '0';
      });
      // Reset headroom if it's the height image
      if (pfx === 'i') {
        var hrInp2 = g('headroom-'+slot);
        if (hrInp2) hrInp2.value = '0';
        var hrLbl2 = g('headroom-lbl-'+slot);
        if (hrLbl2) hrLbl2.textContent = '0%';
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

  var lpi=g('lpre-'+slot);  // this is the preview img (correct)
  var length_image=lpi&&lpi.src&&!lpi.src.endsWith(window.location.href)?lpi.src:'';
  if(!length_image){var lui=g('lurl-'+slot);if(lui&&lui.value.trim().startsWith('http'))length_image=lui.value.trim();}

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
  var prevSaved = (loadCustom())['slot'+slot] || {};
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
    anatomy: (function(){
      var prev = (loadCustom()['slot'+slot]||{}).anatomy || {};
      ['breasts','penis','vag'].forEach(function(k){
        var b = g('anat-'+k+'-'+slot);
        if (b) prev[k] = b.classList.contains('active');
      });
      var bustSelEl = g('bust-sel-'+slot);
      if (bustSelEl) prev.bustSize = bustSelEl.value;
      return prev;
    })(),
  };
  var d=loadCustom(); d['slot'+slot]=char; saveCustom(d);
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
function loadCustom(){try{return JSON.parse(localStorage.getItem(STORE))||{slot1:null,slot2:null};}catch(e){return{slot1:null,slot2:null};}}
function saveCustom(d){try{localStorage.setItem(STORE,JSON.stringify(d));}catch(e){}}

function clearSlot(slot){
  if(!confirm('Clear custom slot '+slot+'?'))return;
  var d=loadCustom(); d['slot'+slot]=null; saveCustom(d);
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

// ── Tab switching ─────────────────────────────────────────────
function switchTab(tab){
  document.querySelectorAll('.sr-tab').forEach(function(t){t.classList.toggle('active',t.getAttribute('data-tab')===tab);});
  document.querySelectorAll('.sr-tab-panel').forEach(function(p){p.style.display='none';});
  var panel=document.getElementById('tab-'+tab); if(panel)panel.style.display='';
}

// ── Utility ───────────────────────────────────────────────────
function g(id){return document.getElementById(id);}

// ── Event wiring ──────────────────────────────────────────────
document.querySelectorAll('.sr-tab').forEach(function(t){t.addEventListener('click',function(){switchTab(this.getAttribute('data-tab'));});});
document.querySelectorAll('.sr-view-tab').forEach(function(t){t.addEventListener('click',function(){switchView(this.getAttribute('data-view'));});});
// slot selects wired per-slot in createSlotRow()

function applyGlobalUnit(isM) {
  S.metric = isM;
  g('btn-imperial').classList.toggle('active', !isM);
  g('btn-metric').classList.toggle('active', isM);
  // Update each custom form: show correct fields, convert values, refresh estimates
  [1,2].forEach(function(slot) {
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
var ROSE_GOLD_FILTER = 'invert(0.72) sepia(0.25) saturate(450%) hue-rotate(350deg) brightness(0.88)';

// Fetch image via XHR (bypasses image cache, gets proper CORS blob),
// draw to canvas with filter, return data URL.
function bakedDataUrl(src) {
  return fetch(src, {mode:'cors', credentials:'omit'})
    .then(function(r){ return r.blob(); })
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
    .catch(function(){ return null; });
}

g('btn-copy-img').addEventListener('click', function() {
  var btn = this;
  var target = S.view === 'length'
    ? document.getElementById('sr-length-area')
    : document.getElementById('sr-canvas-area');
  if (!target || typeof html2canvas === 'undefined') return;

  btn.textContent = '…';
  btn.disabled = true;

  // Gather filtered images and pre-bake them (reload with CORS)
  var filteredImgs = Array.from(target.querySelectorAll('img.sr-char-img:not(.sr-img-real), img.sr-sil-filter'));
  var srcList = filteredImgs.map(function(img){ return img.src; });

  Promise.all(srcList.map(function(src){ return src ? bakedDataUrl(src) : Promise.resolve(null); }))
    .then(function(bakedUrls) {

    html2canvas(target, {
      backgroundColor: null,  // transparent — silhouettes show correctly on any background
      useCORS: true,
      allowTaint: false,
      scale: 2,
      onclone: function(doc) {
        // Swap filtered images to baked versions in the clone
        var cloneImgs = Array.from(doc.querySelectorAll('img.sr-char-img:not(.sr-img-real), img.sr-sil-filter'));
        cloneImgs.forEach(function(img, i) {
          if (bakedUrls[i]) {
            img.src = bakedUrls[i];
            img.style.filter = 'none';
          }
        });
      }
    }).then(function(canvas) {
      canvas.toBlob(function(blob) {
        if (!blob) { btn.textContent = '✗'; setTimeout(function(){btn.innerHTML='&#128203;';btn.disabled=false;},1500); return; }
        try {
          navigator.clipboard.write([new ClipboardItem({'image/png': blob})]).then(function() {
            btn.textContent = '✓';
            setTimeout(function(){ btn.innerHTML='&#128203;'; btn.disabled=false; }, 1500);
          }).catch(function() {
            var url = URL.createObjectURL(blob);
            window.open(url, '_blank');
            btn.innerHTML='&#128203;'; btn.disabled=false;
          });
        } catch(e) {
          var url = URL.createObjectURL(blob);
          window.open(url, '_blank');
          btn.innerHTML='&#128203;'; btn.disabled=false;
        }
      }, 'image/png');
    }).catch(function() {
      btn.textContent = '✗';
      setTimeout(function(){ btn.innerHTML='&#128203;'; btn.disabled=false; }, 1500);
    });
  });
});
g('btn-metric').addEventListener('click',function(){applyGlobalUnit(true);});
g('btn-zoom-in').addEventListener('click',function(){
  if(S.view==='length'){S.zoomL=Math.min(ZMAX,parseFloat((S.zoomL+ZSTEP).toFixed(2)));applyLengthZoom();}
  else{S.zoomH=Math.min(ZMAX,parseFloat((S.zoomH+ZSTEP).toFixed(2)));render();}
});
g('btn-zoom-out').addEventListener('click',function(){
  if(S.view==='length'){S.zoomL=Math.max(ZMIN,parseFloat((S.zoomL-ZSTEP).toFixed(2)));applyLengthZoom();}
  else{S.zoomH=Math.max(ZMIN,parseFloat((S.zoomH-ZSTEP).toFixed(2)));render();}
});
g('btn-zoom-reset').addEventListener('click',function(){
  if(S.view==='length'){S.zoomL=0.5;applyLengthZoom();}
  else{S.zoomH=1;render();}
});
document.querySelectorAll('.custom-clear-btn').forEach(function(btn){btn.addEventListener('click',function(){clearSlot(parseInt(this.getAttribute('data-slot')));});});
document.getElementById('btn-add-char').addEventListener('click', function(){ addSlot('char'); });
document.getElementById('btn-add-obj').addEventListener('click',  function(){ addSlot('obj');  });

// ── Clear all custom data on page load for a clean session ───
(function clearOnLoad() {
  // Clear localStorage custom data for both slots
  var empty = { slot1: null, slot2: null };
  saveCustom(empty);
  // Clear all images from IndexedDB
  openImgDB().then(function(db) {
    var tx = db.transaction(IMG_STORE, 'readwrite');
    tx.objectStore(IMG_STORE).clear();
  }).catch(function(){});
})();

init();
