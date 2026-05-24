/* ===============================================
   Sinverse -- Form Submission Handler
   submit.js
   =============================================== */

'use strict';

const FORMS = {
  newStory: {
    action: 'https://docs.google.com/forms/d/e/1FAIpQLSfAAPRWFs2TL4QVBlx6GCzEhMKxdny0rCrJwzZnCAG_L611Wg/formResponse',
    fields: {
      story:     'entry.1758226504',
      author:    'entry.1046349014',
      summary:   'entry.896008103',
      storyTags: 'entry.984415706',
      blurb:     'entry.120272987',
      tags:      'entry.1419124577',
      imageLink: 'entry.462250081',
      theme:     'entry.613272446',
      isEnding:  'entry.1607455706',
      path1:     'entry.1303831148',
      path1Id:   'entry.1932009715',
      path2:     'entry.1265254790',
      path2Id:   'entry.1373190640',
      path3:     'entry.1088383893',
      path3Id:   'entry.380826477',
      path4:     'entry.1926641281',
      path4Id:   'entry.15030012',
    }
  },
  newBranch: {
    action: 'https://docs.google.com/forms/d/e/1FAIpQLSd-I4_dxSj7fdOfvkQkUnDA7zKea2-TAvrPmR2IMnyfnsbETw/formResponse',
    fields: {
      story:         'entry.1758226504',
      author:        'entry.1046349014',
      currentId:     'entry.1846449635',
      newBranchText: 'entry.1810102385',
      blurb:         'entry.120272987',
      tags:          'entry.1419124577',
      imageLink:     'entry.462250081',
      theme:         'entry.613272446',
      isEnding:      'entry.1933267705',
      path1:         'entry.1303831148',
      path2:         'entry.1265254790',
      path3:         'entry.1088383893',
      path4:         'entry.1926641281',
    }
  }
};

const THEMES = ['dark', 'warm', 'neutral', 'tense', 'sensual'];
// Story-level tags -- shown on library card, describe the story overall
const STORY_TAGS = [
  'explicit', 'sensual', 'romance', 'dubcon', 'non-con', 'bdsm', 'bondage', 'dominance', 'submission',
  'violence', 'dark themes', 'trauma', 'psychological', 'grief', 'horror', 'mystery', 'fantasy', 'sci-fi', 'thriller'
];

// Node-level content tags -- warn readers before entering a specific scene
const NODE_TAGS = [
  'explicit', 'sensual', 'dubcon', 'non-con', 'bdsm', 'bondage', 'dominance', 'submission',
  'violence', 'character death', 'body horror', 'gore', 'dark themes', 'trauma', 'psychological'
];

// -- Submit to Google Forms silently --
async function submitToGoogle(formKey, data) {
  const form = FORMS[formKey];
  const body = new FormData();
  Object.entries(data).forEach(function(entry) {
    var key = entry[0], val = entry[1];
    if (form.fields[key] && val) body.append(form.fields[key], val);
  });
  try {
    await fetch(form.action, { method: 'POST', mode: 'no-cors', body: body });
    return true;
  } catch(e) {
    return false;
  }
}

// -- Render a single field --
function renderField(f) {
  if (f.type === 'hidden') {
    return '<input type="hidden" data-field="' + f.key + '" value="' + (f.value || '') + '" />';
  }

  var req     = f.required ? ' <span class="submit-required">*</span>' : '';
  var hint    = f.hint ? ' <span class="submit-hint">' + f.hint + '</span>' : '';
  var label   = '<label class="submit-label">' + f.label + req + hint + '</label>';

  if (f.type === 'text') {
    var ro      = f.readonly ? ' readonly' : '';
    var val     = f.value ? ' value="' + f.value + '"' : '';
    var pathAttr = f.pathField ? ' data-path-field="1"' : '';
    return '<div class="submit-field"' + pathAttr + '>' + label + '<input class="submit-input" data-field="' + f.key + '" type="text" placeholder="' + (f.placeholder || '') + '"' + ro + val + ' /></div>';
  }

  if (f.type === 'textarea') {
    var min     = f.minWords || 0;
    var wcId    = 'wc-' + f.key;
    var minAttr = min ? ' data-min-words="' + min + '"' : '';
    var wcHtml  = min ? '<div id="' + wcId + '" class="word-count"><span class="wc-hint">0 / ' + min + ' words minimum</span></div>' : '<div id="' + wcId + '" class="word-count"><span class="wc-hint">0 words</span></div>';
    return '<div class="submit-field">' + label + '<textarea class="submit-input submit-textarea" data-field="' + f.key + '" data-wc-id="' + wcId + '" placeholder="' + (f.placeholder || '') + '" rows="5"' + minAttr + '>' + (f.value || '') + '</textarea>' + wcHtml + '</div>';
  }

  if (f.type === 'checkboxes') {
    var boxes = f.options.map(function(opt) {
      return '<label class="submit-checkbox-label"><input type="checkbox" data-field="' + f.key + '" value="' + opt + '" />' + opt + '</label>';
    }).join('');
    return '<div class="submit-field">' + label + '<div class="submit-checkboxes">' + boxes + '</div></div>';
  }

  if (f.type === 'toggle') {
    var hint2 = f.hint ? ' <span class="submit-hint">' + f.hint + '</span>' : '';
    var label2 = '<label class="submit-label">' + f.label + hint2 + '</label>';
    return '<div class="submit-field" data-toggle-field="' + f.key + '">' + label2 +
      '<div class="submit-toggle-row">' +
        '<label class="submit-checkbox-label"><input type="radio" name="' + f.key + '" data-field="' + f.key + '" value="false" checked /> No</label>' +
        '<label class="submit-checkbox-label"><input type="radio" name="' + f.key + '" data-field="' + f.key + '" value="true" /> Yes -- this scene is a story ending</label>' +
      '</div>' +
    '</div>';
  }
  if (f.type === 'radio') {
    var radios = f.options.map(function(opt) {
      return '<label class="submit-checkbox-label"><input type="radio" name="' + f.key + '" data-field="' + f.key + '" value="' + opt + '" />' + opt + '</label>';
    }).join('');
    return '<div class="submit-field">' + label + '<div class="submit-checkboxes">' + radios + '</div></div>';
  }

  return '';
}

// -- Wire word count listeners after DOM insert --
function wireWordCount(container) {
  container.querySelectorAll('textarea[data-wc-id]').forEach(function(ta) {
    var wcId     = ta.getAttribute('data-wc-id');
    var minWords = parseInt(ta.getAttribute('data-min-words') || '0');

    function update() {
      var text  = ta.value.trim();
      var words = text === '' ? 0 : text.split(/\s+/).length;
      var el    = document.getElementById(wcId);
      if (!el) return;
      var met  = minWords ? words >= minWords : true;
      var label = minWords ? words + ' / ' + minWords + ' words minimum' : words + ' words';
      el.innerHTML = '<span class="wc-hint' + (met && words > 0 ? ' wc-met' : '') + '">' + label + '</span>';
      ta.setAttribute('data-wc-ok', (met && words > 0) ? '1' : '0');
    }

    ta.addEventListener('input', update);
    update();
  });
}

// -- Validate form before submit --
function validateForm(overlay, fields) {
  overlay.querySelectorAll('.submit-field-error').forEach(function(e) { e.remove(); });
  overlay.querySelectorAll('.submit-input-error').forEach(function(e) { e.classList.remove('submit-input-error'); });

  var valid = true;

  // Check if isEnding is set
  var isEndingEl = overlay.querySelector('input[data-field="isEnding"]:checked');
  var isEnding   = isEndingEl && isEndingEl.value === 'true';

  fields.forEach(function(f) {
    if (f.type === 'hidden' || f.type === 'checkboxes') return;
    // Skip path fields if this is an ending
    if (f.pathField && isEnding) return;

    var el = overlay.querySelector('[data-field="' + f.key + '"]');
    if (!el || el.type === 'hidden') return;

    var val = el.value.trim();

    if (f.required && val === '') {
      showFieldError(el, 'This field is required.');
      valid = false;
      return;
    }

    var minWords = parseInt(el.getAttribute('data-min-words') || '0');
    if (minWords && val !== '') {
      var words = val.split(/\s+/).length;
      if (words < minWords) {
        showFieldError(el, 'Minimum ' + minWords + ' words required (currently ' + words + ').');
        valid = false;
      }
    }
  });

  return valid;
}

function showFieldError(el, msg) {
  el.classList.add('submit-input-error');
  var err = document.createElement('span');
  err.className   = 'submit-field-error';
  err.textContent = msg;
  el.parentNode.insertBefore(err, el.nextSibling);
  el.addEventListener('input', function() {
    err.remove();
    el.classList.remove('submit-input-error');
  }, { once: true });
}

// -- Build modal --
function buildFormModal(opts) {
  var title    = opts.title;
  var subtitle = opts.subtitle;
  var fields   = opts.fields;
  var onSubmit = opts.onSubmit;
  var onClose  = opts.onClose;

  var overlay = document.createElement('div');
  overlay.className = 'submit-modal-overlay';

  var box = document.createElement('div');
  box.className = 'submit-modal';

  var formHtml = fields.map(renderField).join('');

  box.innerHTML =
    '<div class="submit-modal-header">' +
      '<div>' +
        '<div class="submit-modal-title">' + title + '</div>' +
        '<div class="submit-modal-subtitle">' + subtitle + '</div>' +
      '</div>' +
      '<button class="submit-modal-close" aria-label="Close">X</button>' +
    '</div>' +
    '<div class="submit-modal-body">' +
      '<form id="sinverse-submit-form" autocomplete="off" novalidate>' +
        formHtml +
        '<div class="submit-modal-actions">' +
          '<button type="submit" class="btn-primary">Submit</button>' +
          '<button type="button" class="btn-ghost submit-cancel-btn">Cancel</button>' +
        '</div>' +
        '<p class="submit-anon-note">Submissions are anonymous. Your handle is only used for author credit if provided.</p>' +
      '</form>' +
    '</div>';

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  // Wire word count now that DOM exists
  wireWordCount(box);

  // Wire isEnding toggle to show/hide path fields
  var isEndingRadios = box.querySelectorAll('input[data-field="isEnding"]');
  if (isEndingRadios.length) {
    function updatePathVisibility() {
      var isEnding = box.querySelector('input[data-field="isEnding"]:checked');
      var ending   = isEnding && isEnding.value === 'true';
      box.querySelectorAll('.submit-field[data-path-field]').forEach(function(el) {
        el.style.display = ending ? 'none' : '';
        // Clear required errors if hidden
        if (ending) {
          var inp = el.querySelector('input');
          if (inp) { inp.classList.remove('submit-input-error'); }
          var err = el.querySelector('.submit-field-error');
          if (err) err.remove();
        }
      });
    }
    isEndingRadios.forEach(function(r) { r.addEventListener('change', updatePathVisibility); });
    updatePathVisibility();
  }

  // Close handlers
  function close() { overlay.remove(); if (onClose) onClose(); }
  box.querySelector('.submit-modal-close').addEventListener('click', close);
  box.querySelector('.submit-cancel-btn').addEventListener('click', close);
  overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });

  // Submit handler
  box.querySelector('#sinverse-submit-form').addEventListener('submit', function(e) {
    e.preventDefault();

    if (!validateForm(overlay, fields)) {
      // Scroll to first error
      var firstErr = overlay.querySelector('.submit-input-error');
      if (firstErr) firstErr.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    var data = {};
    fields.forEach(function(f) {
      if (f.type === 'checkboxes') {
        var checked = Array.from(overlay.querySelectorAll('input[data-field="' + f.key + '"]:checked'))
          .map(function(cb) { return cb.value; }).join(', ');
        data[f.key] = checked;
      } else if (f.type === 'radio') {
        var sel = overlay.querySelector('input[data-field="' + f.key + '"]:checked');
        data[f.key] = sel ? sel.value : '';
      } else {
        var el = overlay.querySelector('[data-field="' + f.key + '"]');
        data[f.key] = el ? el.value.trim() : '';
      }
    });

    var submitBtn = box.querySelector('[type="submit"]');
    submitBtn.textContent = 'Sending...';
    submitBtn.disabled    = true;

    onSubmit(data).then(function(ok) {
      if (ok) {
        box.innerHTML =
          '<div class="submit-success">' +
            '<div class="submit-success-glyph">*</div>' +
            '<div class="submit-success-title">Submission received</div>' +
            '<p class="submit-success-body">Thank you. The admin will review your submission and may reach out via Discord.</p>' +
            '<button class="btn-ghost" id="submit-done-btn">Close</button>' +
          '</div>';
        box.querySelector('#submit-done-btn').addEventListener('click', close);
      } else {
        submitBtn.textContent = 'Submit';
        submitBtn.disabled    = false;
        var errEl = overlay.querySelector('.submit-error');
        if (!errEl) {
          errEl = document.createElement('p');
          errEl.className   = 'submit-error';
          errEl.textContent = 'Something went wrong. Please try again or contact the admin on Discord.';
          overlay.querySelector('.submit-modal-actions').before(errEl);
        }
      }
    });
  });
}

// -- Public API --

window.showNewStoryForm = function() {
  buildFormModal({
    title:    'Pitch a New Story',
    subtitle: 'Propose a brand new story for the Sinverse universe',
    fields: [
      { key: 'story',     type: 'text',       label: 'Story title',         placeholder: 'The Velvet Room',                           required: true  },
      { key: 'author',    type: 'text',       label: 'Your handle',         placeholder: 'Optional -- for author credit on each node', hint: '(optional)' },
      { key: 'summary',   type: 'text',       label: 'Library summary',     placeholder: 'One or two sentences shown on the library card', required: true },
      { key: 'blurb',     type: 'textarea',   label: 'Opening scene',       placeholder: 'Write the first scene readers will encounter...', required: true, minWords: 300 },
      { key: 'path1',     type: 'text',       label: 'Choice 1',            placeholder: 'First choice text',                         required: true  },
      { key: 'path2',     type: 'text',       label: 'Choice 2',            placeholder: 'Second choice text',                        required: true  },
      { key: 'path3',     type: 'text',       label: 'Choice 3',            placeholder: 'Third choice text',                         hint: '(optional)' },
      { key: 'path4',     type: 'text',       label: 'Choice 4',            placeholder: 'Fourth choice text',                        hint: '(optional)' },
      { key: 'storyTags', type: 'checkboxes', label: 'Story tags',           options: TAGS.cyoa, hint: '(describe the overall story)' },
      { key: 'theme',     type: 'radio',      label: 'Opening scene theme', options: THEMES,   required: true },
      { key: 'imageLink', type: 'text',       label: 'Image URL',           placeholder: 'Optional link to a cover image',            hint: '(optional)' },
    ],
    onSubmit: function(data) { return submitToGoogle('newStory', data); }
  });
};

window.showNewBranchForm = function(storyTitle, nodeId, branchText) {
  var isDeadEnd = !branchText;

  buildFormModal({
    title:    isDeadEnd ? 'Continue This Path' : 'Add a Branch',
    subtitle: isDeadEnd ? 'Write the next scene for this unwritten path' : 'Add a new branch from this scene',
    fields: [
      { key: 'story',         type: 'hidden',     value: storyTitle },
      { key: 'currentId',     type: 'hidden',     value: String(nodeId) },
      { key: 'newBranchText', type: 'text',       label: 'New choice text',  placeholder: 'The button label readers click to reach your scene', value: branchText || '', required: true },
      { key: 'author',        type: 'text',       label: 'Your handle',      placeholder: 'Optional -- for author credit', hint: '(optional)' },
      { key: 'blurb',         type: 'textarea',   label: 'Scene text',       placeholder: 'Write your scene here...', required: true, minWords: 300 },
      { key: 'tags',          type: 'checkboxes', label: 'Scene content tags', options: TAGS.story, hint: '(warn readers before entering this scene)' },
      { key: 'theme',         type: 'radio',      label: 'Scene theme',      options: THEMES, required: true },
      { key: 'isEnding',      type: 'toggle',     label: 'Is this an ending?', hint: 'If yes, path choices are not needed' },
      { key: 'path1',         type: 'text',       label: 'Choice 1',         placeholder: 'First choice text',  required: true, pathField: true },
      { key: 'path2',         type: 'text',       label: 'Choice 2',         placeholder: 'Second choice text', required: true, pathField: true },
      { key: 'path3',         type: 'text',       label: 'Choice 3',         placeholder: 'Third choice text',  hint: '(optional)', pathField: true },
      { key: 'path4',         type: 'text',       label: 'Choice 4',         placeholder: 'Fourth choice text', hint: '(optional)', pathField: true },
      { key: 'imageLink',     type: 'text',       label: 'Image URL',        placeholder: 'Optional link to a scene image', hint: '(optional)' },
    ],
    onSubmit: function(data) { return submitToGoogle('newBranch', data); }
  });
};