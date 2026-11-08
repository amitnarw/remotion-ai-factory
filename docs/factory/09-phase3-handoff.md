# 09 — Phase 3: cinematic camera, transitions, look, photographer (status, 2026-10-27)

Phase 3 makes the videos cinematic: a camera that frames what the story is about, transitions, a colour grade, captions and HUD that fit each format, and a "photographer" that checks every shot.

**Status: about 95% done.**
- Everything below is built, wired into the real render path and tested.
- The work started on the dev laptop (2026-10-23) and was finished in parallel "lanes" on the GPU machine (2026-10-24); the camera bounds, the reference HUD and the milestone 3 check followed on 2026-10-26/27.
- Left: the user's review of milestone 3, and calibrating the vision checks with a real model.

Related docs:
- Research and design: [08-phase3-research.md](08-phase3-research.md)
- The problems Phase 3 answers: [07-milestone2-visual-review.md](07-milestone2-visual-review.md)

## 1. Done

| Part | Where | Checked how |
|---|---|---|
| **Layout per format.** Safe areas from the Shorts, TikTok and Reels published zones. Captions are sized per format with an outline or soft shadow. The hook fits between whole words, and HUD cards are scaled per format and placed in the safe area. | `src/generator/layout.ts`, `src/compositions/hud/*` | Unit tests; stills in all 3 formats |
| **Camera solver.** The director names a shot per beat: subject, size ECU..EWS, angle, side, move, place, energy, style. A pure, closed-form solver places the camera every frame. Subjects can carry `bounds`, `focus` and `ground`. | `src/generator/camera/{shot,solve,subjects}.ts` | Tests that project the subject through a real three.js camera, for every size × format × placement |
| **ShotCamera in all 7 stages,** plus world scenes (lane A). The world's anchors become solver subjects, and `WorldStage` solves `spec.shots`. | `src/compositions/camera/ShotCamera.tsx`, the anchors in each `*Stage.tsx`, `src/generator/camera/world.ts` | A photographer sweep over 10 kits (`out/qa/laneA/`) with no flags left after the fixes below |
| **Shots in the plan.** The director's shots are read in any wording. Beats without one get film-rule shots. A jump-cut guard applies, and long beats get a second shot. | `src/generator/pipeline/shots.ts`, `director.ts`, `assemble.ts` | Tests; real-model plans (milestone 2, 2026-10-24) carry directed shots |
| **Transitions.** Into or out of space, or day ↔ night: dip to black. A new place: whip pan. Same place with new weather: dip to white. World events: flash. **A flight between world places is its own transition**, with no dip and no cut whoosh, and it starts and ends on shot edges where it can (a shot start 2-6 s before the cut, a shot end 2-5 s after it), so it takes whole shots instead of leaving a stub of one (2026-10-26). In a video the flight shows no place or sun labels (the world previews keep them), and the captions get a dark glow while its cloud veil turns the frame white. | `pipeline/transitions.ts`, `src/compositions/TransitionOverlay.tsx` | Tests; seen in full renders (2026-10-26) |
| **Look (colour grade).** Bloom, tone mapping, a custom grade with seeded grain, and vignette. Presets by time of day and story mood. Applied to flights too (2026-10-26). | `src/compositions/look/`, `src/generator/look-choice.ts` | Look tests; byte-identical renders |
| **Night exposure.** Ocean, countryside, river and interior nights lifted (the moon is now a raking light). The interior got a real light rig and `ROOM_BOUNDS`. | the stage files | Stills in `out/qa/phase3-lane/` |
| **Forest wash-out removed.** Twelve stacked mist planes were replaced by `FogExp2`. | `ForestStage.tsx` | Stills |
| **Rain.** Streaks were drawn to the world origin (`setXYZ` given an array offset). Rain is now shader-driven and camera-relative. | `src/compositions/weather.tsx` | Before/after stills |
| **Photographer.** One draft still per shot, checked by code: exposure with day, night, space, dark and indoor limits; flat frame; washed-out colour. With a "Photographer (vision)" model chosen, neutral yes/no questions are added that never reveal the story. Space limits were calibrated on measured frames; the "dark" limits (after a lights-out event the world is dark on purpose, only a frame showing almost nothing fails) on the 2026-10-26 milestone. In a storm a still never lands on a lightning flash (`src/compositions/lightning.ts` is shared with the storm overlay). | `src/generator/qa/*`, `scripts/photographer.ts` (`npm run photographer -- <id>`) | Tests; real sweeps. The vision part is tested on fixtures only. |
| **Typography (Phase 7 step 1).** The default caption preset is "reference": serif italic with a soft shadow, and the hook keyword in gold. 13 bundled fonts. | `src/generator/caption-style.ts`, `src/compositions/hud/fonts.ts` | Stills |
| **The counter's pulse/BPM row (Phase 7 step 2).** Shown only when the director sets a bpm; no invented values. | `StatHud.tsx`, `director.ts`, `assemble.ts` | Tests |

**Fixed on 2026-10-26 (all-phase check):**
- Every CLI render had lost `public/`: `setPublicDir` used `__dirname`, which points inside `node_modules` when the CLI loads the config.
- Six font file names were wrong.
- A cut from the street or space into a world place crashed on the fog.
- The milestone and photographer scripts read the old flat output paths.

## 2. Left to do

1. ~~**Camera bounds for the street and the forest.**~~ DONE 2026-10-26 (and the river):
   - `solve.ts` bounds gained `openAbove`: a shot whose camera, at rest, stands above the tallest roof or treetop is over the set and the x/z limits don't apply (decided before the move, so a crane never jumps mid-shot).
   - Street (`StreetStage.tsx`, measured `FOOTPRINT` table, `streetCorridor`/`streetBounds`): the road between the curbs is x ±4.4; building fronts measured per slot from the GLB boxes, 0.5 m kept off them; a sidewalk subject opens its side (to -6.0 / 8.4); openAbove = tallest building + 2 m. Moving subjects get walls over their whole run of shots.
   - Forest (`ForestStage.tsx`, `clearingBounds`): a clear box round each subject (free of trunks, crowns, rocks, logs + 0.6 m); openAbove = tallest treetop within 120 m + 1 m.
   - Result on 342 rendered shots (171 per frame shape, street/forest/river, 9:16 and 16:9): lens inside geometry 15 to 2; near-uniform frames 6 to 1; grid sweep lens-inside: street 11,705 to 630, forest 449 to 0, river 122 to 23. Stills: `out/agentCAM-stills/` (`sheet-*`, `pair-*`). Tests: `solve.test.ts` (+2), `stage-bounds.test.ts` (5).
   - Those leftovers were fixed on 2026-10-27, in item 5 below: the street layout depth, traffic through a low lens, the café parasol, the forest crown and the sight line.
2. **Milestone 3 check — DONE 2026-10-27 on the dev laptop (fixtures, real Kitten voices), 9/9 PASS; the user's review closes the phase.**
   - `npm run milestone -- --fixtures --qa` (24 min). Results: `output/milestone/report.md`, the stills in `output/milestone/<id>-qa/`; the milestone 2 run is kept in `output/milestone2-baseline/` for the comparison.
   | video | length | LUFS | true peak | shots flagged | result |
   |---|---|---|---|---|---|
   | money-doubles 9:16 | 26.4 s | -14.2 | -1.3 | 0/8 | PASS |
   | money-doubles 1:1 | 26.4 s | -14.2 | -1.4 | 0/8 | PASS |
   | money-doubles 16:9 | 60.0 s | -14.1 | -1.6 | 0/19 | PASS |
   | oceans-vanish 9:16 | 26.0 s | -14.1 | -1.4 | 0/9 | PASS |
   | oceans-vanish 1:1 | 26.0 s | -14.0 | -1.4 | 0/9 | PASS |
   | oceans-vanish 16:9 | 60.5 s | -14.1 | -1.3 | 1/17 | PASS |
   | forest-walks 9:16 | 26.1 s | -14.0 | -1.3 | 0/8 | PASS |
   | forest-walks 1:1 | 26.1 s | -14.0 | -1.4 | 0/8 | PASS |
   | forest-walks 16:9 | 62.6 s | -14.1 | -1.2 | 2/17 | PASS |
   - Against milestone 2: the rain falls instead of radiating from the horizon, nights read as dark blue with silhouettes instead of black, the captions and HUD are the reference style, framing follows the director's shots.
   - The first run found, and these were fixed before the run above: money 16:9 mastered to -16.7 LUFS (the AAC encode overshot the peak ceiling and plain gain took the loudness; now the WAV is mastered again with the overshoot as headroom: `audio-master.ts`); a lights-out event dimmed the moon to 4% but left the village windows lit (now windows and street lamps go out with it, and the director's prompt says what the event does); the photographer flagged intended blackout darkness (new "dark" limits) and judged one storm shot on its lightning-flash frame (now it steps off the flash). Shots flagged: 16 to 3 of 103.
   - The 3 left: a forest tree ECU at 0.140 (day floor 0.15) and a night canoe FS at exactly the 0.100 floor, both borderline and readable; a hills CU in the blackout at 0.014, which really shows almost nothing (the director's CU choice in total darkness).
3. **With the Ollama key:**
   - Choose a Photographer (vision) model in Settings → AI models. The research suggests `gemma4:31b` on the cloud; check it's in your list.
   - Run `npm run photographer -- <id>` on a few videos, check the yes/no answers against what you see, and calibrate the thresholds on about 50 stills.
4. ~~**Reference HUD style (Phase 7)**~~ DONE 2026-10-26: with the "reference" and "documentary" caption looks the counter and timer are text over the picture (a spaced-capitals label, a large Playfair value, a gold fact line, the EKG as a thin line), mid-left, clear of the captions in every format, with the captions' glow over a flight's white veil; the hook moves up so both show together. The other looks keep the cards (`resolveHudStyle` in `caption-style.ts`, `textHudPlacement`/`hudStack`/`textHudMeetsHook` in `layout.ts`, tests in `src/generator/hud-layout.test.ts`).
5. ~~**Sight lines (occlusion)**~~ DONE 2026-10-27, with the street layout depth and the traffic lanes:
   - `src/generator/camera/occlusion.ts` (new, pure): blocker shapes (column with an optional bottom, ball, box), inside tests and where a segment first enters one. `Subject` gains `blockers`, `own` (the subject's own parts: looked through, never stood in) and `keepOut` (places the lens must not stand in); `SolveOptions` gains `rest` and `ends`.
   - `solve.ts`: a subject with blockers is judged at the rest pose plus the ends of the move and of a moving subject. A blocked shot tries 25 detours in a fixed order (turns of 15 to 180 degrees, front first; lifts of 12 to 40 degrees; closer x0.7 and x0.5) and keeps the first clear one, or the least bad. The choice is made once per shot (about 0.05 ms a frame). With no detour the camera is bit-identical to before.
   - Forest: trunks, crowns, rocks and logs are blockers; the subject's own tree is its own part. River: rocks and the waterfall sheet. Street (`streetBlockers`): building boxes, awnings, café parasols, trees, lamp posts, traffic lights, parked cars; each traffic lane is a keep-out box over the cars' whole loop (a car passes any point about every 4 s, so a time check would rarely allow a low lens anyway).
   - Street layout: `BuildingSlots` sets a building back until its front is behind the sidewalk (|x| >= 9.1, `SIDEWALK_BACK`); every model, height, place and tint stays. 493 of 500 layouts change (set-back 1.3 m median, 3.8 m p90). Fronts in the road 138 to 0, on the sidewalk 493 to 0, a walker's path inside a building 307 to 0. The awnings and the lit night windows now hang on each building's own front (`layout.fronts`); they stood on fixed lines and floated or sat inside the set-back buildings.
   - Traffic lanes moved from x +/-2.25 to +/-1.3 (`LANE_X`): every passing car used to drive 0.7-0.9 m through the parked cars at +/-3.55.
   - Grid sweep (HEAD vs now): lens inside geometry street 19,340 to 0, forest 393 to 6, river 26 to 0; blocked sight lines street 7,873 to 4,667, forest 1,433 to 215, river 474 to 55; a car through the lens 27,361 to 72 (none in rendered frames). The last pass's 342 rendered shots: lens inside 7 to 0, blocked 3 to 0, a car through the lens 13 to 0; the lens moved in 73 of them.
   - Tests: `occlusion.test.ts` (6), `sightlines.test.ts` (9: forest grid, forest known cases, river, café, traffic, parked cars, 500 layouts, the awnings, the footprint table against the GLBs). Stills: `out/agentCAM2-stills/` (sheets and pairs), `out/street-fix/sheet.png` (day and night after the lane and window fixes).
   - **The other stages** (2026-10-28): `src/generator/camera/shapes.ts` turns rotated props into blockers (turned boxes for houses, barn, canoes, coffee table; four-sided roofs; the windmill's blade sweep), each covering its prop within 0.75 m. Countryside: houses, roofs, chimneys, barn, windmill tower, haystacks, fences and the ridge sheets as blockers; the blade sweep and everything behind the ridge's front sheet as keep-outs. Ocean: the jetty from the water to its deck, parasol canopies (keep-out underneath), the sand, canoes and buoy over their whole bob. Interior: walls, window, tables (keep-out underneath), sofa, lamp and cast; the furniture placement is one constant shared by the drawing and the camera. Sweep against the drawn meshes, lens inside geometry: countryside 14,892 to 0, ocean 1,506 to 0, interior 5,988 to 0; hard blocked lines: countryside 3,761 to 44, ocean 3,926 to 0, interior 4,591 to 0. All 51 director's shots in the milestone and Paris props solve to the same pose as before. Tests: `shapes.test.ts` (3), `stage-sightlines.test.ts` (7). Sheets: `out/agentCAM3-stills/`.
   - **The plaza market is not attached as blockers yet:** any blocker switches on the detour search, which penalises a lens inside the subject's radius, and the plaza spots' radius is their 9 m reach, not a body; attached, 30-67% of plaza poses moved (the fountain MS jumped to 9 m high). The fix is a `Subject` flag in `solve.ts` so area subjects skip that rule. Today the market keeps lenses out by bounds and height (tested); 12 of 1,800 Colmar plaza-east/west FS sight lines pass over a stall roof.
   - Still imperfect: a pulled-in shot is accepted up to 1.5x its size's fill, so the 9:16 path EWS left34 frames more like an FS and the tree's back WS like an MS; the café CU from the back still has the canopy across the top two-thirds, and its MS from the back has the pole mid-frame (the subject's centre is the pole); most street blocked lines left are a walker against a street-tree crown (walkers at x -5.3 to -6.4 pass under crowns reaching -6.25); moving cars are not sight blockers and a low lens keeps only 0.3 m from a lane (the 16:9 traffic MS front-low still looks like a near miss); the countryside keeps 44 hard blocks where no detour is clear (haystack, house and fence edges) and its side-on hills shots show the cut-out ridge edge-on; the ocean scene EWS "right" detour goes high with a parasol at the bottom; the interior is cramped and flat-lit; the solver tests lines to the subject only, not what fills the frame's sides. Seen, not fixed: the fence rails are one-sided panels, the floor lamp stands inside the sofa's footprint, the window floats 1 m in front of the back wall.
6. **Later (v2):**
   - Ambient occlusion and depth of field in the grade.
   - Dissolves (they need two 3D scenes at once).
   - Light leaks.

## 3. Commands

```bash
# A plan with directed shots, from fixtures (no key; plan only)
FACTORY_LLM_FIXTURES=test-fixtures/pipeline/oceans-vanish npx tsx src/generator/generate.ts "What if the oceans vanished for 10 seconds?" --no-render --format 9:16 --duration 25 --audio-file test-fixtures/pipeline/oceans-vanish/audio.json

# Render an approved plan (the dashboard does the same); --chunked for the fast re-render path
npx tsx src/generator/generate.ts --from-spec output/<id>/spec.json --audio-file <audio.json>

# Stills: bundle once, then render frames (frame = seconds × 30)
npx remotion bundle src/index.ts --out-dir out/phase3-bundle
npx remotion still out/phase3-bundle WhatIfVideo out/phase3-stills/x.png --props output/<id>/props.json --frame 300 --scale 0.5 --gl=angle

# Photographer: one still per shot, checked by code (+ vision questions if a Photographer model is chosen)
npm run photographer -- <id> --bundle out/phase3-bundle

# Full milestone check with photographer results
npm run milestone -- --fixtures --qa
```

Outputs are per video: `output/<id>/` holds `spec.json`, `props.json`, `video.mp4`, `report.json` and the stage files. Never play audio on the dev laptop; every check measures files.
