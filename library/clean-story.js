/**
 * Sinverse Story Cleaner
 * 
 * Converts messy Word/Google Docs exported HTML into clean
 * story-ready HTML for the Sinverse library reader.
 * 
 * Usage:
 *   node clean-story.js input.html output.html
 * 
 * Or to clean all .html files in a folder:
 *   node clean-story.js ./raw/ ./library/stories/
 */

const fs   = require('fs');
const path = require('path');

// Windows-1252 / Latin-1 character map for common problem characters
var WIN1252 = {
  '\u0080': '€',  // euro sign
  '\u0082': '‚',  // single low quote
  '\u0083': 'ƒ',  // latin small f with hook
  '\u0084': '„',  // double low quote
  '\u0085': '…',  // ellipsis
  '\u0086': '†',  // dagger
  '\u0087': '‡',  // double dagger
  '\u0088': 'ˆ',  // modifier circumflex
  '\u0089': '‰',  // per mille sign
  '\u008a': 'Š',  // latin capital S with caron
  '\u008b': '‹',  // single left angle quote
  '\u008c': 'Œ',  // latin capital ligature OE
  '\u008e': 'Ž',  // latin capital Z with caron
  '\u0091': '‘',  // left single quote
  '\u0092': '’',  // right single quote / apostrophe
  '\u0093': '“',  // left double quote
  '\u0094': '”',  // right double quote
  '\u0095': '•',  // bullet
  '\u0096': '–',  // en dash
  '\u0097': '—',  // em dash
  '\u0098': '˜',  // small tilde
  '\u0099': '™',  // trade mark sign
  '\u009a': 'š',  // latin small s with caron
  '\u009b': '›',  // single right angle quote
  '\u009c': 'œ',  // latin small ligature oe
  '\u009e': 'ž',  // latin small z with caron
  '\u009f': 'Ÿ',  // latin capital Y with diaeresis
};

function fixEncoding(str) {
  // Replace Windows-1252 control range characters with proper Unicode
  return str.replace(/[\u0080-\u009f]/g, function(ch) {
    return WIN1252[ch.toLowerCase()] || ch;
  });
}

function cleanHtml(raw) {
  // Fix encoding issues before any other processing
  raw = fixEncoding(raw);
  // -- Extract body content if full HTML document
  var body = raw.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  var content = body ? body[1] : raw;

  // -- Strip Word/Docs specific tags entirely
  content = content
    .replace(/<o:p[^>]*>[\s\S]*?<\/o:p>/gi, '')        // Word XML tags
    .replace(/<\/?o:[^>]*>/gi, '')                       // other Word namespace tags
    .replace(/<\/?w:[^>]*>/gi, '')                       // Word w: tags
    .replace(/<\/?m:[^>]*>/gi, '')                       // Word m: tags
    .replace(/<xml[^>]*>[\s\S]*?<\/xml>/gi, '')          // XML blocks
    .replace(/<!--\[if[^>]*>[\s\S]*?<!\[endif\]-->/gi, '') // IE conditionals
    .replace(/<!--.*?-->/gs, '')                         // HTML comments
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')      // inline style blocks
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')    // any scripts
    .replace(/<meta[^>]*>/gi, '')                        // meta tags
    .replace(/<link[^>]*>/gi, '');                       // link tags

  // -- Strip all inline styles and class attributes
  content = content
    .replace(/\s*style="[^"]*"/gi, '')
    .replace(/\s*class="[^"]*"/gi, '')
    .replace(/\s*lang="[^"]*"/gi, '')
    .replace(/\s*id="[^"]*"/gi, '');

  // -- Unwrap meaningless span tags (now empty of attributes)
  content = content.replace(/<span>([\s\S]*?)<\/span>/gi, '$1');

  // -- Convert common formatting
  content = content
    .replace(/<b>([\s\S]*?)<\/b>/gi, '<strong>$1</strong>')
    .replace(/<i>([\s\S]*?)<\/i>/gi, '<em>$1</em>')
    .replace(/<u>([\s\S]*?)<\/u>/gi, '$1')              // strip underline
    .replace(/<font[^>]*>([\s\S]*?)<\/font>/gi, '$1');  // strip font tags

  // -- Convert heading tags to h2 (h1 reserved for story title)
  content = content
    .replace(/<h[3-6][^>]*>/gi, '<h2>')
    .replace(/<\/h[3-6]>/gi, '</h2>');

  // -- Clean up divs -- convert to paragraphs if they contain text
  content = content
    .replace(/<div[^>]*>\s*<\/div>/gi, '')               // empty divs
    .replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, '<p>$1</p>'); // div -> p

  // -- Clean up paragraph tags
  content = content
    .replace(/<p[^>]*>\s*<\/p>/gi, '')                   // empty paragraphs
    .replace(/<p[^>]*>/gi, '<p>');                        // strip p attributes

  // -- Horizontal rules for scene breaks
  content = content.replace(/<hr[^>]*>/gi, '<hr />');

  // -- Clean up line breaks
  content = content
    .replace(/<br\s*\/?>/gi, '<br />')
    .replace(/(<br \/>){3,}/gi, '<hr />');               // 3+ breaks -> scene break

  // -- Clean up whitespace
  content = content
    .replace(/&nbsp;/g, ' ')                             // non-breaking spaces
    .replace(/\u00A0/g, ' ')                             // unicode nbsp
    .replace(/[ \t]+/g, ' ')                             // collapse spaces
    .replace(/\n{3,}/g, '\n\n')                          // collapse blank lines
    .replace(/^\s+|\s+$/g, '');                          // trim

  // -- Final: strip any remaining unknown tags but keep content
  // (keep p, h2, strong, em, hr, br, a, ul, ol, li)
  var allowed = ['p', 'h2', 'strong', 'em', 'hr', 'br', 'a', 'ul', 'ol', 'li', 'blockquote'];
  content = content.replace(/<\/?([a-z][a-z0-9]*)[^>]*>/gi, function(match, tag) {
    if (allowed.includes(tag.toLowerCase())) return match;
    return ''; // strip unknown tags, keep inner content
  });

  return content.trim();
}

function processFile(inputPath, outputPath) {
  // Read file as raw buffer
  var buf = fs.readFileSync(inputPath);

  // Strip UTF-8 BOM if present
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) buf = buf.slice(3);

  // Decode: try UTF-8 first
  var raw = buf.toString('utf8');

  // If double-encoded garbage is present (Ã¯Â¿Â½ or ï¿½),
  // the file is Latin-1 bytes being read as UTF-8.
  // Re-read as Latin-1 to get the original Windows-1252 bytes.
  if (raw.includes('Ã¯Â¿Â½') || raw.includes('ï¿½') || raw.includes('\ufffd')) {
    raw = buf.toString('latin1');
  }
  if (path.resolve(inputPath) === path.resolve(outputPath)) {
    console.error('ERROR: Input and output are the same file. Use a different output path.');
    process.exit(1);
  }
  var clean   = cleanHtml(raw);
  fs.writeFileSync(outputPath, clean, 'utf8');
  console.log('Cleaned: ' + path.basename(inputPath) + ' -> ' + path.basename(outputPath));
}

// -- CLI handling
var args = process.argv.slice(2);
if (args.length < 2) {
  console.log('Usage: node clean-story.js <input.html> <output.html>');
  console.log('   or: node clean-story.js <input-folder/> <output-folder/>');
  process.exit(1);
}

var input  = args[0];
var output = args[1];

if (fs.statSync(input).isDirectory()) {
  // Batch mode -- process all .html/.htm files in input folder
  if (!fs.existsSync(output)) fs.mkdirSync(output, { recursive: true });
  var files = fs.readdirSync(input).filter(function(f) {
    return f.match(/\.(html?|htm)$/i);
  });
  if (!files.length) {
    console.log('No HTML files found in ' + input);
    process.exit(1);
  }
  files.forEach(function(file) {
    var inPath  = path.join(input, file);
    var outName = path.basename(file, path.extname(file)) + '.html';
    var outPath = path.join(output, outName);
    processFile(inPath, outPath);
  });
  console.log('\nDone. ' + files.length + ' file(s) cleaned.');
} else {
  // Single file mode
  processFile(input, output);
  console.log('\nDone.');
}