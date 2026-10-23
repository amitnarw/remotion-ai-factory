# 08 — Phase 3 research: camera, transitions, layout, vision QA, look (2026-10-23)

Phase 3 makes the pictures cinematic: a camera that frames what the narration is about, transitions, a graded look, captions and HUD that fit each format, and a "photographer" that checks the stills.

These notes come from four parallel web-research passes before any Phase 3 code was written. The findings are third-party claims checked against their sources on 2026-10-23, not tested here unless a line says so.

The world engine ([06-world-engine.md](06-world-engine.md)) is being built in parallel by another chat in `src/world/`. Phase 3 pieces are built as libraries (pure functions plus thin components) so the world scenes can use them too.

## 1. Camera: `CinematicCamera`

**Finding.** Nothing usable exists as-is for a deterministic, per-frame, LLM-directed camera in three.js. A camera rig built on a clock (drei `CameraShake` and `Bounds`, maath `damp`, camera-controls transitions) depends on the render history. Remotion renders frames out of order, so these must not drive the render. Theatre.js's R3F binding targets fiber 8 and its studio is AGPL.

**What the research found**
- **LLM film agents** (FilmAgent 2025, MovieAgent, LAMP / CVPR 2026, CinemaTraj): the model picks from a short list of named shots and moves, and code places the camera. LAMP showed that enum moves converted to paths by code beat having the model write camera poses.
- **Classic rules** (He, Cohen & Salesin 1996, "Virtual Cinematographer"): establish first, don't cross the line of action, and make each cut change size, angle or subject count (no jump cuts).
- **Cinemachine ideas, borrowed, not code:** the composer (screen position, dead zones), group framing (frame by screen fraction; dolly vs zoom), and the deoccluder (pull forward, preserve height).
- **Two-subject shots:** Lino & Christie's "toric space" gives a closed-form camera position for two subjects at chosen screen spots.
- **Closed-form maths:**
  - Distance from the subject's size, the target screen fill and the field of view (fit by both width and height, take the larger).
  - The horizon height on screen depends only on pitch: put it on a third.
  - Camera height and yaw place the subject on the thirds.
  - A dolly zoom keeps the subject's size while changing the field of view.
  - three.js applies its 35 mm film gauge to the long axis, so in 9:16 the horizontal field of view is narrow.
- **Deterministic motion:**
  - Eased interpolation (easeInOutCubic; easeOutCubic for push-ins and reveals).
  - Closed-form critically damped springs (orangeduck "spring roll call").
  - Follow shots sample the subject's own path with a fixed lag.
  - Handheld shake is seeded noise (`@remotion/noise`) applied to rotation only.

| Adopt | Borrow | Build |
|---|---|---|
| `@remotion/noise`, Remotion `interpolate` / `Easing`, three `Raycaster`, `setViewOffset` | camera-controls' fit maths (MIT), Cinemachine composer, framing and deoccluder ideas, toric two-shot, LAMP-style enum moves, closed-form spring | `solveShot(shot, subject, aspect, t)`: a pure function; anchors per stage; occlusion cascade; jump-cut guard |

**The shot the director writes per beat** (small, all enums):
`{ subject, size: ECU|CU|MS|FS|WS|EWS, angle: eye|low|high|overhead|dutch, side: front|left34|right34|left|right|back|auto, move: static|push_in|pull_out|truck_left|truck_right|crane_up|crane_down|orbit_left|orbit_right|follow|dolly_zoom, place: center|left_third|right_third|auto, energy: calm|normal|bold, style: locked|smooth|handheld }`

**Defaults per shot size.** r is the subject's bounding radius; the lens uses three's 35 mm gauge.

| Size | Fill of frame height | Lens 16:9 / 9:16 (mm) | Move per shot | Shake (% of vertical FOV) |
|---|---|---|---|---|
| ECU | 1.1 (top 15% of the subject) | 85 / 85 | push 5% | 0.4 |
| CU | 0.9 (top 30%) | 50 / 50 | push 8%, orbit 10° | 0.6 |
| MS | 0.9 (top 55%) | 35 / 35 | 10%, orbit 15° | 0.8 |
| FS | 0.75 | 28 / 28 | 12%, orbit 20° | 0.8 |
| WS | 0.35 | 24 / 24 | 15%, orbit 25° | 0.6 |
| EWS | 0.12 | 18 / 24 | 20%, crane | 0.3 |

Energy scales the move (calm ×0.6, bold ×1.6). Style scales the shake (locked 0, handheld ×2).

**Pacing of modern AI video:**
- Kling 3.0 cuts up to 6 shots in 15 s (about 2.5 s each); Veo 3.1 clips are 4, 6 or 8 s.
- Nearly every shot has one slow, continuous move: push-in, orbit or arc, tracking, crane reveal, drone establishing.
- Defaults: 2–3.5 s per shot, a hook shot of 1.5 s or less, establishing shots up to 4 s.
- Change scene every 3–5 s, with a move or punch-in every 1.5–2.5 s inside a scene.

## 2. Transitions
- **`@remotion/transitions` 4.0.536** exists, licensed under the Remotion License like the rest of Remotion.
  - CSS presentations: fade, slide, wipe, flip, clockWipe, iris, none, pushCut (a punch-in with a hard cut and a 2-frame flash).
  - Shader presentations (zoomBlur, blurSlide, linearBlur, crossZoom, filmBurn and more) use the experimental HTML-in-canvas API. It is untested with a nested ThreeCanvas.
  - `TransitionSeries` overlaps the two scenes and shortens the total by the overlap. `TransitionSeries.Overlay` draws over a cut without shortening (for flashes and light leaks).
  - `@remotion/light-leaks` is deprecated in favour of `lightLeak()` in `@remotion/effects`.
- **`@remotion/motion-blur`** mounts 8–10 copies of the scene, which means 8–10 WebGL contexts. Chrome drops contexts beyond about 16. Never wrap a ThreeCanvas in it.
- **Overlapping transitions** mount two ThreeCanvases: double the GPU cost on those frames, plus a shader-compile hitch on the incoming scene's first frame.
- **Worth building for 3D:**
  - Whip pan as a real camera move: the outgoing camera turns 60–90° in 4–6 frames, cut at peak speed, and the incoming camera finishes the turn. Add a blur scaled to speed.
  - Punch-in, 6–10 frames.
  - Flash, 2–4 frames.
  - Dip to black or white, 10–16 frames.
  - Light leak, 20–30 frames.
  - Match cut (free with one continuous world).
- **Decision:** keep one ThreeCanvas and do cut, dip, flash, punch-in and whip as camera moves plus HTML overlays. No second WebGL scene is needed. Dissolves, which need both scenes, are deferred until a second-canvas test.

## 3. Captions, hook and HUD per format (built: `src/generator/layout.ts`)

**Safe areas** (from the platforms' published ad safe zones; pixel values at 1080×1920):
- YouTube Shorts: top 288, bottom 672, right 192 px.
- TikTok: top 240, bottom 660, sides 120 px, with a 180 px rail from y 840.
- Reels: 14% top, 35% bottom, 6% sides.

Safe box used for 9:16: x 0.111–0.822, y 0.15–0.65.

**Captions:**
- Size: 9:16 at 7.5% of the width (~81 px), 1:1 at 6%, 16:9 at ~3%.
- Weight 800–900 with a dark outline and a soft shadow.
- At most 2 lines. On 9:16, "bottom" sits at 58% of the height, not 88%.

**HUD cards** at most ~0.42 W (9:16), ~0.30 W (1:1), ~0.22 W (16:9). The timer card's value is at least 6.5% of the width on 9:16.

**Hook:**
- Fitted to at most 3 lines inside the safe width, between whole words (real spaces between the word spans; the old margin-only spans broke words anywhere, which was the "hook overflows" bug).
- Centred at 42% on 9:16.

Checked with stills in all three formats.

## 4. Photographer (vision QA)

**Ollama facts** (from Ollama's docs on 2026-10-23; not tried here, since there's no key on this laptop):
- **Images** go as base64 in `messages[].images`.
- **Structured output:** `format` with a JSON schema works locally, but Ollama's docs say the cloud does not support structured outputs. Put the schema in the prompt and validate the reply.
- **Cloud vision models:** the cloud list includes `gemma4:31b` (Apache-2.0). `qwen3-vl` (best at returning boxes) is now local-only.
- **A `/v1/systemone` decision API** with `clef:cloud` returns P(yes) for up to 64 yes/no questions per image. It is new; verify it on the user's machine before relying on it.

**How to judge reliably:**
- Ask yes/no checklists, not 1–10 scores.
- Never show the judge the plan or the narration. In a 2026 study, a judge that saw the plan accepted 78–90% of failing clips.
- Ask neutral and negative questions ("Is any sea water visible?").
- Use temperature 0.
- Compare the old and new still pairwise after a re-plan.

**Code, not the model, checks:**
- Subject coverage and position (projected bounding box).
- Occlusion (raycasts to sample points).
- Exposure (mean luma, % crushed, % clipped).
- Horizon height and roll.
- Caption safe-area overlap.
- Scene-state assertions (water gone, lights off).

Off-the-shelf aesthetic predictors are trained on photos (LAION, NIMA) or are non-commercial (pyiqa), so skip them as gates.

**Loop:**
1. Code gates, with up to 2 automatic fixes (move closer, more light, hide the blocking prop).
2. VLM yes/no questions.
3. At most one director re-plan.
4. A pairwise pick between the old and new still.

Flag the shot rather than block the final render. Calibrate the thresholds on 50–100 labelled stills before trusting them.

## 5. Look (post-processing)

**Versions (checked against npm and the source):**
- `@react-three/postprocessing` **3.0.4** is the last version that accepts fiber ^9.0. 3.0.5 and later need fiber ≥9.7.
- Pin `postprocessing` **6.39.5** (zlib licence; peer three ≥0.168 <0.187). n8ao 1.10.3 comes with it.

**Remotion pitfalls:**
- The composer attaches its passes after ThreeCanvas's first `advance()`, so the first frame after mount, and every still, renders **black**. The fix is a `RenderAfterMount` step: delayRender → requestAnimationFrame → advance() → continueRender.
- Render with `--gl=angle`.
- `wrapEffect` rebuilds an effect when a prop changes. Keep props static and drive uniforms through refs.
- The composer turns off three's tone mapping. Add `ToneMapping` (ACES / AgX / Neutral) near the end; backgrounds get tone-mapped too.

**Determinism:** the built-in Noise effect accumulates wall-clock time, so it isn't deterministic. Grain is custom, seeded by the frame number, with an integer hash. Also avoid:
- adaptive tone mapping and TAA;
- N8AO `accumulate` and accumulative shadows;
- drei's clock-driven helpers: Float, Sparkles, Stars, Cloud, Wobble/Distort.

**Effects:**

| Effect | Notes |
|---|---|
| Tone mapping | Nearly free. |
| Bloom (mipmapBlur, threshold ~0.8) | Cheap. |
| LUT | Cheap. Generate our own `.cube` files: no LUT pack with a clean licence was found. |
| Vignette, chromatic aberration | Nearly free (merged pass). |
| N8AO | Medium cost; leaks on an iGPU. Deferred. |
| Depth of field | The most expensive. Deferred; TiltShift2 is the cheap stand-in. |
| SMAA | Use with AO; MSAA without. |

**Borrowed structure:** Bruno Simon's folio-2025 (MIT) DayCycles. Mood presets are plain objects of light, fog and colour values, blended at keyframes; mood comes from lighting and fog as much as from post.

**Presets** (EV = exposure stops; split-tone shadow / highlight):

| Preset | Tone map | EV | Sat | Contrast | Split-tone | Bloom thr / int | Vignette |
|---|---|---|---|---|---|---|---|
| golden-hour | ACES | +0.2 | 1.10 | 1.08 | #4a3b6b / #ffb36b | 0.85 / 0.6 | 0.30 / 0.45 |
| night-moonlight | AgX | −0.6 | 0.75 | 1.12 | #0e1d3a / #9fc3ff | 0.70 / 0.9 | 0.25 / 0.65 |
| overcast-documentary | Neutral | 0 | 0.88 | 0.95 | #2e3a3a / #e8efe8 | 1.00 / 0.15 | 0.40 / 0.25 |
| epic-teal-orange | ACES | +0.1 | 1.15 | 1.18 | #0f5e6e / #ff9a4a | 0.80 / 0.8 | 0.25 / 0.55 |
| dreamy-pastel | Neutral | +0.35 | 0.90 | 0.85 | #b9a3e3 / #ffd6e8 | 0.60 / 1.0 | 0.45 / 0.20 |

**Chain:** Bloom → ToneMapping → SMAA → Grade (white balance, contrast, saturation, split-tone, seeded grain) → Vignette.
**Fallback:** if the composer misbehaves, export the grade as a `.cube` LUT and apply it with ffmpeg's `lut3d`.

## Build order (Phase 3)
1. ✅ **Layout per format:** captions, hook, timer and counter cards (`src/generator/layout.ts`).
2. **Camera solver.**
   - ✅ Pure `src/generator/camera/{shot,solve,subjects}.ts`. Tested by projecting the subject through a real three.js camera for every size, frame shape and placement.
   - ✅ `src/compositions/camera/ShotCamera.tsx`.
   - Subject anchors in each stage: in progress.
3. ✅ **Shots in the plan.**
   - The director's shot per beat, with messy wording accepted.
   - Film-rule shots wherever the director gives none (`pipeline/shots.ts`).
   - The assembler's timing, a second shot for beats over 5 s, and the jump-cut guard.
   - Fixtures with directed shots: oceans-vanish.
4. ✅ **Transitions:** dip to black or white, flash, and whip (a camera turn through the cut plus blur). Planned by rules in `pipeline/transitions.ts`, drawn by `TransitionOverlay.tsx`.
5. **Look:** being built in `src/compositions/look/`.
6. ✅ **Photographer, first version** (`src/generator/qa/{png,metrics,photographer,vision}.ts`, `scripts/photographer.ts`).
   - One still per shot, judged by code: exposure (day, night and space limits), flat frame, washed-out colour.
   - Yes/no vision questions when a Photographer model is chosen. Tested with fixtures only; there's no key here.
7. **Stage fixes:**
   - ✅ Rain. The real cause was `setXYZ` given an array offset instead of a vertex index, so every streak ended at the world origin. Rain is now shader-driven and follows the camera.
   - Night exposure floor: the photographer flags the night ocean at mean luma 0.09.
   - Lens clearance.
