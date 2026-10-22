# 01 — Analysis of the current factory (2026-10-22)

## Core problem
**The AI isn't directing. It fills in a form for 11 worlds that were coded by hand.**

The "director" prompt in `src/generator/ai/generate-spec.ts` (around line 496) is really three fixed story templates: street escalation, street vanish and space, with fixed beat times such as `t = 2, 5, 8, 11, 14`. The model picks a family, a kit, a time of day and one of 7 camera styles, then writes captions. So every video has the same structure, and the AI can't show anything that isn't already a hand-built stage (450–1600 lines each).

AI video tools work the other way round. They write a story first, then many shots (a cut every 1.5–3s), each framed on a subject, with audio driving the timing. This project builds a fixed timeline first and adds voice and sound afterwards.

## Findings by layer

### Story / AI
- Story, shots, captions and SFX all come from **one `generateObject` call**. There's no script stage, no critique and no rewrite.
- The default provider is Ollama Cloud (`ai.config.json`), and the **whole asset catalog is dumped into the prompt**. A mid-tier model with a huge menu and a strict schema produces JSON that's valid but bland.
- The prompt says **"NO voiceover"** (`generate-spec.ts` around line 443), yet narration was added later. Captions are written as short on-screen text, and the TTS then reads those same captions aloud.
- Videos are limited to 1–3 scenes, each one continuous shot. That's about 3 shots per video, against 15–25 in the videos we're comparing to.

### Camera / visuals
- Every camera style is a **sine-wave formula** (`StreetStage.tsx` around lines 1216–1290). It doesn't aim at a subject, there are no shot sizes and no eased moves. It just drifts.
- The camera uses the **absolute frame** (`frame / 30`), and stages aren't wrapped in `<Sequence>`, so scene 2 starts with its camera move already part-way done. Frame rate is hardcoded to 30.
- Scene changes are hard cuts made by switching stage components inside a single `ThreeCanvas`. There are no transitions.
- **No post-processing:** no bloom, depth of field, ambient occlusion, colour grade or motion blur. This is the single biggest reason it doesn't look like AI video.
- **Shadows do nothing.** `ThreeCanvas` has no `shadows` prop, so every `castShadow` in the code is inert.
- The film grain uses a **CSS `@keyframes` animation**. Remotion doesn't sync CSS animations to frames, so it renders non-deterministically, and rotating a full-frame layer exposes its corners.

### Audio (why it sounds bad)
1. **All 51 sounds are synthesized in Node DSP** (`scripts/setup-sfx.ts`), including the crowd chatter, ocean waves and "music". Code-generated noise always sounds fake.
2. 16 real CC0 recordings sit in `public/sfx/cc0/` but were never registered in the catalog (0 CC0 variants). The renderer ignores the catalog anyway: it hardcodes `sfx/${tag}.wav` (`src/compositions/WhatIfVideo/audio.tsx` line 14).
3. **No music in the final render.** `audio.music` is `z.any()` and nothing reads it. `scripts/render-story.ts`, which handled music, no longer exists, so `runStoryJob` in `server/jobs.ts` would crash (it's dead code).
4. **Voice timing is wrong.** Each line is placed at its caption's start time, and the measured durations are recorded but never used, so lines overlap or leave dead air. The hook line plays at t=0 and collides with the first caption line.
5. **No mixing.** Voice doesn't duck the beds, loudness isn't normalized (Shorts targets about −14 LUFS), and SFX play at a flat volume of 1.0.
6. **Ambience goes silent on long videos.** Beds are 30s files with no `loop`, and videos can run to 45s.
7. **VoxCPM voice design never applies.** Preset IDs like `narrator-calm` contain no space, so `scripts/story-tts.py` never prepends the description.
8. **Kitten sounds robotic.** It runs with `temperature=0.1, top_k=1`, and `trim_silence` squeezes every pause to 0.26s, so delivery is rushed and monotone.

### QA
- `scripts/self-review.ts` and `scripts/audio-audit.ts` exist, but `generate` never calls them. Nothing checks the output before it's delivered.

## What a world-class factory needs (summary; details in 05-plan.md)
1. **Script first:** a strong model writes the hook, beats and spoken narration. A critique pass follows, then a rewrite.
2. **Voice first:** TTS produces the real durations, and those set the timeline and the word-level captions.
3. **Shot list:** one shot per narration phrase, using a fixed set of shot sizes, angles, moves and transitions.
4. **Composable scenes:** environment, props and rigged characters, with a camera that aims at subject anchors.
5. **Look:** post-processing (AO, bloom, depth of field, colour grade), soft shadows, AgX tone mapping.
6. **Audio:** real CC0 libraries, music, looping beds, whooshes on cuts, ducking, and normalization to −14 LUFS.
7. **QA loop:** a vision model reviews a still of each shot, plus audio metrics. Only the shots that fail are regenerated.
