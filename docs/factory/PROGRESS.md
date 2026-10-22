# Progress & Handoff

**Last updated:** 2026-10-22, on the dev laptop (Windows, no NVIDIA GPU, Kitten only)
**Current status:** analysis, research and planning are done. **Phase 1 steps 1 to 4 are done** (see below). Committed locally; not pushed.

## Next step
Phase 1 step 6 is done. Start **Phase 1, step 7** (audio renderer: library files, music, loops, ducking, loudness normalisation). Plan: [05-plan.md](05-plan.md#phase-1--controls-captions-real-audio-render-fixes--milestone-1).

Step 1 leftovers (remaining):
- `skeletonClone` runs on every render in AssetStage (performance, not correctness).
- The `/ 30` hardcoding moves to Phase 1 step 2, where fps becomes a setting.
- AgX tone mapping moves to Phase 3 (the look), since it changes every scene's colour.
- Videos "story" filter and `ENGINE_STAGES` story entries kept: they still read old report files.

## Phase checklist
- [x] Analysis of the current factory: [01-analysis.md](01-analysis.md)
- [x] Prior-art research: [02-prior-art.md](02-prior-art.md)
- [x] CC0 audio source research: [03-audio-sources.md](03-audio-sources.md)
- [x] Codebase map: [04-codebase-map.md](04-codebase-map.md)
- [x] Plan agreed: [05-plan.md](05-plan.md)
- [ ] **Phase 1:** controls, captions, real audio, render fixes (milestone 1)
  - [~] 1. Render correctness fixes — DONE 2026-10-22: shadows on; deterministic film grain; mist/rain/waterfall/windmill are pure functions of time (`src/compositions/mist.ts`); mountain ridge now renders (was an empty group; needed indices and normals); dead story-job code removed from `server/jobs.ts`; AssetStage uses absolute clip time; Ocean duplicate lights removed; `tod.ts` colour lerp returns `#hex`; GLB files are checked before loading (`useModelStatus` in `glb.tsx`) so missing models no longer crash the render. Leftovers listed below.
  - [x] 2. `spec.settings` — DONE 2026-10-22: format (9:16 / 16:9 / 1:1) sets width, height and the duration cap (90s; 600s for 16:9); target length and scene count reach the writer prompt and the validator; quality `draft` renders at half size. UI panel in Step 1 (`VideoSettingsPanel`); `/api/plan` validates; `generate.ts` takes `--format --duration --scenes --quality --settings-json`. Verified: 16:9 offline plan → spec 1920×1080 → draft MP4 960×540. NOT in this step: separate voice toggles (step 4); fps stays 30 by design.
  - [x] 3. Model roles — DONE 2026-10-22: `src/generator/ai/roles.ts` (six roles: writer, director, sound, critic, vision, editor); `roles` in `ai.config.json`; `GET/PUT /api/roles` with validation; Providers tab card (`ModelRolesCard`); the writer and the plan route use the writer's model. Verified: API accepts valid choices and rejects unknown role, unknown provider, unknown model; a plan with no provider now uses the writer's provider (it reports the missing key for ollama). NOT verified: a real Ollama generation (no key on this laptop) and the Providers card in a browser. Other roles are stored now and wired in their phases.
  - [x] 4. Voice — DONE 2026-10-22: two independent switches (narration, character voices) with their own engine; ▶ audition for the narrator and the character voice (errors shown, not swallowed); one Python resolver `src/generator/tts-python.ts` (env override, then `.tts/<engine>/.venv`), all hardcoded `C:/Users/Narwal` paths removed; VoxCPM preset ids mapped to their descriptions; Kitten sampling `temperature 0.6, top_k 30` and longer allowed pauses (`SYNTH_VERSION` 2); TTS cache in `public/voice/cache/` keyed by a hash of engine, voice, description and text; narrator skips lines that a character speaks when character voices are on. Verified: description mapping, the clear not-installed error, cache reuse with no Python run, routes report not-installed. NOT verified by ear: the Kitten and VoxCPM sound, since no engine is installed here.
  - [x] 5. Caption style system — DONE 2026-10-22: `src/generator/caption-style.ts` (5 presets: bold pop, clean, documentary serif, neon, minimal pill; overrides for position, offset, font, size, colours, box, uppercase, animation). Captions and the hook draw from one resolved look and use React spans (no injected HTML). Bundled fonts load before the first frame (`hud/fonts.ts`). Dashboard panel `CaptionPanel` with a live Player preview of the same component. The look is stored in `spec.settings.captions`. Verified: stills of bold pop, documentary and minimal pill at the position set; validation rejects a bad colour, a size over 96 and an unknown position; the offline plan keeps the look. NOT verified: the entry animations (only final frames were checked) and the live preview in a browser.
  - [x] 6. CC0 audio library — DONE 2026-10-22: `scripts/setup-audio-library.ts` (`npm run audio:library`). Builds `public/library/` (git-ignored) and `public/library/audio-library.json`. Built on this laptop: 752 files: 625 sfx, 86 stingers, 40 music (FreePD, 5 per mood folder), 1 ambience. Sources: Kenney (8 packs, CC0), OpenGameArt 100 CC0 SFX, BigSoundBank (curated list in `scripts/audio-library.bigsoundbank.json`), FreePD archive.org mirror. Each entry is measured with `loudnorm` (integrated LUFS, true peak, duration), with 5 s of silence added first, since short clips return nothing otherwise. Re-runs reuse downloads. Verified: all 752 entries have a loudness reading, every file in the index exists, and the index merges with earlier runs. NOT verified: listening (none played, by request).
  - [ ] 7. Audio renderer rewrite (library files, music, loops, ducking, loudnorm)
  - [ ] Milestone 1 review by the user
- [ ] **Phase 2:** AI director pipeline + voice-first timeline (milestone 2)
- [ ] **Phase 3:** cinematic camera, transitions, look, photographer vision QA (milestone 3)
- [ ] **Phase 4:** editor + chunked fast re-render (milestone 4)
- [ ] **Phase 5:** better worlds and characters (milestone 5)

## Machine setup notes
- **Install:** `npm ci --legacy-peer-deps`. A plain `npm install` fails with an ERESOLVE error because `@types/react-dom@19.3.0` wants a newer `@types/react` than the pinned 19.2.7. Then run `cd ui && npm install`.
- **Baseline:** `npx tsc --noEmit` passes clean as of 2026-10-22.
- **3D assets:** `public/assets/` and `assets.catalog.json` are not in git. Run `npm run assets` (needs network) before previewing street or ocean scenes. Without them those stages can crash; see the GLB Suspense bug in [04-codebase-map.md](04-codebase-map.md).
- **Missing on the dev laptop:** no `.env` (the Ollama key) and no `.tts/` venvs. Real LLM runs need the Ollama Pro key in `.env` as `OLLAMA_API_KEY`.
- **TTS:** the Python paths in the code still fall back to `C:/Users/Narwal/...`. Set `TTS_KITTEN_PYTHON` / `TTS_VOXCPM_PYTHON`, or install from the Setup tab. Phase 1 step 4 removes the hardcoded path.
- **Post-processing dependency:** use `@react-three/postprocessing@3.0.4` (supports fiber ^9.0). Newer versions need fiber ≥9.7, but the project pins 9.2.0.

## Known limits (as of step 2)
- Offline template premises (gravity, sun-set, time-stop) need the 3D asset catalog: run `npm run assets` first. Without it they fail with "Asset violations".
- Offline templates ignore the requested target length (their length is fixed). The LLM path honours it.
- Landscape (16:9) renders correctly in size, but the camera framing was tuned for portrait. Fixing that is Phase 3.
- The writer's target length is a prompt instruction only. The timeline solver that enforces it is Phase 2.

## Review fixes (applied before step 5)
- Plan route validates settings before creating a job, so a bad request leaves no job behind (checked: /api/jobs is empty after a rejected request).
- `pickRoleModel` in `src/generator/ai/roles.ts`: a role's model is never sent to a different provider. Used by the writer and the plan route.
- VoxCPM preset ids map to their description, and a preset beats a stale description. `voxDescription` now lives in `src/generator/voices.ts`, used by the generator and the audition route. The UI no longer sends the old description.
- Voice cache moved from `public/voice/cache` to `.cache/voice`, so Remotion bundles stay small.
- `.gitignore`: `public/voice/`, `.cache/` and `/*.zip` are ignored. The tracked voice files stay tracked (7 files, not 3 as first noted).
- Settings: `targetDuration` must be 8s up to the format cap (90s, or 600s for 16:9). The schema, the UI (clamped before sending) and the CLI all enforce it. The CLI prints one line for bad flags.
- Checked: role cases 2a-2e, voice mapping 3a-3d, cache reuse with no Python 4a-4b, settings bounds 6a-6c, CLI errors, and that a bad plan request leaves no job.

## Not verified on this laptop (carry these forward)
- The sound of Kitten and VoxCPM (no engine installed here; nothing is played, by the user's request).
- Real GLB loading (the "file exists" path) needs `npm run assets`.
- Ocean is now lit once instead of twice, so it is darker. Retune `OCEAN_TOD` after a render with assets.
- The render cost of shadows has not been measured.
- The UI has not been opened in a browser.
- No real Ollama run (no key here).
- Landscape framing is still tuned for portrait (Phase 3).
- The family templates have fixed beat times, so long 16:9 targets fight them until Phase 2.

## Step 5 limits (carry these forward)
- Fonts are the three bundled ones (Inter, Archivo Black, Georgia serif), not the 12 planned. More fonts need a download step; the bundled set keeps renders identical on every machine.
- Word-by-word and karaoke timing are estimated: each caption's time is shared evenly across its words. Real word timings come with Phase 2 voice timing.
- Entry animations (pop, slide-up, word reveal) are not checked frame by frame. Stills only show the settled state.
- The caption preview in the dashboard has not been opened in a browser.

## Step 6 limits (carry these forward)
- The sound library is generated, not committed. A new machine rebuilds it with `npm run audio:library` (needs internet; ~200 MB).
- BigSoundBank has one curated entry (thunder, 0127). More need adding to `scripts/audio-library.bigsoundbank.json`. The script keeps a file only if its page says "Free and Royalty Free".
- 99 entries have a true peak above 0 dBTP. The source files are hot. Step 7 must set gain from the measured loudness and never rely on the raw files.
- `loopable` is not measured yet. Beds need a loop check or a crossfade in step 7.
- FreePD's licence rests on its own dedication, and the archive item has no licence field. Only the category folders are used, not the root (which holds at least one non-public-domain file).
- Nothing was listened to. The measurements are numbers, not a judgement of the sound.

## Session log
- **2026-10-22 (step 4):** voice switches, audition, Python resolver, VoxCPM descriptions, Kitten tuning, cache. Found and fixed: the narrator was reading character lines too when both were on.
- **2026-10-22 (step 3):** model roles API, config, Providers card; README got setup and usage instructions (new-machine setup, dashboard and CLI workflow, output files, known limits, model roles).
- **2026-10-22 (step 2):** settings schema, validator, writer prompt, generator flags, server route, Step 1 UI panel, composition size from the spec. Also fixed the failure logger, which crashed on a fresh checkout (no `output/` folder) and hid the real error.
- **2026-10-22 (later):** Phase 1 step 1 applied. Verified with stills: river (deterministic: two renders give identical hashes; matches the pre-change look), ocean and street (both used to crash on missing GLB files, now render). Mountain ridge fixed and checked with a countryside still. Dead story-job code removed. Found that React error boundaries do not catch GLTF load failures in the Remotion render, which is why `glb.tsx` now checks the file first.
- **2026-10-22:** full analysis of the repo. Researched CC0 audio sources and prior art. Mapped the 3D stages and the UI/server. The user chose the direction (see [decisions.md](decisions.md)), and the phased plan was written. Implementation started later the same day (see the entry below).
