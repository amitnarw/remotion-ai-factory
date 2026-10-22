# AI Video Factory — "What If" Shorts Generator

A 100% automated, production-ready pipeline that turns a single "what if" premise
into an upload-ready vertical MP4 — no voiceover, just event-synced sound effects
and ambient beds, in the style of @atomicwhatif / @IFOLOGYFILMS.

## What it does

Run one command:

```bash
npm run generate -- "What if gravity disappeared for just 5 seconds?"
```

The pipeline does everything itself — you never touch code, edit timelines, or
mix audio:

1. **Shot design** — premise → scene-by-scene timeline (shots, physics events,
   captions, timer values) as a validated JSON spec.
2. **3D scene** — low-poly pastel world built in React Three Fiber inside
   Remotion's `<ThreeCanvas>`, rendered deterministically frame-by-frame.
3. **HUD & captions** — "TIME WITHOUT ___" timer, uppercase fact captions with a
   highlighted keyword, and the opening hook card — all HTML overlays locked to
   the simulation clock.
4. **Sound design** — SFX one-shots and ambient beds pinned to exact frames
   (sync is arithmetic: `frame = t × fps`), so picture, caption, timer and audio
   can never drift.
5. **Render & encode** — Remotion renders the final 1080×1920 MP4 (H.264 + AAC).

Output: an upload-ready MP4 in `output/` plus a JSON report.

## Quick start

```bash
# 1. Install dependencies (already done on first setup)
npm install

# 2. Build the SFX library (one-time)
npm run setup

# 3. Generate a video
npm run generate -- "What if gravity disappeared for just 5 seconds?"
npm run generate -- "What if time stopped for just 5 seconds?"
npm run generate -- "What if oxygen disappeared for just 5 seconds?"
```

The final MP4 lands in `output/`. Upload it directly to YouTube Shorts.

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
2. **Write the plan.** The AI writes the scene plan. Nothing renders yet.
3. **Review and approve.** Check the plan, then approve to render. Progress and logs appear
   live. The finished video is in the Videos tab and in `output/`.

### Choosing models for each step

Open the **Providers** tab, then **Model roles**. Each pipeline role can use a different
provider and model:

- **Writer** writes the story. This is the one used today.
- **Director, Sound designer, Critic, Photographer, Editor** are listed now and take effect
  as their phases land (see `docs/factory/PROGRESS.md`).

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

### Where the output goes

- `output/<id>-<timestamp>.mp4`: the video.
- `output/<id>-spec.json`: the plan (scenes, captions, events, settings). Edit and render with `--from-spec`.
- `output/<id>-report.json`: a summary of the run.
- `output/FAILED-<id>.log`: the error, if a run fails.

### Known limits right now

- The offline template premises have a fixed length and ignore `--duration`. The AI path honours it.
- Landscape (16:9) renders at the right size, but the camera framing is still tuned for portrait.
- Character voices use one default voice per engine. Per-character casting comes with the editor (a later phase).
- Voice settings were tuned by reading the code, not by listening. Judge the sound on your own machine and adjust in `scripts/story-tts.py`.
- Sound effects and music are still synthesized. Real CC0 libraries come in a later phase.

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

Add a new family by adding a template to `TEMPLATES` in
`src/generator/generate.ts`. Arbitrary premises require an
`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` and wiring `llm.ts` (LLM branch
scaffolded, not yet implemented).

## Output

```
output/
├── whatif-<slug>-<timestamp>.mp4    ← upload-ready video
├── <slug>-spec.json                 ← validated shot spec
└── <slug>-report.json               ← generation report
```

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
  index.ts                      — registerRoot entry point
  Root.tsx                      — two Compositions (WhatIfDemo, WhatIfVideo)
  generator/
    generate.ts                 — CLI: premise → spec → render → MP4
    spec.schema.ts              — zod shot-spec contract
    timing.ts                   — sec↔frame conversion, ramps (shared by 3D/HUD/audio)
    spec.example.gravity.json   — fixture spec
  compositions/
    WhatIfVideo/
      index.tsx                 — master composition (3D + HUD + audio)
      demo.tsx                  — hardcoded gravity preview
      audio.tsx                 — <Audio> cue renderer from spec
      hud/                      — Hook, TimerHUD, Captions (HTML overlays)
      scenes/                   — 3D scene templates (R3F)
        shared/primitives.tsx   — Person, Bird, Tree, Ground
        CityScene.tsx           — low-poly city + pedestrians + birds
        FirstPersonScene.tsx    — first-person POV + glass of water
  scripts/
    setup-sfx.ts                — builds the tagged SFX library (public/sfx/)
public/
  sfx/                          — synthesized SFX library + catalog
```

## Sound library

`npm run setup` builds `public/sfx/` — a tagged WAV library (~9 sounds) synthesized
in pure Node, plus `sfx.catalog.json` used by the auto sound-picker. For a
production release, replace these with real CC0 field recordings
(freesound.org, Kenney, opengameart.org) and re-run `npm run setup` to rebuild
the catalog.

## Docs & agent contract

- `INSTRUCTIONS.md` — 1-page quickstart ("change nothing" guarantee)
- `ai/SKILL.md` — full autonomous agent contract (pipeline, iteration budgets,
  quality gates) — this is what an AI coding agent follows to run the factory
  hands-free
- `ai/PROMPTS.md` — shot-spec prompt templates + few-shot examples
- `docs/factory/` — the factory rebuild: analysis, research, plan and progress

## License

UNLICENSED — internal project. Replace synthesized SFX with properly licensed
recordings before public distribution if required.
