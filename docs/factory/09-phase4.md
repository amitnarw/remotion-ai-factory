# 09 — Phase 4: editor + fast re-render (status, 2026-10-26)

**Status: about 90% done.** Everything is built and committed. The chunked renderer has been proven live twice: on 2026-10-24, and again on 2026-10-26 (cold 5 m 20 s, unchanged re-render 35 s with 0 chunks rendered and 2 reused, a seamless chunk boundary at frame 512 of 790). Fast text edits are done (estimate first, then measure, with a persistent Kitten worker). Keep-timing vs reflow is wired through the editor (`PUT /api/film/:id`). On 2026-10-26 the editor was opened in a (headless) browser through the new dashboard, and a check of the server found 7 bugs, now fixed (see the session at the end).

**What is left:**
1. Ask AI with a real Ollama model (needs the key on the GPU machine).
2. The milestone 4 check: a 3-minute 16:9 video, one caption edit through the editor, and the log shows 1 chunk rendered while the rest are reused.
3. The user's review.

Plan: [05-plan.md, Phase 4](05-plan.md#phase-4--editor--fast-re-render--milestone-4).

## Progress at a glance

| Part | Status | Done |
|---|---|---|
| Research (all parts) | Done. Findings below. | 100% |
| Edits, versions, undo/redo (backend) | Done, tested, checked on a real plan. A recast keeps the editor's caption wording (2026-10-26). | 100% |
| "Ask AI" editor role (backend) | Done, tested with recorded replies; not yet tried with a real Ollama model | 85% |
| Server routes `/api/film/*` | Done, exercised over HTTP on 2026-10-26: an unchanged save changes nothing, a caption edit reaches `output/<id>/spec.json`, a bad recast gets 400, invalid edits no longer wait behind a re-voice | 100% |
| Editor UI (timeline, player, inspector, Ask AI box, history) | Opened through the new dashboard (Library or the plan review), checked in screenshots at 1280 wide and phone width | 90% |
| Incremental pipeline (re-voice only the changed line) | Works (voice cache); keep timing vs reflow; word edits answer at once on estimates and re-measure in the background; persistent Kitten worker | 100% |
| Chunked, cached render | Done and proven: cold, unchanged (all chunks reused), seamless boundary. Flights never sit across a chunk boundary (PLAN_VERSION 2). The editor's and the dashboard's render buttons render chunked | 100% |
| Jobs saved to disk (survive a server restart) | Done and exercised through a real restart: interrupted jobs come back as "failed"; DELETE removes a job; the progress stream sends the final state and closes; progress never goes backwards | 100% |
| Milestone 4 check | Partial: cold and warm chunked renders pass end to end. The 3-minute 16:9 edit-one-caption check is still open | 40% |

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
- `prepare.ts`: `prepareFilm(id)` = `reassemble(id, "render")` (voices only lines the cache lacks) + `resolveAudio` → a playable spec. Also rewrites `output/<id>/spec.json` (it wrote the old flat `output/<id>-spec.json` until 2026-10-26, so edits never reached a render), so the "Make the video" button renders the edited version.
- `recast.ts`: `checkRecast` checks a recast's character name and voice before anything is queued (an unknown name or voice gets 400 and `plan.json` is untouched).
- Tests: `src/generator/film/film.test.ts`, `diff.test.ts`, `recast.test.ts`, shared sample `testFilm.ts`.

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
| `PUT /api/film/:id` `{spec}` | wording saves: reflow (story) or keep timing (captions); returns film, redo and a summary |
| `GET /api/film/:id/status` | `measuring` while the background re-measure runs |

Saves for one film run one at a time (they share the stage files). Since 2026-10-26 a request is validated before it joins that queue, so a bad edit, undo/redo or GET answers in about 15 ms even while a line is being re-voiced.

### 4. Editor UI (`ui/src/pages/editor/`)
- `tracks.ts`: `deriveTracks(spec, film)` → Beats, Shots, Captions, Voice, Music, Hits, Scenes tracks.
- `Timeline.tsx`: own timeline (no library fitted: see research); ctrl+wheel zoom, playhead moved from the Player's `frameupdate` event, click to select and seek. No dragging yet (not required).
- `Inspector.tsx`: forms from `fields` for beats, dialog lines, shots, scenes, hits, music; saves as one `/edit`.
- `AskAi.tsx`: target = selected beat or the whole video; shows the proposal with Apply / Discard.
- `Editor.tsx`: layout, undo/redo, version history, warnings, a back link to where it was opened from, and the Render button (chunked).
- `ui/src/preview/PlayerPreview.tsx` generalized (ref, seek, frame events); `ui/src/api.ts` client for the routes.
- Open it with **Open in editor** on a video in the Library, on the plan review, or on the finished video in Create. The URL is `http://localhost:5177/?tab=editor&film=<id>&from=library|plan|done` (the full URL scheme is in `ui/src/lib/routes.ts`).

### 5. Chunked, cached render (`src/generator/render/`)
| File | Status |
|---|---|
| `plan.ts` + `plan.test.ts` | Done, tested: chunks 4-20 s ending only at hard cuts (never inside a transition or a flight), deterministic; a flight's chunk key covers both places (PLAN_VERSION 2); cache key = global part (bundle hash, versions, gl, encoder, size, fps, total length, any non-time-local spec field) + local slice of time-local spec elements ±pad + hashes of referenced files. Editing one caption changes exactly one chunk key. |
| `hash.ts` | Source-tree and public-folder hashing. |
| `bundle.ts` | `ensureBundle()`: builds to `out/phase4-bundles/<hash>/` with rspack and **no public copy** (copying 885 MB took 36 s), then links `<bundle>/public` → `public/` with a directory junction. Reuses a bundle whose hash matches. |
| `browser.ts` | One shared headless Chrome with `gl: "angle"` (required by Phase 3's post-processing). |
| `chunks.ts` | Renders missing chunks muted as `h264-ts` with `frameRange`, cached in `output/<id>/chunks/<key>.ts`. |
| `audio.ts` | Renders the soundtrack once as WAV from the new audio-only composition. |
| `join.ts` | ffmpeg `concat:` join, `-c:v copy -r <fps> -video_track_timescale 90000`, mux with exact `-t`, frame-count check. |
| `src/compositions/WhatIfAudio.tsx` + `<Composition id="WhatIfAudio">` in `src/Root.tsx` | Done (uses the same metadata as WhatIfVideo, so lengths match). |
| `index.ts` (`renderChunked`) | Done (2026-10-24). |
| `--chunked` flag in `src/generator/generate.ts` | Done (2026-10-24); the dashboard and the editor always render chunked. |

## What was verified (2026-10-23, first pass)
- `npx tsc --noEmit -p .` clean for the whole repo (includes ui/ and Phase 3's work in progress).
- Tests: `npx tsx --test src/generator/film/film.test.ts src/generator/pipeline/editor.test.ts src/generator/render/plan.test.ts` → 15 pass.
- `npm run ui:build` passes; `npx eslint src/generator/render src/generator/film server/film.ts` clean.
- `node scripts/check-ui-icons.mjs` flagged two em-dashes in the old `ui/src/pages/Setup.tsx` (that page is gone since the 2026-10-26 redesign; the check passes).
- Real plan (copy at `output/phase4-film-check/`, git-ignored): edit one beat's line → **only that line synthesized** (8 of 9 from the cache), captions updated; undo → exactly the original captions with no synthesis. Prepare with everything cached: 0.7 s rebuild + 4 s sound resolution.
- **Problem found:** one new Kitten line took **309-519 s** while other sessions were rendering (CPU 58-75%). Each synthesis starts a new Python process, imports torch, loads the model, and runs on all 12 threads, which fight the render processes.

## Pending work, in order
1. ~~**Finish the renderer.**~~ DONE 2026-10-24: `renderChunked(spec, id, { quality, out, log, onFrames })` in `src/generator/render/index.ts` (bundle -> shared browser -> selectComposition with the metadata pinned to videoSeconds -> planRender -> renderChunks -> renderAudioTrack -> joinChunks), and `--chunked` in `generate.ts` renderOnly (keeps masterAudio and the report; the report gains a `chunks` block; prints `Rendered n/m` lines, which server/jobs.ts already parses). Verified with a real cold render: `npx tsx src/generator/generate.ts --from-spec output/milestone-money-doubles-9x16-spec.json --chunked` -> 75 s total (bundle 1.6 s, two chunks 32 s + 25 s, audio 4.5 s), frame counts checked per chunk and after the join, mastered to -14.3 LUFS. Was originally → `renderChunked(spec, id, { quality, out, onProgress })`: `ensureBundle` → shared browser → `selectComposition` (WhatIfVideo, inputProps `{spec}`) → `planChunks` → `renderChunks` (missing only) → `renderAudioTrack` (cached) → `joinChunks` → return `{ output, chunks: {total, rendered, reused}, seconds }`. Then add `--chunked` to `generate.ts` `renderOnly`: after `resolveAudio`, call `renderChunked` instead of the `remotion bundle` + `remotion render` CLI calls; keep `masterAudio` and the report (add chunk stats); print `Rendered a/b` lines (server/jobs.ts parses them). The default CLI path stays as it is.
2. **Test the renderer for real — DONE.** On 2026-10-26, with a quiet tree: an unchanged re-render rendered 0 chunks and reused 2 (35 s, against 5 m 20 s cold), and the chunk boundary at frame 512 of 790 is seamless. Still open: the edited-caption run (1 rendered, 1 reused), which is part of the milestone 4 check. History: **PARTIALLY done 2026-10-24.** Cold render: done (above, 75 s). Audio track reused: demonstrated live twice (`[audio] track reused (500f…)` across runs). Warm CHUNK reuse: not yet demonstrated live — the bundle hash changed between every probe (another session edits src/ continuously; 12 different hashes in 10 minutes), so every chunk key was invalidated each time. This is correct behaviour (code changed), but the reuse branch of renderChunks has not executed against a real cache yet. On a quiet machine this takes one minute: run the same `--chunked` command twice unchanged, then once with one caption edited in the film; expected `chunks rendered 0, reused 2` and then `rendered 1, reused 1`. Also still open: first-frame-of-chunk pixel check against a full render. Was originally cold render of a planned video with `--chunked`; change one caption; render again → log must say 1 chunk rendered, rest reused. Check: same total frames as the CLI render (ffprobe `-count_frames`), first frame of each chunk equal to a full render's frame (hash or small pixel diff), assets load through the junction (fonts, GLBs, audio), audio length = video length. Record cold / warm / CLI times.
3. **Make text edits fast — DONE 2026-10-24 (lane B).** (a) Wording saves answer at once: the film routes use `prepareFilm(voice: "estimate")` — cached lines keep their measured lengths, only the CHANGED lines are timed from word counts (a warning says so) — and the server re-measures in the background; `GET /api/film/:id/status` returns `measuring` and the editor polls it, then refreshes when the real timing lands. (b) A persistent Kitten worker: `TTS_KITTEN_WORKER=1` (DEFAULT ON) keeps one Python process per Node session with the model loaded and speaks lines over stdin (`scripts/story-tts.py --worker`, JSON lines, `@@` results); a crash, spawn failure or timed-out generation falls back to the batch path for the remaining lines and the worker respawns on the next request; a process exit hook kills the model process so nothing is left behind (the CLI disposes explicitly so node exits). Timings measured on this machine (real Kitten 2, quiet tree): **3 separate one-line edits = 121.1 s through the worker vs 266.9 s through the batch path** (137.6/70.3/59.0 — each batch call paid its own model load; the worker paid ONE 15.9 s load, lines 33.7/36.5/32.3 s). Restart-on-crash proven: killing the worker python mid-session, the next line re-voices after a fresh reload (18.7 s load + ~34 s line). Still optional: fewer torch threads while renders run (not needed: the worker loads once, and per-line CPU fighting is a render-phase problem, not a wording-edit problem).
4. **Open the editor in a browser — mostly DONE 2026-10-26.** Opened through the new dashboard in a headless browser (from the Library and from the plan review), checked at 1280 wide and at phone width, with fixture plans. Still open: Ask AI's proposal + Apply with a real model (needs the Ollama key: GPU machine), and a hands-on pass by the user.
5. ~~**Editor Render button → chunked render**~~ DONE 2026-10-24: `/api/render-spec` accepts `{chunked}` and passes `--chunked`; `renderSpec(specId, audio, { chunked })` in ui/src/api.ts; the editor's Make-the-video button always renders chunked now. Was originally pass `--chunked` through the render job (server/jobs.ts builds the generate.ts args).
6. ~~**Jobs saved to disk**~~ DONE 2026-10-24: jobs persist to `output/jobs/<id>.json`; on startup the server re-loads them and marks running/queued jobs failed with "Interrupted: the server restarted". Exercised through a real server restart on 2026-10-26 (a restored interrupted job used to still show "running"; fixed).
7. **"Keep timing" vs "reflow" — DONE 2026-10-24 (lane B), as two save paths in the Inspector.** Wording saves go through the approved spec: `PUT /api/film/:id` `{ spec }`. The server diffs it against the film: changed story wording (hook and each beat's SAY; character dialog lines deliberately stay on POST /edit, because the playable spec's timed lines include narrator lines the film's dialog list does not have) is adopted (re-voice the changed lines from the cache, re-time — "reflow"; the editor toasts the changed length when it moves 0.4 s or more) and changed CAPTION wording becomes a keep-timing override saved on the film version (`film.captions`), applied over the rebuilt captions in prepareFilm (+-0.35 s window match — the voice and the window stay). A reflow of a beat drops the kept overrides inside that beat's windows so its captions follow the story again; every other kept wording survives. This ALSO closes the known problem from the live-reuse proof: a caption-text edit used to be discarded when the stage files existed — caption overrides now survive re-timings, re-opens and renders. The editor shows a small diff preview (lines changed, old to new) before every save. The render route passes the edited spec through unchanged (`--from-spec` -> `reassemble(id, "render", audio, approved)`), so the editor's Make-the-video button still renders chunked. Proven live on the banked money-doubles 9:16 plan's stage files (copied to a throwaway id): initial all-cache prepare measured=true in 2.0 s; a reflow of one line adopted it (version 2, story.json carries it), answered measured=false in 1.7 s, and the background worker measure landed measured=true in 64.3 s (one 19.0 s engine load + one 40.5 s line, 9 cache reuses); a caption-only PUT answered measured=true in 1.6 s with the words applied and the voice untouched. What is NOT built: a timeline solver that squeezes only the edited beat (reflow still re-solves the whole timeline — with mostly-measured cache durations the other beats barely move).
8. **Milestone 4 check:** a 3-minute 16:9 video; edit one caption; the log shows 1 chunk re-rendered and the rest reused, and the total time is a small fraction of a full render. Then the user reviews.

## Running it on either machine
1. The work is committed on `dev`. `git pull`, `npm ci --legacy-peer-deps`, `cd ui && npm install && cd ..`, `npm run audio:library`, `npm run assets`, `npm run world:assets`, `npm run world:catalog`; install KittenTTS 2 from Settings → Voice engines; put the Ollama key in `.env` (GPU machine only).
2. Check: `npx tsc --noEmit -p .` and `npm test` (all tests, including `server/**/*.test.ts`).
3. Start: `npm run server` and `npm run ui`, then open `http://localhost:5177`. `PORT=<n> npm run server` runs a second server next to the first one (5178 is the default).
4. To continue: tell Claude *"Read docs/factory/09-phase4.md and continue Phase 4 from 'What is left'."*

## Working next to other chats
- Renders: Node-API renders must pass `gl: "angle"` (on `openBrowser` when the browser is shared). The CLI render bundles per id (`out/render-bundle-<id>`); the chunked path uses `out/phase4-bundles/<hash>`, shared but read-only once built (atomic rename), so two chunked renders can run side by side. Never use the old shared `out/render-bundle`.
- Any edit under `src/` changes the bundle hash and with it every chunk key, so chunk reuse only shows on a tree nobody is editing.
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

## Session 2026-10-24 (Phase 4 lane)
- Written: `render/index.ts` (renderChunked), the `--chunked` CLI flag, job persistence in `server/jobs.ts` (+ `removeJobFile`), `chunked` in `server/index.ts` render-spec, `renderSpec(..., {chunked})` in the UI API, the editor's render button passes chunked.
- Real render verified cold (above). Bundle build ~1.6-2 s warm cache miss (rspack, no public copy), 2 chunks of 441/312 frames at 32/25 s each (draft 540×960), audio pass 4.5-6.8 s.
- Known caveat: any edit under `src/` (including another lane's) changes the bundle hash and with it every chunk key — chunk reuse is for idle trees. `out/phase4-bundles` keeps the newest 4; chunk cache prunes keys unused for 5 runs.
- The UI was still not opened in a browser.
## Session 2026-10-24 (Phase 4 lane B)
- Written: the persistent Kitten worker — `scripts/story-tts.py --worker` (loads once, one JSON request + one `@@` result per line, `{"op":"quit"}` exits) and the `TtsWorker` client in `src/generator/tts.ts` (`kittenWorkerEnabled`, queue-serialized requests, 7 min per-line limit / `TTS_WORKER_LINE_TIMEOUT_MS`, crash + timeout -> batch fallback, respawn on next use, exit-hook kill; `disposeTtsWorkers()` called at both CLI run exits in `generate.ts`).
- Fast text edits: `server/film.ts` routes (GET / PUT / edit / undo / redo) answer from estimates and start a background `prepareFilm(voice: "measure")` per film when lines were missing; `GET /api/film/:id/status`; `prepareFilm` now computes `measured` honestly from `voice.json`'s estimated flags (estimates answer `false`).
- Keep-timing vs reflow: new `src/generator/film/diff.ts` (`diffTextEdits` (hook + say only), `editsFromTextDiff`, `diffCaptions`, `mergeOverrides`, `applyCaptionOverrides`, `dropOverridesForBeats`) + `CaptionOverride`/`film.captions` in `edits.ts` + version snapshots carry the overrides (`store.ts` ignores them in the changed-outside check) + `prepareFilm` applies them; the Inspector routes hook/say/caption wording through PUT (dialog lines stay on /edit) with a "Keep timing" caption save; the editor polls /status, toasts the changed length on reflow and shows the diff preview everywhere. PROVEN live on the banked money-doubles 9:16 stage files: all-cache prepare 2.0 s (measured); reflow of one line = 1.7 s answer + 64.3 s background measure (one load + one line); caption-only PUT = 1.6 s measured answer, no synthesis.
- Timings (real Kitten 2, quiet tree, each edit = one fresh line): batch path 137.6 + 70.3 + 59.0 = **266.9 s**; worker path 52.3 + 36.5 + 32.3 = **121.1 s** (one 15.9 s load inside the first line's 52.3 s). Keep-timing caption edits (no re-voice) come back measured in seconds.
- Tests: `film/diff.test.ts` (2) + `tts.worker.test.ts` (2) — parser, flag, merge/apply/idempotence. Suite green (see PROGRESS).
- NOT done here: the editor has still never been opened in a browser; the milestone 4 check (3-min 16:9 + one caption edit through the UI) and the user review stay coordinator-side.

## Session 2026-10-26 (all-phase check, then the dashboard redesign)
- **Render fixes (commit `8c35f1a`).** Every CLI render failed on a font 404: `remotion.config.ts` used `__dirname`, which is `node_modules/@remotion/cli/dist` when the CLI compiles it, so no bundle had `public/`. Six font file names were wrong. A dashboard or editor render got the id `spec.json`. `prepare.ts` wrote the old flat spec path, so editor edits never reached a render. All fixed.
- **Chunk reuse proven again** on a quiet tree: cold 5 m 20 s; unchanged 35 s with 0 rendered and 2 reused; the boundary at frame 512 of 790 is seamless.
- **Server and editor fixes** (found by replaying the editor's calls over HTTP):
  1. A recast kept the voice but dropped the editor's caption wording; it now keeps it (a new plan with changed wording still drops it).
  2. A recast with an unknown character or voice was queued and could break `plan.json`; `checkRecast` now answers 400 first.
  3. Progress could go backwards between stages (`server/progress.ts`, tests in `server/progress.test.ts`).
  4. Invalid edits, undo/redo and GET waited behind a running re-voice; they are now checked before the queue.
  5. Jobs: DELETE answers 200 and removes the job; the progress stream of a finished job sends the final state and closes; a job interrupted by a restart shows "failed".
  6. Plan audio files are cleaned up; `PUT /api/film/:id` returns film, redo and a summary; the models show as "fixtures" in fixture mode.
  7. `package.json` lists `@remotion/bundler` and `@remotion/renderer` (4.0.536), which the chunked renderer imports; `npm test` now also runs `server/**/*.test.ts`.
- **The dashboard was redesigned** to show one thing at a time: a sidebar (Create, Library, Settings, Help), a Create wizard with one decision per screen (idea, format, voice, captions, summary, then writing, review, rendering, done), a Library with a detail view, and Settings split into AI models, model roles, voice engines and a getting-started checklist. Every screen has its own URL (`ui/src/lib/routes.ts`); old links still work. The editor opens from the Library, the plan review or the finished video, and has a back link.
