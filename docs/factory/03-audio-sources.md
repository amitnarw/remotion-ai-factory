# 03 — CC0 / free audio sources (verified 2026-10-22)

Every source below was fetched with real requests. Requirements: free for commercial use, no attribution, and downloadable by script without an API key or login.

## Sound effects

### 1. Kenney.nl audio packs (CC0, verified)
- Zip URLs contain a hash, so **scrape them**: fetch `https://kenney.nl/assets/<slug>` and match `https://kenney\.nl/media/pages/assets/[^"']+\.zip`. This is the same method `scripts/setup-sfx-cc0.ts` already uses.
- Files are OGG inside the zip.
- **Already used:** interface-sounds, impact-sounds, rpg-audio (includes footsteps), sci-fi-sounds, casino-audio, voiceover-pack.
- **Add:** `digital-audio` (~1.0 MB: zaps, power-ups), `ui-audio` (~0.4 MB: clicks, pops), `music-jingles` (~1.2 MB: stingers).
- `voiceover-pack-fighter`: its zip URL wasn't resolved.
- Kenney has **no** ambience, nature, vehicle or weather packs, and there is no "foley-sounds" pack.

### 2. BigSoundBank.com (CC0, verified): best for ambience, nature and foley
- Rights page: "Creative Commons CC0 1.0 Universal", including commercial use, "Nothing is mandatory".
- **Only files whose page says "Free and Royalty Free"** are covered, so check that before downloading.
- Direct files, no key needed:
  - `https://bigsoundbank.com/UPLOAD/mp3/{NNNN}.mp3` (also `ogg/{NNNN}.ogg`, `flac/{NNNN}.flac`, `bwf-en/{NNNN}.wav`)
- The ID is the 4-digit number in page slugs, e.g. `thunder-1-s0127.html` → 0127.
- Categories: `https://bigsoundbank.com/search?CatID=AMB` (also ANML, BIRD, CRWD, AIR, AERO, BOAT, DESTR, DOOR, ALRM, DSGN, …). Category and search pages **need a browser User-Agent**.
- Coverage: city/crowd/bar ambience, birds, waves, rain/thunder/wind, animals, vehicles, doors, destruction, alarms.
- Plan: keep a **curated list of IDs** in the downloader.

### 3. OpenGameArt (CC0, verified)
- `https://opengameart.org/sites/default/files/100-CC0-SFX_0.zip`: 2.9 MB, a general mix.
- `https://opengameart.org/sites/default/files/The%20Essential%20Retro%20Video%20Game%20Sound%20Effects%20Collection%20%5B512%20sounds%5D.zip`: 20.6 MB, 8-bit only (pops, UI).

### 4. Sonniss GDC Game Audio Bundle: **excluded**
- Royalty-free with no attribution, but **not CC0**. It forbids redistributing the sounds as sound effects and has an explicit **ban on AI training/usage**. Do not use it unless the user accepts it after a legal read.
- For reference only: parts like `https://downloads.sonniss.com/Sonniss.com-GDC2024-GameAudioBundle1of9.zip` need a browser User-Agent and `Referer: https://sonniss.com/gameaudiogdc`. Each year's bundle is 9–48 GB.

### Rejected
- **Pixabay:** sound pages return 403 to scripts, and the API needs a key.
- **Freesound:** needs an API key, and the license varies per sound.

## Music

### 1. FreePD on archive.org, item `freepd` (verified): main source
- **FreePD.com has closed (2008–2025)**, and its old URLs are dead. The archive.org mirror works:
  - `https://archive.org/download/freepd/{folder}/{Title}.mp3` (302 to the CDN, then 200 audio/mpeg). Tested: `epic/Adventure.mp3`.
  - Full file list as JSON: `https://archive.org/metadata/freepd`
- 1,025 MP3s, about 6.9 GB. **Download a curated subset of about 80 tracks**, not everything.
- **Only use the category folders.** The root contains at least one file that is clearly not public domain ("…BBC Earth.mp3").

| Folder | Tracks | Mood |
|---|---|---|
| `epic` | 36 | epic, cinematic, action |
| `horror` | 21 | tense, suspense, sci-fi atmosphere |
| `scoring` | 21 | documentary, action ("Action Strike", "Driving Concern") |
| `upbeat` | 18 | uplifting |
| `romantic` | 21 | sad, emotional |
| `comedy` | 46 | playful, quirky |
| `electronic` | 13 | sci-fi, tech |
| `misc` | 85 | ambient, mysterious |
| `world` | 29 | world |
| `Page2` | 730 | assorted, untagged |

- Caveat: the archive item has no license field. Public-domain status rests on FreePD's own dedication.

### 2. archive.org item `abook-music-freepd-cc0` (verified, explicit CC0 licenseurl)
- 35 curated FreePD tracks, about 404 MB. File names are hashed (`fpd-<hash>.mp3`); the list is at `https://archive.org/metadata/abook-music-freepd-cc0`. Use it as a cleaner-licensed fallback.

### 3. Kenney `music-jingles` (CC0): short stingers only

## Gap
No clean CC0 source has dedicated cinematic **braams or risers**. The closest are the BigSoundBank DSGN category, layering existing whooshes and impacts, or Sonniss if it's ever accepted.

## Library format we'll produce (Phase 1, step 6)
`public/library/audio-library.json`, one entry per file:
`{id, kind: sfx|ambience|music|stinger, file, tags[], mood, energy, durSec, lufs, loopable, source, license, url}`
Files are transcoded to 48 kHz WAV with the ffmpeg bundled with Remotion, and loudness is measured with `ebur128`.
