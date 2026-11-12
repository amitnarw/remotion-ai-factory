# Done. VFX agent: status (2026-11-05)

Research only, no code. The answer is in [21-vfx-effekseer.md](../21-vfx-effekseer.md): build our own closed-form VFX layer. Borrow Effekseer's parameter model and its CC0 sample effects, baked offline to flipbooks. Keep the Effekseer runtime out of the render.

## Task
Should the factory use Effekseer (its WebGL runtime) for stylized VFX (explosions, magic, smoke, sparks, impacts), or grow our own closed-form particles? To find out, with sources:
- the licences;
- the WebGL runtime and its three.js integration;
- determinism: seek to t, the cost of stepping, seeded randomness;
- content;
- the alternatives: three.quarks, three-nebula, our own.

Then a recommendation, with a build plan.

Files owned: `docs/factory/21-vfx-effekseer.md`, this file.

## Committed
- (this commit) `21-vfx-effekseer.md` and this file.

## Findings (details and sources in 21)
- **Licences.**
  - Runtime, editor and WebGL build: MIT.
  - Effekseer's sample page: "Almost all effects are distributed under CC-0 License" (about 300 effects). Each collection's own readme still decides.
  - The "Old" sample set is Effekseer-only: never.
- **Runtime.**
  - Active: 1.80.8 on 2026-10-30; the WebGL zip is 3.0 MB.
  - A three.js sample exists.
  - It draws with raw GL outside three: no fog or patches, a colour-space mismatch, and it needs a custom pass in the composer.
- **Determinism: the reason not to adopt.**
  - It can't show time t: `setFrame` replays in 1-frame steps (60 a second), backward from frame 0.
  - The seed defaults to C `rand()`. Only the effect file's Global seed is safe.
  - Material time, the update remainder and maybe the pool draw order are per-tab state.
  - One-shots of 3 s or less are affordable to re-step. Whole-video loops are not (6-61 min of CPU for a 90 s loop, at an assumed 0.05-0.5 ms a step; not measured).
- **The other libraries.**
  - three.quarks: `Math.random`, integrates by delta, and 0.17 needs three ≥ 0.182.
  - three-nebula 13.x: seeded and fixed-step, but still stepped, with no content.

## Uncommitted
- Nothing.

## Next
- For the user: choose. Our own build is about 9 days (21 §6). Otherwise, a one-day Effekseer spike (21 §6, last part) before any adoption.

## Worktree and outputs
- None.

## Findings for others
- None.
