# AI Video Factory — "What If" video generator

Turns one "what if" premise into a finished low-poly 3D video: story, voices,
worlds, captions, music and sound effects, mastered and ready to upload.
Formats: 9:16 Shorts (8–90 s), 16:9 (up to 10 min) and 1:1 (up to 90 s).

## What it does

From the premise, a chain of AI roles (each can use its own model) builds the plan:

1. **Writer** — the story, beat by beat: narration, character lines, what is on screen.
2. **Voice** — every line is spoken by KittenTTS 2 or VoxCPM2. The measured length of
   each line sets the timing, so speech never overlaps and captions follow the voice.
3. **Director** — picks the 3D world for each part of the story (a real place such as
   Paris or Cairo with a date and time, or a kit such as street, ocean or space), the
   weather, a camera shot for every beat, and the on-screen devices (counters, timers,
   props, world events). A change of place becomes a flight between them.
4. **Sound designer** — music by mood, ambience beds, hits and whooshes, all from a free
   CC0 library.
5. **Assembler** — code (not the AI) turns all of it into exact frame times.
6. **Render** — Remotion renders the 3D scenes, transitions, colour grade and captions;
   the audio is mixed, ducked under speech and mastered to -14 LUFS. The video is cut into
   chunks at hard cuts, so after an edit only the changed chunks are rendered again.
7. **Photographer** (optional) — checks one still per shot for exposure, flat frames and
   colour, and can ask a vision model yes/no questions about each still.

Every stage is saved, so small changes (a line, a shot, a sound, a voice) are made in
the editor and rebuild the video without asking the AI again.

## Quick start

See **Setting up on a new machine** below first. Then:

```bash
npm run server      # API on http://127.0.0.1:5178
npm run ui          # dashboard on http://localhost:5177
```

Or from the command line:

```bash
npm run generate -- "What if money doubled every 3 seconds?" --format 9:16 --duration 30
```

The finished video lands in `output/<id>/video.mp4`.

## Setting up on a new machine

The project is developed on Windows. The steps below assume a fresh clone or copy.

1. **Install dependencies** (use `--legacy-peer-deps`: a type-package peer conflict breaks a plain install):
   ```bash
   npm ci --legacy-peer-deps
   cd ui && npm install && cd ..
   ```
2. **Download the sound library** (needs internet; a few hundred MB). This builds the free
   sound effects and background music the video uses:
   ```bash
   npm run audio:library
   ```
   Re-running it reuses what it already downloaded. Use `-- --music 1` for a quick, smaller build.
3. **Download the 3D models** (needs internet, takes a while). Without them, the offline
   template premises (gravity, sun-set, time-stop) fail with "Asset violations":
   ```bash
   npm run assets
   ```
4. **Download the world engine's kits and build its catalog** (needs internet). The
   real places (Paris, Cairo, Colmar, New York) and the flights between them use these:
   ```bash
   npm run world:assets
   npm run world:catalog
   ```
   A model that is still missing is drawn as a plain box, so a render never fails on it.
5. **Add your AI key** (only for arbitrary premises). Copy `.env.example` to `.env` and set
   `OLLAMA_API_KEY` (Ollama Pro cloud). Or add the key in the dashboard under
   **Settings → AI models**. `.env` holds secrets: never commit it or share it in a zip.
6. **Voices (optional):** in the dashboard, **Settings → Voice engines**, install
   KittenTTS 2 (runs on a CPU, faster with an NVIDIA GPU) or VoxCPM2 (needs an NVIDIA GPU).
   Or set `TTS_KITTEN_PYTHON` / `TTS_VOXCPM_PYTHON` to an existing Python with the engine
   installed. **Settings → Getting started** shows what this computer still needs.
7. **Check it works:**
   ```bash
   npx tsc --noEmit
   npm test
   npm run generate -- "What if money doubled every 3 seconds?" --no-render
   ```

## Making a video

### The dashboard

Run the server and the UI in two terminals:

```bash
npm run server      # API on http://127.0.0.1:5178 (PORT=<n> picks another port)
npm run ui          # dashboard on http://localhost:5177
```

The dashboard shows one thing at a time. The sidebar has four places:

- **Create**: a step-by-step wizard that makes a video.
- **Library**: every video you have made.
- **Settings**: AI models, voice engines and a getting-started checklist.
- **Help**: what each part does.

Every screen has its own address, so the browser's Back button, a refresh or a saved
link brings you back to the same screen.

#### Create, one decision per screen

1. **Idea.** Type a "what if" question.
2. **Format.** 9:16 (Shorts), 16:9 (long-form, up to 10 min) or 1:1. Length and number of
   scenes are optional (blank = automatic). *Final* is full size; *Draft* renders at half
   size for quick checks. The optional **AI review pass** lets a critic flag weak beats so
   the writer rewrites them (one extra AI call).
3. **Voice.** Narration and character voices are two separate switches, each with its own
   engine (KittenTTS 2 or VoxCPM2). Press play to hear a voice before you choose.
4. **Captions.** Pick a look (including **reference**: serif italic with the key word in
   gold, the style of the quality references), then adjust the position, font, size,
   colours, box and entry animation. The preview is the same caption the video will use.
5. **Summary.** Your choices on one screen, then write the plan.
6. **Writing.** The AI works in stages, each shown as it runs: writing the story, timing
   the voices, directing the camera, designing the sound, reviewing the story (only with
   the AI review pass) and putting it together. Nothing is rendered yet.
7. **Review.** The plan in four views: **Story** (every beat and line; audition and recast
   each character's voice without asking the AI again), **Scenes and shots**, **Sound**
   and **Settings**. Then **Approve and make the video**, or **Open in editor** first.
8. **Rendering.** Progress by stage, with the log. You can stop it.
9. **Done.** Watch, download, open it in the editor, or make another.

#### Library

All videos as a grid, with search, a filter and sorting. Open one to watch it, download
it or its plan, open it in the editor, or delete it.

#### Editor

A timeline (beats, shots, captions, voice, music, hits, scenes) under the video. Select
anything to change it in the inspector: a line's wording (re-voiced and re-timed), a
caption's wording (keeps its timing), a shot, a scene, a sound. **Ask AI** proposes edits
for one beat or the whole video; nothing changes until you apply them. Every save is a
version you can undo. **Make the video** renders only the chunks that changed.

### Choosing models for each step

Open **Settings → AI models**. Add a provider's key, press **Get models** to list what it
offers, then choose a model for each role under **Model roles**:

- **Writer** writes the story. **You must choose a model for it**; nothing is picked silently.
- **Director** and **Sound designer** are used on every plan; **Critic** only with the AI review pass.
- **Photographer (vision)** answers yes/no questions about each shot's still.
- **Editor** answers **Ask AI** in the editor.
- A role with no model of its own uses the Writer's model.

The choices are saved to `ai.config.json`.

### From the command line

```bash
npm run generate -- "What if time stopped for just 5 seconds?"
npm run generate -- "What if money doubled every 3 seconds?" --format 16:9 --duration 60 --scenes 4 --quality draft
npm run generate -- "<premise>" --provider ollama --model <model-id> --no-render   # plan only
npm run generate -- --from-spec output/<id>/spec.json            # render an approved plan
npm run generate -- --from-spec output/<id>/spec.json --chunked  # the same, rendering only the chunks that changed
```

Flags: `--format 9:16|16:9|1:1`, `--duration <seconds>`, `--scenes 1..12`,
`--quality draft|final`, `--provider`, `--model`, `--no-render`, `--from-spec`, `--chunked`,
`--audio-file`.

### Testing without an AI key

```bash
npm test     # unit, pipeline and server tests on recorded model replies
FACTORY_LLM_FIXTURES=test-fixtures/pipeline/money-doubles npx tsx src/generator/generate.ts "What if money doubled every 3 seconds?" --no-render --duration 25 --audio-file test-fixtures/pipeline/money-doubles/audio.json
```

On a machine with a key, `FACTORY_LLM_RECORD=test-fixtures/pipeline/<name>` saves every model reply so the run can be replayed anywhere. The server honours `FACTORY_LLM_FIXTURES` too, so the whole dashboard can be tried without a key (the models then show as "fixtures").

### Photographer check (one still per shot)

```bash
npm run photographer -- <id>      # the video's folder name in output/
```

It renders the middle frame of every shot at half size and checks it by code: too dark, crushed or clipped, one flat colour filling the frame (a prop against the lens, a wall), or washed out. If you choose a **Photographer (vision)** model in Settings → AI models → Model roles, every still also gets neutral yes/no questions ("Is the wooden jetty clearly visible?", "Is any sea water visible?" after the oceans vanish). The model never sees the story, so it can't just agree with it. Results: `output/<id>/qa/qa.json` plus the stills.

### Milestone check (3 premises × 3 formats)

```bash
npm run milestone -- --fixtures      # recorded replies, no AI key needed
npm run milestone                    # your models from Settings → AI models → Model roles
npm run milestone -- --only money-doubles --formats 9:16    # a subset
```

It plans, renders (draft) and measures each video. Nothing is played: length within ±10%
of the target, overlapping speech, the longest silence (pass: 4 s or less), how many
caption words fall inside the line that says them (pass: 95% or more), loudness
(-14 ±1 LUFS, true peak -1 dBTP or lower, 48 kHz), and no voice line left as an
estimate. It also saves a strip of 4 frames per video. Results:
`output/milestone/report.md`. Needs KittenTTS 2 installed; on a CPU the first run
takes over an hour (the voice cache makes later runs fast).

### Where the output goes

Each video has its own folder, `output/<id>/`:

- `video.mp4`: the video; `thumb.jpg`: its thumbnail.
- `spec.json`: the plan (scenes, shots, captions, events, settings, story). Render it with `--from-spec`.
- `story.json`, `voice.json`, `timeline.json`, `direction.json`, `sound.json`, `plan.json`: each pipeline stage's output. The render re-times the video from the measured voice using these, and the editor edits them.
- `props.json`: what the renderer was given; `report.json`: a summary of the run.
- `film/`: the editor's versions (undo and redo); `chunks/`: rendered chunks kept for reuse; `qa/`: the photographer's stills and results.

Also: `output/jobs/` (dashboard jobs, so they survive a server restart) and
`output/FAILED-<id>.log` (the error, if a run fails). Videos made before 2026-10-26 used
flat files (`output/<id>-spec.json` and so on); the Library still shows them.

### Known limits right now

- The offline template premises have a fixed length and ignore `--duration`. The AI path honours it.
- Character voices are cast automatically by gender and age. The Kitten preset genders are assumed from their names; audition and recast in the review's Story view.
- KittenTTS 2 on a CPU is slow: about 30 s to load and 30–50 s per spoken line (measured on a 6-core, 12-thread i7-10850H laptop). The dashboard keeps one Kitten process loaded, so after the first line each edit costs only its own line. At plan time the line lengths are estimated (set `FACTORY_PLAN_TTS=1` to synthesize them at plan time instead); the render always measures the real voice and re-times the video. If the real voice runs more than 10% over the chosen length, the render speeds it up a little (at most 1.15×, pitch kept) and says so in the log.
- Voice settings were tuned by reading the code, not by listening. Judge the sound on your own machine and adjust in `scripts/story-tts.py`.
- Sound effects, ambience and music come from the free library (`npm run audio:library`): Kenney, OpenGameArt, BigSoundBank (checked ambience and whoosh clips) and FreePD music. Picks are made by file-name tags and, in the real places, by the kind of place and the light (city, town, desert, coast; day, low sun, night), not by listening.
- Every finished video is mastered to -14 LUFS (the loudness YouTube Shorts plays at). Music and ambience duck under narration.
- The crowd and featured actors in the real places are off by default.
- With the "reference" (default) and "documentary" caption looks, counters and timers are drawn as text over the picture like the quality references, and the hook sits high; the other looks keep the white cards.
- Chunk reuse needs an unchanged code tree: any change under `src/` renders every chunk again.

### Where the work is tracked

`docs/factory/README.md` is the index of the factory rebuild. `docs/factory/PROGRESS.md`
says what is done and what comes next. Read it before continuing the work on another machine.

## Supported premise families (offline, no API key)

| Family | Example |
|---|---|
| gravity | "What if gravity disappeared for just 5 seconds?" |
| time-stop | "What if time stopped for just 5 seconds?" |
| spin-stop | "What if Earth stopped spinning for just 5 seconds?" |
| air | "What if all air disappeared for just 5 seconds?" |
| oxygen | "What if oxygen disappeared for just 5 seconds?" |
| water | "What if all water disappeared for just 5 seconds?" |
| electrons | "What if electrons disappeared for just 5 seconds?" |
| protons | "What if protons disappeared for just 5 seconds?" |
| neutrons | "What if neutrons disappeared for just 5 seconds?" |
| light | "What if light disappeared for just 100 days?" |
| sun-set | "What if the sun never set for 1,000 years?" |

These are used only when no AI provider is set up. They are fixed templates in
`src/generator/build-family-spec.ts`. Any other premise needs an AI model (see
**Choosing models for each step**).

## Tech stack (all version-matched via the official Remotion template)

- **Remotion 4.0.536** — deterministic programmatic video render, built-in audio
  muxing; `@remotion/renderer` for the chunked render
- **React Three Fiber 9.2.0 + Three.js 0.178.0** — low-poly 3D scenes inside
  `<ThreeCanvas>` (frameloop overridden to `'never'`; animations driven
  declaratively with `useCurrentFrame()`, never `useFrame`)
- **@react-three/postprocessing 3.0.4 + postprocessing 6.39.5** — the colour grade, bloom and grain
- **zod 4.5.4** — shot-spec schema validation
- **Express + Vite/React** — the API server and the dashboard
- **ffmpeg** — shipped by Remotion (`@remotion/compositor-win32-x64-msvc`)
- **Chrome Headless Shell** — auto-downloaded by Remotion, ANGLE GL renderer

## Project structure

```
src/
  Root.tsx                      — compositions (WhatIfVideo, WhatIfAudio, world previews)
  generator/
    generate.ts                 — CLI: premise → plan → render → MP4
    spec.schema.ts              — zod shot-spec contract (story, shots, captions, settings)
    pipeline/                   — writer → voice → timeline → director → sound → critic → assemble
    camera/                     — closed-form cinematic camera solver
    qa/                         — photographer (per-shot still checks + optional vision model)
    film/ · render/             — editor backend (edits, versions, undo, recast) + chunked renderer
    audio-resolve.ts · ...      — CC0 library picking, gains, mastering
  compositions/
    WhatIfVideo/                — master composition (3D + HUD + audio)
    camera/ · look/             — ShotCamera wiring, cinematic grade (bloom/ACeS/grain)
    *Stage.tsx                  — the 7 world kits (street, ocean, space, forest, ...)
  world/                        — one-world engine (places, cities, roads, terrain, globe, actors)
server/                         — Express API (plan and render jobs, film edits, providers, voices)
ui/                             — dashboard (Create, Library, Settings, Help, editor)
scripts/                        — setup, audio library, assets, milestone, photographer
docs/factory/                   — the 7-phase plan and progress (start here)
```

## Sound library

`npm run audio:library` builds `public/library/`: 775 free CC0/FreePD files
(630 effects, 86 stingers, 40 music tracks, 19 ambience beds, each with its measured
loudness) plus `audio-library.json`, the index the sound designer picks from. The
old 9-sound synthesized `public/sfx/` set stays only as a fallback.

## Docs

- `docs/factory/HANDOFF.md` — read first on any machine: the standing rules for AI sessions, where things stand, first steps on the GPU machine
- `docs/factory/README.md` — start here; index of the factory rebuild
- `docs/factory/PROGRESS.md` — current status, what's done, the exact next step
- `docs/factory/05-plan.md` — the agreed 7-phase plan
- The old-era `ai/SKILL.md`, `ai/PROMPTS.md` and `INSTRUCTIONS.md` were removed
  (superseded by the pipeline, dashboard and this README)

## License

UNLICENSED — internal project. Replace synthesized SFX with properly licensed
recordings before public distribution if required.
