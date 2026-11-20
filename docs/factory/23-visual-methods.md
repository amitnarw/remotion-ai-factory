# Three Separate Video Methods — v3.1

**v3.1** bakes in your answers: default method `factory`; length chosen by you in the wizard; the 3 image-generator styles skipped; one method per video, never all three; voice / music / SFX / subtitles always come from the repo.

---

## 1. The rule

Every video is made by **exactly one method**, chosen in the wizard at creation time.

| # | Method | Look | Status |
|---|---|---|---|
| **A** | `factory` | today's Remotion stage kits | **default**, unchanged |
| **B** | `animation` | hand-coded 3D film (WebGL) | new, isolated |
| **C** | `lemo` | 99 library styles, auto-chosen per segment | new, isolated |

- No video is ever made by two methods.
- No method borrows another's picture, palette, type, assets or code.
- The 99 styles exist **only** in method C.

---

## 2. Always reused from the repo (all three methods)

Your voice, background music, SFX, subtitles, loudness mastering and beat timings already work. Every method consumes them; none reinvents them.

| Thing | Source | Used by |
|---|---|---|
| Voice | existing TTS stage | A, B, C |
| Background music | existing audio library | A, B, C |
| SFX | existing library | A, B, C |
| Subtitle captions (text, timing, style) | existing caption system | A, B, C |
| Loudness master | existing `audio-master.ts` | A, B, C |
| Beat / cue timings | existing timeline | A, B, C |
| Length, format, fps | the wizard | A, B, C |

**What each method owns alone:** its renderer, its scene code, its decorative typography, its palette, its grain, its transitions, its style system (only C has one).

**Subtitles rule:** the burned-in captions are the repo's caption system in all three methods — same style, same timing, by design, so a channel looks consistent whichever method made the video. A method may add its own *decorative* type (a big title, a graphic word) on top, but it never replaces the subtitles.

---

## 3. Length is the user's choice

The wizard's **Format & length** step already has a length field (`video.targetDuration`, with presets plus a custom value). Nothing new is needed there except reading it in the new methods.

Consequences for lemo:

- `K` (max styles in one lemo video) is **derived** from whatever length you pick, not hardcoded:
  `K = clamp(1, ceil(durationSeconds / 3), 8)` → 10 s → 4, 15 s → 5, 30 s+ → 8.
- Segment minimum stays 1.2 s.
- A 60 s lemo video can use up to 8 media; a 10 s short gets 4. That's the only place length affects the look.

---

## 4. Method A — `factory` (default, unchanged)

Nothing changes. Same kits, same stages, same captions, same render. The only addition is the `method: "factory"` field so the pipeline knows which branch to run.

**Acceptance:** re-render an existing run — pixels, frames, duration, loudness all identical to the recorded baseline (SSIM ≥ 0.995).

---

## 5. Method B — `animation` (isolated)

A hand-coded 3D film: real camera, real perspective, painted textures — the ocean/beach/boat prototype, inside the repo.

- Own renderer: Playwright + installed Chrome + ffmpeg, deterministic frame stepping.
- Own scenes and primitives (clean-room; the source skill has no licence).
- Own decorative type.
- Uses the repo's voice, music, SFX and subtitles.
- **No styles.** One look, made well.

**Acceptance:** 10 s @ 1080×1920 = 240 frames exactly, silent video, repo audio muxed, `npm run verify` green.

---

## 6. Method C — `lemo` (isolated, 99 styles)

### 6.1 What lemo is

99 film styles in 15 categories — watercolour, risograph, ink wash, Swiss graphic, maps, charts, globes, comics, newsreel… Each is a text description of how a film should look, plus a demo. **It is not a renderer:** it says *how* to draw, the drawing is still code.

### 6.2 What we build

1. **99 packs** — each style turned into machine-readable data: palette, texture, type treatment, motion, the medium it suits, what breaks it, 9:16 fitness, whether it needs an image generator.
2. **12 medium renderers** — map, chart, diagram, type-only, document, painting, print, sketch, 3D object, globe/orbital, light/abstract, film stock. A style is a *treatment* of a medium, so 99 styles need 12 renderers, not 99.
3. **A lemo-only style guide** — one palette, one type, one grain, one tempo, held across the styles used **within a single lemo video**, so a multi-style lemo video still reads as one film. It applies to lemo only and never leaks into A or B.
4. **A router** — decides per beat which medium and which style.

### 6.3 The router (lemo only)

1. Split the story into beats (times already come from the voice).
2. Classify each beat's **medium** — map, chart, globe, diagram, quote…
3. Keep only packs that do that medium, survive 9:16, need no image generator, and aren't marked broken.
4. Score on subject fit, contrast with the previous segment, cost. Deterministic tie-break.
5. Apply hard rules: ≤ `K` styles, ≥ 1.2 s per segment, changes only on beats, first and last segment use the guide's default style, every change has a written reason.
6. A critic pass may veto a choice and pick the next best from the same list. It cannot invent styles or change timing.

### 6.4 The 3 styles that need an image generator — skipped

**Manga Panels**, **Text Flash Cuts**, **Comic History Cartoon** draw characters using an AI image model. You said skip them, everything offline.

- They are ingested and marked `status: "unsupported"` with the reason.
- The router never selects them.
- The UI shows 96 usable styles, and says why the other 3 are unavailable.
- No image-provider dependency, no cost, no network call.
- If an image model is ever added (we already pay for AI models), flipping those three on is a config change, not a rewrite.

### 6.5 Fidelity, honestly

| Level | Meaning |
|---|---|
| `f0` | palette + grain + type on a generic drawing of the medium — usable, shallow |
| `f1` | real medium renderer + the style's texture, inks, motion — close |
| `f2` | bespoke recipe for that one style — could pass as the original |

Day one: all 96 usable styles at `f0`. Promotion to `f1`/`f2` happens in batches, driven by actual use. A style that can't work is marked `unsupported` rather than rendering a bad frame.

**Acceptance:** 96 packs validate and route; one lemo video with ≥ 3 media renders end to end and reads as one film.

---

## 7. Pipeline

```
premise ─► script ─► voice + music + SFX ─► audio.wav  (repo, shared)
                            │
                    beats + cue map + subtitles  (repo, shared)
                            │
                  method chosen in the wizard
                            │
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                 ▼
       method A          method B          method C
       factory           animation          lemo
          └─────────────────┼─────────────────┘
                            ▼
              silent video, exact frames (own captions)
                            ▼
                  mux repo audio → final MP4
```

One video, one branch. The branches meet only at the final mux.

---

## 8. Wizard change (one control)

On the **Format & length** step (`ui/src/pages/create/SetupSteps.tsx`), add:

- **Method** — a segmented control: `Factory (default)` · `Animation` · `Lemo`.
- When `Lemo` is selected, a second control appears: **Style: Auto** (router chooses) or **Force: <style name>** (you pick one).
- Length stays exactly as it is today (`video.targetDuration`).

Everything else in the wizard is untouched. The choice is stored on the run and read by `generate.ts` (`--method`, `--lemo-style`).

---

## 9. Repo layout

```
src/methods/
  factory/     # method A — thin wrapper over today's pipeline; otherwise untouched
  animation/   # method B — own renderer, scenes, captions
  lemo/        # method C — packs, 12 media renderers, router, style guide
src/shared/
  spec.ts      # types shared by all three
  timing.ts    # beats → seconds/frames
  audio.ts     # render + master the repo audio once
  subtitles.ts # the repo's caption system, used by all three
  mux.ts       # silent video + audio → mp4
  probe.ts     # ffprobe / SSIM helpers
```

---

## 10. Phases

| # | Phase | Days |
|---|---|---|
| 0 | Baseline + docs (`docs/factory/23-visual-methods.md`) | 0.5 |
| 1 | `method` field, registry, factory passthrough | 0.5 |
| 2 | Wizard: method + lemo style controls | 0.5 |
| 3 | Method B: renderer, scenes, captions | 3 |
| 4 | Method C: ingest 96 usable packs + audit | 2.5 |
| 5 | Method C: 12 medium renderers + style guide | 2.5 |
| 6 | Method C: router + critic | 3 |
| 7 | Method C: render path + multi-style showcase film | 1.5 |
| 8 | Options CLI, comparison tool, verification | 1 |

**Total ≈ 15 days.** Phases 3 and 4–7 are independent and can run in either order.

---

## 11. Verification

### 11.1 Isolation (proves "do not mix")

- [ ] `src/methods/factory/**` imports nothing from `animation/**` or `lemo/**` — import-graph test fails the build on violation.
- [ ] `animation/**` imports nothing from factory or lemo.
- [ ] `lemo/**` imports nothing from factory or animation, except types in `src/shared/**`.
- [ ] `src/shared/**` contains no palettes, no type, no renderers, no styles — only spec, timing, audio, subtitles, mux, probe.
- [ ] At runtime, a lemo run has zero factory stage components loaded; a factory run has zero lemo packs loaded.

### 11.2 Per method

- [ ] **A:** baseline run re-renders identically (frames/duration/loudness, SSIM ≥ 0.995).
- [ ] **B:** 240 frames for 10 s @ 24 fps, silent video, repo audio muxed, `verify` green.
- [ ] **C:** multi-media film renders, exact frames, one audio stream, `verify` green.
- [ ] All three: audio duration = video duration ± 1 frame; loudness within ±1 LU.

### 11.3 Shared assets, actually shared

- [ ] Same run time, three methods: identical audio waveform (compare RMS per second) and identical subtitle text/timing.
- [ ] Subtitles render in all three with the repo's caption style.
- [ ] Voice/music/SFX are not regenerated by B or C — they consume the existing track.

### 11.4 Lemo internals

- [ ] 96 packs validate; 3 marked `unsupported` with the reason "needs image generator".
- [ ] Router deterministic; `K` derived from the chosen length and never exceeded; no segment < 1.2 s; no `unsupported` or `needsImageGen` style ever selected.
- [ ] Every style change has a written reason and sits on a beat boundary.
- [ ] Compilation test: 5 reviewers, ≥ 4 say "this is one film" for a 3-media lemo video.

### 11.5 Wizard

- [ ] Method control persists into the run and is honoured by `generate.ts`.
- [ ] Choosing Lemo shows the style control; Factory and Animation don't.
- [ ] Length control still works exactly as before for all three.

---

## 12. Legal

- **lemo styles:** commercial and client films are explicitly permitted; no credit needed for the film. **Not permitted:** redistributing or selling the style docs. Never expose pack text in a UI, API, export or error message.
- Source clone lives outside the repo (`Desktop\lemo-src`); only our adapted packs are committed.
- If the factory is ever open-sourced, packs go behind a removable build flag.
- **animation skill:** no licence stated → clean-room reimplementation only.

---

## 13. Pitfalls

- Never let one method import another's code — the import test exists for this.
- Keep style logic inside `src/methods/lemo/`; `src/shared/` is plumbing only.
- `ffmpeg -pattern_type glob` doesn't work on Windows → contiguous `%d`.
- Raw AAC needs `-f mp4`.
- A 16:9 vignette at 9:16 shows a ring → disable or make it aspect-aware.
- Bundled Chromium has no GPU → `playwright-core` + `channel: "chrome"` + `--use-angle=d3d11`.
- Flat/toon materials band on big planes → standard material + painted texture.
- Screen-space sky gradients flip to night-blue when the camera tilts → sky sphere.
- Tiny detail at 9:16 reads as dirt → delete or scale up.

---

## 14. Open items

1. **Animation method (B):** ship it as a user-selectable option, or keep it internal until it beats lemo in a test? *(default: selectable, since you asked for three options)*
2. **Lemo style control:** default to `Auto`, or always let the user force a style? *(default: Auto, with force available)*
3. **Lemo default style** (used for the first and last segment): pick one house style now, or let the router decide from the story? *(default: router decides)*

---

## 15. Execution log (measured, not planned)

Everything here was observed on this machine. A number not in this table does not exist.

### 15.1 Environment

| Item | Value |
|---|---|
| Branch | `dev` |
| Commit at start | `658df74 issue fix or video generation error` |
| Platform | Windows (win32), Node 22 |

### 15.2 Baseline tests (Phase 0)

`npm test` → **985 tests, 983 pass, 1 fail, 1 skipped**, 62 s.

The one failure is **pre-existing and unrelated** to the visual-methods work:

```
not ok 244 - one entry per world catalog model; the cast catalog's id and tags fold into it by file
  src/generator/library/registry.test.ts:84
  Expected values to be strictly equal: 43 !== 40
```

Three catalog models were added without updating the expected count. Left as-is (not our change, and fixing it by guessing the intended number would hide a real drift). `npx tsc --noEmit` is clean.

`npm run lint` also **already fails** on the branch, in files this work does not touch:

```
[icons] 4 emoji/symbol glyph(s) found in ui/src
  ui/src/api.ts:906            [—]
  ui/src/components/MemoryMeter.tsx:38,69   [–]
  ui/src/pages/create/PlanStep.tsx:732      [—]
```

`eslint` and `tsc` both pass; only the icon gate (`scripts/check-ui-icons.mjs`) fails, on four em/en dashes used as UI text in three untouched files. Recorded rather than "fixed" silently — replacing a dash with a lucide icon is a visual decision, not a lint cleanup.

### 15.3 Baseline video (Phase 0)

An existing rendered run, re-verified rather than re-rendered (same spec, same pipeline path the factory method calls):

| Field | Value |
|---|---|
| Run | `documentary-about-phones-and-how-they-evolved-d9711d` |
| File | `output/…/video.mp4` (7.7 MB) |
| Picture | 1080×1920, h264 High, 30 fps |
| Frames | **900** (30.00 s) |
| Audio | AAC LC, 48 kHz, stereo |
| `npm run verify` | **PASS — continuous audio energy** |

Full-length numbers (render wall clock, loudness LUFS) are recorded the first time
method A is re-rendered end to end in Phase 1 acceptance.

### 15.4 Phase log

| Phase | State | Evidence |
|---|---|---|
| 0 — baseline + docs | **done** | this section; baseline video above |
| 1 — method seam, zero behaviour change | **done** | `src/methods/**`, `npm run method:list`, 9 new tests green, tsc clean |
| 2 — wizard controls | **done** | Method cards on the Format step; `method`/`lemoStyle*` in the payload; tsc clean |
| 3 — animation method | **in progress** | renderer + `sea` stage built; stills + a 3 s clip render; art gate open (see 15.7) |
| 4 — lemo packs | not started | — |
| 5 — lemo media + house look | not started | — |
| 6 — lemo router | not started | — |
| 7 — lemo render + showcase | not started | — |
| 8 — options, comparison, verification | not started | — |

### 15.5 What Phase 1 actually did

- `src/generator/spec.schema.ts`: added `METHODS`, `MethodId`, `LEMO_STYLE_MODES`,
  `LemoStyleMode`, and three **optional** settings fields — `method`,
  `lemoStyleMode`, `lemoStyle`. Absent `method` means `factory`, so no existing
  spec changes shape (verified: `npm test` and `tsc` unchanged after the addition).
  A `superRefine` rejects `lemoStyleMode: "forced"` with no `lemoStyle`.
- `src/methods/types.ts` — `MethodContext`, `MethodResult`, `MethodImpl`.
- `src/methods/factory/index.ts` — thin adapter over the unchanged `renderChunked`.
- `src/methods/animation/index.ts`, `src/methods/lemo/index.ts` — honest
  `available: false` stubs with a readable "not built yet, see Phase N" error.
- `src/methods/index.ts` — registry + `resolveMethod`, `methodIdOf`, `listMethods`.
- `src/methods/index.test.ts` (7 tests) and `src/methods/isolation.test.ts`
  (the build-time "do not mix" check).
- `src/generator/generate.ts`: the render step now asks `resolveMethod(spec)` for
  the picture and refuses an unavailable method with a readable error. The
  chunked path calls `method.render(...)`, which for `factory` is the same
  `renderChunked` call with the same arguments; the non-chunked factory path
  (Remotion CLI) still runs exactly as before.
- `scripts/methods-list.ts` + `npm run method:list`.
- `npx tsc --noEmit` clean; the 8 new tests pass.

### 15.6 What Phase 2 actually did

- `src/methods/types.ts` now holds `METHOD_INFO` — one pure catalogue (label,
  summary, `available`, `note`) that the server, the CLI and the UI all read.
  Each implementation takes `available`/`summary` from it, and a test fails if
  they drift.
- `ui/src/pages/create/wizard.ts`: `VideoSettingsForm` gains `method`,
  `lemoStyleMode`, `lemoStyle` (defaults `factory` / `auto` / blank, so saved
  older settings load unchanged). `videoSettingsToPayload` sends `method` and,
  for lemo, the style choice. A saved value for a method that is not available
  is reset to `factory` on load, so an unbuildable choice can never be created.
- `ui/src/pages/create/SetupSteps.tsx`: the Format step gains **How it's made** —
  one card per method, built from `METHOD_INFO`. Factory is selectable now;
  Animation and Lemo render disabled with their "coming soon" note. When Lemo
  becomes available the Auto / One style chips and the style-id field appear
  with no further UI work.
- `src/generator/generate.ts`: `--method`, `--lemo-style`, `--lemo-auto` flags,
  documented in the usage header. `--settings-json` already carries the field
  from the server, so the wizard path works without new CLI plumbing.
- `npx tsc --noEmit` clean; `eslint` clean on every touched file.

Final full-suite run after Phases 0–2: **994 tests, 992 pass, 1 fail, 1 skipped** — the same single pre-existing `registry.test.ts` failure, unchanged, and the 9 new method tests pass.

### 15.7 What Phase 3 has actually built so far

Method B is a clean-room reimplementation. The animation skill folder has no
licence, so nothing was copied from it; the prototype's own `kit.js` also
descends from that skill and was used only as a reference for what the *film*
looks like, not as source. What exists now is written against the Three.js and
Playwright APIs directly.

**Files**

| File | Role |
|---|---|
| `src/methods/animation/renderer.ts` | esbuild → static server → Playwright + installed Chrome → `renderAt(t)` per frame → ffmpeg pipe → MP4. Also `stillsAnimation` for the art loop. |
| `src/methods/animation/scene/kit.ts` | Seeded RNG, easing, sky sphere, painted textures, sun rig, glow. |
| `src/methods/animation/scene/boat.ts` | Lofted hull (not boxes), tan sheer strake, deck, gunwale, curved lateen sail, rigging. |
| `src/methods/animation/scene/sea.ts` | The approved hero stage: deep sky, cream horizon, soft sun, per-vertex water gradient, wake ring. |
| `src/methods/animation/scene/main.ts` | Browser entry; `window.renderAt(t)` + `__ready`. Recipe dispatch (`sea`, `shore`). |
| `src/methods/animation/index.ts` | The `MethodImpl`: spec → `SceneData` → renderer. Still `available: false`. |
| `scripts/method-stills.ts` | `npm run method:stills` — PNG stills for art review. |
| `scripts/method-clip.ts` | `npm run method:clip` — short silent clip, the render gate. |

**Art direction.** The reference is the approved prototype hook
(`build/compare/skill-hook.jpg`): deep blue sky, a cream haze band on the
horizon, a soft low sun with a wide halo, deep teal water, one sailboat with a
pale sail and a wake ring, and the lower half calm because captions land there.
The first in-repo still was a pastel beach with an inverted sky gradient, a
blown-out sun, rocks floating *inside* the water and a wet-sand strip that read
as a beige step. That pass was thrown away rather than tuned.

**Measured (this machine, 2026-11-20).**

| Check | Result |
|---|---|
| Stills | 1080×1920 PNGs at 1, 4, 6, 9, 11 s |
| Clip, draft | 90 frames · 540×960 · h264 · 30 fps · **6.2 s** render (3 workers) |
| Clip, full | 45 frames · 1080×1920 · 30 fps · **6.5 s** render → ~7 fps → a 900-frame film ≈ 2.2 min |
| Determinism | same still rendered twice in separate browser launches: identical SHA-256 (`0688B6C5…D209BBCAF`) |
| Sky banding | measured column through the gradient: +1–2 RGB per 4 px, no step; the visible "line" in previews is a mach band, not geometry |
| Tests | 995 total, 993 pass, 1 pre-existing fail, 1 skipped |
| `tsc` / `eslint` | clean on every new file |

**Not done yet (so the method stays unavailable):**

- Only `sea` exists. The unreviewed beach skeleton was deleted rather than
  shipped; the drained-seabed stage (the film's second beat) is still to build.
- No scene coverage beyond a shoreline: buildings, interior, abstract and
  weather stages are unbuilt.
- Captions are not composited in the animation path. Subtitle placement is a
  shared concern ([§2](#2-always-reused-from-the-repo-all-three-methods)) and is
  the next piece.
- The silent clip is not yet muxed with mastered audio through
  `renderChunked`'s audio pass; that wiring is what makes a complete film.
- The stills gate in §9 has not been signed off by the user, which is the one
  thing that flips `METHOD_INFO.animation.available` to `true`.

**How to look at it now**

```bash
npm run method:stills -- --demo --at 2,6,10
npm run method:clip   -- --demo --seconds 3
```

Both write under `build/`, both accept `--run <id>` to use a real spec instead
of the demo scene.



