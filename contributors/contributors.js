'use strict';

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
function buildCounts(id, galleryItems, libraryItems, adventureNodes, container, isJay) {
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

  var defs = [
    { n: gCount, label: 'Images',     url: '../gallery/?search=' + encodeURIComponent(id) + '&mode=artist', link: gCount > 0 },
    { n: lCount, label: 'Stories',    url: '../library/?search=' + encodeURIComponent(id) + '&mode=author', link: lCount > 0 },
    { n: cCount, label: 'Adventures', url: '../cyoa/?authorId=' + encodeURIComponent(id), link: cCount > 0 },
  ];

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
function renderCard(contributor, galleryItems, libraryItems, adventureNodes) {
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
  buildCounts(contributor.id, galleryItems, libraryItems, adventureNodes, card.querySelector('.con-card-counts'), false);

  return card;
}

// ── Anonymous counts ──────────────────────────────────────────
function renderAnon(galleryItems, libraryItems, adventureNodes) {
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
    ]);

    var contributors = results[0];
    var chars        = results[1];
    var galleryItems = results[2];
    var libraryItems = results[3];
    var cyoaManifest = results[4];

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

    // Check for ?creator= param
    var creatorParam = new URLSearchParams(window.location.search).get('creator');
    if (creatorParam) {
      var creatorId = decodeURIComponent(creatorParam).toLowerCase();
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
    }

    // Sort rest by total contribution count descending
    rest.sort(function(a, b) {
      function count(id) {
        var g = galleryItems.reduce(function(sum, i) {
          if (i.artist !== id) return sum;
          return sum + (i.type === 'comic' && i.pages && i.pages.length ? i.pages.length : 1);
        }, 0);
        var l = libraryItems.reduce(function(sum, i) {
          if (i.author !== id) return sum;
          if (i.type === 'serial' && i.chapters && i.chapters.length > 0) return sum + i.chapters.length;
          return sum + 1;
        }, 0);
        var c = adventureNodes.filter(function(n){ return n.author === id; }).length;
        return g + l + c;
      }
      return count(b.id) - count(a.id);
    });

    var grid = document.getElementById('con-grid');
    grid.innerHTML = '';

    if (!rest.length) {
      grid.innerHTML = '<div class="con-loading">No additional contributors yet.</div>';
    } else {
      rest.forEach(function(c) {
        grid.appendChild(renderCard(c, galleryItems, libraryItems, adventureNodes));
      });
    }

    renderAnon(galleryItems, libraryItems, adventureNodes);

  } catch(e) {
    console.error('Contributors failed to load:', e);
    var grid = document.getElementById('con-grid');
    if (grid) grid.innerHTML = '<div class="con-loading" style="color:var(--wine)">Failed to load contributors.</div>';
  }
}

init();
