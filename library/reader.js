'use strict';

var story       = null;
var chapterIdx  = 0;

async function init() {
  var params = new URLSearchParams(window.location.search);
  var id     = parseInt(params.get('id'), 10);
  var ch     = parseInt(params.get('chapter') || '0', 10);

  if (!id) { window.location.href = 'index.html'; return; }

  try {
    var res = await fetch('./library.json');
    if (!res.ok) throw new Error('Could not load library.json');
    var items = await res.json();
    story = items.find(function(i) { return i.id === id; });
    if (!story) throw new Error('Story not found');
    chapterIdx = ch;
    if (window.SinverseDates) await SinverseDates.load('../wiki/eras.json');
    renderMeta();
    if (story.type === 'serial') {
      renderChapterList();
      loadChapter(chapterIdx);
    } else {
      loadStory();
    }
    initProgress();
  } catch(e) {
    document.getElementById('reader-content').innerHTML =
      '<p style="color:var(--wine);padding:2rem">' + e.message + '</p>';
  }
}

function renderMeta() {
  document.title = story.title + ' — Sinverse Library';
  document.getElementById('reader-topbar-title').textContent = story.title;
  document.getElementById('reader-title').textContent        = story.title;
  var raEl = document.getElementById('reader-author');
  if (raEl) raEl.innerHTML = story.author ? 'by <a class="viewer-artist-link" href="../contributors/?creator=' + encodeURIComponent(story.author) + '">' + story.author + '</a>' : '';
  document.getElementById('reader-summary').textContent      = story.summary || '';
  var canonEl = document.getElementById('reader-canonical');
  if (canonEl) canonEl.style.display = story.canonical ? '' : 'none';

  // Tags
  var tagsEl = document.getElementById('reader-tags');
  (story.tags || []).forEach(function(tag) {
    var span = document.createElement('span');
    span.className   = 'content-tag';
    span.textContent = tag;
    tagsEl.appendChild(span);
  });

  // Posted + in-universe dates
  var datesEl = document.getElementById('reader-dates');
  if (datesEl) {
    var rows = '';
    if (story.date) {
      rows += '<div class="reader-date-row"><span class="reader-date-label">Posted</span><span class="reader-date-val">' + formatPostedDate(story.date) + '</span></div>';
    }
    if (story.universe_date !== null && story.universe_date !== undefined && window.SinverseDates) {
      rows += '<div class="reader-date-row"><span class="reader-date-label">Set</span><span class="reader-date-val">' + SinverseDates.label(story.universe_date) + '</span></div>';
    }
    datesEl.innerHTML = rows;
  }

  // Word count shown after content loads (see loadContent/loadChapter)
}

// Format a "2025-05" style posted date into "May 2025"
function formatPostedDate(s) {
  if (!s) return '';
  var parts = String(s).split('-');
  var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  if (parts.length >= 2) {
    var m = parseInt(parts[1], 10);
    if (m >= 1 && m <= 12) return months[m-1] + ' ' + parts[0];
  }
  return s;
}

function renderChapterList() {
  var wrap = document.getElementById('reader-chapters');
  var list = document.getElementById('reader-chapter-list');
  wrap.style.display = '';
  list.innerHTML = '';

  (story.chapters || []).forEach(function(ch, i) {
    var btn = document.createElement('button');
    btn.className   = 'chapter-list-btn' + (i === chapterIdx ? ' active' : '');
    btn.textContent = ch.title;
    btn.dataset.idx = i;
    btn.addEventListener('click', function() { loadChapter(i); });
    list.appendChild(btn);
  });
}

async function loadStory() {
  if (!story.file) {
    renderExternalLink();
    return;
  }
  await loadFile(story.file);
  document.getElementById('reader-end').style.display = '';
}

async function loadChapter(idx) {
  var chapters = story.chapters || [];
  if (!chapters[idx]) return;
  chapterIdx = idx;

  // Update chapter list highlight
  document.querySelectorAll('.chapter-list-btn').forEach(function(b) {
    b.classList.toggle('active', parseInt(b.dataset.idx) === idx);
  });

  // Update chapter header
  var header = document.getElementById('reader-chapter-header');
  header.style.display = '';
  document.getElementById('reader-chapter-title').textContent = chapters[idx].title;



  // Load content
  if (chapters[idx].file) {
    await loadFile(chapters[idx].file);
  } else if (chapters[idx].externalUrl) {
    renderExternalLink(chapters[idx].externalUrl);
  }

  // Chapter nav
  var nav = document.getElementById('reader-chapter-nav');
  nav.style.display = '';
  document.getElementById('chapter-counter').textContent = (idx + 1) + ' of ' + chapters.length;
  document.getElementById('prev-chapter').disabled = idx === 0;
  document.getElementById('next-chapter').disabled = idx === chapters.length - 1;

  // Show end on last chapter
  document.getElementById('reader-end').style.display = idx === chapters.length - 1 ? '' : 'none';

  window.scrollTo(0, 0);
}

async function loadFile(filePath) {
  var content = document.getElementById('reader-content');
  content.innerHTML = '<div class="loading-placeholder">Loading...</div>';
  try {
    var res = await fetch(filePath);
    if (!res.ok) throw new Error('Could not load ' + filePath);
    var raw = await res.text();
    var bodyHtml;
    if (filePath.endsWith('.md')) {
      // Render markdown — marked.js must be loaded in reader.html
      bodyHtml = typeof marked !== 'undefined' ? marked.parse(raw) : raw.replace(/\n\n/g, '</p><p>').replace(/^/, '<p>') + '</p>';
    } else {
      // Legacy HTML files — strip wrapper if present
      var match = raw.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      bodyHtml = match ? match[1] : raw;
    }
    content.innerHTML = bodyHtml;
    // Word count comes from library.json (not recalculated)
    var wcEl = document.getElementById('reader-wordcount');
    var wc;
    if (story.type === 'serial') {
      var chap = (story.chapters || [])[chapterIdx];
      wc = chap ? chap.wordCount : null;
    } else {
      wc = story.wordCount;
    }
    if (wcEl && wc != null) {
      wcEl.textContent = fmtWords(wc) + (story.type === 'serial' ? ' this chapter' : ' words');
    } else if (wcEl) {
      wcEl.textContent = '';
    }
  } catch(e) {
    content.innerHTML = '<p style="color:var(--wine);padding:2rem">Could not load story file: ' + e.message + '</p>';
  }
}

function renderExternalLink(url) {
  var link = url || story.externalUrl;
  document.getElementById('reader-content').innerHTML =
    '<div class="external-story-wrap">' +
      '<p class="external-story-note">This story is hosted externally.</p>' +
      '<a href="' + link + '" target="_blank" rel="noopener noreferrer" class="btn-primary">Read on external site &#8599;</a>' +
    '</div>';
}

// -- Reading progress bar
function initProgress() {
  var wrap = document.getElementById('reader-progress-wrap');
  wrap.style.display = '';
  window.addEventListener('scroll', updateProgress);
  updateProgress();
}

function updateProgress() {
  var scrollTop    = window.scrollY;
  var docHeight    = document.documentElement.scrollHeight - window.innerHeight;
  var pct          = docHeight > 0 ? Math.round((scrollTop / docHeight) * 100) : 0;
  document.getElementById('reader-progress-fill').style.width = pct + '%';
  document.getElementById('reader-progress-pct').textContent  = pct + '%';
}

// -- Chapter nav buttons
document.getElementById('prev-chapter').addEventListener('click', function() {
  if (chapterIdx > 0) loadChapter(chapterIdx - 1);
});
document.getElementById('next-chapter').addEventListener('click', function() {
  var chapters = story ? story.chapters || [] : [];
  if (chapterIdx < chapters.length - 1) loadChapter(chapterIdx + 1);
});

// -- Keyboard chapter navigation
document.addEventListener('keydown', function(e) {
  if (!story || story.type !== 'serial') return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  var chapters = story.chapters || [];
  if (e.key === 'ArrowRight' && chapterIdx < chapters.length - 1) loadChapter(chapterIdx + 1);
  if (e.key === 'ArrowLeft'  && chapterIdx > 0)                   loadChapter(chapterIdx - 1);
});

// -- Helpers
function fmtWords(n) {
  if (!n) return '';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k words';
  return n + ' words';
}

init();
