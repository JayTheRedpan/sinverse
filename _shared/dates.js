// ── Sinverse in-universe date helpers ─────────────────────────
// Shared across wiki, gallery, and library. Loads eras.json once and
// provides formatting + era lookup for integer universe dates.
//
// Usage:
//   await SinverseDates.load('../wiki/eras.json');
//   SinverseDates.format(3)        → "T+3"
//   SinverseDates.eraName(3)       → "The Reconstruction"
//   SinverseDates.label(3)         → "T+3 · The Reconstruction"
//   SinverseDates.label(null)      → "Unknown era"

window.SinverseDates = (function() {
  var eras = [];

  async function load(path) {
    try {
      var res = await fetch(path);
      if (res.ok) eras = await res.json();
    } catch (e) {
      eras = [];
    }
    return eras;
  }

  // Format an integer year as a T±N string
  function format(d) {
    if (d === null || d === undefined || d === '') return 'Unknown';
    var n = parseInt(d, 10);
    if (isNaN(n)) return 'Unknown';
    if (n === 0) return 'T\u00b10';
    return n > 0 ? 'T+' + n : 'T' + n; // negative already carries the minus
  }

  // Find the era an integer year falls into.
  //
  // Era ranges are inclusive on both ends, so boundary years belong to more than
  // one era (year 0 sits in Sin's-Rise's end, TDay, AND Post-Apotheosis's start).
  // A "point" era (point: true) marks a single defining moment — TDay — and must
  // win those ties, so point eras are matched FIRST. Otherwise the first range
  // era in file order would swallow the boundary year (T±0 showing as Sin's-Rise).
  function matches(e, n) {
    var afterStart = (e.start === null || e.start === undefined) || n >= e.start;
    var beforeEnd  = (e.end === null || e.end === undefined)     || n <= e.end;
    return afterStart && beforeEnd;
  }

  function era(d) {
    if (d === null || d === undefined || d === '') return null;
    var n = parseInt(d, 10);
    if (isNaN(n)) return null;
    // 1) point-in-time eras (e.g. TDay at T±0) take precedence on their exact year
    var pt = eras.find(function(e) { return e.point && matches(e, n); });
    if (pt) return pt;
    // 2) otherwise the first range era containing the year
    return eras.find(function(e) { return !e.point && matches(e, n); }) || null;
  }

  function eraName(d) {
    var e = era(d);
    return e ? e.name : null;
  }

  // Combined display label: "T+3 · The Reconstruction" or "Unknown era"
  function label(d) {
    if (d === null || d === undefined || d === '') return 'Unknown era';
    var name = eraName(d);
    return name ? format(d) + ' \u00b7 ' + name : format(d);
  }

  // The wiki lore page for an era. Pages are 'era-<id>', with one exception:
  // eras.json calls the last era 'sylph-age' while its lore page is
  // 'era-project-sylph'. Keep that mapping here so callers don't each need it.
  var PAGE_OVERRIDES = { 'sylph-age': 'era-project-sylph' };

  function eraPage(d) {
    var e = era(d);
    if (!e || !e.id) return null;
    return PAGE_OVERRIDES[e.id] || ('era-' + e.id);
  }

  // Href to the era's wiki page, relative to a module dir (gallery/, library/…).
  function eraHref(d, base) {
    var page = eraPage(d);
    return page ? (base || '../wiki/') + '#lore-' + page : null;
  }

  // Display label with the era name linked to its wiki page:
  //   "T+3 · <a href=...>The Reconstruction</a>"
  // Falls back to the plain label when there is no era (or no page for it).
  function labelHtml(d, base) {
    if (d === null || d === undefined || d === '') return 'Unknown era';
    var name = eraName(d);
    if (!name) return format(d);
    var href = eraHref(d, base);
    if (!href) return label(d);
    return format(d) + ' \u00b7 <a class="era-link" href="' + href + '">' +
           name.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</a>';
  }

  return { load: load, format: format, era: era, eraName: eraName, label: label,
           eraPage: eraPage, eraHref: eraHref, labelHtml: labelHtml };
})();
