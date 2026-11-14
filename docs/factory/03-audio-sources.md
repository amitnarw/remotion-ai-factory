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

### Picking a track: no quiet openings (2026-11-05)
A music cue plays its track from the file's start, at the gain that brings the whole track to -23 LUFS (audio-resolve.ts `gainFor`), with a 1 s fade-in. A track that swells in from near silence was then all but missing under the hook: the bullet-time test's tense track (horror "Alien Spaceship Atmosphere") opens 15.7 LU under its own loudness.
- **The rule** (audio-library.ts `quietOpening`): a track's first 5 s are measured from the file (decoded by ffmpeg, BS.1770 K-weighting, ungated; never played). More than 8 LU under the track's integrated loudness is a quiet opening: the seeded pick gives way to another track of its mood that opens fine, chosen by the seed again (`pickEntry`'s `prefer`). A pick that opens fine is the pick it always was.
- **The library of 2026-11-05:** 8 of the 40 tracks open quiet: horror Alien Invasion (16.0 LU under) and Alien Spaceship Atmosphere (15.7), misc A Waltz for Naseem (16.2), romantic Brothers Unite (16.6) and Champ de Tournesol (9.4), electronic 3 AM West End (13.1), epic Adventures of Flying Jack (11.8), comedy Alls Fair in Love (9.7). The closest that pass: epic Assassin (6.6) and upbeat Advertime (6.1).
- **The test video** (its run id as the seed): the tense cue now plays horror Cockroaches. In the mix before mastering, the ducked music under the hook line went from -48.1 to -36.7 LUFS (the music alone over the first 5 s: -38.7 to -27.5), about 17 dB under the voice, like the video's other lines (11-20 dB).
- **Not built:** starting a track at its first loud part would keep every track usable. It needs a start offset on the music cue (spec.schema.ts), read by the composition (`<Audio trimBefore>`) and by the slow-down (audio-warp.ts `varispeed`'s origin), so that the warped music stays continuous at the window's cut.

## Room and distance in the mix (2026-11-05)
Until now every effect and bed played dry, the same in a kitchen as on a pier. `src/generator/audio-room.ts` puts each world sound in its scene's space and at the distance of the shot on screen. It runs in `resolveAudio`, after every cue has its file and before bullet time's pass, so a slowed world keeps its room.

**For the user: the impulse responses are generated, not recorded.** No impulse response is on disk (`public/library/`, 775 files, has none) and none of the CC0 sources above lists one, and downloads are not allowed. So each room's impulse response is made in code: seeded noise that decays and darkens, plus a few discrete reflections. It is a processing kernel, like an EQ curve: nothing of it plays on its own, and every sound you hear is still a CC0 recording. A recorded CC0 impulse response could replace any room later (load it in `impulse()` and bump `VERSION`).

**No `afir`:** Remotion's bundled ffmpeg has 50 filters and no `afir`, `lowpass`, `aecho` or `anoisesrc` (`ffmpeg -filters`), and there is no other full ffmpeg on the machine. So the convolution runs in TypeScript by FFT (overlap-add, both channels in one complex FFT), the way `audio-warp.ts` does its varispeed: ffmpeg only decodes. No new dependency. A 111 s bed takes about 2.4 s; an effect a few milliseconds.

**The rooms** (`ROOMS`), chosen from the scene's kit or world place (`spaceOf`):

| Space | Kits | What it is | Decay (RT60) | Tail | Reflections |
|---|---|---|---|---|---|
| `room` | interior | a small room, about 4 x 5 m | 0.45 s | -13 dB | 7, 11, 16, 23 ms, -10 to -15 dB |
| `street` | street-block, city-street, every world place (each is a city or town) | the facades across the street or plaza | 0.9 s, dark | -20 dB | a slap at 58 ms (-11 dB), 87 ms (-14), a flutter at 145 and 203 ms |
| `field` | forest, countryside, ocean, park | open air, almost dry | 0.3 s | -30 dB | the ground at 12 ms, -22 dB |
| `open` | pier, river, boardwalk, model-set | open water and a far bank or hull | 0.6 s | -26 dB | a late faint echo at 170 and 260 ms (-22, -27 dB) |
| none | space, a scene with no kit | no air: dry | | | |

**The distance** (`DISTANCES`). The sound plan holds no distance (`SoundPlan.hits` is `{beat, at, sound}`), so it comes from the shot on screen when the effect plays (`spec.shots[].size`, `distanceOf`): an EWS is far (the direct sound low-passed at 3.5 kHz and 7 dB down, the room at its full level, so it sounds farther, not only quieter); a WS is between (9 kHz, 2.5 dB down); an FS, MS, CU or ECU is near (no filter, no level change, the room 3 dB lower). No shot at that time (a kit stage on its own rig) counts as near.

**What takes the room:**
- the world's effects: the designer's hits (`hit-*`), the world events' hits (`world-*`) and the counter's reaction hits (`counter-*`);
- the beds only in the small room: an outdoor bed is a recording of its place and already holds its space, so it plays as recorded (`bedDb: null`). A bed's room wraps round (circular convolution), so its loop stays seamless.

**What stays dry:** the voice, the music, the cut whooshes, the hook pop, the designed sounds (`whoosh_dissolve`, `rise_short`, `pop_light`, `ui_click`, `stinger_hit`, every stinger file) and bullet time's own cues (`bt_*`).

**Files and determinism:** each processed sound is written once to `public/whatif-audio/room/room-<space>-<distance>-<hash>.wav` and reused by every video. The hash is over what made it: the room's definition, the distance's, the source file's bytes (sha1) and the module's `VERSION`, so the same inputs give the same name and byte-identical bytes (the tests write the same files twice and compare them). The files are 16-bit, written at -6 dB (`HEADROOM`); the cue's gain gives the level back, and the library's per-cue ceiling (-5 dBFS with the gain, `gainFor`) is applied again to the processed sound. A synthesized bed keeps its level (its `vol` becomes the equivalent gain). `whatif-audio` is among `AUDIO_PUBLIC_DIRS`, so the picture's chunk keys do not change: a chunked re-render redoes the audio track only.

**The switch:** `FACTORY_ROOM=off` (also `0`, `false`, `no`) in the environment, or `resolveAudio(spec, seed, { room: false })`. Off, the pass does not run and the resolved spec is what it was before the room existed (no new field in the report either), so the render is byte-identical to before.

**On by default**, because:
- it is what the user asked for (more realistic sound), and it follows from a choice a role already made, the director's place (10-intent-audit);
- the master stays on its target (measured below), and the pictures do not change;
- off is one environment variable and byte-identical, so the listening pass (HANDOFF §4) can compare the two. Nobody has heard it yet (the laptop never plays sound): if the listening pass prefers the dry mix, `roomEnabled` in audio-room.ts is the one line to flip.

**Measured** (2026-11-05; never played). Each fixture's spec resolved with the room off and on, its mix rendered by the real `WhatIfAudio` composition (the bullet test's CLI bundle), encoded to AAC and mastered by `masterAudio`; the script is the session scratchpad's `audio/measure.ts`:

| Fixture (9:16) | Room cues | Mix off | Mix on | Master off | Master on |
|---|---|---|---|---|---|
| money-doubles (street, space) | 2: coins, lights-out rumble (street, near) | -20.37 LUFS, -4.48 dBTP | -20.36, -4.48 | -14.16 LUFS, -1.36 dBTP | -14.17, -1.32 |
| oceans-vanish (ocean, space) | 3: two splashes (open air, far: the EWS), thunder (near) | -19.43, -3.51 | -19.49, -3.51 | -14.09, -1.24 | -14.10, -1.24 |
| forest-walks (forest, countryside) | 4: footsteps, wood impact, rumble (near), thunder (mid: the WS) | -19.13, -4.71 | -19.39, -5.17 | -14.03, -1.45 | -14.03, -1.36 |
| bullet test (Cairo, Paris) | 2: the gravity-on impacts (street, near); its `bt_*` cues stay dry | -20.08, -4.79 | -20.08, -4.79 | -14.15, -1.21 | -14.15, -1.21 |

- **The master stays on target:** every master is within 0.2 LU of -14 LUFS and under -1 dBTP with the room on, as with it off. The mixes before mastering move by at most 0.26 LU: the fixtures have few world effects (2 to 4 each), and most of the loudness is voice and music.
- **A far sound is farther** (the band energies of the processed file against its source, from the same FFT): the oceans splash under an EWS is 7 dB down below 4 kHz and 15 dB more above it; a near effect in open air comes out flat (only the -6 dB headroom its gain gives back).
- **Off is byte-identical:** the four fixtures resolved by the code before the room and by this code with `FACTORY_ROOM=off` give the same spec and report, 4 of 4 (sha256 of the JSON). (Bullet time's report differs between its first run and later ones on any code: a reused slowed file reports no peak.)
- **The cost:** the pass took 0.9 s for money-doubles' two new files on a busy machine, 13 ms when they were reused.

**Not built:**
- a spec setting (`settings.room` in spec.schema.ts, read by generate.ts and film/prepare.ts) for a per-video switch from the dashboard: the environment variable is the switch for now;
- a distance chosen by the sound designer (`SoundPlan.hits[].distance`, pipeline/sound.ts, carried by the assembler onto the cue): the shot size stands in for it;
- outdoor beds heard from inside (rain on an interior scene through the walls: low-passed, in the room).

## Gap
No clean CC0 source has dedicated cinematic **braams or risers**. The closest are the BigSoundBank DSGN category, layering existing whooshes and impacts, or Sonniss if it's ever accepted.

## Library format we'll produce (Phase 1, step 6)
`public/library/audio-library.json`, one entry per file:
`{id, kind: sfx|ambience|music|stinger, file, tags[], mood, energy, durSec, lufs, loopable, source, license, url}`
Files are transcoded to 48 kHz WAV with the ffmpeg bundled with Remotion, and loudness is measured with `ebur128`.
