'use strict';

var state = {
  items:      [],
  filtered:   [],
  typeFilter: 'all',
  tagFilter:  null,
  sortOrder:  'newest',
  query:      '',
};

var TYPE_LABELS = {
  comic:   'Comic',
  scene:   'World Scene',
  charref: 'Character Ref',
};

// -- Boot
async function init() {
  try {
    var res = await fetch('gallery.json');
    if (!res.ok) throw new Error('Could not load gallery.json');
    state.items = await res.json();
    buildTagFilters();
    applyFilters();
  } catch(e) {
    document.getElementById('gallery-grid').innerHTML =
      '<div class="loading-placeholder" style="color:var(--wine)">Failed to load gallery.<br><small>' + e.message + '</small></div>';
  }
}

// -- Tag filters built from data
function buildTagFilters() {
  var tagSet = new Set();
  state.items.forEach(function(item) {
    (item.tags || []).forEach(function(t) { tagSet.add(t); });
  });
  var container = document.getElementById('tag-filters');
  if (!tagSet.size) { container.style.display = 'none'; return; }

  var all = document.createElement('button');
  all.className = 'tag-filter-btn active';
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
    btn.className = 'tag-filter-btn';
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

// -- Filter + sort + render
function applyFilters() {
  var q = state.query.toLowerCase();

  state.filtered = state.items.filter(function(item) {
    if (state.typeFilter !== 'all' && item.type !== state.typeFilter) return false;
    if (state.tagFilter && !(item.tags || []).includes(state.tagFilter)) return false;
    if (q && !item.title.toLowerCase().includes(q) && !(item.artist || '').toLowerCase().includes(q)) return false;
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

function renderGrid() {
  var grid  = document.getElementById('gallery-grid');
  var count = document.getElementById('gallery-count');
  grid.innerHTML = '';

  count.textContent = state.filtered.length + ' item' + (state.filtered.length !== 1 ? 's' : '');

  if (!state.filtered.length) {
    grid.innerHTML = '<div class="loading-placeholder">No items match your filters.</div>';
    return;
  }

  state.filtered.forEach(function(item) {
    var card = document.createElement('a');
    card.className = 'gallery-card gallery-card-' + item.type;
    card.href      = 'viewer.html?id=' + item.id;

    var thumb = item.coverImage || item.image || '';

    card.innerHTML =
      '<div class="gallery-thumb-wrap">' +
        (thumb
          ? '<img class="gallery-thumb" src="' + thumb + '" alt="' + item.title + '" loading="lazy" />'
          : '<div class="gallery-thumb-placeholder">&#10022;</div>') +
        '<span class="gallery-type-badge type-' + item.type + '">' + (TYPE_LABELS[item.type] || item.type) + '</span>' +
        (item.canonical ? '<span class="gallery-canonical-badge">&#10022;</span>' : '') +
        (item.type === 'comic'
          ? '<span class="gallery-page-count">' + (item.pages ? item.pages.length : 0) + ' pages</span>'
          : '') +
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