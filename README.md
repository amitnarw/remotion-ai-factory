# AI Video Factory — "What If" video generator

Turns one "what if" premise into a finished low-poly 3D video: story, voices,
worlds, captions, music and sound effects, mastered and ready to upload.
Formats: 9:16 Shorts (15–90 s), 16:9 (up to 10 min) and 1:1.

## What it does

From the premise, a chain of AI roles (each can use its own model) builds the plan:

1. **Writer** — the story, beat by beat: narration, character lines, what is on screen.
2. **Voice** — every line is spoken by KittenTTS 2 or VoxCPM2. The measured length of
   each line sets the timing, so speech never overlaps and captions follow the voice.
3. **Director** — picks the 3D world, time of day, weather, camera style, characters and
   on-screen devices (counters, timers, props, world events) for each part of the story.
4. **Sound designer** — music by mood, ambience beds, hits and whooshes, all from a free
   CC0 library.
5. **Assembler** — code (not the AI) turns all of it into exact frame times.
6. **Render** — Remotion renders the 3D scenes and captions; the audio is mixed, ducked
   under speech and mastered to -14 LUFS.

Every stage is saved, so small changes (a voice, a caption look) rebuild the video
without asking the AI again.

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

The finished MP4 lands in `output/`.

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
4. **Add your AI key** (only for arbitrary premises). Copy `.env.example` to `.env` and set
   `OLLAMA_API_KEY` (Ollama Pro cloud). Or add the key in the dashboard's Providers tab.
   `.env` holds secrets: never commit it or share it in a zip.
5. **Voices (optional):** open the dashboard's Setup tab and install KittenTTS 2 (CPU) or
   VoxCPM2 (needs an NVIDIA GPU). Or set `TTS_KITTEN_PYTHON` / `TTS_VOXCPM_PYTHON` to an
   existing Python with the engine installed.
6. **Check it works:**
   ```bash
   npx tsc --noEmit
   npm run generate -- "What if money doubled every 3 seconds?" --no-render
   ```

## Making a video

### From the dashboard (recommended)

Run the server and the UI in two terminals:

```bash
npm run server      # API on http://127.0.0.1:5178
npm run ui          # dashboard on http://localhost:5177
```

Then, on the **Generate** tab:

1. **Tell your idea.** Type a "what if" question. Under it:
   - **Format:** 9:16 (Shorts, 15–90s), 16:9 (long-form, up to 10 min) or 1:1 (square, up to 90s).
   - **Length in seconds** and **Scenes** are optional. Leave them blank for automatic.
   - **Quality:** *Draft* renders at half size for quick checks; *Final* is full size.
   - **Captions:** pick a look (bold pop, clean, documentary serif, neon, minimal pill), then adjust the position, font, size, colours, box and entry animation. The live preview shows the same caption the video will use.
   - **Voice:** narration and character voices are two separate switches. Each has its own engine (KittenTTS 2 or VoxCPM2). Use ▶ to listen before you choose. Lines you have already rendered are reused from a cache, so re-running a story is faster.
   - **AI review pass** (optional): a critic flags weak beats and the writer rewrites them. One extra AI call.
2. **Write the plan.** The AI works in stages, shown as pills: the **writer** writes the story beat by beat, the **voice** is generated (or estimated) so its real length sets the timing, the **director** picks the worlds and on-screen devices, the **sound designer** picks music, beds and hits, and everything is **put together** with exact timings. Nothing renders yet.
   - The review screen's **Story** section lists every beat and line. Each character's voice can be auditioned (▶) and changed; changing it rebuilds the plan without calling the AI again.
3. **Review and approve.** Check the plan, then approve to render. Progress and logs appear
   live. The finished video is in the Videos tab and in `output/`.

### Choosing models for each step

Open the **Providers** tab, then **Model roles**. Each pipeline role can use a different
provider and model:

- **Writer** writes the story. **You must choose a model for it**; nothing is picked silently.
- **Director** and **Sound designer** are used on every plan; **Critic** only with the AI review pass.
- A role with no model of its own uses the Writer's model.
- **Photographer** and **Editor** take effect in later phases (see `docs/factory/PROGRESS.md`).

A role left on *Default provider* uses the default. To list the models a provider offers,
open its card and press **Get models** first. The choices are saved to `ai.config.json`.

### From the command line

```bash
npm run generate -- "What if time stopped for just 5 seconds?"
npm run generate -- "What if money doubled every 3 seconds?" --format 16:9 --duration 60 --scenes 4 --quality draft
npm run generate -- "<premise>" --provider ollama --model <model-id> --no-render   # plan only
npm run generate -- "<premise>" --from-spec output/<id>-spec.json                  # render an approved plan
```

Flags: `--format 9:16|16:9|1:1`, `--duration <seconds>`, `--scenes 1..12`,
`--quality draft|final`, `--provider`, `--model`, `--no-render`, `--from-spec`, `--audio-file`.

### Testing without an AI key

```bash
npm test     # unit and pipeline tests on recorded model replies
FACTORY_LLM_FIXTURES=test-fixtures/pipeline/money-doubles npx tsx src/generator/generate.ts "What if money doubled every 3 seconds?" --no-render --duration 25 --audio-file test-fixtures/pipeline/money-doubles/audio.json
```

On a machine with a key, `FACTORY_LLM_RECORD=test-fixtures/pipeline/<name>` saves every model reply so the run can be replayed anywhere.

### Photographer check (one still per shot)

```bash
npx tsx scripts/photographer.ts <id>      # <id> as in output/<id>-spec.json or output/<id>-props.json
```

It renders the middle frame of every shot at half size and checks it by code: too dark, crushed or clipped, one flat colour filling the frame (a prop against the lens, a wall), or washed out. If you choose a **Photographer (vision)** model in Providers → Model roles, every still also gets neutral yes/no questions ("Is the wooden jetty clearly visible?", "Is any sea water visible?" after the oceans vanish). The model never sees the story, so it can't just agree with it. Results: `output/<id>/qa/qa.json` plus the stills.

### Milestone check (3 premises × 3 formats)

```bash
npm run milestone -- --fixtures      # recorded replies, no AI key needed
npm run milestone                    # your models from Providers → Model roles
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

- `output/<id>-<timestamp>.mp4`: the video.
- `output/<id>-spec.json`: the plan (scenes, captions, events, settings, story). Render with `--from-spec`.
- `output/<id>/`: each pipeline stage's output (story, voice, timeline, direction, sound, plan). The render re-times the video from the measured voice using these.
- `output/<id>-report.json`: a summary of the run.
- `output/FAILED-<id>.log`: the error, if a run fails.

### Known limits right now

- The offline template premises have a fixed length and ignore `--duration`. The AI path honours it.
- Landscape (16:9) renders at the right size, but the camera framing is still tuned for portrait (Phase 3).
- Character voices are cast automatically by gender and age. The Kitten preset genders are assumed from their names; audition and recast in the review screen's Story section.
- KittenTTS 2 on a CPU is slow: about 30 s to load and 40–50 s per spoken line (measured on a 6-core, 12-thread i7-10850H laptop). A 25 s Short with 10 lines takes about 8 minutes of voice work the first time; the cache makes re-renders instant. At plan time the line lengths are estimated (set `FACTORY_PLAN_TTS=1` to synthesize them at plan time instead); the render always measures the real voice and re-times the video. If the real voice runs more than 10% over the chosen length, the render speeds it up a little (at most 1.15×, pitch kept) and says so in the log.
- Voice settings were tuned by reading the code, not by listening. Judge the sound on your own machine and adjust in `scripts/story-tts.py`.
- Sound effects and music come from the free library (`npm run audio:library`): Kenney, OpenGameArt, BigSoundBank (25 checked ambience and whoosh clips) and FreePD music. Picks are made by file-name tags, not by listening.
- Every finished video is mastered to -14 LUFS (the loudness YouTube Shorts plays at). Music and ambience duck under narration.

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

- **Remotion 4.0.535** — deterministic programmatic video render, built-in audio
  muxing, single-command MP4 output
- **React Three Fiber 9.2.0 + Three.js 0.178.0** — low-poly 3D scenes inside
  `<ThreeCanvas>` (frameloop overridden to `'never'`; animations driven
  declaratively with `useCurrentFrame()`, never `useFrame`)
- **zod 4.5.4** — shot-spec schema validation
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
    film/ · render/             — editor backend (edits, versions, undo) + chunked renderer
    audio-resolve.ts · ...      — CC0 library picking, gains, mastering
  compositions/
    WhatIfVideo/                — master composition (3D + HUD + audio)
    camera/ · look/             — ShotCamera wiring, cinematic grade (bloom/ACeS/grain)
    *Stage.tsx                  — the 7 world kits (street, ocean, space, forest, ...)
  world/                        — one-world engine (places, cities, roads, terrain, globe, actors)
  server/ · ui/                 — Express API + dashboard (generate, providers, editor)
scripts/                        — setup, audio library, assets, milestone, photographer
docs/factory/                   — the 6-phase plan and progress (start here)
```

## Sound library

`npm run audio:library` builds `public/library/` — 752 free CC0/FreePD files
(625 sfx, 86 stingers, 40 music tracks, one ambience clip, re-measured LUFS per
file) plus `audio-library.json`, the index the sound designer picks from. The
old 9-sound synthesized `public/sfx/` set stays only as a fallback.

## Docs

- `docs/factory/README.md` — start here; index of the factory rebuild
- `docs/factory/PROGRESS.md` — current status, what's done, the exact next step
- `docs/factory/05-plan.md` — the agreed 6-phase plan
- The old-era `ai/SKILL.md`, `ai/PROMPTS.md` and `INSTRUCTIONS.md` were removed
  (superseded by the pipeline, dashboard and this README)

## License

UNLICENSED — internal project. Replace synthesized SFX with properly licensed
recordings before public distribution if required.
