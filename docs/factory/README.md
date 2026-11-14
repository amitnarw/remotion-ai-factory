# Cinematic Factory Rebuild — Start Here

This folder holds everything about rebuilding the factory: the analysis, the research, the plan and the current progress. It's written so you can pick the work up on any machine.

## Read first
| File | What's in it |
|---|---|
| [HANDOFF.md](HANDOFF.md) | **Start here:** the standing rules for every AI session, exactly where the work stopped (2026-11-04), the next steps on the dev laptop and on the GPU machine |
| [00-overview.md](00-overview.md) | **The whole factory on one page:** what it does, how a video gets made, how a frame is built, and a feature index (files, design doc, tests, state) |
| [PROGRESS.md](PROGRESS.md) | Current status of every phase, the next steps, machine setup, known limits, and the session log |
| [16-code-map-pipeline.md](16-code-map-pipeline.md), [17-code-map-world.md](17-code-map-world.md) | Every file, how to change things safely, and the gotchas (see the table below) |
| [05-plan.md](05-plan.md) | The agreed plan: 7 phases, each ending in a milestone the user reviews |
| [decisions.md](decisions.md) | Decisions the user made, with dates |

## Background (written before the build)
| File | What's in it |
|---|---|
| [01-analysis.md](01-analysis.md) | Why the original output was bad: findings by layer, with file references |
| [02-prior-art.md](02-prior-art.md) | Existing products and repos we checked, and what we borrow from them |
| [03-audio-sources.md](03-audio-sources.md) | Verified CC0 sound and music sources, with download URLs and caveats |
| [04-codebase-map.md](04-codebase-map.md) | History only: how the code was organised when the rebuild started (2026-10-22). The current maps are 16 and 17 |

## One document per phase
| File | Phase |
|---|---|
| [07-milestone2-visual-review.md](07-milestone2-visual-review.md) | Phase 2 → 3: what the milestone 2 frames got wrong, ranked, with fixes |
| [08-phase3-research.md](08-phase3-research.md) | Phase 3: research on camera, transitions, safe areas, the look and vision QA, and the build order |
| [09-phase3-handoff.md](09-phase3-handoff.md) | Phase 3: what is done and what is left |
| [09-phase4.md](09-phase4.md) | Phase 4: the editor and the chunked fast re-render |
| [09-phase5.md](09-phase5.md) | Phase 5: characters (actors) and atmosphere |
| [06-world-engine.md](06-world-engine.md) | Phase 6: the one-world engine (places, flights, catalog, streets, terrain) |
| [10-intent-audit.md](10-intent-audit.md) | The rule that everything on screen is chosen by the AI on purpose, and the audit that applied it |
| [11-world-reactions.md](11-world-reactions.md) | Phase 6 step 5: places that react to the story (lift, confetti, money, cracks, lights out, floods, snow, buildings), milestones A to C |
| [12-traffic.md](12-traffic.md) | Phase 6 step 3: traffic in the world cities (lane-graph simulation, junctions, signals, the lens rules) |
| [13-light-and-time.md](13-light-and-time.md) | Phase 6 step 4: the city lights up through dusk, and the time-lapse |
| [14-bullet-time.md](14-bullet-time.md) | Bullet time (the world slows or freezes while the camera moves, projectiles, the dodge, slowed sound) and an original test scene that uses every feature: the design, and its Status as built (2026-11-04) |
| [15-producer.md](15-producer.md) | One tool for every genre (the producer, story modes, breakdown, inventory, asking and downloading what is missing, channel profiles): the design, and §11-13 as built for P1 to P4 |
| [16-code-map-pipeline.md](16-code-map-pipeline.md) | Code map, pipeline side: premise to MP4, the spec, every file, commands and settings, how-to recipes, gotchas |
| [17-code-map-world.md](17-code-map-world.md) | Code map, world and render side: how a frame is built, every file, how-to recipes, verification practice, gotchas |
| [18-world-weather.md](18-world-weather.md) | Rain, snow, storms and lightning in the real places and on flights, river and ocean water events, the rain bed and storm thunder |
| [19-model-sets.md](19-model-sets.md) | Model sets: one catalog model (a ship, a lighthouse) staged as a whole scene |
| [20-publish.md](20-publish.md) | The publish pack per video: titles, description with chapters and credits, tags, thumbnail |
| [21-vfx-effekseer.md](21-vfx-effekseer.md) | Research: Effekseer and other particle engines against our own closed-form VFX; the recommendation and a build plan |
| [22-motion-system-comparison.md](22-motion-system-comparison.md) | An automated motion-design system (a post the user shared) compared with the factory; what we borrow, what we leave, the 16-tool list tool by tool |
| [wip/](wip/) | Patches of unfinished changes (see HANDOFF §2); delete each once its work is committed |
| [quality-refs/](quality-refs/README.md) | Phase 7: the 8 reference frames that set the quality bar, and both comparisons with them |

## How to resume on another machine
1. Get the latest code: `git pull` on the `dev` branch (or copy the folder).
2. Follow **Setting up a new machine** in the repo [README](../../README.md) (packages, sound library, 3D models, world assets, voices, keys).
3. Read [HANDOFF.md](HANDOFF.md) (rules, where the work stopped, next steps), then [00-overview.md](00-overview.md), and pick up the next steps.
4. When you finish something, update HANDOFF.md §2-3 and PROGRESS.md (tick it off and write the new next step) and commit, so the other machine stays in sync.

If you're working with Claude Code or another AI model, tell it: *"Read docs/factory/HANDOFF.md and docs/factory/00-overview.md, follow the rules in HANDOFF §1, then continue from HANDOFF §3."*
