# AI Video Factory — Instructions

## The 30-second version

```bash
npm install          # one-time
npm run setup        # one-time (builds the SFX library)
npm run generate -- "What if gravity disappeared for just 5 seconds?"
```

Upload `output/whatif-*.mp4` directly to YouTube Shorts. Done.

## What "change nothing" means

You do not:
- edit timelines or keyframes
- mix audio or place SFX
- write animation code
- touch ffmpeg or Chrome settings

You only:
1. Pick a premise
2. Run `npm run generate -- "<premise>"`
3. Upload the MP4

Every frame, caption, timer value, and sound effect is computed from the shot
spec, so picture + audio stay locked by construction (`frame = t × fps`).

## Supported premises (run any of these)

```bash
npm run generate -- "What if gravity disappeared for just 5 seconds?"
npm run generate -- "What if time stopped for just 5 seconds?"
npm run generate -- "What if oxygen disappeared for just 5 seconds?"
npm run generate -- "What if water disappeared for just 5 seconds?"
npm run generate -- "What if electrons disappeared for just 5 seconds?"
npm run generate -- "What if the sun never set for 1,000 years?"
```

Want a new scenario type? Add a template to `TEMPLATES` in
`src/generator/generate.ts` (copy the gravity block, change the text/timing).

## Output location

`output/whatif-<slug>-<timestamp>.mp4` — the final upload-ready video.
Next to it: `<slug>-spec.json` (the shot spec) and `<slug>-report.json`
(generation report).

## Troubleshooting

| Problem | Fix |
|---|---|
| `remotion` command not found | Run `npm install` first |
| Render fails on a missing `.wav` | Run `npm run setup` to build the SFX library |
| Black / empty frames | Make sure Chrome Headless Shell downloaded (Remotion does this automatically on first render) |
| `tsx` not found | `npm install` (tsx is a devDependency) |

## Under the hood

The factory is a Remotion project scaffolding from the official
`template-three` (Remotion + React Three Fiber). All Remotion packages are
version-matched (4.0.535). Chrome uses the ANGLE GL renderer (set in
`remotion.config.ts`). Animations are declarative (`useCurrentFrame`), not
`useFrame`, because `<ThreeCanvas>` locks the frameloop to `'never'` during
render — this is what makes every output deterministic and byte-identical
across runs.

## AI-agent operation

This repo is designed to run 100% hands-free through an AI coding agent. The
full agent contract is in `ai/SKILL.md`; shot-spec prompt templates live in
`ai/PROMPTS.md`. An agent can execute `npm run generate -- "<premise>"` end to
end with no human input.
