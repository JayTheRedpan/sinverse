/* ===============================================
   Sinverse — Audio (Voice Works) grid
   audio/audio.js

   Mirrors the library grid: search with mode toggles, tri-state tag
   filtering, sorting with the newest/oldest ID tiebreak, and cards that
   link through to player.html?id=N. Cover art falls back to the featured
   character's portrait, then to a styled title card.
   =============================================== */

'use strict';

var state = {
  items: [],
  filtered: [],
  search: '',
  searchModes: { title: true, credits: true, character: true },
  // Per-tag tristate filtering. tagStates maps a normalized tag -> 'include'
  // or 'exclude'. A tag absent from the map is neutral (no effect).
  tagStates: {},
  sort: 'newest'
};

var CONTRIBUTORS = {};        // id -> contributor record (VA credits)

// ── Character roster (cover fallbacks + known-character checks) ──────────
// Same pattern as the gallery viewer: canon + ACTIVE fan characters are
// "known"; if the roster can't load we fail open rather than degrade.
var _roster = {};             // lowercased name/wiki -> { profile_image }
var _rosterLoaded = false;

function loadRoster() {
  function add(c) {
    if (!c) return;
    var rec = { profile_image: c.profile_image || c.image || null };
    if (c.name) _roster[String(c.name).toLowerCase()] = rec;
    if (c.wiki) _roster[String(c.wiki).toLowerCase()] = rec;
  }
  var canonP = fetch('../_data/characters.json').then(function(r){ return r.ok ? r.json() : []; }).catch(function(){ return []; });
  var fanP   = fetch('../_data/fan-characters.json').then(function(r){ return r.ok ? r.json() : []; }).catch(function(){ return []; });
  return Promise.all([canonP, fanP]).then(function(res) {
    (res[0] || []).forEach(add);
    (res[1] || []).forEach(function(c) { if (!(c && c.active === false)) add(c); });
    _rosterLoaded = true;
  }).catch(function(){ _rosterLoaded = false; });
}

function charKey(tag) {
  var m = String(tag).match(/^\s*(canon|fan)\s*:\s*(.+)$/i);
  return (m ? m[2] : String(tag)).replace(/_/g, ' ').trim().toLowerCase();
}
function rosterEntry(tag) {
  var key = charKey(tag);
  return _roster[key] || _roster[key.replace(/\s+/g, '-')] || null;
}
function charDisplayName(tag) {
  var key = charKey(tag);
  return key.charAt(0).toUpperCase() + key.slice(1);
}

// ── Duration helpers: accept seconds (number) or "MM:SS" (string) ────────
function durationSeconds(d) {
  if (d === null || d === undefined || d === '') return 0;
  if (typeof d === 'number') return d;
  var parts = String(d).split(':').map(function(p){ return parseInt(p, 10) || 0; });
  if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2];
  if (parts.length === 2) return parts[0]*60 + parts[1];
  return parseInt(d, 10) || 0;
}
function formatDuration(d) {
  var s = durationSeconds(d);
  if (!s) return '';
  var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  function pad(n){ return (n < 10 ? '0' : '') + n; }
  return h ? (h + ':' + pad(m) + ':' + pad(sec)) : (m + ':' + pad(sec));
}

// ── Credit helpers ───────────────────────────────────────────────────────
// voice_actors[] is the headline credit ("Voiced by …"); credits[] holds the
// rest of the crew as { id, role } (foley, writing, editing…). The legacy
// `contributor` array is treated as voice_actors for older entries.
function voiceActors(item) {
  if (Array.isArray(item.voice_actors)) return item.voice_actors;
  var c = item.contributor;
  if (!c) return [];
  return Array.isArray(c) ? c : [c];
}
function creditsList(item) {
  return Array.isArray(item.credits) ? item.credits : [];
}
function nameOf(id) {
  var rec = CONTRIBUTORS[id];
  return rec ? rec.name : id;
}
function vaNames(item) {
  return voiceActors(item).map(nameOf);
}
// Every credited person (VAs + crew), for search and contributor-page links.
function allCreditNames(item) {
  var names = vaNames(item);
  creditsList(item).forEach(function(cr) {
    if (cr && cr.id) { names.push(nameOf(cr.id)); names.push(String(cr.id)); }
  });
  voiceActors(item).forEach(function(id){ names.push(String(id)); });
  return names;
}

// ── Load ─────────────────────────────────────────────────────────────────
function init() {
  var itemsP = fetch('audio.json').then(function(r){ return r.ok ? r.json() : []; });
  var contribP = fetch('../contributors/contributors.json')
    .then(function(r){ return r.ok ? r.json() : []; }).catch(function(){ return []; });
  // Canonical tag vocabulary shared with the gallery/library (_data/tags.json).
  // The buttons come from this list, not from whatever tags happen to be in the
  // data, so the filter UI is consistent across modules from day one.
  var tagsP = fetch('../_data/tags.json')
    .then(function(r){ return r.ok ? r.json() : {}; }).catch(function(){ return {}; });

  Promise.all([itemsP, contribP, loadRoster(), tagsP]).then(function(res) {
    (res[1] || []).forEach(function(c){ if (c && c.id) CONTRIBUTORS[c.id] = c; });
    state.items = (res[0] || []).filter(function(it){ return it && it.active !== false; });
    var tagsData = res[3] || {};
    restoreTagStates();
    buildTagFilters(tagsData.audio || tagsData.story || []);
    // Deep links from contributor pages: ?search=<id>&mode=credits
    var params = new URLSearchParams(window.location.search);
    var q = params.get('search');
    var mode = params.get('mode');
    if (q) {
      state.search = q;
      var inp = document.getElementById('search-input');
      if (inp) inp.value = q;
    }
    if (mode && state.searchModes.hasOwnProperty(mode)) {
      Object.keys(state.searchModes).forEach(function(k){ state.searchModes[k] = (k === mode); });
      document.querySelectorAll('.search-mode-btn').forEach(function(btn) {
        btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
      });
    }
    applyFilters();
  }).catch(function(err) {
    console.error('[audio] failed to load', err);
    var grid = document.getElementById('aud-grid');
    if (grid) grid.innerHTML = '<div class="loading-placeholder">Could not load audio.</div>';
  });
}

// ── Tag filters (tri-state, mirroring the library) ───────────────────────
var TAG_STORE_KEY = 'sv_audio_tagStates';

function restoreTagStates() {
  try {
    var saved = JSON.parse(localStorage.getItem(TAG_STORE_KEY) || '{}');
    state.tagStates = (saved && typeof saved === 'object') ? saved : {};
  } catch (e) { state.tagStates = {}; }
}
function persistTagStates() {
  try { localStorage.setItem(TAG_STORE_KEY, JSON.stringify(state.tagStates)); } catch (e) {}
}

function buildTagFilters(warningTags) {
  var container = document.getElementById('tag-filters');
  if (!warningTags || !warningTags.length) {
    container.style.display = 'none';
    var ctrls = document.querySelector('.tag-controls'); if (ctrls) ctrls.style.display = 'none';
    var hint = document.getElementById('tag-mode-hint'); if (hint) hint.style.display = 'none';
    return;
  }

  var sortedTags = warningTags.slice().sort();
  container.innerHTML = '';
  sortedTags.forEach(function(tag) {
    var key = String(tag).trim().toLowerCase();
    var btn = document.createElement('button');
    btn.setAttribute('data-tag', key);
    btn.textContent = tag;   // cached as the display label by paintTagButton
    btn.addEventListener('click', function() {
      // Cycle: neutral -> include -> exclude -> neutral
      var cur = state.tagStates[key];
      if (!cur)                    state.tagStates[key] = 'include';
      else if (cur === 'include')  state.tagStates[key] = 'exclude';
      else                         delete state.tagStates[key];
      persistTagStates();
      paintTagButton(btn, key);
      applyFilters();
    });
    paintTagButton(btn, key);
    container.appendChild(btn);
  });

  var clearBtn = document.getElementById('tag-select-none');
  if (clearBtn && !clearBtn._wired) {
    clearBtn._wired = true;
    clearBtn.addEventListener('click', function() {
      state.tagStates = {};
      persistTagStates();
      reflectTagButtons();
      applyFilters();
    });
  }
}

// Render one tag button to reflect its tristate. Mirrors the library exactly:
// the leading glyph keeps the state legible without relying on colour alone.
function paintTagButton(btn, key) {
  var st = state.tagStates[key];
  var text = btn._label || (btn._label = btn.textContent || key);
  btn.className = 'tag-filter-btn tristate' + (st ? ' ' + st : ' neutral');
  var glyph = st === 'include' ? '＋' : (st === 'exclude' ? '－' : '');
  btn.innerHTML = (glyph ? '<span class="tag-tri-glyph">' + glyph + '</span>' : '') + '<span class="tag-tri-label">' + text + '</span>';
  btn.setAttribute('aria-pressed', st ? 'true' : 'false');
  btn.title = st === 'include' ? 'Including: only clips WITH this tag pass (click to exclude)'
            : st === 'exclude' ? 'Excluding: clips with this tag are hidden (click to clear)'
            : 'Click to require this tag; click again to exclude it';
}

function reflectTagButtons() {
  document.querySelectorAll('.tag-filter-btn').forEach(function(b) {
    paintTagButton(b, b.getAttribute('data-tag'));
  });
}

function tagHint() {
  var inc = 0, exc = 0;
  Object.keys(state.tagStates).forEach(function(k) {
    if (state.tagStates[k] === 'include') inc++; else exc++;
  });
  var el = document.getElementById('tag-mode-hint');
  if (!el) return;
  if (!inc && !exc) { el.textContent = ''; return; }
  var bits = [];
  if (inc) bits.push('requiring ' + inc + ' tag' + (inc > 1 ? 's' : ''));
  if (exc) bits.push('excluding ' + exc + ' tag' + (exc > 1 ? 's' : ''));
  el.textContent = 'Filters: ' + bits.join(', ');
}

// ── Filtering + sorting ──────────────────────────────────────────────────
function matchesSearch(it, q) {
  if (!q) return true;
  var m = state.searchModes;
  if (m.title && (it.title || '').toLowerCase().indexOf(q) !== -1) return true;
  if (m.title && (it.description || '').toLowerCase().indexOf(q) !== -1) return true;
  if (m.credits && allCreditNames(it).some(function(n){ return String(n).toLowerCase().indexOf(q) !== -1; })) return true;
  if (m.character && (it.characters || []).some(function(c){
    return charDisplayName(c).toLowerCase().indexOf(q) !== -1;
  })) return true;
  return false;
}

function matchesTags(it) {
  var tags = (it.tags || []).map(function(t){ return String(t).toLowerCase(); });
  var keys = Object.keys(state.tagStates);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i], st = state.tagStates[k];
    var has = tags.indexOf(k) !== -1;
    if (st === 'include' && !has) return false;
    if (st === 'exclude' && has)  return false;
  }
  return true;
}

function applyFilters() {
  var q = state.search.trim().toLowerCase();
  state.filtered = state.items.filter(function(it) {
    return matchesSearch(it, q) && matchesTags(it);
  });

  state.filtered.sort(function(a, b) {
    // Dates only carry month+year, so same-month items tie. Break the tie by
    // id: a higher id is the more recently added item.
    switch (state.sort) {
      case 'oldest':   return (a.date || '').localeCompare(b.date || '') || ((a.id || 0) - (b.id || 0));
      case 'title':    return (a.title || '').localeCompare(b.title || '');
      case 'duration': return durationSeconds(b.duration) - durationSeconds(a.duration);
      case 'newest':
      default:         return (b.date || '').localeCompare(a.date || '') || ((b.id || 0) - (a.id || 0));
    }
  });

  tagHint();
  renderGrid();
}

// ── Cards ────────────────────────────────────────────────────────────────
function thumbUrl(url) {
  if (!url) return null;
  return (window.SinverseImg && SinverseImg.thumb) ? SinverseImg.thumb(url, 500) : url;
}

// Cover fallback chain: explicit cover -> featured character portrait -> null
// (a styled title card is rendered instead).
function coverFor(it) {
  if (it.cover) return thumbUrl(it.cover);
  var chars = it.characters || [];
  for (var i = 0; i < chars.length; i++) {
    var rec = rosterEntry(chars[i]);
    if (rec && rec.profile_image) return thumbUrl(rec.profile_image);
  }
  return null;
}

function renderGrid() {
  var grid = document.getElementById('aud-grid');
  if (!grid) return;
  grid.innerHTML = '';

  var count = document.getElementById('results-count');
  if (count) count.textContent = state.filtered.length + ' work' + (state.filtered.length === 1 ? '' : 's');
  var foot = document.getElementById('aud-count');
  if (foot) foot.textContent = state.items.length + ' voice work' + (state.items.length === 1 ? '' : 's');

  if (!state.filtered.length) {
    grid.innerHTML = '<div class="loading-placeholder">Nothing matches those filters.</div>';
    return;
  }

  state.filtered.forEach(function(it) {
    var a = document.createElement('a');
    a.className = 'aud-card';
    a.href = 'player.html?id=' + encodeURIComponent(it.id);

    var cover = coverFor(it);
    var coverHtml = cover
      ? '<div class="aud-card-cover"><img src="' + cover + '" alt="" loading="lazy" /></div>'
      : '<div class="aud-card-cover aud-card-cover-fallback"><span>' + escapeHtml(it.title || 'Untitled') + '</span></div>';

    var dur = formatDuration(it.duration);
    var vas = vaNames(it);
    var desc = (it.description || '');
    if (desc.length > 140) desc = desc.slice(0, 137) + '…';

    a.innerHTML =
      coverHtml +
      (dur ? '<span class="aud-card-duration">' + dur + '</span>' : '') +
      '<div class="aud-card-body">' +
        '<div class="aud-card-title">' + escapeHtml(it.title || 'Untitled') + '</div>' +
        (vas.length ? '<div class="aud-card-va">Voiced by ' + escapeHtml(vas.join(', ')) + '</div>' : '') +
        (desc ? '<p class="aud-card-desc">' + escapeHtml(desc) + '</p>' : '') +
      '</div>';
    grid.appendChild(a);
  });
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Wiring ───────────────────────────────────────────────────────────────
document.getElementById('search-input').addEventListener('input', function(e) {
  state.search = e.target.value;
  applyFilters();
});
document.getElementById('search-clear-btn').addEventListener('click', function() {
  state.search = '';
  document.getElementById('search-input').value = '';
  state.tagStates = {};
  persistTagStates();
  renderTagFilters();
  applyFilters();
});
document.getElementById('filter-toggle-btn').addEventListener('click', function() {
  var panel = document.getElementById('filter-panel');
  panel.classList.toggle('open');
});
document.querySelectorAll('.search-mode-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var mode = btn.getAttribute('data-mode');
    state.searchModes[mode] = !state.searchModes[mode];
    btn.classList.toggle('active', state.searchModes[mode]);
    applyFilters();
  });
});
document.getElementById('sort-select').addEventListener('change', function(e) {
  state.sort = e.target.value;
  applyFilters();
});

init();
