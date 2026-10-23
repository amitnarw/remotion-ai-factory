# 09 — Phase 5: characters and atmosphere (started 2026-10-23)

Phase 5 in [05-plan.md](05-plan.md#phase-5--better-worlds--characters--milestone-5): an `Actor` with an action timeline from the director, then materials and atmosphere. The composable set builder (step 3) is covered by the world engine ([06-world-engine.md](06-world-engine.md)).

**Status: about 40% done.** Characters are built and checked in stills. Atmosphere is researched but not built. Work stopped here on the user's request, to continue on the other laptop.

## Files of this phase
New: `src/world/actors/` (`script.ts`, `script.test.ts`, `rigs.ts`, `rig.ts`, `cast.ts`, `Actors.tsx`, `ActorStage.tsx`) and this document. Changed: `src/world/Root.tsx` (two compositions added, `ActorStage` and `ActorStageWide`). Nothing in the main factory (`src/compositions`, `src/generator`, `server`, `ui`) was touched.

## Setting up on the other laptop
1. **Bring the code over.** The Phase 5 files are in a local commit on `main` (not pushed). Either push from this laptop and `git pull` there, or make a bundle:
   - here: `git bundle create phase5.bundle main`
   - there: `git pull <path>/phase5.bundle main`

   Phases 3 and 4 are in progress in other chats in the same folder. Their files are not in this commit.
2. **Install:** `npm ci --legacy-peer-deps`. A plain `npm install` fails on the `@types/react-dom` peer conflict.
3. **Models** (need internet once; not in git):
   - `npm run assets`: Kenney and Poly Pizza characters, city and nature packs, into `public/assets/`.
   - `npx tsx scripts/setup-world-assets.ts`: KayKit and Quaternius packs (about 380 MB, into `public/assets/world/`). The test plaza uses the KayKit bench, streetlight, café table and trees, and the Quaternius planter.
4. **Check:** `npx tsx --test src/world/actors/script.test.ts` should report 10 passing tests.
5. **Look at it:** `npx remotion studio src/world/index.ts`, then open `ActorStage` (9:16) or `ActorStageWide` (16:9) and scrub through the 15 s.

Nothing here needs a GPU, an Ollama key or a TTS engine.

## How to run it
```
npx tsx --test src/world/actors/script.test.ts          # 10 tests: planner, timing, smoothness, determinism
npx remotion studio src/world/index.ts                   # compositions ActorStage (9:16), ActorStageWide (16:9)
npx remotion still src/world/index.ts ActorStage out/actors/f300.png --frame=300
npx remotion render src/world/index.ts ActorStage out/actors/stage.mp4   # the 15 s video (pending check 3 below)
```

What the test plaza shows (`DEFAULT_SCRIPTS` in `ActorStage.tsx`):
- **Maria** walks from the lamp to the bench and sits. At 8.5 s she waves at Tom, and from 11 s she talks to him.
- **Tom** walks in past the hydrant, looks at Maria at 7 s, waves at 8.6 s and points at the lamp at 11.2 s.
- **The kid** runs to the front, cheers at 4.5 s, falls at 7.5 s, gets up at 10 s and runs off.
- **The farmer** by the café watches the kid, flinches when he falls, then walks to the planter.

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
| `script.ts` | The director's actor script and its pure solver.<br>**Schema** (`ActorScriptSchema`, zod): `{id, model?, role?, start, facing?, height?, colors?, steps:[{at, action, to?, via?, target?, for?}]}`.<br>**Actions:** idle, walk, run, wave, point, sit, look, talk, react, panic, fall, cheer, clap, jump.<br>**Anchors:** named spots `{pos, facing?, seat?}`. Unknown names throw `ActorScriptError`, listing the valid names (ready for a repair prompt).<br>**`planActor`:** timed segments. A busy actor delays its next step, with a warning. Accelerate/cruise/decelerate profile, smoothed corners, turns, posture state (stand/sit/down), seats.<br>**`poseAt(plan, t)`:** a pure function returning position, yaw, up to two clip layers whose weights sum to 1, and overlays.<br>**Also:** `actorSubject` (for the camera's shot solver), `aimPoint` (look/point at another actor's head). |
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
1. **Actors in the world.**
   - Write `cityAnchors(place, layout)`, giving named spots from the generated city: avenue, sidewalk-north/south (and ±20 m east/west), plaza, park, landmark front.
   - Ground heights: sidewalk 0.04, avenue 0.12, plaza 0.18, park 0.2. The avenue runs along x at z = 0; its half-width is `style.avenue/2` and the sidewalk width is `style.avenueWalk`.
   - Add a `WorldActors` composition: `GroundWorld` plus `ActorsLayer`.
   - Note: the world's sun shadow covers ±260 m, so actor shadows are soft blobs at street level.
2. **Director block.** `actorDirectorContext(anchors)` prompt text (`ACTION_HELP` plus anchor names), validation of each script with `planActor` errors as repair prompts. Not wired into `src/generator/pipeline/director.ts`: other chats own that file (Phase 3, then Phase 6 step 1).
3. **A video check** of `ActorStage` (15 s), watching for foot sliding, crossfades and turns in motion. Only stills have been checked so far.
4. **Atmosphere** (per the decisions above), as new files in `src/world/atmosphere/`: mood palette (toon), particles, outdoor light shafts, sky dome with cloud layers plus mesh clouds, Gerstner water, height fog. Then stills per mood. Opt-in per scene, nothing global.
5. **River axis fix** in `src/compositions/RiverStage.tsx`:
   - The bank plane is `[length + 20, width + 8]` (long along x), while the water, rocks and the default `flowDir: "z"` run along z.
   - The camera's `angle` is π/2 for z, so it looks sideways (+x).
   - Fix: size the bank by `flowDir`, and look along the flow.
   - Check with the Phase 3 chat first: it is adding camera anchors to every stage.
6. **Optional: UAL clip bake** (offline, Node) onto the CharacterArmature people. Gives sit, talk, crouch and get-up to models that lack them.
7. Docs: tick Phase 5 in PROGRESS.md and record the milestone stills.

**Not Phase 5:** the Interior camera bounds belong to Phase 3 (per-stage `ShotCamera` anchors, in progress in another chat). Crowds of pedestrians are Phase 6 step 3; they reuse `ActorsLayer`/`rig.ts`.
