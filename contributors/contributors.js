'use strict';
/* ============================================================================
   Sinverse — Contributors page
   ----------------------------------------------------------------------------
   Profiles from contributors.json. Contribution counts are auto-tallied by
   scanning gallery.json, library.json, and cyoa.json for each contributor's
   id (lowercased). Comics count per page and serials per chapter; a SET counts
   Adventure contributions are weighted at 1/5 for SORT ranking only (displayed
   as a single entry, as does any other standalone work. Supports ?creator=<id> to filter to one contributor
   (used by gallery/viewer artist links).
   ========================================================================== */

// ── Social platform config ─────────────────────────────────────
// Maps known keys to display labels. Any key not listed renders with
// the key itself capitalised as the label — add new platforms freely to
// contributors.json without touching this code.
var SOCIAL_LABELS = {
  twitter:     'Twitter / X',
  bluesky:     'Bluesky',
  furaffinity: 'FurAffinity',
  deviantart:  'DeviantArt',
  artstation:  'ArtStation',
  patreon:     'Patreon',
  discord:     'Discord',
  website:     'Website',
  instagram:   'Instagram',
  tumblr:      'Tumblr',
  kofi:        'Ko-fi',
  subscribestar: 'SubscribeStar',
};
// Keys whose values are usernames, not full URLs (rendered as plain text)
var SOCIAL_USERNAME_ONLY = ['discord'];

var ANON_IDS = [null, '', 'anon', 'anonymous'];

function isAnon(val) {
  return !val || ANON_IDS.indexOf(val.toLowerCase ? val.toLowerCase() : val) > -1;
}

// ── Build social link elements ────────────────────────────────
function buildSocials(socials, container) {
  if (!socials) return;
  Object.keys(socials).forEach(function(key) {
    var val = socials[key];
    if (!val || !val.trim()) return;
    var label = SOCIAL_LABELS[key] || (key.charAt(0).toUpperCase() + key.slice(1));
    var isUsernameOnly = SOCIAL_USERNAME_ONLY.indexOf(key) > -1;
    var el = document.createElement(isUsernameOnly ? 'span' : 'a');
    el.className = 'social-link' + (isUsernameOnly ? ' social-username' : '');
    el.textContent = label;
    if (!isUsernameOnly) {
      el.href = val.startsWith('http') ? val : 'https://' + val;
      el.target = '_blank';
      el.rel = 'noopener noreferrer';
    } else {
      el.title = key + ': ' + val;
    }
    container.appendChild(el);
  });
}

// ── Build type pills ──────────────────────────────────────────
function buildTypes(types, container) {
  (types || []).forEach(function(t) {
    var pill = document.createElement('span');
    pill.className = 'type-pill';
    pill.textContent = t;
    container.appendChild(pill);
  });
}

// ── Build content count links ─────────────────────────────────
// Count a creator's PUBLIC contributions (gallery + library + cyoa). Used both
// for the stat pills and to decide list visibility: a creator with zero public
// work is hidden from the public list (they only show via a direct ?creator=
// link from the stash).
function publicWorkCount(id, galleryItems, libraryItems, adventureNodes) {
  // Comics count per page and serials per chapter; a set counts as ONE entry,
  // and any other single work counts as one.
  var g = galleryItems.reduce(function(sum, i) {
    if (i.artist !== id) return sum;
    if (i.type === 'comic' && i.pages && i.pages.length) return sum + i.pages.length;
    return sum + 1;
  }, 0);
  var l = libraryItems.reduce(function(sum, i) {
    if (i.author !== id) return sum;
    if (i.type === 'serial' && i.chapters && i.chapters.length) return sum + i.chapters.length;
    return sum + 1;
  }, 0);
  var c = adventureNodes.filter(function(n){ return n.author === id; }).length;
  return g + l + c;
}

// Count a creator's STASH contributions: images (sets/comics count their pages)
// and stories (serials count their chapters). Matches stash.json's `creator`
// field. Stash entries use `creator`; we also accept `artist`/`author` aliases.
function stashCounts(id, stashItems) {
  function who(it) { return (it.creator || it.artist || it.author || '').toLowerCase(); }
  var key = (id || '').toLowerCase();
  var images = (stashItems || []).reduce(function(sum, i) {
    if (i.kind !== 'image' || who(i) !== key) return sum;
    if (i.type === 'comic' && i.pages && i.pages.length) return sum + i.pages.length;
    return sum + 1; // a set counts as one entry
  }, 0);
  var stories = (stashItems || []).reduce(function(sum, i) {
    if (i.kind !== 'story' || who(i) !== key) return sum;
    if (i.type === 'serial' && i.chapters && i.chapters.length) return sum + i.chapters.length;
    return sum + 1;
  }, 0);
  return { images: images, stories: stories };
}

// ── Build content count links ─────────────────────────────────
function buildCounts(id, galleryItems, libraryItems, adventureNodes, container, isJay, stash) {
  // Comics count per page and serials per chapter; a set counts as one entry.
  var gCount = galleryItems.reduce(function(sum, i) {
    if (i.artist !== id) return sum;
    if (i.type === 'comic' && i.pages && i.pages.length > 0) return sum + i.pages.length;
    return sum + 1;
  }, 0);
  var lCount = libraryItems.reduce(function(sum, i) {
    if (i.author !== id) return sum;
    if (i.type === 'serial' && i.chapters && i.chapters.length > 0) return sum + i.chapters.length;
    return sum + 1;
  }, 0);
  var cCount = adventureNodes.filter(function(n){ return n.author === id; }).length;

  var defs;
  var stashUrl = '../stash/?creator=' + encodeURIComponent(id);
  var stashTotal = stash ? (stash.images + stash.stories) : 0;
  // When the visitor arrived via a direct ?creator= link (stash is non-null),
  // show the FULL set of stat pills like any other contributor — all three
  // public counts (even if zero) plus the Stash pill — so a stash-only creator
  // doesn't collapse to a single number. On a normal page visit (stash is null)
  // the stash stats are never passed in, so the secret stays hidden.
  var isLinkView = !!stash;
  if (isLinkView) {
    defs = [
      { n: gCount, label: 'Artworks',   url: '../gallery/?search=' + encodeURIComponent(id) + '&mode=artist', link: gCount > 0 },
      { n: lCount, label: 'Stories',    url: '../library/?search=' + encodeURIComponent(id) + '&mode=author', link: lCount > 0 },
      { n: cCount, label: 'Adventures', url: '../cyoa/?authorId=' + encodeURIComponent(id), link: cCount > 0 },
      { n: stashTotal, label: 'Stash',  url: stashUrl, link: stashTotal > 0 },
    ];
  } else {
    defs = [
      { n: gCount, label: 'Artworks',   url: '../gallery/?search=' + encodeURIComponent(id) + '&mode=artist', link: gCount > 0 },
      { n: lCount, label: 'Stories',    url: '../library/?search=' + encodeURIComponent(id) + '&mode=author', link: lCount > 0 },
      { n: cCount, label: 'Adventures', url: '../cyoa/?authorId=' + encodeURIComponent(id), link: cCount > 0 },
    ];
  }

  defs.forEach(function(d) {
    if (isJay) {
      var item = document.createElement('div');
      item.className = 'jay-count-item';
      item.innerHTML =
        '<span class="jay-count-n">' + d.n + '</span>' +
        '<span class="jay-count-label">' + d.label + '</span>';
      container.appendChild(item);
    } else {
      var el = document.createElement(d.link ? 'a' : 'span');
      el.className = 'count-link' + (d.link ? '' : ' count-link-plain');
      if (d.link && d.url) el.href = d.url;
      el.innerHTML =
        '<span class="count-n">' + d.n + '</span>' +
        '<span class="count-label">' + d.label + '</span>';
      container.appendChild(el);
    }
  });

  return gCount + lCount + cCount;
}

// ── Render Jay dedication ─────────────────────────────────────
function renderJay(jay, chars, galleryItems, libraryItems, adventureNodes) {
  if (!jay) return;

  // Portrait — use characters.json profile_image if available, else avatar
  var char = chars.find(function(c){ return c.name.toLowerCase() === 'jay'; });
  var portraitSrc = (jay.avatar) || (char && char.profile_image) || '';
  var portrait = document.getElementById('jay-portrait');
  if (portrait) {
    if (portraitSrc) {
      portrait.src = portraitSrc;
      portrait.classList.remove('is-sil');
    } else if (char && char.image) {
      portrait.src = char.image;
      portrait.classList.add('is-sil');
    } else {
      portrait.src = '';
      portrait.style.display = 'none';
    }
  }

  // Bio
  var bioEl = document.getElementById('jay-bio');
  if (bioEl) bioEl.textContent = jay.bio || '';

  // Socials
  var socialsEl = document.getElementById('jay-socials');
  if (socialsEl) buildSocials(jay.socials, socialsEl);

  // No counts for Jay — community leader, not content creator
}

// ── Render contributor card ───────────────────────────────────
function renderCard(contributor, galleryItems, libraryItems, adventureNodes, stash) {
  var card = document.createElement('div');
  card.className = 'con-card';

  // Avatar
  var avatarHtml;
  if (contributor.avatar) {
    var avSrc = window.SinverseImg ? SinverseImg.thumb(contributor.avatar, 200) : contributor.avatar;
    avatarHtml = '<div class="con-avatar-wrap"><img class="con-avatar" src="' +
      avSrc + '" alt="' + contributor.name + '" loading="lazy" /></div>';
  } else {
    var initial = contributor.name.charAt(0).toUpperCase();
    avatarHtml = '<div class="con-avatar-wrap"><div class="con-avatar is-placeholder">' + initial + '</div></div>';
  }

  // Types
  var typePills = (contributor.types || []).map(function(t){
    return '<span class="type-pill">' + t + '</span>';
  }).join('');

  card.innerHTML =
    '<div class="con-card-top">' +
      avatarHtml +
      '<div>' +
        '<div class="con-card-name">' + contributor.name + '</div>' +
        '<div class="con-card-types">' + typePills + '</div>' +
      '</div>' +
    '</div>' +
    (contributor.bio ? '<p class="con-card-bio">' + contributor.bio + '</p>' : '') +
    '<div class="con-card-socials"></div>' +
    '<div class="con-card-counts"></div>';

  buildSocials(contributor.socials, card.querySelector('.con-card-socials'));
  buildCounts(contributor.id, galleryItems, libraryItems, adventureNodes, card.querySelector('.con-card-counts'), false, stash);

  return card;
}

// ── Anonymous counts ──────────────────────────────────────────
function renderAnon(galleryItems, libraryItems, adventureNodes) {
  // Comics count per page and serials per chapter; a set counts as one entry.
  var gAnon = galleryItems.reduce(function(sum, i) {
    if (!isAnon(i.artist)) return sum;
    if (i.type === 'comic' && i.pages && i.pages.length > 0) return sum + i.pages.length;
    return sum + 1;
  }, 0);
  var lAnon = libraryItems.reduce(function(sum, i) {
    if (!isAnon(i.author)) return sum;
    if (i.type === 'serial' && i.chapters && i.chapters.length > 0) return sum + i.chapters.length;
    return sum + 1;
  }, 0);
  var cAnon = adventureNodes.filter(function(n){ return isAnon(n.author); }).length;

  var gEl = document.getElementById('anon-gallery');
  var lEl = document.getElementById('anon-library');
  var cEl = document.getElementById('anon-cyoa');
  if (gEl) gEl.textContent = gAnon;
  if (lEl) lEl.textContent = lAnon;
  if (cEl) cEl.textContent = cAnon;
}

// ── Init ──────────────────────────────────────────────────────
// ── Grid render + search ────────────────────────────────────────────────────
// renderContributorGrid draws a given subset of the public contributor list.
// Pulled out so the search box can re-filter in memory without re-fetching or
// re-tallying contribution counts.
function renderContributorGrid(list) {
  var ctx = window._conRenderCtx || {};
  var grid = document.getElementById('con-grid');
  if (!grid) return;
  grid.innerHTML = '';

  if (!list.length) {
    grid.innerHTML = '<div class="con-loading">No contributors match your search.</div>';
  } else {
    list.forEach(function(c) {
      // Only surface stash stats when the visitor actually came FROM the stash
      // (links marked &from=stash) — never on the public list, and never on a
      // plain ?creator= link from gallery/library/adventures — to keep the
      // stash secret.
      var stash = ctx.fromStash ? stashCounts(c.id, ctx.stashItems || []) : null;
      grid.appendChild(renderCard(c, ctx.galleryItems || [], ctx.libraryItems || [], ctx.adventureNodes || [], stash));
    });
  }

  var countEl = document.getElementById('con-result-count');
  if (countEl) {
    var total = (ctx.list || list).length;
    countEl.textContent = (list.length === total)
      ? total + (total === 1 ? ' contributor' : ' contributors')
      : list.length + ' of ' + total + ' contributors';
  }
}

// A clean contributor finder: a name-only search box plus a row of toggle
// buttons for contribution types (Writer, Artist, etc.), built from the types
// actually present in the loaded list. All client-side; no re-fetching.
function initContributorSearch() {
  var ctx = window._conRenderCtx;
  if (!ctx || !ctx.list) return;

  // Collect the distinct types present, ordered by frequency (most common first).
  var typeCounts = {};
  ctx.list.forEach(function(c) {
    (c.types || []).forEach(function(t) { typeCounts[t] = (typeCounts[t] || 0) + 1; });
  });
  var types = Object.keys(typeCounts).sort(function(a, b) {
    return typeCounts[b] - typeCounts[a] || a.localeCompare(b);
  });

  var activeTypes = {};   // type -> true when that filter is engaged
  var nameQuery = '';

  // Build the control bar (created in JS, so no HTML change needed).
  var bar = document.getElementById('con-search-bar');
  if (!bar) {
    var titleRow = document.querySelector('.con-section-title-row');
    var grid = document.getElementById('con-grid');
    var anchor = (titleRow && titleRow.parentNode) ? titleRow : (grid || null);
    if (!anchor || !anchor.parentNode) return;

    bar = document.createElement('div');
    bar.id = 'con-search-bar';
    bar.className = 'con-search-bar';

    var typeBtns = types.map(function(t) {
      return '<button type="button" class="con-type-toggle" data-type="' +
        t.replace(/"/g, '&quot;') + '">' + t + '</button>';
    }).join('');

    bar.innerHTML =
      '<div class="con-search-row">' +
        '<div class="con-search-field">' +
          '<svg class="con-search-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>' +
          '<input type="search" id="con-search-input" class="con-search-input" ' +
            'placeholder="Search by name\u2026" autocomplete="off" aria-label="Search contributors by name" />' +
        '</div>' +
        '<span id="con-result-count" class="con-result-count"></span>' +
        '<button type="button" id="con-clear-filters" class="con-clear-filters" style="display:none">Clear</button>' +
      '</div>' +
      (types.length ? '<div class="con-type-filters" id="con-type-filters">' + typeBtns + '</div>' : '');

    anchor.parentNode.insertBefore(bar, anchor.nextSibling);
  }

  var input = document.getElementById('con-search-input');

  function runSearch() {
    var q = nameQuery;
    var activeList = Object.keys(activeTypes).filter(function(t){ return activeTypes[t]; });
    var filtered = ctx.list.filter(function(c) {
      // Name-only text match.
      if (q && (c.name || '').toLowerCase().indexOf(q) === -1) return false;
      // Type filter: a contributor must carry EVERY selected type (AND).
      if (activeList.length) {
        var has = (c.types || []);
        if (!activeList.every(function(t){ return has.indexOf(t) > -1; })) return false;
      }
      return true;
    });
    renderContributorGrid(filtered);

    // Show the Clear button only when something is actually filtering.
    var clearBtn = document.getElementById('con-clear-filters');
    if (clearBtn) clearBtn.style.display = (q || activeList.length) ? '' : 'none';
  }

  function clearAll() {
    nameQuery = '';
    if (input) input.value = '';
    Object.keys(activeTypes).forEach(function(t){ activeTypes[t] = false; });
    var tf = document.getElementById('con-type-filters');
    if (tf) tf.querySelectorAll('.con-type-toggle.active').forEach(function(b){ b.classList.remove('active'); });
    runSearch();
  }

  if (input) {
    input.addEventListener('input', function() { nameQuery = this.value.trim().toLowerCase(); runSearch(); });
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') { clearAll(); }
    });
  }

  var clearBtn = document.getElementById('con-clear-filters');
  if (clearBtn) clearBtn.addEventListener('click', clearAll);

  var typeFilters = document.getElementById('con-type-filters');
  if (typeFilters) {
    typeFilters.addEventListener('click', function(e) {
      var btn = e.target.closest('.con-type-toggle');
      if (!btn) return;
      var t = btn.getAttribute('data-type');
      activeTypes[t] = !activeTypes[t];
      btn.classList.toggle('active', activeTypes[t]);
      runSearch();
    });
  }

  // Initialize the result count for the full list.
  renderContributorGrid(ctx.list);
}

// ── Boot render ──────────────────────────────────────────────────────────────
async function init() {
  try {
    function safeFetch(url, fallback) {
      return fetch(url)
        .then(function(r) { return r.ok ? r.text() : ''; })
        .then(function(text) {
          if (!text || !text.trim()) return fallback;
          try { return JSON.parse(text); } catch(e) { return fallback; }
        })
        .catch(function() { return fallback; });
    }

    // Resolve base relative to this page's location
    var base = window.location.href.replace(/\/[^/]*$/, '/');
    var root = base + '../';

    var results = await Promise.all([
      safeFetch(base + 'contributors.json', []),
      safeFetch(root + '_data/characters.json',   []),
      safeFetch(root + 'gallery/gallery.json',     []),
      safeFetch(root + 'library/library.json',     []),
      safeFetch(root + 'cyoa/cyoa.json',           []),
      safeFetch(root + 'stash/stash.json',         []),
    ]);

    var contributors = results[0];
    var chars        = results[1];
    var galleryItems = results[2];
    var libraryItems = results[3];
    var cyoaManifest = results[4];
    var stashItems   = results[5];

    // Fetch all adventure nodes from adventures/*.json
    var adventureNodes = [];
    if (cyoaManifest.length) {
      var adventureFetches = cyoaManifest.map(function(adventure) {
        return safeFetch(root + 'cyoa/adventures/' + adventure.id + '.json', []);
      });
      var adventureResults = await Promise.all(adventureFetches);
      adventureResults.forEach(function(nodes) {
        if (Array.isArray(nodes)) adventureNodes = adventureNodes.concat(nodes);
      });
    }

    // Jay is always first — pull him out for the dedication section
    var jay = contributors.find(function(c){ return c.id === 'jay'; });
    var rest = contributors.filter(function(c){ return c.id !== 'jay'; });

    renderJay(jay, chars, galleryItems, libraryItems, adventureNodes);

    // Check for ?creator= param (direct link, e.g. from the stash).
    var creatorParam = new URLSearchParams(window.location.search).get('creator');
    // The stash value must ONLY be revealed when the visitor actually came from
    // the stash, which marks its links with &from=stash. Public modules (gallery,
    // library, adventures) link with ?creator= alone, so they resolve the
    // profile but must NOT expose the stash. `isCreatorLink` still governs
    // single-profile view; `fromStash` alone gates the stash stats.
    var fromStash = new URLSearchParams(window.location.search).get('from') === 'stash';
    var isCreatorLink = false;
    if (creatorParam) {
      isCreatorLink = true;
      var creatorId = decodeURIComponent(creatorParam).toLowerCase();
      // Direct link: resolve the creator regardless of where their work lives,
      // so stash-only creators (hidden from the public list) still get a profile.
      rest = rest.filter(function(c){ return c.id.toLowerCase() === creatorId; });
      // Update heading and show inline view-all link
      var titleEl = document.getElementById('con-section-title');
      var viewAllLink = document.getElementById('con-view-all-link');
      if (titleEl) titleEl.textContent = rest.length === 1 ? rest[0].name : 'Filtered Contributors';
      if (viewAllLink) {
        viewAllLink.href = window.location.pathname;
        viewAllLink.style.display = '';
      }
      // Clean URL
      var cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('creator');
      window.history.replaceState({}, '', cleanUrl);
    } else {
      // Public list: hide creators whose ONLY contributions are in the stash
      // (zero public gallery/library/cyoa work). This keeps the stash secret —
      // they remain reachable only via a direct ?creator= link from the stash.
      rest = rest.filter(function(c){
        return publicWorkCount(c.id, galleryItems, libraryItems, adventureNodes) > 0;
      });
    }

    // Sort rest by weighted contribution score descending.
    // A single adventure scene is a smaller unit of work than a full image or
    // story, so it's weighted at 1/5 for ranking purposes only — the displayed
    // counts elsewhere remain the true, unweighted numbers.
    var ADVENTURE_WEIGHT = 0.2;
    rest.sort(function(a, b) {
      function count(id) {
        // Comics count per page and serials per chapter; a set counts as one.
        var g = galleryItems.reduce(function(sum, i) {
          if (i.artist !== id) return sum;
          if (i.type === 'comic' && i.pages && i.pages.length) return sum + i.pages.length;
          return sum + 1;
        }, 0);
        var l = libraryItems.reduce(function(sum, i) {
          if (i.author !== id) return sum;
          if (i.type === 'serial' && i.chapters && i.chapters.length > 0) return sum + i.chapters.length;
          return sum + 1;
        }, 0);
        var c = adventureNodes.filter(function(n){ return n.author === id; }).length;
        return g + l + (c * ADVENTURE_WEIGHT);
      }
      return count(b.id) - count(a.id);
    });

    var grid = document.getElementById('con-grid');
    grid.innerHTML = '';

    // Keep what we need to re-render on search, without re-fetching/re-tallying.
    window._conRenderCtx = {
      list: rest.slice(),
      galleryItems: galleryItems,
      libraryItems: libraryItems,
      adventureNodes: adventureNodes,
      stashItems: stashItems,
      isCreatorLink: isCreatorLink,
      fromStash: fromStash
    };

    renderContributorGrid(rest);

    // Wire the search box (only on the public, non-deep-link list).
    if (!isCreatorLink) initContributorSearch();

    renderAnon(galleryItems, libraryItems, adventureNodes);

  } catch(e) {
    console.error('Contributors failed to load:', e);
    var grid = document.getElementById('con-grid');
    if (grid) grid.innerHTML = '<div class="con-loading" style="color:var(--wine)">Failed to load contributors.</div>';
  }
}

init();
