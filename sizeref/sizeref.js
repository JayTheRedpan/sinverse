'use strict';

// ── State ─────────────────────────────────────────────────────
var S = {
  chars:      [],   // canon characters
  objects:    [],   // scale objects
  builds:     [],   // body builds
  selObj:     null, // selected scale object
  metric:     false,
  zoom:       1,
  pxPerIn:    2,    // updated on each render
  canvasH:    400,  // updated by ResizeObserver
};

var STORE   = 'sinverse_custom_chars';
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
  S.builds  = await fetchJSON('./builds.json', []);

  fillSelects();
  fillObjSelect();
  buildForms();

  // Default: first canon char in slot 0, door as object
  // Create initial slot and set default character
  var slotContainer = document.getElementById('sr-char-slots');
  if (slotContainer) {
    slotContainer.appendChild(createSlotRow());
    updateSlotUI();
    if (S.chars.length) allSlotSelects()[0].value = 'canon_' + S.chars[0].id;
  }
  var door = S.objects.find(function(o){return o.id==='door';});
  if (door) { S.selObj = door; document.getElementById('sel-obj').value = 'door'; }

  // Observe the CANVAS AREA (not scroll) — its height doesn't change when stats populate,
  // so ResizeObserver won't oscillate as stats are cleared and rebuilt each render.
  var area = document.getElementById('sr-canvas-area');
  var areaRect = area ? area.getBoundingClientRect() : null;
  if (areaRect && areaRect.height > 80) S.canvasH = areaRect.height - LABEL_H - 8;

  var ro = new ResizeObserver(function(entries) {
    var h = entries[0].contentRect.height;
    var newH = h - LABEL_H - 8;
    if (newH > 80 && Math.abs(newH - S.canvasH) > 10) {
      S.canvasH = newH;
      render();
    }
  });
  if (area) ro.observe(area);

  render();
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
  var t = Math.round(i), ft = Math.floor(t/12), ins = t%12;
  return ft + "'" + ins + '"';
}
function fH(in_) { return S.metric ? Math.round(inToCm(in_))+' cm' : ftIn(in_); }
function fW(lbs) {
  if (!lbs) return '—';
  return S.metric ? Math.round(lbsToKg(lbs))+' kg' : Math.round(lbs)+' lbs';
}
function fL(in_) { return S.metric ? inToCm(in_).toFixed(1)+' cm' : in_.toFixed(1)+'"'; }

// ── Square-cube ───────────────────────────────────────────────
function sc(hIn, buildId) {
  var b = S.builds.find(function(b){return b.id===buildId;});
  return (b && hIn) ? b.referenceWeight * Math.pow(hIn/b.referenceHeight, 3) : null;
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
  if (c1||c2) {
    var custG = el('optgroup'); custG.label = 'Custom';
    if(c1){var o=el('option');o.value='custom_1';o.textContent=c1.name+' (custom)';custG.appendChild(o);}
    if(c2){var o=el('option');o.value='custom_2';o.textContent=c2.name+' (custom)';custG.appendChild(o);}
    sel.appendChild(custG);
  }
  if (cur) sel.value = cur;
}

function fillSelects() {
  allSlotSelects().forEach(function(sel) { buildSelectOptions(sel); });
}

function allSlotSelects() {
  return Array.from(document.querySelectorAll('.slot-select'));
}

function fillObjSelect() {
  var sel = document.getElementById('sel-obj');
  sel.innerHTML = '<option value="">-- None --</option>';
  S.objects.forEach(function(o) {
    var opt = el('option'); opt.value = o.id; opt.textContent = o.label; sel.appendChild(opt);
  });
}

// getChar replaced by allChars() + allSlotSelects()

function allChars() {
  return allSlotSelects().map(function(sel) {
    var v = sel.value; if (!v) return null;
    if (v.startsWith('canon_')) {
      var id = parseInt(v.replace('canon_','')); return S.chars.find(function(c){return c.id===id;})||null;
    }
    if (v.startsWith('custom_')) {
      var d = loadCustom(); return d[v==='custom_1'?'slot1':'slot2']||null;
    }
    return null;
  }).filter(Boolean);
}

// ── Render ────────────────────────────────────────────────────
function render() {
  var chars   = allChars();
  var scene   = document.getElementById('sr-scene');
  var empty   = document.getElementById('sr-empty');
  var figs    = document.getElementById('sr-figures');
  var stats   = document.getElementById('sr-stats');

  figs.innerHTML = '';
  stats.innerHTML = '';


  if (!chars.length && !S.selObj) {
    scene.style.display = 'none'; empty.style.display = '';
    updateRuler();
    return;
  }
  scene.style.display = ''; empty.style.display = 'none';

  // Max effective height across all entities
  var maxH = 0;
  chars.forEach(function(c) {
    var eff = c.height * (c.height_correction || 1);
    if (eff > maxH) maxH = eff;
  });
  if (S.selObj && S.selObj.height > maxH) maxH = S.selObj.height;
  if (maxH < 1) maxH = 72;

  // pixels per inch: fill the canvas height
  S.pxPerIn = S.canvasH / maxH;

  // Render figures (images only) + labels (separate row below ground)
  chars.forEach(function(c) { renderChar(figs, c); });
  if (S.selObj) renderObj(figs, S.selObj);

  // Stats
  chars.forEach(function(c) { stats.appendChild(statBlock(c)); });

  // Apply current zoom and rebuild ruler
  applyZoom();
}

function renderChar(figs, char) {
  var effH = char.height * (char.height_correction || 1);
  var pH   = Math.max(4, Math.round(effH * S.pxPerIn));

  var iw = el('div'); iw.className = 'sr-img-wrap';
  iw.style.height = pH + 'px';
  // Only constrain height — let width follow the image's natural aspect ratio
  if (char.image) {
    var img = el('img');
    img.src = char.image; img.alt = char.name; img.className = 'sr-char-img';
    iw.appendChild(img);
  } else {
    var pW = Math.max(20, Math.round(pH * 0.45));
    iw.style.width = pW + 'px';
    iw.innerHTML = silhouette(pH, pW);
  }
  figs.appendChild(iw);
}

function renderObj(figs, obj) {
  var pH = Math.max(4, Math.round(obj.height * S.pxPerIn));
  var iw = el('div'); iw.className = 'sr-img-wrap';
  iw.style.height = pH + 'px';

  if (obj.image) {
    var img = el('img');
    img.src = obj.image; img.alt = obj.label; img.className = 'sr-char-img';
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
function applyZoom() {
  var zoomEl = document.getElementById('sr-zoom');
  if (zoomEl) {
    zoomEl.style.transform = 'scale('+S.zoom+')';
    zoomEl.style.transformOrigin = 'bottom left';
  }

  // Vertical scroll: padding-top creates accessible space above the figures.
  // align-items:flex-end keeps the ground at the bottom. Extra space opens at
  // the top so the user can scroll UP to see tall character heads.
  var scroll = document.getElementById('sr-scroll');
  if (scroll) {
    var extraH = Math.max(0, Math.round(S.canvasH * (S.zoom - 1)));
    scroll.style.paddingTop = extraH + 'px';
    // Keep ground visible: scroll to bottom so the figures are always in view
    // Use requestAnimationFrame so the padding paint happens first
    requestAnimationFrame(function() { scroll.scrollTop = scroll.scrollHeight; });
  }

  document.getElementById('zoom-label').textContent = Math.round(S.zoom*100)+'%';
  updateRuler();
}

// ── Ruler ─────────────────────────────────────────────────────
// Ruler is OUTSIDE zoom — tick positions calculated with zoom factor applied
function updateRuler() {
  var col   = document.getElementById('sr-ruler-col');
  var inner = document.getElementById('sr-ruler-inner');
  if (!inner || !col) return;
  inner.innerHTML = '';

  var colH = col.offsetHeight;
  if (colH < 10) return;
  if (S.pxPerIn <= 0) return;

  // Effective px per inch at current zoom level
  var effPx = S.pxPerIn * S.zoom;

  // The ruler-inner bottom is offset by LABEL_H so 0ft aligns with the ground line.
  // The usable ruler height is colH minus the label space at the bottom.
  var rulerH = colH - LABEL_H;
  if (rulerH < 10) return;

  // Draw ticks for the full visible ruler height
  var maxFt = Math.ceil(rulerH / effPx / 12) + 1;
  for (var f = 0; f <= maxFt; f++) {
    var px = Math.round(f * 12 * effPx);
    if (px > rulerH + 2) break;
    var tick = el('div'); tick.className = 'sr-ruler-tick';
    tick.style.bottom = px + 'px';
    tick.setAttribute('data-label', S.metric ? Math.round(f*12*2.54)+'cm' : f+'ft');
    inner.appendChild(tick);
  }
}

// ── Stat block ────────────────────────────────────────────────
function statBlock(char) {
  var block = el('div'); block.className = 'sr-stat-block';

  var effH_in = char.height * (char.height_correction || 1);
  var poseRow = (char.height_correction && char.height_correction < 0.99)
    ? '<div class="sr-stat-row"><span class="sr-stat-key"></span><span class="sr-stat-val sr-stat-note">renders as '+fH(effH_in)+' (posed)</span></div>' : '';

  block.innerHTML =
    '<div class="sr-stat-name">'+char.name+(char.canonical?' <span class="sr-stat-canon">&#10022;</span>':'')+'</div>'+
    '<div class="sr-stat-grid">'+
      '<div class="sr-stat-row"><span class="sr-stat-key">Height</span><span class="sr-stat-val">'+fH(char.height)+'</span></div>'+
      poseRow+
      '<div class="sr-stat-row"><span class="sr-stat-key">Weight</span><span class="sr-stat-val">'+fW(char.weight)+'</span></div>'+
      (char.faction?'<div class="sr-stat-row"><span class="sr-stat-key">Faction</span><span class="sr-stat-val">'+char.faction+'</span></div>':'')+
    '</div>'+
    (char.wiki?'<a href="../wiki/#'+char.wiki+'" class="sr-wiki-link">View wiki &rarr;</a>':'');

  return block;
}

// ── Custom forms ──────────────────────────────────────────────
function buildForms() {
  [1,2].forEach(buildForm);
}

function buildForm(slot) {
  var wrap = document.getElementById('custom'+slot+'-form');
  if (!wrap) return;
  wrap.innerHTML = '';
  var ex = loadCustom()['slot'+slot];

  // Reload existing image into cropImgs so crop works after refresh
  if (ex && ex.image) {
    setTimeout(function() { preloadCropImg(slot, ex.image); }, 80);
  }

  // Name
  wrap.appendChild(field('Name *', inp('text','n'+slot,'Character name',ex?ex.name:'')));

    // Height
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

  // Weight
  var wf = cf('Weight');
  var exCorr = ex ? String(ex.height_correction||'1') : '1';
  wf.innerHTML +=
    '<div class="btn-row" style="margin-bottom:.4rem">' +
      '<button class="unit-btn active wm" data-slot="'+slot+'" data-m="build">From build</button>' +
      '<button class="unit-btn wm" data-slot="'+slot+'" data-m="calc">Calculate</button>' +
      '<button class="unit-btn wm" data-slot="'+slot+'" data-m="manual">Manual</button>' +
    '</div>' +
    // Build
    '<div id="wb-'+slot+'">' +
      '<select class="builder-input" id="bsel-'+slot+'"></select>' +
      '<div class="wt-est" id="best-'+slot+'"></div>' +
    '</div>' +
    // Calculate
    '<div id="wc-'+slot+'" style="display:none">' +
      '<div class="cf-hint" style="margin-bottom:.3rem">Weight at 6ft — square-cube scales to character height</div>' +
      '<div class="row">' +
        '<input id="ref-'+slot+'" class="builder-input numInput" type="number" min="0" value="170" />' +
        '<span class="sep" id="runit-'+slot+'">'+(!S.metric?'lbs at 6ft':'kg at 183cm')+'</span>' +
      '</div>' +
      '<div class="wt-est" id="cres-'+slot+'"></div>' +
    '</div>' +
    // Manual
    '<div id="wm-'+slot+'" style="display:none">' +
      '<div class="row" id="wmi-'+slot+'">' +
        '<input id="lbs-'+slot+'" class="builder-input numInput" type="number" min="0" placeholder="lbs" value="'+(ex&&ex.weight?Math.round(ex.weight):'')+'" />' +
        '<span class="sep">lbs</span>' +
      '</div>' +
      '<div class="row" id="wmm-'+slot+'" style="display:none">' +
        '<input id="kg-'+slot+'" class="builder-input numInput" type="number" min="0" placeholder="kg" value="'+(ex&&ex.weight?Math.round(lbsToKg(ex.weight)):'')+'" />' +
        '<span class="sep">kg</span>' +
      '</div>' +
    '</div>';
  wrap.appendChild(wf);

  // Populate builds
  var bsel = document.getElementById('bsel-'+slot);
  S.builds.forEach(function(b){var o=el('option');o.value=b.id;o.textContent=b.label;bsel.appendChild(o);});
  bsel.value = 'average';

  // Pose
  var pf = cf('Pose / Position');
  var psel = el('select'); psel.className='builder-input'; psel.id='pose-'+slot;
  POSES.forEach(function(p){var o=el('option');o.value=p.v;o.textContent=p.l;if(p.v===exCorr)o.selected=true;psel.appendChild(o);});
  pf.appendChild(psel);
  wrap.appendChild(pf);

  // Image
  var imgf = cf('Image');
  imgf.innerHTML +=
    '<input id="iurl-'+slot+'" class="builder-input" type="text" placeholder="Paste image URL..." value="'+(ex&&ex.image&&ex.image.startsWith('http')?ex.image:'')+'" />' +
    '<div class="btn-row" style="margin-top:.3rem">' +
      '<button class="unit-btn iurl-btn" data-slot="'+slot+'">Load URL</button>' +
      (ex&&ex.image?'<button class="unit-btn iremove-btn" data-slot="'+slot+'" style="color:var(--wine)">Remove</button>':'') +
    '</div>' +
    '<div class="custom-or">or upload</div>' +
    '<input id="ifile-'+slot+'" type="file" accept="image/*" class="file-input" />' +
    '<div id="ipw-'+slot+'" style="'+(ex&&ex.image?'':'display:none')+'">' +
      '<img id="ipre-'+slot+'" class="prev-img" src="'+(ex&&ex.image?ex.image:'')+'" alt="preview" />' +
      '<details class="crop-det" style="margin-top:.4rem">' +
        '<summary>Crop image (optional)</summary>' +
        '<div class="crop-img-wrap" id="ciwrap-'+slot+'">' +
          '<img id="csrc-'+slot+'" class="crop-src" src="" alt="" />' +
          '<div class="crop-line crop-line-t" id="cl-t-'+slot+'"></div>' +
          '<div class="crop-line crop-line-b" id="cl-b-'+slot+'"></div>' +
          '<div class="crop-line crop-line-l" id="cl-l-'+slot+'"></div>' +
          '<div class="crop-line crop-line-r" id="cl-r-'+slot+'"></div>' +
        '</div>' +
        '<div class="crop-pct-grid">' +
          '<div class="crop-pct-row"><div class="crop-pct-label">Top %</div><input type="number" class="builder-input crop-pct-input" id="ct-'+slot+'" min="0" max="99" value="0" /></div>' +
          '<div class="crop-pct-row"><div class="crop-pct-label">Bottom %</div><input type="number" class="builder-input crop-pct-input" id="cb-'+slot+'" min="0" max="99" value="0" /></div>' +
          '<div class="crop-pct-row"><div class="crop-pct-label">Left %</div><input type="number" class="builder-input crop-pct-input" id="cl2-'+slot+'" min="0" max="99" value="0" /></div>' +
          '<div class="crop-pct-row"><div class="crop-pct-label">Right %</div><input type="number" class="builder-input crop-pct-input" id="cr-'+slot+'" min="0" max="99" value="0" /></div>' +
        '</div>' +
        '<button class="unit-btn" id="creset-'+slot+'" style="margin-top:.4rem">Reset crop</button>' +
      '</details>' +
    '</div>';
  wrap.appendChild(imgf);

  wireForm(slot, wrap);
  refreshEst(slot);
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

// ── Wire form ─────────────────────────────────────────────────

var MAX_SLOTS = 10;

function createSlotRow() {
  var row = el('div'); row.className = 'sr-slot-row';

  var sel = el('select'); sel.className = 'sr-select slot-select';
  buildSelectOptions(sel, '');
  sel.addEventListener('change', function() { render(); });

  var rmBtn = el('button'); rmBtn.className = 'slot-remove-btn'; rmBtn.title = 'Remove';
  rmBtn.innerHTML = '&#10005;';
  rmBtn.addEventListener('click', function() { removeSlot(row); });

  row.appendChild(sel);
  row.appendChild(rmBtn);
  return row;
}

function addSlot() {
  var container = document.getElementById('sr-char-slots');
  if (!container) return;
  var slots = container.querySelectorAll('.sr-slot-row');
  if (slots.length >= MAX_SLOTS) return;
  container.appendChild(createSlotRow());
  updateSlotUI();
}

function removeSlot(row) {
  var container = document.getElementById('sr-char-slots');
  if (!container) return;
  if (container.querySelectorAll('.sr-slot-row').length <= 1) return;
  row.remove();
  updateSlotUI();
  render();
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
}

function wireForm(slot, wrap) {
  function save() { autoSave(slot); }

  // Name, pose
  var ni = document.getElementById('n'+slot); if(ni) ni.addEventListener('input',save);
  var ps = document.getElementById('pose-'+slot); if(ps) ps.addEventListener('change',save);

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
      syncH(slot,S.metric); refreshEst(slot); refreshCalc(slot); save();
    });
  });

  // Build select
  var bs=g('bsel-'+slot); if(bs)bs.addEventListener('change',function(){refreshEst(slot);save();});

  // Calc ref
  var ri=g('ref-'+slot); if(ri)ri.addEventListener('input',function(){refreshCalc(slot);save();});

  // Manual weight
  ['lbs-','kg-'].forEach(function(p){var i=g(p+slot);if(i)i.addEventListener('input',save);});

  // Image URL
  var urlBtn=wrap.querySelector('.iurl-btn');
  if(urlBtn)urlBtn.addEventListener('click',function(){
    var u=g('iurl-'+slot).value.trim(); if(u)loadImg(slot,u);
  });

  // Remove image
  var rmBtn=wrap.querySelector('.iremove-btn');
  if(rmBtn)rmBtn.addEventListener('click',function(){
    g('ipw-'+slot).style.display='none';
    g('ipre-'+slot).src=''; g('iurl-'+slot).value='';
    cropImgs[slot]=null; save();
  });

  // File upload
  var fi=g('ifile-'+slot);
  if(fi)fi.addEventListener('change',function(){
    var f=this.files[0]; if(!f) return;
    var r=new FileReader(); r.onload=function(e){loadImg(slot,e.target.result);}; r.readAsDataURL(f);
  });

  // Crop pct inputs -- auto apply on change
  ['ct-','cb-','cl2-','cr-'].forEach(function(p){
    var i=g(p+slot); if(i)i.addEventListener('input',function(){updateLines(slot);applyCrop(slot);});
  });

  // Reset crop
  var crst=g('creset-'+slot);
  if(crst)crst.addEventListener('click',function(){resetCrop(slot);});

  // Draggable crop lines
  wireCropLines(slot);
}

// ── Height sync ───────────────────────────────────────────────
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
  var char={
    id:'custom_'+slot, name:ni.value.trim(),
    height:h, height_correction:corr,
    weight:getWlbs(slot), image:img,
    canonical:false, custom:true,
  };
  var d=loadCustom(); d['slot'+slot]=char; saveCustom(d);
  // Refresh selects preserving current values
  var sels=allSlotSelects();
  var vals=sels.map(function(s){return s.value;});
  fillSelects();
  allSlotSelects().forEach(function(s,i){s.value=vals[i]||'';});
  if(vals.some(function(v){return v==='custom_'+slot;})) render();
}

// ── Image / crop ──────────────────────────────────────────────
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

function wireCropLines(slot) {
  var lines=[
    {id:'cl-t-'+slot,inp:'ct-'+slot,axis:'y',dir:1},
    {id:'cl-b-'+slot,inp:'cb-'+slot,axis:'y',dir:-1},
    {id:'cl-l-'+slot,inp:'cl2-'+slot,axis:'x',dir:1},
    {id:'cl-r-'+slot,inp:'cr-'+slot,axis:'x',dir:-1},
  ];
  lines.forEach(function(line){
    var el2=g(line.id); if(!el2)return;
    var startPos=0,startVal=0,dragging=false;
    function client(e){return e.touches?(line.axis==='x'?e.touches[0].clientX:e.touches[0].clientY):(line.axis==='x'?e.clientX:e.clientY);}
    function onStart(e){e.preventDefault();dragging=true;startPos=client(e);startVal=clampV(line.inp);
      document.addEventListener('mousemove',onMove);document.addEventListener('mouseup',onEnd);
      document.addEventListener('touchmove',onMove,{passive:false});document.addEventListener('touchend',onEnd);}
    function onMove(e){if(!dragging)return;if(e.cancelable)e.preventDefault();
      var iw=g('ciwrap-'+slot);var wrapSz=iw?((line.axis==='x'?iw.offsetWidth:iw.offsetHeight)):200;if(!wrapSz)return;
      var delta=(client(e)-startPos)*line.dir;var pct=Math.round(delta/wrapSz*100);
      var inp2=g(line.inp);if(!inp2)return;inp2.value=Math.min(99,Math.max(0,startVal+pct));
      updateLines(slot);applyCrop(slot);}
    function onEnd(){dragging=false;document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onEnd);
      document.removeEventListener('touchmove',onMove);document.removeEventListener('touchend',onEnd);}
    el2.addEventListener('mousedown',onStart,{passive:false});el2.addEventListener('touchstart',onStart,{passive:false});
  });
}

// ── Storage ───────────────────────────────────────────────────
function loadCustom(){try{return JSON.parse(localStorage.getItem(STORE))||{slot1:null,slot2:null};}catch(e){return{slot1:null,slot2:null};}}
function saveCustom(d){try{localStorage.setItem(STORE,JSON.stringify(d));}catch(e){}}

function clearSlot(slot){
  if(!confirm('Clear custom slot '+slot+'?'))return;
  var d=loadCustom(); d['slot'+slot]=null; saveCustom(d);
  allSlotSelects().forEach(function(sel){if(sel.value==='custom_'+slot)sel.value='';});
  fillSelects(); buildForms(); render();
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
// slot selects wired per-slot in createSlotRow()
g('sel-obj').addEventListener('change',function(){var id=this.value;S.selObj=id?S.objects.find(function(o){return o.id===id;}):null;render();});
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
    refreshEst(slot);
    refreshCalc(slot);
  });
  render();
}
g('btn-imperial').addEventListener('click',function(){applyGlobalUnit(false);});
g('btn-metric').addEventListener('click',function(){applyGlobalUnit(true);});
g('btn-zoom-in').addEventListener('click',function(){S.zoom=Math.min(ZMAX,parseFloat((S.zoom+ZSTEP).toFixed(2)));applyZoom();});
g('btn-zoom-out').addEventListener('click',function(){S.zoom=Math.max(ZMIN,parseFloat((S.zoom-ZSTEP).toFixed(2)));applyZoom();});
g('btn-zoom-reset').addEventListener('click',function(){S.zoom=1;applyZoom();});
document.querySelectorAll('.custom-clear-btn').forEach(function(btn){btn.addEventListener('click',function(){clearSlot(parseInt(this.getAttribute('data-slot')));});});
document.getElementById('btn-add-slot').addEventListener('click', addSlot);

init();