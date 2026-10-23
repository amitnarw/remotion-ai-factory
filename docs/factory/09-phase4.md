# 09 — Phase 4: editor + fast re-render (status and handoff, 2026-10-23)

**Status: about 55% done. Stopped mid-way on purpose to move to another laptop.** Nothing in this phase is committed yet (see "Moving to the other laptop").

Plan: [05-plan.md, Phase 4](05-plan.md#phase-4--editor--fast-re-render--milestone-4). Phase 3 is being done by another chat in the same repo at the same time; see "Working next to Phase 3" before editing shared files.

## Progress at a glance

| Part (share of the phase) | Status | Done |
|---|---|---|
| Research (all parts) | Done. Findings below. | 100% |
| Edits, versions, undo/redo (backend) | Done, tested, checked on a real plan | 100% |
| "Ask AI" editor role (backend) | Done, tested with recorded replies; not yet tried with a real Ollama model | 85% |
| Server routes `/api/film/*` | Done; typecheck clean; tried through the functions, not over HTTP | 85% |
| Editor UI (timeline, player, inspector, Ask AI box, history) | Code written, compiles, production build passes; **never opened in a browser** | 65% |
| Incremental pipeline (re-voice only the changed line) | Works (voice cache), but one new Kitten line took 5-9 minutes on the loaded laptop; "keep timing" option not built | 50% |
| Chunked, cached render | Planner + tests, bundle cache, browser, chunk render, audio pass and join written; **the main `renderChunked` function, the `--chunked` flag and any real render test are missing** | 45% |
| Jobs saved to disk (survive a server restart) | Not started | 0% |
| Milestone 4 check | Not started | 0% |

**Time left (rough):** 1 to 1.5 working days on a laptop that is not busy rendering other work. Most of it is the renderer's real-render test and the milestone check; render-heavy steps run about 3-5× slower while other sessions render.

## What was built

### 1. Edits, versions, undo (`src/generator/film/`)
A planned video ("film") is the pipeline's stage files in `output/<id>/`: `story.json`, `direction.json`, `sound.json`, `plan.json` (`voice.json` and `timeline.json` are recomputed). `reassemble()` (Phase 2) rebuilds the spec from them with no model calls, so an edit only changes a stage file.

- `edits.ts`: edits address things **by id**, not by JSON pointer (models make index mistakes with RFC 6902 patches; see research):
  ```
  { op: "set", path: "story.beats[b3].say", value: "A new line." }
  { op: "set", path: "direction.shots[2].size", value: "CU" }
  { op: "insert", path: "sound.hits", value: { beat: "b4", at: "start", sound: "boom" } }
  { op: "remove", path: "sound.hits[1]" }
  ```
  `[x]` is an index or an id/beat/name/start. Only allow-listed paths can change; the edited film is validated (story check, `DirectorSchema`, sound check, `SettingsSchema`, every beat reference exists, dialog speakers are characters). Each edit says what must be redone: `voice` (text: re-voice + re-time + assemble), `timeline` (pace) or `assemble` (shots, scenes, sound, captions). All-or-nothing: one bad edit changes nothing, and the error names the problem and the valid ids.
- `store.ts`: every save writes `output/<id>/film/v<N>.json` + `head.json` and rewrites the stage files, so `reassemble()` always reads the current version. Undo/redo move between versions; saving after an undo drops the undone ones. Stage files changed outside the editor (e.g. the voice recast route) become their own version, so undo never loses them.
- `fields.ts`: field choices for the Inspector and the AI prompt, **read from the schemas** (shots and scenes from `DirectorSchema`, moods and sound names from the sound designer), so Phase 3's new shot fields appear automatically.
- `prepare.ts`: `prepareFilm(id)` = `reassemble(id, "render")` (voices only lines the cache lacks) + `resolveAudio` → a playable spec. Also rewrites `output/<id>-spec.json`, so the existing "Make the video" button renders the edited version.
- Tests: `src/generator/film/film.test.ts` (5), shared sample `testFilm.ts`.

### 2. "Ask AI" (`src/generator/pipeline/editor.ts`)
`askEditor({ film, target, request, models })` with target `{kind:"beat", beat}` or `{kind:"video"}`.
- For one beat, the model may only use that beat's exact paths: they are listed in the prompt AND are the only values the reply format allows (`z.enum`, enforced by Ollama's structured output), so it cannot wander to another beat.
- Every reply must apply cleanly; if not, `callRole`'s repair loop sends the exact error back. Near-miss keys (`action`, `target`, `ops`) are accepted.
- The route returns a **proposal**; nothing is saved until the user presses Apply (which calls `/edit` with `source: "ai"`).
- Tests: `src/generator/pipeline/editor.test.ts` (4), including an off-target first reply that is re-asked.

### 3. Server routes (`server/film.ts`, registered in `server/index.ts`)
| Route | Does |
|---|---|
| `GET /api/film/:id` | film, history, playable spec, warnings, `measured`, Inspector fields |
| `POST /api/film/:id/edit` `{edits, source?, summary?}` | validate, save a version, re-prepare; 400 with the reason if invalid |
| `POST /api/film/:id/ask` `{target, request}` | proposal `{summary, edits, redo, changes}` |
| `POST /api/film/:id/undo`, `/redo` | move a version; 409 when there is nothing to undo/redo |

Requests for one film run one at a time (they share the stage files).

### 4. Editor UI (`ui/src/pages/editor/`), written, not yet seen running
- `tracks.ts`: `deriveTracks(spec, film)` → Beats, Shots, Captions, Voice, Music, Hits, Scenes tracks.
- `Timeline.tsx`: own timeline (no library fitted: see research); ctrl+wheel zoom, playhead moved from the Player's `frameupdate` event, click to select and seek. No dragging yet (not required).
- `Inspector.tsx`: forms from `fields` for beats, dialog lines, shots, scenes, hits, music; saves as one `/edit`.
- `AskAi.tsx`: target = selected beat or the whole video; shows the proposal with Apply / Discard.
- `Editor.tsx`: layout, undo/redo, version history, warnings, Render button (still the old `renderSpec` flow).
- `ui/src/preview/PlayerPreview.tsx` generalized (ref, seek, frame events); `ui/src/api.ts` client for the routes; `ui/src/App.tsx` lazy `editor` tab; `ui/src/pages/Generate.tsx` has an **Open editor** button in the review step.
- Open it at `http://localhost:5177/?tab=editor&film=<id>` (or from the review step).

### 5. Chunked, cached render (`src/generator/render/`), partly written
| File | Status |
|---|---|
| `plan.ts` + `plan.test.ts` | Done, tested: chunks 4-20 s ending only at hard cuts (never inside a transition), deterministic; cache key = global part (bundle hash, versions, gl, encoder, size, fps, total length, any non-time-local spec field) + local slice of time-local spec elements ±pad + hashes of referenced files. Editing one caption changes exactly one chunk key. |
| `hash.ts` | Source-tree and public-folder hashing. |
| `bundle.ts` | `ensureBundle()`: builds to `out/phase4-bundles/<hash>/` with rspack and **no public copy** (copying 885 MB took 36 s), then links `<bundle>/public` → `public/` with a directory junction. Reuses a bundle whose hash matches. Untested in a real render. |
| `browser.ts` | One shared headless Chrome with `gl: "angle"` (required by Phase 3's post-processing). |
| `chunks.ts` | Renders missing chunks muted as `h264-ts` with `frameRange`, cached in `output/<id>/chunks/<key>.ts`. Untested. |
| `audio.ts` | Renders the soundtrack once as WAV from the new audio-only composition. Untested. |
| `join.ts` | ffmpeg `concat:` join, `-c:v copy -r <fps> -video_track_timescale 90000`, mux with exact `-t`, frame-count check. Untested. |
| `src/compositions/WhatIfAudio.tsx` + `<Composition id="WhatIfAudio">` in `src/Root.tsx` | Done (uses the same metadata as WhatIfVideo, so lengths match). |
| `index.ts` (`renderChunked`) | **Missing**: the agent was writing it when stopped. |
| `--chunked` flag in `src/generator/generate.ts` | **Missing**. |

## What was verified
- `npx tsc --noEmit -p .` clean for the whole repo (includes ui/ and Phase 3's work in progress).
- Tests: `npx tsx --test src/generator/film/film.test.ts src/generator/pipeline/editor.test.ts src/generator/render/plan.test.ts` → 15 pass.
- `npm run ui:build` passes; `npx eslint src/generator/render src/generator/film server/film.ts` clean.
- `node scripts/check-ui-icons.mjs` flags two em-dashes in `ui/src/pages/Setup.tsx` (old text, not Phase 4).
- Real plan (copy at `output/phase4-film-check/`, git-ignored): edit one beat's line → **only that line synthesized** (8 of 9 from the cache), captions updated; undo → exactly the original captions with no synthesis. Prepare with everything cached: 0.7 s rebuild + 4 s sound resolution.
- **Problem found:** one new Kitten line took **309-519 s** while other sessions were rendering (CPU 58-75%). Each synthesis starts a new Python process, imports torch, loads the model, and runs on all 12 threads, which fight the render processes.

## Pending work, in order
1. **Finish the renderer.** Write `src/generator/render/index.ts` → `renderChunked(spec, id, { quality, out, onProgress })`: `ensureBundle` → shared browser → `selectComposition` (WhatIfVideo, inputProps `{spec}`) → `planChunks` → `renderChunks` (missing only) → `renderAudioTrack` (cached) → `joinChunks` → return `{ output, chunks: {total, rendered, reused}, seconds }`. Then add `--chunked` to `generate.ts` `renderOnly`: after `resolveAudio`, call `renderChunked` instead of the `remotion bundle` + `remotion render` CLI calls; keep `masterAudio` and the report (add chunk stats); print `Rendered a/b` lines (server/jobs.ts parses them). The default CLI path stays as it is.
2. **Test the renderer for real** (needs a quiet machine): cold render of a planned video with `--chunked`; change one caption; render again → log must say 1 chunk rendered, rest reused. Check: same total frames as the CLI render (ffprobe `-count_frames`), first frame of each chunk equal to a full render's frame (hash or small pixel diff), assets load through the junction (fonts, GLBs, audio), audio length = video length. Record cold / warm / CLI times.
3. **Make text edits fast.** (a) `/edit` answers at once with estimated timing (`prepareFilm(id, { voice: "estimate" })`), then measures in the background; add `GET /api/film/:id/status` and let the UI refresh when `measured` turns true. (b) A persistent Kitten worker (keep one Python process with the model loaded; send lines as JSON lines) so a line costs only its generation time; try fewer torch threads (4) while renders run. Measure before and after.
4. **Open the editor in a browser** (`npm run server` + `npm run ui`, then `?tab=editor&film=<id>`): check the timeline, playhead sync, Inspector save, Ask AI proposal + Apply (needs the Ollama key: other laptop), undo/redo, history. Screenshot and fix what looks wrong.
5. **Editor Render button → chunked render**: pass `--chunked` through the render job (server/jobs.ts builds the generate.ts args).
6. **Jobs saved to disk** in `server/jobs.ts` so they survive a server restart.
7. **"Keep timing" vs "reflow"** for text edits (timeline solver keeps other beats where they are and squeezes or stretches only the edited beat).
8. **Milestone 4 check:** a 3-minute 16:9 video; edit one caption; the log shows 1 chunk re-rendered and the rest reused, and the total time is a small fraction of a full render. Then the user reviews.

## Moving to the other laptop
1. **Commit and push this work first** (it is not committed). Phase 4 files only:
   `src/generator/film/` · `src/generator/pipeline/editor.ts` · `src/generator/pipeline/editor.test.ts` · `src/generator/render/` · `src/compositions/WhatIfAudio.tsx` · `src/Root.tsx` · `server/film.ts` · `server/index.ts` · `ui/src/pages/editor/` · `ui/src/api.ts` · `ui/src/App.tsx` · `ui/src/pages/Generate.tsx` · `ui/src/preview/PlayerPreview.tsx` · `docs/factory/09-phase4.md` (+ the doc updates in `docs/factory/`).
   The working tree also holds the Phase 3 chat's uncommitted work: commit only the paths above (`git add <paths>`), or let that chat commit its own.
2. On the other laptop: `git pull`, `npm ci --legacy-peer-deps`, `cd ui && npm install && cd ..`, `npm run audio:library`, `npm run assets`, install KittenTTS 2 from the Setup tab, put the Ollama key in `.env`.
3. Check: `npx tsc --noEmit -p .` and the 15 tests above.
4. Tell Claude: *"Read docs/factory/09-phase4.md and continue Phase 4 from 'Pending work' step 1."*

## Working next to Phase 3
- The Phase 3 chat owns: `spec.schema.ts`, `pipeline/{director,assemble,llm,shots,transitions}.ts`, `src/compositions/*` (except `WhatIfAudio.tsx`), `src/generator/{camera,look,qa}/*`, `layout.ts`, `look-choice.ts`, `scripts/milestone.ts`, `scripts/photographer.ts`. Phase 4 must not edit them.
- Phase 4 owns: `server/index.ts`, `server/jobs.ts`, `src/generator/generate.ts`, the UI files above, `src/generator/{film,render}/*`, `pipeline/editor.ts`.
- Renders: Node-API renders must pass `gl: "angle"` (on `openBrowser` when the browser is shared). Phase 4 uses `out/phase4-*` folders only, never `out/render-bundle` (the CLI path's shared bundle).
- Video length: `videoSeconds(spec)` from `spec.schema.ts` (a planned video ends exactly at the timeline end).
- Agree before any `npm install`.

## Research findings (2026-10-23)
**Editor UI.** Build a small own timeline; nothing fits:
- `@xzdarcy/react-timeline-editor` (MIT) ships its own CSS and has open bugs.
- designcombo/OpenVideo: custom licence, PixiJS.
- Twick: Sustainable Use License.
- Remotion Timeline: $300; Editor Starter: $600.
- OpenCut: archived/rewritten.
- dnd-kit is for lists, not time axes.

Player sync: memoized `<Player>` with a ref, `frameupdate` for the playhead (no per-frame React state), `seekTo` on select. @remotion/player is free for individuals and companies up to 3 people.

**Patch format.** LLMs make index errors in RFC 6902 patches (JSON Whisperer, EMNLP 2025, arxiv.org/abs/2510.04717): use edit-by-id operations and constrain ids/paths with the reply schema (Ollama structured output). Immer (MIT) is a good choice if in-memory inverse patches are ever needed; snapshots are used now.

**Chunked render** (Remotion 4.0.536):
- **Joining.** `combineChunks` is public but its AAC path needs equal chunk lengths, so we join video-only chunks ourselves. Every new encode starts on a keyframe, so no keyframe flags are needed. Uneven chunks joined with `concat:` + `-c:v copy` gave exact frame counts in a test.
- **Audio.** `separateAudioTo` does not work with muted renders, so the soundtrack is rendered once (`codec: "wav"`) from an audio-only composition.
- **Bundling.** `bundle()` always recopies `public/`, and `symlinkPublicDir` has no effect on Windows: use a missing `publicDir` + a directory junction. Remotion's server 404s on files that are themselves symlinks, so link folders, never files.
- **Options.** `remotion.config.ts` does not apply to Node APIs: pass `rspack`, `imageFormat`, `gl` explicitly. Recycle the shared browser every N chunks (angle memory leak).
- **Determinism.**
  - Anything reading R3F `delta`, state built up from frame 0, or `durationInFrames` breaks chunking.
  - The first frame of a chunk is a fresh mount, so QA it against a full render.
- **Prior art.** Revideo (MIT, `midrender/revideo`) uses the same muted-parts + separate-audio pattern.
