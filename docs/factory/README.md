# Cinematic Factory Rebuild — Start Here

This folder holds everything about rebuilding the factory: the analysis, the research, the plan and the current progress. It's written so you can pick the work up on any machine.

| File | What's in it |
|---|---|
| [PROGRESS.md](PROGRESS.md) | **Read first.** Current status, what was done last, the exact next step, machine setup |
| [01-analysis.md](01-analysis.md) | Why the current output is bad: findings by layer with file references |
| [02-prior-art.md](02-prior-art.md) | Existing products and repos we checked, and what we borrow from them |
| [03-audio-sources.md](03-audio-sources.md) | Verified CC0 sound-effect and music sources, with download URLs and caveats |
| [04-codebase-map.md](04-codebase-map.md) | How the code works today: stages, cameras, anchors, UI/server routes, known bugs |
| [05-plan.md](05-plan.md) | The agreed phased plan (6 milestones) |
| [06-world-engine.md](06-world-engine.md) | The one-world engine: research, what is built, measurements, setup |
| [09-phase4.md](09-phase4.md) | Phase 4 (editor + fast re-render): status, files, pending steps, how to resume |
| [07-milestone2-visual-review.md](07-milestone2-visual-review.md) | What the milestone 2 frames get wrong, ranked, with fixes (input for Phase 3) |
| [decisions.md](decisions.md) | Decisions the user made, with dates |

## How to resume on another laptop
1. `git pull`
2. Open [PROGRESS.md](PROGRESS.md) and do the "Next step".
3. When you finish a step, update PROGRESS.md (tick it off and write the new next step) and commit, so the other machine stays in sync.

If you're working with Claude Code, tell it: *"Read docs/factory/README.md and PROGRESS.md, then continue from the next step."*
