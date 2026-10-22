# Progress & Handoff

**Last updated:** 2026-10-22, on the dev laptop (Windows, no NVIDIA GPU, Kitten only)
**Current status:** analysis, research and planning are done. **Phase 1 step 1 (render correctness) is partly done** (see below). Everything is still uncommitted on the dev laptop.

## Next step
Finish **Phase 1, step 1** (leftovers below), then continue through the Phase 1 steps in order. Plan: [05-plan.md](05-plan.md#phase-1--controls-captions-real-audio-render-fixes--milestone-1).

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
  - [ ] 2. `spec.settings` (format, duration, scene count, voice toggles, quality)
  - [ ] 3. Model roles (config, API, Providers UI)
  - [ ] 4. Voice: two toggles, audition, python path fix, VoxCPM description fix, Kitten tuning, TTS cache
  - [ ] 5. Caption style system + fonts + UI panel
  - [ ] 6. CC0 audio library downloader + `audio-library.json`
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

## Session log
- **2026-10-22 (later):** Phase 1 step 1 applied. Verified with stills: river (deterministic: two renders give identical hashes; matches the pre-change look), ocean and street (both used to crash on missing GLB files, now render). Mountain ridge fixed and checked with a countryside still. Dead story-job code removed. Found that React error boundaries do not catch GLTF load failures in the Remotion render, which is why `glb.tsx` now checks the file first.
- **2026-10-22:** full analysis of the repo. Researched CC0 audio sources and prior art. Mapped the 3D stages and the UI/server. The user chose the direction (see [decisions.md](decisions.md)), and the phased plan was written. Implementation started later the same day (see the entry below).
