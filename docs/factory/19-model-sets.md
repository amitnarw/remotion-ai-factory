# 19 — Model sets, and actions from the clips on disk (P6, 2026-11-05 to 11-11)

P6 of the producer's plan ([15-producer.md](15-producer.md) §4 "Would a generic model set close part of the gap?", §9). Two parts:
1. new actor actions from clips the character packs already have;
2. model sets: one catalog model staged as the whole set.

Status: built and committed, version 1 (exteriors, ships and lighthouses). The P6 agent's log is [status/p6.md](status/p6.md).

## 1. Actions from clips on disk (`3632df3`)

### What the packs have
An inventory of the 100 animated catalog models (`src/world/data/world-catalog.json`, field `an`):
- **Punch:** Quaternius `Punch_Right` and `Punch_Left` (11 people), `Man_Punch` and `Female_Punch` (8), `Punch` (14 sushi-kit animal folk), Kenney `attack-melee-right` (36).
- **Kick:** Quaternius `Kick_Right` (11), Kenney `attack-kick-right` (36).
- **Pick-up:** Kenney `pick-up` (36).
- **Crouch:** Kenney mini `crouch` (18). The sushi kit's `Duck` is a duck-and-rise, so it is not used.
- **Carrying:** `Walk_Holding` and `Idle_Holding` (14), Kenney `holding-*` (36). These are not used: a carried prop rides on the hand bone, as before.
- **Climb:** no pack has a climb clip. Climb stays a build request.

### The actions
| Action | Plays | Without the clip |
|---|---|---|
| `punch` | `punch` key, once (0.9 s), facing its target (an actor where it stands then) | the model is not cast for it (`unsupported`) |
| `kick` | `kick` key, once (1 s) | not cast |
| `crouch` | `crouch` key, looped until the next step or `for` | the dodge's duck held (hips 0.4 m down on the leg IK, the spine folded, arms forward) |
| `stand` | stands up from a seat (the sit clip backwards), the ground (the fall backwards) or a crouch | — |
| `pickup` | `pickup` key, once (1.2 s); with `prop` (bag, box, briefcase) the prop is taken from the ground in front at 0.55 s | a bend with both arms reaching to the ground |
| `putdown` | the same clip, the prop is left on the ground in front | the same bend |

### How they are kept apart from existing plans
- **Mapped only on demand.** The new clip keys are `DEVICE_KEYS` (`src/world/actors/rigs.ts`), like bullet time's gun clips: a rig maps them only for a plan that uses them. `KEY_EXCLUDE` lets a punch use punch and melee clips, and a kick use kick clips; every other key still hides them.
- **The prop.** A pickup's prop is planned in `PropPlan` (`script.ts`): it lies on the ground in front until it is picked up, rides in the hand, and lies where it is put down. `poseAt().prop` gives it at any moment, and `rig.ts` draws it. A script's background `carry` with no pickup draws as before.
- **One list.** The spec schema's actor actions are `ACTOR_ACTIONS` itself, so the schema and `ACTOR_ACTIONS` can no longer drift (17's gotcha). The director's prompt and the capability registry read the same list. The director's `actorAction` takes the usual words: pick up, put down, stand up, kneel, hit.
- **The registry** maps every clip key (`library/models.ts`), so it knows which action plays each clip: a punch need is have.

Tests: `src/world/actors/actions.test.ts`.

## 2. Model sets

### The pieces (`bebc075`, `afdc3d3`, `60ff5d8`, `e62248f`, `3047235`)
| File | What it does |
|---|---|
| [`src/world/modelset/gltf.ts`](../../src/world/modelset/gltf.ts) | A pure glTF triangle reader: node transforms, mirrored nodes, float positions, triangle lists. Draco and meshopt are refused. It gives the same triangles in Node and in the browser. |
| [`src/world/modelset/measure.ts`](../../src/world/modelset/measure.ts) | The set measured from its triangles: 0.25 m voxels from the surfaces. **Floors:** up-facing surfaces with a body's headroom (0.45 to 1.9 m free above), joined eight ways within a 0.3 m step, the biggest first. **Solid:** each layer's inside (flood fill from outside), up to the column's floor. **Camera boxes:** merged on a 0.5 m grid. **Routes:** A* over a floor, pulled straight. |
| [`src/world/modelset/sets.ts`](../../src/world/modelset/sets.ts) | The set list, generated from the catalog (built-in and acquired). CC0 ships 8 m or longer are fitted to 26 m, so a person fits under the sails (Kenney's are toy-sized: the main sail hung 1 m over the deck). Lighthouses are fitted to 19 m. Also the spots, the subjects, and the director's lines (`modelSetsForPrompt`). |
| [`src/world/modelset/stage.ts`](../../src/world/modelset/stage.ts) | The layout. The model is centred on x and z, its lowest point at 0. **A ship:** its water line 30 % up to its main deck, its bow the narrower end, spots `deck`, `fore`, `aft`, `port`, `starboard` on the main deck. **A lighthouse:** on a seeded islet (a flat top at 0 falling into the sea at -1.2, boulders kept off the door's side), spots `door`, `back`, `left`, `right`, `shore`. Plus `groundAt` and `route`. |
| [`src/generator/camera/modelSet.ts`](../../src/generator/camera/modelSet.ts) | The camera's subjects, each with the model's boxes as blockers: `scene`; `ship` or `tower`; `bow`, `stern`, `mast` or `top`; the spots; each actor (by id, role and `actor<n>`). Also the cast: actors planned on the set's table, a target naming another actor resolved by role. `modelSetShotSubjects` gives the names for the shots' check. |
| [`src/compositions/ModelSetStage.tsx`](../../src/compositions/ModelSetStage.tsx) | The stage: the file read once per tab under a hold, the layout and the drawn model from the same bytes, materials in file order, opaque meshes in scene order (`useSceneDrawOrder`), a stand-in box for a missing file. It draws the sea, sky, light by time of day, fog, weather, the islet, the actors and `ShotCamera`. |
| Schema, director, assembler, shots | `kit: "model-set"` and `scene.modelSet: { model }`. The director's `modelSet` choice and its MODEL SETS block; an id off the list is asked about once. The assembler makes a listed id a model-set scene with its actors; kit, crowd and cast don't apply. Shots may name the set's parts, spots and actors (`timeShots` `subjectsAt`). |
| Registry | One `model-set:<id>` entry per set. The planned model-set capability is now built. A set need whose model a set can stage is have: the keeper's lighthouse, a ship's deck. |
| Sound | `BEDS_BY_SET`: a ship has the sea and the wind; a lighthouse has the surf and the coast wind. The designer is told "on the deck of a ship at sea". |

### Measured
- **`kenney-pirate-kit-ship-large` at ×1.98:** a 51 m² main deck at 4.2 m, the forecastle at 5.6 m, the quarterdeck at 7.0 m. About 250 camera boxes. The measure takes about 1 s once per tab.
- **All 13 listed ships** have a deck of 17 to 118 m².
- **`landmark-lighthouse` at ×1.48:** 19.3 m tall, solid inside. The gallery is one cell wide (0.5 m between the glass and the rail), so `top` is a camera subject, not a floor.

### Checked
- **Sight lines** (`camera/modelSet.test.ts`): for the ship and the lighthouse, 1,800 lenses each (every subject, 5 sizes, 6 sides, 3 angles, 9:16 and 16:9). Every lens stands outside the model as drawn (its voxels, not the merged boxes), within the 70 m reach, and sees its subject; up to 2 % may fail.
- **An actor walks the deck:** a sailor goes from `aft` to `fore` round the mast, feet within 5 cm of the deck, never inside the model.
- **Stills:** `out/agentP6/sheet-model-sets.png` (dev laptop):
  - the ship by golden light and at night: EWS, the deck from high with the sailor walking past the mast, a follow shot, the hull and sails from low;
  - the lighthouse by day and at night: EWS on its islet, the tower from low, the keeper by the door, the lantern room.

  Specs in `out/agentP6/specs/`.
- **Existing videos:** the fixture plans are byte-identical (money-doubles 9:16 and 16:9, oceans-vanish, forest-walks, bullet-test). 24 of 24 hashed frames of four fixture videos are identical before and after the stage and router.

### Not built yet
- **Creaks for a ship:** the library has creak one-shots (`kenney-rpg-audio-creak1..3`), but there is no creak sound name in `audio-resolve.ts`. Add one, then a creak hit every few seconds on a ship scene (assembler).
- **Interiors:** only where the model is hollow and the camera fits (a cabin, a hall). The measure finds the floors inside already; the camera would need `bounds` from the walls.
- **More kinds:** a cabin, a cave, a throne room (one model each; KayKit dungeon and Kenney castle pieces are modular, so they need a model built from pieces first).
- **Motion:** a ship's bob and roll (the actors, camera subjects and blockers through one closed-form transform).
- **Lights:** a lit lantern at night; lamps on a ship's deck.
- **CC-BY models** (the lighthouse cottage): their credit through `generate.ts creditsForPlaces`.
- **The gallery as a floor:** a 0.25 m clearance mode for narrow walkways.
- **A real-model run:** a premise whose story sets a scene on a ship, so the director chooses `modelSet` on its own.
