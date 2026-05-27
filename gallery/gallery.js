'use strict';

var state = {
  items:      [],
  filtered:   [],
  typeFilter: { comic: true, scene: true, charref: true },
  hiddenTags: new Set(),  // tags excluded by user
  sortOrder:  'newest',
  query:      '',
};

var TYPE_LABELS = {
  comic:   'Comic',
  scene:   'World Scene',
  charref: 'Reference',
};

// -- Boot
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
function buildTagFilters(warningTags) {
  var container = document.getElementById('tag-filters');
  if (!warningTags || !warningTags.length) { container.style.display = 'none'; return; }

  // Load saved hidden tags from localStorage
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

// -- Filter + sort + render
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
    if (state.hiddenTags.size && (item.tags || []).some(function(t){ return state.hiddenTags.has(t); })) return false;
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
// Search mode toggle buttons
document.querySelectorAll('.search-mode-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    this.classList.toggle('active');
    applyFilters();
  });
});

function resetSearch() {
  var inp = document.getElementById('search-input');
  if (inp) inp.value = '';
  state.query = '';
  document.querySelectorAll('.search-mode-btn').forEach(function(b){ b.classList.add('active'); });
  state.typeFilter = { comic: true, scene: true, charref: true };
  state.hiddenTags = new Set();
  localStorage.removeItem('sinverse_hidden_tags');
  document.querySelectorAll('.tag-filter-btn').forEach(function(b){ b.classList.add('active'); });
  document.querySelectorAll('.type-toggle-btn').forEach(function(b){ b.classList.add('active'); });
  applyFilters();
}


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
