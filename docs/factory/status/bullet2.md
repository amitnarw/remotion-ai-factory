Done (2026-11-05).

# bullet2: the bullet-time test video, the hold's flipping pixels, the photographer's notes

## Task
1. Render the whole bullet-time test video end to end from `test-fixtures/pipeline/bullet-test/` (9:16, about 38 s, draft then final), look at it (a sheet of every second, the window's frames), measure its sound (loudness, true peak, the `bt-*.wav` files, voices against music). Sheets in `out/agentBULLET/test-video/`.
2. The open point in [14-bullet-time.md](../14-bullet-time.md) Status: 2 pixels flip in 1-2 of 30 hold frames. Find and fix; proof: the hold frames at concurrency 2 and 6 and in reverse, byte-identical.
3. The photographer's notes for the window (risk 11), in `src/generator/qa/photographer.ts`. The critic's note waits (another owner's file).

Files owned: `src/world/warp.ts`, `projectiles.ts`, `ProjectilesLayer.tsx`, `src/world/react/*`, `src/world/actors/*`, `src/generator/audio-warp.ts`, `src/generator/qa/*`, `src/compositions/WhatIfVideo/{WorldStage,index}.tsx`, `src/compositions/look/*`, `test-fixtures/pipeline/bullet-test/*`, the Status section of 14-bullet-time.md.

## Committed
- `aeb4588` this status file.
- `b8eaca6` Task 2: the reaction pieces' fixed draw order (`rigid.ts` `rigidDrawOrder`, `RigidReaction.tsx`, `debris.test.ts`).
  - Cause: three.js draws opaque meshes by renderOrder, then **material id**, then depth. The reaction pieces' material ids follow the order the model files finished loading, which differs per browser session, so two touching frozen pieces of different files (a plank through a crate) won their shared depth either way. Frame 989 rendered alone in fresh browsers gave both states (2 and 2 of 4 calls).
  - Fix: each opaque rigid mesh gets its own renderOrder in [1, 2) in build order (after the rest of the opaque scene); transparent parts keep 0 and share one fixed rest bounding sphere.
  - Proof (`bt-plan-spec.json`, frames 960-989): concurrency 2, 6 three times, reverse 5-frame calls: 30 of 30 identical (`out/agentBULLET/bthash-j*.txt`); 989 alone in 6 fresh browsers and 988 in 4: one state. Before (`bthash-g*.txt`): 988 and 989 flipped. Without bullet time the lift frames 780-800 and 960-989 of `bt-plan-spec-plain.json` are unchanged (51 of 51).
- `bd0cc45` Task 3: the photographer's notes for the window (`qa/photographer.ts`: `bulletAt`, `stillNotes`, `colourFloor`, `ShotCheck.notes`, a shot whose middle is in the window judged in the hold; `qa/vision.ts`: the hold's "trails visible?" question, `visionQuestions(spec, shot, t)`; tests). `HOLD_DESATURATE`/`HOLD_CONTRAST` moved to `warp.ts`, imported by `look/CinematicLook.tsx` (same values). 14's Status for tasks 2 and 3.
- `13fb5d5` Task 1: the fixtures `writer-1.txt`, `director-1.txt`, and 14's Status "The test video, end to end".
  - Why: the old story ran 42 s for 38, so the timeline cut the silent beat b6 to 1.6 s and the window (2.5 s at least) swallowed all of b7 up to the cut: no aftermath, Karim's react and fall planned after his scene's end.
  - Now: short lines (seven of nine beats spoken, the writer's check), b6 3.6 s, b7 shows the fall; actor times follow the plan; Nadia's Paris walk starts at 0.0 (at 0.4 the dodge began 0.5 s late and two bullets were dropped for passing 0.02 and 0.30 m from her); b5 films Karim raising the pistol (the low plaza shot was blocked by the fountain's basin).
- Checks for every code commit on `wt-bullet2` (dev + my files): tsc 0, eslint 0, npm test 0 fail (774, then 795 tests at 0c3aba4 + the fixtures).

## Uncommitted
- Nothing.

## Results
- **The videos:** `out/agentBULLET/test-video/final/video.mp4` (1080x1920, 38.0 s, 60.7 MB, run `...-617aae`) and `draft2/` (half size, run `...-f9ff7a`); `draft/` is the first draft (b5 still on the plaza). Each folder: `sheet-seconds.png`, `sheet-window.png`, `sound.txt`, `qa.json`, props and spec. `final/bt/` holds the slow-down's nine files for the user to audition.
- **Sound (final):** -14.1 LUFS, -1.3 dBTP. Window: -15.1 before, -11.6 ramp in, -13.3 hold, -16.3 ramp out, -13.8 after. Voices 7-30 dB over the ducked music.
- **Its own hold frames** (740-769 of draft 2): concurrency 2, 6 twice, reverse: 30 of 30 identical (`bthash-v*.txt`).
- **The photographer:** b6 judged at 24.87 s (in the hold) with its notes; the only flag is b7 (Karim against a dark wall, 47 % near black).

## Worktree and outputs
- Worktree `wt-bullet2` removed (junctions first). The render command, from a checkout: `FACTORY_LLM_FIXTURES=test-fixtures/pipeline/bullet-test npm run generate -- "What if, once a day, the world stopped for one second, for everyone but you?" --format 9:16 --duration 38 --no-story-gate --quality final --audio-file test-fixtures/pipeline/bullet-test/audio.json` (about 6 min of frames here once the voices are cached; kitten2 took 1-9 min a line on the busy CPU).

## Findings for others
- **The critic's note (pipeline/critic.ts; forwarded to producer2):** in `critiquePlan`'s beat list, append to the bullet-time beat's line, only when `input.direction.bulletTime?.beat === b.id`: ` [bullet time here: the world slows almost to a stop on purpose; frozen people and cars and things hanging in the air are intended, not a fault]`.
- **Music pick (audio-resolve, by run id):** the tense tracks picked for draft 2 and the final (freepd-horror-alien-invasion, -alien-spaceship-atmosphere) are near silent in their first seconds: the music is barely there under the hook and b5-b7. Draft 1's pick (asking-questions) sat 10-16 dB under the voices.
- **The hook shot** (assembler/camera): 0-4.7 s is an EWS high over Cairo in beige haze, almost empty; b9's EWS over Paris at dusk is hazy too.
- **The flight** (assembler) takes the whole of b4 (one 4.8 s shot), so Karim's line is heard over the globe.
- **The litter** still flutters down in the next scene 3-4 s after gravity-on, also without bullet time (react/particles chips; mine, left as designed).
- **bulletWindow** (warp.ts) runs a too-short beat into the whole next beat; left as is.
- The Paris money video's frame 349 differs between renders (no bullet time, no reaction pieces): forwarded to the determinism agent.
