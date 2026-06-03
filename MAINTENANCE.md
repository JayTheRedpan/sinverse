# Sinverse — Maintenance Guide

This is the **plain-English operations manual** for keeping the site running and
making changes safely on your own. It complements two other docs:

- **`SITEMAP.md`** — the file/folder map and what each piece is.
- **`SCHEMAS.md`** — the exact shape of every JSON data file (what fields mean).
- **`CONTENT_CHECKLIST.md`** — step-by-step recipes for adding content.

Read those for *what things are*. Read **this** for *how to change them, how to
deploy, and what to do when something breaks.*

> Written for someone comfortable reading code but who isn't a daily developer.
> When in doubt, the golden rule is at the bottom: **change one thing, test it
> locally, then deploy.**

---

## 1. The 60-second mental model

The site is a **static website** — plain HTML, CSS, and JavaScript files. There
is **no server, no database, no build step.** What's in the folder is exactly
what runs. That's good news: you can open any file, edit it, and see the result.

- **Hosting:** GitHub Pages (free). The files live in a GitHub repo; pushing to
  it publishes the site.
- **Domain:** sinverse.net, DNS managed at Porkbun, pointed at GitHub Pages.
- **Images:** hosted on Cloudinary (account/cloud name: `dq40xaaux`). The site
  just references Cloudinary URLs; it doesn't store images itself.
- **Data:** lives in `.json` files (structured data) and `.md` files (prose).
  The pages fetch these at load time and render them. **To change content, you
  edit a JSON or MD file — you rarely touch the page logic.**

Each "module" (wiki, library, gallery, cyoa, sizeref, contributors) is a
self-contained folder with its own `index.html`, `.js`, and `.css`. They share a
few things from the `_shared/` folder (the top nav bar, the age gate, the design
colors/fonts).

---

## 2. How to deploy a change

You've been using **GitHub Desktop**. The flow:

1. Make your edit to a file (locally, in the `sinverse` repo folder).
2. Test locally first (see §3).
3. Open GitHub Desktop — it shows your changed files.
4. Write a short summary in the bottom-left box (e.g. "Add new gallery image").
5. Click **Commit to main**.
6. Click **Push origin** (top bar).
7. Wait ~1–2 minutes. GitHub Pages rebuilds and the live site updates.

If the live site doesn't seem to update, it's almost always **browser caching** —
see §5 on cache-busting, and try a hard refresh (Ctrl+Shift+R / Cmd+Shift+R).

---

## 3. How to test locally before deploying

Never push untested changes. Two easy ways to preview locally:

- **VS Code "Live Server" extension** (you've been using `127.0.0.1:5500`). Right
  click an HTML file → "Open with Live Server."
- Or any simple static server (e.g. `python3 -m http.server` in the site folder,
  then visit `http://localhost:8000`).

You need a real local server (not just double-clicking the HTML file) because the
pages **fetch JSON/MD files**, and browsers block that for `file://` pages.

**Validate JavaScript before deploying.** If you edited a `.js` file and have
Node installed, run `node --check path/to/file.js`. It catches typos/syntax
errors instantly. A single missing comma or brace can break an entire page, and
this is the fastest way to catch it.

**Validate CSS braces.** Most CSS breakage is an unbalanced `{ }`. A quick check:
the number of `{` should equal the number of `}` in the file.

---

## 4. The folder layout (and one important trap)

See `SITEMAP.md` for the full tree. The essentials:

```
sinverse/
  index.html            ← landing page (age gate, module cards, intro modal)
  _shared/              ← shared across all modules
    styles-global.css   ← THE design system: colors, fonts, nav bar, buttons
    nav.js              ← the top navigation bar (initNav('modulename'))
    agegate.js          ← the 18+ gate
    images.js, dates.js, registry.js ← small shared helpers
  _data/                ← SHARED data (characters, tags) used by multiple modules
  images/               ← logo, favicon
  wiki/  library/  gallery/  cyoa/  sizeref/  contributors/   ← the six modules
  admin/                ← a hidden internal page
```

### ⚠️ TRAP: there are TWO data folders, only one is real

There is a `_data/` folder **and** a `data/` folder. **The site only uses
`_data/` (with the underscore).** The `data/` folder is leftover/orphaned and is
**not** referenced by any code. If you edit `data/characters.json` expecting a
change, nothing will happen — you must edit `_data/characters.json`.

> Recommendation: once you're confident, you can delete the `data/` folder to
> avoid confusion. Verify first that nothing references it (search the codebase
> for `"data/` without the underscore — there should be zero matches in JS/HTML).

---

## 5. Cache-busting (why edits sometimes "don't show up")

Browsers cache `.js` and `.css` files. To force visitors to get the new version
after you change one, the HTML references them with a **version string**, like:

```html
<script src="sizeref.js?v=1780461048"></script>
<link rel="stylesheet" href="styles.css?v=1780461048" />
```

The `?v=...` number is just a timestamp. **When you change a `.js` or `.css`
file, you must also bump that number** in the HTML that loads it, or returning
visitors keep the old cached copy.

Rules of thumb learned building this site:
- **`.js` files** are almost always referenced *with* `?v=` → bump it after edits.
- **Some `.css` files are referenced WITHOUT `?v=`** (e.g. the per-module
  `styles.css` in a few modules). Those are fetched fresh every time, so no bump
  is needed. Check how the HTML references the file before assuming.
- **JSON and MD data files** are fetched live (no version string) — edits to
  content show up immediately, no cache-bust needed.
- **`_shared/` files** (nav.js, agegate.js, styles-global.css) are referenced
  from *every* module's HTML. If you change one, you must bump its `?v=` in
  **all** the pages that load it, not just one.

Any number works as long as it changes; using the current Unix timestamp is just
a convenient way to guarantee it's new.

---

## 6. The design system (colors & fonts)

All colors and fonts are defined once as **CSS variables** ("design tokens") in
`_shared/styles-global.css`. Use these instead of hardcoding values, so the look
stays consistent.

| Token | Value | Use |
|---|---|---|
| `--bg` | #110d0b | page background (near-black) |
| `--bg-panel` | #1a1210 | panels |
| `--bg-card` | #1f1613 | cards |
| `--bg-inset` | #150f0d | inset/recessed areas, inputs |
| `--accent` | #c49a78 | rose-gold accent (buttons, highlights) |
| `--accent-light` | #dbb89a | brighter accent (hovers) |
| `--text-primary` | #f5ece0 | main text (bright) |
| `--text-secondary` | #c4a882 | secondary text |
| `--text-muted` | #a08870 | dim/subtle text |
| `--wine` | #7a2233 | deep burgundy (delete/danger) |
| `--font-display` | Cormorant Garamond | headings |
| `--font-caps` | Cormorant SC | small-caps labels/buttons |
| `--font-body` | EB Garamond | body text |

In CSS you reference a token as `color: var(--accent);`. To brighten dim text,
change `var(--text-muted)` to `var(--text-secondary)`.

> **Gotcha we hit:** the CYOA module had *overridden* these tokens with darker
> values and a smaller base font (`html { font-size: 17px }`) in its own
> `styles.css`. That made it look dimmer/smaller than the other modules. If a
> module ever looks "off," check whether it redefines `:root` tokens or the
> `html` font-size. The shared default is `18px`.

---

## 7. The global navigation bar — and its #1 recurring bug

`_shared/nav.js` injects a **fixed 52px-tall top bar** on every module page when
the page calls `initNav('modulename')`. To make room, it adds `padding-top: 52px`
to the `<body>` (via a `body.has-global-nav` class).

### ⚠️ The recurring "I have to scroll to see everything" bug

Any element styled `height: 100vh` will be **52px too tall**, because `100vh` is
the full screen but the content area starts 52px down (below the nav). This
caused scroll/overflow bugs in the gallery viewer and the sizeref app.

**The fix pattern** (already applied where needed): scope a height override to
the nav case, e.g.:

```css
body.has-global-nav .sr-app { height: calc(100vh - 52px); }
```

So if you ever add a new full-height layout and it overflows by a sliver / forces
scrolling, this is almost certainly why. Subtract 52px when the global nav is
present. On mobile, full-height layouts usually switch to `height: auto` so the
page scrolls normally — make sure your mobile rule still wins (the
`body.has-global-nav` selector is more specific, so the mobile override often
needs to include it too).

---

## 8. The age gate

`_shared/agegate.js` runs first on every module page. If the visitor hasn't
confirmed 18+ this browser session, it redirects them to the landing page's age
gate, remembering where they were headed.

- Confirmation is stored in `sessionStorage` under the key `sinverse_age_ok`
  (value `'1'`). "Session" means it resets when the browser tab is fully closed.
- **Bot/screenshot bypass:** a URL with `?screenshot=1` skips the age gate
  entirely (so the Discord bot's automated image capture works). This is
  intentional — see §10.

---

## 9. Common content edits (recipes)

`CONTENT_CHECKLIST.md` has the detailed steps. Quick reference for the most
common tasks:

### Add a gallery image / comic / set
Edit `gallery/gallery.json`. Each entry needs an `id`, `type`
(`scene`/`comic`/`charref`/`set`), `title`, `artist`, image URL(s), `tags`, etc.
(see SCHEMAS.md). The artist name should match a contributor `id` so the
"by [artist]" link works. **No cache-bust needed** (JSON is fetched live).

### Add a library story
1. Write the prose as a `.md` file in `library/stories/`.
2. Add an entry to `library/library.json` pointing at it (title, author, tags,
   file path).

### Add a wiki character
1. Stats go in `_data/characters.json` (height in **inches**, etc. — see SCHEMAS).
2. Prose goes in `wiki/characters/{name}.md`.
3. The wiki reads both and renders the page.

### Add a wiki lore page
1. Write `wiki/lore/{id}.md`.
2. Register it in `wiki/lore.json` so it appears in the sidebar.

### Add a CYOA adventure
1. Structure (nodes, choices, branches) → `cyoa/adventures/{id}.json`.
2. Prose for each node → `cyoa/adventures/{id}.md` (split by `## {nodeId}`
   headings).
3. Register it in `cyoa/cyoa.json`.
Node 1 is always the entry point. `nextId: null` marks a dead-end / unfinished
branch.

### Add/edit a tag (for gallery/library/cyoa filters)
Edit `_data/tags.json`. It holds the canonical tag lists. **If a tag exists on
content but not in this file, no filter button appears for it** — that was the
cause of a "filtering doesn't work" bug once. Keep the lists in sync with the
tags actually used.

### Add a contributor
Edit `contributors/contributors.json`. Their `id` (lowercased) is what links
gallery/library/cyoa content back to their profile. Contribution counts are
auto-tallied from the other modules.

---

## 10. The sizeref module (the most complex piece)

`sizeref/sizeref.js` (~5000 lines) is the biggest single file. You probably won't
edit its logic often, but here's what matters:

- **Character heights are in INCHES** everywhere. 72 = 6 ft, 144 = 12 ft.
- **Canon characters** come from `_data/characters.json`. **Custom characters**
  are created by the user in-app and stored in the browser's `localStorage` under
  `sinverse_custom_chars` as `{ chars: [ {id:'custom_1', ...}, ... ] }`. Custom
  character *images* are stored separately in the browser's IndexedDB.
- **Config files:** `defaults.json` (silhouettes, build types, poses),
  `objects.json` (comparison objects like a soda can), `builds.json` (body types).
- **Stats math:** the `calcStats()` function. It scales real-world averages by
  size using proper physics (linear dimensions scale with height, volumes/masses
  with the cube). Penis girth/width scale from the character's *length*, not
  height. Fluid outputs use an intentional exaggeration (`mass^1.5`).

### The Discord bot image API (URL parameters)

The sizeref page can render an image from URL parameters alone — this is what the
Discord bot uses. Append `&screenshot=1` and the page replaces itself with a
single PNG of the comparison.

**Parameters:**
- `char1`, `char2` — canon character *name* (e.g. `char1=Sin`)
- `h1`, `h2` — height in inches → creates a **custom** character instead
- `n1`, `n2` — name label for a custom character
- `l1`, `l2` — length in inches (optional, for the length view)
- `w1`, `w2` — weight in lbs (optional)
- `view` — `height` | `length` | `stats`
- `screenshot=1` — output mode (bypasses age gate, returns a single image)
- `scale=1` — include the measurement ruler (off by default)

**Example URLs:**
```
/sizeref/?char1=Jay&char2=Sin&view=height&screenshot=1
/sizeref/?h1=66&n1=Mia&h2=180&n2=Vera&view=height&screenshot=1
/sizeref/?h1=72&n1=Rex&l1=18&char2=Sin&view=length&screenshot=1&scale=1
```

> If the bot images ever break after a sizeref change, the likely culprits are:
> (a) the custom-character storage shape changed (the param code builds chars in
> the same shape the app uses — they must stay in sync), or (b) the capture waits
> ~800ms for render then replaces the page; a `_screenshotDone` flag stops
> later renders from erroring. The view-tab class is `.sr-view-tab`.

---

## 11. Troubleshooting playbook

**"My change isn't showing on the live site."**
1. Did you commit AND push in GitHub Desktop?
2. Wait 1–2 min for GitHub Pages to rebuild.
3. Hard refresh (Ctrl/Cmd+Shift+R).
4. If it's a JS/CSS change, did you bump the `?v=` cache-bust number? (§5)

**"A whole page is blank / broken after I edited a .js file."**
A syntax error breaks the entire script. Open the browser console (F12 →
Console) to see the error and line number. Run `node --check file.js` to find it.
Most often: a missing comma, brace, or quote.

**"A page looks unstyled / colors are wrong."**
Likely a CSS syntax error (unbalanced braces) — everything after the broken rule
is ignored. Check the `{ }` balance. Or a token was changed in
`styles-global.css` affecting everything.

**"I have to scroll to see the whole app / something overflows by a bit."**
The 52px global-nav height bug. See §7.

**"Filters don't filter / a tag is missing."**
The tag isn't in `_data/tags.json`. Add it. (§9)

**"Images are missing/broken."**
The Cloudinary URL is wrong or the image was removed from Cloudinary. The site
only references URLs; it doesn't host images. Check the URL in the JSON.

**"Bot images / screenshot URLs flash then go blank."**
Almost always the age gate redirecting. Confirm `?screenshot=1` is in the URL
(it bypasses the gate). (§8, §10)

**"I edited content JSON and nothing changed."**
Are you editing the file in `_data/` (correct) or the orphaned `data/` folder
(ignored)? (§4)

---

## 12. Outstanding / future work

- **Analytics** — not yet added. Options discussed: Cloudflare Web Analytics
  (free, needs moving DNS nameservers to Cloudflare, confirm their policy allows
  adult content) or Plausible (~$9/mo, one script tag, no DNS change).
- **CYOA submissions backend** — `cyoa/SinverseSubmissions.gs` is a Google Apps
  Script that receives the submission form. Confirm it's authorized and working;
  archive the old forms.
- **Discord bot** — the image API (§10) is ready; the bot program itself is
  separate work.
- **Gallery pagination** — deferred until ~100–150 images make one page too long.
- **Cleanup** — consider deleting the orphaned `data/` folder (§4) once verified
  unused.

---

## 13. The golden rules

1. **Change one thing at a time**, test locally, then deploy. Don't batch a dozen
   edits and push blind.
2. **Edit data, not logic, for content.** Adding a character/story/image means
   editing a JSON or MD file — you should almost never need to touch the page
   JavaScript.
3. **Bump the `?v=` number** whenever you change a `.js` (and versioned `.css`).
4. **`_data/` not `data/`.**
5. **Subtract 52px** when a full-height layout fights the global nav.
6. When stuck, the **browser console (F12)** tells you what's wrong — read the
   error, note the file and line, and fix that spot.
