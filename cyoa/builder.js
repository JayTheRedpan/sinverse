'use strict';

// -- State
var builderState = {
  nodes:    [],
  activeId: null,
  nextId:   1,
};

// Tag lists -- avoid redeclaring consts from submit.js
var BUILDER_THEMES     = ['dark', 'warm', 'neutral', 'tense', 'sensual'];
var BUILDER_STORY_TAGS = ['explicit','sensual','romance','dubcon','non-con','bdsm','bondage','dominance','submission','violence','dark themes','horror','mystery','fantasy','sci-fi','thriller','trauma','psychological','grief','size difference','macro','micro'];
var BUILDER_NODE_TAGS  = ['explicit','sensual','dubcon','non-con','bdsm','bondage','dominance','submission','violence','character death','body horror','gore','dark themes','trauma','psychological','size difference'];

// -- Boot
async function initBuilder() {
  // Load canonical tags from central registry if available
  try {
    var res = await fetch('../_data/tags.json');
    if (res.ok) {
      var tagData = await res.json();
      if (tagData.cyoa)  BUILDER_STORY_TAGS = tagData.cyoa;
      if (tagData.story) BUILDER_NODE_TAGS  = tagData.story;
    }
  } catch(e) { /* use fallback arrays above */ }

  buildMetaTags();
  addNode();
}

// -- Story-level tag checkboxes
function buildMetaTags() {
  var container = document.getElementById('meta-tags');
  if (!container) return;
  BUILDER_STORY_TAGS.forEach(function(tag) {
    var label = document.createElement('label');
    label.className = 'builder-tag-label';
    label.innerHTML = '<input type="checkbox" value="' + tag + '" /> ' + tag;
    container.appendChild(label);
  });
}

// -- Add a new node and render its card
function addNode() {
  var node = {
    id:        builderState.nextId++,
    sceneName: '',
    blurb:     '',
    theme:     'neutral',
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

  var themeEl = card.querySelector('input[name="theme-' + id + '"]:checked');
  node.theme  = themeEl ? themeEl.value : 'neutral';

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
  card.className = 'node-card';
  card.setAttribute('data-node-id', node.id);

  // Header
  var header = document.createElement('div');
  header.className = 'node-card-header';
  header.innerHTML =
    '<div class="node-card-header-left">' +
      '<span class="node-card-label">Scene ' + node.id + (node.id === 1 ? ' <span class="node-opening-badge">Opening</span>' : '') + '</span>' +
      '<input class="node-scene-name builder-input" type="text" placeholder="Scene title (optional)" value="' + (node.sceneName || '') + '" />' +
    '</div>' +
    '<button class="node-delete-btn" data-id="' + node.id + '">&#10005; Delete</button>';
  card.appendChild(header);

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
    '<label class="node-label">Scene text <span class="req">*</span></label>' +
    '<textarea class="builder-input node-blurb" rows="6" placeholder="Write your scene here...">' + (node.blurb || '') + '</textarea>' +
    '<div id="' + wcId + '" class="builder-wc">0 / 300 words minimum</div>';
  card.appendChild(blurbWrap);

  // Wire word count
  var ta = blurbWrap.querySelector('textarea');
  ta.addEventListener('input', function() { updateWc(this, wcId); });
  updateWc(ta, wcId);

  // Theme
  var themeWrap = document.createElement('div');
  themeWrap.className = 'node-field';
  var themeHtml = '<label class="node-label">Theme</label><div class="node-radio-row">';
  BUILDER_THEMES.forEach(function(t) {
    themeHtml += '<label class="builder-radio-label"><input type="radio" name="theme-' + node.id + '" value="' + t + '"' + (node.theme === t ? ' checked' : '') + ' /> ' + t + '</label>';
  });
  themeHtml += '</div>';
  themeWrap.innerHTML = themeHtml;
  card.appendChild(themeWrap);

  // Content tags
  var tagsWrap = document.createElement('div');
  tagsWrap.className = 'node-field';
  var tagsHtml = '<label class="node-label">Content tags</label><div class="builder-tag-grid">';
  BUILDER_NODE_TAGS.forEach(function(t) {
    tagsHtml += '<label class="builder-tag-label"><input type="checkbox" class="node-tag-cb" value="' + t + '"' + (node.tags.includes(t) ? ' checked' : '') + ' /> ' + t + '</label>';
  });
  tagsHtml += '</div>';
  tagsWrap.innerHTML = tagsHtml;
  card.appendChild(tagsWrap);

  // Is ending toggle
  var endingWrap = document.createElement('div');
  endingWrap.className = 'node-field';
  endingWrap.innerHTML =
    '<label class="node-label">Is this an ending?</label>' +
    '<div class="node-radio-row">' +
      '<label class="builder-radio-label"><input type="radio" name="ending-' + node.id + '" value="no"' + (!node.isEnding ? ' checked' : '') + ' /> No</label>' +
      '<label class="builder-radio-label"><input type="radio" name="ending-' + node.id + '" value="yes"' + (node.isEnding ? ' checked' : '') + ' /> Yes</label>' +
    '</div>';
  card.appendChild(endingWrap);

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
  card.appendChild(choicesWrap);

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
function updateWc(ta, wcId) {
  var text  = ta.value.trim();
  var words = text === '' ? 0 : text.split(/\s+/).length;
  var el    = document.getElementById(wcId);
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
  if (el) el.textContent = builderState.nodes.length;
}

// -- Validation
function validateAll() {
  var title   = document.getElementById('meta-title').value.trim();
  var summary = document.getElementById('meta-summary').value.trim();
  if (!title)   { alert('Please enter a story title.'); return false; }
  if (!summary) { alert('Please enter a library summary.'); return false; }

  syncAllNodes();

  var errors = [];
  builderState.nodes.forEach(function(node) {
    var words = node.blurb.trim() === '' ? 0 : node.blurb.trim().split(/\s+/).length;
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

  var title  = document.getElementById('meta-title').value.trim();
  var author = document.getElementById('meta-author').value.trim();
  var summary = document.getElementById('meta-summary').value.trim();
  var storyTags = Array.from(document.querySelectorAll('#meta-tags input:checked')).map(function(cb) { return cb.value; }).join(', ');

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

    var data = {
      story:    title,
      storyTags: i === 0 ? storyTags : '',
      author:   author,
      summary:  i === 0 ? summary : '(see scene 1)',
      blurb:    node.blurb,
      tags:     node.tags.join(', '),
      theme:    node.theme,
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
    await new Promise(function(res) { setTimeout(res, 400); });
  }

  barEl.style.width = '100%';
  document.getElementById('submit-glyph').style.animation = 'none';

  if (failed === 0) {
    titleEl.textContent    = 'Story submitted!';
    progressEl.textContent = total + ' scene' + (total !== 1 ? 's' : '') + ' sent for review. The admin will be in touch via Discord.';
  } else {
    titleEl.textContent    = 'Partially submitted';
    progressEl.textContent = failed + ' of ' + total + ' scenes may not have sent. Please contact the admin on Discord.';
  }

  document.getElementById('submit-done-btn').style.display = '';
}

// -- Wire top-level buttons
document.getElementById('btn-add-node').addEventListener('click', addNode);
document.getElementById('btn-submit-all').addEventListener('click', submitAll);
document.getElementById('submit-done-btn').addEventListener('click', function() {
  window.location.href = 'index.html';
});

initBuilder();