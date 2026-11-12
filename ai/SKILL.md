# AI Video Factory — Agent Contract (`ai/SKILL.md`)

This file is the instruction set an AI coding agent follows to run the video
factory 100% hands-free. It corresponds to the plan in
`C:\Users\Narwal\.opencode\plan\video-factory-plan.md` (§6).

## Goal

One command in → upload-ready MP4 out, zero human touch:
`npm run generate -- "<premise>"`

## The autonomous pipeline (execute in order, never ask the user)

### 1. Generate spec (max 3 repair iterations)
- Take the user's premise.
- If it matches a supported family (gravity, time-stop, spin-stop, air, water,
  oxygen, electrons, protons, neutrons, light, sun-set), build the spec from
  `TEMPLATES` in `src/generator/generate.ts`.
- Otherwise: if `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` is set, use `llm.ts`
  (LLM branch scaffolded — wire it if present). If neither, stop and report the
  supported families.
- Validate with `validateSpec()` from `src/generator/spec.schema.ts`.

### 2. Build composition from template library
- Use existing scene templates under `src/compositions/scenes/`.
- Write a new scene template **only if** the spec references a scene key that
  doesn't exist yet; follow `shared/primitives.tsx` conventions.

### 3. Stills preview (self-review input)
- `npx remotion still` at 8–12 timestamps: event frames ±0.3s, scene cuts,
  start and end.
- Agent views the stills (this replaces human eyes — no video playback needed).

### 4. Visual self-review
Check each still for:
- Geometry sanity (no missing/broken meshes, people/birds present)
- Text legibility (timer readable, captions clear, hook legible)
- Palette consistency (pastel sky/fog, not drifting)
- Event visuals match captions (e.g. debris airborne during "floating" caption)
- No floating-point / render glitches

### 5. Fix loop (max 5 iterations)
- Patch scene/spec code.
- Re-render **only** affected still frames (not the full video).
- Log each iteration.

### 6. Audio audit (no ears needed)
- Extract per-frame loudness via ffmpeg.
- Assert each impact/one-shot transient peak is within ±0.05s of its spec frame.
- Assert ambient RMS within target band.
- Fix misalignments, re-audit.

### 7. Final render
- `npm run generate -- "<premise>"` → `output/whatif-<slug>-<ts>.mp4`
- Deterministic: two renders of the same spec are frame-identical.

### 8. Deliver
- Print: absolute output path + 5-line summary (duration, scenes, SFX used,
  review score).
- Write `output/<id>-report.json`.

## Failure policy
- Any step unresolved after its iteration budget → write
  `output/FAILED-<slug>.log` with diagnosis and STOP.
- Never silently deliver degraded quality.

## Commands an agent may run

```
npm install                 # fresh-machine setup
npm run setup               # build SFX library
npm run generate -- "..."   # generate one video
npx remotion compositions src/index.ts   # list compositions
npx remotion still ...      # preview a single frame
npx remotion upgrade        # pull newest stable Remotion
npm run lint                # eslint + tsc
```

## Files an agent creates / modifies

- `src/generator/generate.ts` — add templates to `TEMPLATES`
- `src/compositions/scenes/` — new scene templates
- `public/sfx/` + `sfx.catalog.json` — extend the sound library
- `output/` — generated MP4s + reports + FAILED logs

## Files an agent must NOT edit by hand

- Individual frame keyframes / timelines (the spec drives these)
- ffmpeg / Chrome flags (managed by Remotion config)

## Quality gates (all must pass before "done")

1. `npm run generate -- "What if time stopped for 5 seconds?"` on a clean
   checkout → upload-ready MP4, zero manual steps.
2. Validation gates pass (spec, stills, audio audit) → `<video>-report.json`.
3. Determinism: two renders of the same spec are frame-identical.
4. `npm run setup` works fresh.
5. Failure paths log clearly; no silent quality degradation.
