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
const btnDeadEndLibrary     = $('btn-dead-end-library');
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
  } catch (_) {
    meta.nodeCount = null;
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
        ${(meta.tags || []).map(t => `<span class="tag">${t}</span>`).join('')}
        ${countLabel ? `<span class="tag tag-length">${countLabel}</span>` : ''}
      </div>
      <h2 class="card-title">${meta.title}</h2>
      <p class="card-description">${meta.description || ''}</p>
      <div class="card-footer">
        <span class="card-cta">Read  </span>
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

// -- Load Story ----------------------------------
async function loadAdventure(id) {
  try {
    const base = window.location.pathname.replace(/\/[^/]*$/, '/');
    const res = await fetch(base + `adventures/${id}.json`);
    if (!res.ok) throw new Error(`Could not load adventures/${id}.json (status ${res.status}) at ${res.url}`);
    const data = await res.json();

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

    goToNode(1);
  } catch (err) {
    showToast(`Error loading adventure: ${err.message}`, 4000);
  }
}

// -- Navigation ----------------------------------
function goToNode(id) {
  const node = state.nodeMap[id];
  if (!node) { showToast(`Missing node: "${id}"`, 3000); return; }
  state.deadEndActive = false;
  if (state.currentId && state.currentId !== id) state.history.push(state.currentId);
  state.currentId = id;
  applyTheme(node.theme);
  updateImage(node);
  updateBreadcrumbs();
  renderBlurb(node.blurb, node.author);
  renderChoices(node);
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
    applyTheme(node.theme);
    updateImage(node);
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
  applyTheme(node.theme);
  updateImage(node);
  updateBreadcrumbs();
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
    sceneAuthorEl.textContent = author;
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
  const label = document.createElement('div');
  label.className   = 'choices-label';
  label.textContent = 'What do you do ';
  choicesWrap.appendChild(label);

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
    const destNode = choice.nextId != null ? state.nodeMap[choice.nextId] : null;
    const destAuthor = destNode ? destNode.author : null;
    const destTags   = destNode ? (destNode.tags || []) : [];

    if (destAuthor || destTags.length) {
      const preview = document.createElement('div');
      preview.className = 'choice-preview';

      if (destAuthor) {
        const authorEl = document.createElement('span');
        authorEl.className   = 'choice-preview-author';
        authorEl.textContent = 'by ' + destAuthor;
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
    <div style="display:flex; align-items:center; gap:0.6rem; flex-wrap:wrap; margin-top:0.25rem;">
      <span class="dead-end-node-id">node: ${nodeId}</span>
    </div>
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
    item.textContent = node ? (node.blurb.slice(0, 42) + ' ') : id;
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
function applyTheme(theme) {
  THEMES.forEach(t => document.body.classList.remove('theme-' + t));
  if (theme && THEMES.includes(theme)) document.body.classList.add('theme-' + theme);
}

// -- Screen switching -----------------------------
function showScreen(name) {
  screenLibrary.style.display = name === 'library' ? 'block' : 'none';
  screenGame.style.display    = name === 'game' ? 'block' : 'none';
  window.scrollTo(0, 0);
}

// -- Save / Load ----------------------------------


function restartAdventure() {
  showConfirm('Restart from the beginning  Current progress will be lost.', () => {
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
    applyTheme(null);
    showScreen('library');
  };
  if (!state.currentId || node .isEnding) {
    resetState();
  } else {
    showConfirm('Return to the library  Your unsaved progress will be lost.', resetState);
  }
});

btnBackNode.addEventListener('click', goBack);
btnRestart.addEventListener('click', restartAdventure);
btnPlayAgain.addEventListener('click', () => {
  state.currentId = null; state.history = []; state.inventory = new Set(); state.deadEndActive = false;
  goToNode(1);
});
btnLibraryFromEnd.addEventListener('click', () => { state.currentId = null; state.history = []; state.deadEndActive = false; applyTheme(null); showScreen('library'); });
btnDeadEndLibrary.addEventListener('click', () => { state.currentId = null; state.history = []; state.deadEndActive = false; applyTheme(null); showScreen('library'); });

// -- Start ----------------------------------------
try {
  init();
} catch(e) {
  console.error('[Sinverse] Fatal init error:', e);
}