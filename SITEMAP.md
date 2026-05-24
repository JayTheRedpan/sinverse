# Sinverse -- Project Sitemap
# Paste this at the start of any session to re-establish full project context.

## Site Structure
```
sinverse/
  _shared/
    styles-global.css   -- design tokens, fonts, global buttons, nav bar
    nav.js              -- global navigation component (initNav(pageId))
    registry.js         -- resolves entity IDs to URLs (resolveLink, buildCrossLink)
  _data/
    contributors.json   -- all authors/artists + founder profile
    characters.json     -- character registry with heights and cross-links
    library.json        -- library story manifest
    gallery.json        -- gallery image manifest (Cloudinary URLs)
    tags.json           -- canonical story and node tag lists
  images/
    logo.png
    favicon.ico
    apple-touch-icon.png
  index.html            -- landing page + age gate + nav cards + Discord link
  wiki/                 -- characters, lore, timeline, factions, locations
  library/              -- complete uploaded stories (admin curated)
  cyoa/                 -- community branching interactive stories
  gallery/              -- art showcase (images on Cloudinary)
  sizeref/              -- interactive character size comparison tool
  contributors/         -- founder profile + contributor hall of fame
```

## Sub-site Status
| Sub-site     | Status      | Notes                                    |
|---|---|---|
| Landing page | Complete    |                                          |
| CYOA         | Complete    | Migrated from cyoa-app, age gate removed |
| Wiki         | Not started |                                          |
| Library      | Not started |                                          |
| Gallery      | Not started |                                          |
| Size Ref     | Not started |                                          |
| Contributors | Not started |                                          |

## Infrastructure
- Hosting: GitHub Pages (free)
- Images: Cloudinary -- cloud name: [YOUR CLOUD NAME]
- Large story files: Google Drive shared links
- Domain: [YOUR DOMAIN]
- Discord invite: [YOUR INVITE LINK]
- Deployment: GitHub Desktop

## Cross-linking
All entities use stable slug IDs. registry.js resolves:
  resolveLink('character', 'character_lyra')  => /wiki/#character_lyra
  resolveLink('story',     'velvet_room')     => /library/reader.html?id=velvet_room
  resolveLink('cyoa',      'hollow_forest')   => /cyoa/?story=hollow_forest
  resolveLink('gallery',   'gallery_042')     => /gallery/#gallery_042
  resolveLink('contributor','jaytheredpan')   => /contributors/#jaytheredpan

## CYOA Submission Forms (Google Forms)
- New story:  https://docs.google.com/forms/d/1w6ys0HXOpRHgnSk7kBm1FozYOkDTFLzJ23baqgjTcwU
- New branch: https://docs.google.com/forms/d/1cgRDh5PIcXQl4F9AWjzkmJD9be-sZ3LDs5QH6BdCY4s

## Key Design Tokens (from _shared/styles-global.css)
- --bg: #110d0b  (near black)
- --accent: #c49a78  (rose-gold, from logo)
- --wine: #7a2233  (deep burgundy, primary buttons)
- --font-display: Cormorant Garamond
- --font-caps: Cormorant SC
- --font-body: EB Garamond

## Current Session Focus
[update each session]

## Known Issues
[update each session]