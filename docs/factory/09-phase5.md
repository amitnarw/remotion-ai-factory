# 09 — Phase 5: characters and atmosphere (started 2026-10-23, status 2026-10-26)

Phase 5 in [05-plan.md](05-plan.md#phase-5--better-worlds--characters--milestone-5): an `Actor` with an action timeline from the director, then materials and atmosphere. The composable set builder (step 3) is covered by the world engine ([06-world-engine.md](06-world-engine.md)).

**Status: about 75% done** (2026-10-26).

Built:
- Characters (actors with a director's action script), a city crowd and featured actors placed by the director (`scene.actors`).
- Per-actor level of detail.
- The atmosphere set: mood palette, sun shafts with a halo, pond and fountain water, night windows, ocean water and an FBM sky.

Left:
- Two decisions noted below.

**User decision (2026-10-24):** the world crowd and featured actors are **off by default** (commit 993e9d7). `WorldStage` does not pass `crowd`. Phase 7's "at least 10 animated people per street scene" needs them back on, so that decision gates that item.

## Files of this phase
- **Actors:** `src/world/actors/` (`script.ts`, `rigs.ts`, `rig.ts`, `cast.ts`, `Actors.tsx`, `ActorStage.tsx`, plus tests).
- **Atmosphere:** `src/world/atmosphere/` (mood palette, shafts, pond water, FBM sky).
- **World integration:** `cityAnchors`, the crowd and the actors layer in `GroundWorld` (`src/world/Ground.tsx`).
- **Main factory:**
  - `director.ts` takes the director's `scene.actors` block;
  - `assemble.ts` converts the scene-relative times to video times;
  - `src/compositions/WhatIfVideo/WorldStage.tsx` passes the cast through.

## Setting up on the other laptop
1. **Bring the code over.** The Phase 5 files are in a local commit on `main` (not pushed). Either push from this laptop and `git pull` there, or make a bundle:
   - here: `git bundle create phase5.bundle main`
   - there: `git pull <path>/phase5.bundle main`

   Phases 3 and 4 are in progress in other chats in the same folder. Their files are not in this commit.
2. **Install:** `npm ci --legacy-peer-deps`. A plain `npm install` fails on the `@types/react-dom` peer conflict.
3. **Models** (need internet once; not in git):
   - `npm run assets`: Kenney and Poly Pizza characters, city and nature packs, into `public/assets/`.
   - `npm run world:assets`: KayKit and Quaternius packs (about 380 MB, into `public/assets/world/`). The test plaza uses the KayKit bench, streetlight, café table and trees, and the Quaternius planter.
4. **Check:** `npx tsx --test src/world/actors/*.test.ts` should report 29 passing tests.
5. **Look at it:** `npx remotion studio src/world/index.ts`, then open `ActorStage` (9:16) or `ActorStageWide` (16:9) and scrub through the 15 s.

Nothing here needs a GPU, an Ollama key or a TTS engine.

## How to run it
```
npx tsx --test src/world/actors/*.test.ts               # 29 tests: planner, timing, smoothness, rig, determinism
npx remotion studio src/world/index.ts                   # compositions ActorStage (9:16), ActorStageWide (16:9)
npx remotion still src/world/index.ts ActorStage out/actors/f300.png --frame=300
npx remotion render src/world/index.ts ActorStage out/actors/stage.mp4   # the 15 s video (pending check 3 below)
```

What the test plaza shows (`DEFAULT_SCRIPTS` in `ActorStage.tsx`):
- **Maria** walks from the lamp to the bench and sits (6.8 s). At 8.5 s she waves at Tom, and from 11 s she talks to him. At 12.4 s she stands up (the sit-down played backwards) and walks to the hydrant.
- **Tom** walks in past the hydrant, looks at Maria at 7 s, waves at 8.6 s and points at the lamp at 11.2 s.
- **The kid** runs to the front, cheers at 5.2 s (for 1.9 s), falls at 7.5 s, gets up from 9.6 s (the fall played backwards) and runs off at 10.8 s.
- **The farmer** by the café watches the kid, flinches when he falls, then walks to the planter (its spot moved to z = -3.5 so he stops in front of it).

Close-ups use the `camera` prop, e.g. the bench: `--props='{"camera":{"pos":[5.2,1.5,2.4],"target":[3,0.7,-1.6],"fov":50}}'`.

**Faster test renders.** A normal bundle copies the whole 0.9 GB `public/` folder, which takes about 3 minutes. A slim folder of hard links cuts that to 20 s:
- Hard-link only the packs the scene uses into `out/actors-public/`: `assets/characters`, `assets/world/kaykit/{city-builder-bits,restaurant-bits,forest-nature-pack}`, `assets/world/quaternius/downtown-city-megakit`, and `fonts` (the world entry loads the caption fonts). In Git Bash use `cp -al`.
- Bundle against it: `npx remotion bundle src/world/index.ts --out-dir=out/actors-bundle --public-dir=out/actors-public`.
- Render from the bundle: `npx remotion still out/actors-bundle ActorStage ...`.

## Research (two parallel passes, 2026-10-23)
**Characters**
- **Playback rule:** set each clip's time and weight by hand, then call `mixer.update(0)`.
  - Under Remotion, `ThreeCanvas` advances the scene with wall-clock time.
  - `mixer.setTime`, fades, `crossFadeTo` and drei `useAnimations` keep hidden state, so frames rendered out of order (parallel tabs) differ.
  - Crossfade weights must sum to 1, or the bind pose leaks in.
- **Foot sliding:** use distance matching. Clip phase = metres walked ÷ stride per cycle, where the stride is measured from the planted foot.
  - Measured planted-foot speeds: Quaternius CharacterArmature walk ≈ 1.3 m/s, UAL Walk_Loop ≈ 1.1 m/s.
- **Packs on disk** (four rig families with different bone names):
  - Kenney blocky (node-animated)
  - Kenney mini (7 joints)
  - Quaternius CharacterArmature (62 joints, has Wave and HitRecieve, no sit)
  - Quaternius HumanArmature (31 joints, has Sitting and Clapping, no wave)
  - Quaternius kit animals (43 joints)
- **Better clip library:** Quaternius **Universal Animation Library** (UAL1/UAL2, CC0). It has sitting enter/idle/exit, talking idles, crouch, hit, death, lay-to-idle, jog and sprint. Its free tiers have no wave, point, clap or cheer.
  - UAL2 has a direct link: `https://opengameart.org/sites/default/files/universal_animation_library_2standard.zip`.
  - UAL1 v3 is on itch.io only, so it needs a manual one-off download.
  - Using it means an offline retarget bake onto the CharacterArmature people, borrowing the rest-pose method from three-vrm's MIT `loadMixamoAnimation.js`. Not done yet (see Pending).
- **Licences:**
  - Quaternius now shows its "Asset License v1.0" (2026-08-28), which bans redistributing the assets on their own. The packs' own licence files still say CC0. Download from the source by script; never commit or re-host the files.
  - Mixamo can't be scripted (needs a login, no redistribution).
- **Crowds** (Phase 6): `@three.ez/instanced-mesh` (MIT) for instanced skinning, with a pose cache per (clip, phase bucket). Use full skinned actors only near the camera.
- **Prior art borrowed:** FilmAgent's named positions with affordances (e.g. sittable), and Cutscene Agent's posture state machine and semantic facing. The model never outputs coordinates.

**Atmosphere** (not built yet; the decisions to build from)
- **Clock rule:** every drei effect that reads `state.clock` or `delta` gets wall time under Remotion. Every `uTime` must be `frame / fps`.
- **Toon palette per mood:** `MeshToonMaterial` with a 3–5 px `NearestFilter` ramp.
  - Coloured ramps through a per-material `onBeforeCompile` (r178 reads only `.r`).
  - Do **not** override three's global shader chunks: that would change the Phase 3 chat's scenes too.
  - Shadow tint comes from the hemisphere ground colour.
  - Key it by the Phase 3 look preset ids (`src/compositions/look/presets.ts`), so grade and palette follow one choice.
  - Atlas kits are recoloured once at load (colour plus vertex colours), never by a runtime grade.
- **Particles** (dust motes, fireflies, pollen, embers): drei `Sparkles` is not deterministic (wall clock, `Math.random` layout). Build a ~60-line `Points` shader:
  - Remotion `random(seed)` for the attributes.
  - Closed-form drift, rise and blink.
  - Additive blending, `depthWrite=false`, small points.
- **Light shafts:**
  - Interiors: drei `SpotLight` volumetric cone with no depth buffer and `castShadow={false}`. A depth buffer would double the draw calls.
  - Outdoors: build 2–3 additive billboard quads per shaft with scrolled noise, faded near the ground and the camera. At most 3–4 on screen.
- **Sky:** build a shader dome with:
  - a 3-stop gradient,
  - a sun disk and halo,
  - 1–2 cel-stepped FBM cloud layers projected onto a plane, driven by `uTime`.

  Add low-poly mesh clouds with frame-driven drift at mid distance. drei `Clouds` is usable only with `speed={0}`, a fixed `seed` and a local texture, moved from the frame number. Reject `@takram/three-clouds`/`atmosphere`: they are post-effects with temporal reprojection, too heavy for an iGPU and not frame-pure.
- **Water:** Gerstner waves (3–4, ΣQ·A·k < 1) in the vertex stage via `three-custom-shader-material` (MIT), flat-shaded normals from derivatives, shoreline foam from a baked water-depth vertex attribute (no depth pre-pass). Reject three `Water`/`Water2` (reflection re-renders).
- **Height fog:** exponential height fog plus a sun in-scatter tint (Íñigo Quílez's formula), added **per material** with `onBeforeCompile`. The fog colour comes from the sky's horizon colour.

## What is built (`src/world/actors/`)
| File | What it does |
|---|---|
| `script.ts` | The director's actor script and its pure solver.<br>**Schema** (`ActorScriptSchema`, zod): `{id, model?, role?, start, facing?, height?, colors?, carry?, steps:[{at, action, to?, via?, target?, for?, how?, prop?}]}`.<br>**Actions:** idle, walk, run, wave, point, sit, look, talk, react, panic, fall, cheer, clap, jump; bullet time's aim, shoot, dodge ([14](14-bullet-time.md)); P6's punch, kick, crouch, stand, pickup, putdown, from clips already on disk ([19](19-model-sets.md) §1: mapped only for a plan that uses them; a model without a punch or kick clip is not cast for one; crouch and pickup have stand-ins; a pickup's prop lies, rides in the hand, and is put down). One list, `ACTOR_ACTIONS`, read by the spec schema, the director and the registry.<br>**Anchors:** named spots `{pos, facing?, seat?}`; a table may also give `route(a, b)` (a model set's deck: the walk round its mast). Unknown names throw `ActorScriptError`, listing the valid names (ready for a repair prompt).<br>**`planActor`:** timed segments. A busy actor delays its next step, with a warning. Accelerate/cruise/decelerate profile, smoothed corners, turns, posture state (stand/sit/down), seats.<br>**`poseAt(plan, t)`:** a pure function returning position, yaw, up to two clip layers whose weights sum to 1, and overlays.<br>**Also:** `actorSubject` (for the camera's shot solver), `aimPoint` (look/point at another actor's head). |
| `rigs.ts` | Normalises clip names across packs (`HumanArmature\|Female_Walk` → `walk`), picks a clip per key, and finds head/neck/arm/thigh/foot bones by name. Pure; also runs in Node. |
| `rig.ts` | Builds the three.js side:<br>- clone, scale to metres, recolour named materials (dark palette for suits)<br>- measures the walk/run stride from the feet, and where the hips land in the sit clip<br>- `applyPose()` sets clip times and weights, then calls `mixer.update(0)`<br>- seats: hips onto the seat, weighted<br>- procedural overlays: head look-at with neck limits, point with the arm on the target's side, talk gestures, and stand-ins for missing wave/cheer/clap/cower/react<br>No state carries between frames. |
| `cast.ts` | Casts catalog characters by role words (gender, occupation, child). One look family per scene (children stay in it, just shorter). Only models whose clips can play the plan; different models for different actors. |
| `Actors.tsx` | `ActorsLayer` (load, gate the frame with `delayRender`, plan, cast, pose every frame); `planCast` and `useActorPlans` share the plans with a camera. |
| `ActorStage.tsx` | Test plaza with catalog props and four scripted people; registered in `src/world/Root.tsx` as `ActorStage` / `ActorStageWide`. |

**Checked in stills** (`out/actors/`, not in git):
- walking and running, with direction and gait correct
- a fall that stays down
- sitting on the bench: hips on the seat, feet on the ground (after the seat fix)
- a seated wave
- a standing wave (the model's own clip)
- pointing at the lamp with the near arm
- a seated talk gesture

**Fixed along the way:**
- A zero-length hold dropped the arrival turn, so the yaw jumped.
- Sitting landed the thighs inside the bench.
- A child was cast from a different pack.
- A suit was recoloured bright yellow.

## Pending (in order)

Status on 2026-10-26:
- Items 1, 2 and 4 below are **done** (the world integration and the crowd, the director block in `director.ts`, and the atmosphere lane C).
- The FBM sky is built but **not wired**: nothing sets `GroundWorld`'s `fbmSky` prop. Decide whether world scenes should use it, and turn it on in `WorldStage` if so.
- Item 3 (the motion check) is **done** (2026-10-26, see below). Item 5 (the river axis) is **done** too. Still open: 6 (optional clip bake).

1. ~~**Actors in the world.**~~ (done)
   - Write `cityAnchors(place, layout)`, giving named spots from the generated city: avenue, sidewalk-north/south (and ±20 m east/west), plaza, park, landmark front.
   - Ground heights: sidewalk 0.04, avenue 0.12, plaza 0.18, park 0.2. The avenue runs along x at z = 0; its half-width is `style.avenue/2` and the sidewalk width is `style.avenueWalk`.
   - Add a `WorldActors` composition: `GroundWorld` plus `ActorsLayer`.
   - Note: the world's sun shadow covers ±260 m, so actor shadows are soft blobs at street level.
2. ~~**Director block.**~~ (done: `scene.actors` in `director.ts`) `actorDirectorContext(anchors)` prompt text (`ACTION_HELP` plus anchor names), validation of each script with `planActor` errors as repair prompts. Not wired into `src/generator/pipeline/director.ts`: other chats own that file (Phase 3, then Phase 6 step 1).
3. ~~**A video check** of `ActorStage` (15 s)~~ DONE 2026-10-26. The video and a probe that ran the real `planActor`/`poseAt`/`applyPose` on the real GLBs for all 450 frames found what stills could not show, all fixed in `src/world/actors/`:
   - Arms, head and neck stayed in the rest pose (each rig was posed twice per frame, and three's `AnimationMixer` skips unchanged values): a pure clip evaluator in `rig.ts` replaces the mixer, and `Actors.tsx` poses once per frame. `applyPose` no longer depends on the frame before.
   - The sit clip looped back to standing: it now plays once and holds; two-bone leg IK keeps the feet on the ground under a higher or lower seat.
   - Planted feet slid backward (stride under-measured; the kid's run played 1.4x too fast): stride = planted-foot speed x clip length, each move starts on the walk phase nearest the idle stance, and the stride stretches at most 18% to stop near that stance. Signed slide: Maria -0.24 to 0.00 m/s, Tom -0.40 to +0.03, kid -0.91 to +0.10, farmer -0.32 to +0.01.
   - Turns: 0.8 s about-turns, a turn carries into the next segment, big turns turn on the spot before the first step, on-the-spot turns step the feet round (`turnSteps`), path corners are rounded so facing matches the motion (no crab-walk).
   - Cross-fades chain through short segments; a walk into another walk is one move; the get-up plays the fall backwards (`GETUP_SECONDS` 1.2 s) instead of swinging through the ground.
   - Tests: `rig.test.ts` (8, a synthetic rig, no asset files) and 5 new in `script.test.ts`; all fail on the old code. Evidence: `out/agentACT-stills/` (before/after sheets, `motion-metrics-before.txt`, `motion-metrics-after.txt`), `out/actors/stage-before.mp4` vs `stage.mp4`.
   - Second pass (2026-10-27), also in `src/world/actors/`:
     - **Walk-off:** a move that starts with a turn turns fully on the spot, stepping, before the first step; the walk's cross-fade starts with that step; the planted foot is held where the previous clip stood it until the gait lifts it. Worst planted-sole speed at a walk-off: Maria 1.07 to 0.35 m/s, Tom 1.06 to 0.35, the farmer 0.91 to 0.43. Turning on the spot: Tom 0.35 to 0.06 m/s.
     - **Lying on the ground:** `measureFall` measures the lowest point of the posed body at the end of the fall; the model is lifted by it through the fall and the get-up. The kid's lowest point: -4.3 cm to -0.1 cm.
     - **Standing up:** its own segment, the sit clip played backwards over 1 s (`STANDUP_SECONDS`), with the feet planted; the seat IK also cancels the sideways shift (Maria's feet slid 17 cm while sitting down).
     - **A culling bug, found on the way:** three.js computes a skinned mesh's bounding sphere from the first pose it culls in and keeps it, so a lying body's head and hands could vanish in a close-up depending on the render tab. `buildRig` now gives each skinned mesh a fixed sphere (1.25 × the actor's height). Close-up renders of lying or seated people made before this may have missing parts.
     - Tests: 4 new in `rig.test.ts`, 2 in `script.test.ts` (all 6 fail on the old code); 29 actor tests pass. Evidence: `out/agentACT2/` (before/after videos and sheets, `motion-metrics-*.txt`; the probe is `out/agentACT2/probe/motion.mts`).
   - Still imperfect: the first swing foot's toe drags 1-1.5 cm for a frame or two at a walk-off; the stride stretch gives about 0.25 m/s of forward slide per landed foot; the walk-to-idle cross-fade on arrival still drags a foot (up to 0.69 m/s); the soles turn (up to 0.26 m/s) when sitting down; the kid's run clip jerks about 1 m/s on each landing and the Death clip slides the feet (the clips' own motion); plans can't face a moving actor (only overlays aim at them); blocky Kenney rigs without a thigh-shin chain still pivot on turns; a stand-up from a seated-loop clip (no sit-down to reverse) fades to idle and is untested, as none of the stage's models has one.
4. ~~**Atmosphere**~~ (done, lane C 2026-10-24; FBM sky not wired) (per the decisions above), as new files in `src/world/atmosphere/`: mood palette (toon), particles, outdoor light shafts, sky dome with cloud layers plus mesh clouds, Gerstner water, height fog. Then stills per mood. Opt-in per scene, nothing global.
5. ~~**River axis fix**~~ DONE 2026-10-26: the water, banks, falls, pool, mist and mountains follow `flowDir`; the scene, river and waterfall anchors and the fallback camera look along the flow; a partial `riverConfig` is merged over the defaults (it gave NaN); the camera keeps to a lane over the water between the rock lines; the ground opens over the channel with a dark bed below (the water used to sit level with the ground and only showed in patches). Was: in `src/compositions/RiverStage.tsx`:
   - The bank plane is `[length + 20, width + 8]` (long along x), while the water, rocks and the default `flowDir: "z"` run along z.
   - The camera's `angle` is π/2 for z, so it looks sideways (+x).
   - Fix: size the bank by `flowDir`, and look along the flow.
   - Check with the Phase 3 chat first: it is adding camera anchors to every stage.
6. **Optional: UAL clip bake** (offline, Node) onto the CharacterArmature people. Gives sit, talk, crouch and get-up to models that lack them.
7. Docs: tick Phase 5 in PROGRESS.md and record the milestone stills.

**Not Phase 5:** the Interior camera bounds belong to Phase 3 (per-stage `ShotCamera` anchors, in progress in another chat). Crowds of pedestrians are Phase 6 step 3; they reuse `ActorsLayer`/`rig.ts`.
