# 17 — Code map: the world and render side (2026-11-03)

This page maps the code that draws a video: the Remotion root, the main composition, the kit stages, the one-world engine (`src/world/`), the look and grade, the HUD, the sound in the composition, and the camera shot vocabulary and solver. It is for a person or an AI session that has to change something here without this session's memory.

**Commit.** Everything below was checked against commit `9381c07` (HEAD on `dev` on 2026-11-03, "Docs: the producer design"). Line numbers in the links are HEAD's. Other chats were editing `src/world/{places,kitTown,landmarks,city,trees,terrain,surface,kits,kitFar,kitWindows,kitLod,meshes}.ts`, `src/generator/camera/*` and `src/world/Traffic*` / `traffic.ts` while this was written, so those files may have moved on; check `git log` on a file before trusting a line number.

**What it replaces.** [04-codebase-map.md](04-codebase-map.md) describes the code of 2026-10-22 and is out of date for this side. The pipeline side (writer, director, assembler, sound design, render, UI, server) is not covered here.

**Where the why lives.** This page says where things are and how they connect. The reasons and the measurements are in the design docs, linked throughout:
[06 world engine](06-world-engine.md), [08 Phase 3 research](08-phase3-research.md), [09 Phase 3 handoff](09-phase3-handoff.md), [09 Phase 5](09-phase5.md), [10 intent audit](10-intent-audit.md), [11 world reactions](11-world-reactions.md), [12 traffic](12-traffic.md), [13 light and time](13-light-and-time.md), [quality-refs](quality-refs/README.md), [HANDOFF](HANDOFF.md), [decisions](decisions.md).

Contents:
1. [How a frame is built](#1-how-a-frame-is-built)
2. [How spec fields reach the world](#2-how-spec-fields-reach-the-world)
3. [File by file](#3-file-by-file)
4. [How-to recipes](#4-how-to-recipes)
5. [Verification practice](#5-verification-practice)
6. [Gotchas and open points](#6-gotchas-and-open-points)
7. [Asset folders the renderer loads](#7-asset-folders-the-renderer-loads)

---

## 1. How a frame is built

### 1.1 From the root to the stage

```
src/index.ts  registerRoot(RemotionRoot)
└─ src/Root.tsx  compositions WhatIfVideo, WhatIfAudio, WhatIfDemo, WhatIfGravityDemo
   └─ WhatIfVideo (compositions/WhatIfVideo/index.tsx), one frame:
      ├─ <ThreeCanvas shadows>                         the 3D picture
      │   ├─ one stage, picked by scene.kit            (the scene router)
      │   │   world → WorldStage → GroundWorld (+ SolvedLens)
      │   │   street-block | space | ocean | countryside | forest | river | interior → its own stage
      │   │   any other kit → AssetStage;  no kit → legacy CityScene / FirstPersonScene
      │   └─ <CinematicLook>                           the grade, last child of the canvas
      ├─ <TransitionOverlay>                           dips and flashes (HTML)
      ├─ <FlightView>                                  a flight's own canvas, over everything, while its window runs
      ├─ <ZoomVignette>, <StatHud>, <Hook>, <TimerHUD>, <Captions>   the HUD (HTML)
      └─ <CompositionAudio>                            every sound cue
```

1. [`src/index.ts`](../../src/index.ts) registers [`RemotionRoot`](../../src/Root.tsx#L50). It is also the bundle entry ([`src/generator/render/bundle.ts`](../../src/generator/render/bundle.ts) `BUNDLE_OPTIONS`).
2. The `WhatIfVideo` composition ([Root.tsx](../../src/Root.tsx#L71)) takes `{ spec }`, validated by `ShotSpecSchema`. [`specMetadata`](../../src/Root.tsx#L38) sets the size from `spec.settings.format`, the fps and the length from the spec, so a 16:9 plan opens as a 16:9 composition. `WhatIfAudio` has the same props and metadata and draws nothing: it is the chunked render's audio pass ([`WhatIfAudio.tsx`](../../src/compositions/WhatIfAudio.tsx)).
3. [`WhatIfVideo`](../../src/compositions/WhatIfVideo/index.tsx#L73) works out, for the frame's time `t = frame / fps`:
   - the scene on screen ([`resolvePhysicsAt`](../../src/compositions/WhatIfVideo/index.tsx#L55): the first scene with `from <= t < to`, else the last);
   - the flight window, if any ([L99](../../src/compositions/WhatIfVideo/index.tsx#L99)); while a flight joins two world scenes, `flightCovers` ([L103](../../src/compositions/WhatIfVideo/index.tsx#L103)) leaves the stage canvas empty and ungraded, because the flight's opaque canvas covers it;
   - a time-lapse's two looks, once per scene ([L115](../../src/compositions/WhatIfVideo/index.tsx#L115), `lapseLookFor`).
4. The router ([L137-L178](../../src/compositions/WhatIfVideo/index.tsx#L137)) mounts exactly one stage. A cut to another kit unmounts the old stage and mounts the new one in the same canvas and WebGL context; between two world scenes the same WorldStage stays mounted and rebuilds its per-scene memos. The grade ([L183](../../src/compositions/WhatIfVideo/index.tsx#L183)) is the canvas's last child.
5. The HTML layers follow in DOM order ([L194-L241](../../src/compositions/WhatIfVideo/index.tsx#L194)). They are plain React driven by `useCurrentFrame()`.

### 1.2 Inside a world scene

[`WorldStage`](../../src/compositions/WhatIfVideo/WorldStage.tsx#L61) does the per-scene planning, then hands the place to [`GroundWorld`](../../src/world/Ground.tsx#L247).

**Once per scene** (`useMemo`, keyed on the spec's own objects):
- the lapse clock ([L66](../../src/compositions/WhatIfVideo/WorldStage.tsx#L66), [`lapseClock`](../../src/world/lapse.ts#L185)) and the place ([L67](../../src/compositions/WhatIfVideo/WorldStage.tsx#L67), [`resolvePlace`](../../src/world/places.ts#L330)); with a lapse, the place built is the clock's start;
- the camera's subjects ([L79](../../src/compositions/WhatIfVideo/WorldStage.tsx#L79), [`worldShotSet`](../../src/generator/camera/world.ts#L442)). This generates the city a second time, with exactly the arguments GroundWorld uses, so the anchors sit on the set that is drawn. It also plans the featured actors and the keep-outs round lifting buildings and floods;
- `cameraAt(t)` ([L84](../../src/compositions/WhatIfVideo/WorldStage.tsx#L84)): the active `spec.shots` entry through [`solveWorldShot`](../../src/generator/camera/world.ts#L699), else the stand-in rig [`worldPose`](../../src/compositions/WhatIfVideo/WorldStage.tsx#L189) by `scene.camera`;
- the lens path every 0.25 s ([`lodPath`](../../src/compositions/WhatIfVideo/WorldStage.tsx#L107)), so the kit city's near/far split is fixed for the scene and nothing pops; and `lensAt` / `aimAt` for the traffic.

**Inside GroundWorld, once per scene:** the world build ([L333](../../src/world/Ground.tsx#L333): landmarks, `generateCity`, merged box-city meshes, `terrainFor`, the far disc, night windows and lamps, height fog, mood palette, ponds and fountain water, shafts, trees, market, plaza dressing, flags, anchors, the crowd scripts, the water and snow patches); the reactions ([L565](../../src/world/Ground.tsx#L565)); water and snow plans ([L617](../../src/world/Ground.tsx#L617)); the crack ground ([L638](../../src/world/Ground.tsx#L638)); the traffic run ([L659](../../src/world/Ground.tsx#L659), `trafficPlan`); lifting buildings ([L686-L723](../../src/world/Ground.tsx#L686)); the sky dome ([L739](../../src/world/Ground.tsx#L739)); the lights, moon and stars ([L756](../../src/world/Ground.tsx#L756)); the lights-out plan ([L796](../../src/world/Ground.tsx#L796)).

**Every frame in render:** a lapse's light `placeLight(clock.at(t))` ([L325](../../src/world/Ground.tsx#L325)), the kit near mask (only when there is no `lodPath`, [L732](../../src/world/Ground.tsx#L732)), the lifting kit buildings' matrices ([L737](../../src/world/Ground.tsx#L737)).

**Its children** ([L941-L1025](../../src/world/Ground.tsx#L941)): the primitives above, then `KitInstances` for the landmarks, the market and the kit town, one `ReactionLayers` per reaction kind, `TrafficLayer` (which mounts `TrafficSignals`), `Flags`, `BirdsLayer`, `ActorsLayer` for the cast, and the clouds.

### 1.3 The order of work in one frame

While rendering, `@remotion/three`'s `ThreeCanvas` runs R3F with `frameloop="never"` and calls `advance()` once per frame from an effect, holding the frame with `delayRender` until it has run. One `advance()` runs every `useFrame` callback sorted by priority, and within a priority in subscription order. R3F subscribes in a layout effect, and React runs a child's layout effects before its parent's, so GroundWorld's own layers run before GroundWorld does.

1. **Priority −1000:** [`Precompile`](../../src/compositions/look/CinematicLook.tsx#L98) asks the driver for every program the scene draws with, when the mesh count changed (first frame, a model arrived).
2. **Priority 0, the layers inside GroundWorld**, in tree order: `KitInstances` fills the near mask and poses lifting buildings ([`applyNear`](../../src/world/KitInstances.tsx#L524)); the reaction layers (rigid pieces, particles, slabs, flood, snowfall); the cars ([TrafficLayer](../../src/world/TrafficLayer.tsx#L134)) and signal heads; flags; birds; actors.
3. **Priority 0, GroundWorld itself**, its hooks in their order: first the crack uniforms (`useCrackGround`, a hook GroundWorld calls), then its own callback ([L838](../../src/world/Ground.tsx#L838)): wind and water `uTime`; the camera from the `pose` prop (fov, near = max(0.5 m, 2 % of the height), far 70 km, `lookAt`); fog put back if a kit stage's cleanup cleared it, and fog distances by altitude; a lapse's light written whole (key, fill, discs, stars, fog, water, sky dome, clouds); lights out or the rest values (`darkLights`); the dusk uniform; the lift, water and snow uniforms; the coastal ocean's drop; dome, disc, stars and moon kept on the camera; the key's shadow box snapped to its texel grid ([`keyShadowBox`](../../src/world/Ground.tsx#L236)); the sun disc; the shafts.
4. **Priority 0, [`SolvedLens`](../../src/compositions/WhatIfVideo/WorldStage.tsx#L169)**, mounted after GroundWorld: the solver's full pose overwrites the camera (quaternion with dutch and handheld roll, the whip yaw), its fov, near = [`lensNear`](../../src/compositions/WhatIfVideo/WorldStage.tsx#L162), far 70 km.
5. **Priority 1, the EffectComposer** (`@react-three/postprocessing`): it draws the scene into a half-float buffer and runs the chain. Because a subscriber with priority above 0 exists, R3F does not draw on its own.

The consequence: a layer inside GroundWorld that reads `camera` in its frame callback sees the previous frame's camera, which in an out-of-order tab is some other frame. Layers take the lens from props (`eye`, `target`, `fov`, the pure pose), as TrafficLayer's header says. The grain seed and a lapse's blend are pushed in layout effects ([`GrainSeed`](../../src/compositions/look/CinematicLook.tsx#L78)), which run before the effect that calls `advance()`.

**Kit stages** are simpler: their frame callbacks run in tree order, then the composer. The camera is written by [`ShotCamera`](../../src/compositions/camera/ShotCamera.tsx#L69) (the solver when a shot is active and the stage knows its subject, else the stage's own rig) wherever the stage mounts it (first in ForestStage). The rain and snow of `WeatherLayer` read the render camera's uniforms in the shader, so they do not depend on that order.

### 1.4 Flights

[`FlightView`](../../src/compositions/WhatIfVideo/FlightView.tsx#L46) mounts a `<Sequence>` over the window with [`WorldFlight`](../../src/world/WorldFlight.tsx#L180). The 15 s path ([`TIMING`](../../src/world/flight.ts#L48)) is time-scaled to the window (`dur`). One canvas, with a logarithmic depth buffer, holds ground A (before `seam1`, 5.0 s of path time), the globe (5.0-9.6 s), then ground B, swapped inside the cloud veil; a canvas per stage cost a WebGL context and a recompile each ([06](06-world-engine.md)). Each side is graded with the look its scene has (`FlightGrade`). The places are memoised on their values ([`usePlace`](../../src/world/WorldFlight.tsx#L158)): keyed on the objects FlightView makes every frame, the city was rebuilt every flight frame. A flight's grounds have traffic over the window and the story's reaction, but no lapse: a lapse scene is met at the moment its lapse has reached ([`departureMoment`](../../src/compositions/WhatIfVideo/FlightView.tsx#L41)).

### 1.5 The grade, the HUD and the sound

- **Grade.** [`lookFor`](../../src/generator/look-choice.ts) picks a preset from the scene's `look.timeOfDay` and `story.mood`; a world scene's from its real sun at its place and moment instead (`worldSunOf`, since 2026-11-04, [13](13-light-and-time.md#the-grade-follows-the-sun-2026-11-04)); a lapse scene gets [`lapseLookFor`](../../src/generator/look-choice.ts#L111) (the start's and end's looks from the real sun, blended by how far the light has gone). [`CinematicLook`](../../src/compositions/look/CinematicLook.tsx#L120) builds the effect chain once per (look, quality) ([`buildChain`](../../src/compositions/look/chain.ts#L54)): Bloom, ToneMapping (or ToneMix for a lapse whose two looks use different operators), SMAA (not in draft), Grade with seeded grain, Vignette, optional ChromaticAberration. Per frame only uniforms change. Exposure is `gl.toneMappingExposure`. Videos pass `grain={0.3}`. Design: [08 §5](08-phase3-research.md), [13 Part B](13-light-and-time.md#part-b-as-built-2026-11-02-option-a-a-continuous-lapse).
- **HUD.** Hook, captions, counter and timer are HTML over the canvas. Their look comes from `spec.settings.captions` through `src/generator/caption-style.ts`, their places from `src/generator/layout.ts` (both outside this map). During a flight they get a dark glow while the cloud veil is white (`veilAt`).
- **Sound.** [`CompositionAudio`](../../src/compositions/WhatIfVideo/audio.tsx#L74) plays what the sound designer and `audio-resolve.ts` prepared: `events[].sfx`, `audio.transitions` (cut whooshes), `audio.ambient` (looped beds, equal-power fades where a lapse crosses them over), `audio.music`, `audio.voiceFiles`. Music and beds duck by `DUCK_DEPTH` under speech. Never play audio to check it; measure files ([HANDOFF §1](HANDOFF.md)).

### 1.6 Determinism rules

Remotion renders frames in several browser tabs at once (`--concurrency`), each tab getting its own share, often starting mid-video, and it may render a frame again. Every rule below follows from that. The reactions' version is [11 §4.3](11-world-reactions.md#43-determinism-rules-every-reaction-must-pass).

1. **A frame is a pure function of (spec, frame).** Motion is a closed formula of `t = frame / fps`: no integration, no `+=` in a frame callback, no `setState` in a frame callback, no `AnimationMixer.update` ([`rig.ts`](../../src/world/actors/rig.ts) evaluates clips itself because the mixer skips unchanged writes). `performance.now()` only feeds `advance()` timestamps and `traffic.ts` timing stats.
2. **No state carried between frames.** Caches keyed on values are fine (`terrainFor`, `streetGraphFor`, `modelCache`, the `LIFT_GUARDS` per shot, `KitInstances`' last applied mask). Anything that remembers what the previous frame did is not.
3. **Seeded randomness only.** [`makeRng(seed)`](../../src/world/rng.ts#L5) with string seeds such as `` `${placeId}:react:slab` `` (re-exported by `city.ts`), `hash01` in [`shot.ts`](../../src/generator/camera/shot.ts#L71), Remotion's `random()` in StreetStage. No `Math.random`, no clock.
4. **A history is sampled once per scene on a fixed grid** that does not depend on which frame is asked: [`levelTrack`](../../src/world/react/track.ts#L47) for releases, the high-water mark in [`water.ts`](../../src/world/react/water.ts), the lapse's pace table, the whole traffic run from a fixed warm-up before the scene.
5. **Build per scene, memoised on values.** Never key a heavy `useMemo` on an object that is new every frame (the flight's per-frame city rebuild, [06](06-world-engine.md#main-video-render-speed-phase-6-2026-10-29)).
6. **Program identity.** A shader patch keeps the same GLSL text for every material it touches; differences ride on uniforms ([`patch.ts`](../../src/world/atmosphere/patch.ts)). A patch is applied only to scenes that need it, because a patched program rounds a last bit differently even where it multiplies by 1: the dusk patches only when `0 < dusk < 1`, the walls' dark patch only in a night scene that goes dark. A lapse builds everything any of its frames needs at frame 0 ([`lapseShape`](../../src/world/lapseLight.ts#L158)), so no program compiles mid-scene. The reaction, dusk and lift uniforms are module-wide (one place is drawn at a time) and GroundWorld writes them every frame, rest values included.
7. **`delayRender` holds.** Nothing is captured before it is drawn:

   | Hold | Where | Timeout |
   |---|---|---|
   | canvas created, R3F drew frame N | `@remotion/three` | default |
   | caption fonts | [`hud/fonts.ts`](../../src/compositions/hud/fonts.ts#L48) | default (30 s) |
   | one more draw after the composer mounts | [`renderAfterMount.tsx`](../../src/compositions/look/renderAfterMount.tsx#L32) | default (30 s) |
   | kit, landmark and market models | [`KitInstances.tsx`](../../src/world/KitInstances.tsx#L472) | 120 s |
   | cars; signal heads | [`TrafficLayer.tsx`](../../src/world/TrafficLayer.tsx#L73), [`TrafficSignals.tsx`](../../src/world/TrafficSignals.tsx#L114) | 120 s |
   | reaction models | [`RigidReaction.tsx`](../../src/world/react/RigidReaction.tsx#L111) | 120 s |
   | actor models | [`Actors.tsx`](../../src/world/actors/Actors.tsx#L110) | 120 s |
   | kit stages' GLBs, per `GlbSuspense` boundary, held until R3F's `advance()` has drawn the frame through the grade (since `d876a47`) | [`glb.tsx`](../../src/compositions/glb.tsx) | 60 s, 2 retries |

   Each model layer calls `advance()` itself once its models are in the scene, then releases its hold, so the captured frame has them.
8. **Draw-order fixes.** three.js draws opaque meshes in material-id order, and GLTFLoader made each material when its textures decoded, which differs from tab to tab; coplanar parts then z-fought the other way (the Eiffel Tower's base at night). [`loadKitModel`](../../src/world/KitInstances.tsx#L122) remakes each file's materials in the file's own order (glTF index, then first use), commit `847a2a8`. In the same commit TrafficLayer recomputes its bounding spheres every frame ([L201-L221](../../src/world/TrafficLayer.tsx#L201)): meshes sharing the KayKit atlas are sorted by a sphere three computes once per tab. The key's shadow box moves in whole texels ([`keyShadowBox`](../../src/world/Ground.tsx#L236)), and the `static` move no longer drifts ([`solve.ts`](../../src/generator/camera/solve.ts#L247)): both against shimmer, [13 open points](13-light-and-time.md#part-b-as-built-2026-11-02-option-a-a-continuous-lapse).
9. **A missing model never cancels a render.** World layers draw a stand-in box the catalog's size ([`standInModel`](../../src/world/KitInstances.tsx#L191)); kit stages draw procedural stand-ins ([`glb.tsx`](../../src/compositions/glb.tsx)).

---

## 2. How spec fields reach the world

Schema: [`src/generator/spec.schema.ts`](../../src/generator/spec.schema.ts). The assembler (`src/generator/pipeline/assemble.ts`) writes these fields from the director's choices; this table is the render side.

| Spec field | World scenes read it in | Kit stages, HUD and sound read it in |
|---|---|---|
| `scenes[].kit` | router [index.tsx L137](../../src/compositions/WhatIfVideo/index.tsx#L137); `"world"` is set by the assembler when the director's place resolves | router; each stage |
| `scenes[].world` `{place, date, time}` | [WorldStage L67](../../src/compositions/WhatIfVideo/WorldStage.tsx#L67) → `resolvePlace` → GroundWorld `place`; [`worldShotSet`](../../src/generator/camera/world.ts#L442); [FlightView](../../src/compositions/WhatIfVideo/FlightView.tsx#L41); validated by [`resolveWorldScene`](../../src/world/director-context.ts#L79) | sound: `placeSound` in `pipeline/sound.ts` |
| `scenes[].world.lapse.to` | [`lapseClock`](../../src/world/lapse.ts#L185) → GroundWorld `lapse` (`lapseShape`, `placeLight` per frame, traffic `densityAt`); [`lapseLookFor`](../../src/generator/look-choice.ts#L111) → CinematicLook `blendFrom`/`blend`; FlightView `departureMoment` | sound `lapseBeds`; `pipeline/transitions.ts`; `qa/photographer.ts` |
| `scenes[].actors` | [`worldCast` / `planWorldCast`](../../src/generator/camera/world.ts#L64) → `WorldShotSet.castScripts` → GroundWorld `cast` → [`ActorsLayer`](../../src/world/actors/Actors.tsx#L85); also camera subjects (one per actor, with aliases) | — |
| `scenes[].camera` (style) | stand-in rig [`worldPose`](../../src/compositions/WhatIfVideo/WorldStage.tsx#L189) when no shot is active | not read by the kit stages (StreetStage's rig reads `scene.street.cameraStyle`) |
| `scenes[].look.timeOfDay` | only where the place does not resolve: the grade, the photographer and the dips judge a world scene by its real sun (`worldSunOf` in `look-choice.ts`, since 2026-11-04); the light comes from `world.time` | each stage's TOD table; `timeSpan` arcs via [`tod.ts`](../../src/compositions/tod.ts) (StreetStage) |
| `scenes[].look.weather` | [`worldWeather`](../../src/world/weather/weather.ts) in WorldStage → GroundWorld `weather` (rain, storm or snow round the lens and the light under it, the sun's disc and halo veiled, wet streets in rain and storm: [`wetGround.ts`](../../src/world/weather/wetGround.ts), [18](18-world-weather.md)); `rain-start` sets it to rain in the assembler | [`WeatherLayer`](../../src/compositions/weather.tsx#L136) in every kit stage; sound `worldRainStretches` (world) and the kit beds; `stormThunder` |
| `story.mood` | GroundWorld `mood` ([`mood.ts`](../../src/world/atmosphere/mood.ts) palette and sky dome), the grade, WorldFlight `mood` | the grade |
| `statPanel.react` + `beats` | [`reactionPlan`](../../src/world/react/reaction.ts#L217) (`COUNTER_FIELDS`), read in [Ground L565](../../src/world/Ground.tsx#L565), `hasDark`/`hasWater`/`hasSnow`; camera guards in `worldShotSet`; traffic halt and slow | [`StatHud`](../../src/compositions/hud/StatHud.tsx#L88), `ZoomVignette`; stages via `statScaleAt`/`statZoomAt` (`src/generator/statPanel.ts`) |
| `worldEvents` | `reactionPlan` `EVENT_KEYS` ([L178](../../src/world/react/reaction.ts#L178)): gravity-off/on, ground-break, snow-start/stop, water-rise/vanish/return, lights-out; rain-start/stop time the scene's weather (`worldWeather`) | [`lightsOutAt`](../../src/compositions/weather.tsx#L40) (stages); Ocean, River ([`riverWater.ts`](../../src/compositions/riverWater.ts)) and AssetStage water level |
| `shots` | [`solveWorldShot`](../../src/generator/camera/world.ts#L699) in WorldStage `cameraAt` | [`ShotCamera`](../../src/compositions/camera/ShotCamera.tsx#L69) |
| `transitions` | `whipYaw` in SolvedLens; `whipBlur` on the canvas ([index.tsx L132](../../src/compositions/WhatIfVideo/index.tsx#L132)) | [`TransitionOverlay`](../../src/compositions/TransitionOverlay.tsx#L47); `whipYaw` in ShotCamera; `audio.transitions` |
| `flights` | `flightWindow` / `flightCovers` in index.tsx; FlightView | — |
| `settings.format`, `fps` | Root `specMetadata` | same |
| `settings.quality` | CinematicLook `quality` (`draft`: no SMAA) | same |
| `settings.captions`, `hook`, `captions`, `timer` | — | Hook, Captions, StatHud, TimerHUD |
| `events[].sfx`, `audio` | — | CompositionAudio; `gravity_off/on` events also drive the legacy CityScene |
| `scenes[].cast`, `subject`, `street`, `riverConfig`; `heroProp` | — | `cast`: AssetStage, InteriorStage; `subject`: SpaceStage; `street` and `heroProp`: StreetStage; `riverConfig`: RiverStage |

---

## 3. File by file

Format: what it does, key exports; who uses it; tests that import it; design doc. "Tests" lists test files that import the module directly. Paths are under `src/`.

### `src/` root
- [`Root.tsx`](../../src/Root.tsx) — the factory's compositions: `WhatIfVideo` (spec props, `calculateMetadata`), `WhatIfAudio`, `WhatIfDemo` (eyesight spec, street-block), `WhatIfGravityDemo` (gravity spec, `city-street` kit, 280 frames). Exports `RemotionRoot`. Its header's `story-<slug>` registry no longer exists.
- [`index.ts`](../../src/index.ts) — `registerRoot(RemotionRoot)`; the bundle entry.

### `src/compositions/WhatIfVideo/`
- [`index.tsx`](../../src/compositions/WhatIfVideo/index.tsx) — the master composition (§1.1). `WhatIfVideo`. Used by Root, `demo.tsx`, the editor's `ui/src/preview/PlayerPreview.tsx`. No tests. Docs: [08](08-phase3-research.md), [10](10-intent-audit.md).
- [`WorldStage.tsx`](../../src/compositions/WhatIfVideo/WorldStage.tsx) — a world scene (§1.2). `WorldStage`, `lensNear`. Used by index.tsx. Covered through `camera/world.test.ts`. Docs: [06](06-world-engine.md), [11 §7](11-world-reactions.md), [13](13-light-and-time.md).
- [`FlightView.tsx`](../../src/compositions/WhatIfVideo/FlightView.tsx) — the flight overlay (§1.4). `FlightView`, `flightScenes`, `departureMoment`. Tests: `generator/pipeline/assemble.test.ts`. Docs: [06](06-world-engine.md), [13](13-light-and-time.md).
- [`audio.tsx`](../../src/compositions/WhatIfVideo/audio.tsx) — the mix (§1.5). `CompositionAudio`, `bedFade`. Used by index.tsx and WhatIfAudio. Tests: `generator/pipeline/sound.test.ts`. Docs: [03](03-audio-sources.md), [13](13-light-and-time.md) (lapse beds).
- [`demo.tsx`](../../src/compositions/WhatIfVideo/demo.tsx) — `WhatIfDemo` on `spec.example.eyesight.json`.

### `src/compositions/` (stages and shared pieces)
- [`WhatIfAudio.tsx`](../../src/compositions/WhatIfAudio.tsx) — `WhatIfAudio`: CompositionAudio only, for the chunked render's audio pass (`src/generator/render/`).
- [`TransitionOverlay.tsx`](../../src/compositions/TransitionOverlay.tsx) — dip-black, dip-white, flash drawn over the picture; whip as camera yaw plus blur. `TransitionOverlay`, `transitionAt`, `whipYaw`, `whipBlur`. Used by index.tsx, WorldStage, ShotCamera. Tests: `generator/pipeline/transitions.test.ts`. Doc: [08 §2](08-phase3-research.md).
- [`camera/ShotCamera.tsx`](../../src/compositions/camera/ShotCamera.tsx) — films a kit stage: the solver on the stage's anchors while a shot is active, else the stage's rig. `ShotCamera`, `activeShot`, `Anchors`. Used by the Street, Space, Ocean, Countryside, Forest, River and Interior stages (AssetStage keeps its own rig). Docs: [08 §1](08-phase3-research.md), [09 handoff](09-phase3-handoff.md).
- [`StreetStage.tsx`](../../src/compositions/StreetStage.tsx) — `street-block`: the dense New York style street (storefronts, café, traffic loop, crowd, hero prop, water towers and signals), camera zoom on the counter. `StreetStage`, `streetAnchors`, `streetBlockers`, `streetBounds`, `streetCorridor`, `streetCurb`, `BuildingSlots`, `movingCars`, `parkedCars`, `LANE_X`. Tests: `camera/sightlines.test.ts`, `camera/stage-bounds.test.ts`. Docs: [09 handoff §2](09-phase3-handoff.md#2-left-to-do), [quality-refs](quality-refs/README.md).
- [`street/dressing.ts`](../../src/compositions/street/dressing.ts) — the street's New York dressing as pure layout (water towers, crosswalks, mast-arm signals, hydrants, trash bags) and the numbers its camera blockers use. `curbDressing`, `waterTowers`, `CROSSINGS` and the size constants. Used by StreetStage. Doc: [quality-refs](quality-refs/README.md).
- [`SpaceStage.tsx`](../../src/compositions/SpaceStage.tsx) — `space`: procedural planets (`scene.subject` earth, moon or mars) that grow with the counter, an orbit rig. `SpaceStage`, `spaceAnchors`, `Starfield` (also used by `world/Globe.tsx` and StreetStage), `SpaceDebugComposition` (registered nowhere).
- [`OceanStage.tsx`](../../src/compositions/OceanStage.tsx) — `ocean`: waves, beach, jetty, canoes; water-rise (up the beach), water-vanish/return and the counter move the water level. `OceanStage`, `oceanAnchors`, `canoeLayout`. Tests: `camera/stage-sightlines.test.ts`.
- [`CountrysideStage.tsx`](../../src/compositions/CountrysideStage.tsx) — `countryside`: fields, houses, barn, windmill, ridge. `CountrysideStage`, `countryLayout`, `countrysideAnchors`. Tests: `camera/stage-sightlines.test.ts`.
- [`ForestStage.tsx`](../../src/compositions/ForestStage.tsx) — `forest`: tree scatter, mist, rocks, logs, shafts. `ForestStage`, `forestLayout`, `forestBlockers`, `clearingBounds`, `forestAnchors`, and two helpers the other stages borrow: `clearestFacing` (Countryside, Ocean, River) and `restoreRigLens` (Countryside, Interior, River). Tests: `camera/sightlines.test.ts`, `camera/stage-bounds.test.ts`.
- [`RiverStage.tsx`](../../src/compositions/RiverStage.tsx) — `river`: a water strip, optional waterfall (`scene.riverConfig`), level from the counter and the water events ([`riverWater.ts`](../../src/compositions/riverWater.ts) `riverWaterAt`: a rise floods the valley, a vanish drains the bed and dries the falls, a return; tests `riverWater.test.ts`, [18](18-world-weather.md#river-water-events)). `RiverStage`, `riverAnchors`, `riverRocksOf`, `RiverConfig`. Tests: `camera/sightlines.test.ts`, `camera/stage-bounds.test.ts`.
- [`InteriorStage.tsx`](../../src/compositions/InteriorStage.tsx) — `interior`: a room, window light, furniture, `scene.cast`. `InteriorStage`, `interiorAnchors`. Tests: `camera/stage-sightlines.test.ts`.
- [`AssetStage.tsx`](../../src/compositions/AssetStage.tsx) — every other kit (`city-street`, `park`, `boardwalk`, `pier`): GLB environment kits, rigged `scene.cast` with mixer-time actions, the legacy gravity float arc, the pier's water-return. `AssetStage`. Own `CameraRig`, no ShotCamera.
- [`glb.tsx`](../../src/compositions/glb.tsx) — model loading for the kit stages: each `GlbSuspense` boundary holds the frame until R3F's `advance()` has drawn it with its model, through the grade (it used to draw with a bare `gl.render`, so each tab's first frame was captured ungraded: [09 §4](09-phase3-handoff.md#4-kit-stages-frame-by-frame-fixed-2026-11-05)); a Suspense fallback to a procedural stand-in; `useSceneDrawOrder` draws opaque meshes in scene order, not by material id. `GlbSuspense`, `useGltfPaint`, `useSceneDrawOrder`. Used by the Asset, Ocean and Street stages.
- [`assetIndex.generated.ts`](../../src/compositions/assetIndex.generated.ts) — generated from `assets.catalog.json` by `scripts/export-asset-index.ts`; buckets of the older packs (`CITY_BUILDINGS`, `HUMANS_ANIMATED`, `VEHICLES`, ...). Used by StreetStage. Do not edit; `npm run assets:index`.
- [`Birds.tsx`](../../src/compositions/Birds.tsx) — the kit stages' flock, positions as functions of the frame. `Birds`. Used by the Countryside, Forest, Interior and Ocean stages.
- [`mountains.tsx`](../../src/compositions/mountains.tsx) — `MountainRidge`, a seeded ridge backdrop. Used by the Countryside, Forest and River stages.
- [`mist.ts`](../../src/compositions/mist.ts) — closed-form particle drift for mist, rain and waterfall layers (`keepMistBase`, `driftMist`). Used by the Countryside, Forest and River stages.
- [`water.tsx`](../../src/compositions/water.tsx) — the kit stages' water: `WaterSurface`, `ShoreFoam`, `GradientSkyDome`, `waveHeightAt`, `seaSwellAt`, `WATER_TOD`. Used by the Asset, Countryside, Forest, Ocean and River stages.
- [`weather.tsx`](../../src/compositions/weather.tsx) — `WeatherLayer` (rain, snow and storm as a camera-relative GPU volume, lightning flashes) and `lightsOutAt(spec, t)`. Used by every kit stage.
- [`lightning.ts`](../../src/compositions/lightning.ts) — when a storm flashes (`lightningAt`). Used by weather.tsx, the world's weather (`world/weather/weather.ts`), the thunder (`pipeline/sound.ts` `stormThunder`) and `generator/qa/photographer.ts`. Tests: `generator/qa/photographer.test.ts`, `world/weather/weather.test.ts`, `pipeline/sound.test.ts`.
- [`tod.ts`](../../src/compositions/tod.ts) — time-of-day interpolation for `look.timeSpan` (`getActiveTodLook`, `lerpTodLook`). Used by StreetStage only.
- [`scenes/CityScene.tsx`](../../src/compositions/scenes/CityScene.tsx), [`scenes/FirstPersonScene.tsx`](../../src/compositions/scenes/FirstPersonScene.tsx), [`scenes/shared/primitives.tsx`](../../src/compositions/scenes/shared/primitives.tsx) — the legacy physics demo scenes, used only when a scene has no `kit` and `scene.scene` is `city` or `first-person`.

### `src/compositions/hud/`
Design for all: [08 §3](08-phase3-research.md), [quality-refs](quality-refs/README.md) (the reference style), [10](10-intent-audit.md) (the BPM row is a director's device). Layout tests live outside this map (`generator/hud-layout.test.ts`, `generator/layout.test.ts`).
- [`Hook.tsx`](../../src/compositions/hud/Hook.tsx) — the opening premise title, keyword in the highlight colour, sized to 3 lines. `Hook`.
- [`Captions.tsx`](../../src/compositions/hud/Captions.tsx) — caption lines from one resolved `CaptionLook`, keywords as React spans. `Captions`. Also used by `CaptionPreview.tsx`.
- [`StatHud.tsx`](../../src/compositions/hud/StatHud.tsx) — the counter (`text` or `card` look), values blending toward the active beat, the EKG row only when every beat has a `bpm`. `StatHud`, `ZoomVignette`, `formatStat`, `hasPulseRow`.
- [`TimerHUD.tsx`](../../src/compositions/hud/TimerHUD.tsx) — the "TIME WITHOUT ..." timer, `text` or `card`. `TimerHUD`.
- [`fonts.ts`](../../src/compositions/hud/fonts.ts) — loads the bundled fonts from `public/fonts` on import and holds the first frame. No exports; imported for its side effect by the four HUD files and `world/WorldFlight.tsx`.
- [`CaptionPreview.tsx`](../../src/compositions/hud/CaptionPreview.tsx) — one caption on a still backdrop for the dashboard (`ui/src/components/CaptionPanel.tsx`).

### `src/compositions/look/`
Design: [08 §5](08-phase3-research.md), [13 Part B](13-light-and-time.md#part-b-as-built-2026-11-02-option-a-a-continuous-lapse).
- [`CinematicLook.tsx`](../../src/compositions/look/CinematicLook.tsx) — the grade as the canvas's last child (§1.5), `Precompile`, the grain seed. `CinematicLook`. Used by index.tsx, `world/WorldFlight.tsx`, `LookTest.tsx`. Its TODO: ambient occlusion and depth of field were skipped on purpose.
- [`chain.ts`](../../src/compositions/look/chain.ts) — the effect chain built once per (look, quality), and a lapse's per-frame uniform writes. `buildChain`, `applyLookMix`, `LookChain`. Tests: `look/blend.test.ts`.
- [`blend.ts`](../../src/compositions/look/blend.ts) — a look between two presets (pure maths). `mixLooks`, `lapseChainLook`, `LookMix`. Tests: `look/blend.test.ts`, `generator/look-choice.test.ts`.
- [`presets.ts`](../../src/compositions/look/presets.ts) — the six named looks (operator, exposure, bloom, grade, vignette). `LOOK_PRESETS`, `LOOK_PRESET_IDS`, `isLookPresetId`. Also used by WorldFlight. Tests: `look/look.test.ts`, `look/blend.test.ts`, `generator/look-choice.test.ts`.
- [`grade.ts`](../../src/compositions/look/grade.ts) — the grade maths in TypeScript, the single source of truth (`gradeLinear`, `resolveGrade`, `buildCubeLut`, the grain hash). Tests: `look/look.test.ts`, `look/blend.test.ts`.
- [`GradeEffect.ts`](../../src/compositions/look/GradeEffect.ts) — the grade and seeded grain as a postprocessing `Effect`; its GLSL mirrors `gradeLinear` line for line. `GradeEffect`.
- [`ToneMixEffect.ts`](../../src/compositions/look/ToneMixEffect.ts) — two tone-map operators with their outputs blended by a uniform, for a lapse between looks with different operators. `ToneMixEffect`, `TONE_FUNCTIONS`. Tests: `look/blend.test.ts`.
- [`renderAfterMount.tsx`](../../src/compositions/look/renderAfterMount.tsx) — holds the frame and draws once more after the composer is live, so the first frame and every still are not black. `RenderAfterMount`.
- [`LookTest.tsx`](../../src/compositions/look/LookTest.tsx), [`index.ts`](../../src/compositions/look/index.ts) — a separate entry with `LookTestPortrait` and `LookTestLandscape` for checking presets and blends.

### `src/generator/camera/` (shot vocabulary and solver)
Design: [08 §1](08-phase3-research.md), [09 handoff §2](09-phase3-handoff.md#2-left-to-do), [11 §7](11-world-reactions.md), [13](13-light-and-time.md) (static move).
- [`shot.ts`](../../src/generator/camera/shot.ts) — the director's vocabulary: `SHOT_SIZES`, `SHOT_ANGLES`, `SHOT_SIDES`, `SHOT_MOVES`, `SHOT_PLACES`, `SHOT_ENERGIES`, `SHOT_STYLES`, `ShotSchema`, `SIZE_DEFAULTS` (region, fill, lens, push, orbit, shake per size), `SIDE_DEG`, `hash01`, `guardJumpCuts`. Used by the solver, the director (`pipeline/director.ts`), `pipeline/shots.ts`, the schema, two stages. Tests: every camera test, `pipeline/shots.test.ts`.
- [`solve.ts`](../../src/generator/camera/solve.ts) — a shot to a pose for one moment, closed form: [`solveShot`](../../src/generator/camera/solve.ts#L190), the moves in [`place`](../../src/generator/camera/solve.ts#L205), the detour search round blockers [`clearView`](../../src/generator/camera/solve.ts#L443). `Subject`, `SolveOptions`, `CameraPose`, `lensToVFov`. Tests: `solve.test.ts` and the other camera tests.
- [`occlusion.ts`](../../src/generator/camera/occlusion.ts) — blocker shapes (columns, balls, boxes) and the inside and segment tests. `Occluder`, `BoxBlocker`, `occluderBox`, `insideOccluder`, `segmentEntry`. Used by the solver, `world.ts`, `shapes.ts` and six stages. Tests: `occlusion.test.ts` and others.
- [`shapes.ts`](../../src/generator/camera/shapes.ts) — turned boxes, four-sided roofs and the windmill's disc as unions of blockers. `turnedBox`, `turnedRoof`, `discColumns`. Used by the Countryside, Interior and Ocean stages. Tests: `shapes.test.ts`.
- [`subjects.ts`](../../src/generator/camera/subjects.ts) — the subject names each kit offers the director (`KIT_SUBJECTS`, `subjectsFor`, `subjectMenu`; the world's include `belfry` since 2026-11-05). Used by `pipeline/director.ts`, `pipeline/shots.ts`, `qa/vision.ts`, `scripts/phase3-lane-stills.ts` and the editor's Inspector. Tests: `pipeline/shots.test.ts`.
- [`world.ts`](../../src/generator/camera/world.ts) — the world kit's subjects: the city's spots, `scene`, the landmark (famous model or the generated minaret), the old towns' bell tower (`belfry`: the whole tower from the plaza's side, the belfry stage in close shots, the city's buildings and stalls as sight blockers), a landmark inside the city with its houses as sight blockers (`landmarkCityBlockers`: Rome, London), each featured actor as a moving subject; the avenue filmed down its axis with the light behind the lens; keep-outs round lifting buildings and a lens floor over a flood. `worldShotSet`, `solveWorldShot`, `worldShot`, `worldCast`, `planWorldCast`, `worldLiftPlan`, `liftKeepOut`, `avenueLane`, `belfrySubject`, `worldAnchorNames`, `resolveWorldScene`. Used by WorldStage and `scripts/phase3-lane-stills.ts`. Tests: `world.test.ts`, `stage-sightlines.test.ts`.
- Tests only: `occlusion.test.ts`, `shapes.test.ts`, `sightlines.test.ts` (forest, river, café, traffic, 500 street layouts), `solve.test.ts`, `stage-bounds.test.ts`, `stage-sightlines.test.ts` (countryside, ocean, interior, the plaza market), `world.test.ts` (real places, every size, angle and move).

### `src/world/` — compositions, preview entry and the place
- [`Root.tsx`](../../src/world/Root.tsx), [`index.ts`](../../src/world/index.ts) — the world preview entry (§5.2). `WorldRoot`. Not registered in the factory's Root; open it with `npx remotion studio src/world/index.ts`.
- [`Ground.tsx`](../../src/world/Ground.tsx) — `GroundWorld`, the ground-level place (§1.2, §1.3). Props: `place`, `pose`, `fov`, `cloudPassage`, `crowd` (default off), `birds`, `cast`, `mood`, `kitWindows`, `market`, `reaction`, `fbmSky` (default off), `lodPath`, `kitLod`, `traffic`, `lapse`, `weather` (its ground patched wet in rain and storm only). Used by WorldStage, WorldFlight and the previews. No direct test (its parts are tested). Docs: [06](06-world-engine.md), [11](11-world-reactions.md), [12](12-traffic.md), [13](13-light-and-time.md).
- [`KitInstances.tsx`](../../src/world/KitInstances.tsx) — draws model placements as one instanced mesh per (file, part); loading, the stand-in box, the material-order fix, the kit town's near pieces and far cards, the night and dusk window glow, lifted buildings, the painted kits' paint and New York's masonry (the walk-ups keep a material of their own), a landmark's omitted base parts (landmarks.ts `omittedParts`). `KitInstances`, `loadKitModel`, `loadKitModelOrStandIn`, `standInModel`, `placementMatrix`, `buildKitInstances`, `buildKitNear`, `KitLift`. Used by Ground, KitPreview, TrafficLayer, TrafficSignals, ActorStage, kitFar, RigidReaction. Tests: `atmosphere/dusk.test.ts`, `react/buildings.test.ts`. Doc: [06](06-world-engine.md).
- [`WorldFlight.tsx`](../../src/world/WorldFlight.tsx) — the flight A → globe → B in one canvas (§1.4), the cloud veil, optional labels. `WorldFlight`, `FlightLook`, `WorldFlightProps`. Used by FlightView and the previews. Doc: [06](06-world-engine.md).
- [`flight.ts`](../../src/world/flight.ts) — the flight's camera path as a function of time, the scale switch inside the cloud. `flightAt`, `groundPath`, `veilAt`, `travelCourse`, `TIMING`, `CLOUD_PASSAGES`, `GroundPose`. Tests: `world.test.ts`, `kitLod.test.ts`.
- [`Globe.tsx`](../../src/world/Globe.tsx) — the Earth from orbit coloured from the surface map, real sun, clouds, rim, stars. `GlobeWorld`. Used by WorldFlight and GlobeSpin.
- [`GlobeSpin.tsx`](../../src/world/GlobeSpin.tsx) — the globe alone, fixed or turning (preview). `GlobeSpin`.
- [`PlaceView.tsx`](../../src/world/PlaceView.tsx) — a still lens at one place (preview `WorldPlace`). `PlaceView`.
- [`WorldActors.tsx`](../../src/world/WorldActors.tsx) — a place at street level for QA (previews `WorldActors`, `WorldMood*`, `WorldShafts`, `WorldPond`, `WorldNight*`). `WorldActors`. It draws no crowd: GroundWorld's `crowd` is off and this file does not turn it on.
- [`KitPreview.tsx`](../../src/world/KitPreview.tsx) — kit buildings on a short street, or a gallery of raw kit files (modes `street`, `gallery`, `houses`, `town`). `KitPreview`, `previewStreet`, `previewHouses`, `previewTown`.
- [`places.ts`](../../src/world/places.ts) — the places (`PLACES`: paris, cairo, colmar, new-york, rome, london, san-francisco), the region styles (`REGION_STYLES`, `RegionStyleId`), time-zone rules (`utcOffsetFor`), and [`resolvePlace`](../../src/world/places.ts) (sun, season, surface, style, UTC offset). A place may wear its own colours on its region's look (`PlaceLook`, laid over by `placeStyle`: one style object per place, the region's id kept), name its own bays and straits (`PlaceWater`, read by terrain.ts) and a landmark's open ground (`clear`). `placeOffset` pulls far points in to `LANDMARK_MAX_DISTANCE` (7 km). Used by almost every world module, the camera, the producer's registry and matcher, and `pipeline/sound.ts`. Tests: `places.test.ts`, `world.test.ts` and most world tests. Doc: [06](06-world-engine.md#more-real-places-rome-london-san-francisco-2026-11-05).
- [`geo.ts`](../../src/world/geo.ts) — Earth and sun maths: lat/lon frames, great circles, the NOAA sun position (`sunAt`), the subsolar point, `seasonAt`, `localToUtcMs`, `headingToGround`. Tests: `world.test.ts`, `terrain.test.ts`, `lapse.test.ts`, `lapseLight.test.ts`, `traffic.test.ts`.
- [`earth-grid.ts`](../../src/world/earth-grid.ts), [`surface.ts`](../../src/world/surface.ts) — the quarter-degree surface map (`surfaceAt`, `isWater`) decoded from `data/earth-grid.generated.ts`, and its `Surface` enum. Tests: `world.test.ts`, `terrain.test.ts`.
- [`sky.ts`](../../src/world/sky.ts) — sky and light colours from the sun's height (`skyFor`, `nightFor`, `sunGlowFor`, `mixHex`). Tests: `dusk`, `moon`, `lapse`, `lapseLight`, `dark` tests.
- [`skyDome.ts`](../../src/world/skyDome.ts) — the gradient sky dome and its per-frame repaint for a lapse (`skyDome`, `paintSkyDome`). Tests: `lapseLight.test.ts`. Doc: [13](13-light-and-time.md).
- [`rng.ts`](../../src/world/rng.ts) — `makeRng(seed)`. Used by most world modules.
- [`director-context.ts`](../../src/world/director-context.ts) — what the director is told about the world (places, with their landmarks and bell tower, styles, the lapse rules, the catalog summary) and the answer's schema. `worldDirectorContext`, `WorldSceneSchema`, `resolveWorldScene`, `resolveWorldLapse`. Used by `pipeline/director.ts`, `assemble.ts`, `critic.ts`, `sound.ts`. Tests: `director-context.test.ts`. Docs: [06](06-world-engine.md), [13](13-light-and-time.md).

### `src/world/` — the city
- [`city.ts`](../../src/world/city.ts) — the seeded city from a region style: roads (via roads.ts), box buildings and roofs, kit buildings for kit styles, props, trees, parks, the minaret landmark, the plaza's bell tower (`CityLayout.belfry`, with its belfry `stage` for the camera), suburbs, the cloud layer (generated last). [`generateCity`](../../src/world/city.ts#L497), `CityLayout`, re-exports `makeRng`. Used by Ground, `camera/world.ts`, Globe, WorldFlight and most of `react/` and `atmosphere/`. Tests: `world.test.ts` and many others. Doc: [06](06-world-engine.md).
- [`roads.ts`](../../src/world/roads.ts) — tensor-field street networks: roads, blocks, plazas, lots, junctions, by preset. `generateRoads`, `roadPresetForStyle`, `ROAD_PRESETS`. Used by city.ts, meshes.ts, traffic.ts, `scripts/preview-roads.ts`. Tests: `roads.test.ts`, `traffic.test.ts`.
- [`meshes.ts`](../../src/world/meshes.ts) — the box city as a few merged meshes, windows as a metre-mapped texture. `buildingsGeometry`, `mansardGeometry`, `propsGeometry`, `roadsGeometry`, `areasGeometry`, `flatGeometry`, `windowTexture`. Used by Ground and crackGround. Tests: `world.test.ts`, `react/dark.test.ts`, `react/buildingsShader.test.ts`.
- [`terrain.ts`](../../src/world/terrain.ts) — seeded terrain beyond the city (flat under it), coloured by surface, season and latitude; cached per place. On an Ocean surface a place's own bays and straits (`placeWater`, found by the seed, the place id) replace the seeded coast (San Francisco). `terrainFor`, `buildTerrain`, `placeWater`, `snowLineFor`, `noise2`, `hashString`. Used by Ground, `camera/world.ts`, fbmSky, `scripts/preview-terrain.ts`. Tests: `terrain.test.ts`.
- [`trees.ts`](../../src/world/trees.ts) — seasonal low-poly tree templates (`treeTemplates`, `TREE_KINDS`). Used by Ground and `scripts/preview-terrain.ts`. Tests: `terrain.test.ts`.
- [`cityAnchors.ts`](../../src/world/cityAnchors.ts) — the named spots (avenue, sidewalks, plaza and its compass points, park, landmark front) and `groundAt`. `cityAnchors`, `ANCHOR_VOCAB`, `anchorsForPrompt`, `openBlocks`, `blockCentre`, `GROUND`. Used by Ground, the camera, the director, crowd, dressing, market, water, the reactions. Tests: `cityAnchors.test.ts` and others. Doc: [09 Phase 5](09-phase5.md).
- [`crowd.ts`](../../src/world/crowd.ts) — background walkers on the anchors, sliced by the lens height. `crowdFor`, `crowdLevel`, `crowdCountFor`, `cityCrowd`. Used by Ground. Tests: `crowd.test.ts`. Off in every composition at HEAD ([decisions 2026-10-24](decisions.md)).
- [`catalog.ts`](../../src/world/catalog.ts) — the world asset catalog over `data/world-catalog.json`: `findAssets`, `scoreAssets`, `assetById`, `allAssets`, `catalogSummary`, `creditsFor`, `createCatalog`. Used by KitInstances, landmarks, market, debris, cast, ActorStage, director-context, `camera/world.ts`, `scripts/build-world-catalog.ts`. Tests: `catalog.test.ts`, `world.test.ts`, `market.test.ts`, `traffic.test.ts`. Doc: [06](06-world-engine.md).
- [`assembler.ts`](../../src/world/assembler.ts) — modular kit pieces into buildings on lots (pure, seeded), whole-building packs, glTF bounds from JSON. `assembleBuilding`, `placeCompleteBuilding`, `planBuilding`, `fitModules`, `measureGlb`, `gltfBounds`, `Placement`, `KitRecipe`. Tests: `assembler.test.ts` (needs the installed packs), `kitLod.test.ts`, `world.test.ts`.
- [`kits.ts`](../../src/world/kits.ts) — measured recipes for the kits on disk and the kit sets the region styles draw from. `KIT_RECIPES`, `COMPLETE_MODELS`, `KIT_SETS`, `KitSetId`. Tests: `assembler.test.ts`, `kitLod.test.ts`, `world.test.ts`.
- [`kitTown.ts`](../../src/world/kitTown.ts) — a city's kit buildings to placements, with each building's share and extent (for the levels of detail). `kitTown`, `KitTownBuilding`, `kitPlacements`. Tests: `kitLod`, `world`, `camera/world`, `react/buildings`, `react/buildingsShader`, `react/dark` tests.
- [`kitLod.ts`](../../src/world/kitLod.ts) — near or far per building (a pure function of the lens path), the far cards' faces and atlas layout. `nearMask`, `lodRadius`, `KIT_LOD_RADIUS` (200 m), `cardKinds`, `buildFarCards`. Used by Ground, KitInstances, kitFar. Tests: `kitLod.test.ts`, `react/buildings.test.ts`. Doc: [06](06-world-engine.md).
- [`kitFar.ts`](../../src/world/kitFar.ts) — bakes the card atlas once per tab on the scene's renderer and builds the merged far-card mesh. `bakeCardAtlas`, `farCity`. Used by KitInstances. Tests: `atmosphere/dusk.test.ts`.
- [`kitPaint.ts`](../../src/world/kitPaint.ts) — painted kit houses (the wall swatch takes the house's paint) and New York's masonry: the Building Kit's painted walls as brick or ashlar by the paint, the KayKit walk-ups' wall colours as brick, in the shader in model units, faded by screen footprint. `patchKitPaint`, `patchWalkupMasonry`, `masonryFor`, `isBrickPaint`, `bondAt`, `paintTexel`. Used by KitInstances and kitFar. Tests: `kitPaint.test.ts`, `towns.test.ts`.
- [`weather/`](../../src/world/weather/) — a world scene's weather ([18](18-world-weather.md)): `weather.ts` (the plan: fall, flash and the streets' `wet` level; the air; the rain, flash and bolt shaders), `weatherLayer.ts` (their meshes), `wetGround.ts` (the ground's wet patch). Used by WorldStage, WorldFlight, Ground and `pipeline/sound.ts`. Tests: `weather.test.ts`.
- [`kitWindows.ts`](../../src/world/kitWindows.ts) — the kit pieces' night and dusk window glow as additive copies keyed per building. `windowGlowMaterialFor`, `WINDOW_GLOW_COLOR`. Used by KitInstances and kitFar. Tests: `dusk`, `laneC`, `dark` tests.
- [`landmarks.ts`](../../src/world/landmarks.ts) — famous landmarks at their real offsets (pulled in to 7 km), as placements with their drawn size (`PlacedLandmark.size`, `.base`), and their CC-BY credit lines. A model on a diorama base of its own (the Golden Gate's sea slab and grass block) has it left out and its sea level stood at the world's (`LANDMARK_BASES`, `omittedParts`). `landmarksFor`, `landmarkPlacements`, `creditsForPlaces`. Used by Ground, `camera/world.ts`, `generator/generate.ts`, the previews. Tests: `world.test.ts` and many others.

### `src/world/` — traffic, light and time
- [`traffic.ts`](../../src/world/traffic.ts) — the lane-graph simulation, run once per scene and read per frame: street graph, lanes, turn paths, lights and priority, the lens rules, halt and slow for reactions. `trafficPlan`, `placeTraffic`, `streetGraph`, `streetGraphFor`, `TRAFFIC_MODELS`, `SIGNAL_MODELS`, `lightAt`. Used by Ground, TrafficLayer, TrafficSignals, lapseLight. Tests: `traffic.test.ts`, `lapseLight.test.ts`. Doc: [12](12-traffic.md).
- [`TrafficLayer.tsx`](../../src/world/TrafficLayer.tsx) — draws the plan at t: KayKit models near the lens, body-coloured boxes far out, head, tail and brake lights. `TrafficLayer`. Used by Ground. Doc: [12](12-traffic.md).
- [`TrafficSignals.tsx`](../../src/world/TrafficSignals.tsx) — the junctions' light heads, the lit lamp as a bright drum, halos at night, out with lights out. `TrafficSignals`. Used by TrafficLayer. Doc: [12](12-traffic.md).
- [`lapse.ts`](../../src/world/lapse.ts) — the time-lapse clock, slowed through dusk; the director's words to clock times; the checks. `lapseClock`, `lapseWordTime`, `lapseProblem`, `sunElevationAt`, `paceWeight`, `LAPSE_WORDS`. Used by WorldStage, FlightView, `look-choice.ts`, `sound.ts`, `transitions.ts`, `photographer.ts`, director-context. Tests: `lapse.test.ts` and pipeline tests. Doc: [13](13-light-and-time.md).
- [`lapseLight.ts`](../../src/world/lapseLight.ts) — the light of one moment (`placeLight`) and what a lapse must build up front (`lapseShape`). Used by Ground. Tests: `lapseLight.test.ts`. Doc: [13](13-light-and-time.md).

### `src/world/atmosphere/`
- [`dusk.ts`](../../src/world/atmosphere/dusk.ts) — the city lighting up: `duskFor`, `carLightsFor`, `isDusk`, the per-building and per-lamp thresholds, `DUSK_GLSL`. Used by Ground, dressing, kitWindows, lapseLight, darkShader. Tests: `dusk.test.ts`, `lapseLight.test.ts`. Doc: [13 Part A](13-light-and-time.md#part-a-the-dusk-fade-in-built-2026-10-30).
- [`moon.ts`](../../src/world/atmosphere/moon.ts) — the full moon opposite the sun, the key changing sides at zero intensity, the disc sprite. `keyFor`, `moonFor`, `moonDisc`, `SUN_KEY_GONE`, `MOON_DIST`. Used by Ground and lapseLight. Tests: `moon.test.ts`, `dusk.test.ts`, `lapseLight.test.ts`.
- [`stars.ts`](../../src/world/atmosphere/stars.ts) — the seeded starfield and its fade (`starField`, `starsMesh`, `starsFor`). Tests: `moon`, `dusk`, `lapseLight` tests.
- [`fog.ts`](../../src/world/atmosphere/fog.ts) — exponential height fog per material, shared live uniforms for a lapse (`applyHeightFog`, `heightFogLive`, `setHeightFogLive`). Tests: `atmosphere`, `lapseLight`, `dark` tests.
- [`mood.ts`](../../src/world/atmosphere/mood.ts) — the material palette per story mood family, after the fog (`moodLook`, `applyMoodPalette`, `moodFamily`). Used by Ground and skyDome. Tests: `laneC.test.ts`.
- [`shafts.ts`](../../src/world/atmosphere/shafts.ts) — sun shafts for the golden hours (`sunShafts`, `shaftStrength`). Tests: `laneC`, `lapseLight` tests.
- [`water.ts`](../../src/world/atmosphere/water.ts) — the drawn water of ponds and the fountain (`pondsFor`, `waterMaterial`, `waterLive`). Used by Ground, dressing and the water reaction. Tests: `laneC`, `lapseLight`, `dark` tests.
- [`sway.ts`](../../src/world/atmosphere/sway.ts) — tree sway and cloud drift as `uTime` patches (`applyTreeSway`, `applyCloudDrift`). Tests: `atmosphere.test.ts`.
- [`night.ts`](../../src/world/atmosphere/night.ts) — the box walls' window glow mask and the avenue lamp spots (`windowGlowTexture`, `lampSpots`). Tests: `atmosphere`, `dusk`, `dark` tests.
- [`dressing.ts`](../../src/world/atmosphere/dressing.ts) — fountain, stalls, benches and bins in the plazas, the avenue lamps (`plazaDressing`, `lampGroup`). Tests: `dusk`, `dark` tests.
- [`market.ts`](../../src/world/atmosphere/market.ts) — the main plaza's market of kit models, keeping the camera aisles open (`cityMarket`, `marketPlan`). Used by Ground, `camera/world.ts`, debris. Tests: `market.test.ts`, `camera/world.test.ts`, `camera/stage-sightlines.test.ts`, debris and reaction tests. Doc: [quality-refs](quality-refs/README.md).
- [`Flags.tsx`](../../src/world/atmosphere/Flags.tsx) — waving flags over plazas and the avenue (`Flags`, `flagSpots`). Tests: `atmosphere.test.ts`.
- [`Birds.tsx`](../../src/world/atmosphere/Birds.tsx) — the flock over the city (`BirdsLayer`). Used by Ground.
- [`patch.ts`](../../src/world/atmosphere/patch.ts) — composes `onBeforeCompile` patches on one material (`patchMaterial`). Used by every shader patch in `atmosphere/` and `react/`.
- [`fbmSky.ts`](../../src/world/atmosphere/fbmSky.ts) — an optional procedural cloud sky (`createFBMSkyDome`). GroundWorld's `fbmSky` prop; no composition turns it on ([HANDOFF §3](HANDOFF.md): for the user to review).
- Tests only: `atmosphere.test.ts`, `dusk.test.ts`, `laneC.test.ts`, `market.test.ts`, `moon.test.ts`.

### `src/world/actors/`
Design: [09 Phase 5](09-phase5.md). Off by default ([decisions 2026-10-24](decisions.md)); featured actors draw when a scene has `actors`.
- [`script.ts`](../../src/world/actors/script.ts) — what an actor does as a pure function of time: `ACTOR_ACTIONS`, `ACTION_HELP`, `CLIP_KEYS`, the script schema, [`planActor`](../../src/world/actors/script.ts#L310), [`poseAt`](../../src/world/actors/script.ts#L824), `actorSubject` (for the camera), `aimPoint`. Used by the camera, the director, Ground, crowd, cityAnchors and the other actor files. Tests: `script.test.ts`, `rig.test.ts`, `crowd.test.ts`, `cityAnchors.test.ts`.
- [`rig.ts`](../../src/world/actors/rig.ts) — one actor's three.js side: clone, clips evaluated without the mixer, measured gait, carried props, overlays. `buildRig`, `applyPose`. Used by Actors.tsx. Tests: `rig.test.ts`.
- [`rigs.ts`](../../src/world/actors/rigs.ts) — clip-name and bone-name matching across the packs (`mapClips`, `PROCEDURAL`, `unsupported`, `findBones`). Used by cast.ts and rig.ts.
- [`cast.ts`](../../src/world/actors/cast.ts) — picks a catalog model per actor by role words and the clips its plan needs (`castActors`, `castableModels`). Used by Actors.tsx, ActorStage, `camera/world.ts`.
- [`Actors.tsx`](../../src/world/actors/Actors.tsx) — plans, casts, loads and poses a cast every frame. `ActorsLayer`, `planCast`, `useActorPlans`, `loadActorModel`. Used by Ground and ActorStage.
- [`ActorStage.tsx`](../../src/world/actors/ActorStage.tsx) — a test plaza with scripted people (previews `ActorStage`, `ActorStageWide`). `ActorStage`, `STAGE_SPOTS`, `DEFAULT_SCRIPTS`.

### `src/world/react/` (world reactions)
Design: [11](11-world-reactions.md) (§4 design, §5 the reactions, §7 the camera). The counter's `react` and the world events become one signal per scene in `reaction.ts`; each effect reads a level track from `track.ts`.
- [`reaction.ts`](../../src/world/react/reaction.ts) — the scene's signal at t: [`reactionPlan`](../../src/world/react/reaction.ts#L217) (`COUNTER_FIELDS`, `EVENT_KEYS`, `COMBINE`), `reactionAt`, `beatLevel`, the epicentre [`reactionEpicentre`](../../src/world/react/reaction.ts#L338). Used by Ground, WorldFlight, the camera, `pipeline/shots.ts`, `qa/photographer.ts` and the effect modules. Tests: `reaction.test.ts` and most react tests.
- [`track.ts`](../../src/world/react/track.ts) — the level sampled on a fixed grid, crossings, integrals, bursts (`levelTrack`, `levelIntegral`, `crossings`, `sceneBursts`). Tests: buildings, buildingsShader, debris, lift, particles, `camera/world` tests.
- [`ReactionLayers.tsx`](../../src/world/react/ReactionLayers.tsx) — mounts what one reaction kind draws (lift, confetti, money, crack, water, snow). `ReactionLayers`, `ReactKind`. Used by Ground and ReactionsPreview. Lights out is drawn by GroundWorld itself.
- [`debris.ts`](../../src/world/react/debris.ts) — the reaction site and what lies there to fly: debris props, coin spots and piles. `reactionSite`, `debrisScatter`, `coinSpots`, `coinPileSpots`. Tests: `debris.test.ts`, `lift.test.ts`, `slab.test.ts`.
- [`lift.ts`](../../src/world/react/lift.ts) — closed-form lift, hop, fall and bounce of a rigid piece (`liftSchedule`, `liftPose`, `fallPlan`). Tests: lift, buildings, buildingsShader, debris, particles, slab, snow, water tests.
- [`rigid.ts`](../../src/world/react/rigid.ts) — rigid pieces on the CPU: lift, drop, grow, ride (`rigidPlan`, `rigidPose`, `liftSet`, `moneySet`, `ridePieces`). Tests: buildings, debris, lift, slab, `camera/world` tests.
- [`RigidReaction.tsx`](../../src/world/react/RigidReaction.tsx) — draws rigid pieces as moving instanced meshes, never culled. `RigidReaction`.
- [`particles.ts`](../../src/world/react/particles.ts), [`ReactionParticles.tsx`](../../src/world/react/ReactionParticles.tsx), [`textures.ts`](../../src/world/react/textures.ts) — confetti, banknotes and chips as stateless GPU particles; the shader and its TypeScript mirror `particleAt`; the sprites (a generic note with no real currency's marks). Tests: `particles.test.ts`, `snow.test.ts`, `textures.test.ts`.
- [`crack.ts`](../../src/world/react/crack.ts), [`crackGround.ts`](../../src/world/react/crackGround.ts) — cracks as a Voronoi-edge patch on the ground material (`crackAt` mirrors the shader), and the ground's part: joints, the slabs' ground cut out, the soil pit (`useCrackGround`, `crackScene`). Tests: `crack.test.ts`, `slab.test.ts`.
- [`slab.ts`](../../src/world/react/slab.ts), [`slabMesh.ts`](../../src/world/react/slabMesh.ts), [`slabDust.ts`](../../src/world/react/slabDust.ts), [`SlabReaction.tsx`](../../src/world/react/SlabReaction.tsx) — the ground breaking into slabs: the grid, rafts and releases, one skinned mesh, dust puffs. Tests: `slab.test.ts`.
- [`dark.ts`](../../src/world/react/dark.ts), [`darkShader.ts`](../../src/world/react/darkShader.ts) — lights out: the wave, the flicker, the dimming (`hasDark`, `darkPlan`, `placementKeys`, `DARK_GLSL`); the module-wide uniforms and patches, also the dusk patches (`patchDarkEmissive`, `patchDuskEmissive`, `setDuskUniform`, `darkRig`). Tests: `dark.test.ts`, `dusk.test.ts`, `lapseLight.test.ts`, `buildingsShader.test.ts`.
- [`buildings.ts`](../../src/world/react/buildings.ts), [`buildingsShader.ts`](../../src/world/react/buildingsShader.ts) — whole buildings lifting: which, when, how high and leaning (`placeLiftingBuildings`, `buildingPlan`, `kitLiftMatrices`, `forceNear`); the box cities' vertex-shader side and undersides (`patchBuildingLift`, `setLiftUniforms`, `undersideGeometry`). Tests: `buildings.test.ts`, `buildingsShader.test.ts`, `camera/world.test.ts`.
- [`water.ts`](../../src/world/react/water.ts), [`waterShader.ts`](../../src/world/react/waterShader.ts), [`waterLayer.tsx`](../../src/world/react/waterLayer.tsx) — floods and drains: the plan, the high-water mark, the lens floor (`hasWater`, `waterPlan`, `lensFloor`); wet marks and drop patches, the flood plane, pond beds; the layer that writes the uniforms. Tests: `water.test.ts`, `snow.test.ts`, `camera/world.test.ts`.
- [`snow.ts`](../../src/world/react/snow.ts), [`snowShader.ts`](../../src/world/react/snowShader.ts), [`snowLayer.tsx`](../../src/world/react/snowLayer.tsx) — snow cover by slope and the snowfall volume (`hasSnow`, `snowPlan`, `SNOWFALL_NIGHT`; `patchSnowCover`, `patchSnowCards`, `buildSnowfall`). Tests: `snow.test.ts`.
- [`synthetic.ts`](../../src/world/react/synthetic.ts) — a stand-in level signal, for tests only.
- [`ReactionsPreview.tsx`](../../src/world/react/ReactionsPreview.tsx), [`darkPreview.tsx`](../../src/world/react/darkPreview.tsx) — QA compositions: a plaza reacting to a synthetic counter through GroundWorld's real `reaction` prop. `ReactionsPreview`, `ReactionsPreviewDark`.

### `src/world/data/` and `src/world/test-fixtures/`
- [`data/world-catalog.json`](../../src/world/data/world-catalog.json) — the catalog (about 4,030 assets, one per line), committed. Built by `npm run world:catalog` (`scripts/build-world-catalog.ts`) from the installed packs; files it cannot read are skipped, so rebuild it only where the packs are installed.
- [`data/earth-grid.generated.ts`](../../src/world/data/earth-grid.generated.ts) — the Natural Earth surface grid, run-length encoded, committed. Built by `npm run world:data`.
- `test-fixtures/` — small glTF files and raw records for `catalog.test.ts`.

---

## 4. How-to recipes

Each recipe lists the files to touch in order. After any of them: `npx tsc --noEmit`, `npm test`, `npx eslint src`, then a still and a frame-hash check (§5).

### Add a real place
1. [`places.ts` `PLACES`](../../src/world/places.ts): id, name, country (a short one: the producer's matcher reads every word of it), lat, lon, `style`, `tz` (`std` and `dst` rule: `eu`, `us`, `egypt`, `none`; the UK uses `eu`; add a rule to `utcOffsetFor` if needed), `cloudiness`, optional `terrain` (when the surface map is too coarse), `landmarks` (catalog ids; `rotY`, `clear` for its open ground), `look` (its own colours on the region's look) and `water` (bays and straits on an Ocean terrain). Rome, London and San Francisco (`7b576b3`) are the examples.
2. Nothing else is needed for the director: [`worldDirectorContext`](../../src/world/director-context.ts) lists `PLACES` and `REGION_STYLES` itself. The producer's registry and matcher read `PLACES` too: a landmark that was "at no place" becomes "have" (`library/match.test.ts`, `pipeline/breakdown.test.ts` name such landmarks).
3. Check the sound: `pipeline/sound.ts` `placeSound` decides city or town by style id and desert or coast by surface. Traffic density is by style too (`traffic.ts` `placeTraffic`).
4. A landmark: inside the built area its houses block the camera (`landmarkCityBlockers`); one on a diorama base of its own goes into `LANDMARK_BASES`. A CC-BY one reaches the description through `creditsForPlaces`.
5. Check the camera: `places.test.ts`, `world.test.ts` and `camera/world.test.ts` loop over named places; add the new one where they list places, and run `scripts/phase3-lane-stills.ts` or a one-scene spec (§5) for every subject.
6. Render the place at noon, dusk and night at street level and from above, and hash the old places' frames before and after (§5.1): a new place must leave them byte-identical.

### Add a region style
1. `RegionStyleId` ([L19](../../src/world/places.ts#L19)) and an entry in [`REGION_STYLES`](../../src/world/places.ts#L85): block, street and avenue sizes, floors, roof, colours, windows, trees, `haze`, optional `kit` zones.
2. [`roads.ts` `roadPresetForStyle`](../../src/world/roads.ts#L107): map it to a road preset.
3. For a kit-built core: recipes and sets in [`kits.ts`](../../src/world/kits.ts#L239) (measure the files; `assembler.test.ts` re-measures them), check the far cards (`kitLod.ts cardKinds`, `kitLod.test.ts` "every kit set file has a card kind").
4. Style-id branches elsewhere: [`traffic.ts` `placeTraffic`, `modelWeights`](../../src/world/traffic.ts#L296), `pipeline/sound.ts` `placeKind` and `placeSound`.
5. Tests: `world.test.ts` (kit styles: determinism, off the avenue, no overlap), `traffic.test.ts` (no overlaps per city), `camera/world.test.ts` (avenue lane). Stills at street level and from the flight.

### Add a landmark
1. Get the model: add it to the hand-picked list in `scripts/world-assets/landmarks.ts` (Poly Pizza id; the licence is read from the page, CC-BY lines go to `public/assets/world/landmarks/CREDITS.txt`), then `npx tsx scripts/setup-world-assets.ts landmarks`.
2. For a famous landmark, add its real height and city to the table in `scripts/build-world-catalog.ts` (`landmarkFor`, the list near line 515), then `npm run world:catalog`. The catalog id is `landmark-<slug>`.
3. Place it: `landmarks: [{ asset, lat, lon, rotY? }]` on the place in `PLACES`. [`landmarksFor`](../../src/world/landmarks.ts#L27) clears ground round it and pulls far ones in to 7 km; the camera's `landmark` subject picks it up in `camera/world.ts`.
4. A CC-BY model reaches the video description through `creditsForPlaces` (`generator/generate.ts`). Check `world.test.ts` (landmark positions, credits).

### Add a kit stage
1. A new `src/compositions/<Name>Stage.tsx` with `<Name>Stage({ spec, scene })`. Follow ForestStage: a TOD table keyed by `scene.look.timeOfDay`, `lightsOutAt(spec, t)`, `<WeatherLayer>`, every motion a function of `useCurrentFrame() / fps`, seeded by `spec.id`, and `<ShotCamera spec anchors fallback={<Rig/>}>`.
2. Export a pure `<name>Anchors(...)`: one `Subject` per subject name, with `bounds`, `blockers` and `own`, so the camera tests run in node.
3. Register the kit: [`SceneSchema.kit`](../../src/generator/spec.schema.ts#L142), `SCENE_KITS` in `src/generator/ai/knowledge.ts` (L32), the director's `KIT_GUIDE` (`pipeline/director.ts` L325), `KIT_SUBJECTS` in [`subjects.ts`](../../src/generator/camera/subjects.ts#L9).
4. Route it in [`index.tsx`](../../src/compositions/WhatIfVideo/index.tsx#L137) before the catch-all AssetStage branch.
5. The assembler's kit sets (`pipeline/assemble.ts` L36-38: `SELF_POPULATING`, `WATER_KITS`, `LIGHTS_KITS`) decide which events and casts it accepts; `BEDS_BY_KIT` in `pipeline/sound.ts` gives its ambience.
6. Tests: add its anchors to `camera/stage-sightlines.test.ts` or `stage-bounds.test.ts`. Stills: `npx tsx scripts/phase3-lane-stills.ts --kit <kit>`.

### Add a world reaction or a world event
1. Schema: a new counter reaction goes into [`STAT_REACTS`](../../src/generator/spec.schema.ts#L80); a new event into the `worldEvents` name enum ([L445](../../src/generator/spec.schema.ts#L445)).
2. The signal: [`reaction.ts`](../../src/world/react/reaction.ts#L169) `COUNTER_FIELDS` (counter level to field), `EVENT_KEYS` (the event's ramp), a new field in `COMBINE` with its rest value and combine mode if neither fits. Keep the rest value "nothing happened".
3. The effect: a pure module in `react/` (plan, closed-form pose, a TypeScript mirror of any GLSL), a layer component that writes its uniforms every frame and its rest values when it goes, and its patches applied to the world materials in GroundWorld's build (every scene, inert at rest) or only where needed, following §1.6 rule 6.
4. Wire it: the `reacting` kinds in [Ground L565](../../src/world/Ground.tsx#L565), a branch in `ReactionLayers`, the traffic `halt` / `slow` ([L673](../../src/world/Ground.tsx#L673)) if cars must react, the camera guards in `camera/world.ts` (`guardReactions`, `worldLiftPlan`) if the lens must keep away.
5. The pipeline: the director's prompt (`pipeline/director.ts`, the WORLD EVENTS line L347), the assembler's checks and hits (`PLACE_EVENTS`, `EVENT_HIT`, `REACT_HIT` in `pipeline/assemble.ts`), `holdReactions` in `pipeline/shots.ts` if a shot should hold on it.
6. Tests in `react/<name>.test.ts`: rest is exact, monotone where it must be, the same at any frame order. Before/after frame hashes of a scene without it must be identical.

### Add a camera move or shot option
1. [`shot.ts`](../../src/generator/camera/shot.ts#L14): add to the list (`SHOT_MOVES`, `SHOT_ANGLES`, ...) and, for a size, to `SIZE_DEFAULTS`.
2. [`solve.ts` `place`](../../src/generator/camera/solve.ts#L240): the move's case (distance, bearing, pitch, truck or fov as a function of the eased progress); choose its easing at [L209](../../src/generator/camera/solve.ts#L209); decide whether the detour search judges it like `static` and `follow` ([L500](../../src/generator/camera/solve.ts#L500)).
3. The director sees `SHOT_MOVES` in its prompt (`pipeline/director.ts` L355); add words it may use to `MOVE_ALIASES` in `pipeline/shots.ts` (L47).
4. Tests: `solve.test.ts` (a pure check of the motion), and `camera/world.test.ts` loops every move over real places, so the new one is checked for crowns, facades and roofs automatically.

### Add a director device like the time-lapse
The lapse (commit `aa6b7e9`) touched these, in order. A new device needs the same chain:
1. Schema field and its validation (`spec.schema.ts`, `spec.schema.test.ts`).
2. What the director is told and how its answer is checked and repaired (`world/director-context.ts`, `pipeline/director.ts`, `ai/knowledge.ts`).
3. The assembler carries it into the spec, drops it with a warning when it can't be used (`pipeline/assemble.ts`).
4. A pure module the whole render reads (`world/lapse.ts`: a clock that is exactly the start at `from` and the end at `to`), plus what the scene must build up front so no program compiles mid-scene (`world/lapseLight.ts` `lapseShape`).
5. The render: `WorldStage.tsx` (made once per scene), `Ground.tsx` (built once, written per frame), the atmosphere modules that gained live uniforms (`fog.ts`, `water.ts`, `shafts.ts`, `skyDome.ts`, `darkShader.ts`), `traffic.ts`, the flight (`FlightView.tsx`, `WorldFlight.tsx`).
6. The grade (`look-choice.ts`, `look/blend.ts`, `chain.ts`, `CinematicLook.tsx`) and the sound (`pipeline/sound.ts`, `audio-resolve.ts`, `WhatIfVideo/audio.tsx`).
7. Everything that judges a frame: `qa/photographer.ts`, `pipeline/critic.ts`, `pipeline/transitions.ts`.
8. Tests at every layer, and the verification set of §5: frames without the device byte-identical, frames with it the same at 2 and 6 tabs and in reverse order.

### Change the look or the grade
1. Numbers of an existing look: [`presets.ts`](../../src/compositions/look/presets.ts#L61). The grade maths live in [`grade.ts` `gradeLinear`](../../src/compositions/look/grade.ts#L228) and are mirrored in `GradeEffect.ts`'s GLSL: change both, `look.test.ts` checks the TypeScript side.
2. A new look: add its id to `LOOK_PRESET_IDS` and `LOOK_PRESETS`, and to the separate list in [`look-choice.ts`](../../src/generator/look-choice.ts#L18) with the rule that picks it in `lookFor`. No test ties the two lists together.
3. New effects go into `chain.ts buildChain`, built once per (look, quality); never anything that reads wall-clock time (no `NoiseEffect`, adaptive tone mapping or TAA). If a lapse must blend it, add it to `mixLooks` and `applyLookMix` (`blend.test.ts` checks a lapse changes uniforms only).
4. Check on stills: `LookTestPortrait` (`src/compositions/look/index.ts`) for the preset, then a real scene, then the frame hashes. Grain changes every frame and makes H.264 files much larger.
5. The world's material palette per mood is a different thing: [`atmosphere/mood.ts`](../../src/world/atmosphere/mood.ts).

### Add an actor action
1. [`script.ts`](../../src/world/actors/script.ts#L21): `ACTOR_ACTIONS` and `ACTION_HELP` (the director's prompt reads both), a clip key in `CLIP_KEYS` if it needs one, a default length (`GESTURE_SECONDS`, `ONCE_SECONDS`), and its case in `act()` ([L528](../../src/world/actors/script.ts#L528)), including from which postures it may start.
2. The spec schema has its own copy of the action list at [`spec.schema.ts` L238](../../src/generator/spec.schema.ts#L238): add it there too (the director's schema uses `ACTOR_ACTIONS`).
3. Clips: map the packs' clip names in [`rigs.ts` `mapClips`](../../src/world/actors/rigs.ts#L57); if a procedural overlay can stand in, add it to `PROCEDURAL` and draw it in [`rig.ts`](../../src/world/actors/rig.ts#L1004).
4. Tests: `script.test.ts` (plan and pose), `rig.test.ts` (no foot sliding, nothing through the ground). Stills: the `ActorStage` preview with a script using it.

### Add traffic models
1. The model must be in the catalog (`npm run world:catalog`); [`TRAFFIC_MODELS`](../../src/world/traffic.ts#L97) takes its catalog id, file, body size, `centreZ`, `scale` and `lift`. `traffic.test.ts` checks the sizes against the catalog.
2. Keep three lists the same length: `TRAFFIC_MODELS`, the weights per city look in [`modelWeights`](../../src/world/traffic.ts#L303), and the far boxes' [`BODY_COLOURS`](../../src/world/TrafficLayer.tsx#L26).
3. The head and tail lamps sit at fixed offsets in TrafficLayer's frame callback (sides ±0.62 m, heights 0.62 and 0.72 m): check them on a car of a new shape.
4. A new signal model goes into `SIGNAL_MODELS` (lenses and solids inside the model's box, tested).
5. Run `traffic.test.ts` (no two bodies overlap in any city), then stills by day and at night and the frame hashes.

---

## 5. Verification practice

### 5.1 How earlier work checked frames
All of this lives in gitignored `out/` folders on the dev laptop; [HANDOFF §5](HANDOFF.md) lists the ones referenced most.
- **Bundle once.** `npx tsx out/camera-react-scripts/bundle.mts <name>` builds with `ensureBundle` ([`src/generator/render/bundle.ts`](../../src/generator/render/bundle.ts)) and parks it as `out/<name>`: rspack, no copy of `public/` (885 MB), which is linked as a directory junction instead. Delete such a bundle only after `rmdir <bundle>\public` ([HANDOFF §1](HANDOFF.md)). The plain way, `npx remotion bundle src/index.ts --out-dir out/<name>`, copies `public/` every time. A before/after pair is two bundles: one of the old commit (often from a `git worktree`), one of the new tree.
- **One-scene specs.** Scripts take a real video's props (`out/camera-react/props-<place>-lift.json`, or the Paris video at `output/what-if-money-doubled-every-3-seconds-in-paris/props.json`) and strip them to one scene with locked shots: no counter, timer, captions, events or flights, the hook pushed past the end (`out/agentLAPSE/lapse-spec.mts`). Everything renders through `WhatIfVideo`, so the grade, traffic and camera are the video's.
- **Frame hashes.** `renderFrames` from `@remotion/renderer` with `imageFormat: "png"`, `gl: "angle"` and `onFrameBuffer` hashing each frame with SHA-1, written as `<case> <frame> <sha1>` lines (`out/agentLAPSE/ident-hash.mts`, `out/agentTRAFFIC/whash.mts`). `python out/agentLAPSE/compare.py hash before,before-rerun after` counts identical and different frames per case; several baseline runs are allowed because the old tree had a rare two-state frame pair.
- **Order and tab independence.** The same 30 frames at concurrency 2 and 6, and as 5-frame calls from the last backward in fresh tabs (`out/agentLAPSE/lapse-hash.mts --variant c2|c6|rev`). Identical hashes mean nothing depends on what a tab rendered before.
- **Identity sets.** A change that should not touch other scenes is checked on a fixed set: Paris by day, dusk and night, New York and Colmar at dusk, Cairo at night, plus the Paris video's frames 331-360 (Paris) and 700-730 (Cairo). `out/agentPAR/dusk/run-hashes.sh` runs the whole battery in one go.
- **Stills and sheets.** `renderStill` (or `npx remotion still <bundle> WhatIfVideo out.png --props=... --frame=N --gl=angle --scale 0.5`) into a folder with a `manifest.json`; Python with PIL lays them out as contact sheets (`out/agentTRAFFIC/sheet.py`, `out/agentLAPSE/strips.py`). The reference comparisons are `out/phase7-gate/v2/gate-gravity.png` and `gate-toilets.png` ([quality-refs](quality-refs/README.md)).
- **Scripts in `scripts/`:** `phase3-lane-stills.ts` (one still per subject anchor per kit, world places included, into `out/qa/laneA/`), `photographer.ts` (one draft still per shot, measured by code), `milestone.ts` (the milestone check, `--fixtures --qa`), `self-review.ts` (stills at key moments), `preview-roads.ts` and `preview-terrain.ts` (street networks and terrain without a browser), `verify-video.ts` (audio levels of an mp4 by measurement).

### 5.2 The preview compositions
`npx remotion studio src/world/index.ts`, or `npx remotion still src/world/index.ts <Id> out/x.png --frame=N --props='{...}'`. Registered in [`src/world/Root.tsx`](../../src/world/Root.tsx):

| Id | Component | Shows |
|---|---|---|
| `WorldFlight`, `WorldFlightWide` | WorldFlight | Paris to Cairo, 9:16 and 16:9 |
| `WorldFlightKits` | WorldFlight | Colmar to New York (kit cities) |
| `WorldPlace` | PlaceView | one still lens anywhere (`pos`, `target`, `kitLod`) |
| `GlobeSpin` | GlobeSpin | the globe turning |
| `KitPreview` | KitPreview | kit buildings, or a gallery of kit files |
| `WorldActors`, `WorldActorsWide` | WorldActors | Colmar at street level |
| `WorldMoodUpbeat`, `WorldMoodTense`, `WorldMoodPastel` | WorldActors | the mood palettes |
| `WorldShafts`, `WorldPond`, `WorldNightKits`, `WorldNightNewYork` | WorldActors | shafts, drawn water, kit windows at night |
| `ActorStage`, `ActorStageWide` | ActorStage | scripted actors on a test plaza |
| `ReactionsPreview`, `ReactionsPreviewGravityOn`, `ReactionsPreviewConfetti`, `ReactionsPreviewMoney`, `ReactionsPreviewCrack` | ReactionsPreview | the Paris plaza reacting to a synthetic counter |
| `ReactionsPreviewDark`, `ReactionsPreviewDarkNight`, `WorldNightMoon`, `WorldNightMoonDark` | ReactionsPreviewDark | lights out by day and night, the moonlit night |

These previews are **not the video's picture**: they render ungraded (no CinematicLook), with a logarithmic depth buffer the main canvas does not have, without traffic, lapse or the solver's lens. Use them to inspect geometry and reactions; judge light, grade, shimmer and depth artefacts through `WhatIfVideo` with a one-scene spec. The look has its own entry, `src/compositions/look/index.ts` (`LookTestPortrait`, `LookTestLandscape`).

### 5.3 The render-time bar
Milestone 6's bar is **123 s of render per 15 s of video**: 1.5 times the 82 s the Paris to Cairo flight took in the world engine's second build ([06](06-world-engine.md)). It is measured as the wall time of a CLI render with encode and audio at concurrency 6, on AC power, with no other renders running:

```bash
npx remotion render <bundle> WhatIfVideo out/x.mp4 --props=output/what-if-money-doubled-every-3-seconds-in-paris/props.json --gl=angle --concurrency=6 --frames=331-780
```

Frames 331-780 are the Paris video's 15 s world stretch (the plaza, the flight, Cairo). `out/agentTRAFFIC/time.sh` and `out/agentLAPSE/time-lapse.sh` run before and after interleaved for two rounds and log the wall time, the number of other `chrome-headless-shell` processes before and after and the power source (the lapse script also the CPU load) to `timings.log`; the first, cold run is slower. Last figures: 229 to 112 s after `da39a18`, 85 s without and 92 s with traffic ([12](12-traffic.md)); a 15 s lapse scene 65-66 s ([13](13-light-and-time.md)). Where the time goes is in [06](06-world-engine.md#main-video-render-speed-phase-6-2026-10-29).

---

## 6. Gotchas and open points

Found in the code at `9381c07`. The design docs' own open lists are linked at the end.

**Frame order and state**
- **A layer inside GroundWorld that reads `camera` sees the previous frame's camera** (§1.3), so layers take the lens from props. `ActorsLayer` broke this rule with distance billboards kept in state (`setLodActors` in the frame callback, a new `Sprite` every render); fixed in `2bf5ebd` (after this map's commit): every featured actor is a full rig at any distance, and the layer no longer reads the camera.
- **Module-wide uniforms assume one place on screen.** The dark, dusk, lift, water and snow uniforms are shared by every material, and GroundWorld writes them every frame. Two GroundWorlds in one canvas would overwrite each other; that is one reason the flight swaps its scene inside one canvas and the stage is not drawn under a flight (`flightCovers`).
- **The city is generated twice per scene**, by GroundWorld and by `worldShotSet`, with the same arguments. Change `generateCity`'s arguments in one and the camera's anchors no longer sit on the drawn set. (The flight's ground B uses `CLOUD_PASSAGES.b`, the stage uses `[-75, 0]`: only the extra cloud clusters differ, since the clouds are generated last.) It also costs 0.5-1 s per scene and tab ([06](06-world-engine.md#main-video-render-speed-phase-6-2026-10-29)).
- **Side effects in `useMemo`.** GroundWorld sets `scene.background` and `scene.fog` in a memo ([L824](../../src/world/Ground.tsx#L824)); a kit stage's unmount cleanup clears them after, so its frame callback puts them back ([L859](../../src/world/Ground.tsx#L859)). Keep both if you touch either.
- **A program compiled mid-scene stalls every tab** for seconds on the big lit materials ([`lapseLight.ts`](../../src/world/lapseLight.ts) header). `darkRig` already switches the sun disc's `transparent` (with `needsUpdate`) as a blackout starts, a new program for that one small material; do not add a define, patch or `transparent` switch that flips during a scene on anything larger.

**What the spec asks and the world ignores**
- **Fixed 2026-11-04** ([18](18-world-weather.md)): world scenes draw `look.weather` (rain, storm, snow, timed by `rain-start`/`rain-stop`) and the rules give them a rain bed; a world scene's grade, its photographer stills and its dips follow its real sun, not `look.timeOfDay`; RiverStage reads water-rise, water-vanish and water-return. Since then a flight's grounds draw their scenes' weather, and rain and storm wet the streets (2026-11-05). Still open: a storm's thunder (`stormThunder`) is added only once the assembler calls it.
- **The background crowd is drawn nowhere at HEAD**: GroundWorld's `crowd` defaults off and no composition sets it, including `WorldActors`, whose header and the world Root comment still promise it. The director's prompt still says "Background crowds fill themselves" (`pipeline/director.ts` L319).
- **The coastal ocean is a stub**: for an `Ocean` surface GroundWorld adds a plain 2 km `MeshStandardMaterial` plane at y 0.01 commented "to test rendering", with its comment block pasted twice ([L436-L455](../../src/world/Ground.tsx#L436)).

**Lists that must stay in step** (nothing fails loudly if they drift)
- The actor actions in `spec.schema.ts` L238 and `ACTOR_ACTIONS` in `script.ts`.
- The look ids in `look-choice.ts` L18 and `LOOK_PRESET_IDS` in `presets.ts`.
- `TRAFFIC_MODELS`, `modelWeights` and `BODY_COLOURS`.
- Every GLSL block and its TypeScript mirror: `GradeEffect` / `gradeLinear`, `DARK_GLSL` / `darkLit`, the crack, particle, dust, snow and water shaders and `crackAt`, `particleAt`, `puffAt`, `snowCoverAt`, `flakeAt`, `waterLookAt`. The tests check the TypeScript side.

**Timing and machines**
- **Kit stages and 30 fps (fixed 2026-11-04):** every kit stage and its helpers (`Birds`, `water.tsx`, `weather.tsx`) take the composition's fps. Motions tuned per frame (the asset kits' bobbing, the waterfall mist's drift) run on `frame * (30 / fps)`. At 30 fps the frames are byte-identical.
  - The street and asset-kit stages used to render some frames in more than one state from run to run; fixed on 2026-11-05 ([09 §4](09-phase3-handoff.md#4-kit-stages-frame-by-frame-fixed-2026-11-05)), and every kit stage now owns its fog, background and draw order each frame (`888c6f3`), so all of them can be hash-checked. Still open in world scenes: the flight's car-light pools on the first frame after a ground loads in a tab ([status/determinism.md](status/determinism.md)).
- **Default 30 s holds** on the caption fonts and `RenderAfterMount`; on a busy machine a first frame can run close (the pipeline's own renders use 180 s timeouts).
- **`assembler.test.ts` needs the asset packs installed**: on a fresh clone without `npm run world:assets` it fails on missing files.
- **Render-time margin:** 112 of 123 s per 15 s for the main video's world stretch. Re-time after any world change (§5.3). Known costs: per-tab setup about 20 s, a scene's first draw waiting 4-5 s for programs, the 2048 px shadow map, the far-card atlas up to about 75 MB per tab for New York ([06](06-world-engine.md)).

**Stale text**
- `src/Root.tsx`'s header describes a `story-<slug>` registry that no longer exists, and the file imports `WhatIfVideo` twice under two names.
- `src/world/Root.tsx` starts with a byte-order mark and its header shows "â€”" for a dash.
- `CinematicLook.tsx` keeps the only TODO in scope: ambient occlusion and depth of field, skipped for GPU cost.

**Open points kept in the design docs** (not repeated here): the camera's leftovers and the plaza market as sight blockers ([09 handoff §2](09-phase3-handoff.md#2-left-to-do)); Cairo's square flood lake, the moon's real phase, the old towns and New York facades ([HANDOFF §4](HANDOFF.md)); the reactions' "still differs" lists ([11](11-world-reactions.md)); light pools on the road and the camera not knowing the cars ([12](12-traffic.md#as-built-2026-10-30)); the lapse's open points ([13](13-light-and-time.md#part-b-as-built-2026-11-02-option-a-a-continuous-lapse)); the reference gaps ([quality-refs](quality-refs/README.md#second-gate-comparison-2026-10-29-commit-b06ce7a)).

---

## 7. Asset folders the renderer loads

`public/assets/` and `public/library/` are not in git, and `public/voice/` is ignored except a few tracked samples; `public/fonts/` and `public/sfx/` are in git. Every path is passed to `staticFile()`. Licences of the sound sources: [03](03-audio-sources.md).

| Folder | What | Filled by | Licence | Read by |
|---|---|---|---|---|
| `public/assets/world/kenney/` | 14 Kenney 3D packs (GLB, textures, `License.txt`) | `npm run world:assets` (`scripts/setup-world-assets.ts` + `scripts/world-assets/kenney.ts`) | CC0, checked per pack page | world catalog → KitInstances, market, debris |
| `public/assets/world/kaykit/` | KayKit packs: City Builder Bits (cars, lights, props), furniture, forest, restaurant ... | same, `kaykit.ts` | CC0, licence text checked | traffic, signals, market, ActorStage |
| `public/assets/world/quaternius/` | Quaternius megakits and the iPoly3D desert props | same, `quaternius.ts` (some downloads by hand into `.cache/world-assets/quaternius/`) | the shipped licence decides; non-commercial or no-derivatives packs are rejected | catalog, actors |
| `public/assets/world/landmarks/` | 32 landmark GLBs, `CREDITS.txt` | same, `landmarks.ts` (Poly Pizza) | CC0 or CC-BY 3.0/4.0; CC-BY lines go in the video description | `landmarks.ts` |
| `public/assets/world/world-assets.raw.json` | the downloaders' records | same | — | `scripts/build-world-catalog.ts` |
| `public/assets/{characters,city,nature,props,vehicles}/` | the older Kenney and Poly Pizza packs (characters, city kits, cars, nature, furniture, food) | `npm run assets` (`scripts/setup-assets.ts`, writes `assets.catalog.json` at the repo root, then `assetIndex.generated.ts`) | CC0 | StreetStage, AssetStage, the world catalog (characters for actors) |
| `public/fonts/` | the caption fonts (woff2), `ATTRIBUTIONS.md` | `scripts/add-fonts.ps1` | OFL | `hud/fonts.ts` |
| `public/sfx/` | synthesized one-shots and beds, CC0 recordings in `sfx/cc0/` | `npm run sfx` (`setup-sfx.ts`), `npm run sfx:cc0` | own synthesis; Kenney CC0 | `audio.tsx` fallback `sfx/<tag>.wav` |
| `public/library/` | the downloaded sound library (ambience, music, sfx, stingers), `audio-library.json` | `npm run audio:library` | Kenney and OpenGameArt CC0, BigSoundBank royalty-free, FreePD public domain | files named in `spec.audio` (resolved by `audio-resolve.ts`) |
| `public/voice/` | generated voice lines | the TTS stage (`src/generator/tts.ts`) | — | `audio.tsx` voice cues |

The committed data the world reads at render time: `src/world/data/world-catalog.json` (`npm run world:catalog`) and `src/world/data/earth-grid.generated.ts` (`npm run world:data`, Natural Earth 1:50m, public domain).
