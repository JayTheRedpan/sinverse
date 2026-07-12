'use strict';
/* ============================================================================
   Sinverse — Gallery browser
   ----------------------------------------------------------------------------
   Grid of artworks loaded from gallery.json. Supports four item types:
   scene, comic, charref (character reference), and set (a bundle of images).

   - `state` holds filters: tagMode ('exclude'|'include'), selectedTags (Set),
     typeFilter, search query, sort order.
   - Tag filtering: mode-toggle system (Hide these / Show only these) with
     any-match logic, persisted to localStorage (sinverse_gallery_*). The tag
     list comes from _data/tags.json — a tag missing there gets no filter button.
   - Clicking a card opens viewer.html?id=N (see viewer.js).
   - Artist names link to ../contributors/?creator=<artist>.
   ========================================================================== */

var state = {
  items:      [],
  filtered:   [],
  typeFilter: { comic: true, scene: true, charref: true, set: true },
  canonOnly:  false,
  // Per-tag tristate filtering. tagStates maps a normalized tag -> 'include'
  // or 'exclude'; a tag absent from the map is neutral (no effect).
  tagStates: {},
  sortOrder:  'newest',
  query:      '',
};

// ── Artist helpers (support single string OR array, for collabs) ─────────────
// An item's `artist` may be a string ("FastTrack") or an array (["Vex","FastTrack"])
// for collaborations. These normalize both to a clean array and a display string,
// so the rest of the module never has to care which form the data is in.
// (Mirrors the stash module's creatorList/creatorText.)
function artistList(item) {
  if (!item) return [];
  var a = item.artist;
  if (Array.isArray(a)) return a.filter(function (n) { return n && String(n).trim(); }).map(String);
  if (a && String(a).trim()) return [String(a)];
  return [];
}
function artistText(item) {
  var list = artistList(item);
  if (!list.length) return '';
  if (list.length === 1) return list[0];
  if (list.length === 2) return list[0] + ' & ' + list[1];
  return list.slice(0, -1).join(', ') + ' & ' + list[list.length - 1];
}

var TYPE_LABELS = {
  comic:   'Comic',
  scene:   'World Scene',
  charref: 'Reference',
  set:     'Set',
};

// Small inline-SVG icon per type for at-a-glance distinction in the badge.
var TYPE_ICONS = {
  // stacked pages
  comic:   '<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="2" width="8" height="11" rx="1"/><path d="M5.5 2.5V13.5M13 4v9a1 1 0 0 1-1 1H5"/></svg>',
  // single frame
  scene:   '<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2.5" y="3" width="11" height="10" rx="1"/><circle cx="6" cy="6.5" r="1"/><path d="M3 11l3-2.5 2.5 2 2-1.5L13 11"/></svg>',
  // person
  charref: '<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="5" r="2.5"/><path d="M3.5 13c0-2.8 2-4.5 4.5-4.5s4.5 1.7 4.5 4.5"/></svg>',
  // grid of squares
  set:     '<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="0.8"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="0.8"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="0.8"/><rect x="9" y="9" width="4.5" height="4.5" rx="0.8"/></svg>',
};

// -- Boot
// ── INIT: load tags + gallery.json, build filters, first render ──────────
// ── Inactive fan characters ───────────────────────────────────
// Fan characters flagged "active": false in _data/fan-characters.json are
// hidden site-wide, so their appearances as character tags on gallery items
// are ignored — not shown, not counted in filters or search.
var _inactiveFanKeys = {};
function loadInactiveFanKeys() {
  return fetch('../_data/fan-characters.json')
    .then(function(r){ return r.ok ? r.json() : []; })
    .then(function(list){
      (list || []).forEach(function(c){
        if (c && c.active === false) {
          if (c.name) _inactiveFanKeys[String(c.name).toLowerCase()] = true;
          if (c.wiki) _inactiveFanKeys[String(c.wiki).toLowerCase()] = true;
        }
      });
    })
    .catch(function(){});
}
function isInactiveFanTag(tag) {
  var m = String(tag).match(/^\s*(canon|fan)\s*:\s*(.+)$/i);
  if (m && m[1].toLowerCase() === 'canon') return false; // an explicit canon ref is never a fan char
  var key = (m ? m[2] : String(tag)).replace(/_/g, ' ').trim().toLowerCase();
  return !!_inactiveFanKeys[key] || !!_inactiveFanKeys[key.replace(/\s+/g, '-')];
}
function activeCharacters(chars) {
  return (chars || []).filter(function(c){ return !isInactiveFanTag(c); });
}

async function init() {
  try {
    var res = await fetch('gallery.json');
    if (!res.ok) throw new Error('Could not load gallery.json');
    state.items = await res.json();
    var tagsRes = await fetch('../_data/tags.json');
    var tagsData = await tagsRes.json();
    await loadInactiveFanKeys();
    buildTagFilters(tagsData.gallery || []);

    // Seed filter state from the URL (shareable links + restore-on-return).
    var hadUrlState = readURLState();

    // Reflect search modes onto the toggle buttons.
    if (state._urlModes) {
      document.querySelectorAll('.search-mode-btn').forEach(function(b){
        b.classList.toggle('active', state._urlModes.indexOf(b.getAttribute('data-mode')) > -1);
      });
    }
    // Reflect the seeded query into the search box.
    if (state.query) {
      var inp = document.getElementById('search-input');
      if (inp) inp.value = state.query;
    }
    // Reflect type toggles, canon button, sort select, and tag buttons.
    document.querySelectorAll('#type-filters .type-toggle-btn').forEach(function(b){
      var t = b.getAttribute('data-type');
      if (t in state.typeFilter) b.classList.toggle('active', state.typeFilter[t]);
    });
    var canonBtn = document.getElementById('canon-filter-btn');
    if (canonBtn) canonBtn.classList.toggle('active', state.canonOnly);
    var sortSel = document.getElementById('sort-select');
    if (sortSel && state.sortOrder) sortSel.value = state.sortOrder;
    if (typeof reflectTagButtons === 'function') reflectTagButtons();
    if (typeof updateTagModeHint === 'function') updateTagModeHint();


    // Clean up any legacy entry params now that they've been folded into state.
    if (hadUrlState) {
      var cleanUrl = new URL(window.location.href);
      ['character', 'search', 'mode'].forEach(function(k){ cleanUrl.searchParams.delete(k); });
      window.history.replaceState({}, '', cleanUrl);
    } else {
      resetSearch();
    }

    applyFilters();
  } catch(e) {
    document.getElementById('gallery-grid').innerHTML =
      '<div class="loading-placeholder" style="color:var(--wine)">Failed to load gallery.<br><small>' + e.message + '</small></div>';
  }
}

// -- Tag filters built from data
// ── TAG FILTERING ─────────────────────────────────────────────────────────
// Mode-toggle (exclude/include) + select-all/clear, persisted to localStorage
// (sinverse_gallery_* keys). Tag list from _data/tags.json. Tristate per-tag.
function buildTagFilters(warningTags) {
  var container = document.getElementById('tag-filters');
  if (!warningTags || !warningTags.length) {
    container.style.display = 'none';
    var ctrls = document.querySelector('.tag-controls'); if (ctrls) ctrls.style.display = 'none';
    var hint = document.getElementById('tag-mode-hint'); if (hint) hint.style.display = 'none';
    return;
  }

  // Restore saved per-tag states (gallery-specific key)
  try {
    var saved = JSON.parse(localStorage.getItem('sinverse_gallery_tag_states') || '{}');
    state.tagStates = (saved && typeof saved === 'object') ? saved : {};
  } catch(e) { state.tagStates = {}; }

  var sortedTags = warningTags.slice().sort();
  container.innerHTML = '';
  sortedTags.forEach(function(tag) {
    var key = String(tag).trim().toLowerCase();
    var btn = document.createElement('button');
    btn.setAttribute('data-tag', key);
    btn.addEventListener('click', function() {
      // Cycle: neutral -> include -> exclude -> neutral
      var cur = state.tagStates[key];
      if (!cur)                   state.tagStates[key] = 'include';
      else if (cur === 'include') state.tagStates[key] = 'exclude';
      else                        delete state.tagStates[key];
      paintTagButton(btn, key);
      persistTagState();
      applyFilters();
    });
    paintTagButton(btn, key);
    container.appendChild(btn);
  });

  // Clear-all button (resets every tag to neutral)
  var selNone = document.getElementById('tag-select-none');
  if (selNone) selNone.addEventListener('click', function() {
    state.tagStates = {};
    reflectTagButtons();
    persistTagState();
    applyFilters();
  });

  updateTagModeHint();
}

// Render one tag button to reflect its tristate. Leading glyph keeps the state
// legible without relying on colour alone: ＋ included, － excluded, blank off.
function paintTagButton(btn, key) {
  var st = state.tagStates[key];
  var text = btn._label || (btn._label = btn.textContent || key);
  btn.className = 'tag-filter-btn tristate' + (st ? ' ' + st : ' neutral');
  var glyph = st === 'include' ? '＋' : (st === 'exclude' ? '－' : '');
  btn.innerHTML = (glyph ? '<span class="tag-tri-glyph">' + glyph + '</span>' : '') + '<span class="tag-tri-label">' + text + '</span>';
  btn.setAttribute('aria-pressed', st ? 'true' : 'false');
  btn.title = st === 'include' ? 'Including: only artworks WITH this tag pass (click to exclude)'
            : st === 'exclude' ? 'Excluding: artworks with this tag are hidden (click to clear)'
            : 'Click to require this tag; click again to exclude it';
}

// Repaint every tag button to reflect current tagStates (used by Clear all / reset).
function reflectTagButtons() {
  document.querySelectorAll('.tag-filter-btn').forEach(function(b) {
    paintTagButton(b, b.getAttribute('data-tag'));
  });
}

function updateTagModeHint() {
  var hint = document.getElementById('tag-mode-hint');
  if (!hint) return;
  var inc = 0, exc = 0;
  Object.keys(state.tagStates || {}).forEach(function(k){
    if (state.tagStates[k] === 'include') inc++;
    else if (state.tagStates[k] === 'exclude') exc++;
  });
  if (!inc && !exc) {
    hint.textContent = 'Tap a tag once to require it (＋), again to exclude it (－), again to clear.';
  } else {
    var parts = [];
    if (inc) parts.push('requiring ' + inc + ' tag' + (inc > 1 ? 's' : ''));
    if (exc) parts.push('excluding ' + exc + ' tag' + (exc > 1 ? 's' : ''));
    hint.textContent = 'Showing artworks ' + parts.join(' and ') + '.';
  }
}

function persistTagState() {
  try {
    localStorage.setItem('sinverse_gallery_tag_states', JSON.stringify(state.tagStates || {}));
  } catch(e) {}
}

// -- Filter + sort + render
// ── SEARCH + FILTER + SORT ────────────────────────────────────────────────
// applyFilters() filters by type, canon, tags, and search; then renderGrid().
function getActiveModes() {
  var modes = [];
  document.querySelectorAll('.search-mode-btn.active').forEach(function(b){ modes.push(b.getAttribute('data-mode')); });
  return modes;
}

function applyFilters() {
  var q = state.query.toLowerCase();
  var modes = getActiveModes();

  state.filtered = state.items.filter(function(item) {
    if (!state.typeFilter[item.type]) return false;
    if (state.canonOnly && !item.canonical) return false;
    // Per-tag tristate filtering (case/space-insensitive). Hidden if it carries
    // ANY excluded tag, or if there are included tags and it lacks them all.
    var includeTags = [], excludeTags = [];
    Object.keys(state.tagStates || {}).forEach(function(k){
      if (state.tagStates[k] === 'include') includeTags.push(k);
      else if (state.tagStates[k] === 'exclude') excludeTags.push(k);
    });
    if (includeTags.length || excludeTags.length) {
      var itemTags = (item.tags || []).map(function(t){ return String(t).trim().toLowerCase(); });
      if (excludeTags.some(function(t){ return itemTags.indexOf(t) > -1; })) return false;
      if (includeTags.length && !includeTags.some(function(t){ return itemTags.indexOf(t) > -1; })) return false;
    }
    // Character filter from URL param is now folded into the search query
    if (state.characterFilter && !activeCharacters(item.characters).map(function(c){return c.toLowerCase();}).includes(state.characterFilter)) return false;
    if (q) {
      var matched = false;
      if (modes.indexOf('title')     > -1 && (item.title  || '').toLowerCase().includes(q)) matched = true;
      if (modes.indexOf('artist')    > -1 && artistList(item).join(' ').toLowerCase().includes(q)) matched = true;
      if (modes.indexOf('character') > -1 && activeCharacters(item.characters).some(function(c){ return c.toLowerCase().includes(q); })) matched = true;
      if (!matched) return false;
    }
    return true;
  });

  state.filtered.sort(function(a, b) {
    // Dates only carry month+year, so same-month items tie. Break the tie by id:
    // a higher id is the more recently added item, so it sorts first under
    // 'newest' (and last under 'oldest').
    if (state.sortOrder === 'newest')    return (b.date || '').localeCompare(a.date || '') || ((b.id || 0) - (a.id || 0));
    if (state.sortOrder === 'oldest')    return (a.date || '').localeCompare(b.date || '') || ((a.id || 0) - (b.id || 0));
    if (state.sortOrder === 'title')  return a.title.localeCompare(b.title);
    if (state.sortOrder === 'artist') return artistText(a).localeCompare(artistText(b));
    return 0;
  });

  renderGrid();
  syncURL();
}

// ── URL STATE ─────────────────────────────────────────────────────────────
// The URL query string is a mirror of the current filter state. This gives us
// two things for free: navigating into an item and back restores the view (the
// browser keeps the URL), and the URL is shareable. It does NOT touch the
// in-memory filter/sort path — applyFilters() still runs entirely client-side
// at the same speed; this only reads/writes the address bar.
//
// Params (all optional, omitted when at their default):
//   q     search query text
//   modes comma list of active search modes (title/artist/character)
//   types comma list of ENABLED types, only when not all four are on
//   tags  comma list of tag filters, each prefixed + (include) or - (exclude)
//   canon "1" when canon-only is active
//   sort  sort order, only when not the default "newest"
var _syncingURL = false;
function syncURL() {
  if (_syncingURL) return;
  var p = new URLSearchParams();

  if (state.query) p.set('q', state.query);

  var modes = getActiveModes();
  // Only record modes if they differ from "all active" (the default).
  var allModes = ['title', 'artist', 'character'];
  if (modes.length && modes.length !== allModes.length) p.set('modes', modes.join(','));

  var enabledTypes = Object.keys(state.typeFilter).filter(function(t){ return state.typeFilter[t]; });
  var totalTypes = Object.keys(state.typeFilter).length;
  if (enabledTypes.length !== totalTypes) p.set('types', enabledTypes.join(','));

  var tagBits = [];
  Object.keys(state.tagStates || {}).forEach(function(k){
    if (state.tagStates[k] === 'include') tagBits.push('+' + k);
    else if (state.tagStates[k] === 'exclude') tagBits.push('-' + k);
  });
  if (tagBits.length) p.set('tags', tagBits.join(','));

  if (state.canonOnly) p.set('canon', '1');
  if (state.sortOrder && state.sortOrder !== 'newest') p.set('sort', state.sortOrder);

  var qs = p.toString();
  var newUrl = window.location.pathname + (qs ? '?' + qs : '');
  // replaceState (not pushState): filtering shouldn't spam the back button.
  window.history.replaceState({}, '', newUrl);
}

// Seed state from the URL on load. Returns true if any filter param was found,
// so init() knows whether to skip its default resetSearch().
function readURLState() {
  var p = new URLSearchParams(window.location.search);
  var found = false;

  // Back-compat: the old entry params (character / search / mode) still work.
  var legacyChar = p.get('character');
  var legacySearch = p.get('search');
  if (legacyChar) {
    state.query = decodeURIComponent(legacyChar).toLowerCase();
    p.set('q', state.query);
    p.set('modes', 'character');
    found = true;
  } else if (legacySearch) {
    state.query = decodeURIComponent(legacySearch).toLowerCase();
    p.set('q', state.query);
    if (p.get('mode')) p.set('modes', p.get('mode'));
    found = true;
  }

  if (p.has('q')) { state.query = decodeURIComponent(p.get('q')); found = true; }

  if (p.has('types')) {
    found = true;
    var on = p.get('types').split(',').filter(Boolean);
    Object.keys(state.typeFilter).forEach(function(t){ state.typeFilter[t] = on.indexOf(t) > -1; });
  }

  if (p.has('tags')) {
    found = true;
    state.tagStates = {};
    p.get('tags').split(',').filter(Boolean).forEach(function(bit){
      var sign = bit.charAt(0);
      var key = bit.slice(1);
      if (sign === '+') state.tagStates[key] = 'include';
      else if (sign === '-') state.tagStates[key] = 'exclude';
    });
  }

  if (p.get('canon') === '1') { state.canonOnly = true; found = true; }
  if (p.has('sort')) { state.sortOrder = p.get('sort'); found = true; }

  // Stash desired modes so init() can reflect them onto the buttons after the
  // DOM is ready (the buttons exist, but we centralize the reflect in init).
  state._urlModes = p.has('modes') ? p.get('modes').split(',').filter(Boolean) : null;
  if (state._urlModes) found = true;

  return found;
}

// ── RENDER GRID ───────────────────────────────────────────────────────────
// Builds the cards. Per-type icon/colour, stacked edge for multi-image items
// (comic/set). Clicking a card opens viewer.html?id=N.
function renderGrid() {
  var grid  = document.getElementById('gallery-grid');
  var count = document.getElementById('gallery-count');
  if (!count) count = { textContent: '' };
  grid.innerHTML = '';

  count.textContent = state.filtered.length + ' item' + (state.filtered.length !== 1 ? 's' : '');

  if (!state.filtered.length) {
    grid.innerHTML = '<div class="loading-placeholder">No items match your filters.</div>';
    return;
  }

  state.filtered.forEach(function(item) {
    var card = document.createElement('a');
    var isMulti = item.type === 'comic' || item.type === 'set';
    card.className = 'gallery-card gallery-card-' + item.type + (isMulti ? ' has-stack' : '');
    card.href      = 'viewer.html?id=' + item.id;

    var thumbSrc = item.coverImage || item.image ||
      (item.images && item.images.length ? item.images[0] : '') ||
      (item.pages && item.pages.length ? item.pages[0] : '') || '';
    var thumb = (window.SinverseImg ? SinverseImg.thumb(thumbSrc, 500) : thumbSrc);

    // Count label for multi-image types
    var countLabel = '';
    if (item.type === 'comic') countLabel = (item.pages ? item.pages.length : 0) + ' pages';
    else if (item.type === 'set') countLabel = (item.images ? item.images.length : 0) + ' images';

    card.innerHTML =
      '<div class="gallery-thumb-wrap">' +
        (thumb
          ? '<img class="gallery-thumb" src="' + thumb + '" alt="' + item.title + '" loading="lazy" />'
          : '<div class="gallery-thumb-placeholder">&#10022;</div>') +
        '<span class="gallery-type-badge type-' + item.type + '">' +
          (TYPE_ICONS[item.type] || '') +
          '<span class="gallery-type-badge-txt">' + (TYPE_LABELS[item.type] || item.type) + '</span>' +
        '</span>' +
        (item.canonical ? '<span class="gallery-canonical-badge">&#10022;</span>' : '') +
        (countLabel ? '<span class="gallery-page-count">' + countLabel + '</span>' : '') +
      '</div>' +
      '<div class="gallery-card-body">' +
        '<div class="gallery-card-title">' + item.title + '</div>' +
        '<div class="gallery-card-artist">' + artistText(item) + '</div>' +
        '<div class="gallery-card-meta">' +
          (item.tags || []).map(function(t) { return '<span class="content-tag">' + t + '</span>'; }).join('') +
        '</div>' +
      '</div>';

    grid.appendChild(card);
  });
}

// -- Event listeners
// Search mode toggle buttons
document.querySelectorAll('.search-mode-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    this.classList.toggle('active');
    applyFilters();
  });
});

// ── RESET ─────────────────────────────────────────────────────────────────
function resetSearch() {
  var inp = document.getElementById('search-input');
  if (inp) inp.value = '';
  state.query = '';
  document.querySelectorAll('.search-mode-btn').forEach(function(b){ b.classList.add('active'); });
  state.typeFilter = { comic: true, scene: true, charref: true, set: true };
  state.canonOnly = false;
  var cb = document.getElementById('canon-filter-btn');
  if (cb) cb.classList.remove('active');
  state.tagStates = {};
  localStorage.removeItem('sinverse_gallery_tag_states');
  localStorage.removeItem('sinverse_gallery_selected_tags'); // legacy key cleanup
  localStorage.removeItem('sinverse_gallery_tag_mode');       // legacy key cleanup
  localStorage.removeItem('sinverse_hidden_tags');            // legacy key cleanup
  if (typeof reflectTagButtons === 'function') reflectTagButtons();
  if (typeof updateTagModeHint === 'function') updateTagModeHint();
  document.querySelectorAll('#type-filters .type-toggle-btn').forEach(function(b){ b.classList.add('active'); });
  applyFilters();
}


// -- Filter panel toggle
// ── UI WIRING: collapsible filter panel, type/canon toggles, search box ───
var filterToggleBtn = document.getElementById('filter-toggle-btn');
var filterPanel = document.getElementById('filter-panel');
if (filterToggleBtn && filterPanel) {
  filterToggleBtn.addEventListener('click', function() {
    var open = filterPanel.classList.toggle('open');
    filterToggleBtn.textContent = open ? 'Filters ▴' : 'Filters ▾';
  });
}

document.getElementById('search-clear-btn').addEventListener('click', resetSearch);

document.getElementById('search-input').addEventListener('input', function() {
  state.query = this.value.trim();
  applyFilters();
});

document.getElementById('search-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') { state.query = this.value.trim(); applyFilters(); }
  if (e.key === 'Escape') resetSearch();
});

document.getElementById('type-filters').addEventListener('click', function(e) {
  var btn = e.target.closest('.type-toggle-btn');
  if (!btn) return;
  var type = btn.getAttribute('data-type');
  state.typeFilter[type] = !state.typeFilter[type];
  btn.classList.toggle('active', state.typeFilter[type]);
  applyFilters();
});

var galleryCanonBtn = document.getElementById('canon-filter-btn');
if (galleryCanonBtn) galleryCanonBtn.addEventListener('click', function() {
  state.canonOnly = !state.canonOnly;
  this.classList.toggle('active', state.canonOnly);
  applyFilters();
});

document.getElementById('sort-select').addEventListener('change', function() {
  state.sortOrder = this.value;
  applyFilters();
});

init();
