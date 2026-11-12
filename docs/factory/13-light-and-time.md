# 13 — Light and time (Phase 6 step 4)

Phase 6 step 4 in [05-plan.md](05-plan.md) asks for "a place from dawn to night in a few seconds, lights switching on as the sun sets", and milestone 6 asks for "at least one night or time-lapse shot".
- **Part A, the dusk fade-in, is built** (2026-10-30, below). It needed no decision.
- **Part B, the time-lapse, is built** (2026-11-02, option A as the user chose; the proposal follows it).

## Part A: the dusk fade-in (built 2026-10-30)
Until now the city's lights switched on all at once when the sun dropped below 1 degree: every box-city window, every kit-building window glow and every street lamp, while the sky was still orange. Now they come on through dusk, building by building.

**The curve** (`src/world/atmosphere/dusk.ts` `duskFor`): a smoothstep in the sun's elevation, exactly 0 from DUSK_FROM (5 degrees) up and exactly 1 from DUSK_FULL (−4 degrees) down.
- It leads the sky: the first windows light before the sun key starts to fade (2 degrees) and before the sky turns to night (0). Half the city is lit just after sunset (0.5 degrees), all of it by −4, as the first stars come out and long before the sky is night's (−12). The blue hour shows a fully lit city.
- Share of the city's window light: 10% at 2.95 degrees, 25% at 1.9, 50% at 0.5, 75% at −0.9, 90% at −2.0.
- **Each building fades in** over DUSK_RAMP (5/64 of the dusk amount; 2026-11-03), not in one frame: in a 12 s lapse a building takes about 0.37 s, and no building gains more than a fifth of its light in a frame (four big near buildings had jumped 18-34 luma levels in one frame; now at most 6.6, over 6-20 frames). A static dusk scene shows about 8% of buildings part-lit. Lamps warm up over LAMP_RAMP (1/32). Full day and night stay byte-identical (301 of 301 frames).

**One by one.** Each light waits for its turn: a seeded threshold from its lights-out key (`react/dark.ts`: a building's index, or a kit piece's building, or a 20 m grid cell where kit levels of detail are off), lit once the dusk amount passes it. The thresholds are uniform, so the share lit is the dusk amount, and a light that came on never goes off as the dusk deepens. Lights out still works on top: a window is lit only if the dusk lit it and the blackout wave has not put it out.
- **Street lamps** switch by photocell circuit: four consecutive lamps (about 136 m of avenue) together, each stretch at its own dusk amount between 0.6 and 0.85 (the sun from about 0 to 2 degrees down).
- **Car lights** (traffic) follow the same curve a degree ahead: 0 from 6 degrees up, all on by 3 down.
- **Snowfall** dims with the dusk instead of at the switch.

**Day and night are unchanged, byte for byte.** A scene with dusk amount exactly 0 or 1 takes the old code path (no extra shader patch, no new uniform); only a scene strictly between draws with the dusk patches (`react/darkShader.ts` `patchDuskEmissive`, `patchDuskBasic`; `kitWindows.ts` a separate dusk glow material; `kitFar.ts` the far cards). A patched program rounds a last bit differently even where it multiplies by 1, so day and night must keep their own programs. Frames with the sun between 5 and −4 degrees change by design (with traffic, car lights change from 6 down to −3).

**Not changed:** the world camera still picks its light side at 1 degree (`src/generator/camera/world.ts`, `lightX`), so an avenue shot still turns round at that step. It is framing, not a light.

**Checks.**
- **Tests:** 12 in `atmosphere/dusk.test.ts`: the curve, the thresholds (deterministic, the share lit follows the dusk), the lamps' stretches, dusk combined with lights out, the shader text matching the TypeScript, and day and night taking the old materials and programs. `npm test` 517 of 517.
- **Before and after on the GPU** (`out/agentLIGHT/`, 2026-10-23 in Paris, Colmar, New York and Cairo; a bundle of `efafd59` against the new tree):
  - 144 stills from +12 to −20 degrees, three shots each. 73 are byte-identical: every still at +12, −6, −10 and −20 degrees, and those at +6 and −4 whose sun is outside the band. The 71 that differ are all in the band (Colmar's "+6" is 5.93 degrees, inside the car lights' ramp; New York's "−4" is −3.94).
  - PNG hashes: 299 of 301 frames identical, including the Paris video's frames 331-360 (Paris at 21 degrees) and 700-730 (Cairo at −22). The 2 that differ are Paris at −20 degrees, frames that already had two states between two runs of the old bundle (a nondeterminism in the baseline, followed up separately).
  - Sheets: `out/agentLIGHT/sheet-before-vs-after-<place>.png`; close-ups `crop-paris-plaza.png` (before: every building dark at +1 and lit at 0; after: one at +2, two at 0, most and the plaza lamp at −1, nearly all at −2) and `crop-new-york-avenue.png`.

## Part B as built (2026-11-02): option A, a continuous lapse
The user chose option A on 2026-11-02 (answers in §5 below). Built by four agents in parallel, each on its own files, against one API in `src/world/lapse.ts`.

**The director's device.** A world scene may carry `world.lapse: { to: "HH:MM" }` (`spec.schema.ts`, `director-context.ts`). The director may write a clock time or a word, which the assembler turns into the real time with `lapseWordTime`:
- `night`: the sun sinking through −12 degrees;
- `dusk`: through −6, the blue hour with the whole city lit;
- `dawn`: rising through 0;
- `noon`: solar noon.

The prompt teaches when a lapse is worth it (premises about time, "by nightfall" or "hours later" beats, a day-to-night arc), filmed wide and slow, and teaches the stepped alternative (one place at two times, joined by a dip). The checks (`lapseProblem`, `validateSpec`): `to` after `time` on the same date, at least 3 s, the sun moving at least 6 degrees, at most one per video. A refused lapse is asked about once, with the real times in the repair message. If it is still wrong, the assembler drops the lapse with a warning and keeps the place.

**The clock** (`lapseClock`): a weighted table per scene, inverted by binary search, pure per frame. It is exactly `time` at the scene's start and `to` at its end, and slows through dusk: each minute of clock weighs 3 from +6 down to −6 degrees and 1 outside +10..−10, with smooth edges. Paris on 2026-10-23, 17:00 to 19:30 in 6 s, gives the windows' band (+5..−4) 2.97 s instead of 2.30; the clock reads 17:00, 17:51, 18:12, 18:31, 18:50, 19:10 and 19:30 at each second.

**The picture** (`Ground.tsx`, `lapseLight.ts`, `skyDome.ts`, `WorldStage.tsx`):
- **Built once per scene.** The city is built for the start's place. `lapseShape` decides from the sun's whole range what the one build must hold: day materials, night ones, or the dusk ones if any frame needs them. Stars, the moon, sun shafts and the key's shadows exist from the first frame, so no shader program is compiled mid-scene.
- **Written every frame** from `clock.at(t)`: the key's colour, intensity, direction and side (sun or moon), the sky fill, the sun disc, the moon, the stars, the clouds, the fog and background, the height fog, the water's sky and glint, the sky dome's colours (repainted, about 0.15 ms), the shafts, the dusk amount (windows one by one), the snowfall light and the car lights.
- **Traffic** arrivals follow the clock's density (`trafficPlan` `densityAt`).
- **The camera** frames the shot for the start's light (the light side never flips mid-shot).
- **No frame-order traps.** `darkRig` takes the lit values per frame instead of remembering the first ones it saw, and the fog colour is written per frame.

**The grade** (`look-choice.ts` `lapseLookFor`, `compositions/look/blend.ts`, `chain.ts`):
- **Both tone maps run** (2026-11-03, `look/ToneMixEffect.ts`): a lapse whose two looks use different operators (golden's ACES, night's AgX) runs both from the first frame and blends their outputs by the same weight as the rest; each end is exactly its preset, and the first frame is byte-identical to a static scene at the start. (The first build kept the end's operator alone, as decided, and a day start opened flat and grey: 30-50% less contrast, half the saturation.) The effect chain is built once with every effect either end uses.
- **Blended per frame:** exposure, bloom, the grade's colour uniforms, vignette and chromatic aberration. The weight is the share of the light's change (day at 10 degrees to night at −12) the sun has made since the first frame, so the grade turns as fast as the light does.
- Each end's look comes from the real sun there.

**Sound** (`sound.ts` `lapseBeds`, `lapseAmbience`; `audio.tsx`): a lapse scene's ambience splits where the sun crosses 10 and −6 degrees. At each change, a 2 s equal-power crossfade takes the birds out and the crickets in, and lowers the crowd and traffic. A sound that doesn't change plays on unbroken; the sound designer's own choices stand.

**Also following the lapse:**
- **Photographer:** day or night rules by the sun at the still's frame.
- **Critic:** a lapse is described as "17:00 to 19:30 (a time-lapse)", and the look at a cut is compared end to start.
- **Transitions:** a dip follows the outgoing scene's sun at its end and the incoming one's at its start.
- **Flights:** a flight's window overlaps both scenes, so it leaves a lapse scene where the lapse has got to as the window opens, and reaches one where it has got to as it closes, graded the same.

**Checks** (`out/agentLAPSE/`):
- **Tests:** `lapse.test.ts`, `lapseLight.test.ts` (10), `look/blend.test.ts` (6), `look-choice.test.ts` (7), and new cases in the schema, director, assembler, sound, critic, transitions and photographer tests; `npm test` 571 of 571.
- **Scenes without a lapse are unchanged:** 241 of 241 PNG frames byte-identical to a bundle of `847a2a8` (Paris day, dusk and night, New York and Colmar at dusk, Cairo at night, the Paris video's frames 331-360 and 700-730); the baseline reproduced itself exactly.
- **A lapse renders the same in any tab and order:** 60 of 60 frames across the dusk identical at 2 and 6 tabs, and rendered in reverse order in fresh tabs.
- **Its last frame matches a static scene at the end time** (brightness within 1.1 levels).
- **Cost:** a 15 s scene (450 frames, CLI with encode, concurrency 6, quiet machine): the lapse 17:00 to 19:30 in 66.2 and 65.1 s, the same scene static at 19:30 in 74.0 and 64.7 s. A lapse costs nothing extra; the bar is 123 s.
- **Strips:** Paris, New York, Colmar and Cairo on 2026-10-23 and Paris on 2026-06-21, wide and avenue shots (`out/agentLAPSE/strips-after/sheet-*.png`). The sky runs from blue-grey through orange haze and lavender to deep blue with no jumps; car lights come on from 6 degrees, windows building by building from 5, lamps by circuit around −1.5; the moon rises with moonlit shadows, then the stars.

**Open points**
- **Fixed 2026-11-03:** the flat grey first frame (both tone maps now blend) and the big near buildings lighting up in one frame (each building fades in).
- **Shimmer in still shots** (investigated 2026-11-03, `out/agentPAR/shadow/`): the camera solver keeps every shot "never quite frozen" (`solve.ts`, a few mm to 0.1 m a frame), and that drift set off three things. The shadow box followed it on new texels each frame: now snapped to its texel grid (sunlit wide shots 15-20% fewer flickering pixels). A pale strip across Cairo's avenue was alley paving z-fighting with the avenue at the same height: alleys now lie 2 cm under the roads. The rest is aliasing of fine geometry under the drift: making locked shots truly still removes 94-98% of it; more anti-aliasing would cost render time. **Decided 2026-11-03 (the user):** locked shots stand truly still; the `static` move no longer drifts (`solve.ts`, pinned by a solver test).
- **The camera's side** is the start's: a static scene at the lapse's end time can film the avenue from the other side.
- With a lapse, the procedural (fbm) sky option, the flood's water look and the lights-out plan use the start's sky.

## The grade follows the sun (2026-11-04)
A world scene without a lapse used to grade by the director's time-of-day word (`look.timeOfDay`), while its light came from the real sun at `world.place`, `date` and `time`. Nothing checked that the two agreed. The Paris video's plaza (21 June, 19:30) was marked "golden" and graded golden-hour, while its sun stood 20.9 degrees up in daylight.

**The rule** (`look-choice.ts` `lookFor`, `worldSunOf`): a world scene's grade comes from the sun its place resolves to, by the same rule a lapse uses at its two ends.
- Sun below 0 degrees: moonlight.
- Sun from 0 to 10 degrees: golden hour.
- Higher: the director's day word picks the grade (overcast stays overcast; noon and afternoon follow the story's mood). Any other word gives the mood's day look.

A lapse's first look is the same as a static scene at its start. Kit scenes, and world choices that do not resolve (an unknown place or a malformed moment), still grade by their words. The flight's two ends follow too (`FlightView` calls the same `lookFor`). No component changed.

**Which recorded videos change.** The pipeline fixtures (`test-fixtures/pipeline/*`) have no world scenes, so their grades do not change. Of the rendered videos in `output/`, only the Paris money video has world scenes:
- Paris, 2026-06-21 19:30 ("golden", sun +20.9 degrees, mood upbeat): golden-hour becomes dreamy-pastel. The grade is less warm and orange and closer to the daylight that lights the scene.
- Cairo, 22:00 ("night", sun −21.8 degrees): unchanged (moonlight).

The verifiers' one-scene specs take their word from that video, so their grades follow the sun now. Stills before and after are in `out/agentWEATHER/grade-before/` and `grade-after/`.

**The rest follows too** (2026-11-04): the photographer's day or night rules (`qa/photographer.ts` `lightAt`) and a dip's night test at a cut (`pipeline/transitions.ts` `nightAt`) judge a world scene by the same sun (`worldSunOf` with `lightWordFor`). Noon marked "night" is judged as day, and a June evening marked "golden" after the sun has set as night.

## Part B: the time-lapse (proposal)
This part is a proposal only. The code was read at `efafd59`, and the web sources were checked on 2026-10-30.

### Recommendation in short
- **Build it ourselves: option A, a continuous lapse,** as one director device, `world.lapse: { to: "HH:MM" }`. Over the scene's seconds the clock runs from `time` to `to`, and the sun, moon, stars, sky, fog, windows and lamps follow the real sun. Every frame is a pure function of t.
- **No engine, no dependency, no download.** Everything a lapse moves is already a function of the sun's elevation (`sky.ts`, `moon.ts`, `stars.ts`, `placeSound`, `placeTraffic`). What's missing is evaluating it per frame instead of once per scene.
- **The cost is about that of a night frame of the same place.** The light state takes 9 µs of CPU a frame, and re-baking the whole sky dome takes 0.15 ms (both measured). The shadow map is already redrawn every frame. The real work is structural: `GroundWorld`'s one big memo is keyed on the resolved place and its sky, so a naive lapse would rebuild the whole city every frame. That is the flight bug of 2026-10-29 again (1.3-1.8 s a frame).
- **Everything downstream follows by rule** from that one choice. The grade ramps with the light, as time-lapse photographers ramp exposure. The ambience crossfades at the sun heights it already uses. The photographer judges each still by the sun at that frame. A flight leaves at the lapse's end time.
- **Also now, at no cost:** teach the director that two scenes of one place at different times, cut with a dip, make a stepped lapse (option B).
- **Effort for A:** about 6 working days.

### 1. Prior art
| What | Licence | What it does | Verdict |
|---|---|---|---|
| Unreal [Sun Position Calculator](https://dev.epicgames.com/documentation/en-us/unreal-engine/geographically-accurate-sun-positioning-tool-in-unreal-engine) | engine plugin | Places the sun from latitude, longitude, time zone, date and time; the light must be "Movable" to change at run time | Already ours: `geo.ts` `sunAt` (NOAA) from the place and moment. |
| Unreal [Day Sequence](https://dev.epicgames.com/documentation/en-us/unreal-engine/day-sequence-time-of-day-plugin-for-unreal-engine) | engine plugin | One time-of-day timeline drives the sun, moon, stars, atmosphere and clouds; a custom rig uses two directional lights (sun and moon) | Borrow the idea: one clock drives every sky piece. Keep our single key that changes sides at zero intensity (`moon.ts` `keyFor`): one shadow map, not two. |
| Unity day-night assets ([Enviro](https://marketplace.unity.com/packages/tools/particles-effects/enviro-sky-and-weather-33963)) | paid asset | Curves and gradients for light, ambient, fog and sky, read by sun altitude every frame | The idea is already ours: `sky.ts` `KEYS` by sun elevation. The asset is paid and Unity-only: rejected. |
| Baked time-of-day lighting: Assassin's Creed Unity (4 baked key frames) and Shadows (11), both blended at run time ([SIGGRAPH 2025](https://www.realtimerendering.com/advances/s2025/content/Advances%202025%20-%20Raytracing%20the%20world%20of%20Assassin%27s%20Creed%20Shadows.pdf)); Far Cry 5's GI is right only for the day it baked ([2018](https://www.advances.realtimerendering.com/s2018/The%20Challenges%20of%20Rendering%20an%20Open%20World%20in%20Far%20Cry%205%20%28With%20Notes%29.pdf)) | talks | Precomputed light cannot follow a moving sun, so games bake a few moments and blend them | Nothing to adopt. We bake no lighting (the far cards bake unlit albedo and a window glow, neither tied to the light), so a moving sun re-bakes nothing. The keyed idea is option B. |
| three.js `Sky` (Preetham), in `node_modules/three/examples/jsm/objects/Sky.js` | MIT | An analytic daylight sky in a shader; the sun is a uniform | Borrow the idea (the sky gradient from a sun uniform). Reject the model: daylight only and photoreal, unlike our approved stylised dome and moonlit night. |
| [@takram/three-atmosphere](https://github.com/takram-design-engineering/three-geospatial) (Bruneton scattering for three.js and R3F) | MIT | A physically based sky and aerial perspective from precomputed tables | Reject: photoreal, extra passes and tables, a new dependency. |
| ["Complete Sky System for Three.js"](https://discourse.threejs.org/t/complete-sky-system-for-three-js-skybox-sun-moon-day-night-cycle-clouds-stars-lensflares/88311) | none stated | Sun and moon, a day-night cycle, stars, clouds, light ramping | Nothing to borrow (no licence). |
| Day-to-night "holy grail" time-lapses ([PetaPixel](https://petapixel.com/2018/08/02/how-to-shoot-and-edit-a-holy-grail-timelapse-at-sunset-or-sunrise), [why it is hard](https://witharsenal.com/blog/why-are-holy-grail-timelapses-so-difficult)) | technique | Photographers ramp exposure in small steps as the light falls (every step risks flicker), and some ramp the shooting interval | Borrow: the grade follows the lapse with a smooth exposure ramp, and the pacing question (6) is interval ramping. The grammar: a locked-off or slowly moving wide shot, shadows sweeping, lights coming on. |
| Stable shadow maps, texel snapping ([gamedev.net](https://www.gamedev.net/forums/topic/591684-xna-40---shimmering-shadow-maps/)) | technique | Moving the shadow camera in whole texels stops edges crawling. It fixes translation, not a turning light. | Borrow if the motion strips crawl. |
| Remotion ([flickering](https://www.remotion.dev/docs/flickering)) | — | Frames render out of order in several tabs; animation must come from the frame number | The rule we already keep. |

No GPL code is involved.

**Already in the repo:**
- `tod.ts` `getActiveTodLook` blends two StreetStage look tables over a scene, from `look.timeOfDay` to `look.timeSpan.to` ([spec.schema.ts:151](../../src/generator/spec.schema.ts#L151)). No prompt teaches that field, and it speaks in buckets (dawn, golden, night), not clock times.
- The flight already lerps the globe's `utcMs` between its two places' moments (`flight.ts`).
- `darkRig` writes the key, fill, discs, clouds, fog and background every frame. `DARK_UNIFORMS` are shared uniforms. `patchDarkSky` blends the dome to a second set of colours with one uniform.

### 2. What a lapse means here
**Definition.** In a world scene the clock runs from `world.time` to `world.lapse.to` over the scene's seconds. Everything that follows from the moment today follows from the clock at t:
- the sun's direction and colour, the sky and the fog;
- the full moon rising opposite the sun, and its key light;
- the stars, the clouds' tint;
- the windows, lamps and car lights (Part A's dusk amount).

The city, its people and its cars run at normal speed: the light lapses, life does not (question 3).

For scale, 2.5 hours in 6 s is 1,500 times real time. In Paris on 30 October, 17:00 to 19:30 takes the sun from 4.5 to −19.4 degrees, about 0.13 degrees a frame.

**How the director asks.** One optional field on the world choice: `"world": { "place": "paris", "date": "2026-10-30", "time": "17:00", "lapse": { "to": "19:30" } }`.
- **Clock time or word.** The director may give a clock time or a word (`night`, `dusk`, `dawn`, `noon`). The assembler turns a word into the clock time from the real sun (night = −12 degrees), as it already turns actors' scene times into video seconds. The spec stores only a clock time, which the editor can show.
- **The validator** refuses a lapse in which the sun barely moves, and gives the real times in its repair message. Paris on 21 June only reaches −8 degrees by 23:00: no full night.

**When it is worth it (the prompt).**
- **Premises about time:** "what if a day lasted ten minutes", "what if the sun never set".
- **Story cues:** a beat that says "by nightfall" or "hours later".
- **The reference's arc:** the day-to-night arc, or a lights-out story that starts at dusk.
- **Limits:** at most one per video, at least 3 s, filmed wide and slow. The prompt says "almost never static"; a lapse beat is the exception.

**How it touches the rest**
| Part | Today | With a lapse |
|---|---|---|
| AI intent ([10-intent-audit.md](10-intent-audit.md)) | — | A lapse exists only when the director writes one; the assembler never adds it. The grade, sound, traffic and photographer follow from it by rule (the audit's case b). |
| Grade ([look-choice.ts](../../src/generator/look-choice.ts#L25)) | one preset per scene, from `look.timeOfDay` | Blends from the start's preset to the end's by the sun's elevation (`setGrade`, exposure and bloom are uniforms). The tone-map operator cannot blend (golden is ACES, night is AgX), so a lapse scene keeps one operator (question 4). |
| Sound ([sound.ts:74](../../src/generator/pipeline/sound.ts#L74)) | beds by day, low sun (under 10°) and night (under −6°) | The beds split where the sun crosses 10 and −6 degrees, with a 2 s crossfade: the birds go out, the crickets come in, the traffic quietens. Beds have no fades today; music does. |
| Photographer ([photographer.ts:89](../../src/generator/qa/photographer.ts#L89)) | day or night rules from `look.timeOfDay` | Rules from the sun's elevation at the still's frame. |
| Flights ([FlightView.tsx:59](../../src/compositions/WhatIfVideo/FlightView.tsx#L59)) | leave at the scene's `world.time` | Leave at the lapse's end time. The globe's sun then runs on from there. |
| World reactions | `darkRig` records each light's lit value the first time it sees it (`LIT` in [darkShader.ts](../../src/world/react/darkShader.ts)) | The lapse writes the lit values every frame and lights-out multiplies them. Otherwise the recorded value would depend on which frame a tab rendered first. |
| Traffic ([traffic.ts:187](../../src/world/traffic.ts#L187)) | density and car lights from the scene's moment | Car lights per frame (`TrafficLayer` already reads them every frame); arrivals from the clock at each 0.1 s step of the precomputed run. |
| Part A (the dusk fade-in, `atmosphere/dusk.ts`, in progress) | `duskFor(elevation)` from 5° down to −4°, written each frame into the shared `DUSK_UNIFORMS.uDusk`; the dusk patches are applied only to a scene strictly between day and night | The same uniform, written from the clock at t: the windows and lamps coming on one by one become visible animation. A lapse whose sun crosses that band takes the dusk patches from its first frame. |
| Editor | — | The scene inspector shows the lapse's end time. |

### 3. Cost and determinism
A world frame today is bound by the GPU. A Paris wide shot takes about 96 ms: the scene 48, shadows 23, the grade 25, over 148 draw calls. The Paris stretch renders in 112 s against the 123 s bar ([06-world-engine.md](06-world-engine.md#main-video-render-speed-phase-6-2026-10-29)), and in 92 s with traffic on a quiet machine ([12-traffic.md](12-traffic.md)).

| Per frame in a lapse | How | Cost |
|---|---|---|
| Sun, sky, key, moon and stars | `sunAt`, `skyFor`, `keyFor`, `moonFor`, `starsFor` at t | 9 µs CPU (measured) |
| Key direction and colour, sky fill, fog colour and height fog, cloud tint, moon sprite, star opacity, sun disc, shafts, water | property and uniform writes; the height fog's uniforms become shared, like `DARK_UNIFORMS` | negligible |
| Shadow map | already redrawn every frame (nothing sets `autoUpdate = false`; the shadow camera follows the focus each frame) | nothing added |
| Sky dome colours | re-bake 1,225 vertex colours, or move the gradient into the shader | 0.15 ms CPU (measured) |
| Night pieces drawn while it is still day (window glow copies, lamp pools, stars, moon) | present from the first frame at zero strength | about what a night frame of the same place costs now |
| Grade | uniforms | nothing added |
| Rebuilding the city, terrain, kit instances or materials | must never happen | 0.5-1 s a frame, plus programs, if it did |

**The plan:**
1. **Split `GroundWorld`'s memo** ([Ground.tsx:299-509](../../src/world/Ground.tsx#L299-L509)). It is keyed on the resolved place and its `sky` today.
   - **The place** is built once per scene: city, terrain, materials, kit instances, light objects, dome geometry, stars and moon. It is keyed on place, date, and whether the lapse reaches dusk or day.
   - **The light at t** is a pure `lapseLight(scene, t)`, written in the frame callback.
2. **Keep the same programs all scene long.**
   - The key keeps casting shadows at zero intensity: switching `castShadow` changes programs.
   - The walls keep their emissive map, and the kit glow copies and the far cards' glow atlas exist from the start.
   - Nothing night-only is hidden at the start. `Precompile` uses `gl.compile`, which skips invisible objects, so a piece that appeared mid-scene would make every tab stop and compile its program there (a scene's first draw waits 4-5 s for its programs today).
3. **Scenes without a lapse keep today's build** and render byte-identical, as with each reaction.
4. **Check it:**
   - time the Paris 15 s stretch with and without a dusk lapse, on a quiet machine;
   - frames byte-identical across tabs and orders;
   - motion strips for crawling shadows.

**Determinism.** The clock at t is `utc(time) + (utc(to) − utc(time)) × ease((t − from) / (to − from))`, and everything else is a function of it. Nothing is carried between frames. There are two traps, and both move into the per-frame write:
- `darkRig`'s first-seen lit values;
- the fog colour, set once per sky.

**Risk.** Shadow edges may crawl as the light turns: the map is 2048 px over 260-1400 m, so a texel is 0.25-1.4 m. At 1,500 times the shadows sweep metres per frame, which reads as motion. In a slow lapse it may read as shimmer. The fallback is option C for that scene: hold the key's direction.

### 4. Options
| Option | What the user sees | Cost per frame | Build | Risk |
|---|---|---|---|---|
| **A. Continuous lapse** (recommended) | In one wide shot the sun sinks, and shadows stretch and swing. The sky goes orange, then deep blue. Windows come on one by one; lamps and car lights glow; the moon rises opposite and the stars come out. The grade warms, then cools; the birds give way to crickets. | about a night frame's | about 6 days:<br>• lapse module and tests 0.5<br>• `GroundWorld` split 2<br>• grade blend 1<br>• schema, director, assembler and flights 1<br>• sound, photographer and traffic 0.5<br>• checks 1 | Crawling shadows. The split touches `Ground.tsx`, which Part A also edits. |
| **B. Stepped lapse by cuts** (keyed moments) | Two or three shots of the same plaza at 18:00, 19:30 and 21:00 with dips, perhaps with a clock caption. Each moment is right, but nothing moves within a shot. | nothing added (each is a normal scene) | prompt only, half a day; today's schema allows it | Each extra scene costs a city rebuild (0.5-1 s per tab). It reads as a montage, not a lapse. A crossfade between moments would draw two scenes (twice the cost). |
| **C. Light-only lapse** | As A, but the shadows hold their direction and only fade. From a low sun it looks nearly the same as A. From noon, shadows stand still under a darkening sky, which looks fake. | as A | A with the key's direction frozen | No crawl, but it suits dusk and dawn lapses only. |

**Recommendation:** A, with C as a per-scene switch if the motion strips crawl, and B taught to the director now (it costs nothing).

### 5. Questions for the user
**Answered 2026-11-02:** 1 option A (with C as the per-scene fallback, B taught); 3 normal speed; 4 one operator, the end time's; 6 slowed through dusk. Defaults taken for 2 (a clock time or a word), 5 (later), 7 (one per video, at least 3 s) and 8 (the storybook moon stays).

1. **The option:** A, with C as the fallback and B taught now?
2. **The director's field:** `world.lapse.to` as a clock time, with words (`night`, `dawn`, ...) turned into times by the assembler? Or words only?
3. **Life during a lapse:** do people, cars and clouds move at normal speed (recommended)? Or should the clouds race, as in a real time-lapse (a speed factor, cheap)? Cars streaking into light trails would be new work.
4. **The grade:** keep one tone-map operator per lapse scene (which: the end's?) and blend the rest? Or switch presets at a shot cut inside the scene?
5. **Other directions:** crossing midnight, running backward ("time runs backward") or stalling ("the sun never sets"): in the first version, or later?
6. **Pacing:** an even clock (true to time), or paced by how fast the light changes, giving the dusk more screen time (the photographers' interval ramping)?
7. **Limits:** one lapse per video, at least 3 s long?
8. **Moon and stars:** a lapse shows the storybook full moon rising opposite the sun. Is that still fine? Should the stars turn about the pole (a lapse signature, one matrix a frame)?
