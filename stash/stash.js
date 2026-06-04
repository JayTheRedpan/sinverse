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
  // URL param: ?creator=NAME prefills the search to that creator (creator-only
  // search mode), so the contributors "Stash" card can deep-link into a creator's
  // stash work.
  var creatorParam = new URLSearchParams(window.location.search).get('creator');
  if (creatorParam) {
    var name = decodeURIComponent(creatorParam);
    state.search = name.toLowerCase();
    state.searchModes = { title: false, creator: true };
    var si = document.getElementById('stash-search'); if (si) si.value = name;
    document.querySelectorAll('.search-mode-btn').forEach(function (b) {
      var on = b.getAttribute('data-mode') === 'creator';
      b.classList.toggle('active', on);
    });
    var url = new URL(window.location.href);
    url.searchParams.delete('creator');
    window.history.replaceState({}, '', url);
  }
  applyFilters();
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
      if (state.searchModes.creator) fields.push(it.creator || '');
      var hay = fields.join(' ').toLowerCase();
      if (hay.indexOf(state.search) === -1) return false;
    }
    return true;
  });

  items.sort(function (a, b) {
    switch (state.sort) {
      case 'oldest':  return (a.date || '').localeCompare(b.date || '');
      case 'title':   return (a.title || '').localeCompare(b.title || '');
      case 'creator': return (a.creator || '').localeCompare(b.creator || '');
      case 'newest':
      default:        return (b.date || '').localeCompare(a.date || '');
    }
  });

  renderGrid(items);
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

    var thumb = document.createElement('div');
    thumb.className = 'stash-card-thumb';
    if (it.image) {
      var img = document.createElement('img');
      img.src = it.image;
      img.alt = it.title || '';
      img.loading = 'lazy';
      thumb.appendChild(img);
    } else {
      thumb.classList.add('stash-card-thumb-empty');
      thumb.textContent = 'No image';
    }
    card.appendChild(thumb);

    var body = document.createElement('div');
    body.className = 'stash-card-body';
    var t = document.createElement('h3');
    t.className = 'stash-card-title';
    t.textContent = it.title || 'Untitled';
    body.appendChild(t);
    if (it.creator) {
      var c = document.createElement('p');
      c.className = 'stash-card-creator';
      c.textContent = 'by ' + it.creator;
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
      (it.creator ? '<div class="lib-title-card-author">by ' + escapeHtml(it.creator) + '</div>' : '') +
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
      (it.creator ? '<div class="lib-info-author">by ' + escapeHtml(it.creator) + '</div>' : '') +
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
  document.getElementById('stash-lightbox-img').src = it.image || '';
  document.getElementById('stash-lightbox-img').alt = it.title || '';
  document.getElementById('stash-lightbox-title').textContent = it.title || '';
  document.getElementById('stash-lightbox-creator').textContent = it.creator ? 'by ' + it.creator : '';
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
  document.getElementById('stash-reader-creator').textContent = it.creator ? 'by ' + it.creator : '';
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
