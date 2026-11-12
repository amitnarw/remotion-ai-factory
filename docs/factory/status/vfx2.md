# Done. VFX2 agent: status (2026-11-12)

The factory's own VFX layer is built, committed and proven:
- the closed-form emitter, six families, flipbooks, the preview and the world hook-up;
- frames identical in any tab and order; a loop's 80th second the same alone or in a run; videos without effects unchanged.

The summary is the Status section of [21-vfx-effekseer.md](../21-vfx-effekseer.md#status-2026-11-11-built-our-own). The director's side is the vfx-director agent's (edits below).

Building the factory's own VFX layer, as planned in [21-vfx-effekseer.md](../21-vfx-effekseer.md) §6. The user decided on 2026-11-11: build our own (no Effekseer runtime, no three.quarks, no three-nebula).

## Task
In this order, a commit each:
1. A closed-form emitter in `src/world/vfx/`: a fixed pool whose state at t is a formula of (t, seed, index); bursts and looping emitters; motion under velocity, acceleration and drag; size, colour and alpha curves over age; GPU instanced, a fixed count, fixed bounding spheres; a TypeScript mirror for the tests.
2. Six families as presets: explosion (toon fireball, chunks, smoke), fire, smoke or dust, sparks, impact (puff and debris), magic (glow burst and rings); a flash light whose intensity is a closed-form curve of t where it fits.
3. Flipbooks at `frame = floor(age × rate)`: procedural sheets (no downloads).
4. A preview composition in `src/world/Root.tsx` with every family; stills and a motion sheet in `out/agentVFX/`.
5. Proof: byte-identical frames at concurrency 1 and 6, shuffled, a fresh tab per frame; a looping emitter at t = 80 s alone equals the same frame in a sequence; videos with no VFX byte-identical.
6. `VfxLayer` in GroundWorld: a list of effects (family, position or spot, start, duration, scale); nothing drawn when the list is empty.

Files owned: new `src/world/vfx/*` and its tests; `src/world/Ground.tsx`; `src/compositions/WhatIfVideo/WorldStage.tsx`; `src/world/react/*` (reuse only, reactions byte-identical); `src/world/Root.tsx` (previews); the Status section of `21-vfx-effekseer.md`; this file.

Not mine: `spec.schema.ts`, `pipeline/{director,assemble,shots,sound}.ts` (P6, now done); `WhatIfVideo/index.tsx`, `hud/*`, `brand/*` (brand); `server/*`, `ui/*`, `pipeline/{run,manifest,...}` (variants).

## Committed
- `d11918e` this file, started.
- `bc054e2` step 1: `src/world/vfx/emitter.ts` (the closed-form emitter: spawning for bursts and loops, the uint hash, PVA with drag, ballistic landing with one bounce, orbit, wobble, the curves, the four renderers, the GLSL and its TypeScript mirror `vfxParticleAt`), `flipbook.ts` (the frame maths and the procedural sheets), `emitter.test.ts` (10 tests: the hash against BigInt, curves, bursts, loops one particle per instance, no history at t = 80 s, drag against an integration, landing, flipbook cells, the lens fade, one GLSL text).
- `6fd184f` step 2: `families.ts` (the six families as presets of the emitter, their palettes, the flash light's closed-form curve `flashIntensity`), `VfxLayer.tsx` (one instanced draw per part, fixed bounding spheres and render order, never culled, one flash light per layer; uniforms only per frame), `spec.ts` (the `scene.vfx` entry schema, the effects on the scene's clock, `placeEffects` on the city's spots), `families.test.ts` (6 tests: palettes, loop pools, no pop at birth or death, every particle inside its bounding sphere, nothing alive outside its length, the flash curves).

- `5af9696` step 3: `flipbook.test.ts` (4 tests: the frame at floor(age × fps), wrapped, held or a still cell; the sheets' grids, nothing on the cells' borders; the flame's toon bands, hard outline and seamless loop; the burst grows then burns out from the middle). The sheets themselves came in `bc054e2` (`flipbook.ts`): `glow` (dot, streak, ring, star), `flame` (16 looping frames), `burst` (8 frames, once).

- `e3b1cd4` step 6: `Ground.tsx` (the `vfx` prop: effects placed on the city's spots, `VfxLayer` mounted only when the list has some, with the reaction particles' fog and mood patch), `WorldStage.tsx` (reads `scene.vfx` through `sceneVfx`, puts it on the place's clock: a bullet time slows it), `spec.ts` (+ `VFX_SOUND`, `vfxForPrompt` for the director and assembler), `spec.test.ts` (5 tests). Checks on `wt-vfx`: tsc, eslint, `npm test` 909 of 910 (1 skipped).

- `40dae44` step 4: `VfxPreview.tsx` (GroundWorld's real `vfx` path, graded like a video's world scene), `src/world/Root.tsx` (`VfxPreview` 9:16 and `VfxPreviewWide` 16:9: the six on the Paris avenue at 11:00, the loops burning, the one-shots at 1, 2 and 3 s; `VfxPreviewNight` the same at 22:30; `VfxFamily` one family alone at the plaza, 90 s), `families.ts` (smoke's light lift down to a trace: it glowed at night).

- `3a749d4` tuning from the motion sheets: `VfxFamily` keeps a loop burning for the whole composition (its 80 s column was empty: the loops had stopped at their default length); at night the grade's exposure blew the fire's, sparks' and magic's lights to white (lights lower, flame and burst glow lower).

- `b662b0f` `docs/factory/21-vfx-effekseer.md`: the Status section (what is built, the proof's numbers, how to bake Effekseer's CC0 samples to sheets by hand, what is open).

## Uncommitted
- Nothing of mine.

## Proof (step 5)
- **Existing videos, no VFX in their specs, `3d442de` against `40dae44`** (bundles `b-base`, `b-after`, both from clean `wt-vfx` checkouts; only my files differ in `src`):
  - at 6 tabs: the Paris money video 70 of 70 frames identical (340-369, 590-599, 640-669), the street video 10 of 10; the bullet-time video 87 of 90;
  - the 3 that differed (1001, 1002, 1005) are the base code's own: the bullet video's last scene depends on what a tab drew before. A second run of 1000-1029 alone gives base = after on 30 of 30, but all 30 differ from the first run, where the same tabs had drawn 100-129 and 600-629 first;
  - the whole bullet set at one tab (a fixed schedule): 90 of 90 identical.
- **Through the real video:** the Paris money video's props with a hand-written `scene.vfx` on its Paris scene (six effects round the fountain) draw every family through WhatIfVideo: the solver's lens, the traffic, the grade (`out/agentVFX/video2/sheet-v.png`). A first try had them on plaza-north, -east and -west, which none of the scene's shots looks at, so nothing showed: the director must put an effect where a shot films it (an explosion 12 m from the fountain landed beside this lens and filled the frame). Noted for the vfx-director agent.
- **The effects' own frames:** byte-identical at 1 tab, at 6 tabs, in shuffled groups of 1-4 (a fresh tab each) and one fresh tab per frame in a shuffled order (a subset):
  - `VfxPreviewWide` 30 of 30;
  - `VfxPreviewNight` 30 of 30;
  - the Paris video with six effects through WhatIfVideo, 21 of 21.

  Bundles `b-wfinal`, `b-ffinal` of `3a749d4`; hashes in `out/agentVFX/proof/vfx/`, the spec in `out/agentVFX/proof/paris-vfx-props.json`. The first six-tab run of the video case read the spec before a rewrite and was rerun.
- **A loop's 80th second:** frame 2400 of `VfxFamily`, for fire, smoke and sparks, is identical alone in a fresh tab, after 2390-2399 in one tab, and at 6 tabs; 2399 and 2401 match too (`proof/vfx/loop80-sheet.png`: all three burning).

## Next
- Nothing for this agent. For others: the vfx-director agent's prompt, assembler and hits (below); the determinism owner's bullet-video history fault (below).
- Then the Status section of 21 with the numbers, and remove `wt-vfx` (junctions first).

## Worktree and outputs
- Check worktree `wt-vfx`: removed on 2026-11-12 (its five junctions first, the real folders checked intact).
- Renders: `out/agentVFX/`:
  - `motion/motion-day.png`, `motion/motion-night.png`: the motion sheets (each family alone at six ages; the loops' last column was empty in this render, fixed since: `try6/`);
  - `try4/sheet-allday.png`, `try4/sheet-allnight.png`: the six on the avenue;
  - `proof/`: hash files and frames;
  - `try1`-`try6`: trial sheets.
- Bundles left in `out/agentVFX/`, each holding `public` as a junction (`rmdir` it before deleting one); the trial bundles `b-world1`-`b-world6` were removed that way:
  - `b-world7`;
  - `b-wfinal` and `b-ffinal` (`3a749d4`, world and factory entries);
  - `b-base` (`3d442de`) and `b-after` (`40dae44`).
- The scripts (bundle, frames, the hash compare, the sheets) were scratch files outside the repo: the hash files and frames in `proof/` are what is kept.

## Findings for others
- **Determinism (base code, not VFX):** the bullet-time test video's last scene (`output/what-if-once-a-day-...-654381`, frames 1000-1029) changes with what a tab drew before: frame 1001 drawn after frame 600 in the same tab differs from frame 1001 alone by 2,743 px, at most 4 levels, in a band across the frame (y 1211-1394 of 1920). Frames in `out/agentVFX/proof/hist/`. For the determinism owner. **Fixed by the fixes agent** (status/fixes.md item 5b): the reaction layers kept the first scene's fog patch through a GroundWorld kept for the next scene of the place; 1001 after 600 now equals 1001 alone.

## `scene.vfx` in the pipeline (the layer is ready; a vfx-director agent is wiring it, f19cc45)
The world draws `scene.vfx` today: WorldStage reads it from the props (Remotion passes them unparsed), so a hand-written spec shows effects. No assembled spec has it until these edits land. Everything they need is exported by `src/world/vfx/spec.ts` (pure, zod only).
1. **`src/generator/spec.schema.ts`** (owner: P6, done; route to whoever holds it):
   - `import { SceneVfxSchema } from "../world/vfx/spec";`
   - in `SceneSchema`, after `bulletTime`: `/** The director's effects in this world scene (docs/factory/21-vfx-effekseer.md): each a family at a video time on a city spot. Drawn only when listed. */ vfx: SceneVfxSchema.optional(),`
   - in the spec's checks (next to the bullet-time ones): `spec.scenes.forEach((s, i) => { if (!s.vfx?.length) return; if (s.kit !== "world") problems.push("scenes[" + i + "].vfx is only for world scenes"); for (const v of s.vfx) if (v.t < s.from - 1e-6 || v.t >= s.to) problems.push("scenes[" + i + "].vfx " + v.kind + " at " + v.t + "s is outside its scene"); });`
2. **`src/generator/pipeline/director.ts`**:
   - import `{ VFX_FAMILIES }` from `../../world/vfx/families` and `{ vfxForPrompt, MAX_SCENE_VFX }` from `../../world/vfx/spec`;
   - the scene's zod type (next to `modelSet`): `vfx: z.array(z.object({ kind: z.enum(VFX_FAMILIES), beat: z.string(), where: z.string().optional(), scale: z.number().optional(), palette: z.string().optional(), seconds: z.number().optional() })).max(3).optional(),`
   - the scene parser (next to `modelSet: msModel ? ...`): `vfx: asArray<Record<string, unknown>>(pick(s, ["vfx", "effects", "fx"])).map((v) => obj(v)).filter((v): v is Record<string, unknown> => !!v).map((v) => ({ kind: fuzzyEnum(pick(v, ["kind", "type", "effect"]), VFX_FAMILIES), beat: beatRef(pick(v, ["beat", "at", "start"])), where: str(pick(v, ["where", "spot"])) || undefined, scale: Number(pick(v, ["scale", "size"])) || undefined, palette: str(pick(v, ["palette", "colour", "color"])) || undefined, seconds: Number(pick(v, ["seconds", "duration"])) || undefined })).filter((v) => v.kind && v.beat).slice(0, 3),`
   - the prompt: `${vfxForPrompt()}` on the line after the WORLD EVENTS line; in the JSON example's scene: `"vfx": [] (optional)`.
3. **`src/generator/pipeline/assemble.ts`**:
   - import `{ MAX_SCENE_VFX, VFX_SOUND }` from `../../world/vfx/spec`;
   - where a scene's `world` is set: `const vfx = (s.vfx ?? []).flatMap((v) => { const from = fromOf(v.beat); return from === undefined ? [] : [{ kind: v.kind, t: r3(from + 0.3), ...(v.seconds ? { duration: Math.min(600, v.seconds) } : {}), ...(v.where ? { where: v.where } : {}), ...(v.scale ? { scale: Math.min(4, Math.max(0.25, v.scale)) } : {}), ...(v.palette ? { palette: v.palette } : {}) }]; }).slice(0, MAX_SCENE_VFX);` then `if (vfx.length) { if (scene.kit === "world") scene.vfx = vfx; else warnings.push("vfx dropped: only world scenes draw effects"); }`;
   - the hit, as world events do: `for (const v of scene.vfx ?? []) { const tag = VFX_SOUND[v.kind]; if (tag) events.push({ t: v.t, name: "vfx-" + v.kind + "-" + r3(v.t), targets: [], sfx: [{ tag }] }); }`.
4. **`src/generator/pipeline/shots.ts`** (optional): a shot over an effect's start films its `where` (a camera subject when it is one), wide or medium, like `holdReactions`.
5. **`src/generator/pipeline/sound.ts`**: nothing required (the assembler's hits). A fire or sparks bed needs a CC0 crackle with its own name in `audio-resolve.ts` (none in the library yet).
6. **`src/generator/render/plan.ts`**: check that a chunk's key covers `scenes[].vfx` (it does if it hashes the scene objects, as it does for `bulletTime`).
