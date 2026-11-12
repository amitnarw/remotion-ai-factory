# Done. Places agent: status (2026-11-05)

Rome, London and San Francisco are on `dev` (`7b576b3`), with tests and docs (06, quality-refs, 17). The review agent's fix for the hook's haze is in `camera/world.ts` (`6440ebc`; main messaged with the hash). The four old places render byte-identical with the new places (540 of 540); the new places render the same twice (405 of 405). Worktree `wt-places` removed. Only optional checks are left (Next).

## Task
More real places the director can choose, each reusing an existing region style and a landmark model already in `src/world/data/world-catalog.json`:
1. Rome (`european-old-town`, the Colosseum);
2. London (`european-old-town`, Big Ben);
3. San Francisco (`american-downtown`, the Golden Gate Bridge, its hills and bay);
4. then, if those go well, Athens (the Parthenon).

Each with lat, lon and time zone; terrain and surface; cloudiness; the landmark placed and filmable; spots, traffic density and ambience; flights and the globe; a line in the director's (generated) place list. No new region style: an East Asian style is a proposal below, not code.

Proof: each new place at noon, dusk and night, three shots, a sheet in `out/agentPLACES/`; the four existing places byte-identical (frame hashes before and after); tests in the style of `towns.test.ts` and `world.test.ts`; `creditsFor` lists the CC-BY landmarks of a video that uses them.

Files owned: `src/world/{places,landmarks,city,roads,terrain,surface,trees,meshes,geo,sky,flight,earth-grid,cityAnchors,director-context,kits,kitTown,kitPaint,kitFar,kitLod,kitWindows}.ts`, `KitInstances.tsx`, `src/world/data/*`, `src/world/atmosphere/*`, `src/generator/camera/*`, their tests; docs `06-world-engine.md`, `quality-refs/README.md`, the place lines of `17-code-map-world.md`, this file.

## Committed
- `0c3aba4` this status file.
- `7b576b3` Rome, London and San Francisco: the code and tests below (checked: tsc, npm test, eslint).

## What was built
- `places.ts`: `rome` (Piazza Venezia; the Colosseum 1.1 km SE in 250 m of open ground; CET/CEST), `london` (Trafalgar Square; Big Ben 0.8 km S; GMT/BST on the EU rule), `san-francisco` (Union Square; the Golden Gate pulled in to 7 km WNW; PST/PDT; Ocean terrain). `PlaceLook`: a place's own colours on its region's look (walls, roofs, paving, bell tower, kit paints, tanks); `resolvePlace` lays it over the style (`placeStyle`, one object per place; the four old places get their region's object itself). `PlaceWater`: bays and straits at real lat/lon, pulled in like landmarks (`placeOffset`, `LANDMARK_MAX_DISTANCE` moved here and re-exported by landmarks.ts). Landmark `clear`: its open ground (default 40 m).
- `landmarks.ts`: `LANDMARK_BASES` (the bridge's own sea slab and grass block left out, its sea level at the world's, its towers 227 m over it), `omittedParts`, `PlacedLandmark.size` and `base`.
- `KitInstances.tsx`: skips a model's omitted parts (only the bridge's file has any; the material-order fix is kept).
- `terrain.ts`: a place's own water on an Ocean surface (found by the seed, the place id): bays, the strait under the bridge, steep banks, bluffs where the bridge lands. New York keeps its seeded coast.
- `camera/world.ts`: the landmark subject uses the placed size and base; a landmark inside the built city (Rome, London) gets the city's houses as sight blockers and its trees as keep-outs (`landmarkCityBlockers`; `footBox` lifted to module level, the bell tower's subject unchanged).
- Tests: `places.test.ts` (new, 9 tests), `camera/world.test.ts` (FS low over the new places; no lens in a house or tree round an in-city landmark), `kitPaint.test.ts` (masonry is the American downtown look's).

- (this commit) docs: `06-world-engine.md` "More real places: Rome, London, San Francisco (2026-11-05)"; `quality-refs/README.md` "More places (2026-11-05)". Their evidence lines name `out/agentPLACES/sheet-{rome,london,san-francisco}.png`, which Next step 3 makes.

- (this commit) `17-code-map-world.md`: the `places.ts`, `terrain.ts`, `landmarks.ts`, `KitInstances.tsx` and `camera/world.ts` lines; the "Add a real place" recipe.

- `6440ebc` the review agent's fix for the hook's haze (docs/factory/status/review.md): `camera/world.ts`, a `scene` WS or EWS frames 80 m of the core, 40 m high (`sceneWide`), so its lens stands 0.3-0.4 km out instead of 1.6-1.8 km in the height fog; `camera/world.test.ts`, a scene WS or EWS (eye and high, static and crane_down) within 500 m of the core's centre in 9:16 and 16:9, in Paris, Cairo, Rome, London and San Francisco. Checked on `wt-places` (dev `dedfab2` + these two files): tsc clean, `npm test` 823 tests, 822 pass, 0 fail (1 skipped), eslint clean.
- Its proof (bundles `out/agentPLACES/before4` = dedfab2, `after4` = with the edit; PNG hashes every 6th frame):
  - Scenes that film the place wide: the scene EWS changes (old places 135 of 135, new 135 of 135). The landmark FS low of Paris, Cairo and New York is identical (135 of 135); Colmar, whose scene has no scene shot, is identical (135 of 135).
  - In those same scenes the other shots that see streets change too (the avenue WS in Paris, Cairo and New York; Rome's landmark and belfry WS; London's and San Francisco's street shots): **only the cars and their shadows differ** (`out/agentPLACES/sheet-haze-diff.png`: Paris avenue 8 % of pixels, all on cars; Rome belfry WS 1.2 %, all on cars). The traffic run is built once per scene from the scene's whole lens path (`traffic.ts`, per-path lens zones that clear the cars round the lens), so a new lens in one shot changes which cars a scene keeps. Not a camera change.
  - Scenes without a scene WS or EWS (`cases-noscene.mts`: avenue WS, landmark FS low, scene MS; six places, noon and night): **540 of 540 frames byte-identical** (`hash-noscene-{before4,after4}.txt`, finished after the hard stop).

## Uncommitted (on disk in the dev tree; `git diff <file>` shows them)
- Nothing.

## Checks (the removed worktree `wt-places`: my files, plus the two producer test edits below)
- `npx tsc --noEmit` clean; `npm test` 807 tests, 806 pass, 0 fail (1 skipped); `npx eslint src server` clean. Without the producer's two test edits (Findings 1), `match.test.ts` and `breakdown.test.ts` fail on dev.
- Identity: the four existing places at noon, dusk and night, three shots each, every 6th frame: **540 of 540 frames byte-identical** before and after (`out/agentPLACES/hash-ident-before.txt`, `hash-ident-before2.txt` (a second baseline run, also 540 of 540), `hash-ident-after1.txt`). On the final bundle of `7b576b3`'s code (`after3`): **540 of 540 again** (`hash-ident-after3.txt`).
- The new places render the same twice (the same 3 x 3 cases, every 6th frame): **405 of 405** (`hash-new-a.txt`, `hash-new-b.txt`).
- Relative cost (shared machine, 135 frames per place, `hash-*.log`): Rome 76 s and London 88 s against Paris 61-102 s over three runs; San Francisco 56 s against New York 56-81 s. The same order of cost.
- Stills: `out/agentPLACES/sheet1-{rome,london,san-francisco}.png` (noon, dusk, night x landmark, EWS high, street), `sheet2-bridge.png` (the bridge close, the Colosseum across its open ground).

## Next (optional)
- The no-scene proof of the haze fix: done, 540 of 540 identical.
- The final sheets: made from `stills4/` (the committed code with the haze fix): `out/agentPLACES/sheet-rome.png`, `sheet-london.png`, `sheet-san-francisco.png`.
- Athens and an East Asian style: Proposals below.

## Worktree and outputs
- Check worktree `wt-places`: removed (its three junctions first, then `git worktree remove --force`).
- Bundles `out/agentPLACES/{before,after1,after2,after3,before4,after4}`: each `public` is a junction; `rmdir` it before deleting a bundle.
- Scripts: the session scratchpad's `places/` (bundle, hash, shoot, sheet, cases, probes).

## Findings for others (exact edits; not applied)
1. **Handled** (the coordinator committed the breakdown.test.ts edit in `dedfab2`, adjusted for P6's punch action; another agent had updated match.test.ts). **Producer (`src/generator/library/match.test.ts`, `src/generator/pipeline/breakdown.test.ts`)**: with Rome in `PLACES`, "Rome by the Colosseum" is no longer a landmark at no place; two tests fail until this lands (both pass with it, checked in `wt-places`):
   - `match.test.ts`, the `WORLD` list: add `model("landmark-milad-tower"),` after `model("polypizza-man"),`.
   - `match.test.ts`, test "a landmark at no place is data...": replace its first four lines (the Rome need, `"data"`, the Rome `PlaceDef` match, `place:paris`) with
     ```ts
     const m = await one(need("set", "Tehran under the Milad Tower", ["tehran", "milad"]));
     assert.equal(m.status, "data");
     assert.match(m.data ?? "", /PlaceDef .* Tehran, Iran, in the arab-desert-city look, with the landmark landmark-milad-tower/);
     assert.equal(m.use?.id, "place:cairo");
     ```
     and after the Paris check add
     ```ts
     const rome = await one(need("set", "old Rome by the Colosseum", ["rome", "colosseum"]));
     assert.equal(rome.status, "have");
     assert.equal(rome.use?.id, "place:rome");
     ```
   - `breakdown.test.ts`, "an action story: Last Delivery": `n1: ["data", "place:paris"],` becomes `n1: ["have", "place:rome"],`, and `assert.match(byId.get("n1")!.data ?? "", /PlaceDef .*Rome.*landmark-colosseum/);` becomes `assert.match(byId.get("n1")!.note ?? "", /Rome shows Colosseum/);`.
2. **Sound (`src/generator/pipeline/sound.ts`)**: no edit needed. `placeSound` decides by region style and surface, not by place id: Rome and London sound as cities, San Francisco as a city on the coast (waves, gulls by day).
3. **Determinism agent (`src/world/Ground.tsx`)**: the Ocean "stub" (the 2 km teal `oceanWater` plane at y 0.01: in HEAD `ba5505e` L479-498, with the stray copy of its comment at L418-421; its entry in the world memo's return, L597; its drop in the frame callback, L1033; its `<primitive>`, L1106) shows as a teal ring between the kit core and 1 km out in every aerial of New York (`out/agentPOLISH/brick-after2-stills/newyork-f405.png`) and now San Francisco. The terrain already draws the coast's water at y = 0 (its water faces, OCEAN colour). Deleting the stub changes New York's aerial frames (the ring becomes the terrain's flat ground) and no other place's; a drain would then no longer lower the coast's water.
4. **Traffic (`traffic.ts`)**: no edit needed; density is by region style (a city 1, a town 0.3) and the sun.

## Proposals
- **Athens (evaluated, not built)**: the temple is in stock (`landmark-greek-temple`, CC-BY, 24 x 14 x 20 m: a generic temple a third of the Parthenon's 70 x 31 m footprint). Centred on Syntagma, it would stand 0.84 km to the west-south-west, inside the built area. Three things are missing:
  - The Acropolis: a 70 m rock with a 300 x 150 m top. The city stands on an exactly flat square, so this needs an in-city hill: a tapered prop in `city.ts` (a mesa), the landmark's `base` at its top (`PlacedLandmark.base` exists now), and the rock as a camera blocker.
  - A look: Athens's flat-roofed white blocks fit `arab-desert-city` best, but that look brings minarets and palms, so `PlaceLook` would need to switch off its `landmark` and change its tree kind.
  - The terrain: the surface map says "ocean" at Athens's cell, so it needs Land or Mountain with hills (Lycabettus is 277 m).

  About half a day; worth it only with the Acropolis.
- **East Asian style (Tokyo, Shanghai)**: not built (a new subsystem). It would need a `RegionStyleId` "east-asian-city" (dense blocks, narrow streets, the `east-asian-dense` road preset that `roads.ts` already has), its colours, a sound branch (`placeKind`), traffic weights, and buildings: no CC0 kit exists (06's research), so either our own generator (box towers with signage bands, low wooden houses with curved tiled roofs as tapered props) or Kenney/KayKit city pieces. The landmarks are in stock (Tokyo Tower, the Oriental Pearl Tower, pagodas, Mount Fuji, a torii). About the size of the dressed-places work: a style, its buildings, tests, sheets.
