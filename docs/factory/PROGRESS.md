# Progress & Handoff

**Last updated:** 2026-10-23 (evening), on the original machine (Windows, RTX 3060 Laptop GPU, VoxCPM2 + KittenTTS 2 installed, Ollama Pro key in `.env`)
**Current status:** The project was **ported from the dev laptop to this, the user's original machine**. All three parallel-session work trees (Phase 3 camera/look, Phase 4 editor, Phase 5+6 world engine) were secured on this machine as committed work. **The real-model milestone run is in progress** (3 premises × 3 formats, writer role `ollama/glm-5.3`, real KittenTTS 2 voices); results go into the table below when it finishes.

## Next step
**Phase 3 is about 65% done and was paused for a move to another laptop.** Start from **[09-phase3-handoff.md](09-phase3-handoff.md)**: what is done, what is left, in order, with commands. Research and design: [08-phase3-research.md](08-phase3-research.md); the problems it answers: [07-milestone2-visual-review.md](07-milestone2-visual-review.md).

**On the machine with the Ollama key** (the last part of Phase 2, any time):
1. `git pull` (or apply the bundle), `npm ci --legacy-peer-deps`, `npm run audio:library`, `npm run assets`.
2. Install KittenTTS 2 from the dashboard's Setup tab. It needs internet once and downloads its decoder too.
3. Providers → Model roles: choose a model for the **Writer** (required). The other roles use the Writer's model unless you pick their own.
4. `npm run milestone` runs the same 9-video check with the real models. Record their replies once with `FACTORY_LLM_RECORD=test-fixtures/pipeline/<name>` and commit the folder.
5. Listen to the videos on your machine (nothing is played on the dev laptop) and note what sounds wrong.

## Phase checklist
- [x] Analysis of the current factory: [01-analysis.md](01-analysis.md)
- [x] Prior-art research: [02-prior-art.md](02-prior-art.md)
- [x] CC0 audio source research: [03-audio-sources.md](03-audio-sources.md)
- [x] Codebase map: [04-codebase-map.md](04-codebase-map.md)
- [x] Plan agreed: [05-plan.md](05-plan.md)
- [ ] **Phase 1:** controls, captions, real audio, render fixes (milestone 1)
  - [~] 1. Render correctness fixes — DONE 2026-10-22: shadows on; deterministic film grain; mist/rain/waterfall/windmill are pure functions of time (`src/compositions/mist.ts`); mountain ridge now renders (was an empty group; needed indices and normals); dead story-job code removed from `server/jobs.ts`; AssetStage uses absolute clip time; Ocean duplicate lights removed; `tod.ts` colour lerp returns `#hex`; GLB files are checked before loading (`useModelStatus` in `glb.tsx`) so missing models no longer crash the render. Leftovers listed below.
  - [x] 2. `spec.settings` — DONE 2026-10-22: format (9:16 / 16:9 / 1:1) sets width, height and the duration cap (90s; 600s for 16:9); target length and scene count reach the writer prompt and the validator; quality `draft` renders at half size. UI panel in Step 1 (`VideoSettingsPanel`); `/api/plan` validates; `generate.ts` takes `--format --duration --scenes --quality --settings-json`. Verified: 16:9 offline plan → spec 1920×1080 → draft MP4 960×540. NOT in this step: separate voice toggles (step 4); fps stays 30 by design.
  - [x] 3. Model roles — DONE 2026-10-22: `src/generator/ai/roles.ts` (six roles: writer, director, sound, critic, vision, editor); `roles` in `ai.config.json`; `GET/PUT /api/roles` with validation; Providers tab card (`ModelRolesCard`); the writer and the plan route use the writer's model. Verified: API accepts valid choices and rejects unknown role, unknown provider, unknown model; a plan with no provider now uses the writer's provider (it reports the missing key for ollama). NOT verified: a real Ollama generation (no key on this laptop) and the Providers card in a browser. Other roles are stored now and wired in their phases.
  - [x] 4. Voice — DONE 2026-10-22: two independent switches (narration, character voices) with their own engine; ▶ audition for the narrator and the character voice (errors shown, not swallowed); one Python resolver `src/generator/tts-python.ts` (env override, then `.tts/<engine>/.venv`), all hardcoded `C:/Users/Narwal` paths removed; VoxCPM preset ids mapped to their descriptions; Kitten sampling `temperature 0.6, top_k 30` and longer allowed pauses (`SYNTH_VERSION` 2); TTS cache in `public/voice/cache/` keyed by a hash of engine, voice, description and text; narrator skips lines that a character speaks when character voices are on. Verified: description mapping, the clear not-installed error, cache reuse with no Python run, routes report not-installed. NOT verified by ear: the Kitten and VoxCPM sound, since no engine is installed here.
  - [x] 5. Caption style system — DONE 2026-10-22: `src/generator/caption-style.ts` (5 presets: bold pop, clean, documentary serif, neon, minimal pill; overrides for position, offset, font, size, colours, box, uppercase, animation). Captions and the hook draw from one resolved look and use React spans (no injected HTML). Bundled fonts load before the first frame (`hud/fonts.ts`). Dashboard panel `CaptionPanel` with a live Player preview of the same component. The look is stored in `spec.settings.captions`. Verified: stills of bold pop, documentary and minimal pill at the position set; validation rejects a bad colour, a size over 96 and an unknown position; the offline plan keeps the look. NOT verified: the entry animations (only final frames were checked) and the live preview in a browser.
  - [x] 6. CC0 audio library — DONE 2026-10-22: `scripts/setup-audio-library.ts` (`npm run audio:library`). Builds `public/library/` (git-ignored) and `public/library/audio-library.json`. Built on this laptop: 752 files: 625 sfx, 86 stingers, 40 music (FreePD, 5 per mood folder), 1 ambience. Sources: Kenney (8 packs, CC0), OpenGameArt 100 CC0 SFX, BigSoundBank (curated list in `scripts/audio-library.bigsoundbank.json`), FreePD archive.org mirror. Each entry is measured with `loudnorm` (integrated LUFS, true peak, duration), with 5 s of silence added first, since short clips return nothing otherwise. Re-runs reuse downloads. Verified: all 752 entries have a loudness reading, every file in the index exists, and the index merges with earlier runs. NOT verified: listening (none played, by request).
  - [x] 7. Audio renderer — DONE 2026-10-23. `src/generator/audio-resolve.ts` picks a library file for every cue (deterministic, seeded), sets its gain from the measured loudness (targets: sfx -20, stinger -18, ambience -26, music -23, narration -16, dialog -17 LUFS; never above -1 dBTP), and writes `file`/`gain` into the spec. Background music comes from the story's mood when the spec has none. A whoosh is placed at each scene cut. The composition (`WhatIfVideo/audio.tsx`) plays only what it is given, ducks music and beds by 8 dB under speech, and fades music in and out. `src/generator/audio-master.ts` masters the finished MP4 to -14 LUFS / -1 dBTP in two passes, copying the picture. Shared ffmpeg code is in `src/generator/ffmpeg.ts`. BUG FIXED: the render props were written before the voice stage, so narration never reached any render since step 4. Verified end to end on a draft 9:16 render: narration present in props (6 lines, gains set); mix measures -14.01 LUFS, true peak -1.56 dBTP; video stream unchanged. NOT verified: how it sounds (nothing played, by request); the duck curve by ear; real speech (the test used generated tones in the voice cache).
  - [ ] Milestone 1 review by the user
- [x] **Review before Phase 2** — DONE 2026-10-23 (`5f46bf9`): the default writer model was `beam` (first of the alphabetical list) — never silently picked now; library tags come from file names (a "whoosh" request used to return computer noises); beds always loop; 24 verified BigSoundBank entries (whooshes, thunder, rain, wind, street, traffic, birds, waves, insects, streams); a sword clip mislabelled "thunder" removed.
- [~] **Phase 2:** AI director pipeline + voice-first timeline (milestone 2)
  - [x] 1. Test harness (`npm test`, node:test) + schema: `spec.story`, caption word times, stat `scale` (`statScaleAt` sizes the world; eyesight still renders identically)
  - [x] 2. `pipeline/llm.ts`: per-role models (unassigned roles use the writer's), lenient JSON, normalize, repair loop, streaming Ollama, fixtures (`FACTORY_LLM_FIXTURES` replay, `FACTORY_LLM_RECORD` record)
  - [x] 3. `pipeline/writer.ts`: exact beat count, code-assigned ids b1..bN, alias-tolerant, revise call; words per beat come from the time a beat gets and the narrator's calibrated words/s (`wordsPerBeat`: 5–7 for a 25 s Short, 9–14 for a 60 s 16:9 at 2.3 words/s; it was a fixed 6–10 / 12–18, which made every video run long with Kitten)
  - [x] 4. `pipeline/voice.ts`: one TTS line per sentence; casting by gender/age (preset genders ASSUMED from names, labelled unverified); plan time uses calibrated estimates (`FACTORY_PLAN_TTS=1` synthesizes Kitten lines at plan time); the render always measures
  - [x] 5. `pipeline/timeline.ts` + `captions.ts`: voice-first beats, no overlap, frame-aligned, ±10% or one revise; phrase-aware caption chunks with word times
  - [x] 6. `pipeline/director.ts` + `assemble.ts`: worlds/devices by beat id; assembler does all timing; unshowable choices dropped with warnings
  - [x] 7. `pipeline/sound.ts`: rules baseline + LLM pass over a named-sound vocabulary
  - [x] 8. `pipeline/run.ts` + `reassemble` + CLI: stage files in `output/<id>/`; render re-times from the measured voice; old single-call prompt removed
  - [x] 9. Server + dashboard: per-role key checks, voice settings to plan jobs, stage pills, Story section with audition and recast
  - [x] 10. Review pass (code checks always; optional AI critic) + long-form (over 180 s) written act by act
  - [x] 11. Milestone 2 check on the dev laptop — DONE 2026-10-23: `npm run milestone -- --fixtures`, real Kitten voices, 9/9 pass (table below)
  - [ ] 12. On the user's machine: the same check with real Ollama models, and record their replies as fixtures (see Next step)
- [~] **Phase 3:** cinematic camera, transitions, look, photographer vision QA (milestone 3). Research first: [08-phase3-research.md](08-phase3-research.md) (4 parallel research passes).
  - [x] Layout per format: safe areas from the platforms' published zones, captions ~7.5% of the width on 9:16 with an outline, the hook fitted between whole words, and counter and timer cards scaled per shape (`src/generator/layout.ts`). Checked with stills in all three formats.
  - [x] Camera solver (`src/generator/camera/`). The director names a shot per beat (subject, size, angle, side, move, place, energy, style), and a pure closed-form solver places the camera. Tested by projecting through a real three.js camera.
  - [x] Shots in the plan: the director's shots (any wording), film-rule shots wherever none are given, the jump-cut guard, and a second shot for long beats (`pipeline/shots.ts`).
  - [x] Transitions: dip to black or white, flash, and whip as a camera turn plus blur, planned by rules (`pipeline/transitions.ts`, `TransitionOverlay.tsx`). Only one 3D scene is ever drawn.
  - [x] Rain fix: streaks were drawn to the world origin (`setXYZ` given an array offset). Now shader-driven and camera-relative.
  - [x] Photographer, first version: one still per shot, code checks (exposure, flat frame, colour), and yes/no vision questions when a Photographer model is chosen (`src/generator/qa/`, `scripts/photographer.ts`). The vision part is tested on fixtures only.
  - [~] Subject anchors in every stage (`ShotCamera`): street done and checked; the other six are wired up but not fully checked (09 §3.1).
  - [~] Look: built and wired in (`src/compositions/look/`); tuning is left (09 §3.3).
  - [ ] Night exposure floor: the photographer measured the night ocean at mean luma 0.09.
  - [ ] Milestone 3 check: stills per kit × shot size × format, then full renders compared with milestone 2.
  - Input: [07-milestone2-visual-review.md](07-milestone2-visual-review.md) — the milestone 2 frames reviewed: the camera doesn't frame the narrated subject, rain radiates from the horizon, props block the lens, night is too dark, captions and HUDs need per-aspect sizing.
- [~] **Phase 4:** editor + chunked fast re-render (milestone 4). About 55% done, paused 2026-10-23 to move laptops: status, files and the exact next steps are in [09-phase4.md](09-phase4.md). Not committed yet.
- [~] **Phase 5:** better worlds and characters (milestone 5). About 40% done. Status, how to run it on another machine, and the pending list are in [09-phase5.md](09-phase5.md).
  - [x] Research: characters/animation and deterministic atmosphere (two passes, findings in 09).
  - [x] `Actor` (`src/world/actors/`): director script schema, pure planner and `poseAt`, clip mapping across the four rig families on disk, stride-matched walking, seats, look/point/talk overlays, casting by role. Test plaza `ActorStage`. 10 tests pass. Checked in stills only.
  - [ ] Actors in world places (`cityAnchors`), the director prompt block, a video check.
  - [ ] Atmosphere: mood palette, particles, light shafts, sky and clouds, water, height fog.
  - [ ] River axis fix (coordinate with the Phase 3 camera work). The Interior camera bounds are left to Phase 3.
- [ ] **Phase 6:** one world and video quality (milestone 6). The engine base is built and tested in `src/world/` ([06-world-engine.md](06-world-engine.md)); step 1 (connect it to the director and the main composition) comes before Phase 3.

## Machine setup notes
- **Install:** `npm ci --legacy-peer-deps`. A plain `npm install` fails with an ERESOLVE error because `@types/react-dom@19.3.0` wants a newer `@types/react` than the pinned 19.2.7. Then run `cd ui && npm install`.
- **Baseline:** `npx tsc --noEmit` passes clean as of 2026-10-22.
- **3D assets:** `public/assets/` and `assets.catalog.json` are not in git. Run `npm run assets` (needs network) before previewing street or ocean scenes. Without them those stages can crash; see the GLB Suspense bug in [04-codebase-map.md](04-codebase-map.md).
- **Missing on the dev laptop:** no `.env` (the Ollama key), so no real model runs here. Real LLM runs need the Ollama Pro key in `.env` as `OLLAMA_API_KEY`. VoxCPM2 is not installed (no NVIDIA GPU); KittenTTS 2 is.
- **TTS:** install from the Setup tab (`.tts/<engine>/.venv`), or set `TTS_KITTEN_PYTHON` / `TTS_VOXCPM_PYTHON` to an existing Python with the engine. The installer needs internet once (it caches the models).
- **Post-processing dependency:** use `@react-three/postprocessing@3.0.4` (supports fiber ^9.0). Newer versions need fiber ≥9.7, but the project pins 9.2.0.

## Known limits (as of step 2)
- Offline template premises (gravity, sun-set, time-stop) need the 3D asset catalog: run `npm run assets` first. Without it they fail with "Asset violations".
- Offline templates ignore the requested target length (their length is fixed). The LLM path honours it.
- Landscape (16:9) renders correctly in size, but the camera framing was tuned for portrait. Fixing that is Phase 3.
- The writer's target length is a prompt instruction only. The timeline solver that enforces it is Phase 2.

## Review fixes (applied before step 5)
- Plan route validates settings before creating a job, so a bad request leaves no job behind (checked: /api/jobs is empty after a rejected request).
- `pickRoleModel` in `src/generator/ai/roles.ts`: a role's model is never sent to a different provider. Used by the writer and the plan route.
- VoxCPM preset ids map to their description, and a preset beats a stale description. `voxDescription` now lives in `src/generator/voices.ts`, used by the generator and the audition route. The UI no longer sends the old description.
- Voice cache moved from `public/voice/cache` to `.cache/voice`, so Remotion bundles stay small.
- `.gitignore`: `public/voice/`, `.cache/` and `/*.zip` are ignored. The tracked voice files stay tracked (7 files, not 3 as first noted).
- Settings: `targetDuration` must be 8s up to the format cap (90s, or 600s for 16:9). The schema, the UI (clamped before sending) and the CLI all enforce it. The CLI prints one line for bad flags.
- Checked: role cases 2a-2e, voice mapping 3a-3d, cache reuse with no Python 4a-4b, settings bounds 6a-6c, CLI errors, and that a bad plan request leaves no job.

## Not verified on this laptop (carry these forward)
- The sound of Kitten and VoxCPM (no engine installed here; nothing is played, by the user's request).
- Real GLB loading (the "file exists" path) needs `npm run assets`.
- Ocean is now lit once instead of twice, so it is darker. Retune `OCEAN_TOD` after a render with assets.
- The render cost of shadows has not been measured.
- The UI has not been opened in a browser.
- No real Ollama run (no key here).
- Landscape framing is still tuned for portrait (Phase 3).
- The family templates have fixed beat times, so long 16:9 targets fight them until Phase 2.

## Step 5 limits (carry these forward)
- Fonts are the three bundled ones (Inter, Archivo Black, Georgia serif), not the 12 planned. More fonts need a download step; the bundled set keeps renders identical on every machine.
- Word-by-word and karaoke timing are estimated: each caption's time is shared evenly across its words. Real word timings come with Phase 2 voice timing.
- Entry animations (pop, slide-up, word reveal) are not checked frame by frame. Stills only show the settled state.
- The caption preview in the dashboard has not been opened in a browser.

## Step 6 limits (carry these forward)
- The sound library is generated, not committed. A new machine rebuilds it with `npm run audio:library` (needs internet; ~200 MB).
- BigSoundBank has one curated entry (thunder, 0127). More need adding to `scripts/audio-library.bigsoundbank.json`. The script keeps a file only if its page says "Free and Royalty Free".
- 99 entries have a true peak above 0 dBTP. The source files are hot. Step 7 must set gain from the measured loudness and never rely on the raw files.
- `loopable` is not measured yet. Beds need a loop check or a crossfade in step 7.
- FreePD's licence rests on its own dedication, and the archive item has no licence field. Only the category folders are used, not the root (which holds at least one non-public-domain file).
- Nothing was listened to. The measurements are numbers, not a judgement of the sound.

## Step 7 limits (carry these forward)
- Only one ambience clip exists in the library (thunder). Most beds still fall back to the synthesized sounds in public/sfx. Adding more ambience to scripts/audio-library.bigsoundbank.json is the main fix.
- Background music is chosen by mood and seeded, not by listening. Check the picks on a real render.
- Word timing and per-character voices still come in Phase 2.
- Loops are played with the file's own loop; no crossfade at the loop point yet.
- Music picks are library tracks from FreePD only (see step 6 licence note).

## Phase 2 — how to test without a key
- `npm test` — the Phase 2 tests cover parse/normalize, the writer and its word budget, voice and per-engine calibration, timeline and the voice speed-up (target and format cap), captions, the assembler, the pipeline on fixtures, recast voices surviving approval, the review pass, long form and the video length.
- `npm run milestone -- --fixtures` — the milestone 2 check on hand-written replies: 3 premises × 3 formats, planned, rendered (draft) with real Kitten voices, and measured. Fixture sets: `test-fixtures/pipeline/<premise>` (25 s) and `<premise>-long` (60 s 16:9). `money-doubles` is over-long on purpose (it exercises the revise and the speed-up); the others keep to the writer's word budget.
- `FACTORY_LLM_FIXTURES=test-fixtures/pipeline/money-doubles npx tsx src/generator/generate.ts "What if money doubled every 3 seconds?" --no-render --duration 25 --audio-file test-fixtures/pipeline/money-doubles/audio.json` writes a full plan.
- The server also honours `FACTORY_LLM_FIXTURES` (it then skips the provider checks).

## Phase 2 limits (carry these forward)
- **Not run with a real model yet.** Every pipeline run so far used hand-written fixtures. Real models will produce different quirks; record them (Next step 3).
- **Plan-time voice durations are estimates** (words ÷ words-per-second, calibrated per engine from the voice cache; Kitten defaults to 2.3, measured here). The render synthesizes and measures every line and re-times the video from the real lengths, with no AI call.
- **Voice speed-up to fit (`fitTempo` in `timeline.ts`).** Where the writer can't be asked to cut words (the render, and a plan after its one revise), a voice more than 10% over the target is sped up by the smallest step that lands within 5% of it, at most 1.15× (ffmpeg `atempo`, pitch kept, made from the cached original so it never compounds). The warning says so; past 1.15× the video stays long and the warning says to shorten the story. Found by the first milestone run: Kitten's Bruno speaks 2.32 words/s, not the 2.6 assumed, so a 25 s plan rendered at 30 s.
- **Character voice genders are assumed from preset names.** Audition and recast in the Story section.
- **The dashboard was built but not opened in a browser** (stage pills, Story section, AI review switch).
- Recast runs in the server process; with Kitten installed it synthesizes the changed lines while the request waits.
- **Shot-by-shot camera (`shots[]`) is Phase 3**; the director currently picks worlds, time, weather, camera style and devices per scene.
- Counter values must be plain numbers under 10 digits; others are dropped with a warning (the HUD shows 1.05M style).

## KittenTTS 2 on the dev laptop (2026-10-23)
- **Installed** from the Setup tab: `.tts/kitten2/.venv`, Python 3.14, torch 2.14.1+cpu.
- **Installer bug fixed:** Kitten 2 also needs the `ResembleAI/chatterbox-turbo` decoder, which the installer did not download, so the first real synthesis failed offline (`LocalEntryNotFoundError`; `story-tts.py` sets `HF_HUB_OFFLINE=1`). The installer's verify step now speaks one line through `story-tts.py` with downloads allowed, which caches every file the engine needs.
- **Speed (CPU):** torch used half the threads by default. With all 12 (`use_all_cores()` in `story-tts.py`): about 30 s to load, then 40–50 s per line (was 140 s load, 100–165 s per line). A 9-word line came out at 4.1 s of speech.
- **Consequences:**
  - Plan-time synthesis is now opt-in (`FACTORY_PLAN_TTS=1`); a plan with 10 lines would otherwise take ~8 minutes. If synthesis fails at plan time, the plan goes ahead on estimates with a warning.
  - `synthesizeLines` runs Python asynchronously (60 min limit, was a 10 min blocking call), so the server keeps answering while voices are made.
  - `/api/voice-sample` (▶ audition) uses the same cache, so a sample is slow once and instant after. It used to time out after 120 s and return an empty error.
- **Nothing was played.** Durations and loudness are measured from the files.

## Milestone 2 result (2026-10-23, dev laptop, fixtures + real KittenTTS 2)
Checks per video: length within ±10% of the target, no overlapping speech, longest silence of 4 s or less (to the end of the MP4), at least 95% of caption words inside the line that says them, -14 ±1 LUFS, true peak of -1 dBTP or lower, 48 kHz, and no voice line left as an estimate.

| video | target | length | longest silence | caption sync | LUFS | true peak | voice speed | result |
|---|---|---|---|---|---|---|---|---|
| money-doubles 9:16 | 25 s | 26.4 s | 0.95 s | 100% | -14.2 | -1.4 | 1.15× | PASS |
| money-doubles 1:1 | 25 s | 26.4 s | 0.95 s | 100% | -14.2 | -1.3 | 1.15× | PASS |
| money-doubles 16:9 | 60 s | 60.0 s | 1.36 s | 100% | -14.1 | -1.3 | 1× | PASS |
| oceans-vanish 9:16 | 25 s | 26.0 s | 0.96 s | 100% | -14.1 | -1.2 | 1.13× | PASS |
| oceans-vanish 1:1 | 25 s | 26.0 s | 0.96 s | 100% | -14.1 | -1.3 | 1.13× | PASS |
| oceans-vanish 16:9 | 60 s | 60.5 s | 0.95 s | 100% | -14.5 | -1.1 | 1× | PASS |
| forest-walks 9:16 | 25 s | 26.1 s | 0.96 s | 100% | -14.1 | -1.3 | 1.13× | PASS |
| forest-walks 1:1 | 25 s | 26.1 s | 0.96 s | 100% | -14.1 | -1.4 | 1.13× | PASS |
| forest-walks 16:9 | 60 s | 62.6 s | 0.98 s | 100% | -14.1 | -1.3 | 1× | PASS |

No overlapping speech anywhere. Every rate is 48 kHz, and every line was measured. A 25 s Short took about 8 minutes of Kitten time the first time and about 3 minutes to render from the cache. The full matrix took about 40 minutes from a warm cache.

What this does NOT show:
- **How it sounds.** Nothing was played.
- **How real models behave.** The replies were hand-written. The 25 s Shorts still need a 1.13–1.15× voice speed-up even with the new word budget: the writer's fixed beat count plus the hook leave about 2.5 s of speech per beat. Watch this with real models. If they keep needing a speed-up, ask for fewer beats in Shorts.
- **Whether it looks good.** It does not, yet: see [07-milestone2-visual-review.md](07-milestone2-visual-review.md).

## Found by the milestone run (2026-10-23, fixed)
- **Videos ran 20% long with real voices.** Kitten speaks ~2.3–2.4 words/s, not the 2.6 assumed, and the writer's word budget was fixed. Fixed three ways: the writer's words per beat come from the time per beat and the calibrated voice speed; calibration is per engine (Kitten defaults to 2.3); the voice is sped up (at most 1.15×, pitch kept) where the writer can't be asked again.
- **2 s of dead air at the end of every planned video.** The render added a 2 s hold after the last scene (left from the template era) on top of the timeline's own closing tail. Planned videos now end where the timeline ends (`videoSeconds` in `spec.schema.ts`, used by the CLI and `Root.tsx`); the old templates keep their hold. The milestone script now measures length and silence from the MP4, not from the plan, so this can't hide again.
- **Mastering missed its targets on peaky mixes.** The pre-master mixes sit around -17 LUFS with peaks near full scale.
  - A single loudnorm pass aimed at -1 dBTP left -0.8 dBTP after the AAC encode.
  - Aiming at -1.5 pushed those mixes into loudnorm's dynamic mode, which landed at -16.7 LUFS.
  - A plain gain trim afterwards cost too much loudness (-15.3 LUFS).
  - New chain in `audio-master.ts` (Remotion's ffmpeg has loudnorm but no limiter):
    1. Take the mix out as lossless 24-bit WAV.
    2. Repeat the two-pass loudnorm (at most 3 rounds) until it is within 0.3 LU of -14 with peaks at or below -1.5 dBTP.
    3. Encode AAC once, with the picture copied.
    4. Trim any encoder overshoot above -1 dBTP with measured gain.
  - The hard case (money 16:9) went from -17.3 to -14.1 LUFS with a -1.3 dBTP peak.
- **The 3D model packs were never downloaded on the dev laptop** (`public/assets` was missing), so every render here used stand-in shapes. `npm run assets` was run (1,077 models, 166 MB). Poly Pizza page lookups time out now and then; a timed-out model is left out of `assets.catalog.json` (its file stays on disk). Don't commit `src/compositions/assetIndex.generated.ts` after a run with timeouts; re-run `npm run assets` or keep the committed one.
- **Code review of the Phase 2 changes** (a second pass, read-only) found, and these were fixed:
  - A character recast in the review lost its voice at render, because the approval sends voice settings without per-character choices. `mergeAudio` in `run.ts` keeps them unless the character engine changed.
  - Two auditions at once shared one job file, and a double click could cache a half-written WAV. Each sample now gets its own job folder, a second request for the same sample waits for the first, and samples are served from the cache instead of being copied into `public/` (which every render bundles). Checked: two different auditions at once both return their WAV.
  - A synthesis timeout threw away every finished line. Each line is now cached the moment the engine reports it, and the time limit grows with the line count (3 min per line, at least 30).
  - The speed-up ignored the format's cap: a 90 s Short whose voice ran 95 s failed instead of speeding up 1.06×. It now also fits under the cap.
  - A failed AI-critic pass left a half-applied plan (the new story with the old check's failure). Now the notes are kept only when the re-timed story still fits.
- **Remotion's bundled ffmpeg is a minimal build**: no `fps`, `tile` or `select` filters (it has `atempo`, `scale`, `trim`, `loudnorm`). The milestone saves 4 separate frames per video instead of a contact sheet.

## Session log
- **2026-10-23 (later, ported to the original machine):** all parallel-session work committed in logical chunks (docs, Phase 1–3 code, Phase 4 code, world engine, cleanup). Found and fixed on this machine:
  - **The CLI never loaded `.env`** (`resolveModel`/`llm.ts` read the key from `process.env`; only the server applied `.env`), so a real-keyed machine silently fell back to an offline template for matching premises — the thing the "never silently" rule forbids. Fixed: `.env` is applied once in the pipeline (`src/generator/env.ts`, loaded from `pipeline/llm.ts`), without overriding variables already set. The money premise indeed fell back to `escalation-street-15s` before the fix; after it, the first real pipeline plan ran (writer 21.7s–45.9s, director ~200s, sound ~50s with `glm-5.3`).
  - **A bare CLI plan had voice settings off** (`planLines` needs `narration.enabled`, the dashboard and the milestone script set it, the CLI didn't) — every beat warned "no spoken line". Fixed in `generateSpec`: when a caller passes neither narration nor dialogs, narration defaults to the dashboard's default (kitten2, Bruno).
  - **KittenTTS 2's `hf download` had left the snapshot incomplete** (234 files missing; the engine was marked installed after pip but synthesis failed offline). Completed the snapshot with `hf download KittenML/kitten-tts-2` (the repo is ~12 GB on disk, not the 950 MB the Setup tab labels); a sample line then synthesized in 47.5 s (matches the CPU profile) and VoxCPM2 produced a 4.32 s sample on this machine's GPU. Both engines are now verified to synthesize here (sound quality still to be judged by the user on the milestone videos).
  - Model roles: writer = `ollama/glm-5.3` (deliberate choice: strongest structured-JSON behaviour of the available Ollama models; director/sound/critic inherit it). quirk seen: the director's counter step `"0"` was dropped by the validator once (documented behaviour, watch in the milestone).
- **2026-10-23 (later):** Kitten installed on the dev laptop; milestone 2 check built and run with real voices, 9/9 pass after the fixes listed under "Found by the milestone run"; a read-only code review of the changes and a frame review (07). Another chat started the world engine (06) in the same tree; its files were left alone and not committed here.
- **2026-10-23:** review of steps 5–7; review fixes; Phase 2 steps 1–10. Found and fixed during Phase 2: counter values like "10^30" were mangled into 1030; captions split phrases across commas; the mastered audio came out at 96 kHz; long counter numbers overflowed the HUD card.
- **2026-10-22 (step 4):** voice switches, audition, Python resolver, VoxCPM descriptions, Kitten tuning, cache. Found and fixed: the narrator was reading character lines too when both were on.
- **2026-10-22 (step 3):** model roles API, config, Providers card; README got setup and usage instructions (new-machine setup, dashboard and CLI workflow, output files, known limits, model roles).
- **2026-10-22 (step 2):** settings schema, validator, writer prompt, generator flags, server route, Step 1 UI panel, composition size from the spec. Also fixed the failure logger, which crashed on a fresh checkout (no `output/` folder) and hid the real error.
- **2026-10-22 (later):** Phase 1 step 1 applied. Verified with stills: river (deterministic: two renders give identical hashes; matches the pre-change look), ocean and street (both used to crash on missing GLB files, now render). Mountain ridge fixed and checked with a countryside still. Dead story-job code removed. Found that React error boundaries do not catch GLTF load failures in the Remotion render, which is why `glb.tsx` now checks the file first.
- **2026-10-22:** full analysis of the repo. Researched CC0 audio sources and prior art. Mapped the 3D stages and the UI/server. The user chose the direction (see [decisions.md](decisions.md)), and the phased plan was written. Implementation started later the same day (see the entry below).
