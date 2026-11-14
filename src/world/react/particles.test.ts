import { test } from "node:test";
import assert from "node:assert/strict";
import { ShaderLib } from "three";
import { DROP_LAND_MAX, DROP_SPEED_MAX, heldLand, type Vec3 } from "./lift";
import {
  chipReleases,
  NEVER,
  PARTICLE_BUDGET,
  REACTION_PARTICLES,
  SCENE_PARTICLE_BUDGET,
  PARTICLE_HEADER,
  PARTICLE_KINDS,
  particleAt,
  particleSeeds,
  particleUniformValues,
  particleVertexShader,
  seedsOf,
  UNIFORM_NAMES,
  type ParticleKind,
} from "./particles";
import { PREVIEW_BEATS, syntheticBursts, syntheticLevel } from "./synthetic";
import { levelOf, levelTrack, MAX_BURSTS } from "./track";

const KINDS: ParticleKind[] = ["confetti", "notes", "chips"];
const EPI: Vec3 = [-299.1, 0.18, -64.4];
const WIDE: Vec3 = [EPI[0] + 14, 9, EPI[2] + 18];
const bursts = syntheticBursts(PREVIEW_BEATS);
const track = levelTrack(syntheticLevel(PREVIEW_BEATS), 0, 40);

/** Every particle of a kind at time t (the shader's formula, in TypeScript). */
function frame(kind: ParticleKind, t: number, camera: Vec3, opts: { bursts?: typeof bursts; ambient?: number; withTrack?: boolean } = {}) {
  const look = PARTICLE_KINDS[kind];
  const seeds = particleSeeds("paris", kind, look.count);
  const rel = chipReleases(seeds, look.count, opts.withTrack ? track : null, look.chipRadius);
  const u = particleUniformValues(look, { time: t, epi: EPI, bursts: opts.bursts, ambient: opts.ambient });
  return Array.from({ length: look.count }, (_, i) => ({
    seeds: seedsOf(seeds, i),
    state: particleAt(u, seedsOf(seeds, i), [rel[4 * i], rel[4 * i + 1], rel[4 * i + 2], rel[4 * i + 3]], camera),
  }));
}

test("particles: counts within the §5 budget, one draw call per kind", () => {
  // §5: confetti or banknotes up to 6,000 and chips 2,000 per scene. A
  // scene has one counter reaction, so a lift scene's chips may use the
  // confetti it doesn't draw: the scene total stays inside the table.
  assert.ok(PARTICLE_BUDGET.confetti <= 6000 && PARTICLE_BUDGET.notes <= 6000);
  assert.ok(PARTICLE_BUDGET.chips <= 4000, `chips: ${PARTICLE_BUDGET.chips}`);
  for (const k of KINDS) assert.ok(PARTICLE_KINDS[k].count <= PARTICLE_BUDGET[k], `${k}: ${PARTICLE_KINDS[k].count}`);
  for (const [react, kinds] of Object.entries(REACTION_PARTICLES)) {
    const total = kinds.reduce((n, k) => n + PARTICLE_KINDS[k].count, 0);
    assert.ok(total <= SCENE_PARTICLE_BUDGET, `${react}: ${total} particles per scene`);
  }
});

test("particles: the defaults draw nothing (no bursts, no ambient, no lift)", () => {
  for (const kind of KINDS) {
    for (const t of [0, 1, 3.2, 8, 30]) {
      const drawn = frame(kind, t, WIDE).filter((p) => p.state.scale > 0).length;
      assert.equal(drawn, 0, `${kind} at ${t} s`);
    }
  }
});

test("particles: seeds come from the place and the kind only", () => {
  const a = particleSeeds("paris", "confetti", 100);
  assert.deepEqual(particleSeeds("paris", "confetti", 100), a);
  assert.notDeepEqual(particleSeeds("paris", "notes", 100), a);
  assert.notDeepEqual(particleSeeds("colmar", "confetti", 100), a);
  for (const arr of a) for (const v of arr) assert.ok(v >= 0 && v < 1);
});

for (const kind of ["confetti", "notes"] as const) {
  test(`${kind}: burst particles leave the epicentre at their burst, none before`, () => {
    const look = PARTICLE_KINDS[kind];
    const before = frame(kind, PREVIEW_BEATS[0].t - 0.01, WIDE, { bursts });
    assert.equal(before.filter((p) => p.state.scale > 0).length, 0, "nothing before the first beat");
    // Just after each burst starts, its new particles are at the launch disc.
    for (const b of bursts) {
      const prior = frame(kind, b.t - 0.001, WIDE, { bursts });
      const early = frame(kind, b.t + 0.02, WIDE, { bursts });
      const fresh = early.filter((p, i) => p.state.scale > 0 && prior[i].state.scale === 0 && p.seeds.a[0] >= look.ambientShare);
      assert.ok(fresh.length > 0, `particles leave at ${b.t} s`);
      for (const p of fresh) {
        const r = Math.hypot(p.state.pos[0] - EPI[0], p.state.pos[2] - EPI[2]);
        assert.ok(r < look.launch[1] + look.sway + 0.6, `near the epicentre (${r.toFixed(2)} m)`);
        assert.ok(p.state.pos[1] - EPI[1] < look.launch[0] + 0.7, "at the launch height");
      }
    }
    // Every burst particle is in the air a second after the last burst; more burst, more particles.
    const mid = frame(kind, 3.5, WIDE, { bursts }).filter((p) => p.state.scale > 0).length;
    const late = frame(kind, 6, WIDE, { bursts }).filter((p) => p.state.scale > 0).length;
    assert.ok(late > 1.8 * mid, `${mid} after two beats, ${late} after three`);
  });

  test(`${kind}: they settle flat on the ground and stay`, () => {
    const after = frame(kind, 60, [EPI[0], 500, EPI[2]], { bursts });
    const landed = after.filter((p) => p.state.landed && p.state.scale > 0);
    assert.ok(landed.length > 0.8 * after.filter((p) => p.state.scale > 0).length, "most have landed by a minute");
    for (const p of landed) {
      assert.ok(p.state.pos[1] >= EPI[1] && p.state.pos[1] < EPI[1] + 0.05, "on the ground");
      // The quad's normal (third column) is vertical: flat, either face up (two-sided).
      assert.ok(Math.abs(Math.abs(p.state.rot[5]) - 1) < 1e-6 && Math.abs(p.state.rot[2]) < 1e-3 && Math.abs(p.state.rot[8]) < 1e-3, "flat");
    }
  });
}

test("notes: flutter rocks about ±40° while falling (Andersen et al.)", () => {
  const look = PARTICLE_KINDS.notes;
  assert.ok(Math.abs(look.flutter - (40 * Math.PI) / 180) < 0.05);
  const tilts = frame("notes", 8, WIDE, { bursts })
    .filter((p) => p.state.scale > 0 && !p.state.landed && p.seeds.a[0] >= look.ambientShare)
    .map((p) => Math.acos(Math.min(1, Math.abs(p.state.rot[5]))));
  // Normal's tilt from vertical: within the rock amplitude, and spread over it.
  assert.ok(Math.max(...tilts) <= look.flutter + 1e-6);
  assert.ok(Math.max(...tilts) > 0.8 * look.flutter);
});

test("particles: nothing drawn within 1.5 m of the lens", () => {
  const cams: Vec3[] = [WIDE, [EPI[0], EPI[1] + 1.6, EPI[2] + 6], [EPI[0] + 2, EPI[1] + 6, EPI[2]], [EPI[0] - 3, EPI[1] + 15, EPI[2] + 1]];
  let checked = 0;
  for (const kind of KINDS) {
    const look = PARTICLE_KINDS[kind];
    for (const cam of cams) {
      for (const t of [1.3, 2, 3.3, 5.4, 7, 12]) {
        for (const p of frame(kind, t, cam, { bursts, ambient: levelOf(track, t), withTrack: true })) {
          if (p.state.scale <= 0) continue;
          checked++;
          // The quad's own half-size (the shader's per-particle size).
          const reach = 0.5 * Math.max(...look.size) * (1 + look.sizeJitter * (2 * p.seeds.c[0] - 1));
          const d = Math.hypot(p.state.pos[0] - cam[0], p.state.pos[1] - cam[1], p.state.pos[2] - cam[2]);
          assert.ok(d - reach >= 1.5 - 1e-6, `${kind} at ${t} s is ${d.toFixed(2)} m from the lens`);
        }
      }
    }
  }
  assert.ok(checked > 50000, `${checked} particle-frames checked`);
});

test("ambient: fills the air as each burst's front spreads; the uniform sets its density", () => {
  const look = PARTICLE_KINDS.confetti;
  const ambientOnly = (t: number, a: number, cam: Vec3 = WIDE) =>
    frame("confetti", t, cam, { bursts, ambient: a }).filter((p) => p.state.scale > 0 && p.seeds.a[0] < look.ambientShare);
  // None without bursts, none before the first, none with the uniform at 0.
  assert.equal(frame("confetti", 10, WIDE, { ambient: 1 }).filter((p) => p.state.scale > 0).length, 0);
  assert.equal(ambientOnly(PREVIEW_BEATS[0].t - 0.01, 1).length, 0);
  assert.equal(ambientOnly(10, 0).length, 0);
  // The front reaches further with time: more of the air is filled.
  const early = ambientOnly(PREVIEW_BEATS[2].t + 0.5, 1).length;
  const late = ambientOnly(PREVIEW_BEATS[2].t + 4, 1).length;
  assert.ok(late > 1.5 * early, `${early} at +0.5 s, ${late} at +4 s`);
  // Density follows the uniform.
  const lo = ambientOnly(10, 0.25).length;
  const hi = ambientOnly(10, 1).length;
  assert.ok(hi > 2.5 * lo && lo > 0, `${lo} at a quarter, ${hi} at full`);
  for (const p of ambientOnly(10, 1, [EPI[0] + 30, 20, EPI[2]])) {
    assert.ok(Math.hypot(p.state.pos[0] - EPI[0], p.state.pos[2] - EPI[2]) <= look.radius + 1e-6);
  }
});

/** Every particle of a kind over consecutive 30 fps frames: what changes
 *  between neighbours that should not (the stills can't show it). */
function motionFaults(kind: ParticleKind, opts: { from: number; to: number; count: number; withTrack?: boolean }) {
  const look = PARTICLE_KINDS[kind];
  const seeds = particleSeeds("paris", kind, look.count);
  const rel = chipReleases(seeds, look.count, opts.withTrack ? track : null, look.chipRadius);
  const lookDir: Vec3 = [-18, -6.5, -26];
  const faults: string[] = [];
  let prev: ReturnType<typeof particleAt>[] | null = null;
  for (let f = Math.round(opts.from * 30); f <= Math.round(opts.to * 30); f++) {
    const t = f / 30;
    const u = particleUniformValues(look, { time: t, epi: EPI, bursts: kind === "chips" ? [] : bursts, ambient: kind === "chips" ? 0 : 1 });
    const cur: ReturnType<typeof particleAt>[] = [];
    for (let i = 0; i < opts.count; i++) cur.push(particleAt(u, seedsOf(seeds, i), [rel[4 * i], rel[4 * i + 1], rel[4 * i + 2], rel[4 * i + 3]], WIDE, lookDir));
    if (prev) {
      for (let i = 0; i < opts.count; i++) {
        const a = prev[i];
        const b = cur[i];
        const size = 1 + look.sizeJitter * (2 * seedsOf(seeds, i).c[0] - 1);
        if (Math.abs(b.scale - a.scale) > 0.3 * size) faults.push(`${kind} ${i} pops at ${t.toFixed(3)} s (${a.scale.toFixed(2)} -> ${b.scale.toFixed(2)})`);
        if (a.scale > 0 && b.scale > 0) {
          const jump = Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]);
          if (jump > 2) faults.push(`${kind} ${i} jumps ${jump.toFixed(1)} m at ${t.toFixed(3)} s`);
          const turn = Math.abs(a.rot[2] * b.rot[2] + a.rot[5] * b.rot[5] + a.rot[8] * b.rot[8]);
          if (turn < 0.5) faults.push(`${kind} ${i} snaps at ${t.toFixed(3)} s`);
        }
      }
    }
    prev = cur;
  }
  return faults;
}

for (const kind of KINDS) {
  test(`${kind}: no pops, jumps or snaps between consecutive frames (30 fps)`, () => {
    // Round the 16x beat and into the steady air; landings included.
    const faults = [
      ...motionFaults(kind, { from: PREVIEW_BEATS[2].t - 0.3, to: PREVIEW_BEATS[2].t + 1.5, count: 1500, withTrack: true }),
      ...motionFaults(kind, { from: 16, to: 20, count: 1500, withTrack: true }),
    ];
    assert.deepEqual(faults.slice(0, 5), []);
  });
}

test("chips: lift off with the level, each beat's share within 0.5 s", () => {
  const look = PARTICLE_KINDS.chips;
  const seeds = particleSeeds("paris", "chips", look.count);
  const rel = chipReleases(seeds, look.count, track, look.chipRadius);
  assert.deepEqual(chipReleases(seeds, look.count, track, look.chipRadius), rel, "per scene, deterministic");
  const share = (t: number) => {
    let n = 0;
    for (let i = 0; i < look.count; i++) if (rel[4 * i] <= t) n++;
    return n / look.count;
  };
  let prev = 0;
  for (const beat of PREVIEW_BEATS) {
    const before = share(beat.t - 0.01);
    const after = share(beat.t + 0.5);
    assert.ok(Math.abs(before - prev) < 0.03);
    assert.ok(after - before >= 0.8 * (beat.level - before) - 0.02, `beat ${beat.t}: ${(after - before).toFixed(3)} of ${(beat.level - before).toFixed(3)}`);
    prev = beat.level;
  }
  // Never released without a track.
  const none = chipReleases(seeds, look.count, null, look.chipRadius);
  for (let i = 0; i < look.count; i++) assert.ok(none[4 * i] === NEVER && none[4 * i + 2] === 0 && none[4 * i + 3] === 0);
  // Rising: higher later.
  const h = (t: number) => {
    const ps = frame("chips", t, WIDE, { withTrack: true }).filter((p) => p.state.scale > 0);
    return ps.reduce((s, p) => s + p.state.pos[1], 0) / ps.length;
  };
  assert.ok(h(8) > h(6) + 1);
});

test("shader: one GLSL text for every kind; every uniform declared once", () => {
  const base = ShaderLib.lambert.vertexShader;
  const text = particleVertexShader(base);
  for (const inc of ["#include <uv_vertex>", "#include <color_vertex>", "#include <beginnormal_vertex>", "#include <begin_vertex>"]) {
    assert.ok(base.includes(inc), `Lambert has ${inc}`);
    if (inc !== "#include <uv_vertex>") assert.ok(!text.includes(inc), `${inc} replaced`);
  }
  assert.ok(text.includes("rpParticle(rpPos, rpRot, rpScale);"));
  // The particle call comes before uv_vertex, at the top of main.
  assert.ok(text.indexOf("rpParticle(rpPos") < text.indexOf("#include <uv_vertex>"));
  // Uniforms: the TypeScript table and the GLSL agree.
  const declared = [...PARTICLE_HEADER.matchAll(/uniform\s+\w+\s+(\w+)/g)].map((m) => m[1]);
  assert.equal(new Set(declared).size, declared.length, "no uniform declared twice");
  assert.deepEqual(new Set(declared), new Set([...Object.values(UNIFORM_NAMES), "uRpPalette"]));
  assert.ok(PARTICLE_HEADER.includes(`uRpBurstT[${MAX_BURSTS}]`));
  // No per-kind text: the source has no kind in it, and every kind's
  // uniform values have the same keys.
  for (const k of KINDS) assert.ok(!PARTICLE_HEADER.includes(k));
  const keys = KINDS.map((k) => Object.keys(particleUniformValues(PARTICLE_KINDS[k], { time: 0, epi: EPI })).sort().join());
  assert.equal(new Set(keys).size, 1);
  // No randomness or clock in the shader.
  assert.ok(!/random|uRpFrame|time\(/i.test(PARTICLE_HEADER.replace(/uRpTime/g, "")));
});

test("chips: gravity on drops them from where they are, under gravity or held to DROP_LAND_MAX, with no jump", () => {
  const look = PARTICLE_KINDS.chips;
  const seeds = particleSeeds("paris", "chips", look.count);
  // Six seconds weightless, then gravity back.
  const lift = levelTrack(syntheticLevel([{ t: 1, level: 1 }, { t: 7, level: 0 }]), 0, 16);
  const rel = chipReleases(seeds, look.count, lift, look.chipRadius);
  const at = (i: number, t: number) =>
    particleAt(particleUniformValues(look, { time: t, epi: EPI }), seedsOf(seeds, i), [rel[i * 4], rel[i * 4 + 1], rel[i * 4 + 2], rel[i * 4 + 3]], [0, 1000, 0]);
  let checked = 0;
  let low = 0;
  for (let i = 0; i < look.count; i += 7) {
    const [r0, drop, weight] = [rel[i * 4], rel[i * 4 + 1], rel[i * 4 + 2]];
    if (!(r0 < 7 && drop < NEVER && weight > 0)) continue;
    checked += 1;
    const e = 1e-4;
    const a = at(i, drop - e);
    const b = at(i, drop + e);
    assert.ok(Math.abs(a.pos[1] - b.pos[1]) < 2e-3, "no jump at the drop");
    // Its rising speed carries on at the drop (no stop in mid-air).
    const va = (a.pos[1] - at(i, drop - 2 * e).pos[1]) / e;
    const vb = (at(i, drop + 2 * e).pos[1] - b.pos[1]) / e;
    assert.ok(Math.abs(va - vb) < 0.05, `speed ${va.toFixed(2)} -> ${vb.toFixed(2)} m/s at the drop`);
    // Down within its held time, frame by frame no faster than DROP_SPEED_MAX.
    const h = a.pos[1] - (EPI[1] + look.restLift);
    let prev = a.pos[1];
    let down = NaN;
    for (let f = 1; f <= 30 * 4; f++) {
      const s = at(i, drop + f / 30);
      assert.ok(prev - s.pos[1] <= DROP_SPEED_MAX / 30 + 0.02, `a chip falls ${(prev - s.pos[1]).toFixed(2)} m in a frame`);
      prev = s.pos[1];
      if (s.landed) {
        down = f / 30;
        break;
      }
    }
    assert.ok(down <= heldLand(Math.max(0, h), Math.max(0, va), DROP_LAND_MAX, DROP_SPEED_MAX) + 1 / 30 + 1e-6, `from ${h.toFixed(1)} m: down in ${down} s`);
    // Landed, it lies still: no tumbling or sliding on the ground.
    const l1 = at(i, drop + down + 0.5);
    const l2 = at(i, drop + down + 3);
    assert.deepEqual([l1.pos, l1.rot], [l2.pos, l2.rot], "still on the ground");
    assert.ok(drop - 7 <= 0.65, `lets go ${(drop - 7).toFixed(2)} s after gravity-on`);
    if (h <= 12) {
      assert.ok(drop + down - 7 <= 1.5 + 1 / 30, `from ${h.toFixed(1)} m: down ${(drop + down - 7).toFixed(2)} s after gravity-on`);
      low += 1;
    }
  }
  assert.ok(checked > 100 && low > 20, `${checked} chips checked, ${low} from up to 12 m`);
});
