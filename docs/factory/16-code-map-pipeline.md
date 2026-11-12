# 16 — Code map: the pipeline side (2026-11-03)

This page maps the code that turns a premise into a finished MP4: the CLI, the AI roles, the voice and the timeline, the assembler, sound resolution and mastering, the chunked render, the QA checks, the editor's film store, the API server, the dashboard and the scripts. It is for a person or an AI session that has to change something here without this session's memory.

**Commit.** Everything below was checked against commit `4f96700` on `dev` (2026-11-03), with one exception. Some files were checked again on 2026-11-04, against commit `6f3784e`. They are the files changed by:
- the producer's phase P1 (resumable runs and the story gate, [15-producer.md](15-producer.md) §11);
- the §7.5 fixes;
- P2 (channels and story modes, §12);
- the P3 wiring (§3).

They are:
- `src/generator/generate.ts`, `ai/generate-spec.ts`, `ai/knowledge.ts`, `ai/roles.ts`;
- `pipeline/run.ts`, `pipeline/llm.ts` and the new `pipeline/manifest.ts`;
- `server/index.ts`, `server/jobs.ts`;
- `ui/src/api.ts`, `lib/jobs.ts`, `lib/help.ts`, `lib/navigation.tsx`, `components/shared.tsx`, `preview/PlayerPreview.tsx` and `pages/create/{Create,PlanStep,SetupSteps,wizard}`.

**What it replaces.** [04-codebase-map.md](04-codebase-map.md) describes the code of 2026-10-22. The render and world side is mapped in [17-code-map-world.md](17-code-map-world.md): the composition, the stages, `src/world/`, the HUD, the look and `src/generator/camera/`.

**Where the why lives.** This page says where things are and how they connect. The reasons are in the design docs, linked throughout:
- [HANDOFF](HANDOFF.md): the standing rules.
- [PROGRESS](PROGRESS.md): the status and the known limits.
- [decisions](decisions.md).
- [05 plan](05-plan.md): the phases and the milestone checks.
- [09 Phase 3 handoff](09-phase3-handoff.md): shots, the photographer and the commands.
- [09 Phase 4](09-phase4.md): the editor and the chunked render.
- [10 intent audit](10-intent-audit.md): nothing on screen without AI intent.
- [03 audio sources](03-audio-sources.md).
- [15 producer](15-producer.md): the next pipeline design.

Contents:
1. The flow, end to end
2. The spec and the stage files
3. File by file
4. Commands and settings
5. `public/` and `output/`
6. How-to recipes
7. Gotchas

---

## 1. The flow, end to end

```
premise
└─ generate.ts main ─ newRunId ─ generateSpec ─ runPlan            (src/generator/pipeline/run.ts)
   story: writer ─ voice (estimated) ─ timeline ─ [revise once]    each stage kept when its inputs are unchanged
   ─ claims (pipeline/claims.ts: the factual claims, judged by the critic's model; a documentary's reworded once; story.claims.json; 15 §18)
   ─ voice ─ [the story gate: stop, STORY_ID; --resume <run> goes on; the gate shows the checker's notes and the claims]
   ─ breakdown ─ match (what the story needs, against the library)
   ─ [gate 2: the shopping list; stops, SHOP_ID, when nothing in stock stands in for a need; --resume <run> --all-cc0 | --approve ... gets what was approved]
   ─ director ─ sound ─ code checks ─ [critic: notes, or proposals for an approved story]
   ─ captions ─ assemble ─ validateSpec ─ validateAssets
   └─ output/<run>/run.json, brief.json, .calls/, story|voice|timeline|direction|sound|critique|plan.json, then spec.json
└─ --no-render: stop here (the dashboard's plan job)
└─ renderOnly
   reassemble("render"): synthesize every line, re-time from the measured audio, assemble again
   resolveAudio: every cue -> library file + gain
   render: a fresh bundle (public/ as a junction) + `remotion render` (default)  |  --chunked: renderChunked
   masterAudio (-14 LUFS, -1 dBTP) ─ report.json
   └─ output/<id>/video.mp4
```

### 1.1 The CLI path
1. `npm run generate -- "<premise>" [flags]` runs [main](../../src/generator/generate.ts#L358).
   - [parseArgs](../../src/generator/generate.ts#L81) reads the flags (section 4.1).
   - `--status <run>` prints the run's stages ([printStatus](../../src/generator/generate.ts#L211)); `--resume <run>` goes to [resumeMain](../../src/generator/generate.ts#L483) (step 6).
   - The settings are checked with [SettingsSchema](../../src/generator/spec.schema.ts#L270).
   - Every run gets its own id, `<slug>-<6 hex>` ([newRunId](../../src/generator/pipeline/manifest.ts#L126), [L450](../../src/generator/generate.ts#L450)), and the CLI prints `RUN_ID: <run>`.
2. [generateSpec](../../src/generator/ai/generate-spec.ts#L28) chooses the path:
   - With no voice settings, narration defaults to Kitten 2 with the voice Bruno ([L52](../../src/generator/ai/generate-spec.ts#L52)).
   - It runs the pipeline under `FACTORY_LLM_FIXTURES`, or when the writer's model resolves and its key is set. The CLI asks for the story gate unless `--no-story-gate` is given, and passes `--story-from <run>`.
   - With no key, it uses an offline template ([buildFamilySpec](../../src/generator/build-family-spec.ts#L93)) or throws.
3. [runPlan](../../src/generator/pipeline/run.ts#L634) starts the run: [startRun](../../src/generator/pipeline/manifest.ts#L188) writes `brief.json` and a fresh `run.json`. [planStages](../../src/generator/pipeline/run.ts#L365) gives every role a model ([resolveRoleModels](../../src/generator/pipeline/llm.ts#L53)) and runs inside the run's reply cache ([withCallCache](../../src/generator/pipeline/llm.ts#L168), L243).
   - Each stage goes through [runStage](../../src/generator/pipeline/run.ts#L185). It is kept when it finished with the same input hash ([stableHash](../../src/generator/pipeline/manifest.ts#L141), [isFresh](../../src/generator/pipeline/manifest.ts#L207)) and its files are there. Otherwise it runs, and its state, hash, model, times, warnings and error go into `run.json`.
   - Before each step it prints `@@STAGE <name>` ([stage](../../src/generator/pipeline/run.ts#L59)), and [save](../../src/generator/pipeline/run.ts#L85) writes each result to `output/<run>/<stage>.json`.

   The stages:
   - **Story** ([L396](../../src/generator/pipeline/run.ts#L396)): the writer (or, for a script as written, the reader in [script.ts](../../src/generator/pipeline/script.ts)), the voice timing and the revise, all before the gate. The channel's profile ([ai/channels.ts](../../src/generator/ai/channels.ts)) shapes the writer's prompts.
     - [writeStory](../../src/generator/pipeline/writer.ts#L248) asks for an exact number of beats ([beatCountFor](../../src/generator/pipeline/writer.ts#L95)). The words per beat are sized from the voice's calibrated rate ([wordsPerBeat](../../src/generator/pipeline/writer.ts#L197)). Above 180 s it writes an outline, then one act per call ([writeLongStory](../../src/generator/pipeline/writer.ts#L372)). Code numbers the beats `b1..bN`; the model never writes times.
     - [timeStory](../../src/generator/pipeline/run.ts#L100) times it in three steps. [planLines](../../src/generator/pipeline/voice.ts#L103) lists the lines (the hook, then each beat's sentences and dialog) and [castVoices](../../src/generator/pipeline/voice.ts#L77) casts them. [voiceLines](../../src/generator/pipeline/voice.ts#L204) runs in "plan" mode: lines already in the voice cache keep their measured length, and the rest are estimated by [calibratedModel](../../src/generator/pipeline/voice.ts#L151). [buildTimeline](../../src/generator/pipeline/timeline.ts#L75) builds the timeline from those lengths.
     - If the length is more than 10% off and there is a narrator, [reviseStory](../../src/generator/pipeline/writer.ts#L303) asks the writer once to add or cut `reviseWords`. The voice then runs again, and this time [fitTempo](../../src/generator/pipeline/timeline.ts#L197) may speed it up, to 1.15x at most. Over the format's cap, the plan throws ([checkFits](../../src/generator/pipeline/run.ts#L240)).
   - **Voice** ([L432](../../src/generator/pipeline/run.ts#L432)) saves `voice.json` and `timeline.json`. Its input is the story, so an edited `story.json` is timed again here.
   - **The story gate** ([L454](../../src/generator/pipeline/run.ts#L454)). With the gate on and the story not approved (or changed since the approval), the plan throws [StoryGateStop](../../src/generator/pipeline/run.ts#L159). Step 4 shows what the CLI does with it.
   - **Breakdown and match** (after the gate). [breakDownStory](../../src/generator/pipeline/breakdown.ts) lists the needs into `breakdown.json`, and [matchNeeds](../../src/generator/library/match.ts) matches them into `needs.json` ([15-producer.md](15-producer.md) §3, "As built").
     - A failure is a warning, and the plan goes on without gate 2.
     - Recorded reply sets without `breakdown-1.txt` skip both stages.
   - **Gate 2, the shopping list** ([shopGate](../../src/generator/pipeline/run.ts#L460), [15-producer.md](15-producer.md) §14). With the gate on (`gates.shop`), the needs of [needsToShop](../../src/generator/library/acquire/acquire.ts#L99) with no choice yet are looked at.
     - It stops only when one of them has nothing in stock standing in for it (status `download`): [findOffers](../../src/generator/library/acquire/acquire.ts#L145) saves `shopping.json`, and the plan throws [ShopGateStop](../../src/generator/pipeline/run.ts#L180).
     - With the user's choices (a `ShopDecision`), [shopApprovals](../../src/generator/pipeline/run.ts#L217) decides every open need, then [acquire](../../src/generator/library/acquire/acquire.ts#L234) writes `acquisition.json` and the new `needs.json`.
     - After an intake, [seeAcquired](../../src/generator/pipeline/run.ts#L238) refreshes the world catalog's acquired models, the sound names and the audio index in this process.
     - Tests set a mocked fetch and a temporary library with [setShopOptions](../../src/generator/pipeline/run.ts#L207).
   - **Director** ([L507](../../src/generator/pipeline/run.ts#L507)). [directStory](../../src/generator/pipeline/director.ts#L459) sees each beat with its real length. It picks the scenes (a kit or a world place, the time, weather, camera, cast, actors and a lapse), the counter, timer, prop, world events and a shot per beat. Its essential check asks again when the counter has no `react` ([counterReactProblem](../../src/generator/pipeline/director.ts#L410)), and once when a lapse can't be used ([lapseProblems](../../src/generator/pipeline/director.ts#L435)).
   - **Sound** ([L520](../../src/generator/pipeline/run.ts#L520)). [designSound](../../src/generator/pipeline/sound.ts#L407) starts from [soundRules](../../src/generator/pipeline/sound.ts#L305). The model may replace the music and the beds and add hits, using only names from [soundVocabulary](../../src/generator/pipeline/sound.ts#L38). If the call fails, the rules stand and a warning is added.
   - **Checks** ([L536](../../src/generator/pipeline/run.ts#L536)). [codeChecks](../../src/generator/pipeline/critic.ts#L57) always run. With `settings.critic`, [critiquePlan](../../src/generator/pipeline/critic.ts#L90) names at most 3 weak beats ([L540](../../src/generator/pipeline/run.ts#L540)).
     - For a story approved at the gate, the notes stay in `critique.json` as proposals.
     - Otherwise [applyNotes](../../src/generator/pipeline/critic.ts#L134) rewrites only those beats, and the rewrite is kept only if the video still fits. The kept stages are then re-hashed against the noted story ([rehash](../../src/generator/pipeline/run.ts#L618)).
   - **Assemble** ([L590](../../src/generator/pipeline/run.ts#L590)). [finish](../../src/generator/pipeline/run.ts#L129) calls, in order, [buildCaptions](../../src/generator/pipeline/captions.ts#L121), [assemble](../../src/generator/pipeline/assemble.ts#L111), [validateSpec](../../src/generator/spec.schema.ts#L548) and [validateAssets](../../src/generator/asset-catalog.ts#L58).
4. **The CLI after the plan.**
   - [afterPlan](../../src/generator/generate.ts#L256) writes `output/<run>/spec.json` ([L281](../../src/generator/generate.ts#L281)). With `--no-render` it prints `PLAN_ID: <run>` and stops; the dashboard's plan job looks for that marker.
   - At the gate, [planStopped](../../src/generator/generate.ts#L300) calls [printStoryGate](../../src/generator/generate.ts#L229). It prints the story and the command that approves it and goes on, then `STORY_ID: <run>`, and exits 0.
   - At gate 2 it calls [printShopGate](../../src/generator/generate.ts#L310): the list (`formatShopping`), the commands (`--all-cc0`, `--approve n6=<source>:<id> ...`, a plain `--resume`, `--no-shop-gate`), then `SHOP_ID: <run>`, and exits 0.
5. [renderOnly](../../src/generator/generate.ts#L581) makes the video:
   - **Voice, measured.** For a planned spec whose stage files exist ([canReassemble](../../src/generator/pipeline/run.ts#L770)), [reassemble](../../src/generator/pipeline/run.ts#L785) runs in "render" mode. Every line is synthesized, cache first ([synthesizeLines](../../src/generator/tts.ts#L433)), and the video is re-timed from the real audio and assembled again, with no model call.
   - **Approved edits.** The rebuild takes the approved spec's story wording ([adoptEdits](../../src/generator/pipeline/run.ts#L822)), its caption wording ([keepCaptionTexts](../../src/generator/pipeline/run.ts#L842)) and its look settings ([approvedSettings](../../src/generator/pipeline/run.ts#L751)). The `--audio-file` voices win over the plan's ([mergeAudio](../../src/generator/pipeline/run.ts#L733)).
   - **Old specs.** Offline templates and old specs go through the legacy [runTtsStage](../../src/generator/tts.ts#L405), which voices the hook and the captions ([L628](../../src/generator/generate.ts#L628)).
   - **Sound.** [resolveAudio](../../src/generator/audio-resolve.ts#L127) gives every cue a file and a gain ([L643](../../src/generator/generate.ts#L643)).
   - **Render.** With `--chunked`, [renderChunked](../../src/generator/render/index.ts#L69) renders ([L653](../../src/generator/generate.ts#L653)). Otherwise:
     - [freshBundle](../../src/generator/generate.ts#L555) builds `out/render-bundle-<run>` with the Node API, its `public/` a junction to the project's `public/`. An older bundle there is removed with [removeTree](../../src/generator/generate.ts#L529), which never goes through a link.
     - `remotion render` then runs through `node node_modules/@remotion/cli/remotion-cli.js` ([L698](../../src/generator/generate.ts#L698)) and reads the props from `output/<run>/props.json` ([L664](../../src/generator/generate.ts#L664)).
   - **Finish.** [masterAudio](../../src/generator/audio-master.ts#L65) masters the mix ([L706](../../src/generator/generate.ts#L706)), then `report.json` is written ([L717](../../src/generator/generate.ts#L717)).
   - **Failure.** A failed plan writes `output/FAILED-<run>.log` ([writeFailedLog](../../src/generator/generate.ts#L334)) and prints the command that resumes it.
6. **Resume.** `--resume <run>` ([resumeMain](../../src/generator/generate.ts#L483)) continues a run.
   - A complete plan is only rendered again, or only reported with `--no-render`.
   - Otherwise [resumePlan](../../src/generator/pipeline/run.ts#L864) approves a story that waits at the gate ([approveStory](../../src/generator/pipeline/manifest.ts#L234)) and runs planStages again: the finished stages are kept, and the saved replies are replayed.
   - Gate 2's choices: `--approve` (and bare `nN=...` words) and `--all-cc0` become a `ShopDecision`. A plain `--resume` while the shopping list waits ([waitsForShopping](../../src/generator/pipeline/manifest.ts#L249)) goes on with every stand-in kept. `--no-shop-gate` turns the gate off for the run.

### 1.2 The dashboard path
1. The wizard's Write button ([Create.write](../../ui/src/pages/create/Create.tsx#L52)) calls [planSpec](../../ui/src/api.ts#L63), which posts to [POST /api/plan](../../server/index.ts#L312). It sends `storyGate`, from the Format step's "Read the story first" switch (on unless turned off).
2. The route checks the request before anything starts:
   - the settings;
   - the writer's provider, key and model;
   - every role's key and model ([rolesProblem](../../server/index.ts#L284));
   - that no other plan is running ([busyPlan](../../server/index.ts#L308), 409 otherwise).

   It writes the voice settings to `output/plan-<jobId>-audio.json` and starts [runJob](../../server/jobs.ts#L354) with `noRender`.
3. `runJob` spawns `npx --no-install tsx src/generator/generate.ts <premise> --no-render --settings-json <json> --audio-file <file>` ([L362-375](../../server/jobs.ts#L362)).
   - It adds `--provider` and `--model` only when the request named them (`explicitModel`). Otherwise each role keeps its own assignment.
   - It adds `--no-story-gate` when the gate is off, and `--story-from <run>` when a story is reused.
   - It adds `--no-shop-gate` when gate 2 is off, and `--sources a,b|none` when the request limits the sources.
   - It adds `--channel`, `--mode` and `--script output/plan-<jobId>-script.txt` for a channel and a pasted story.
4. The CLI's output drives the job:
   - A plan follows the `@@STAGE` markers ([stageMarker](../../server/progress.ts#L25)). Each stage has a progress floor in [PLAN_PROGRESS](../../server/progress.ts#L13).
   - A render reads Remotion's lines and the `[n/5]` traces ([readRenderLog](../../server/progress.ts#L31)).
   - The `RUN_ID:` line names the job's run as soon as it appears ([L398](../../server/jobs.ts#L398)).
   - Jobs are saved to `output/jobs/<jobId>.json`. After a server restart, [loadJobsFromDisk](../../server/jobs.ts#L142) marks a job that was running as failed; a plan job's error says it can be resumed.
5. When the CLI exits ([L454-461](../../server/jobs.ts#L454)), `PLAN_ID:` becomes `job.specId`, `STORY_ID:` marks a job stopped at the story gate (`job.gate = "story"`), and `SHOP_ID:` one stopped at gate 2 (`job.gate = "shop"`). The UI polls [GET /api/spec/:jobId](../../server/index.ts#L611) every 2.5 s ([PlanStep](../../ui/src/pages/create/PlanStep.tsx#L180)).
   - **At gate 2** the route answers `{ gate: "shop", runId, shopping }` ([shoppingFor](../../server/index.ts#L558)). [ShoppingGateView](../../ui/src/pages/create/ShoppingStep.tsx#L187) shows the list; its buttons call `resumeRun(runId, { approvals, allFree })`, and the resume route passes them on as `--approve ... [--all-cc0]`.
   - **At the story gate** the route answers `{ gate: "story", runId, story, length }`. [StoryGateView](../../ui/src/pages/create/PlanStep.tsx#L420) shows the story. Approve calls [resumeRun](../../ui/src/api.ts#L140), which posts to [POST /api/plan/:runId/resume](../../server/index.ts#L540). That route starts a second plan job, `generate.ts --resume <run> --no-render`, and the wizard follows it to the review.
   - **A finished plan** answers with its spec, plus `notes` when the critic's notes were kept as proposals ([criticNotes](../../server/index.ts#L497)). The review shows them.
   - **A failed or interrupted plan** shows Resume from \<stage\> ([ResumeButton](../../ui/src/pages/create/PlanStep.tsx#L383)), from [GET /api/runs/:runId](../../server/index.ts#L592), through the same resume route.
6. Recasting a character goes to [POST /api/plan/:specId/recast](../../server/index.ts#L665). The route:
   - checks the request with [checkRecast](../../src/generator/film/recast.ts#L23);
   - writes the new voice into `plan.json`;
   - rebuilds with `reassemble(id, "plan")` on the film's queue ([queueFilmChange](../../server/film.ts#L60)).

   No model is called.
7. Approving calls [renderSpec](../../ui/src/api.ts#L162), which posts to [POST /api/render-spec](../../server/index.ts#L714). The route:
   - refuses a second render of the same spec or title;
   - writes the approval's voice settings to `output/<id>/audio.json`;
   - runs the CLI with `--from-spec output/<id>/spec.json [--audio-file …] [--chunked]`.
8. The render screen listens to [GET /api/jobs/:id/events](../../server/index.ts#L880) (SSE, [subscribeSSE](../../server/jobs.ts#L512)) and falls back to polling. When the CLI exits with 0:
   - [latestReportFor](../../server/jobs.ts#L297) reads the job's own `output/<id>/report.json`, and falls back to the newest report of the premise;
   - a thumbnail is cut to `thumb.jpg` ([L483](../../server/jobs.ts#L483));
   - the done screen plays `/media/<id>/video.mp4`. `/media` is the static route over `output/` ([L1105](../../server/index.ts#L1105)).

### 1.3 The editor path ([09-phase4.md](09-phase4.md))
1. **Opening a film.** `?tab=editor&film=<specId>` opens the [Editor](../../ui/src/pages/editor/Editor.tsx#L116), which calls [GET /api/film/:id](../../server/film.ts#L220).
   - [openFilm](../../src/generator/film/store.ts#L89) reads the stage files and the versions.
   - [prepareFilm](../../src/generator/film/prepare.ts#L54) runs reassemble, applies the caption overrides and calls resolveAudio. It also rewrites `output/<id>/spec.json`.
2. **A structured edit.** [POST /api/film/:id/edit](../../server/film.ts#L309) runs three steps:
   - [checkEdits](../../src/generator/film/edits.ts#L267) checks the edits.
   - [applyEdits](../../src/generator/film/edits.ts#L288) applies them. The editable paths are listed in [RULES](../../src/generator/film/edits.ts#L101), each with how much has to be redone.
   - [saveFilm](../../src/generator/film/store.ts#L139) saves the result as `output/<id>/film/v<N>.json`, and the film is prepared again.

   A voice-level edit answers at once on estimated timing, then measures the voice in the background ([startMeasure](../../server/film.ts#L126)). The UI polls `/status`.
3. **A wording edit.** [PUT /api/film/:id](../../server/film.ts#L252) sends the whole spec.
   - [diffTextEdits](../../src/generator/film/diff.ts#L57) turns changed story wording into edits.
   - [diffCaptions](../../src/generator/film/diff.ts#L84) turns changed caption wording into overrides that keep their timing.
4. **Ask AI.** [POST /api/film/:id/ask](../../server/film.ts#L348) calls [askEditor](../../src/generator/pipeline/editor.ts#L171) and answers with a proposal. Nothing is saved until the user applies it, through `/edit` with `source: "ai"`.
5. **Undo, redo, render.** Undo and redo are at [L373](../../server/film.ts#L373). All changes to one film run on one queue ([serial](../../server/film.ts#L43)). The editor's render button sends `chunked: true`.

### 1.4 QA along the way
- **Plan.** Each role's essential check runs inside [callRole](../../src/generator/pipeline/llm.ts#L282); [codeChecks](../../src/generator/pipeline/critic.ts#L57) adds warnings.
- **Spec.** [validateSpec](../../src/generator/spec.schema.ts#L548) checks that:
  - scenes tile the video from 0;
  - the length is between 8 s and the format's cap;
  - there are at most `sceneCount` scenes;
  - events, captions and the timer fall inside the video;
  - counter beats rise, and the first zoom is 1;
  - lapses are valid.

  [validateAssets](../../src/generator/asset-catalog.ts#L58) rejects unknown cast ids and fills in `cast[].file`.
- **Render.**
  - [resolveAudio](../../src/generator/audio-resolve.ts#L127) drops a cue that has no file (a missing file crashes the render).
  - [renderChunked](../../src/generator/render/index.ts#L69) checks the frame count with ffprobe and the length of the audio.
- **After the render.**
  - `npm run photographer` runs [checkShots](../../src/generator/qa/photographer.ts#L125). [judgeStill](../../src/generator/qa/photographer.ts#L106) checks exposure, flat frames and colour; when a vision model is set, [askVision](../../src/generator/qa/vision.ts#L58) adds yes/no questions.
  - `npm run milestone` measures each video ([measure](../../scripts/milestone.ts#L111)).
  - `npm run verify` finds silent seconds.

---

## 2. The spec and the stage files

### 2.1 The spec
[ShotSpecSchema](../../src/generator/spec.schema.ts#L392) is the one contract between the pipeline and the renderer. Some rules hold for every field:
- Every time in the spec is seconds of the video.
- The module is also bundled into the browser composition, so it must not import Node modules. That is why the asset check lives in `asset-catalog.ts` instead.
- How each field reaches the picture is in [17-code-map-world.md](17-code-map-world.md) §2.

| field | written by | read by |
|---|---|---|
| `id`, `title`, `fps` | [assemble](../../src/generator/pipeline/assemble.ts#L434) | Root metadata, the render, `report.json` |
| `width`, `height` | [validateSpec](../../src/generator/spec.schema.ts#L552), from `settings.format` ([formatDims](../../src/generator/spec.schema.ts#L295)) | Root metadata, renderChunked, the CLI render flags |
| `settings` (format, targetDuration, sceneCount, quality, captions, critic) | the CLI flags or the dashboard, through runPlan; [approvedSettings](../../src/generator/pipeline/run.ts#L751) on a rebuild | the timeline (format, length), the director (sceneCount), the critic switch, the caption style, draft scale |
| `palette` | the schema default only | nothing: a dead field |
| `story` (title, mood, hook, characters with their cast voice, beats with from/to/say/see/pace/stress/lines) | [assemble L439](../../src/generator/pipeline/assemble.ts#L439) | adoptEdits on render, film/diff, the review and editor screens, WorldStage/FlightView, the chunk keys |
| `hook` | [assemble L458](../../src/generator/pipeline/assemble.ts#L458) | Hook card, HUD placement, the chunk keys |
| `events[]` (`t`, `name`, `sfx[]`) | assemble: the hook pop ([L247](../../src/generator/pipeline/assemble.ts#L247)), counter steps ([L311](../../src/generator/pipeline/assemble.ts#L311)), world-event hits ([L362](../../src/generator/pipeline/assemble.ts#L362)), the designer's hits ([L370](../../src/generator/pipeline/assemble.ts#L370)); resolveAudio adds `file`/`gain` or drops the cue | composition audio, the timeline tracks |
| `captions[]` (with per-word times) | [buildCaptions](../../src/generator/pipeline/captions.ts#L121); edited wording from keepCaptionTexts and [applyCaptionOverrides](../../src/generator/film/diff.ts#L127) | the caption HUD, validateSpec |
| `statPanel` (title, unit, react, beats: t/value/zoom/scale/sub/bpm) | [assemble L251](../../src/generator/pipeline/assemble.ts#L251), from `direction.counter`; never invented | StatHud, stages via [statPanel.ts](../../src/generator/statPanel.ts), world reactions |
| `timer` | [assemble L325](../../src/generator/pipeline/assemble.ts#L325) | TimerHUD |
| `heroProp` | [assemble L335](../../src/generator/pipeline/assemble.ts#L335) (street scenes only) | StreetStage |
| `scenes[]` (kit, from/to, look, world with place/date/time/lapse, actors, flight, subject, street, cast) | [assemble L157](../../src/generator/pipeline/assemble.ts#L157); validateAssets fills `cast[].file` | the scene router and stages, the chunk plan |
| `shots[]` | [timeShots](../../src/generator/pipeline/shots.ts#L166) and [holdReactions](../../src/generator/pipeline/shots.ts#L237) (assemble [L398](../../src/generator/pipeline/assemble.ts#L398)) | the camera rigs, the chunk plan, the photographer |
| `transitions[]` | [planTransitions](../../src/generator/pipeline/transitions.ts#L46) | TransitionOverlay, ShotCamera, the chunk plan |
| `flights[]` | [assemble L411](../../src/generator/pipeline/assemble.ts#L411) | FlightView, the chunk plan, resolveAudio (no cut whoosh under a flight) |
| `worldEvents[]` | [assemble L342](../../src/generator/pipeline/assemble.ts#L342) (events a scene can't show are dropped) | stages, world reactions, the photographer |
| `audio.ambient[]` | assemble: the heartbeat ladder ([L315](../../src/generator/pipeline/assemble.ts#L315)), the beds ([L376](../../src/generator/pipeline/assemble.ts#L376)), [lapseAmbience](../../src/generator/pipeline/sound.ts#L243); resolveAudio adds `file`, `gain` and `loop` | composition audio, the audio cache key |
| `audio.music[]` | assemble (mood, from, to); resolveAudio ([L203](../../src/generator/audio-resolve.ts#L203)) adds the file, gain, loop and fades | composition audio |
| `audio.transitions[]` | resolveAudio ([L226](../../src/generator/audio-resolve.ts#L226)) | composition audio |
| `audio.voiceFiles[]` | assemble ([L390](../../src/generator/pipeline/assemble.ts#L390)), only for lines that have a file (after synthesis); resolveAudio sets the gain | composition audio (ducking), the chunk keys |
| `audio.narration`, `audio.dialogs` | [assemble L473](../../src/generator/pipeline/assemble.ts#L473) | the legacy voice path in [generate.ts L628](../../src/generator/generate.ts#L628), the UI |

### 2.2 The stage files: the film
A planned video is rebuilt from four files in `output/<id>/`, never from `spec.json`. These four are the "film" that the editor versions ([Film](../../src/generator/film/edits.ts#L33)).

| file | written by | read by |
|---|---|---|
| `story.json` (WriterStory) | the story stage ([L405](../../src/generator/pipeline/run.ts#L405)), the critic's applied notes ([L574](../../src/generator/pipeline/run.ts#L574)), reassemble ([L810](../../src/generator/pipeline/run.ts#L810)), the film store | the stages of a resume, reassemble, the film store, the recast route, the story gate (`/api/spec`) |
| `direction.json` (Direction) | the director stage ([L507](../../src/generator/pipeline/run.ts#L507)), the film store | a resume, reassemble, the film store |
| `sound.json` (SoundPlan) | the sound stage ([L520](../../src/generator/pipeline/run.ts#L520)), the film store | a resume, reassemble, the film store |
| `plan.json` (premise, settings, audio, models) | the assemble stage ([L595](../../src/generator/pipeline/run.ts#L595)), reassemble when the look settings change, the recast route, [markFixtureModels](../../server/jobs.ts#L129) | reassemble, the film store |
| `voice.json` (PlannedLine[]) | the voice stage, reassemble | a resume, [voiceAllMeasured](../../src/generator/film/prepare.ts#L40) in prepareFilm, the milestone (tempo) |
| `timeline.json` | the voice stage, reassemble | a resume, the story gate's length |
| `critique.json` | the critic stage | a resume, `/api/spec` (`notes`, when they were kept as proposals) |
| `spec.json` | generate.ts, prepareFilm ([L86](../../src/generator/film/prepare.ts#L86)), the recast route | `/api/spec`, `/api/render-spec`, `--from-spec` |

A run also keeps its manifest ([manifest.ts](../../src/generator/pipeline/manifest.ts); [15-producer.md](15-producer.md) §11). None of these is part of the film:

| file | written by | read by |
|---|---|---|
| `brief.json` (Brief: the premise, settings, voices, gate, channel, mode and script) | [startRun](../../src/generator/pipeline/manifest.ts#L188); a resume with `storyGate: false` | resumePlan, `/api/plan/:runId/resume`, reassemble (an as-written run is never sped up) |
| `breakdown.json`, `needs.json` | the breakdown and match stages | a resume, `/api/spec` (`needs`), the CLI's shopping list |
| `run.json` (RunManifest) | [runStage](../../src/generator/pipeline/run.ts#L185) as each stage starts and ends; [approveStory](../../src/generator/pipeline/manifest.ts#L234) | the stages (input hashes), `--status`, `/api/runs/:runId`, `/api/spec` (the gate), jobs.ts |
| `.calls/<label>-<key>.txt` | [callRole](../../src/generator/pipeline/llm.ts#L282) inside [withCallCache](../../src/generator/pipeline/llm.ts#L168) | callRole, when the same call is asked again in that run |

---

## 3. File by file

### `src/generator/` (root)
- [generate.ts](../../src/generator/generate.ts): the CLI.
  - `main` (L358), `parseArgs` (L81), `resumeMain` (L580), `printStatus` (L258), `printChannels` (L202), `printStoryGate` (L229), `printShopGate` (L310, gate 2), `parseSources` (L250), `afterPlan` (L256, which also prints the shopping list), `planStopped` (L300), `renderOnly` (L581). (Line numbers after `printStoryGate` moved with gate 2; search by name.)
  - The non-chunked render: `freshBundle` (L555) and `removeTree` (L529).
  - It prints the markers `RUN_ID:`, `STORY_ID:` and `PLAN_ID:` for the server.
  - It finds ffmpeg through `ffmpeg.ts` and runs the Remotion CLI's own script with `node`, so its render path is no longer Windows-only.
  - Run by `npm run generate` and spawned by `server/jobs.ts` and `scripts/milestone.ts`. It runs `main()` on import, so it has no unit test; the milestone and `resume.test.ts` (through run.ts) exercise it.
- [spec.schema.ts](../../src/generator/spec.schema.ts): the spec contract.
  - Exports: `ShotSpecSchema` (L392), `SceneSchema` (L123), `SettingsSchema` (L270), `validateSpec` (L548), `formatDims` (L295), `maxDurationFor` (L303), `videoSeconds` (L313), `STAT_REACTS` (L80).
  - Read by every layer, including the browser bundle.
  - Test: `spec.schema.test.ts`.
- [asset-catalog.ts](../../src/generator/asset-catalog.ts): reads `assets.catalog.json`. A missing file gives an empty catalog.
  - Exports: `loadCatalog` (L34), `getAsset` (L48), `validateAssets` (L58), `catalogForPrompt` (L92).
  - Callers: the director prompt, the assembler (cast filter), runPlan, generate.ts.
- [build-family-spec.ts](../../src/generator/build-family-spec.ts): offline templates (gravity, time-stop, doubling and others) built from the two `spec.example.*.json` files. Export: `buildFamilySpec` (L93). Callers: generateSpec (no key), the `/api/plan` and `/api/generate` offline checks.
- `spec.example.gravity.json`, `spec.example.eyesight.json`: hand-written specs. Users: Root.tsx default props, the templates, `spec.schema.test.ts`, `scripts/enrich-example-spec.ts`.
- [audio-resolve.ts](../../src/generator/audio-resolve.ts): sound names to files.
  - Exports: `SOUND_QUERY` (L44, the sound vocabulary), `MOOD_TAGS` (L76, the music moods), `TARGET_LUFS` (L28), `gainFor` (L102), `resolveAudio` (L127).
  - Callers: generate.ts, prepareFilm, the writer and sound roles (vocabulary).
  - Tests: `assemble.test.ts`, `transitions.test.ts`. Doc: [03-audio-sources.md](03-audio-sources.md).
- [audio-library.ts](../../src/generator/audio-library.ts): reads `public/library/audio-library.json` (L29). Exports: `loadLibrary` (L34, read once per process), `reloadLibrary` (L45: run.ts after gate 2 took sounds in), `pickEntry` (seeded and deterministic for a given library). Caller: audio-resolve.
- [audio-master.ts](../../src/generator/audio-master.ts): the final mix pass. Export: `masterAudio` (L65), which targets -14 LUFS and -1 dBTP with up to three loudnorm rounds and a re-encode when the AAC overshoots. Caller: generate.ts L421. No unit test; the milestone measures the result.
- [audio-room.ts](../../src/generator/audio-room.ts) (since `63aca43`): room and distance in the mix. Each effect (and a bed indoors) is convolved by FFT in TypeScript with a generated impulse response chosen by the scene's space (interior small room; streets and world places city slap; open air almost dry; pier, river, boardwalk and model sets open water; space dry), and low-passed and lowered by the shot's distance (EWS far, WS between, FS and closer dry). Voice, music, stingers and bullet time's cues stay dry. Files go once to `public/whatif-audio/room/`, named by a hash. Run from `resolveAudio`; `FACTORY_ROOM=off` or `{ room: false }` gives today's output exactly. Remotion's bundled ffmpeg has no `afir`, `lowpass` or `aecho`, hence the TypeScript convolution. Details and measurements: [03-audio-sources.md](03-audio-sources.md).
- [tts.ts](../../src/generator/tts.ts): runs the voice engines.
  - Exports: `synthesizeLines` (L433), `cachedDuration` (L574), `tempoVoiceFile` (L609), `cacheKey` (L399), `runTtsStage` (L405, legacy), `disposeTtsWorkers` (L330), `CACHE_DIR` (L21).
  - The cache is `.cache/voice/<sha1>.wav` plus `.json`; the key includes `SYNTH_VERSION` (L339).
  - A persistent Kitten worker (`TtsWorker`, L162) is used unless `TTS_KITTEN_WORKER=0`. VoxCPM, and any worker failure, use the batch path through `scripts/story-tts.py`.
  - Callers: pipeline/voice.ts, generate.ts, the server's voice-sample route. Test: `tts.worker.test.ts`, which covers only `parseWorkerResult`.
- [tts-python.ts](../../src/generator/tts-python.ts): which Python runs an engine: `TTS_KITTEN_PYTHON` or `TTS_VOXCPM_PYTHON`, else `.tts/<engine>/.venv`. Exports: `resolveTtsPython` (L30), `venvPythonPath` (L24). Used by tts.ts and the server.
- [voices.ts](../../src/generator/voices.ts): the voice catalog. Exports: `KNOWN_VOICES` (L33, Kitten presets; Bella is banned), `VOXCPM_VOICE_DESCRIPTIONS` (L46), `voxDescription` (L67), `TTS_ENGINES` (L12). Used by the server's `/api/voices`, recast and pipeline/voice.ts.
- [ffmpeg.ts](../../src/generator/ffmpeg.ts): finds ffmpeg ([resolveFfmpeg](../../src/generator/ffmpeg.ts#L13): `FFMPEG_PATH`, then Remotion's bundled ffmpeg, then PATH) and runs it. Exports: `runFfmpeg` (L27), `measureLoudness` (L46). Used by audio, render/join and the milestone.
- [env.ts](../../src/generator/env.ts): the one reader and writer of `.env`, for the CLI and the server (2026-11-05). `loadDotEnv()` applies it once and never overrides a variable that is already set (called on import of pipeline/llm.ts); `loadDotEnv({ override: true })` is the server's, so a key saved a moment ago is used. `readDotEnv`, `parseDotEnv`, and `saveDotEnv`, which changes the named keys in place and keeps every other line.
- [producer-cli.ts](../../src/generator/producer-cli.ts): `npm run producer -- new|resume|status|needs|get|say|ok|no|undo|notes` ([15-producer.md](15-producer.md) §16). `new`, `resume`, `status` and `get` run generate.ts; the others call pipeline/producer.ts. After `ok` or `undo` on a finished plan it rebuilds `spec.json` (`prepareFilm`, estimate), so the next render shows the change.
- [timing.ts](../../src/generator/timing.ts): `secToFrame` (L10), `formatTimer` (L21). Shared with the composition.
- [caption-style.ts](../../src/generator/caption-style.ts): caption presets and overrides. Exports: `CaptionStyleSchema` (L63), `resolveCaptionStyle` (L112), `resolveHudStyle` (L140). Used by the spec settings, the HUD and the dashboard's caption panel. Tests: `layout.test.ts`, `hud-layout.test.ts`.
- [layout.ts](../../src/generator/layout.ts): safe areas and text placement per frame shape. Exports: `SAFE_AREA` (L29), `captionScale` (L50), `textHudPlacement` (L100). Used by the HUD. Tests: the same two.
- [look-choice.ts](../../src/generator/look-choice.ts): the colour grade per scene. Exports: `lookFor` (L32), `lightWordFor` (L53, also used by transitions.ts), `lapseLookFor` (L111). Used by WhatIfVideo and FlightView. Test: `look-choice.test.ts`. Docs: [13-light-and-time.md](13-light-and-time.md), [08-phase3-research.md](08-phase3-research.md) §5.
- [statPanel.ts](../../src/generator/statPanel.ts): counter values over time. Exports: `statValueAt` (L26), `statScaleAt` (L37), `statZoomAt` (L53), `statBpmAt` (L66). Used by StatHud and the stages. Test: `statPanel.test.ts`.

### `src/generator/ai/`
- [generate-spec.ts](../../src/generator/ai/generate-spec.ts): `generateSpec` (L28) picks between the pipeline and the offline templates.
  - It passes the run's story gate, reused story, channel, mode and script to runPlan.
  - It fills in the channel's format, caption style and voices where the caller gave none.
  - A caller that names no id gets a new run id. Callers: generate.ts, milestone.ts.
- [channels.ts](../../src/generator/ai/channels.ts): the channel profiles (`channels/<id>.json`).
  - `ChannelSchema` (L37), `loadChannel` (L114), `listChannels` (L133), `channelMoods` (L147), `formatProblem` (L152).
  - The prompt blocks: `writerRules` (L162), `criticSystem` (L177), `directorGuide` (L195) and `soundGuide` (L207). run.ts passes the last three to `critiquePlan`, `directStory` and `designSound` (`ee0c153`); for what-if they are the prompts of before.
  - `gates`: `story` (gate 1) and `shop` (gate 2, default on).
  - The settings page's: `checkChannel` (the checks `loadChannel` makes), `readChannelFile` (the file as written) and `saveChannel` (checked; the version goes up by one only when the profile changed; `create` for a copy at version 1).
  - `DEFAULT_CHANNEL` is `what-if`. Test: `channels.test.ts`. Doc: [15-producer.md](15-producer.md) §12.
- [provider-registry.ts](../../src/generator/ai/provider-registry.ts): the one reader of the AI config, for the CLI and the server (2026-11-05). `readAiConfig(root)` lays `ai.config.local.json` (this machine's choices, git-ignored, written by the dashboard; `null` removes a provider, a role or a default) over the tracked `ai.config.json`, and says what is wrong with either file; `loadAiConfig` warns once per problem instead of returning an empty config in silence. `saveAiConfig` writes only what differs from the tracked file, to the local one. `resolveModel` builds an AI SDK model reference by `package`. `getProviderStatus` feeds `npm run models`. Callers: llm.ts, generateSpec, the server. Test: `config.test.ts`.
- [roles.ts](../../src/generator/ai/roles.ts): `ROLE_DEFS` (L13) lists writer, reader (the script reader), director, sound, critic, breakdown, matcher, vision and editor. `pickRoleModel` (L96) never sends a model to a provider it doesn't belong to. Used by llm.ts, the server's `/api/roles` and the photographer script.
- [knowledge.ts](../../src/generator/ai/knowledge.ts): the vocabularies the director chooses from: `SCENE_KITS` (L30), `WORLD_EVENTS` (L49), `TIME_OF_DAY` (L73), `CAMERA_STYLES` (L76), `HERO_PROP_STYLES` (L113), `HERO_ANCHORS` (L127), `STREET_ACCENTS` (L140).
  - `memoryBlock` (L253) is the anti-repetition memory in the director's prompt. It is built from `recentStories` (L212), which reads `rendered` (L173): every report in `output/<id>/` or the old flat files, newest first.
  - Inside `withMemoryChannel` (L203, set by planStages) the memory is that channel's videos only. A report's `channel` says which; older reports are what-if.
  - `reportTime` (L163) turns a report's ISO `generatedAt` into a sortable number. The server's sorts use it too.
  - `WEATHER_LOOKS`, `SPACE_SUBJECTS` and `ANIMAL_CAST_IDS` have no reader since the dead prompt blocks were removed (2026-11-04). They are kept as vocabulary data.

### `src/generator/pipeline/`
| file | what it does, key exports | called by | tests |
|---|---|---|---|
| [run.ts](../../src/generator/pipeline/run.ts) | The pipeline as a run of stages. `runPlan` (L634) starts a run and `resumePlan` (L704) continues one. Both go through `planStages` (L365), with each stage in `runStage` (L185). The story gate throws `StoryGateStop` (L159). `reuseStory` (L682) seeds a run with another run's story. The channel's limits: `channelDirection` (L257) drops the devices it does not use, and `channelSound` (L303) its moods. `prepareScript` (L330) readies an as-written brief. The breakdown and match stages come after the gate, then gate 2: `shopGate` (L460) stops with `ShopGateStop` (L180) or acquires what `shopApprovals` (L217) decides, and `seeAcquired` (L238) refreshes the process; `setShopOptions` (L207) is for tests. Rebuilds without a model: `reassemble` (L785), `canReassemble` (L770), `mergeAudio` (L733), `approvedSettings` (L751). Also `stage` (L59). | generateSpec, generate.ts, prepareFilm, the server's recast | `run.test.ts` (full fixture plan), `resume.test.ts` (the gate and resumes), `modes.test.ts` (channels, modes, the breakdown), `critic.test.ts`, `shop.test.ts` (gate 2: stop, resume, approvals, all have or close, off) |
| [manifest.ts](../../src/generator/pipeline/manifest.ts) | A run's id and manifest. `newRunId` (L126), `slugOf` (L121), `stableHash` (L141), `startRun` (L188), `isFresh` (L207), `nextStage` (L213), `isComplete` (L218), `waitsForStory` (L223), `approveStory` (L234), `waitsForShopping` (L249), `describeRun` (L242), `readRun` (L158: an older run.json gets the newer stages), `readBrief` (L168), `runDir` (L146), `STAGES` (L34) and `STAGE_LABELS` (L109). The brief holds the channel, mode and script, and gate 2's `shopGate` and `shopSources`; `gates.shop` (`ShopGate` L96) records gate 2. `setOutputDir` (L29) is for tests: their runs go to a temp folder. | run.ts, generate.ts, generateSpec, the server | `manifest.test.ts` |
| [script.ts](../../src/generator/pipeline/script.ts) | The as-written mode. `parseScript` (L74) reads narration, `Name:` lines, `[directions]` and acts. `scriptBeats` (L164) makes the beats and the hook. `readScript` (L320) asks the reader role for the directions and characters only. `checkWords` (L238) proves the words are the script's. Also `scriptPremise` (L252) and `beatWords` (L126). | run.ts, generate.ts, the server | `script.test.ts`, `modes.test.ts` |
| [llm.ts](../../src/generator/pipeline/llm.ts) | One way to ask any role for JSON. `callRole` (L282) does a lenient parse, then normalize, then zod, then the essential check, with a repair loop of 3 attempts by default. Inside a run (`withCallCache` L168) it saves each usable reply under `callKey` (L173) and `callFile` (L178), and replays it when the same call is asked again. Also `lenientJson` (L75), `fuzzyEnum` (L108), `beatRef` (L122), `asArray` (L101), `resolveRoleModels` (L53), `resetFixtureCounters` (L158) and the test hook `setModelAsker` (L241). `askModel` (L196) uses the native `ollama` client for Ollama (which also carries images) and AI SDK `generateText` for everything else. | every role, the server | `llm.test.ts`, `calls.test.ts` |
| [writer.ts](../../src/generator/pipeline/writer.ts) | The writer: `writeStory` (L248; with a `source`, the adapt mode, label `writer-adapt`), `reviseStory` (L303), the long-form outline and acts (`writeLongStory` L372), `normalizeWriter` (L116), `writerSystem` (L167) and `writerPrompt` (L218), both built from the channel's profile, `MOODS` (L21), `defaultDuration` (L90: 30 s, or 90 s for 16:9). | runPlan | `writer.test.ts`, `prompts.test.ts` (what-if's prompts are unchanged), `critic.test.ts` (long form) |
| [variants.ts](../../src/generator/pipeline/variants.ts) | Versions of one run ([15-producer.md](15-producer.md) §17): `parseVariantAsk` (`hooks=3,endings=2,formats=9:16,16:9`), `listVariants` (the crossed list, ids `h2-e1-9x16`), `proposeAlternatives` (the writer, label `writer-variants`), `variantTimeline` (pure: a new hook or ending keeps its window when it fits), `makeVariants` (each spec through run.ts `finish` under the run's id, rendered by the caller's `VariantRenderer`), `readVariants`. Writes `output/<run>/variants/`. | generate.ts (`--variants`, `variants <run>`) | `variants.test.ts` |
| [voice.ts](../../src/generator/pipeline/voice.ts) | Lines and their lengths: `planLines` (L103), `castVoices` (L77; the genders are assumed from the preset names), `voiceLines` (L204), `calibratedModel` (L151: a least-squares fit over `.cache/voice`), `speedUp` (L277), `AudioConfig` (L24). | run.ts | `voice.test.ts` |
| [timeline.ts](../../src/generator/pipeline/timeline.ts) | Pure. Beats in seconds from the voice: `TIMING` (L17), `naturalLength` (L63, the unfitted length an as-written script sets its target from), `buildTimeline` (L75), `fitTempo` (L197), `MAX_TEMPO` (L188). | run.ts | `timeline.test.ts`, `modes.test.ts` |
| [captions.ts](../../src/generator/pipeline/captions.ts) | Pure. Caption chunks and per-word times: `buildCaptions` (L121), `wordTimes` (L75), `matchesStress` (L89), `CHUNK_CHARS` (L14). | run.ts, assemble.ts | `timeline.test.ts`, `assemble.test.ts` |
| [director.ts](../../src/generator/pipeline/director.ts) | The director: `DirectorSchema` (L125), `normalizeDirector` (L196), `directorInventory` (L336), `worldBlock` (L309), `directorPrompt` (L374), `directStory` (L459). | run.ts; film/fields reads its schema | `director.test.ts` |
| [shots.ts](../../src/generator/pipeline/shots.ts) | Shots per beat. Film rules fill any beat the director left out. `normalizeShots` (L72), `ruleShots` (L132), `timeShots` (L166), `holdReactions` (L237, `REACTION_HOLD` 2.5 s). Uses `camera/shot.ts` and `camera/subjects.ts`. | director.ts, assemble.ts | `shots.test.ts` |
| [sound.ts](../../src/generator/pipeline/sound.ts) | The sound designer: `designSound` (L407), `soundRules` (L305), `BEDS_BY_KIT` (L53), `placeSound` (L94), the lapse ambience (`lapseStretches` L151, `lapseBeds` L198, `lapseAmbience` L243), `matchSound` (L334). | run.ts, assemble.ts, critic.ts | `sound.test.ts` |
| [critic.ts](../../src/generator/pipeline/critic.ts) | `codeChecks` (L57), `critiquePlan` (L90), `applyNotes` (L134), `sceneLook` (L41). | run.ts | `critic.test.ts` |
| [assemble.ts](../../src/generator/pipeline/assemble.ts) | Pure apart from the catalog lookup. Turns beat references into seconds and drops, with a warning, any choice the world can't show. A flight between places never covers a character's line (2026-11-05): it takes off after the last one of the scene it leaves and lands 0.2 s before the first one of the scene it reaches; narration may run over it, as a narrator talks over a map. `assemble` (L111), `EVENT_HIT` (L42), `REACT_HIT` (L68), `parseCounterValue` (L85). | run.ts | `assemble.test.ts`, `run.test.ts` |
| [transitions.ts](../../src/generator/pipeline/transitions.ts) | The scene-to-scene film rules: `planTransitions` (L46), `isFlightCut` (L34). | assemble.ts, audio-resolve.ts | `transitions.test.ts` |
| [editor.ts](../../src/generator/pipeline/editor.ts) | Ask AI. `askEditor`, `describeFilm`, `beatPaths`: a beat-scoped ask may only use that beat's paths. `editProblem` (renamed from `checkEdits`, 2026-11-05; `film/edits.ts` keeps `checkEdits` for the shape check) says why edits are unusable. The word lock of an as-written run: `wordLockProblem` and `typedWords` (`askEditor({ lockWords, typed })`). `notes` passes the producer's standing notes. | server/film.ts, producer.ts | `editor.test.ts` |
| [checker.ts](../../src/generator/pipeline/checker.ts) | The story checker (the `checker` role): `checkStory` gives notes, claims and, for adapt, the user's plot points with the beats that tell them (`lost`: none does, decided by code); `checkerPrompt`, `formatCheck`. Run by the `check` stage before gate 1, into `story.check.json`. | run.ts, generate.ts | `modes.test.ts` |
| [notes.ts](../../src/generator/pipeline/notes.ts) | A run's conversation with the producer, `notes.jsonl` (append only): `readTurns`, `appendTurn`, `proposals` (each with its state), `appliedTurns`, `standingNotes`, `standingBlock` (the prompt block, "" when none), `ACTION_KINDS`. | producer.ts, run.ts | `producer.test.ts` |
| [producer.ts](../../src/generator/pipeline/producer.ts) | The producer you talk to (P5): `say` (the `producer` role's `routeNote`, then a proposal per action), `confirm`, `discard`, `undoLast`, `conversation`, `runPhase`. The work: `restageScenes` (the director for the named scenes only, the rest fixed), `resound`, the editor for edits, the writer for named beats (`applyNotes`), `matchNeeds` for a new need, `fileRequest` for a build. A finished plan's change is a film version. | producer-cli.ts, server/producer.ts | `producer.test.ts` |

Design docs: [05-plan.md](05-plan.md) Phase 2 (the voice-first timeline), [09-phase3-handoff.md](09-phase3-handoff.md) (shots and transitions), [10-intent-audit.md](10-intent-audit.md) (devices never invented), [11-world-reactions.md](11-world-reactions.md) (`react`, the reaction holds), [13-light-and-time.md](13-light-and-time.md) Part B (lapses and their sound).

### `src/generator/film/` ([09-phase4.md](09-phase4.md))
- [edits.ts](../../src/generator/film/edits.ts): edits addressed by id (`story.beats[b3].say`).
  - Exports: `RULES` (L101, the allow-list and redo level), `parsePath` (L79), `applyEdits` (L288), `checkEdits` (L267), `validateFilm` (L233), `beatOfEdit` (L315), and the `Film` type (L33).
  - Test: `film.test.ts`.
- [store.ts](../../src/generator/film/store.ts): versions in `output/<id>/film/`. `openFilm` (L89) adopts stage files that changed outside the editor as a new version. Also `peekFilm` (L124), `saveFilm` (L139), `undoFilm` (L173), `redoFilm` (L177) and `captionOverrides` (L186). Test: `film.test.ts`.
- [diff.ts](../../src/generator/film/diff.ts): what a PUT changed. Exports: `diffTextEdits` (L57), `editsFromTextDiff` (L75), `diffCaptions` (L84), `mergeOverrides` (L101), `dropOverridesForBeats` (L114), `applyCaptionOverrides` (L127). Test: `diff.test.ts`.
- [prepare.ts](../../src/generator/film/prepare.ts): `prepareFilm` (L54), the playable spec in "measure" or "estimate" mode. Shared by the editor preview and the routes. No direct test.
- [fields.ts](../../src/generator/film/fields.ts): the editable fields and their choices, read from DirectorSchema and the sound vocabulary. Exports: `sceneFields` (L43), `shotFields` (L49), `BEAT_FIELDS` (L54), `soundChoices` (L61), `editorFields` (L66).
- [recast.ts](../../src/generator/film/recast.ts): `checkRecast` (L23). Pure. Test: `recast.test.ts`.
- [testFilm.ts](../../src/generator/film/testFilm.ts): `sampleFilm()`, a small film for tests.

### `src/generator/qa/` ([09-phase3-handoff.md](09-phase3-handoff.md), [08-phase3-research.md](08-phase3-research.md) §4)
- [photographer.ts](../../src/generator/qa/photographer.ts): renders one still per shot and checks it.
  - Exports: `checkShots` (L125), `shotFrames` (L75, which avoids lightning frames), `lightAt` (L91), `judgeStill` (L106), and the thresholds (`MAX_FLAT` and others).
  - Without a `serveUrl`, `checkShots` bundles anew, which copies `public/`.
  - Callers: `scripts/photographer.ts`, `milestone.ts --qa`, `phase3-lane-stills.ts`. Test: `photographer.test.ts`.
- [vision.ts](../../src/generator/qa/vision.ts): `visionQuestions` (L38), `askVision` (L58). Fixture label: `vision-<beat>`. Test: `vision.test.ts`.
- [metrics.ts](../../src/generator/qa/metrics.ts): `lumaStats` (L39), `colourfulness` (L74), `exposureVerdict` (L166), `dominantColourShare` (L181). Test: `metrics.test.ts`.
- [png.ts](../../src/generator/qa/png.ts): `decodePng` (L22), for 8-bit RGB or RGBA only. Tested through `metrics.test.ts`.

### `src/generator/render/`: the chunked, cached render ([09-phase4.md](09-phase4.md) §5)
- [index.ts](../../src/generator/render/index.ts): `renderChunked` (L69) and `encoderFor` (L40). Its result is not mastered; the caller runs `masterAudio`. It logs `Rendered n/m` for the server.
- [plan.ts](../../src/generator/render/plan.ts): pure. Chunks of 4 to 20 s, cut on hard cuts only (`planChunks` L164, `hardCuts` L133).
  - The cache key is `planRender` (L291): a global part (`globalPart` L271, which is every field that is not time-sliced) plus a local part (`localSlice` L239).
  - The audio key is `audioKey` (L338). Bump `PLAN_VERSION` (L54) when the key rules change.
  - `story.hook` is keyed with the hook card's slice, not globally (version 3, for the variants: a hook variant re-renders only the hook's chunk).
  - Test: `plan.test.ts`.
- [bundle.ts](../../src/generator/render/bundle.ts): `ensureBundle` (L110) builds `out/phase4-bundles/<hash>/` once per source hash (`sourceHash` L39: `src/**` without the tests, plus `package-lock.json`, `tsconfig.json` and `acquired.catalog.json`, which `src/` imports).
  - The bundle's `public` is a junction ([linkPublic](../../src/generator/render/bundle.ts#L55)). [removeBundle](../../src/generator/render/bundle.ts#L80) unlinks it first.
  - The newest 4 bundles are kept.
- [chunks.ts](../../src/generator/render/chunks.ts): `renderChunks` (L79). Each chunk is muted H.264 in MPEG-TS, written to `output/<id>/chunks/<key>.ts` and listed in `index.json`. A chunk unused for 5 runs is deleted (`keepRuns` raises that; a batch of variants passes it through `renderChunked`).
- [audio.ts](../../src/generator/render/audio.ts): `renderAudioTrack` (L17) renders the `WhatIfAudio` composition to `chunks/audio-<key>.wav`.
- [join.ts](../../src/generator/render/join.ts): `joinChunks` (L43) concatenates the chunks, encodes the audio to AAC and checks the frame count. Also `countFrames` (L25) and `audioDuration` (L33).
- [hash.ts](../../src/generator/render/hash.ts): `treeHash` (L41), `PublicHasher` (L79, memoised in `chunks/hash-memo.json`), and `visualManifest` (L61), a manifest of every picture asset that leaves out `AUDIO_PUBLIC_DIRS`.
- [browser.ts](../../src/generator/render/browser.ts): `BrowserPool` (L30), one Chrome with `gl: angle` that is recycled every 4 uses.

### `server/` (Express 5 on 127.0.0.1:5178)
- [index.ts](../../server/index.ts): every route except the film routes (table below). It also serves the static routes `/media` (L1105, `output/`) and `/sfx` (L1108, `public/sfx`), the `/api` 404 catch-all (L1111) and `ui/dist` when it exists (L1130). Helpers: `rolesProblem` (L284, every role's key and model), `busyPlan` (L308), `criticNotes` (L497), `storyNeeds` (L513, the review's "This story needs"), `shoppingFor` (L558, gate 2's list for the dashboard). Thumbnails use the portable ffmpeg from `src/generator/ffmpeg.ts`.
- [jobs.ts](../../server/jobs.ts): the job store and the CLI runner.
  - Exports: `createJob` (L213), `runJob` (L354), `getJob`, `getAllJobs` (L257), `deleteJob` (L244), `cancelJob` (L258), `premiseSlug` (L270), `subscribeSSE` (L512).
  - A job's run: `runId` (from `RUN_ID:`, L398), `gate: "story"` (from `STORY_ID:`) or `"shop"` (from `SHOP_ID:`), `storyGate`, `shopGate`, `shopSources`, `storyFrom`, `resume`, and `channel`, `mode` and `scriptFile` (`--script output/plan-<jobId>-script.txt`, removed with the job's audio file).
  - [latestReportFor](../../server/jobs.ts#L297) reads the job's own folder first. [failedLogError](../../server/jobs.ts#L333) reads `FAILED-<runId>.log`.
  - Jobs are saved to `output/jobs/`, and at most 50 are kept.
- [film.ts](../../server/film.ts): `registerFilmRoutes` (L219) holds the editor routes, a queue per film (`serial` L43, `queueFilmChange` L60) and the background voice measurement (`startMeasure` L126). GET answers `wordsLocked` for an as-written run, and `/ask` passes the lock. `refreshFilm` re-prepares a film after the producer changed it.
- [publish.ts](../../server/publish.ts): GET and POST `/api/videos/:id/publish` ([20-publish.md](20-publish.md)): `publish.json`, and a job that runs `scripts/publish.ts <id>` (`kind: "publish"`; `runJob` takes `script`). The dashboard's [PublishPanel.tsx](../../ui/src/components/PublishPanel.tsx) is on the done screen and the Library's video page.
- [variants.ts](../../server/variants.ts): GET and POST `/api/runs/:runId/variants` ([15-producer.md](15-producer.md) §17); the POST is checked by the pure [variants-ask.ts](../../server/variants-ask.ts) `checkVariantsAsk` (test: `variants-ask.test.ts`) and runs `generate.ts variants <run> <ask>` as a job (`kind: "variants"` in jobs.ts).
- [producer.ts](../../server/producer.ts): `registerProducerRoutes`: GET `/api/producer/:runId`, POST `say`, `ok`, `no`, `undo`. A finished plan's notes run in the film's queue.
- [progress.ts](../../server/progress.ts): pure. `stageMarker` (L25), `readRenderLog` (L31), `PLAN_PROGRESS` (L13), `nextProgress` (L62). Test: `progress.test.ts`, the only server test.
- [providers.ts](../../server/providers.ts): `loadConfig`, `saveConfig` and `configProblems` through provider-registry (the dashboard's changes go to `ai.config.local.json`), and `loadEnv`, `applyEnv` and `saveEnv` through env.ts. `ROOT` comes from `__dirname`.
- [tts.ts](../../server/tts.ts): the voice engines' status and install. `ttsStatus` (L55); `startInstall` (L108) creates `.tts/<engine>/.venv` with the system `python` and runs `pip install` for `kittenml` or `voxcpm` (network); `getTtsJob` (L78).
- [fetch-models.ts](../../server/fetch-models.ts): `fetchProviderModels` (L114) lists the models from each provider's own API (network, free). Package `ollama` goes through the OpenAI-compatible path, which lists Ollama hosts from their native `/api/tags` (it used to throw: section 7.5, fixed after this map was written). Test: `server/fetch-models.test.ts`.
- [error-hints.ts](../../server/error-hints.ts): `actionable` (L31) turns errors into `{message, fix}`; `keyUrlFor` (L27).

| route | where | what |
|---|---|---|
| GET/PUT `/api/roles` | [L40](../../server/index.ts#L40), [L49](../../server/index.ts#L49) | Model per role; PUT writes `ai.config.local.json` |
| GET/POST `/api/providers`, POST `:name/key` `:name/config` `:name/default` `:name/test`, DELETE `:name`, GET `:name/models` | [L86-279](../../server/index.ts#L86) | Providers. A key goes to `.env`; `test` and `models` make live calls and save the model list in `ai.config.local.json`; GET answers `problems` with either config file |
| POST `/api/plan` | [L312](../../server/index.ts#L312) | Starts a plan job (no render); `storyGate: false` skips the story gate, `storyFrom` reuses a run's story |
| POST `/api/plan/:runId/resume` | [L540](../../server/index.ts#L540) | Approves a waiting story, or continues a stopped run, in a new plan job (409 for a complete plan) |
| GET `/api/runs/:runId` | [L592](../../server/index.ts#L592) | A run's stages, its gate and the next stage |
| GET `/api/channels` | [L574](../../server/index.ts#L574) | The channels: each one's modes, formats, captions, voices, gates and version |
| GET/PUT `/api/channels/:id`, POST `/api/channels` | (after `/api/channels`) | Settings > Channels: one profile as its file holds it, a checked save (the version goes up when it changed), a copy as a new channel |
| POST `/api/runs/:runId/offers`, POST `/api/runs/:runId/link` | (before `/api/channels`) | Gate 2 from a card: more offers for one need (up to 20 a source, saved in `shopping.json`); a pasted link read as an offer. Nothing is downloaded |
| `/api/producer/:runId` GET, POST `say` `ok` `no` `undo` | [producer.ts](../../server/producer.ts) | The producer you talk to (15 §16) |
| GET `/api/spec/:jobId` | [L611](../../server/index.ts#L611) | The plan's state, its story at the gate, its shopping list at gate 2 (`gate: "shop"`), or its spec (with the critic's kept `notes`) |
| GET `/api/assets` | [L677](../../server/index.ts#L677) | The Assets page: `sourceStatus()`, the ranked build requests, the acquired items (and whether their files are here) |
| POST `/api/plan/:specId/recast` | [L665](../../server/index.ts#L665) | Gives a character another voice; rebuilds without a model |
| POST `/api/render-spec` | [L714](../../server/index.ts#L714) | Renders an approved spec: by default with the plan's own voices and chunked (every dashboard button sends only `specId`); `audio` and `chunked: false` for other callers |
| GET `/api/jobs`, GET `/api/jobs/:id`, GET `/api/jobs/:id/events`, DELETE `/api/jobs/:id` | [L760](../../server/index.ts#L760), [L874](../../server/index.ts#L874), [L880](../../server/index.ts#L880), [L1042](../../server/index.ts#L1042) | Jobs, and SSE progress |
| POST `/api/generate` | [L772](../../server/index.ts#L772) | Legacy one-shot plan and render, with no story gate; no UI caller |
| POST `/api/voice-sample` | [L897](../../server/index.ts#L897) | An audition WAV, kept out of `public/` |
| GET `/api/videos`, DELETE `/api/videos/:id` | [L932](../../server/index.ts#L932), [L1047](../../server/index.ts#L1047) | The library, newest first; lists per-video folders and old flat files. DELETE also removes the video's voice files (`output/<id>-voice/`, `<id>-voice.json`, `public/voice/<id>/`) and never deletes through a link |
| GET `/api/tts/status`, POST `/api/tts/install/:engine`, GET `/api/tts/job/:id`, GET `/api/voices` | [L982-1013](../../server/index.ts#L982) | The voice engines |
| `/api/film/:id` GET, PUT, `/status`, `/edit`, `/ask`, `/undo`, `/redo` | [film.ts L220-397](../../server/film.ts#L220) | The editor |

### `ui/src/`: the dashboard (React 19, Vite, Tailwind 4)
- **How it is wired.**
  - There is no router library: the URL query is the state ([routes.ts](../../ui/src/lib/routes.ts#L57) `normalizeQuery`, [navigation.tsx](../../ui/src/lib/navigation.tsx#L43) `navigate`).
  - [App.tsx](../../ui/src/App.tsx#L26) picks the page and lazy-loads the Editor (L21).
  - [main.tsx](../../ui/src/main.tsx) mounts it. [index.css](../../ui/src/index.css) holds the dark-first Tailwind tokens.
- **The URLs.**
  - `?tab=create&step=idea|format|voice|captions|summary` is the wizard.
  - `step=writing|review&plan=<jobId>` is the plan screen (the story alone, when the job stopped at the story gate); `step=rendering|done&job=<jobId>` is the render screen.
  - `?tab=library[&video=]`, `?tab=assets`, `?tab=settings&section=models|voice|checklist` and `?tab=help` are the other pages.
  - `?tab=editor&film=<specId>&from=...` is the editor.
- **[api.ts](../../ui/src/api.ts): every call to the server.**
  - The functions include `planSpec` L63, `getJobSpec` L114, `getChannels` L134, `resumeRun` L140, `getRun` L155, `renderSpec` L162, `recastVoice` L235, `voiceSample` L245, `getRoles`/`saveRoles` L301/L306, `getProviders` L316, `getFilm` L445, `putFilm` L457, `editFilm` L465, `askFilm` L473, `undoFilm`/`redoFilm` L477/L481, `listJobs` L494 and `listVideos` L502.
  - [errorText](../../ui/src/api.ts#L269) shows the server's `{error, fix}`.
  - Its types come from `src/` through `import("../../src/...")`.
  - Two kinds of request bypass api.ts: the SSE stream, and the `/media/...` URLs.
- **[pages/create/](../../ui/src/pages/create): the wizard.**
  - [wizard.ts](../../ui/src/pages/create/wizard.ts#L176) is the shared store, saved to localStorage under `vf:*`. [videoSettingsToPayload](../../ui/src/pages/create/wizard.ts#L221) and [voiceConfigToAudio](../../ui/src/pages/create/wizard.ts#L234) build the request. `video.storyGate` (L40) is the "Read the story first" switch, on unless turned off; it is sent as its own field. `channel` and `story` (`OwnStory` L19) are the channel and the pasted story with its mode; `hasIdea` (L65) lets the idea step be left with either an idea or a story.
  - [Create.tsx](../../ui/src/pages/create/Create.tsx#L36) switches between the steps.
  - [SetupSteps.tsx](../../ui/src/pages/create/SetupSteps.tsx) holds the five choosing steps. The idea step ([IdeaStep](../../ui/src/pages/create/SetupSteps.tsx#L89)) has the channel picker and the "Use my own story" box. The Format step has the story gate's switch (L460).
  - [PlanStep.tsx](../../ui/src/pages/create/PlanStep.tsx#L180) shows the writing progress (`PLAN_STAGES` L68, with the gate, the breakdown and the match as steps) and the review. Its `approve` (L713) calls `renderSpec`. [StoryGateView](../../ui/src/pages/create/PlanStep.tsx#L420) is the story's review at gate 1; its approve (L426) calls `resumeRun`. [ResumeButton](../../ui/src/pages/create/PlanStep.tsx#L383) resumes a failed or interrupted plan. [NeedsList](../../ui/src/pages/create/PlanStep.tsx#L839) is the review's read-only "This story needs". [ShoppingStep.tsx](../../ui/src/pages/create/ShoppingStep.tsx#L187) is gate 2's Shopping list step (`PLAN_STAGES` has it as "Your shopping list").
  - [RunStep.tsx](../../ui/src/pages/create/RunStep.tsx#L65) holds the render (SSE at L122, polling fallback at L100) and the done screen.
  - [parts.tsx](../../ui/src/pages/create/parts.tsx) holds the stepper and the frame.
- **[pages/editor/](../../ui/src/pages/editor): the editor.**
  - [Editor.tsx](../../ui/src/pages/editor/Editor.tsx#L116) holds `save` (L190, POST `/edit`), `onSaveSpec` (L214, PUT), `move` (L243, undo and redo) and `render` (L257, chunked).
  - [Inspector.tsx](../../ui/src/pages/editor/Inspector.tsx#L490) builds one form per item kind from the server's `fields`.
  - [Timeline.tsx](../../ui/src/pages/editor/Timeline.tsx#L50) draws the tracks.
  - [tracks.ts](../../ui/src/pages/editor/tracks.ts#L65) is pure: `deriveTracks`, `askTargetBeat` (L248). It has no test.
  - [AskAi.tsx](../../ui/src/pages/editor/AskAi.tsx#L34) proposes, then applies; in an as-written run it says the words are kept.
  - [components/ProducerChat.tsx](../../ui/src/components/ProducerChat.tsx): the producer's chat on a run (proposals with Apply and Discard, Undo, standing notes), in the editor, the plan review and the story review.
- **The other pages.**
  - [Library.tsx](../../ui/src/pages/library/Library.tsx#L97) lists the videos.
  - [Assets.tsx](../../ui/src/pages/assets/Assets.tsx#L56) shows the sources, the build requests and the acquired items ([getAssets](../../ui/src/api.ts#L229)); it only reads.
  - [Settings.tsx](../../ui/src/pages/settings/Settings.tsx#L34) has four sections: [AiModels.tsx](../../ui/src/pages/settings/AiModels.tsx) (providers, keys, model roles; a broken config file is named), [Channels.tsx](../../ui/src/pages/settings/Channels.tsx) (`section=channels&channel=<id>`: a profile in a form or as JSON, and a copy as a new channel), [VoiceEngines.tsx](../../ui/src/pages/settings/VoiceEngines.tsx#L153) and a checklist.
  - [Help.tsx](../../ui/src/pages/Help.tsx#L33) shows `HELP` from [lib/help.ts](../../ui/src/lib/help.ts#L15), the one registry behind every `InfoTip`.
- **Shared code.**
  - [components/AppShell.tsx](../../ui/src/components/AppShell.tsx#L17) holds the nav and the job status.
  - [CaptionPanel.tsx](../../ui/src/components/CaptionPanel.tsx#L108) has a live `<Player>` of `CaptionPreview`.
  - [StorySection.tsx](../../ui/src/components/StorySection.tsx#L21) handles characters and recasting.
  - [useVoiceAudition.tsx](../../ui/src/components/useVoiceAudition.tsx), [InfoTip.tsx](../../ui/src/components/InfoTip.tsx) and [shared.tsx](../../ui/src/components/shared.tsx) are small helpers.
  - `components/ui/*` are shadcn-style Radix wrappers.
  - [lib/jobs.ts](../../ui/src/lib/jobs.ts#L54) polls `/api/jobs` every 5 s and shows a toast when a job finishes ("Your story is ready to read" for a plan stopped at the story gate). [lib/format.ts](../../ui/src/lib/format.ts#L19) holds `FORMATS` with the length caps.
- **[preview/PlayerPreview.tsx](../../ui/src/preview/PlayerPreview.tsx#L39).** `SpecPlayer` plays the real `WhatIfVideo` composition through the `@` alias, in the editor only.
- **[ui/vite.config.ts](../../ui/vite.config.ts#L16).**
  - It serves port 5177 (`strictPort`) and proxies `/api` and `/media` to 5178.
  - `publicDir` is the project's `public/`.
  - It aliases `react`, `remotion`, `three` and `zod` to the root `node_modules`, so the dashboard and the composition share one copy.
  - Docs: [09-phase4.md](09-phase4.md) (the editor, and the 2026-10-26 redesign).

### `scripts/`
| file | what it does | fills or writes | npm script |
|---|---|---|---|
| [milestone.ts](../../scripts/milestone.ts) | The 3 premises × 3 formats check. `planAndRenderOne` (L171) calls generateSpec in-process, then spawns `generate.ts --from-spec` (one-shot, not chunked); `measure` (L111) judges length, overlaps, silence, caption sync, loudness, the 48 kHz rate and estimated lines; `--qa` adds `checkShots`. | `output/milestone/report.json` and `report.md`, stills, logs | `milestone` |
| [photographer.ts](../../scripts/photographer.ts) | `checkShots` on a rendered id; vision only when the vision role has a model | `output/<id>/qa/` | `photographer` |
| [verify-video.ts](../../scripts/verify-video.ts) | RMS per second; exits 1 on a silent second | a temporary WAV | `verify` |
| [self-review.ts](../../scripts/self-review.ts) | Stills at key frames. Finds only flat `output/<id>-spec.json` (stale) | `output/<id>-review/` | `review` |
| [audio-audit.ts](../../scripts/audio-audit.ts) | Audio stream and SFX presence. Stale: runs no checks on current specs | `output/<id>-report.json` | `audit` |
| [models.ts](../../scripts/models.ts) | Prints `getProviderStatus` | | `models` |
| [probe-nvidia.ts](../../scripts/probe-nvidia.ts) | One live `generateText` call; not a GPU probe | | `probe:gpu` |
| [check-ui-icons.mjs](../../scripts/check-ui-icons.mjs) | Fails on emoji, symbol glyphs and en or em dashes anywhere in `ui/src`, comments included | | part of `lint` |
| [setup-audio-library.ts](../../scripts/setup-audio-library.ts) | Downloads Kenney, OpenGameArt, BigSoundBank (curated ids in `audio-library.bigsoundbank.json`) and FreePD; converts and measures with loudnorm | `public/library/**`, `audio-library.json` | `audio:library` |
| [setup-sfx.ts](../../scripts/setup-sfx.ts) + [sfx-synth.ts](../../scripts/sfx-synth.ts) | Seeded DSP synthesis of the fallback sounds (`ROLES` L1469, `SEEDS` L1406) | `public/sfx/<role>.wav`, `sfx.catalog.json` (tracked) | `sfx` |
| [setup-sfx-cc0.ts](../../scripts/setup-sfx-cc0.ts) | Adds Kenney recordings as ranked variants | `public/sfx/cc0/` | `sfx:cc0` |
| [story-tts.py](../../scripts/story-tts.py) | The Python TTS: batch mode (prints `@@ {durations}`) or `--worker` (Kitten kept loaded) | `<outDir>/<id>.wav` | run by `tts.ts`, `server/tts.ts` |
| [setup-assets.ts](../../scripts/setup-assets.ts) + [export-asset-index.ts](../../scripts/export-asset-index.ts) | Downloads the CC0 model packs; writes the catalog, then `src/compositions/assetIndex.generated.ts` | `public/assets/{characters,city,nature,props,vehicles}`, `assets.catalog.json` | `assets`, `assets:index` |
| `setup-world-data.ts`, `setup-world-assets.ts` + `world-assets/*`, `build-world-catalog.ts` | World data, packs and catalog (see [17-code-map-world.md](17-code-map-world.md)) | `src/world/data/*`, `public/assets/world/` | `world:data`, `world:assets`, `world:catalog` |
| `preview-terrain.ts`, `preview-roads.ts`, `phase3-lane-stills.ts`, `qc-ocean.cjs`, `qc-world-props.cjs` | World previews and QC stills | `out/...` | `preview:*`, `lane:stills`, `qc:*` |
| [enrich-example-spec.ts](../../scripts/enrich-example-spec.ts) | Writes the resolved `cast[].file` into the gravity example | the example spec | `enrich:spec` |
| [add-fonts.ps1](../../scripts/add-fonts.ps1) | PowerShell; pulls the OFL fonts | `public/fonts/` (tracked) | none |

No script makes a paid model call unless a paid provider is chosen. The downloaders use the network. `scripts/` has no tests.

### `test-fixtures/pipeline/`
Recorded model replies, replayed by `FACTORY_LLM_FIXTURES` (section 4.4).

| set | files | used by |
|---|---|---|
| `money-doubles`, `oceans-vanish`, `forest-walks` | `writer-1`, `writer-revise-1`, `director-1`, `sound-1` (`.txt`), and `audio.json` (the voice settings they were recorded with) | `milestone --fixtures` (9:16 and 1:1, 25 s), `run.test.ts` and `critic.test.ts` (`money-doubles`) |
| `<name>-long` | the same files | `milestone --fixtures` (16:9, 60 s) |
| `real` | 13 recordings each of writer, writer-revise, director and sound | nothing replays it: an archive of a real-model run |

Other tests write their replies to a temporary directory (the pattern in `llm.test.ts` and `writer.test.ts`). The labels in use are `writer`, `writer-revise`, `writer-outline`, `writer-act-<n>`, `writer-notes`, `director`, `sound`, `critic`, `editor` and `vision-<beat>`.

### Root configs
- [package.json](../../package.json): the scripts (section 4.1). `remotion`, `@remotion/renderer` and `@remotion/bundler` are 4.0.536. `react` is 19.2.3, `three` 0.178.0 and `zod` 4.5.4. The AI SDK is `ai` v7 with `@ai-sdk/*`, `ai-sdk-ollama` and the `ollama` client.
- [ai.config.json](../../ai.config.json) (tracked: the shared defaults; since 2026-11-05 the dashboard writes its changes to the git-ignored `ai.config.local.json`, laid over it):
  - top-level keys: `defaultProvider`, `providers.<name> = {package, apiKeyEnv, baseUrl?, models[]}` and `roles.<role> = {provider, model}`;
  - providers at HEAD: gateway, openai, anthropic, google, openrouter, nvidia and ollama;
  - `defaultProvider` is `ollama`, and only `roles.writer` is set (nvidia).
- [remotion.config.ts](../../remotion.config.ts): rspack, `angle`, jpeg frames, `publicDir` from `process.cwd()`. It applies to the CLI only, not to the Node APIs that the chunked render uses.
- [tsconfig.json](../../tsconfig.json): strict, `noUnusedLocals`, `@/*` to `src/*`. It has no `include`, so `tsc` checks `src`, `server`, `scripts` and `ui/src` alike.
- `assets.catalog.json` (git-ignored, written by `setup-assets.ts`): `{generatedAt, sources[{name,url,license}], note, count, assets[{id, file, pack, category, tags[], animations[], license}]}`. It has 1073 assets on the dev laptop, in five categories: characters, city, nature, props and vehicles.
- `.env` (git-ignored; written by the dashboard's key form). The key names are in [.env.example](../../.env.example) (section 4.2).

---

## 4. Commands and settings

### 4.1 npm scripts
| script | what it runs | flags and env |
|---|---|---|
| `producer` | `tsx src/generator/producer-cli.ts` | `new "<premise>" [generate's flags]`, `resume <run>`, `status <run>`, `needs <run>`, `get <run> n6=... [--all-cc0]`, `say <run> "<note>"`, `ok <run> [p1 ...]`, `no <run> [p1 ...]`, `undo <run>`, `notes <run>` ([15-producer.md](15-producer.md) §16) |
| `generate` | `tsx src/generator/generate.ts` | `"<premise>"`, `--provider X`, `--model Y`, `--no-render`, `--from-spec <file>`, `--audio-file <file>`, `--chunked`, `--format 9:16\|16:9\|1:1`, `--duration <s>`, `--scenes <1-12>`, `--quality draft\|final`, `--critic`, `--settings-json '<json>'`; runs: `--resume <run>`, `--status <run>`, `--no-story-gate`, `--story-from <run>` ([15-producer.md](15-producer.md) §11); channels and modes: `--channel <id>`, `--script <file>`, `--mode premise\|adapt\|as-written`, `--channels` (§12); gate 2: `--approve n6=<source>:<id> n2=close n3=build n9=skip`, `--all-cc0`, `--no-shop-gate`, `--sources a,b|none` (§14); variants: `--variants hooks=3,endings=2,formats=9:16,16:9`, and the command `variants <run> <ask> [--no-render]` (§17); `--publish`: the publish pack after the render ([20-publish.md](20-publish.md)) |
| `server` | `tsx server/index.ts` | `PORT` (default 5178) |
| `ui` / `ui:build` | Vite dev on 5177 / a build into `ui/dist` | |
| `test` | `tsx --test "src/**/*.test.ts" "server/**/*.test.ts"` | |
| `lint` | `eslint src && tsc && node scripts/check-ui-icons.mjs` | |
| `milestone` | `tsx scripts/milestone.ts` | `--fixtures`, `--qa`, `--only a,b`, `--formats 9:16,16:9`; `MILESTONE_PARALLEL` (1-4, default 2; 1 with fixtures), `FACTORY_LLM_RECORD` |
| `photographer` | `tsx scripts/photographer.ts` | `<id> [--bundle out/<dir>] [--scale 0.5] [--no-vision]` |
| `verify`, `review`, `audit` | the QA scripts in section 3 | `<mp4>`; `<id-or-premise>` |
| `audio:library`, `sfx`, `sfx:cc0` | the sound library and the fallbacks | `--only kenney,oga,bigsoundbank,freepd`, `--music <n>`, `--force` |
| `assets`, `assets:index`, `world:data`, `world:assets`, `world:catalog` | the model packs and catalogs | `world:assets [kenney kaykit quaternius landmarks]`, `world:catalog --verbose` |
| `models`, `probe:gpu` | the provider status; one live call | `probe:gpu [provider] [model]` |
| `dev`, `build`, `upgrade` | Remotion Studio, a bundle, `remotion upgrade` | |
| `preview:terrain`, `preview:roads`, `lane:stills`, `qc:ocean`, `qc:world-props`, `enrich:spec` | the world tools (render side) | |

How to run the dashboard: `npm run server` and `npm run ui`, then open `http://localhost:5177`. See also [09-phase4.md](09-phase4.md), "Running it on either machine".

### 4.2 Environment variables
| name | read by | what it does |
|---|---|---|
| `AI_GATEWAY_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `OLLAMA_API_KEY`, `NVIDIA_API_KEY` | each provider's `apiKeyEnv` ([provider-registry.ts L109](../../src/generator/ai/provider-registry.ts#L109), [llm.ts L206](../../src/generator/pipeline/llm.ts#L206)) | The provider keys. `NVIDIA_API_KEY` is missing from `.env.example`. `OLLAMA_BASE_URL` is in `.env.example`, but nothing reads it. |
| `FACTORY_LLM_FIXTURES` | llm.ts, generateSpec, `/api/plan`, jobs.ts | Replays recorded replies from that folder (section 4.4) |
| `FACTORY_ROOM` | audio-resolve.ts, audio-room.ts | `off` turns the room reverb and distance off (output as before `63aca43`); on by default |
| `FACTORY_LLM_RECORD` | llm.ts [recordReply](../../src/generator/pipeline/llm.ts#L253) | Saves every real reply there |
| `FACTORY_PLAN_TTS=1` | [voice.ts L215](../../src/generator/pipeline/voice.ts#L215) | Synthesizes Kitten lines at plan time instead of estimating them |
| `TTS_KITTEN_PYTHON`, `TTS_VOXCPM_PYTHON` | tts-python.ts | Which Python runs each engine |
| `TTS_KITTEN_WORKER=0` | tts.ts | Turns the persistent Kitten worker off |
| `TTS_WORKER_LINE_TIMEOUT_MS` | tts.ts | The worker's time limit per line (default 7 minutes) |
| `FFMPEG_PATH` | ffmpeg.ts | Overrides the ffmpeg binary |
| `MILESTONE_PARALLEL` | milestone.ts | The size of the worker pool |
| `PORT` | server/index.ts | The API port |
| `HF_HUB_OFFLINE` | set by story-tts.py (1) and the install's verify step (0) | Stops Hugging Face downloads at synthesis time |

A CLI run picks up `.env` through [loadDotEnv](../../src/generator/env.ts), which never overrides the shell. The server applies `.env` over `process.env` before a plan (`applyEnv`, the same reader with `override`), and the spawned CLI inherits it.

### 4.3 Models per role, and adding a provider
- **Roles.** producer (the one you talk to), writer, reader (the script reader, as-written runs only), checker (the story checker), director, sound, critic, breakdown, matcher, vision and editor ([ROLE_DEFS](../../src/generator/ai/roles.ts#L13)). They are chosen in Settings → AI models → Model roles, which writes `roles` to `ai.config.local.json` through PUT `/api/roles`.
- **Resolution** ([resolveRoleModels](../../src/generator/pipeline/llm.ts#L53)):
  - The writer takes the CLI flags first ([pickRoleModel](../../src/generator/ai/roles.ts#L96)), then `roles.writer`, then `defaultProvider` and `defaultModel`.
  - Every other role takes its own assignment, or else the writer's.
  - The vision role is used only when it is set (`scripts/photographer.ts`). The editor role is resolved in [film.ts L354](../../server/film.ts#L354).
- **Calls.** Every model call goes through [callRole](../../src/generator/pipeline/llm.ts#L282).
  - Ollama (by name or by package) uses the native client with `format` set to the zod JSON schema and streams the reply.
  - Every other provider uses AI SDK `generateText` with the schema appended to the prompt ([contractFor](../../src/generator/pipeline/llm.ts#L182)).
  - Images (the vision role) work only with Ollama, at temperature 0.
- **Standing rule:** no paid APIs. The user runs every role on Ollama ([HANDOFF](HANDOFF.md) §1).
- **Adding a provider** is recipe 6.3.

### 4.4 Fixture replay
- **How it works.** `FACTORY_LLM_FIXTURES=<dir>` makes every `callRole` read `<dir>/<label>-<n>.txt` instead of calling a model ([fixtureReply](../../src/generator/pipeline/llm.ts#L245)).
  - The reply goes through the same lenient parse, normalizer, schema and essential check as a real one.
  - `n` counts the calls to that label in this process, repair attempts included, so a reply that fails its check reads `<label>-2.txt` next.
  - [resetFixtureCounters](../../src/generator/pipeline/llm.ts#L158) restarts the count (in tests, and in milestone runs).
  - No key or model is needed: `generateSpec` and `/api/plan` skip the provider checks.
  - Fixture replay never reads or writes a run's saved replies (`.calls/`), so the counts move on exactly as before. A resume in a new process starts the counts again, and the stages it keeps ask nothing.
- **A plan from fixtures, with no key** (in PowerShell, set the variable with `$env:FACTORY_LLM_FIXTURES="test-fixtures/pipeline/money-doubles"` first):
  ```
  FACTORY_LLM_FIXTURES=test-fixtures/pipeline/money-doubles npm run generate -- "What if money doubled every 3 seconds?" --no-render --format 9:16 --duration 25 --audio-file test-fixtures/pipeline/money-doubles/audio.json
  ```
  - It stops at the story gate. Go on with the `npm run generate -- --resume <run> --no-render` line it prints, with the same variable set, or add `--no-story-gate` to the first command.
  - The labels of the newer roles: `writer-adapt` (the adapt mode), `reader` (as written), `breakdown` and `matcher-<need>` (P3). A set without `breakdown-1.txt` skips the breakdown and the match. A missing matcher reply falls back to code verdicts with a warning. `keeper-as-written/` holds a drama script with all of them except the matcher.
  - Match the set's format and length: `<name>` was recorded for 9:16 and 1:1 at 25 s, and `<name>-long` for 16:9 at 60 s. Otherwise the beat count or an essential check fails, a repair is asked for, and the replay stops with "fixture missing".
- **Rendering a fixture plan** needs no model: `npm run generate -- --from-spec output/<id>/spec.json`. It does need Kitten 2 installed, because the render measures every line.
- **The dashboard on fixtures.** Start the server with the variable set. Every plan job then uses the set and is labelled "fixtures".
- **Recording.** Set `FACTORY_LLM_RECORD=<dir>` with a real model. [recordReply](../../src/generator/pipeline/llm.ts#L253) never overwrites a file; it takes the next free number.
- See also [PROGRESS.md](PROGRESS.md), "Phase 2: how to test without a key".

### 4.5 Checks before a commit
These are the [HANDOFF](HANDOFF.md) §1 list:
- `npx tsc --noEmit`
- `npm test`
- `npx eslint src server`
- `npm run ui:build`
- `node scripts/check-ui-icons.mjs`

`npm run lint` covers ESLint on `src` only, then `tsc`, then the icon check. When other chats have uncommitted edits in the tree, check on a clean `git worktree` as HANDOFF describes. `ui:build` copies the whole of `public/` (about 900 MB) into `ui/dist`.

---

## 5. `public/` and `output/` (not in git, except where noted)

| `public/` folder | what it holds | filled by |
|---|---|---|
| `library/{sfx,ambience,music,stinger}/`, `audio-library.json` | The CC0 sound library: 775 files, with LUFS and true peak measured | `npm run audio:library` |
| `sfx/` (tracked) | The synthesized fallback per sound name, `cc0/` variants, `sfx.catalog.json`, `ATTRIBUTIONS.md` | `npm run sfx`, `npm run sfx:cc0` |
| `voice/<id>/` | The final voice WAVs of each video (7 tracked samples) | `synthesizeLines` (copies from `.cache/voice`), `tempoVoiceFile` |
| `assets/{characters,city,nature,props,vehicles}/`, `assets/world/` | The 3D models | `npm run assets`, `npm run world:assets` |
| `fonts/` (tracked) | The OFL caption fonts | `scripts/add-fonts.ps1` |
| `whatif-audio/`, `whatif-data/` (tracked, although listed in `.gitignore`) | Legacy Story Studio files; nothing writes them | none |

| `output/` path | what it holds | written by |
|---|---|---|
| `<id>/story.json` … `plan.json`, `critique.json` | The stage files (section 2.2). Since producer P1 a planned `<id>` is a run id, `<slug>-<6 hex>`, so one premise can have several folders | run.ts |
| `<id>/run.json`, `brief.json`, `.calls/` | The run's manifest, what was asked, and its saved model replies (section 2.2) | manifest.ts, run.ts, llm.ts |
| `<id>/breakdown.json`, `needs.json` | What the story needs, and the library match (P3) | run.ts |
| `<id>/spec.json`, `props.json`, `video.mp4`, `report.json` | The plan and the render | generate.ts |
| `<id>/audio.json` | The approval's voice settings | `/api/render-spec` |
| `<id>/thumb.jpg` | The library thumbnail | jobs.ts, `/api/videos` |
| `<id>/film/head.json`, `v<N>.json` | The editor's versions | film/store.ts |
| `<id>/chunks/<key>.ts`, `audio-<key>.wav`, `index.json`, `hash-memo.json` | The chunk cache (the run's variants render into it too) | render/ |
| `<id>/variants/variants.json`, `<id>/variants/<variant>/spec.json`, `video.mp4` | The run's variants: what each differs in, its state and chunks ([15-producer.md](15-producer.md) §17) | pipeline/variants.ts |
| `<id>/qa/` | The photographer's stills and `qa.json` | `npm run photographer` |
| `<id>-voice/`, `<id>-voice.json` | The TTS work folder and the voice manifest | tts.ts ([L435](../../src/generator/tts.ts#L435), [L564](../../src/generator/tts.ts#L564)) |
| `jobs/<jobId>.json` | The dashboard's jobs | server/jobs.ts |
| `plan-<jobId>-audio.json`, `plan-<jobId>-script.txt` | A plan's voice settings and pasted story, deleted when the job ends | `/api/plan` |
| `FAILED-<id>.log` | A failed premise run | generate.ts |
| `milestone/`, `<id>-review/` | The milestone report and stills; self-review | scripts |
| `<id>-spec.json`, `<id>-report.json`, `<id>-<stamp>.mp4` and others | Flat files from before 2026-10-25, still listed by `/api/videos` | old runs, and milestone.ts (a flat `-spec.json`) |

Elsewhere:
- `.cache/voice/` holds the TTS line cache. `.cache/{audio-library,world,world-assets}/` hold the downloads.
- `.tts/<engine>/.venv/` holds the voice engines.
- `scripts/asset-cache/` holds the downloaded zips.
- `out/` is scratch space, with code copies that should be ignored:
  - `phase4-bundles/<hash>/` are the chunked render's bundles, whose `public` is a junction.
  - `render-bundle-<id>/` are the CLI render's bundles. Since 2026-11-04 their `public` is a junction too. Older ones on the dev laptop still hold a full copy of `public/`.
  - The rest are QA folders and other chats' copies.
- `ui/dist/` holds the dashboard build.

---

## 6. How-to recipes

### 6.1 Add a spec field, end to end
Example: a new director device.
1. **Schema.** Add the field to [ShotSpecSchema](../../src/generator/spec.schema.ts#L392), or to `SceneSchema` (L123) for a per-scene field.
   - Make it optional, so old specs still validate.
   - Add any timing rule to [validateSpec](../../src/generator/spec.schema.ts#L548), worded as a fix.
   - Import nothing from Node here.
2. **Director.**
   - Add the field to [DirectorSchema](../../src/generator/pipeline/director.ts#L125) as optional or nullable.
   - Accept the usual spellings in [normalizeDirector](../../src/generator/pipeline/director.ts#L196).
   - Describe it in [directorInventory](../../src/generator/pipeline/director.ts#L336) and show it in the JSON shape in [directorPrompt](../../src/generator/pipeline/director.ts#L374).
   - Add an essential check in [directStory](../../src/generator/pipeline/director.ts#L459) only if the plan can't do without it.
   - The JSON contract follows from the schema by itself ([contractFor](../../src/generator/pipeline/llm.ts#L182)).
3. **Assembler.** In [assemble](../../src/generator/pipeline/assemble.ts#L111), turn the beat references into seconds from the timeline. Drop, with a warning, anything the scene can't show, and add the field to the `spec` object (L434). Never invent a value the director didn't choose ([10-intent-audit.md](10-intent-audit.md)).
4. **Render keys.** In [plan.ts](../../src/generator/render/plan.ts), a new field is global by default: changing it re-renders every chunk, which is safe. Make it time-sliced (`TIME_SLICED` L268, `localSlice` L239) only when the composition reads it by time, and then bump `PLAN_VERSION`.
5. **Renderer.** Read the field in the composition ([17-code-map-world.md](17-code-map-world.md) §2 and §4).
6. **Editor** (if it is editable):
   - add a path to [RULES](../../src/generator/film/edits.ts#L101) with its redo level;
   - scene and shot fields appear in [fields.ts](../../src/generator/film/fields.ts) by themselves;
   - add per-beat paths to [beatPaths](../../src/generator/pipeline/editor.ts#L30) and the field to [describeFilm](../../src/generator/pipeline/editor.ts#L71) for Ask AI;
   - in the UI, edit `Inspector.tsx`, `tracks.ts`, and `PlanStep.tsx` (which has hard-coded labels).
7. **Tests:**
   - `director.test.ts` for the normalizer and the prompt;
   - `assemble.test.ts` for the seconds and the drops;
   - `spec.schema.test.ts`;
   - `plan.test.ts` if the key rules changed.

   The committed fixtures don't have the field, so `run.test.ts` and `milestone --fixtures` show that it stays optional.

### 6.2 Add a pipeline role, or change a prompt
1. **Declare it.** Add the role to [ROLE_DEFS](../../src/generator/ai/roles.ts#L13). Settings lists it through GET `/api/roles`, and PUT accepts it.
2. **Write the module** in `pipeline/<role>.ts`, following [writer.ts](../../src/generator/pipeline/writer.ts):
   - a `SYSTEM` string;
   - an exported prompt builder;
   - a small zod schema;
   - a normalizer built from `asArray`, `beatRef` and `fuzzyEnum`;
   - an essential check;
   - one `callRole` call with a new `label`. The label is also the fixture file name.
3. **Wire it.**
   - In [planStages](../../src/generator/pipeline/run.ts#L365): call it inside `runStage(run, "<name>", <its inputs>, …)`, with `stage("<name>")` and `save(id, "<name>", …)` in its `work`. The inputs are hashed, so list everything the stage reads.
   - Add the stage to `STAGES` and its file to `STAGE_FILES` in [manifest.ts](../../src/generator/pipeline/manifest.ts#L34), and the role to `resolveRoleModels` ([run.ts L376](../../src/generator/pipeline/run.ts#L376)).
   - In the key check of `/api/plan` ([rolesProblem](../../server/index.ts#L284)).
   - In [PLAN_PROGRESS](../../server/progress.ts#L13) and the UI's `PLAN_STAGES` ([PlanStep.tsx L68](../../ui/src/pages/create/PlanStep.tsx#L68)).
4. **Rebuilds.** If its output has to survive a rebuild, `reassemble` and the film store's four `STAGES` must read it. Today only story, direction, sound and plan are rebuilt.
5. **Fixtures.** Every committed set needs a `<label>-1.txt`, or the replay throws (recipe 6.6).
6. **Changing a prompt.** The prompts live next to each role:
   - the writer: `SYSTEM` L149, `writerPrompt` L185;
   - the director: `SYSTEM` L365, `directorInventory` L336, `worldBlock` L309;
   - the sound designer: `SYSTEM` L372, `soundPrompt` L379;
   - the critic: `SYSTEM` L84;
   - the editor: `SYSTEM` L18, `describeFilm` L71;
   - vision: [askVision](../../src/generator/qa/vision.ts#L58).

   Build the vocabularies from the code's constants, never as typed-out lists, so the prompt and the schema can't drift. Fixtures replay the old replies whatever the prompt says, so tests can't judge a prompt: check it on a real (Ollama) model, then record a new set.

### 6.3 Add a provider
1. **An OpenAI-compatible endpoint** needs no code.
   - In Settings → AI models → Add provider ([AddProviderDialog](../../ui/src/pages/settings/AiModels.tsx#L370), which posts to `/api/providers`), give `package: "openai"`, a `baseUrl` and an `apiKeyEnv`.
   - Save the key: it goes to `.env`.
   - Press Get models, which runs [fetchProviderModels](../../server/fetch-models.ts#L114) and rewrites `models` in `ai.config.json`.
   - Assign the provider to roles.
   - The same entry can be written into `ai.config.json` by hand.
2. **A new SDK package:**
   - add a branch to [resolveModel](../../src/generator/ai/provider-registry.ts#L90) and widen `ModelReference` (L33);
   - add a model-listing function to `fetch-models.ts`;
   - add the key URL to `KEY_URLS` in [error-hints.ts](../../server/error-hints.ts#L27);
   - add the key name to `.env.example`.

   [askModel](../../src/generator/pipeline/llm.ts#L196) needs a branch only if the provider must not go through AI SDK `generateText` (as Ollama doesn't).
3. **Check it** with `npm run models`, then the provider card's Test button, which makes one live call.

### 6.4 Add a sound name or a music mood
- **A hit or bed name.**
  - Add it to [SOUND_QUERY](../../src/generator/audio-resolve.ts#L44) with its kinds and word sets. Every word of a set must be among a library file's tags; check them in `public/library/audio-library.json`.
  - The name then joins [soundVocabulary](../../src/generator/pipeline/sound.ts#L38) by itself, which feeds the designer's prompt, the normalizer and the editor's choices.
  - Make sure it always plays: either a library match, or a synthesized fallback `public/sfx/<name>.wav`, made by adding a role to `scripts/setup-sfx.ts` `ROLES` (L1469) and `SEEDS` (L1406) and running `npm run sfx`. A name with neither is dropped at render time with a warning.
- **Defaults.** Default beds are set per kit in [BEDS_BY_KIT](../../src/generator/pipeline/sound.ts#L53) and per real place in [placeSound](../../src/generator/pipeline/sound.ts#L94). Device sounds are `EVENT_HIT` and `REACT_HIT` ([assemble.ts L42-76](../../src/generator/pipeline/assemble.ts#L42)). The loudness target for each kind is in [TARGET_LUFS](../../src/generator/audio-resolve.ts#L28).
- **A music mood.** Add it to [MOOD_TAGS](../../src/generator/audio-resolve.ts#L76) with words found in the music files' tags (the FreePD folder names). It becomes a choice for the writer (`MOODS`) and the sound designer. With no matching file, the report says "(none found)" and the video has no music.
- **New sounds from a new source.** Add them in `scripts/setup-audio-library.ts`, after the licence check in [03-audio-sources.md](03-audio-sources.md).
- **Tests:** `sound.test.ts`, `assemble.test.ts`. Never play audio; measure it instead (`npm run verify`, the milestone).

### 6.5 Add a dashboard page or an API route
- **A route.**
  - Add it in `server/index.ts` before the `/api` 404 catch-all ([L1111](../../server/index.ts#L1111)), or in a `register…Routes(app)` module like [film.ts](../../server/film.ts#L219).
  - Check every id with `/^[a-z0-9-]+$/` before it touches the file system.
  - Answer errors as `{ error, fix }` (`actionable()` handles provider errors).
  - Run long work through `runJob` (a CLI child process) or a per-id queue, never inline.
  - Put pure logic in its own module with a `server/*.test.ts` beside it, as `progress.ts` does.
- **The client.** Add a typed function to [api.ts](../../ui/src/api.ts) that uses its `json()` helper, so the `fix` reaches the user.
- **A page:**
  1. add the section to `Section` and to `normalizeQuery` and `sectionOf` in [routes.ts](../../ui/src/lib/routes.ts#L19);
  2. add the page to the switch and to `titles` in [App.tsx](../../ui/src/App.tsx#L56);
  3. add a `NAV` entry in [AppShell.tsx](../../ui/src/components/AppShell.tsx#L17), with a lucide icon;
  4. add help text to [help.ts](../../ui/src/lib/help.ts#L15).

  No emoji and no en or em dashes, even in comments: `check-ui-icons.mjs` fails on them.

### 6.6 Add a test fixture set
1. **Record** with a real model, Ollama under the standing rules:
   ```
   FACTORY_LLM_RECORD=test-fixtures/pipeline/<name> npm run generate -- "<premise>" --no-render --no-story-gate --format 9:16 --duration 25 --audio-file <voice settings>
   ```
   Without `--no-story-gate` the run stops after the writer; set the variable again for the resume, or the director and sound replies are not recorded. The milestone records in the same way (it never stops at the gate).
2. **Keep the replies the replay will ask for, in call order:** `writer-1`, `writer-revise-1` (only if the length needed a revise), `director-1`, `sound-1`, and `critic-1` with `writer-notes-1` when the critic is on. A repair attempt is the next number. Hand edits are fine, and `<think>` blocks and code fences parse.
3. **Add `audio.json`** with the voice settings the set was recorded with.
4. **For the milestone,** add the premise to `PREMISES` ([milestone.ts L40](../../scripts/milestone.ts#L40)) and record a `<name>-long` set at 16:9, 60 s.
5. **Replay it once** with `FACTORY_LLM_FIXTURES` (section 4.4). If a test uses it:
   - call `setOutputDir(<temp folder>)` at the top of the file, so its runs stay out of `output/`;
   - call `resetFixtureCounters()` before each plan;
   - remove the run's voice files by id afterwards (`output/<id>-voice/`, `<id>-voice.json`, `public/voice/<id>/`).

   `run.test.ts` and `resume.test.ts` follow this pattern.

---

## 7. Gotchas

### 7.1 Determinism
- **The picture** is a pure function of the spec ([17-code-map-world.md](17-code-map-world.md) §1.6).
- **Sound picks.** [pickEntry](../../src/generator/audio-library.ts#L57) is seeded by the video id and the cue, so a re-render plays the same files. Rebuilding the library changes the candidate lists, and with them the picks.
- **Voices.** The TTS samples at temperature 0.6 with no seed. A line sounds the same again only because `.cache/voice` keeps it, keyed by engine, voice, description, text and `SYNTH_VERSION`. Bump that version when the synthesis settings change. Deleting the cache changes every voice and its timing.
- **Plan-time timing depends on the machine.** [calibratedModel](../../src/generator/pipeline/voice.ts#L151) fits the voice rate to whatever `.cache/voice` holds. That moves the writer's word budget, the decision to revise, and the plan's length. `run.test.ts` asserts `revised === true`, so it rests on this too. The render re-times from real audio, so the final video is not affected.
- **The director's prompt depends on the machine.** [memoryBlock](../../src/generator/ai/knowledge.ts#L253) lists the 8 newest rendered videos ([rendered](../../src/generator/ai/knowledge.ts#L173): `output/<id>/report.json` and the old flat `output/<id>-report.json`). Fixture replay is not affected, but the director's saved-reply key (`.calls/`) changes with it, so a resume that crosses a new render asks the director again.
- **Model replies are never deterministic; fixtures are.** Vision asks for temperature 0, on Ollama only.
- **Chunk keys** include the bundle hash of all of `src/`, so any edit under `src/` re-renders every chunk ([PROGRESS.md](PROGRESS.md), known limits).
- **Wall-clock values:** `report.generatedAt`, job ids, `sfx.catalog.json` `generatedAt` (a tracked file that changes on every `npm run sfx`), and the slug fallback `premise-<Date.now()>`.

### 7.2 Tests: the Node runner, not vitest
- **The runner.** Every test uses `node:test` and `node:assert/strict`, run through `tsx --test`. There is no vitest or jest config, and `describe`, `it` and `expect` don't exist here.
- **Running them.** Run one file with `npx tsx --test src/generator/pipeline/assemble.test.ts`. `npm test` covers `src/**` and `server/**`. Nothing tests `ui/` or `scripts/`.
- **Tests touch real files.** They read the machine's `public/library`, `public/sfx/sfx.catalog.json`, `assets.catalog.json` and `.cache/voice`. A test can therefore pass on one laptop and fail on a fresh checkout. Some skip themselves when Kitten 2 or a rendered still is missing.
- **Where tests write.**
  - The pipeline tests (`run`, `critic`, `resume`, `manifest`) keep their runs in a temp folder ([setOutputDir](../../src/generator/pipeline/manifest.ts#L29)).
  - The voice timing still writes `output/<id>-voice/`, `<id>-voice.json` and `public/voice/<id>/` through `tts.ts`, which has fixed paths. Those tests remove them by id afterwards.

### 7.3 Bundles and the `public` junction
- **The chunked render.** It links `public/` into `out/phase4-bundles/<hash>/public` as a directory junction ([bundle.ts L55](../../src/generator/render/bundle.ts#L55)).
  - Never delete a bundle folder recursively through it. Unlink the junction first, with `rmdir <bundle>\public` ([HANDOFF](HANDOFF.md) §1); [removeBundle](../../src/generator/render/bundle.ts#L80) does this for you.
  - A plain `du` over `out/` walks the junctions.
- **The CLI render.** The default, non-chunked path in generate.ts builds `out/render-bundle-<id>/` with the Node API and links its `public` as a junction ([freshBundle](../../src/generator/generate.ts#L555)), about 48 MB instead of a full copy.
  - An older bundle under that name is removed by [removeTree](../../src/generator/generate.ts#L529), which removes any link it meets and never descends into one.
  - `milestone --qa` still finds the bundle under the same name.
  - Ten older bundles on the dev laptop still hold full copies of `public/` (real files, safe to delete; check each `public` with `dir /AL` first).
- **Other bundles.** `checkShots` without `--bundle` and `self-review.ts` bundle anew in the same way.

### 7.4 Windows
- **The CLI render is portable since 2026-11-04.** It finds ffmpeg through [resolveFfmpeg](../../src/generator/ffmpeg.ts#L13) and runs `node node_modules/@remotion/cli/remotion-cli.js` instead of `cmd /c remotion.cmd`. The server's thumbnails use the same ffmpeg. Several scripts still hard-code the Windows ffmpeg or `.cmd` files. Nothing has been run off Windows yet.
- **The props go through a file** (`output/<id>/props.json`) because asset-heavy specs pass Windows' command-line limit of about 32 KB.
- **Absolute paths.** `--from-spec` and `--audio-file` count a path that contains `:` (a drive letter) as absolute.
- **Python.** The voice venvs use `Scripts/python.exe` on Windows and `bin/python` elsewhere ([tts-python.ts L24](../../src/generator/tts-python.ts#L24)). The install runs `python -m venv` with the system Python.
- **Line endings and BOMs.**
  - Git warns "LF will be replaced by CRLF" on several files.
  - These files begin with a BOM: `render/index.ts`, `film/diff.ts`, `film/prepare.ts`, `server/film.ts` and `ui/src/pages/editor/Inspector.tsx`. A regex anchored at the first line can miss.
  - The last two lines of `.gitignore` (`ui/public/` and `ui/public/fonts/`) are UTF-16, so they ignore nothing.
- **Mixed project roots.** Most modules resolve paths from `process.cwd()`, but `server/providers.ts` and `tts-python.ts` use `__dirname`. Always run from the repository root.

### 7.5 Bugs and drift found while mapping (read from code)
Items 1, 3, 4, 5, 6, 7, 9, 10, 11 and 12 are fixed, and so are two of the stale comments in item 8 (6, 7, 9 and 11 in `e848f64`, 2026-11-05). The CLI render's copy of `public/` (section 7.3) and its Windows-only paths (section 7.4) are fixed too. The fixes after item 1 are in commit `728edf6` (2026-11-04). The other items are open.

1. **Ollama model listing (fixed in the commit after this map).** [fetchProviderModels](../../server/fetch-models.ts#L114) has no branch for `package: "ollama"`. It throws "No live model listing for package "ollama"" (checked with a local call that makes no request). That is the package of the user's main `ollama` entry in `ai.config.json`, so Get models fails on its card. Test fails too: `/test` catches the error, and GET `/models` gets it as a synchronous throw.
2. **SFX cue units.** The schema calls `SfxCueSchema.at`, `from` and `to` frames ([spec.schema.ts L13-18](../../src/generator/spec.schema.ts#L13)). The assembler writes `to` in seconds (`REACT_HIT` cuts) and the composition reads it as seconds. The schema comment is wrong; `scripts/audio-audit.ts` mixes the two units.
3. **`generatedAt` sorts (fixed).** `report.generatedAt` is an ISO string, but three places sorted it as a number, so the order was unreliable: `/api/videos`, `latestReportFor` (which could pick the wrong video when two share a premise) and `recentStories`. All three now sort by [reportTime](../../src/generator/ai/knowledge.ts#L163). `latestReportFor` also reads the job's own folder first.
4. **The director's memory read only flat files (fixed).** `recentStories` read only `output/<id>-report.json` and `<id>-spec.json`, so it saw only old and milestone videos. It now reads every rendered video through [rendered](../../src/generator/ai/knowledge.ts#L173). A folder whose spec is a flat file (the milestone's) falls back to it.
5. **Deleting a video left files behind (fixed).** `DELETE /api/videos/:id` now also removes `public/voice/<id>/`, `output/<id>-voice/` and `output/<id>-voice.json`.
6. **Two loaders for the same files (fixed: env.ts and provider-registry `readAiConfig` serve both, and a broken file is named).** `ai.config.json` is read by [loadAiConfig](../../src/generator/ai/provider-registry.ts#L60) (zod-checked; an invalid file silently becomes an empty config) and by the server's [loadConfig](../../server/providers.ts#L24) (raw). `.env` is read by `loadDotEnv` (never overrides) and the server's `loadEnv` (always overrides).
7. **`ai.config.json` is a tracked file that the dashboard rewrites (fixed: the dashboard writes `ai.config.local.json`, git-ignored, over it)** (roles, providers and live model lists). Leave it out of a commit unless the change is meant to be committed.
8. **Stale comments:**
   - Fixed: `roles.ts` said "Only the writer is wired today", and `jobs.ts` said the CLI has no dotenv loader.
   - `.env.example` lacks `NVIDIA_API_KEY` and lists an unused `OLLAMA_BASE_URL`.
   - The schema's narration engine defaults to `voxcpm2` ([L526](../../src/generator/spec.schema.ts#L526)), while the pipeline defaults to `kitten2`.
9. **Name clash** (fixed: pipeline/editor.ts's is now `editProblem`). `checkEdits` exists twice with different signatures: [film/edits.ts L267](../../src/generator/film/edits.ts#L267) checks the shape of the edits, and [pipeline/editor.ts L158](../../src/generator/pipeline/editor.ts#L158) checks that they apply and stay in scope.
10. **Slug length (fixed).** `generate-spec.ts` slugged a premise to 60 characters and `generate.ts` to 96. Both now use [newRunId](../../src/generator/pipeline/manifest.ts#L126): a run id, `<slug of 60>-<6 hex>`.
11. **The dashboard's three render buttons sent different settings (fixed: each sends only the plan's id; the server renders with the plan's voices, chunked):**
    - Approve sends the wizard's current voice choices from localStorage;
    - the editor sends `chunked` and no voices;
    - Try again on the render screen sends neither.
12. **Scripts that couldn't see new runs (fixed 2026-11-04):** `scripts/runs.ts` finds a run in either layout, and `self-review.ts`, `audio-audit.ts` and `phase3-lane-stills.ts` use it.
    - `audio-audit.ts` checked nothing on current specs: it kept only cues with an `at`, and judged a window by its WAV's byte size. It now measures each cue's peak and RMS from the decoded audio.

### 7.6 Dead code
- **Removed on 2026-11-04:**
  - `buildKnowledge`, `engineToolsBlock` and `soundCatalogBlock` in `knowledge.ts`;
  - the UI exports `setProviderConfig`, `generateVideo`, `hrefFor`, `FieldLabel` and the `PlayerPreview` component (`SpecPlayer` stays).
- **Removed later on 2026-11-04:** `pickVoice`, `DEFAULT_NARRATOR` and `DEFAULT_CHARACTER` in `voices.ts`; `volumeRamp` and `frameToSec` in `timing.ts`; `lookAtEnd` in `look-choice.ts`.
- **A field nothing reads:** `spec.palette`.
- **Legacy paths still reachable:**
  - `POST /api/generate`, which has no UI caller any more;
  - the job `engine` values `template`, `story` and `storyboard`;
  - `runTtsStage` and `deriveLines`, used only by offline-template specs.
- **Leftover files:** `voice-probe/` (24 WAVs nothing references), `public/phone.mp4` and `public/tablet.mp4`, and `test-fixtures/pipeline/real/` (an archive).
