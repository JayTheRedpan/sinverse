# Sinverse Content Checklist

Step-by-step reference for adding each type of content. Keep this open alongside the repo.

---

## Adding a Character

### 1. Upload images to Cloudinary
Upload three images (as needed):
- **Height image** — full-body silhouette, transparent background, character standing upright
- **Length image** — for characters with `anatomy.penis: true`, side-profile image
- **Profile image** — portrait/headshot, square-ish crop

Copy the Cloudinary URLs for each.

### 2. Add to `_data/characters.json`
Copy an existing entry and update all fields. Key things to get right:
- `id` — next integer in sequence (check the highest existing id)
- `height` — in **inches** (multiply feet×12, add inches)
- `height_correction` — `1` if standing straight; less than 1 if posed/crouching (e.g. `0.9`)
- `headroom_pct` — percentage of image height that is empty space above the character's head (usually 0–10)
- `transformed_by` — `"apotheosis-serum"` | `"project-sylph"` | `null` (not transformed)
- `anatomy` — set `penis`, `vag`, `breasts` accurately; `bustSize` only if `breasts: true`
- `canonical` — `true` for official characters, `false` otherwise

### 3. Create the wiki page
Create `wiki/characters/{name-lowercase-hyphenated}.md`. Just lore prose — no stats, no frontmatter. Stats auto-populate from `characters.json`.

Suggested sections:
```markdown
## Overview

## Appearance

## Personality

## Lore / History

## Did You Know

- Fun fact one.
- Fun fact two.
```

### 4. Deploy
Commit both files. The character will appear immediately in:
- Sizeref character selector
- Wiki characters grid
- Gallery/library character filters

---

## Adding a Gallery Item

### 1. Upload to Cloudinary
- For a **scene or charref**: upload the image, copy the URL
- For a **comic**: upload each page, copy all URLs in order; optionally upload a separate cover

### 2. Add to `gallery/gallery.json`
```json
{
  "id": 99,
  "type": "scene",
  "title": "Title Here",
  "artist": "ContributorId",
  "image": "https://res.cloudinary.com/...",
  "synopsis": "Short description.",
  "characters": ["jay", "sin"],
  "tags": [],
  "canonical": false,
  "date": "2025-05",
  "universe_date": null              // integer year relative to TDay, or null
}
```

- `artist` must exactly match a `contributors.json` id (case-sensitive)
- `characters` uses lowercase character names matching `characters.json`
- For a comic: use `"pages": ["url1", "url2"]` instead of `"image"`, add `"coverImage"` optionally
- `tags` — only add tags that apply (see `tags.json` for valid values)

### 3. Deploy
That's it. No other files needed.

---

## Adding a Library Story

### 1. Write the story
Export from Word using Pandoc: `pandoc "Story.docx" -o story.md`
Or paste into a `.md` file directly. Plain prose — no special formatting needed beyond:
- Blank lines between paragraphs
- `*italics*` for emphasis
- `---` on its own line for scene breaks

### 2. Name and place the file
Save as `library/stories/{descriptive-filename}.md`.
Convention: `{title-slug}_{author}_{ch1}.md` for serials, `{title-slug}_{author}.md` for standalones.

### 3. Add to `library/library.json`

**Standalone:**
```json
{
  "id": 99,
  "type": "standalone",
  "title": "Story Title",
  "author": "ContributorId",
  "synopsis": "One or two sentence blurb.",
  "characters": ["jay"],
  "tags": [],
  "canonical": false,
  "date": "2025-05",
  "universe_date": null,             // integer year relative to TDay, or null
  "file": "stories/filename.md",
  "wordCount": 2400
}
```

**Serial:**
```json
{
  "id": 99,
  "type": "serial",
  "title": "Serial Title",
  "author": "ContributorId",
  "synopsis": "...",
  "characters": ["sin"],
  "tags": [],
  "canonical": false,
  "date": "2025-05",
  "universe_date": null,             // integer year relative to TDay, or null
  "complete": false,
  "chapters": [
    { "title": "Chapter 1: ...", "file": "stories/serial_ch1.md", "wordCount": 1800 },
    { "title": "Chapter 2: ...", "file": "stories/serial_ch2.md", "wordCount": 2100 }
  ]
}
```

- `wordCount` — count words in the `.md` file (VS Code shows this in the status bar, or use `wc -w filename.md` in terminal)
- `author` must match a `contributors.json` id exactly

### 4. Deploy
Commit the `.md` file and the updated `library.json`.

---

## Adding a CYOA Adventure

### 1. Plan the structure
Sketch the node graph on paper or in a tool like draw.io. Assign integer IDs to each node starting from 1.

### 2. Create the adventure JSON
Save as `cyoa/adventures/{adventure-id}.json`. Structure only — no prose:

```json
[
  {
    "id": 1,
    "author": "ContributorId",
    "image": "https://...",
    "tags": [],
    "choices": [
      { "text": "Choice A", "nextId": 2 },
      { "text": "Choice B", "nextId": 3 }
    ]
  },
  {
    "id": 2,
    "author": "ContributorId",
    "image": null,
    "tags": ["NonCon"],
    "choices": [
      { "text": "Continue", "nextId": null }
    ]
  }
]
```

- `nextId: null` = dead end / WIP branch (shows "coming soon" state)
- Node 1 is always the entry point

### 3. Create the adventure markdown
Save as `cyoa/adventures/{adventure-id}.md`. Write node text under `## {id}` headings:

```markdown
## 1

Scene text for node 1...

## 2

Scene text for node 2...
```

### 4. Add to `cyoa/cyoa.json`
```json
{
  "id": "adventure-id",
  "title": "Adventure Title",
  "description": "One sentence teaser.",
  "tags": ["Toy"],
  "coverImage": "https://..."
}
```

- `id` must match the filename (without `.json`/`.md`)
- `tags` — `"Giantess"` | `"Toy"` — shown on the adventure card

### 5. Deploy
Commit all three files: `cyoa.json`, the adventure `.json`, and the adventure `.md`.

---

## Adding a Contributor

### 1. Upload avatar to Cloudinary
Square crop preferred. Copy the URL.

### 2. Add to `contributors/contributors.json`
```json
{
  "id": "HandleExactly",
  "name": "Display Name",
  "avatar": "https://res.cloudinary.com/...",
  "bio": "Short bio (one or two sentences).",
  "types": ["Artist"],
  "socials": {
    "twitter": "https://twitter.com/handle",
    "furaffinity": "https://www.furaffinity.net/user/handle"
  }
}
```

- `id` is permanent — it links this contributor to all their credits in gallery, library, and CYOA. Don't change it later.
- `types`: `"Artist"` | `"Writer"` | `"3D Artist"` | `"CYOA Author"` — can be multiple
- Only include social keys that have values — omit empty ones entirely

### 3. Deploy
That's it. Their contribution counts (gallery, stories, adventures) auto-calculate.

---

## Adding a Lore Page

### 1. Register in `wiki/lore.json`
```json
{
  "id": "page-id",
  "label": "Display Name",
  "section": "Sidebar Section"
}
```

### 2. Create the markdown file
Save as `wiki/lore/{page-id}.md`. Pure markdown prose. Suggested structure:

```markdown
## Overview

## History

## Key Figures

## Did You Know

- Self-contained fun fact.
- Another fun fact.
```

### 3. Deploy
The page appears in the wiki sidebar immediately under its section.

---

## Adding a Timeline Event

Add to `wiki/timeline.json`:
```json
{
  "id": "unique-slug",
  "era": "post",
  "date": "T+2",
  "title": "Event Name",
  "summary": "Full description shown when expanded. Can be a paragraph or two.",
  "tags": ["sincorp", "jay"]
}
```

- `date`: signed integer — years relative to TDay (negative = before, 0 = TDay, positive = after), or `null` for TBD
- `era`: derived automatically from the date sign (`pre`/`anchor`/`post`) — set it to match
- `tags`: slugs of related lore pages or character names — shown as Related links

---

## Adding Sizeref Objects

Add to `sizeref/objects.json`:
```json
{
  "id": "unique-id",
  "label": "Display Name",
  "height": 72,
  "color": "#888888",
  "image": "https://...",
  "length": null,
  "length_orient_flip": false,
  "length_orient_rotate": 0
}
```

- `height` in **inches**
- `color` — hex color for the fallback shape (shown if no image)
- `image` — optional silhouette/reference image URL
- `length` — only for objects that appear in the length view
- `length_orient_flip` / `length_orient_rotate` — adjust orientation of length image if needed

---

## Quick Reference: Image Specs

| Use | Format | Notes |
|-----|--------|-------|
| Character height image | PNG, transparent bg | Full body, upright |
| Character length image | PNG, transparent bg | Side profile |
| Character profile image | PNG or JPG | Portrait crop |
| Gallery scene | JPG or PNG | Any resolution |
| Gallery comic page | JPG or PNG | Consistent size across pages |
| Contributor avatar | JPG or PNG | Square crop preferred |
| Adventure cover | JPG or PNG | ~800×600 or wider |
| Lore page image | JPG or PNG | Any |

All images hosted on Cloudinary. Upload via the Cloudinary dashboard and copy the full URL.

---

## Common Mistakes

- **Wrong contributor id** — credits break silently if the id doesn't exactly match `contributors.json`. Copy-paste, don't retype.
- **Height in feet instead of inches** — `height: 6` means 6 inches, not 6 feet. Always convert: 6'0" = 72.
- **Missing `## Did You Know` heading** — the bot won't find fun facts if the heading isn't exactly this string, including capitalisation.
- **CYOA node id mismatch** — if a JSON node has `"id": 3` but the markdown has `## 3 ` (trailing space), the blurb won't load. Keep ids clean integers.
- **`nextId` vs `null`** — use `null` for WIP/dead-end branches. The reader shows a "coming soon" state, not an error.
