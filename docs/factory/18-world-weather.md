# 18 — World weather and river water events (2026-11-04)

Two things the director could choose that the renderer dropped ([17 §6](17-code-map-world.md#6-gotchas-and-open-points), "What the spec asks and the world ignores"):
- rain, storm and snow (`look.weather`, and `rain-start` / `rain-stop`) in a world place;
- water-rise, water-vanish and water-return in a river scene.

Both are now drawn. A world scene's grade also follows its real sun now ([13](13-light-and-time.md#the-grade-follows-the-sun-2026-11-04)).

## World weather (commit `e5b0135`)

**When it falls** ([`world/weather/weather.ts`](../../src/world/weather/weather.ts) `worldWeather`):
- It falls only when the director chose `look.weather` rain, storm or snow for the scene. A scene with none or clear has no plan and draws exactly as before.
- Rain and storm fall all scene, unless the scene's first rain event is a `rain-start`: then it is dry until that event. Each `rain-start` or `rain-stop` inside the scene turns the rain on or off. It builds over 3 s and eases off over 2.5 s.
- The assembler already sets `look.weather` to rain for the scene a `rain-start` falls in, and gives the event its `thunder_crack` hit, so the crack and the first drops come together.
- Snow falls all scene. `snow-start` and `snow-stop` stay the snow reaction's ([11](11-world-reactions.md)): where the reaction snows, the weather adds no flakes of its own.

**What is drawn** ([`weatherLayer.ts`](../../src/world/weather/weatherLayer.ts)), in one or two draw calls:
- **Rain:** the kit stages' camera-relative GPU volume ([`compositions/weather.tsx`](../../src/compositions/weather.tsx)), rebuilt for a city.
  - Four nested balls round the render camera, 12, 28, 60 and 130 m: 11,600 drops in rain, 18,100 in a storm, drawn as one set of lines.
  - Every drop has a seeded, world-fixed path, wrapped by modulo into a box round the lens. Horizontally the box is the ball's size. Vertically it is a column from 2 m under the streets (or from the box's bottom, for a lens high over the city) up.
  - A drop wraps only where it is invisible: past 0.85 of its ball, under the ground, or above the column. The lens can move 54 m/s without a drop popping. The tests check this with a crane move.
  - Far layers draw longer, fainter streaks, so a wide or high view still reads the rain against the city.
  - Each drop waits for its own density threshold, so rain that starts comes in drop by drop.
- **Snow:** the snow reaction's snowfall volume, seeded for the weather, at full fall, within §5's particle budget.
- **A storm's flash:** one quad in clip space. It needs no camera, and it is off the screen between flashes.
- **A storm's bolt** (`boltAt`, `BOLT_VERTEX`; 2026-11-04): one more draw, showing exactly while its flash does (`lightning.ts` `lightningFlashAt`).
  - Each flash takes one of the place's six seeded shapes: a 1.4 km channel stepping down to the ground with three branches.
  - It stands on the ground 1.8 to 3.2 km ahead of the render camera, at a seeded place in the view. A weak flash's bolt is farther (3.8 to 6 km) and smaller.
  - It is drawn as a ribbon at least 1.6 px wide, bright enough for the grade's bloom, hidden by the buildings in front of it.
  - No rain falls above the clouds (1.2 to 1.6 km), so a lens in the air flies out of it.
- **Flights** (`WorldFlight`'s `weather`, passed by `FlightView`): each flight ground draws its scene's weather, as its stage does.

**The light under it** (`airAt`, `weatherSky`, written in GroundWorld's frame callback after the light and lights out):
- The key dims to 35% in rain, 20% in a storm and 45% in snow, so the shadows go soft.
- The sky dome, the fog, the background, the height fog and the clouds go grey (darker in a storm). The fog closes in to a quarter of its distance in rain, so the far city fades into the rain.
- The sun's disc, glow and shafts, the moon and the stars are veiled.
- **Lightning** keeps [`lightning.ts`](../../src/compositions/lightning.ts)'s clock (the kit stages', which the photographer already avoids). Each flash lights the sky, the haze and the city's fill light for a few frames, and the rain catches it.

**Determinism and identity.**
- A frame is a pure function of (scene, events, t) and the render camera's uniforms.
- Everything is visible from frame 0: a dry frame culls its drops in the shader. Every program compiles with the scene's, so none compiles mid-scene.
- Scenes without weather are byte-identical: 241 of 241 PNG frames of the identity set ([17 §5.1](17-code-map-world.md#51-how-earlier-work-checked-frames)) match a bundle of `3eec668`.
- Tests: `world/weather/weather.test.ts` (14 since 2026-11-05).

**Evidence** (`out/agentWEATHER/`, `stills.mts`; the bolt in `sheet-bolt.png`, the flights in `sheet-flight.png`):
- `sheet-weather.png`: Paris rain wide and on the avenue, a storm by day and at night with a flash, New York and Colmar snow, a rain-start at 4 s.
- `sheet-storm.png`: the storm and its flash, by day and at night.
- `crop-avenue-full.png`: the rain at full resolution.

**Cost:** see [Cost](#cost) below.

**Sound** ([`pipeline/sound.ts`](../../src/generator/pipeline/sound.ts), 2026-11-04):
- **The rain bed:** the rules give a world scene with rain its `rain_hiss` bed at `RAIN_BED` (0.4, a kit scene's level), on top of the place's own beds, over the stretches it falls (`worldRainStretches`: the world's own rule, by beats). A rain-start in a dry scene starts one; a rain-stop ends it.
- **The designer is told:** a world scene's name carries its weather ("paris, 2026-06-21 12:00 (city, day), rain").
- **Thunder:** `stormThunder` gives a `thunder_crack` 0.25 s after each strong flash of the lightning clock, in every storm scene. A world storm thunders only while its rain flashes. There is none under a flight, inside a bullet time's window, or within 1.5 s of a rain-start (which brings its own crack). It is tested, but the assembler (`assemble.ts`, not this change's) still has to add it to `spec.events`; until then a storm's only thunder is the rain-start's.
- **Unchanged:** the rules and labels for all 20 recorded director replies in `test-fixtures/pipeline/` are byte-identical to before. They have no world scenes with weather.

**The critic** (`critic.ts` `sceneLook`) counts a world scene's weather: the same place and moment in the rain is another picture. A scene with no weather keeps its old key.

**Wet streets** ([`weather/wetGround.ts`](../../src/world/weather/wetGround.ts), 2026-11-05):
- **How wet:** the plan's `wet` level (`weather.ts`). Rain and storm scenes are wet all scene; after a `rain-start` the streets wet over `WET_IN` (4 s, a little slower than the rain builds), after a `rain-stop` they dry over `WET_OUT` (10 s, so they are still wet when the last drops have gone). Snow never wets them (the snow reaction covers them). A pure function of t, like the fall.
- **What it does:** GroundWorld's one ground material (the avenue, the streets, the sidewalks, the plazas, the parks) is patched in a rain or storm scene only. The albedo darkens to `WET_DARK` (0.5), the roughness drops toward `WET_ROUGH` (0.65: a soft sheen, no hard sun glint on a veiled day), and a Fresnel sheen of the frame's weather horizon (`WET_SHEEN` 0.2) brightens the street toward the horizon and flashes with the lightning. Grass (a green ground colour) only darkens to 0.85 and does not shine. One patch on the existing material: no draw call.
- **Identity:** a dry scene's ground keeps its own program, and the snow's; while a `rain-start` has not come the patch draws nothing. PNG frame hashes (every fourth frame) against the tree before: Paris dry 90 of 90, Colmar in snow 45 of 45, New York dry 45 of 45 (`out/agentPOLISH/hash-wet-*.txt`).
- **Cost:** nothing measurable. Paris in rain, an avenue WS and a plaza WS, 150 PNG frames (concurrency 4), the tree before (no wet streets) and after interleaved over four rounds with other agents rendering: before 92.4, 49.9, 80.2 and 58.8 s, after 94.3, 57.3, 57.4 and 47.7 s (in all 281 s against 257 s; `out/agentPOLISH/cost.log`).
- **Evidence:** `out/agentPOLISH/sheet-wet.png`: Paris rain on the avenue (wide and low), the plaza from high, a sidewalk; New York's sidewalk and avenue; a night storm; a rain-start at 3 s and a rain-stop at 8 s (2, 4, 7.5, 10 and 13.3 s).
- Tests: `weather.test.ts` (the wet level: ramps, monotone, snow, order independence; the ground look: dry exact, darker and glossier, grazing sheen, grass).

**The sun under the weather** (2026-11-05): the sun's screen halo and its rays (`shafts.ts`, the golden hours' glare) were faded only by lights out, so a flight ground in rain or a storm facing a low sun still showed them, and the disc, its colour lerped to the horizon grey but drawn without the dome's tone mapping, stayed a pale disc. Both now fade with the weather's veil (gone at full fall, ramping with `rain-start` and `rain-stop`), the disc through lights out's own transparency path. Flight frames without weather are byte-identical (10 of 10). Stills: `out/agentPOLISH/sheet-glare.png`.

**Open points**
- **The bolt follows the view:** it stands ahead of the lens wherever the lens points, so a whip pan during a flash's few frames would carry it along.

## Cost
Paris at 14:30, one locked wide shot, 150 frames rendered as PNGs (`renderFrames`, concurrency 4, `evidence.mts --mode cost`). Dry, rain and storm were interleaved over two rounds, on a machine where other agents were rendering, so only the relative figures mean anything.

| Round | Dry | Rain | Storm |
|---|---|---|---|
| 1 | 70.5 s | 71.5 s (+1%) | 76.1 s (+8%) |
| 2 | 79.0 s | 85.1 s (+8%) | 98.3 s (+24%) |

Rain costs a few percent and a storm up to about a fifth more. A storm draws 18,100 line segments against rain's 11,600, and its flash frames light the whole city. The dome is repainted every frame in both (0.15 ms). A quiet-machine timing against the 123 s bar is still to do.

## River water events

[`compositions/riverWater.ts`](../../src/compositions/riverWater.ts) `riverWaterAt` gives the river's level at video time t. [`RiverStage`](../../src/compositions/RiverStage.tsx) draws it.

| Event | What happens | Over |
|---|---|---|
| water-rise | The level climbs 1.5 m. A flood sheet 5 cm under the river's surface (the same waves, so they never cross) covers the valley floor while the water stands over it. | 2.5 s |
| water-vanish | The level falls to 1.2 m, under the channel's bed, faster as it goes. The bed dries to silt, the channel's sides show, and the waterfall, its pool and the mist dry up. | 1.6 s |
| water-return | Back to the counter's level, from a flood or a drain. From a drain it rises a little past the level and settles, as the ocean does. | 1.8 s |

**How the level is worked out.**
- Each event eases from where the water was toward its own level, and the counter keeps moving the level underneath. Every event is a blend over the one before, so a frame is a pure function of (spec, t).
- The events are the video's, in time order, as OceanStage reads them.
- The camera's river anchor follows the same level.

**Identity and tests.**
- A spec without water events draws exactly as before: no flood sheet, no channel sides, the falls and the bed as they were. 30 of 30 PNG frames match a bundle of `3eec668`.
- Tests: `compositions/riverWater.test.ts` (5).
- Evidence: `out/agentWEATHER/sheet-river.png`. The rows are no event, a rise at 2 s, and a vanish at 2 s with a return at 6 s.

**The ocean** (OceanStage, 2026-11-04) reads water-rise too. The sea climbs 1.8 m up the beach over 2.5 s, past the dune line and among the parasols, and a water-return after it recedes it over 1.8 s. The return that refills a drained sea is now the first one after the drain; until now it was the video's first return, even one before the drain. An ocean scene without a rise is byte-identical: 40 of 40 frames, a vanish and return included. Stills: `out/agentWEATHER/sheet-ocean.png`.
