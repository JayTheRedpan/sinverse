# Sinverse Data Schemas
Reference for all JSON data files. Fields marked `*` are required; all others default to `null` or `false`.

---

## `_data/characters.json`

```json
{
  "id": 0,                          // * integer, unique
  "name": "Jay",                    // * display name
  "species": "Red Panda",           // * species
  "pronouns": "he/him",             // display pronouns
  "age": null,                      // actual age in years, null if unknown
  "age_appearance": "adult",        // child | teen | adult | elder
  "height": 67,                     // * height in inches (canonical)
  "height_correction": 1,           // pose multiplier (1 = standing straight)
  "headroom_pct": 0,                // % of image height above head (for silhouette positioning)
  "weight": 130,                    // weight in lbs, null = calculated from build
  "build": "athletic",              // slight | average | athletic | heavy | massive
                                    // (refs defaults.json builds; used for strength calcs)
  "length": 5,                      // penis length in inches, null if N/A
  "length_correction": 1,           // pose multiplier for length image
  "image": "https://...",           // height/silhouette image URL
  "length_image": "https://...",    // length view image URL
  "profile_image": "https://...",   // portrait/headshot URL
  "wiki": "jay",                    // wiki page slug (usually name.toLowerCase())
  "faction": "SinCorp",             // faction name, null if none
  "status": "active",               // active | deceased | unknown
  "transformed_by": null,           // "apotheosis-serum" | "project-sylph" | null (untransformed)
  "canonical": true,                // true = official canon character
  "anatomy": {
    "breasts": true,
    "bustSize": "d",                // flat|a|b|c|d|dd|f|g|h|j, null if breasts: false
    "penis": false,
    "vag": true
  }
}
```

---

## `gallery/gallery.json`

```json
{
  "id": 1,                          // * integer, unique
  "type": "scene",                  // * comic | scene | charref
  "title": "...",                   // * display title
  "artist": "FastTrack",            // contributor id (matches contributors.json)
  "image": "https://...",           // * main image URL (scene/charref)
  "pages": ["https://..."],         // comic pages array (comics only)
  "coverImage": "https://...",      // comic cover (optional — defaults to pages[0])
  "synopsis": "...",                // description shown in viewer
  "characters": ["jay", "sin"],     // character names (lowercase, matches characters.json name)
  "tags": ["explicit"],             // content tags (matches tags.json gallery array)
  "canonical": false,               // true = official canon piece
  "date": "2025-01",                // real-world publish date "YYYY-MM", null if unknown
  "universe_date": "T+3"            // in-universe date (T±N format), null if ambiguous
}
```

---

## `library/library.json`

```json
{
  "id": 1,                          // * integer, unique
  "type": "standalone",             // * standalone | serial
  "title": "...",                   // * display title
  "author": "RonaSerena",           // contributor id (matches contributors.json)
  "synopsis": "...",                // blurb shown in grid card
  "characters": ["jay"],            // character names (lowercase)
  "tags": ["explicit"],             // content tags (matches tags.json story array)
  "canonical": false,
  "date": "2025-01",                // real-world publish date "YYYY-MM"
  "universe_date": "T+3",          // in-universe date (T±N format), null if ambiguous
  "file": "stories/filename.md",   // standalone only — path to markdown file
  // word count is calculated dynamically from story file content
  "complete": true,                 // serial only — is the serial finished?
  "chapters": [                     // serial only
    {
      "title": "Chapter 1",
      "file": "stories/serial_ch1.md",
      "wordCount": 1800
    }
  ]
}
```

---

## `contributors/contributors.json`

```json
{
  "id": "FastTrack",                // * unique handle, used as artist/author credit everywhere
  "name": "FastTrack",             // * display name
  "avatar": "https://...",          // profile image URL
  "bio": "",                        // short bio, "" if none
  "types": ["Artist"],             // Artist | Writer | 3D Artist | CYOA Author
  "socials": {
    // omit keys entirely if empty — only include platforms with values
    "twitter": "",                  // full URL or empty string
    "bluesky": "",
    "furaffinity": "",              // full URL or handle
    "deviantart": "",
    "artstation": "",
    "patreon": "",
    "discord": "",                  // username only (not a link)
    "website": ""                   // full URL
  }
}
```

---

## `wiki/lore.json`

```json
{
  "id": "sincorp",                  // * matches lore/*.md filename
  "label": "SinCorp",              // * sidebar display name
  "section": "Organizations"        // * sidebar category heading
}
```

---

## `wiki/timeline.json`

```json
{
  "id": "tday",                     // * unique slug
  "era": "anchor",                  // * anchor | pre | post
  "date": "T±0",                   // * display date (T±0 | T-N | T+N | TBD)
  "title": "TDay",                 // * event name
  "summary": "...",                 // * expanded detail text
  "tags": ["sin", "sincorp"]       // lore/character ids for Related links
}
```

---

## `sizeref/defaults.json` — builds array

```json
{
  "id": "athletic",
  "label": "Athletic",
  "referenceWeight": 195,           // reference weight at 5'10" in lbs
  "bodyFatPct": 14,                 // body fat percentage (for future strength calcs)
  "muscleRatio": 0.55,              // muscle mass as fraction of lean mass
  "description": "Muscular, fit build"
}
```

Builds: `slight` | `average` | `athletic` | `heavy` | `massive`

---

## `cyoa/cyoa.json` — adventure manifest

```json
{
  "id": "the_hollow_forest",        // * matches adventures/*.json filename
  "title": "The Hollow Forest",    // * display title
  "description": "...",             // cover blurb
  "tags": ["giantess"],            // giantess | toy
  "coverImage": "https://..."       // cover image URL
}
```

## `cyoa/adventures/*.json` — adventure nodes

```json
{
  "id": "node_001",                 // * unique within adventure
  "blurb": "...",                   // * scene text
  "author": "CharitysSongbird",     // contributor id, "Anonymous" if uncredited
  "image": "https://...",           // optional scene image
  "theme": "dark",                  // optional theme tag
  "choices": [
    {
      "text": "Go left",
      "target": "node_002"
    }
  ]
}
```

---

## `tags.json`

```json
{
  "gallery": ["noncon", "snuff", "gore", "vore", "watersports", "scat", "abuse", "bdsm", "micro"],
  "story":   ["noncon", "snuff", "gore", "vore", "watersports", "scat", "abuse", "bdsm", "micro"],
  // "story" applies to both library items AND cyoa adventure nodes
  "cyoa":    ["giantess", "toy"]
}
```

---

## Contributor ID Convention

The `id` field in `contributors.json` is the **single source of truth** for credits. Use it exactly (case-sensitive) in:
- `gallery.json` → `artist`
- `library.json` → `author`
- `cyoa/adventures/*.json` → `author`

Use `"Anonymous"` (capital A) for uncredited contributions — the contributors page counts these for the anonymous total.

---

## In-Universe Date Format

All `universe_date` fields use the **T±N** system:
- `"T-3"` — 3 years before TDay
- `"T±0"` — on TDay itself
- `"T+3"` — 3 years after TDay
- `"T+3 to T+4"` — spans a period
- `null` — ambiguous or unknown
