'use strict';

var state = {
  stories:    [],
  collections:[],
  typeFilter: 'all',
  tagFilter:  null,
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
    buildTagFilters();
    applyFilters();
  } catch(e) {
    document.getElementById('lib-grid').innerHTML =
      '<div class="loading-placeholder" style="color:var(--wine)">Failed to load library.<br><small>' + e.message + '</small></div>';
  }
}

// -- Tag filters built from stories/serials only
function buildTagFilters() {
  var tagSet = new Set();
  state.stories.forEach(function(item) {
    (item.tags || []).forEach(function(t) { tagSet.add(t); });
  });
  var container = document.getElementById('tag-filters');
  if (!tagSet.size) return;

  var all = document.createElement('button');
  all.className   = 'tag-filter-btn active';
  all.textContent = 'All tags';
  all.addEventListener('click', function() {
    state.tagFilter = null;
    container.querySelectorAll('.tag-filter-btn').forEach(function(b) { b.classList.remove('active'); });
    all.classList.add('active');
    applyFilters();
  });
  container.appendChild(all);

  tagSet.forEach(function(tag) {
    var btn = document.createElement('button');
    btn.className   = 'tag-filter-btn';
    btn.textContent = tag;
    btn.addEventListener('click', function() {
      state.tagFilter = state.tagFilter === tag ? null : tag;
      container.querySelectorAll('.tag-filter-btn').forEach(function(b) { b.classList.remove('active'); });
      (state.tagFilter ? btn : all).classList.add('active');
      applyFilters();
    });
    container.appendChild(btn);
  });
}

function applyFilters() {
  var q = state.query.toLowerCase();

  if (state.tab === 'collections') {
    renderCollectionsTab(q);
    return;
  }

  // Stories tab -- show standalone and serials, never raw collection entries
  var filtered = state.stories.filter(function(item) {
    if (state.typeFilter !== 'all' && item.type !== state.typeFilter) return false;
    if (state.tagFilter && !(item.tags || []).includes(state.tagFilter)) return false;
    if (q) {
      var inTitle  = (item.title  || '').toLowerCase().includes(q);
      var inAuthor = (item.author || '').toLowerCase().includes(q);
      if (!inTitle && !inAuthor) return false;
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
  document.getElementById('search-input').placeholder = 'Search by title or author...';
  document.getElementById('story-controls').style.display = '';
  document.getElementById('story-tag-row').style.display = '';
  document.getElementById('story-view-toggle').style.display = '';
  applyFilters();
});

document.getElementById('tab-collections').addEventListener('click', function() {
  state.tab = 'collections';
  state.query = '';
  document.getElementById('search-input').value = '';
  document.querySelectorAll('.lib-tab').forEach(function(t) { t.classList.remove('active'); });
  this.classList.add('active');
  document.getElementById('search-input').placeholder = 'Search collections...';
  document.getElementById('story-controls').style.display = 'none';
  document.getElementById('story-tag-row').style.display = 'none';
  document.getElementById('story-view-toggle').style.display = 'none';
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
document.getElementById('search-input').addEventListener('input', function() {
  state.query = this.value.trim();
  applyFilters();
});

document.getElementById('type-filters').addEventListener('click', function(e) {
  if (!e.target.classList.contains('filter-btn')) return;
  state.typeFilter = e.target.getAttribute('data-value');
  document.querySelectorAll('#type-filters .filter-btn').forEach(function(b) { b.classList.remove('active'); });
  e.target.classList.add('active');
  applyFilters();
});

document.getElementById('sort-select').addEventListener('change', function() {
  state.sortOrder = this.value;
  applyFilters();
});

init();