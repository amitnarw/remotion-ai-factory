Done (2026-11-05). Left for other owners: wiring the pack into the run, the server and the dashboard ([20-publish.md](../20-publish.md) §4 has the exact calls).

# publish: a publish pack per finished video

## Task
Each finished run gets a pack ready to upload to YouTube, written to `output/<run>/publish/{publish.json, description.txt, thumbnail.png}`:
- 3 title options and tags: one model call on the writer role's model (no new role), with recorded replies for tests;
- a description built by code: the hook, a short summary, chapters for long form (from the beats' times), and the credits line for every CC-BY model the video used (`creditsFor` / `creditsForPlaces` in `src/world/catalog.ts`);
- a thumbnail: one still at 1280x720 (or the format's own size) picked from the video's frames, with the hook text over it in the channel's caption style.

The CLI: `npx tsx scripts/publish.ts <run>`. Nothing is uploaded anywhere.

Files owned: new `src/generator/publish/*` and its tests, new `scripts/publish.ts`, new `test-fixtures/publish/*`, docs `docs/factory/20-publish.md` and this file.

## What was built
- `src/generator/publish/pack.ts` (pure): `readRun`, `creditsOf` (places' landmarks via `creditsForPlaces`, a model set's model via `creditsFor`, an old report's lines for other models), `chaptersOf` (landscape and 60 s or more: 0:00, then beat starts about a sixth of the video apart, each 10 s or more, at least 3), `summaryOf`, `buildDescription`, `cleanTitles`, `cleanTags` (YouTube's 100 / 500 limits), `hashtagsOf`, `pickThumbnail` (the photographer's best clean still from `qa/qa.json`, else the hook's shot via `shotFrames`), `thumbnailSize`, `thumbnailSpec` (no captions, no sound cues, the hook over the whole video).
- `titles.ts`: `askTitles`, one `callRole` on the writer (label `publish`, saved in the run's `.calls/`), repair when fewer than 3 distinct titles; code titles and tags when no model answers, with a warning.
- `thumbnail.ts`: `renderThumbnail` (the `WhatIfVideo` composition's own still, `renderStill`, so the hook is drawn by the video's Hook in the run's caption style), `uploadableThumbnail` (a JPEG copy when the PNG is over YouTube's 2 MB).
- `index.ts`: `makePublishPack(run, opts)`, `buildPack(readRun(run), opts)`, the `PublishPack` type.
- `scripts/publish.ts`: `<run> [--bundle out/<folder>] [--frame N] [--no-thumbnail] [--output-dir <dir>]`.
- Tests `publish.test.ts` (10) on `test-fixtures/publish/runs/money-paris/` and the recorded replies `test-fixtures/publish/replies{,-repair}/`.
- Checks on `wt-publish` (`ddf56aa` + these files only): tsc 0, eslint 0, npm test 857 tests, 0 failing.
- Checked by hand in `out/agentPUBLISH/`: the fixture run (9:16, b3 the Paris plaza, 1080x1920, PNG 3.0 MB plus a 383 KB JPEG), the forest milestone at 16:9 (the hook's shot, 1280x720, 4 chapters, code titles). Only recorded replies or none: no model was called.

## Committed
- `700d8e9`: this status file.
- `b0b7e9a`: the publish pack: `src/generator/publish/{pack,titles,thumbnail,index,publish.test}.ts`, `scripts/publish.ts`, `test-fixtures/publish/*`, `docs/factory/20-publish.md`, this file.
- (this commit) this file: the hash, the worktree removed.

## Uncommitted
- Nothing.

## Next
For the coordinator or the variants agent (not my files), as in 20-publish.md §4:
1. `generate.ts` `renderOnly`, after `report.json` (L827 at `ddf56aa`): behind a `--publish` flag, `await makePublishPack(id, { serveUrl: bundleDir })` in a try/catch (`bundleDir` from `freshBundle(id)` at L781, or `ensureBundle()` with `--chunked`).
2. `server/index.ts`: `POST /api/videos/:id/publish` (a job running `npx --no-install tsx scripts/publish.ts <id>`), `GET /api/videos/:id/publish` (the `publish.json`); the files are already under `/media/<id>/publish/`.
3. `ui/src/`: a "Publish pack" button on the done screen and the library: titles with copy buttons, the description, the tags, the thumbnail (`thumbnail.upload`), the credits, the warnings.
4. Later: a description template in the channel profile (15 §7) for `buildDescription`.

## Worktree and outputs
- Check worktree `C:\Users\Dell\Documents\remotion-ai-factory\wt-publish`: removed after the checks (junctions `node_modules`, `public\assets`, `public\library` first).
- `out/agentPUBLISH/`: `bundle/` (its `public` is a junction: `rmdir out\agentPUBLISH\bundle\public` before deleting it), `output/{money-paris,forest-16x9}/publish/` (the two trial packs), `log1.txt`, `log2.txt`.

## Findings for others
- `src/world/modelset/sets.ts` says model sets are CC0 only because "a CC-BY model's credit line would have to reach the video's description": `creditsOf` now credits `scene.modelSet.model` in the pack's description, so that reason holds only for `report.json` (generate.ts credits the places only).
- While I worked, `src/generator/audio-room.test.ts` (another agent's, untracked) failed `tsc` at L185 in the shared tree; the clean worktree left it out.
