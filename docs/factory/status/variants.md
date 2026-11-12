**Done** (2026-11-11): the variants, the claims wiring and the publish wiring are committed, and the worktree is removed. **Waiting:** the brand step (Next 1) needs the P6 agent's `spec.brand` commit first.

# Variants agent: status (2026-11-11)

## Task
Variants from one run: one run makes several versions of the same video (alternative hooks from the writer, alternative endings, other formats 9:16, 16:9, 1:1). Everything else is reused (the story, the voices of the unchanged lines, the plan, the render chunks); only what differs is voiced and rendered again.
- CLI: `--variants hooks=3,endings=2,formats=9:16,16:9`, and a `variants <run>` command to add them later.
- Output: `output/<run>/variants/<id>/video.mp4`, with `variants.json` listing what each differs in.
- Dashboard: a Variants panel on a finished run (choose counts, render, list the results).
- The default (no variants) byte-identical: fixture plans and `prompts.test.ts`.
- Tests on recorded replies (`FACTORY_LLM_FIXTURES`), with a fixture for the hooks reply.

Then the coordinator's queue: the claims wiring, the publish-pack wiring, then the brand bumpers in the video's length.

Files owned: `src/generator/generate.ts`; `src/generator/pipeline/*` and tests except `critic.ts`, `claims.ts`, `ai/roles.ts`, and (since 2026-11-11, the P6 agent's) `director.ts`, `assemble.ts`, `shots.ts`, `sound.ts`; `src/generator/render/*`, `src/generator/film/*`; `server/*`; `ui/src/*` except `ui/src/pages/settings/Channels.tsx`; `test-fixtures/pipeline/*`; docs `15-producer.md` §17, my entries in `16-code-map-pipeline.md`, this file.

## Committed
- `866037d`, `ddf56aa` this file.
- `94edb16` (a fork of this agent) the server and the dashboard: `server/variants.ts` and `server/variants-ask.ts` (GET and POST `/api/runs/:runId/variants`), `server/jobs.ts` (`kind: "variants"`), `ui/src/api.ts` (`getVariants`, `makeVariants`), `ui/src/components/VariantsPanel.tsx` on the render done screen (`RunStep.tsx`) and the Library's video page, a toast in `ui/src/lib/jobs.ts`.
- `0896864` the pipeline, render and CLI side: `pipeline/variants.ts` (the ask, the writer's alternative hooks and endings, each spec on its format's own timing, the renders, `variants.json`), `variants.test.ts` (4 tests), the fixture `test-fixtures/pipeline/money-doubles/writer-variants-1.txt`, `generate.ts` (`--variants`, `variants <run>`), `run.ts` (`finish`, `timeStory` exported), `render/plan.ts` (`story.hook` keyed with the hook's slice, `PLAN_VERSION` 3), `render/{chunks,index}.ts` (`keepRuns`). Checks on `wt-variants` at `63aca43`: tsc, eslint, ui:build, icons pass; `npm test` 866, 865 pass, 1 skipped, 0 fail. By hand on the recorded replies: `--variants hooks=3,endings=2,formats=16:9 --no-render` (11 planned), then `variants <run> hooks=2,formats=1:1 --no-render` with no fixtures (the saved lines, no writer call), a bad ask refused.
- `f5c8959` the docs: `15-producer.md` §17, the entries in `16-code-map-pipeline.md`.
- `4656df3` **the claims wiring**, as `status/claims.md` "Next" items 1-6 say: `manifest.ts` (`claims` between `story` and `voice`, `story.claims.json`, "the claims check"), `run.ts` (the stage block after the story; `StoryGateStop.claims`; its warnings), `generate.ts` (the claims at the CLI's story gate), `server/index.ts` (`claims` in the story gate's answer), `ui/src/api.ts` and `PlanStep.tsx` (the story review's "Facts and figures": a badge per claim, the sentence, the beat, "Suggested" or "Changed to"), `server/progress.ts` (`claims: 20`). Tests: `manifest.test.ts` (the stage order), a new `resume.test.ts` case (a money-doubles copy with a dated beat and a `claims-1.txt`: the stage runs, saves `story.claims.json`, the claim reaches the gate, the what-if story is not rewritten). Recorded sets without `claims-1.txt` skip it, so the fixture plans are unchanged. Checks on `wt-variants` at `9d9a1f8`: tsc, eslint, ui:build, icons pass; `npm test` 877, 876 pass, 1 skipped, 0 fail.
- `8434ccc` **the publish-pack wiring**, as `docs/factory/20-publish.md` §4 says:
  - `generate.ts`: `--publish` (carried to the gates' resume lines, and taken by `--from-spec`). After `report.json`, `makePublishPack(id, { serveUrl })` with the bundle the video was rendered from (`freshBundle`, hoisted; `ensureBundle().dir` when chunked), in a try/catch (a failure only warns), then `PUBLISH_DIR: output/<id>/publish`. Without the flag nothing changes.
  - `server/publish.ts` (new, mounted in `index.ts`): GET `/api/videos/:id/publish` (`publish.json`, 404 when none, plus a running publish job's id); POST runs `scripts/publish.ts <id>` as a job (`kind: "publish"`; 404 without `video.mp4` and `report.json`, 409 while one runs). `server/jobs.ts`: `runJob` takes `script`; no new thumb for a variants or publish job.
  - `ui/src/api.ts` (`getPublishPack`, `makePublishPack`, `PublishPackInfo`), `ui/src/components/PublishPanel.tsx` (new: the button, the job followed, the titles with copy buttons, the description and tags with copy, the thumbnail and its download, the credits, the warnings), on the done screen (`RunStep.tsx`) and every Library video page; `ui/src/lib/jobs.ts` toasts "Your publish pack is ready".
  - Checks on `wt-variants` at `30efe84` + these files: tsc 0, eslint 0, ui:build 0, icons clean; `npm test` 880, 879 pass, 1 skipped, 0 fail. Not run by hand: a real pack through the button (it renders a still in a browser); a pack per variant.
- `f84613a` the code map's claims stage and publish routes (16), this file.

## Uncommitted (in the dev laptop's tree)
- Nothing of mine.

## Next
1. **Queued (the coordinator): the brand bumpers in the video's length**, once the P6 agent's commit adds `spec.brand` (the coordinator sends the hash). Exactly as `docs/factory/status/brand.md` items 4 and 6 say: `src/generator/render/index.ts` (`durationInFrames = brandedFrames(secToFrame(videoSeconds(spec), fps), brandOf(spec), fps)`), `src/generator/generate.ts` `durationFrames` the same, `ui/src/preview/PlayerPreview.tsx` (the Player's length with `brandedFrames`). Unbranded videos stay byte-identical (`brandedFrames` returns its input without a brand). Make a fresh worktree from HEAD for its checks.
2. Left from variants (15 §17 "Not built yet"): a real render of the variants on the GPU machine (`npm run generate -- variants <run> hooks=2` on a rendered run: 1 chunk rendered, the rest reused); ~~the editor's caption overrides do not reach the variants; a publish pack per variant~~ done by the fixes agent (status/fixes.md item 3): the editor's caption wording carries into every version where its caption has the same words, and a rendered version gets its own pack in `variants/<id>/publish/` when the run has one (so `--publish --variants` makes them all). Not wired: the dashboard's Publish pack panel and `/api/videos/:id/publish` show only the run's own pack.

## Worktree and outputs
- `wt-variants` is removed (both the one from before the 2026-11-11 merge and the fresh one): its junctions with `rmdir` first, then `git worktree remove --force`. The real `node_modules`, `.tts`, `public/assets` and `public/library` are intact.
- No renders.

## Findings for others
- `docs/factory/20-publish.md` §4 and `status/claims.md` "Next" still say "not done": both wirings are in (`8434ccc`, `4656df3`). Their owners or the coordinator can mark them.
- `status/brand.md` items 5 and 7 are not this agent's files: `src/compositions/WhatIfAudio.tsx` (the sound after the intro) and `src/generator/qa/*` (the stills' times in a branded video).
- `status/claims.md` item 7 (the checker's own claims list repeats the claims check at the gate) is in `checker.ts`, mine, but dropping it changes the checker's recorded replies; left as it is until the coordinator asks.
