'use strict';
/* ===============================================
   Sinverse -- Interactive Fiction
   app.js
   =============================================== */

'use strict';

// -- Config --------------------------------------
const CONFIG = {
  discordHandle: 'jaytheredpan',
};


// -- State ---------------------------------------
const state = {
  deadEndActive: false,  // true when showing a dead end screen
  activeTag:     null,   // currently selected tag filter
  manifest:  [],
  story:     null,
  storyId:   null,
  storyMeta: null,
  nodeMap:   {},
  currentId: null,
  history:   [],
  inventory: new Set(),
};

// -- DOM refs ------------------------------------
const $ = id => document.getElementById(id);
const searchInput           = $('search-input');
const tagFilters            = $('tag-filters');
const screenLibrary         = $('screen-library');
const screenGame            = $('screen-game');
const screenAuthor          = $('screen-author');
const storyGrid             = $('adventure-grid');
const sceneBlurb            = $('scene-blurb');
const sceneImage            = $('scene-image');
const sceneImagePlaceholder = $('scene-image-placeholder');
const choicesWrap           = $('choices-wrap');
const endingWrap            = $('ending-wrap');
const deadEndWrap           = $('dead-end-wrap');
const deadEndContact        = $('dead-end-contact');
const breadcrumbList        = $('breadcrumb-list');
const btnBackLibrary        = $('btn-back-library');
const btnBackNode           = $('btn-back-node');
const btnRestart            = $('btn-restart');
const btnPlayAgain          = $('btn-play-again');
const btnLibraryFromEnd     = $('btn-library-from-end');
const gameStoryTitle        = $('game-story-title');
const cyoaTopbarTitle       = $('cyoa-topbar-title');
const modalOverlay          = $('modal-overlay');
const modalMessage          = $('modal-message');
const modalConfirm          = $('modal-confirm');
const modalCancel           = $('modal-cancel');
const toastEl               = $('toast');
const sceneByline           = $('scene-byline');
const sceneAuthorEl         = $('scene-author');

// -- Boot ----------------------------------------

// -- Reading controls (font size + line spacing) ---------------
// Shares the same localStorage key as the library reader so a reader's
// preference carries across the whole site.
var READER_PREFS_KEY = 'sinverse_reader_prefs';
var FONT_MIN = 16, FONT_MAX = 28, FONT_DEFAULT = 20, FONT_STEP = 1;
var LH_MIN = 1.4, LH_MAX = 2.6, LH_DEFAULT = 1.9, LH_STEP = 0.15;
var readerPrefs = { font: FONT_DEFAULT, lh: LH_DEFAULT };

function loadReaderPrefs() {
  try {
    var saved = JSON.parse(localStorage.getItem(READER_PREFS_KEY));
    if (saved && typeof saved.font === 'number' && typeof saved.lh === 'number') {
      readerPrefs.font = Math.min(FONT_MAX, Math.max(FONT_MIN, saved.font));
      readerPrefs.lh   = Math.min(LH_MAX, Math.max(LH_MIN, saved.lh));
    }
  } catch (e) {}
}

function saveReaderPrefs() {
  try { localStorage.setItem(READER_PREFS_KEY, JSON.stringify(readerPrefs)); } catch (e) {}
}

function applyReaderPrefs() {
  var blurb = document.getElementById('scene-blurb');
  if (blurb) {
    blurb.style.setProperty('--reader-font-size', readerPrefs.font + 'px');
    blurb.style.setProperty('--reader-line-height', String(readerPrefs.lh));
  }
  var fDec = document.getElementById('cyoa-font-dec');
  var fInc = document.getElementById('cyoa-font-inc');
  var lDec = document.getElementById('cyoa-lh-dec');
  var lInc = document.getElementById('cyoa-lh-inc');
  if (fDec) fDec.disabled = readerPrefs.font <= FONT_MIN;
  if (fInc) fInc.disabled = readerPrefs.font >= FONT_MAX;
  if (lDec) lDec.disabled = readerPrefs.lh <= LH_MIN + 0.001;
  if (lInc) lInc.disabled = readerPrefs.lh >= LH_MAX - 0.001;
}

function initReadingControls() {
  loadReaderPrefs();
  applyReaderPrefs();

  function bump(kind, dir) {
    if (kind === 'font') {
      readerPrefs.font = Math.min(FONT_MAX, Math.max(FONT_MIN, readerPrefs.font + dir * FONT_STEP));
    } else {
      readerPrefs.lh = Math.min(LH_MAX, Math.max(LH_MIN, Math.round((readerPrefs.lh + dir * LH_STEP) * 100) / 100));
    }
    applyReaderPrefs();
    saveReaderPrefs();
  }

  var map = [
    ['cyoa-font-dec', 'font', -1], ['cyoa-font-inc', 'font', 1],
    ['cyoa-lh-dec', 'lh', -1],     ['cyoa-lh-inc', 'lh', 1]
  ];
  map.forEach(function(m) {
    var btn = document.getElementById(m[0]);
    if (btn) btn.addEventListener('click', function() { bump(m[1], m[2]); });
  });
}

async function init() {
  // Age gate is on the landing page -- go straight to library
  initReadingControls();
  loadLibrary();
}

// -- Library -------------------------------------
async function loadLibrary() {
  try {
    // Use absolute path from current page location to avoid root ambiguity
    const base = window.location.pathname.replace(/\/[^/]*$/, '/');
    const res = await fetch(base + 'cyoa.json');
    if (!res.ok) throw new Error('Could not load cyoa.json (status ' + res.status + ') at ' + res.url);
    state.manifest = await res.json();
    await Promise.all(state.manifest.map(fetchNodeCount));
    renderLibrary();

    // Restore adventure from URL if navigating back from another page
    if (window._pendingAuthor) {
      const authorId = window._pendingAuthor;
      const advId    = window._pendingAdventure;
      const nodeId   = window._pendingNode;
      window._pendingAuthor    = null;
      window._pendingAdventure = null;
      window._pendingNode      = null;
      // Restore adventure state silently if needed, then show author screen
      if (advId) {
        try {
          await loadAdventure(advId);
          if (nodeId && state.nodeMap[nodeId] && String(nodeId) !== String(state.currentId)) {
            goToNode(nodeId, false);
          }
        } catch(e) {}
      } else {
        showScreen('library');
      }
      showAuthorScreen(authorId);
    } else if (window._pendingAdventure) {
      const advId = window._pendingAdventure;
      const nodeId = window._pendingNode;
      window._pendingAdventure = null;
      window._pendingNode = null;
      try {
        await loadAdventure(advId);
        if (nodeId && state.nodeMap[nodeId] && String(nodeId) !== String(state.currentId)) {
          goToNode(nodeId, false);
        }
      } catch(e) { showScreen('library'); }
    } else {
      showScreen('library');
    }
  } catch (err) {
    storyGrid.innerHTML = `<div class="loading-placeholder" style="color:#a04040">
      Failed to load adventure library.<br><small>${err.message}</small>
    </div>`;
  }
}

async function fetchNodeCount(meta) {
  try {
    const base = window.location.pathname.replace(/\/[^/]*$/, '/');
    const res = await fetch(base + `adventures/${meta.id}.json`);
    if (!res.ok) return;
    const data = await res.json();
    meta.nodeCount = Array.isArray(data) ? data.length : null;
    // Derive display tags from the first node (id 1, or first in array)
    if (Array.isArray(data) && data.length) {
      const first = data.find(n => n.id === 1) || data[0];
      meta.tags = (first && first.tags) ? first.tags : [];
    }
  } catch (_) {
    meta.nodeCount = null;
    meta.tags = [];
  }
}

function renderLibrary() {
  storyGrid.innerHTML  = '';
  state.activeTag      = null;
  if (searchInput) searchInput.value = '';
  if (!state.manifest.length) {
    storyGrid.innerHTML = '<div class="loading-placeholder">No adventures found.</div>';
    return;
  }

  state.manifest.forEach(meta => {
    const coverSrc   = meta.coverImage || '';
    const countLabel = meta.nodeCount != null ?
        `${meta.nodeCount} scene${meta.nodeCount !== 1 ? 's' : ''}`
      : null;

    const card = document.createElement('article');
    card.className = 'adventure-card';
    card.tabIndex  = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Read ${meta.title}`);

    card.innerHTML = `
      <div class="card-cover-placeholder" id="cp-${meta.id}">*</div>
      <img class="card-cover" id="ci-${meta.id}" src="${coverSrc}"
           alt="${meta.title} cover" style="opacity:0;position:absolute;" />
      <div class="card-tags">
        ${(meta.tags && meta.tags.length) ? `<span class="card-tags-label">Opening scene:</span>` : ''}
        ${(meta.tags || []).map(t => `<span class="tag">${t}</span>`).join('')}
        ${countLabel ? `<span class="tag tag-length">${countLabel}</span>` : ''}
      </div>
      <h2 class="card-title">${meta.title}</h2>
      <p class="card-description">${meta.description || ''}</p>
      <div class="card-footer">
        <span class="card-cta">Read  </span>
        <button class="card-map-btn" aria-label="Story map" title="Story map"><svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="3" cy="8" r="1.8"/><circle cx="12.5" cy="3.5" r="1.8"/><circle cx="12.5" cy="12.5" r="1.8"/><path d="M4.6 7 11 4.2M4.6 9 11 11.8"/></svg></button>
        <button class="card-info-btn" aria-label="Adventure info" title="Adventure info">&#9432;</button>
      </div>
    `;

    const img  = card.querySelector(`#ci-${meta.id}`);
    const ph   = card.querySelector(`#cp-${meta.id}`);
    img.onload  = () => {
      img.style.opacity = '1';
      img.style.position = '';
      ph.style.display = 'none';
    };
    img.onerror = () => {
      img.style.display = 'none';
      ph.style.display = '';
    };

    const go = () => loadAdventure(meta.id);
    card.addEventListener('click', go);
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });

    card.querySelector('.card-info-btn').addEventListener('click', function(e) {
      e.stopPropagation();
      showAdventureInfo(meta);
    });

    card.querySelector('.card-map-btn').addEventListener('click', function(e) {
      e.stopPropagation();
      openStoryMapForAdventure(meta.id);
    });

    storyGrid.appendChild(card);
  });

  // New story card
  const newCard = document.createElement('article');
  newCard.className = 'adventure-card new-adventure-card';
  newCard.innerHTML = `
    <div class="new-story-glyph">*</div>
    <h2 class="card-title new-story-title">Start Something New</h2>
    <p class="card-description">Have an adventure idea set in the Sinverse universe? Pitch a new adventure and become a founding author of a fresh branch.</p>
    <div class="card-footer">
      <span></span>
      <span class="card-cta">Submit an idea  </span>
    </div>
  `;
  newCard.addEventListener('click', () => { window.location.href = 'new-story.html'; });
  newCard.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.location.href = 'new-story.html'; }
  });
  newCard.tabIndex = 0;
  newCard.setAttribute('role', 'button');
  newCard.setAttribute('aria-label', 'Submit a new adventure idea');
  storyGrid.appendChild(newCard);

  // Build tag filters and wire search input
  buildTagFilters();
  if (searchInput) {
    searchInput.oninput = applyFilters;
  }
}

// -- Search & Filter -----------------------------
function buildTagFilters() {
  // Collect all unique tags across all stories
  const tagSet = new Set();
  state.manifest.forEach(m => (m.tags || []).forEach(t => tagSet.add(t)));
  tagFilters.innerHTML = '';

  // All button
  const allBtn = document.createElement('button');
  allBtn.className = 'tag-filter-btn' + (state.activeTag === null ? ' active' : '');
  allBtn.textContent = 'All';
  allBtn.addEventListener('click', () => { state.activeTag = null; applyFilters(); });
  tagFilters.appendChild(allBtn);

  tagSet.forEach(tag => {
    const btn = document.createElement('button');
    btn.className = 'tag-filter-btn' + (state.activeTag === tag ? ' active' : '');
    btn.textContent = tag;
    btn.addEventListener('click', () => {
      state.activeTag = state.activeTag === tag ? null : tag;
      applyFilters();
    });
    tagFilters.appendChild(btn);
  });
}

function applyFilters() {
  const query      = searchInput.value.trim().toLowerCase();
  const activeTag  = state.activeTag;
  const cards      = storyGrid.querySelectorAll('.adventure-card:not(.new-adventure-card)');
  let anyVisible = false;

  // Update tag button active states
  tagFilters.querySelectorAll('.tag-filter-btn').forEach(btn => {
    btn.classList.toggle('active',
      btn.textContent === 'All' ? activeTag === null : btn.textContent === activeTag
    );
  });

  cards.forEach((card, i) => {
    const meta      = state.manifest[i];
    const matchText = !query || meta.title.toLowerCase().includes(query);
    const matchTag  = !activeTag || (meta.tags || []).includes(activeTag);
    card.style.display = (matchText && matchTag) ? '' : 'none';
  });

  // Show empty state if nothing matches
  const existing = storyGrid.querySelector('.no-results');
  anyVisible = [...cards].some(c => c.style.display !== 'none');
  if (!anyVisible && !existing) {
    const msg = document.createElement('div');
    msg.className   = 'no-results loading-placeholder';
    msg.textContent = 'No adventures match your search.';
    storyGrid.appendChild(msg);
  } else if (anyVisible && existing) {
    existing.remove();
  }
}

// -- Fetch adventure nodes with blurbs injected from .md --
async function fetchAdventureNodes(id) {
  const base = window.location.pathname.replace(/\/[^/]*$/, '/');
  const res = await fetch(base + `adventures/${id}.json`);
  if (!res.ok) return [];
  const data = await res.json();
  const mdRes = await fetch(base + `adventures/${id}.md`);
  if (mdRes.ok) {
    const blurbs = parseMdBlurbs(await mdRes.text());
    data.forEach(n => { if (!n.blurb && blurbs[String(n.id)]) n.blurb = blurbs[String(n.id)]; });
  }
  return data;
}

// -- Markdown blurb parser -------------------------
function parseMdBlurbs(md) {
  const map = {};
  const sections = md.split(/^## /m);
  sections.forEach(section => {
    const nl = section.indexOf('\n');
    if (nl < 0) return;
    const id = section.slice(0, nl).trim();
    const text = section.slice(nl + 1).trim();
    if (id) map[id] = text;
  });
  return map;
}

// -- Load Story ----------------------------------
// Load adventure data into state WITHOUT touching browser history or the path
// trail. Safe to call when starting fresh or when restoring via popstate.
// Returns true on success. Skips the fetch if the adventure is already loaded.
async function ensureAdventureLoaded(id) {
  if (state.storyId === id && state.nodeMap && Object.keys(state.nodeMap).length) {
    return true; // already loaded
  }
  const base = window.location.pathname.replace(/\/[^/]*$/, '/');
  const res = await fetch(base + `adventures/${id}.json`);
  if (!res.ok) throw new Error(`Could not load adventures/${id}.json (status ${res.status}) at ${res.url}`);
  const data = await res.json();

  const mdRes = await fetch(base + `adventures/${id}.md`);
  if (mdRes.ok) {
    const blurbs = parseMdBlurbs(await mdRes.text());
    data.forEach(n => { if (!n.blurb && blurbs[String(n.id)]) n.blurb = blurbs[String(n.id)]; });
  }

  state.story     = data;
  state.storyId   = id;
  state.storyMeta = state.manifest.find(m => m.id === id) || {};
  state.nodeMap   = {};
  data.forEach(n => { state.nodeMap[n.id] = n; });

  const title = state.storyMeta.title || id;
  gameStoryTitle.textContent = title;
  if (cyoaTopbarTitle) cyoaTopbarTitle.textContent = title;
  return true;
}

async function loadAdventure(id) {
  try {
    await ensureAdventureLoaded(id);
    // Fresh start: reset path state
    state.currentId     = null;
    state.history       = [];
    state.inventory     = new Set();
    state.deadEndActive = false;
    showScreen('game');
    // Clear stale browser history from previous adventures by replacing
    // the current entry before goToNode adds a new one
    history.replaceState({ screen: 'library' }, '', window.location.pathname);
    goToNode(1);
  } catch (err) {
    showToast(`Error loading adventure: ${err.message}`, 4000);
  }
}

// -- Navigation ----------------------------------
function goToNode(id, silent = false) {
  const node = state.nodeMap[id];
  if (!node) { showToast(`Missing node: "${id}"`, 3000); return; }
  state.deadEndActive = false;
  if (!silent && state.currentId && state.currentId !== id) state.history.push(state.currentId);
  state.currentId = id;
  updateImage(node);
  updateBreadcrumbs();
  renderSceneTitle(node.title || '');
  renderBlurb(node.blurb, node.author);
  renderChoices(node);
  // Push browser state (unless restoring from popstate). Each entry carries a
  // snapshot of the path trail so back/forward can restore state exactly.
  if (!silent) {
    history.pushState(
      { screen: 'game', adventure: state.storyId, node: id, trail: state.history.slice() },
      '',
      '?adventure=' + encodeURIComponent(state.storyId) + '&node=' + encodeURIComponent(id)
    );
  }
  const main = document.querySelector('.game-main');
  if (main && main.scrollHeight > main.clientHeight && getComputedStyle(main).overflowY !== 'visible') {
    main.scrollTop = 0;
  } else {
    window.scrollTo(0, 0);
  }
}

function goBack() {
  if (state.deadEndActive) {
    // On dead end screen: just clear flag, no history was pushed
    state.deadEndActive = false;
    updateBreadcrumbs();
    deadEndWrap.style.display = 'none';
    const node = state.nodeMap[state.currentId];
    if (!node) return;
      updateImage(node);
    renderSceneTitle(node.title || '');
  renderBlurb(node.blurb, node.author);
    renderChoices(node);
    const main = document.querySelector('.game-main');
    if (main) main.scrollTop = 0;
    return;
  }
  if (!state.history.length) return;
  const prevId = state.history.pop();
  const node   = state.nodeMap[prevId];
  if (!node) return;
  state.currentId = prevId;
  updateImage(node);
  updateBreadcrumbs();
  renderSceneTitle(node.title || '');
  renderBlurb(node.blurb, node.author);
  renderChoices(node);
  const main = document.querySelector('.game-main');
  if (main && main.scrollHeight > main.clientHeight && getComputedStyle(main).overflowY !== 'visible') {
    main.scrollTop = 0;
  } else {
    window.scrollTo(0, 0);
  }
}

// -- Render --------------------------------------
function renderSceneTitle(title) {
  var el = $('scene-title');
  if (!el) return;
  el.textContent = title || '';
  el.style.display = title ? '' : 'none';
}

// Render scene markdown with links neutralised — submitted scenes must not
// contain clickable links. We render normally, then strip any anchor tags,
// keeping their visible text. This is version-independent (doesn't rely on
// marked's renderer API, which changes between releases).
function renderSceneMarkdown(src) {
  var html = marked.parse(src);
  // Replace <a ...>text</a> with just text
  html = html.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1');
  return html;
}

function renderBlurb(text, author) {
  sceneBlurb.style.animation = 'none';
  sceneBlurb.offsetHeight;
  sceneBlurb.style.animation = '';
  // Render the scene text as Markdown so bold/italic/quotes/dividers/lists/etc.
  // all work. Fall back to simple paragraph splitting if marked isn't loaded.
  var src = text || '';
  if (window.marked) {
    sceneBlurb.innerHTML = renderSceneMarkdown(src);
  } else {
    sceneBlurb.innerHTML = src.split(/\n\n+/)
      .map(function(p){ return '<p>' + p.replace(/\n/g, '<br>') + '</p>'; })
      .join('');
  }

  if (author) {
    const authorLink = document.createElement('a');
    authorLink.href = '#';
    authorLink.className = 'cyoa-author-link';
    authorLink.textContent = author;
    authorLink.addEventListener('click', function(e) {
      e.preventDefault();
      showAuthorScreen(author);
    });
    sceneAuthorEl.innerHTML = '';
    sceneAuthorEl.appendChild(authorLink);
    sceneByline.style.display = '';
  } else {
    sceneByline.style.display = 'none';
  }
}

function renderChoices(node) {
  choicesWrap.innerHTML     = '';
  endingWrap.style.display  = 'none';
  deadEndWrap.style.display = 'none';


  // -- Ending ------------------------------------
  if (node.isEnding || !(node.choices || []).length) {
    endingWrap.style.display = 'flex';
    return;
  }

  // -- Choices -----------------------------------
  node.choices.forEach(choice => {
    if (choice.requiresItem && !state.inventory.has(choice.requiresItem)) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'choice-wrapper';

    if ((choice.contentTags || []).length) {
      const warn = document.createElement('div');
      warn.className = 'choice-content-tags';
      warn.innerHTML = `<span class="content-tag-label">  Content notice:</span> ` +
        choice.contentTags.map(t => `<span class="content-tag">${t}</span>`).join('');
      wrapper.appendChild(warn);
    }

    const btn = document.createElement('button');
    btn.className   = 'choice-btn';
    btn.textContent = choice.text;

    if (choice.locked) {
      btn.classList.add('locked');
      btn.setAttribute('aria-disabled', 'true');
      btn.title = choice.lockedReason || 'This option is unavailable';
    } else if (choice.nextId === null || choice.nextId === undefined) {
      // Null nextId = unwritten branch, clicking shows dead end screen
      const choiceText = choice.text;
      btn.addEventListener('click', () => {
        const deadNode = state.currentId;
        // Push a dead-end entry (carries choice text + trail for restoration),
        // then render the panel via the shared helper.
        history.pushState(
          { screen: 'game', adventure: state.storyId, node: deadNode, deadEnd: true, deadEndChoice: choiceText, trail: state.history.slice() },
          '',
          '?adventure=' + encodeURIComponent(state.storyId) + '&node=' + encodeURIComponent(deadNode)
        );
        renderDeadEndState(deadNode, choiceText);
      });
    } else {
      btn.addEventListener('click', () => {
        if (choice.grantsItem) state.inventory.add(choice.grantsItem);
        goToNode(choice.nextId);
      });
    }

    wrapper.appendChild(btn);

    // Show destination node's author and tags as a preview below the button
    const isDeadEnd  = (choice.nextId === null || choice.nextId === undefined) && !choice.locked;
    const destNode   = choice.nextId != null ? state.nodeMap[choice.nextId] : null;
    const destAuthor = destNode ? destNode.author : null;
    const destTags   = destNode ? (destNode.tags || []) : [];

    if (isDeadEnd) {
      const preview = document.createElement('div');
      preview.className = 'choice-preview';
      const deadEl = document.createElement('span');
      deadEl.className = 'choice-preview-deadend';
      deadEl.innerHTML = '<span class="deadend-word">Unwritten path</span>';
      preview.appendChild(deadEl);
      wrapper.appendChild(preview);
    } else if (destAuthor || destTags.length) {
      const preview = document.createElement('div');
      preview.className = 'choice-preview';

      if (destAuthor) {
        const authorEl = document.createElement('span');
        authorEl.className   = 'choice-preview-author';
        const authorA = document.createElement('a');
        authorA.href = '#';
        authorA.className = 'cyoa-author-link';
        authorA.textContent = destAuthor;
        authorA.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation(); // don't trigger the choice button
          showAuthorScreen(destAuthor);
        });
        const byLabel = document.createElement('span');
        byLabel.className = 'choice-preview-by';
        byLabel.textContent = 'by ';
        authorEl.appendChild(byLabel);
        authorEl.appendChild(authorA);
        preview.appendChild(authorEl);
      }

      if (destTags.length) {
        destTags.forEach(tag => {
          const tagEl = document.createElement('span');
          tagEl.className   = 'content-tag';
          tagEl.textContent = tag;
          preview.appendChild(tagEl);
        });
      }

      wrapper.appendChild(preview);
    }

    choicesWrap.appendChild(wrapper);
  });

  // Add a branch button -- always shown below choices
  const addBranchBtn = document.createElement('button');
  addBranchBtn.className   = 'btn-ghost add-branch-btn';
  addBranchBtn.textContent = '+ Add a branch to this scene';
  addBranchBtn.addEventListener('click', () => {
    goToBranchBuilder(state.currentId, '');
  });
  choicesWrap.appendChild(addBranchBtn);
}

// Navigate to the full-page branch builder (mirrors the new-story page,
// seeded with the parent story + node this cluster attaches to).
function goToBranchBuilder(nodeId, choiceText) {
  const storyTitle = state.storyMeta && state.storyMeta.title ? state.storyMeta.title : state.storyId;
  const params = new URLSearchParams({
    mode:   'branch',
    story:  storyTitle,
    storyId: state.storyId || '',
    node:   String(nodeId),
    choice: choiceText || ''
  });
  window.location.href = 'new-story.html?' + params.toString();
}

function renderDeadEnd(node) {
  const nodeId    = node.id;
  const storyName = state.storyMeta .title || state.storyId;

  deadEndContact.innerHTML = `
    <p class="dead-end-body">
      This branch hasn't been written yet. If you have an idea for where it leads,
      submit a continuation -- your scene will be reviewed and added to the adventure.
    </p>
    <div style="display:flex; flex-direction:column; gap:0.65rem; margin-top:0.75rem;">
      <button id="dead-end-submit-btn" class="btn-primary" style="align-self:flex-start;">
        * Write this scene
      </button>
    </div>
  `;
}

function updateBreadcrumbs() {
  breadcrumbList.innerHTML = '';
  const trail = [...state.history, state.currentId];
  trail.forEach((id, i) => {
    const node = state.nodeMap[id];
    const item = document.createElement('div');
    const isLast = i === trail.length - 1;
    item.className = 'breadcrumb-item' + (isLast && !state.deadEndActive ? ' current' : '');
    item.textContent = node ? (node.title || node.blurb.slice(0, 42) + '…') : id;
    breadcrumbList.appendChild(item);
  });
  // Add dead end entry at the bottom if active
  if (state.deadEndActive) {
    const item = document.createElement('div');
    item.className   = 'breadcrumb-item current';
    item.textContent = '* Unwritten path ';
    breadcrumbList.appendChild(item);
  }
  breadcrumbList.scrollTop = breadcrumbList.scrollHeight;
  btnBackNode.style.display = (state.history.length > 0 || state.deadEndActive) ? '' : 'none';
}

function updateImage(node) {
  if (node.image) {
    sceneImage.alt = '';
    sceneImage.classList.remove('loaded');
    sceneImagePlaceholder.classList.remove('hidden');
    sceneImage.onload  = () => {
      sceneImage.classList.add('loaded');
      sceneImagePlaceholder.classList.add('hidden');
    };
    sceneImage.onerror = () => {
      sceneImage.classList.remove('loaded');
      sceneImagePlaceholder.classList.remove('hidden');
    };
    sceneImage.src = node.image;
  } else {
    sceneImage.onload  = null;
    sceneImage.onerror = null;
    sceneImage.src     = '';
    sceneImage.alt     = '';
    sceneImage.classList.remove('loaded');
    sceneImagePlaceholder.classList.remove('hidden');
  }
}

// -- Theme ----------------------------------------


// -- Screen switching -----------------------------
function showScreen(name) {
  [screenLibrary, screenGame, screenAuthor].forEach(s => { if (s) s.style.display = 'none'; });
  if (name === 'library')  { screenLibrary.style.display = 'block'; return; }
  if (name === 'game')     { screenGame.style.display    = 'flex'; return; }
  if (name === 'author')   { screenAuthor.style.display  = 'block'; return; }
}


// -- Save / Load ----------------------------------


function restartAdventure() {
  showConfirm('Restart from the beginning? Current progress will be lost.', () => {
    state.currentId = null; state.history = []; state.inventory = new Set(); state.deadEndActive = false;
    goToNode(1);
  });
}

// -- Modal ----------------------------------------
let _onConfirm = null, _onCancel = null;

function showConfirm(msg, onConfirm, onCancel) {
  modalMessage.textContent = msg;
  _onConfirm = onConfirm;
  _onCancel  = onCancel || null;
  modalOverlay.style.display = 'flex';
}

function closeModal() {
  modalOverlay.style.display = 'none';
  _onConfirm = null; _onCancel = null;
}

modalConfirm.addEventListener('click', () => { const cb = _onConfirm; closeModal(); if (cb) cb(); });
modalCancel.addEventListener('click',  () => { const cb = _onCancel;  closeModal(); if (cb) cb(); });
modalOverlay.addEventListener('click', e => {
  if (e.target === modalOverlay) { const cb = _onCancel; closeModal(); if (cb) cb(); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && modalOverlay.style.display !== 'none') {
    const cb = _onCancel; closeModal(); if (cb) cb();
  }
});

// -- Toast ----------------------------------------
let _toastTimer = null;
function showToast(msg, duration = 2200) {
  toastEl.textContent = msg;
  toastEl.classList.add('visible');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toastEl.classList.remove('visible'), duration);
}

// -- Event listeners ------------------------------
btnBackLibrary.addEventListener('click', () => {
  const node = state.nodeMap[state.currentId];
  const resetState = () => {
    state.currentId     = null;
    state.history       = [];
    state.deadEndActive = false;
      showScreen('library');
  };
  if (!state.currentId || node .isEnding) {
    resetState();
  } else {
    showConfirm('Return to adventures? Your unsaved progress will be lost.', resetState);
  }
});

btnBackNode.addEventListener('click', goBack);
btnRestart.addEventListener('click', restartAdventure);
btnPlayAgain.addEventListener('click', () => {
  state.currentId = null; state.history = []; state.inventory = new Set(); state.deadEndActive = false;
  goToNode(1);
});
btnLibraryFromEnd.addEventListener('click', () => { state.currentId = null; state.history = []; state.deadEndActive = false; showScreen('library'); });

// ── Browser history navigation (back/forward) ────────────────
// The browser history is the single source of truth. Each game entry carries
// a snapshot of the path trail, so we simply restore whatever the target entry
// describes — no position math, no forward-blocking, no parallel bookkeeping.
window.addEventListener('popstate', function(e) {
  const s = e.state;

  // Back to the library (or unknown/empty state)
  if (!s || s.screen === 'library') {
    state.currentId = null;
    state.history = [];
    state.deadEndActive = false;
    deadEndWrap.style.display = 'none';
    showScreen('library');
    return;
  }

  // Back/forward to an author screen (restore only — do not push again)
  if (s.screen === 'author') {
    showAuthorScreen(s.authorId, false);
    return;
  }

  // Game entry: ensure the right adventure is loaded, then render the node.
  // This covers back AND forward, including jumping back into an adventure
  // from the library or across adventures.
  if (s.screen !== 'game') return;

  (async function() {
    try {
      await ensureAdventureLoaded(s.adventure);
    } catch (err) {
      showToast(`Error loading adventure: ${err.message}`, 4000);
      showScreen('library');
      return;
    }

    showScreen('game');

    // Restore the path trail exactly from the entry's snapshot
    state.history = Array.isArray(s.trail) ? s.trail.slice() : [];

    if (s.deadEnd) {
      // Reconstruct the dead-end panel exactly
      renderDeadEndState(s.node, s.deadEndChoice || '');
    } else {
      state.deadEndActive = false;
      deadEndWrap.style.display = 'none';
      renderSceneFromId(s.node);
    }
  })();
});

// Render a node by id without touching browser history or the path trail.
function renderSceneFromId(id) {
  const node = state.nodeMap[id];
  if (!node) { showScreen('library'); return; }
  state.currentId = id;
  updateImage(node);
  updateBreadcrumbs();
  renderSceneTitle(node.title || '');
  renderBlurb(node.blurb, node.author);
  renderChoices(node);
  const main = document.querySelector('.game-main');
  if (main) main.scrollTop = 0;
}

// Render the dead-end panel overlay for a given node + choice text, without
// touching browser history. Used both on click and when restoring via popstate.
function renderDeadEndState(nodeId, choiceText) {
  const node = state.nodeMap[nodeId];
  if (!node) { showScreen('library'); return; }
  state.currentId = nodeId;
  state.deadEndActive = true;
  updateBreadcrumbs();
  renderSceneTitle('');
  sceneBlurb.innerHTML = '<p style="font-style:italic; color:var(--text-muted);">The path ends here -- for now. Every blank page in the Sinverse is an invitation. Maybe this one is yours.</p>';
  sceneByline.style.display = 'none';
  sceneImage.classList.remove('loaded');
  sceneImagePlaceholder.classList.remove('hidden');
  sceneImage.src = '';
  choicesWrap.innerHTML = '';
  endingWrap.style.display = 'none';
  deadEndWrap.style.display = 'flex';
  renderDeadEnd(node, choiceText || '');
  const deadEndFormBtn = deadEndWrap.querySelector('#dead-end-submit-btn');
  if (deadEndFormBtn) {
    deadEndFormBtn.onclick = () => {
      goToBranchBuilder(state.currentId, choiceText || '');
    };
  }
  const main = document.querySelector('.game-main');
  if (main) main.scrollTop = 0;
}

// ── On page load, set base library state + check URL params ──
(function restoreFromURL() {
  // Read params BEFORE replaceState strips the URL
  const p = new URLSearchParams(window.location.search);
  const authorId  = p.get('authorId');
  const adventure = p.get('adventure');
  if (authorId) {
    window._pendingAuthor    = authorId;
    window._pendingAdventure = adventure || null;
    window._pendingNode      = p.get('node') || null;
  } else if (adventure) {
    window._pendingAdventure = adventure;
    window._pendingNode      = p.get('node') || null;
  }
  // Now set baseline library state (strips params from address bar)
  history.replaceState({ screen: 'library' }, '', window.location.pathname);
})();

// ── Adventure info modal ─────────────────────────────────────
async function showAdventureInfo(meta) {
  // Remove any existing modal
  var old = document.getElementById('adv-info-modal');
  if (old) old.remove();

  var overlay = document.createElement('div');
  overlay.id = 'adv-info-modal';
  overlay.className = 'adv-info-overlay';

  var box = document.createElement('div');
  box.className = 'adv-info-box';

  box.innerHTML =
    '<div class="adv-info-header">' +
      '<div>' +
        '<div class="adv-info-eyebrow">Adventure</div>' +
        '<h2 class="adv-info-title">' + (meta.title || meta.id) + '</h2>' +
      '</div>' +
      '<button class="adv-info-close" id="adv-info-close">&#10005;</button>' +
    '</div>' +
    '<div class="adv-info-stats" id="adv-info-stats">' +
      '<div class="adv-info-loading">Loading…</div>' +
    '</div>' +
    '<div class="adv-info-tags" id="adv-info-tags"></div>' +
    '<div class="adv-info-authors" id="adv-info-authors"></div>' +
    '<div class="adv-info-footer">' +
      '<button class="btn-primary adv-info-begin" id="adv-info-begin">Begin adventure →</button>' +
    '</div>';

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  document.getElementById('adv-info-close').addEventListener('click', function() { overlay.remove(); });
  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  document.getElementById('adv-info-begin').addEventListener('click', function() {
    overlay.remove();
    loadAdventure(meta.id);
  });

  // Fetch adventure nodes
  try {
    var nodes = await fetchAdventureNodes(meta.id);

    var totalWords = nodes.reduce(function(sum, n) {
      return sum + (n.blurb || '').replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
    }, 0);

    // Author breakdown
    var authorCounts = {};
    nodes.forEach(function(n) {
      var a = n.author || 'Anonymous';
      authorCounts[a] = (authorCounts[a] || 0) + 1;
    });
    var authors = Object.keys(authorCounts).sort(function(a, b) {
      return authorCounts[b] - authorCounts[a];
    });

    // Tag breakdown across all nodes
    var tagCounts = {};
    nodes.forEach(function(n) {
      (n.tags || []).forEach(function(t) {
        tagCounts[t] = (tagCounts[t] || 0) + 1;
      });
    });
    var tagKeys = Object.keys(tagCounts).sort(function(a, b) {
      return tagCounts[b] - tagCounts[a];
    });
    var tagsEl = document.getElementById('adv-info-tags');
    if (tagsEl) {
      if (tagKeys.length) {
        tagsEl.innerHTML = '<div class="adv-info-tags-title">Content tags across all scenes</div>' +
          '<div class="adv-info-tags-list">' +
          tagKeys.map(function(t) {
            return '<span class="adv-info-tag">' + t + ' <span class="adv-info-tag-count">' + tagCounts[t] + '</span></span>';
          }).join('') +
          '</div>';
      } else {
        tagsEl.innerHTML = '<div class="adv-info-tags-title">No content tags</div>';
      }
    }

    var statsEl = document.getElementById('adv-info-stats');
    if (statsEl) {
      statsEl.innerHTML =
        '<div class="adv-stat"><span class="adv-stat-n">' + nodes.length + '</span><span class="adv-stat-label">Scenes</span></div>' +
        '<div class="adv-stat"><span class="adv-stat-n">' + (totalWords >= 1000 ? (totalWords/1000).toFixed(1) + 'k' : totalWords) + '</span><span class="adv-stat-label">Words</span></div>' +
        '<div class="adv-stat"><span class="adv-stat-n">' + authors.length + '</span><span class="adv-stat-label">' + (authors.length === 1 ? 'Author' : 'Authors') + '</span></div>';
    }

    // Fetch contributor avatars
    var contribs = [];
    try {
      var cr = await fetch('../contributors/contributors.json');
      if (cr.ok) contribs = await cr.json();
    } catch(e) {}

    var authorsEl = document.getElementById('adv-info-authors');
    if (authorsEl && authors.length) {
      authorsEl.innerHTML = '<div class="adv-info-authors-title">Contributors</div>';
      authors.forEach(function(a) {
        var contrib = contribs.find(function(c) { return c.id === a; });
        var avatar  = contrib && contrib.avatar ? contrib.avatar : '';
        var display = contrib ? contrib.name : a;

        var row = document.createElement('div');
        row.className = 'adv-author-row';

        var avatarHtml = avatar
          ? '<img class="adv-author-avatar" src="' + avatar + '" alt="' + display + '" />'
          : '<div class="adv-author-avatar adv-author-avatar-ph">' + display.charAt(0).toUpperCase() + '</div>';

        row.innerHTML =
          avatarHtml +
          '<span class="adv-author-name">' + display + '</span>' +
          '<span class="adv-author-count">' + authorCounts[a] + (authorCounts[a] === 1 ? ' scene' : ' scenes') + '</span>';

        if (a !== 'Anonymous') {
          row.style.cursor = 'pointer';
          row.addEventListener('click', function() {
            overlay.remove();
            showAuthorScreen(a);
          });
        }
        authorsEl.appendChild(row);
      });
    }
  } catch(e) {
    var statsEl2 = document.getElementById('adv-info-stats');
    if (statsEl2) statsEl2.innerHTML = '<div class="adv-info-loading">Could not load adventure data.</div>';
  }
}

// ── Author screen ─────────────────────────────────────────────
async function showAuthorScreen(authorId, pushHistory = true) {
  const nameEl   = document.getElementById('author-screen-name');
  const totalEl  = document.getElementById('author-screen-total');
  const avatarEl = document.getElementById('author-screen-avatar');
  const listEl   = document.getElementById('author-screen-adventures');
  const linkEl   = document.getElementById('author-screen-contrib-link');

  if (nameEl)  nameEl.textContent  = authorId;
  if (totalEl) totalEl.textContent = '';
  if (listEl)  listEl.innerHTML    = '<div class="loading-placeholder">Loading scenes…</div>';
  if (linkEl)  linkEl.href = '../contributors/?creator=' + encodeURIComponent(authorId);

  // Fetch contributor info for avatar
  const base = window.location.pathname.replace(/\/[^/]*$/, '/');
  try {
    const contribs = await fetch('../contributors/contributors.json').then(r => r.ok ? r.json() : []).catch(() => []);
    const contrib  = contribs.find(c => c.id === authorId);
    if (contrib && avatarEl) {
      if (contrib.avatar) {
        avatarEl.src = contrib.avatar;
        avatarEl.style.display = 'block';
      } else {
        avatarEl.style.display = 'none';
      }
      if (nameEl) nameEl.textContent = contrib.name || authorId;
    }
  } catch(e) {}

  // Wire profile click to contributor page immediately
  var profileUrl = '../contributors/?creator=' + encodeURIComponent(authorId);
  var profileEl  = document.querySelector('.author-screen-profile');
  if (profileEl) {
    profileEl.onclick = function() { window.location.href = profileUrl; };
  }

  showScreen('author');
  // Push author screen state only for user actions (not popstate restores)
  if (pushHistory) {
    history.pushState(
      { screen: 'author', authorId: authorId, adventure: state.storyId, node: state.currentId },
      '',
      '?authorId=' + encodeURIComponent(authorId) +
      (state.storyId ? '&adventure=' + encodeURIComponent(state.storyId) : '') +
      (state.currentId !== null && state.currentId !== undefined ? '&node=' + encodeURIComponent(state.currentId) : '')
    );
  }

  // Fetch all adventures and find scenes by this author
  try {
    let totalScenes = 0;
    const cards = [];

    await Promise.all(state.manifest.map(async function(meta) {
      try {
        const nodes = await fetchAdventureNodes(meta.id);
        if (!nodes.length) return;
        const mine  = nodes.filter(n => n.author === authorId);
        if (!mine.length) return;
        totalScenes += mine.length;
        cards.push({ meta, nodes: mine });
      } catch(e) {}
    }));

    if (totalEl) totalEl.textContent = totalScenes + (totalScenes === 1 ? ' scene' : ' scenes') + ' across ' + cards.length + (cards.length === 1 ? ' adventure' : ' adventures');

    if (!listEl) return;
    if (!cards.length) {
      listEl.innerHTML = '<div class="loading-placeholder">No scenes found for this author.</div>';
      return;
    }

    listEl.innerHTML = '';
    cards.forEach(function({ meta, nodes }) {
      const card = document.createElement('div');
      card.className = 'author-adv-card';

      const titleRow = document.createElement('div');
      titleRow.className = 'author-adv-title author-adv-collapsed';
      titleRow.innerHTML =
        '<span class="author-adv-chevron">▸</span>' +
        '<span class="author-adv-title-main">' + (meta.title || meta.id) + '</span>' +
        '<span class="author-adv-count">' + nodes.length + (nodes.length === 1 ? ' scene' : ' scenes') + '</span>';
      card.appendChild(titleRow);

      const sceneList = document.createElement('div');
      sceneList.className = 'author-adv-scenes';
      sceneList.style.display = 'none'; // starts collapsed

      titleRow.addEventListener('click', function() {
        var collapsed = titleRow.classList.toggle('author-adv-collapsed');
        sceneList.style.display = collapsed ? 'none' : 'flex';
      });

      nodes.forEach(function(node) {
        const row = document.createElement('div');
        row.className = 'author-scene-row';
        const preview = node.title
          ? node.title
          : (node.blurb || '').replace(/<[^>]+>/g, '').trim().slice(0, 80) + ((node.blurb || '').length > 80 ? '…' : '');
        row.innerHTML =
          '<span class="author-scene-node">' + node.id + '</span>' +
          '<span class="author-scene-blurb">' + preview + '</span>' +
          '<button class="author-scene-jump">Jump →</button>';
        row.querySelector('.author-scene-jump').addEventListener('click', function() {
          loadAdventure(meta.id).then(function() {
            if (state.nodeMap[node.id]) goToNode(node.id);
          });
        });
        sceneList.appendChild(row);
      });

      card.appendChild(sceneList);
      listEl.appendChild(card);
    });
  } catch(e) {
    if (listEl) listEl.innerHTML = '<div class="loading-placeholder" style="color:var(--wine)">Failed to load scenes.</div>';
  }
}

document.getElementById('btn-back-author').addEventListener('click', function() {
  // "All Adventures" always returns to the library, regardless of how the
  // author page was reached.
  state.currentId = null;
  state.history = [];
  state.deadEndActive = false;
  deadEndWrap.style.display = 'none';
  showScreen('library');
  history.pushState({ screen: 'library' }, '', window.location.pathname);
});

// ─── STORY MAP (reader) ───────────────────────────────────────
// A full overview of an adventure's branching structure. Openable from an
// adventure card (no path highlight) or from inside the reader (highlights the
// current session's path). Clicking a scene jumps straight to it.

// From an adventure card: load the node data, then show the map cold.
async function openStoryMapForAdventure(id) {
  try {
    await ensureAdventureLoaded(id);
  } catch (err) {
    showToast('Could not load the story map: ' + err.message, 4000);
    return;
  }
  var meta = state.manifest.find(function(m){ return m.id === id; }) || {};
  renderReaderStoryMap(id, meta.title || id, /*highlightPath*/ false);
}

// From inside the reader: show the current adventure, highlighting the path
// taken this session.
function openStoryMapCurrent() {
  if (!state.storyId || !state.nodeMap) return;
  var title = (state.storyMeta && state.storyMeta.title) ? state.storyMeta.title : state.storyId;
  renderReaderStoryMap(state.storyId, title, /*highlightPath*/ true);
}

function renderReaderStoryMap(adventureId, title, highlightPath) {
  var overlay = document.getElementById('story-map-overlay');
  var body    = document.getElementById('map-body');
  var titleEl = document.getElementById('map-title');
  if (!overlay || !body) return;
  titleEl.textContent = title;

  var nodes = Object.keys(state.nodeMap).map(function(k){ return state.nodeMap[k]; });
  body.innerHTML = '';
  if (!nodes.length) { body.innerHTML = '<p class="map-empty">No scenes to map.</p>'; overlay.style.display = 'flex'; return; }

  var byId = {};
  nodes.forEach(function(n){ byId[n.id] = n; });

  // Path taken this session (for highlight)
  var visited = {};
  if (highlightPath) {
    state.history.forEach(function(id){ visited[id] = true; });
    if (state.currentId != null) visited[state.currentId] = true;
  }

  // BFS depth from the opening (id 1, or the first node)
  var startId = byId[1] ? 1 : nodes[0].id;
  var depth = {}; depth[startId] = 0;
  var queue = [startId];
  while (queue.length) {
    var cur = queue.shift();
    var node = byId[cur];
    if (!node) continue;
    (node.choices || []).forEach(function(c) {
      var t = (c.nextId === null || c.nextId === undefined) ? null : c.nextId;
      if (t != null && byId[t] && depth[t] === undefined) {
        depth[t] = depth[cur] + 1;
        queue.push(t);
      }
    });
  }
  var maxDepth = 0;
  Object.keys(depth).forEach(function(k){ if (depth[k] > maxDepth) maxDepth = depth[k]; });
  var orphanCol = maxDepth + 1;
  nodes.forEach(function(n){ if (depth[n.id] === undefined) depth[n.id] = orphanCol; });

  // Group into columns
  var columns = {};
  nodes.forEach(function(n){ (columns[depth[n.id]] = columns[depth[n.id]] || []).push(n); });
  var colKeys = Object.keys(columns).map(Number).sort(function(a,b){ return a-b; });

  var COL_W = 230, NODE_W = 180, NODE_H = 64, V_GAP = 28, PAD = 40;
  var maxRows = 0;
  colKeys.forEach(function(d){ if (columns[d].length > maxRows) maxRows = columns[d].length; });

  var positions = {};
  colKeys.forEach(function(d, ci) {
    var col = columns[d];
    var colHeight = col.length * NODE_H + (col.length - 1) * V_GAP;
    var totalHeight = maxRows * NODE_H + (maxRows - 1) * V_GAP;
    var startY = PAD + (totalHeight - colHeight) / 2;
    col.forEach(function(n, ri) {
      positions[n.id] = { x: PAD + ci * COL_W, y: startY + ri * (NODE_H + V_GAP) };
    });
  });

  var width  = PAD * 2 + (colKeys.length - 1) * COL_W + NODE_W;
  var height = PAD * 2 + maxRows * NODE_H + (maxRows - 1) * V_GAP;

  var canvas = document.createElement('div');
  canvas.className = 'map-canvas';
  canvas.style.width  = width + 'px';
  canvas.style.height = height + 'px';

  // Edges (SVG)
  var svgNS = 'http://www.w3.org/2000/svg';
  var svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'map-edges');
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
  nodes.forEach(function(n) {
    var from = positions[n.id];
    if (!from) return;
    (n.choices || []).forEach(function(c) {
      var t = (c.nextId === null || c.nextId === undefined) ? null : c.nextId;
      if (t == null || !positions[t]) return;
      var to = positions[t];
      var x1 = from.x + NODE_W, y1 = from.y + NODE_H / 2;
      var x2 = to.x,            y2 = to.y + NODE_H / 2;
      var midX = (x1 + x2) / 2;
      var path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', 'M ' + x1 + ' ' + y1 + ' C ' + midX + ' ' + y1 + ', ' + midX + ' ' + y2 + ', ' + x2 + ' ' + y2);
      var onPath = highlightPath && visited[n.id] && visited[t];
      path.setAttribute('class', 'map-edge' + (x2 < x1 ? ' backward' : '') + (onPath ? ' on-path' : ''));
      svg.appendChild(path);
    });
  });
  canvas.appendChild(svg);

  // Scene nodes
  nodes.forEach(function(n) {
    var pos = positions[n.id];
    if (!pos) return;
    var box = document.createElement('button');
    var isOpening = n.id === startId;
    var isEnding = n.isEnding || !((n.choices || []).length);
    box.className = 'map-node' +
      (isOpening ? ' opening' : '') +
      (isEnding ? ' ending' : '') +
      (highlightPath && visited[n.id] ? ' visited' : '') +
      (highlightPath && n.id === state.currentId ? ' current' : '');
    box.style.left = pos.x + 'px';
    box.style.top  = pos.y + 'px';
    box.style.width = NODE_W + 'px';
    box.style.height = NODE_H + 'px';
    var sceneName = n.title || n.sceneName || '';
    var label = sceneName ? escapeHtmlMap(sceneName) : '<em>Scene ' + n.id + '</em>';
    var meta = isEnding ? 'Ending' : ((n.choices || []).filter(function(c){ return c.nextId != null; }).length + ' choices');
    box.innerHTML =
      '<span class="map-node-id">Scene ' + n.id + (highlightPath && n.id === state.currentId ? ' • you are here' : '') + '</span>' +
      '<span class="map-node-name">' + label + '</span>' +
      '<span class="map-node-meta">' + meta + '</span>';
    box.addEventListener('click', function() { jumpToMapScene(adventureId, n.id); });
    canvas.appendChild(box);
  });

  body.appendChild(canvas);
  overlay.style.display = 'flex';
}

function escapeHtmlMap(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Find the shortest path (list of node ids) from the opening to `targetId`
// over the choice graph, so a map jump can populate the "path taken" trail.
// Returns the full path including the target, or just [targetId] if unreachable.
function shortestPathToNode(targetId) {
  var startId = state.nodeMap[1] ? 1 : (Object.keys(state.nodeMap)[0]);
  if (startId == null) return [targetId];
  if (String(startId) === String(targetId)) return [targetId];
  var queue = [startId];
  var prev = {};               // nodeId -> the node we reached it from
  var seen = {}; seen[startId] = true;
  while (queue.length) {
    var cur = queue.shift();
    var node = state.nodeMap[cur];
    if (!node) continue;
    var choices = node.choices || [];
    for (var i = 0; i < choices.length; i++) {
      var t = choices[i].nextId;
      if (t === null || t === undefined || !state.nodeMap[t]) continue;
      if (seen[t]) continue;
      seen[t] = true;
      prev[t] = cur;
      if (String(t) === String(targetId)) {
        // Reconstruct path from target back to start
        var path = [t];
        var p = cur;
        while (p !== undefined && p !== null) {
          path.unshift(p);
          p = prev[p];
        }
        return path;
      }
      queue.push(t);
    }
  }
  return [targetId]; // unreachable from the opening — drop in directly
}

// Jump to a chosen scene: ensure the adventure is loaded, enter the game
// screen, reconstruct the path so "path taken" / back button work, then show
// the chosen node.
async function jumpToMapScene(adventureId, nodeId) {
  var overlay = document.getElementById('story-map-overlay');
  if (overlay) overlay.style.display = 'none';
  try {
    await ensureAdventureLoaded(adventureId);
  } catch (err) {
    showToast('Could not open that scene: ' + err.message, 4000);
    return;
  }
  state.inventory     = new Set();
  state.deadEndActive = false;
  // Build the trail leading to this node; everything before it becomes history
  var path = shortestPathToNode(nodeId);
  state.history   = path.slice(0, -1);   // ancestors
  state.currentId = null;                // so goToNode doesn't re-push
  showScreen('game');
  history.replaceState({ screen: 'library' }, '', window.location.pathname);
  goToNode(path[path.length - 1]);
}

function initStoryMapControls() {
  var close = document.getElementById('map-close');
  var overlay = document.getElementById('story-map-overlay');
  if (close) close.addEventListener('click', function(){ overlay.style.display = 'none'; });
  if (overlay) overlay.addEventListener('click', function(e){ if (e.target === overlay) overlay.style.display = 'none'; });
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && overlay && overlay.style.display !== 'none') overlay.style.display = 'none';
  });
  var mapBtn = document.getElementById('cyoa-map-btn');
  if (mapBtn) mapBtn.addEventListener('click', openStoryMapCurrent);
}
initStoryMapControls();



// -- Start ----------------------------------------
try {
  init();
} catch(e) {
  console.error('[Sinverse] Fatal init error:', e);
}
