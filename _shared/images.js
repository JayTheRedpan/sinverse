// ── Sinverse Cloudinary image helpers ─────────────────────────
// Rewrites Cloudinary delivery URLs to request resized, compressed,
// auto-format thumbnails instead of full-resolution originals.
//
//   .../image/upload/v123/name.png
//   .../image/upload/w_400,c_fill,q_auto,f_auto/v123/name.png
//
// Non-Cloudinary URLs (or empty values) are returned unchanged, so this
// is always safe to call.
//
// Usage:
//   SinverseImg.thumb(url, 400)          // 400px wide, fill crop
//   SinverseImg.thumb(url, 400, 'fit')   // 400px wide, fit (no crop)
//   SinverseImg.thumb(url, 600, 'fill', 800)  // explicit width + height

window.SinverseImg = (function() {
  function thumb(url, width, mode, height) {
    if (!url || typeof url !== 'string') return url;
    if (url.indexOf('res.cloudinary.com') === -1) return url; // not Cloudinary
    if (url.indexOf('/upload/') === -1) return url;            // unexpected shape

    width = width || 400;
    mode  = mode  || 'fill';   // fill = crop to fill; fit = scale to fit

    var crop = mode === 'fit' ? 'c_fit' : 'c_fill';
    var parts = ['w_' + width];
    if (height) parts.push('h_' + height);
    parts.push(crop, 'q_auto', 'f_auto');
    var transform = parts.join(',');

    // Insert the transformation segment immediately after '/upload/'.
    // Avoid double-applying if a transform is already present.
    return url.replace(/\/upload\/(?!w_|h_|c_|q_|f_)/, '/upload/' + transform + '/');
  }

  // Full-size display (image viewers / lightboxes): keep the image large but
  // still serve it auto-compressed and in a modern format, with a sane max
  // width so enormous originals don't ship at full resolution. No cropping,
  // never upscales (c_limit).
  function full(url, maxWidth) {
    if (!url || typeof url !== 'string') return url;
    if (url.indexOf('res.cloudinary.com') === -1) return url;
    if (url.indexOf('/upload/') === -1) return url;
    var parts = ['q_auto', 'f_auto', 'c_limit', 'w_' + (maxWidth || 1600)];
    return url.replace(/\/upload\/(?!w_|h_|c_|q_|f_)/, '/upload/' + parts.join(',') + '/');
  }

  return { thumb: thumb, full: full };
})();
