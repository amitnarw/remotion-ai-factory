# The bundler's project root with one spelling (2026-11-12, written, not checked)

Windows paths are case-insensitive, but the bundler is not: a bundle built from a working directory that starts `c:\` instead of `C:\` renders whole frames differently. Found by the fixes agent on 2026-11-12 (the finding below); the fix was written the same day, then the session stopped: no checks were run, nothing is committed, and this file is its only record in the tree besides the patch.

## The finding (from fixes.md at `50d5570`, dropped by its later rewrite, kept here)
- **A bundle made from a lowercase drive letter renders differently** (`src/generator/render/bundle.ts`): the fixes agent's first bundle (`out/agentFIXES/b-head`, cwd `c:\...` from that session's shell) was 1.4 MB larger than one of the same tree from `C:\...` (`b-head2`; `index.html`'s `remotion_cwd` shows the case), and its frames differed over the whole picture (a stronger haze, the fountain's water darker: 2 million px, up to 158 levels). **Rspack resolves some modules twice when the path's case differs.** `ensureBundle` bundles `join(process.cwd(), "src", "index.ts")` (today at `entryPoint: join(root, "src", "index.ts")`, `bundle.ts`), and `generate.ts`'s `BUNDLE_SRC` (the Remotion CLI's own bundle step) is the same shape, so a CLI run from a shell whose cwd is `c:\...` could render such a video; VS Code starts the process with either spelling. Every other agent's bundle checked that day (brand, VFX, determinism) was `C:`.
- The before pair (`b-head`/`b-head2`) was deleted with the fixes agent's other bundles; rebuild the same way if it is ever needed (a bundle from a lowercase-cwd shell against one from `C:\`).
- The scratchpad's bundle scripts die with their sessions; a new one should take its root from `projectRoot()` too.

## What is written (uncommitted on `dev`, also as the patch below)
- **New `src/generator/render/root.ts`** (untracked): `canonicalPath(p)` (a lowercase Windows drive letter upper-cased, any other path as it is) and `projectRoot()` (`canonicalPath(process.cwd())`).
- **New `src/generator/render/root.test.ts`** (untracked): one test over both spellings, a forward-slash path and a relative path.
- **`src/generator/generate.ts`** (modified): `BUNDLE_SRC` and `freshBundle`'s `out` folder and `public` junction now from `projectRoot()` instead of `process.cwd()`.
- **`src/generator/render/bundle.ts`** (modified): `BUNDLES_DIR` and `sourceHash`'s default root from `projectRoot()`; `ensureBundle` takes `canonicalPath(opts.root ?? process.cwd())`, so the entry point, the bundle hash and the `public` junction take one spelling whatever the shell's cwd was.

## What is left
1. The checks (HANDOFF §1) — `npx tsc --noEmit`, `npm test`, `npx eslint src server`, `npm run ui:build`, `node scripts/check-ui-icons.mjs` — on a clean check worktree holding only these files (the vfx-director agent's files are uncommitted in the same tree; HANDOFF §1 says how).
2. `src/generator/render/index.ts:86` (`const root = process.cwd()`): it feeds `publicDir`, `out` and `chunksDir`, and `publicDir` feeds `visualManifest` and the chunk hasher. `visualManifest`'s lines are `relative()` to `publicDir`, so the spelling probably cancels — check before changing: a change that moves the manifest or the hasher changes chunk keys and re-renders everything. If the reading is clean, leave it; if not, canonicalize it with a test.
3. Optional proof, if cheap: the same tree bundled from a `c:\` shell and a `C:\` shell now gives the same bundle hash (the unit test plus the code reading may be enough; the bug's shape is a module resolved twice, so the hash is the fast check).
4. Commit by file name: `src/generator/render/root.ts`, `root.test.ts`, `generate.ts`, `bundle.ts`; update this file; delete the patch below.
5. A line in `16-code-map-pipeline.md`'s render section: every bundler path comes from `render/root.ts`.

## For the other machine
The edits are committed as [wip/2026-11-12-render-root-path.patch](../wip/2026-11-12-render-root-path.patch): `git apply docs/factory/wip/2026-11-12-render-root-path.patch`, then continue from "What is left" (delete the patch once the work is committed).
