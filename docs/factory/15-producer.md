# 15 — The producer: one factory for every genre (design)

Status (2026-11-04):
- **P1 is built:** runs that save and resume, and the story gate ([§11](#11-status-what-p1-built-2026-11-04)).
- **P2 is built:** channel profiles and the story modes ([§12](#12-status-what-p2-built-2026-11-04)).
- **P3's breakdown and library match are wired into runs** (§3, "As built").

The rest is a design or is being built (P4). P1 and P2 use the recommended defaults of §10 questions 1, 2, 3 and 13; the other questions still need the user's answers.

## The ask
The user's words, paraphrased:
- One tool for every genre, so they can run several YouTube channels, each in its own genre. Today the writer only makes "what if" videos.
- They give a topic, or a whole story of their own. The strongest model available writes or checks the story, and the story is saved so it is never redone.
- A breakdown lists everything the story needs: sets or places, characters, props, actions and animations, effects, sounds, music.
- Another stage checks what the factory already has.
- For anything missing, the system asks the user. Once approved, it downloads the item and adds it to the library, so next time it exists.
- The one the user talks to delivers exactly what was asked; other models do their parts under it.

The standing rules still hold ([HANDOFF.md](HANDOFF.md) §1): stylized low-poly 3D, no image-generation models, CC0 sounds, no paid model APIs during development, nothing on screen without intent.

## 1. Where things stand

### What already fits the vision
| Vision | What exists | Where |
|---|---|---|
| Stages save their work | Each stage writes a JSON file in `output/<id>/`: story, voice, timeline, direction, sound, critique, plan, then spec | [run.ts:56](../../src/generator/pipeline/run.ts#L56), [:146](../../src/generator/pipeline/run.ts#L146), [:171](../../src/generator/pipeline/run.ts#L171), [:211](../../src/generator/pipeline/run.ts#L211), [generate.ts:251](../../src/generator/generate.ts#L251) |
| Rebuild without model calls | `reassemble()` rebuilds the spec from the stage files; the render re-times it from the measured voice | [run.ts:264](../../src/generator/pipeline/run.ts#L264), [:279](../../src/generator/pipeline/run.ts#L279) |
| A gate before rendering | The dashboard plans with `--no-render`; the CLI prints `PLAN_ID`; the review shows story, scenes, sound and settings; nothing renders until Approve calls `/api/render-spec` | [server/index.ts:409](../../server/index.ts#L409), [:495](../../server/index.ts#L495), [generate.ts:257](../../src/generator/generate.ts#L257), [PlanStep.tsx](../../ui/src/pages/create/PlanStep.tsx) |
| Notes on a plan | The editor keeps versions with undo (`output/<id>/film/v<N>.json`). Ask AI proposes edits for one beat or the whole video, limited to exact paths, saved only when the user accepts | [editor.ts:16](../../src/generator/pipeline/editor.ts#L16), [:30](../../src/generator/pipeline/editor.ts#L30), [:171](../../src/generator/pipeline/editor.ts#L171), [server/film.ts:348](../../server/film.ts#L348), [film/store.ts](../../src/generator/film/store.ts) |
| Models per role | Six roles (writer, director, sound, critic, vision, editor), each with its own provider and model in `ai.config.json`; a role without one uses the writer's | [roles.ts:12](../../src/generator/ai/roles.ts#L12), [llm.ts:46](../../src/generator/pipeline/llm.ts#L46) |
| Any provider | gateway, openai, anthropic, google, openrouter, nvidia and ollama are configured; any OpenAI-compatible URL can be added | `ai.config.json`, [llm.ts:167](../../src/generator/pipeline/llm.ts#L167) |
| Work without keys | Recorded replies (`FACTORY_LLM_FIXTURES`) stand in for every model | [llm.ts:16](../../src/generator/pipeline/llm.ts#L16) |
| Long stories | Over 180 s the writer outlines acts, then writes one act per call | [writer.ts:292](../../src/generator/pipeline/writer.ts#L292), [:322](../../src/generator/pipeline/writer.ts#L322) |
| A library | The world catalog: 4,030 models in 44 packs, 29 of them CC-BY landmarks with credit lines. The older cast catalog: 1,073 models. Sound: 775 files (630 effects, 86 stingers, 40 music tracks, 19 ambience beds) | [catalog.ts](../../src/world/catalog.ts), [asset-catalog.ts](../../src/generator/asset-catalog.ts), [audio-library.ts](../../src/generator/audio-library.ts) |
| Licence checked per item | Poly Pizza's licence is read from each model page (CC0 only for the cast packs; CC-BY with a credit line for landmarks). Quaternius's comes from the licence file in the zip. BigSoundBank files are kept only if the page says "Free and Royalty Free". A CC-BY record without a credit line stops the build | [setup-assets.ts:286](../../scripts/setup-assets.ts#L286), [landmarks.ts:12](../../scripts/world-assets/landmarks.ts#L12), [quaternius.ts:278](../../scripts/world-assets/quaternius.ts#L278), [setup-audio-library.ts:199](../../scripts/setup-audio-library.ts#L199), [setup-world-assets.ts:65](../../scripts/setup-world-assets.ts#L65) |
| Credits | `creditsFor` lists the CC-BY lines a video used | [catalog.ts:573](../../src/world/catalog.ts#L573) |
| Clips mapped by name | Clip keys are matched to each pack's clip names, with procedural stand-ins for wave, point, cheer and the rest | [rigs.ts:31](../../src/world/actors/rigs.ts#L31), [:57](../../src/world/actors/rigs.ts#L57), [:81](../../src/world/actors/rigs.ts#L81) |
| Jobs survive a restart | Job files live in `output/jobs/`; a job that was running at the restart is marked interrupted | [jobs.ts:55](../../server/jobs.ts#L55), [:139](../../server/jobs.ts#L139) |
| Reuse | Voice lines are cached by hash in `.cache/voice`; the chunked render reuses unchanged chunks | [tts.ts:21](../../src/generator/tts.ts#L21), [09-phase4.md](09-phase4.md) |

### What is missing
1. **One genre.** Every prompt is written for "what if" videos: the writer ([writer.ts:149](../../src/generator/pipeline/writer.ts#L149); the hook is always "What if ...?", [:196](../../src/generator/pipeline/writer.ts#L196)), the director ([director.ts:365](../../src/generator/pipeline/director.ts#L365)), sound ([sound.ts:372](../../src/generator/pipeline/sound.ts#L372)) and the critic ([critic.ts:84](../../src/generator/pipeline/critic.ts#L84)). There is no channel and no profile.
2. **No story of the user's own.** `/api/plan` takes a premise of 6 characters or more ([server/index.ts:274](../../server/index.ts#L274)) and the writer always writes. A user's script would be rewritten.
3. **The story is not kept.** `runPlan` calls the writer every time ([run.ts:144](../../src/generator/pipeline/run.ts#L144)). The run id is the premise slug ([generate.ts:222](../../src/generator/generate.ts#L222), [:55](../../src/generator/generate.ts#L55)), so the same premise overwrites its folder and asks the writer again. When the director fails, story.json is on disk but nothing reads it back. The length revise ([run.ts:151](../../src/generator/pipeline/run.ts#L151)) and the critic's notes ([run.ts:192](../../src/generator/pipeline/run.ts#L192)) rewrite the story without asking.
4. **No gate for the story alone.** The user sees story, scenes and sound together, after every model call has been made.
5. **No breakdown.** The writer gets one line on what can be filmed ([writer.ts:156](../../src/generator/pipeline/writer.ts#L156)). The director sees the 60 catalog lines that best match the premise's words ([director.ts:360](../../src/generator/pipeline/director.ts#L360), [asset-catalog.ts:92](../../src/generator/asset-catalog.ts#L92)). Whatever the world cannot show is dropped with a warning ([assemble.ts:7](../../src/generator/pipeline/assemble.ts#L7)). Nobody lists what the story needs, so nobody knows what is missing.
6. **No acquisition.** Downloads are batch scripts with hard-coded lists (`npm run assets`, `world:assets`, `audio:library`), with no per-item search, approval or intake.
7. **No place for capability gaps.** Nothing records "this story needed bullet time".
8. **Two model catalogs.** Cast entries are validated against `assets.catalog.json` ids ([asset-catalog.ts:58](../../src/generator/asset-catalog.ts#L58)). The world engine uses `world-catalog.json`, which already holds the older packs, under other ids.
9. **Edits, not a conversation.** Ask AI handles one request with one proposal. It cannot re-stage a scene, add something new or remember the user's earlier notes. It can insert only lines, shots, world events and hits ([editor.ts:62](../../src/generator/pipeline/editor.ts#L62)).
10. **A fixed vocabulary.** It is fine as it is, but it limits every genre:
    - 12 kits ([spec.schema.ts:143](../../src/generator/spec.schema.ts#L143)) and 4 places ([places.ts:280](../../src/world/places.ts#L280));
    - up to 3 characters ([writer.ts:66](../../src/generator/pipeline/writer.ts#L66)), and 4 actors per scene with 14 actions ([spec.schema.ts:238](../../src/generator/spec.schema.ts#L238), [:249](../../src/generator/spec.schema.ts#L249));
    - 12 scenes ([spec.schema.ts:274](../../src/generator/spec.schema.ts#L274)), and 90 s or 600 s of video ([spec.schema.ts:303](../../src/generator/spec.schema.ts#L303));
    - 11 camera moves ([shot.ts:14](../../src/generator/camera/shot.ts#L14)) and 11 world events ([knowledge.ts:51](../../src/generator/ai/knowledge.ts#L51));
    - 8 music moods with 5 tracks each (10 for sci-fi) ([audio-resolve.ts:76](../../src/generator/audio-resolve.ts#L76)), and 28 named sounds ([audio-resolve.ts:44](../../src/generator/audio-resolve.ts#L44)).
11. **One memory for everything.** The anti-repetition block reads every report in `output/` ([knowledge.ts:313](../../src/generator/ai/knowledge.ts#L313)), not one channel's.

## 2. The target pipeline

### Who does what
- **The producer** is the one the user talks to. In code it is a state machine that owns the run: the stages, their files, the gates and resuming.
  - A model (the `producer` role) is used only to understand the user's words, turning each note into an action, and to explain what is happening.
  - It never writes the story or stages scenes itself; it asks the roles to.
  - Keeping the run in code is what makes resuming and "exactly what was asked" checkable. Mid-size models are also unreliable in long tool loops; the factory works because each role gets one small schema with a repair loop ([llm.ts:232](../../src/generator/pipeline/llm.ts#L232)).
- **The name.** The user called the orchestrator "the director", but `director` is already the staging and camera role. This doc calls the orchestrator the producer (open question 1).
- **The roles under it:** writer, story checker, script reader, breakdown, matcher, librarian, director, sound, critic, editor and photographer (§8).

### The stages
```
brief ─► STORY (write | adapt | as written) ─► story check ─► [gate 1: the story]
      ─► BREAKDOWN ─► MATCH against the inventory ─► [gate 2: the shopping list]
      ─► ACQUIRE (download → intake → library)   +   BUILD REQUESTS (queued; a fallback is chosen)
      ─► VOICE + TIMELINE   (starts as soon as gate 1 passes; runs while gate 2 waits)
      ─► DIRECTOR ─► SOUND ─► CRITIC + BRIEF CHECK ─► ASSEMBLE ─► [gate 3: the plan, with the editor]
      ─► RENDER ─► [gate 4: the video] ─► notes to the producer ─► back to the stage each note needs
```

| Stage | Reads | Writes | Role |
|---|---|---|---|
| Brief | the user's form or command | `brief.json` | none |
| Story | brief, channel profile | `story.json`, `story.check.json` | writer, story checker, or script reader |
| Breakdown | approved story | `breakdown.json` | breakdown |
| Match | breakdown, inventory | `needs.json` | matcher (code first) |
| Acquire | the needs the user approved | library manifests, `acquisition.json` | librarian |
| Voice, timeline | approved story | `voice.json`, `timeline.json` (as today) | none |
| Director | story, timeline, resolved needs, standing notes | `direction.json` | director |
| Sound | story, direction, resolved sound needs | `sound.json` | sound |
| Critic, brief check | everything above | `critique.json`, the brief check in `report.json` | critic (optional) |
| Assemble | everything above | `spec.json` | none |
| Render | spec | `video.mp4`, `report.json` | none |
| Notes | the user's messages | `notes.jsonl`, film versions | producer, then the role each note needs |

### What a run saves
```
output/<run>/
  run.json          the manifest: profile id and version, each stage's state, input hash, model, times, error, approvals
  brief.json        what was asked: mode, text or premise, channel, format, length, the must-haves the user named
  story.json        as today, plus story.check.json (the checker's notes and listed claims)
  breakdown.json    the needs as the model listed them
  needs.json        each need matched: have / close / download / build / data / skip, candidates, the user's choice
  acquisition.json  what was fetched for this run and how intake went
  voice.json  timeline.json  direction.json  sound.json  critique.json  plan.json  spec.json   (as today)
  film/v<N>.json    as today: the editor's versions
  notes.jsonl       the conversation with the producer, one line per turn, with the actions taken
  .calls/           each model reply, keyed by role, model and prompt hash (replayed on resume)
  video.mp4  report.json
```
Shared, all committed: `channels/<id>.json` (profiles, §7), `scripts/intake/models.json` and `scripts/intake/sounds.json` (what intake added, §6), and `build-requests/<id>.json` (§4).

### Resume
- **A run id per run:** `<slug>-<6 hex>`. It still passes the existing `[a-z0-9-]+` checks ([server/index.ts:450](../../server/index.ts#L450)). A new run never overwrites an old one. "Write it again" starts a new run that can reuse the old story.
- **`run.json`** has one entry per stage: its state (waiting, running, done, failed, approved, stale), the hash of its inputs, the file it wrote, the model, the times and the error.
- **A stage runs only when needed:** when its file is missing, failed, or stale (its input hash changed). Resume runs from the first stage that is not done. The dashboard shows "Resume from \<stage\>"; the CLI is `npm run producer -- resume <run>`. A server restart resumes the run instead of marking it interrupted.
- **Approved means locked.** After gate 1 the story is locked, and after gate 2 the needs are. Nothing downstream rewrites them; any change goes back through its gate.
  - The length revise moves inside the story stage, before gate 1.
  - The critic's notes on the story become proposals at gate 1 or 3. They are never silent rewrites.
- **Stale stages are explained.** Editing an approved story marks everything after it stale, and the producer says what will be redone, for example: "b3 and b4 changed: 2 lines are re-voiced, the director re-stages scene 2, the breakdown re-checks 1 need". Beat ids stay stable, so choices for unchanged beats can be kept (the critic already relies on this, [critic.ts:5](../../src/generator/pipeline/critic.ts#L5)).
- **Model replies are cached** in `.calls/`. A crash in the middle of a stage replays the calls that finished at no cost, which matters for long form written act by act. `FACTORY_LLM_RECORD` already writes replies this way ([llm.ts:217](../../src/generator/pipeline/llm.ts#L217)).

### Story modes
- **Write** (a premise): today's writer, given the channel's template (§7).
- **Adapt** (the user's story, rewritten into beats): the writer gets the user's text as its source. It may cut and rephrase. The story checker compares the two and lists any plot point that was lost.
- **As written** (the user's script, word for word):
  - The script reader works in code first. Narration paragraphs become `say`, `NAME: line` becomes dialogue, text in `[...]` or `(...)` becomes `see`, and headings or `---` start new acts.
  - A model fills in only what code cannot: it splits long paragraphs into beats at sentence ends, writes a `see` for beats with no direction, and gives each character a gender, age and look.
  - A code check keeps it word for word. All the spoken text of the beats, joined together, must equal the user's spoken text once whitespace and quotes are normalised. A reply that changes a word goes back to the model (callRole's essential check) or is rejected.
  - The script sets the length: no revise and no speed-up (open question 3); the timeline stretches the visual holds. Before any voicing, an estimate from words per second (`calibratedWps`) says whether the script fits the format. If it doesn't, the user is told how long it runs and that 16:9 holds 10 minutes.
  - The story checker only comments: clarity, pacing, what the picture will need. It never changes a word.
  - The editor keeps it that way. In an as-written run, Ask AI may not change `say` or `lines` unless the user typed the new words.

### The gates
| Gate | Shows | The user can | Default |
|---|---|---|---|
| 1 the story | title, hook, beats, characters, the checker's notes and listed claims | approve, edit lines, have named beats rewritten, write it again | on |
| 2 the shopping list | each need: in stock, substitute, download, build | approve downloads, pick a candidate, accept a substitute, skip, file a build request, wait for it | on when something is missing; passes by itself when everything is in stock |
| 3 the plan | today's review (story, scenes, sound, settings), the editor, the brief check | approve, edit, talk to the producer | on |
| 4 the video | the render, the report (brief check, credits) | accept, send notes | on |

A channel may skip gate 1 (for example a Shorts channel run in volume). Gate 2 always asks before a download.

### The producer you talk to (building on editor.ts)
- **One chat per run,** saved in `notes.jsonl`, open at gates 1, 3 and 4 and in the editor.
- **Each message is routed.** A small-schema call (the producer role) turns it into one or more actions:

| Action | Handled by | Example |
|---|---|---|
| edit | the editor role as it is today (`askEditor`, exact paths) | "make the hook shorter" |
| restage | the director, for the named scenes only, with the note | "scene 2 should be in Cairo at night" |
| resound | sound, with the note | "no music in the intro" |
| story | the writer for named beats (in an as-written run, the user's own words), then gate 1 for those beats | "add a beat where the cat escapes" |
| need | a breakdown of the new thing, then a match, then gate 2 | "put a pirate ship in it" |
| build | a build request (§4) | "bullet time on the dodge" |
| question | answered from the plan; nothing changes | "why is it 34 s long?" |
| settings | the plan's settings (a new format still needs a new plan) | "captions in yellow" |

- **Proposals first.** Every action comes back as a proposal with a one-line summary and a diff, as Ask AI's does today ([server/film.ts:348](../../server/film.ts#L348)). It is applied only on confirm, and lands as a film version ([film/store.ts](../../src/generator/film/store.ts)), so undo works.
- **Restage is new.** `directStory` today plans the whole video. Restaging gives it the other scenes as fixed context and replaces only the named scenes' scenes, shots, world events and actors, under the same checks (counter react, lapse, beat refs).
- **Standing notes.** A confirmed note that states a preference ("keep the cat orange", "no dutch angles") stays with the run and goes into the director, sound and editor prompts, so a later restage keeps it. The producer offers to make it a channel rule.
- **Exactly what was asked.** The brief holds the must-haves: format, length, story mode and the things the user named. The brief check (gate 3 and the report) lists each one and how it was met. A must-have that was substituted or dropped shows in amber; it never disappears silently.

## 3. The breakdown

### What the model lists
Each need has a kind, a short description, search words, its beats and whether the story fails without it. The model never names ids or files; code matches them. Code assigns the need ids, as it does beat ids.
```ts
type NeedKind =
  | "set" | "character" | "prop" | "vehicle" | "animal"
  | "action" | "effect" | "camera" | "sound" | "ambience" | "music" | "graphic";

interface Need {
  id: string;          // "n1", given by code
  kind: NeedKind;
  what: string;        // "an old lighthouse keeper with a grey beard"
  words: string[];     // ["old", "man", "keeper", "beard"]
  beats: string[];     // ["b1", "b4", "b7"]
  who?: string;        // for an action: the character who does it
  must: boolean;       // the story does not work without it
  fallback?: string;   // what would do instead: "any sailing boat"
  look?: string;       // colour, era, region, mood
}
```
Rules in the prompt:
- One need per thing: the same character in five beats is one need with five beats.
- At most about 3 needs per beat.
- `must` only when the story fails without it.
- Nothing the profile does not allow (a documentary lists no bullet time).

Long stories get one call per act, and code merges the results (same kind and the same words make one need).

### How each kind is matched
| Kind | Matched against | Where it is known today | A miss becomes |
|---|---|---|---|
| set | the 12 kits with their guide text, the 4 places and their region looks, later the model sets (§4) | [knowledge.ts:32](../../src/generator/ai/knowledge.ts#L32), [director.ts:325](../../src/generator/pipeline/director.ts#L325), [places.ts:280](../../src/world/places.ts#L280) | a model set (download), a new set type (build), or a new place in a known look (data) |
| character | world catalog `character` records (74, 100 models have clips), with recolouring | [catalog.ts](../../src/world/catalog.ts) | download |
| prop, vehicle, animal | world catalog by category and name words, with a size check | [catalog.ts:559](../../src/world/catalog.ts#L559) | download |
| action | the character's own clips through `mapClips`, the procedural stand-ins and the 14 actor actions | [rigs.ts:57](../../src/world/actors/rigs.ts#L57), [script.ts:21](../../src/world/actors/script.ts#L21) | a clip for that rig (download) or a procedural action (build) |
| effect | 11 world events, 7 reactions, weather, the time-lapse, the counter, timer, hero prop and bpm devices, transitions | [knowledge.ts:51](../../src/generator/ai/knowledge.ts#L51), [director.ts:46](../../src/generator/pipeline/director.ts#L46) | build |
| camera | 11 moves, 3 styles, 6 sizes, 5 angles, the camera styles | [shot.ts:11](../../src/generator/camera/shot.ts#L11) | build |
| sound | the 28 named sounds, then library tags (every word must match, as `pickEntry` does) | [audio-resolve.ts:44](../../src/generator/audio-resolve.ts#L44), [audio-library.ts:57](../../src/generator/audio-library.ts#L57) | download |
| ambience | the 19 ambience beds by tags | `public/library/audio-library.json` | download |
| music | the 8 moods and the tracks under each (5 per mood today) | [audio-resolve.ts:76](../../src/generator/audio-resolve.ts#L76) | download more tracks |
| graphic | counter, timer, captions and HUD; maps, labels and diagrams are not built | | build |

Voices are not in the list: Kitten has 23 fixed presets and VoxCPM voices are designed from a text description, so there is nothing to download.

How a match is made:
1. **Code scores.** The need's words are stemmed and run through a small synonyms table (cop is police, automobile is car), and its kind maps to catalog categories. Code scores the overlap with names, tags, pack names and capability descriptions, and keeps the top 5.
2. **A small model judges** each of the 5: same, close (with a reason), or no. The answer is cached by the need's words and the inventory version.
3. **Code applies the rules:**
   - size sanity (a "ship" under 3 m is a toy);
   - a character that acts must have clips;
   - region (a Cairo street wants middle-eastern props);
   - style flags (§5).
4. **The result per need** is one of:
   - have: an id;
   - close: an id and a note;
   - download;
   - build;
   - data;
   - skip: not a must-have, and nothing close.

Two new pieces of code make this possible:
- **A capability registry** describes every capability in words (id, kind, help text, synonyms, where it works). Its entries come from the lists that are spread today over `knowledge.ts`, `director.ts` (`KIT_GUIDE`, `REACT_HELP`) and `camera/shot.ts`. Later the director's prompt can be generated from the same registry, so there is one source of truth.
- **One inventory query** over the world catalog (which already includes the older packs), the audio library and the registry, with a version hash. Cast validation moves to world-catalog ids, so there is one id per model.

Once matched, the needs go into the director's and the sound designer's prompts as a THIS STORY NEEDS block, for example "b3: the keeper climbs the stairs, actor action `climb`" or "n4 lantern: asset `kaykit-halloween-bits-lantern-hanging`". The essential check asks again when a must-have with a resolved id is not used. Today the director guesses from the 60 lines it is shown.

### An example: a drama, "The keeper's last night"
Checked against today's library:

| Need | Kind | Match today |
|---|---|---|
| a lighthouse on a rocky coast, stormy night (must) | set | close: the ocean kit; the `landmark-lighthouse` model exists but cannot be the set until model sets exist |
| an old keeper with a grey beard (must) | character | close: a Quaternius man, recoloured; no beard |
| he climbs the spiral stairs | action | missing: none of the 120 clip names in the catalog is a climb; a clip download for that rig, or a build request |
| an oil lantern (must) | prop | have: `kaykit-halloween-bits-lantern-hanging` |
| storm with lightning | effect | have: weather `storm` |
| a foghorn | sound | missing: no library file is tagged horn; download (Freesound CC0, BigSoundBank's boat category) |
| waves and wind | ambience | have: the waves and storm-wind beds |
| slow, sad music | music | have, but thin: 5 tracks tagged sad |
| a ship in trouble | vehicle | close: `kenney-pirate-kit-ship-ghost`, or a Kenney watercraft boat |
| a slow orbit round the lamp | camera | have: `orbit_left` |

### As built
**As built (P3, 2026-11-04):** `src/generator/library/` holds:
- the registry: `registry()`, about 4,870 entries read from the code's constants and catalogs, versioned by hash;
- the match: `matchNeeds` takes the top 5 candidates by words, asks a small-model judge (cached by inventory version), then applies the code rules;
- the shopping list.

`pipeline/breakdown.ts` is the role (`breakDownStory`, `needsFor`).

Each need ends as one of:
- have;
- close (with `then`);
- download;
- build (a BuildRequest draft);
- data;
- skip: not a must-have, nothing close, and it would need code.

A sound with only a synthesized stand-in is close, with a recording to download. Try it: `npx tsx scripts/breakdown.ts test-fixtures/breakdown/keeper/story.json`.

**Wired into runs (2026-11-04):**
- **The stages.** Two run stages, `breakdown` and `match`, come after gate 1 and before the director, and write `breakdown.json` and `needs.json`. They run on the new `breakdown` and `matcher` roles (Settings → AI models → Model roles), which use the writer's model when they have none.
- **Informational for now.** Until gate 2 (P4) the needs only inform: the CLI prints the shopping list with the plan, and the dashboard's plan review shows a read-only "This story needs" panel. A breakdown that fails becomes a warning, never a stopped plan.
- **Recorded replies.** Sets with no `breakdown-1.txt` (every set from before P3) skip both stages with a log line, so fixture runs and `npm run milestone -- --fixtures` plan as before.

## 4. Acquisition: two kinds of gap

### Things that can be downloaded
Models, animation clips, sounds, ambience, music and, rarely, textures (the look mostly uses flat colours).

The flow:
1. Search the sources the channel allows (§5) for each missing need.
2. Show the candidates at gate 2.
3. Fetch the approved ones into quarantine.
4. Read the licence evidence for each item.
5. Intake (§6) adds it to the library manifests.
6. The run's needs are matched again.

### Capabilities that need code: the build-request queue
A new set type, a new effect such as bullet time, or a new camera move cannot be downloaded. Each one becomes a build request for a developer:
```ts
interface BuildRequest {
  id: string;                  // "camera-bullet-time"
  kind: "set-type" | "effect" | "camera" | "device" | "action" | "graphic";
  title: string;               // "Bullet time on a dodge"
  what: string;                // in the user's words, from the need
  asks: Array<{ run: string; need: string; beats: string[]; at: string }>;
  fallback: string;            // what runs use meanwhile: "slow push_in, the sound slowed"
  acceptance: string;          // what a developer must show: a still sheet, a test, a 15 s clip
  status: "open" | "accepted" | "building" | "done" | "declined";
  design?: string;             // a design doc, e.g. docs/factory/14-bullet-time.md
}
```
- **Stored** in `build-requests/<id>.json`, committed, and listed on the dashboard. HANDOFF tells developer sessions to read the queue.
- **One request per capability.** A new ask with the same key adds a line to `asks`, so the count ranks the queue.
- **Runs keep going.** The run carries on with the fallback unless the user chooses to wait. When the capability lands, the registry gets its entry, the request closes, and the producer offers to re-plan the waiting runs from the director stage (story and breakdown reused).
- **Likely first requests:**
  - bullet time (being designed in [14-bullet-time.md](14-bullet-time.md));
  - climbing, two-person fights, talking mouths;
  - fire and smoke, explosions with debris;
  - a map with a route line (Phase 6 step 7, the graphics layer, is not built);
  - a point-of-view shot;
  - a plane in flight, underwater scenes.

**A third, smaller kind: data.** A new place in an existing look ("Rome: the European old-town look, with the Colosseum landmark already in stock") needs no new code, only a `PlaceDef`. Today the places live in code ([places.ts:280](../../src/world/places.ts#L280)). Moved to a data file, they can be proposed at gate 2 and checked with a still, with no developer.

### Would a generic "model set" close part of the gap?
A model set is a downloaded model staged as the whole set: a ship deck, a plane cabin, a cave, a throne room, a lighthouse.

What the engine would need for any model set:
- **Scale,** from intake (§6).
- **The floor:** walkable areas, found by casting rays down a grid inside the bounds. Actors stand and walk there.
- **Inside or outside:** in a closed cabin the camera must stay inside the inner bounds. The sight-line test uses the model's own meshes as blockers.
- **Subjects and spots for the camera and actors:** "scene" (the whole model), "hero" (its biggest part), spots from the floor grid (front, back, middle, left, right), and named glTF nodes where the model has them ("Wheel", "Mast").
- **A backdrop:** void, sky, ground, the ocean kit around it (a ship), or space.
- **Motion:** still, bob (a boat at rest), rock (a ship in a storm) or cruise (a plane, with the backdrop sliding past).
- **Light and sound:** outside, the scene's sun and sky; inside, a lamp rig. The ambience bed comes from the set's tags (ship: waves and creaks; cabin: engine hum).

What it closes: most of the long tail of "where": rooms, halls, vehicle interiors, decks, caves, temples. The kits on disk already hold many such pieces (Kenney pirate, castle, space and train kits; KayKit dungeon and restaurant).

What it does not close:
- anything that moves in its own way (a door opening, a ship sinking);
- sets generated by rules (a whole city);
- effects, interactions and new camera grammar.

**Verdict: worth building once, as a capability** (phase P6, about 2 weeks). It turns many build requests into downloads. The risks:
- the camera solver in tight interiors;
- light inside closed models;
- models whose floors are not flat;
- render time with heavy models.

## 5. Sources and the licence policy

### Sources (researched 2026-11-03)
| Source | What | Access | Licence per item | Verdict |
|---|---|---|---|---|
| Kenney (kenney.nl) | models, sounds, some music jingles | no API; each pack's zip link is scraped from its page (the method of `setup-sfx-cc0.ts`) | CC0 for the whole site; each zip carries its licence file | default source; index the pack list once for search |
| KayKit (itch.io) | models | itch.io download flow (`world-assets/kaykit.ts`) | CC0 | default source |
| Quaternius (quaternius.com, itch.io) | models; the Universal Animation Library (120+ clips on one humanoid rig, glTF; the free tier is a subset) | itch.io or Drive flow (`world-assets/quaternius.ts`) | The licence page now shows the Quaternius Asset License 1.0 (updated 2026-08-28): commercial use, no attribution, no redistributing the assets themselves. Older downloads ship CC0, and the UAL page still says CC0. The licence file in the zip decides, as the downloader does today | default source; the best place for animation clips |
| Poly Pizza | stylized models, many animated | API at `api.poly.pizza` (v1.1) with an `X-Auth-Token` key from a free account; search and model-by-id return `Licence`, `Creator`, `Thumbnail`, `Download` (GLB), `TriangleCount`, `Animated`. The official docs render in the browser only, so these details come from third-party guides. The repo reads model pages without a key today | mixed: CC0, CC-BY 3.0/4.0 (the site also lists other CC licences); read from each model's record at download time | the best search source for models; needs the user's own key, and the user should check the API terms for commercial use, which are unclear (one third-party guide says commercial use is paid) |
| Poly Haven | HDRIs, PBR textures, scanned models | `api.polyhaven.com`, no key; free for any purpose including commercial; requests must send a User-Agent naming the tool; software that shows live API content should credit it ("Powered by Poly Haven") | CC0 for everything | allowed but off by default: the content is photoreal and does not fit the look |
| ambientCG | PBR materials, some models and HDRIs | `ambientCG.com/api/v3/assets?q=&type=&include=downloads`, no key mentioned; a one-person site that says the API is not enterprise-grade | CC0 | same as Poly Haven: off by default |
| Freesound | sounds, ambience, loops | APIv2: a free API key covers search and previews (HQ mp3 or ogg); original files need an OAuth2 login by the user; filter `license:"Creative Commons 0"`. The API terms: commercial use of the API is agreed case by case with UPF, no full copies of the database, intermediate copies only as needed | per sound: "Creative Commons 0", "Attribution", "Attribution NonCommercial"; re-read from the sound's record at download | the biggest help for ambience and specific effects (the library has 19 beds). Opt-in, once the user has read the API terms; CC0 only |
| BigSoundBank | ambience, nature, foley | no API; direct files by id; category pages need a browser User-Agent ([03-audio-sources.md](03-audio-sources.md)) | CC0 only where the page says "Free and Royalty Free" | default source for sounds; add a category search |
| FreePD (archive.org mirror) | music, 1,025 tracks; the library holds 40 | `archive.org/metadata/freepd` | public-domain dedication (category folders only) | default; downloading more of it is the cheapest fix for the thin moods |
| OpenGameArt | models, sounds, music | no API; each item page shows "License(s)" | mixed: CC0, CC-BY 3.0/4.0, CC-BY-SA, OGA-BY, GPL 2/3; when several are listed, you may choose one | CC0 items only, from a link the user pastes or from curated lists (as today's 100-CC0-SFX pack) |
| Sketchfab | models of every style | Download API: the user must log in (OAuth2); glTF, GLB or USDZ only. The store moved to Epic's Fab; free models stay downloadable until Fab has an equivalent API, with no end date set | per model: mostly CC-BY, also CC-BY-SA, CC-BY-NC, CC-BY-ND, CC0 | off. At most an opt-in "paste a Sketchfab link" for CC0 and CC-BY models, with credit; the style varies too much for search |
| Mixamo | rigged characters and animations | Adobe account; no public API (the scripts that exist reuse the browser's login token) | Adobe's FAQ terms: royalty-free in projects, the raw files may not be redistributed; the FAQ dates from the technology preview | excluded. Use the Quaternius UAL clips instead |

### The licence policy (proposed)
| Tier | Licences | Where | Credit |
|---|---|---|---|
| Free | CC0 1.0; public-domain dedications (FreePD); Quaternius Asset License 1.0 (the files never leave this machine except inside a rendered video) | everything | none needed; the source is still recorded |
| Credit (opt-in per channel) | CC-BY 3.0 and 4.0, OGA-BY 3.0 | models by default (already decided for landmarks, [decisions.md](decisions.md) 2026-10-23), music only if the user turns it on; never sounds | the credit line is written at intake and goes into the video description automatically (`creditsFor`) |
| Never | NC, ND, SA (an adapted work must carry the same licence: unclear for a video, not worth the risk), GPL and LGPL for art, Sampling+, custom terms that ban AI use (Sonniss), editorial-only, missing or unknown licences, Mixamo, anything its source marks as AI-generated | | |

**The check for each item:**
- **Read at download time** from the item's own record: the API field, the model or sound page, or the licence file in the zip. It is never assumed from the source's reputation.
- **A source-wide licence** is accepted only where the source has a single licence (Kenney, KayKit, Poly Haven, ambientCG) and the zip's own licence file agrees.
- **Saved with the item:** the licence id and URL, the author, the item's page, the date, the evidence (the field's value or a quote from the page, or the licence file's hash), the file's sha256 and the credit line.
- **Checked again on every re-download.** If the licence has changed to one that is not allowed, the item is held back and the user is told. Quaternius changing its licence in August 2026 is why this matters.

**The style gate** sits beside the licence check and only shows flags; the user decides:
- triangles over budget (about 20k for a prop, 60k for a set, 10k for a character);
- textures over 2048 px;
- many materials;
- "looks scanned" (big textures on most materials together with a high triangle count).

The rule against image-generation models also means no generated textures, no text-to-3D and no generated audio.

## 6. Intake for each item

### Approving in the dashboard
- **Where:** a "Shopping list" step in the Create flow after the story review, and a new **Assets** page in the sidebar listing the inventory, items waiting for approval and the build requests. (The sidebar's Library page holds the videos, so the name Assets avoids a clash.)
- **Each missing need is a card:** its words and beats, then 3 to 6 candidates per source. The user can get one, use the substitute, skip, ask for more results, or paste a link.
- **A model candidate shows** the source's thumbnail, title, author, source, a licence badge (CC0 green, CC-BY amber with its credit line), triangles, whether it is animated and its clip names, its file size and a link to its page.
- **After Get,** the card shows our own preview:
  - a still in the factory's light and grade, front and three-quarter, with a 1.7 m person beside it for scale, from a preview composition like [KitPreview.tsx](../../src/world/KitPreview.tsx);
  - the intake checks, each editable: the size in metres, rotate buttons for up and forward, the clip table (each key and its clip, with a dropdown of the file's clip names), tags, category, placement and region, and the style flags;
  - buttons: Add to library, or Discard.
- **A sound candidate shows metadata only:** name, source, author, licence, length, sample rate, channels, file type, tags, the description, and a link to its page, where the user listens. The dashboard plays nothing. After intake it adds the measured loudness, true peak, silence at each end and, for beds, whether it loops cleanly.
- **One-click approval:** "Approve every CC0 pick" approves the best candidate for each need in one go. It is still the user's click.

### Approving in the CLI
```
npm run producer -- new --channel what-if "What if every clock in Paris stopped?"
npm run producer -- new --channel drama --script story.txt --as-written
npm run producer -- needs <run>                     # the shopping list as a table
npm run producer -- get <run> n6=freesound:123456 n2=close n3=build n9=skip
npm run producer -- resume <run>
npm run producer -- say <run> "no music in the intro"
```

### Intake of a model
1. **Quarantine.** Each download goes into its own new, empty folder (`.cache/intake/<source>/<item>/`). There is a size cap (64 MB, as in [landmarks.ts](../../scripts/world-assets/landmarks.ts)) and a glTF header check. Zip entry paths are checked. Nothing from a download is ever run (the rules in the headers of `landmarks.ts` and `quaternius.ts`).
2. **Licence evidence,** read and saved (§5).
3. **Format.** GLB and glTF are kept as they are. FBX, OBJ and Blend files are refused at first, with the reason shown, as `quaternius.ts` does today. A converter comes later, after a prior-art check (FBX2glTF, the Blender command line). An optional clean-up with glTF-Transform (prune, dedupe, textures down to 2048 px) is a new dependency, so it gets the same check first.
4. **Scale.** The catalog builder's glTF reader ([build-world-catalog.ts](../../scripts/build-world-catalog.ts)) measures the bounds. A table of real sizes by category and name word gives the expected size (person 1.7 m, car 4.5 m, chair 0.9 m, ship 15 to 60 m), and from that the scale factor `k`. The user confirms it on the still.
5. **Orientation.** glTF is Y-up. Forward is guessed from the long axis for vehicles and the rest pose for characters; the user rotates it on the card if the guess is wrong.
6. **Catalog.** A raw record in the existing contract ([types.ts](../../scripts/world-assets/types.ts): id, file, source, pack, licence, author, source URL, credit, tags) goes into `scripts/intake/models.json`. The world catalog is rebuilt (deterministic) and validated.
7. **Clips.** `mapClips` and `unsupported` ([rigs.ts:57](../../src/world/actors/rigs.ts#L57), [:81](../../src/world/actors/rigs.ts#L81)) show which keys map and which are missing. The user's own choices are saved as per-model clip overrides (a new optional field) that the renderer's clip lookup reads.
8. **Tags.** The source's title and tags, plus the need's words, are cleaned by the librarian role into the catalog's words. Region, category and placement follow the catalog builder's rules.
9. **The preview still** is saved next to the model, with its triangle, material and texture checks.
10. **Match again.** The run's needs are matched against the new inventory version.

Animation packs (UAL clips for every Quaternius-rig character) need clips shared across models of one rig family, so they come in phase P6. At first, only clips that come inside a model are used.

### Intake of a sound or a music track
1. Download the original (Freesound with the user's OAuth login) or the HQ preview.
2. Convert to 48 kHz WAV with the bundled ffmpeg and measure loudness and true peak (`measureLoudness`), as `setup-audio-library.ts` does.
3. Take the kind (effect, ambience, music, stinger) from the need. A bed must be at least 20 s and loop without a jump in level.
4. Take tags from the title and the need's words. A music track's tags must map to a mood (or to a new mood the profile adds).
5. Write a record in `scripts/intake/sounds.json`, the same pattern as the curated `audio-library.bigsoundbank.json`. `npm run audio:library` then adds it to `audio-library.json`.
6. Register a name for the sound designer. A new sound such as `foghorn` gets a name and its word sets beside `SOUND_QUERY` (code today, data from the manifest after this), so the designer can choose it and every name still plays.

### The other machine
`public/` is not in git, but the intake manifests are. On the GPU machine, after `git pull`, `npm run world:assets` and `npm run audio:library` fetch the same items by URL and check them against the saved sha256. The library is then the same on both machines.

## 7. Genre and channel profiles

### What a profile holds
`channels/<id>.json`, committed and versioned. Each run records the profile version it used.
- **Identity:** id, name, language, a short description of the channel.
- **The writer:**
  - the structure template (sections with their share of the length and their purpose);
  - the hook rule and the ending rule;
  - point of view and tense, tone words, phrases to avoid;
  - words per beat and the beat-count rule per format;
  - the story modes the channel allows, and the most characters (writer.ts caps it at 3 today).
- **Voices:** the narrator on or off, with engine and voice or description; the character voice policy; dialogue allowed.
- **Music and sound:** allowed moods and the default; music level; how many hits per minute; ambience on or off.
- **Look:** allowed grade presets ([look-choice.ts](../../src/generator/look-choice.ts)), preferred times of day, allowed kits and places, the crowd and featured actors (off unless the user turns them on), seconds per shot, allowed moves, styles and transitions.
- **Captions:** a preset and overrides ([caption-style.ts](../../src/generator/caption-style.ts)).
- **Formats:** the default format, lengths and scene count.
- **Devices allowed:** counter and reactions, timer, hero prop, bpm, world events, the time-lapse, flights, actors.
- **Rules:** licence tiers (CC-BY for models, for music), and which sources may be searched.
- **Gates and memory:** the gates the channel skips; anti-repetition per channel (`recentStories` filtered by channel).
- **Standing rules,** collected from the producer chats.
- **Description:** a template for the video description, with the credits.
- **Models:** optional per-role overrides.

### Four example profiles
| | What-if explainer | Action short | Story or drama | Documentary |
|---|---|---|---|---|
| Structure | hook question, first consequence, escalation, twist, conclusion (today's writer) | cold open in motion, chase or conflict, set piece, reversal, a button ending | three acts: setup (who, what they want), confrontation (obstacle, turn), resolution | chapters: the question, context, evidence 1..n, turning point, what it means |
| Hook | the premise as a question, at most 12 words | an image already moving, not a question | a line of character or situation | a surprising fact, stated |
| Ending | a surprising conclusion, no call to action | a beat of payoff or a joke | resolution, a quiet last image | a summary and an open thought |
| Voice | narrator, present tense; characters optional | little or no narration; short lines of dialogue, 8 words or fewer | storyteller in the past tense, or none; dialogue at the centre | an authoritative narrator; quotes read by the narrator |
| Story mode | write | write or adapt | as written (default) or adapt | write or adapt |
| Checker | hook, escalation, payoff | pace, clarity of the action | character, motivation, plot holes | lists every factual claim; each marked known or check, confirmed by the user at gate 1 (the models have no web access) |
| Music | epic, tense, upbeat, sci-fi | epic, tense; dense effects (impacts, whooshes, engines) | sad, ambient, upbeat at the resolution; few hits | documentary, ambient; ambience beds on, few hits |
| Look | `golden-hour` or `epic-teal-orange` by mood; world places and reactions | `epic-teal-orange`, golden or night; handheld and dutch allowed | `dreamy-pastel`, `golden-hour`, `night-moonlight`; slow moves | `overcast-documentary` or `neutral`; flights between places |
| Camera | 1.5 to 4 s shots; wide on reactions | 1 to 2.5 s shots; follow, low angles, whips; bullet time once built | 3 to 8 s shots; push-ins on faces | 4 to 8 s shots; slow pushes, crane reveals; no dutch, no handheld |
| Captions | `reference` (serif, gold keyword) | `bold-pop` (upper case, pop) | `clean` | `documentary` |
| Formats | 9:16 25 to 60 s; 16:9 3 to 10 min | 9:16 15 to 45 s | 16:9 3 to 10 min; 9:16 60 to 90 s | 16:9 5 to 10 min; 9:16 cut-downs |
| Devices | counter with react, timer, hero prop, world events, time-lapse; bpm only for fear | world events, timer; featured actors on (the user's call) | time-lapse, featured actors on (the user's call); no counter | counter for numbers, timer, time-lapse, flights; maps and labels once the graphics layer exists |

The prompts change from one fixed text to blocks: role rules that are the same for every genre, plus the profile's blocks. The "what if" wording moves into the what-if profile, so existing runs and fixtures still get the same prompt text.

### Brand (2026-11-05)
A profile may carry a `brand`, the channel's look on screen ([brand.ts](../../src/compositions/brand/brand.ts)); a channel without one makes its videos exactly as before. Borrowed from an automated motion-design system's brand kit.
- **What it holds:**
  - the name on screen;
  - a logo, a file in `public/brand/<channel>/` (checked when the profile loads), or none: then a simple mark (circle, play, bolt, star, diamond, drop);
  - three colours: the accent (keywords, the HUD's fact line, the mark), the text, the background (the bumpers, a caption box);
  - the caption font and the title font (the hook, the HUD's numbers, the bumpers), from the fonts the project ships;
  - an intro bumper of 1 to 2 s (a dot turns into the mark, or the logo scales in, then the name);
  - an outro bumper of 2 to 4 s (the name and a call to subscribe, written only; no voice);
  - a watermark in the top corner, on or off (it appears once the hook has gone).
- **In the video** ([WhatIfVideo](../../src/compositions/WhatIfVideo/index.tsx), [Bumpers.tsx](../../src/compositions/brand/Bumpers.tsx)): the intro, then the whole video (picture, HUD and sound) shifted by the intro's length, then the outro. The marks morph with [Flubber](https://github.com/veltman/flubber) (MIT, [marks.ts](../../src/compositions/brand/marks.ts)), a pure function of the frame.
- **The example:** the action channel has a brand (the bolt mark, orange on near-black, Anton titles). What-if, drama and documentary have none.
- **Editing:** Settings → Channels → The brand, or As JSON.
- **Previews:** a separate entry, `src/compositions/brand/index.ts`, with `BrandIntro`, `BrandOutro` and `BrandedWhatIfVideo`.
- **In a run** (2026-11-11, `53b2f46`, `2d69851`): the plan, a rebuild and every variant carry the channel's brand into `spec.brand` (what-if has none, so its plans are byte-identical). [length.ts](../../src/compositions/brand/length.ts) counts the whole video (intro, story, outro) for Root.tsx, the CLI and chunked renders and the editor's player. The chunk plan moves the story's chunks by the intro. The audio pass starts the sound after the intro. The photographer's stills and the publish pack's chapters shift by it, and the thumbnail is the story's own frame, with the brand's colours and fonts.
- **Not done:** the editor's timeline still reads the player's frame as spec time (a branded video's playhead runs ahead by the intro), and the outro is never spoken.

## 8. Models per role
Models are already chosen per role ([roles.ts](../../src/generator/ai/roles.ts)). The new roles join the same Settings → AI models → Model roles card. The user picks the providers. During development, runs use recorded replies (`FACTORY_LLM_FIXTURES`) and the user's Ollama models, never a paid API.

| Role | Job | Model | Why |
|---|---|---|---|
| producer | understand notes, route them, explain | strong | it is what the user talks to, and a wrong route wastes a run; its schema is small |
| writer | write or adapt the story | the strongest | the story is the video; it is written once and kept |
| story checker | check the story against the profile; list claims | the strongest, ideally a different model from the writer | a second opinion catches more than the writer checking itself |
| script reader | split an as-written script; fill `see` and characters | mid | code does the hard part and the word-for-word check |
| breakdown | list the needs | strong to mid | careful reading with a simple schema, once per story |
| matcher | judge the top 5 candidates of a need | small | many calls answering same, close or no; cached |
| librarian | tags, category, region for intake | small | one call per item |
| director | scenes, shots, devices | strong | the biggest schema in the factory |
| sound | music, beds, hits | mid | names from a fixed list |
| critic | plan review, notes for the brief check | mid to strong | optional |
| editor | Ask AI edits | mid | exact paths keep it on track |
| vision | the photographer's stills | a vision model | as today |

A role with no model of its own uses the writer's today ([llm.ts:46](../../src/generator/pipeline/llm.ts#L46)). With more roles, the small ones should use a "small default" when one is set, so that tagging and matching don't run on the writer's model.

## 9. The build plan
Sizes are rough, in focused working days for one session.

| Phase | What | Size | Done when |
|---|---|---|---|
| P1 Runs that resume and keep the story | run id per run, `run.json`, input hashes, resume, the model-reply cache; gate 1 for the story; the length revise inside the story stage; the critic's notes as proposals; `npm run producer -- new/resume/status` | M, about 5 days | a run killed in the director stage resumes with no writer call; writing a premise again can reuse its approved story; fixture tests |
| P2 Channels and story modes | the profile schema and 4 profiles; prompts built from profile blocks; memory per channel; adapt and as-written modes with the word-for-word check; channel and script fields in the Create wizard | M, 5 to 8 days | one fixture premise gives two different structures in two profiles; an as-written script reaches the voice lines word for word |
| P3 Breakdown and inventory | the capability registry; one inventory query; cast ids moved to the world catalog; the breakdown and matcher roles; `needs.json`; the needs block for the director and sound; a read-only needs view | M, 5 to 8 days | the lighthouse story lists about 10 needs and matches them as in §3 |
| P4 Acquisition | source adapters (Kenney index, Poly Pizza with the user's key, BigSoundBank search, more FreePD, Freesound opt-in, OpenGameArt and Sketchfab by link); quarantine, licence evidence, intake for GLB models and sounds, preview stills, manifests and sync; gate 2 in the dashboard and the CLI; the build-request queue | L, 10 to 15 days | a missing foghorn and a missing prop are found, approved and taken in, and the run's match turns them into have |
| P5 The producer you talk to | the router, the actions, proposals with diffs, `notes.jsonl`, standing notes, restage and resound by scene, the brief check | M, 5 to 8 days | five notes of different kinds each reach the right stage, and each can be undone |
| P6 Model sets and animation packs | the model-set stage (floor, bounds, spots, backdrop, motion), clip overrides, clip packs per rig family | L, about 10 days | a ship or lighthouse model set films with sight lines working, and an actor walks its deck |
| Then | build requests in the order of their asks; bullet time first ([14-bullet-time.md](14-bullet-time.md)) | | |

P1 comes first because everything else stands on runs that resume. P2 next, because it gives the user several channels with no downloading at all. P3 before P4, since the factory must know what is missing before it fetches anything. P5 can move ahead of P4 if the user wants the conversation first.

**Shared files.** P1 to P3 change `run.ts`, `writer.ts`, `director.ts`, `sound.ts`, `critic.ts`, `server/index.ts` and the Create wizard, which other chats also touch. One chat should own them for each phase (HANDOFF §1).

### Risks
- **Breakdowns from mid-size models:** they over-list, or invent needs. The per-beat cap, `must`, the merge in code and the user's gate keep it small.
- **Matching:** word matching misses synonyms, and a false "have" hides a gap. The synonyms table, the small-model judge, the size and clip rules, and substitutes shown in amber guard against both.
- **Licences drift** (Quaternius in August 2026; Sketchfab's move to Fab): evidence for each item at download and a check again on every re-download.
- **API terms:** commercial use of the Poly Pizza API is unclear, and Freesound's is agreed case by case. The user reads them; pasting a link always works as a fallback.
- **Style:** models from many authors look different. The style gate, previews in our own light, and later a palette recolour help.
- **Render time:** the main video's world scenes take 112 s of the 123 s budget per 15 s. Downloads add triangles, so the budget shows on every card.
- **Scope:** build requests pile up. Counting asks ranks them, and the fallbacks keep videos shipping meanwhile.
- **Two machines:** `public/` is not in git; the committed manifests and the sync cover it.
- **Long scripts:** an as-written script longer than its format allows is caught by the early estimate.
- **The router:** a note can be routed to the wrong action. Everything is a proposal with a diff, and nothing applies without a confirm.
- **Films:** a user's story may copy a film. The same rule as for bullet time applies ([decisions.md](decisions.md) 2026-11-03): the generic technique with original characters. The story checker flags it.

## 10. Open questions, each with a recommended default
| # | Question | Recommended default |
|---|---|---|
| 1 | What is the one you talk to called? | "Producer"; the staging role keeps the name Director |
| 2 | Is the story gate on for every channel? | yes; a channel may turn it off |
| 3 | As written: may the voice be sped up (at most 1.15×) to fit a format? | no; the user is told the length instead |
| 4 | CC-BY: for which kinds, and on for every channel? | models yes, with automatic credits (as decided for landmarks); music off; sounds never |
| 5 | Is the Quaternius Asset License 1.0 accepted like CC0? | yes: commercial use, no credit, and we never pass the files on |
| 6 | Poly Pizza: will you make a free account and key and check the API terms? | yes; until then only hand-picked model links, no search |
| 7 | Freesound: opt in with your own key and a login for original files? | off until you have read the API terms; you can always drop in files you downloaded yourself |
| 8 | Poly Haven, ambientCG and Sketchfab | off (photoreal look, mixed licences); Sketchfab by pasted link only; Mixamo excluded |
| 9 | May the producer download without asking when one CC0 match is clear? | no; one click approves every CC0 pick |
| 10 | When a must-have cannot be downloaded or built yet | plan with the closest substitute and file a build request; don't stop the run |
| 11 | Where do build requests live? | `build-requests/*.json` in the repo, listed on the dashboard, read by developer sessions |
| 12 | Model formats at intake | GLB and glTF only at first; FBX after a prior-art check |
| 13 | Anti-repetition memory | per channel |
| 14 | How are profiles edited? | JSON files first; a settings page later |
| 15 | Which genres first? | the four in §7: what-if (today's), documentary, drama, action |

## 11. Status: what P1 built (2026-11-04)
Phase P1 of §9: every plan is a run that saves its stages, resumes from where it stopped, and stops after the story for the user's approval. The names follow §10 questions 1 and 2. The orchestrator is the **producer**, and its log lines start `[producer]`. The camera and staging role stays the **director**. The story gate is on by default.

### Runs and run.json
- **A run id per run:** `<slug>-<6 hex>`, with the slug cut to 60 characters ([manifest.ts](../../src/generator/pipeline/manifest.ts) `newRunId`). The same premise never overwrites an older run. The CLI prints `RUN_ID: <run>` as it starts.
- **`output/<run>/brief.json`** holds what was asked:
  - the premise, the settings and the voices;
  - `--provider` and `--model`, if given;
  - whether the story gate is on;
  - the run whose story was reused, if any.
- **`output/<run>/run.json`** has one entry per stage: `story`, `voice`, `director`, `sound`, `critic` and `assemble`. Each entry holds:
  - its state: waiting, running, done, failed or skipped;
  - the hash of its inputs, and its files;
  - the model that answered (`fixtures` on recorded replies);
  - its times, error and warnings;
  - the facts a resumed report needs: the revise, and the sound's source.

  The story gate's state and approval live under `gates.story`.
- **A stage runs only when needed** ([run.ts](../../src/generator/pipeline/run.ts) `runStage`). It is kept when it finished with the same input hash and its files are still there.
  - The hashes chain: the voice hashes the story, the director the story and the timeline, and so on.
  - An edited `story.json` therefore re-times the voice and re-plans what follows. A story that comes out the same keeps everything after it.
- **The story stage holds the length revise.** The writer, the voice timing and the one revise all happen before the gate, so the user approves the final words.
- **A complete plan is not planned again.** From there the editor owns the stage files. `--resume` on a complete run renders it (or, with `--no-render`, only prints `PLAN_ID`).
- **Fixed ids start clean.** The tests and the milestone plan under fixed ids. Planning one of them again starts a fresh run.json and removes the older plan's saved replies.

### Saved model replies
- Inside a run, [callRole](../../src/generator/pipeline/llm.ts) keeps each usable reply in `output/<run>/.calls/<label>-<key>.txt`.
  - The key hashes the role, the provider and model, the system text, the first prompt and any images.
  - A repaired reply is saved under the first prompt, so its replay skips the repair.
  - Unusable replies are never kept, so a retry gets fresh attempts.
- **A resumed run replays the calls that finished, at no cost.** A long story that crashed in act 2 gets its outline and act 1 back, and asks only for act 2 onwards (`calls.test.ts`). A saved reply that no longer passes the checks is asked again.
- **`FACTORY_LLM_FIXTURES` works exactly as before.** Fixture replay never reads or writes `.calls/`, and its counters move on as they always did. `FACTORY_LLM_RECORD` still records only real model replies.
- **Parallel runs keep apart.** Runs planned at the same time in one process (the milestone pool) each use their own `.calls/` (`AsyncLocalStorage`).

### The story gate (gate 1)
- **Where it stops.** After the story stage and its voice timing, before the director: the plan throws `StoryGateStop`.
- **What an approval records.** The hash of `story.json` as it is on disk then, so the user may edit the file first. If the story changes after the approval, the plan stops again.
- **On by default** for the CLI and the dashboard. Three things turn it off:
  - `--no-story-gate` on the CLI;
  - the "Read the story first" switch on the Format step;
  - `storyGate: false` in POST `/api/plan`.

  Library callers (`runPlan`, `generateSpec`, and so the milestone and the tests) plan straight through unless they ask for it. So does the legacy POST `/api/generate`.
- **An approved story is locked.** With the review pass on, the critic's notes on an approved story are kept in `critique.json` as proposals, and the plan review lists them ("The review pass's notes"). The story is not rewritten.
- **With the gate off,** the critic's notes are applied as before. The kept stages are then re-hashed against the noted story, so a resume does not redo them.

### The commands
```
npm run generate -- "What if money doubled every 3 seconds in Paris?" --format 9:16 --duration 25
    plans the story, prints it, and stops with:
    Approve it and go on:  npm run generate -- --resume <run>
npm run generate -- --resume <run>                  # approve the waiting story, plan the rest, render
npm run generate -- --resume <run> --no-render      # the same, stopping at the plan (PLAN_ID)
npm run generate -- --status <run>                  # each stage's state and what comes next
npm run generate -- "<premise>" ... --no-story-gate # plan straight through, as before P1
npm run generate -- --story-from <run> --format 16:9 --duration 60   # a new run with that run's story
```
- The gate's message repeats the flags the resume needs again (`--no-render`, `--chunked`).
- A run keeps the premise, settings and voices it started with. A resume warns when others are given.
- A failed plan prints `Resume from <stage> (finished stages are kept): npm run generate -- --resume <run>`.
- `--from-spec`, `--no-render`, `--chunked` and `npm run milestone -- --fixtures` work as before.
- `npm run producer -- new/resume/status` (§6) is not wired yet: it needs a `producer` script in `package.json`. The same commands work through `npm run generate` today.

### The dashboard and the server
- **The Create wizard.** The Format step has the "Read the story first" switch, on by default. The plan job then stops at the story.
  - Its review screen shows the hook, the title, the length when read aloud, the characters, and every beat: narration, dialogue and what it shows.
  - Its buttons are Back, Write it again, and **Approve the story and plan the rest**. Approve starts a second plan job that resumes the run with the director; the usual plan review follows.
  - The writing card shows the gate as its own step. A toast says "Your story is ready to read".
- **Resume after a failure or a restart.** A plan job that failed, or that a server restart interrupted, shows **Resume from \<stage\>** next to Try again. The finished stages are kept. A restart does not resume by itself: the job is marked as interrupted, and its error says it can be resumed.
- **The API:**
  - POST `/api/plan` takes `storyGate` and `storyFrom`.
  - GET `/api/spec/:jobId` answers `{ ready, gate: "story", runId, story, length }` for a job stopped at the gate. For a finished plan it adds `notes`, the critic's kept proposals.
  - POST `/api/plan/:runId/resume` approves a waiting story, or continues a stopped run, in a new plan job. One plan job runs at a time, and a complete plan gets a 409.
  - GET `/api/runs/:runId` gives the stages, the gate and the next stage.
  - `/api/jobs` marks the jobs stopped at the gate with `gate: "story"`.
- **The job runner** reads `RUN_ID`, `STORY_ID` and `PLAN_ID` from the CLI. It finds a failure's log by the run id, and a render's report by the job's own folder, since one premise can now have several videos.

### What changed for the GPU machine (HANDOFF §3)
- **Task 2, the Paris premise.** The command now stops after the story. Read it, then run the `npm run generate -- --resume <run>` line it prints. To plan and render in one go, as before, add `--no-story-gate`.
- **Task 3, milestone 4.** The same: either add `--no-story-gate`, or run `npm run generate -- --resume <run> --chunked` after the story stop. The editor step after it is unchanged.
- **Output folders** are now `output/<slug>-<6 hex>/` instead of `output/<slug>/`. A premise planned twice has two folders, and the library lists both.
- Everything else is unchanged: the setup, the checks, Ask AI, the photographer and the milestone.

### Checked
- `manifest.test.ts`: run ids, input hashes, fresh stages, clean restarts of fixed ids.
- `calls.test.ts`:
  - a replay with no model call;
  - repaired and stale replies;
  - fixture replay left as it was;
  - parallel runs;
  - the long story that crashed in act 2.
- `resume.test.ts` runs on the money-doubles replies. Every resume gets fixtures with no writer reply at all, so a writer call would fail the test. It checks that:
  - the gate stops, and a resume plans the rest;
  - a run killed in the director stage resumes there;
  - an edited story is re-timed and approved as edited;
  - a resume without approval stops again;
  - an approved story keeps the critic's notes as proposals;
  - with no gate the notes apply, and a resume keeps the plan;
  - a new run reuses an approved story with no second stop.
- By hand, on fixtures:
  - the CLI gate and resume;
  - the dashboard's job API end to end on a second server: plan, gate, resume, plan ready, and a second resume refused;
  - one draft render through `--resume <run> --chunked`.

### Not built yet
- The brief's must-haves and the brief check, the channel profile id in run.json, and the story checker role with `story.check.json` (P2 and later).
- At gate 1 in the dashboard: editing lines and rewriting named beats. On the CLI, edit `story.json` before the resume.
- Accepting the critic's proposals with one click (the producer's proposals, P5), and the producer telling the user what a changed story will redo. Today the log says, stage by stage, that its inputs changed.
- The voice timing still writes `output/<run>-voice/` and `public/voice/<run>/` through `tts.ts`, outside the run folder.

## 12. Status: what P2 built (2026-11-04)
Phase P2 of §9: channel profiles and the three story modes. The defaults of §10 hold:
- as written, the voice is never sped up to fit, and the user is told the length instead (question 3);
- the director's memory is per channel (question 13);
- the story gate stays on by default (question 2).

### Channel profiles
- **The files.** A profile is `channels/<id>.json`, committed and versioned, and checked by a zod schema ([ai/channels.ts](../../src/generator/ai/channels.ts)). Its parts:
  - the writer's intro and rules, how the narrator speaks, the hook example, the structure, tone and phrases to avoid;
  - the story modes it allows, and the one a script gets;
  - the most characters, and the longest line;
  - the critic's intro and what it watches for;
  - the voices, the music moods (with a fallback) and ambience;
  - the look (grades, times of day, shot lengths, notes), the caption style and the formats;
  - the devices allowed, and the story gate.
- **The four channels** are those of §7: `what-if` (the default), `action`, `drama` and `documentary`. `npm run generate -- --channels` lists them.
- **What-if changes nothing.** Its writer and critic text are the prompts of before profiles, word for word. `prompts.test.ts` compares every writer, revise, long-form, critic and notes call with the prompts recorded from the code of before (`test-fixtures/pipeline/what-if-prompts.json`). The money-doubles (9:16 and 16:9) and forest-walks fixture plans are byte-identical: spec, story, voice, timeline, direction and sound.

### Where each part of a profile is used today
| Part | Used by |
|---|---|
| writer | every writer prompt: the system text, the narrator line, the character rule, the hook example, the moods; a story mood the channel does not use becomes its fallback |
| voices, captions, the default format | the CLI, when the run names none; the dashboard, when you pick the channel |
| formats | a warning when the run's format or length is outside the channel's |
| music | run.ts: a mood the channel does not use becomes its fallback; no ambience removes the beds |
| devices | run.ts drops what the channel does not use from the director's choices, with a warning: the counter, its reactions and pulse, the timer, the hero prop, world events, the time-lapse, featured actors, bullet time. Flights follow from the places, so they are left to the director's prompt |
| gates | the story gate's default, and gate 2's (§14) |
| critic, look, the devices as guidance | the critic's system text, and the director's and the sound designer's guides at the end of their prompts (`ee0c153`, below) |
| the memory | `withMemoryChannel` (ai/knowledge.ts): the director's anti-repetition block lists only the channel's videos, and videos from before channels count as what-if. `report.json` records the channel |

### The story modes
- **Premise:** today's writer, given the channel's rules.
- **Adapt:** the writer gets the user's story as a source block, and may cut, merge and rephrase. Its fixture label is `writer-adapt`.
- **As written:** the reader is [pipeline/script.ts](../../src/generator/pipeline/script.ts).
  - **Code reads the script:**
    - a narration paragraph becomes `say`;
    - `Name: line` becomes a character's line (ALL CAPS names become Title Case);
    - a line or a part in `[...]` or `(...)` becomes `see`, never spoken;
    - a first `# Title` is the title, and a later heading or a `---` line starts a new act.
  - **Code splits long paragraphs** at sentence ends, into about 5 s of speech (8 s in 16:9). Code does this, not a model: it is exact.
  - **The hook** is the first narration sentence, so it is the user's words too. A script that opens with dialogue shows its title as the hook, not read aloud (`hookVoiced: false`).
  - **The new `reader` role** fills only what each beat shows where the script says nothing, the characters' gender, age and look, the title and the mood. A reply that changes a spoken word is asked again, and `checkWords` proves that the story's spoken words are the script's, in order and with the same speakers.
  - **The script sets the length.** With no length given, the brief's target is the script's estimated length when read aloud. A script that cannot fit the format even with the shortest pauses stops before any model call, and says that 16:9 holds 10 minutes.
  - **Never sped up,** at the plan or at the render, and never revised. The critic's notes on it are only proposals.
  - **The voices it needs** (narration, characters) are turned on, with a note.

### The commands
```
npm run generate -- --channels
npm run generate -- --channel drama --script story.txt                   # the drama channel: as written
npm run generate -- --channel drama --script story.txt --mode adapt
npm run generate -- --script story.txt                                    # what-if: adapt (its script mode)
npm run generate -- "<premise>" --channel documentary --format 16:9 --duration 300
```
- **The premise** of a script run is its title, or its first sentence.
- **The modes** a channel does not allow are refused, as is a mode without its script.
- **A resume** uses the run's own channel, mode and script.

### The dashboard and the API
- **The Create wizard's first step** has a channel picker. A channel brings its format, caption look and narration and character switches, and each can still be changed. It also has a "Use my own story" box: paste a story, then choose "Rewrite it into beats" (adapt) or "Keep my words" (as written), as the channel allows. The summary shows both.
- **GET `/api/channels`** lists the channels.
- **POST `/api/plan`** takes `channel`, `script` and `mode`. It names a pasted story after its title when no idea was typed, and passes the story to the CLI in `output/plan-<job>-script.txt`, removed when the job ends. The brief keeps the text, for a resume.
- **The roles.** `reader`, `breakdown` and `matcher` join the model roles in Settings. Each uses the writer's model when it has none.

### For other owners (done since, in `ee0c153`)
These were wired on 2026-11-05 as described. The director's and the sound's guides go into their stages' input hashes only when they are set, and so does the critic's text for a channel other than what-if; what-if's prompts, plans and stage hashes are unchanged. `modes.test.ts` checks that a drama run sends all three.
- **`pipeline/critic.ts`** (the weather agent):
  - `critiquePlan` takes `profile?: ChannelProfile`, and sends `system: criticSystem(input.profile ?? loadChannel())` (both from `ai/channels.ts`; for what-if it is today's text, tested).
  - Then run.ts passes `profile`.
- **`pipeline/director.ts`** (bullet time):
  - `directStory` takes `guide?: string` and appends it at the end of its prompt.
  - run.ts passes `guide: directorGuide(profile)`, which is `""` for what-if, so nothing changes there.
  - It carries the look and the devices as words.
- **`pipeline/sound.ts`** (the weather agent): `designSound` takes `guide?: string` and appends it to its prompt; run.ts passes `guide: soundGuide(profile)` (`""` for what-if).
- **`spec.schema.ts`:** no change is needed. The channel lives in the brief and run.json.

### Checked
- `channels.test.ts`:
  - the four profiles load;
  - what-if's writer and critic text equal the recorded prompts;
  - the other channels change them;
  - formats;
  - broken profiles are refused;
  - the memory is per channel.
- `script.test.ts`: the parse, the beats, the hook, a dialogue opening, and the word check failing on a changed word or a line moved to another speaker.
- `modes.test.ts`:
  - a drama script as written keeps every word and sets its own length, with no line sped up, the counter and timer dropped, and the mood replaced;
  - a reader that changes a word is asked again;
  - a script too long stops before any model call;
  - adapt;
  - refused modes;
  - the device and mood filters;
  - the natural length.
- By hand: the CLI as written, and the job API end to end on a second server (`/api/channels`, an as-written drama, a refused mode).

### Not built yet
- In an as-written run, Ask AI in the editor may still change the words. The doc asks for a lock that lets only the user's own typed words change.
- A settings page for profiles: they are JSON files for now (question 14).
- Description templates, the licence tiers and the sources per channel (P4), and per-role model overrides in a profile.
- The story checker role (`story.check.json`), and the lost-plot-point check for adapt.

## 13. Status: what P4's library built (2026-11-04)
The library side of phase P4 of §9: finding, checking, downloading and taking in what a shopping list is missing, and the build-request queue. Gate 2 in the run, the server and the dashboard is not wired yet. The answers to §10 questions 4 to 12 are the recommended defaults. The code is in [library/acquire/](../../src/generator/library/acquire/), and the CLI is [scripts/acquire.ts](../../scripts/acquire.ts).

### The sources
| Source | State | How it searches | Licence read from |
|---|---|---|---|
| Kenney | index, on | the 3D and Audio pack lists (about 6 pages, cached in `.cache/sources/kenney/`); an offer is a pack, and the model or sound inside it that best matches the need's words is taken in, or the one named as `kenney:<pack>/<file>` | the pack page's licence row, and the zip's License.txt, which must agree |
| KayKit | index, on | the itch.io listing and the GitHub repositories (2 requests, cached) | the repository's LICENSE.txt, else the zip's file, else the pack's itch.io page |
| Quaternius | index, on | the itch.io listing (1 request, cached); the free download flow | the licence file in the download (CC0 or the Quaternius Asset License 1.0), else the page's row |
| BigSoundBank | works, on | the site's own search, at most 2 queries per need, each cached | the "License" section of the item's page. Every page's footer says "Free and Royalty Free", so that phrase alone proves nothing |
| FreePD | index, on | the archive.org metadata (1 request, cached), category folders only; a folder is a mood | the source's single dedication, with the md5 checked against the metadata |
| Poly Pizza, Freesound | disabled | built on recorded replies; they need the user's own key (`POLYPIZZA_API_KEY`, `FREESOUND_API_KEY`) | the API record |
| Sketchfab | by link | a pasted link is read through the public API, with no key; downloading needs `SKETCHFAB_API_TOKEN` | the API record's licence slug |
| Poly Haven, ambientCG | off | photoreal | |

- **Polite:** one request at a time per host, 1.2 s apart, a tool User-Agent (a browser's only for BigSoundBank, as `setup-audio-library.ts` does), https only. The indexes are refreshed only with `--refresh`.
- **Kenney's downloads changed.** Pack pages no longer link the zip. Their "Continue without donating..." button asks `kenney.nl/download-link/<id>` for a signed link, and that answers 403 to tools. No browser is imitated. Zips that are already cached (`.cache/world-assets/kenney/`, `.cache/audio-library/`) are used again. For any other pack, the error says where to put a zip downloaded in a browser. The same change stops `scripts/world-assets/kenney.ts` for packs it has not cached.

### The licence check
- **Read per item at download** ([policy.ts](../../src/generator/library/acquire/policy.ts)), from the item's own words: a licence file, a page's licence section, or an API field. A whole web page is never classified.
- **The tiers:**
  - Free: CC0, public domain (FreePD) and the Quaternius Asset License 1.0.
  - Credit: CC-BY 3.0 and 4.0 and OGA-BY, for models only, with a credit line in the landmarks' form. CC-BY music is off, and sounds are never CC-BY.
  - Never: NC, ND, SA, GPL and LGPL, Sampling+, terms that ban AI use, editorial use only, anything marked as AI-generated, and anything unclear.
- **The evidence** goes beside each item as `licence.json`: the ref, the page, the file URL, the date, the statement and where it was read, the text's sha256 and an excerpt, the second statement where one must agree, the decision, the credit line and each file's sha256. The licence file itself is kept beside it. A refused item installs nothing, and its evidence stays in quarantine.

### Intake ([intake.ts](../../src/generator/library/acquire/intake.ts))
- **Quarantine:** each item gets its own new, empty folder, `.cache/intake/<source>/<item>/`. Zip paths are checked, every entry is capped at 64 MB, a model's buffers and textures must sit inside the archive, and nothing is run. FBX, OBJ and Blend are refused with what the pack ships.
- **Models** go to `public/assets/acquired/models/<source>/<id>/`.
  - They are measured, classified and scaled to metres by the world catalog builder's own code (`buildCatalog`, `chooseScale`), with one scale for the whole kit when the model comes from a pack.
  - The need's kind sets the category. The clips are mapped through `mapClips`.
  - The style flags are reported, not enforced: triangles over budget, textures over 2048 px, many materials, and "looks scanned".
- **Sounds** go to `public/assets/acquired/sounds/<kind>/<id>`.
  - They are converted to 48 kHz as the library is (WAV for effects, MP3 for beds and music) and measured with `measureLoudness`. They are never played.
  - The silence at each end is measured. A bed must last 20 s and is checked for a clean loop (the loudness of its two ends, with loudnorm: the bundled ffmpeg has no volumedetect).
  - The tags are the source's words, the need's words and the words of the sound name that stood in for it, so that name now reaches the file. A music track must reach a mood.
  - The entry is published into `audio-library.json`, merged by id, for the sound picker.
- **`acquired.catalog.json`** (repo root, committed) lists what was taken in: models as world-catalog records (`createCatalog` reads them), sounds as library entries, and each item's source, licence, evidence and hashes.
  - The registry reads it beside the world catalog and the library, but only items whose files are on this machine.
  - `assets.catalog.json` and `world-catalog.json` are not rewritten.

### Gate 2's functions ([acquire.ts](../../src/generator/library/acquire/acquire.ts))
- `findOffers(needs)`: the offers for every need that is download, or close with a download gap. Nothing is downloaded.
- `parseApprovals`: the approvals, as the CLI writes them.
- `approveAllFree`: "Approve every CC0 pick".
- `acquire(needs, approvals)`: runs only what was approved.
  - A must-have that can't be had keeps its substitute and files a build request, so the run never stops.
  - The changed needs are matched again (`matchNeeds` with `only` and `previous`), and `needs.json` keeps each choice.
  - It returns `acquisition.json` and the new `needs.json`.
- `syncAcquired`: on another machine, it fetches every item again by its ref. It holds back any item whose licence or file hash changed, and says so.

### The build-request queue
`build-requests/<id>.json` ([requests.ts](../../src/generator/library/acquire/requests.ts)) holds `what`, `why`, `asks` (run, need, beats, time), `count`, `fallback`, `acceptance` and `status`. There is one file per capability. A run and need that ask again update their own line. The queue is ranked by count, and nothing is built automatically. Open requests are planned capabilities for the next match.

### The commands
```
npx tsx scripts/acquire.ts <needs.json> list                    # the offers; writes shopping.json, downloads nothing
npx tsx scripts/acquire.ts <needs.json> get n6=bigsoundbank:1048 n2=close n3=build n9=skip [--all-cc0]
npx tsx scripts/acquire.ts sources | requests | sync
    --root <dir>  a trial library   --sources a,b   --refresh   --run <id>   --cc-by-models off   --cc-by-music on
```

### Checked
- **55 tests on a mocked fetch** and fixture archives in `test-fixtures/acquire/`:
  - each adapter;
  - the itch.io flow;
  - an escaping zip entry;
  - FBX-only and NC packs;
  - Poly Pizza and Sketchfab with and without keys;
  - the policy table;
  - a model in centimetres scaled to metres;
  - an animated glTF character's clips;
  - sounds measured, the 20 s bed, the loop check and mood tags;
  - the queue;
  - the whole flow from offers to the match again;
  - the sync, with a licence that changed.
- **One real check, in a temporary library** (deleted afterwards), on the keeper's needs:
  - BigSoundBank `bsb-1048` (a fog horn, 3.6 s): close to have, with `ocean_ship_horn` now reaching it;
  - FreePD `piano-magic-motive` (78 s): download to have, in the sad mood;
  - KayKit Prototype Bits' `Wall_Target` (glTF with its bin and texture, CC0 from the archive's licence file): download to have.
  - About 20 requests in all. Kenney's download answered 403, as described above.

### Built since (2026-11-05)
- **The world catalog reads `acquired.catalog.json`** (`afa6377`, [catalog.ts](../../src/world/catalog.ts)), by id only.
  - `assetById` and `creditsFor` find an acquired model, so a model the director names can be placed and credited.
  - `allAssets`, `findAssets` and `catalogSummary` stay the built-in ones: they are the pools the world casts and dresses from by itself.
  - Held-back items and ids the built-in catalog has are left out.
  - With the committed (empty) file, every answer is the built-in one, and Paris and New York frames render byte-identical.
  - The registry still reads the file itself (`allAssets` plus `acquiredInventory`), unchanged.
- **Sound names for acquired sounds** (`e0064df`, [audio-resolve.ts](../../src/generator/audio-resolve.ts) `acquiredSoundNames`).
  - `SOUND_QUERY` is the built-in table plus a name for each acquired sound that no name reaches (the built-in names and the synthesized catalog's).
  - The name is the first of the sound's tags in its need's word order ("foghorn"). When that is taken, it is two or three words, or the word and the kind ("harbour_bed").
  - Music, held-back items and sounds whose file isn't on this machine get no name.
  - A new name reaches only sounds no name reached, so no existing pick changes. It joins the designer's vocabulary, and so its fuzzy name matching.
  - With no acquired sound, the table is today's, key for key (a test pins its hash).
- **`setup-audio-library.ts` reads BigSoundBank's "License" section** (`7afca56`), with the adapter's `bsbLicenceDecision` and the policy, one request at a time, 1.2 s apart.
  - The 24 BigSoundBank files in `public/library/` were re-checked on 2026-11-05 (24 page requests). Every page's section says "CC0 (public domain)", so all 24 pass. Nothing was deleted or moved.

### Not built yet
- Gate 2 in the run, the server and the dashboard, the in-process refresh after an intake, and the bundle's cache key are built since: §14.
- **Preview stills,** per-model clip overrides and the librarian role (tags are cleaned by code).
- **OpenGameArt by link,** and an FBX converter after a prior-art check.
- **Clip packs per rig family** (P6).

## 14. Status: gate 2 in runs (2026-11-05)
Gate 2 of §2 in the run, on the command line, on the server and in the dashboard. It calls P4's library (§13, [acquire.ts](../../src/generator/library/acquire/acquire.ts)) and changes nothing in it.

### Where it stops
- **After the library match, before the director** ([run.ts](../../src/generator/pipeline/run.ts) `shopGate`). The needs it looks at are those of `needsToShop(needs)` with no `choice` yet.
- **It stops only for a need nothing in stock stands in for** (status `download`). A run whose needs are all have or close goes on.
  - Its close needs with a download gap (the keeper's characters and its sad music, for example) are got only when the user asks: with choices given in advance (`--all-cc0` on the first command), or at a stop made for another need, where the list shows every open need.
  - `needsToShop` alone would stop for every close need with a download gap, which most runs have.
- **At a stop:**
  - `findOffers(needs, {run})` finds the offers, and nothing is downloaded;
  - they are saved in `output/<run>/shopping.json`;
  - `run.json` records `gates.shop = { state: "waiting", needs }`;
  - the plan throws `ShopGateStop`.

  A second stop with the same inventory uses the saved list, with no new request.
- **With the user's choices** (`ShopDecision`: the approvals, and `allFree` for every CC0 pick), `shopApprovals` decides every open need:
  - the named needs as named (a need that is not in the run is refused, with the run's need ids);
  - with `allFree`, `approveAllFree` over the open needs, so a CC-BY offer is never picked for you;
  - every need left keeps its stand-in (`close`), or is left out (`skip`) when nothing stands in.

  Then `acquire(needs, approvals, {run, shopping, models})` runs. `acquisition.json` and the new `needs.json` (each choice recorded) are saved, `gates.shop` becomes `done`, and the director goes on. A must-have that could not be had keeps its stand-in and files a build request (§13), so the plan never stops there.
- **The same process plans on with what was taken in.** After an intake the run calls `setAcquiredModels` and `setAcquiredSounds` with the new catalog, and `reloadLibrary` ([audio-library.ts](../../src/generator/audio-library.ts)). So the director, the sound designer and a render in that process see the new items.
- **The render bundle's cache key** ([render/bundle.ts](../../src/generator/render/bundle.ts) `sourceHash`) now hashes `acquired.catalog.json`, so a cached bundle is built again after an acquisition. Every cached bundle is built once more after this change.
- **On by default** for the CLI and the dashboard, through the channel profile's new `gates.shop` (default true). It is off with `--no-shop-gate`, with `shopGate: false` in POST `/api/plan`, or with `resumePlan(id, { shopGate: false })` at a stop.
  - Library callers (`runPlan`, `generateSpec`, the milestone, the tests) plan straight through unless they ask, and their brief and stage hashes are as before.
  - `npm run milestone -- --fixtures` and the fixture plans are unchanged. Runs from before gate 2 read as gate 2 off.

### The commands
```
npm run generate -- "<premise>" ...                 stops at the story, then (if something is missing) at the shopping list,
                                                    which prints the needs and each offer's licence, size and page, then SHOP_ID: <run>
npm run generate -- --resume <run> --all-cc0        get every free (CC0) pick, plan the rest
npm run generate -- --resume <run> --approve n6=bigsoundbank:1048 n2=close n3=build n9=skip   (add --all-cc0 for the needs not named)
npm run generate -- --resume <run>                  go on with what the library has (every stand-in kept, nothing downloaded)
npm run generate -- --status <run>                  "gate 2  the shopping list waits for your choices (n1, n4, ...)"
npm run generate -- "<premise>" --no-shop-gate      never stop there
npm run generate -- "<premise>" --sources kenney,bigsoundbank   the sources searched (none searches nothing)
```
- `--approve` takes one or several approvals, comma or space separated, and bare `nN=...` words after it count too.
- Choices given before the stop (with the first command, or when approving the story) are used when the plan gets there.
- A run keeps the sources it started with (`brief.shopSources`).

### The dashboard and the API
- **The Shopping list step** ([ShoppingStep.tsx](../../ui/src/pages/create/ShoppingStep.tsx)) comes after the story review, when the plan job stopped there (`SHOP_ID`, `gate: "shop"`).
  - Each need is a card: its kind, whether the story needs it, its beats, and what stands in meanwhile.
  - The choices are Get one, Use the stand-in, Ask for it (a build request) and Leave it out. Nothing is downloaded by default.
  - Get one lists the offers. Each shows its licence badge, source, author, size or length, the pack note, its ref and a link to its page, and a model's thumbnail. Nothing plays.
  - "Approve every CC0 pick" sends the needs you changed, plus `allFree`. "Get N and plan the rest" sends every choice. Either starts a plan job that resumes the run.
  - The writing card lists "Your shopping list" as a step, and a toast says "Your shopping list is ready".
- **The Assets page** ([Assets.tsx](../../ui/src/pages/assets/Assets.tsx), `?tab=assets`, in the sidebar) shows:
  - the sources and their state (`sourceStatus()`, with the keys saved in `.env`);
  - the build requests in the order to take them (`readRequests` plus `rankRequests`);
  - what was acquired (`readAcquired(acquirePaths().catalogFile)`): the licence, the credit, the need it was got for, held-back items, and whether the files are on this computer.
- **The API:**
  - POST `/api/plan` takes `shopGate` and `shopSources`.
  - GET `/api/spec/:jobId` answers `{ ready, gate: "shop", runId, shopping }` at the stop: the waiting needs with their beats and stand-ins, the sources and the warnings.
  - POST `/api/plan/:runId/resume` takes `{ approvals: ["n6=bigsoundbank:1048", "n2=close"], allFree }`, checked with `parseApprovals`.
  - GET `/api/runs/:runId` adds `shopGate` and `waitsForShopping`. GET `/api/assets` is new.

### Checked
- `shop.test.ts` runs on the keeper's recorded replies with a brass telescope added (nothing stands in for it), a mocked fetch (FreePD only), a 25 s tone as the FreePD track, and a temporary library. It checks that:
  - at the stop, `shopping.json` lists every open need, the director waits, and no file is fetched;
  - a resume without choices stops again, with no new request;
  - a resume with the telescope as a build request and every CC0 pick fetches only the approved MP3 and takes in the sad music; the characters keep their stand-ins, the request asks for the telescope, every waiting need has its choice in `needs.json`, and the plan completes;
  - the keeper as it is (all have or close) does not stop and asks no source; with every CC0 pick given in advance, its close music is got without a stop;
  - turned off at the stop, nothing is acquired; library callers plan with no gate and no `shopGate` in the brief;
  - `shopApprovals` keeps the stand-ins of unnamed needs, never asks a decided need again, never takes CC-BY as a free pick, and refuses an unknown need.
- The other tests pass unchanged.
- By hand, on the keeper fixtures with the telescope and `--sources none`, in a check worktree:
  - the CLI stop, `--status`, and `--resume <run> --approve n1=build` (the request filed, the other needs kept their stand-ins, `PLAN_ID`);
  - the job API end to end on a second server: a plan with `shopSources: []` stopped with `gate: "shop"` and the four waiting needs (their beats and stand-ins), `/api/jobs` and `/api/runs` showed the stop, a bad approval and an unknown source were refused (400), the resume with `["n1=build"]` and `allFree` finished the plan, and `/api/assets` listed the sources and the new request.
- What-if fixture plans need no breakdown, so they never reach gate 2: their plans are as before (§12).

### Not built yet
- From the card: more results, or a pasted link (the CLI takes `nN=<link>`).
- Our own preview still of a model after Get, and the editable intake checks (§6).
- A Format-step switch for gate 2 in the wizard. It is on; POST `/api/plan` takes `shopGate: false`.

## 15. Status: P2's leftovers, the code map's config items, gate 2's small items (2026-11-05)
This closes the "Not built yet" lists of §12 and §14, except the preview still.

### The word lock in Ask AI (`e813abb`)
- **In an as-written run** the hook, a beat's narration and its lines (their words and who speaks them) are the user's own. Ask AI may change them only to words the user typed in the request: its quoted parts, or the whole request when it has none ([editor.ts](../../src/generator/pipeline/editor.ts) `wordLockProblem`, `typedWords`).
- A reply that changes them otherwise goes back to the editor role with the reason; shots, scenes and sound stay free. A line given to another speaker needs that speaker named; removing words is refused.
- The editor's Ask AI panel says the words are kept (`wordsLocked` on GET `/api/film/:id`). The user's own edits in the inspector are not locked.

### The channel profiles page (`1f1c467`)
- **Settings > Channels** (`?tab=settings&section=channels&channel=<id>`, [Channels.tsx](../../ui/src/pages/settings/Channels.tsx)) lists the channels. A profile is edited in a form (the channel, the story and its modes, the writer's and the critic's words, music and sound, the look, the devices, the gates) or as JSON (every field: the formats, voices and captions too).
- **A save is checked** as a plan checks the profile ([channels.ts](../../src/generator/ai/channels.ts) `saveChannel`). Its version goes up by one only when it changed, so each run's brief still names the version it used, and a resume warns when it changed. A new channel starts as a copy of another, at version 1.
- The API: GET and PUT `/api/channels/:id`, POST `/api/channels` `{ from, id, name }`. This answers §10 question 14 ("JSON files first; a settings page later").

### The story checker and the lost plot points (`9774996`)
- **A new role, `checker`** (Settings > AI models > Model roles; the writer's model when it has none), reads the story before gate 1 ([checker.ts](../../src/generator/pipeline/checker.ts)). It only comments:
  - notes, at most 5, in the channel's terms (its critic's "what makes a beat weak");
  - claims of real-world fact, each "known" or "check": every one for a documentary (the models have no web access, so the user confirms them at the gate), otherwise only the few the story makes;
  - for an adapted story, the plot points of the user's own story, each with the beats that tell it. **Code decides what was lost:** a point no real beat tells.
- **A run stage, `check`,** after the voice timing and before the gate, writes `story.check.json`. It runs when the story gate is on (its notes are shown there) or the story is adapted (a lost point is also a plan warning). A failure is a warning. Recorded replies with no `checker-1.txt` (every set from before it) skip it, so the fixture plans are as before.
- **Shown** at the CLI's story gate and on the dashboard's story review ("The story checker's notes", with "Lost from your story" first).

### The code map's §7.5 items 6, 7, 9 and 11 (`e848f64`)
- **One reader for each config file.** The CLI and the server read `ai.config.json` through [provider-registry.ts](../../src/generator/ai/provider-registry.ts) `readAiConfig`, and `.env` through [env.ts](../../src/generator/env.ts). A broken file is named in a warning and on the AI models page, never read as empty in silence. A `.env` save keeps every other line. The CLI never overrides a variable set in the shell; the server applies `.env` over its own on each use, so a key saved a moment ago works.
- **`ai.config.json` stays as committed.** The dashboard writes its changes (model roles, the default provider, providers added or removed, live model lists) to `ai.config.local.json`, git-ignored, which holds only what differs and is laid over the tracked file. On the GPU machine, choosing the writer in Settings writes that file; the tracked one does not change.
- **`checkEdits`** in pipeline/editor.ts is now `editProblem`.
- **One render request.** Approve on the plan review, the editor's Make the video and Try again on the render screen send only the plan's id. The server renders with the plan's own voices (recasts included) through the chunked, cached renderer, so a render after an edit reuses the unchanged chunks. Approve used to send the wizard's current voices, which could differ from the plan's (an as-written script turns voices on).

### Gate 2's small items (`343dccf`)
- **The Sources line** of the shopping list (CLI and dashboard) names the sources it searched (`Shopping.searched`): "Sources searched: none" for `--sources none`.
- **From a card:** "More offers" asks the sources again for that need alone, up to 20 offers from each (POST `/api/runs/:runId/offers`, `findOffers` with `only` and `more`); a pasted link to an item's page is read by its source as an offer (POST `/api/runs/:runId/link`, `offerFromLink`; Sketchfab reads links today) and approved as `nN=<link>`. Nothing is downloaded until the choices are sent.
- **The wizard:** the Format step has "Show me the shopping list" (`shopGate`), beside "Read the story first".
- **Not built: the preview still after Get.** Our own still needs a preview composition in `src/Root.tsx` and a render bundle after each intake (a minute or more), outside this work's files. The card shows the source's thumbnail meanwhile.

### Also, for other agents
- `critic.ts` (`5ac7443`): the bullet-time beat's line tells the critic the frozen world is intended. Videos without a bullet time keep the prompt of before.
- `shots.ts` (`79c365c`): `PLACE_SUBJECT` takes `belfry`, so a shot of the bell tower holds on a reaction.
- Open: `shots.ts` `subjectFromSee` counts stop-words such as "the"; fixing it changes the recorded plans' rule shots.

### Checked
`editor.test.ts` (the lock, and a re-asked reply), `channels.test.ts` (save, version, refusals, copies), `modes.test.ts` (an adapted story's lost points at the gate, kept after the approval; skipped without a reply), `config.test.ts` (the overlay, a broken file, `.env`), `acquire.test.ts` (the sources searched, one need, links), `critic.test.ts` (the bullet-time line). Each commit: tsc, eslint, the icon check and ui:build pass, and `npm test` passes on a clean worktree.

## 16. Status: P5, the producer you talk to (2026-11-05)
Phase P5 of §9, as §2 "The producer you talk to" designs it, on top of the editor.

### What it does
- **One conversation per run,** `output/<run>/notes.jsonl`, appended to only ([notes.ts](../../src/generator/pipeline/notes.ts)): the user's notes, the producer's answers and proposals, and what was applied, turned down or undone.
- **Each note is routed** by the new `producer` role (one small schema, [producer.ts](../../src/generator/pipeline/producer.ts) `routeNote`) into up to 4 actions. Code does the work, asking only the role each action needs:

| Action | Done by | On a finished plan | On a story at its gates |
|---|---|---|---|
| edit, settings | the editor (`askEditor`, exact paths) | a film edit | words: as a story note; otherwise a standing note |
| restage | the director, for the named scenes only | the other scenes, shots and world events stay, and so do the counter, timer, prop and bullet time; the counter-reaction and time-lapse checks run on the result | a standing note for the director |
| resound | the sound designer, with the note and the sound as it is | music, beds and hits | a standing note for the sound designer |
| story | the writer for the named beats (`applyNotes`), or the user's own typed words for one beat | film edits | `story.json` rewritten (the gate asks again) |
| need | the library match of the new thing | in stock: restaged in; missing: added to the run's `needs.json`; needing code: a build request | in stock: a standing note naming it; missing, at gate 2: on `needs.json`, so the shopping list offers it on the resume (at gate 1 the breakdown that follows writes `needs.json` anew) |
| build | a build request (`build-requests/`) | filed on confirm | the same |
| keep | a standing note | kept | kept |
| question | the producer's answer from the plan | nothing changes | nothing changes |

- **Proposals first.** Every action comes back as a proposal: one line and its diff. It is applied only on confirm, and a finished plan's change lands as a film version (film/store.ts), so the editor's history and undo see it.
- **Undo** takes back the last proposal still applied: the film version before it, the story as it was, the standing note, the build request's ask (the request goes when it held only that ask), or the added need. A film that changed since in the editor is undone there instead.
- **Standing notes** go into the director's and the sound designer's prompts when the plan goes on (run.ts adds them only when there are some, so plans without notes are unchanged), and into a restage, a resound and the editor's prompts.
- **As written:** a story note changes words only to words the user typed (in quotes), and the editor's word lock applies to every edit.

### The commands
```
npm run producer -- new "<premise>" [generate's flags]
npm run producer -- resume <run>            npm run producer -- status <run>
npm run producer -- needs <run>             npm run producer -- get <run> n6=<source>:<id> n2=close [--all-cc0]
npm run producer -- say <run> "make scene 2 at night"
npm run producer -- ok <run> [p1 p2]        npm run producer -- no <run> [p1]
npm run producer -- undo <run>              npm run producer -- notes <run>
```
`new`, `resume`, `status` and `get` run `npm run generate` with the same flags. After `ok` or `undo` on a finished plan the CLI rebuilds `spec.json`, so `npm run generate -- --resume <run> --chunked` renders the change.

### The dashboard
- **"Talk to the producer"** ([ProducerChat.tsx](../../ui/src/components/ProducerChat.tsx)) is on the story review (gate 1), the plan review (gate 3) and in the editor: the conversation, each proposal with its diff and Apply or Discard, Undo the last change, and the notes kept for the video. A change reloads the page's story, plan or film.
- **The API** ([server/producer.ts](../../server/producer.ts)): GET `/api/producer/:runId`; POST `say` `{ text }`, `ok` and `no` `{ proposal }`, `undo`. A finished plan's notes run in the film's queue, like the editor's own changes, and its playable spec follows each change.

### Checked
- `producer.test.ts`, on recorded replies with no network:
  - a finished money-doubles plan takes seven notes: a restage of scene 1 at night (only scene 1 changes), no music in the intro, a shorter hook, beat 2 funnier, "no dutch angles" kept, a build request, a question. Nothing changes before ok; each lands as a version; all six changes are undone newest first, back to the plan;
  - at the story gate: a story note rewrites `story.json`, a scene note waits as a standing note, a discarded proposal changes nothing, and the approved, edited story plans on.
- By hand on the CLI, on recorded replies: `say`, `ok` (version 2, `spec.json` rebuilt), `undo` (version 1) and `notes`.

### Not built yet
- The brief's must-haves and the brief check (§2, "Exactly what was asked").
- Offering a standing note as a channel rule (it stays with the run).
- A new beat ("add a beat where the cat escapes"): edits cannot add beats, so the producer rewrites existing ones, or the story is written again.
- Getting a need added to a finished plan: it goes on `needs.json`, but the shopping list runs only before the director (gate 2), and a finished plan is not resumed.
- With a real model: the router's choices are tested on recorded replies only.

## 17. Status: variants from one run (2026-11-05)
One run makes several versions of the same video, to test against each other: other hooks, other endings and other formats, crossed (borrowed from motion-design systems where one brief gives 3 hooks × 3 aspect ratios × 2 calls to action). Everything else is the run's own, and only what differs is voiced and rendered again ([variants.ts](../../src/generator/pipeline/variants.ts)).

### What a variant is
- **The ask:** `hooks=3,endings=2,formats=9:16,16:9`. Hooks (1 to 4) and endings (1 to 3) count the run's own; the run's own format is always made. That ask gives 3 × 2 × 2 = 12 versions, the run's own video among them, so 11 variants.
- **Ids:** `h<hook>-e<ending>-<format>`, for example `h2-e1-9x16`; hook 1 and ending 1 are the run's own.
- **The writer** proposes the other hooks and endings in one call (label `writer-variants`, the channel's writer system). An ending is a new narration line for the last beat only; its dialogue lines stay. The lines are kept in `variants.json`, so asking for more later asks only for the new ones. A changed story (an edited hook or last beat) starts the list again.
- **As written:** the user's words are kept, so only the format can vary (hooks or endings above 1 are refused).

### What is reused
- **The story, the director's and the sound designer's plans** (the stage files), unchanged. Every version is assembled under the run's own id, so the world is seeded the same.
- **The voices:** only the changed lines are voiced; the voice cache gives every other line back.
- **The timing.** Each format's versions share that format's own timing: the run's story timed once for it (in the run's format, the timing of the run's video). A new hook or ending keeps its window when it fits (`timing: "kept"`); a line that needs more time grows its window, and everything after a longer hook moves later (`timing: "longer"`).
- **The render chunks.** Every variant renders chunked into the run's own cache (`output/<run>/chunks/`).
  - With the timing kept, a variant's spec differs from the run's only inside the hook's or the last beat's window. A hook variant re-renders only the hook's chunk, an ending variant only the last.
  - For that, [render/plan.ts](../../src/generator/render/plan.ts) now keys `story.hook` with the hook card's time slice instead of globally (no composition reads it elsewhere). `PLAN_VERSION` is 3, so every cached chunk renders once more.
  - A longer variant changes the video's length, which is in every chunk's key, so it re-renders every chunk.
  - A batch passes `keepRuns` (5 plus the variants' count) to the cache, so it does not delete the run's own chunks.
  - Another format re-renders everything (its size is in every key). Its hook and ending variants then share its chunks.

### What a run saves
- `output/<run>/variants/variants.json`: the run, the base (format, hook, ending, `video.mp4`), `hooks` and `endings` (the run's own first), and one entry per variant: `id`, `hook`, `ending`, `format`, `differs` (`hook`, `ending`, `format`), `hookText`, `endingText`, `timing`, `state` (`planned`, `rendered` or `failed`, with `error`), `video` (relative to `output/<run>/`), `durationSec`, `chunks` (total, rendered, reused) and `renderedAt`.
- `output/<run>/variants/<id>/spec.json` and `video.mp4` (mastered like the run's).
- A version already rendered with the same lines is kept. A failed version is recorded, and the others go on.

### The commands
```
npm run generate -- "<premise>" --chunked --variants hooks=3,endings=2,formats=9:16,16:9
    plans and renders the run, then its variants; the story gate's and gate 2's resume lines carry --variants
npm run generate -- variants <run> hooks=3,endings=2,formats=16:9,1:1     add them to a planned run later
npm run generate -- variants <run> hooks=2 --no-render                     the writer's lines and the specs only
```
- The CLI prints each variant (what it differs in, its timing, its chunks, its file), then `VARIANTS_ID: <run>`. It exits 1 only when every variant failed.
- With `--no-render`, the variants are planned (their lines and specs), and the printed `variants <run>` line renders them.

### The dashboard and the API
- **The Variants panel** ([VariantsPanel.tsx](../../ui/src/components/VariantsPanel.tsx)) is on the render's done screen and on the Library's video page.
  - It offers hooks (1 to 4), endings (1 to 3) and the formats (the run's own checked); a shape longer than its format allows is greyed out. It says how many new versions the choice makes.
  - Render starts the job and follows it, then lists each version: what differs, its hook and ending, its format and timing, its chunks, and a player that never plays by itself.
- **The API** ([server/variants.ts](../../server/variants.ts)): GET `/api/runs/:runId/variants` (`variants.json`, the run's format and length, and a running variants job); POST `{ hooks, endings, formats }`, checked by `checkVariantsAsk` ([variants-ask.ts](../../server/variants-ask.ts)): 400 for a bad ask or nothing new, 409 while a job of the run runs. It runs `generate.ts variants <run> hooks=H,endings=E,formats=...` as a job (`kind: "variants"`). The videos play from `/media/<run>/variants/<id>/video.mp4`.

### Checked
- `variants.test.ts`, on the money-doubles replies with `writer-variants-1.txt` (the hooks and endings reply):
  - the ask and the crossed list;
  - the window rule (kept, longer, a longer hook moving the beats);
  - eleven variants from `hooks=3,endings=2,formats=16:9`: the writer's lines, one spec each under the run's id, a hook variant whose beats and scenes are the run's, and whose chunk keys equal the run's except the hook's chunk; an ending variant changes only the last beat's words; the 16:9 versions keep the story and the places; asked again, no writer call and nothing rendered twice;
  - an as-written run: hooks refused, a format planned.
- By hand on the recorded replies: the CLI's `--variants` with `--no-render` (11 planned), then `variants <run> hooks=2,formats=1:1 --no-render` with no fixtures at all (the saved lines, no writer call), and a bad ask refused.
- The fixture plans and `prompts.test.ts` are unchanged: a run without `--variants` plans and renders as before (only the chunk keys changed, as above).

### Not built yet
- **A real render of the variants.** Nothing was rendered here (no render on this machine during the task). On the GPU machine: `npm run generate -- variants <run> hooks=2` on a rendered run; the log must say 1 chunk rendered and the rest reused.
- **The editor's caption overrides** do not reach the variants: they are built from the stage files.
- **Variants of a variant:** an edit to one version in the editor; a publish pack per variant (20-publish.md).
- **Other endings with new dialogue lines** (the writer writes narration only).
- **A shorter line keeps its window,** so a much shorter ending holds the last image longer. Shrinking it would change the length and re-render every chunk.

## 18. Status: claims need support (2026-11-05)
Borrowed from an automated motion-design system's rule that a claim such as "a 240% lift" must come from real data. A story's factual claims are found and judged before the story gate ([claims.ts](../../src/generator/pipeline/claims.ts)). It never blocks the run, and when nothing is flagged it changes nothing.

### How a claim is checked
1. **Code finds the sentences** (`findClaims`, no model): every spoken sentence (the hook when it is read, each beat's narration, each character's line) with a figure (digits, %, "millions", "sixty tonnes"), a date (a year, a month, a century), a record ("tallest", "world's", "in history"), an authority ("scientists say", "studies", "according to", NASA), a titled person ("President Lincoln") or a named thing inside the sentence ("the Golden Gate Bridge"; the story's own characters are not real people), or an event ("war", "earthquake", "the moon landing"). A decimal point or "Dr." does not end a sentence. At most 24.
2. **The critic role's model judges each one** (one call, label `claims`; no new role): `known` (common knowledge supports it), `speculative` (with `framed`: told as a what-if or as uncertain, not as fact), `source` (a figure, date, record, quote or attribution that would need a source, or is doubtful), or `none` (no real-world fact after all: the story's own invented detail; dropped). Each flagged claim gets a suggested rewording.
3. **Flagged** means `source`, or `speculative` told as fact.

### Per channel (by the profile's id or genre, `claimsPolicy`; no schema field)
| Channel | Policy | What happens to a flagged claim |
|---|---|---|
| documentary | strict | the writer is asked once (label `writer-claims`) to rewrite only the flagged sentences; code puts each new sentence in place of the old one, so every other word stays. Never for an approved story or an as-written script: those are listed only |
| what-if, and any other non-fiction | note | listed with its suggested rewording; nothing changes |
| drama, action, other fiction | skip | no call |

### The stage
- **`claimsStage(...)` is the whole stage in one call.** It saves `story.claims.json`: the policy, each claim (beat, sentence, claim, verdict, framed, rewording, the writer's new sentence), the count flagged, and for a strict fix the beats it changed and the new story's hash. On a resume, the story the stage already fixed comes back with no call and no second fix.
- **Warnings** only when a claim is flagged: "the writer reworded 2 claim(s)…", "1 claim(s) may need a source or a what-if framing: b4 …".
- **Lines for the CLI's gate:** `formatClaims` (each flagged claim with its rewording or the writer's change, then the rest in one line).
- **What-if stays byte-identical:** the check is its own call and stage; the recorded reply sets have no `claims-1.txt`, so they skip it; `prompts.test.ts` and the critic's prompt are untouched.

### Not wired yet (the files are other owners'; the exact edits are in [status/claims.md](status/claims.md))
- `manifest.ts`: a `claims` stage between `story` and `voice` (`story.claims.json`, "the claims check").
- `run.ts`: the stage itself, right after the story stage, so a strict fix is timed by the voice stage like any edited story; `StoryGateStop` carries the claims.
- `generate.ts`: the claims at the CLI's story gate. `server/index.ts`, `ui/src/api.ts`, `PlanStep.tsx`: the claims on the dashboard's story review. `server/progress.ts`: the `claims` marker.

### Checked
`claims.test.ts` on recorded replies (`test-fixtures/claims/`): the policies; what code finds (and does not) in a documentary and a what-if story; the prompt; what-if lists a claim needing a source and leaves the story unchanged; nothing flagged changes nothing; a documentary's two flagged sentences rewritten once, every other word the same, and no call on the resume; an approved story only listed; drama, action and a story with nothing specific make no call.
