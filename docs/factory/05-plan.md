# Cinematic Factory Rebuild — Plan

## Context
The factory turns a topic into a video with Remotion + React Three Fiber, using low-poly 3D. The output is poor for six reasons:
- **The AI isn't directing.** The LLM fills one JSON form inside 3 fixed story templates ([generate-spec.ts:496](../../src/generator/ai/generate-spec.ts#L496)).
- **The camera is formulaic.** It's sine-wave formulas ([StreetStage.tsx:1216](../../src/compositions/StreetStage.tsx#L1216)), driven by the absolute frame with `frame/30` hardcoded.
- **The audio is fake or missing.** All 51 sounds are synthesized in Node. The renderer hardcodes `sfx/<tag>.wav` ([audio.tsx:14](../../src/compositions/WhatIfVideo/audio.tsx#L14)), so real files are never played. There is no music, no ducking and no loudness normalization.
- **Narration is broken.** It's the captions read aloud at the caption start times, so lines overlap or leave dead air. The VoxCPM voice description is never applied, and Kitten runs with `temperature=0.1, top_k=1`, which sounds robotic.
- **The rendering is technically broken.** Shadows are inert because `ThreeCanvas` has no `shadows`. The CSS film grain and several mist/windmill effects are not frame-accurate. GLB files load outside their Suspense boundary, so Street/Ocean crash when assets are missing. Ocean has its lights mounted twice, and the `tod.ts` colour lerp drops the `#`.
- **Nothing can be edited.** Every change means a full LLM run, full TTS, a full rebundle and a full render.

**What the user wants:**
- **Voice:** separate narration and character-voice toggles. Kitten or VoxCPM, with an audition before choosing.
- **Models:** pick an Ollama model per pipeline role.
- **Length and format:** target duration and scene count. 9:16 (15–90s), 16:9 (up to about 10 min) and 1:1.
- **Audio:** real CC0 SFX and music.
- **Captions:** controllable position, colour, font and animation.
- **AI direction:** the AI chooses story, camera, angles, transitions and sound, for a cinematic result.
- **Visuals:** much better low-poly worlds, with CC0 rigged characters.
- **One world (added 2026-10-23):** a single continuous low-poly Earth (countries, cities, nature, seasons, time of day) plus planets and interiors. The AI picks the best place and moment for each scene, and one video can travel between places smoothly. See Phase 6 and [06-world-engine.md](06-world-engine.md).
- **Editing:** a browser editor with live preview, where small edits only redo what changed.

**Confirmed constraints:**
- Low-poly 3D only: no image generation, no realism.
- Only Ollama Pro cloud is available.
- Dev machine: no NVIDIA GPU, Kitten only. VoxCPM2 runs on another machine, so both engines must be supported.
- Free CC0 audio.
- **Delivered in phased milestones**, each one runnable and reviewed by the user before the next starts.

## Prior art (checked 2026-10-22): nothing to adopt wholesale
- **MoneyPrinterTurbo, ShortGPT:** stock footage plus TTS. Not 3D, and no directing.
- **OpenMontage:** AGPL, driven by a coding agent, and built on paid video/image/TTS APIs. Not usable: it doesn't fit the constraints, and copying its code would bring in AGPL obligations.
- **FilmAgent:** its Unity multi-agent repo has become VideoClaw, which now uses generative video models.
- **Cutscene Agent (Kuaishou, Unreal):** the closest design, but no code has been released.
- **Blender MCP servers:** tool-level only.
- **Remotion `remotion-dev/skills`:** rule files for coding agents, not a pipeline.

**Borrowed ideas:**
- FilmAgent's Critique-Correct-Verify loop and its library of predefined shot templates.
- Cutscene Agent's split into director, cinematographer and sound subagents, plus a **"photographer" that reviews rendered stills**. That review step is added below as a vision role using an Ollama vision model.
- ClawVid's TTS-first timing, which is already the plan.

## Target architecture
```
idea + settings ─► WRITER ─► story.json   (acts→beats: narration, dialog[{speaker,text}], visual intent, mood; characters[])
                     │ long-form: outline call, then one call per act
                     ▼
                   VOICE (Kitten|VoxCPM, cache by hash(engine,voice,text)) ─► measured durations
                     ▼
                   TIMELINE solver ─► timeline.json (beat from/to, caption word timings)   ← voice-first
                     ▼
                   DIRECTOR (per batch of beats) ─► direction.json (scenes: kit/look/cast; shots[]: size, angle, move, subject, lens, transition, grade)
                     ▼
                   SOUND DESIGNER ─► sound.json (music cues, SFX on events and cuts, ambience) chosen from the CC0 library index
                     ▼
                   CRITIC (optional) ─► issues → targeted re-asks of the director/sound designer only
                     ▼
                   film.json (= ShotSpec v2, single source of truth) ─► Editor (live Player) ─► chunked render + audio mix + loudnorm
```
Every stage writes its own file under `output/<id>/`, so any stage can be re-run without redoing the earlier ones. Each role uses a **small, separate zod schema**, which mid-size Ollama models handle far more reliably than one large spec. The roles are writer, director, sound, critic and editor. Each is mapped to an Ollama model in `ai.config.json → roles`, with the default model as the fallback.

---

## Phase 1 — Controls, captions, real audio, render fixes  *(milestone 1)*
**Goal: the current videos immediately sound real and look correct, and every setting is user-controlled.**

1. **Render correctness**
   - Set `shadows`, AgX tone mapping and sRGB output on `ThreeCanvas` in [index.tsx](../../src/compositions/WhatIfVideo/index.tsx). Take fps from `useVideoConfig` everywhere.
   - Make the film grain deterministic (SVG `seed={frame}`), replacing the CSS keyframes.
   - Rewrite the accumulating mists and windmill (Countryside, Forest, River) as pure functions of `t`.
   - AssetStage: use `mixer.setTime`, and stop running `skeletonClone` on every render.
   - Wrap `GlbSingle`, `CarBody` and `FloatingCanoe` in `GlbSuspense`.
   - Remove Ocean's duplicate lights. Fix the `#` in `tod.ts` `lerpColor` and the `mountains.tsx` ridge mesh.
   - Delete the dead storyboard code: `runStoryJob`, `createStoryJob`, `ENGINE_STAGES` story entries, and the Videos "story" filter.
2. **Settings model.** Add `spec.settings`:
   - `format: "9:16"|"16:9"|"1:1"`, `targetDuration` (s), `sceneCount?`.
   - `narration {enabled, engine, voice|voiceDesc}`.
   - `characters {enabled, engine, cast: {name → voice}}`.
   - `quality: draft|final`.

   Composition size and duration come from `calculateMetadata` in [Root.tsx](../../src/Root.tsx). Validator caps change to 15–600s.
3. **Model roles**
   - Add `roles` to `AiConfigSchema` in [provider-registry.ts](../../src/generator/ai/provider-registry.ts) and a `resolveRole(role)` that falls back to the default.
   - Server: `GET/PUT /api/roles`.
   - Providers page: show the fetched Ollama models (the `/api/tags` list already exists in [server/fetch-models.ts](../../server/fetch-models.ts)), plus a **Roles card** with a model select and a "Test" button per role.
4. **Voice**
   - Replace the 4-way mode select in Generate.tsx with **two switches** (Narration, Character voices), each with its own engine select.
   - **Audition ▶** for the narrator and for any character voice. Character casting happens in the editor (Phase 4).
   - Move the python resolution into one shared `pythonFor()` (from [tts.ts](../../src/generator/tts.ts)), removing the hardcoded `C:/Users/Narwal` paths in server/index.ts.
   - Fix the VoxCPM description bug: map a preset id to its description through `VOXCPM_VOICE_DESCRIPTIONS`.
   - Kitten: sampling around `temperature 0.6`. Raise `trim_silence` `max_pause` to about 0.45s.
   - **Cache TTS per line** at `public/voice/cache/<sha1>.wav`.
5. **Captions**
   - Add a `captionStyle` schema with presets (Bold Pop, Clean, Documentary Serif, Neon, Minimal) and full custom fields:
     - position (top/upper/middle/lower/bottom + y-offset, safe areas per format)
     - font (a curated set of about 12 via `@remotion/google-fonts@4.0.536`, loaded before render), weight, size
     - text, highlight, stroke and shadow colours; background none/box/pill + opacity
     - uppercase
     - animation (none/fade/pop/slide-up/**karaoke word highlight**/word-by-word), words per chunk
   - Rewrite [Captions.tsx](../../src/compositions/hud/Captions.tsx) and [Hook.tsx](../../src/compositions/hud/Hook.tsx) on this style. This also removes the `dangerouslySetInnerHTML` keyword injection.
   - UI style panel with a live mini Player.
6. **CC0 audio library.** New `scripts/setup-audio-library.ts`, reusing the Kenney scraping and ffmpeg path from [setup-sfx-cc0.ts](../../scripts/setup-sfx-cc0.ts). Sources:
   - **Kenney:** the existing packs plus `digital-audio`, `ui-audio`, `music-jingles`.
   - **OpenGameArt:** `100-CC0-SFX_0.zip`.
   - **BigSoundBank:** a curated ID list for ambience, nature, crowd, vehicles, animals, weather and destruction. `UPLOAD/mp3/{id}.mp3`; each page is checked for "Free and Royalty Free" before download.
   - **Music:** a curated subset of about 80 tracks from the archive.org `freepd` **category folders only** (epic, horror, scoring, upbeat, romantic, comedy, electronic, misc), listed through `archive.org/metadata/freepd`.
   - Sonniss is left out because of its no-AI-use clause.

   Processing: transcode to 48 kHz WAV, then measure LUFS (ebur128), duration and loopability. Write `public/library/audio-library.json`:
   - `{id, kind: sfx|ambience|music|stinger, file, tags[], mood, energy, durSec, lufs, loopable, source, license, url}`

   Tags come from the folder and file name. An optional "librarian" role pass adds descriptive tags.
7. **Audio renderer rewrite** ([audio.tsx](../../src/compositions/WhatIfVideo/audio.tsx)):
   - Cues resolve to library files, with a gain derived from the measured LUFS so every category sits at a target level.
   - Music cues get fades. Beds `loop`.
   - **Ducking:** music and ambience drop about 8 dB while any voice segment is active (the volume curve is computed from the voice segments).
   - Automatic whoosh on transitions.
   - Synth sounds stay only as a last resort.
   - Post-render: **two-pass ffmpeg `loudnorm` to −14 LUFS / −1 dBTP**.

**Milestone 1 check:** re-render an existing plan in all 3 formats. The result has real SFX and music, a ducked and normalized mix, styled captions, working shadows and no flicker. The user signs off.

## Phase 2 — AI director pipeline + voice-first timeline  *(milestone 2)*
1. New `src/generator/pipeline/` with `writer.ts`, `voice.ts`, `timeline.ts`, `director.ts`, `sound.ts`, `critic.ts`, `assemble.ts` and `llm.ts`:
   - `llm.ts` is the generic `callRole(role, system, prompt, schema)`. It reuses the native-Ollama `format` enforcement and the `extractJson`/`buildRepairContext`/`extractFailure` repair loop from [generate-spec.ts](../../src/generator/ai/generate-spec.ts).
2. **Writer prompt:** hook in the first 2s, escalation, payoff, retention rubric, characters with a description, gender and age.
   - Word budget = target × about 2.4 words/s, minus dialog.
   - Long-form: outline first, then one call per act.
   - After TTS, if the measured length is off by more than 10%, one trim/extend call on specific beats. Otherwise the timeline stretches visual holds.
3. **Director prompt:** a cinematography knowledge block.
   - The shot vocabulary (below) and pacing rules: 1.5–4s per shot for Shorts, 3–8s for long-form.
   - Vary shot sizes and keep the 180° rule.
   - Moves are motivated by mood. Transition grammar. A grade preset per mood.
   - The world inventory from [knowledge.ts](../../src/generator/ai/knowledge.ts) (kits, assets, anchors per kit).
   - Batches of about 8 beats per call to fit long videos.
4. **Characters are cast automatically.** Kitten voices are chosen from a gender/pace table built from [voices.ts](../../src/generator/voices.ts). VoxCPM gets a generated description. Both can be overridden later.
5. **The 3 fixed families go away.** `statPanel`, `timer` and `heroProp` become optional "graphic devices" the director may use.
6. `generate.ts` and `server/jobs.ts` get the new stage names and progress (writer → voice → director → sound → critic). Plan jobs now receive `settings`.

**Milestone 2 check:**
- 3 different premises × 3 formats, using the user's Ollama models.
- Varied stories, and voice with no overlaps or dead air.
- Captions in sync word by word.
- Length within ±10% of the target.

## Phase 3 — Cinematic camera, transitions, look  *(milestone 3)*
> **With the world engine (Phase 6):** camera anchors come from the world (landmarks, avenues, lots, junctions, parks) instead of a table per stage; a flight over the globe is one more transition type ("travel"); the look pass applies to both the ground and the globe scenes. Do Phase 6 step 1 first.

1. **Spike first (half a day):** pin `@react-three/postprocessing@3.0.4` (it accepts fiber ^9.0, while current releases need ≥9.7) with `postprocessing@6.39`. Verify that `EffectComposer` renders correctly in a `ThreeCanvas` still and in the Player. Fallback: a custom composer pass through `useFrame` priority.
2. **Anchors.**
   - Each stage exports a static anchor table, measured from its layout code. Examples: street hero-prop row, shop row, crosswalk; space planet radius from the stat value; ocean jetty, canoes, shoreline; countryside houses, barn, windmill; interior window, sofa, lamp, cast slots.
   - Dynamic anchors (characters, hero props) register through `AnchorContext`.
   - Each stage gets `cameraMode="external"`. The inline rigs in Countryside, Forest, River and Interior are first extracted into components.
3. **`CinematicCamera`**:
   - Shot: `{size: extreme-wide|wide|medium|close|extreme-close, angle: eye|low|high|overhead|dutch, move, subject, lens(mm), intensity}`.
   - Moves: static, push-in, pull-out, truck-left/right, orbit-left/right, crane-up/down, tilt-up/down, pan, follow, dolly-zoom, whip-out, handheld, arc reveal.
   - Distance is computed from the anchor radius, the shot size and an FOV that adapts to the aspect ratio. Look-at leaves leading room. Easing per move. Seeded handheld noise.
   - Per-kit bounds keep the camera from leaving rooms or clipping through trees.
   - Time is local to the scene (`t - scene.from`).
   - In space, the sun light follows the camera.
4. **Transitions.** Each scene renders in its own `ThreeCanvas` layer, and layers only overlap during a transition window. Stages keep absolute time, so nothing reads the wrong frame.
   - Types: cut, crossfade, dip to black/white, whip-pan (camera whip + directional blur), zoom-punch, flash, push/slide, match-cut.
5. **Look**
   - N8AO, mipmap bloom, depth of field focused on the subject distance.
   - A custom `GradeEffect` (lift/gamma/gain, split-tone, saturation) with presets the director picks per mood.
   - Vignette, light chromatic aberration, seeded grain.
   - The draft quality setting drops AO and DOF for previews.

6. **Photographer role (vision QA)**
   - Render a draft still per shot and send it to an Ollama vision model chosen in Roles (e.g. a qwen-vl or gemma family model from the user's list).
   - The model scores framing, subject visibility and caption overlap against the shot's intent.
   - Shots that fail get one targeted re-ask to the director. This is capped, logged, and can be switched off.

**Milestone 3 check:** stills from every kit × shot sizes × all 3 formats are reviewed visually, and a full render of each premise is compared with the Phase 2 renders.

## Phase 4 — Editor + fast re-render  *(milestone 4)*
1. **Editor.** The review step in [Generate.tsx](../../ui/src/pages/Generate.tsx) becomes an editor with three panes:
   - **Timeline:** beats and shots.
   - **Player:** generalizes the unused [PlayerPreview.tsx](../../ui/src/preview/PlayerPreview.tsx), with size and duration taken from the spec and draft quality.
   - **Inspector** for the selected item:
     - narration and dialog text
     - speaker voice, with ▶ audition
     - caption text and keyword
     - shot size/angle/move/lens/subject/transition
     - scene look/time/weather
     - music and SFX cues with ▶ preview
     - global caption style
2. **"Ask AI"** box per beat and for the whole video. The `editor` role returns a JSON patch for only that target.
3. **Incremental pipeline.**
   - A text edit re-voices that line only (cache), re-solves the timeline, and offers "keep timing" or "reflow".
   - A shot or style edit changes nothing upstream.
   - New routes: `PUT /api/film/:id` (validated, versioned `film.vN.json`, with undo) and `POST /api/film/:id/patch`.
4. **Chunked render.** Switch from cmd spawning to `@remotion/renderer` (`bundle`, `selectComposition`, `renderMedia`).
   - **Bundle cache:** keyed by a hash of the source tree. Today it rebundles on every render.
   - **Video chunks:** split per scene, and long scenes split at shot cuts so no chunk exceeds 20s. Rendered **muted** with `frameRange`. Cache key = sha1(bundle hash + format + quality + every spec element that intersects the chunk range ± transition padding).
   - **Audio:** rendered once, audio-only, then ffmpeg concat (`-c copy`), mux and loudnorm.
   - **Result:** a caption tweak re-renders one chunk instead of the whole video. Jobs are written to disk so they survive a server restart.

**Milestone 4 check:** edit one caption in a 3-minute 16:9 video. The log shows 1 chunk re-rendered with the rest reused, and the total time is a fraction of a full render.

## Phase 5 — Better worlds & characters  *(milestone 5)*
> **With the world engine (Phase 6):** step 3 (the composable set builder) is now done by the world engine: place catalog, street generator, kit assembler and asset catalog. Steps 1 and 2 still apply, but inside the world rather than per stage.

1. **Characters**
   - Make sure `npm run assets` fetches the Kenney blocky/mini characters and the Quaternius Animated Men/Women packs (already in [setup-assets.ts](../../scripts/setup-assets.ts)).
   - New `Actor` component: GLB rig and recolour, plus an **action timeline from the director**: walk-to(anchor), idle, run, wave, point, sit, look-at, react/panic, fall, cheer.
   - Clips are played deterministically with `mixer.setTime`.
2. **Materials and atmosphere:** a consistent toon/gradient material palette per mood, dust motes or fireflies, cheap volumetric light shafts, layered cloud skies. Improve water. Fix the River axis bug and the Interior camera bounds.
3. **Composable set builder.** The director picks a kit, a layout variant, and catalog props placed at named slots, so new worlds don't need new code. Add 2–3 new kits where the milestone tests show gaps (e.g. lab/tech interior, desert, snow mountain).

## Phase 6 — One world and video quality  *(milestone 6)*
**Goal: every video happens in one living, continuous world, chosen by the AI, and looks and sounds like it.** The engine's base is built and tested (`src/world/`, see [06-world-engine.md](06-world-engine.md)); this phase connects it to the factory and adds what makes the videos feel alive.

**Order:** step 1 (and the speed work in step 2) comes before Phase 3, because Phase 3's camera aims at things in the world. The other steps can run alongside Phases 3–5. **Every step starts with a prior-art check** (libraries, CC0 assets, research code) before any code is written.

1. **Connect the world to the factory**
   - The director gets `worldDirectorContext()` (places, city looks, asset summary) and answers `{place, date, time}` per scene, checked with `WorldSceneSchema`. This edits the Phase 2 director: coordinate so only one session works on it.
   - The main composition renders world scenes (ground and globe) in place of the separate stages; a change of place between scenes becomes a flight.
   - The CC-BY credits for the models a video used go into its report and description automatically (`creditsForPlaces`, `creditsFor`).
   - `npm run` scripts for the world data, asset download and catalog build; the setup steps go into the README.
2. **Render speed**
   - Distance levels of detail for kit cities: real kit pieces near the camera's path, merged boxes beyond (Colmar → New York takes 229 s today against 82 s for Paris → Cairo).
   - Only the assets a video uses are copied into the render bundle (today the whole 0.9 GB public folder is).
3. **Life in the world**
   - Traffic driving along the generated streets (car kit, road graph), stopping at junctions.
   - Pedestrians on sidewalks and in plazas (the animated character packs; they share Phase 5's `Actor`).
   - Birds, trees and flags swaying in the wind, chimney smoke, boats on water, drifting clouds.
   - All driven by the frame number, so every render is identical.
4. **Light and time** (possible because the sun is real)
   - Night: lit windows, street lights, car headlights, a starry sky.
   - Time-lapse: a place from dawn to night in a few seconds, lights switching on as the sun sets.
   - Season-lapse: trees going from green to autumn colours to bare to snow.
5. **"What if" world events.** Water rising through the streets, the lights going out, gravity switching off, snow covering everything, the sun not setting. The director schedules events on the timeline; each is a pure function of time. Ports and extends the old stages' world events.
6. **Camera extras.** Motion blur on fast moves (measure the render cost first); travel shots that follow the flight line; shot choices aimed at landmarks and avenues.
7. **Graphics layer.** An animated flight line between cities on the globe, a distance counter, city and country labels, animated stat cards and small maps, designed to work with the caption styles.
8. **Globe polish and the continuous descent**
   - Smooth coastlines, climate colours that blend instead of latitude stripes, real cloud systems (tropical belt, storm bands), a soft atmosphere glow, a night side with city lights.
   - Test NASA 3DTilesRendererJS (Apache-2.0) for a truly continuous street-to-orbit descent; keep the cloud cover if it fails.
9. **Sound from the place.** Ambience by place type and density (traffic and crowds in cities, wind in deserts, birds in parks), effects from world events and passing traffic, volume falling off with distance. Uses the CC0 library and the Phase 2 sound designer.
10. **More of the world**
    - Famous landmarks with no free model (Taj Mahal, Pisa, Sydney Opera House, Burj Khalifa, Sagrada Familia, ...) modelled in low-poly, simple ones first.
    - More places and regional looks (East Asian, South Asian, Middle Eastern, Nordic winter, tropical coast), with our generator where no kit exists.
    - Interiors: rooms laid out Holodeck-style (relational constraints, a small solver) with the furniture kits; the camera can enter a building through a window or door.
    - Planet surfaces (Moon, Mars) reached from the globe.

**Milestone 6 check:**
- Three AI-made premises with real Ollama models, each using at least two places, rendered in all three formats.
- Streets have traffic and people; at least one night or time-lapse shot; at least one world event.
- Render time per 15 s stays within 1.5× of Paris → Cairo (82 s on the dev laptop).
- The CC-BY credits appear in each video's description.
- The user reviews the videos.

---

## Phase 7 — The Reference Bar *(milestone 7 — added 2026-10-23)*
**Goal: a finished video stands next to the two channels the user chose as the quality bar and holds up.** The 8 reference frames live in [quality-refs/](quality-refs/): the **gravity-town** channel (one dressed European plaza, day → night, buildings lifting, ground breaking) is the target aesthetic for the Phase 6 world; the **toilets/fun-facts** channel (dense NYC, animated people, tracking/aerial/close-up camera, timer HUD) is the target for density, life, camera and HUD.

**The checklist items are acceptance criteria inside Phases 3, 5 and 6** (each listed below); this phase owns the gate, plus the two items with no home yet.

1. **Typography (cheap first win, runs inside the Phase 3 look work).** Captions default to the serif italic style with a soft shadow (the reference channels read as "documentary serif"); the hook/title renders serif over the live scene with the **keyword highlighted in gold** (a caption-style preset, not a separate card).
2. **Pulse/BPM returns as a director device.** `bpm` comes back into `StatBeatSchema` as **optional**, rendered only when the director sets it (checked against the media in `quality-refs/` where the reference channel drives it deliberately). The heartbeat sound becomes a **sound-designer cue derived from the chosen bpm** — the fabricated always-on bed and the invented bpm values of the audit stay deleted. Amends [10-intent-audit.md](10-intent-audit.md).
3. **Dressed places** *(→ Phase 5 step 3 / Phase 6 steps 3, 10):* per-region prop kits fill scenes — plaza: market stalls, striped awnings, bunting lines, fountain, tower, trees, bins; NYC blocks: rooftop water towers, taxis, bodegas, hydrants, crosswalks. Gate: a wide shot of the hero scene shows **≥ 30 authored props**, no bare box corridors.
4. **Visible life** *(→ Phase 5 step 1 / Phase 6 step 3):* **≥ 10 animated background people** per street/plaza scene with real walk cycles, at least one carrying an object (coffee cup, bag); birds overhead.
5. **Camera language** *(→ Phase 3 step 3):* every video exercises a **tracking follow-shot, an aerial flyover and a close-up**, chosen by the director per beat; the aerial shows street depth (crossings, traffic lights).
6. **Light & atmosphere gate** *(→ Phase 3 step 5 / Phase 5 step 2 / Phase 6 step 4):* sun with god-rays or a starfield night; haze in depth layers; consistent shadows; at least one wet/reflection moment per video.
7. **The world reacts** *(→ Phase 5 / Phase 6 step 5):* every stat beat visibly moves the world on screen (buildings lift, ground cracks, confetti rises) within 0.5 s of the value change — no number-change without a physical change.
8. **The gate.** Side-by-side stills of our video against `quality-refs/` for every checklist item, then the full video. Milestone 7 passes **only when the user says it looks like the references**.

**Milestone 7 check:** one AI-made premise at reference level in 9:16: stills pass items 3–7 side by side with the references, the full video passes items 1–2 and 8. Then the bar applies to the other two premises and formats.

---

## Critical files
- **Schema and AI:** `src/generator/spec.schema.ts`, `src/generator/ai/provider-registry.ts`, `src/generator/ai/knowledge.ts`, `src/generator/ai/generate-spec.ts` (repair helpers are moved into `pipeline/llm.ts`), new `src/generator/pipeline/*`.
- **Voice:** `src/generator/tts.ts`, `src/generator/voices.ts`, `scripts/story-tts.py`, `server/tts.ts`.
- **Render:** `src/compositions/WhatIfVideo/index.tsx`, `src/compositions/WhatIfVideo/audio.tsx`, `src/compositions/hud/*`, `src/Root.tsx`, every `src/compositions/*Stage.tsx` (same pattern: anchors table + `cameraMode` prop + determinism fixes), new `src/compositions/cinema/{CinematicCamera,anchors,transitions,Look,GradeEffect,Actor}.tsx`.
- **Pipeline orchestration:** `src/generator/generate.ts` → new `src/generator/render/{chunks,mix}.ts`.
- **Audio library:** `scripts/setup-audio-library.ts` (new), `public/library/audio-library.json`.
- **Server:** `server/index.ts`, `server/jobs.ts`, `server/providers.ts`.
- **UI:** `ui/src/pages/Generate.tsx` (split into `ui/src/pages/editor/*`), `ui/src/pages/Providers.tsx`, `ui/src/preview/PlayerPreview.tsx`, `ui/src/api.ts`.
- **World engine (Phase 6):** `src/world/*` (places, city, roads, terrain, trees, assembler, kits, catalog, landmarks, director-context, Ground, Globe, WorldFlight), `scripts/world-assets/*`, `scripts/setup-world-data.ts`, `scripts/setup-world-assets.ts`, `scripts/build-world-catalog.ts`.
- **Dependencies:** `@remotion/google-fonts@4.0.536`, `@remotion/renderer@4.0.536`, `@react-three/postprocessing@3.0.4`, `postprocessing@6.39.x`, `vitest` (dev). Install with `--legacy-peer-deps` because of the existing `@types/react-dom` peer conflict.

## Verification
- **Every phase:**
  - `npx tsc --noEmit`, `npm run lint`.
  - Vitest units: timeline solver (no voice overlap, duration fit), caption chunker and word timing, camera framing math (subject inside frame across all 3 aspects), chunk hashing (editing one caption changes exactly one chunk key).
- **Visual:** `npx remotion still` at key frames per format. Inspect the PNGs. Check determinism by rendering the same frame twice and comparing hashes.
- **Audio:** ffmpeg `ebur128` on the final MP4: integrated −14 ±1 LUFS, true peak ≤ −1 dBTP. A timeline check confirms no voice overlap. `npm run audit` for SFX alignment.
- **Pipeline:**
  - An offline fixture LLM (recorded role outputs) runs the full pipeline here without a key.
  - Real runs with the user's Ollama Pro key happen on their machine, since this one has no `.env`.
  - Kitten is verified here; VoxCPM is verified on the other machine.
- **World:** `npx tsx --test src/world/*.test.ts`; stills of each place at street level and from above; render time per 15 s flight compared with the 82 s (Paris → Cairo) and 229 s (Colmar → New York) baselines.
- **The user reviews each milestone's sample videos before the next phase starts.**
