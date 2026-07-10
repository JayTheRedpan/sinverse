// ── Sinverse Cloudinary image helpers ─────────────────────────
// Rewrites Cloudinary delivery URLs to request resized, compressed,
// auto-format images instead of full-resolution originals.
//
//   .../image/upload/v123/name.png
//   .../image/upload/w_500,c_fill,q_auto,f_auto/v123/name.png
//
// Non-Cloudinary URLs (or empty values) are returned unchanged, so every
// helper here is always safe to call.
//
// WIDTH TIERS: every requested width is snapped UP to the nearest value in
// WIDTH_TIERS. This is deliberate — Cloudinary generates and *stores* a
// separate derived asset for each unique width (and format), so keeping the
// site to a handful of standard widths keeps transformation + storage usage
// low. Ask for whatever width suits the layout; it resolves to a tier.
//
// Usage:
//   SinverseImg.thumb(url, 400)          // ~tier-500 wide, fill crop
//   SinverseImg.thumb(url, 400, 'fit')   // fit (no crop)
//   SinverseImg.full(url)                // large, capped, auto-format (viewers)
//   SinverseImg.canvas(url, 1600)        // resize+compress, NO crop, NO format
//                                        // swap — safe for <canvas>/CORS/alpha

window.SinverseImg = (function() {

  // Standard delivered widths. Keep this list short.
  var WIDTH_TIERS = [160, 500, 800, 1600];

  function snapWidth(w) {
    w = +w || 500;
    for (var i = 0; i < WIDTH_TIERS.length; i++) {
      if (w <= WIDTH_TIERS[i]) return WIDTH_TIERS[i];
    }
    return WIDTH_TIERS[WIDTH_TIERS.length - 1];
  }

  function isCloudinary(url) {
    return url && typeof url === 'string' &&
           url.indexOf('res.cloudinary.com') !== -1 &&
           url.indexOf('/upload/') !== -1;
  }

  // Insert a transform segment right after '/upload/', unless one is already
  // present (avoids double-applying).
  function inject(url, transform) {
    return url.replace(/\/upload\/(?!w_|h_|c_|q_|f_)/, '/upload/' + transform + '/');
  }

  // Thumbnails / cards / portraits: sized, cropped-to-fill (or fit), compressed,
  // modern format. Width snaps to a tier.
  function thumb(url, width, mode, height) {
    if (!isCloudinary(url)) return url;
    var crop = mode === 'fit' ? 'c_fit' : 'c_fill';
    var parts = ['w_' + snapWidth(width)];
    if (height) parts.push('h_' + snapWidth(height));
    parts.push(crop, 'q_auto', 'f_auto');
    return inject(url, parts.join(','));
  }

  // Full-size display (image viewers / lightboxes): large but auto-compressed
  // and in a modern format, capped so enormous originals don't ship at full
  // resolution. No cropping; never upscales (c_limit). Cap snaps to a tier.
  function full(url, maxWidth) {
    if (!isCloudinary(url)) return url;
    var parts = ['q_auto', 'f_auto', 'c_limit', 'w_' + snapWidth(maxWidth || 1600)];
    return inject(url, parts.join(','));
  }

  // Canvas-safe: for images drawn onto a <canvas> (e.g. the size-ref figures).
  // Resizes and compresses but does NOT crop and does NOT change format
  // (no f_auto) — so aspect ratio, transparency/alpha, and cross-origin
  // behaviour are all preserved exactly, and only oversized originals are
  // scaled down (c_limit never upscales). Cap snaps to a tier.
  function canvas(url, maxWidth) {
    if (!isCloudinary(url)) return url;
    var parts = ['c_limit', 'w_' + snapWidth(maxWidth || 1600), 'q_auto'];
    return inject(url, parts.join(','));
  }

  return { thumb: thumb, full: full, canvas: canvas, WIDTH_TIERS: WIDTH_TIERS };
})();
