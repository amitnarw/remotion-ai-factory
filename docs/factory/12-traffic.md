# 12 — Traffic in the world cities (Phase 6 step 3)

Phase 6 step 3 in [05-plan.md](05-plan.md) asks for "traffic driving along the generated streets (car kit, road graph), stopping at junctions", and milestone 6 asks that "streets have traffic". Hard requirements from the brief: every car's pose is a pure function of (place, seed, video time); cars never pass through each other; they stop at junctions on a light or priority rule that is itself a function of time; they stay on the carriageway; the layer is cheap (the main video's Paris stretch is at 112 of 123 s); a car never drives through the lens.

## Research (2026-10-29)

### What exists elsewhere
| What | Licence | Verdict |
|---|---|---|
| Eclipse SUMO (microscopic simulator, large networks, signals) | EPL-2.0 | Rejected: C++ program with its own runtime; we would need to export our streets, run it offline and import trajectories (a new tool on the render path). |
| CityFlow (city-scale simulator for traffic-light learning) | Apache-2.0 | Rejected: C++ with Python bindings; same objection. |
| sumo-web3d (Sidewalk Labs, three.js view of SUMO output) | MIT | Rejected: draws SUMO's output, needs SUMO. |
| movsim / traffic-simulation.de (JavaScript, IDM car following, MOBIL lane changes, lights as obstacles) | GPL-3.0 | Borrow ideas only: GPL code in our render bundle is not wanted, and it adds random noise without a seed. Its published models are usable: the Intelligent Driver Model (Treiber, Hennecke, Helbing 2000) and the "ballistic" update step. |
| A/B Street (Rust traffic game, OpenStreetMap maps) | Apache-2.0 | Borrow ideas: cars live in single lanes and queue behind each other ("no ghosting"), leaders bound the position of their followers, lane changes happen only at intersections, and a car follows a fixed turn path through the junction after the intersection lets it in. |
| Newell's simplified car following (2002) | paper | Borrow the idea that a follower's position is bounded by its leader's minus a jam spacing. A pure closed form (Newell's min-chain, platoons timed to green waves) still needs each car's delay history at every light it met, so it ends up a schedule anyway. |
| Infinitown (Little Workshop), "3D city traffic" on the three.js forum | not open source / no code | Nothing to adopt. |
| Remotion docs | — | A frame must come from the frame number and props alone; anything precomputed must be deterministic. |

No free tool drives cars over our own generated road graph, deterministically, inside a Remotion frame. The pieces are small published ideas, so the layer is built here, with no new npm dependency and no download.

### What the repo already has
- **`StreetStage` traffic** (`src/compositions/StreetStage.tsx`): a closed-form loop for one straight street. Each lane has one speed and evenly staggered cars, so they never catch up; models are normalised to 1.9 m wide; parked cars at ±3.55 m and lanes at ±1.3 m (`LANE_X`) so moving cars clear them. It has no junctions and no stops, so it does not carry over to a road graph, but its lesson does: keep the lanes clear of everything static.
- **Streets** (`src/world/roads.ts`, `city.ts`): road centre lines with corridor width and kind (avenue, main, street, alley). The avenue is a separate strip along z = 0 to ±2,600 m. The layout drops the junction list, but junction nodes are shared, exactly equal vertices of the road polylines (the avenue's are snapped to z = 0), so the graph can be rebuilt from the layout alone. Paris has 48 km of streets, Cairo 102 km (mostly alleys, too narrow for cars), New York 20 km. Landmarks stand 4-6 km out, clear of every road.
- **Car models, already installed, CC0:** KayKit City Builder Bits (hatchback, sedan, station wagon, taxi, police: 1,200-1,300 triangles, 2.1 m × 4.0-4.7 m, one shared texture) and the Kenney Car Kit (`public/assets/vehicles/car-kit`: sedan, SUV, van, taxi, trucks: 2,000-3,100 triangles, toy proportions 2.6 m wide for 4.5 m long).
- **Loading and instancing:** `KitInstances.tsx` `loadKitModelOrStandIn` loads a model once per tab, shares materials and already patches wet marks and snow cover onto kit materials.
- **Reactions:** `reactionPlan(spec, scene)(t)` gives the flood level, lift, crack and snow at any t in closed form; the epicentre is the main plaza or, without one, the avenue's middle stretch, whose carriageway then breaks into slabs.
- **Camera:** street-level world shots stand in the avenue's carriageway (`avenueLane`); the lens is a pure function of t (`WorldStage` `cameraAt`).

## Recommendation: build, borrowing the ideas above
A small lane-graph traffic simulation, precomputed once per scene from fixed inputs, read back per frame.
- **Lane graph** from the layout: nodes where road polylines share a vertex, lanes on the right (one or two per direction by carriageway width; alleys get none), stop lines set back from each junction by the crossing roads' half widths, and turn paths through the junction box (straight, right, left; U-turns only off the map).
- **Signals and priority:** junctions on an avenue or main road get fixed-time two-phase lights, a pure function of t (cycle, green, amber, all-red, an offset per junction and a green wave along the avenue). Street-only junctions are give-way: slow to walking pace at the line, go when clear.
- **Never through each other:** cars follow their leader in a lane with the Intelligent Driver Model, plus a hard clamp behind the leader's back. A turn path is entered only after the junction grants it, and only if no conflicting turn path is in use (paths that cross, merge or share an entry lane) and the exit lane has room ("don't block the box"), as in A/B Street.
- **Deterministic:** a fixed step (0.1 s) from a fixed start (the scene's start minus a warm-up), seeded choices (`makeRng`), no state between frames. Every render tab computes the same table; a frame reads two steps and interpolates. Cars enter and leave only where a road leaves the simulated area (a few hundred metres out, or 1.5 km down the avenue).
- **The lens:** the simulation knows the scene's camera path. While a low lens stands within reach of a lane, that stretch is closed: cars stop before it, and a car caught inside it at a cut is taken off the road at the cut (where nobody can see it go).
- **Reactions:** cars brake to a stop as a flood rises, the ground cracks or things lift, drive slower in snow, and never stand on the avenue stretch that breaks into slabs.
- **Drawing:** one instanced mesh per car model (pieces merged), small box stand-ins far away, glowing head and tail lights at dusk and night (brake lights by day too), light pools on the road at night.

Status (2026-10-29): research and recommendation written; the build follows in `src/world/traffic.ts` and `src/world/TrafficLayer.tsx`, and this page gets its measurements and open points as it lands.
