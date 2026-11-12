# 14 — Bullet time (a director device)

Built on 2026-11-04 (option A, the full device): see [Status](#status-as-built-2026-11-04). The proposal below was written at `6ec318d` and the web sources were checked on 2026-11-03; the user's ten questions (section 8) were taken as recommended (the user may change them).

**Bullet time** means the world slows or freezes while the camera keeps moving round the subject. A shot is fired, the projectiles crawl past with trails and rings of disturbed air, a person leans back out of their way, the camera sweeps fast round the frozen moment, and the sound sinks and slows. The director (the LLM) asks for it in the spec, as it asks for a time-lapse ([13-light-and-time.md](13-light-and-time.md) Part B).

**The device is generic.** It is made of a clock warp, projectiles, a dodge and an arc move, and any story can use them, with or without projectiles (for example a frozen jump, a splash, or crates hanging in the air). Nothing here comes from a film: no film's characters, costumes, colour tint, lines or staging. The test scene (section 7) is our own: its characters, places, lines and staging are original. It is a private test bed and will not be posted.

## Recommendation in short
- **One device, `scene.bulletTime`, on world scenes only.** Over a window of 2.5-6 s the world's clock ramps down to a crawl (or stops), holds, and ramps back. The camera, the HUD, the captions and the voice stay on real time.
- **Three clocks, all closed-form functions of video time t:**
  - real t: the camera, the grade, the HUD, the captions and the voice;
  - the world clock w(t): everything in the place;
  - the hero clock h(t): one featured actor who moves faster than the world, so the dodge can be seen.
  
  Nothing is carried between frames, so frames still render in any order and in any tab.
- **New work:**
  - projectiles drawn only when the director names them, with trails and path-anchored ripple rings;
  - three new actions, `aim`, `shoot` and `dodge` (a procedural lean-back);
  - a procedural low-poly pistol;
  - an `arc` camera move that sweeps 180° round the hero;
  - a slow-motion sound pass: the beds and music varispeeded along the warp in TypeScript, plus device one-shots.
- **No download is needed for a first version.** The 11 Quaternius characters already on disk have `Gun_Shoot`, `Idle_Gun_Pointing` and `Roll` clips; `rigs.ts` hides them today. The pistol, the whiz, the sub drop and the swell can be made in code.
- **Cost:** about the same render time as the same scene without bullet time (under 1 ms a frame extra). The build is about 13 working days in 8 phases.

## 1. Prior art and sources

### Techniques
| What | Licence | What it does | Verdict |
|---|---|---|---|
| Time-slice photography: Muybridge, then Tim Macmillan from 1980 ([Wikipedia](https://en.wikipedia.org/wiki/Bullet_time)) | technique | Still cameras round a subject fire at once or in sequence, and in-between frames are interpolated | Borrow the idea: one frozen world clock, and a camera on its own clock. We need no camera array, because every frame is rendered. |
| Max Payne's bullet time, 2001 ([Wikipedia](https://en.wikipedia.org/wiki/Max_Payne_(video_game))) | game | The world slows while the player still aims at near real speed | Borrow two clocks: the world's and the hero's. |
| Unreal `CustomTimeDilation` and `SetGlobalTimeDilation` ([actor](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Engine/GameFramework/AActor/CustomTimeDilation?application_version=5.4), [global](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Engine/Kismet/UGameplayStatics/SetGlobalTimeDilation?application_version=5.4)) | engine API | An actor's delta time is the global dilation times its own | Borrow the per-actor rate. Engines add up dt frame by frame, which is state; we integrate the rate curve in closed form instead. |
| Unity `Time.timeScale` and `unscaledDeltaTime` ([timeScale](https://docs.unity.com/en-us/engine/current/script-reference/unityengine/time/timescale), [unscaled](https://docs.unity.com/en-us/engine/current/script-reference/unityengine/time/unscaleddeltatime)) | engine API | Scaled time drives the game; unscaled time drives the UI and the camera | Borrow: the camera, the HUD, the captions and the voice run on real time. |
| CRIWARE on bullet-time audio ([blog](https://blog.criware.com/index.php/2024/06/03/bullet-time/)) | article | One parameter drives volume, pitch and a band-pass. The ambience is pitched down and faded, gunshots crossfade to slowed variants, and more goes to reverb | Borrow: one curve (the warp's rate) drives the sound's pitch, filter and level. |
| pmndrs/postprocessing `ShockWaveEffect` ([repo](https://github.com/pmndrs/postprocessing)) | Zlib | A screen-space distortion ring from one 3D point | Later, as an option. The first version uses stylised ring meshes and needs no extra pass. |
| Remotion `<Audio>` (4.0.536 is installed) | — | `playbackRate` (becomes `atempo`, keeps pitch) and `toneFrequency` (becomes `asetrate`) are one number per file (`node_modules/remotion/dist/cjs/audio/props.d.ts:30-39`). `toneFrequency` plays only at render, not in the preview | Neither can follow a curve; a pre-rendered file can. |
| ffmpeg `atempo` and `asetrate`+`aresample` ([filters](https://ffmpeg.org/ffmpeg-filters.html)); `rubberband` ([librubberband](https://breakfastquay.com/rubberband/), GPL); SoX (GPL) | — | `atempo` keeps the pitch. `asetrate` changes speed and pitch together, like tape. rubberband and SoX can do both | The bundled ffmpeg (n7.1, `src/generator/ffmpeg.ts:13-18`) has `atempo`, `asetrate` and `aresample`, but not `lowpass`, `afade`, `areverse`, `aecho` or `rubberband`. Use it to decode only. Do the varispeed and the filter in TypeScript (`scripts/sfx-synth.ts` already has state-variable filters and glides). Reject rubberband and SoX (GPL). |

### Models and clips
| What | Licence (as the page says) | Relevant | Verdict |
|---|---|---|---|
| Quaternius animated characters, already on disk: 11 `public/assets/characters/polypizza/*` (business man, casual, hoodie, punk, swat, worker, farmer, king, adventurer, astronaut, beach) | catalog: "CC0 (poly.pizza)" | 24 clips. Among them `Gun_Shoot` (0.58 s), `Idle_Gun_Pointing`, `Idle_Gun_Shoot`, `Run_Shoot`, `Roll` (1.33 s), `HitRecieve` and `Run_Back`. Bones Hips, Abdomen, Torso, Chest, Neck, Head. No gun mesh | **Use** for the shooter (aim, shoot) and the roll dodge. There is no lean-back clip. |
| Quaternius HumanArmature men and women, on disk (8 polypizza models) | CC0 | 11 clips, none for guns or dodges; spine Hips, Abdomen, Torso | The procedural lean works on them. |
| Kenney mini and blocky characters, on disk | CC0 | `holding-right-shoot` (a 0.2 s pose), `crouch` (mini only), `die`. One `torso` node, no spine chain | Fine for a shooter pose. For the dodge only a crude lean; use the duck instead. |
| Kenney Space Kit `weapon_gun.glb`, on disk but not in the catalog | CC0 | 70 triangles, 0.7 m long at the kit's scale, sci-fi | A blaster, for sci-fi stories only. |
| Quaternius [Ultimate Guns Pack](https://quaternius.com/packs/ultimategun.html) and [Animated Guns](https://quaternius.com/packs/animatedguns.html) | "CC0" | 40 untextured low-poly guns (FBX/OBJ/Blend); 6 animated, including a pistol and a revolver | Later, if the procedural pistol reads poorly (download and convert to GLB). |
| Kenney [Blaster Kit](https://kenney.nl/assets/blaster-kit) | "Creative Commons CC0" | 40 toy and sci-fi blasters, glTF, 1.1 MB | Only for a toy look. |
| Poly Pizza pistols | per model: [Pistol](https://poly.pizza/m/J3i9KDQ3kt) "Public Domain (CC0)"; [9mm Pistol](https://poly.pizza/m/BoZWhFdsj4) "Creative Commons Attribution" | — | Check each page; prefer the quaternius.com copy. |
| Quaternius [Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html) and [UAL2](https://quaternius.com/packs/universalanimationlibrary2.html) | "CC0 License"; the Standard tier is free, Pro costs $9.99 and up | 120+ and 130+ clips. The page lists a "combat and gun" category, and UAL2 lists KNOCKBACK, SLIDE and NINJUMP. The pistol clip names are not on the page (unverified) | Later. It uses its own "universal humanoid" rig, so the clips would have to be retargeted. |
| KayKit [Character Animations](https://kaylousberg.itch.io/kaykit-character-animations) | "CC0 Licensed" | 161 clips (aiming, shooting, dodging) for Rig_Medium and Rig_Large | Later: our characters are not KayKit rigs. |
| Mixamo | free, but the raw files may not be redistributed (an Adobe community post; the official FAQ blocked our fetch, so unverified) | — | Reject for the repo. |
| Bandai Namco motion dataset ([repo](https://github.com/BandaiNamcoResearchInc/Bandai-Namco-Research-Motiondataset)); CMU mocap | "CC BY-NC 4.0"; CMU's page could not be reached | — | Reject: Bandai Namco is non-commercial, and CMU's licence is unchecked. |

### Sounds
- **In the library today** (`public/library/audio-library.json`, 775 entries):
  - `oga-100cc0-shot-01` (0.75 s) and `shot-02` (0.33 s);
  - whooshes `bsb-1796` (1.0 s), `bsb-0572` and `bsb-0573` (11-12 s);
  - the Kenney impact sets (metal, glass, generic; light to heavy) and two `lowFrequency_explosion`;
  - synthesized roles in `public/sfx`: `whoosh_dissolve`, `space_whoosh`, `rise_short`, `rumble_deep` and `heartbeat_bpm70`-`150`.
  
  There is nothing for a bullet whiz, a ricochet, a riser, a reverse swell or a sub drop.
- **Freesound picks** (each page says "Creative Commons 0"):
  - fly-by [789222](https://freesound.org/people/modusmogulus/sounds/789222/);
  - pistol shot [427592](https://freesound.org/people/michorvath/sounds/427592/);
  - ricochet [478345](https://freesound.org/people/Joao_Janz/sounds/478345/);
  - slow whoosh [369698](https://freesound.org/people/crackles04/sounds/369698/);
  - sub [475005](https://freesound.org/people/AlexLane/sounds/475005/);
  - heartbeat [332820](https://freesound.org/people/loudernoises/sounds/332820/);
  - shell casings [210102](https://freesound.org/people/GrayJoy/sounds/210102/);
  - reversed cymbal [425463](https://freesound.org/people/trivialAccapella/sounds/425463/).
  
  Avoid three that are marked CC0 but have doubtful origins: 855248 (taken from a NATO video), 609633 (adapted from a cartoon sound) and 856174 (made with an AI tool).
- **Sonniss GDC bundles:** royalty-free, but the files may not be redistributed "as sound effects", so they cannot be committed. Rejected.
- **Verdict:** the first version needs no download. Synthesize the whiz, the sub drop and the swell; take the shot, the impacts and the heartbeat from the library. The Freesound picks are an upgrade if the synthesized sounds read poorly.

## 2. How the code works today

### Every consumer of time in a world scene
A world frame reads time in more places than one, and three layers read the frame number themselves. The last column says which clock each must follow in bullet time.

| Consumer | Where it reads time | Clock in bullet time |
|---|---|---|
| The stage's time | [WorldStage.tsx:118](../../src/compositions/WhatIfVideo/WorldStage.tsx#L118) `t = frame / fps`, then passed down as `reaction.t`, `traffic.t` and `lapse.t` (:135-139) | splits into real t, world w(t) and hero h(t) |
| Camera pose and shot progress | `cameraAt` (WorldStage.tsx:84-103). [world.ts:699-714](../../src/generator/camera/world.ts#L699) `solveWorldShot` takes both the shot's progress u and the subject from one t; actor subjects at :632 | **real** for u and the lens; the subject on its own clock (the hero on h, others on w) |
| Kit level-of-detail path, solved lens, whip pan | WorldStage.tsx:107-112 and :141-146 | **real** |
| Tree sway, cloud drift, pond and fountain water | [Ground.tsx:838-843](../../src/world/Ground.tsx#L838), from its own frame (:316) | **world** |
| Sun, moon, stars, sky, dusk amount | resolved once per scene (WorldStage.tsx:66-73) or by the lapse clock (Ground.tsx:325) | static: a bullet-time scene has no lapse |
| Lights out, lifting buildings, water level | Ground.tsx:886, :737 and :891, :896, all from `reaction.t` | **world** |
| Reactions (debris, money, confetti, slabs, flood, snowfall) | `ReactionLayers` t (Ground.tsx:972-990; ReactionLayers.tsx:88; snowLayer.tsx:51) | **world**; the snowfall's box round the lens stays at the real lens |
| Traffic plan | Ground.tsx:659-680: the scene's span, `lens`, `aim`, `halt`, `slow` | the **world** span; the lens through the clock's inverse, plus the arc kept clear |
| Cars | [TrafficLayer.tsx:131-138](../../src/world/TrafficLayer.tsx#L131) `poseAt(t, out, lens)` blends two steps of a 0.1 s table (traffic.ts:2199) | **world** t, real lens |
| Traffic lights | TrafficSignals.tsx:189 `lightsAt` | **world** |
| Background crowd | crowd.ts scripts, drawn by `ActorsLayer` (Ground.tsx:1021). Off: `crowd = false` (Ground.tsx:252), and WorldStage never passes it | **world** |
| Featured actors | [Actors.tsx:103-153](../../src/world/actors/Actors.tsx#L103), from its own frame | **world**; the hero on **h** |
| Birds, flags | Birds.tsx:59 and :87; Flags.tsx:65 and :89, each from its own frame | **world** |
| Rain | none in world scenes (it is kit-stage weather, `compositions/weather.tsx`) | — |
| Grade, grain | WhatIfVideo index.tsx:115 and :183; the grain seed is the frame (CinematicLook.tsx:79) | **real**, optionally blended to a "bullet look" by the warp |
| Transitions, hook, counter, timer | index.tsx:194-235; planned by rule in transitions.ts:46 | **real** |
| Captions | Captions.tsx:48-51 | **real** |
| Voice | timeline.ts:17-29, audio.tsx:174-180 | **real** |
| Ambience beds, music | audio.tsx:114-172; ducking under speech :20-42 | **slowed** (a pre-rendered file) |
| One-shots | audio.tsx:86-106; world-event hits at beat start + 0.3 s (assemble.ts:345-362) | world events inside the window slowed, the rest real |
| Kit stages | 8 stages read `useCurrentFrame` directly (StreetStage in 9 places; Ocean, Countryside, River and Asset 5 each; Forest 4; Space and Interior 3), plus water.tsx and weather.tsx | out of scope for the first version |

### Camera
- **Moves** ([solve.ts:240-256](../../src/generator/camera/solve.ts#L240)): an orbit turns by `size.orbit × energy × (eased − 0.5)`. That is 6° (ECU) to 30° (EWS) over a shot ([shot.ts:53-60](../../src/generator/camera/shot.ts#L53)), times 0.6 to 1.6 for energy: at most 48°, a slow drift.
- **The view test** (`viewCost`, solve.ts:487-507) checks the rest pose and the two ends of the move only. That is enough for a 30° orbit, not for a 180° sweep.
- **Detours** turn, lift or pull in the whole shot (`DETOURS`, :389-401).
- **Traffic lanes** are a `keepOut` for the lens.

### Actors
- **Actions:** 14 in `ACTOR_ACTIONS` (script.ts:21-36), duplicated in the schema enum (spec.schema.ts:238). There is no `aim`, `shoot` or `dodge`.
- **Clip keys:** 12 in `CLIP_KEYS` (script.ts:59-72).
- **Hidden clips:** [rigs.ts:47](../../src/world/actors/rigs.ts#L47) `EXCLUDE` hides every clip named gun, shoot, pistol, holding or roll, for every key.
- **Overlays:** `PROCEDURAL` (rigs.ts:74) stands in for wave, point, cheer, clap, react, cower and jump.
- **Posing:** `applyPose` ([rig.ts:868](../../src/world/actors/rig.ts#L868)) resets the head, neck, arms and legs to rest each frame. The spine is never touched: `findBones` finds a chest but the rig does not keep it.
- **Leg IK:** `moveFoot` and `plantFeet` already keep feet planted.
- **Carried props:** procedural boxes under the hand bone (rig.ts:606-622): bag, box, briefcase.
- **The aim:** the `point` overlay already aims an arm at a target point.

### Sound
- **Mixing:** Remotion mixes at render time.
  - Every cue is its own `<Sequence>` (audio.tsx).
  - Beds loop from the start of their file.
  - ffmpeg only masters the finished file (audio-master.ts:65-134).
  - Per-video files live in `public/whatif-audio/<id>/` (the render hash covers it: render/hash.ts:17).
- **The lapse's precedent:** `lapseAmbience` (sound.ts:243) splits beds where the sun crosses a height, and assemble.ts:380 splices them in.

### Spec, prompt, checks
- **The lapse:** `world.lapse` (spec.schema.ts:203-220) is taught in director-context.ts:63-70.
- **Checks:**
  - `lapseProblems` (director.ts:435-457) is asked once, then the lapse is dropped with a warning (:468-475);
  - `validateSpec` checks one per video and at least 3 s (spec.schema.ts:590-605).
- **Actor times:** actors' `do[].at` are scene seconds, made absolute by the assembler (assemble.ts:203-220).

## 3. The proposal

### 3.1 The warp curve
**The window.** A window [a, d] in video seconds has a ramp-in [a, b], a hold [b, c] and a ramp-out [c, d]. Let S(x) = 3x² − 2x³ (smoothstep) and let r be the world's rate in the hold (0 means frozen).

**The rate:**
- ρ(t) = 1 outside the window;
- 1 − (1 − r)·S((t − a)/(b − a)) in the ramp-in;
- r in the hold;
- r + (1 − r)·S((t − c)/(d − c)) in the ramp-out.

**The world clock w(t)** is the integral of ρ, exact because ∫₀ˣ S = x³ − x⁴/2:
- w = t before a;
- w = a + (b − a)·[x − (1 − r)(x³ − x⁴/2)] in the ramp-in;
- w = a + (b − a)(1 + r)/2 + r(t − b) in the hold;
- after d, w = t − debt, where debt = (d − a) − [(b − a)(1 + r)/2 + r(c − b) + (d − c)(1 + r)/2].

**Properties:**
- **Pure:** no table, no state, the same in every tab and order.
- **Smooth:** its rate never jumps (C¹).
- **Monotone,** and invertible outside a frozen hold. The inverse, for placing sounds at real times, is a bisection.

**The other clocks.**
- **The hero clock h(t)** is the same curve with its own hold rate (default 0.4).
- **The sound clock** uses max(ρ, 0.45), so a frozen world hums about 14 semitones down instead of going silent.

**An example.** A 4.5 s window with 0.5 s and 0.45 s ramps and r = 1/200:
- the world moves 0.50 s in it;
- the hold covers 0.018 s of world time;
- the debt is 4.0 s.

**Times after the window.** The world lags real time by the debt. Every time in the spec stays in real video seconds (the editor shows them as written), and the world maps them through w when it plans:
- actor plans are built with each step at w(at), the hero's at h(at);
- the reaction plan uses each event at w(T);
- the traffic sim covers [w(from), w(to)].

So a step or event the director put after the window still happens at its real moment on screen; one put inside the hold happens at once in world time. The next scene starts on its own clock.

### 3.2 Projectiles (a world effect)
Projectiles are drawn only when the spec lists them: the intent rule ([10-intent-audit.md](10-intent-audit.md)). A pure plan (`projectilePlan(spec, scene, layout)`, Node-safe so the validator and the assembler use it) gives each one the following.

**Its path:**
- **Origin:** a shooter's muzzle, taken from the planned pose (shoulder height 0.82 × the actor's height, 0.55 m toward the target, 0.18 m to the right; model-free, so Node can plan it), a named spot at 1.4 m, or a compass direction 40 m off screen.
- **Pass point:** where the target's head or chest was before the dodge, offset to miss.
- **End:** where the line meets the ground or a wall, from the occluders the camera already has.
- **Speed:** a story speed (120 m/s for a bullet, 25 for a ball), not muzzle velocity, so the crawl in the hold is readable.

**Its timing.** Each projectile passes the hero at a set share of the hold (0.3, 0.5, 0.7 for three shots, spread along the path). Its fire time in world time is solved backwards from the pass: fire = w(pass) − distance / speed. With the example window, a shooter 12 m away fires 0.18 s into the ramp-in, at 72% speed. The bang lands as time sinks.

**How it is drawn:**
- **The projectile:** 3 times real size for legibility (a 3.5 × 1.3 cm bullet), spinning by world time. A ball kind exists for non-weapon stories.
- **The trail:** a camera-facing tapered ribbon over the last 2.5 m of path, pale and fading.
- **Ripple rings:** born at fixed points every 0.4 m along the path, at most 6. Each ring's radius grows with the distance the projectile has gone past its point (0.04 + 0.12 × that distance), so the rings expand as the bullet crawls and hold still when it is frozen. They are thin and pale and write no depth.
- **Muzzle flash:** an additive sprite for 4 ms of world time, a few frames in the ramp. No light is added, because a light appearing mid-scene changes every shader program.
- **Impact:** a dust and chip burst at the path's end, from the existing reaction particles.
- **Draw calls:** all projectiles together make three instanced draws.

**Checks:**
- every projectile is at least 0.35 m from every body as posed at its pass time (people are never hit);
- every pass point is inside the hold;
- no path starts inside a wall.

### 3.3 The dodge
**`dodge` is a new action, on the hero clock.** Its default is a procedural lean-back of 1.6 s of hero time: 0.5 s in, a hold, 0.6 s out.
- **The body:**
  - the hips go forward 0.18 m and down 0.22 m, with the knees bent through the existing leg IK, which keeps the feet planted;
  - Abdomen, Torso and Chest pitch back 15°, 20° and 20°;
  - the head tips back and looks at the nearest projectile (the `look` overlay, aimed at the projectile's position at w(t));
  - the arms swing out and back.
- **Rig changes:** find and reset the spine bones (Hips, Abdomen, Torso, Chest) in `applyPose`, as it already does the head and arms.
- **Variants:**
  - `duck`: the `cower` overlay, or the mini characters' `crouch` clip;
  - `roll`: the Quaternius `Roll` clip, on disk.
  
  Blocky and mini rigs, which have one `torso` node and no spine chain, use `duck`.
- **The shooter's actions:**
  - `aim` is the `point` overlay plus the pistol, or `Idle_Gun_Pointing` where the model has it;
  - `shoot` adds `Gun_Shoot`, or a procedural 0.12 s recoil.
- **`rigs.ts` gets exemptions per key:** `aim`, `shoot` and `roll` may use gun, shoot, pistol, holding and roll clips. `EXCLUDE` still hides them from every other key.
- **The pistol** is a procedural carried prop: three dark boxes, about 0.19 m long, under the right hand along the forearm, like rig.ts:606-622. It is drawn only on an actor whose script has `aim` or `shoot`.
- **Downloaded dodge clips** (UAL, KayKit) are a later option, because they need retargeting.

### 3.4 The arc camera move
- **What it is:** a new move, `arc`, kept out of the director's move list. The assembler gives it to the shot that covers the window, and that shot spans the window exactly.
- **The bearing:** sweeps `dir × sweep × (E(u) − 0.5)`, where u is the real-time progress and E is smootherstep. The default sweep is 180° on FS, peaking at about 84°/s, or about 5 m/s at a 3.5 m radius.
- **The lens:** dips from eye height to 0.7 × the hero's height mid-hold, a slight low angle.
- **The subject:** the hero's planned position at h(t), not the leaning body, so the arc stays steady.
- **The view test** samples 9 poses along the arc, not the rest pose and two ends. If blocked, it tries in order:
  1. turning the whole arc (the existing detours);
  2. lifting it;
  3. shrinking the sweep (180°, then 135°, then 90°);
  4. flipping the direction.
- **The road:** for this shot the lens may stand in a traffic lane. The traffic plan closes the lanes within reach of any arc point from 2 s of world time before the window, using the existing low-lens closure: cars wait 12 m short. So no frozen car vanishes as the lens comes near.

### 3.5 The sound
- **Beds, music and world one-shots inside the window** are re-rendered by a new pipeline step after `resolveAudio` (audio-resolve.ts:127):
  - decode each affected file with the bundled ffmpeg (`aformat`, `aresample`);
  - read the source along the sound clock (cubic interpolation: tape-style varispeed, so the pitch slides down and back up with the picture);
  - apply a low-pass whose cutoff follows the rate, open at full speed and about 700 Hz at the floor, and drop 4 dB;
  - write the result to `public/whatif-audio/<id>/bt-*.wav`.
  
  The file starts frame-exactly at the window, reading the source where the bed had got to, with a 10 ms overlap, and runs to the cue's end so no restart is heard. It is pure TypeScript and deterministic, it plays in the preview too, and it takes about 50 ms per track.
- **Device one-shots,** added by rule from the director's choice (the intent audit's case b):
  - a **time drop**: a synthesized sub drop plus a dark whoosh, at the ramp-in;
  - the **gunshots**: `shot-01` at each fire's real time, through the varispeed;
  - a **whiz** per projectile, synthesized and centred on its pass;
  - a **heartbeat** under the hold (`heartbeat_bpm70`, low);
  - a **reverse swell** ending at the ramp-out: a TypeScript-reversed `whoosh_dissolve`;
  - **impacts** at the ends, at normal speed (Kenney metal or generic heavy).
- **Voice and captions stay on real time.** The music still ducks under speech.

### 3.6 Spec shape and checks
The director writes beats; the assembler times everything.

```jsonc
// The director's reply (beats, names):
"bulletTime": { "beat": "b6", "hero": "Nadia", "from": "Karim", "shots": 3, "kind": "bullet", "dodge": "lean", "freeze": false }

// The spec (scene.bulletTime; real video seconds; everything else is derived per frame):
"bulletTime": {
  "from": 20.0, "to": 24.2, "rampIn": 0.45, "rampOut": 0.45,
  "rate": 0.005,                                   // 0 = frozen
  "hero": { "actor": "nadia", "rate": 0.4, "dodge": "lean" },
  "arc": { "sweep": 180, "dir": "left" },
  "projectiles": [
    { "kind": "bullet", "from": "karim", "at": "nadia", "pass": 0.3, "miss": "high" },
    { "kind": "bullet", "from": "karim", "at": "nadia", "pass": 0.5, "miss": "high-left" },
    { "kind": "bullet", "from": "karim", "at": "nadia", "pass": 0.7, "miss": "high-right" }
  ]
}
```

**The assembler:**
- The window is the beat's span. If the beat is shorter than 2.5 s, the window runs into the next beat of the same scene.
- It inserts `aim` (1 s before the window), `shoot` (at it) and `dodge` (at its start) when the director didn't write them.
- It gives the window's shot `arc`, on the hero, at FS.

**Checks** (`bulletProblem` in a pure `warp.ts`, plus `validateSpec`):
- world scenes only, at most one per video;
- inside one scene, from 0.5 s after its start to its end, not across a flight or a transition;
- a window of 2.5-6 s, a hold of at least 1.5 s, ramps of 0.25-1 s;
- `rate` 0-0.05, and the hero's rate from `rate` to 0.6;
- not in a scene with a lapse;
- the hero is a featured actor of the scene;
- at most 6 projectiles, each 4-60 m from its target, never within 0.35 m of a body;
- `arc` is refused outside a window.

Like the lapse, a wrong bullet time is asked about once with the real beat lengths. If it is still wrong, it is dropped with a warning and the scene stays.

**The prompt** (a block like the lapse's) teaches:
- **When:** a near miss, a split-second choice, reflexes, "what if time stopped for everyone but you". It can also be a frozen moment with no projectiles at all.
- **Where:** a silent or linger beat in a world scene with a featured actor standing on open ground.
- **Never** hitting anyone.

### 3.7 Where it can happen
| Place | Spot | Room for the arc |
|---|---|---|
| Paris, Colmar | the plaza's clear ring, between the fountain basin (2.9 m) and the stalls (`MARKET_CLEAR_RING`, 9 m) | A 3 m arc fits on the aisle axes. The best spot today; it needs one new spot name, `plaza-ring-<side>`, 6 m out from the fountain. |
| all | avenue, sidewalks | Cairo's sidewalk is 2 m with walls behind, so the arc sweeps half over the road, where traffic is kept clear. Traffic does not avoid actors today: an actor standing in the carriageway is driven through. |
| places with a park | park | trees: the arc detours |
| Cairo | `landmark-front`, 9 m in front of the minaret's dome | an open forecourt (not measured) |

**Cairo has no plaza.** Its style's `plazaChance` is 0.01 (roads.ts:302) and its layout draws none; New York has none either. A guaranteed square for Cairo would change its whole layout, so every Cairo frame would need re-baselining (about 1 day).

**What a rooftop set would need** (about 3 days). Box cities only: Cairo and New York have flat roofs; Paris and Colmar are kit-built with pitched roofs.
1. A `rooftop` anchor: a flat-roofed building near the avenue (Cairo has 3-11 floors of 3.1 m), with a roof of at least 15 × 15 m and no taller neighbour within 20 m on the arc's side. The spot's height is the roof's, and `groundAt` must return that height there.
2. Dressing: a 0.9 m parapet, a stair hut, water tanks, air-conditioning boxes and dishes (procedural boxes or kit pieces), and these must be added to the camera's blockers.
3. The camera: `ground` is the roof height, the lens may pass beyond the edge over the street, and the skyline sits behind.
4. The shadow box: it is focused at y = 0 today (Ground.tsx, the frame callback) and must move to the roof's height.
5. The building and its neighbours stay at full detail (the kit level of detail).

### 3.8 Options
| Option | What the user sees | Build | Verdict |
|---|---|---|---|
| **A. The full device** (recommended) | Everything in 3.1-3.6 | about 13 days | Recommended |
| **B. Time-slice only** | The world stops and the camera circles the frozen moment (a jump, crates in the air) with the slowed sound. No projectiles, no new actions | about 6 days (phases 1-3 and 6, with a slim phase 7) | A good first step if A is too much |
| **C. Retimed slow motion** | The warp is fed to everything, camera included: a plain slow-motion shot | about 2 days | Rejected: it is not bullet time, because nothing circles the frozen moment |

## 4. Render cost
- **The baseline:** a world frame is GPU-bound: about 96 ms for a Paris wide shot (48 ms the scene, 23 ms shadows, 25 ms the grade). The Paris 15 s stretch renders in 85-92 s with traffic, against the 123 s bar ([12-traffic.md](12-traffic.md)).
- **A frozen frame costs as much as a moving one,** because every frame draws the whole place.
- **What bullet time adds:**
  - **projectiles:** 3 instanced draws, under 0.5 ms;
  - **the lean:** a few bone writes;
  - **the arc's view test:** 9 samples, once per shot;
  - **the traffic sim:** covers 4 s less world time, so slightly cheaper;
  - **the sound pass:** about 50 ms per track per video;
  - **encoding:** a fast arc changes more pixels per frame, so the H.264 file grows and the encode slows by a few percent.
  
  **Expected:** within 5% of the same scene without bullet time.
- **Optional extras:**
  - a screen-space distortion pass: +2-4 ms a frame;
  - the bullet look: uniforms only, nothing added.
- **The test scene** (38 s, three scenes and a flight): at the Paris stretch's rate (92 s per 15 s), about 4 minutes on the GPU machine.

## 5. Risks
1. **A layer left on the real clock keeps moving in the freeze.** Flags, Birds and ActorsLayer read the frame themselves today. Mitigation: GroundWorld takes one `clock` prop, and a test fails if anything under `src/world` other than the clock's provider calls `useCurrentFrame`.
2. **State between frames.** Actors.tsx:160 keeps the per-actor billboard level of detail in React state written from `useFrame`, so what a frame shows depends on the frames that tab drew before. A fast arc makes this more likely to show. Fix: make the level of detail a pure function of distance, or exempt the featured cast (half a day; worth doing anyway).
3. **Traffic and the lens.** The draw rule hides cars within reach of a low lens, and the solver keeps the lens out of lanes. Both are handled by closing the arc's lanes early and dropping the lane keep-out for the arc shot (3.4).
4. **Traffic does not avoid featured actors.** An actor in the carriageway is driven through. Keep heroes off the road for now; avoiding actors is later work.
5. **The arc may meet stalls, trees and lamp posts.** The 9-sample test and the shrinking sweep handle it. Check with stills of each spot.
6. **A 1 cm bullet is about 10 px** at FS on a 1080 px wide frame, so it is drawn 3 times real size with a bright trail. Check the stills.
7. **The debt.** Every world-timed thing in the scene must go through w. A missed one fires about 4 s late. Test: a world event after the window happens at its real time.
8. **Pitched-down music can sound wrong** (out of key, smeared). The floor and the low-pass soften it; the fallback is a drone only. The user listens to judge it; agents never play audio.
9. **Content.** Firearms in videos. Shots always miss and nobody is hit, there is no blood, and the prompt teaches non-weapon uses too. The test scene is private.
10. **Narration over the freeze is allowed,** but a line about the freeze may land outside it. The prompt prefers a silent or linger beat.
11. **The critic and the photographer** may flag frozen people or floating crates as faults. They are told the window and what it does.
12. **Editing:** a beat change in the editor moves the window, so the slow-motion audio is cached by window and source files and re-rendered when they change.

## 6. Phased plan
| Phase | What | Size |
|---|---|---|
| 1. The clock and the spec | `src/world/warp.ts` (w, h, the sound clock, the inverse, the debt; tests); `scene.bulletTime` in the schema; `bulletProblem`. Nothing drawn yet | 1 day |
| 2. The world follows | One `clock` threaded through GroundWorld: sway, clouds, water, birds, flags, actors (world and hero), reactions, lights out, lift, snowfall, traffic (the world span, the inverse lens, the arc closed); WorldStage subjects on their own clocks. Tests: scenes without it byte-identical; no stray `useCurrentFrame`; fix risk 2 | 2 days |
| 3. The arc | `arc` in solve.ts (sweep, ease, height), the view test along the arc, fallbacks, lane keep-out off for that shot; tests | 1 day |
| 4. Actors | `aim`, `shoot`, `dodge`; clip keys and exemptions in `rigs.ts`; spine bones; the procedural lean with leg IK; duck and roll; the procedural pistol; casting prefers models with gun clips; stills of each rig family | 2.5 days |
| 5. Projectiles | The pure plan (paths, fire times solved backwards, misses, ends) and the layer (projectile, trail, rings, flash, impact); tests | 1.5 days |
| 6. Sound | The slow-motion step (decode, varispeed, low-pass, splice) and the device one-shots (synthesized drop, whiz and swell; library shot, heartbeat and impacts); tests for lengths, continuity at the joins and determinism | 2 days |
| 7. The director | The prompt block, the director's shape and normaliser, `bulletProblems` (asked once, then dropped), assembler timing (window, arc shot, inserted steps, projectiles), the `plaza-ring-<side>` spots, an editor inspector line, critic and photographer notes | 1.5 days |
| 8. Checks and the test scene | The test fixture (section 7); stills strip; frames identical at 2 and 6 tabs and in reverse order; non-bullet scenes byte-identical; render timing; a list of the sound files for the user to audition | 1.5 days |

**Total:** about 13 days.

**Later, each on its own:**

| Item | Size |
|---|---|
| The bullet look | 0.5 day |
| A crowd switch for test specs | 2 hours |
| A Cairo square | 1 day plus re-baselining |
| A rooftop set | 3 days |
| Kit stages | 2 days |
| A distortion pass | 1 day |
| Downloaded and retargeted clips | 2 days |

## 7. The test scene
A private test bed: one video that uses the whole factory around one bullet-time beat, so the user can judge every part at once and decide what to change next. It will not be posted. The characters, places, lines and staging are original.

**Premise:** "What if, once a day, the world stopped for one second, for everyone but you?" Format 9:16, 30 fps, about 38 s. Mood: tense, then upbeat.

| Beat | s | Where and when | What we see | Said |
|---|---|---|---|---|
| b1 | 0-3.2 | Cairo, 2026-11-14 16:10 (sun 9°) | EWS down the avenue, palms, traffic, the minaret; `crane_down` | Narrator (hook): "What if one second a day could last as long as you wanted?" |
| b2 | 3.2-7.8 | Cairo | Nadia, a courier (our character: yellow jacket, a parcel box), runs along the north sidewalk past the cars; FS `follow`, handheld | Narrator: "Nadia runs parcels across Cairo. She is never late." |
| b3 | 7.8-11.6 | Cairo, then the flight | WS `pull_out`; the flight to Paris leaves from this shot | Narrator: "Today's parcel is due in Paris before dark." |
| b4 | 11.6-16.4 | Paris plaza, 16:50 (sun 2.5°: some windows lighting) | The flight lands; Nadia walks into the market's clear ring; Karim (our character: a man in a grey hoodie) waits by the stalls; WS `push_in` | Karim: "That parcel stays with me." |
| b5 | 16.4-20.0 | Paris | `gravity-off`: the market's crates and litter drift up; low WS `crane_up`; Karim raises a pistol (`aim`) | Nadia: "Then come and take it." |
| b6 | 20.0-24.2 (linger, silent) | Paris | **Bullet time:** three shots, a ramp to a crawl, crates hanging mid-air, bullets with trails and rings, Nadia leaning back, a fast 180° arc, the sound sinking with a heartbeat | — |
| b7 | 24.2-28.4 | Paris | The ramp-out: the bullets strike the paving (dust, chips); `gravity-on`: everything falls; Karim flinches and falls; MS `pull_out`, handheld | Narrator: "One second. All hers." |
| b8 | 28.4-33.0 | Paris, 17:00, lapse to `dusk` (17:48) | After a dip, Nadia hands the parcel to a flower seller (our character); MS `orbit_left`; the windows come on | Florist: "You're early." Nadia: "Always." |
| b9 | 33.0-38.0 | Paris | EWS `crane_up`, slow; the lamps come on by circuit | Narrator: "Delivered before dark." |

**Spec sketch** (abbreviated; the director writes beats and the assembler turns them into these seconds):

```jsonc
{
  "story": { "mood": "tense", "characters": [{ "name": "Nadia" }, { "name": "Karim" }, { "name": "Florist" }] },
  "scenes": [
    { "from": 0, "to": 11.6, "kit": "world", "world": { "place": "cairo", "date": "2026-11-14", "time": "16:10" },
      "actors": [{ "role": "bike courier, woman, 20s", "where": "sidewalk-north-west", "carry": "box",
                   "do": [{ "at": 3.4, "action": "run", "to": "sidewalk-north-east" }] }] },
    { "from": 11.6, "to": 28.4, "kit": "world", "flight": true, "world": { "place": "paris", "date": "2026-11-14", "time": "16:50" },
      "actors": [
        { "role": "Nadia", "where": "plaza-west", "carry": "box",
          "do": [{ "at": 12.0, "action": "walk", "to": "plaza-ring-north" }, { "at": 16.6, "action": "talk", "target": "Karim" },
                 { "at": 20.0, "action": "dodge" }, { "at": 25.0, "action": "run", "to": "plaza-north" }] },
        { "role": "Karim, man in a grey hoodie", "where": "plaza-east",
          "do": [{ "at": 12.0, "action": "look", "target": "Nadia" }, { "at": 17.2, "action": "aim", "target": "Nadia" },
                 { "at": 20.1, "action": "shoot", "target": "Nadia" }, { "at": 24.8, "action": "react" }, { "at": 25.6, "action": "fall" }] }],
      "bulletTime": { "from": 20.0, "to": 24.2, "rampIn": 0.45, "rampOut": 0.45, "rate": 0.005,
                      "hero": { "actor": "Nadia", "rate": 0.4, "dodge": "lean" }, "arc": { "sweep": 180, "dir": "left" },
                      "projectiles": [{ "kind": "bullet", "from": "Karim", "at": "Nadia", "pass": 0.3, "miss": "high" },
                                      { "kind": "bullet", "from": "Karim", "at": "Nadia", "pass": 0.5, "miss": "high-left" },
                                      { "kind": "bullet", "from": "Karim", "at": "Nadia", "pass": 0.7, "miss": "high-right" }] } },
    { "from": 28.4, "to": 38.0, "kit": "world", "world": { "place": "paris", "date": "2026-11-14", "time": "17:00", "lapse": { "to": "17:48" } },
      "actors": [{ "role": "Nadia", "where": "plaza-south", "do": [{ "at": 28.6, "action": "talk", "target": "Florist" }] },
                 { "role": "Florist, man, 60s", "where": "plaza-south", "do": [{ "at": 29.4, "action": "wave", "target": "Nadia" }] }] }
  ],
  "worldEvents": [{ "t": 16.7, "name": "gravity-off" }, { "t": 24.5, "name": "gravity-on" }],
  "shots": ["b1 avenue EWS crane_down", "b2 Nadia FS follow handheld", "b3 landmark WS pull_out", "b4 plaza WS push_in",
            "b5 plaza WS low crane_up", "b6 Nadia FS arc (by rule)", "b7 Karim MS pull_out handheld", "b8 Nadia MS orbit_left", "b9 scene EWS crane_up calm"]
}
```

The flight (about 8.0-14.6 s), the dip at 28.4 s, the beds, music cues, hits, voice files and captions are all filled in by the assembler and `resolveAudio` as for any video.

**Featured actors are off by default** (the user's decision of 2026-10-24, [decisions.md](decisions.md)).
- **In code:** GroundWorld's `crowd` prop defaults to false and WorldStage never passes it (Ground.tsx:252), so no background crowd ever shows in a video. Featured actors are drawn only when a scene lists `actors` (WorldStage passes them as the cast), and the prompt tells the director to add one only when the story names a person.
- **How the test turns them on:** it writes `actors` into its scenes.
- **The crowd stays off.** Frozen walkers would show the freeze well, but they need a new switch and the user's say (question 9).

**How the test runs, with no model API:** like run.test.ts:36-47, with `FACTORY_LLM_FIXTURES` pointing at hand-written writer, director and sound replies in `test-fixtures/pipeline/bullet-test/`.
- The real pipeline runs on them: the assembler, the voice (local kitten2 or voxcpm2), `resolveAudio`, the slow-motion step and the render.
- After editing in the editor, the video can be rendered again with `npm run generate -- --from-spec output/<id>/spec.json`.

**What it uses, and what exists:**
| Item | How the test uses it | Today |
|---|---|---|
| Real place, date and time | Cairo at 16:10 (sun 9°), Paris at 16:50 and 17:00 | exists |
| Flight | Cairo to Paris over the globe | exists |
| Traffic | Cairo avenue busy; Paris streets round the plaza, brought to a stop by the lift | exists; frozen in the window: **new** (phase 2) |
| Featured actors | walk, run, carry a box, look, talk, react, fall, wave | exists (on because the spec lists them) |
| Actor actions for the device | `aim`, `shoot`, `dodge` (lean), the pistol | **new** (phase 4) |
| World event or reaction | `gravity-off`, then `gravity-on`: the market's crates and litter float, then fall | exists; hanging frozen in the window: **new** (phase 2) |
| Bullet time | the clock, three projectiles with trails and rings, the dodge, the 180° arc, the slowed sound | **new** (phases 1-6) |
| The plaza's clear-ring spot | `plaza-ring-north` | **new** (phase 7, small) |
| Time-lapse | the last scene runs from 17:00 to dusk | exists |
| Transitions | the flight's own transition; a dip at the Paris cut (by rule, transitions.ts:46) | exists |
| Grade and look | per scene from the sun and the mood; the lapse's blend; the mood palette | exists; the optional bullet look: **new** |
| Ambience | the place's beds (low sun in Cairo); the lapse's bed crossfade | exists; slowed in the window: **new** (phase 6) |
| Music | tense, then upbeat from b8, ducked under speech | exists; slowed in the window: **new** |
| Stingers and hits | the hook pop, the world-event hits (`rise_short`, `impact_soft_bodies`), a sound-designer hit at b7, the whoosh at the cut | exists |
| Device sounds | time drop, gunshots, whiz, heartbeat, swell, impacts | **new** (library and synthesized) |
| Narration and dialogue | a narrator plus three character voices, local TTS | exists |
| Captions | every line, with the speakers | exists |
| Birds, flags, fountain water, tree sway | in both cities | exist; frozen in the window: **new** |
| Background crowd | — | off (the user's decision); needs a new switch |
| Counter, timer, hero prop | left out (they would crowd the frame) | exist |

## 8. Questions for the user
1. **Slow or freeze** in the hold? Recommended: slow (the world at 1/200, the bullets crawling about 0.6 m/s on screen), with `freeze` as the director's alternative.
2. **Guns:** a visible shooter with a pistol, shots from off screen only, or no firearms (thrown objects only)? Recommended: all three allowed; a procedural low-poly pistol; nobody is ever hit; no blood.
3. **The dodge:** a procedural lean-back, plus duck and roll from the clips on disk? Recommended: yes. Download and retarget UAL clips only if the lean reads poorly in stills.
4. **The sound:** varispeed the beds and music along the warp (recommended), crossfade to fixed slowed copies, or replace them with a drone? Should the music slow too? Recommended: yes.
5. **Scope:** world scenes only (recommended), or kit stages too (2 more days)?
6. **Places:** use the existing spots plus the plaza's clear ring now (recommended)? Later, if wanted: a square for Cairo (changes its layout, 1 day plus re-baselining) or a rooftop set (3 days, Cairo's flat roofs first).
7. **Limits:** one per video; a 2.5-6 s window; a hold of at least 1.5 s; not with a lapse in the same scene; inside one scene? Recommended: yes.
8. **After the window:** the world lags real time by the debt, and later steps are mapped so they still land on their beats (recommended). The alternative is a visible fast-forward to catch up.
9. **The crowd in the test:** keep it off, as decided (recommended), or add a test-only switch so frozen walkers show the freeze (2 hours)?
10. **Extras by rule:** a subtle grade shift during the hold (a little less saturation, a little more contrast) and the heartbeat under the hold? Recommended: both on, since both follow from the director's choice.

### The answers, taken as recommended (the user may change them)
The user had not answered when the device was built, so each question took the recommended default:
1. **The hold is slow** (the world at 1/200); `freeze` stops it dead when the director asks.
2. **Guns are allowed:** a visible shooter with a procedural pistol, shots from off the set, or a thrown ball. Nobody is ever hit (every projectile is kept 0.35 m from every body), and there is no blood.
3. **The dodge** is the procedural lean-back, plus the duck and the Quaternius `Roll` clip already on disk. Nothing was downloaded.
4. **The beds and the music slow** along the warp (varispeed and a low-pass in TypeScript).
5. **World scenes only.**
6. **Places:** the existing spots plus the plaza's clear ring (`plaza-ring-north/south/east/west`). No Cairo square and no rooftop set.
7. **Limits:** one per video, a 2.5-6 s window, a hold of at least 1.5 s, no lapse in the same scene, inside one scene.
8. **Afterwards the world lags** real time by the debt, and later steps and events are mapped onto their beats.
9. **The crowd stays off.**
10. **Extras by rule:** a subtle grade shift during the hold (saturation down 18 %, contrast up 8 %) and a low heartbeat under it.

## Status (as built 2026-11-04, updated 2026-11-05)
Option A is built and committed on `dev` (aa6d9fa to 7b3231e). A scene's `bulletTime` comes only from the director's choice; without one nothing below runs, and every frame is the same as before.

**What is where:**
- **The clocks** ([warp.ts](../../src/world/warp.ts)): `bulletClock` gives w(t), h(t) and the sound clock in closed form, their rates, inverses and the debt; `bulletWindow` makes the window from the director's beat (2.5-6 s, starting 0.5 s into its scene, 5 s when a flight lands in it); `bulletProblem` is the check; `bulletScripts` puts each actor's steps on its clock and turns a target that names another actor into its cast id; `warpSpecTimes` moves the world events and counter steps onto w for the place's reaction.
- **The spec** ([spec.schema.ts](../../src/generator/spec.schema.ts)): `scene.bulletTime` (`BulletTimeSchema`), checked by `validateSpec` (one per video, the window, the hold, no lapse, an `arc` shot only inside a window); actor steps `aim`, `shoot`, `dodge` with `how`.
- **The actors** ([script.ts](../../src/world/actors/script.ts), [rig.ts](../../src/world/actors/rig.ts), [rigs.ts](../../src/world/actors/rigs.ts), [cast.ts](../../src/world/actors/cast.ts)): `aim` holds a pistol at its target (the `Idle_Gun_Pointing` clip, or the right arm pointed); `shoot` plays `Gun_Shoot` (or a 0.12 s recoil) and returns to the aim; `dodge` leans back (hips 0.18 m forward and 0.22 m down on the leg IK, the spine 15, 20 and 20 degrees back, arms out, the head on the nearest projectile), ducks, or rolls (`Roll`, else a duck). The gun and roll clips are mapped only for a plan that uses them; a shooter is cast where a model has the clips; the pistol (three boxes) is built only for an actor that aims or shoots and shows only while it does.
- **The projectiles** ([projectiles.ts](../../src/world/projectiles.ts), [ProjectilesLayer.tsx](../../src/world/ProjectilesLayer.tsx)): the pure plan (paths, fire times solved backwards from the pass, ends on the city's walls or the ground) and the check (0.35 m from every body as posed at the pass, on its own clock). The layer draws the projectile, a tapered trail, ripple rings (thin tori), a muzzle flash (4 ms of world time, at least 0.1 s on screen) and an impact burst of chips and dust, each one instanced draw with fixed counts and bounding spheres.
- **The camera** ([solve.ts](../../src/generator/camera/solve.ts), [world.ts](../../src/generator/camera/world.ts)): the `arc` move (kept out of `SHOT_MOVES`, the director's list) as in 3.4; actor subjects on their own clocks; the arc shot drops the lanes' keep-out.
- **The world** ([WorldStage.tsx](../../src/compositions/WhatIfVideo/WorldStage.tsx), [Ground.tsx](../../src/world/Ground.tsx)): every consumer in section 2's table follows its clock. GroundWorld is the place's one reader of the frame ([clock.test.ts](../../src/world/clock.test.ts) fails on a layer that reads it itself): sway, clouds and water, birds, flags and the cast; WorldStage passes the reaction, the traffic and the weather on w. The traffic sees the lens through the clock's inverse, and the arc's lens path closes its lanes from 2 s of world time before the window (the actors' closure, `walkers`).
- **The grade** ([CinematicLook.tsx](../../src/compositions/look/CinematicLook.tsx)): `hold` (the hold's depth, passed only in a video with a bullet time) takes 18 % off the saturation and adds 8 % contrast, as uniforms (`HOLD_DESATURATE`, `HOLD_CONTRAST`, kept in warp.ts so the photographer reads the same numbers).
- **The photographer** ([photographer.ts](../../src/generator/qa/photographer.ts), [vision.ts](../../src/generator/qa/vision.ts)), risk 11: a shot whose middle is in a window is judged on a frame of the hold, its daytime colour floor comes down with the hold's grade (8 × (1 − 0.18 × depth)), and its check carries `notes`: the world stands still on purpose (things hanging in the air, people and traffic frozen, the hero slow, the trails), so whoever reads `qa.json` does not take it for a fault. In the hold, with projectiles, the vision model is also asked "Are thin bright streaks or trails visible in the air?" (want yes: risk 6, the bullets must read).
- **The sound** ([audio-warp.ts](../../src/generator/audio-warp.ts)), run at the end of `resolveAudio`: beds, music and the world's one-shots in the window are cut at its start and read along the sound clock (cubic varispeed, a low-pass from 18 kHz to 700 Hz with the rate, 4 dB down at the floor) into `public/whatif-audio/<id>/bt-*.wav`, named by a hash of what made them; the drop, the whiz and the reverse swell are synthesized in TypeScript, the shot (`shot-01`) and the impacts (Kenney metal) come from the library; the heartbeat (`heartbeat_bpm70`) lies under the hold at real time.
- **The director** ([director.ts](../../src/generator/pipeline/director.ts), [director-context.ts](../../src/world/director-context.ts)): the `bulletTime` answer, its normaliser, the teaching block, and `bulletProblems` (asked once with the real beat lengths). **The assembler** ([assemble.ts](../../src/generator/pipeline/assemble.ts)): the window, the hero's dodge and the shooter's aim and shot where the director left them out (the shot timed to the first fire), projectiles that would come near a body dropped, the window's arc shot ([shots.ts](../../src/generator/pipeline/shots.ts) `bulletShot`), no flight or flash in the window, the device's sounds, and `aim`, `shoot` and `dodge` taken out of every other scene. **The spots**: `plaza-ring-north/south/east/west` ([cityAnchors.ts](../../src/world/cityAnchors.ts)).

**Where it differs from the proposal:**
- The sound clock is the warp's curve with its own hold rate (0.45), not max(rate, 0.45): the pitch glides with no corner.
- The arc's lanes are closed by the traffic's actor closure (cars wait 3 m short of the lens path), not the 12 m low-lens closure.
- Rings are thin tori: a flat ring across the path vanished whenever the lens was beside it.
- A name as an actor's target resolves to that actor only in a bullet-time scene: elsewhere it still fails to plan as before (see below), so those scenes stay byte-identical.
- The impact draws its own chips and dust, not the reaction particles.

**How it was checked** (the scripts and pictures are in `out/agentBULLET/`, gitignored):
- **Tests:** `warp.test.ts` (the doc's example: 0.495 s of world in the window, a 4.005 s debt; C1, monotone, inverse), `projectiles.test.ts` (fire times backwards from the pass, a 0.3-1 m/s crawl, nobody within 0.35 m, ends on walls), `dodge.test.ts` (aim, shot, dodge; the lean on a rig: hips 0.22 m down and 0.18 m forward, ankles planted within 1 cm, pure per pose; the pistol only while aiming), `audio-warp.test.ts` (the source itself outside the window and continuous at the cut, 1000 Hz sinking to 450 Hz in the hold, deterministic files), `solve.test.ts` (the arc's 180 degrees, its low point, a blocker turning it), `clock.test.ts`, and the director, assembler, schema and spots tests.
- **Byte-identical without bullet time:** `ident-hash.mts`, PNG hashes of 261 frames (Paris by day, at dusk and at night, New York at dusk, Cairo at night, Colmar at sunset, each at three shots; a Paris scene with two actors walking and waving; the Paris video's frames 331-360 and 700-730) on a bundle of `8a6d0b5` (before the world integration) and one with it: 261 of 261 identical, and the same on a second run of the first.
- **In the window:** the same 30 hold frames (960-989 of `bt-plan-spec.json`) at concurrency 2, at 6 three times and in reverse 5-frame calls: 30 of 30 identical (`bthash-j*.txt`), after the draw-order fix below; before it 988 and 989 had two states each (`bthash-g*.txt`).
- **Pictures:** `sheet-warp.png` (every sixth frame through the window: the cut to the hero, the lean, the sweep round her, the crates hanging, the trails), `crop6.png` (the rings along the trails from the side and from below), stills of the dodge from behind and from the front.

**The test video, end to end (2026-11-05):** from the recorded replies, on the dev laptop (kitten2 voices), with `FACTORY_LLM_FIXTURES=test-fixtures/pipeline/bullet-test npm run generate -- "What if, once a day, the world stopped for one second, for everyone but you?" --format 9:16 --duration 38 --no-story-gate --quality draft` (then `final`). The videos (the final: 1080x1920, 60.7 MB), sheets (`sheet-seconds.png`, one frame a second; `sheet-window.png`, every fourth frame of the window), `sound.txt` and the photographer's `qa.json` are in `out/agentBULLET/test-video/{draft2,final}/`.
- **The replies had to change.** The story ran 42 s for a 38 s target, so the timeline cut the silent beat b6 to 1.6 s, and the window (2.5 s at least) ran on through the whole of b7 to the cut: no aftermath on screen, Karim's react and fall planned after his scene's end, "One second. All hers." inside the hold. The writer's lines are now short (seven of nine beats spoken, as the writer's check asks), so b6 keeps 3.6 s (window 23.07-26.67, hold 2.7 s) and b7 shows the fall. The director's actor times follow the plan's timeline; Nadia's Paris walk starts with the scene (from 0.4 s she was still walking when the window opened, her dodge began 0.5 s late and two of the three bullets were dropped for passing 0.02 and 0.30 m from her); b5 films Karim raising the pistol (the low plaza shot was blocked by the fountain's basin).
- **What reads:** Cairo's avenue and Nadia's run with the parcel; the flight; the hold: Nadia leaning back with her arms out, the 180-degree sweep round her, three trails with their rings, crates and litter hanging; Karim aiming, then reacting and falling in b7; the florist at dusk with the windows coming on. The photographer judged b6 on a hold frame (24.87 s) with its notes; it flags only b7 (Karim against a dark wall, 47 % of pixels near black).
- **What does not:** the hook (0-4.7 s) is an EWS high over Cairo in beige haze, almost empty; Karim's line in b4 is heard over the globe flight (the flight takes the whole of b4, one 4.8 s shot); the litter is still fluttering down in the next scene 3-4 s after gravity-on (the same without bullet time); Nadia wears the cast model's orange dress, not a yellow jacket.
- **Sound** (the final, measured, never played): -14.1 LUFS integrated, -1.3 dBTP true peak (the master's targets). The window: -15.1 LUFS in the 2 s before, -11.6 on the ramp in (the drop), -13.3 in the hold, -16.3 on the ramp out, -13.8 in the 2 s after (the strikes and gravity-on's hits). The slow-down's files (`public/whatif-audio/<id>/bt-*.wav`): the two beds 14.9 s long at the loudness of their sources (-25.7 and -32.0 LUFS), the music 6.5 s (-25.1), the drop 1.8 s (-12.9), three whizzes of 1.6 s (-15.1 to -15.8), the swell 1.6 s (-14.6), the shot 1.5 s (-26.4), peaks -2.6 to -8.6 dBTP. The voices sit 7-30 dB over the ducked music; the tense track the run picked (freepd-horror-alien-spaceship-atmosphere, chosen by the run id; draft 2 had alien-invasion) is quiet in its first seconds, so the music is barely there under the hook and b5-b7.
- **Its own hold frames** (740-769) at concurrency 2, 6 twice and in reverse 5-frame calls: 30 of 30 identical.

**Open points:**
- **Fixed (2026-11-05): the 2 flipping pixels.** They lay on the edge of a plank where it passes through a crate, both reaction pieces frozen in the hold (not on the trail). three.js draws opaque meshes by renderOrder, then material id, then depth, and the pieces' material ids follow the order their model files finished loading, which differs from one browser session to the next: frame 989 rendered alone in a fresh browser gave either state (2 and 2 of 4 calls), so it was never the tabs' history. `rigidDrawOrder` ([rigid.ts](../../src/world/react/rigid.ts)) gives every opaque reaction mesh its own renderOrder in [1, 2), in build order, after the rest of the opaque scene; a transparent part keeps 0 and the set shares one fixed bounding sphere (its rest bounds). After it: 989 alone in 6 fresh browsers and 988 in 4, one state each. Without bullet time the lift frames 780-800 and 960-989 of `bt-plan-spec-plain.json` are unchanged (51 of 51).
- Not built: the critic's note about the window (risk 11; the edit is ready for the critic's owner: on the bullet-time beat's line in `critiquePlan`, say the world slows almost to a stop on purpose and frozen people and things in the air are intended) and an editor inspector line; the traffic still simulates the scene's whole span, not the 4 s less the world covers; kit stages.
- A target that names another actor ("talk to Karim") fails to plan outside a bullet-time scene, and that actor is left out (camera/world.ts worldCast passes the name through): the prompt asks for spots, so it is rare; fixing it everywhere changes those scenes' renders, so it waits for the user.
- Fixed on the way: an actor step's numeric `at` was read as its target, so the script failed to plan and the actor vanished (director.ts normalizeDirector); a world scene's shots may now film its actors (`actorN`, `person`), which the camera offered but the shot planner refused.
