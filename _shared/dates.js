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

  // Find the era an integer year falls into
  function era(d) {
    if (d === null || d === undefined || d === '') return null;
    var n = parseInt(d, 10);
    if (isNaN(n)) return null;
    return eras.find(function(e) {
      var afterStart = (e.start === null || e.start === undefined) || n >= e.start;
      var beforeEnd  = (e.end === null || e.end === undefined)   || n <= e.end;
      return afterStart && beforeEnd;
    }) || null;
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

  return { load: load, format: format, era: era, eraName: eraName, label: label };
})();
