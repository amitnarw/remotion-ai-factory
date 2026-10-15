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

## License

UNLICENSED — internal project. Replace synthesized SFX with properly licensed
recordings before public distribution if required.
