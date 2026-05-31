/* ===============================================
   Sinverse -- Global Navigation
   _shared/nav.js
   =============================================== */

'use strict';

(function() {
  var DISCORD = 'https://discord.gg/FFWPJmcUDg';  // replace with real invite

  var LINKS = [
    { label: 'Home',         href: '/',              id: 'home' },
    { label: 'Wiki',         href: '/wiki/',          id: 'wiki' },
    { label: 'Library',      href: '/library/',       id: 'library' },
    { label: 'CYOA',         href: '/cyoa/',          id: 'cyoa' },
    { label: 'Gallery',      href: '/gallery/',       id: 'gallery' },
    { label: 'Size Ref',     href: '/sizeref/',       id: 'sizeref' },
    { label: 'Contributors', href: '/contributors/',  id: 'contributors' },
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

    // Discord button
    var discord = document.createElement('a');
    discord.href      = DISCORD;
    discord.target    = '_blank';
    discord.rel       = 'noopener noreferrer';
    discord.className = 'global-nav-discord';
    discord.textContent = 'Discord';
    links.appendChild(discord);

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
