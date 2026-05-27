'use strict';

var state = {
  stories:    [],
  collections:[],
  typeFilter: { standalone: true, serial: true },
  hiddenTags: new Set(),
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

    // Apply ?character= param from wiki, or reset to clean state on fresh visit
    var urlParams = new URLSearchParams(window.location.search);
    var charParam = urlParams.get('character');
    if (charParam) {
      var charName = decodeURIComponent(charParam);
      var inp = document.getElementById('search-input');
      if (inp) inp.value = charName;
      state.query = charName.toLowerCase();
      document.querySelectorAll('.search-mode-btn').forEach(function(b){ b.classList.remove('active'); });
      var charBtn = document.querySelector('.search-mode-btn[data-mode="character"]');
      if (charBtn) charBtn.classList.add('active');
      var url = new URL(window.location.href);
      url.searchParams.delete('character');
      window.history.replaceState({}, '', url);
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
function buildTagFilters(warningTags) {
  var container = document.getElementById('tag-filters');
  if (!warningTags || !warningTags.length) { container.style.display = 'none'; return; }

  try {
    var saved = JSON.parse(localStorage.getItem('sinverse_hidden_tags') || '[]');
    state.hiddenTags = new Set(saved);
  } catch(e) { state.hiddenTags = new Set(); }

  var sortedTags = warningTags.slice().sort();
  sortedTags.forEach(function(tag) {
    var btn = document.createElement('button');
    btn.className = 'tag-filter-btn' + (state.hiddenTags.has(tag) ? '' : ' active');
    btn.textContent = tag;
    btn.setAttribute('data-tag', tag);
    btn.addEventListener('click', function() {
      if (state.hiddenTags.has(tag)) {
        state.hiddenTags.delete(tag);
        btn.classList.add('active');
      } else {
        state.hiddenTags.add(tag);
        btn.classList.remove('active');
      }
      localStorage.setItem('sinverse_hidden_tags', JSON.stringify([...state.hiddenTags]));
      applyFilters();
    });
    container.appendChild(btn);
  });
}


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
  state.hiddenTags = new Set();
  localStorage.removeItem('sinverse_hidden_tags');
  document.querySelectorAll('.tag-filter-btn').forEach(function(b){ b.classList.add('active'); });
  document.querySelectorAll('.type-toggle-btn').forEach(function(b){ b.classList.add('active'); });
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
    if (state.hiddenTags.size && (item.tags || []).some(function(t){ return state.hiddenTags.has(t); })) return false;
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

  document.getElementById('lib-count').textContent = filtered.length + ' item' + (filtered.length !== 1 ? 's' : '');

  if (state.view === 'grid') renderGridView(filtered);
  else renderListView(filtered);
}

// -- Collections tab
function renderCollectionsTab(q) {
  var grid  = document.getElementById('lib-grid');
  var count = document.getElementById('lib-count');
  grid.className = 'lib-grid';
  grid.innerHTML = '';

  var collections = state.collections.filter(function(col) {
    if (q) return (col.title || '').toLowerCase().includes(q);
    return true;
  });

  count.textContent = collections.length + ' collection' + (collections.length !== 1 ? 's' : '');

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

    var coverHtml = col.coverImage
      ? '<img class="lib-card-cover" src="' + col.coverImage + '" alt="' + col.title + '" loading="lazy" />'
      : titleCard;

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

function handleCardClick(item) {
  window.location.href = 'reader.html?id=' + item.id;
}

// -- List view
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
          (cols ? '<span class="lib-in-collection">&#9674; ' + cols + ' collection' + (cols !== 1 ? 's' : '') + '</span>' : '') +
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

    var titleCard =
      '<div class="lib-title-card" style="background:' + pal.bg + ';border-top:3px solid ' + pal.line + '">' +
        '<div class="lib-title-card-line" style="background:' + pal.line + '"></div>' +
        '<div class="lib-title-card-text" style="color:' + pal.accent + '">' + item.title + '</div>' +
        (item.author ? '<div class="lib-title-card-author">by ' + item.author + '</div>' : '') +
        '<div class="lib-title-card-line" style="background:' + pal.line + '"></div>' +
        '<div class="lib-title-card-type">' + (TYPE_LABELS[item.type] || item.type) + '</div>' +
      '</div>';

    var coverHtml = item.coverImage
      ? '<img class="lib-card-cover" src="' + item.coverImage + '" alt="' + item.title + '" loading="lazy" />'
      : titleCard;

    card.innerHTML =
      '<div class="lib-card-cover-wrap">' +
        coverHtml +
        '<span class="lib-type-badge lib-type-' + item.type + '">' + (TYPE_LABELS[item.type] || item.type) + '</span>' +
        (item.canonical ? '<span class="lib-canonical-badge">&#10022;</span>' : '') +
      '</div>' +
      '<div class="lib-card-body">' +
        '<div class="lib-card-title">' + item.title + '</div>' +
        (item.author ? '<div class="lib-card-author">by ' + item.author + '</div>' : '') +
        '<p class="lib-card-summary">' + (item.summary || '') + '</p>' +
        '<div class="lib-card-meta">' +
          (words ? '<span class="lib-wordcount">' + fmtWords(words) + '</span>' : '') +
          (chaps ? '<span class="lib-wordcount">' + chaps + '</span>' : '') +
          (cols ? '<span class="lib-wordcount">&#9674; ' + cols + ' collection' + (cols !== 1 ? 's' : '') + '</span>' : '') +
          (item.tags || []).map(function(t) { return '<span class="content-tag">' + t + '</span>'; }).join('') +
        '</div>' +
      '</div>';

    card.style.cursor = 'pointer';
    card.addEventListener('click', function() { handleCardClick(item); });
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
  document.querySelectorAll('.lib-tab').forEach(function(t) { t.classList.remove('active'); });
  this.classList.add('active');
  document.getElementById('search-input').placeholder = 'Search…';
  // Restore filter controls
  var fp = document.getElementById('filter-panel');
  if (fp) { fp.style.display = ''; }
  var ftb = document.getElementById('filter-toggle-btn');
  if (ftb) ftb.style.display = '';
  var rb = document.querySelector('.results-bar');
  if (rb) rb.style.display = '';
  applyFilters();
});

document.getElementById('tab-collections').addEventListener('click', function() {
  state.tab = 'collections';
  state.query = '';
  document.getElementById('search-input').value = '';
  document.querySelectorAll('.lib-tab').forEach(function(t) { t.classList.remove('active'); });
  this.classList.add('active');
  document.getElementById('search-input').placeholder = 'Search collections...';
  // Hide all filter controls — collections only searched by title
  var fp = document.getElementById('filter-panel');
  if (fp) { fp.classList.remove('open'); fp.style.display = 'none'; }
  var ftb = document.getElementById('filter-toggle-btn');
  if (ftb) ftb.style.display = 'none';
  var rb = document.querySelector('.results-bar');
  if (rb) rb.style.display = 'none';
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

document.getElementById('sort-select').addEventListener('change', function() {
  state.sortOrder = this.value;
  applyFilters();
});

init();

