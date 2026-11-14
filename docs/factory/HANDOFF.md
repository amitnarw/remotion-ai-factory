# Handoff: start here on any machine (updated 2026-11-12)

This page is for whoever picks the work up next, person or AI session, on either machine. It holds the standing rules, exactly where the work stopped, and what to do next.
- **The map of the whole factory:** [00-overview.md](00-overview.md).
- **The phase table and the history:** [PROGRESS.md](PROGRESS.md).
- **Every file:** the code maps [16-code-map-pipeline.md](16-code-map-pipeline.md) and [17-code-map-world.md](17-code-map-world.md).

If you're an AI session, read this page, then 00-overview.md, then continue from §2 (the live table), then the status files it names.

## 1. Rules for every AI session in this repo
These are the user's standing instructions. Claude Code's memory on the dev laptop is not in the repo, so this list replaces it on any other machine.
- **Never play audio.** Check sound by measuring files (loudness, true peak, duration, silence, overlaps). The user listens to the videos themselves.
- **Commit locally on `dev` only.** Never push, fork, open pull requests or issues, or contact anyone about the repo. The user pushes when they choose.
- **No paid model APIs.** Don't use `ANTHROPIC_API_KEY`. The user has an Ollama Pro plan, and each pipeline role picks its own model in Settings → AI models. On a machine without `.env`, run plans on recorded replies: `FACTORY_LLM_FIXTURES=test-fixtures/pipeline/<name>`.
- **The look and the sources:**
  - stylized low-poly 3D only, no image-generation models;
  - sound from CC0 libraries only;
  - cities from our own regional style rules, no OpenStreetMap;
  - downloads only under the licence policy in [15-producer.md](15-producer.md) §5 and §13.
- **Original work only:** devices such as bullet time are generic techniques. Test scenes and examples use our own characters, places and staging, never a film's characters, look, dialogue or scenes (decision of 2026-11-03).
- **Research before building:** before writing a new subsystem, look for existing tools and CC0 assets and propose adopt / borrow / build to the user.
- **Nothing appears without AI intent:** everything on screen or in the mix is there because a role chose it, or follows from what it chose ([10-intent-audit.md](10-intent-audit.md)).
- **The crowd and featured actors stay off by default** (the user's decision, 2026-10-24). Featured actors show only when a scene lists `actors`.
- **Don't stop to wait on a render:** keep working, and wait inside the turn.
- **Several chats or agents may work in this repo at once:**
  - say which files you own, edit only those;
  - commit by file name (never `git add -A` or `git add .` over someone else's uncommitted work);
  - never revert a change you didn't make;
  - commit in small working steps, so a session that ends loses little.
- **Folder links (junctions):**
  - Every render bundle (`out/phase4-bundles/`, `out/agent*-bundle*`, the CLI's `out/render-bundle-<id>` since 728edf6) and every check worktree holds `public`, `node_modules`, `.cache` or `.tts` as directory junctions to the real folders.
  - Remove a junction with `rmdir <path>` (cmd) before deleting its folder, and remove a worktree with `git worktree remove --force <path>` only after its junctions are gone.
  - **Never delete recursively through a junction:** it would delete the real `node_modules` or the asset and sound library.
- **Check worktrees** live next to the repo (`C:\Users\Dell\Documents\remotion-ai-factory\wt-<name>`), never inside it: the tests, tsc, eslint and the bundler would pick up a copy inside the repo.
- **Scratch files** go in your own subfolder of the session scratchpad, never at its top level (agents overwrote each other's scripts there).
- **Checks before a commit:**
  - `npx tsc --noEmit`;
  - `npm test` (about 760 tests);
  - `npx eslint src server`;
  - `npm run ui:build`;
  - `node scripts/check-ui-icons.mjs`.

  When others have uncommitted edits in the tree, run the checks on a clean worktree holding only your files. `roads: fast enough to build at render time` fails when the CPU is busy; it passes alone (open item §3.3).

## 2. Live: what is being worked on now (2026-11-12)
**If you are resuming, on either machine:** two sessions stopped mid-task on 2026-11-12. Their uncommitted edits are on disk on the dev laptop (`git status`), and each is also committed as a patch in [wip/](wip/) so it reaches any other machine: apply it there with `git apply docs/factory/wip/<file>.patch` (delete the patch once the work is committed). Each agent's `status/<agent>.md` lists its files with the exact next step — right now: [status/vfx-director.md](status/vfx-director.md) (the vfx-fire fixture's draft render is done; its proof, commit and worktree removal are left) and [status/root-path.md](status/root-path.md) (the bundler's drive-letter fix: written, not checked). Run the checks in §1, commit, then remove the leftover check worktrees next to the repo (`git worktree list`) the safe way: junctions first (§1) — `wt-vfxdir` is still there, holding the fixture's finished draft render.

**If the repo reached you as a zip (2026-11-12, built on the dev laptop, no push/pull):** it arrives already a working `dev` repo — one setup commit holds all committed work (the two `wip/` patches included), and the two stopped sessions' edits sit uncommitted in the tree exactly as their status files say. Do **not** run `git apply` (the files are already here; the patches are for a fresh push/pull clone, and they are the record of this state). The setup commit is the only one, so the commit hashes cited in these docs (`50d5570` and the rest) point at the dev laptop's history and cannot be resolved here — the files' current state is what matters. The zip carries: the current code and docs, `.claude`, `acquired.catalog.json`, `public/` minus `library` (the 3D models and every tracked asset: fonts, the sfx fallbacks, whatif-data, the brand logo), `.cache/voice` (the TTS line cache — the vfx fixture's re-render replays it, no voice engine needed), and the fixture's finished draft render (`wt-vfxdir/output/…36d318/video.mp4`; `wt-vfxdir` here is a plain folder holding only that render, so its status file's worktree-removal step reduces to deleting that folder once the proof is done). Not in the zip — everything there is generated on arrival: `node_modules` (root and `ui`) from `npm ci --legacy-peer-deps` and `cd ui && npm install`; `ui/dist` from `npm run ui:build`; `public/library` from `npm run audio:library` (CC0 sounds and music, needs internet); the voice engines (`.tts`) from Settings → Voice engines; the rest of `.cache` from the same setup scripts (`world:assets`, `world:catalog`) and from renders; `public/whatif-audio/room` and the render-time caches regenerate themselves during a render; `public/voice`'s untracked per-run audio refills when a render runs with an engine installed. First steps: `npm ci --legacy-peer-deps`, `cd ui && npm install`, `npm run ui:build`, then the §1 checks — then continue from the rows below. Install kitten2 from Settings → Voice engines only when a render needs a line the cache lacks; add `.env` with `OLLAMA_API_KEY` when the GPU tasks (§4) start.

Work restarted on 2026-11-05 with five parallel agents, each owning separate files. **Each running agent keeps its own status file in [status/](status/)**, committed with every code commit: its task, what is committed (hashes), what is uncommitted, its next step, and its worktree. If a session ends, read those files first: each says exactly where its agent stopped.

| Agent | Task | Status file | State |
|---|---|---|---|
| gate2 | the channel-guides patch, then gate 2 (the shopping list in the CLI, the dashboard's Shopping list step, an Assets page), plus the library's follow-ups (bundle hash, in-process reload) | [status/gate2.md](status/gate2.md) | **done**: `ee0c153` (guides; what-if byte-identical), `9cd3afb` (gate 2), `38994ab` (docs: 15 §14). The run stops at gate 2 only when a need has nothing in stock standing in for it; `--resume <run> --all-cc0`, `--approve n6=... n2=close`, `--no-shop-gate` |
| producer2 | P2's leftovers (as-written word lock in Ask AI, a profiles settings page, the adapt lost-plot check, the story checker), the code map's §7.5 items 6, 7, 9 and 11, the gate-2 small items, then P5 (the producer you talk to); also the critic's bullet-time note and the belfry in `PLACE_SUBJECT` | [status/producer2.md](status/producer2.md) | **done**: `e813abb` (word lock), `1f1c467` (Channels settings page), `9774996` (story checker, adapt's lost plot points), `e848f64` (§7.5: one reader for `ai.config.json` and `.env`; **the dashboard now writes the git-ignored `ai.config.local.json`**), `343dccf` (gate 2's small items), **`65ab8b5` P5, the producer you talk to**, `5ac7443` (critic's bullet-time note), `79c365c` (belfry shots hold), `7f516b4` (a flight never covers a character's line), docs `589d971` (15 §15-16). Use: `npm run producer -- say <run> "make scene 2 at night"`, then `ok <run> [p1]`, `no`, `undo`, `notes`; then `npm run generate -- --resume <run> --chunked`. Dashboard: "Talk to the producer" on the story review, plan review and editor. Only run on recorded replies so far |
| p6 | P6: new actor actions from clips already on disk, then model sets (one catalog model staged as a whole set: a ship, a lighthouse, a cabin) | [status/p6.md](status/p6.md) | **done (2026-11-11)**: `60ff5d8` (the director's `modelSet` choice from the generated list, the assembler's `model-set` scenes, shots on the set's parts, spots and actors; `worldCast` passes a pickup's prop), `e62248f` (registry: a set need a ship or lighthouse can stage is have), `53b2f46` (the brand spec field), `3047235` (`ModelSetStage.tsx` and the router: sea, sky and light by time of day, fog, weather, the islet, actors on the set's spots), `1c1f82b` (sound beds; [19-model-sets.md](19-model-sets.md)). Evidence `out/agentP6/sheet-model-sets.png` (the ship at golden hour and night with a sailor walking the deck; the lighthouse with its keeper). Existing videos unchanged (5 fixture plans, 24 of 24 frames). **Left:** a model-set scene's frame hashes at 2 and 6 tabs; a sound name for the library's creaks (`audio-resolve.ts`); interiors, more kinds, a ship's bob and roll, a lit lantern; a real-model run where the director picks a ship itself. Before 2026-11-11: stopped at the user's hard stop, partly done. Committed: `3632df3` (actions punch, kick, crouch, stand, pickup, putdown from clips on disk; one `ACTOR_ACTIONS` list for the schema, director and registry; no pack has a climb clip), `bebc075` (model-set geometry: a pure glTF reader, the floor, solids and walking routes from the triangles; CC0 ships scaled to 26 m, lighthouses 19 m), `afdc3d3` (`kit: "model-set"` and `scene.modelSet` in the schema, the ship's deck spots, the lighthouse's islet, camera subjects with the model's blockers; 1,800 lenses per set pass the sight-line test; a sailor walks the deck). **Not built yet** (exact steps in its status file): the director's `modelSet` choice and prompt list, the assembler branch, shot subjects, the registry entries, `ModelSetStage.tsx` and its stills, the router edit (written in the status file), `19-model-sets.md`. Two small edits for others' files are in its status file: `camera/world.ts` `worldCast` passes a pickup's prop; `sound.ts` beds for `model-set` |
| determinism | the street and park frames that differ between runs; the roads timing test | [status/determinism.md](status/determinism.md) | **done**: `d876a47`, `0b380a0`, `11c40a6`, `e3b5309`, `9db156c` (four causes, the main one: `glb.tsx` drew each tab's first frame without the grade; see [09-phase3-handoff.md](09-phase3-handoff.md) §4). The roads test times CPU, best of three. **Follow-ups done** (`4b947e4`): `d65751e` (ShotCamera's lens and the storm flash from the frame's own camera), `888c6f3` (the kit stages own their fog, background and draw order every frame: 95 frames identical in 5 runs, 55 of 95 before), `c6fc4f7` (GroundWorld takes away only the fog and background it set), `2665abc` (the teal ocean plane is gone: the coast's water is the terrain's own water faces, and a drain still leaves a dry bed; New York's and San Francisco's aerial and plaza frames change). **Not fixed:** the Paris money video's frame 349 (not reproduced on old or new code); the flight's car-light pools after a ground loads in a tab (transparent quads fail the depth test on that first frame; what was ruled out and two candidate fixes are in its status file) |
| bullet2 | render the bullet-time test video end to end, the 2-pixel flip, the photographer's notes for the window | [status/bullet2.md](status/bullet2.md) | **done**: `b8eaca6` (the flip fixed: reaction pieces in a fixed draw order), `bd0cc45` (the photographer's notes), `13fb5d5` (the fixture's timing, 14's Status). **The test video:** `out/agentBULLET/test-video/final/video.mp4` (1080×1920, 38 s; -14.1 LUFS, -1.3 dBTP; sheets and `sound.txt` beside it; the nine slow-down files in `final/bt/`). Hold frames 30 of 30 identical at 2 and 6 tabs and reversed |
| review | the test video's other faults: the hook's beige haze over Cairo, the tense music's near-silent start, litter still falling 3-4 s after gravity-on (Karim's line over the flight went to producer2) | [status/review.md](status/review.md) | **done**: `338265a` (a music track whose first 5 s are more than 8 LU under itself gives way to another of its mood: 8 of 40 tracks open quiet; seven saved runs change track), `7fa0272` (gravity-on lands everything within about 1.5 s: chips 9.8 → 1.3 s in the bullet scene, 24.7 → 1.9 s after a 6 s lift; frames before gravity-on byte-identical), the haze fix via the places agent (`6440ebc`). Left: the test video's re-render (the coordinator's combined check); a real intro skip would need a start offset in the spec (written up in 03-audio-sources.md) |
| polish | the bell tower as a camera subject, brick texture on painted walls, wet streets in rain, no sun glare over stormy flights | [status/polish.md](status/polish.md) | **done**: `b5cf946` (glare), `4af3f66` (bell tower subject), `0442e4f` (wet streets), `bb6e3e5` (brick and stone), `5791252` (docs). No render cost measurable (noisy timings). A trap it found is noted in 06: three's vertex shader names an instance colour `USE_INSTANCING_COLOR`, not `USE_COLOR` |
| places | more real places that reuse a region style and have their landmark in stock (Rome first: the breakdown asks for it, the Colosseum is in the catalog) | [status/places.md](status/places.md) | **done** (`be89422`): `7b576b3` (**Rome, London, San Francisco**: the Colosseum, Big Ben, the Golden Gate Bridge over its own bay), docs `e2878a2`, `87e4323`; **`6440ebc` the hook's haze fix** (the scene EWS no longer stands 1.6-1.8 km out in the fog; in a scene that films the place wide, its other shots differ only in the cars kept). The four old places 540 of 540 frames byte-identical; the new ones render the same twice (405 of 405). Sheets: `out/agentPLACES/sheet-{rome,london,san-francisco}.png`, `sheet2-bridge.png`. The haze fix's last check passed too: scenes with no scene WS or EWS byte-identical with and without it, 540 of 540 (`5e88e69`). Left as proposals: Athens (needs the Acropolis as an in-city hill) and an East Asian style, both proposals in its status file |
| variants | alternative hooks, endings and formats from one run, reusing everything else ([22-motion-system-comparison.md](22-motion-system-comparison.md)); queued after it: wiring the claims check and the publish pack into the run, CLI and dashboard | [status/variants.md](status/variants.md) | **done** (`884a8db`): `94edb16` (server routes, the dashboard's Variants panel), `0896864` (pipeline, render, CLI), docs `f5c8959` (15 §17). Use: `npm run generate -- "<premise>" --chunked --variants hooks=3,endings=2,formats=9:16,16:9`, or later `npm run generate -- variants <run> hooks=2,formats=1:1`; output `output/<run>/variants/<id>/video.mp4` with `variants.json`. A new hook or ending that fits its old slot re-renders only its chunk; another format renders every chunk. Also wired the claims check (`4656df3`) and the publish pack (`8434ccc`). **Left:** its brand step (`render/index.ts`, `generate.ts`, `PlayerPreview.tsx`) waits for the spec's `brand` field (P6); a real variants render on the GPU machine (the log should say 1 chunk rendered); caption edits don't carry into variants yet, and variants get no publish pack of their own |
| publish | a publish pack per video: titles, description with chapters and CC-BY credits, tags, thumbnail | [status/publish.md](status/publish.md) | **built, CLI only**: `b0b7e9a` ([20-publish.md](20-publish.md)). `npx tsx scripts/publish.ts <run>` writes `output/<run>/publish/{publish.json, description.txt, thumbnail.png}` (plus a `.jpg` when the PNG is over YouTube's 2 MB): 3 titles and tags from the writer's model (code titles with no model), the description by code (hook, summary, chapters for 16:9 of 60 s or more, the CC-BY credits, hashtags), a thumbnail at the photographer's best frame with the hook in the run's caption style. Uploads nothing. **Wired in `8434ccc`:** `--publish` makes the pack after the render (nothing changes without the flag); GET and POST `/api/videos/:id/publish`; a Publish pack panel on the done screen and the Library's video page. Not yet tried by hand through the button |
| brand | channel branding (logo, colours, fonts, intro and outro bumpers), then Flubber shape morphs | [status/brand.md](status/brand.md) | **built** (`ec59572`, `6258cfe`, `cdf2e06`; status Done at `9e1ef98`): an optional `brand` per channel profile (name, logo or a simple shape, three colours, caption and title fonts, a 1-2 s intro, a silent 2-4 s outro, a corner watermark; Flubber morphs), edited in Settings → Channels; only the action channel has one so far. Unbranded videos unchanged (299 of 300 frames; the other, card frame 228 of money-doubles 9:16, alternates on old and new code alike: an open street-stage nondeterminism); branded frames 82 of 82 identical. Sheet `out/agentBRAND/sheet-brand.png`. **Done end to end (2026-11-11):** `53b2f46` (the spec field, by P6), `2d69851`, `6de2f23`, `5134b8a`, `ee02753`, `67386d9`. A run passes the channel's brand (plan, `reassemble`, variants); `brand/length.ts` counts intro, story and outro for Root, render, generate and the preview; the sound starts after the intro; the photographer's stills, the chunk boundaries and the publish pack's chapters and thumbnail shift by it. The five fixture plans are unchanged. **The branded render:** `out/agentBRAND/action-video/video.mp4` (42.5 s = 1.5 s intro + 38 s story + 3 s outro; the 14 voice lines land at plan time + 1.5 s within 1 ms; sheet `sheet-action-video.png`). **Left:** the editor's timeline playhead runs 1.5 s ahead in a branded video (exact `Timeline.tsx` edit in status/brand.md); a spoken outro |
| claims | a story's factual claims found and judged at the story gate (strict for documentary) | [status/claims.md](status/claims.md) | **built, not wired yet**: `a994e24` (`pipeline/claims.ts`: code finds sentences with figures, dates, records, "scientists say" wording or named real things; the critic's model judges each as known, speculative or needs a source, with a rewording; documentary rewrites only the flagged sentences once; what-if lists; drama and action skip), docs `929ce60` (15 §18). What-if byte-identical. **Wired in `4656df3`:** a `claims` stage between the story and the voice; the claims show at the CLI's story gate and as "Facts and figures" on the dashboard's story review; recorded reply sets without `claims-1.txt` skip it. Open: the story checker (`checker.ts`) still lists claims too, a repeat (removing it changes the checker's recorded replies) |
| audio | room reverb by space and distance on effects, with FFmpeg | [status/audio.md](status/audio.md) | **done**: `63aca43` (`audio-room.ts`: FFT convolution in TypeScript, since Remotion's ffmpeg has no `afir`; generated impulse responses by space; distance from the shot size), docs `04f2f6a`, `b5d7c08`. On by default; `FACTORY_ROOM=off` gives the old output exactly. Masters unchanged (-14.0 to -14.2 LUFS, -1.2 to -1.5 dBTP on four fixtures). **Not heard yet** (the user's listening pass). Open: a per-video `settings.room`, and a per-hit `distance` from the sound designer (exact edits in its status file) |
| fixes | a batch of small open fixes: the editor's playhead in branded videos, the checker repeating the claims check, caption edits and publish packs for variants, a creak sound name, the street stage's frames under load, the flight's car-light pools, a model-set scene's frame hashes | [status/fixes.md](status/fixes.md) | **done (2026-11-12)**: items 1-4 committed (`e4507fc`, `3f84dfd`, `9f9518e`, `462ee97`), item 5b in `60630ac`, item 7 proved (60 of 60 frames the same, nothing to fix). Not fixed, timeboxed, next steps in its file: item 5 — the street's card HUD is sometimes captured from an older raster by Chrome (the shadow alone, or the cards drawn into the canvas, or a capture that waits for Chrome's raster) — and item 6 — the flight's car-light pools (log the scene's draws round a ground's first frame; a depth writer to find). Worktree and bundles removed |
| vfx2 | **the user's decision (2026-11-11): build our own VFX layer** ([21-vfx-effekseer.md](21-vfx-effekseer.md) §6): a closed-form emitter, six families (toon explosion, fire, smoke and dust, sparks, impact, magic), flash lights, flipbooks, a preview, a `VfxLayer` in the world. The director's `scene.vfx` and effect sounds come after, via the P6 agent's files | [status/vfx2.md](status/vfx2.md) | **done (2026-11-12)**: `bc054e2` (emitter), `6fd184f` (six families, `VfxLayer`), `5af9696` (procedural flipbooks), `e3b1cd4` (world hook-up), `40dae44` (previews), `3a749d4` (tuning), `b662b0f` (21's Status). Each family in 3-4 palettes with a closed-form flash light; nothing downloaded. **Proof:** effect frames byte-identical at 1 and 6 tabs, shuffled and one tab per frame (day 30/30, night 30/30, a Paris video with six effects 21/21); fire, smoke and sparks at their 80th second the same alone, in a run and at 6 tabs; videos without effects unchanged (Paris 70/70, street 10/10, bullet video 90/90 at 1 tab). Sheets in `out/agentVFX/motion/`. **Found:** an effect shows only if a shot films its spot (sent to vfx-director); at night the grade desaturates effects (flames read peach); the bullet video's last scene differs at 6 tabs in the base code too (sent to fixes). **Open:** a fire or sparks crackle bed (no CC0 one in the library), a loader for hand-baked Effekseer sheets, soft particles at walls |
| vfx-director | the director chooses effects: `scene.vfx` in the spec, the director's list and prompt, the assembler's timing and one hit sound per effect, the registry's six families, a fixture with an explosion or fire | [status/vfx-director.md](status/vfx-director.md) | running again (2026-11-12, second restart). Committed: `f19cc45` (`scene.vfx` in the spec), `d5ae53c`, `8631049` (the director's list and prompt; the assembler's timing and hits), `7ada21c` (a shot films each effect's spot; a bed under fire or sparks, the nearest name since no CC0 crackle exists; the designer hears the effects; a ship set's creaks), `ef1a99d` (the six families in the registry). Uncommitted: the `vfx-fire` fixture (an original story: a fountain catches fire and a gas main blows under the avenue, two Paris scenes, five effects), its director test and docs — also as [wip/2026-11-12-vfx-fire-fixture.patch](wip/2026-11-12-vfx-fire-fixture.patch). **The fixture's draft render is done** (`wt-vfxdir\output\what-if-the-fountain-in-the-square-caught-fire-36d318\video.mp4`, 750 frames, 25 s, -14.27 LUFS / -1.29 dBTP; the run was re-planned, id `36d318`): left are the stills, contact sheet and hits' loudness into `out/agentVFXDIR/`, the suite, the commit, then removing `wt-vfxdir` (junctions first). Exact steps in its status file |
| root-path | the bundler's project root with one spelling: a bundle built from a `c:\` cwd resolves modules twice and renders whole frames differently (found by fixes, `50d5570`; VS Code starts the process with either spelling); every bundler path now comes from `src/generator/render/root.ts` | [status/root-path.md](status/root-path.md) | **written, not checked (2026-11-12)**: new `render/root.ts` + `root.test.ts`, and `generate.ts` and `bundle.ts` take their paths from it — also as [wip/2026-11-12-render-root-path.patch](wip/2026-11-12-render-root-path.patch). Left: the checks on a clean worktree (the vfx-director's files are uncommitted in the same tree), a look at `render/index.ts:86`, the commit |
| vfx | research only: Effekseer against our own particles | [status/vfx.md](status/vfx.md) | **done** (`d17740b`, [21-vfx-effekseer.md](21-vfx-effekseer.md)). **Recommendation: build our own VFX layer from the closed-form particles; keep Effekseer's runtime out.** It is MIT and most samples are CC0, but it can't show an effect at time t (it re-steps from frame 0), it falls back to an unseeded `rand()`, it keeps per-tab state, and it draws outside three.js (no fog, other colour space). three.quarks and three-nebula fail the same test. Borrow its parameter model, and bake its CC0 samples to flipbooks once. Plan, about 9 days: a closed-form emitter, six effect families (a low-poly toon explosion among them), flash lights, flipbook import, a `scene.vfx` director choice. **For the user to decide** |
| **combined check** | the coordinator, after the first wave | — | **done 2026-11-05 at `5895465`:** `npm test` 834 of 834; the bullet-time test video re-rendered at final quality with every fix, `output/what-if-once-a-day-the-world-stopped-for-one-second-for-ever-654381/video.mp4` (38 s, -14.1 LUFS, -1.5 dBTP, 392 s to make). The hook now shows the city, not haze. Seen: b7's shot is a tight, low view of Karim's shoes (odd framing, not fixed). **Not done: the quiet timing against the 123 s bar** (needs no other renders running) |
| library | the acquired-catalog patch, BigSoundBank's licence check, sound names for acquired sounds | — | **done**: `afa6377`, `7afca56`, `e0064df`, `6ee4934`. None of the 24 BigSoundBank files in the library fails the stricter check |

**Pulled on 2026-11-11 (the other laptop's work):** `origin/dev` had one commit, `f4ce684` "voice fixes", made on the other laptop from a copy of this branch as of `48f8893` (2026-10-29) and committed on the old base `5588aaf`. It was merged on its true base (`434d131`, merge `56c3a53`), so only its own 33 files came in:
- the voice engine script and `tts.ts`;
- a much richer VoxCPM2 voice list and the new `voice-finish.ts`;
- voice references (upload, audition, a References panel), and voice previews;
- the server routes, the seed and job files in `scripts/`;
- `ai.config.json` with the director, sound, critic, vision and editor roles on an NVIDIA model.

`dd55568` records `origin/dev` as merged, so `dev` is ahead of the remote and behind by nothing: a normal push works. Left out as leftovers, with copies kept outside the repo and the originals still in `f4ce684`: `helpers` (saved `python --version` output), `server.pid`, a `.pyc`, and the four old dashboard pages the 2026-10-26 redesign replaced (`Generate`, `Providers`, `Setup`, `Videos`; nothing imports them). `.gitignore` now keeps pid and pyc files out. **`node_modules` was missing** on the dev laptop that day (the 914 MB `public/` was intact) and was reinstalled with `npm ci --legacy-peer-deps`. The checks after the merge: tsc, eslint, `npm test` 876 of 876, ui:build, the icon check. The remote branch `imp` (one commit, `341eb19`, 2026-10-29) was recorded as merged on the user's request (`9d9a1f8`) with dev's files kept: it was a copy of this branch as of `48f8893` whose only differences were the pre-rebuild docs and old dashboard pages dev had deleted on purpose, two temp scripts editing one of those pages, a `.gitignore` without the `ui/public/` rules, and a trimmed personal settings file.

**Remotion's agent skills (2026-11-11, `f7f76a7`):** 13 skills from `remotion-dev/skills` (best practices, captions, render, studio, upgrade, maps and others) are installed for Claude Code in `.claude/skills/`. They were reviewed: Markdown guides and example code; the only scripts prepare local map JSON. Only `skills-lock.json` is committed; on another machine run `npx skills experimental_install` to restore them.

**Since 2026-11-04:** the three leftover worktrees (`wt-bullet`, `wt-towns2`, `wt-weather4`) were removed, junctions first. Every edit in them was already on `dev`.

## 2b. Where the work stopped on 2026-11-04 (`8c2a009`), kept for the record
Between 2026-11-03 and 11-04 about 60 commits landed on `dev` (`6ec318d` to `8c2a009`). Then the user stopped all agents. Nothing is pushed.

### Done and committed
- **Camera:** locked (static) shots stand truly still (`6ec318d`). The plaza market's stalls block the camera's sight lines (`4f96700`).
- **Featured actors:**
  - no billboard switch kept between frames (`2bf5ebd`);
  - cars stop for actors in the road (`3eec668`, wired in `e5b0135`);
  - aim, shoot and dodge actions (bullet time).
- **Traffic:** headlight and tail-light pools on the road at night (`04db944`).
- **Providers:** "Get models" and "Test" work for the `ollama` package (`c0da000`).
- **Producer P1:** resumable runs, cached model replies, the story gate (`c252914`). Plus the code-map fixes (`728edf6`):
  - the date sorts;
  - the director's memory reads every video;
  - CLI bundles link `public/` instead of copying it;
  - no Windows-only render paths;
  - tests use temp folders.
- **Producer P2:** channel profiles `channels/{what-if,action,drama,documentary}.json`, the story modes premise / adapt / as written, the dashboard's channel picker and "use my own story" box (`d27de77`, `4601308`). What-if output is unchanged.
- **Producer P3:** the capability registry (about 4,870 entries from the code's own lists), the breakdown and the matcher roles, `scripts/breakdown.ts`. Wired after gate 1, informational (`0fa198b`, `b533e36`, `6f3784e`).
- **Producer P4, the library side** (`05730e7` to `080d2f3`):
  - source adapters: BigSoundBank live; Kenney, KayKit, Quaternius and FreePD index-only; Poly Pizza, Freesound and Sketchfab need the user's keys;
  - the licence check with saved evidence, and quarantine;
  - intake into `public/assets/acquired/` and `acquired.catalog.json`;
  - the `build-requests/` queue and `scripts/acquire.ts`.

  Kenney's site now refuses tool downloads (403): cached zips work, otherwise the user downloads the zip by hand ([15-producer.md](15-producer.md) §13).
- **Bullet time** (`aa6d9fa` to `7f50524`, docs `3cc5655`):
  - the warp clock, `scene.bulletTime`, the projectiles with trails and ripple rings, the dodge, the arc camera move;
  - the world, traffic and rain on the warped clock, the hold's grade shift, the slowed sound;
  - the director's device and checks, and the original test scene's recorded replies in `test-fixtures/pipeline/bullet-test/`.

  The ten open questions were taken as recommended ([14-bullet-time.md](14-bullet-time.md) §8).
- **Weather and water:**
  - rain, snow and storms (with a lightning bolt) in the real cities and on flight views (`e5b0135`, `c67e7d4`, `5c26516`);
  - the grade follows the real sun (`3df854a`);
  - river rise, vanish and return (`1c9c265`), ocean water-rise (`cd3bae2`);
  - the photographer, critic and night dips judge by the real sun and the weather (`402952a`, `36e1583`, `546fc8c`);
  - the rain bed and storm thunder (`d8d1516`).

  [18-world-weather.md](18-world-weather.md) has the detail.
- **Dressed places** (`ec32050`, `429405a`, `a01d042`, `22e2b6b`):
  - painted Paris and Colmar houses;
  - a bell tower on each old-town plaza;
  - hills behind the towns;
  - Cairo's flood follows the land;
  - New York gets fewer street trees, brick walk-ups, brick and stone mid-rises, and water tanks.

  Every chosen kit building now stands; half went missing before.
- **Kit stages** take the composition's fps (`4092acd`). Dead code was removed (`cd62613`). The scripts see the new run folders, and the audio audit really measures (`fdcd171`).
- **Docs:** the designs [14-bullet-time.md](14-bullet-time.md) and [15-producer.md](15-producer.md), the code maps 16 and 17, [18-world-weather.md](18-world-weather.md), [00-overview.md](00-overview.md).

### Unfinished, in the dev laptop's working tree (not committed)
These edits were written but their checks never ran. The type check passes with them in the tree. Copies are committed as patches, so they reach the other machine too.

| Work | Files | Patch | What is left |
|---|---|---|---|
| Channel guides for the critic, director and sound designer (15 §12 "needed from other owners") | src/generator/pipeline/{critic,director,sound,run}.ts | [wip/2026-11-04-channel-guides.patch](wip/2026-11-04-channel-guides.patch) | run the checks; what-if must stay byte-identical (`prompts.test.ts`, the fixture plans); commit |
| Acquired models merged into the world catalog (by id only; not in the pools the world dresses from) | src/world/catalog.ts | (deleted) | **done 2026-11-05 in `afa6377`**, with tests; renders byte-identical |

On the laptop, `git diff` shows them. Elsewhere, apply a patch with `git apply docs/factory/wip/<file>.patch`. Delete the patch files once the work is committed.

### Started, nothing landed
- **The street and park stages render some frames differently from run to run.** Two runs of the same frames in the *old* code disagreed on 5 of 15 frames. The fix was started in worktree `wt-weather4`; no edits were kept.
  - Suspects: per-render `mixer.update` or `skeletonClone` in `AssetStage.tsx`; the GLB material or draw-order sort (compare the fix in `KitInstances.tsx`, `847a2a8`); `useGltfPaint` outside Suspense; state kept across frames.
- **The roads timing test** made robust (best of several runs), same worktree.
- **BigSoundBank's licence check in `scripts/setup-audio-library.ts`** passes every file, because "Free and Royalty Free" is in every page's footer. It should read the item's own "License" section, the way `library/acquire/sources/bigsoundbank.ts` does. Re-check the files already in `public/library/` and report; delete nothing without the user.

### Leftover worktrees and folders
- **Worktrees next to the repo:** `wt-bullet`, `wt-towns2`, `wt-weather4`. Each holds junctions (`node_modules`, `.cache`, `.tts`, links inside `public\`). Remove them as §1 says (`git worktree list` shows them).
- **Old render folders:** ten `out/render-bundle-*` folders from before `728edf6` hold full copies of `public/`, about 9 GB, and are safe to delete. Ask the user first, and check that `public` inside is a real folder, not a junction, before deleting.

## 3. Next steps on the dev laptop (no GPU, no key needed)
1. **Finish the two patches** in §2: check, then commit.
2. **Gate 2 in runs** (P4's library is built; the calls are in `src/generator/library/acquire/acquire.ts`):
   1. `needsToShop(needs)`: stop when it is not empty.
   2. `findOffers(needs, {run})`: save `output/<run>/shopping.json`.
   3. `parseApprovals([...])` (CLI: `n6=bigsoundbank:1048 n2=close n3=build n9=skip`) or `approveAllFree(shopping, given)`.
   4. `acquire(needs, approvals, {run, shopping, models})`: save `acquisition.json` and `needs.json`, then the director.

   In the dashboard, a Shopping list step after the story gate, and an Assets page (`sourceStatus()`, `readRequests` plus `rankRequests`, `readAcquired(acquirePaths().catalogFile)`). Runs whose needs are all have or close must not stop. Fixture runs and `npm run milestone -- --fixtures` stay as they are.
3. **The street and park nondeterminism, and the roads test** (§2, "started"). Prove the fix by rendering the same frames twice, shuffled, and on 1 versus 6 tabs: byte-identical.
4. **The BigSoundBank licence check** (§2).
5. **The bullet-time test video:** render it from the recorded replies in `test-fixtures/pipeline/bullet-test/` ([14-bullet-time.md](14-bullet-time.md) §7; the premise is "What if, once a day, the world stopped for one second, for everyone but you?", 9:16, about 38 s). Only the window's frames and sheets were rendered so far, never the whole video end to end. Then look at it, and measure its sound.
   - Open points in 14's Status: 2 pixels flip in 1-2 of 30 hold frames where a trail crosses a frozen market piece; the critic's and photographer's notes for the window; kit stages.
   - Also open: a target naming another actor outside bullet time is dropped, and fixing that changes renders (the user's call).
6. **A combined check of everything together:**
   - draft renders of the fixture videos (money-doubles, oceans-vanish, forest-walks, the bullet test) on the combined tree;
   - byte-identical checks against the last bundles;
   - then the Paris 15 s stretch timed against the 123 s bar on a quiet machine, with no other renders running. Traffic, weather, the towns and bullet time all landed since the last quiet timing (112 s).
7. **Smaller open items:**
   - the bell tower as a camera subject (`CityLayout.belfry`, `camera/world.ts`);
   - brick textures on painted walls;
   - wet streets in rain;
   - the faint sun glare on a stormy flight ground;
   - the code-map §7.5 items 6, 7, 9 and 11 (in `ai/*`, `server/*`, `ui/*`, `ai.config.json`; item 9 is the two `checkEdits` in `server/film.ts` or `pipeline/editor.ts`);
   - the lists the world map's gotchas name as untied (the actor actions in the schema versus `ACTOR_ACTIONS`, the look presets, the traffic models).
8. **Later phases** ([15-producer.md](15-producer.md) §9):
   - P5, the producer you talk to;
   - P6, model sets (one downloaded model staged as a whole set: a ship, a lighthouse, a cabin) and clip packs;
   - P2's leftovers: a word lock for as-written stories in Ask AI, a profiles settings page, the adapt lost-plot check, the story checker;
   - more places (the breakdown asks for Rome; the Colosseum model is in stock).

## 4. First steps on the GPU machine
1. **Get the code:** pull `dev` after the user has pushed it. `git log --oneline` should show this page's commit or later.
2. **Set up** as in [PROGRESS.md](PROGRESS.md#machine-setup): packages, the sound library, 3D models, world assets and catalog, both voice engines, and `.env` with `OLLAMA_API_KEY`.
   - After pulling, also run `npx tsx scripts/acquire.ts sync` if `acquired.catalog.json` lists items. It fetches them again by their refs and holds back any whose licence or file changed.
3. **Run the checks** in §1.
4. **GPU-machine tasks, in this order.** Runs now stop after the story (the story gate): run the printed `npm run generate -- --resume <run>` line (add `--chunked` for milestone 4), or add `--no-story-gate` to the first command.
   1. Set the Writer back to `ollama/glm-5.3-flash` in Settings → AI models → Model roles. It is still the NVIDIA model from the 2026-10-24 switch; the user chose flash. Optionally give the new breakdown and matcher roles a small model (they fall back to the writer's).
   2. **Plan and render one world premise with real models,** for example `npm run generate -- "What if money doubled every 3 seconds in Paris?" --format 9:16 --duration 25`. Check that the director chose a `react` for the counter, that the plaza shot holds on the big beat, and that the reaction shows on screen. Every reaction, the weather, the lapse and bullet time so far ran on recorded replies only.
   3. **Milestone 4:** `npm run generate -- "What if every clock in Paris stopped for one minute?" --format 16:9 --duration 180 --chunked`, then the `--resume` line with `--chunked`. Change one caption in the editor and render again; the log must say 1 chunk rendered and the rest reused.
   4. **Ask AI** in the editor with a real model.
   5. **The photographer's vision questions:** choose a Photographer (vision) model and calibrate on about 50 stills ([09-phase3-handoff.md](09-phase3-handoff.md) §2 item 3).
   6. **Milestone 6:** three AI premises with real models, each using at least two places, in all three formats. Time the render per 15 s against the 123 s bar.
   7. **A channel other than what-if,** for example `--channel drama --script story.txt`, and an as-written run.
   8. **Listen to the videos** (the laptop never plays sound): voices, music, the per-reaction hits, the rain and thunder, the bullet-time slow-down.

## 5. For the user to review or decide
- **The bullet-time answers** (14 §8) and **the producer answers** (15 §10). All were taken as recommended; the user may change any. For example:
  - guns may appear, nobody is ever hit, no blood;
  - CC0 and FreePD free by default; CC-BY for models only, with credits;
  - nothing downloads without approval, but one click approves every CC0 pick.
- **The two keys:** Poly Pizza and Freesound need the user's own key and a read of their API terms.
- **Kenney packs:** download any new pack's zip by hand, since the site refuses tools.
- **Deleting** the ~9 GB of old `out/render-bundle-*` folders.
- **Earlier open choices:**
  - whether the crowd stays off;
  - the FBM sky;
  - whether a storybook full moon (always opposite the sun) is fine;
  - whether towns such as Colmar should have more cars;
  - whether to fix actor targets that name another actor (changes some renders).
- **The videos:** milestones 1, 2 and 3, the reference comparison sheets, and the new evidence sheets:
  - `out/agentTOWNS/`;
  - `out/agentWEATHER/`;
  - `out/agentBULLET/sheet-warp.png`;
  - `out/agentCAMLIGHT/`.

## 6. Only on the dev laptop (not in git)
`out/` (sheets, stills, sweep scripts) and `output/` (plans and videos) are gitignored. Copy them across if you want them; every one can be regenerated with the commands in the phase documents. The ones referenced most:
- **The reference comparisons:** `out/phase7-gate/v2/gate-gravity.png` and `gate-toilets.png`; for the dressed places, `out/agentTOWNS/sheet-oldtowns.png` and `sheet-newyork*.png`.
- **The reactions:** `out/react-check/`, `out/reactB-crack/`, `out/reactB-dark/`, `out/reactC-buildings/final/`, `out/reactC-water-snow/`.
- **Nights, street and camera:** `out/night/`, `out/street-pass/`, `out/agentCAM2-stills/`, `out/agentCAM3-stills/`, `out/camera-react/sheet.png`, `out/agentCAMLIGHT/`.
- **Weather and water:** `out/agentWEATHER/` (sheets for weather, storm, bolt, flights, grade, river, ocean).
- **Bullet time:** `out/agentBULLET/` (the window sheet, crops, the hash scripts and their results).
- **The milestone videos and reports:** `output/milestone-*/`, `output/milestone/report.md`.
</content>
