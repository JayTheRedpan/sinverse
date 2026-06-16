'use strict';
/* ============================================================================
   Sinverse — Library browser
   ----------------------------------------------------------------------------
   Lists stories from library.json. Each story's prose is a .md file in
   library/stories/, opened via reader.html (see reader.js).

   - Same mode-toggle tag filtering as the gallery (Hide these / Show only
     these), persisted to localStorage (sinverse_* keys), tags from
     _data/tags.json. Matching is case/whitespace-insensitive.
   - collections.json defines curated groupings of stories.
   ========================================================================== */

var state = {
  stories:    [],
  collections:[],
  typeFilter: { standalone: true, serial: true },
  canonOnly:  false,
  // Per-tag tristate filtering. tagStates maps a normalized tag -> 'include'
  // or 'exclude'. A tag absent from the map is neutral (no effect). This lets a
  // user include some tags AND exclude others at the same time.
  tagStates: {},
  sortOrder:  'newest',
  query:      '',
  view:       'grid',
  tab:        'stories',   // 'stories' or 'collections'
};

var TYPE_LABELS = {
  standalone: 'Story',
  serial:     'Serial',
  collection: 'Collection',
};

// ── INIT: load tags + library.json, build filters, first render ──────────
async function init() {
  try {
    var [storiesRes, collectionsRes] = await Promise.all([
      fetch('./library.json'),
      fetch('./collections.json'),
    ]);
    if (!storiesRes.ok)    throw new Error('Could not load library.json');
    if (!collectionsRes.ok) throw new Error('Could not load collections.json');
    state.stories     = await storiesRes.json();
    state.collections = await collectionsRes.json();
    var tagsRes = await fetch('../_data/tags.json');
    var tagsData = await tagsRes.json();
    buildTagFilters(tagsData.story || []);

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

    // Reflect the content tab (stories / collections) and view (grid / list).
    document.querySelectorAll('#content-toggle .view-toggle-btn').forEach(function(b){
      var tb = b.getAttribute('data-tab');
      if (tb) b.classList.toggle('active', tb === state.tab);
    });
    document.querySelectorAll('[data-view]').forEach(function(b){
      b.classList.toggle('active', b.getAttribute('data-view') === state.view);
    });

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
    document.getElementById('lib-grid').innerHTML =
      '<div class="loading-placeholder" style="color:var(--wine)">Failed to load library.<br><small>' + e.message + '</small></div>';
  }
}

// -- Tag filters built from stories/serials only
// ── TAG FILTERING ─────────────────────────────────────────────────────────
// Mode-toggle system (exclude/include) + select-all/clear. Tag list comes from
// _data/tags.json. State persists to localStorage. Mirrors the gallery module.
function buildTagFilters(warningTags) {
  var container = document.getElementById('tag-filters');
  if (!warningTags || !warningTags.length) {
    container.style.display = 'none';
    var ctrls = document.querySelector('.tag-controls'); if (ctrls) ctrls.style.display = 'none';
    var hint = document.getElementById('tag-mode-hint'); if (hint) hint.style.display = 'none';
    return;
  }

  // Restore saved per-tag states
  try {
    var saved = JSON.parse(localStorage.getItem('sinverse_tag_states') || '{}');
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
      if (!cur)               state.tagStates[key] = 'include';
      else if (cur === 'include') state.tagStates[key] = 'exclude';
      else                    delete state.tagStates[key];
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

// Render one tag button to reflect its tristate. The leading glyph makes the
// state legible without relying on colour alone: + included, − excluded, ◦ off.
function paintTagButton(btn, key) {
  var st = state.tagStates[key];
  var label = btn.getAttribute('data-tag');
  // Find the original-cased tag text from the data-tag (we lowercased it); use
  // the stored label if available, else the key.
  var text = btn._label || (btn._label = btn.textContent || key);
  btn.className = 'tag-filter-btn tristate' + (st ? ' ' + st : ' neutral');
  var glyph = st === 'include' ? '＋' : (st === 'exclude' ? '－' : '');
  btn.innerHTML = (glyph ? '<span class="tag-tri-glyph">' + glyph + '</span>' : '') + '<span class="tag-tri-label">' + text + '</span>';
  btn.setAttribute('aria-pressed', st ? 'true' : 'false');
  btn.title = st === 'include' ? 'Including: only stories WITH this tag pass (click to exclude)'
            : st === 'exclude' ? 'Excluding: stories with this tag are hidden (click to clear)'
            : 'Click to require this tag; click again to exclude it';
}

// Repaint every tag button to reflect the current tagStates (used by Clear All
// and reset). Defined as a hoisted function so earlier callers resolve it.
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
    hint.textContent = 'Showing stories ' + parts.join(' and ') + '.';
  }
}

function persistTagState() {
  try {
    localStorage.setItem('sinverse_tag_states', JSON.stringify(state.tagStates || {}));
  } catch(e) {}
}


// ── SEARCH + FILTER + SORT ────────────────────────────────────────────────
// applyFilters() is the heart: runs every keystroke/toggle, decides which
// stories show, then hands off to the active render mode (list/grid).
function getActiveModes() {
  var modes = [];
  document.querySelectorAll('.search-mode-btn.active').forEach(function(b){ modes.push(b.getAttribute('data-mode')); });
  return modes;
}

function resetSearch() {
  var inp = document.getElementById('search-input');
  if (inp) inp.value = '';
  state.query = '';
  document.querySelectorAll('.search-mode-btn').forEach(function(b){ b.classList.add('active'); });
  state.typeFilter = { standalone: true, serial: true };
  state.canonOnly = false;
  var cb = document.getElementById('canon-filter-btn');
  if (cb) cb.classList.remove('active');
  state.tagStates = {};
  localStorage.removeItem('sinverse_tag_states');
  localStorage.removeItem('sinverse_selected_tags'); // legacy key cleanup
  localStorage.removeItem('sinverse_tag_mode');       // legacy key cleanup
  localStorage.removeItem('sinverse_hidden_tags');    // legacy key cleanup
  if (typeof reflectTagButtons === 'function') reflectTagButtons();
  if (typeof updateTagModeHint === 'function') updateTagModeHint();
  document.querySelectorAll('#type-filters .type-toggle-btn').forEach(function(b){ b.classList.add('active'); });
  applyFilters();
}

function applyFilters() {
  var charFilter = window._charFilter || null;
  var q = state.query.toLowerCase();

  if (state.tab === 'collections') {
    renderCollectionsTab(q);
    return;
  }

  // Stories tab -- show standalone and serials, never raw collection entries
  var filtered = state.stories.filter(function(item) {
    if (!state.typeFilter[item.type]) return false;
    if (state.canonOnly && !item.canonical) return false;
    // Per-tag tristate filtering (case/space-insensitive). A story is hidden if
    // it carries ANY excluded tag, or if there are included tags and it lacks
    // them all (any-match). Neutral tags have no effect.
    var includeTags = [], excludeTags = [];
    Object.keys(state.tagStates || {}).forEach(function(k){
      if (state.tagStates[k] === 'include') includeTags.push(k);
      else if (state.tagStates[k] === 'exclude') excludeTags.push(k);
    });
    if (includeTags.length || excludeTags.length) {
      var itemTags = (item.tags || []).map(function(t){ return String(t).trim().toLowerCase(); });
      // Exclusion wins: any excluded tag present -> hide.
      if (excludeTags.some(function(t){ return itemTags.indexOf(t) > -1; })) return false;
      // Inclusion: must have at least one of the required tags.
      if (includeTags.length && !includeTags.some(function(t){ return itemTags.indexOf(t) > -1; })) return false;
    }
    if (charFilter && !(item.characters || []).map(function(c){return c.toLowerCase();}).includes(charFilter)) return false;
    if (q) {
      var modes = getActiveModes();
      var inTitle  = modes.indexOf('title')     > -1 && (item.title  || '').toLowerCase().includes(q);
      var inAuthor = modes.indexOf('author')    > -1 && (item.author || '').toLowerCase().includes(q);
      var inChar   = modes.indexOf('character') > -1 && (item.characters || []).some(function(c){ return c.toLowerCase().includes(q); });
      var inTag    = modes.indexOf('tag')       > -1 && (item.tags || []).some(function(t){ return t.toLowerCase().includes(q); });
      if (!inTitle && !inAuthor && !inChar && !inTag) return false;
    }
    return true;
  });

  filtered.sort(function(a, b) {
    if (state.sortOrder === 'newest')    return (b.date || '').localeCompare(a.date || '');
    if (state.sortOrder === 'oldest')    return (a.date || '').localeCompare(b.date || '');
    if (state.sortOrder === 'title')     return (a.title || '').localeCompare(b.title || '');
    if (state.sortOrder === 'author')    return (a.author || '').localeCompare(b.author || '');
    if (state.sortOrder === 'wordcount') return totalWords(b) - totalWords(a);
    return 0;
  });


  if (state.view === 'grid') renderGridView(filtered);
  else renderListView(filtered);
  var libCount = document.getElementById('lib-count');
  if (libCount) libCount.textContent = filtered.length + (filtered.length === 1 ? ' work' : ' works');
  syncURL();
}

// ── URL STATE ─────────────────────────────────────────────────────────────
// The URL query string mirrors the current filter state, so navigating into a
// story and back restores the view (the browser keeps the URL) and the URL is
// shareable. This does NOT touch the in-memory filter/sort path — applyFilters()
// still runs entirely client-side at the same speed; this only reads/writes the
// address bar.
//
// Params (all optional, omitted when at their default):
//   tab   "collections" when on the collections tab
//   view  "list" when in list view (grid is default)
//   q     search query text
//   modes comma list of active search modes, only when not all are on
//   types comma list of ENABLED types, only when not all are on
//   tags  comma list of tag filters, each prefixed + (include) or - (exclude)
//   canon "1" when canon-only is active
//   sort  sort order, only when not the default "newest"
var _syncingLibURL = false;
function syncURL() {
  if (_syncingLibURL) return;
  var p = new URLSearchParams();

  if (state.tab === 'collections') p.set('tab', 'collections');
  if (state.view === 'list') p.set('view', 'list');

  if (state.query) p.set('q', state.query);

  var modes = getActiveModes();
  var allModes = [];
  document.querySelectorAll('.search-mode-btn').forEach(function(b){ allModes.push(b.getAttribute('data-mode')); });
  if (modes.length && allModes.length && modes.length !== allModes.length) p.set('modes', modes.join(','));

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

  if (p.get('tab') === 'collections') { state.tab = 'collections'; found = true; }
  if (p.get('view') === 'list') { state.view = 'list'; found = true; }

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

  state._urlModes = p.has('modes') ? p.get('modes').split(',').filter(Boolean) : null;
  if (state._urlModes) found = true;

  return found;
}

// -- Collections tab
// ── COLLECTIONS ───────────────────────────────────────────────────────────
// Curated story groupings from collections.json, shown as their own tab.
function renderCollectionsTab(q) {
  var grid  = document.getElementById('lib-grid');
  grid.className = 'lib-grid';
  grid.innerHTML = '';

  var collections = state.collections.filter(function(col) {
    if (q) return (col.title || '').toLowerCase().includes(q);
    return true;
  });

  var count = document.getElementById('lib-count');
  if (count) count.textContent = collections.length + ' collection' + (collections.length !== 1 ? 's' : '');

  if (!collections.length) {
    grid.innerHTML = '<div class="loading-placeholder">No collections found.</div>';
    return;
  }

  collections.forEach(function(col) {
    var members = state.stories.filter(function(i) {
      return (col.storyIds || []).includes(i.id);
    });
    var pal = paletteFor(col.title);

    var card = document.createElement('div');
    card.className = 'lib-card lib-card-collection';
    card.style.cursor = 'pointer';

    var titleCard =
      '<div class="lib-title-card" style="background:' + pal.bg + ';border-top:3px solid ' + pal.line + '">' +
        '<div class="lib-title-card-line" style="background:' + pal.line + '"></div>' +
        '<div class="lib-title-card-text" style="color:' + pal.accent + '">' + col.title + '</div>' +
        '<div class="lib-title-card-line" style="background:' + pal.line + '"></div>' +
        '<div class="lib-title-card-type">Collection &middot; ' + members.length + ' ' + (members.length !== 1 ? 'stories' : 'story') + '</div>' +
      '</div>';

    var coverHtml = titleCard;

    card.innerHTML =
      '<div class="lib-card-cover-wrap">' +
        coverHtml +
        '<span class="lib-type-badge lib-type-collection">Collection</span>' +
      '</div>' +
      '<div class="lib-card-body">' +
        '<div class="lib-card-title">' + col.title + '</div>' +
        '<p class="lib-card-summary">' + (col.summary || '') + '</p>' +
        '<div class="lib-card-meta">' +
          '<span class="lib-wordcount">' + members.length + ' ' + (members.length !== 1 ? 'stories' : 'story') + '</span>' +
        '</div>' +

      '</div>';

    // Click opens an inline overlay showing all members
    card.addEventListener('click', function() { openCollectionOverlay(col, members); });
    grid.appendChild(card);
  });
}

// -- Collection overlay
function openCollectionOverlay(col, members) {
  var panel  = document.getElementById('collection-panel');
  var header = document.getElementById('collection-header');
  var list   = document.getElementById('collection-stories');

  header.innerHTML =
    '<h2 class="collection-title">' + col.title + '</h2>' +
    (col.summary ? '<p class="collection-summary">' + col.summary + '</p>' : '');

  list.innerHTML = '';
  if (!members.length) {
    list.innerHTML = '<p class="lib-empty">No stories in this collection yet.</p>';
  } else {
    resetSearch();
    members.forEach(function(item) {
      var row = document.createElement('a');
      var words = totalWords(item);
      row.className = 'collection-story-row';
      row.href = 'reader.html?id=' + item.id;
      var tagHtml = (item.tags || []).map(function(t) {
        return '<span class="content-tag">' + t + '</span>';
      }).join('');

      row.innerHTML =
        '<div class="csr-info">' +
          '<div class="csr-title">' + item.title + '</div>' +
          (item.author ? '<div class="csr-author">by ' + item.author + '</div>' : '') +
          (tagHtml ? '<div class="csr-tags">' + tagHtml + '</div>' : '') +
        '</div>' +
        '<div class="csr-meta">' +
          (words ? '<span class="lib-wordcount">' + fmtWords(words) + '</span>' : '') +
          '<span class="lib-type-badge lib-type-' + item.type + '">' + (TYPE_LABELS[item.type] || '') + '</span>' +
        '</div>';
      list.appendChild(row);
    });
  }

  panel.style.display = '';
  window.scrollTo(0, 0);
}

// -- Find collections a story belongs to
function collectionsFor(storyId) {
  return state.collections.filter(function(col) {
    return (col.storyIds || []).includes(storyId);
  });
}

// -- Helpers
// ── WORD COUNT helpers ────────────────────────────────────────────────────
function totalWords(item) {
  if (item.wordCount) return item.wordCount;
  if (item.chapters)  return item.chapters.reduce(function(sum, c) { return sum + (c.wordCount || 0); }, 0);
  return 0;
}

function fmtWords(n) {
  if (!n) return '';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k words';
  return n + ' words';
}

// ── STORY INFO MODAL + card click → open reader.html ──────────────────────
function openInfoModal(item, words) {
  var existing = document.getElementById('lib-info-overlay');
  if (existing) existing.remove();

  var overlay = document.createElement('div');
  overlay.id = 'lib-info-overlay';
  overlay.className = 'lib-info-overlay';

  var tagHtml = (item.tags || []).map(function(t) {
    return '<span class="content-tag">' + t + '</span>';
  }).join('');

  overlay.innerHTML =
    '<div class="lib-info-modal">' +
      '<button class="lib-info-close" aria-label="Close">&#10005;</button>' +
      '<div class="lib-info-eyebrow">' + (TYPE_LABELS[item.type] || item.type) +
        (item.canonical ? ' &middot; \u2726 Canon' : '') + '</div>' +
      '<h2 class="lib-info-title">' + item.title + '</h2>' +
      (item.author ? '<div class="lib-info-author">by ' + item.author + '</div>' : '') +
      (item.summary ? '<p class="lib-info-summary">' + item.summary + '</p>' : '') +
      (tagHtml ? '<div class="lib-info-tags">' + tagHtml + '</div>' : '') +
      (words ? '<div class="lib-info-wordcount">' + fmtWords(words) + ' words</div>' : '') +
      '<a class="lib-info-read" href="reader.html?id=' + item.id + '">Read &#8594;</a>' +
    '</div>';

  function close() { overlay.remove(); }
  overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
  overlay.querySelector('.lib-info-close').addEventListener('click', close);
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });

  document.body.appendChild(overlay);
}

function handleCardClick(item) {
  window.location.href = 'reader.html?id=' + item.id;
}

// -- List view
// ── RENDER: list view / grid view / per-title color palette ───────────────
function renderListView(items) {
  var grid = document.getElementById('lib-grid');
  grid.className = 'lib-list';
  grid.innerHTML = '';

  if (!items.length) {
    grid.innerHTML = '<div class="loading-placeholder">No stories match your filters.</div>';
    return;
  }

  items.forEach(function(item) {
    var row   = document.createElement('div');
    var words = totalWords(item);
    var chaps = item.chapters ? item.chapters.length + ' chapters' : '';
    var cols  = collectionsFor(item.id).length;

    row.className = 'lib-row';
    row.innerHTML =
      '<div class="lib-row-left">' +
        '<div class="lib-row-title-line">' +
          '<span class="lib-row-title">' + item.title + '</span>' +
          '<span class="lib-type-badge lib-type-' + item.type + '">' + (TYPE_LABELS[item.type] || item.type) + '</span>' +
          (item.canonical ? '<span class="lib-canonical-star">&#10022;</span>' : '') +
        '</div>' +
        (item.author ? '<div class="lib-row-author">by ' + item.author + '</div>' : '') +
        '<p class="lib-row-summary">' + (item.summary || '') + '</p>' +
        '<div class="lib-row-tags">' +
          (item.tags || []).map(function(t) { return '<span class="content-tag">' + t + '</span>'; }).join('') +
        '</div>' +
      '</div>' +
      '<div class="lib-row-right">' +
        (words ? '<span class="lib-wordcount">' + fmtWords(words) + '</span>' : '') +
        (chaps ? '<span class="lib-wordcount">' + chaps + '</span>' : '') +
        '<span class="lib-row-cta">Read &#8594;</span>' +
      '</div>';

    row.style.cursor = 'pointer';
    row.addEventListener('click', function() { handleCardClick(item); });
    grid.appendChild(row);
  });
}

// -- Grid view
function renderGridView(items) {
  var grid = document.getElementById('lib-grid');
  grid.className = 'lib-grid';
  grid.innerHTML = '';

  if (!items.length) {
    grid.innerHTML = '<div class="loading-placeholder">No stories match your filters.</div>';
    return;
  }

  items.forEach(function(item) {
    var card  = document.createElement('div');
    var words = totalWords(item);
    var chaps = item.chapters ? item.chapters.length + ' ch.' : '';
    var pal   = paletteFor(item.title);
    var cols  = collectionsFor(item.id).length;

    card.className = 'lib-card lib-card-' + item.type;

    var chapCount = item.chapters ? item.chapters.length : 0;
    var chapBadge = (item.type === 'serial' && chapCount)
      ? '<span class="lib-chap-badge">' + chapCount + ' ch.</span>'
      : '';

    var titleCard =
      '<div class="lib-title-card" style="background:' + pal.bg + ';border-top:3px solid ' + pal.line + '">' +
        '<div class="lib-title-card-line" style="background:' + pal.line + '"></div>' +
        '<div class="lib-title-card-text" style="color:' + pal.accent + '">' + item.title + '</div>' +
        (item.author ? '<div class="lib-title-card-author">by ' + item.author + '</div>' : '') +
        '<div class="lib-title-card-line" style="background:' + pal.line + '"></div>' +
        '<div class="lib-title-card-type">' + (TYPE_LABELS[item.type] || item.type) + '</div>' +
      '</div>';

    var coverHtml = titleCard;

    card.innerHTML =
      '<div class="lib-card-cover-wrap">' +
        coverHtml +
        '<span class="lib-type-badge lib-type-' + item.type + '">' + (TYPE_LABELS[item.type] || item.type) + '</span>' +
        chapBadge +
        (item.canonical ? '<span class="lib-canonical-badge">&#10022;</span>' : '') +
        (words ? '<span class="lib-cover-wordcount">' + fmtWords(words) + '</span>' : '') +
        '<button class="lib-info-btn" title="Details" aria-label="Details">i</button>' +
      '</div>';

    card.style.cursor = 'pointer';
    card.addEventListener('click', function() { handleCardClick(item); });
    var infoBtn = card.querySelector('.lib-info-btn');
    if (infoBtn) {
      infoBtn.addEventListener('click', function(e) {
        e.stopPropagation();   // don't open the reader
        e.preventDefault();
        openInfoModal(item, words);
      });
    }
    grid.appendChild(card);
  });
}

// -- Color palette for generated title cards
var CARD_PALETTES = [
  { bg: '#1a0e0e', accent: '#c49a78', line: '#7a2233' },
  { bg: '#0e1018', accent: '#8899cc', line: '#334488' },
  { bg: '#0e1a10', accent: '#88bb99', line: '#2a5a38' },
  { bg: '#180e18', accent: '#bb88cc', line: '#5a2a6a' },
  { bg: '#1a140a', accent: '#ccaa66', line: '#7a5a20' },
  { bg: '#0e1818', accent: '#88bbcc', line: '#1a5a6a' },
];

function paletteFor(title) {
  var hash = 0;
  for (var i = 0; i < title.length; i++) {
    hash = ((hash << 5) - hash) + title.charCodeAt(i);
    hash |= 0;
  }
  return CARD_PALETTES[Math.abs(hash) % CARD_PALETTES.length];
}

document.getElementById('collection-close').addEventListener('click', function() {
  document.getElementById('collection-panel').style.display = 'none';
});

// -- Tab switching
document.getElementById('tab-stories').addEventListener('click', function() {
  state.tab = 'stories';
  state.query = '';
  document.getElementById('search-input').value = '';
  document.querySelectorAll('#content-toggle .view-toggle-btn').forEach(function(t) { t.classList.remove('active'); });
  this.classList.add('active');
  document.getElementById('search-input').placeholder = 'Search…';
  // Restore filter controls
  var fp = document.getElementById('filter-panel');
  if (fp) { fp.style.display = ''; }
  var ftb = document.getElementById('filter-toggle-btn');
  if (ftb) ftb.style.display = '';
  // Show sort + view controls (but keep the content toggle visible)
  var sortWrap = document.querySelector('.results-sort');
  if (sortWrap) sortWrap.style.display = '';
  var svt = document.getElementById('story-view-toggle');
  if (svt) svt.style.display = '';
  applyFilters();
});

document.getElementById('tab-collections').addEventListener('click', function() {
  state.tab = 'collections';
  state.query = '';
  document.getElementById('search-input').value = '';
  document.querySelectorAll('#content-toggle .view-toggle-btn').forEach(function(t) { t.classList.remove('active'); });
  this.classList.add('active');
  document.getElementById('search-input').placeholder = 'Search collections...';
  // Hide filters and the sort/view controls — but keep the content toggle visible
  var fp = document.getElementById('filter-panel');
  if (fp) { fp.classList.remove('open'); fp.style.display = 'none'; }
  var ftb = document.getElementById('filter-toggle-btn');
  if (ftb) ftb.style.display = 'none';
  var sortWrap = document.querySelector('.results-sort');
  if (sortWrap) sortWrap.style.display = 'none';
  var svt = document.getElementById('story-view-toggle');
  if (svt) svt.style.display = 'none';
  applyFilters();
});

// -- View toggle
document.getElementById('view-list-btn').addEventListener('click', function() {
  state.view = 'list';
  this.classList.add('active');
  document.getElementById('view-grid-btn').classList.remove('active');
  applyFilters();
});

document.getElementById('view-grid-btn').addEventListener('click', function() {
  state.view = 'grid';
  this.classList.add('active');
  document.getElementById('view-list-btn').classList.remove('active');
  applyFilters();
});

// -- Search and filters

// -- Filter panel toggle
// ── UI WIRING: collapsible filter panel, canon toggle, search box ─────────
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

document.querySelectorAll('.search-mode-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    this.classList.toggle('active');
    applyFilters();
  });
});

document.getElementById('type-filters').addEventListener('click', function(e) {
  var btn = e.target.closest('.type-toggle-btn');
  if (!btn) return;
  var type = btn.getAttribute('data-type');
  state.typeFilter[type] = !state.typeFilter[type];
  btn.classList.toggle('active', state.typeFilter[type]);
  applyFilters();
});

var canonBtn = document.getElementById('canon-filter-btn');
if (canonBtn) canonBtn.addEventListener('click', function() {
  state.canonOnly = !state.canonOnly;
  this.classList.toggle('active', state.canonOnly);
  applyFilters();
});

document.getElementById('sort-select').addEventListener('change', function() {
  state.sortOrder = this.value;
  applyFilters();
});

init();

