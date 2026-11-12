Done (2026-11-11): the brand works end to end, from a channel's profile to the finished video. `src/compositions/WhatIfVideo/index.tsx` is free (P6): the wiring did not touch it. Left: the editor's timeline offset (below, for its owner) and a spoken outro (not asked for).

## The wiring task (2026-11-11)
P6 committed the spec field and the assembler's copy (`53b2f46`). Mine now: `pipeline/run.ts` (`finish` gains `brand`, its callers pass `channelBrand(profile)`), `pipeline/variants.ts` (the same), the video length with the bumpers (`render/index.ts`, `generate.ts`, `ui/src/preview/PlayerPreview.tsx`, `src/Root.tsx`), `WhatIfAudio.tsx` (the sound after the intro), `generator/qa/*` (the photographer's stills shifted by the intro). Proof: unbranded what-if byte-identical (fixture plans, hashed frames); one branded draft render of the action channel on recorded replies, stills and a sheet in `out/agentBRAND/`.

Steps:
- `2d69851` **the wiring:**
  - `compositions/brand/length.ts` (new): `storyFrames`, `videoFrames` (intro + story + outro), `introFrames`, `videoFrameOf`; its own module, so brand.ts never imports spec.schema.ts at run time;
  - `pipeline/run.ts`: `finish(..., brand?)` passes it to `assemble`; the plan passes `channelBrand(profile)` (and puts it in the assemble stage's inputs only when there is one), `reassemble` the brief's channel's; `pipeline/variants.ts` the same for every version;
  - the length: `Root.tsx` `specMetadata`, `render/index.ts`, `generate.ts` `durationFrames`, `ui/src/preview/PlayerPreview.tsx` `specTiming` use `videoFrames`;
  - `render/plan.ts`: a branded video's chunks are planned on the story's frames and moved by the intro (the first takes the intro, the last the outro); keys slice on story times; unbranded plans and keys unchanged;
  - `WhatIfAudio.tsx`: the sound starts after the intro and stops where the story ends, as in WhatIfVideo;
  - `qa/photographer.ts`: each still is rendered at `videoFrameOf(spec, frame)`;
  - `publish/pack.ts`: chapters after the first move by the intro; `thumbnailSpec` keeps the brand's look without its bumpers, so the thumbnail is the story's own frame (both the variants agent's files, finished: the same fix as the photographer's);
  - tests: `pipeline/brand.test.ts` (an action-channel plan carries the brand, a rebuild keeps it, a what-if plan has no brand key), `render/plan.test.ts` (the branded chunk plan), `publish/publish.test.ts` (chapters, thumbnail spec).
  - Checks on `wt-brand` (`e400a47` + these files): tsc 0, eslint 0, npm test 885 (884 pass, 0 fail), ui:build 0, icons clean. **Fixture plans byte-identical** (money-doubles, money-doubles-long, oceans-vanish, forest-walks, bullet-test: the same spec hashes before and after).
- `6de2f23` **unbranded frames, before and after the wiring** (bundles `b-w-before` = `e400a47`, `b-w-after` = `2d69851`'s files; money-doubles 9:16 with a timer, text and card HUD, every 3rd frame of 0-449, while a TTS worker loaded the CPU): 295 of 300 identical; the 5 others all in the card case's street window 7.3-7.8 s (frames 219-234), where each bundle gave the odd hash for some of them. Rendered again, frames 216-237, twice on each bundle: 22 of 22 identical in all four runs, and equal to the first pass's other bundle. So the street stage's run-to-run noise again (it grows with CPU load), not the wiring. Hashes: `out/agentBRAND/hash-w-*.txt`, `hash-wb1/2`, `hash-wa1/2`.
- `5134b8a`: 15-producer.md §7 "Brand", the run part.
- (this commit) **the branded render:** `FACTORY_LLM_FIXTURES=test-fixtures/pipeline/bullet-test npm run generate -- "What if, once a day, the world stopped for one second, for everyone but you?" --channel action --format 9:16 --duration 38 --no-story-gate --quality draft --chunked --audio-file test-fixtures/pipeline/bullet-test/audio.json`, in `wt-brand` at `2d69851`'s files (29 min, the kitten voices made fresh: 1-5 min a line).
  - **The video:** `out/agentBRAND/action-video/video.mp4` (540x960 draft, 1275 frames = 42.5 s: the 1.5 s intro, the 38.0 s story, the 3 s outro), with its `spec.json` and `props.json`. The chunked render planned 3 chunks, the first from frame 0 (the intro), the last to 1275 (the outro).
  - **Sheet:** `out/agentBRAND/sheet-action-video.png` (stills in `action-video/stills/`): the dot growing into the bolt and "Action short" (0.2-1.2 s); the hook in Anton over the city from 1.6 s; captions in Inter with orange keywords; the watermark top right once the hook has gone (9 s on); the outro with the bell button, fading out at 42.3 s.
  - **Sound in sync** (measured from the file, `scratchpad/brand/sync.py`, never played): the intro is silent (-91 dB RMS) and the first sound starts at 1.50 s. Each of the 14 voice lines, found in the mix by cross-correlating its own file, sits at its spec time + 1.5 s within 1 ms. The story's mix is -17.2 dB RMS and the outro -65.5 dB (silent). Loudness per 0.25 s: `action-video/loudness.txt`.
  - The action channel's limits held: the time-lapse was dropped and upbeat music became epic (run warnings).
- Worktree `wt-brand` removed (junctions first: the chunked render's `out/phase4-bundles/<hash>/public`, then `public/assets`, `public/library`, `node_modules`, `.cache`, `.tts`).
- Not done, for its owner: the editor's timeline (`ui/src/pages/editor/Timeline.tsx`) maps the player's frame to spec time as `frame / fps`; in a branded video that is `(frame - intro) / fps`, and `seek(sec)` should add the intro (`introFrames(spec)`).

## Earlier state (before the wiring task)
Done (2026-11-11). **index.tsx free:** `src/compositions/WhatIfVideo/index.tsx` is no longer being edited here; P6 may add its model-set line.

# brand: channel branding (and, if time allows, Flubber shape morphs)

## Task
1. **Channel branding.** Each channel profile (`channels/*.json`, `src/generator/ai/channels.ts`) gains an optional `brand`: a name and a logo (`public/brand/<channel>/` or none), colours (accent, text, background), the caption and title fonts (from the shipped fonts), an intro bumper (1-2 s) and an outro bumper (2-4 s, a subscribe call as text only), a corner watermark on or off. The bumpers are Remotion compositions in `src/compositions/brand/`, rendered as part of the video when the profile has them; captions and HUD take the brand's colours and fonts. What-if without a brand renders byte-identical to today. The Settings → Channels page edits the brand. Tests.
2. **If time allows: Flubber shape morphs** (`veltman/flubber`, MIT), frame-driven, for one motion-graphics touch.

Files owned: `channels/*`, `src/generator/ai/channels.ts` and its test, `src/compositions/hud/*`, `src/compositions/brand/*` (new), `src/compositions/WhatIfVideo/index.tsx`, `src/compositions/look/*`, `ui/src/pages/settings/Channels.tsx`, `package.json` and `package-lock.json` (dependencies only), `public/brand/*`; docs: a short "Brand" section in `15-producer.md` §7, this file.

## What is built
- **`src/compositions/brand/brand.ts`:** `BrandSchema` (name, logo `brand/<channel>/<file>`, mark, colours accent/text/background, fonts caption/title from `CAPTION_FONTS`, `intro.seconds` 1-2, `outro.seconds` 2-4 and `outro.subscribe`, `watermark`), `brandOf(spec)` (reads `spec.brand`, ignores one that does not parse), `bumperFrames`, `brandedFrames`, `brandCaptionLook`, `brandTitleLook`, `brandHudLook` (each returns its input unchanged without a brand).
- **`Bumpers.tsx`:** `BrandIntro` (a dot morphs into the mark, or the logo scales in, then the name), `BrandOutro` (mark or logo, name, a subscribe button whose icon morphs from the mark into a bell; silent), `Watermark` (top right inside the safe area, fades in after the hook).
- **Flubber (task 2, done with task 1):** `marks.ts` `morphPath(from, to, t)`, one interpolator per pair cached on values; `shapes.ts` holds the outlines (no Flubber, for the Settings page). `flubber@0.4.2` (MIT, its LICENSE checked; deps d3-array and d3-polygon BSD-3, earcut, svg-path-properties and topojson-client ISC, svgpath MIT; no randomness or timers in its source) and `@types/flubber@0.4.0`.
- **`WhatIfVideo/index.tsx`:** no brand: `VideoBody` alone, the tree of before. A brand: the intro Sequence, the video in a Sequence from the intro's end (picture, HUD and sound shifted together), the outro Sequence. Captions, hook and HUD take the brand's colours and fonts; the watermark.
- **HUD:** `StatHud` and `TimerHUD` take `BrandedHudLook` (`text`, `cardAccent`, default white and red as before); `Captions` takes `plateFont` (default "serif" as before).
- **`BrandRoot.tsx` / `index.ts`:** a separate entry with `BrandIntro`, `BrandOutro` and `BrandedWhatIfVideo` (WhatIfVideo with the bumpers in its length).
- **Channels:** `ChannelSchema.brand` optional; `checkChannel` refuses a logo outside `public/brand/<id>/` or missing; `channelBrand(profile)`. `action.json` (version 2) has a brand: "Action short", the bolt mark, orange on near-black, Inter captions, Anton titles, 1.5 s intro, 3 s outro, watermark. `public/brand/action/logo.svg`: our own logo (not used by the profile; the logo test case uses it). What-if, drama and documentary have none.
- **Settings → Channels:** a "The brand" group: on or off, a small preview, the name, logo path, mark, colours (picker and hex), the two fonts, intro and outro with their lengths, the subscribe line, the watermark.
- **Tests:** `brand/brand.test.ts` (6: no brand changes nothing, the schema, the spec's brand, the lengths, the looks, the morphs are pure), `channels.test.ts` (the brand and the logo checks).

## Committed
- `4bbb0f6`: this status file.
- `ec59572`: the brand, the bumpers, the morphs, the HUD and caption hooks, the channel schema, the Settings group, the tests. Checks on `wt-brand` (`9bc2163` + these files): tsc 0, eslint 0, npm test 851 (850 pass, 0 fail), ui:build 0, icons clean.

- `6258cfe`: the "Brand" section in 15-producer.md §7.

## Frame checks (2026-11-05, bundles of `9bc2163` with and without the brand files)
- **Unbranded, byte-identical:** the money-doubles 9:16 spec (sound stripped: its old sfx files are gone), with a timer, in the text HUD and the card HUD (bold-pop), every 3rd frame of 0-449: 298 of 300 identical. The 2 others (card frames 228 and 231) flip between two runs of the *same* bundle (each bundle matched the other's hash once); rendered again twice on each bundle, frames 222-234 are 13 of 13 identical in all four runs. So: the street stage's own run-to-run noise, not the brand (for the determinism owner).
- **Branded, twice:** 82 frames (intro, body, outro; the mark and the logo cases): the mark case identical twice; the logo intro's frames 10 and 20 differed between runs: the logo grew by a CSS `transform: scale`, which Chrome rasterizes at a scale it may reuse from another frame. Fixed in `cdf2e06`: the logo grows by its own width and height.

## Committed on 2026-11-11
- `cdf2e06`: the edits the frame check led to:
  - `brand.ts` `SINGLE_WEIGHT_FONTS`, `brandWeight`, `brandTitleWeight`: a single-weight display font (Anton, Bebas Neue, Archivo Black) is drawn at 400, never a smeared synthetic bold;
  - `Bumpers.tsx`: the names at that weight; the logo grows by its width and height, not a CSS scale;
  - `hud/Hook.tsx`: an optional `weight` prop (unset: the weight of before); `WhatIfVideo/index.tsx` passes it only with a brand title font;
  - `brand.test.ts`: the weights.
- Checks on the fresh `wt-brand` (`f5c8959` + these files): tsc 0, eslint 0, npm test 876 (875 pass, 0 fail), ui:build 0, icons clean.
- `dfd6e05`: this file.
- (this commit) the final frame checks, below, and this file.

## Frame checks on the final code (2026-11-11)
- **Bundles:** `b-before3` is `f5c8959` with the HUD and WhatIfVideo files of `4bbb0f6` (before any brand code); `b-after3` is `cdf2e06`'s files; `b-brand3` is the brand entry.
- **Unbranded, byte-identical:** the same two cases (money-doubles 9:16 with a timer, text HUD and card HUD, every 3rd frame of 0-449): 299 of 300 identical. The other, card frame 228, takes one of the same two hashes in every run of either bundle (`b8b45d9...` or `2dacaf0...`; both bundles produced both on 2026-11-05): the street stage's run-to-run noise, not the brand. Hashes: `out/agentBRAND/hash-before3.txt`, `hash-after3.txt`.
- **Branded, twice:** 82 of 82 frames identical across two runs (4 and 2 tabs), the logo intro included: `hash-brand3a.txt`, `hash-brand3b.txt`.
- **Sheet:** `out/agentBRAND/sheet-brand.png`. Top row: the mark case (Inter captions, Anton titles, text HUD): the dot growing into the bolt, the name, the video with the watermark and orange keywords, the outro whose button icon turns from the bolt into a bell. Bottom row: the logo case (`public/brand/action/logo.svg`, Montserrat captions, Bebas Neue titles, card HUD). Stills in `stills3/`.
- **Seen on the sheet:** the card HUD's big numbers keep Inter (only its label takes the accent); the watermark's name is small (26 px on a 1080 frame) next to the mark.

## Uncommitted
- Nothing.

## Next
- Nothing for this agent. The wiring below is for its owners; once spec.schema.ts keeps `spec.brand` and the assembler sets it, render an action-channel run and check that its length holds the bumpers.

## Worktree and outputs
- Check worktree: `wt-brand` removed after the checks (junctions first).
- Bundles and renders: `out/agentBRAND/` (`b-before3`, `b-after3`, `b-brand3` and the 2026-11-05 ones; each holds `public` as a junction, except `b-after`, whose junction is already gone).

## Findings for others
- **Determinism owner:** the money-doubles 9:16 spec in the card HUD renders frames 228 and 231 (street-block, about 7.6 s) one of two ways from run to run on the same bundle. **Traced by the fixes agent** (status/fixes.md item 5): not the street stage; the differences are all in the card HUD (a 1-level band along the timer card's shadow, once the timer card of an earlier frame), a raster of the HUD's DOM layer that Chrome sometimes captures stale. Not fixed yet.

## Findings for others: the edits that wire the brand into runs
None of these files are mine. Until they land, a profile's brand is saved and checked but no run's video shows it.
1. **`src/generator/spec.schema.ts`** (keep `spec.brand` through `validateSpec`): `import { BrandSchema } from "../compositions/brand/brand";` and in `ShotSpecSchema`, after `settings`: `brand: BrandSchema.optional(),`. (brand.ts imports only `type ShotSpec` from it: no runtime cycle.)
2. **The pipeline** (`pipeline/assemble.ts` where the spec object is built, or run.ts after `assemble(...)`): `...(channelBrand(profile) ? { brand: channelBrand(profile) } : {})` (`channelBrand` from `ai/channels.ts`). What-if has no brand, so its spec, hashes and fixtures stay byte-identical.
3. **`src/Root.tsx` `specMetadata`:** `durationInFrames: brandedFrames(secToFrame(videoSeconds(spec), spec.fps ?? FPS), brandOf(spec), spec.fps ?? FPS)` (both from `./compositions/brand/brand`).
4. **`src/generator/render/index.ts:89`** the same: `const durationInFrames = brandedFrames(secToFrame(videoSeconds(spec), fps), brandOf(spec), fps);` and `src/generator/generate.ts:90` the same.
5. **`src/compositions/WhatIfAudio.tsx`** (the chunked render's audio pass): wrap `<CompositionAudio>` in `<Sequence from={bumperFrames(brandOf(spec), fps).intro}>` so the sound starts after the intro, as in WhatIfVideo.
6. **`ui/src/preview/PlayerPreview.tsx:26`:** the Player's length with `brandedFrames` too.
7. **QA** (`src/generator/qa/*`): the photographer's stills are picked by spec time; in a branded video add the intro's frames (`bumperFrames(...).intro`).
8. **Not built:** a spoken outro (the schema has no voice; the task says text only unless a channel sets one): it would need the voice stage to speak `brand.outro.say` and the spec to carry its file.
