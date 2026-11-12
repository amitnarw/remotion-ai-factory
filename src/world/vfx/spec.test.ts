import { test } from "node:test";
import assert from "node:assert/strict";
import { anchorTable } from "../actors/script";
import { MAX_SCENE_VFX, placeEffects, sceneVfx, specEffects, VfxSpecSchema } from "./spec";
import { effectClock, flashAt } from "./VfxLayer";
import { familyPreset } from "./families";

test("vfx spec: none listed, none drawn; a malformed list draws none (never a guess)", () => {
  assert.deepEqual(sceneVfx({}), []);
  assert.deepEqual(sceneVfx(undefined), []);
  assert.deepEqual(sceneVfx({ vfx: [] }), []);
  assert.deepEqual(sceneVfx({ vfx: [{ kind: "nuke", t: 1 }] }), []);
  assert.deepEqual(sceneVfx({ vfx: [{ kind: "fire", t: -1 }] }), []);
  assert.deepEqual(sceneVfx({ vfx: Array.from({ length: MAX_SCENE_VFX + 1 }, () => ({ kind: "fire", t: 1 })) }), []);
  const ok = sceneVfx({ vfx: [{ kind: "explosion", t: 4.5, where: "plaza", scale: 1.5 }] });
  assert.equal(ok.length, 1);
  assert.equal(ok[0].kind, "explosion");
  assert.ok(VfxSpecSchema.safeParse({ kind: "magic", t: 0, palette: "frost", offset: [1, 0, -2] }).success);
});

test("vfx spec: effects on the scene's clock; a loop opening the scene is already burning", () => {
  const scene = { from: 10 };
  const list = specEffects(
    [
      { kind: "fire", t: 10, duration: 8, where: "avenue" },
      { kind: "explosion", t: 12.5, palette: "plasma" },
      { kind: "magic", t: 14, palette: "not-a-palette" },
    ],
    scene,
  );
  assert.deepEqual(list.map((e) => [e.family, e.start, e.duration, e.warm, e.palette]), [
    ["fire", 10, 8, true, undefined],
    ["explosion", 12.5, undefined, false, "plasma"],
    ["magic", 14, undefined, false, undefined],
  ]);
  // A bullet time's world clock (here: half speed after 12 s) moves the start and stretches the duration.
  const clock = (t: number) => (t < 12 ? t : 12 + (t - 12) / 2);
  const slow = specEffects([{ kind: "fire", t: 13, duration: 4 }], scene, clock);
  assert.equal(slow[0].start, 12.5);
  assert.equal(slow[0].duration, 2);
});

test("vfx spec: placed on the city's spots, moved by the offset, on the ground; distinct seeds", () => {
  const anchors = anchorTable({ plaza: { pos: [100, 0.18, -40] }, avenue: { pos: [0, 0.12, 0] } }, (x) => (x > 50 ? 0.18 : 0.12));
  const placed = placeEffects(
    [
      { family: "fire", spot: "plaza", offset: [2, 0, 3], start: 0 },
      { family: "smoke", spot: "no-such-spot", start: 0 },
      { family: "impact", start: 1 },
      { family: "magic", at: [5, 2, 5], start: 2 },
      { family: "fire", spot: "avenue", offset: [3, 0.5, 0], start: 0 },
    ],
    anchors,
    "paris",
  );
  assert.deepEqual(placed[0].at, [102, 0.18, -37]);
  // An unknown or missing spot falls back to the plaza (here there is one).
  assert.deepEqual(placed[1].at, [100, 0.18, -40]);
  assert.deepEqual(placed[2].at, [100, 0.18, -40]);
  // A position is kept as given.
  assert.deepEqual(placed[3].at, [5, 2, 5]);
  // On the ground under the moved point, plus the offset's height.
  assert.deepEqual(placed[4].at, [3, 0.62, 0]);
  assert.equal(new Set(placed.map((p) => p.seed)).size, placed.length);
  // Without a plaza: the avenue; without anchors: the origin.
  const noPlaza = anchorTable({ avenue: { pos: [0, 0.12, 0] } });
  assert.deepEqual(placeEffects([{ family: "fire", spot: "plaza", start: 0 }], noPlaza, "x")[0].at, [0, 0.12, 0]);
  assert.deepEqual(placeEffects([{ family: "fire", start: 0 }], null, "x")[0].at, [0, 0, 0]);
});

test("vfx layer: an effect's clock, a warm loop ahead by its warm-up; the flash light takes the brightest", () => {
  const fire = familyPreset("fire");
  const warm = { family: "fire" as const, at: [0, 0, 0] as [number, number, number], start: 10, duration: 5, warm: true, seed: "a" };
  assert.deepEqual(effectClock(warm, fire, 10), { time: fire.warmup, emitFor: 5 + fire.warmup });
  assert.deepEqual(effectClock({ ...warm, warm: false }, fire, 12), { time: 2, emitFor: 5 });
  const boom = { family: "explosion" as const, at: [20, 0, 0] as [number, number, number], start: 11, seed: "b" };
  const ex = familyPreset("explosion").light!;
  // At the explosion's peak it outshines the fire; long after, the fire holds the light; before both, none.
  const peak = flashAt([warm, boom], 11 + ex.attack);
  assert.equal(peak?.colour, ex.colour);
  assert.equal(peak?.intensity, ex.peak);
  assert.deepEqual(peak?.at, [20, ex.lift, 0]);
  assert.equal(flashAt([warm, boom], 13)?.colour, fire.light!.colour);
  assert.equal(flashAt([{ ...warm, warm: false }, boom], 5)?.intensity, 0);
  // Scaled: brighter by the square, farther by the scale.
  const big = flashAt([{ ...boom, scale: 2 }], 11 + ex.attack);
  assert.equal(big?.intensity, 4 * ex.peak);
  assert.equal(big?.range, 2 * ex.range);
  assert.equal(flashAt([{ family: "smoke", at: [0, 0, 0], start: 0, seed: "s" }], 3), null);
});

test("vfx spec: the director's block names every family and palette; each family's hit is a sound name or none", async () => {
  const { VFX_FAMILIES, VFX_PALETTES } = await import("./families");
  const { BUILT_IN_SOUND_QUERY } = await import("../../generator/audio-resolve");
  const { vfxForPrompt, VFX_SOUND } = await import("./spec");
  const block = vfxForPrompt();
  for (const k of VFX_FAMILIES) {
    assert.ok(block.includes(k), k);
    for (const p of VFX_PALETTES[k]) assert.ok(block.includes(p), `${k} ${p}`);
    const hit = VFX_SOUND[k];
    if (hit !== null) assert.ok(hit in BUILT_IN_SOUND_QUERY, `${k}: ${hit}`);
  }
  assert.equal(block.split("\n").length, 4);
});
