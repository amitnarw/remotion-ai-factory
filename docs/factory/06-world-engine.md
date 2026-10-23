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
- `npx tsx scripts/setup-world-data.ts` builds the surface grid from Natural Earth 1:50m (public domain): ocean, land, desert, mountains, tundra, ice, lakes at quarter-degree cells, 55 KB.
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
npx tsx scripts/setup-world-data.ts      # Natural Earth surface grid (already committed; only to rebuild)
npm run assets                           # older Kenney/Poly Pizza packs (public/assets/city etc.)
npx tsx scripts/setup-world-assets.ts    # new packs into public/assets/world/ (~380 MB)
npx tsx scripts/build-world-catalog.ts   # re-measure and re-classify (writes src/world/data/world-catalog.json)
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

**Known gaps:** kit cities need distance levels of detail (kit pieces near the camera path, boxes beyond); the globe is coarse just after the cloud (~55 km facets; the continuous-descent test with 3DTilesRendererJS is next); no CC0 kits for Arab, Indian, Japanese cities (our generator covers them); missing landmarks (Taj Mahal, Pisa, Sydney Opera House, Burj Khalifa...) must be modelled; New York towers top out at ~52 m (kit scale); interiors and planet surfaces not started; the Remotion bundle copies all public assets (~0.9 GB).

**Next:** the remaining work is planned as Phase 6 in [05-plan.md](05-plan.md#phase-6--one-world-and-video-quality--milestone-6): connect the world to the director and the main composition first (touches the Phase 2 files: coordinate), then render speed, life, light and time, world events, camera extras, graphics, globe polish, sound, and more of the world.
