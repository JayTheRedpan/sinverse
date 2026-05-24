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
  document.getElementById('reader-author').textContent       = story.author ? 'by ' + story.author : '';
  document.getElementById('reader-summary').textContent      = story.summary || '';

  // Cover
  if (story.coverImage) {
    var cover = document.getElementById('reader-cover');
    cover.src   = story.coverImage;
    cover.style.display = '';
  }

  // Tags
  var tagsEl = document.getElementById('reader-tags');
  (story.tags || []).forEach(function(tag) {
    var span = document.createElement('span');
    span.className   = 'content-tag';
    span.textContent = tag;
    tagsEl.appendChild(span);
  });

  // Word count
  var wc = document.getElementById('reader-wordcount');
  var totalWc = story.wordCount || (story.chapters || []).reduce(function(s, c) { return s + (c.wordCount || 0); }, 0);
  if (totalWc) wc.textContent = fmtWords(totalWc);
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

  // Update chapter word count
  var wc = document.getElementById('reader-wordcount');
  if (chapters[idx].wordCount) wc.textContent = fmtWords(chapters[idx].wordCount) + ' this chapter';

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
    var html = await res.text();
    // Strip any full HTML wrapper if present, keep just body content
    var match = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    content.innerHTML = match ? match[1] : html;
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