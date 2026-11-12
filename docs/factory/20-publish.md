# 20 — The publish pack (2026-11-05)

Every finished run can get a pack ready to upload to YouTube by hand: three title options, a description, tags and a thumbnail. Borrowed from an automated motion-design system's delivery step. **Nothing is uploaded anywhere:** the pack is files only.

## 1. What it writes
`output/<run>/publish/`:

| file | what |
|---|---|
| `publish.json` | everything below, as data (`PublishPack` in [publish/index.ts](../../src/generator/publish/index.ts)) |
| `description.txt` | the description, as it is pasted |
| `thumbnail.png` | one still of the video, the hook over it |
| `thumbnail.jpg` | only when the PNG is over YouTube's 2 MB limit for a custom thumbnail: a JPEG copy, the one to upload (`thumbnail.upload` names it) |

`publish.json` has no clock value: the same run and the same reply give the same file.

## 2. Who makes each part
- **Titles and tags: one model call** on the writer role's model (no role of its own), label `publish`, in [titles.ts](../../src/generator/publish/titles.ts).
  - The prompt gives the working title, the hook, the mood, the places shown, the format and length, and the narrator's lines. The system text gives the channel's name, genre and description.
  - The rules: three titles, each a different angle (the premise, the payoff, the most surprising image), at most 70 characters, no emoji, hashtags or quotes, promise only what the video shows; 8 to 15 tags, lowercase, the most specific first.
  - Code cleans the reply ([pack.ts](../../src/generator/publish/pack.ts) `cleanTitles`, `cleanTags`): quotes and hashtags off, no `<` or `>`, titles at most 100 characters, distinct tags (case-insensitive) of at most 60 characters, all of them within 500 counted YouTube's way. Fewer than three distinct titles is asked again (`callRole`'s repair loop). The places the video shows are always added to the tags.
  - The reply is saved in the run's `.calls/` like every other role's, so publishing again asks no model.
  - **No model** (no key, no recorded reply, three bad replies): code titles stand in (the story's title, the hook, the premise, the title with the places, the first line), `titlesFrom: "code"`, and `warnings` says why. The pack is never blocked by the model.
- **The description: code** (`buildDescription`), in this order, blocks separated by a blank line:
  1. the hook;
  2. a short summary in the video's own words: the beats' lines in order, about two to three sentences, at most 300 characters (`summaryOf`);
  3. **chapters, long form only** (`chaptersOf`): a landscape video of 60 s or more. The first at 0:00 (named by the hook), then a new chapter at a beat's start once the current one has run about a sixth of the video (10 to 90 s), named by that beat's first clause (7 words at most). A last chapter under 10 s is not started. Fewer than three: none (YouTube's rules: the first at 0:00, at least three, each at least 10 s);
  4. **the credits** (`creditsOf`), under "3D model credits": every CC-BY model the video used, required by the decision of 2026-10-23. They come from the catalog: `creditsForPlaces` for the landmarks of the world scenes' places (as `report.json` lists them) and `creditsFor` for a model set's model; a line of an older `report.json` for a model the catalog lines don't name is kept. The description is never cut in the credits: an overlong one shortens the summary;
  5. hashtags: `#Shorts` for a vertical video, then two or three one-word tags.
- **The thumbnail: code picks, the composition draws** ([thumbnail.ts](../../src/generator/publish/thumbnail.ts)).
  - **The frame** (`pickThumbnail`): the still the photographer scored best, when `output/<run>/qa/qa.json` exists; else the middle of the hook's shot (the photographer's `shotFrames`: never inside a lightning flash, in a bullet time's hold); `--frame N` overrides. The score (`stillScore`): colourfulness × (1 − flat share) × exposure near 0.45, less for clipped or crushed pixels; a still the photographer flagged never wins over a clean one.
  - **The picture** is the video's own composition, `WhatIfVideo`, rendered as one still (`renderStill`, as the photographer does) from `thumbnailSpec`: the video's spec with no captions, no sound cues (a still has no sound; a plan's unresolved sound path would fail it) and the hook shown over the whole video. So the hook text is drawn by the video's own Hook, in the run's caption style (`settings.captions`, the channel's when the run named none), at the size and place the video uses. Everything else (the scene, camera, grade, HUD) is the frame as rendered.
  - **The size** (`thumbnailSize`): 1280x720 for 16:9 (rendered at scale 2/3), else the format's own size (1080x1920, 1080x1080).
  - **The bundle:** `--bundle <folder>` (a bundle whose `public` is a junction), else the chunked render's cached bundle (`ensureBundle`, out/phase4-bundles/). A failed render leaves the text files, `thumbnail.file: null` and the reason in `thumbnail.skipped` and `warnings`.

## 3. The command
```
npx tsx scripts/publish.ts <run> [--bundle out/<folder>] [--frame N] [--no-thumbnail] [--output-dir <dir>]
```
- Reads `output/<run>/`: `props.json` (the rendered spec) or `spec.json`, plus `report.json`, `brief.json` (the channel and premise) and `qa/qa.json` when they exist. Old flat runs (`output/<id>-spec.json`) are not read.
- Prints the titles, tags, credits, the chapter count, the thumbnail and `PUBLISH_DIR: output/<run>/publish`.
- On recorded replies: `FACTORY_LLM_FIXTURES=<dir>` with `<dir>/publish-1.txt` (as every role).
- `--output-dir` reads and writes runs in another folder (trials).

## 4. Wiring it in (done in `8434ccc`: `--publish`, the publish routes, the Publish pack panel)
**The run** (`src/generator/generate.ts`, `renderOnly`, after `report.json` is written: `reportPath`, L827 at `ddf56aa`): optional, behind a flag such as `--publish`, so renders don't change by default.
```ts
import { makePublishPack } from "./publish";
// ...after writeFileSync(reportPath, ...):
if (args.publish) {
  try {
    await makePublishPack(id, { serveUrl: bundleDir }); // the bundle the video was rendered from
  } catch (e) {
    console.warn(`[publish] skipped: ${e instanceof Error ? e.message : String(e)}`);
  }
}
```
`bundleDir` is the value `freshBundle(id)` returns on the default path (L781, `out/render-bundle-<id>`; hoist it out of its block), or `(await ensureBundle()).dir` with `--chunked`. Passing it saves a second bundle. When the photographer runs after the render, run the pack after it (or again): only then does it pick the photographer's best still.

**The server** (`server/index.ts`):
- `POST /api/videos/:id/publish` → start a job that runs `npx --no-install tsx scripts/publish.ts <id>` (like `runJob`; it opens a browser for the still, so a child process keeps the server free), and answer `{ jobId }`. Its last line is `PUBLISH_DIR: ...`.
- `GET /api/videos/:id/publish` → `output/<id>/publish/publish.json` (`PublishPack`), 404 when there is none.
- The files are already served by the static `/media` route over `output/`: `/media/<id>/publish/thumbnail.png` (and `thumbnail.jpg`).

**The dashboard** (`ui/src/`): on the done screen and in the video library, a "Publish pack" button (calls the POST, then polls the GET), showing the three titles with copy buttons, the description (`description.txt`) with a copy button, the tags as a comma list, the thumbnail (`thumbnail.upload` to download) and the credits, plus `warnings` (for example "titles from code").

**For the variants agent or the coordinator:** the functions are
- `makePublishPack(runId, { outputDir?, models?, serveUrl?, thumbnail?, frame?, render?, channel?, log? }): Promise<PublishPack>` (writes the files);
- `buildPack(readRun(runId), opts)`: the same pack without writing anything or rendering;
- `readRun`, `creditsOf`, `chaptersOf`, `buildDescription`, `pickThumbnail`, `thumbnailSpec`, `thumbnailSize` in `pack.ts`, all pure.

## 5. Tests and the check by hand
- `src/generator/publish/publish.test.ts` (10 tests): on the saved run `test-fixtures/publish/runs/money-paris/` (the Paris money video's spec, a trimmed report, photographer checks made for the test: the best clean still is b3, the most colourful one is flagged) and the recorded replies `test-fixtures/publish/replies/` (a reply in a code fence after a `<think>` block, quoted titles, a hashtag) and `replies-repair/` (two titles, one a case-only repeat, then a good reply under other key names). The renderer is a stub there.
- By hand (2026-11-05, `out/agentPUBLISH/`): the fixture run (9:16, the photographer's b3: the Paris plaza with its bell tower and the hook in the reference serif; 1080x1920, PNG 3.0 MB, so a 383 KB JPEG copy) and the forest milestone at 16:9 (no checks: the hook's EWS; 1280x720, 1.0 MB; code titles, since no reply was recorded; 4 chapters).

## 6. Not built, and limits
- The channel profile has no description template yet ([15-producer.md](15-producer.md) §7 lists one): when it gets one, `buildDescription` should fill it.
- The counter or timer HUD shows on the thumbnail when the video shows it at that frame (it hides only where it waits for the hook).
- A Short's cover may be chosen in the YouTube app instead; the still is written at the format's own size either way.
- Only models the scenes name are credited: the places' landmarks and a model set's model. The kit cast (`assets.catalog.json`) is all CC0 today; an acquired CC-BY model placed some other way would need its id added to `creditsOf`.
