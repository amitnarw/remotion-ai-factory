Done (2026-11-05). Left: the test video's re-render (below, "Next"), done by the coordinator in the final combined check.

# review: the bullet-time test video's faults outside bullet time

## Task
The first full test video, `out/agentBULLET/test-video/final/video.mp4`, showed three faults outside bullet time:
1. **The hook is an almost empty frame of beige haze over Cairo** (0-4.7 s, sun about 9°), and b9 (Paris at dusk) is hazy too.
2. **The tense music is nearly silent in its first seconds.**
3. **Litter still falls 3-4 s after gravity-on**, with or without bullet time.

Files owned: `src/compositions/WhatIfVideo/*`, `src/compositions/look/*`, `src/generator/look-choice.ts`, `src/world/react/*`, `src/generator/{audio-resolve,audio-library,audio-master}.ts`, `test-fixtures/pipeline/bullet-test/*`, their tests; docs: the gravity line of `11-world-reactions.md`, the music note in `03-audio-sources.md`, this file.

## 1. The hook's haze: the camera's distance into the height fog (fixed by the places agent, `6440ebc`)
- **The shot:** every video's hook is `scene EWS eye push_in` (pipeline/shots.ts:185); this was the first run whose hook falls on a world scene by day. b9 is the director's `scene EWS high crane_up`.
- **Cause:** the "scene" subject (camera/world.ts: a third of the core, about 185 m across) is framed by the solver's width fit, and a 9:16 frame is narrow, so the hook's lens stood 1.6-1.8 km out and 370-400 m up (16:9: 1.2 km), b9's 1.75 km out and 1.1-1.3 km up. The height fog (atmosphere/fog.ts, about 1 − exp(−density × distance), capped at 0.85; Cairo 0.00178/m, Paris 0.00115) then hid the city: 85 % fog under the hook.
- **Not the cause:** the low sun or the desert (the same shot at noon, and in Paris, is as empty: `out/agentREVIEW/sheet-base-hooks.png`), the grade or the mood (b1 has the same and reads well).
- **Fix:** a WS/EWS of "scene" frames 80 m of the core, 40 m high: the hook's lens 0.37-0.41 km out, 90 m up; b9's 0.39 km out, 255-296 m up. Proved here on stills (`out/agentREVIEW/sheet-cam-variants.png`, `sheet-camA.png`), applied by the places agent in `6440ebc`.

## 2. The tense music's near-silent start (`338265a`)
- **Cause:** the run's tense pick (horror Alien Spaceship Atmosphere, chosen by the run id) opens 15.7 LU under its own loudness, and a cue plays the file from its start at the whole track's gain.
- **Fix** (audio-library.ts `quietOpening`, `kLoudness`, `pickEntry`'s `prefer`; audio-resolve.ts): a track whose first 5 s, measured from the file (ffmpeg decode, BS.1770 K-weighting, never played), are more than 8 LU under its integrated loudness gives way to another track of its mood that opens fine, chosen by the seed again; picks that open fine are unchanged. 8 of the 40 tracks open quiet. Note in 03-audio-sources.md.
- **Measured** (the soundtrack's first 12 s through `WhatIfAudio`): the ducked music under the hook line -48.1 -> -36.7 LUFS; the music alone over 0-5 s -38.7 -> -27.5; 17 dB under the hook voice (was 29).
- **Saved plans whose music changes:** milestone-forest-walks 1x1 and 9x16, milestone-oceans-vanish 1x1 and 9x16, what-if-money-doubled-every-3-seconds (both copies), what-if-the-oceans-vanished, the bullet test's final and draft 2. The other 9 are unchanged.
- **Not built:** skipping an intro instead (start at the first loud part) needs a start offset on the music cue in spec.schema.ts and in audio-warp.ts's `varispeed` origin (not my files).

## 3. The litter after gravity-on (this commit)
- **Cause:** gravity-on ramps the lift level to 0 in 0.3 s, but the GPU chips fell back at a paper-like 0.8-1.4 m/s (up to 25 s from where they rose), and the rigid pieces fell freely from up to 20 m (2.5 s) and bounced 2 m. Also, the scene after the bullet-time scene reads the world events at real times, so its lift lasted 6 s (through the frozen hold) against the bullet scene's 2.9 s of world time: higher pieces, still falling into b8.
- **Fix** (lift.ts `DROP_LAND_MAX` 0.8 s, `DROP_SPEED_MAX` 30 m/s, `heldLand`, `fallPlan(…, maxLand, maxSpeed)`, `Fall.g`; particles.ts chips, shader and `particleAt`): a gravity-on fall longer than 0.8 s is pulled down harder to touch down in 0.8 s, from above 12 m a little later so nothing lands faster than 1 m a frame; its bounce is no higher than off a 3.1 m drop; chips fall the same way, keep their rise's tumble pace (no frame before gravity-on changes), turn to lie flat at touch-down and then lie still (they used to keep tumbling and sliding). Coins and buildings are unchanged. Line in 11-world-reactions.md.
- **Measured** (every piece and chip of the plans the layers draw), touch-down after gravity-on, before -> after: bullet scene: chips median 4.05 s, max 9.8 -> 1.09, max 1.30; rigid max 1.74 (settled 2.83) -> 1.30 (1.98). b8 and a plain 6 s Paris lift: chips median 9.4, max 24.7 -> 1.18, p95 1.64, max 1.89; rigid max 2.54 (settled 4.31) -> 1.73 (2.41). A 2 s lift: all by 1.34 s.
- **Frames** (bundles `b-dev` = dev `e8f10ac`, `b-grav2` = + this fix): the Paris money video with the counter's reaction set to money, confetti and lift: 12 of 12 identical each; a plain Paris gravity-off/on scene: the 5 frames before gravity-on identical, the 9 after differ. `out/agentREVIEW/sheet-gravity.png`: 1.5 s and 3 s after gravity-on, everything lies on the paving (before: still coming down).
- **Checks** on `wt-review` (`e8f10ac` + this fix): tsc 0, eslint 0, the reaction tests 130 of 130, npm test 825 tests, 0 failing.

## Committed
- `ba5505e`, `525aa2f`, `2e2fac5`, `e8f10ac`, `6be1501`, `c59f1ea`: this status file.
- `338265a`: item 2.
- (this commit) item 3: `src/world/react/{lift,particles,lift.test,particles.test}.ts`, `docs/factory/11-world-reactions.md`, this file.

## Uncommitted
- Nothing.

## Next (for the coordinator's final combined check)
- **Re-render the test video** on dev at this commit or later (it holds `6440ebc`, the haze fix, `338265a` and item 3), from a checkout with `.cache` and `.tts` at hand:
  `FACTORY_LLM_FIXTURES=test-fixtures/pipeline/bullet-test npm run generate -- "What if, once a day, the world stopped for one second, for everyone but you?" --format 9:16 --duration 38 --no-story-gate --quality final --audio-file test-fixtures/pipeline/bullet-test/audio.json`
  Then look at 0-4.7 s (the hook: the city, haze behind), 34.8-38 s (b9), 26.7-31 s (the litter down by about 28.3 s), and measure the first 5 s of the sound. Scripts I used, in my scratchpad's `review/` folder: `vsheets.py <dir>` (sheet-seconds.png, sheet-window.png from video.mp4 + props.json) and `sound.mts <dir> <public>` (sound.txt: mix, scenes, the window's parts, the first 5 s, voices against the music).
- **Open, not mine:** a world scene after a bullet-time scene keeps real time for the world's events (WorldStage gives each scene its own clock), so its reaction's history differs from the bullet scene's; harmless now that everything lands within 2 s.

## Worktree and outputs
- `wt-review`: removed (junctions first).
- `out/agentREVIEW/`: bundles `b-base`, `b-camA`, `b-camB`, `b-dev`, `b-grav`, `b-grav2` (each holds `public` as a junction: `rmdir <bundle>\public` before deleting one); stills, specs, sheets, hash files, music renders.
