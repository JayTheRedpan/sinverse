/* ===============================================
   Sinverse -- Form Submission Handler
   submit.js
   =============================================== */

'use strict';

// Load content tags from tags.json
fetch('../_data/tags.json')
  .then(function(r){ return r.json(); })
  .then(function(data){ NODE_TAGS = data.story || []; })
  .catch(function(){ /* leave empty if unavailable */ });


// Single unified submission form. Every scene — whether it's part of a brand
// new story or a branch added to an existing story — posts one row here.
// `submissionType` ('story' | 'branch') distinguishes them; story scenes leave
// parentId/branchText blank, branch scenes leave summary/pathId blank.
// NOTE: the entry.* IDs below are placeholders — replace each with the real ID
// from the unified form's "Get pre-filled link" URL.
// ── FORM DEFINITIONS: maps each submission type to its Google Form fields ─
const FORMS = {
  submission: {
    action: 'https://docs.google.com/forms/d/e/1FAIpQLSedyP4gmr2lOZoYpEh_4Vnd6fECDwLLT_Mrjj8NznOlRrrdeA/formResponse',
    fields: {
      submissionType: 'entry.1177017336',
      story:          'entry.1163655137',
      author:         'entry.687642526',
      sceneId:        'entry.1117435850',
      parentId:       'entry.1297230468',
      branchText:     'entry.1866009772',
      summary:        'entry.1871137109',
      title:          'entry.2066354214',
      blurb:          'entry.853816147',
      tags:           'entry.1375708215',
      isEnding:       'entry.436306734',
      imageLink:      'entry.866353116',
      path1:          'entry.1483163042',
      path1Id:        'entry.1254249639',
      path2:          'entry.1219434053',
      path2Id:        'entry.60165910',
      path3:          'entry.1815825692',
      path3Id:        'entry.962906094',
      path4:          'entry.849792395',
      path4Id:        'entry.704030206',
    }
  }
};


// Story-level tags -- shown on library card, describe the story overall
// Node-level content tags -- loaded from tags.json on init
var NODE_TAGS = [];

// -- Submit to Google Forms silently --
// ── SUBMIT: post the collected data to the Google Form endpoint ───────────
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
// ── FIELD RENDERING: build each input type in the modal form ──────────────
function renderField(f) {
  if (f.type === 'hidden') {
    return '<input type="hidden" data-field="' + f.key + '" value="' + (f.value || '') + '" />';
  }

  var req     = f.required ? ' <span class="submit-required">*</span>' : '';
  var hint    = f.hint ? ' <span class="submit-hint">' + f.hint + '</span>' : '';
  var label   = '<label class="submit-label">' + f.label + req + hint + '</label>';

  if (f.type === 'choices') {
    // Placeholder — wired up by buildFormModal after innerHTML is set
    return '<div class="submit-field" data-choices-start="' + (f.startCount||1) + '" data-choices-max="' + (f.max||4) + '">' +
      '<label class="submit-label">' + f.label + '</label>' +
      '<div class="modal-choice-list"></div>' +
      '<button type="button" class="modal-add-choice-btn">+ Add choice</button>' +
    '</div>';
  }

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
    var toolbar = '';
    if (f.markdownTools) {
      toolbar =
        '<div class="submit-md-toolbar" data-for="' + f.key + '">' +
          '<button type="button" class="md-tool-btn" data-md="bold" title="Bold (wrap in **)"><strong>B</strong></button>' +
          '<button type="button" class="md-tool-btn" data-md="italic" title="Italic (wrap in *)"><em>I</em></button>' +
          '<button type="button" class="md-tool-btn" data-md="heading" title="Heading">H</button>' +
          '<button type="button" class="md-tool-btn" data-md="quote" title="Block quote">&#8220;&#8221;</button>' +
          '<button type="button" class="md-tool-btn" data-md="hr" title="Scene divider">&#8213;</button>' +
          '<button type="button" class="submit-md-preview" data-for="' + f.key + '">&#128065; Preview</button>' +
          '<button type="button" class="submit-md-tips">&#9998; Tips</button>' +
        '</div>';
    }
    return '<div class="submit-field">' + label + toolbar + '<textarea class="submit-input submit-textarea" data-field="' + f.key + '" data-wc-id="' + wcId + '" placeholder="' + (f.placeholder || '') + '" rows="5"' + minAttr + '>' + (f.value || '') + '</textarea>' + wcHtml + '</div>';
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
// ── EDITOR HELPERS: word count + markdown formatting toolbar + preview ────
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


// -- Markdown formatting toolbar / preview / tips for submit-modal textareas --
function wireMarkdownTools(container) {
  container.querySelectorAll('.submit-md-toolbar').forEach(function(bar) {
    var key = bar.getAttribute('data-for');
    var ta  = container.querySelector('textarea[data-field="' + key + '"]');
    if (!ta) return;
    bar.querySelectorAll('.md-tool-btn').forEach(function(btn) {
      btn.addEventListener('mousedown', function(e) {
        e.preventDefault();
        applyMarkdownFormatSubmit(ta, btn.getAttribute('data-md'));
      });
    });
    var prev = bar.querySelector('.submit-md-preview');
    if (prev) prev.addEventListener('click', function() { openSubmitPreview(ta.value); });
    var tips = bar.querySelector('.submit-md-tips');
    if (tips) tips.addEventListener('click', openSubmitTips);
  });
}

function applyMarkdownFormatSubmit(ta, kind) {
  var start = ta.selectionStart, end = ta.selectionEnd, value = ta.value;
  var selected = value.slice(start, end);
  function setValue(nv, s, e) {
    ta.value = nv; ta.focus(); ta.setSelectionRange(s, e);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (kind === 'bold' || kind === 'italic') {
    var marker = kind === 'bold' ? '**' : '*';
    if (selected) {
      var wrapped = value.slice(start - marker.length, start) === marker && value.slice(end, end + marker.length) === marker;
      if (wrapped) {
        setValue(value.slice(0, start - marker.length) + selected + value.slice(end + marker.length), start - marker.length, end - marker.length);
      } else {
        setValue(value.slice(0, start) + marker + selected + marker + value.slice(end), start + marker.length, end + marker.length);
      }
    } else {
      var ph = kind === 'bold' ? 'bold text' : 'italic text';
      var ins = marker + ph + marker;
      setValue(value.slice(0, start) + ins + value.slice(end), start + marker.length, start + marker.length + ph.length);
    }
    return;
  }
  if (kind === 'heading') {
    var ls = value.lastIndexOf('\n', start - 1) + 1;
    var le = value.indexOf('\n', start); if (le === -1) le = value.length;
    var line = value.slice(ls, le), nl;
    if (/^#+\s/.test(line)) nl = line.replace(/^#+\s+/, '');
    else nl = '## ' + line;
    setValue(value.slice(0, ls) + nl + value.slice(le), ls, ls + nl.length);
    return;
  }
  if (kind === 'quote') {
    var qs = value.lastIndexOf('\n', start - 1) + 1;
    var qe = value.indexOf('\n', end); if (qe === -1) qe = value.length;
    var block = value.slice(qs, qe);
    var quoted = block.split('\n').map(function(l){ return l.startsWith('> ') ? l : '> ' + l; }).join('\n');
    setValue(value.slice(0, qs) + quoted + value.slice(qe), qs, qs + quoted.length);
    return;
  }
  if (kind === 'hr') {
    var before = value.slice(0, end), after = value.slice(end);
    var prefix = before.endsWith('\n\n') ? '' : (before.endsWith('\n') ? '\n' : '\n\n');
    var suffix = after.startsWith('\n') ? '' : '\n';
    var ins = prefix + '---' + suffix;
    var caret = before.length + ins.length;
    setValue(before + ins + after, caret, caret);
    return;
  }
}

function renderSubmitMarkdown(src) {
  if (!window.marked) {
    return src.split(/\n\n+/).map(function(p){
      return '<p>' + p.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\n/g,'<br>') + '</p>';
    }).join('');
  }
  // Strip links — submitted scenes must not contain clickable links
  return marked.parse(src).replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1');
}

function openSubmitPreview(text) {
  var src = (text || '').trim();
  var body = src ? renderSubmitMarkdown(src) : '<p class="md-preview-empty">Nothing written yet — your scene text will appear here, formatted.</p>';
  showSubmitInfoModal('Preview', 'Scene', '<div class="md-preview-render">' + body + '</div>');
}

function openSubmitTips() {
  var html =
    '<p>Scene text supports <strong>Markdown</strong> — a simple way to add formatting. You don\'t have to use any of it, but here\'s what you can do.</p>' +
    '<div class="md-tips-subhead">The basics</div>' +
    '<table class="md-tips-table">' +
      '<tr><th>To get this</th><th>Type this</th></tr>' +
      '<tr><td><em>italic</em></td><td><code>*italic*</code></td></tr>' +
      '<tr><td><strong>bold</strong></td><td><code>**bold**</code></td></tr>' +
      '<tr><td><strong><em>bold italic</em></strong></td><td><code>***both***</code></td></tr>' +
      '<tr><td>A new paragraph</td><td>Leave a <strong>blank line</strong> between paragraphs</td></tr>' +
      '<tr><td>A line break (same paragraph)</td><td>End a line with two spaces</td></tr>' +
      '<tr><td>A scene break / divider</td><td><code>---</code> on its own line</td></tr>' +
    '</table>' +
    '<div class="md-tips-subhead">Neat extras</div>' +
    '<table class="md-tips-table">' +
      '<tr><th>To get this</th><th>Type this</th></tr>' +
      '<tr><td>A quote or aside</td><td><code>&gt; quoted text</code></td></tr>' +
      '<tr><td>A bulleted list</td><td><code>- item</code> on each line</td></tr>' +
      '<tr><td>A numbered list</td><td><code>1. item</code> on each line</td></tr>' +
      '<tr><td>A heading / section title</td><td><code># Heading</code> &nbsp;(more <code>#</code> = smaller)</td></tr>' +
    '</table>' +
    '<p class="md-tips-note">Tip: use the <strong>&#128065; Preview</strong> button to see exactly how your formatting will look to readers, or highlight text and use the <strong>B</strong> / <em>I</em> buttons to wrap it instantly.</p>';
  showSubmitInfoModal('Help', 'Formatting your scene', html);
}

// ── INFO / PREVIEW / TIPS MODALS ──────────────────────────────────────────
function showSubmitInfoModal(eyebrow, title, bodyHtml) {
  var ov = document.createElement('div');
  ov.className = 'builder-modal-overlay submit-info-overlay';
  ov.innerHTML =
    '<div class="builder-modal">' +
      '<div class="builder-modal-head">' +
        '<div><div class="builder-modal-eyebrow">' + eyebrow + '</div>' +
        '<div class="builder-modal-title">' + title + '</div></div>' +
        '<button class="builder-modal-close" aria-label="Close">&#10005;</button>' +
      '</div>' +
      '<div class="builder-modal-body">' + bodyHtml + '</div>' +
    '</div>';
  document.body.appendChild(ov);
  function close() { ov.remove(); document.removeEventListener('keydown', onKey); }
  function onKey(e) { if (e.key === 'Escape') close(); }
  ov.addEventListener('click', function(e) { if (e.target === ov) close(); });
  ov.querySelector('.builder-modal-close').addEventListener('click', close);
  document.addEventListener('keydown', onKey);
}

// -- Validate form before submit --
// ── VALIDATION ────────────────────────────────────────────────────────────
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

    // Dynamic choices validation
    if (f.type === 'choices') {
      if (isEnding) return; // endings need no choices
      var inputs = overlay.querySelectorAll('.modal-choice-input');
      var filled = 0;
      inputs.forEach(function(inp) {
        if (inp.value.trim() === '') {
          showFieldError(inp, 'Choice text required.');
          valid = false;
        } else {
          filled++;
        }
      });
      if (filled < 2) valid = false;
      return;
    }

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

// -- Append a choice row to modal choice list
// ── DYNAMIC CHOICE ROWS (for branching-story submissions) ─────────────────
function appendModalChoiceRow(container, addBtn, max) {
  var row = document.createElement('div');
  row.className = 'modal-choice-row';
  var idx = container.querySelectorAll('.modal-choice-row').length + 1;
  row.innerHTML =
    '<input type="text" class="modal-input modal-choice-input" placeholder="Choice ' + idx + ' text..." />' +
    '<button type="button" class="modal-choice-remove">\u2715</button>';
  row.querySelector('.modal-choice-remove').addEventListener('click', function() {
    // Enforce a minimum of 2 choices
    if (container.querySelectorAll('.modal-choice-row').length <= 2) return;
    row.remove();
    container.querySelectorAll('.modal-choice-row').forEach(function(r, i) {
      var inp = r.querySelector('.modal-choice-input');
      if (inp) inp.placeholder = 'Choice ' + (i+1) + ' text...';
    });
    updateRemoveButtons(container);
    if (addBtn) addBtn.style.display = '';
  });
  container.appendChild(row);
  if (container.querySelectorAll('.modal-choice-row').length >= max) {
    if (addBtn) addBtn.style.display = 'none';
  }
  updateRemoveButtons(container);
}

// Dim/disable remove buttons when only the minimum (2) remain
function updateRemoveButtons(container) {
  var rows = container.querySelectorAll('.modal-choice-row');
  var atMin = rows.length <= 2;
  rows.forEach(function(r) {
    var btn = r.querySelector('.modal-choice-remove');
    if (btn) {
      btn.disabled = atMin;
      btn.style.opacity = atMin ? '0.3' : '';
      btn.style.cursor  = atMin ? 'not-allowed' : 'pointer';
    }
  });
}

// -- Build modal --
// ── FORM MODAL BUILDER: assembles + opens a submission form ───────────────
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
  // Wire markdown toolbar / preview / tips for any markdownTools textareas
  wireMarkdownTools(box);

  // Wire dynamic choice fields
  box.querySelectorAll('[data-choices-start]').forEach(function(wrap) {
    var max = parseInt(wrap.getAttribute('data-choices-max')) || 4;
    var startCount = parseInt(wrap.getAttribute('data-choices-start')) || 1;
    var choiceList = wrap.querySelector('.modal-choice-list');
    var addBtn = wrap.querySelector('.modal-add-choice-btn');
    if (!choiceList || !addBtn) return;
    addBtn.addEventListener('click', function() {
      if (choiceList.querySelectorAll('.modal-choice-row').length >= max) return;
      appendModalChoiceRow(choiceList, addBtn, max);
    });
    for (var sc = 0; sc < startCount; sc++) appendModalChoiceRow(choiceList, addBtn, max);
    addBtn.style.display = choiceList.querySelectorAll('.modal-choice-row').length >= max ? 'none' : '';
  });

  // Wire isEnding toggle to show/hide path fields
  var isEndingRadios = box.querySelectorAll('input[data-field="isEnding"]');
  if (isEndingRadios.length) {
    function updatePathVisibility() {
      var isEnding = box.querySelector('input[data-field="isEnding"]:checked');
      var ending   = isEnding && isEnding.value === 'true';
      box.querySelectorAll('.submit-field[data-path-field], .submit-field[data-choices-start]').forEach(function(el) {
        el.style.display = ending ? 'none' : '';
        if (ending) {
          el.querySelectorAll('input').forEach(function(inp){ inp.classList.remove('submit-input-error'); });
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
      } else if (f.type === 'radio' || f.type === 'toggle') {
        var sel = overlay.querySelector('input[data-field="' + f.key + '"]:checked');
        var v = sel ? sel.value : '';
        // Google Form expects Yes/No for the ending toggle
        if (f.type === 'toggle') v = (v === 'true') ? 'Yes' : 'No';
        data[f.key] = v;
      } else if (f.type === 'choices') {
        // Map choice inputs to path1..path4
        var keys = ['path1','path2','path3','path4'];
        overlay.querySelectorAll('.modal-choice-input').forEach(function(inp, i) {
          if (keys[i]) data[keys[i]] = inp.value.trim();
        });
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
      { key: 'title',     type: 'text',       label: 'Scene title',         placeholder: 'A short evocative title for this scene',           required: true  },
      { key: 'blurb',     type: 'textarea',   label: 'Opening scene',       placeholder: 'Write the first scene readers will encounter...', required: true, minWords: 300 },
      { key: 'path1',     type: 'text',       label: 'Choice 1',            placeholder: 'First choice text',                         required: true  },
      { key: 'path2',     type: 'text',       label: 'Choice 2',            placeholder: 'Second choice text',                        required: true  },
      { key: 'path3',     type: 'text',       label: 'Choice 3',            placeholder: 'Third choice text',                         hint: '(optional)' },
      { key: 'path4',     type: 'text',       label: 'Choice 4',            placeholder: 'Fourth choice text',                        hint: '(optional)' },
      { key: 'imageLink', type: 'text',       label: 'Image URL',           placeholder: 'Optional link to a cover image',            hint: '(optional)' },
    ],
    onSubmit: function(data) {
      // Single opening scene → unified form as a 'story' submission
      data.submissionType = 'story';
      data.sceneId = '1';
      return submitToGoogle('submission', data);
    }
  });
};


