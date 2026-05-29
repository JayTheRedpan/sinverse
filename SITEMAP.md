# Sinverse — Project Sitemap
# Paste this at the start of any session to re-establish full project context.

## Site Structure
```
sinverse/
  _shared/
    styles-global.css     — design tokens, fonts, global buttons, nav bar
    nav.js                — global navigation component (initNav(pageId))
    registry.js           — resolves entity IDs to URLs
  _data/
    characters.json       — 43 characters, all with images
    tags.json             — canonical tag lists for gallery/library/cyoa
  images/
    logo.png
    favicon.ico
    apple-touch-icon.png
  index.html              — landing page + age gate + nav cards + Discord link
  robots.txt              — blocks all crawlers
  SCHEMAS.md              — data schema reference for all JSON files
  CONTENT_CHECKLIST.md    — step-by-step guide for adding each content type

  wiki/
    index.html            — wiki SPA (characters, lore, timeline)
    lore.json             — sidebar lore page registry
    timeline.json         — timeline events
    lore/                 — lore page markdown files
    characters/           — character page markdown files (prose only, stats from characters.json)
    articles/             — general wiki articles

  library/
    index.html            — story browser
    library.js            — browser logic
    reader.html           — story reader (supports .md and legacy .html)
    reader.js             — reader logic (marked.js for md rendering)
    library.json          — story manifest
    collections.json      — curated collections
    styles.css
    stories/              — story .md files (one per chapter or standalone)

  cyoa/
    index.html            — adventure browser + reader
    app.js                — SPA logic (adventure browser, reader, author screen)
    cyoa.json             — adventure manifest (index of all adventures)
    adventures/
      captured.json       — node structure (choices, authors, tags, images)
      captured.md         — node text (## id headings)
    styles.css
    builder.css / builder.js / new-story.html / submit.js

  gallery/
    index.html
    gallery.js
    gallery.json          — image manifest
    styles.css

  sizeref/
    index.html
    sizeref.js            — all sizeref logic (~170kb)
    styles.css
    defaults.json         — build types, silhouette defaults, headshot defaults
    objects.json          — comparison objects (12 items)

  contributors/
    index.html
    contributors.js
    contributors.json     — contributor profiles
    styles.css
```

## Sub-site Status
| Sub-site     | Status      | Notes |
|---|---|---|
| Landing page | Complete    | Age gate, nav cards, Discord link |
| Wiki         | Complete    | Characters, lore, timeline, imperial/metric toggle |
| Library      | Complete    | .md story files, marked.js rendering, collections |
| CYOA         | Complete    | JSON structure + .md prose, author credits, browser history |
| Gallery      | Complete    | Cloudinary images, search, filters |
| Sizeref      | Complete    | Height/length/stats, sandbox, ruler, custom chars (up to 8) |
| Contributors | Complete    | Auto-counts from gallery/library/cyoa, CYOA author link |

## Infrastructure
- Hosting: GitHub Pages
- Domain: sinverse.net (Porkbun DNS)
- Images: Cloudinary (cloud: dq40xaaux)
- Deployment: GitHub Desktop → sinverse repo
- Age gate: sessionStorage `sinverse_age_ok`

## Content File Conventions
- **Characters** — stats in `_data/characters.json`, prose in `wiki/characters/{name}.md`
- **Library stories** — metadata in `library/library.json`, prose in `library/stories/{file}.md`
- **CYOA adventures** — structure in `cyoa/adventures/{id}.json`, prose in `cyoa/adventures/{id}.md`
- **Lore pages** — registered in `wiki/lore.json`, content in `wiki/lore/{id}.md`
- **Contributor id** — defined in `contributors/contributors.json`, referenced in gallery/library/cyoa

## Key Design Tokens
- `--bg`: #110d0b (near black)
- `--accent`: #c49a78 (rose-gold)
- `--wine`: #7a2233 (deep burgundy)
- `--font-display`: Cormorant Garamond
- `--font-caps`: Cormorant SC
- `--font-body`: EB Garamond

## Sizeref Key Details
- Custom characters: up to 8, stored in localStorage `sinverse_custom_chars` as `{chars:[]}`
- State keys (flip/rotation/resize): `{slotIdx}_{charValue}` e.g. `0_canon_1`
- Sandbox positions: `sandboxPositions{}` keyed by slot index, persists across renders via `applySandboxPositions()`
- URL params: `?char1=sin&char2=jay&view=height&screenshot=1`

## CYOA Key Details
- Node 1 is always the adventure entry point
- `nextId: null` = dead end / WIP branch (reader shows coming soon state)
- Author screen accessible at `?authorId={id}`
- `parseMdBlurbs()` splits .md on `## {id}` headings, injects into nodes before render

## Known Pending Items
- Crop modal blank when editing custom char with existing image (IndexedDB/cropImgs not backfilled)
- Age gate live domain test
- CYOA builder (new-story.html) functional test
- Dead-end "coming soon" state on adventure cards for incomplete adventures

## Current Session Focus
[update each session]
