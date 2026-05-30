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
  "universe_date": 3                 // in-universe year relative to TDay (integer), null if unknown
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
  "universe_date": 3,                // in-universe year relative to TDay (integer), null if unknown
  "file": "stories/filename.md",   // standalone only — path to .md file in /stories/
  "wordCount": 1800,                 // pre-calculated word count (update after writing)
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
  "era": "anchor",                  // derived from date sign: pre (<0) | anchor (0) | post (>0)
  "date": 0,                        // * integer year relative to TDay; null = TBD
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

## `cyoa/adventures/*.json` — adventure nodes (structure only)

Node text lives in the companion `.md` file — **not** in the JSON.

```json
{
  "id": 1,                          // * integer node id — matches ## heading in .md
  "title": "Awakening",             // * short scene title (shown in breadcrumb and author credit)
  "author": "CharitysSongbird",     // * contributor id, "Anonymous" if uncredited
  "image": "https://...",           // optional scene image URL
  "tags": ["NonCon"],               // content tags
  "choices": [
    {
      "text": "Go left",
      "nextId": 2                   // integer id of next node, null = dead end (WIP)
    }
  ]
}
```

## `cyoa/adventures/*.md` — adventure node text

One file per adventure. Sections delimited by `## {nodeId}` headings.

```markdown
## 1

The steel below your naked body was cold...

## 2

Gazing back you can't help but flush...
```

- Node IDs must match the integer `id` fields in the companion `.json`
- Plain markdown — italics `*like this*`, scene breaks `---`
- No frontmatter needed

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

All `universe_date` and timeline `date` fields use a **signed integer** representing years relative to TDay:
- `-3` — 3 years before TDay
- `0` — on TDay itself (Year Zero)
- `3` — 3 years after TDay
- `null` — unknown / TBD

For content spanning a range, store the **starting** year (single anchor point). The UI formats these as `T-3`, `T±0`, `T+3` at display time.

---

## Bot Integration

### Wiki — Fun Facts

Any lore or character markdown page can include a `## Did You Know` section at the **bottom** of the file. The Discord bot scrapes this section and picks a random bullet point to post.

**Convention:**
- Heading must be exactly `## Did You Know` (case-sensitive)
- Each fact is a single `- ` bullet point on its own line
- Facts should be self-contained (readable without context)
- Keep facts under ~280 characters for Discord readability

**Example (`wiki/lore/sincorp.md`):**
```markdown
## Did You Know

- SinCorp was founded three years before TDay under the cover of a pharmaceutical company.
- At its peak, SinCorp employed over 40,000 people who had no idea what they were really working on.
```

The bot fetches the raw markdown from:
`https://sinverse.net/wiki/lore/{id}.md` or `https://sinverse.net/wiki/characters/{name}.md`

---

### Sizeref — URL Params (Bot/Deeplink)

The sizeref tool accepts URL params to pre-configure a comparison for bot screenshots or sharing.

| Param | Description | Example |
|-------|-------------|---------|
| `char1` | Canon character name (case-insensitive) | `char1=sin` |
| `char2` | Canon character name (case-insensitive) | `char2=jay` |
| `h1` | Height in inches for a generic character | `h1=72` |
| `n1` | Display name for generic character 1 | `n1=Alice` |
| `h2` | Height in inches for a generic character | `h2=144` |
| `n2` | Display name for generic character 2 | `n2=Mystery` |
| `view` | Which view to open | `view=height` (height\|length\|stats\|compare) |
| `screenshot` | Hides UI chrome for clean bot screenshots | `screenshot=1` |

**Example URLs:**
```
# Two canon characters
https://sinverse.net/sizeref/?char1=sin&char2=jay&view=height

# Canon vs generic
https://sinverse.net/sizeref/?char1=sin&h2=66&n2=Alice&view=height

# Bot screenshot (no UI chrome)
https://sinverse.net/sizeref/?char1=sin&char2=jay&view=height&screenshot=1
```
