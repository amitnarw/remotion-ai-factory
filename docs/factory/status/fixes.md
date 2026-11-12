Done (2026-11-12). Items 1-4, 5b and 7 committed; items 5 and 6 traced and timeboxed, not fixed (their next steps below). Worktree `wt-fixes` and the bundles removed.

# fixes: a batch of small open fixes (2026-11-11)

## Task
Seven small open items from HANDOFF §2, in this order, each committed on its own:
1. The editor's playhead runs 1.5 s ahead in a branded video (`ui/src/pages/editor/Timeline.tsx`, the edit in `status/brand.md`).
2. The story checker repeats the claims check at the story gate: drop the checker's claims list when the claims stage ran (`pipeline/checker.ts`).
3. Variants: the editor's caption edits carry into variants; each variant gets its own publish pack (`pipeline/variants.ts`, `src/generator/publish/*`).
4. A sound name for the library's ship creaks, so a model-set ship scene creaks (`audio-resolve.ts`); existing sound plans byte-identical.
5. The street stage still renders some frames two ways under load (money-doubles 9:16 card frame 228; the 7.3-7.8 s stretch): find the cause and fix it; prove it at 1 and 6 tabs, shuffled, under CPU load.
6. The flight's car-light pools on the first frame after a ground loads in a tab (`src/world/TrafficLayer.tsx`).
7. A model-set scene's frame hashes at 2 and 6 tabs and reversed (`ModelSetStage.tsx`); fix if they differ.

Items 5 and 6 are timeboxed to about 30 minutes each.

Files owned: `ui/src/pages/editor/*`; `src/generator/pipeline/{checker,claims,variants,run}.ts` and their tests, `src/generator/publish/*`; `src/generator/audio-resolve.ts`; `src/compositions/{StreetStage,AssetStage,glb,ModelSetStage}.tsx`, `src/compositions/street/*`, `src/compositions/scenes/*`; `src/world/{TrafficLayer,TrafficSignals}.tsx`, `src/world/traffic.ts`; `test-fixtures/pipeline/*`; docs `09-phase3-handoff.md` §4, this file, and the matching lines of the status files closed. Not mine (the VFX agent's): `src/world/Ground.tsx`, `WorldStage.tsx`, `src/world/Root.tsx`, `src/world/react/*`, `src/world/vfx/*`.

## Committed
- `62f637e`, `ceafafc` this file.
- `e4507fc` **item 1, the editor's playhead in a branded video:** `ui/src/pages/editor/Editor.tsx` (the timeline gets the story's length, without the bumpers, and `introFrames`), `Timeline.tsx` (the playhead at `(frame - intro) / fps`, held at 0 in the intro and at the story's end in the outro; a seek adds the intro). Unbranded: intro 0, the same numbers as before.
- `3f84dfd` **item 2, the checker's claims:** `pipeline/checker.ts` (`checkerPrompt(..., { claims: false })` leaves the claims rule and the JSON shape's claims out; `checkStory({ claims: false })` asks with a schema without claims and returns `claims: []`; the default prompt is the one of before), `pipeline/run.ts` (the check stage passes `claims: false` when the claims stage returned a check, and adds `claimsChecked: true` to its inputs only then), `pipeline/resume.test.ts` (claims and checker replies recorded: the gate's check has no claims, the claims check has c1, the prompt asks for none). No recorded reply set has a `checker-1.txt`, so none changes; fixture plans run without the gate (no checker).
- Checks for both on the fresh `wt-fixes` (HEAD + the item's files): tsc 0, eslint 0, ui:build 0, icons clean; `npm test` 913, 911 pass, 1 skipped, 1 fail: `world/clock.test.ts` "only the place's clock provider and the compositions read the frame under src/world" names `vfx/VfxPreview.tsx` (the VFX agent's file, committed in `40dae44`; it fails on HEAD alone).

- `9f9518e` **item 3, variants:** `pipeline/variants.ts` (`carryCaptionEdits`: each of the editor's caption wordings, found on the run's own caption it was written over, goes on the version's caption with the same words, the same occurrence of them; a new hook or ending, or another format's line cut, keeps its own words; entries record `captions: { carried, dropped }` and `edits` (the wording's hash: new wording renders the version again); `makeVariants(..., { publish })`: a rendered version gets its own pack, by default when the run has one), `publish/pack.ts` (`readVariantRun`: the variant's spec with the run's report, brief and `.calls/`; the photographer's stills only when the variant has the run's format and timing "kept"), `publish/index.ts` (`PublishOptions.variant`, `publishDir(id, out, variant)`, the pack's `variant` and `video: "../video.mp4"`), tests (`variants.test.ts`: wording carried 2 of 2 on a hook variant, 1 of 2 on an ending variant, a pack per version with its own hook, nothing re-rendered until the wording changes; `publish.test.ts`: a variant's pack and folder, the still only on the run's frames). Checks: tsc, eslint, ui:build, icons; `npm test` 919, 917 pass, 1 skipped, 1 fail (the VfxPreview one). `status/variants.md`'s line updated.
- `462ee97` **item 4, the creak name:** `audio-resolve.ts` `wood_creak: { kinds: ["sfx"], sets: [["creak"]] }` (the library's `kenney-rpg-audio-creak1..3`, spread by the seed; no synthesized fallback, so on a machine without the library the cue is dropped with a warning, as for any such name); `audio-resolve.test.ts` (the vocabulary hash is today's 29 names, and the 28 of before hash as before; the creak picks). **The five fixture plans byte-identical** (`scratchpad/fixes/plans.mts` on `wt-fixes`: money-doubles e2e01cb546ed, money-doubles-long bb0c4ea6d3a3, oceans-vanish e6ece2c0258e, forest-walks aeb4a8a3ba64, bullet-test 0f517ef11192; their sound.json too). Checks: tsc, eslint, ui:build, icons; `npm test` 924, 922 pass, 1 skipped, 1 fail (the VfxPreview one). `status/p6.md`'s line updated.
- `60630ac` **item 5b (added by the coordinator), the bullet-time video's last scene:** WorldStage keeps one GroundWorld through the video's last two Paris scenes (16:50, then a 17:00 lapse). `ReactionParticles` built its layer once and applied the `patch` (height fog, mood palette) only when `patchKey` changed, so after scene 2 the chips lying on the ground kept scene 2's fixed fog uniforms, not the lapse's live ones (up to 8 levels on the chips only). Now a layer is rebuilt when its patch changes (GroundWorld memoizes it per scene; the program cache key is unchanged, so no new compile): `react/ReactionParticles.tsx`, `SlabReaction.tsx`, `waterLayer.tsx`; docs 09 §4 and the lines of `status/{vfx2,brand,determinism,p6}.md`.
  - Before (HEAD bundle): 1001 after 600 in one tab `7a64176`, alone `7c71cad`. After: 1001 after 600 = alone = `7c71cad` (= the VFX agent's "alone" frame); 600, and 1001, 1002, 1005 alone, the same as on HEAD (fresh tabs unchanged).
  - Proof (`out/agentFIXES/hash-bp-*.txt`), frames 1000-1029 under 10 busy CPU threads: 6 tabs, 1 tab, one fresh tab per frame in a shuffled order: 30 of 30 the same; after 600-999 in the same tabs at 6 tabs (every 3rd frame from 600, every 4th from 601): the 18 frames of 1000-1029 they reach equal the fresh ones.
  - Checks on a fresh `wt-fixes` (`d5b0eaf` + the three files): tsc 0, eslint 0, `npm test` 929, 928 pass, 1 skipped, 0 fail; ui:build 0; icons clean.
- **Item 7, a model-set scene's frame hashes:** the P6 agent's specs (`out/agentP6/specs/`), the ship at golden hour (frames 120-149, the sailor walking) and the lighthouse at night (200-229), at 2 tabs, 6 tabs and in groups of 1-4 fresh tabs in reverse order (`hash-m-*.txt`): 60 of 60 the same. Nothing to fix (`status/p6.md` line, in `60630ac`).

## Not fixed (timeboxed)
- **Item 5, the street stage: not the street stage; the card HUD's raster.** Three passes of the money-doubles 9:16 card case (every 3rd frame of 0-449, 4 tabs, under load; `hash-g1..3.txt`) differ by 7 to 9 frames pass to pass, and every difference is in the card HUD: a 1-level band along the timer card's top shadow (x 145-482, y 529-558; frames 165-237), and in one pass the timer card drawn whole at frames 363, 369 and 378, after the timer ended (at 363 it reads 0:08.500, frame 345's value; `out/agentFIXES/evidence/g2-money-card-0363.png`). The 3D picture is the same in every pass, and 210-240 alone at 1 or 6 tabs, shuffled or in groups, gives one answer. So Chrome sometimes captures the HUD's DOM layer (it overlaps the WebGL canvas) from an older or other raster. Ruled out: the street stage (its pixels never differ); the cards' `transform: scale(0.9)`: sized by CSS `zoom` instead (as the brand's logo fix did with sizes), three more passes still differ in the same band on 2 to 8 frames (`hash-z1..3.txt`), so it is reverted.
  - Next (HUD or render owner): the shadow alone (the 44 px blur over the canvas) without it, or the cards drawn into the canvas; a capture that waits for Chrome's raster (a render option, `src/generator/render/*`); then the stale whole card, which no HUD change explains. Prove with `scratchpad/fixes/hash.mts --fn full --only money-card --nth 3 --concurrency 4`, three passes under `burn.mjs`.
- **Item 6, the flight's car-light pools: still open.** Reproduced on HEAD with the Paris money video: frame 675 alone has headlight pools on Cairo's avenue (`9866def`, `evidence/p-b-head2-alone-pools-0675.png`), after 674 or 660 in the same tab none (`b9de665`). Candidate (b) of `status/determinism.md`, the pools in the opaque list after the road (`transparent: false`, additive blending kept, `renderOrder` 1), changes nothing (the same two hashes in all three cases), so it was not kept. The depth buffer the pools meet in a tab's later frames holds something nearer than the road (determinism's GREATER test), drawn in those frames only.
  - Next: log the scene's draws in frames 674 and 675 of one tab with each object's `depthWrite`, `colorWrite` and `renderOrder`, opaque and transparent, and look for one skipped on a ground's first frame (an object made visible or given its geometry in a frame callback; a cloud or fog plane of the flight). The determinism agent's opaque test drew the pools with no blending; with additive blending the depth test is the same, so their pass there needs a second look.

## Outputs
- `out/agentFIXES/`: hashes `hash-*.txt` (`bp`/`bt` the bullet video, `p` the pools, `g`/`z` the street card case on HEAD and with zoom cards, `m` the model sets; `f`/`s` were on the bad bundle below) and eight PNGs in `evidence/`. Bundles and the other PNGs deleted (`public` junctions removed first).
- Scripts in `scratchpad/fixes/`: `hash.mts` (`--mode range|single|groups|reverse`, `--nth`, `--frames`), `cases.mts`, `bundle.mts`, `burn.mjs` (CPU load), `plans.mts` (fixture plan hashes), `pixdiff.py`, `check.sh`.
- Worktree `wt-fixes`: removed (its junctions first).

## For the assembler's owner (the VFX director agent): a ship's creaks (taken in `7ada21c`)
`src/generator/pipeline/assemble.ts`, beside `effectHits` (it uses `modelSetDef`, already imported), and called after `events.push(...effectHits(scenes, flights, warnings));`:
```ts
/** A ship model set creaks (19-model-sets.md): its hull and rigging, every few
 *  seconds (4.5, 3.5, 5.5 s in turn) from 1.5 s into the scene, none in its
 *  last second. Each creak is its own event, so the resolver's seed picks
 *  among the library's creaks (audio-resolve.ts wood_creak). */
function shipCreaks(scenes: Scene[]): NonNullable<ShotSpec["events"]> {
  const out: NonNullable<ShotSpec["events"]> = [];
  for (const sc of scenes) {
    if (sc.kit !== "model-set" || !sc.modelSet || modelSetDef(sc.modelSet.model)?.kind !== "ship") continue;
    for (let t = sc.from + 1.5, n = 0; t < sc.to - 1; t += [4.5, 3.5, 5.5][n % 3], n++) {
      out.push({ t: r3(t), name: `creak-${r3(sc.from)}-${n + 1}`, targets: [], sfx: [{ tag: "wood_creak" }] });
    }
  }
  return out;
}
// ...
events.push(...shipCreaks(scenes));
```
Videos without a ship set get no event, so their plans stay byte-identical.

## Uncommitted
- Nothing.

The drive-letter finding ("a bundle made from a lowercase drive letter renders differently", in this file's Findings for others at `50d5570`, dropped by the rewrite of 2026-11-12) is recorded with its fix in [root-path.md](root-path.md).
