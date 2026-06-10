/* ===============================================
   Sinverse -- Global Navigation
   _shared/nav.js
   =============================================== */

'use strict';

(function() {
  // Fallback invite used only if community.json can't be read. The live URL
  // and status come from community.json so there's a single source of truth.
  var DISCORD_FALLBACK = 'https://discord.gg/FFWPJmcUDg';

  var LINKS = [
    { label: 'Home',         href: '/',              id: 'home' },
    { label: 'Library',      href: '/library/',       id: 'library' },
    { label: 'Gallery',      href: '/gallery/',       id: 'gallery' },
    { label: 'Size Ref',     href: '/sizeref/',       id: 'sizeref' },
    { label: 'CYOA',         href: '/cyoa/',          id: 'cyoa' },
    { label: 'Wiki',         href: '/wiki/',          id: 'wiki' },
    { label: 'Contributors', href: '/contributors/',  id: 'contributors' },
    { label: 'Community',    href: '/community/',     id: 'community' },
  ];

  function buildNav(activePage) {
    var nav = document.createElement('nav');
    nav.className = 'global-nav';

    // Brand
    var brand = document.createElement('a');
    brand.href      = '/';
    brand.className = 'global-nav-brand';
    brand.innerHTML =
      '<img src="/images/logo.png" alt="Sinverse" class="global-nav-logo" />' +
      '<span class="global-nav-title">Sinverse</span>';
    nav.appendChild(brand);

    // Links
    var links = document.createElement('div');
    links.className = 'global-nav-links';
    links.id        = 'global-nav-links';

    LINKS.forEach(function(l) {
      var a = document.createElement('a');
      a.href      = l.href;
      a.className = 'global-nav-link' + (l.id === activePage ? ' active' : '');
      a.textContent = l.label;
      links.appendChild(a);
    });

    // Discord button — URL + status pulled from community.json.
    var discord = document.createElement('a');
    discord.href      = DISCORD_FALLBACK;
    discord.target    = '_blank';
    discord.rel       = 'noopener noreferrer';
    discord.className = 'global-nav-discord';
    discord.textContent = 'Discord';
    links.appendChild(discord);

    // Resolve the real Discord link/status from community.json. Path is
    // root-relative so it works from any sub-site. If it can't load, the
    // fallback invite above stays in place.
    fetch('/community/community.json')
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        if (!data || !data.platforms) return;
        var d = data.platforms.filter(function(p) { return p.id === 'discord'; })[0];
        if (!d) return;
        if (d.url) discord.href = d.url;
        var status = (d.status || 'up').toLowerCase();
        if (status === 'down') {
          discord.classList.add('is-down');
          discord.title = 'Discord is currently unavailable';
        } else if (status === 'standby') {
          discord.classList.add('is-standby');
          discord.title = 'Discord is up but not yet open';
        }
      })
      .catch(function() {});

    nav.appendChild(links);

    // Mobile toggle
    var toggle = document.createElement('button');
    toggle.className   = 'global-nav-toggle';
    toggle.innerHTML   = '&#9776;';
    toggle.setAttribute('aria-label', 'Menu');
    toggle.addEventListener('click', function() {
      links.classList.toggle('open');
    });
    nav.appendChild(toggle);

    return nav;
  }

  // Inject nav at top of body
  window.initNav = function(activePage) {
    var nav = buildNav(activePage || '');
    document.body.insertBefore(nav, document.body.firstChild);
    document.body.classList.add('has-global-nav');
  };
})();
