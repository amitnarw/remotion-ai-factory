# 00 — Start here: the whole factory on one page (2026-11-04)

This page is the map of the AI video factory: what it does, how a video gets made, where every feature lives, and how far each part is. It is for any person or AI session that picks the work up without this session's memory.

**Read in this order:**
1. [HANDOFF.md](HANDOFF.md): the standing rules, where work stopped, and the next steps.
2. This page.
3. The two code maps, for the detail of every file:
   - [16-code-map-pipeline.md](16-code-map-pipeline.md): premise to MP4, server, dashboard, scripts;
   - [17-code-map-world.md](17-code-map-world.md): how a frame is built, the world, camera, look.
4. The design doc of whatever you change (the table below names it).

[04-codebase-map.md](04-codebase-map.md) is the code as it was on 2026-10-22. It is history only.

## 1. What it is
A local tool that turns a topic or a story into a finished short or long video: stylized low-poly 3D (Remotion with react-three-fiber), a narrator and character voices, sound effects, ambience and music from CC0 libraries, captions, and a cinematic camera. Every role is an AI model chosen per role: Ollama, OpenAI, Anthropic, Google, OpenRouter or any OpenAI-compatible endpoint (Settings → AI models). Everything on screen or in the mix is there because a role chose it ([10-intent-audit.md](10-intent-audit.md)).

## 2. How a video gets made
```
brief (topic, or the user's own story; a channel profile)
  → story        writer role; premise, adapt, or as written (the user's words kept)   → story.json
  → GATE 1       the user reads or edits the story (on by default; --no-story-gate skips it)
  → breakdown    breakdown role: every set, character, prop, action, effect, sound the story needs → breakdown.json
  → match        the library registry plus the matcher role: have / close / download / build / data / skip → needs.json
  → GATE 2       the shopping list: approve downloads, accept substitutes, file build requests
                 (the library functions are built, src/generator/library/acquire/; the run does not stop here yet)
  → voice + timeline   voices first, then every beat is timed from the speech
  → director     places or kit sets, date and time, shots, actors, reactions, time-lapse, bullet time
  → sound        beds, effects, music, stingers
  → critic       code checks plus an optional AI critic; the writer revises
  → GATE 3       plan review in the dashboard (optional)
  → assemble     the spec (src/generator/spec.schema.ts), validated
  → render       Remotion, optionally in chunks (only changed chunks re-render)
  → QA           the photographer's stills and checks, the audio master and measurements → MP4 + report
```
- **Saved and resumable:** each run lives in `output/<slug>-<6 hex>/`. `run.json` lists every stage with its input hash, so a run resumes from the first stage that changed or never finished, and model replies are cached ([15-producer.md](15-producer.md) §11).
- **Commands:** [16-code-map-pipeline.md](16-code-map-pipeline.md) §4 and HANDOFF §3.

## 3. How a frame is built
`src/Root.tsx` → `WhatIfVideo` (`src/compositions/WhatIfVideo/index.tsx`) → each scene is either a **kit stage** (street, space, ocean, countryside, forest, river, interior, park, pier, boardwalk) or a **world scene**: a real place (Paris, Cairo, Colmar, New York) at a real date and time, drawn by `WorldStage.tsx` and `src/world/Ground.tsx`. Then come the look and grade, the HUD and captions, and the audio.

**Every frame is a pure function of the frame number.** Remotion renders frames out of order, in parallel tabs, with no state between frames. Randomness is seeded, models load under `delayRender`, and layers take the lens from props. The rules and their traps are in [17-code-map-world.md](17-code-map-world.md) §1 and its gotchas.

## 4. Feature index
"State" is as of `8c2a009` (2026-11-04). Tests run with `npm test` (the node test runner through tsx, not vitest).

| Feature | Main files | Design doc | Tests | State |
|---|---|---|---|---|
| Writer, revise, long form (act by act over 180 s) | pipeline/writer.ts | 05-plan, 15 §12 | writer, prompts | done |
| **Channel profiles** (what-if, action, drama, documentary) | channels/*.json, ai/channels.ts | 15 §7, §12 | channels, prompts | done; the director, sound and critic guides are an unfinished patch (HANDOFF §2) |
| **Story modes** (premise, adapt, as written) | pipeline/script.ts, writer.ts, run.ts | 15 §2, §12 | script, modes | done |
| **Resumable runs, story gate** | pipeline/run.ts, manifest.ts, llm.ts (reply cache), generate.ts | 15 §11 | run, resume, calls, manifest | done |
| **Breakdown and inventory** | src/generator/library/{registry,capabilities,match,judge,shopping,models,sounds,words}.ts, pipeline/breakdown.ts, scripts/breakdown.ts | 15 §3 | registry, match, breakdown | done, wired after gate 1 (informational) |
| **Acquisition** (sources, licence check, intake, build requests) | src/generator/library/acquire/*, scripts/acquire.ts, acquired.catalog.json, build-requests/ | 15 §4-6, §13 | acquire/*.test | library done; gate 2 in the run, server and dashboard not wired; the world catalog merge is an unfinished patch |
| Director, shots, transitions | pipeline/director.ts, shots.ts, transitions.ts, src/world/director-context.ts | 08, 09-phase3-handoff, 13, 14 | director, shots, transitions | done |
| Sound designer | pipeline/sound.ts | 03, 13 Part B, 18 | sound | done (rain bed, storm thunder) |
| Critic, photographer (vision QA) | pipeline/critic.ts, src/generator/qa/* | 05, 08 §4, 09-phase3-handoff | critic, photographer, vision, metrics | done; vision calibration needs the GPU machine |
| Voices (KittenTTS 2, VoxCPM2), timeline, captions | pipeline/voice.ts, timeline.ts, captions.ts, tts.ts, voices.ts, scripts/story-tts.py | 05 Phase 2 | voice, timeline, tts.worker | done |
| Assembler and spec | pipeline/assemble.ts, spec.schema.ts | 10, 11, 14 | assemble, spec.schema | done |
| Audio resolve, mastering, slow-motion sound | audio-resolve.ts, audio-master.ts, audio-library.ts, audio-warp.ts | 03, 14 §3.5 | assemble, audio-warp | done |
| Render, chunks, editor, Ask AI | src/generator/render/*, film/*, pipeline/editor.ts, server/film.ts, ui/src/pages/editor/* | 09-phase4 | plan, film, diff, recast, editor | done; Ask AI with a real model untested |
| Dashboard and server | ui/src/*, server/* | 09-phase4, 15 §12 | progress, fetch-models | done (channel picker, "use my own story", story review) |
| Providers and roles | pipeline/llm.ts, ai/provider-registry.ts, ai/roles.ts, server/providers.ts, server/fetch-models.ts | HANDOFF §1 | llm, fetch-models | done (Ollama listing fixed in c0da000) |
| Places, regions, cities, terrain | src/world/{places,geo,city,roads,terrain,trees,meshes}.ts | 06 | world, roads, terrain, towns | done |
| **Dressed places** (painted towns, bell towers, hills, New York brick, water tanks) | places.ts, city.ts, kits.ts, kitTown.ts, kitPaint.ts, KitInstances.tsx, kitFar.ts | 06, quality-refs | towns, world | done |
| Kit buildings, far cards, landmarks, catalog | assembler.ts, kits.ts, kitLod.ts, kitFar.ts, landmarks.ts, catalog.ts | 06 | assembler, kitLod, catalog | done |
| Kit stages | src/compositions/*Stage.tsx | 08, 09-phase3-handoff | camera sightlines, stage-bounds | done; street and park frames differ between runs (an open bug, HANDOFF §2) |
| Globe and flights | WorldFlight.tsx, flight.ts, Globe.tsx, WhatIfVideo/FlightView.tsx | 06 | world, assemble | done (flights show their scene's weather) |
| Traffic (cars, signals, light pools, stops for actors) | traffic.ts, TrafficLayer.tsx, TrafficSignals.tsx | 12 | traffic | done |
| Featured actors (off by default) | src/world/actors/*, camera/world.ts | 09-phase5, 14 | script, rig, dodge, cast | done |
| Dusk lights, moon, stars | atmosphere/{dusk,moon,stars}.ts, kitWindows.ts, react/darkShader.ts | 13 Part A, 11 | dusk, moon | done |
| Time-lapse | lapse.ts, lapseLight.ts, look/{blend,chain,ToneMixEffect}.ts | 13 Part B | lapse, lapseLight, blend | done |
| **Bullet time** | warp.ts, projectiles.ts, ProjectilesLayer.tsx, audio-warp.ts, actors/*, camera arc in solve.ts | 14 (Status) | warp, projectiles, dodge, audio-warp, clock | built; the full test video not rendered yet |
| World reactions and events | src/world/react/*, Ground.tsx | 11 | react/*.test | done |
| **World weather** (rain, snow, storm, bolt) | src/world/weather/*, Ground.tsx | 18 | weather | done; wet streets open |
| **Water events** (river, ocean) | riverWater.ts, RiverStage.tsx, OceanStage.tsx | 18 | — | done |
| Look and grade (sun-based in world scenes) | src/compositions/look/*, look-choice.ts | 08 §5, 13 | look, blend, look-choice | done |
| Camera solver (locked shots still, market blockers, arc) | src/generator/camera/* | 08 §1, 09-phase3-handoff, 11, 13, 14 | camera/*.test | done |
| HUD and captions | src/compositions/hud/* | 08 §3, quality-refs | hud-layout, layout | done |

The paths above are under `src/generator/` for the pipeline rows and under `src/world/` or `src/compositions/` for the world rows, unless written out. The code maps give every file.

## 5. What is left, in short
The full list, in order, is in [HANDOFF.md](HANDOFF.md) §3 and §4. In one line each:
1. Finish the two unfinished patches (channel guides; acquired models in the world catalog).
2. Wire gate 2 (the run, the CLI, the dashboard's shopping list and an Assets page).
3. Fix the street and park frame nondeterminism, and make the roads timing test robust.
4. Render the bullet-time test video and look at it.
5. A combined check of everything together, and the render time against the 123 s bar on a quiet machine.
6. Then on the GPU machine: real models end to end, milestones 4 and 6, the photographer's calibration, and the user's listening pass.
7. Later: the producer you talk to (P5), model sets and clip packs (P6), more places.
</content>
