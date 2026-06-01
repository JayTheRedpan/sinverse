'use strict';

// -- State
var builderState = {
  nodes:    [],
  activeId: null,
  nextId:   1,
};

// Branch mode: when the page is opened from a dead end / "add a branch" in the
// reader, it operates as a branch-cluster builder instead of a new-story builder.
var branchMode = null; // { story, storyId, parentNode, choiceSeed }

// Tag lists -- avoid redeclaring consts from submit.js
var BUILDER_NODE_TAGS  = ['explicit','sensual','dubcon','non-con','bdsm','bondage','dominance','submission','violence','character death','body horror','gore','dark themes','trauma','psychological','size difference'];

// -- Boot
async function initBuilder() {
  // Load canonical tags from central registry if available
  try {
    var res = await fetch('../_data/tags.json');
    if (res.ok) {
      var tagData = await res.json();
      if (tagData.story) BUILDER_NODE_TAGS  = tagData.story;
    }
  } catch(e) { /* use fallback arrays above */ }

  detectBranchMode();
  addNode();
}

// Read URL params; if mode=branch, switch the page into branch-cluster mode.
function detectBranchMode() {
  var p = new URLSearchParams(window.location.search);
  if (p.get('mode') !== 'branch') return;

  branchMode = {
    story:      p.get('story') || '',
    storyId:    p.get('storyId') || '',
    parentNode: p.get('node') || '',
    choiceSeed: p.get('choice') || ''
  };

  // Swap which detail section shows
  var advSec = document.getElementById('section-adventure-details');
  var brSec  = document.getElementById('section-branch-details');
  if (advSec) advSec.style.display = 'none';
  if (brSec)  brSec.style.display  = '';

  // Topbar + back link
  var tt = document.getElementById('builder-topbar-title');
  if (tt) tt.textContent = 'Continue a Path';
  document.title = 'Continue a Path — Sinverse';
  var back = document.querySelector('.builder-back');
  if (back) back.setAttribute('href', 'index.html?adventure=' + encodeURIComponent(branchMode.storyId || ''));

  // Context line + seed the attach-choice text
  var ctx = document.getElementById('branch-context');
  if (ctx) {
    ctx.innerHTML = 'Adding to <strong>' + escapeHtmlSM(branchMode.story) + '</strong>. ' +
      'Write the scene that fills this path — and any follow-on scenes your own choices lead to. ' +
      'They\u2019ll be submitted together and reviewed before going live.';
  }
  var cseed = document.getElementById('branch-choice-text');
  if (cseed && branchMode.choiceSeed) cseed.value = branchMode.choiceSeed;
}

// (adventure-level tags removed — card shows opening scene tags instead)

// -- Add a new node and render its card
function addNode() {
  var node = {
    id:        builderState.nextId++,
    sceneName: '',
    blurb:     '',
    tags:      [],
    isEnding:  false,
    choices:   [],
  };
  builderState.nodes.push(node);
  renderAllNodes();
  // Scroll to new node card
  setTimeout(function() {
    var card = document.querySelector('[data-node-id="' + node.id + '"]');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 50);
}

// -- Delete a node
function deleteNode(id) {
  if (builderState.nodes.length <= 1) {
    alert('You need at least one scene.');
    return;
  }
  if (!confirm('Delete Scene ' + id + '?')) return;
  builderState.nodes = builderState.nodes.filter(function(n) { return n.id !== id; });
  // Recalculate nextId so new scenes fill the gap
  builderState.nextId = builderState.nodes.length
    ? Math.max.apply(null, builderState.nodes.map(function(n) { return n.id; })) + 1
    : 1;
  renderAllNodes();
}

// -- Read a node card's current values back into state
function syncNodeFromCard(id) {
  var node = builderState.nodes.find(function(n) { return n.id === id; });
  if (!node) return;
  var card = document.querySelector('[data-node-id="' + id + '"]');
  if (!card) return;

  var nameEl = card.querySelector('.node-scene-name');
  node.sceneName = nameEl ? nameEl.value.trim() : '';
  node.blurb = card.querySelector('.node-blurb').value;
  // Preserve the collapsed/expanded state across re-renders
  node.collapsed = card.classList.contains('collapsed');


  var endingEl = card.querySelector('input[name="ending-' + id + '"]:checked');
  node.isEnding = endingEl ? endingEl.value === 'yes' : false;

  node.tags = Array.from(card.querySelectorAll('.node-tag-cb:checked')).map(function(cb) { return cb.value; });

  node.choices = [];
  card.querySelectorAll('.choice-row').forEach(function(row) {
    var textEl  = row.querySelector('.choice-text');
    var nextEl  = row.querySelector('.choice-next');
    if (!textEl || !nextEl) return;
    node.choices.push({
      text:   textEl.value,
      nextId: nextEl.value || null,
    });
  });
}

// -- Sync all cards before submission
function syncAllNodes() {
  builderState.nodes.forEach(function(n) { syncNodeFromCard(n.id); });
}

// -- Render all node cards
function renderAllNodes() {
  syncAllNodes();
  rebuildNodeCards();
}

// -- Rebuild the node card DOM from the current model WITHOUT syncing first.
//    Use this when the model has just been set deliberately (e.g. collapse-all)
//    and re-reading the stale DOM would clobber those values.
function rebuildNodeCards() {
  var container = document.getElementById('nodes-container');
  if (!container) return;
  container.innerHTML = '';
  builderState.nodes.forEach(function(node) {
    container.appendChild(buildNodeCard(node));
  });
  updateNodeCount();
}

// -- Get display label for a node
function nodeLabel(node) {
  return node.sceneName ? node.id + ' - ' + node.sceneName : 'Scene ' + node.id;
}

// -- Build a single node card DOM element
function buildNodeCard(node) {
  var card = document.createElement('div');
  card.className = 'node-card' + (node.collapsed ? ' collapsed' : '');
  card.setAttribute('data-node-id', node.id);

  // Header
  var header = document.createElement('div');
  header.className = 'node-card-header';
  header.innerHTML =
    '<button class="node-collapse-btn" aria-label="Collapse scene" title="Collapse / expand">&#9662;</button>' +
    '<div class="node-card-header-left">' +
      '<span class="node-card-label">Scene ' + node.id + (node.id === 1 ? ' <span class="node-opening-badge">Opening</span>' : '') + '</span>' +
      '<input class="node-scene-name builder-input" type="text" placeholder="Scene title (required)" value="' + (node.sceneName || '') + '" />' +
      '<span class="node-collapsed-summary"></span>' +
    '</div>' +
    '<button class="node-delete-btn" data-id="' + node.id + '">&#10005; Delete</button>';
  card.appendChild(header);

  // Collapsible body wrapper — all fields below the header live in here
  var body = document.createElement('div');
  body.className = 'node-card-body';
  card.appendChild(body);

  // Collapse / expand toggle
  var collapseBtn = header.querySelector('.node-collapse-btn');
  var summaryEl   = header.querySelector('.node-collapsed-summary');
  function refreshSummary() {
    var n = builderState.nodes.find(function(x){ return x.id === node.id; });
    var words = n && n.blurb ? n.blurb.trim().split(/\s+/).filter(Boolean).length : 0;
    summaryEl.textContent = words + (words === 1 ? ' word' : ' words');
  }
  collapseBtn.addEventListener('click', function() {
    card.classList.toggle('collapsed');
    var isCollapsed = card.classList.contains('collapsed');
    var n = builderState.nodes.find(function(x){ return x.id === node.id; });
    if (n) n.collapsed = isCollapsed;
    if (isCollapsed) refreshSummary();
  });
  // If this card is rendered collapsed (state persisted across re-render),
  // populate its summary immediately.
  if (node.collapsed) refreshSummary();

  // Update node list and dropdowns when scene name changes
  header.querySelector('.node-scene-name').addEventListener('input', function() {
    var n = builderState.nodes.find(function(x) { return x.id === node.id; });
    if (n) n.sceneName = this.value.trim();
    updateNodeList();
    updateAllChoiceDropdowns();
  });

  // Blurb
  var blurbWrap = document.createElement('div');
  blurbWrap.className = 'node-field';
  var wcId = 'wc-' + node.id;
  blurbWrap.innerHTML =
    '<div class="node-blurb-labelrow">' +
      '<label class="node-label">Scene text <span class="req">*</span></label>' +
      '<button type="button" class="node-preview-btn">&#128065; Preview</button>' +
    '</div>' +
    '<div class="node-md-toolbar">' +
      '<button type="button" class="md-tool-btn" data-md="bold" title="Bold (wrap in **)"><strong>B</strong></button>' +
      '<button type="button" class="md-tool-btn" data-md="italic" title="Italic (wrap in *)"><em>I</em></button>' +
      '<button type="button" class="md-tool-btn" data-md="heading" title="Heading">H</button>' +
      '<button type="button" class="md-tool-btn" data-md="quote" title="Block quote">&#8220;&#8221;</button>' +
      '<button type="button" class="md-tool-btn" data-md="hr" title="Scene divider">&#8213;</button>' +
    '</div>' +
    '<textarea class="builder-input node-blurb" rows="6" placeholder="Write your scene here...">' + (node.blurb || '') + '</textarea>' +
    '<div id="' + wcId + '" class="builder-wc">0 / 300 words minimum</div>';
  body.appendChild(blurbWrap);

  // Wire word count
  var ta = blurbWrap.querySelector('textarea');
  var wcEl = blurbWrap.querySelector('#' + wcId) || blurbWrap.querySelector('.builder-wc');
  ta.addEventListener('input', function() { updateWc(this, wcEl); });
  updateWc(ta, wcEl);

  // Wire the formatting toolbar buttons
  blurbWrap.querySelectorAll('.md-tool-btn').forEach(function(btn) {
    // Use mousedown so the textarea doesn't lose its selection on click
    btn.addEventListener('mousedown', function(e) {
      e.preventDefault();
      applyMarkdownFormat(ta, btn.getAttribute('data-md'));
      updateWc(ta, wcEl);
    });
  });

  // Wire per-scene markdown preview
  blurbWrap.querySelector('.node-preview-btn').addEventListener('click', function() {
    openMarkdownPreview(ta.value, node.sceneName || ('Scene ' + node.id));
  });

  // Theme

  // Content tags
  var tagsWrap = document.createElement('div');
  tagsWrap.className = 'node-field';
  var tagsHtml = '<label class="node-label">Content tags</label><div class="builder-tag-grid">';
  BUILDER_NODE_TAGS.slice().sort().forEach(function(t) {
    tagsHtml += '<label class="builder-tag-label"><input type="checkbox" class="node-tag-cb" value="' + t + '"' + (node.tags.includes(t) ? ' checked' : '') + ' /> ' + t + '</label>';
  });
  tagsHtml += '</div>';
  tagsWrap.innerHTML = tagsHtml;
  body.appendChild(tagsWrap);

  // Is ending toggle
  var endingWrap = document.createElement('div');
  endingWrap.className = 'node-field';
  endingWrap.innerHTML =
    '<label class="node-label">Is this an ending?</label>' +
    '<div class="node-radio-row">' +
      '<label class="builder-radio-label"><input type="radio" name="ending-' + node.id + '" value="no"' + (!node.isEnding ? ' checked' : '') + ' /> No</label>' +
      '<label class="builder-radio-label"><input type="radio" name="ending-' + node.id + '" value="yes"' + (node.isEnding ? ' checked' : '') + ' /> Yes</label>' +
    '</div>';
  body.appendChild(endingWrap);

  // Choices section
  var choicesWrap = document.createElement('div');
  choicesWrap.className = 'node-field node-choices-wrap';
  choicesWrap.style.display = node.isEnding ? 'none' : '';
  choicesWrap.innerHTML = '<label class="node-label">Choices</label>';

  var choiceList = document.createElement('div');
  choiceList.className = 'choice-list';
  choicesWrap.appendChild(choiceList);

  var addChoiceBtn = document.createElement('button');
  addChoiceBtn.className   = 'builder-add-choice-btn';
  addChoiceBtn.textContent = '+ Add choice';
  addChoiceBtn.addEventListener('click', function() {
    if (choiceList.querySelectorAll('.choice-row').length >= 4) return;
    appendChoiceRow(choiceList, '', null, addChoiceBtn, node.id);
  });
  choicesWrap.appendChild(addChoiceBtn);

  // Render existing choices AFTER addChoiceBtn exists in DOM
  node.choices.forEach(function(c) { appendChoiceRow(choiceList, c.text, c.nextId, addChoiceBtn, node.id); });
  // Set button visibility based on existing count
  addChoiceBtn.style.display = choiceList.querySelectorAll('.choice-row').length >= 4 ? 'none' : '';
  body.appendChild(choicesWrap);

  // Toggle choices on ending change
  endingWrap.querySelectorAll('input[type="radio"]').forEach(function(r) {
    r.addEventListener('change', function() {
      choicesWrap.style.display = this.value === 'yes' ? 'none' : '';
    });
  });

  // Delete button
  header.querySelector('.node-delete-btn').addEventListener('click', function() {
    deleteNode(parseInt(this.getAttribute('data-id')));
  });

  return card;
}

// -- Append a choice row to a choice list
function appendChoiceRow(container, text, nextId, addBtn, currentNodeId) {
  var row = document.createElement('div');
  row.className = 'choice-row';

  // Build options from current node list
  var options = '<option value="">-- dead end --</option>';
  builderState.nodes.forEach(function(n) {
    if (currentNodeId && n.id === currentNodeId) return; // can't link to self
    var sel = (nextId && parseInt(nextId) === n.id) ? ' selected' : '';
    options += '<option value="' + n.id + '"' + sel + '>' + nodeLabel(n) + '</option>';
  });

  row.innerHTML =
    '<input class="builder-input choice-text" type="text" placeholder="Choice text..." value="' + (text || '') + '" />' +
    '<select class="builder-input choice-next" data-owner-id="' + (currentNodeId || '') + '">' + options + '</select>' +
    '<button class="node-delete-btn choice-remove-btn">&#10005;</button>';

  row.querySelector('.choice-remove-btn').addEventListener('click', function() {
    row.remove();
    if (addBtn) addBtn.style.display = '';
  });
  container.appendChild(row);

  // Hide add button when at 4 choices
  if (addBtn && container.querySelectorAll('.choice-row').length >= 4) {
    addBtn.style.display = 'none';
  }
}

// -- Word count helper
function updateWc(ta, wcRef) {
  var text  = ta.value.trim();
  var words = text === '' ? 0 : text.split(/\s+/).length;
  // wcRef may be the element itself or an id string. Prefer the element so it
  // works even before the card is attached to the document.
  var el = (wcRef && wcRef.nodeType) ? wcRef : document.getElementById(wcRef);
  if (!el) return;
  var met  = words >= 300;
  el.textContent = words + ' / 300 words minimum';
  el.className   = 'builder-wc' + (met ? ' wc-met' : '');
}

// -- Update just the node list sidebar (without full re-render)
function updateNodeList() {
  var list = document.getElementById('nodes-container');
  if (!list) return;
  list.querySelectorAll('.builder-node-item').forEach(function(item) {
    var id   = parseInt(item.dataset.id);
    var node = builderState.nodes.find(function(n) { return n.id === id; });
    if (!node) return;
    item.querySelector('.bni-id').textContent = nodeLabel(node) + (node.isEnding ? '' : '');
  });
}

// -- Update all choice dropdowns across all cards
function updateAllChoiceDropdowns() {
  document.querySelectorAll('.choice-next').forEach(function(select) {
    var currentVal = select.value;
    var ownerId    = parseInt(select.getAttribute('data-owner-id')) || null;
    var options    = '<option value="">-- dead end --</option>';
    builderState.nodes.forEach(function(n) {
      if (ownerId && n.id === ownerId) return; // exclude self
      var sel = String(n.id) === String(currentVal) ? ' selected' : '';
      options += '<option value="' + n.id + '"' + sel + '>' + nodeLabel(n) + '</option>';
    });
    select.innerHTML = options;
  });
}

// -- Node count badge
function updateNodeCount() {
  var el = document.getElementById('node-count');
  if (el) el.textContent = builderState.nodes.length + (builderState.nodes.length === 1 ? ' Scene' : ' Scenes');
}

// -- Validation
function validateAll() {
  if (branchMode) {
    var choiceText = document.getElementById('branch-choice-text').value.trim();
    if (!choiceText) { alert('Please enter the choice text readers will click to reach your first scene.'); return false; }
  } else {
    var title   = document.getElementById('meta-title').value.trim();
    var summary = document.getElementById('meta-summary').value.trim();
    if (!title)   { alert('Please enter an adventure title.'); return false; }
    if (!summary) { alert('Please enter a library summary.'); return false; }
  }

  syncAllNodes();

  var errors = [];
  builderState.nodes.forEach(function(node) {
    var words = node.blurb.trim() === '' ? 0 : node.blurb.trim().split(/\s+/).length;
    if (!node.sceneName) {
      errors.push('Scene ' + node.id + ' needs a title.');
    }
    if (!node.blurb.trim()) {
      errors.push('Scene ' + node.id + ' has no text.');
    } else if (words < 300) {
      errors.push('Scene ' + node.id + ' needs 300+ words (' + words + ' so far).');
    }
    if (!node.isEnding && node.choices.length === 0) {
      errors.push('Scene ' + node.id + ' has no choices and is not an ending.');
    }
  });

  if (errors.length) {
    alert('Please fix before submitting:\n\n' + errors.join('\n'));
    return false;
  }
  return true;
}

// -- Submit all
async function submitAll() {
  if (!validateAll()) return;

  var title  = branchMode ? branchMode.story : document.getElementById('meta-title').value.trim();
  var author = (branchMode ? document.getElementById('branch-author') : document.getElementById('meta-author')).value.trim();
  var summary = branchMode ? '' : document.getElementById('meta-summary').value.trim();
  var choiceText = branchMode ? document.getElementById('branch-choice-text').value.trim() : '';

  var overlay    = document.getElementById('submit-overlay');
  var titleEl    = document.getElementById('submit-title');
  var progressEl = document.getElementById('submit-progress');
  var barEl      = document.getElementById('submit-bar');

  overlay.style.display = 'flex';

  var total  = builderState.nodes.length;
  var failed = 0;

  for (var i = 0; i < total; i++) {
    var node = builderState.nodes[i];
    progressEl.textContent = 'Submitting scene ' + (i + 1) + ' of ' + total + '...';
    barEl.style.width = Math.round((i / total) * 100) + '%';

    var data;
    if (branchMode) {
      // Each scene becomes its own newBranch record, all sharing the parent
      // node. The first scene declares the attach-choice; later scenes note
      // their cluster origin and encode internal wiring into the path text.
      data = {
        story:     title,
        author:    author,
        currentId: branchMode.parentNode,
        newBranchText: i === 0
          ? choiceText
          : '(cluster scene ' + (i + 1) + ' \u2014 reached from within this submission)',
        title:    node.sceneName,
        blurb:    node.blurb,
        tags:     node.tags.join(', '),
        isEnding: node.isEnding ? 'Yes' : 'No',
        path1:    branchPathText(node.choices[0]),
        path2:    branchPathText(node.choices[1]),
        path3:    branchPathText(node.choices[2]),
        path4:    branchPathText(node.choices[3])
      };
      var okB = await submitToGoogle('newBranch', data);
      if (!okB) failed++;
    } else {
      data = {
        story:    title,
        author:   author,
        summary:  i === 0 ? summary : '(see scene 1)',
        title:    node.sceneName,
        blurb:    node.blurb,
        tags:     node.tags.join(', '),
        isEnding: node.isEnding ? 'Yes' : 'No',
        path1:    node.choices[0] ? node.choices[0].text   : '',
        path1Id:  node.choices[0] ? String(node.choices[0].nextId || 'dead end') : '',
        path2:    node.choices[1] ? node.choices[1].text   : '',
        path2Id:  node.choices[1] ? String(node.choices[1].nextId || 'dead end') : '',
        path3:    node.choices[2] ? node.choices[2].text   : '',
        path3Id:  node.choices[2] ? String(node.choices[2].nextId || 'dead end') : '',
        path4:    node.choices[3] ? node.choices[3].text   : '',
        path4Id:  node.choices[3] ? String(node.choices[3].nextId || 'dead end') : '',
      };
      var ok = await submitToGoogle('newStory', data);
      if (!ok) failed++;
    }
    await new Promise(function(res) { setTimeout(res, 400); });
  }

  barEl.style.width = '100%';
  document.getElementById('submit-glyph').style.animation = 'none';

  if (failed === 0) {
    if (branchMode) {
      titleEl.textContent    = 'Scenes submitted!';
      progressEl.textContent = total + ' scene' + (total !== 1 ? 's' : '') + ' sent for review and will be added to the path. The admin will be in touch via Discord.';
    } else {
      titleEl.textContent    = 'Adventure submitted!';
      progressEl.textContent = total + ' scene' + (total !== 1 ? 's' : '') + ' sent for review. The admin will be in touch via Discord.';
    }
  } else {
    titleEl.textContent    = 'Partially submitted';
    progressEl.textContent = failed + ' of ' + total + ' scenes may not have sent. Please contact the admin on Discord.';
  }

  document.getElementById('submit-done-btn').style.display = '';
}

// Encode a choice's text plus its internal cluster target (if any) so the
// reviewer can see how the submitted scenes are meant to link together.
function branchPathText(choice) {
  if (!choice) return '';
  var label = choice.text || '';
  if (choice.nextId) {
    label += ' \u2192 [scene ' + choice.nextId + ' in this submission]';
  }
  return label;
}

// -- Apply a markdown format to the current textarea selection
function applyMarkdownFormat(ta, kind) {
  var start = ta.selectionStart;
  var end   = ta.selectionEnd;
  var value = ta.value;
  var selected = value.slice(start, end);

  function setValue(newVal, selStart, selEnd) {
    ta.value = newVal;
    ta.focus();
    ta.setSelectionRange(selStart, selEnd);
    // Fire input so word-count / state stay in sync
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  if (kind === 'bold' || kind === 'italic') {
    var marker = kind === 'bold' ? '**' : '*';
    if (selected) {
      // Toggle off if the selection is already wrapped
      var alreadyWrapped =
        value.slice(start - marker.length, start) === marker &&
        value.slice(end, end + marker.length) === marker;
      if (alreadyWrapped) {
        var unwrapped = value.slice(0, start - marker.length) + selected + value.slice(end + marker.length);
        setValue(unwrapped, start - marker.length, end - marker.length);
      } else {
        var wrapped = value.slice(0, start) + marker + selected + marker + value.slice(end);
        setValue(wrapped, start + marker.length, end + marker.length);
      }
    } else {
      // No selection — insert markers and place the cursor between them
      var placeholder = kind === 'bold' ? 'bold text' : 'italic text';
      var ins = marker + placeholder + marker;
      var nv = value.slice(0, start) + ins + value.slice(end);
      setValue(nv, start + marker.length, start + marker.length + placeholder.length);
    }
    return;
  }

  if (kind === 'quote') {
    // Prefix each selected line (or the current line) with "> "
    var lineStart = value.lastIndexOf('\n', start - 1) + 1;
    var lineEnd = value.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = value.length;
    var block = value.slice(lineStart, lineEnd);
    var quoted = block.split('\n').map(function(l){ return l.startsWith('> ') ? l : '> ' + l; }).join('\n');
    var nv = value.slice(0, lineStart) + quoted + value.slice(lineEnd);
    setValue(nv, lineStart, lineStart + quoted.length);
    return;
  }

  if (kind === 'heading') {
    // Prefix the current line with "## " (toggle off if already a heading)
    var hLineStart = value.lastIndexOf('\n', start - 1) + 1;
    var hLineEnd = value.indexOf('\n', start);
    if (hLineEnd === -1) hLineEnd = value.length;
    var line = value.slice(hLineStart, hLineEnd);
    var newLine, caretShift;
    if (/^#+\s/.test(line)) {
      newLine = line.replace(/^#+\s+/, '');
      caretShift = newLine.length - line.length;
    } else {
      newLine = '## ' + line;
      caretShift = 3;
    }
    var nv = value.slice(0, hLineStart) + newLine + value.slice(hLineEnd);
    setValue(nv, hLineStart, hLineStart + newLine.length);
    return;
  }

  if (kind === 'hr') {
    // Insert a scene divider on its own line after the cursor
    var before = value.slice(0, end);
    var after = value.slice(end);
    var prefix = before.endsWith('\n\n') ? '' : (before.endsWith('\n') ? '\n' : '\n\n');
    var suffix = after.startsWith('\n') ? '' : '\n';
    var ins = prefix + '---' + suffix;
    var nv = before + ins + after;
    var caret = before.length + ins.length;
    setValue(nv, caret, caret);
    return;
  }
}


// ── Markdown preview modal ────────────────────────────────────
function openMarkdownPreview(text, sceneTitle) {
  var overlay = document.getElementById('md-preview-overlay');
  var titleEl = document.getElementById('md-preview-scene');
  var bodyEl  = document.getElementById('md-preview-body');
  titleEl.textContent = sceneTitle || 'Scene';
  var src = (text || '').trim();
  if (!src) {
    bodyEl.innerHTML = '<p class="md-preview-empty">Nothing written yet — your scene text will appear here, formatted.</p>';
  } else if (window.marked) {
    // Links are stripped in the published reader, so strip them here too for an
    // accurate preview — render link markdown as its plain text only.
    var html = marked.parse(src);
    html = html.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1');
    bodyEl.innerHTML = html;
  } else {
    // Fallback if the markdown library hasn't loaded: show plain paragraphs
    bodyEl.innerHTML = src.split(/\n\n+/).map(function(p){
      return '<p>' + p.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\n/g,'<br>') + '</p>';
    }).join('');
  }
  overlay.style.display = 'flex';
}

// ── Markdown tips modal ───────────────────────────────────────
function openMarkdownTips() {
  document.getElementById('md-tips-overlay').style.display = 'flex';
}

// Wire modal close behaviour (backdrop click, close buttons, Escape)

// ── Story map (visualise scene connections) ───────────────────
function openStoryMap() {
  syncAllNodes();  // pull latest values from the cards into state
  var overlay = document.getElementById('story-map-overlay');
  var body    = document.getElementById('story-map-body');
  if (!overlay || !body) return;
  renderStoryMap(body);
  overlay.style.display = 'flex';
}

function renderStoryMap(container) {
  container.innerHTML = '';
  var nodes = builderState.nodes;
  if (!nodes.length) {
    container.innerHTML = '<p class="story-map-empty">No scenes yet.</p>';
    return;
  }

  var byId = {};
  nodes.forEach(function(n){ byId[n.id] = n; });

  // --- Assign each scene a depth (column) via BFS from the opening (id 1) ---
  var depth = {};
  var startId = byId[1] ? 1 : nodes[0].id;
  var queue = [startId];
  depth[startId] = 0;
  while (queue.length) {
    var cur = queue.shift();
    var node = byId[cur];
    if (!node) continue;
    (node.choices || []).forEach(function(c) {
      var t = c.nextId ? parseInt(c.nextId, 10) : null;
      if (t && byId[t] && depth[t] === undefined) {
        depth[t] = depth[cur] + 1;
        queue.push(t);
      }
    });
  }
  // Unreachable scenes get parked in a trailing column
  var maxDepth = 0;
  Object.keys(depth).forEach(function(k){ if (depth[k] > maxDepth) maxDepth = depth[k]; });
  var orphanCol = maxDepth + 1;
  nodes.forEach(function(n){ if (depth[n.id] === undefined) { depth[n.id] = orphanCol; } });

  // --- Group scenes by column ---
  var columns = {};
  nodes.forEach(function(n) {
    var d = depth[n.id];
    (columns[d] = columns[d] || []).push(n);
  });
  var colKeys = Object.keys(columns).map(Number).sort(function(a,b){ return a-b; });

  // --- Layout geometry ---
  var COL_W = 230, NODE_W = 180, NODE_H = 64, V_GAP = 28, PAD = 40;
  var positions = {};
  var maxRows = 0;
  colKeys.forEach(function(d){ if (columns[d].length > maxRows) maxRows = columns[d].length; });

  colKeys.forEach(function(d, ci) {
    var col = columns[d];
    var colHeight = col.length * NODE_H + (col.length - 1) * V_GAP;
    var totalHeight = maxRows * NODE_H + (maxRows - 1) * V_GAP;
    var startY = PAD + (totalHeight - colHeight) / 2;
    col.forEach(function(n, ri) {
      positions[n.id] = {
        x: PAD + ci * COL_W,
        y: startY + ri * (NODE_H + V_GAP)
      };
    });
  });

  var width  = PAD * 2 + (colKeys.length - 1) * COL_W + NODE_W;
  var height = PAD * 2 + maxRows * NODE_H + (maxRows - 1) * V_GAP;

  // --- Build the canvas ---
  var canvas = document.createElement('div');
  canvas.className = 'story-map-canvas';
  canvas.style.width  = width + 'px';
  canvas.style.height = height + 'px';

  // SVG edge layer
  var svgNS = 'http://www.w3.org/2000/svg';
  var svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'story-map-edges');
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);

  nodes.forEach(function(n) {
    var from = positions[n.id];
    if (!from) return;
    (n.choices || []).forEach(function(c) {
      var t = c.nextId ? parseInt(c.nextId, 10) : null;
      if (!t || !positions[t]) return;
      var to = positions[t];
      var x1 = from.x + NODE_W, y1 = from.y + NODE_H / 2;
      var x2 = to.x,            y2 = to.y + NODE_H / 2;
      var midX = (x1 + x2) / 2;
      var path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', 'M ' + x1 + ' ' + y1 + ' C ' + midX + ' ' + y1 + ', ' + midX + ' ' + y2 + ', ' + x2 + ' ' + y2);
      path.setAttribute('class', 'story-map-edge' + (x2 < x1 ? ' backward' : ''));
      svg.appendChild(path);
    });
  });
  canvas.appendChild(svg);

  // Scene boxes
  nodes.forEach(function(n) {
    var pos = positions[n.id];
    if (!pos) return;
    var box = document.createElement('button');
    var isOpening = n.id === (byId[1] ? 1 : nodes[0].id);
    box.className = 'story-map-node' +
      (isOpening ? ' opening' : '') +
      (n.isEnding ? ' ending' : '');
    box.style.left = pos.x + 'px';
    box.style.top  = pos.y + 'px';
    box.style.width = NODE_W + 'px';
    box.style.height = NODE_H + 'px';
    var choiceCount = (n.choices || []).filter(function(c){ return c.nextId; }).length;
    var meta = n.isEnding ? 'Ending' : (choiceCount + (choiceCount === 1 ? ' choice' : ' choices'));
    box.innerHTML =
      '<span class="story-map-node-id">Scene ' + n.id + '</span>' +
      '<span class="story-map-node-name">' + (n.sceneName ? escapeHtmlSM(n.sceneName) : '<em>Untitled</em>') + '</span>' +
      '<span class="story-map-node-meta">' + meta + '</span>';
    box.addEventListener('click', function() { jumpToScene(n.id); });
    canvas.appendChild(box);
  });

  container.appendChild(canvas);
}

function escapeHtmlSM(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Close the map and scroll to / expand the chosen scene's card
function jumpToScene(id) {
  var overlay = document.getElementById('story-map-overlay');
  if (overlay) overlay.style.display = 'none';
  var node = builderState.nodes.find(function(n){ return n.id === id; });
  if (node && node.collapsed) {
    syncAllNodes();          // capture current states first
    node.collapsed = false;  // then expand the target
    rebuildNodeCards();      // rebuild without re-reading the stale DOM
  }
  setTimeout(function() {
    var card = document.querySelector('[data-node-id="' + id + '"]');
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('node-card-flash');
      setTimeout(function(){ card.classList.remove('node-card-flash'); }, 1200);
    }
  }, 60);
}

function initBuilderModals() {
  ['md-preview-overlay', 'md-tips-overlay', 'story-map-overlay'].forEach(function(id) {
    var ov = document.getElementById(id);
    if (!ov) return;
    ov.addEventListener('click', function(e) { if (e.target === ov) ov.style.display = 'none'; });
    var closeBtn = ov.querySelector('.builder-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', function() { ov.style.display = 'none'; });
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      document.getElementById('md-preview-overlay').style.display = 'none';
      document.getElementById('md-tips-overlay').style.display = 'none';
      var sm = document.getElementById('story-map-overlay');
      if (sm) sm.style.display = 'none';
    }
  });
  var tipsBtn = document.getElementById('btn-md-tips');
  if (tipsBtn) tipsBtn.addEventListener('click', openMarkdownTips);
  var mapBtn = document.getElementById('btn-story-map');
  if (mapBtn) mapBtn.addEventListener('click', openStoryMap);
}


// -- Wire top-level buttons
document.getElementById('btn-add-node').addEventListener('click', addNode);
initBuilderModals();

// Collapse all scenes (always collapses; never toggles to expand)
(function() {
  var btn = document.getElementById('btn-collapse-all');
  if (!btn) return;
  btn.addEventListener('click', function() {
    syncAllNodes(); // capture current states + field values into the model
    builderState.nodes.forEach(function(n){ n.collapsed = true; });
    // Rebuild WITHOUT re-syncing from the DOM (a re-sync would read the
    // not-yet-rerendered cards and overwrite what we just set).
    rebuildNodeCards();
  });
})();

// Confirm before leaving if any scenes have been written
document.querySelector('.builder-back').addEventListener('click', function(e) {
  var hasContent = Array.from(document.querySelectorAll('.node-blurb')).some(function(ta) { return ta.value && ta.value.trim(); });
  var titleFilled = document.getElementById('meta-title') && document.getElementById('meta-title').value.trim();
  if (hasContent || titleFilled) {
    if (!confirm('Leave this page? Any unsaved writing will be lost.')) {
      e.preventDefault();
    }
  }
});
document.getElementById('btn-submit-all').addEventListener('click', submitAll);
document.getElementById('submit-done-btn').addEventListener('click', function() {
  window.location.href = 'index.html';
});

initBuilder();
