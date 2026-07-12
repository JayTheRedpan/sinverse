/* ==========================================================================
   Jay's Stash — hidden combined gallery + library module.
   A unified grid mixing image entries and story entries. Images open in an
   in-page lightbox; stories open in an in-page markdown reader. Self-contained:
   reads only stash/stash.json (no dependence on gallery/library data).
   ========================================================================== */
'use strict';

var stashItems = [];
var state = {
  search: '',
  searchModes: { title: true, creator: true },
  kinds: { image: true, story: true },
  tagStates: {},            // tag -> 'include' | 'exclude' (absent = neutral)
  sort: 'newest'
};

var TAG_KEY = 'sinverse_stash_tag_states';

// ── Boot ──────────────────────────────────────────────────────────────────
async function init() {
  try {
    var res = await fetch('./stash.json');
    if (!res.ok) throw new Error('Could not load stash.json');
    stashItems = await res.json();
  } catch (e) {
    document.getElementById('stash-grid').innerHTML =
      '<div class="loading-placeholder">Nothing here yet.</div>';
    return;
  }
  loadTagState();
  buildTagFilters();
  wireControls();
  // Seed filter state from the URL (shareable links + restore-on-return).
  var hadUrlState = readURLState();

  // Reflect the seeded state onto the controls.
  var si = document.getElementById('stash-search');
  if (si && state.search) si.value = state.search;

  document.querySelectorAll('.search-mode-btn').forEach(function (b) {
    var m = b.getAttribute('data-mode');
    if (m in state.searchModes) b.classList.toggle('active', state.searchModes[m]);
  });
  document.querySelectorAll('#stash-kind-filters .type-toggle-btn').forEach(function (b) {
    var k = b.getAttribute('data-kind') || b.getAttribute('data-type');
    if (k && k in state.kinds) b.classList.toggle('active', state.kinds[k]);
  });
  var so = document.getElementById('stash-sort');
  if (so && state.sort) so.value = state.sort;
  if (typeof reflectTagButtons === 'function') reflectTagButtons();
  else document.querySelectorAll('#stash-tag-filters .tag-filter-btn').forEach(function (btn) {
    if (typeof paintTagButton === 'function') paintTagButton(btn, btn.getAttribute('data-tag'));
  });
  if (typeof updateTagHint === 'function') updateTagHint();

  // Clean up the legacy ?creator= param now that it's folded into state.
  if (hadUrlState) {
    var clean = new URL(window.location.href);
    clean.searchParams.delete('creator');
    window.history.replaceState({}, '', clean);
  }

  applyFilters();
}

// ── Creator helpers (support single string OR array, for collabs) ────────────
// An item's creator may be a string ("Kyrm") or an array (["Kyrm","Sushi"]) for
// collaborations. These normalize both to a clean array and a display string,
// so the rest of the module never has to care which form the data is in.
function creatorList(it) {
  if (!it) return [];
  var c = it.creator;
  if (Array.isArray(c)) return c.filter(function(n){ return n && String(n).trim(); }).map(String);
  if (c && String(c).trim()) return [String(c)];
  return [];
}
function creatorText(it) {
  var list = creatorList(it);
  if (!list.length) return '';
  if (list.length === 1) return list[0];
  if (list.length === 2) return list[0] + ' & ' + list[1];
  return list.slice(0, -1).join(', ') + ' & ' + list[list.length - 1];
}

// ── Tag state persistence ───────────────────────────────────────────────────
function loadTagState() {
  try {
    var raw = localStorage.getItem(TAG_KEY);
    if (raw) state.tagStates = JSON.parse(raw) || {};
  } catch (e) { state.tagStates = {}; }
}
function persistTagState() {
  try { localStorage.setItem(TAG_KEY, JSON.stringify(state.tagStates)); } catch (e) {}
}

// ── Tag filter UI (tristate: neutral -> include -> exclude -> neutral) ──────
function allTags() {
  var set = {};
  stashItems.forEach(function (it) { (it.tags || []).forEach(function (t) { set[t] = true; }); });
  return Object.keys(set).sort();
}

function buildTagFilters() {
  var wrap = document.getElementById('stash-tag-filters');
  if (!wrap) return;
  wrap.innerHTML = '';
  var tags = allTags();
  if (!tags.length) { wrap.innerHTML = '<span class="tag-empty">No tags yet.</span>'; updateTagHint(); return; }
  tags.forEach(function (tag) {
    var btn = document.createElement('button');
    btn.className = 'tag-filter-btn';
    btn.setAttribute('data-tag', tag);
    btn.textContent = tag;
    btn.addEventListener('click', function () {
      var cur = state.tagStates[tag];
      if (!cur) state.tagStates[tag] = 'include';
      else if (cur === 'include') state.tagStates[tag] = 'exclude';
      else delete state.tagStates[tag];
      paintTagButton(btn, tag);
      persistTagState();
      updateTagHint();
      applyFilters();
    });
    wrap.appendChild(btn);
    paintTagButton(btn, tag);
  });
  updateTagHint();
}

function paintTagButton(btn, tag) {
  var st = state.tagStates[tag];
  btn.classList.remove('include', 'exclude');
  if (st === 'include') { btn.classList.add('include'); btn.textContent = '＋ ' + tag; }
  else if (st === 'exclude') { btn.classList.add('exclude'); btn.textContent = '－ ' + tag; }
  else { btn.textContent = tag; }
}

function reflectTagButtons() {
  document.querySelectorAll('#stash-tag-filters .tag-filter-btn').forEach(function (btn) {
    paintTagButton(btn, btn.getAttribute('data-tag'));
  });
}

function updateTagHint() {
  var hint = document.getElementById('stash-tag-hint');
  if (!hint) return;
  var inc = 0, exc = 0;
  Object.keys(state.tagStates).forEach(function (k) {
    if (state.tagStates[k] === 'include') inc++;
    else if (state.tagStates[k] === 'exclude') exc++;
  });
  if (!inc && !exc) { hint.textContent = ''; return; }
  var parts = [];
  if (inc) parts.push('requiring ' + inc + ' tag' + (inc > 1 ? 's' : ''));
  if (exc) parts.push('excluding ' + exc + ' tag' + (exc > 1 ? 's' : ''));
  hint.textContent = 'Showing items ' + parts.join(' · ');
}

// ── Controls wiring ─────────────────────────────────────────────────────────
function wireControls() {
  var search = document.getElementById('stash-search');
  if (search) search.addEventListener('input', function () { state.search = this.value.trim().toLowerCase(); applyFilters(); });

  var clear = document.getElementById('stash-clear');
  if (clear) clear.addEventListener('click', resetAll);

  var ft = document.getElementById('stash-filter-toggle');
  var fp = document.getElementById('stash-filter-panel');
  if (ft && fp) ft.addEventListener('click', function () { fp.classList.toggle('open'); });

  document.querySelectorAll('#stash-kind-filters .type-toggle-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var k = this.getAttribute('data-kind');
      state.kinds[k] = !state.kinds[k];
      this.classList.toggle('active', state.kinds[k]);
      applyFilters();
    });
  });

  document.querySelectorAll('.search-mode-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var m = this.getAttribute('data-mode');
      // Don't allow turning the last active mode off (would search nothing).
      var activeCount = document.querySelectorAll('.search-mode-btn.active').length;
      if (state.searchModes[m] && activeCount <= 1) return;
      state.searchModes[m] = !state.searchModes[m];
      this.classList.toggle('active', state.searchModes[m]);
      applyFilters();
    });
  });

  var tagClear = document.getElementById('stash-tag-clear');
  if (tagClear) tagClear.addEventListener('click', function () {
    state.tagStates = {};
    persistTagState();
    reflectTagButtons();
    updateTagHint();
    applyFilters();
  });

  var sort = document.getElementById('stash-sort');
  if (sort) sort.addEventListener('change', function () { state.sort = this.value; applyFilters(); });

  // Lightbox close
  var lb = document.getElementById('stash-lightbox');
  var lbClose = document.getElementById('stash-lightbox-close');
  if (lbClose) lbClose.addEventListener('click', closeLightbox);
  if (lb) lb.addEventListener('click', function (e) { if (e.target === lb) closeLightbox(); });

  // Reader close
  var rClose = document.getElementById('stash-reader-close');
  if (rClose) rClose.addEventListener('click', closeReader);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeLightbox(); closeReader(); }
  });
}

function resetAll() {
  state.search = '';
  state.searchModes = { title: true, creator: true };
  state.kinds = { image: true, story: true };
  state.tagStates = {};
  state.sort = 'newest';
  persistTagState();
  var s = document.getElementById('stash-search'); if (s) s.value = '';
  var so = document.getElementById('stash-sort'); if (so) so.value = 'newest';
  document.querySelectorAll('#stash-kind-filters .type-toggle-btn').forEach(function (b) { b.classList.add('active'); });
  document.querySelectorAll('.search-mode-btn').forEach(function (b) { b.classList.add('active'); });
  reflectTagButtons();
  updateTagHint();
  applyFilters();
}

// ── Filtering + sorting ─────────────────────────────────────────────────────
function applyFilters() {
  var includeTags = [], excludeTags = [];
  Object.keys(state.tagStates).forEach(function (k) {
    if (state.tagStates[k] === 'include') includeTags.push(k);
    else if (state.tagStates[k] === 'exclude') excludeTags.push(k);
  });

  var items = stashItems.filter(function (it) {
    if (!state.kinds[it.kind]) return false;

    var tags = it.tags || [];
    // exclusion wins
    for (var i = 0; i < excludeTags.length; i++) if (tags.indexOf(excludeTags[i]) !== -1) return false;
    // inclusion: must have at least one of the required tags
    if (includeTags.length) {
      var has = false;
      for (var j = 0; j < includeTags.length; j++) if (tags.indexOf(includeTags[j]) !== -1) { has = true; break; }
      if (!has) return false;
    }

    if (state.search) {
      var fields = [];
      if (state.searchModes.title)   fields.push(it.title || '');
      if (state.searchModes.creator) fields.push(creatorList(it).join(' '));
      var hay = fields.join(' ').toLowerCase();
      if (hay.indexOf(state.search) === -1) return false;
    }
    return true;
  });

  items.sort(function (a, b) {
    // Dates only carry month+year, so same-month items tie. Break the tie by id:
    // a higher id is the more recently added item, so it sorts first under
    // 'newest' (and last under 'oldest').
    switch (state.sort) {
      case 'oldest':  return (a.date || '').localeCompare(b.date || '') || ((a.id || 0) - (b.id || 0));
      case 'title':   return (a.title || '').localeCompare(b.title || '');
      case 'creator': return creatorText(a).localeCompare(creatorText(b));
      case 'newest':
      default:        return (b.date || '').localeCompare(a.date || '') || ((b.id || 0) - (a.id || 0));
    }
  });

  renderGrid(items);
  syncURL();
}

// ── URL STATE ─────────────────────────────────────────────────────────────
// The URL query string mirrors the current filter state, so navigating into an
// item and back restores the view (the browser keeps the URL) and the URL is
// shareable. This does NOT touch the in-memory filter/sort path — applyFilters()
// still runs entirely client-side at the same speed; this only reads/writes the
// address bar.
//
// Params (all optional, omitted when at their default):
//   q     search query text
//   modes comma list of active search modes (title/creator), only if not all on
//   kinds comma list of ENABLED kinds, only when not all are on
//   tags  comma list of tag filters, each prefixed + (include) or - (exclude)
//   sort  sort order, only when not the default "newest"
function syncURL() {
  var p = new URLSearchParams();

  if (state.search) p.set('q', state.search);

  var modeKeys = Object.keys(state.searchModes);
  var activeModes = modeKeys.filter(function (m) { return state.searchModes[m]; });
  if (activeModes.length && activeModes.length !== modeKeys.length) p.set('modes', activeModes.join(','));

  var kindKeys = Object.keys(state.kinds);
  var activeKinds = kindKeys.filter(function (k) { return state.kinds[k]; });
  if (activeKinds.length !== kindKeys.length) p.set('kinds', activeKinds.join(','));

  var tagBits = [];
  Object.keys(state.tagStates || {}).forEach(function (k) {
    if (state.tagStates[k] === 'include') tagBits.push('+' + k);
    else if (state.tagStates[k] === 'exclude') tagBits.push('-' + k);
  });
  if (tagBits.length) p.set('tags', tagBits.join(','));

  if (state.sort && state.sort !== 'newest') p.set('sort', state.sort);

  var qs = p.toString();
  var newUrl = window.location.pathname + (qs ? '?' + qs : '');
  window.history.replaceState({}, '', newUrl);
}

// Seed state from the URL on load. Returns true if any filter param was found,
// so init() knows whether to skip its defaults.
function readURLState() {
  var p = new URLSearchParams(window.location.search);
  var found = false;

  // Back-compat: the old ?creator=NAME deep-link still works.
  var legacyCreator = p.get('creator');
  if (legacyCreator) {
    state.search = decodeURIComponent(legacyCreator).toLowerCase();
    p.set('q', state.search);
    p.set('modes', 'creator');
    found = true;
  }

  if (p.has('q')) { state.search = decodeURIComponent(p.get('q')).toLowerCase(); found = true; }

  if (p.has('modes')) {
    found = true;
    var on = p.get('modes').split(',').filter(Boolean);
    Object.keys(state.searchModes).forEach(function (m) { state.searchModes[m] = on.indexOf(m) > -1; });
    // Never leave zero modes active (would match nothing on a non-empty query).
    if (!Object.keys(state.searchModes).some(function (m) { return state.searchModes[m]; })) {
      Object.keys(state.searchModes).forEach(function (m) { state.searchModes[m] = true; });
    }
  }

  if (p.has('kinds')) {
    found = true;
    var onK = p.get('kinds').split(',').filter(Boolean);
    Object.keys(state.kinds).forEach(function (k) { state.kinds[k] = onK.indexOf(k) > -1; });
  }

  if (p.has('tags')) {
    found = true;
    state.tagStates = {};
    p.get('tags').split(',').filter(Boolean).forEach(function (bit) {
      var sign = bit.charAt(0), key = bit.slice(1);
      if (sign === '+') state.tagStates[key] = 'include';
      else if (sign === '-') state.tagStates[key] = 'exclude';
    });
  }

  if (p.has('sort')) { state.sort = p.get('sort'); found = true; }

  return found;
}

// ── Grid render ─────────────────────────────────────────────────────────────
function renderGrid(items) {
  var grid = document.getElementById('stash-grid');
  if (!grid) return;
  grid.innerHTML = '';

  if (!items.length) {
    grid.innerHTML = '<div class="loading-placeholder">Nothing matches — try clearing filters.</div>';
    updateCount(0);
    return;
  }

  items.forEach(function (it) {
    if (it.kind === 'story') { grid.appendChild(buildStoryCard(it)); return; }

    var card = document.createElement('div');
    card.className = 'stash-card stash-card-image';

    // Derive the card cover and (for multi-image entries) a count badge — same
    // precedence the gallery uses: explicit image, else first of a set's
    // images[], else first of a comic's pages[].
    var coverSrc = it.image ||
      (it.images && it.images.length ? it.images[0] : '') ||
      (it.pages  && it.pages.length  ? it.pages[0]  : '') || '';
    var countLabel = '';
    if (it.pages && it.pages.length)        countLabel = it.pages.length + (it.pages.length === 1 ? ' page' : ' pages');
    else if (it.images && it.images.length) countLabel = it.images.length + (it.images.length === 1 ? ' image' : ' images');

    var thumb = document.createElement('div');
    thumb.className = 'stash-card-thumb';
    if (coverSrc) {
      var img = document.createElement('img');
      img.src = (window.SinverseImg ? SinverseImg.thumb(coverSrc, 500) : coverSrc);
      img.alt = it.title || '';
      img.loading = 'lazy';
      thumb.appendChild(img);
    } else {
      thumb.classList.add('stash-card-thumb-empty');
      thumb.textContent = 'No image';
    }
    if (countLabel) {
      var cb = document.createElement('span');
      cb.className = 'stash-card-count';
      cb.textContent = countLabel;
      thumb.appendChild(cb);
    }
    card.appendChild(thumb);

    var body = document.createElement('div');
    body.className = 'stash-card-body';
    var t = document.createElement('h3');
    t.className = 'stash-card-title';
    t.textContent = it.title || 'Untitled';
    body.appendChild(t);
    var cText = creatorText(it);
    if (cText) {
      var c = document.createElement('p');
      c.className = 'stash-card-creator';
      c.textContent = 'by ' + cText;
      body.appendChild(c);
    }
    if (it.tags && it.tags.length) {
      var tg = document.createElement('div');
      tg.className = 'stash-card-tags';
      it.tags.slice(0, 4).forEach(function (tag) {
        var s = document.createElement('span');
        s.className = 'stash-card-tag';
        s.textContent = tag;
        tg.appendChild(s);
      });
      body.appendChild(tg);
    }
    card.appendChild(body);

    card.addEventListener('click', function () { window.location.href = 'viewer.html?id=' + it.id; });
    grid.appendChild(card);
  });

  updateCount(items.length);
}

// Story cards mirror the library's: a generated "title card" cover (per-title
// colour palette), type + word-count badges, and an info ("i") button that opens
// a details modal. Clicking the card (or "Read") opens the in-page reader.
function buildStoryCard(it) {
  var card = document.createElement('div');
  var isSerial = it.type === 'serial';
  card.className = 'lib-card lib-card-' + (isSerial ? 'serial' : 'standalone') + ' stash-story-card';
  var pal = paletteFor(it.title || '');
  var words = stashTotalWords(it);
  var chapCount = (it.chapters && it.chapters.length) ? it.chapters.length : 0;
  var typeLabel = isSerial ? 'Serial' : 'Story';

  var titleCard =
    '<div class="lib-title-card" style="background:' + pal.bg + ';border-top:3px solid ' + pal.line + '">' +
      '<div class="lib-title-card-line" style="background:' + pal.line + '"></div>' +
      '<div class="lib-title-card-text" style="color:' + pal.accent + '">' + escapeHtml(it.title || 'Untitled') + '</div>' +
      (creatorText(it) ? '<div class="lib-title-card-author">by ' + escapeHtml(creatorText(it)) + '</div>' : '') +
      '<div class="lib-title-card-line" style="background:' + pal.line + '"></div>' +
      '<div class="lib-title-card-type">' + typeLabel + '</div>' +
    '</div>';

  card.innerHTML =
    '<div class="lib-card-cover-wrap">' +
      titleCard +
      '<span class="lib-type-badge lib-type-' + (isSerial ? 'serial' : 'standalone') + '">' + typeLabel + '</span>' +
      ((isSerial && chapCount) ? '<span class="lib-chap-badge">' + chapCount + ' ch.</span>' : '') +
      (words ? '<span class="lib-cover-wordcount">' + fmtWords(words) + '</span>' : '') +
      '<button class="lib-info-btn" title="Details" aria-label="Details">i</button>' +
    '</div>';

  card.style.cursor = 'pointer';
  card.addEventListener('click', function () { window.location.href = 'reader.html?id=' + it.id; });
  var infoBtn = card.querySelector('.lib-info-btn');
  if (infoBtn) infoBtn.addEventListener('click', function (e) {
    e.stopPropagation(); e.preventDefault();
    openInfoModal(it, words);
  });
  return card;
}

// Per-title colour palette (same set as the library, for visual consistency).
var CARD_PALETTES = [
  { bg: '#1a0e0e', accent: '#c49a78', line: '#7a2233' },
  { bg: '#0e1018', accent: '#8899cc', line: '#334488' },
  { bg: '#0e1a10', accent: '#88bb99', line: '#2a5a38' },
  { bg: '#180e18', accent: '#bb88cc', line: '#5a2a6a' },
  { bg: '#1a140a', accent: '#ccaa66', line: '#7a5a20' },
  { bg: '#0e1818', accent: '#88bbcc', line: '#1a5a6a' }
];
function paletteFor(title) {
  var hash = 0;
  for (var i = 0; i < title.length; i++) { hash = ((hash << 5) - hash) + title.charCodeAt(i); hash |= 0; }
  return CARD_PALETTES[Math.abs(hash) % CARD_PALETTES.length];
}
function fmtWords(n) {
  if (!n) return '';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k words';
  return n + ' words';
}

// Total word count: explicit top-level wordCount if given, otherwise the sum of
// the serial's chapter word counts (so serials don't need a manual total).
function stashTotalWords(it) {
  if (it.wordCount) return it.wordCount;
  if (it.chapters && it.chapters.length) {
    return it.chapters.reduce(function (sum, c) { return sum + (c.wordCount || 0); }, 0);
  }
  return 0;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

// Story details modal — mirrors the library's info modal. "Read" opens the
// in-page stash reader rather than navigating to a separate page.
function openInfoModal(it, words) {
  var existing = document.getElementById('lib-info-overlay');
  if (existing) existing.remove();

  var overlay = document.createElement('div');
  overlay.id = 'lib-info-overlay';
  overlay.className = 'lib-info-overlay';

  var tagHtml = (it.tags || []).map(function (t) {
    return '<span class="content-tag">' + escapeHtml(t) + '</span>';
  }).join('');

  overlay.innerHTML =
    '<div class="lib-info-modal">' +
      '<button class="lib-info-close" aria-label="Close">&#10005;</button>' +
      '<div class="lib-info-eyebrow">' + (it.type === 'serial' ? 'Serial' : 'Story') +
        (it.type === 'serial' && it.chapters ? ' &middot; ' + it.chapters.length + ' chapters' : '') + '</div>' +
      '<h2 class="lib-info-title">' + escapeHtml(it.title || 'Untitled') + '</h2>' +
      (creatorText(it) ? '<div class="lib-info-author">by ' + escapeHtml(creatorText(it)) + '</div>' : '') +
      (it.blurb ? '<p class="lib-info-summary">' + escapeHtml(it.blurb) + '</p>' : '') +
      (tagHtml ? '<div class="lib-info-tags">' + tagHtml + '</div>' : '') +
      (words ? '<div class="lib-info-wordcount">' + fmtWords(words) + '</div>' : '') +
      '<button class="lib-info-read" type="button">Read &#8594;</button>' +
    '</div>';

  function close() { overlay.remove(); }
  overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
  overlay.querySelector('.lib-info-close').addEventListener('click', close);
  overlay.querySelector('.lib-info-read').addEventListener('click', function () {
    close();
    window.location.href = 'reader.html?id=' + it.id;
  });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });
  document.body.appendChild(overlay);
}

function updateCount(n) {
  var el = document.getElementById('stash-count');
  if (el) el.textContent = n + (n === 1 ? ' item' : ' items');
}

function renderTagPills(containerId, tags) {
  var el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '';
  (tags || []).forEach(function (tag) {
    var s = document.createElement('span');
    s.className = 'stash-overlay-tag';
    s.textContent = tag;
    el.appendChild(s);
  });
}

// ── Image lightbox ──────────────────────────────────────────────────────────
function openLightbox(it) {
  var lb = document.getElementById('stash-lightbox');
  document.getElementById('stash-lightbox-img').src = (window.SinverseImg ? SinverseImg.full(it.image || '') : (it.image || ''));
  document.getElementById('stash-lightbox-img').alt = it.title || '';
  document.getElementById('stash-lightbox-title').textContent = it.title || '';
  document.getElementById('stash-lightbox-creator').textContent = creatorText(it) ? 'by ' + creatorText(it) : '';
  document.getElementById('stash-lightbox-blurb').textContent = it.blurb || '';
  renderTagPills('stash-lightbox-tags', it.tags);
  lb.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}
function closeLightbox() {
  var lb = document.getElementById('stash-lightbox');
  if (lb && lb.style.display !== 'none') {
    lb.style.display = 'none';
    document.body.style.overflow = '';
  }
}

// ── Story reader ────────────────────────────────────────────────────────────
var _readerStory = null;
var _readerChapter = 0;

async function openReader(it) {
  _readerStory = it;
  _readerChapter = 0;
  var r = document.getElementById('stash-reader');
  document.getElementById('stash-reader-title').textContent = it.title || '';
  document.getElementById('stash-reader-bartitle').textContent = it.title || '';
  document.getElementById('stash-reader-creator').textContent = creatorText(it) ? 'by ' + creatorText(it) : '';
  document.getElementById('stash-reader-blurb').textContent = it.blurb || '';
  renderTagPills('stash-reader-tags', it.tags);
  r.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  var isSerial = it.type === 'serial' && it.chapters && it.chapters.length;
  renderChapterList(isSerial ? it.chapters : null);

  if (isSerial) {
    loadChapter(0);
  } else {
    loadReaderFile(it.file);
  }
}

// Build (or hide) the chapter list for serials.
function renderChapterList(chapters) {
  var wrap = document.getElementById('stash-reader-chapters');
  var list = document.getElementById('stash-reader-chapter-list');
  if (!wrap || !list) return;
  list.innerHTML = '';
  if (!chapters) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  chapters.forEach(function (ch, i) {
    var btn = document.createElement('button');
    btn.className = 'stash-chapter-btn' + (i === 0 ? ' active' : '');
    btn.textContent = ch.title || ('Chapter ' + (i + 1));
    btn.addEventListener('click', function () { loadChapter(i); });
    list.appendChild(btn);
  });
}

function loadChapter(idx) {
  if (!_readerStory || !_readerStory.chapters) return;
  var ch = _readerStory.chapters[idx];
  if (!ch) return;
  _readerChapter = idx;
  document.querySelectorAll('#stash-reader-chapter-list .stash-chapter-btn').forEach(function (b, i) {
    b.classList.toggle('active', i === idx);
  });
  loadReaderFile(ch.file);
}

async function loadReaderFile(file) {
  var contentEl = document.getElementById('stash-reader-content');
  contentEl.innerHTML = '<p class="stash-reader-loading">Loading…</p>';
  document.querySelector('.stash-reader-scroll').scrollTop = 0;
  if (!file) { contentEl.innerHTML = '<p class="stash-reader-loading">This story isn\u2019t available yet.</p>'; return; }
  try {
    var res = await fetch(file);
    if (!res.ok) throw new Error('not found');
    var text = await res.text();
    text = text.replace(/^---[\s\S]*?---\s*/, '');
    contentEl.innerHTML = (typeof marked !== 'undefined') ? marked.parse(text) : ('<pre>' + text + '</pre>');
  } catch (e) {
    contentEl.innerHTML = '<p class="stash-reader-loading">This story isn\u2019t available yet.</p>';
  }
}
function closeReader() {
  var r = document.getElementById('stash-reader');
  if (r && r.style.display !== 'none') {
    r.style.display = 'none';
    document.body.style.overflow = '';
  }
}

init();
