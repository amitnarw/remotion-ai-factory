# Done. Polish agent: status (2026-11-05)

All four items committed, with their docs. The determinism agent's edit for `Ground.tsx` (GroundWorld leaving `scene.fog` and `scene.background` behind for the next stage in a tab) had not arrived: whoever applies it, prove world-scene frames byte-identical.

## Task
HANDOFF §3 item 7, the smaller open items, in order:
1. The bell tower (`CityLayout.belfry`) as a camera subject the director can name.
2. A subtle procedural brick or stone pattern on painted walls (New York's walk-ups and mid-rises), no new downloads, no extra draw calls.
3. Wet streets in rain: a darker, slightly glossy road and paving, ramping with `rain-start` / `rain-stop`; dry scenes byte-identical.
4. No faint sun glare on a stormy or rainy flight ground (`WorldFlight`).

Files owned: `src/generator/camera/*`; `src/world/{cityAnchors,director-context,places,city,kits,kitTown,kitPaint,kitFar,kitLod,kitWindows,meshes,terrain,landmarks}.ts`, `KitInstances.tsx`, `src/world/weather/*`, `Ground.tsx`, `WorldFlight.tsx`, their tests; docs `06-world-engine.md`, `18-world-weather.md`, `quality-refs/README.md`, the matching lines of `17-code-map-world.md`.

## Committed
- `b5cf946` item 4: the weather veils the sun's screen halo (shafts.ts, faded only by lights out before) and the sun disc (faded through lights out's own transparency path) in `Ground.tsx`. Dry flight frames 515-524 byte-identical (10/10). Sheet `out/agentPOLISH/sheet-glare.png`.
- `4af3f66` item 1: the bell tower as a camera subject (`camera/world.ts` `belfrySubject`, `subjects.belfry`, close shots frame the belfry stage `Belfry.stage` from `city.ts`), named in `KIT_SUBJECTS.world` and on the director's place lines (`director-context.ts`); tests in `camera/world.test.ts`. Non-tower shots byte-identical: Paris 90/90, Colmar 90/90 (`out/agentPOLISH/hash-belfry-*.txt`). Sheet `sheet-belfry.png`.

- `0442e4f` item 3: wet streets (`weather.ts` `wet` level, `wetGround.ts`, `Ground.tsx` patches its ground in rain and storm only). Dry and snow scenes byte-identical: Paris dry 90/90, Colmar snow 45/45, New York dry 45/45 (`hash-wet-*.txt`). Sheet `sheet-wet.png`.

- `bb6e3e5` item 2: masonry (`kitPaint.ts` brick or ashlar on the Building Kit's painted walls by the paint, brick on the KayKit walk-ups' wall cells; `KitInstances.tsx` keeps the walk-ups' material apart from the rest of the KayKit city kit and patches both; tests `kitPaint.test.ts`). Paris 45/45, Colmar 45/45 (its painted houses), Cairo 23/23 byte-identical (`hash-brick-*.txt`). Sheet `sheet-brick.png`.

- (this commit) docs: `06-world-engine.md` (the tower on camera, brick and stone, identity, cost), `18-world-weather.md` (wet streets, the sun under the weather, cost), `quality-refs/README.md` (Polish 2026-11-05), the matching lines of `17-code-map-world.md`.

## Uncommitted
- Nothing.

## Render cost (relative only: other agents rendered at the same time; `out/agentPOLISH/cost.log`)
- Paris in rain, 150 PNG frames, four interleaved rounds: before (no wet streets) 92.4, 49.9, 80.2, 58.8 s; after 94.3, 57.3, 57.4, 47.7 s. Nothing measurable.
- New York, 150 PNG frames, four rounds: before (no masonry) 67.5, 58.9, 56.9, 35.1 s; after 66.8, 67.5, 38.0, 35.2 s. Nothing measurable.

## Next
- Nothing of this task. Open, for other owners: see Findings.

## Worktree and outputs
- Worktree `wt-polish` removed (junctions first).
- `out/agentPOLISH/`: sheets `sheet-glare.png`, `sheet-belfry.png`, `sheet-wet.png`, `sheet-brick.png`; stills; `hash-*.txt`; `cost.log`. Four bundles kept for comparisons (`before` = 481415b, `glare-after3` = item 4, `wet-after2` = items 1 (without the close-up framing) and 3, `brick-after2` = all four): each bundle's `public` is a junction, `rmdir` it before deleting the bundle. Scripts were in the session scratchpad (`polish/`: bundle, shoot, hash, cost, sheet).

## Findings for others
- Run-to-run nondeterminism in world flights (determinism agent): the first still render of the Paris video's flight frames 660 and 675 (Cairo at night, rain) after a fresh bundle differed from a second render of the same bundle in the car-light pools on the road; the second run matched the after-bundle's.
- No edit is needed in `pipeline/director.ts`: the director's subject menu is generated from `KIT_SUBJECTS` and its world block from `worldDirectorContext()`, both now name the tower.
- Optional, `pipeline/shots.ts` (gate-2 agent): `PLACE_SUBJECT = /^(plaza|avenue|sidewalk|park)/` decides which shots hold on a reaction; a belfry shot looks across the plaza's market, so `/^(plaza|avenue|sidewalk|park|belfry)/` would hold it too (changes only plans that film the tower).
- `pipeline/shots.ts` `subjectFromSee` counts every word over two letters, "the" included, once per use in a subject's description: "The Eiffel Tower glows" picks `plaza` ("the city's main square (when the place has one)" has "the" twice). A stop-word list would fix it, but changes rule shots of recorded plans.
