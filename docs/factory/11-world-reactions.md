# 11 — World reactions: places that react to the story (research and proposal, 2026-10-27)

Phase 6 step 5 ("what if" world events) and Phase 7 item 7 ("the world reacts") in [05-plan.md](05-plan.md) both say the world places must physically change when the story does. Today they don't. This note covers why, what the reference does, what exists to build on, and a plan. It is a proposal only: no code was written.

The code was read at commit b65f220 plus the working tree of 2026-10-27, where other chats are editing `src/world/`, `src/generator/camera/` and `src/compositions/`. Line links point at that state. The web findings are third-party claims checked against their pages on 2026-10-27, not tested here.

## Recommendation in short
- **Build it ourselves, on closed-form motion.** Every reaction is a formula of (spec, scene, frame): nothing is integrated step by step and nothing is kept between frames. No physics engine and no particle library goes into the render.
- **Adopt assets, not engines.** Use the CC0 models already in the world catalog for debris (crates, barrels, planks, bricks, rubble, coins, Kenney Car Kit debris, the market's own stalls). Download Kenney's CC0 Particle Pack and Smoke Particles for dust puffs.
- **Borrow algorithms:**
  - stateless particles (Latta 2004);
  - the flutter and tumble motions of falling paper (Andersen, Pesavento & Wang 2005);
  - Worley-noise cracks (Gustavson's MIT GLSL);
  - slope-based snow cover (Ohlsson & Seipel 2004);
  - the darker look of wet walls (Lagarde);
  - three's own `ConvexObjectBreaker`, for breaking buildings into chunks later.
- **One new director choice.** The counter gets a required `react` field when it plays over a world scene, and a few new world events (gravity off/on, ground break, snow start/stop). The director chooses them, so the intent-audit rule holds: nothing appears unless the AI chose it ([10-intent-audit.md](10-intent-audit.md)).
- **Effort: about 15 working days for everything, in three milestones.**
  - **A (about 5.5 days):** every stat beat in every place moves the world: things lift, confetti, money.
  - **B (+4.5 days):** the ground cracks and breaks apart, and the lights go out (the reference's night frames).
  - **C (+5 days):** water rising, snow, whole buildings lifting, the gate review.

## Status (2026-10-29, later): the camera stays on the reactions
- **Shots hold on a reaction** (`pipeline/shots.ts` `holdReactions`): when a strong counter step (a quarter level or more) or a world event lands in a shot filming the place (plaza, avenue, sidewalk, park; the whole-place shot too for water, snow and dark), that shot runs on 2.5 s past it, never past its scene; the next shot starts later or is folded in. The Paris plaza WS used to cut away 0.8 s after the 16x beat. Applies to plans made from now on.
- **The world camera is safe** (`camera/world.ts`, `solveWorldShot`): in a lift scene the lifting buildings' envelopes (grown by the 1.5 m hide distance) are keep-outs and each shot keeps its original framing when it stays clear, else is steered, else rises over the envelopes, so a building never vanishes as it lets go (popping shots in the sweeps: New York 1,708 to 0, Cairo 3,438 to 0); in a flood every lens stays at least 0.4 m over the water, held per shot. Without either reaction every pose is identical to before; the Paris video's own shots don't change. Left: the last-resort rise can turn a low shot into a high one (189 Cairo and 36 New York sweep shots rise more than 5 m); the flight camera doesn't use these yet.

## Status (2026-10-29): milestone C done (every reaction in the brief)
- **Water** (`water.ts`, `waterShader.ts`, `waterLayer.tsx`): a flood plane at the counter's level (2.5 m at 16x, reached within 0.5 s), foam at the waterline and walls darker below the high-water mark (a closed-form running max: it never goes down); ponds, the fountain pool and the coast drain for a falling counter or `water-vanish`, with mud beds. Every world surface carries the patches in every scene (uniforms at rest change nothing). `lensFloorPlan` (surface + 0.4 m) is ready for the camera.
- **Snow** (`snow.ts`, `snowShader.ts`, `snowLayer.tsx`): cover by slope times level with a noise breakup (patches at 1.75x, a blanket at 16x, a dusting on mansards; far cards get a band at the top); snowfall as a camera-relative GPU volume (6,000 flakes, 2,000 beside confetti to stay in budget); `snow-start` falls first and settles over 8 s.
- **Buildings lifting** (`buildings.ts`, `buildingsShader.ts`): at strong lift (level 0.75 to 0.95 by distance), up to 12 buildings nearest the epicentre rise a few metres and lean toward their street, about the front edge of their base (no clipping of party walls), and fall back with a small bounce on gravity-on. Kit cities move a building's instances through a KitInstances hook (forced into the near set); box cities through a vertex patch keyed by building; lifted buildings get closed undersides.
- **Found on the way:** materials with identical settings shared one compiled program (three's default key), so the fountain pool was drawn with the far disc's shader (flat teal, no ripples); patches now freeze a material's default key first, and the pool shows its water look.
- **Checked:** no-reaction stills byte-identical to before (except the fixed fountain pool), deterministic frames, motion strips without pops; 485 tests. Evidence: `out/reactC-water-snow/` (`SHEET-water.png`, `SHEET-snow.png`, `SHEET-drain-rise.png`), `out/reactC-buildings/final/` (`compare-ref.png` and the rest).
- **Still differs:** the director's edit decides whether a reaction is on screen (the Paris video cuts away 0.8 s after the 16x beat, so its buildings rise off screen); buildings let go 0.45-0.85 s after the beat and lift a few metres (subtle in wide shots); a lens within 1.5 m of a lifting building hides it at once (a pop: the camera should keep clear using `buildingClearance`, not wired); the flood's lens floor is not in the camera yet; Cairo's flood was a square lake from high (the city's exactly flat square met the dunes at its straight sides; since 2026-11-04 a level foot of noisy width blends the pad into the land, so the shore follows the land's contours 0.7 to 2 km out, [06-world-engine.md](06-world-engine.md#dressed-places-phase-7-gate-item-3-2026-11-04)); snow at noon has low contrast under the golden grade; a half-drained fountain already looks dry; no floating debris on the flood.
- **Render time:** a 15 s stretch of the Paris video (WS through the flight into Cairo, concurrency 6) takes 188-207 s with or without a reaction, over milestone 6's 123 s bar: the reactions add nothing measurable, the base scene is the cost. Fixed the same day (the flight rebuilt its city every frame, and the stage was drawn under it): 229 to 112 s on a quiet machine ([06-world-engine.md](06-world-engine.md#main-video-render-speed-phase-6-2026-10-29)).

## Status (2026-10-28): milestone B done
- **The ground cracks, then breaks** (`crack.ts`, `slab.ts`, `slabMesh.ts`, `slabDust.ts`, `SlabReaction.tsx`, `crackGround.ts`): Worley cracks (Gustavson's MIT cellular noise) spread over the ground from the epicentre with the counter's level; at the break level or a `ground-break` event the plaza (or the avenue stretch where there's none) breaks into about 1,050 slabs clipped to its outline, one skinned mesh with a bone per raft (one draw call plus shadow), released as the break front passes, popping then rising and tumbling in closed form, over a dark soil pit. Market stalls ride their slabs; fountain, benches and poles stand on held slabs; dust puffs on the GPU. The plaza now shows the slab grid's paving at rest in every world scene.
- **Lights out** (`dark.ts`, `darkShader.ts`): windows (kit pieces, far cards, box-city walls through a new per-building attribute), lamp heads and pools go out building by building in a wave from the epicentre, each with a brief deterministic flicker; sun or moon, sky light, dome, haze and fog dim with the global power (the user's decision: by day too). The wave cascades with the counter's level (1.75x darkens the plaza's ring, 16x the whole city within 1.6 s); a `lights-out` event spreads at 60 m/s and finishes with the sky over 2.5 s. Scenes without a reaction render byte-identical to before.
- **Checked:** 18 crack and 16 dark tests; frames byte-identical across tabs and orders; motion strips around the beats; the photographer's "dark" limits pass on every blackout still (Paris night 0.029 mean, by day 0.152). Evidence: `out/reactB-crack/`, `out/reactB-dark/`.
- **Still differs from the night references:** fixed the same day: moonlit nights (`atmosphere/moon.ts`, `stars.ts`: a moon key with shadows, a moon disc, stars), clouds dimming in a deep-night blackout, flights passing the reaction, the photographer judging counter blackouts as dark. Left: a blackout at night goes nearly black by the user's rule; only the plaza or the avenue stretch breaks (the reference breaks out to the hills); landed coins and confetti stay at plaza height when their slab flies.

## Status (2026-10-28): milestone A done
Every counter beat over a world place now moves it: things lift, confetti bursts, money rains. Built and checked on the dev laptop (fixtures, no key).
- **Pipeline:** `statPanel.react` and five new place events in the schema; the director must choose `react` when a counter step falls in a world scene (re-asked otherwise); the assembler keeps water and lights events in places and gives each counter step its reaction's sound (`REACT_HIT`); `reactionAt`/`reactionPlan` in `src/world/react/reaction.ts`. A falling counter reacts by the size of its fall (`v0 / v`), and water drains for one.
- **Effects** (`src/world/react/`): `lift.ts` + `rigid.ts` + `RigidReaction.tsx` (debris and the market's own stalls rise at a speed that follows the level squared, with a hop on big steps; gravity-on falls and bounces back upright), `particles.ts` + `ReactionParticles.tsx` (GPU confetti, generic banknotes, lift chips; one draw call each, stateless). **Gravity-on lands everything within about 1.5 s** (2026-11-05): a piece or chip that would fall longer than 0.8 s is pulled down harder to touch down in 0.8 s, from above 12 m a little later so it never lands faster than 30 m/s (1 m a frame), and bounces no higher than off a 3.1 m drop (lift.ts `DROP_LAND_MAX`, `DROP_SPEED_MAX`, `fallPlan`; the chips' shader the same). Before, the chips drifted down at about 1 m/s for up to 25 s and the pieces fell freely from up to 20 m and bounced 2 m: the bullet-time test's litter was still falling 3-4 s after gravity-on, into the next scene. After a 2 s lift everything is down by 1.34 s, after a 6 s lift 95 % by 1.64 s (the highest by 1.89 s), settled by 2.4 s; `debris.ts` (260 CC0 props, coins and coin piles), `textures.ts` (procedural note and confetti atlases), `ReactionLayers.tsx`, and `ReactionsPreview*` compositions in `src/world/Root.tsx`.
- **Hook-up:** `GroundWorld`'s `reaction` prop (spec, scene, video time) mounts the layers with the city's real layout, fog and mood; with lifting it draws the market through the reaction (at rest exactly where it stood). `WorldStage` passes it.
- **Checked:** in the Paris money video set to each reaction, the 16x beat reads within 0.5 s (debris 95% at least 0.3 m up, median 0.9 m; stalls median 0.86 m) and the earlier 1.75x beat only hovers. A frame-by-frame audit at 30 fps (the shader has a TypeScript mirror) found five pops (burst and ambient particles appearing at full size, confetti snapping flat on landing, coins appearing mid-air, a coin pile jumping), all fixed in closed form; no faults left, gravity-on included. Frames are byte-identical across tabs and orders, after fixing `Flags.tsx` (it read its rest shape from flag 0's own geometry, which the loop overwrote, so the droop piled up per tab).
- **Budget:** chips 4,000 in a lift scene (no confetti there), confetti 6,000, notes 3,000; at most about 400 CPU matrices per frame.
- **Evidence:** `out/react-check/` (`before-after-916.png`, `final-169.png`, `final-11.png`, `steady-preview.png`, `grav/sheet.png`, `strips/`, `determinism/`). Tests: 55 in `src/world/react/`, plus the director, assembler and chunk-key tests.
- **Still differs from the reference:** the air below empties as lifted things keep rising (nothing new releases after the last beat); no floating people (the crowd is off); no fountain jet; stalls lift whole; confetti chips are flat quads, a little larger and squarer than the reference's; the director's shots decide whether the plaza is in frame at the beat (the prompt now asks for a wide or low shot over it).
- **Next:** milestone B (the ground cracks and breaks into slabs; lights out per building), then C.

## 1. Where we are

**World scenes get no story signal.**
- [WorldStage.tsx:101-109](../../src/compositions/WhatIfVideo/WorldStage.tsx#L101-L109) passes `place`, `pose`, `fov`, `cloudPassage`, `cast` and `mood` to `GroundWorld`. It passes no counter, no world events and no weather.
- [GroundWorld](../../src/world/Ground.tsx#L197-L242) has no prop for any of them.
- Nothing under `src/world/` mounts the `WeatherLayer`. So even a `rain-start` that the assembler accepts for a world scene ([assemble.ts:292](../../src/generator/pipeline/assemble.ts#L292) sets `look.weather`) shows no rain in a place.

**The assembler drops the rest.**
- `WATER_KITS` and `LIGHTS_KITS` ([assemble.ts:37-38](../../src/generator/pipeline/assemble.ts#L37-L38)) don't include `"world"`. Water events and `lights-out` in a place are dropped with a warning ([assemble.ts:286-290](../../src/generator/pipeline/assemble.ts#L286-L290)).
- The hero prop is kept only when a street-block scene exists ([assemble.ts:275](../../src/generator/pipeline/assemble.ts#L275)).
- The director's prompt lists world events by kit only ([director.ts:272](../../src/generator/pipeline/director.ts#L272)).

**A concrete case.** In `output/what-if-money-doubled-every-3-seconds-in-paris`, the third counter beat (t 12.97 s, value 1048576, `scale` 16) falls in the Paris scene (11.03 to 19.93 s). The HUD jumps to a million and the plaza does not move. This is exactly the "no number change without a physical change" that gate item 7 forbids.

**The signal already exists.**
- `StatBeatSchema.scale` (1..16, set by the assembler, [spec.schema.ts:71-73](../../src/generator/spec.schema.ts#L71-L73)) is the counter's size for the world.
- `statScaleAt` ([statPanel.ts:37-40](../../src/generator/statPanel.ts#L37-L40)) reads it.
- The older stages use it as follows:

| Stage | Reacts to the counter | Reacts to world events |
|---|---|---|
| Space | planet size | — |
| Ocean | water level and wave height ([OceanStage.tsx:100-124](../../src/compositions/OceanStage.tsx#L100-L124)) | water-vanish / water-return (drain, then refill with an overshoot), lights-out |
| River | river level | water-rise, lights-out |
| Street | hero-prop count and height ([StreetStage.tsx:1926-1950](../../src/compositions/StreetStage.tsx#L1926-L1950)), camera zoom | lights-out (key light 0.04, fill 0.3, [StreetStage.tsx:227-235](../../src/compositions/StreetStage.tsx#L227-L235)) |
| Forest, Countryside | camera zoom only (1 + 10–12 % of the scale) | lights-out |
| AssetStage | — | gravity off/on: a closed-form float, fall and squash ([AssetStage.tsx:196-215](../../src/compositions/AssetStage.tsx#L196-L215)) |

The reactions worth porting are the Ocean drain/refill curve, the AssetStage gravity arc and the Street lights-out values. The zoom-only reactions are too weak for the reference.

## 2. What the reference shows
Read from the four gravity-town frames in [quality-refs/](quality-refs/README.md):
- **[ref-gravity-confetti](quality-refs/ref-gravity-confetti.jpeg)** has three layers:
  - Thousands of small coloured chips (round and flat) fill the sky through the whole depth.
  - Larger debris tumbles among them: striped awning panels, crates, parasol discs, poles.
  - Stalls lift off the paving. A white jet rises from the fountain, and people are in the air.
  - The reaction covers the whole frame, not one row of props.
- **[ref-gravity-night-breaking](quality-refs/ref-gravity-night-breaking.jpeg):** the paving is still whole. Objects and people float overhead, and their shadows lie on the plaza. The shadows matter: they show how high the things are.
- **[ref-gravity-night-ground](quality-refs/ref-gravity-night-ground.jpeg):** the paving breaks into **square slabs**, each carrying the paving pattern. They rise and tumble toward the camera and fill the lower two-thirds of the frame. These are not fracture shapes: it is a grid of tiles lifting off.
- **What none of the frames needs:** collisions. Things rise, drift and spin; nothing lands, piles up or knocks into anything else.

**What follows from this.** The whole reference can be drawn with closed-form motion: "released at time r, rises with this speed, spins about this axis". That is cheap, exactly repeatable, and needs no solver.

## 3. Prior art

### Libraries

| Library | Licence | What it is | Verdict |
|---|---|---|---|
| Rapier (`@dimforge/rapier3d`, `-deterministic` and `-compat` builds, 0.19.x) | Apache-2.0 | Rigid-body physics in WASM. Its docs say the JS build is "fully cross-platform deterministic" given identical setup, and warn that `Math.sin`/`Math.cos` setup values can break that. | **Not in the render.** Stepping is stateful, and Remotion renders frames out of order in several tabs, so each frame would have to re-simulate from the event start. Keep it as the fallback for one future need: things falling back and piling up with real collisions, baked offline into keyframes at plan time. |
| `@react-three/rapier` | MIT | R3F binding for Rapier | No: steps on the R3F clock. |
| cannon-es | MIT | JS physics | No: stateful, and determinism is not guaranteed. |
| three-pinata (dgreenheck) | MIT, three ≥ 0.158 | Voronoi and plane fracture of meshes in the browser. No physics needed; it suggests pre-fracturing and hiding the pieces. | **Borrow later**, for buildings breaking into chunks: fracture once in `useMemo` with seeded points, then move the pieces in closed form. The reference ground doesn't need it. |
| three `ConvexObjectBreaker` | MIT, already in `node_modules/three/examples/jsm/misc` (r178) | Cuts a convex mesh by planes | **Borrow later**, same role, with no new dependency. The box-city walls are boxes, so they are convex. |
| three.quarks | MIT | VFX particle system, `batchRenderer.update(delta)` | No: integrates per frame from a clock, with no documented seek. |
| drei `Sparkles` (drei 10.7.9) | MIT | Sparkle points | No: its time comes from `state.clock.elapsedTime` (checked in `node_modules`). |
| canvas-confetti, react-dom-confetti | — | 2D DOM/canvas confetti fired by an event | No: 2D, so it can't pass behind buildings or debris, and it is not frame-locked. |
| three `Water` / `Water2` | MIT, in three's examples | Reflective and refractive water using extra render passes | No: renders the scene again per frame. Our `waterMaterial` ([atmosphere/water.ts](../../src/world/atmosphere/water.ts)) already fits the low-poly look. |
| maath (installed) | MIT | Easing and random helpers | Not needed: `makeRng` and Remotion's `random` cover it. |

**Our own code to reuse:**
- `patchMaterial` ([atmosphere/patch.ts](../../src/world/atmosphere/patch.ts)) chains `onBeforeCompile` patches, with all variation on uniforms.
- The tree sway ([sway.ts:26-32](../../src/world/atmosphere/sway.ts#L26-L32)) shows how to get a per-instance phase from `instanceMatrix[3]` on the GPU.
- The camera-relative rain volume ([weather.tsx:75-122](../../src/compositions/weather.tsx#L75-L122)) wraps world-fixed drops round the render camera and fades them near the lens.
- The curves listed in section 1: the Ocean drain/refill, the AssetStage gravity arc, the Street lights-out values.

### Research
- **Stateless particles** (Lutz Latta, "Building a Million Particle System", GDC 2004): a stateless system computes each particle's state from its start values and the current time; a state-preserving one integrates. Stateless is exactly the render rule we need.
- **Falling paper** (Andersen, Pesavento & Wang, "Unsteady aerodynamics of fluttering and tumbling plates", J. Fluid Mech. 541, 2005): freely falling plates, about the size of a leaf or business card, either **flutter** (rock side to side while sinking) or **tumble** (turn end over end while drifting). This gives the two parametric modes: banknotes flutter (rock ±40°, sway sideways, sink slowly), confetti tumbles (steady spin, faster).
- **Snow cover** (Ohlsson & Seipel, "Real-time rendering of accumulated snow", SIGRAD 2004): snow per pixel from the surface slope, times an occlusion term from a shadow-map-like depth view from above. Borrow the slope term; skip the occlusion map for now (it costs an extra depth pass).
- **Wet surfaces** (Sébastien Lagarde, "Water drop 3a/3b – Physically based wet surfaces"): wet materials are darker, and he changes the dry material's parameters instead of adding a lighting model. Use it for the high-water mark after a flood.
- **Crack lines:** Stefan Gustavson's `webgl-noise` (MIT) includes cellular (Worley) noise in GLSL. Cracks are drawn where F2 − F1 is small, a standard Voronoi-edge trick.

### CC0 assets
- **Already installed** (world catalog, 4,030 assets, all CC0 except the Poly Pizza landmarks):
  - Kenney Car Kit `debris-*`: 20 pieces (bolt, bumper, door, drivetrain...).
  - KayKit Dungeon `rubble-*`: 3. KayKit Resource Bits: bricks, stone and planks.
  - Coins and coin piles: 7 (KayKit and Quaternius).
  - Crates: 31. Barrels: 27. Trash: 8.
  - KayKit Holiday: snowball piles.
  - The market's own pieces: Paris has 32 stalls and 141 pieces ([quality-refs README](quality-refs/README.md)).
- **To download:** Kenney Particle Pack (80+ sprites) and Kenney Smoke Particles (77 sprites, five styles), both CC0, for the dust puffs where slabs break off and for splash spray. They can be added to the existing asset download script.
- **Banknotes:**
  - No CC0 banknote from Kenney or Quaternius was found. A Poly Pizza search for "money" shows cash models by other authors, with licences not shown on the results page.
  - **Build it instead:** a flat quad with a texture drawn once on a canvas: border, central oval, corner blocks, three colourways, no text.
  - It must stay generic and must not copy any real currency's design.
- **Confetti and water:** no asset needed (procedural quads; our water material).

## 4. Design

### 4.1 One signal per scene: `reactionAt`
A pure function, new under `src/world/react/` (or wherever the world owner prefers):

```
reactionAt(spec, scene, t) → {
  lift, crack, snow, power: 0..1,     // eased levels
  water: metres above the street,
  front: metres,                      // how far a break or blackout wave has spread from the epicentre
  bursts: { t, gain }[],              // one per counter beat, for impulses (static per scene)
}
```

**From the counter** (the director's `react` choice):
- Each beat's `scale` (1..16) becomes a level `L = log2(scale) / 4`. So 1 gives 0, 2 gives 0.25, 4 gives 0.5 and 16 gives 1: every doubling is a visible step.
- The level eases from the previous beat's value over 0.4 s (ease-out cubic). The step is therefore complete inside the 0.5 s gate of item 7.
- Secondary motion (drift, spin, settling) carries on after the step, so the picture never freezes.
- The existing `statScaleAt` steps and `statZoomAt` blends over 0.9 s, which is too slow for the gate. That is why the reactions get their own eased curve.

**From world events:** each event is a ramp with its own length. Examples: gravity-off ramps `lift` to 1 over 2 s; water-rise ramps `water` to 2.5 m over 4 s; lights-out runs the blackout wave out from the epicentre.

### 4.2 Two ways to draw, chosen by whether the thing casts a shadow
- **Rigid things on the CPU:** stalls, debris models, coins, slabs, whole buildings.
  - Each frame, every instance matrix is rebuilt from its rest matrix plus `f(t)`, never from the previous frame.
  - A few thousand matrix compositions take well under a millisecond.
  - Shadows come for free, and the reference's floating-object shadows need them.
  - `buildKitNear` already rewrites instance buffers in `useFrame` ([KitInstances.tsx:234-290](../../src/world/KitInstances.tsx#L234-L290)), so the pattern is there. A per-placement transform hook on `KitInstances` lets the market and debris move. Because the hook works per placement, a multi-part stall moves as one piece (the part matrix stays relative to it).
- **Particles on the GPU:** confetti, banknotes, snowflakes, dust puffs.
  - One instanced mesh per kind. Per-particle seeds are attributes. The motion is a vertex-shader formula of `uTime` and the burst uniforms.
  - Each kind is one draw call with no CPU work per frame.
  - There are no shadows, as with the tree sway: the shadow pass doesn't see vertex displacement unless the depth material is patched too.

### 4.3 Determinism rules (every reaction must pass)
1. **A pure function of (spec, scene, frame):**
   - Seeds come from the place id and the reaction kind (`makeRng(\`${place.id}:react:${kind}\`)`), like the layout's.
   - No `Math.random`, no clock, no state carried between frames.
2. **Closed form, not integration.**
   - Release time, rise, spin and fall are formulas.
   - A bounce after landing is closed form too: with restitution e and landing speed v, bounce k lasts 2eᵏv/g, and the whole sequence settles after 2ev/(g(1 − e)).
   - This also sidesteps the cross-machine float worry the Rapier docs raise. A formula doesn't amplify a last-bit difference; a stepped chaotic simulation does.
3. **Uniforms only in shaders.** The GLSL text stays identical for every instance ([patch.ts](../../src/world/atmosphere/patch.ts) rule). Every reaction uniform defaults to 0, so a scene without a reaction looks exactly as it does today.
4. **Bounds.** `buildKitInstances` computes each mesh's bounding sphere once, at rest ([KitInstances.tsx:196-203](../../src/world/KitInstances.tsx#L196-L203)). A lifted stall could be culled while still on screen. Moving instanced meshes either recompute it per frame from the formula's envelope or set `frustumCulled = false`.
5. **The chunk cache is already right.**
   - [render/plan.ts:251-253](../../src/generator/render/plan.ts#L251-L253) keys each chunk on every world event and stat beat up to the chunk's end. A reaction whose debris is still in the air in a later chunk therefore invalidates that chunk.
   - `statPanel` minus its beats is in the static key ([plan.ts:273-275](../../src/generator/render/plan.ts#L273-L275)), so a new `statPanel.react` changes every chunk, which is correct.
   - The plan code needs no change; it only needs a test that says so.
6. **Repeatability check:**
   - Unit tests: `reactionAt` gives the same output whatever order frames are asked in.
   - Visual: render the same frame twice and compare hashes (already the practice in [05-plan.md](05-plan.md#verification)).

### 4.4 Where the reaction happens
Each scene has a fixed epicentre:
- **The main plaza when the place has one** (Paris, Colmar: the market's plaza, `cityMarket` / `openBlocks(layout, GROUND.plaza)`).
- **Otherwise the avenue's middle stretch** (Cairo, New York; the `avenue` anchor in `cityAnchors`).

It stays fixed for the whole scene, so a shot change never moves it. Release delays and blackout waves spread from it (`delay = distance / front speed + seeded jitter`). The director is told to film reaction beats wide or from a low angle over that spot.

## 5. The reactions

| Reaction | Looks like | How | Adopt / borrow / build | Effort |
|---|---|---|---|---|
| **Things lifting** (`lift`, gravity-off/on) | Stalls, parasols, crates, benches and litter rise and tumble. More rise and they go higher with each beat. Gravity-on drops them back with a short bounce. | CPU rigid instances: market placements, plus up to about 400 catalog debris pieces scattered on the plaza or avenue at rest, plus about 2,000 small chips on the GPU. Release fraction = level; rise = v·(τ − τ₀(1 − e^(−τ/τ₀))), a smooth start then steady drift; seeded axis spin. Gravity-on: a closed-form fall from the height at that moment, then a bounce. Ports the AssetStage arc. | Build. Borrow: AssetStage arc, catalog debris (CC0). | 2 d |
| **Confetti** (`confetti`) | Coloured paper chips burst at each beat and fill the air. | GPU stateless particles: about 6,000 opaque two-sided alpha-tested quads (opaque avoids sorting). Burst particles start at the beat from the epicentre; an ambient layer is a camera-relative wrapped volume like the rain. Tumble mode. Fades within 1.5 m of the lens. | Build. Borrow: Latta (stateless), Andersen et al. (tumble), the rain volume. | 1.5 d (shared with money) |
| **Money** (`money`) | Banknotes flutter down; coins rain and pile up in the plaza. | The same particle layer in flutter mode with the generic note texture (about 1,500). Coins: catalog coin models as rigid debris that fall, bounce and stay. Catalog coin-pile models placed at plaza spots grow with the level (the street hero prop, ported to places). | Build. Borrow: Andersen et al. (flutter), catalog coins (CC0). | +0.5 d |
| **Ground cracking, then breaking** (`crack`, ground-break) | Cracks race out over the paving and streets. At level ≥ 0.5, or on ground-break, the plaza breaks into square slabs that rise and tumble, with dark soil showing underneath and stalls riding up on their slabs. | **Cracks:** a patch on the shared ground material (rects, roads and areas share one, [Ground.tsx:269-272](../../src/world/Ground.tsx#L269-L272)). Worley F2 − F1 < width, masked to within the crack front's radius of the epicentre. **Slabs:** a grid of about 2 m cells clipped to the plaza polygon (an avenue stretch where there's no plaza), one instanced box mesh (about 900 slabs for a 60 m plaza), in the plaza's colour ±4 % with joint lines. A slab releases as the front passes, then rises and tumbles. Each market piece rides the slab under it. While breaking is in the scene, the plaza polygon is left out of the area mesh and a dark soil pit sits under the grid (static per scene). Dust puffs: Kenney smoke sprites, one per ten slabs, expanding and fading over 1.5 s. | Build. Adopt: Kenney Particle Pack and Smoke Particles (CC0). Borrow: Gustavson's cellular noise (MIT). | 3 d |
| **Water rising** (`water`, water-rise/return/vanish) | The streets flood higher with each beat. There's a foam line where the water meets walls, loose things float and bob, and walls stay darker below the high-water mark after it drains. | A plane the size of the terrain (9 km half-size) at y = h(t) with the existing `waterMaterial`. It meets the rising hills beyond the city on its own, so the shoreline is natural. A patch on walls, roofs, props and kit materials: a foam band where the height is within 0.12 m of h, and darker and glossier below the highest h so far (a closed-form max of the curve, so still pure). Ponds, fountain pool and coastal ocean follow h; vanish drains them (the Ocean curve). | Build. Borrow: Ocean drain curve, Lagarde wet look. | 1.5 d |
| **Lights out** (`dark`, lights-out) | Windows and street lamps go out block by block in a wave from the epicentre, each with a brief flicker. The sky, sun or moon and the fill light dim like the kit stages'. | A `uPower` uniform with a per-instance threshold. Kit window glow is already a separate additive instanced mesh, and `buildingOfPlacement` ([kitLod.ts:86](../../src/world/kitLod.ts#L86)) gives each placement its building, so it becomes a per-instance attribute. Lamp heads and pools carry an index along the avenue. The flicker is a hash of (building, frame/2). Sun, hemisphere light and sky-dome colour dim to the Street values (key 0.04, fill 0.3). The merged box-city walls get one global dim until `buildingsGeometry` carries a building index. | Build. Borrow: Street lights-out values. | 1 d |
| **Snow** (`snow`, snow-start/stop) | Snow falls, then whitens the ground, roofs, tree crowns and the tops of props as the level rises. | Snowfall: the rain's camera-relative GPU volume with snow parameters (0.8–1.5 m/s, sideways sway). The current `WeatherLayer` snow is 200 CPU points in a fixed 140 × 55 m box round the origin ([weather.tsx:208-238](../../src/compositions/weather.tsx#L208-L238)), too small for a city. Cover: a patch on every world material, mixing toward snow white by smoothstep(world-normal·up) × level, with noise breakup. The far kit cards get a band at the top, since their normals face the camera. | Build. Borrow: Ohlsson & Seipel (slope term), rain volume. | 1.5 d |
| **Buildings lifting** (strong `lift`, level ≥ 0.75) | Whole kit buildings near the epicentre rise a few metres and tilt. | CPU: every placement of building j gets the same offset (from `buildingOfPlacement`). Those buildings are forced into the near set for the scene (`lodPath` / `nearMask`), because the far cards don't move. The merged box-city buildings stay put for now. Breaking buildings into chunks later uses `ConvexObjectBreaker` or three-pinata, fractured once and seeded. | Build. Borrow later: ConvexObjectBreaker / three-pinata (MIT). | 1.5 d |

**Rough budget per scene at the highest level** (to check against the render-time gate):

| Kind | Instances | Draw calls |
|---|---|---|
| Confetti or banknotes | up to 6,000 | 1 |
| Chips | 2,000 | 1 |
| Rigid debris | up to 400, from about 15 model files | 15–30 (with shadows) |
| Slabs | up to 1,200 | 1 (+1 shadow) |
| Flood plane | 1 | 1 |

CPU work is at most about 3,000 matrices per frame.

**Out of scope here:**
- People floating off: the crowd and featured actors are off by the user's decision. The same closed-form lift applies to them once they return.
- Time-lapse and "the sun never sets": Phase 6 step 4.

## 6. Pipeline changes (for the implementing session)
- **Schema** ([spec.schema.ts](../../src/generator/spec.schema.ts)):
  - `StatPanelSchema` gets `react?: "lift" | "crack" | "confetti" | "money" | "water" | "snow" | "dark"`.
  - The `worldEvents` name enum ([spec.schema.ts:421-428](../../src/generator/spec.schema.ts#L421-L428)) gains `gravity-off`, `gravity-on`, `ground-break`, `snow-start` and `snow-stop`.
  - `WORLD_EVENTS` in [knowledge.ts:49](../../src/generator/ai/knowledge.ts#L49) gains the same names.
  - Kit stages ignore `react` and keep their own reactions.
- **Director** ([director.ts](../../src/generator/pipeline/director.ts)):
  - The counter's text ([L269](../../src/generator/pipeline/director.ts#L269)) gains `react`, with one line of meaning each:
    - lift: weightless, gravity, lightness
    - crack: pressure, quakes, the earth itself
    - confetti: celebration, fame, likes
    - money: wealth, prices, cash
    - water: sea level, floods, rain
    - snow: cold, winter, temperature
    - dark: power, energy, darkness
  - The world-events text names what places can show.
  - The existing `essential` check ([L341](../../src/generator/pipeline/director.ts#L341)) rejects a counter without `react` when any of its steps falls in a world scene, so the repair loop asks again. This makes gate item 7 an AI choice that can't be skipped, never an assembler invention.
  - `normalizeDirector` fuzzy-matches the new field like the others.
  - One shot hint: film a reaction beat WS/EWS or low over the epicentre.
- **Assembler** ([assemble.ts](../../src/generator/pipeline/assemble.ts)):
  - Add `"world"` to the water and lights sets.
  - Carry `react` onto `statPanel`.
  - Give each `counter-i` event in a world scene a hit sound per reaction instead of the bare `pop_light` ([L250](../../src/generator/pipeline/assemble.ts#L250)). The CC0 library has whoosh (3), coins (2), splash (2), power (12), snow (5) and glass (26) tags, plus `rumble_deep` and `thunder_crack` in `sfx/`. A rubble or crack sound is a gap; BigSoundBank's destruction category is already in the Phase 1 source list.
  - A new test: every counter beat inside a world scene maps to a reaction.
- **Composition:**
  - `WorldStage` passes `reactionAt(spec, scene, ·)` and the scene's weather to `GroundWorld`, and mounts the weather layer. The weather layer is a separate small fix that also makes `rain-start` work in places today.
  - `GroundWorld` exposes the material list for patches, the market placements and plaza polygon, the building index, and the lamp group to a `ReactionsLayer`.

## 7. Coordination with the other chats
These files belong to other chats right now:
- `src/world/` (Ground, KitInstances, market, kitLod)
- `src/generator/camera/` (the new `occlusion.ts`, the world anchors)
- `src/compositions/` (WorldStage, weather)

The reaction modules can be written as new files with tests first. The hooks into Ground, KitInstances and WorldStage are small but must wait for those owners or be agreed with them.

Three camera interactions to settle with the camera owner:
1. **The lens and flying debris.** For v1, rigid debris fades out within 2 m of the render camera. That is pure, because the camera pose is pure. Later, `reactionBlockers(t)` lets `occlusion.ts` see lifted stalls where they are instead of at rest.
2. **The lens and water.** The lens must stay at least 0.4 m above h(t). This belongs in the world anchors' ground height.
3. **The market clearance.** Today a lens over the market keeps above `MARKET_TOP` (3.3 m). Lifted stalls pass through that height, so the fade in point 1 covers it until point 1's later step lands.

## 8. Tests and the gate
- **Unit tests:**
  - `reactionAt` is pure and its output doesn't depend on the order of calls.
  - Every counter beat's step reaches at least 80 % of its new level within 0.5 s (gate item 7's number).
  - Instance counts stay within the budget above.
  - No debris is drawn within 1.5 m of a sampled camera pose.
  - Slabs cover the plaza polygon with no gaps.
  - The chunk keys change when `react` changes.
- **Stills** (after each milestone, all three formats):
  - Each reaction at the beat minus 0.1 s and plus 0.5 s, side by side.
  - Then side by side with the three gravity-town frames, as in the first gate comparison ([quality-refs README](quality-refs/README.md)).
- **Render time:** a 15 s Paris world clip with a reaction, against the 1.5 × 82 s gate of milestone 6.

## 9. Plan and effort
One working day = one focused session, including tests and stills review.

| Milestone | Steps | Days | Result |
|---|---|---|---|
| **A** | Plumbing (schema, director, assembler, `reactionAt`, WorldStage → GroundWorld, weather mount): 1.5. Lifting: 2. Confetti and money particles: 2. | **5.5** | Every stat beat in every place moves the world. The Paris money video rains notes and coins at the million beat. Gate item 7 can pass. |
| **B** | Ground cracking and slabs: 3. Lights out: 1. Gate stills: 0.5. | **4.5** | The two night reference frames (breaking ground, blackout). |
| **C** | Water rising: 1.5. Snow: 1.5. Buildings lifting: 1.5. Final gate review and render-time check: 0.5. | **5** | Every reaction in the brief. |
| | | **≈ 15** | |

**Recommended order: A, then B.** A unblocks the gate for every counter. B is what makes the plaza look like the reference. C can wait for a premise that needs it.

## 10. Risks and open questions
- **Shared kit materials.** `KitInstances` shares materials across files. A patch must be applied once per material, tracked with a `WeakSet`. Because uniforms default to 0, `KitPreview` and other users of these materials see no change.
- **Far cards.** The baked far cards don't move or crack. Reactions stay near the epicentre, and lifted buildings are forced near.
- **Box-city walls are one merged mesh.** A per-building blackout or lift there needs a building-index vertex attribute in `meshes.ts`. Until then they get a global dim only.
- **A plain plaza.** The plaza today is one flat colour ([city.ts:610-611](../../src/world/city.ts#L610-L611)). The slab grid, drawn at rest, would also give it real paving joints before anything breaks: a dressing win, if the world owner wants it all the time.
- **Generic banknotes.** The note texture must not imitate a real currency.
- **One more field for the LLM.** `react` is a short enum with meanings and goes through the same fuzzy-enum normalizer and repair loop. Fixture runs (`FACTORY_LLM_FIXTURES`) need a recorded counter with `react`.
- **Decided by the user (2026-10-28):**
  - A counter in a world scene always requires `react`: the director is asked again when it leaves it out (no "still on purpose").
  - `lights-out` in a place dims the sun by day too (the kit semantics): sun or moon, sky, lamps and windows all fade to near-black.
  - Milestone A goes ahead after the 2026-10-27 round is committed.

## Sources
- Rapier JS determinism: https://rapier.rs/docs/user_guides/javascript/determinism ; packages: https://npmjs.com/package/@dimforge/rapier3d , https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-deterministic@0.19.3/README.md
- three-pinata: https://github.com/dgreenheck/three-pinata
- three.quarks: https://github.com/Alchemist0823/three.quarks
- Remotion and R3F (animate from `useCurrentFrame`, not `useFrame`): https://www.remotion.dev/docs/three
- Kenney Smoke Particles (CC0): https://opengameart.org/content/smoke-particle-assets ; Kenney Particle Pack (CC0): https://opengameart.org/content/particle-pack-80-sprites
- Poly Pizza "money" search (licences not shown): https://poly.pizza/search/money
- Gustavson, webgl-noise (MIT, includes cellular noise): https://github.com/stegu/webgl-noise
- Latta, "Building a Million Particle System" (GDC 2004): https://www.cin.ufpe.br/~sbm/CG/Artigo5.pdf
- Andersen, Pesavento & Wang, "Unsteady aerodynamics of fluttering and tumbling plates", J. Fluid Mech. 541 (2005): https://dragonfly.tam.cornell.edu/publications/2005_JFM_Andersen_Pesavento_Wang_a.pdf
- Ohlsson & Seipel, "Real-time rendering of accumulated snow", SIGRAD 2004: https://ep.liu.se/ecp/013/007/ecp01307.pdf
- Lagarde's wet-surface work, as summarised by fxguide: https://www.fxguide.com/?p=43362
