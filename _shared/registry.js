/* ===============================================
   Sinverse -- Registry
   _shared/registry.js
   Resolves entity IDs to URLs across all sub-sites.
   Import in any sub-site that needs cross-links.
   =============================================== */

'use strict';

var REGISTRY = {
  character:   function(id) { return '/wiki/#' + id; },
  story:       function(id) { return '/library/reader.html?id=' + id; },
  cyoa:        function(id) { return '/cyoa/?story=' + id; },
  gallery:     function(id) { return '/gallery/#' + id; },
  contributor: function(id) { return '/contributors/#' + id; },
  wiki:        function(id) { return '/wiki/#' + id; },
};

// Resolve a cross-link from a related block
// e.g. resolveLink('story', 'velvet_room') => '/library/reader.html?id=velvet_room'
window.resolveLink = function(type, id) {
  if (REGISTRY[type]) return REGISTRY[type](id);
  console.warn('[Registry] Unknown type: ' + type);
  return '#';
};

// Build a cross-link anchor element
window.buildCrossLink = function(type, id, label) {
  var a = document.createElement('a');
  a.href      = window.resolveLink(type, id);
  a.className = 'cross-link cross-link-' + type;
  a.textContent = label || id;
  return a;
};
