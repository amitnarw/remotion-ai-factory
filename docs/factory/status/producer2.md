**Done** (2026-11-05): every task is committed, and the worktree is removed.

# Producer2 agent: status (2026-11-05)

## Task
In order, each committed on its own:
1. P2's leftovers (15-producer.md §12 "Not built yet"): the as-written word lock in Ask AI, a channel profiles settings page, the adapt mode's lost-plot check, the story checker.
2. The code map's §7.5 items 6, 7, 9 and 11 (16-code-map-pipeline.md).
3. Gate 2's small items (15 §14 "Not built yet"): the shopping list's "Sources" line with `--sources none`, more offers or a pasted link from a card, a preview still after Get (if cheap), a wizard switch for gate 2.
4. P5, the producer you talk to (15 §2, §9): `npm run producer -- ...`, a chat panel on a run in the dashboard, tests on recorded replies.
5. From other agents (via the coordinator): `critic.ts` notes the bullet-time beat (bullet2); `shots.ts` `PLACE_SUBJECT` takes `belfry` (polish).
6. From the coordinator: a character's line played over the globe flight in the bullet-time test video (Karim's b4).

Files owned: `src/generator/generate.ts`, `src/generator/env.ts`, `src/generator/ai/*`, `src/generator/pipeline/*` and tests, `src/generator/library/*`, `src/generator/film/*`, `server/*`, `ui/src/*`, `ai.config.json`, `package.json` (scripts only), `test-fixtures/pipeline/*` (not `bullet-test/`), `channels/*`, docs `15-producer.md` (§15, §16), my entries in `16-code-map-pipeline.md`, this file. Also one line in `.gitignore` (`ai.config.local.json`, item 7).

## Committed
- `84553f6`, `9fede81`, `c0117cb` this file.
- `e813abb` 1a, the word lock in Ask AI for as-written runs.
- `1f1c467` 1b, Settings > Channels (edit a profile, copy one into a new channel).
- `9774996` 1c/1d, the story checker and the adapt mode's lost plot points (`check` stage, `story.check.json`).
- `e848f64` task 2, code map 7.5 items 6, 7, 9, 11: one reader for ai.config.json and .env; the dashboard writes `ai.config.local.json` (git-ignored, one line added to `.gitignore`); `editProblem`; one render request.
- `343dccf` task 3, gate 2: the sources searched, more offers and pasted links from a card, the wizard switch. The preview still is not built (needs a composition in Root.tsx).
- `5ac7443` critic.ts: the bullet-time beat is frozen on purpose (bullet2). `79c365c` shots.ts: `PLACE_SUBJECT` takes `belfry` (polish).
- `65ab8b5` task 4, P5: `pipeline/{notes,producer}.ts`, `producer-cli.ts` (`npm run producer`), `server/producer.ts`, the Talk to the producer panel, `producer.test.ts`.
- `589d971` docs: `15-producer.md` §15 and §16, the code map's entries.
- `7f516b4` task 6, the flight and the speaker: `assemble.ts` takes a flight off after the last character line of the scene it leaves and lands it 0.2 s before the first one of the scene it reaches; narration may run over it. The bullet test's recorded replies now plan the flight 12.8-17.6 s (it was 12.8-20.7 s, over Karim's line at 17.8 s). The what-if fixture plans have no flights, so they are unchanged. Noted in 16's assemble.ts row; test in `assemble.test.ts`.
- Each code commit checked on the worktree: tsc, eslint, icons, ui:build pass; `npm test` all pass (799 tests at P5, 1 skipped).

## Uncommitted (in the dev laptop's tree)
- Nothing of mine.

## Next
- Nothing for these tasks. Left (15 §15 and §16, "Not built yet"): the preview still after Get; the brief check; a standing note as a channel rule; adding a beat; getting a need on a finished plan; the router with a real model.
- The bullet-time test video needs a new render to show the flight fix (bullet2's).

## Worktree and outputs
- `wt-producer2` was removed: its junctions with `rmdir` first, then `git worktree remove --force`. No renders.

## Findings and open points
- Gate 2's preview still after Get is not built: it needs a preview composition in `src/Root.tsx` and a bundle per intake (a minute or more), outside my files. The card shows the source's thumbnail.
- Open (from polish, not to fix now): `shots.ts` `subjectFromSee` counts stop-words such as "the"; fixing it changes recorded plans' rule shots.
