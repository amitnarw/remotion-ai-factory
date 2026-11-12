Done (2026-11-05), with two world-scene hunts stopped and handed over (below, "Open").

# Determinism of the street and asset-kit stages (agent DETERMINISM)

## Follow-ups (done)
Files now mine: `src/compositions/camera/ShotCamera.tsx`, `src/compositions/weather.tsx`, `src/compositions/{Countryside,Forest,Interior,River,Ocean,Space}Stage.tsx` and their helpers (`mist.ts`, `water.tsx`, `tod.ts`); then `src/world/{TrafficLayer,TrafficSignals}.tsx`, `src/world/traffic.ts`. Not mine: `src/world/Ground.tsx` (world-polish), `src/compositions/WhatIfVideo/WorldStage.tsx` (bullet2), `docs/factory/17-code-map-world.md` (coordinator): exact edits for them go in "Findings for others".

Written and committed: 1-2 in `d65751e`, 3 and 5 in `888c6f3`, 4 in "GroundWorld takes its fog and background away when it goes":
1. `ShotCamera.tsx`: the solver's lens written whenever it differs (far never shrank within a tab; fov changes under 1e-4 were skipped).
2. `weather.tsx`: the storm flash placed from the render camera in `scene.onBeforeRender` (after every frame callback, before three sorts), and drawn only while it flashes (unlit, it still wrote depth wherever an earlier flash had left it, or across the world's origin).
3. `ForestStage.tsx` `useStageFog(fog, background)`: the scene's fog and background written in `useFrame`, cleared on unmount. Used by Countryside, Forest, Interior, River (their `useEffect` fog came after ThreeCanvas drew a cut's first frame, and stayed for the next stage), Ocean (its `<fog attach>` was put back to the previous stage's fog by R3F on unmount) and Space (background set in a memo, never cleared). `SpaceStage` OrbitRig: far exactly 2600 (`Math.max(cam.far, 2600)` kept a world stage's 70 km).

4. `src/world/Ground.tsx` (now mine, the polish agent is done; its b5cf946 and 0442e4f kept): GroundWorld's cleanup takes away the fog and background on unmount, only if they are still the ones it set (`owned`, also updated where its frame callback puts them back). A globe or another place sets its own first and keeps it.

5. Every kit stage (Countryside, Forest, Interior, River, Ocean, Space) draws its opaque meshes in scene order (`useSceneDrawOrder`): the ocean's water mounts when the water returns, the canoes when their model arrives, and where they meet the beach the pixel followed when each material was made.

Proof so far (`dhash2.mts`, 95 frames: the milestone videos with their shots round every cut, shot change and storm flash, river and interior alone): bundle `b-f3` at 3, 6 and 1 tabs, random groups and one tab per frame: 95 of 95 the same. Before (`b-f0`, 3 vs 6 tabs): 55 of 95.
Look changes (old 3-tab render vs new): the first frame of a tab in a forest, countryside, river or interior scene, and the first frame after a cut into one, had no fog at all (the fog came after the draw); now it has its fog like the rest (whole frame). Space frames after the street and in shots have one lens (the old ones had a far left by the street or a shot). Storm flash frames: the flash from the render camera (about 1,000,000 px). Ocean intersection pixels: 1-10 px.

Proof of 4: the Paris video's world frames on `b-f0` and `b-f3` at 4 tabs: 15 of 15 the same; with rain in Cairo the same two states per flight frame in both bundles (the pools below). World scenes cut with park and forest (`world-kits`, 15 frames round the cuts): one tab through all of them, 6 tabs and one fresh tab per frame give the same hashes.

Committed: the coast's water (places agent, Findings 3) in `2665abc`. The 2 km teal plane at 0.01 is gone; the terrain's water faces are split into their own mesh (`seaSplit`, cached per terrain; the land's material, so at rest the picture is the terrain's), and a drain lowers that mesh (`position.y = -drop`); under a drained sea the far disc (1 m down) shows as the dry bed. Checks before the commit (dev `6be1501` + the edit): tsc, eslint, `npm test` 822 tests, 0 failing.
- Proof (`dhash4.mts`: New York, San Francisco, Paris at noon; aerial, plaza, avenue): `b-g1` at 4 and 1 tabs and one tab per frame, 24 of 24 the same. Against `b-g0` (dev `6be1501`): Paris unchanged (8 of 8); New York and San Francisco change in the aerial and plaza frames (the teal square round the kit core is the terrain's flat ground now, 90,000-370,000 px), their eye-level avenue frames do not.
- The drain (`dhash5.mts`/`dhash6.mts`, aerials, water-vanish at 1 s, frame 120): drained against undrained, San Francisco 202,757 px (its bay turns to the dry bed), New York 13,995 px. With the old stub only the teal square dropped and the terrain's water stayed blue.

## Open (stopped on the coordinator's word; nothing of it in src)
1. **The flight's car-light pools** (polish's frames 660, 675; Cairo at night). (2026-11-12, the fixes agent: still open; candidate (b) below, with the additive blending kept, changes nothing; status/fixes.md item 6.) Ground B draws the pools only on the first frame after its GroundWorld mounts in a tab (675 alone or after the globe: pools; after 674, 660 or ground A: none); with rain, 640 and 660 flip with the tab assignment. Ruled out:
   - the data: 39 pools computed at 675, drawn in the same order with the same program, the texture uploaded, into the composer's half-float target; the draw lists of the two frames are the same;
   - re-uploading the pool textures, fresh instance buffers, `gl.resetState()`, all every frame; the polygon offset (off: no change);
   - the GL state and uniforms: depth test on, LEQUAL, mask off, log-depth FC 0.124 and the same perspective projection for every scene draw in both frames (the flight canvas has a logarithmic depth buffer).
   Found: drawn with GREATER, later frames show the pools behind the road even 10 m above it; drawn as opaque quads (no blending), even last of the opaque list, they pass the depth test in both frames; drawn first of the transparent meshes they fail in the first frame too. So the same quads pass LEQUAL as opaque draws and fail as transparent ones.
   Next: (a) find what differs for the transparent draw (log the depth func, mask and FC at the opaque and the transparent draw of the same quads; try `transparent: true` with `blending: NormalBlending`); (b) or adopt the opaque-list variant (`transparent: false`, `CustomBlending` SrcAlpha + One, `renderOrder` 1): history-independent (675 alone = 675 after 674), but 675 then has no pools while 674 has; check the look first. Debug builds: `out/agentDETERMINISM/b-dbg*`, `dhash3.mts --frames 674,675 --log`.
2. **bullet2's Paris frame 349.** Not reproduced: frames 300-360 at 4 tabs against 349 alone give the same hash (`dca647e2d9fd`) on `b-before` (`481415b`), `b-g0` (dev `6be1501`) and `b-g1`; also after 330 in one tab. Next: bullet2's exact command (its bundle, frame range, `scale`, concurrency) to repeat; my scripts render at scale 1 with `gl: angle`.

## Worktree and outputs (follow-ups)
- Worktrees `wt-determinism` and `wt-determinism-dbg`: removed.
- `out/agentDETERMINISM/`: bundles `b-f0`..`b-f3`, `b-g0`, `b-g1` and the debug `b-dbg*` (each holds `public` as a junction: `rmdir <bundle>\public` before deleting it); scripts `dhash2.mts` (milestone videos with shots), `dhash3.mts` (Paris video, rainy Cairo, world scenes cut with kits; `--frames`, `--log`), `dhash4.mts`..`dhash6.mts` (coasts, the drain); hashes `hash-g*`, `hash-h*` (follow-ups), `hash-w*`, `hash-k*` (world), `hash-s*`, `hash-d*`, `hash-n*` (coasts), `hash-q*`, `hash-r*` (frame 349).

## Task
- Make every frame of the street-block, city-street, park, boardwalk and pier stages a pure function of the frame (HANDOFF §2 "Started, nothing landed"; §3.3). Prove it: the same frames twice, shuffled, at 1 and 6 tabs, 9:16 and 16:9, byte-identical PNGs. Report frames whose look changes.
- Make `roads: fast enough to build at render time` (`src/world/roads.test.ts`) robust under CPU load without weakening it.
- Files owned: `src/compositions/{StreetStage,AssetStage,glb}.tsx`, `src/compositions/street/*`, `src/compositions/scenes/*`, `src/world/roads.test.ts`, a docs section (written in [09-phase3-handoff.md §4](../09-phase3-handoff.md#4-kit-stages-frame-by-frame-fixed-2026-11-05), since 17 had another agent's uncommitted edits).

## Committed
- `d876a47` `glb.tsx`: each `GlbSuspense` holds the frame until R3F's `advance()` drew it with its model (**the main cause**: `useGltfPaint`'s bare `gl.render` left a tab's first frame ungraded, and that was captured), and the `useSceneDrawOrder` hook.
- `0b380a0` `StreetStage.tsx`: fog range in `useFrame` (a `useEffect` runs after ThreeCanvas drew), the rig's lens written whenever it differs, `prepClone` warms the shared GLTF before cloning (the café idlers stood at their size or vanished), opaque meshes in scene order.
- `11c40a6` `AssetStage.tsx`: default lens and no fog every frame, clones made once, opaque meshes in scene order.
- `e3b5309` `roads.test.ts`: the build timed in the process's CPU time, best of up to three; the bound is unchanged (1500 ms). Under load in `npm test`: middle-eastern 2474 ms wall (the old test failed), 673 ms CPU.
- This commit: [09 §4](../09-phase3-handoff.md#4-kit-stages-frame-by-frame-fixed-2026-11-05) (causes, proof, what changes on screen, rules, open points) and this file.

## Proof
`out/agentDETERMINISM/dhash.mts` on bundle `b-after3` (the four code commits): the five stages × 9:16 and 16:9 × 15 frames, at 1, 3, 3 and 6 tabs, random groups of 1-4 frames in fresh tabs in a shuffled order, and one fresh tab per frame in a shuffled order (twice): 7 runs, 150 of 150 hashes the same. Ocean (canoes go through glb.tsx) at 1, 6 and one tab per frame: 30 of 30. Before (`481415b`, three runs): 17 of 150. Checks for every commit on `wt-determinism`: `tsc`, `eslint src server`, `npm test` (778 tests, 0 failing).

## What changed on screen (against `481415b` at 3 tabs)
- Every tab's first frame (the first `concurrency` frames of a render, each chunk's first frames) is now graded like the rest: whole frame.
- Street: frames after a zoom change get their own fog and lens (up to 190,000 px, faint, over the far street and sky); the café idlers always stand at the tables (1,000-5,000 px).
- Intersection pixels from the scene draw order: 0-2 px a frame in park, boardwalk, pier; about 20 in city-street; a few in the street's tree crowns.
- Ocean: only the tabs' first frames.

## Uncommitted
- None.

## Worktree and outputs
- Worktree `wt-determinism`: removed.
- `out/agentDETERMINISM/`: bundles `b-before` (`481415b`) and `b-after3` (each holds `public` as a junction: `rmdir <bundle>\public` before deleting it); scripts `bundle.mts`, `dhash.mts` (`--mode asc|single|groups --conc N --only <cases> --save <dir>`), `cmp.mjs <tags>`, `pixdiff.py`, `cells.py`, `mark.py`, `bright.py`, `lookdiff.py`; hashes `hash-<tag>.txt` (`base1-3` before; `c1-3`, `p1`, `pg`, `ps`, `psA` after; `o1`, `o6`, `os`, `ob3` ocean); PNGs `png-<tag>/`.

## Ruled out
- `mixer.setTime` in the render body: absolute clip time, pure; the mixer's skip-unchanged-writes check is harmless since nothing else writes those bones.
- Per-render `skeletonClone` in AssetStage: wasteful, not a cause (fixed anyway).
- `Math.random` / `Date`: none feed the picture; Remotion `random()` has string seeds.
- `useGltfPaint` outside Suspense: every call is inside a `GlbSuspense`.
- The grain: seeded by the frame in a layout effect (`GrainSeed`); there is no FilmGrain file.

## Findings for others
- Fixed in the follow-ups (the files became mine): ShotCamera's lens (`d65751e`), the storm flash (`d65751e`), the stages' and GroundWorld's fog and background (`888c6f3`, `c6fc4f7`), the ocean's draw order (`888c6f3`).
- `docs/factory/17-code-map-world.md` (another agent had it open): §1.6's holds table says "kit stages' GLBs, per file" (now per `GlbSuspense`); §3's `glb.tsx` line names `releaseModelLoad` (gone) and "one gate per file", and should add `useSceneDrawOrder`; §6's "Exception: the street and asset-kit stages already render some frames in more than one state" is fixed (point to 09 §4); §1.6 rule 8 could add the kit stages' scene draw order.
