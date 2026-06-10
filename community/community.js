/* ===============================================
   Sinverse — Community Failsafe
   community/community.js
   Renders announcements, a status-driven platform
   signpost (so the site points people to a fallback
   if the primary chat goes down), and a multi-platform
   contact form. All driven by community.json.
   =============================================== */
(function () {
  'use strict';

  // Cache-bust the data fetch so announcements/status changes appear without a
  // hard refresh. The file is tiny, so skipping its cache on each load is fine.
  var DATA_URL = 'community.json?v=' + Date.now();

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function fmtDate(s) {
    // Reuse the shared date formatter if present, else a simple fallback.
    if (window.SinverseDates && window.SinverseDates.format) {
      try { return window.SinverseDates.format(s); } catch (e) {}
    }
    var d = new Date(s + 'T00:00:00');
    if (isNaN(d)) return s;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  }

  // ── Announcements ────────────────────────────────────────────
  function renderAnnouncements(list) {
    var wrap = document.getElementById('community-announcements');
    if (!wrap) return;
    wrap.innerHTML = '';
    var items = (list || []).slice().sort(function (a, b) {
      return String(b.date).localeCompare(String(a.date));
    });
    if (!items.length) {
      wrap.appendChild(el('p', 'community-empty', 'No announcements right now.'));
      return;
    }
    items.forEach(function (a) {
      var lvl = (a.level || 'info').toLowerCase();
      var card = el('article', 'community-announce lvl-' + lvl);
      card.appendChild(el('div', 'community-announce-meta',
        '<span class="community-announce-date">' + esc(fmtDate(a.date)) + '</span>'));
      card.appendChild(el('h3', 'community-announce-title', esc(a.title)));
      if (a.body) card.appendChild(el('p', 'community-announce-body', esc(a.body)));
      wrap.appendChild(card);
    });
  }

  // ── Platform signpost (the failsafe core) ────────────────────
  function platformCard(p, emphasis) {
    var status = (p.status || 'up').toLowerCase();
    var down = status === 'down';
    var standby = status === 'standby';
    var clickable = status === 'up' && !!p.url;   // only an online card with a URL links
    var card = el('a', 'community-platform' + (emphasis ? ' is-emphasis' : '') +
      (down ? ' is-down' : '') + (standby ? ' is-standby' : '') + (clickable ? '' : ' is-inert'));
    card.href = clickable ? p.url : '#';
    if (clickable) { card.target = '_blank'; card.rel = 'noopener'; }
    if (!clickable) {
      card.setAttribute('aria-disabled', 'true');
      card.addEventListener('click', function (e) { e.preventDefault(); });
    }

    var statusTxt = down ? 'Unavailable' : (standby ? 'Standby' : 'Online');
    var statusCls = down ? 'down' : (standby ? 'standby' : 'up');
    card.innerHTML =
      '<div class="community-platform-head">' +
        '<span class="community-platform-name">' + esc(p.label) + '</span>' +
        '<span class="community-platform-status ' + statusCls + '">' + statusTxt + '</span>' +
      '</div>' +
      (p.blurb ? '<p class="community-platform-blurb">' + esc(p.blurb) + '</p>' : '') +
      (down ? '<span class="community-platform-cta muted">Currently down</span>'
            : standby ? '<span class="community-platform-cta muted">Standby \u2014 not open yet</span>'
            : '<span class="community-platform-cta">Open ' + esc(p.label) + ' &rarr;</span>');
    return card;
  }

  function renderPlatforms(platforms) {
    var wrap = document.getElementById('community-platforms');
    var alertWrap = document.getElementById('community-alert');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (alertWrap) alertWrap.innerHTML = '';

    platforms = platforms || [];
    var primary  = platforms.filter(function (p) { return p.role === 'primary'; })[0];
    var fallback = platforms.filter(function (p) { return p.role === 'fallback'; })[0];

    var primaryDown = primary && (primary.status || 'up').toLowerCase() === 'down';

    // If the primary is down and we have a fallback, raise a prominent banner
    // and steer people to the fallback as the emphasized destination.
    if (primaryDown && fallback && alertWrap) {
      var box = el('div', 'community-alert-box');
      box.innerHTML =
        '<strong>' + esc(primary.label) + ' is currently unavailable.</strong> ' +
        'The community has moved to <strong>' + esc(fallback.label) + '</strong> for now \u2014 ' +
        'use the link below to find everyone.';
      alertWrap.appendChild(box);
    }

    // Order: emphasized destination first.
    var ordered = platforms.slice().sort(function (a, b) {
      function rank(p) {
        var d = (p.status || 'up').toLowerCase() === 'down';
        if (primaryDown) { // fallback leads when primary is down
          if (p.role === 'fallback' && !d) return 0;
          if (p.role === 'beacon' && !d) return 1;
        } else {
          if (p.role === 'primary' && !d) return 0;
        }
        return d ? 9 : 5;
      }
      return rank(a) - rank(b);
    });

    ordered.forEach(function (p, i) {
      var emphasize = (i === 0 && (p.status || 'up').toLowerCase() !== 'down');
      wrap.appendChild(platformCard(p, emphasize));
    });
  }

  // ── Contact collection (modal) ───────────────────────────────
  function renderContact(cfg) {
    var wrap = document.getElementById('community-contact');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (!cfg || cfg.enabled === false) { wrap.style.display = 'none'; return; }

    if (cfg.intro) wrap.appendChild(el('p', 'community-contact-intro', esc(cfg.intro)));

    // Trigger button — the form itself lives in a modal.
    var openBtn = el('button', 'community-open-form', 'Stay In Touch &rarr;');
    openBtn.type = 'button';
    wrap.appendChild(openBtn);

    // Build the modal once and append to body.
    var overlay = el('div', 'community-modal-overlay');
    overlay.id = 'community-modal';
    var modal = el('div', 'community-modal');
    var closeBtn = el('button', 'community-modal-close', '&times;');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close');
    modal.appendChild(closeBtn);

    var heading = el('h3', 'community-modal-title', 'Stay reachable');
    modal.appendChild(heading);

    var modalBody = el('div', 'community-modal-body');
    modal.appendChild(modalBody);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Modal content: an embedded Google Form (if configured) or the native form.
    if (cfg.google_form_embed) {
      var frame = el('iframe', 'community-gform');
      frame.src = cfg.google_form_embed;
      frame.setAttribute('loading', 'lazy');
      frame.setAttribute('title', 'Stay reachable form');
      modalBody.appendChild(frame);
    } else {
      modalBody.appendChild(buildContactForm(cfg));
    }

    function open() { overlay.classList.add('open'); }
    function close() { overlay.classList.remove('open'); }
    openBtn.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('open')) close();
    });
  }

  // Builds the site-native contact form element (used when no Google Form
  // embed URL is configured).
  function buildContactForm(cfg) {
    var form = el('form', 'community-form');
    form.setAttribute('novalidate', 'novalidate');

    (cfg.fields || []).forEach(function (f) {
      var row = el('label', 'community-field');
      row.appendChild(el('span', 'community-field-label', esc(f.label)));
      var input;
      if (f.type === 'textarea') {
        input = el('textarea');
        input.rows = 3;
      } else {
        input = el('input');
        input.type = f.type || 'text';
      }
      input.name = f.name;
      input.placeholder = f.placeholder || '';
      input.className = 'community-input';
      row.appendChild(input);
      form.appendChild(row);
    });

    var btn = el('button', 'community-submit', 'Submit');
    btn.type = 'submit';
    form.appendChild(btn);

    var note = el('p', 'community-form-note');
    form.appendChild(note);

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var values = {};
      var any = false;
      (cfg.fields || []).forEach(function (f) {
        var input = form.querySelector('[name="' + f.name + '"]');
        var v = input ? input.value.trim() : '';
        if (v) { values[f.name] = v; any = true; }
      });

      if (!any) {
        note.className = 'community-form-note err';
        note.textContent = 'Add at least one way to reach you before submitting.';
        return;
      }
      if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
        note.className = 'community-form-note err';
        note.textContent = 'That email address doesn\u2019t look right.';
        return;
      }

      btn.disabled = true;
      note.className = 'community-form-note';
      note.textContent = 'Sending\u2026';

      // Post to the Google Form the same way the CYOA system does: a FormData
      // POST to the form's /formResponse URL with mode:'no-cors'. Each field is
      // mapped to its Google Form entry.<id> via the `entry` key in the config.
      // no-cors hides the response, so success is assumed if nothing throws.
      var body = new FormData();
      (cfg.fields || []).forEach(function (f) {
        if (f.entry && values[f.name]) body.append(f.entry, values[f.name]);
      });

      if (!cfg.google_form_action) {
        btn.disabled = false;
        note.className = 'community-form-note err';
        note.textContent = 'The form isn\u2019t connected yet \u2014 check back soon.';
        return;
      }

      fetch(cfg.google_form_action, { method: 'POST', mode: 'no-cors', body: body })
        .then(function () {
          form.reset();
          note.className = 'community-form-note ok';
          note.textContent = 'Thank you \u2014 Jay\u2019s got your details. Talk soon!';
          setTimeout(function () {
            var ov = document.getElementById('community-modal');
            if (ov) ov.classList.remove('open');
            btn.disabled = false;
          }, 1600);
        })
        .catch(function () {
          btn.disabled = false;
          note.className = 'community-form-note err';
          note.textContent = 'Something went wrong sending that \u2014 please try again.';
        });
    });

    return form;
  }

  // ── Init ─────────────────────────────────────────────────────
  function init() {
    fetch(DATA_URL)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        renderAnnouncements(data.announcements);
        renderPlatforms(data.platforms);
        renderContact(data.contact);
      })
      .catch(function (e) {
        var main = document.getElementById('community-main');
        if (main) {
          main.innerHTML = '<p class="community-empty">Could not load community data. ' +
            'Please try again shortly.</p>';
        }
        if (window.console) console.warn('[Community] load failed:', e);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
