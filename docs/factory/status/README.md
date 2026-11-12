# Live status of the agents at work

Each agent working in this repo keeps one file here, `status/<agent>.md`, and commits it together with every code commit, so a session that ends mid-task loses nothing: the next session reads these files and continues each task from its last line.

A status file holds:
- **Task:** what the agent was asked to do, and the files it owns.
- **Committed:** each step done, with its commit hash.
- **Uncommitted:** files edited but not yet committed (they are in the dev laptop's tree; `git diff <file>` shows them), and why.
- **Next:** the exact next step.
- **Worktree and outputs:** the check worktree next to the repo (remove it the safe way, HANDOFF §1) and the `out/` folder with its renders.
- **Findings for others:** anything that needs another owner's file.

When a task is finished, its file says "Done" at the top, and the coordinator folds it into [HANDOFF.md](../HANDOFF.md) and [00-overview.md](../00-overview.md).
