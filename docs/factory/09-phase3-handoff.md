# 09 — Phase 3 handoff: what's done, what's left, how to continue (2026-10-23)

Phase 3 makes the videos cinematic: a camera that frames what the story is about, transitions, a colour grade, captions and HUD that fit each format, and a "photographer" that checks every shot. It was stopped on the dev laptop at about **65%** so it can continue on another machine.

- Research and design: [08-phase3-research.md](08-phase3-research.md)
- The problems Phase 3 answers: [07-milestone2-visual-review.md](07-milestone2-visual-review.md)

## 1. Set up the other laptop
1. Get the code from the bundle (`git pull <path>\factory.bundle main`, or `git clone factory.bundle`) or copy the folder.
   - The bundle holds only committed work. Two other chats work in the same folder: the world engine (`src/world/`, Phase 5) and the editor (Phase 4). Their uncommitted files come only with a folder copy.
2. `npm ci --legacy-peer-deps`, then `cd ui && npm install && cd ..`. This installs the two new look packages, pinned exactly: `@react-three/postprocessing@3.0.4` and `postprocessing@6.39.5`.
3. `npm run audio:library` and `npm run assets`. Both need internet; neither is in git.
   - `npm run assets` sometimes times out on a few Poly Pizza pages. Run it again.
   - Don't commit `src/compositions/assetIndex.generated.ts` after a run that had timeouts.
4. KittenTTS 2: install it from the dashboard's Setup tab. Renders synthesize every voice line. The voice cache (`.cache/voice`) isn't in git, so the first render of each video is slow on a CPU (about 40–50 s per line).
5. Check everything works:
   - `npx tsc --noEmit` should be clean.
   - `npm test` should pass all 200 tests (Phase 3's are in `src/generator/{camera,qa}/*.test.ts`, `layout.test.ts`, `pipeline/{shots,transitions}.test.ts`).

## 2. Done

| Part | Where | Checked how |
|---|---|---|
| **Layout per format.** Safe areas from the Shorts, TikTok and Reels published zones. 9:16 captions are 7.5% of the width with a dark outline, and "bottom" sits at 58% of the height. The hook is fitted between whole words: the old word spans had no spaces, so the browser split words, which was the "hook overflows" bug. Counter and timer cards are scaled per format and placed in the safe area. | `src/generator/layout.ts`, `src/compositions/hud/{Captions,Hook,TimerHUD,StatHud}.tsx` | Unit tests; stills in all 3 formats |
| **Camera solver.** The director names a shot per beat: subject, size ECU..EWS, angle, side, move, place, energy, style. A pure, closed-form solver places the camera for every frame (lens to field of view, distance from size, horizon, thirds, moves, dolly zoom, seeded handheld shake). Subjects can carry `bounds` (the camera is pulled in along its line of sight instead of leaving them) and `focus: "centre"` for props. | `src/generator/camera/{shot,solve,subjects}.ts` | 13 tests that project the subject through a real three.js camera, for every size × format × placement |
| **ShotCamera in all 7 stages.** While a shot is active, the solved camera films. With no shots, the old rig runs unchanged. | `src/compositions/camera/ShotCamera.tsx`; anchors in each `*Stage.tsx` | **Street: fully checked** (stills of every subject in 3 formats; no camera inside a building). Ocean, space, forest, countryside, river, interior: wired up and compiling, **not fully checked** (see §3.1). |
| **Shots in the plan.** The director's shots are read whatever the wording ("close-up", "B3", "beat 4", "three quarter"). Beats without one get film-rule shots: a new place opens wide; quick beats are tight and handheld; lingering ones wide and calm; the subject comes from the beat's "see" line. A jump-cut guard applies, and beats over 5 s get a second shot. | `src/generator/pipeline/shots.ts`, `director.ts` (prompt and schema), `assemble.ts` | Tests; a fixture plan with directed shots (`test-fixtures/pipeline/oceans-vanish/director-1.txt`) |
| **Transitions.** Into or out of space, or day ↔ night: dip to black. A new place: whip pan (a camera turn through the cut plus blur). Same place with new weather: dip to white. World events (water returns, lights out): flash. Only one 3D scene is drawn at a time. | `src/generator/pipeline/transitions.ts`, `src/compositions/TransitionOverlay.tsx` | Tests. **Not yet seen in a full render.** |
| **Look (colour grade).** Bloom, then tone mapping (ACES / AgX / Neutral), SMAA, a custom grade (white balance, contrast, saturation, split-tone, seeded grain), and vignette. Presets: golden-hour, night-moonlight, overcast-documentary, epic-teal-orange, dreamy-pastel, neutral. Chosen per scene by time of day and story mood. Byte-deterministic. The old HTML grain and vignette were removed. | `src/compositions/look/`, `src/generator/look-choice.ts`, wired into `WhatIfVideo/index.tsx` | Look tests; preset stills; renders are byte-identical twice. **Needs tuning** (§3.3). |
| **Rain.** Every streak was drawn to the world origin (`setXYZ` was given an array offset, not a vertex index). Rain is now shader-driven, camera-relative and pure per frame. | `src/compositions/weather.tsx` | Before/after stills in `out/rain-stills/` |
| **Street hero props** sank into the 0.18 m sidewalk. They now stand on it. | `StreetStage.tsx` `HeroProps` | Not re-rendered yet |
| **Photographer, first version.** One draft still per shot, checked by code: exposure with day, night and space limits; one flat colour filling the frame; washed-out colour. With a "Photographer (vision)" model chosen, every still also gets neutral yes/no questions that never reveal the story. | `src/generator/qa/{png,metrics,photographer,vision}.ts`, `scripts/photographer.ts`, `llm.ts` (images for Ollama) | Tests; a run on a real plan (9 shots, 2 min). The vision part is tested with fixtures only (no key here). |
| **Milestone script.** `--qa` adds photographer results per video, and length is measured from the MP4. | `scripts/milestone.ts` | Type-checked |

## 3. Left to do (in this order)

### 3.1 Check the six stages the agents didn't finish (about 1 h)
The agents were stopped while checking. For each of ocean, space, forest, countryside, river and interior:
1. Copy a milestone props file (`output/milestone-<premise>-<format>-props.json`). For river and interior, change one scene's `kit`.
2. Add a `spec.shots` list covering every subject name in `src/generator/camera/subjects.ts` for that kit, with varied size, angle, side and move.
3. Render stills at mid-shot frames (§4) and look at each one. Is the subject framed as asked? Is anything blocking the lens? Is the camera never inside geometry or under water?

Notes the agents left:
- **Ocean:** the beach shot looked low after the solver's eye-level change and the new grade landed at the same time. Re-check it.
- **Interior:** the room renders black without extra lights. The stage needs real lighting; a temporary debug light was removed again.

### 3.2 Give each stage's anchors `bounds` (about 30 min)
The solver supports `bounds` now, but no stage passes it yet. Without it, wide shots from a three-quarter side can land inside the street's shop rows (reported by the street agent), inside forest trees, or outside the room.
- Street: the corridor between the building rows, roughly x ±4.5 (measure it from `BuildingSlots`).
- Interior: the room box.
- Forest: a clearing around the path.

### 3.3 Fix the look problems seen in stills (about 45 min)
1. **Black frame.** forest-walks 9:16 frame 480 (the countryside overcast rain scene) rendered completely black with the look on; only the captions drew. It was rendered while the countryside stage was being edited, so first render it again. If it's still black, turn off `<CinematicLook>` in `WhatIfVideo/index.tsx` to see whether the stage or the grade is at fault.
2. **Washed-out forest.** The golden forest is a washed-out sepia with ghosted, stacked translucent layers (07 review #6). Replace the stacked fog planes in `ForestStage.tsx` with exponential scene fog.
3. **Sky colours.** Tone mapping shifts them (ACES lightens the dusk salmon to pale yellow). Retune the stage sky colours, or give daytime presets Neutral tone mapping.
4. **Grain and file size.** Per-frame grain makes MP4s much larger (the look agent measured about 60×). It's set to 0.3 × the preset. Check the size of a full render and set `grain` lower, or to 0 for drafts.

### 3.4 Your decision: the PULSE / BPM row on the counter card
The counter card ("YOUR MONEY 1× → 2×") is shown only when the director uses a counter. Its pulse/BPM row is left over from the "eyesight" template.
- My recommendation: drop the row by default and keep it only for stories about the body.
- Also add a switch in Video settings to turn the card off.

**Not changed yet; waiting for your call.** The code is in `src/compositions/hud/StatHud.tsx`, and the heartbeat sound ladder is in `pipeline/sound.ts` and `assemble.ts`.

### 3.5 Milestone 3 check (about 1.5 h, mostly rendering)
1. Run `npm run milestone -- --fixtures --qa`. It renders 9 videos with shots, transitions and the look, plus one photographer still per shot.
2. Read `output/milestone/report.md` (all Phase 2 checks must still pass) and the per-shot stills in `output/milestone/<id>-qa/`.
3. Compare them with the milestone 2 frames listed in `07-milestone2-visual-review.md`. Does each beat now show its subject, with clean rain, readable nights and safe captions?
4. Fix what's wrong, then write `10-milestone3-review.md` the same way as 07.

### 3.6 With the Ollama key (any time)
1. Providers → Model roles: choose a **Photographer (vision)** model. The research suggests `gemma4:31b` on the cloud; check that it's in your list.
2. Run `npx tsx scripts/photographer.ts <id>` on a few videos. Check that the yes/no answers match what you see, then calibrate the thresholds on about 50 stills.
3. Run a plan with real models and check the director's `shots`. Record them with `FACTORY_LLM_RECORD=test-fixtures/pipeline/<name>`.

### 3.7 Later (Phase 3 v2)
- Occlusion test by raycast (move the camera when a prop blocks the subject).
- Ambient occlusion and depth of field in the grade (skipped for iGPU cost).
- Dissolves (they need two 3D scenes at once).
- Light leaks.

## 4. Commands

```bash
# A plan with directed shots, from fixtures (no key; plan only, no render)
FACTORY_LLM_FIXTURES=test-fixtures/pipeline/oceans-vanish npx tsx src/generator/generate.ts "What if the oceans vanished for 10 seconds?" --no-render --format 9:16 --duration 25 --audio-file test-fixtures/pipeline/oceans-vanish/audio.json

# Stills: bundle once, then render frames (frame = seconds × 30)
npx remotion bundle src/index.ts --out-dir out/phase3-bundle
npx remotion still out/phase3-bundle WhatIfVideo out/phase3-stills/x.png --props output/<id>-props.json --frame 300 --scale 0.5 --gl=angle

# Photographer: one still per shot, checked by code (+ vision questions if a Photographer model is chosen)
npx tsx scripts/photographer.ts <id> --bundle out/phase3-bundle

# Full milestone check with photographer results
npm run milestone -- --fixtures --qa
```

Never play audio on the dev laptop. All checks measure files.

## 5. Working alongside the other chats
- **World engine chat:** `src/world/`, `scripts/*world*`, `06-world-engine.md`, `decisions.md`.
- **Phase 4 chat** (editor and chunked render): `src/generator/{render,film}/`, `pipeline/editor.ts`, `server/film.ts`, `ui/src/pages/editor/`, `WhatIfAudio.tsx`, `Root.tsx`, `server/index.ts`, `ui/`.
  - It renders into its own `out/phase4-bundle`.
  - It reads the shot schema (`SpecShotSchema`, `SHOT_*` enums, `subjectsFor`) for its Inspector, so keep those names stable.
- **Phase 3 owns:**
  - `src/compositions/*Stage.tsx`, `WhatIfVideo/index.tsx`, `hud/`, `look/`, `camera/`, `TransitionOverlay.tsx`, `weather.tsx`;
  - `src/generator/{camera,qa}/`, `layout.ts`, `look-choice.ts`, `caption-style.ts`, `spec.schema.ts`, `llm.ts`;
  - `pipeline/{shots,transitions,director,assemble}.ts`, `scripts/{milestone,photographer}.ts`.
- `generate.ts` bundles into the shared `out/render-bundle` (about 900 MB). Don't run two renders at once.
