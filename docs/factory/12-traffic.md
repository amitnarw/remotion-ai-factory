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

Status (2026-10-29): research and recommendation written. Built on 2026-10-30, below.

## As built (2026-10-30)
Files: `src/world/traffic.ts` (pure: the street graph, lanes, turn paths, control, the run and its table; 11 tests in `traffic.test.ts`), `src/world/TrafficLayer.tsx` (drawing), `Ground.tsx` (`traffic` prop), `WorldStage.tsx` and `WorldFlight.tsx` (pass the scene, the lens and where it looks).

**Where cars drive.** Streets with at least 4.4 m of asphalt (Paris streets have 5 m: two narrow lanes) and the avenue to 1.5 km each way; Cairo's alleys carry none. Two lanes a direction from 12 m of asphalt, else one; the avenue's lanes sit between its painted lines (Paris 2.25 and 6.75 m from the centre; Cairo's two each side of the palm median, which no turn crosses). The cars are the five KayKit City Builder Bits models (hatchback, sedan, station wagon, taxi, police; CC0, one 1024 px palette texture); New York gets mostly taxis.

**How it differs from the recommendation** (each found on the stills or the overlap test):
- **Generator leftovers dropped.** A street whose middle runs inside another road's asphalt is that road: a thin loop of two main roads in Paris, a street piece inside Colmar's avenue. The dead ends this leaves are pruned.
- **Junction clusters.** Two junctions joined by a street too short for a lane between their stop lines (or under 20 m) act as one, as A/B Street's complex intersections: their turn paths run through the short street in one go (its lanes as a mitred polygon, corners cut by Chaikin), so no car waits inside a box. A street of 40 m or more always keeps its lanes; no turn path is longer than 45 m.
- **Stop lines** stand 1.5 m (a crosswalk) behind the crossing road's asphalt; a bend is cut back for a 6 m turning radius. Turns tighter than 3 m are left out unless they are the only way on; followers keep a longer gap through a tight one.
- **Conflicts** are tested on each turn path extended by a car's length into its lanes at both ends (the body reaches that far), on points 0.75 m apart.
- **Control.** Lights only where two big roads cross (three or more avenue or main approaches; 40-44 s cycles, 62% of the green to the main axis, a green wave along the avenue). Where one big road passes side streets it has priority: the side street slows to walking pace and gives way to its oncoming cars. Streets give way to each other; a bend is free. Left turns give way to oncoming traffic, for at most 10 s. A flow kept waiting by a crossing one for 6 s goes first once the box is clear (long turn paths otherwise let a steady stream starve the crossing flows for minutes).
- **Room.** A car enters a turn path only if its exit lane holds the whole car at its jam gap plus 0.8 m; with less, the last car's tail stayed in the box and held it through the red.
- **The lens.** Cars in a low lens's lane wait 12 m short of it; at a cut (the lens jumps more than 3 m) that lane is cleared from its start to 10 m past the lens, and cars choosing their way at the junction before it go round when they can. The first stills had a car stopped 3 m in front of an eye-level lens. Drawing also hides any car within reach of a low lens. A lens above 3.4 m closes nothing: a car may wait at a light right under it.
- **The area** covers the junctions within 320 m (plus twice the lens height) of the lens and of what it looks at (plus 0.6 times that distance), at most 900 m, and every avenue junction; cars enter and leave where a road leaves it.
- **Density** follows the place and moment as the place's sound does (`placeTraffic`, matching `sound.ts` `placeSound`): a city full by day, 0.85 at low sun, half at night; a town (Colmar) 0.3, since it only murmurs. Arrivals: 0.1 cars/s per avenue lane, 0.06 main, 0.015 street. With higher arrivals the area filled up (arrivals 4.8 cars/s against 3.2 leaving).
- **Reactions.** A flood, cracking ground or lifting stop every car at a steady 3.5 m/s^2 (the car-following model crept for seconds); snow takes 45% off the speeds at full cover; no car stands on the stretch that breaks into slabs.
- **Flights.** Each place's ground in a flight has its traffic too, simulated over the flight's window.
- **Drawing.** Models out to 220 m (at the 1920 px, 62 degree reference, scaled to the lens), a box in the model's body colour out to 1.5 km. Cars outside a cone around the pose's direction are skipped; the cone comes from the props, because the stage moves the camera after the layer's frame callback. Head lights and tail lights from 6 degrees of sun down; brake lights by day. Light pools on the road at night since 2026-11-03 (below).

**Checks (tests).** The models' sizes are the catalog's; the avenue's lanes fit between its lines; every avenue crossing is a graph node and no street runs inside the avenue. The same scene gives the same table, with or without the cached street graph. No two car bodies overlap at any step in Paris, Cairo, Colmar and New York (separating axes on the drawn rectangles), and at most 3 lanes per city end at a junction with no way on (Paris 1, Colmar 2, Cairo and New York 0). Cars stay on the asphalt and off Cairo's median. A low lens in a lane is never reached and no car comes within 10 m behind it, while cars drive past beside it; a halt stops everything within 4 s; snow slows the traffic; closed ground stays empty; `poseAt` reads and blends the table.

**Cost per scene and tab** (a 15 s scene, the street-level dolly; first run in a fresh process / warm): Paris 720 / 380-480 ms (760 lanes, 1,400 turn paths, 920 cars), Colmar 850 / 460-570 ms, Cairo 280 ms, New York 250 ms. Most of it is the run (0.1 s steps from 30 s before the scene); the street graph is cached per layout.

**Render time** (the Paris video's 15 s world stretch, frames 331-780: the plaza, the flight, Cairo; CLI with encode and audio, concurrency 6, on AC with no other renders; `out/agentTRAFFIC/timings.log`): traffic off 115.3 s (the first, cold run) and 84.6 s, traffic on 91.3 and 92.0 s. Traffic costs about 7 s (8%) here; both are under milestone 6's 123 s bar.

**Determinism:** the two traffic renders are byte-identical (the whole mp4); PNG frame hashes match at 6 and 2 tabs for 90 Paris frames (331-420) and 56 flight frames (505-560).

**Stills of the flight:** `out/agentTRAFFIC/sheet-flight.png` (frames from the timing render): the busy avenue as the flight climbs out of Paris, the cars and their lights below the towers as it lands in Cairo at night.

**Flow** (the stills' dolly, 15 s scenes): the avenue as a whole at 7-8 m/s with 8-18% of its cars standing; within 300 m of the centre 15-42% stand (lights and queues), main roads 36-53%, streets 22-34%. Over a minute in Paris about 45% of all cars stand at a time, mostly at red lights, and no junction stays blocked.

**Stills:** `out/agentTRAFFIC/stills-v2/` (all four cities by day, Paris and New York at night), `stills-v4-*/` (after the lens changes), sheets `out/agentTRAFFIC/sheet-*.png`; script `out/agentTRAFFIC/stills.mts`.

**Traffic lights (drawn 2026-11-03).** One head per signalled approach (`traffic.ts` heads, `lightsAt(t)`; `TrafficSignals.tsx`, mounted from TrafficLayer): on the kerb at the approach's right, 1 m behind the stop line, facing the cars, stepped back until 0.5 m off the asphalt, 1.45 m off every turn path and 1.2 m off the street trees' spots. A mast arm (KayKit trafficlight_C) over two-lane approaches, a corner pole (A) on streets, a pole instead of an arm where a low lens would meet it. The lit lamp is a bright drum, the others dark glass, with a halo at night; they go dark with lights out. Paris 101 heads at 24 lights, Colmar 97 at 22, Cairo 53 at 14, New York none (its junctions are priority roads). A head shows red exactly when its cars are refused for red; the car table is unchanged; a 15 s Paris scene facing lights renders 2.6% slower; frames identical at 6 and 2 tabs. Stills: `out/agentPAR/signals/sheet-signals.png`, `pair-change.png`. Open: on Paris's tree-lined avenue the arms sit at the crowns' lower edge, and leaves can hide them from some angles; by day a light reads to about 30 m.

**Light pools on the road (2026-11-03).** Each lit car throws a pool of light on the road ahead and a faint red glow behind (`TrafficLayer.tsx`), at the strength of the cars' `lights` (0 by day to 1 at night, the head lamps' curve, from the director's place and time).
- **Shape.** The beam is a 6 x 14 m quad from the front bumper: brightest 3-6 m out, widening, gone by its far end, in the head lamps' colour at 0.07. The glow is a 2.6 x 2.4 m oval round the back, at 0.05 of the tail colour (1.8 times that while braking). Each falloff is a small baked texture.
- **Look.** Additive and unfogged, like the street lamps' pools and the signals' halos. The pools lie 7 cm over the asphalt (above the lane paint), with a polygon offset against z-fighting far out. A first try at 0.34 lit the dark asphalt like day (the lamps' pools add 0.26, but to the pale pavement).
- **What is drawn.** A pool is tested against the view cone itself, so a car behind the lens lights the road ahead of it. The pools fade out over the last 60 m before the lit cars end (the models' reach, about 200 m). Lights out leaves them on, as the car lamps.
- **Cost.** One instanced mesh each: 2 draw calls, none by day (the meshes are hidden in a frame without pools).
- **Day frames are byte-identical.** 258 frames hash the same before and after: the four cities at 10:00, 6 frames round each of 7 shots, and the Paris video's frames 331-420. Night frames are identical at 6 and 2 tabs (84 frames, Paris and New York at 22:30), and two renders of the same bundle give the same mp4.
- **Render time.** The 15 s Paris night stretch (22:30, the stills' shots, frames 30-479; CLI, 6 tabs), before and after, interleaved while other agents rendered (`out/agentCAMLIGHT/timings.log`): 120.3 / 111.1 s, 100.4 / 89.2 s (the quietest pair, no other renders running), 131.5 / 145.1 s, and 123.4 / 177.8 s with a type check running beside it. The pools' cost is below that noise.
- **Stills.** `out/agentCAMLIGHT/sheet-night.png` and `sheet-dusk.png` (the four cities at 22:30 and 21:30, before over after), `pair-a2.png` and `crop-a2-f60.png`, `crop-a2-f420.png` (Paris at street level). Scripts: `stills.mts`, `hash.mts`, `time.sh`.

**Featured actors in the road (2026-11-04).** The bullet-time design found cars driving through an actor who stands or walks in the carriageway ([14-bullet-time.md](14-bullet-time.md)). The run now takes `opts.walkers`: t -> each featured actor's footprint [x, z, r] (`camera/world.ts` `castWalkers(plans)`, from the same plans the camera and the renderer use: 0.3 m standing, 0.45 m sitting, its height when lying down). It works like the lens closure:
- **Closure.** Each step closes every lane and turn path point within a car's half width + r + 0.15 m of where an actor stands now or will over the next 3 s (sampled every 0.25 s; before the scene, where they stand at its start), so cars brake in time.
- **Stopping.** Cars stop 3 m short of that stretch. A car already inside it stops 0.8 m short of the actor, or drives on when the actor is beside or behind its front.
- **Junctions.** No car enters a turn path an actor is on, or one whose exit lane has no room short of an actor; route choice avoids the closed lanes; no new car starts in a lane closed near its start.
- **No car is taken off the road** (it would vanish on screen).
- **Unchanged without them.** Without walkers, or with actors only off the carriageway, the table is byte-identical. The cost is within noise (a 15 s Paris run with two actors in the road: 1.9 s, against 2.2 s without, on a loaded machine).
- **Tests** (`traffic.test.ts`, +2; `world.test.ts`, +1). A runner across Paris's avenue and an actor standing in its outer lane: no car body comes within 0.1 m of either at any step; cars stand for the runner and pass beside the one standing; without them, cars drive through both spots. Actors on the sidewalk and at the kerb's edge leave the table byte-identical. `castWalkers` gives each actor's ground position as `actorSubject` does, and its footprint by posture.
- **Not wired yet:** WorldStage.tsx must pass `castWalkers(shots.plans)` in its `traffic` prop, and Ground.tsx must hand it to `trafficPlan` as `walkers`. Those are other agents' files; until then the renders are unchanged.

**Open points**
- Towns at 0.3 density: a choice to match the sound (no traffic bed). The user may want more cars in Colmar, with a light traffic bed to match.
- Lights-out leaves car lights and their pools on (batteries), by design.
- The pools are flat decals just above the asphalt: they light no facade or car in their reach, and on a turn the beam points along the car, not round the bend.
- Featured actors: the cars stop for them once WorldStage and Ground pass `walkers` (above). A car that an actor walks into while it stands in a queue cannot move away.
- The camera planner doesn't know the cars; cars never block a sight line on purpose, but one can stand between the lens and its subject.
- An earlier, unfinished draft of the same design is in `out/wip-traffic/traffic.ts` (gitignored, not used).
