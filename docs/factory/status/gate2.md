**Done** (2026-11-05): both tasks are committed, and the worktree is removed.

# Gate 2 agent: status (2026-11-05)

## Task
1. Finish the channel-guides change (critic, director, sound designer), prove what-if stays byte-identical, commit, delete its patch.
2. Gate 2 in runs: the run stops at the shopping list (`needsToShop`, `findOffers`), resumes with approvals (`parseApprovals`, `approveAllFree`, `acquire`), then the director. CLI, server, dashboard (a Shopping list step and an Assets page), tests on a mocked fetch.

Files owned: `src/generator/generate.ts`, `src/generator/ai/*`, `src/generator/pipeline/{run,llm,manifest,resume,calls,writer,critic,director,sound,timeline,voice,captions,editor,script,breakdown}.ts` and tests (plus the new `shop.test.ts`), `server/*`, `ui/src/*`, `test-fixtures/pipeline/*` (not `bullet-test/`), `src/generator/render/bundle.ts` and `src/generator/audio-library.ts` (given by the coordinator), docs `15-producer.md` §14 and my entries in `16-code-map-pipeline.md`.

## Committed
- `ee0c153` Channel guides reach the director, the sound designer and the critic. The patch file is deleted. What-if byte-identical: the fixture plans money-doubles 9:16 and 16:9, forest-walks and oceans-vanish give the same files and stage input hashes as before; `prompts.test.ts` passes.
- `d820d0a` This status file.
- `9cd3afb` Gate 2 in the run, the CLI, the server and the dashboard (the Shopping list step, the Assets page), the in-process refresh after an intake (`setAcquiredModels`, `setAcquiredSounds`, `reloadLibrary`), and `acquired.catalog.json` in the render bundle's hash. Checks on the worktree: tsc, eslint, icons and ui:build pass; `npm test` 773 of 775 pass, 1 skipped, and the 1 failure is the known roads timing test under load, which passes alone.

- `38994ab` Docs: `15-producer.md` (§12's "for other owners" marked done, §13's "not built yet" pointed at §14, the new §14) and `16-code-map-pipeline.md` (the gate 2 entries). By hand, the job API on a second server (port 5199, fixtures, no source searched) passed: the stop, the list, refused bad input, the resume with choices, `/api/assets`.

## Uncommitted (in the dev laptop's tree)
- Nothing.

## Next
- Nothing for this task. Left for later (15-producer.md §14, "Not built yet"):
  - more results or a pasted link from the card;
  - the model preview still after Get;
  - a wizard switch for gate 2.
- With real models on the GPU machine, a premise whose story needs something missing stops at the shopping list. Run the printed `--resume <run> --all-cc0` line, or add `--no-shop-gate`.

## Worktree and outputs
- `wt-gate2` was removed: its junctions with `rmdir` first, then `git worktree remove --force`. The real `node_modules`, `.cache` and `public\library` are intact.
- No renders. The keeper fixture copy with the telescope and the check scripts are in the session scratchpad only.

## Findings for others
- Gate 2 stops only for a need nothing in stock stands in for (status `download`). A run whose needs are all have or close goes on; its close needs with a download gap are got only when choices are given in advance (`--all-cc0` on the first command) or at a stop for another need. This follows "runs whose needs are all have or close don't stop"; `needsToShop` alone would also stop for every close need with a download gap.
- `formatShopping` (library) lists every non-disabled source on its "Sources" line even when `--sources none` searched none.
- The coordinator's three points from the library agent are done in the gate 2 commit: the in-process refresh (`seeAcquired` in run.ts), `reloadLibrary` in audio-library.ts, and `acquired.catalog.json` in `sourceHash` (every cached bundle is built once more).
