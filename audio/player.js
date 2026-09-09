/* ===============================================
   Sinverse — Audio player page
   audio/player.js

   Full-page, deliberate listening (audiobook-style — no persistent
   cross-page player). Native <audio controls> with preload="none" so the
   file is only fetched when playback starts. Characters link to the wiki
   only when they resolve to a real entry (canon or active fan); the
   transcript, when present, starts collapsed and is fetched on first
   expand.
   =============================================== */

'use strict';

var CONTRIBUTORS = {};

// ── Character roster: known-character checks + portrait fallbacks ────────
var _roster = {};             // lowercased name/wiki -> { profile_image }
var _inactiveFanKeys = {};
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
    (res[1] || []).forEach(function(c) {
      if (c && c.active === false) {
        if (c.name) _inactiveFanKeys[String(c.name).toLowerCase()] = true;
        if (c.wiki) _inactiveFanKeys[String(c.wiki).toLowerCase()] = true;
      } else { add(c); }
    });
    _rosterLoaded = true;
  }).catch(function(){ _rosterLoaded = false; });
}

function charKey(tag) {
  var m = String(tag).match(/^\s*(canon|fan)\s*:\s*(.+)$/i);
  return (m ? m[2] : String(tag)).replace(/_/g, ' ').trim().toLowerCase();
}
function charPrefix(tag) {
  var m = String(tag).match(/^\s*(canon|fan)\s*:\s*(.+)$/i);
  return m ? (m[1].toLowerCase() + ':') : '';
}
function isInactiveFanTag(tag) {
  if (charPrefix(tag) === 'canon:') return false;
  var key = charKey(tag);
  return !!_inactiveFanKeys[key] || !!_inactiveFanKeys[key.replace(/\s+/g, '-')];
}
function isKnownCharacter(tag) {
  if (!_rosterLoaded) return true;   // roster unavailable → link rather than blank everything
  var key = charKey(tag);
  return !!(_roster[key] || _roster[key.replace(/\s+/g, '-')]);
}
function charDisplayName(tag) {
  var key = charKey(tag);
  return key.charAt(0).toUpperCase() + key.slice(1);
}

// ── Small helpers ────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
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
function formatPostedDate(d) {
  if (!d) return '';
  var parts = String(d).split('-');
  var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  if (parts.length >= 2) {
    var m = parseInt(parts[1], 10);
    if (m >= 1 && m <= 12) return MONTHS[m - 1] + ' ' + parts[0];
  }
  return d;
}
function thumbUrl(url, w) {
  if (!url) return null;
  return (window.SinverseImg && SinverseImg.thumb) ? SinverseImg.thumb(url, w || 800) : url;
}
// voice_actors[] is the headline credit; credits[] is the rest of the crew as
// { id, role }. The legacy `contributor` array is treated as voice_actors.
function voiceActors(item) {
  if (Array.isArray(item.voice_actors)) return item.voice_actors;
  var c = item.contributor;
  if (!c) return [];
  return Array.isArray(c) ? c : [c];
}
function creditsList(item) {
  return Array.isArray(item.credits) ? item.credits : [];
}
function contributorLink(id) {
  var rec = CONTRIBUTORS[id];
  var name = rec ? rec.name : id;
  return '<a class="player-va-link" href="../contributors/?creator=' + encodeURIComponent(id) + '">' + escapeHtml(name) + '</a>';
}
function vaLinksHtml(item) {
  var list = voiceActors(item);
  if (!list.length) return '';
  return list.map(contributorLink).join(', ');
}
// One meta row per role, e.g. "Foley — <links>", preserving data order.
function creditsRowsHtml(item) {
  var order = [], groups = {};
  creditsList(item).forEach(function(cr) {
    if (!cr || !cr.id) return;
    var role = cr.role || 'Credit';
    if (!groups[role]) { groups[role] = []; order.push(role); }
    groups[role].push(cr.id);
  });
  return order.map(function(role) {
    return '<div class="player-meta-row"><span class="player-meta-label">' + escapeHtml(role) + '</span>' +
           '<span class="player-meta-val">' + groups[role].map(contributorLink).join(', ') + '</span></div>';
  }).join('');
}

function coverFor(it) {
  if (it.cover) return thumbUrl(it.cover, 800);
  var chars = it.characters || [];
  for (var i = 0; i < chars.length; i++) {
    var key = charKey(chars[i]);
    var rec = _roster[key] || _roster[key.replace(/\s+/g, '-')];
    if (rec && rec.profile_image) return thumbUrl(rec.profile_image, 800);
  }
  return null;
}

// ── Render ───────────────────────────────────────────────────────────────
function render(item) {
  document.title = (item.title || 'Audio') + ' — Sinverse';

  var main = document.getElementById('player-main');

  var cover = coverFor(item);
  var dur = formatDuration(item.duration);

  var html = '';
  html += '<div class="player-head">';
  if (cover) html += '<div class="player-cover"><img src="' + cover + '" alt="" /></div>';
  html += '<div class="player-headings">';
  html += '<h1 class="player-title">' + escapeHtml(item.title || 'Untitled') + '</h1>';
  var vaHtml = vaLinksHtml(item);
  if (vaHtml) html += '<div class="player-va">Voiced by ' + vaHtml + '</div>';
  if (dur) html += '<div class="player-duration">' + dur + '</div>';
  html += '</div></div>';

  // The player itself. preload="none": nothing downloads until play is
  // pressed, so browsing costs no audio bandwidth.
  html += '<audio class="player-audio" controls preload="none" src="' + escapeHtml(item.audio || '') + '"></audio>';

  if (item.description) {
    html += '<div class="player-desc">' + escapeHtml(item.description) + '</div>';
  }

  // Meta rows
  html += '<div class="player-meta">';
  var charRow = charactersHtml(item.characters);
  if (charRow) html += '<div class="player-meta-row"><span class="player-meta-label">Characters</span><span class="player-meta-val">' + charRow + '</span></div>';
  html += creditsRowsHtml(item);
  if (item.date) html += '<div class="player-meta-row"><span class="player-meta-label">Posted</span><span class="player-meta-val">' + formatPostedDate(item.date) + '</span></div>';
  if (item.universe_date !== undefined && item.universe_date !== null && item.universe_date !== '' && window.SinverseDates) {
    var eraHtml = SinverseDates.labelHtml ? SinverseDates.labelHtml(item.universe_date, '../wiki/') : SinverseDates.label(item.universe_date);
    html += '<div class="player-meta-row"><span class="player-meta-label">Set</span><span class="player-meta-val">' + eraHtml + '</span></div>';
  }
  if (item.tags && item.tags.length) {
    html += '<div class="player-meta-row"><span class="player-meta-label">Tags</span><span class="player-meta-val">' +
      item.tags.map(function(t){ return '<span class="player-tag">' + escapeHtml(t) + '</span>'; }).join(' ') + '</span></div>';
  }
  html += '</div>';

  // Transcript — collapsed by default; fetched on first expand.
  if (item.transcript) {
    html += '<div class="player-transcript">';
    html += '<button id="transcript-toggle" class="transcript-toggle" aria-expanded="false">Show transcript ▾</button>';
    html += '<div id="transcript-body" class="transcript-body" style="display:none"></div>';
    html += '</div>';
  }

  main.innerHTML = html;

  if (item.transcript) wireTranscript(item.transcript);
}

function charactersHtml(characters) {
  var list = (characters || []).filter(function(c){ return !isInactiveFanTag(c); });
  if (!list.length) return '';
  return list.map(function(tag) {
    var name = charDisplayName(tag);
    if (isKnownCharacter(tag)) {
      var pfx = charPrefix(tag);
      var key = charKey(tag);
      return '<a class="player-char-link" href="../wiki/?character=' + encodeURIComponent(pfx + key) + '">' + escapeHtml(name) + '</a>';
    }
    return '<span class="player-char-plain" title="No wiki entry yet">' + escapeHtml(name) + '</span>';
  }).join(', ');
}

function wireTranscript(path) {
  var btn = document.getElementById('transcript-toggle');
  var body = document.getElementById('transcript-body');
  var loaded = false;
  btn.addEventListener('click', function() {
    var open = body.style.display !== 'none';
    if (open) {
      body.style.display = 'none';
      btn.textContent = 'Show transcript ▾';
      btn.setAttribute('aria-expanded', 'false');
      return;
    }
    body.style.display = 'block';
    btn.textContent = 'Hide transcript ▴';
    btn.setAttribute('aria-expanded', 'true');
    if (loaded) return;
    loaded = true;
    body.innerHTML = '<div class="loading-placeholder">Loading transcript…</div>';
    fetch(path).then(function(r) {
      if (!r.ok) throw new Error(r.status);
      return r.text();
    }).then(function(md) {
      body.innerHTML = (window.marked && marked.parse)
        ? marked.parse(md)
        : '<pre class="transcript-pre">' + escapeHtml(md) + '</pre>';
    }).catch(function() {
      body.innerHTML = '<div class="loading-placeholder">Transcript unavailable.</div>';
    });
  });
}

// ── Init ─────────────────────────────────────────────────────────────────
function init() {
  var id = new URLSearchParams(window.location.search).get('id');
  var itemsP = fetch('audio.json').then(function(r){ return r.ok ? r.json() : []; });
  var contribP = fetch('../contributors/contributors.json')
    .then(function(r){ return r.ok ? r.json() : []; }).catch(function(){ return []; });
  var datesP = (window.SinverseDates && SinverseDates.load)
    ? SinverseDates.load('../wiki/eras.json').catch(function(){})
    : Promise.resolve();

  Promise.all([itemsP, contribP, loadRoster(), datesP]).then(function(res) {
    (res[1] || []).forEach(function(c){ if (c && c.id) CONTRIBUTORS[c.id] = c; });
    var all = res[0] || [];
    var item = all.find(function(it){ return String(it.id) === String(id); });
    if (!item || item.active === false) {
      document.getElementById('player-main').innerHTML =
        '<div class="loading-placeholder">That audio work wasn\'t found. <a href="./">Back to Audio</a></div>';
      return;
    }
    render(item);
  }).catch(function(err) {
    console.error('[audio player] failed to load', err);
    document.getElementById('player-main').innerHTML =
      '<div class="loading-placeholder">Could not load this work.</div>';
  });
}

init();
