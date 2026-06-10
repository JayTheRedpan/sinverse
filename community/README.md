# Community failsafe module

A self-contained module that keeps the community reachable even if the primary
chat platform (Discord) goes down. Everything is driven by `community.json` —
edit that file and push; no code changes needed for day-to-day use.

## What it does

1. **Announcements** — a list you maintain in `community.json`, rendered newest-first.
2. **Where to find us** — platform cards driven by a `status` flag. When the
   primary platform's status is flipped to `"down"`, the page raises a banner and
   steers everyone to the fallback instead. This is the failsafe.
3. **Stay reachable** — a multi-platform contact form so members can leave any
   handles they like, letting you re-contact the community if you ever have to move.

## Editing announcements

Add objects to the `announcements` array:

```json
{ "id": 2, "date": "2026-06-10", "level": "important",
  "title": "Heads up", "body": "Text of the announcement." }
```

- `level` is one of `info`, `important`, `critical` (controls the accent color).
- `date` is `YYYY-MM-DD`. The list sorts newest-first automatically.

## Flipping to the fallback (the important one)

Each platform has a `status` and a `role`:

**Status** (controls the badge color and button behavior, site-wide):
- `up` (green) — live and open; buttons link normally.
- `standby` (amber) — technically up and reachable, but not yet open / not the active hub. The "ready as a fallback" state. Buttons still link, shown in amber.
- `down` (red) — unavailable. Buttons gray out; the signpost promotes the fallback.

**Role:**
- `primary`  — the main hub (Discord)
- `fallback` — where everyone goes if the primary is down (Telegram)
- `beacon`   — broadcast-only "where are we now" pointer (Telegram channel)

The Discord button on the home page and in the global nav both read their URL
**and** status from this file's `discord` platform entry — so the invite link
lives in exactly one place, and flipping its status recolors those buttons too.

**If Discord goes down:** set the Discord platform's `"status"` to `"down"` and
push. The page will automatically show a banner ("Discord is unavailable — we've
moved to Telegram") and promote the fallback to the top. Set it back to `"up"`
when Discord returns. That one value is the whole switch.

Replace every `REPLACE_ME` URL with your real invite links before going live.

## Wiring the contact form

The "Stay reachable" section is a button that opens a **modal**. What the modal
shows depends on `community.json`:

**Option 1 — Embed a Google Form (recommended for zero backend).**
Set `contact.google_form_embed` to your Google Form's *embed* URL (in Google
Forms: Send → `< >` Embed HTML → copy the `src` URL from the iframe snippet).
The modal then shows your real Google Form in an iframe — Google handles
validation, storage, and the success screen. The platform questions are defined
in the Google Form itself; mirror the field list below so you capture the same
platforms. Styling inside the iframe is Google's, not the site's.

**Option 2 — Site-native form.**
Leave `google_form_embed` empty and the modal shows a form styled to match the
site, built from the `fields` array. It needs somewhere to send submissions:
- Set `contact.endpoint` to a form service (e.g. Formspree) or a self-hosted
  handler that accepts a JSON POST.
- If `endpoint` is also empty, the form falls back to opening the visitor's
  email client to `contact.fallback_email` with their details pre-filled.

> Note: don't POST a native form directly at Google Forms' hidden endpoint —
> it relies on undocumented field IDs and can't confirm success. Use the iframe
> embed (Option 1) if you want Google Forms.

### Platform fields covered

email, FurAffinity, Telegram, Discord, Twitter/X, Bluesky, Mastodon, Matrix, and
a free "anywhere else" field (Weasyl, Inkbunny, Itaku, VRChat, etc.). Edit the
`fields` array to add or remove platforms; mirror the same set into your Google
Form if you use the embed.

## Files

- `community.json` — all content/config (edit this)
- `community.js`   — render + form logic (no edits needed normally)
- `index.html`     — the page shell and styles
