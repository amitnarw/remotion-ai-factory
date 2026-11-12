# 21 — VFX: Effekseer, or our own particles grown (research, 2026-11-05)

The question: should the factory use Effekseer (`github.com/effekseer/Effekseer`, and its WebGL runtime `EffekseerForWebGL`) for richer stylized effects (explosions, magic, smoke, sparks, impacts)? Or should our own closed-form particles grow instead? This note answers with sources. It is research only: nothing was installed, downloaded or built.

The rule everything is measured against is in [17 §1.6](17-code-map-world.md#16-determinism-rules) and [11 §4.3](11-world-reactions.md#43-determinism-rules-every-reaction-must-pass). A frame is a pure function of (spec, frame). Remotion renders frames out of order in several tabs, often starting mid-video, and nothing may carry over from one frame to the next. Our particles today ([11](11-world-reactions.md), `src/world/react/particles.ts`, `slabDust.ts`, `ProjectilesLayer.tsx`) are stateless GPU particles (Latta 2004): each particle's state is a formula of its seeds and `t`.

The web findings are claims read from the projects' own pages and source files on 2026-11-05. None was tested here. Facts read from source code say "as read" where a test should confirm them.

**Built on 2026-11-11 (our own):** see [Status](#status-2026-11-11-built-our-own).

## Recommendation in short
- **Build our own: grow the closed-form particles into a small VFX layer.** Keep Effekseer's runtime out of the render.
- **Why not Effekseer:**
  - It cannot show an effect at time t. `setFrame(n)` re-simulates from frame 0 in 1-frame steps (§3.1).
  - Each handle's random seed comes from C `rand()` unless the effect or the caller sets one (§3.2).
  - It draws with its own WebGL calls, outside three.js. It knows nothing of our fog, dusk, lights-out or wet patches, it doesn't match our linear colour pipeline, and it would need a custom pass in the composer (§2.3).
  - Per-tab state that our rules forbid: the material shaders' time, the fractional update remainder, and possibly the instance pools' draw order (§3.3).
  - Short one-shots (an impact, a 3 s explosion) would cost little to re-step every frame. Anything that loops through a scene or a whole video would not (§3.4).
- **Borrow from Effekseer:**
  - **Its parameter model.** Most of an Effekseer node is already closed form: position as PVA (position, velocity, acceleration), easing or F-curves over the particle's age; spawn counts and times; size, colour and alpha curves over age. Our presets should use the same vocabulary.
  - **Its CC0 sample library, baked to flipbooks.** Effekseer's sample page says "Almost all effects are distributed under CC-0 License" (about 300 effects). The editor's recorder exports any effect as a sprite sheet or PNG sequence with alpha. A baked flipbook played back at `frame = floor(age × rate)` is closed form (§4).
- **Don't adopt the other libraries either:**
  - three.quarks integrates `update(delta)` per call and uses `Math.random` at spawn. Its current 0.17 needs three ≥ 0.182 (we have 0.178).
  - three-nebula (revived in 2026) is seeded and fixed-step, but it is still stepped from the start, and it has almost no content.
- **Cost of our own build:** about 9 days for the core, six effect families, flipbook import, the director's choice and the checks (§6).

## Status (2026-11-11): built, our own

The user chose on 2026-11-11 to build our own (§6): no Effekseer runtime, no three.quarks, no three-nebula. Steps 1-3 and 6 of §6 and the world's half of step 5 are built. The director's choice is wired end to end (2026-11-12, the vfx-director agent): see "The director's effects" below.

**The code** (`src/world/vfx/`):
- **`emitter.ts`, the closed-form emitter.** A part is a fixed pool of instances, drawn as one instanced mesh:
  - **bursts:** each instance is born once in its spread;
  - **loops:** births at k / rate, the instance showing the newest one at or before t, a pool of ⌈rate × life⌉ + 1, so a loop's 80th second needs no history;
  - **randoms:** an integer hash (Wellons' lowbias32) of the seed, the index and the loop's cycle, in GLSL ES 3.00's `uint` arithmetic: exact on every GPU, and the TypeScript mirror gives the same bits;
  - **motion:** a spawn shape (ball, disc, ring); a cone turned outward; constant acceleration under linear drag toward the wind, in closed form; or ballistic, landing with one bounce; an orbit, a wobble;
  - **look over the age:** size, alpha and glow curves (four keys) and a colour ramp (linear, or stepped for the toon look);
  - **four renderers in one GLSL text:** billboards, billboards stretched along the analytic velocity, tumbling low-poly meshes (puffs and chunks, dissolving face by face toward each face's centre), and flat cards on the ground;
  - `vfxParticleAt` mirrors the vertex shader for the tests.
- **`flipbook.ts`, flipbooks and procedural sheets.** The frame is `floor(age × fps)`, wrapped for a loop or held for a one-shot. Three sheets are drawn in code (nothing downloaded):
  - `glow`: a dot, a streak, a ring and a star;
  - `flame`: 16 looping frames of three nested toon tongues, with heat in red, a dissolve noise in green and a hard outline in alpha;
  - `burst`: 8 frames played once, a starburst that burns out from the middle.
- **`families.ts`, the six families.** Each is a preset of parts, plus a flash light: one point light per layer whose intensity is a closed-form curve (`flashIntensity`), a decaying flash for one-shots and a flicker for loops:
  - **explosion:** flash, toon fireball, smoke, chunks, sparks, shock ring;
  - **fire:** flipbook flames, halo, embers, smoke;
  - **smoke:** a column; its `dust` palette stays low and pale;
  - **sparks:** a fountain and a glint;
  - **impact:** a puff ring, debris, a shock ring and a flash;
  - **magic:** a glow burst, rings, orbiting sparkles and motes.

  Each family has 3-4 palettes. The muzzle flash of §6.2 stays in `ProjectilesLayer` (not folded in).
- **`VfxLayer.tsx`, the drawing:**
  - one mesh per part, never culled, with a fixed bounding sphere round its effect and a fixed render order;
  - only uniforms and the light change per frame;
  - lit parts take the world's height fog and mood patch;
  - the light exists from the layer's first frame.
- **`spec.ts`, the spec side:**
  - the `scene.vfx` entry: `{ kind, t, duration?, where?, offset?, scale?, palette?, seed? }`;
  - `specEffects` (on the place's clock: a bullet time slows them) and `placeEffects` (on the city's named spots, on the ground);
  - `VFX_SOUND`, the hit per family, and `vfxForPrompt()`, the director's block.
- **`VfxPreview.tsx`:** the compositions `VfxPreview`, `VfxPreviewWide`, `VfxPreviewNight` and `VfxFamily` in `src/world/Root.tsx`.

**The world:**
- GroundWorld takes `vfx: { effects, t }` and mounts `VfxLayer` only when the list has some.
- WorldStage reads `scene.vfx` (unknown to the schema today).
- A scene that lists none draws exactly as before.

**Proof (2026-11-12):** Renders, hash files and the scripts' outputs are in `out/agentVFX/` (PNG frames, SHA-1 per frame).
- **Any tab, any order:** the same frames came out byte-identical
  - at 1 tab;
  - at 6 tabs;
  - dealt into shuffled groups of 1-4 frames, each group in a fresh tab;
  - one fresh tab per frame, in a shuffled order (a subset).

  The cases: `VfxPreviewWide` (the six families on the Paris avenue by day) 30 of 30, `VfxPreviewNight` 30 of 30, and the Paris money video through `WhatIfVideo` with six effects added to its Paris scene by hand 21 of 21 (the solver's lens, traffic and grade included).
- **A loop's 80th second:** frame 2400 of `VfxFamily` (a fire, a smoke column, a spark fountain) is identical
  - alone in a fresh tab;
  - after frames 2390-2399 in one tab;
  - among frames 30-2690 at 6 tabs.

  Frames 2399 and 2401 match too.
- **Videos without effects are unchanged.** Bundles of `3d442de` (before) and `40dae44` (after), both from clean checkouts, with only the VFX files differing in `src`:
  - the Paris money video: 70 of 70 frames;
  - the street video: 10 of 10;
  - the bullet-time test video: 90 of 90 at 1 tab.

  At 6 tabs the bullet video showed 3 frames that differ in its last scene. That is the base code's own fault: the scene depends on what the tab drew before (frame 1001 after frame 600 in the same tab differs from frame 1001 alone by 2,743 px of at most 4 levels). It is reported in [status/vfx2.md](status/vfx2.md).
- **Tests:** 25 in `src/world/vfx/` cover:
  - the hash, checked against BigInt;
  - drag, checked against an integration;
  - a loop shows one particle per instance;
  - no pops at birth or death;
  - every particle stays inside its bounding sphere;
  - the flash curves, the sheets and the spec.

**Seen on the stills:** the night grade desaturates the effects with everything else, so at night the flames read peach and the magic rings white. The grade is `look/*`'s, not changed here.

**Baking Effekseer's CC0 samples by hand later** (§4; no tool downloads here):
1. Install the Effekseer editor (effekseer.github.io) on a desktop and open a sample from a collection whose own readme says CC0.
2. File → Record:
   - format: sprite sheet;
   - "X Count": 4;
   - frames: 16 (a loop) or 8 (a one-shot), skipping frames to cover the effect;
   - size: 256 × 256 (64 px cells) or 512 × 512;
   - transparency: "Generate alpha (Blend+Add)".
3. Save the sheet under `public/assets/vfx/<collection>/<name>.png`, with the collection's licence text and the sample's credit beside it (credit asked, not required). Put an entry in the asset setup's licence record, as for models.
4. A loader for it is not built. It would follow `sheetTexture` in `VfxLayer.tsx`:
   - `SHEET_GRID` gets the sheet's cols, rows and frames;
   - a part sets `sheet`, `frames`, `fps` and `flipLoop`;
   - glow parts use the RGB and alpha as they are (`material: "glow"`).
   - A colour sheet would need its own fragment branch: today a card reads red as heat and green as dissolve noise.

**The director's effects (2026-11-12):** how a story gets effects, from the director's reply to the spec ([status/vfx-director.md](status/vfx-director.md)).
- **Nothing without intent.** A world scene's `"vfx": [{ "kind", "beat", "where", "scale", "palette", "seconds" }]`, at most 3 a scene, is the only way in. The director's prompt has `vfxForPrompt()` right after the world events, plus one rule: an effect is a story event (a blast, a fire, smoke or dust, sparks, a crash or a blow, a spell), never decoration; most videos have none.
- **The director's words** (`pipeline/director.ts`) are read leniently: `effects` or `fx` for `vfx`, `type` for `kind`, `at` for `beat`, `spot` for `where`, and aliases for the family ("fireball" and "blast" an explosion, "flames" fire, "dust" a smoke with the dust palette, "short circuit" electric sparks, "spell" magic). A family or palette off the list, a beat outside its scene, or effects on a kit scene are asked about once (`vfxProblems`); after that the assembler drops them with a warning.
- **The timing** (`assemble.ts` `sceneEffects`): each effect goes on the world scene its beat falls in. A one-shot (explosion, impact, magic) starts 0.3 s into its beat, as a world event does. A loop (fire, smoke, sparks) on its scene's first beat is already burning at the scene's start; its seconds are still counted from the beat. A spot that is not a city spot is dropped with a warning (the layer then uses the plaza, else the avenue).
- **Flights** (`effectSound`): under a flight the globe fills the screen. A one-shot in the scene the flight lands in waits until 0.3 s after the landing; one under a take-off is dropped; a loop burns on unseen.
- **The sound:**
  - one hit per effect from `VFX_SOUND` at its start; none for smoke, or for a loop already burning when it is first seen. Every hit name has library files (explosion 8, impact_metal 20, impact_soft_bodies 20, whoosh_dissolve and rise_short 3).
  - A fire or sparks gets a bed while it burns (`VFX_BED`). The library has no CC0 crackle, so the bed is the nearest name, `forest_wind_leaves`: the synthesized wind with a leaf rustle, which no library file matches, so it always plays that file. `wind_city` and `rain_hiss` would pick library recordings with birds or a rain storm in them.
  - The sound designer sees `[effects: ...]` on those beats, and the hits they bring.
- **The camera** (`shots.ts` `frameEffects`): an effect shows only where a shot films it (an effect on a spot no shot looks at never appears). The shot on screen when an effect is first seen films its spot (`where`, else the plaza) at MS, FS or WS, and holds on it 2.5 s, never past its scene or into a bullet time. A shot that began 1.2 s or more before is cut 0.2 s before the effect, so the director's framing stays up to the cut.
- **The registry:** `effect:<family>` entries (kind `effect`), so a breakdown's explosion, fire, smoke, sparks or spell need is have, not build.
- **Unchanged:** the five fixture plans are byte-identical, and so are the what-if prompts (`prompts.test.ts`). The render's chunk keys hash whole scenes, so `scene.vfx` re-renders only its own chunks.

**Open:**
- a CC0 crackle in the library for the fire and sparks beds, with a name of its own in `audio-resolve.ts` (`forest_wind_leaves` stands in);
- in a city without a plaza, an effect with no `where` stands on the avenue, but its shot asks for the plaza, and the camera then films the whole place (the assembler doesn't know the city's layout);
- the flipbook loader for baked sheets;
- soft particles (no depth fade where a puff meets a wall);
- a director's `where` on an actor or the landmark (only city spots and positions today).

## 1. Licences

| Item | Licence | What it means for us | Source |
|---|---|---|---|
| Effekseer runtime (C++) | MIT, "Copyright (c) 2011 Effekseer Project" | Free for commercial use. The notice goes with copies of the software, not into a video. | `LICENSE` in the repo |
| Effekseer editor (the tool) | MIT for the project, plus third-party parts listed in `LICENSE_TOOL`: Ms-PL (DirectX Tool Kit), MIT (imgui, implot, spdlog, ufbx...), BSD-style (PicoJSON), the SIL OFL 1.1 font, a GD notice, an Autodesk FBX SDK notice | We would only run the editor, never ship it, so none of these reach a video. | `LICENSE_TOOL` |
| EffekseerForWebGL (the WASM build) | MIT | Same as the runtime. | its README |
| Effekseer sample effects ("Sample Effects", about 300 effects in 10 collections: Effekseer Official 13, Pierre's 11 + 12, MAGICAL X SPIRAL 103, tktk 71 + 43, AndrewFM 15, and others) | "Almost all effects are distributed under CC-0 License". They are "free to use in your games or movies". A credit to Effekseer and the contributor is asked for, not required. | Free tier ([15 §5](15-producer.md#5-sources-and-the-licence-policy)) item by item. "Almost all" means each collection's own readme decides, read at download time as the policy says. | effekseer.github.io/en/contribute.html |
| Effekseer "Sample Effects (Old)" (project弾幕GIrls, NITORI BOX, Touhou Strategy) | "old License": "free to use when effects is played with Effekseer" | **Never**: custom terms, tied to the runtime, and it would forbid our baked flipbooks. | same page |
| RPG VFX pack (System G6 / Qoma, OpenGameArt) | CC0 ("you don't need to credit me") | Image sequences, 8-64 frames, some loop, 41.6 MB, mostly made in Effekseer. **Check first:** the author says some use "free resources from Unity Labs Paris", whose licence is not CC0 by default. | opengameart.org/content/rpg-vfx-pack (the page refused our fetch; facts from the search result's copy) |
| Paid and Japanese free packs (Dreams Circle EVFX on itch.io, BOOTH sets) | custom terms or paid | Not in our Free tier. | — |

**Verdict:** the licences don't block anything. The runtime and the editor are MIT. Most official samples are CC0, so they are usable as content, including baked into our own flipbooks.

## 2. The WebGL runtime

### 2.1 State and size
- **Active.** Effekseer 1.80.8 came out on 2026-10-30, with 1.80.5-1.80.7 in June-August 2026. Each release ships `EffekseerForWebGL1.80.8.zip` (3,000,475 bytes). The zip holds `effekseer.min.js`, `effekseer.wasm`, an asm.js fallback `effekseer_asmjs.js`, and a sample. The wasm's own size is not on any page read. The zip also carries the sample's `three.min.js` (610 KB), so the runtime itself is well under 3 MB.
- **Not on npm.** It is distributed as release zips (the README names no npm package). The repo's own GitHub release page still lists 1.70e as "Latest"; 1.80.x is attached to the main Effekseer releases.
- **Open issues to note:**
  - #142 (open, 2026-01): "Uncaught RuntimeError: float unrepresentable in integer range" on 1.8, with no reply.
  - #136 (closed): the same effect looked different in the editor and in the WebGL runtime.
  - The main repo's README warns that master is a development branch.
- **WebGPU:** an experimental WebGPU runtime with a three.js sample (PR #147) was closed unmerged in May 2026. The README says new WebGPU and WebGL work is starting.

### 2.2 three.js integration (a sample exists)
`Release/Sample/index.html` uses three.js. The README's pattern:
1. `effekseer.initRuntime(wasmPath, onload)`, then `context = effekseer.createContext()` and `context.init(renderer.getContext())`. Optionally `setRestorationOfStatesFlag(false)`, the fast mode.
2. `effect = context.loadEffect(url)`; `handle = context.play(effect, x, y, z)`.
3. Every frame:
   - `context.update(clock.getDelta() * 60.0)`;
   - `renderer.render(scene, camera)`;
   - `context.setProjectionMatrix(camera.projectionMatrix.elements)` and `context.setCameraMatrix(camera.matrixWorldInverse.elements)`;
   - `context.draw()`;
   - `renderer.resetState()` in fast mode.

The API in `src/js/effekseer.src.js`, as read:
- `update(deltaFrames)` counts in **60 fps frames**. A falsy value, 0 included, becomes 1.
- `play(effect, x, y, z)` has **no start-frame argument** (the C++ `Play` has one; the binding doesn't pass it).
- `handle.setFrame(frame)`, `handle.setRandomSeed(seed)`, `handle.setSpeed`, `handle.setPaused`, `updateHandle(handle, delta)`, `drawHandle(handle)`, `beginUpdate`/`endUpdate`, `stopAll`.
- `init` options: `instanceMaxCount` 4,000, `squareMaxCount` 10,000, `enablePremultipliedAlpha`, `enableExtensionsByDefault`, a timer-query option that measures draw time only.
- No `Math.random`, `Date.now` or `performance.now` in the JS.

In `src/cpp/main.cpp`:
- the renderer is created as OpenGL ES 2;
- there is no depth-texture input (soft particles can't read our depth) and no colour-space setting;
- `captureBackground` copies the framebuffer for distortion effects.

### 2.3 What it would take in our renderer
- **The composer.** Our picture goes through `CinematicLook` ([17 §1.5](17-code-map-world.md#15-the-grade-the-hud-and-the-sound)): the scene renders into a linear half-float target, then Bloom, tone mapping, SMAA, the grade and grain run. Effekseer would have to draw into the composer's input target after the scene pass, in a custom pass that binds that target (whose depth buffer gives occlusion by buildings), calls `context.draw()` and `renderer.resetState()`. Drawn after the composer instead, effects would skip the grade and draw over buildings.
- **Colour.** Effekseer's colours are authored for a gamma-space screen. In our linear target they would come out too bright and washed out, until each effect's colours are converted or a conversion is patched into the runtime's shaders.
- **Fog and our patches.** Our fog, dusk, lights-out, wet and grade patches ([patch.ts](../../src/world/atmosphere/patch.ts)) can't reach Effekseer's shaders. A distant explosion would stand unfogged in the height fog.
- **The lens.** The camera matrices must come from the frame's pure pose (props), never from `camera` inside a GroundWorld layer, which still holds the previous frame's camera ([17 §1.3](17-code-map-world.md#13-the-order-of-work-in-one-frame)).
- **Loading.** The wasm and the effect files load through `staticFile` under a `delayRender` hold, like the kit models.
- **three 0.178:** no conflict. The runtime uses raw GL and doesn't depend on three's version.

## 3. Determinism (this decides it)

### 3.1 Can an effect be shown at time t without simulating every step from the start? No.
`setFrame(frame)` calls `Manager::UpdateHandleToMoveToFrame` (main.cpp). In `Effekseer.Manager.cpp`, as read:
- **Backward** (`frame < updatedFrame`): `StopWithoutRemoveDrawSet`, then `ResetAndPlayWithDataSet(drawSet, frame)`. That reseeds from the stored `drawSet.RandomSeed` and steps `for (float f = 0; f < frame - 1; f += 1.0f)`: a full replay from frame 0.
- **Forward:** `for (int i = 0; i < frame - updatedFrame; i++) UpdateHandle(handle, 1)`: one step per 60 fps frame.
- `Update(float)` sets `UpdateInterval = 0`, so a plain update is one big step. The WebGL binding's `update` loops `Update(1)` over whole frames and carries the fraction over (`restDeltaTime_`).

So the state at t is the result of 60·t steps. An Effekseer node is mostly formulas of age (PVA, easing, F-curves: the tool reference's position modes). But spawning, parent-child inheritance, local force fields and collisions are stepped, and the runtime has no closed-form path.

### 3.2 Is its randomness seeded? Yes, but not by default.
- `PlayInternal` takes the effect file's own seed if `m_defaultRandomSeed >= 0`, else `GetRandFunc()()`, which defaults to C `rand()`. The editor's Global setting "Random seed" says "If the random seed is 0 or less, the behavior of random elements change each time."
- The generator is a per-effect LCG (`Effekseer.Random.cpp`: a = 1103515245, c = 12345, m = 2147483647). It is exact integer arithmetic.
- `handle.setRandomSeed(seed)` calls `SetRandomSeed`, which, as read, sets only the live generator, not the stored `drawSet.RandomSeed`. So a later backward `setFrame` replays with the play-time seed, and anything `Play` drew before the call used `rand()`. The safe seed is the effect file's own Global seed (above 0). A per-placement seed would need a test, or a patched binding.

### 3.3 Other state that would differ from tab to tab
- **Material time.** `renderer->SetTime(context->time_)`, where `time_` grows only through `update`/`updateHandle`, never through `setFrame`. Any material that uses the Time node would depend on what the tab drew before. The fix is a patched, rebuilt binding with a `setTime(t)`, or no Time-node materials at all.
- **The update remainder** (`restDeltaTime_`), kept across calls.
- **Instance pools.** Instances live in chunks reused from a pool. If the draw order of overlapping alpha sprites follows chunk order, a tab that has played other effects could draw them in a different order. This is the same class of fault as bullet2's two-pixel flip (`b8eaca6`). Untested.
- **Floating point.** WASM floats are IEEE and deterministic (NaN bits aside), so the same build gives the same simulation on every machine. Our GPU draw varies by GPU as it already does.

### 3.4 What re-stepping costs at 30 fps
Effekseer counts 60 frames a second, so video frame f of an effect born at frame f₀ is Effekseer frame 2(f − f₀). Replaying from the effect's own birth (never the video's start) costs 2k steps at the effect's k-th video frame: N(N+1) steps over N frames.

No published benchmark gives Effekseer's per-step cost (the C++ manager reports `GetUpdateTime`, which the WebGL binding doesn't expose). The table assumes **0.05-0.5 ms a step** in WASM for 100-1,000 live instances. That is an estimate to be measured, not a fact.

| Effect | Life | Steps in its worst frame | Steps over its life | Worst frame; total CPU at 0.05-0.5 ms a step |
|---|---|---|---|---|
| impact, sparks | 1 s | 60 | 930 | 3-30 ms; 0.05-0.5 s |
| explosion | 3 s | 180 | 8,190 | 9-90 ms; 0.4-4 s |
| fire or smoke looping through a scene | 15 s | 900 | 202,950 | 45-450 ms; 10-100 s |
| a loop through a 38 s video | 38 s | 2,280 | 1,300,740 | 0.11-1.1 s; 1-11 min |
| a loop through a 90 s video | 90 s | 5,400 | 7,292,700 | 0.27-2.7 s; 6-61 min |

For scale: a world frame already costs about 1.5 s per tab (the Paris stretch: 450 frames in 112 s at concurrency 6, [06](06-world-engine.md#main-video-render-speed-phase-6-2026-10-29)). A 90 s video is 2,700 frames, about 4,000 tab-seconds.
- **One-shots up to about 3 s add under 0.1 %:** affordable.
- **A loop through a whole video adds 9-90 %**, more with several effects. A loop would have to be cut into overlapping, seeded one-shots of bounded life, which changes how effects are authored.
- **A forward-only cache** (keep the handle, step on from the last frame a tab drew) brings it down to 2 steps a frame. It is lawful under rule 2 only if stepping 0→k→n gives exactly the same state as 0→n. As read, the forward path is the same `UpdateHandle(handle, 1)` sequence either way, but that is a hash test to pass, not a given. The backward path (`ResetAndPlayWithDataSet`) is different code and must be avoided: stop and play fresh instead.

### 3.5 Same pixels every time?
- **Likely, if every condition holds:** the effect's own seed set, no Time-node materials, a fresh play and a forward replay every frame, a fixed draw order.
- **Not shown yet.** Each condition needs the hash tests of [17 §5](17-code-map-world.md#5-verification-practice) (2 and 6 tabs, reversed). Even then the effect is a replay, not a formula: it meets the letter of the rules at a cost that grows with the effect's age.

## 4. Content

- **Effekseer samples:** about 300 CC0 effects (§1). Their look is mostly anime/JRPG: additive glows, flares, magic circles, slashes. That fits "stylized", less so "low-poly". Effekseer can also draw model nodes (meshes) and ribbons, so faceted, flat-coloured effects can be authored in it, but the samples are mostly sprites.
- **Baked flipbooks.** The editor's recorder exports a sprite sheet ("X Count" frames a row) or a numbered PNG sequence, with a frame range, a frame skip, a size, and four transparency modes. "Generate alpha (Blend+Add)" records blend and additive parts separately for correct compositing. This is a GUI step; no command-line mode was found. A person would bake a chosen set once, and the licence record follows each source collection. A baked flipbook is a camera-facing card with no parallax inside it, which is how most game explosions and impacts are drawn anyway.
- **Other CC0 content:**
  - Kenney's Particle Pack (80+ sprites) and Smoke Particles (77 sprites, five styles), already proposed in [11 §3](11-world-reactions.md);
  - the RPG VFX pack (CC0 image sequences, after checking its Unity Labs part);
  - JangaFX's 2020 CC0 VDB volumes are realistic gas simulations: wrong for the look.
- **What making an effect costs:**
  - **In Effekseer:** a VFX artist's hours per effect in a GUI. The files (`.efkefc`) are binary and editor-made, so an AI role can only pick from a fixed set. It can't vary an effect beyond position, scale, speed and seed.
  - **Our own way:** each effect family is code plus a preset, written once (0.5-1 day a family, §6). The director can then vary colour, scale, count, timing and spread through data, so each video's effects are chosen, not just placed ([10-intent-audit.md](10-intent-audit.md)).

## 5. The alternatives compared

| | Effekseer (WebGL) | three.quarks | three-nebula | Our own, extended |
|---|---|---|---|---|
| Licence | MIT (runtime, editor); samples mostly CC0 | MIT | MIT | ours; CC0 sprites |
| State | 1.80.8, 2026-10-30; active | 0.17.1; active (R3F package, WebGPU shaders in 0.17.0) | 13.3.0, 2026-09-19; revived after 10.0.3 (2021) | particles, dust, flash, trails in use |
| Fits three 0.178 | yes (raw GL, outside the scene graph) | **0.17 needs three ≥ 0.182** (0.16 needs ≥ 0.165) | yes (peer ≥ 0.122; tested on 0.185.1) | yes |
| Inside our composer, fog and patches | no: own GL draw, custom pass, colour mismatch, no fog | yes (three materials) | yes (sprites, meshes, points) | yes |
| Show at time t | **no**: `setFrame` replays 1-frame steps | **no**: `update(delta)` integrates (`position.addScaledVector(...)`, `age += delta`), delta clamped to 0.1 s; prewarm loops `update(1/60)`; the `time` setter doesn't simulate | **no**: `update(dt)` fixed steps; "reproducibility = same seed + the same number of fixed steps" | **yes**: a formula of (seeds, t) |
| Seeded | per effect file or handle; default `rand()` | **no**: `Math.random()` at spawn (`IntervalValue.startGen`) and for burst probability | yes: `setSeed`, its own stream, "does not consume from the global `Math.random`" | yes: `makeRng` |
| Cost at t | O(age × 60) WASM steps | O(age / dt) JS steps | O(age / dt) JS steps | O(1): uniforms only |
| Content | about 300 CC0 samples; GUI editor | quarks.art editor (JSON); Shuriken import (Unity Store packs are not licence-eligible) | JSON systems; no editor found | presets as data; CC0 sprites; baked CC0 flipbooks |
| An AI can author it | no (binary files) | JSON, verbose | JSON | yes (a few named parameters) |

wawa-vfx (MIT, R3F) was looked at too. Its README doesn't say whether its motion is a GPU formula of age or integrated, nor how time is driven, so it is not assessed.

## 6. The recommendation and a build plan

**Build our own; borrow Effekseer's parameter model and its CC0 samples as baked flipbooks.**

The core, `src/world/vfx/` (a proposal; the names are illustrative):
1. **The emitter in closed form (2 d).**
   - **Bursts:** a burst at time b gives particle i its birth `b + jitter(i)`.
   - **Continuous emitters:** rate r and life L need a fixed pool of N = ⌈rL⌉ + 1 instances. At time t, instance i shows the particle with the largest birth index k ≡ i (mod N) and k ≤ rt, born at k/r. It is alive while t − k/r < L, which holds for every instance. So a fire or a smoke column runs through a whole video with no history and no warm-up.
   - **Motion over age a:** PVA with closed-form linear drag (the confetti's), easing, or a sampled F-curve; orbit (angle ω·a, radius curve) for magic; ballistic sparks.
   - **Look over age:** size, colour and alpha curves.
   - **Renderers:** billboards; stretched billboards along the analytic velocity; instanced meshes; flipbook cards at `floor(a × rate)`.
   - **Rules:** one GLSL text for every instance and kind ([patch.ts](../../src/world/atmosphere/patch.ts)), with a TypeScript mirror for the tests, like `particleAt`.
2. **Six families as presets (3 d):**
   - sparks;
   - impact: a ring, dust and chips (generalising the projectiles' strike burst);
   - toon explosion: low-poly icosphere shells growing with a stepped colour ramp and a noise dissolve, plus smoke puffs, sparks and a flash;
   - smoke column and fire (continuous);
   - a magic burst or circle;
   - the muzzle flash (exists, folded in).
3. **The flash light (0.5 d).** One point light per scene with an intensity curve. It exists from frame 0 at intensity 0, so no program compiles mid-scene.
4. **Flipbook import (1 d).**
   - An atlas loader and a licence record per item in the asset setup.
   - Kenney Smoke and Particle packs first.
   - Then a set of Effekseer CC0 samples the user bakes in the editor's recorder (Blend+Add alpha), and the RPG VFX pack after its check.
5. **The director's choice (1.5 d):**
   - `scene.vfx: [{ kind, at, where (spot, actor, landmark), scale, palette, seed }]` in the schema;
   - the director's prompt list, the assembler, a paired sound cue;
   - the effect enters only when a role chose it.
6. **Checks (1 d):**
   - frames without effects byte-identical;
   - frames with them identical at 2 and 6 tabs and reversed;
   - a frame-by-frame pop audit;
   - a stills sheet next to a few baked Effekseer references.

**Total: about 9 days.** Steps 1-2 alone give explosions, smoke, sparks and impacts in the look, at no per-frame CPU cost.

**If Effekseer's runtime is wanted anyway** (for example to play its samples live, with 3D parallax inside an effect), do a one-day spike before deciding:
1. Load the wasm in a test composition.
2. Draw in a custom pass inside `CinematicLook`'s composer.
3. Each frame: stop all, play fresh, `setFrame(2 × age)`, draw. Use the effect's own Global seed.
4. Measure the step cost with `performance.now` around `setFrame`.
5. Hash 30 frames at 2 and 6 tabs and reversed.

Adopt it only for one-shots of 3 s or less, and only if three things hold: the hashes match, a 3 s effect costs under 50 ms a frame, and the colour and fog mismatch is acceptable or fixed.

## Sources (read 2026-11-05)
- Effekseer repo, README and licences: https://github.com/effekseer/Effekseer ; https://raw.githubusercontent.com/effekseer/Effekseer/master/LICENSE ; https://raw.githubusercontent.com/effekseer/Effekseer/master/LICENSE_TOOL
- Effekseer releases (1.80.8, 2026-10-30, asset sizes): https://api.github.com/repos/effekseer/Effekseer/releases
- The manager, the seek and the seed (as read): https://raw.githubusercontent.com/effekseer/Effekseer/master/Dev/Cpp/Effekseer/Effekseer/Effekseer.Manager.cpp ; https://raw.githubusercontent.com/effekseer/Effekseer/master/Dev/Cpp/Effekseer/Effekseer/Effekseer.Random.cpp
- EffekseerForWebGL README (the three.js usage): https://github.com/effekseer/EffekseerForWebGL ; the JS API: https://raw.githubusercontent.com/effekseer/EffekseerForWebGL/master/src/js/effekseer.src.js ; the binding: https://raw.githubusercontent.com/effekseer/EffekseerForWebGL/master/src/cpp/main.cpp ; the sample folder: https://github.com/effekseer/EffekseerForWebGL/tree/master/Release/Sample
- EffekseerForWebGL issues #136, #142 and PR #147: https://github.com/effekseer/EffekseerForWebGL/issues/136 ; https://github.com/effekseer/EffekseerForWebGL/issues/142 ; https://github.com/effekseer/EffekseerForWebGL/pull/147
- Effekseer tool reference: the global random seed https://effekseer.github.io/Help_Tool/en/ToolReference/global.html ; the recorder https://effekseer.github.io/Help_Tool/en/ToolReference/record.html ; position modes https://effekseer.github.io/Help_Tool/en/ToolReference/location.html
- Effekseer sample effects and their licence: https://effekseer.github.io/en/contribute.html
- RPG VFX pack (CC0): https://opengameart.org/content/rpg-vfx-pack
- three.quarks: https://github.com/Alchemist0823/three.quarks ; `ParticleSystem.ts` https://raw.githubusercontent.com/Alchemist0823/three.quarks/master/packages/three.quarks/src/ParticleSystem.ts ; `IntervalValue.ts` https://raw.githubusercontent.com/Alchemist0823/three.quarks/master/packages/quarks.core/src/functions/IntervalValue.ts ; the changelog https://raw.githubusercontent.com/Alchemist0823/three.quarks/master/CHANGELOG.md ; npm https://registry.npmjs.org/three.quarks/latest , https://registry.npmjs.org/three.quarks/0.16.0
- three-nebula: https://github.com/creativelifeform/three-nebula ; README https://raw.githubusercontent.com/creativelifeform/three-nebula/master/README.md ; npm https://registry.npmjs.org/three-nebula
- wawa-vfx: https://github.com/wass08/wawa-vfx
- JangaFX's CC0 VDBs (2020): https://www.cgchannel.com/?p=113054
- Latta, "Building a Million Particle System" (GDC 2004), and the Kenney packs: see [11-world-reactions.md](11-world-reactions.md#sources)
