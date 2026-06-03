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
  tagMode:    'exclude',     // 'exclude' = hide selected tags; 'include' = show only items with a selected tag
  selectedTags: new Set(),   // normalized tags the user has clicked
  sortOrder:  'newest',
  query:      '',
};

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
async function init() {
  try {
    var res = await fetch('gallery.json');
    if (!res.ok) throw new Error('Could not load gallery.json');
    state.items = await res.json();
    var tagsRes = await fetch('../_data/tags.json');
    var tagsData = await tagsRes.json();
    buildTagFilters(tagsData.gallery || []);

    // Apply URL params on load
    var urlParams = new URLSearchParams(window.location.search);
    var charParam   = urlParams.get('character');
    var searchParam = urlParams.get('search');
    var modeParam   = urlParams.get('mode');

    if (charParam) {
      var charName = decodeURIComponent(charParam);
      var inp = document.getElementById('search-input');
      if (inp) inp.value = charName;
      state.query = charName.toLowerCase();
      document.querySelectorAll('.search-mode-btn').forEach(function(b){ b.classList.remove('active'); });
      var charModeBtn = document.querySelector('.search-mode-btn[data-mode="character"]');
      if (charModeBtn) charModeBtn.classList.add('active');
      var url = new URL(window.location.href);
      url.searchParams.delete('character');
      window.history.replaceState({}, '', url);
    } else if (searchParam) {
      var sVal = decodeURIComponent(searchParam);
      var inp2 = document.getElementById('search-input');
      if (inp2) inp2.value = sVal;
      state.query = sVal.toLowerCase();
      document.querySelectorAll('.search-mode-btn').forEach(function(b){ b.classList.remove('active'); });
      var targetMode = modeParam || 'artist';
      var modeBtn = document.querySelector('.search-mode-btn[data-mode="' + targetMode + '"]');
      if (modeBtn) modeBtn.classList.add('active');
      var url2 = new URL(window.location.href);
      url2.searchParams.delete('search');
      url2.searchParams.delete('mode');
      window.history.replaceState({}, '', url2);
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
// (sinverse_gallery_* keys). Tag list from _data/tags.json. Any-match logic.
function buildTagFilters(warningTags) {
  var container = document.getElementById('tag-filters');
  if (!warningTags || !warningTags.length) {
    container.style.display = 'none';
    var ctrls = document.querySelector('.tag-controls'); if (ctrls) ctrls.style.display = 'none';
    var hint = document.getElementById('tag-mode-hint'); if (hint) hint.style.display = 'none';
    return;
  }

  // Restore saved mode + selected tags (gallery-specific keys)
  try {
    var savedMode = localStorage.getItem('sinverse_gallery_tag_mode');
    if (savedMode === 'include' || savedMode === 'exclude') state.tagMode = savedMode;
    var savedSel = JSON.parse(localStorage.getItem('sinverse_gallery_selected_tags') || '[]');
    state.selectedTags = new Set(savedSel.map(function(t){ return String(t).trim().toLowerCase(); }));
  } catch(e) { state.selectedTags = new Set(); }

  var sortedTags = warningTags.slice().sort();
  container.innerHTML = '';
  sortedTags.forEach(function(tag) {
    var key = String(tag).trim().toLowerCase();
    var btn = document.createElement('button');
    btn.className = 'tag-filter-btn' + (state.selectedTags.has(key) ? ' selected' : '');
    btn.textContent = tag;
    btn.setAttribute('data-tag', key);
    btn.addEventListener('click', function() {
      if (state.selectedTags.has(key)) state.selectedTags.delete(key);
      else state.selectedTags.add(key);
      btn.classList.toggle('selected', state.selectedTags.has(key));
      persistTagState();
      applyFilters();
    });
    container.appendChild(btn);
  });

  // Mode toggle
  document.querySelectorAll('.tag-mode-btn').forEach(function(b) {
    b.classList.toggle('active', b.getAttribute('data-mode') === state.tagMode);
    b.addEventListener('click', function() {
      state.tagMode = b.getAttribute('data-mode');
      document.querySelectorAll('.tag-mode-btn').forEach(function(x){
        x.classList.toggle('active', x.getAttribute('data-mode') === state.tagMode);
      });
      updateTagModeHint();
      persistTagState();
      applyFilters();
    });
  });

  // Select all / none
  var selAll = document.getElementById('tag-select-all');
  var selNone = document.getElementById('tag-select-none');
  if (selAll) selAll.addEventListener('click', function() {
    sortedTags.forEach(function(t){ state.selectedTags.add(String(t).trim().toLowerCase()); });
    reflectTagButtons();
    persistTagState();
    applyFilters();
  });
  if (selNone) selNone.addEventListener('click', function() {
    state.selectedTags.clear();
    reflectTagButtons();
    persistTagState();
    applyFilters();
  });

  updateTagModeHint();
}

function reflectTagButtons() {
  document.querySelectorAll('.tag-filter-btn').forEach(function(b) {
    b.classList.toggle('selected', state.selectedTags.has(b.getAttribute('data-tag')));
  });
}

function updateTagModeHint() {
  var hint = document.getElementById('tag-mode-hint');
  if (!hint) return;
  hint.textContent = state.tagMode === 'include'
    ? 'Showing only works with any selected tag.'
    : 'Hiding works that have any selected tag.';
}

function persistTagState() {
  try {
    localStorage.setItem('sinverse_gallery_tag_mode', state.tagMode);
    localStorage.setItem('sinverse_gallery_selected_tags', JSON.stringify([...state.selectedTags]));
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
    // Tag filtering by mode (case/space-insensitive)
    if (state.selectedTags.size) {
      var itemTags = (item.tags || []).map(function(t){ return String(t).trim().toLowerCase(); });
      var hasSelected = itemTags.some(function(t){ return state.selectedTags.has(t); });
      if (state.tagMode === 'include') {
        if (!hasSelected) return false;
      } else {
        if (hasSelected) return false;
      }
    }
    // Character filter from URL param is now folded into the search query
    if (state.characterFilter && !(item.characters || []).map(function(c){return c.toLowerCase();}).includes(state.characterFilter)) return false;
    if (q) {
      var matched = false;
      if (modes.indexOf('title')     > -1 && (item.title  || '').toLowerCase().includes(q)) matched = true;
      if (modes.indexOf('artist')    > -1 && (item.artist || '').toLowerCase().includes(q)) matched = true;
      if (modes.indexOf('character') > -1 && (item.characters || []).some(function(c){ return c.toLowerCase().includes(q); })) matched = true;
      if (!matched) return false;
    }
    return true;
  });

  state.filtered.sort(function(a, b) {
    if (state.sortOrder === 'newest') return (b.date || '').localeCompare(a.date || '');
    if (state.sortOrder === 'oldest') return (a.date || '').localeCompare(b.date || '');
    if (state.sortOrder === 'title')  return a.title.localeCompare(b.title);
    if (state.sortOrder === 'artist') return (a.artist || '').localeCompare(b.artist || '');
    return 0;
  });

  renderGrid();
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
        '<div class="gallery-card-artist">' + (item.artist || '') + '</div>' +
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
  state.selectedTags = new Set();
  state.tagMode = 'exclude';
  localStorage.removeItem('sinverse_gallery_selected_tags');
  localStorage.removeItem('sinverse_gallery_tag_mode');
  localStorage.removeItem('sinverse_hidden_tags'); // legacy key cleanup
  document.querySelectorAll('.tag-filter-btn').forEach(function(b){ b.classList.remove('selected'); });
  document.querySelectorAll('.tag-mode-btn').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-mode') === 'exclude'); });
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
