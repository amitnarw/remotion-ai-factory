# Cinematic Factory Rebuild — Start Here

This folder holds everything about rebuilding the factory: the analysis, the research, the plan and the current progress. It's written so you can pick the work up on any machine.

## Read first
| File | What's in it |
|---|---|
| [HANDOFF.md](HANDOFF.md) | **Start here:** the standing rules for every AI session, where things stand, and the first steps on the GPU machine |
| [PROGRESS.md](PROGRESS.md) | Current status of every phase, the next steps, machine setup, known limits, and the session log |
| [05-plan.md](05-plan.md) | The agreed plan: 7 phases, each ending in a milestone the user reviews |
| [decisions.md](decisions.md) | Decisions the user made, with dates |

## Background (written before the build)
| File | What's in it |
|---|---|
| [01-analysis.md](01-analysis.md) | Why the original output was bad: findings by layer, with file references |
| [02-prior-art.md](02-prior-art.md) | Existing products and repos we checked, and what we borrow from them |
| [03-audio-sources.md](03-audio-sources.md) | Verified CC0 sound and music sources, with download URLs and caveats |
| [04-codebase-map.md](04-codebase-map.md) | How the code was organised when the rebuild started (stages, cameras, UI/server routes) |

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
| [quality-refs/](quality-refs/README.md) | Phase 7: the 8 reference frames that set the quality bar, and both comparisons with them |

## How to resume on another machine
1. Get the latest code: `git pull` on the `dev` branch (or copy the folder).
2. Follow **Setting up a new machine** in the repo [README](../../README.md) (packages, sound library, 3D models, world assets, voices, keys).
3. Read [HANDOFF.md](HANDOFF.md) (rules and first steps), then [PROGRESS.md](PROGRESS.md), and pick up the next steps.
4. When you finish something, update PROGRESS.md (tick it off and write the new next step) and commit, so the other machine stays in sync.

If you're working with Claude Code, tell it: *"Read docs/factory/HANDOFF.md and PROGRESS.md, then continue from the next step."*
