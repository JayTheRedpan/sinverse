'use strict';

var _histPos = 0; // monotonic counter for browser history direction tracking

var _histPos = 0; // monotonic counter for browser history direction tracking
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
const modalOverlay          = $('modal-overlay');
const modalMessage          = $('modal-message');
const modalConfirm          = $('modal-confirm');
const modalCancel           = $('modal-cancel');
const toastEl               = $('toast');
const sceneByline           = $('scene-byline');
const sceneAuthorEl         = $('scene-author');

// -- Boot ----------------------------------------
async function init() {
  // Age gate is on the landing page -- go straight to library
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
async function loadAdventure(id) {
  try {
    const base = window.location.pathname.replace(/\/[^/]*$/, '/');
    const res = await fetch(base + `adventures/${id}.json`);
    if (!res.ok) throw new Error(`Could not load adventures/${id}.json (status ${res.status}) at ${res.url}`);
    const data = await res.json();

    // Fetch companion markdown file for node text
    const mdRes = await fetch(base + `adventures/${id}.md`);
    if (mdRes.ok) {
      const mdText = await mdRes.text();
      const blurbs = parseMdBlurbs(mdText);
      data.forEach(n => { if (!n.blurb && blurbs[String(n.id)]) n.blurb = blurbs[String(n.id)]; });
    }

    // Story is now a plain array; node 1 is always the start
    state.story        = data;
    state.storyId      = id;
    state.storyMeta    = state.manifest.find(m => m.id === id) || {};
    state.nodeMap      = {};
    data.forEach(n => { state.nodeMap[n.id] = n; });
    state.currentId    = null;
    state.history      = [];
    state.inventory    = new Set();
    state.deadEndActive = false;

    const storyMeta = state.manifest.find(m => m.id === id) || {};
    gameStoryTitle.textContent = storyMeta.title || id;
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
  // Push browser state (unless restoring from popstate)
  if (!silent) {
    _histPos++;
    history.pushState(
      { screen: 'game', adventure: state.storyId, node: id, pos: _histPos },
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

function renderBlurb(text, author) {
  sceneBlurb.style.animation = 'none';
  sceneBlurb.offsetHeight;
  sceneBlurb.style.animation = '';
  // Split on double newline for paragraphs, single newline for line breaks
  const paragraphs = text.split(/\n\n+/);
  sceneBlurb.innerHTML = paragraphs
    .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');

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
        state.deadEndActive = true;
        updateBreadcrumbs();
        renderSceneTitle('');
        // Replace blurb with dead end flavour text
        sceneBlurb.innerHTML      = '<p style="font-style:italic; color:var(--text-muted);">The path ends here -- for now. Every blank page in the Sinverse is an invitation. Maybe this one is yours.</p>';
        sceneByline.style.display = 'none';
        sceneImage.classList.remove('loaded');
        sceneImagePlaceholder.classList.remove('hidden');
        sceneImage.src            = '';
        // Show dead end panel
        choicesWrap.innerHTML     = '';
        endingWrap.style.display  = 'none';
        deadEndWrap.style.display = 'flex';
        renderDeadEnd(state.nodeMap[state.currentId], choiceText);
        // Push dead end state — back dismisses it, then back again goes to previous scene
        _histPos++;
        history.pushState(
          { screen: 'game', adventure: state.storyId, node: state.currentId, deadEnd: true, pos: _histPos },
          '',
          '?adventure=' + encodeURIComponent(state.storyId) + '&node=' + encodeURIComponent(state.currentId)
        );


        // Wire dead end form button
        const deadEndFormBtn = deadEndWrap.querySelector('#dead-end-submit-btn');
        if (deadEndFormBtn) {
          deadEndFormBtn.onclick = () => {
            const storyTitle = state.storyMeta .title || state.storyId;
            window.showNewBranchForm(storyTitle, state.currentId, '');
          };
        }
        const main = document.querySelector('.game-main');
        if (main) main.scrollTop = 0;
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
    const storyTitle = state.storyMeta .title || state.storyId;
    window.showNewBranchForm(storyTitle, state.currentId, '');
  });
  choicesWrap.appendChild(addBranchBtn);
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
  if (name === 'game')     { screenGame.style.display    = 'block'; return; }
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
btnLibraryFromEnd.addEventListener('click', () => { state.currentId = null; state.history = []; state.deadEndActive = false; applyTheme(null); showScreen('library'); });

// ── Browser back support (forward disabled within adventure) ──
window.addEventListener('popstate', function(e) {
  const s = e.state;
  // Back to library
  if (!s || s.screen === 'library') {
    state.currentId = null; state.history = []; state.deadEndActive = false;
    applyTheme(null); showScreen('library'); return;
  }
  // Back to author screen
  if (s.screen === 'author') {
    showAuthorScreen(s.authorId);
    return;
  }
  if (s.screen !== 'game' || s.adventure !== state.storyId) return;
  // Block all forward navigation while in an adventure
  if (s.pos !== undefined && s.pos > _histPos) {
    // Going forward — push current state back to cancel it
    // Use setTimeout to avoid re-entrancy with the popstate handler
    const curId  = state.currentId;
    const curAdv = state.storyId;
    const curPos = _histPos;
    setTimeout(function() {
      history.pushState(
        { screen: 'game', adventure: curAdv, node: curId, pos: curPos },
        '',
        '?adventure=' + encodeURIComponent(curAdv) + '&node=' + encodeURIComponent(curId)
      );
    }, 0);
    return;
  }
  // Update our position tracker to match where the browser is
  if (s.pos !== undefined) _histPos = s.pos;
  // If dead end is showing, dismiss and fully re-render the current node
  if (state.deadEndActive) {
    state.deadEndActive = false;
    deadEndWrap.style.display = 'none';
    const curNode = state.nodeMap[state.currentId];
    if (curNode) {
      renderBlurb(curNode.blurb, curNode.author);
      renderChoices(curNode);
      updateBreadcrumbs();
    }
    return;
  }
  // Normal back to a previous scene
  if (s.node !== undefined && s.node !== state.currentId) {
    state.history.pop();
    goToNode(s.node, true);
    return;
  }
  // s.node === currentId with no dead end: go to previous in history
  if (state.history.length > 0) {
    const prevId = state.history[state.history.length - 1];
    state.history.pop();
    goToNode(prevId, true);
  } else {
    state.currentId = null;
      showScreen('library');
  }
});

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
async function showAuthorScreen(authorId) {
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
  // Push author screen state so browser back from contributors returns here
  history.pushState(
    { screen: 'author', authorId: authorId, adventure: state.storyId, node: state.currentId },
    '',
    '?authorId=' + encodeURIComponent(authorId) +
    (state.storyId ? '&adventure=' + encodeURIComponent(state.storyId) : '') +
    (state.currentId !== null && state.currentId !== undefined ? '&node=' + encodeURIComponent(state.currentId) : '')
  );

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
  if (state.currentId) {
    showScreen('game');
  } else {
    showScreen('library');
  }
});

// -- Start ----------------------------------------
try {
  init();
} catch(e) {
  console.error('[Sinverse] Fatal init error:', e);
}
