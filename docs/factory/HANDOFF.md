# Handoff: start here on any machine (updated 2026-10-29)

This page is for whoever picks the work up next, person or AI session, on either machine. It holds the standing rules, where things stand, and what to do first. The detail lives in [PROGRESS.md](PROGRESS.md) and the per-phase documents listed in [README.md](README.md).

## 1. Rules for every AI session in this repo
These are the user's standing instructions. Claude Code's memory on the dev laptop is not in the repo, so this list replaces it on any other machine.
- **Never play audio.** Check sound by measuring files (loudness, true peak, duration, silence, overlaps). The user listens to the videos themselves.
- **Commit locally on `dev` only.** Never push, fork, open pull requests or issues, or contact anyone about the repo. The user pushes when they choose.
- **No paid model APIs.** Don't use `ANTHROPIC_API_KEY`. The user has an Ollama Pro plan, and each pipeline role picks its own Ollama model in Settings → AI models. On a machine without `.env`, run plans on recorded replies: `FACTORY_LLM_FIXTURES=test-fixtures/pipeline/<name>`.
- **The look:** stylized low-poly 3D only, no image-generation models; sound from the downloaded CC0 libraries only; cities from our own regional style rules (no OpenStreetMap).
- **Research before building:** before writing a new subsystem, look for existing tools and CC0 assets and propose adopt / borrow / build to the user.
- **Nothing appears without AI intent:** everything on screen or in the mix is there because the director or sound designer chose it, or follows from what they chose ([10-intent-audit.md](10-intent-audit.md)).
- **The crowd and featured actors stay off by default** (the user's decision, 2026-10-24). Turning them on is the user's call.
- **Don't stop to wait on a render:** keep working, and wait inside the turn.
- **Several chats may work in this repo at once:** say which files you own, edit only those, commit by file name (never `git add -A` over someone else's uncommitted work), and never revert a change you didn't make.
- **Folder links:** every render bundle under `out/phase4-bundles/` and `out/agentSPEED*/` holds `public` as a directory junction to the real `public/`. Unlink it with `rmdir <bundle>\public` before deleting a bundle folder, and never delete recursively through it.
- **Checks before a commit:** `npx tsc --noEmit`, `npm test`, `npx eslint src server`, `npm run ui:build`, `node scripts/check-ui-icons.mjs`. When other chats have uncommitted edits in the tree, check on a clean `git worktree` holding only your files, with junctions to `node_modules` and the untracked `public/` folders, and remove it the same careful way.

## 2. Where things stand
The phase table in [PROGRESS.md](PROGRESS.md) is the summary. The work of 2026-10-26 to 10-29, all committed on `dev`:
- **The world reacts to the story** ([11-world-reactions.md](11-world-reactions.md)): every counter beat over a real place moves it.
  - Things lift: stalls, debris, whole buildings.
  - Confetti bursts, or money rains down.
  - The ground cracks and breaks into slabs.
  - The lights go out building by building.
  - The streets flood, or ponds and fountains drain.
  - Snow falls and settles.

  The director must choose the reaction. A shot filming the place holds 2.5 s on it, and the camera keeps off lifting buildings and above a flood.
- **Moonlit nights** in places: a moon key with shadows, a moon disc, stars, and a near-black sky.
- **Dressed places:** a market in the main plaza, and a New York street pass (water towers, crossings with signals, hydrants, taxis, a clearer sky).
- **The camera's sight-line test** works on every stage. **Actors** walk off, lie down and stand up without sliding.
- **Render speed:** kit cities draw far buildings as baked cards (Colmar → New York 110 to 78 s per 15 s). The main video's world scenes went 229 to 112 s per 15 s on a quiet machine (`da39a18`), just under the 123 s bar.
- **The second comparison with the 8 reference frames** is in [quality-refs/README.md](quality-refs/README.md). The reaction and night frames are closest. The biggest gaps: people (the crowd is off), house colours and a landmark in the old towns, and the New York facades.
- **Stopped before the switch, nothing built yet:**
  - **Traffic in the world cities** (Phase 6 step 3). The research and the design are committed in [12-traffic.md](12-traffic.md) (`9535aba`): nothing to adopt, so build a small deterministic lane-graph simulation over our own streets with the installed CC0 car models. No code landed. Continue from that page: `src/world/traffic.ts` (pure, with tests), then `TrafficLayer.tsx` mounted from `Ground.tsx` behind a `traffic` prop, then stills, determinism hashes and a timing pair on the Paris stretch.
  - **Light and time** (Phase 6 step 4). Nothing written yet; `13-light-and-time.md` does not exist. Part A, buildable without a decision: a continuous dusk amount from the sun's elevation (today `Ground.tsx` switches all night lighting at `elevation < 1`), with windows and lamps switching on one by one, reusing the lights-out keys in `react/dark.ts`, and full-day and full-night frames byte-identical. Part B, the time-lapse: research the prior art and write a proposal in `13-light-and-time.md` for the user to decide before any code (how the director asks for a lapse, the per-frame cost against the render bar, the grade and the photographer).

## 3. First steps on the GPU machine
1. **Get the code:** pull `dev` after the user has pushed it. `git log --oneline` should show this page's commit or later.
2. **Set up** as in [PROGRESS.md](PROGRESS.md#machine-setup): packages, the sound library, 3D models, world assets and catalog, both voice engines, and `.env` with `OLLAMA_API_KEY`.
3. **Run the checks** in section 1. On the dev laptop on 2026-10-29: tsc clean, about 494 tests passing, eslint clean.
4. **GPU-machine tasks, in this order:**
   1. Set the Writer back to `ollama/glm-5.3-flash` in Settings → AI models → Model roles. It is still the NVIDIA model from the 2026-10-24 switch; the user chose flash.
   2. **Plan and render one world premise with real models,** for example `npm run generate -- "What if money doubled every 3 seconds in Paris?" --format 9:16 --duration 25`. Check that the director chose a `react` for the counter, that the plaza shot holds on the big beat, and that the reaction shows on screen. Every reaction so far was checked on recorded replies only.
   3. **Milestone 4:** `npm run generate -- "What if every clock in Paris stopped for one minute?" --format 16:9 --duration 180 --chunked`. Then change one caption in the editor and render again; the log must say 1 chunk rendered and the rest reused.
   4. **Ask AI** in the editor with a real model.
   5. **The photographer's vision questions:** choose a Photographer (vision) model and calibrate on about 50 stills ([09-phase3-handoff.md](09-phase3-handoff.md) §2 item 3).
   6. **Milestone 6:** three AI premises with real models, each using at least two places, in all three formats. Time the render per 15 s against the 123 s bar; this machine's GPU should beat the laptop.
   7. **Listen to the videos** (the laptop never plays sound): voices, music, the per-reaction hits.
5. **For the user to review or decide:**
   - the milestone 1, 2 and 3 videos;
   - the reference comparison sheets;
   - whether the crowd stays off;
   - the FBM sky;
   - whether a storybook full moon (always opposite the sun) is fine.

## 4. Open work that needs no GPU
- **The old towns:** varied house colours, a landmark such as a bell tower on the plaza, and hills behind (gate item 3).
- **New York:** brick and stone facades, and fewer street trees in the walking shots.
- **The plaza market as camera sight blockers:** this needs a `Subject` flag in `solve.ts` so area subjects skip the inside-the-radius rule ([09-phase3-handoff.md](09-phase3-handoff.md) §2 item 5).
- **Cairo's flood** ends in a straight-edged square lake, because the city sits on an exactly flat square in `terrain.ts`.
- **The moon's real phase,** and buildings lifting higher or shedding debris (milestone C's "still differs" list).
- **Render time:** the margin is small, 112 of 123 s; re-time on a quiet machine after each world change.

## 5. Only on the dev laptop (not in git)
`out/` (sheets, stills, sweep scripts) and `output/` (plans and videos) are gitignored. Copy them across if you want them; every one can be regenerated with the commands in the phase documents. The ones referenced most:
- **The reference comparisons:** `out/phase7-gate/v2/gate-gravity.png` and `gate-toilets.png`.
- **The reactions:** `out/react-check/`, `out/reactB-crack/`, `out/reactB-dark/`, `out/reactC-buildings/final/`, `out/reactC-water-snow/`.
- **Nights, street and camera:** `out/night/`, `out/street-pass/`, `out/agentCAM2-stills/`, `out/agentCAM3-stills/`, `out/camera-react/sheet.png`.
- **The milestone videos and reports:** `output/milestone-*/`, `output/milestone/report.md`.
