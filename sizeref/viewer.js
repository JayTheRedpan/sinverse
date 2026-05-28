'use strict';

var item       = null;
var comicPage  = 0;

// -- Boot
async function init() {
  var params = new URLSearchParams(window.location.search);
  var id     = parseInt(params.get('id'), 10);
  if (!id) { window.location.href = 'index.html'; return; }

  try {
    var res = await fetch('./gallery.json');
    if (!res.ok) throw new Error('Could not load gallery.json');
    var items = await res.json();
    item = items.find(function(i) { return i.id === id; });
    if (!item) throw new Error('Item not found: ' + id);
    render();
  } catch(e) {
    document.body.innerHTML = '<div style="padding:4rem;text-align:center;color:var(--text-muted)">' + e.message + '</div>';
  }
}

function render() {
  document.title = item.title + ' — Sinverse Gallery';
  document.getElementById('viewer-title').textContent = item.title;

  if (item.type === 'comic')   renderComic();
  if (item.type === 'scene')   renderScene();
  if (item.type === 'charref') renderCharRef();
}

// -- Comic
function renderComic() {
  document.getElementById('view-comic').style.display = '';

  // Populate sidebar
  document.getElementById('comic-title-reader').textContent   = item.title;
  var caEl = document.getElementById('comic-artist-reader');
  if (caEl) caEl.innerHTML = item.artist ? 'by ' + '<a class="viewer-artist-link" href="../contributors/?creator=' + encodeURIComponent(item.artist) + '">' + item.artist + '</a>' : '';
  document.getElementById('comic-synopsis-reader').textContent = item.synopsis || '';
  if (item.canonical) document.getElementById('comic-canonical-reader').style.display = '';
  renderTags('comic-tags-reader', item.tags);
  renderCharacterLinks('comic-characters-reader', item.characters);

  // Start on page 0
  comicPage = 0;
  showPage(0);

  document.getElementById('comic-prev').addEventListener('click', function() { showPage(comicPage - 1); });
  document.getElementById('comic-next').addEventListener('click', function() { showPage(comicPage + 1); });

  // Keyboard navigation
  document.addEventListener('keydown', function(e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') showPage(comicPage + 1);
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   showPage(comicPage - 1);
  });
}

function showPage(n) {
  var pages = item.pages || [];
  comicPage = Math.max(0, Math.min(n, pages.length - 1));
  var img = document.getElementById('comic-page-img');
  img.src = pages[comicPage];
  document.getElementById('comic-page-counter').textContent = (comicPage + 1) + ' / ' + pages.length;
  document.getElementById('comic-prev').style.visibility = comicPage === 0 ? 'hidden' : '';
  document.getElementById('comic-next').style.visibility = comicPage === pages.length - 1 ? 'hidden' : '';
  // Scroll to top of image when page changes
  img.onload = function() {
    var wrap = document.getElementById('comic-page-wrap') || document.querySelector('.comic-page-wrap');
    if (wrap) wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  };
}

// -- Scene
function renderScene() {
  document.getElementById('view-scene').style.display = '';
  var typeBadge = document.getElementById('scene-type-badge');
  if (typeBadge) typeBadge.textContent = item.type === 'charref' ? 'Reference' : 'World Scene';

  var img = document.getElementById('scene-img');
  img.src = item.image || '';
  img.alt = item.title;

  document.getElementById('scene-title').textContent       = item.title;
  document.getElementById('scene-artist').textContent      = item.artist ? 'by ' + item.artist : '';
  document.getElementById('scene-description').textContent = item.description || '';

  if (item.canonical) document.getElementById('scene-canonical').style.display = '';

  renderTags('scene-tags', item.tags);
  renderCharacterLinks('scene-characters', item.characters);

  var dl = document.getElementById('scene-download');
  dl.href     = item.image || '#';
  dl.download = item.title.replace(/\s+/g, '_') + '.jpg';
}

// -- Character Reference
function renderCharRef() {
  document.getElementById('view-charref').style.display = '';

  var img = document.getElementById('ref-img');
  img.src = item.image || '';
  img.alt = item.title;

  document.getElementById('ref-title').textContent  = item.title;
  document.getElementById('ref-artist').textContent = item.artist ? 'by ' + item.artist : '';

  if (item.canonical) document.getElementById('ref-canonical').style.display = '';

  renderTags('ref-tags', item.tags);

  // Character wiki link
  if (item.characterId) {
    var charLink = document.getElementById('ref-char-link');
    var a = document.createElement('a');
    a.href      = '../wiki/#' + item.characterId;
    a.className = 'ref-wiki-link';
    a.textContent = 'View character wiki entry';
    charLink.appendChild(a);
  }

  // Height
  if (item.height) {
    document.getElementById('ref-height-block').style.display = '';
    document.getElementById('ref-height').textContent = item.height;
  }

  // Artist notes
  if (item.notes) {
    document.getElementById('ref-notes-block').style.display = '';
    document.getElementById('ref-notes').textContent = item.notes;
  }

  var dl = document.getElementById('ref-download');
  dl.href     = item.image || '#';
  dl.download = item.title.replace(/\s+/g, '_') + '_ref.jpg';
}

// -- Helpers
function renderTags(containerId, tags) {
  var el = document.getElementById(containerId);
  if (!el || !tags || !tags.length) return;
  tags.forEach(function(tag) {
    var span = document.createElement('span');
    span.className   = 'content-tag';
    span.textContent = tag;
    el.appendChild(span);
  });
}

function renderCharacterLinks(containerId, characters) {
  var el = document.getElementById(containerId);
  if (!el || !characters || !characters.length) return;
  var label = document.createElement('span');
  label.className   = 'viewer-chars-label';
  label.textContent = 'Characters: ';
  el.appendChild(label);
  characters.forEach(function(charId, i) {
    var a = document.createElement('a');
    a.href      = '../wiki/#' + charId;
    a.className = 'viewer-char-link';
    var displayName = charId.replace(/_/g, ' ');
    a.textContent = displayName.charAt(0).toUpperCase() + displayName.slice(1);
    a.href = '../wiki/?character=' + encodeURIComponent(displayName.toLowerCase());
    el.appendChild(a);
    if (i < characters.length - 1) el.appendChild(document.createTextNode(', '));
  });
}

init();
