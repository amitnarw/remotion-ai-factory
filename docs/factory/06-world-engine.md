# 06 — One-world engine: research and test build (2026-10-23)

## What the user asked for
One continuous low-poly world instead of separate stages: the whole Earth (countries, cities, nature, seasons, time of day), other planets, and interiors. The AI picks the best place, season and time for each scene from a catalog of what exists. One video can travel between places with smooth transitions. Cities are **generated from regional style rules; no OpenStreetMap** (user's choice).

## Research: does something already do this? (three searches, 2026-10-23)
**No.** Nothing free does "AI picks place and time, builds a stylized low-poly world, renders smooth travel" end to end. It has to be built, but large parts can be taken from existing work.

### Use as-is
| What | Licence | For |
|---|---|---|
| Quaternius Medieval Village MegaKit, Kenney Fantasy Town / Retro Urban / Modular Buildings | CC0 (Quaternius moved to its own "Asset License v1.0" on 2026-08-28: video use allowed; keep each download's licence file) | European towns, house interiors |
| Quaternius Downtown City MegaKit; Kenney city/suburban kits (already downloaded) | CC0 | US downtown, suburbs |
| KayKit City Builder Bits, Forest Nature, Furniture Bits; iPoly3D Desert Props | CC0 | Cartoon city, nature, interiors, desert props |
| THREE.Terrain (github.com/IceCreamYou/THREE.Terrain) | MIT | Seeded terrain, biomes, snow lines |
| EZ-Tree (github.com/dgreenheck/ez-tree) | MIT | Seeded low-poly trees, season variants baked offline |
| ProbableTrain MapGenerator tensor-field core (github.com/ProbableTrain/MapGenerator) | LGPL-3.0 (output is free); MIT fallback: t-mw/citygen | Organic street networks and building lots per region |

No CC0 kit exists for Arab, Indian or Japanese architecture: our own generator stays for those, and for distant background buildings.
No CC0 famous landmarks exist. Poly Pizza has Eiffel Tower, Big Ben, Tokyo Tower, Statue of Liberty, pyramids, a pagoda and a mosque, all **CC-BY 3.0** (credit line needed). Open question for the user.

### Test before adopting
- **3DTilesRendererJS** (NASA-AMMOS, Apache-2.0, supports React Three Fiber 9 and three ≥0.167): could give a truly continuous descent from orbit to street instead of the cloud cover. Natural Earth fills as a GeoJSON overlay; relief from AWS Terrain Tiles (free, no key; some regions CC-BY/OGL attribution). Risks: tiles load asynchronously (every frame must wait for them), terrain is smooth (a shader is needed for the faceted look).

### Borrow ideas, not code
- **Holodeck** (AllenAI, Apache-2.0): how the AI knows what exists. Each asset is annotated once (category, size, on-floor/on-wall flags, description); the AI asks in words and a score picks the asset; layouts come from relational constraints ("near", "against wall", "facing") solved by a small search. Use for the world catalog and interiors, with Ollama models instead of GPT-4.
- **SceneX / 3D-GPT / SceneCraft**: the AI never touches geometry. It reads a catalog and generator docs, outputs IDs and parameters (schema-checked), a deterministic builder makes the scene, and a vision model reviews stills (our planned "photographer" role).
- **threejs-planet-terrain** (no licence, idea only): quad-sphere level of detail and a floating origin, if we build our own continuous globe.
- **takram three-geospatial** (MIT): sun and moon direction helpers.

### Rejected
CesiumJS, iTowns, Giro3D, OpenGlobus, MapLibre, deck.gl (own render loop or imagery-first); three-geo, geo-three (keyed imagery); Google Earth Studio (no commercial use); Mult.dev, TravelBoast, Vyond (manual apps); Claude Motion (2D, no API); Infinigen (photoreal, heavy); CityDreamer (non-commercial); Tiny World Builder (AGPL); hello-worlds, LayoutVLM, 3D-GPT (no licence); Sketchfab landmarks (CC-BY only, often 100k+ faces); Synty and SceneCity (paid).

## Test build (built before the research; kept as the starting point)
Separate entry point, nothing in the main factory touched: `src/world/`, `scripts/setup-world-data.ts`.
- `npm run world:data` builds the surface grid from Natural Earth 1:50m (public domain): ocean, land, desert, mountains, tundra, ice, lakes at quarter-degree cells, 55 KB.
- `geo.ts`: NOAA sun position, subsolar point, season by hemisphere, great-circle maths. `places.ts`: place catalog + regional styles + `resolvePlace`. `city.ts`: seeded city generator. `flight.ts`: camera path street → clouds → globe → clouds → street. `Ground.tsx`, `Globe.tsx`, `WorldFlight.tsx`.
- Run: `npx remotion studio src/world/index.ts` or `npx remotion render src/world/index.ts WorldFlight out/world-flight.mp4`.
- Tests: `npx tsx --test src/world/world.test.ts` (11 pass: midnight sun in Tromsø, equinox noon in Cairo, surface map, city determinism, no camera jumps, cloud cover closed at both scale switches).

Measured on the dev laptop (i7-10850H, Intel graphics only): Paris → Cairo, 15 s at 1080×1920, **rendered in 86 s** (5.7× real time). Same frame rendered twice is byte-identical. Both scale switches are fully hidden in cloud.
Weaknesses seen: the globe just after the cloud opens (about 300 km up) shows crude 55 km facets; generated cities look like grids from above; box buildings up close are plain.

## Recommended direction
Keep from the test build: Natural Earth globe (nothing found is ahead of it), sun/season maths, place resolver, flight timing. Replace: grid streets with tensor-field roads; near buildings with CC0 kit pieces snapped onto lots; trees and ground with EZ-Tree / KayKit and THREE.Terrain. Add: a Holodeck-style asset catalog the director reads. Test 3DTilesRendererJS for the mid-altitude band; keep the cloud cover if it fails.

## Build 2: real assets, catalog, streets, terrain (2026-10-23)
Built by parallel agents, all inside `src/world/` and `scripts/` (main factory untouched). 70 tests pass (`npx tsx --test src/world/*.test.ts`).

**Set up on a new machine** (needs internet once; assets are not in git):
```
npm run world:data                      # Natural Earth surface grid (already committed; only to rebuild)
npm run assets                           # older Kenney/Poly Pizza packs (public/assets/city etc.)
npm run world:assets                     # new packs into public/assets/world/ (~380 MB)
npm run world:catalog                   # re-measure and re-classify (writes src/world/data/world-catalog.json)
```

| Piece | Files | What it does |
|---|---|---|
| Asset packs | `scripts/world-assets/{kenney,kaykit,quaternius,landmarks}.ts` | Kenney 14 packs (1,255 models), KayKit 10 packs (1,061), Quaternius + iPoly3D 6 packs (609), 32 landmarks (29 CC-BY with credit lines, `public/assets/world/landmarks/CREDITS.txt`). Licence checked per pack; idempotent. |
| Catalog | `scripts/build-world-catalog.ts`, `src/world/catalog.ts` | 4,030 assets: real size in metres, category, building part, placement, regions, indoor/outdoor, licence, credit. `findAssets`, `catalogSummary` (~1,400 tokens), `creditsFor`. |
| Streets | `src/world/roads.ts` | Own tensor-field street generator (Chen et al. 2008): roads, blocks, plazas, lots facing their street. Presets: grid-american, european-radial, east-asian-dense, middle-eastern-organic. 0.1-0.4 s. |
| Terrain, trees | `src/world/terrain.ts`, `src/world/trees.ts` | Own seeded terrain (~47k triangles, ±9 km, flat under the city, hills/dunes/mountains, seasonal colours, snow line) and low-poly tree templates per season. THREE.Terrain and EZ-Tree did not fit (single grid; photo textures). |
| Kit buildings | `src/world/assembler.ts`, `kits.ts`, `KitInstances.tsx`, `kitTown.ts` | Snaps modular kit pieces into buildings on lots, or places whole-building models; instanced (8,318 pieces = 39 draw calls). |
| Landmarks | `src/world/landmarks.ts` | Real positions from lat/lon (Eiffel Tower stands at the end of the Paris avenue); far ones pulled in along their bearing; `creditsForPlaces` for the description. |
| Director | `src/world/director-context.ts` | Prompt block (places, city looks, asset summary, ~5,600 chars) and the answer schema `{place, date, time}` with repair-ready errors. Not wired into the Phase 2 director yet. |
| Places | `src/world/places.ts` | Paris, Cairo (generated looks), Colmar (Kenney fantasy-town kit), New York (Kenney commercial towers + landmarks). Time-zone rules (eu, us, egypt), so the AI gives only date and local time. |

**Measured** (15 s at 1080×1920, this laptop): Paris → Cairo **82 s**; Colmar → New York **229 s** (kit cities place 133k-151k pieces, 13-18 M triangles). Compositions: `WorldFlight`, `WorldFlightWide`, `WorldFlightKits`, `WorldPlace`, `KitPreview` (`npx remotion studio src/world/index.ts`).

**Kit-city levels of detail (Phase 6 step 2, 2026-10-28).** Before, the kit core was drawn whole in both the main and the shadow pass every frame (17.6 M triangles in Colmar, 12.8 M in New York; double-sided, one city-sized bounding sphere per instanced mesh, so nothing was culled). Now kit pieces are drawn near the camera and "far cards" beyond: one merged mesh with a quad per wall slot exactly on the building outline, roof planes and gables, flat-roof tops and parapets, about 60 times fewer triangles. Their pictures are the real pieces, baked once per render tab into an unlit albedo atlas (plus a night window-glow atlas), so the scene's light, shadow and fog fall on cards and pieces alike.
- Near or far is a pure function of the camera position: `WorldFlight` passes each side's whole camera path (`lodPath`), so the split is fixed per scene and nothing pops; `WorldStage` passes its scene's lens path too (sampled every 0.25 s from the same pure camera function, 2026-10-28). Radius 200 m at the 1920 px / 62° reference, scaled to the lens and picture (`GroundWorld` `kitLod`: 0 = cards only, negative = every piece as before).
- Quiet machine, concurrency 6: Colmar → New York **110 s to 78 s** on the committed tree (−29%); Paris → Cairo unchanged (box cities). Milestone 6's bar (1.5 × 82 s = 123 s per 15 s) is met. Street frames differ from the all-pieces drawing in 0.01% of pixels, aerial and New York frames in 0.4-1.8%, only at far edges. Renders are byte-identical across processes and frame orders.
- Files: `kitLod.ts` (pure: near mask, radius, card faces, atlas packing; 10 tests), `kitFar.ts` (the bake and the card mesh), `kitTown.ts` (per-building ranges), `KitInstances.tsx` (optional `lod`), `flight.ts` (`groundPath`). Evidence: `out/agentSPEED/` (sheets, pairs, `timings.log`).
- Found on the way: the plaza market's first models (five Quaternius props, each loading nine 2048 px PBR maps, decoded again in every tab) cost about 15 s on a 15 s Paris clip and 24 s on the kit flight; the market now uses only Kenney and KayKit models with small shared textures, and costs nothing measurable (Paris → Cairo, two interleaved rounds: 79.2 and 79.8 s with it, 81.8 and 72.6 s without).
- Still imperfect: cards glow a little more evenly at night than the pieces; within about 100 m (where pieces are drawn anyway) whole-building boxes keep a lid on pyramid tops and doorways bake as open; the atlas takes up to about 75 MB per tab for New York.

#### Main video render speed (Phase 6, 2026-10-29)
The Paris video's 15 s world stretch (frames 331-780: the plaza, the flight, Cairo; CLI with encode and audio, concurrency 6) took 188-256 s against the 123 s bar. Measured cause and fix (`da39a18`):
- **The flight rebuilt its city every frame.** `FlightView` passes new `from`/`to` objects each frame, and `WorldFlight` memoized the places on those objects, so `GroundWorld` built a new city, lights, 2048 px shadow map and kit instances for every flight frame (1.3-1.8 s per frame in one tab). The places are now memoized on their values (`usePlace`).
- **The stage was drawn under the opaque flight.** The main canvas drew and graded Paris, then Cairo, on every flight frame. It now draws neither stage nor grade while a flight covers the frame (`flightScenes`).
- **A WebGL context per flight stage** (place A, globe, place B) in every tab, each compiling the grade and the world's programs again. One canvas now holds the whole flight, its scene swapped at the cloud seams.
- **Programs compiled one at a time** at first use. `CinematicLook`'s `Precompile` asks for all of a scene's programs before its first draw (with a half-float target bound like the composer's), so the driver compiles them side by side; again only when the mesh count changes.
- Result: **229 to 112 s** on AC with no other renders (busy machine: 252-256 to 119-128 s). Frames byte-identical: 450 of 450 old against new, 450 of 450 at 6 against 4 tabs, and the kit flight around both seams. The camera work committed the same day adds nothing measurable (`worldShotSet` 0.4-0.9 s per scene with or without the reaction plan; `solveWorldShot` 0.02-0.1 ms per frame).
- Where the time goes now: per-tab setup (every tab renders every segment, so each pays the Paris stage, flight, globe and Cairo setups, about 20 s; a scene's first draw waits 4-5 s for programs, the city builds in 0.5-1 s and again in `worldShotSet`, the 292k-face globe takes about 2 s of CPU), then a GPU-bound steady state (Paris WS about 96 ms per frame: scene 48, shadows 23, grade 25; 148 draw calls, 4.1 M triangles, half in the shadow pass).
- Next, without changing frames: share the city layout between the camera planner and the stage, pre-bake the globe, drop the extra first-frame draws in `KitInstances` and `RenderAfterMount`. With a review of frames: a smaller or harder shadow map, a lighter grade. Remotion's default 30 s `delayRender` timeout is close on a busy machine (the pipeline uses 180 s). Evidence: `out/agentSPEED2/` (`timings.log`, per-frame CSVs, hash lists).

**Known gaps:** the globe is coarse just after the cloud (~55 km facets; the continuous-descent test with 3DTilesRendererJS is next); no CC0 kits for Arab, Indian, Japanese cities (our generator covers them); missing landmarks (Taj Mahal, Pisa, Sydney Opera House, Burj Khalifa...) must be modelled; New York towers top out at ~52 m (kit scale); interiors and planet surfaces not started. (The render bundle now links `public/` instead of copying it: `src/generator/render/bundle.ts`.)

**Next:** the remaining work is planned as Phase 6 in [05-plan.md](05-plan.md#phase-6--one-world-and-video-quality--milestone-6): connect the world to the director and the main composition first (touches the Phase 2 files: coordinate), then render speed, life, light and time, world events, camera extras, graphics, globe polish, sound, and more of the world.
