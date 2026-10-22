# 04 — Codebase map (as of 2026-10-22, commit d6633d7)

A reference for whoever implements the plan. Line numbers are approximate and will drift as the code changes.

## Pipeline today
```
UI (ui/, Vite :5177) ──/api──► server (server/index.ts, Express :5178)
  POST /api/plan        → runJob(--no-render) → tsx src/generator/generate.ts <premise> --no-render
                           → generateSpec() [src/generator/ai/generate-spec.ts] → output/<id>-spec.json, prints PLAN_ID
  GET  /api/spec/:jobId → reads output/<id>-spec.json (read-only review screen)
  POST /api/render-spec → writes output/<id>-audio.json → generate.ts --from-spec ... --audio-file ...
                           → runTtsStage (src/generator/tts.ts → scripts/story-tts.py)
                           → `remotion bundle` (every time) → `remotion render` (cmd spawn) → MP4 + report
```
- Jobs are kept **in memory only** (a Map capped at 50) and are lost when the server restarts. Progress comes from parsing log lines (`[1/5]`, `[voice]`, `Rendered a/b`, `Encoded a/b`, `PLAN_ID:`).
- `.env` is read and written by `server/providers.ts` (`loadEnv`/`saveEnv`). `ai.config.json` is read through `loadConfig`/`saveConfig` there and through `src/generator/ai/provider-registry.ts` (`loadAiConfig`, `resolveModel`). There is no `roles` field yet.
- `server/fetch-models.ts`: for Ollama hosts it calls `GET {origin}/api/tags` with a Bearer key and returns model names only.

## UI (ui/src)
- `App.tsx`: tabs `generate | videos | providers | setup` via `?tab=`. There's no router; URL state lives in `lib/navigation.tsx`.
- `pages/Generate.tsx` (~950 lines). Steps are tracked by `?step=1|review|3`, `?plan=`, `?job=`.
  - `VoiceSettings` (~lines 237–355): localStorage `vf:voiceConfig`, with a 4-way mode `none|narration|dialogs|both`. Audition is only for the narrator.
  - `SpecReview` (~lines 451–762): **read-only** view of the spec. Approve calls `renderSpec`.
  - `JobPanel`: SSE progress, stage pills from `ENGINE_STAGES`.
- `preview/PlayerPreview.tsx`: `<Player component={WhatIfVideo}>`. **Nothing uses it yet**; it's the base for the Phase 4 editor. Vite aliases `@` to `../src` and `publicDir` to `../public`.
- `pages/Providers.tsx`: key, test, set default, add provider. "Get models" only shows a toast; there's **no model picker**.
- `pages/Setup.tsx`: TTS engine install cards. `pages/Videos.tsx`: library, playback, review stills.
- The UI kit is shadcn-like (Radix + cva + Tailwind v4, dark only): Button, Badge, Card, Input, Textarea, Select, Dialog, AlertDialog, Collapsible, Switch, Tooltip. Toasts use sonner; icons use lucide.

## Dead code (delete in Phase 1)
- `server/jobs.ts` `createStoryJob` / `runStoryJob` spawn the missing `scripts/render-story.ts`.
- `ENGINE_STAGES` story/storyboard entries, the Videos "story" filter, `Job.storyboard` / `slug`, `public/whatif-data/*`.
- `generateVideo` (POST /api/generate) and `setProviderConfig` have no callers.

## Composition
- `src/compositions/WhatIfVideo/index.tsx`: a single `ThreeCanvas` (**no `shadows`, no `gl` props**) whose stage is picked by `scene.kit` (no `<Sequence>`, so stages see the absolute frame). On top sit the HTML overlays: StatHud, CSS FilmGrain (non-deterministic), Vignette, Hook, TimerHUD, Captions, CompositionAudio.
- `hud/Captions.tsx`: two hardcoded looks, "bold" (bottom 150) and "serif-italic" (bottom 600). It uses `dangerouslySetInnerHTML` to inject the keyword. `hud/Hook.tsx` is similar.
- `WhatIfVideo/audio.tsx`: SFX `sfx/${tag}.wav`, beds with `startFrom` and no loop, voice at `vf.at`.

## Stages: camera, anchors, problems
Every stage hardcodes `frame / 30` and writes to the single `useThree().camera` inside `useFrame` (ignoring delta).

| Stage | Camera rig | Main anchors (world coords) | Problems |
|---|---|---|---|
| **StreetStage** | `CameraRig` ~1182–1290, 7 styles, driven by zoom, beats, poiX, heroPos | Road x±4.6 (z +9…−80); sidewalks x±6.85; shop row x±11.6–12.8, z=2.5−6.9k, h 9.5–14.5; towers x±19–23; hero prop x±4.95 (sidewalk) / ±0.85 (plaza), z=−5−2.15i; café x5.4–7.4, z−8.5…−26.5; crosswalk z4.4; traffic x±2.25 | `GlbSingle` and `CarBody` call `useGltfPaint` **outside GlbSuspense**, so missing assets crash the scene |
| **SpaceStage** | `OrbitRig` ~211–244; the sun position uses the same `orbitAngles`, so **a new camera must also move the sun** | Planet at origin, r=max(1, value^0.55); moon orbit 2.35×scale | Clean |
| **OceanStage** | `CameraRig` ~283–301 | Water plane level 0–4.2; shoreline z=6+level/0.36; jetty x7, z10…−9, deck y1.6; canoes x±1.5–6, z−16…−58 | **Lights mounted twice**; `FloatingCanoe` loads GLB outside Suspense |
| **CountrysideStage** | Inline ~522–536 (must be extracted) | Houses on a ring r18–26 around (0,−15); barn x35–45; windmill x−30…−20, hub y12.5; road (−5,20)→(15,−60) | Windmill rotation and mist accumulate per tick (not deterministic); `MountainRidge` renders nothing |
| **ForestStage** | Inline ~324–337 | 180 trees r8–93; no hero object | Camera clips through trees; mist accumulates |
| **RiverStage** | Inline ~301–319 | River w12 × l200 at origin; waterfall at z=l/2−1 (optional) | Bank vs water axis mismatch; with `flowDir z` the camera looks sideways; mists accumulate |
| **InteriorStage** | Inline ~426–443 | Room 8×3×8; window (0,1.2,−3.02); sofa (−2,−1.5); lamp (−2.8,−1.2); cast slots fg(−1,2) mg(0.5,0.5) bg(1.5,−1) | Camera partly **outside the room**; no directional light; procedural people with no animation |
| **AssetStage** | `CameraRig` ~944–969 | Crowd zones fg x±4 z−4.5…−2, mg ±9 z−8.5…−4, bg ±20 z−24…−12; pier deck x±4.5 | `mixer.update(1/30)` on every render (not deterministic); `skeletonClone` every frame (slow); the crowd disappears if GLBs are missing |
| Legacy City/FirstPerson | Moves the world, not the camera | — | Old gravity demo only |

**Absolute-time spec fields read by stages:** statPanel beats, `events[].t`, `worldEvents` (lights-out, water-*), `timer`, `scene.from/to`, `look.timeSpan`. Keep stages on absolute time and give only the new camera scene-local time.

**Shared helpers to reuse:** `water.tsx` (`WaterSurface`, `seaSwellAt`, `waveHeightAt`, `GradientSkyDome`), `weather.tsx` (`WeatherLayer`, `lightsOutAt`), `tod.ts` (`getActiveTodLook`, `lerpTodLook`; **bug: `lerpColor` returns hex without `#`**), `Birds.tsx`, `SpaceStage.Starfield`. `mountains.tsx` is broken.

## Assets
- `scripts/setup-assets.ts` scrapes Kenney zips (blocky-characters, mini-characters, city kits, car-kit, nature-kit, furniture-kit, food-kit) and Poly Pizza bundles (Animated Men/Women, Ultimate Modular Men, Animated Animals, cars, stylized nature, city props). Everything is CC0 and goes to `public/assets/<category>/<pack>/`. It writes `assets.catalog.json` (`{id, file, pack, category, tags, animations, license}`); `export-asset-index.ts` then writes `src/compositions/assetIndex.generated.ts`.
- **Rigged animated humanoids and animals are included:** Kenney clips idle/walk/sprint/sit; Quaternius clips `HumanArmature|Man_*`. StreetStage plays them deterministically with `mixer.setTime`.
- Not present on the dev laptop; run `npm run assets`.

## Voice
- `src/generator/tts.ts`: `deriveLines` (narration = the hook plus every caption at `caption.from`; dialogs = captions with a `speaker`), `runTtsStage` (one python process per engine, wavs copied to `public/voice/<id>/`), `pythonFor()`.
- `scripts/story-tts.py`: Kitten (`temperature=0.1, top_k=1`, `trim_silence max_pause=0.26`) and VoxCPM (`cfg 2.0`, 10 timesteps; the description is only applied if the voice string contains a space, which is the bug). Sets `HF_HUB_OFFLINE=1`.
- `src/generator/voices.ts`: 23 Kitten voices with measured pace (Bella banned), plus VoxCPM preset descriptions.
- `server/index.ts` `/api/voice-sample`: the python path falls back to the hardcoded `C:/Users/Narwal/...`.
