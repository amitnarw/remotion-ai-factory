import { test } from "node:test";
import assert from "node:assert/strict";
import { curveAt, DISSOLVE_SPREAD, loopCount, vfxParticleAt, vfxUniformValues, type EmitterParams, type Vec3 } from "./emitter";
import { effectLength, familyPreset, flashIntensity, VFX_FAMILIES, VFX_PALETTES, type FamilyPreset } from "./families";

const AT: Vec3 = [-40, 0.18, 12];
const FAR: Vec3 = [AT[0] + 60, 30, AT[2] + 60];
const all = (): FamilyPreset[] => VFX_FAMILIES.flatMap((f) => VFX_PALETTES[f].map((p) => familyPreset(f, p)));

/** How much of a particle shows at an age (0..1): its size against its largest, times what is left of it. */
function presence(p: EmitterParams, u: number): number {
  const max = Math.max(...p.size.v);
  const size = curveAt(p.size.v, p.size.k, u) / max;
  const a = curveAt(p.alpha.v, p.alpha.k, u);
  // A dissolving mesh or card: the share of it still there; a glow: its opacity.
  const left = p.material === "glow" ? a : Math.min(1, a / (1 - DISSOLVE_SPREAD));
  return size * left;
}

test("vfx families: six, each with its palettes; an unknown palette is the family's first", () => {
  assert.deepEqual([...VFX_FAMILIES], ["explosion", "fire", "smoke", "sparks", "impact", "magic"]);
  for (const f of VFX_FAMILIES) {
    assert.ok(VFX_PALETTES[f].length >= 3, f);
    for (const p of VFX_PALETTES[f]) assert.equal(familyPreset(f, p).palette, p);
    assert.equal(familyPreset(f, "no-such").palette, VFX_PALETTES[f][0]);
    assert.equal(familyPreset(f).palette, VFX_PALETTES[f][0]);
  }
  // Loops: fire, smoke, sparks; one-shots: explosion, impact, magic.
  assert.deepEqual(VFX_FAMILIES.filter((f) => familyPreset(f).loop), ["fire", "smoke", "sparks"]);
});

test("vfx families: a loop's pool holds every particle alive at once; budgets", () => {
  for (const preset of all()) {
    const total = preset.parts.reduce((n, p) => n + p.count, 0);
    assert.ok(total <= 300, `${preset.family}/${preset.palette}: ${total} particles`);
    for (const p of preset.parts) {
      if (p.loop) assert.ok(p.count >= loopCount(p.rate, p.life[1]), `${preset.family}.${p.name}: ${p.count} < ${loopCount(p.rate, p.life[1])}`);
      assert.ok(p.life[0] > 0 && p.life[1] >= p.life[0], `${preset.family}.${p.name} life`);
      assert.ok(new Set(preset.parts.map((x) => x.name)).size === preset.parts.length, "part names differ (their seeds)");
    }
  }
});

test("vfx families: nothing pops - a loop's particle grows in and every particle goes out small or clear", () => {
  for (const preset of all()) {
    for (const p of preset.parts) {
      const tag = `${preset.family}/${preset.palette}.${p.name}`;
      // A one-shot's start is its bang (a flash may open at full size); a loop's births are mid-stream.
      if (p.loop) assert.ok(presence(p, 0) <= 0.3, `${tag} born at ${presence(p, 0).toFixed(2)}`);
      assert.ok(presence(p, 1) <= 0.3, `${tag} dies at ${presence(p, 1).toFixed(2)}`);
    }
  }
});

test("vfx families: every particle stays inside its effect's bounding sphere (scaled too)", () => {
  for (const preset of all()) {
    for (const scale of [1, 2.5]) {
      const r = preset.reach * scale;
      const centre: Vec3 = [AT[0], AT[1] + 0.5 * r, AT[2]];
      const emitFor = preset.loop ? preset.length : preset.length;
      const end = effectLength(preset, emitFor);
      let worst = 0;
      for (const p of preset.parts) {
        for (let t = 0; t <= end; t += 0.1) {
          const u = vfxUniformValues(p, { time: t, at: AT, scale, seed: "bounds", emitFor });
          for (let i = 0; i < u.count; i++) {
            const s = vfxParticleAt(u, i, FAR);
            if (!s.alive) continue;
            const d = Math.hypot(s.pos[0] - centre[0], s.pos[1] - centre[1], s.pos[2] - centre[2]) + 0.5 * s.size;
            worst = Math.max(worst, d / r);
          }
        }
      }
      assert.ok(worst <= 1, `${preset.family}/${preset.palette} at scale ${scale}: ${worst.toFixed(2)} of its reach`);
    }
  }
});

test("vfx families: after its length nothing is alive; before its start nothing", () => {
  for (const preset of all()) {
    const emitFor = preset.loop ? 3 : preset.length;
    const end = effectLength(preset, emitFor);
    for (const p of preset.parts) {
      for (const t of [-0.5, -1e-3, end + 1e-3, end + 5]) {
        const u = vfxUniformValues(p, { time: t, at: AT, scale: 1, seed: "life", emitFor });
        for (let i = 0; i < u.count; i++) assert.equal(vfxParticleAt(u, i, FAR).alive, false, `${preset.family}.${p.name} at ${t}`);
      }
    }
  }
});

test("vfx flash: a closed-form curve - nothing before, a peak, nothing after; a held light flickers while it emits", () => {
  const ex = familyPreset("explosion").light!;
  assert.equal(flashIntensity(ex, -0.01, 0), 0);
  assert.equal(flashIntensity(ex, 0, 0), 0);
  assert.equal(flashIntensity(ex, ex.attack, 0), ex.peak);
  assert.equal(flashIntensity(ex, ex.attack + ex.decay, 0), 0);
  assert.equal(flashIntensity(ex, 9, 0), 0);
  let prev = Infinity;
  for (let t = ex.attack; t <= ex.attack + ex.decay; t += 0.01) {
    const v = flashIntensity(ex, t, 0);
    assert.ok(v <= prev + 1e-9);
    prev = v;
  }
  const fire = familyPreset("fire").light!;
  assert.ok(fire.hold);
  const emit = 6;
  assert.equal(flashIntensity(fire, 0, emit), 0);
  for (let t = fire.fade; t < emit; t += 0.05) {
    const v = flashIntensity(fire, t, emit);
    assert.ok(v >= fire.peak * (1 - fire.flicker) - 1e-9 && v <= fire.peak * (1 + fire.flicker) + 1e-9, `${v} at ${t}`);
  }
  assert.equal(flashIntensity(fire, emit + fire.fade, emit), 0);
  // The same value however it is asked (no state).
  assert.equal(flashIntensity(fire, 3.3, emit), flashIntensity(fire, 3.3, emit));
});
