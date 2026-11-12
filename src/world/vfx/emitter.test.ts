import { test } from "node:test";
import assert from "node:assert/strict";
import { ShaderLib } from "three";
import {
  curve,
  curveAt,
  emitter,
  flat,
  linearHex,
  loopCount,
  particleSeed,
  ramp,
  rampAt,
  saltOf,
  VFX_UNIFORM_NAMES,
  VFX_VERTEX_HEADER,
  vfxBasicFragment,
  vfxHash,
  vfxLitFragment,
  vfxParticleAt,
  vfxRand,
  vfxUniformValues,
  vfxVertexShader,
  type EmitterParams,
  type Vec3,
} from "./emitter";

const AT: Vec3 = [12, 0.2, -30];
const FAR: Vec3 = [AT[0] + 40, 12, AT[2] + 40];

/** Every instance of a part at time t (the shader's formula, in TypeScript). */
function frame(p: EmitterParams, t: number, opts: { emitFor?: number; scale?: number; camera?: Vec3; seed?: string } = {}) {
  const u = vfxUniformValues(p, { time: t, at: AT, scale: opts.scale ?? 1, seed: opts.seed ?? "test", emitFor: opts.emitFor ?? 1e4 });
  return Array.from({ length: u.count }, (_, i) => vfxParticleAt(u, i, opts.camera ?? FAR));
}

const burst = emitter({ name: "burst", count: 40, spread: 0.3, life: [0.8, 1.4], shape: "ball", radius: 0.5, cone: Math.PI, speed: [4, 8], outward: 1, drag: 2, accel: [0, 1, 0] });
const loop = emitter({ name: "loop", loop: true, rate: 12, count: loopCount(12, 1.5), life: [1, 1.5], shape: "disc", radius: 0.5, cone: 0.3, speed: [1, 2], accel: [0, 1, 0], drag: 0.5 });

test("vfx hash: the shader's uint arithmetic, exactly (checked against BigInt)", () => {
  const ref = (x: bigint): bigint => {
    const M = (1n << 32n) - 1n;
    x &= M;
    x ^= x >> 16n;
    x = (x * 0x7feb352dn) & M;
    x ^= x >> 15n;
    x = (x * 0x846ca68bn) & M;
    x ^= x >> 16n;
    return x;
  };
  for (const x of [0, 1, 2, 7, 12345, 0x7fffffff, 0x80000000, 0xdeadbeef, 0xffffffff]) assert.equal(BigInt(vfxHash(x)), ref(BigInt(x)), `hash ${x}`);
  // vfxRand: 24 bits, in [0, 1), the k-th draw of a seed (h ^ k·golden, wrapped to 32 bits).
  for (const h of [0, 99, 0xfedcba98]) {
    for (const k of [0, 1, 5, 20]) {
      const r = vfxRand(h, k);
      const want = Number(ref(BigInt(h) ^ ((BigInt(k) * 0x9e3779b9n) & 0xffffffffn)) >> 8n) / 16777216;
      assert.equal(r, want);
      assert.ok(r >= 0 && r < 1 && Number.isInteger(r * 16777216));
    }
  }
  // The seed of (salt, index, cycle): salt + hash(index + golden·cycle), all wrapped to 32 bits.
  const salt = saltOf("x");
  assert.ok(Number.isInteger(salt) && salt >= 0 && salt < 1 << 24);
  const want = ref(BigInt(salt) + ref((7n + 0x9e3779b9n * 3n) & 0xffffffffn));
  assert.equal(BigInt(particleSeed(salt, 7, 3)), want);
  // Another cycle of the same instance draws other randoms.
  assert.notEqual(particleSeed(salt, 7, 3), particleSeed(salt, 7, 4));
});

test("vfx curves: four keys, linear between, held outside; ramps linear or stepped", () => {
  const c = curve([0.1, 0], [0.4, 3], [0.6, 3], [1, 1]);
  assert.equal(curveAt(c.v, c.k, 0), 0);
  assert.ok(Math.abs(curveAt(c.v, c.k, 0.25) - 1.5) < 1e-12);
  assert.equal(curveAt(c.v, c.k, 0.5), 3);
  assert.ok(Math.abs(curveAt(c.v, c.k, 0.8) - 2) < 1e-12);
  assert.equal(curveAt(c.v, c.k, 1.5), 1);
  // Fewer keys pad with the last; a flat curve is the same everywhere.
  assert.deepEqual(curve([0, 2], [1, 4]).v, [2, 4, 4, 4]);
  for (const u of [0, 0.3, 1]) assert.equal(curveAt(flat(2).v, flat(2).k, u), 2);
  const r = ramp([[0, "#ff0000"], [0.5, "#00ff00"], [1, "#0000ff"]]);
  const cs = r.c.map(linearHex);
  assert.deepEqual(rampAt(cs, r.k, false, 0.25), [0.5, 0.5, 0]);
  const s = ramp([[0, "#ff0000"], [0.5, "#00ff00"], [1, "#0000ff"]], true);
  assert.deepEqual(rampAt(s.c.map(linearHex), s.k, true, 0.49), [1, 0, 0]);
  assert.deepEqual(rampAt(s.c.map(linearHex), s.k, true, 0.5), [0, 1, 0]);
  // sRGB hex to linear as three's Color does.
  assert.ok(Math.abs(linearHex("#808080")[0] - 0.21586) < 1e-4);
});

test("vfx burst: nothing before its start or after its last life; every birth inside the spread", () => {
  for (const t of [-1, -0.01]) assert.equal(frame(burst, t).filter((p) => p.alive).length, 0, `t ${t}`);
  const end = burst.spread + burst.life[1];
  for (const t of [end, end + 0.01, 5, 80]) assert.equal(frame(burst, t).filter((p) => p.alive).length, 0, `t ${t}`);
  // Everyone is born within the spread and lives within its range.
  for (const p of frame(burst, 0.31)) {
    const birth = 0.31 - p.age;
    assert.ok(birth >= 0 && birth < burst.spread + 1e-9);
    assert.ok(p.life >= burst.life[0] && p.life <= burst.life[1]);
    assert.ok(p.alive);
  }
  // Ordered births run through the spread in index order.
  const train = emitter({ ...burst, ordered: true, spread: 0.5, count: 5 });
  const ages = frame(train, 0.6).map((p) => p.age);
  ages.forEach((a, i) => assert.ok(Math.abs(a - (0.6 - (0.5 * i) / 5)) < 1e-9));
});

test("vfx loop: each instance one particle at a time; born at k / rate; none after it stops", () => {
  assert.ok(loop.count >= Math.ceil(loop.rate * loop.life[1]) + 1);
  for (const t of [0.05, 1, 3.3, 17.25, 80]) {
    const ps = frame(loop, t);
    ps.forEach((p, i) => {
      if (!p.alive) return;
      // Born at k / rate with k ≡ i (mod count), at or before t.
      const k = (t - p.age) * loop.rate;
      assert.ok(Math.abs(k - Math.round(k)) < 1e-6, `birth slot at ${t}`);
      assert.equal(((Math.round(k) % loop.count) + loop.count) % loop.count, i);
      assert.ok(p.age >= 0 && p.age < loop.count / loop.rate);
    });
    // As many alive as the rate times the lives, roughly (steady state after the first life).
    if (t > 2) {
      const alive = ps.filter((p) => p.alive).length;
      assert.ok(alive >= loop.rate * loop.life[0] - 2 && alive <= loop.count, `alive ${alive} at ${t}`);
    }
  }
  // Stopped at emitFor: nothing born from then on; all gone a life later.
  const stop = 5;
  for (const t of [5.2, 6, 6.4]) for (const p of frame(loop, t, { emitFor: stop })) if (p.alive) assert.ok(t - p.age < stop, `born ${t - p.age}`);
  assert.equal(frame(loop, stop + loop.life[1] + 1e-6, { emitFor: stop }).filter((p) => p.alive).length, 0);
});

test("vfx: no history - any frame, in any order, alone, equals itself in a sequence (t = 80 s of a loop)", () => {
  const ts = [80, 0.4, 79.9, 3, 80, 12.5, 0.4];
  const fresh = ts.map((t) => JSON.stringify(frame(loop, t)));
  const again = [...ts].reverse().map((t) => JSON.stringify(frame(loop, t))).reverse();
  assert.deepEqual(fresh, again);
  assert.equal(fresh[0], fresh[4]);
  // The 80 s frame, from a sequence of the frames before it, is the same as alone.
  let seq = "";
  for (let f = 2390; f <= 2400; f++) seq = JSON.stringify(frame(loop, f / 30));
  assert.equal(seq, fresh[0]);
});

test("vfx motion: linear drag in closed form equals a fine integration", () => {
  const p = emitter({ name: "drag", count: 6, life: [3, 3], cone: 1, speed: [6, 9], accel: [0, -3, 0], drag: 1.7, wind: [1, 0, -0.5] });
  const t = 1.3;
  const a = frame(p, 0);
  const b = frame(p, t);
  a.forEach((p0, i) => {
    // Euler steps of dv/dt = accel + drag·(wind − v) from the shader's own launch.
    const v = [...p0.vel];
    const x = [...p0.pos];
    const dt = 1e-5;
    for (let s = 0; s < t / dt; s++) {
      const acc = [0, -3, 0].map((g, j) => g + 1.7 * ([1, 0, -0.5][j] - v[j]));
      for (let j = 0; j < 3; j++) {
        x[j] += v[j] * dt;
        v[j] += acc[j] * dt;
      }
    }
    for (let j = 0; j < 3; j++) assert.ok(Math.abs(x[j] - b[i].pos[j]) < 2e-3, `pos ${j}: ${x[j]} vs ${b[i].pos[j]}`);
  });
});

test("vfx motion: ballistic chunks land on the ground, bounce once, then lie still", () => {
  const p = emitter({ name: "chunks", count: 30, life: [4, 4], offset: [0, 1, 0], cone: 1, speed: [5, 12], accel: [0, -9.8, 0], ground: true, bounce: 0.3 });
  const ground = AT[1];
  let min = Infinity;
  for (let f = 0; f < 4 * 30; f++) for (const s of frame(p, f / 30)) if (s.alive) min = Math.min(min, s.pos[1]);
  assert.ok(min >= ground - 1e-9, `lowest ${min}`);
  // Long after: every chunk at rest on the ground, the same two frames running.
  const late = frame(p, 3.5);
  const later = frame(p, 3.9);
  late.forEach((s, i) => {
    assert.ok(Math.abs(s.pos[1] - ground) < 1e-9);
    assert.deepEqual(s.pos, later[i].pos);
    assert.deepEqual(s.vel, [0, 0, 0]);
  });
  // Scaled, the whole part (its offset too) grows about the effect's spot, on the same times.
  const big = frame(p, 0.4, { scale: 2 });
  frame(p, 0.4).forEach((s, i) => {
    for (let j = 0; j < 3; j++) assert.ok(Math.abs(big[i].pos[j] - AT[j] - 2 * (s.pos[j] - AT[j])) < 1e-9);
  });
});

test("vfx flipbook: cells at floor(age × fps), looped or held, or a random still cell", () => {
  const p = emitter({ name: "flip", count: 8, life: [3, 3], sheet: "flame", frames: 16, fps: 10, flipLoop: true });
  for (const t of [0, 0.05, 0.1, 1.55, 2.9]) for (const s of frame(p, t)) assert.equal(s.cell, Math.floor(t * 10) % 16);
  const once = emitter({ ...p, sheet: "burst", frames: 8, fps: 10, flipLoop: false });
  for (const s of frame(once, 2.5)) assert.equal(s.cell, 7);
  const still = emitter({ ...p, fps: 0 });
  const cells = frame(still, 1).map((s) => s.cell);
  assert.deepEqual(frame(still, 2.7).map((s) => s.cell), cells);
  for (const c of cells) assert.ok(c >= 0 && c < 16 && Number.isInteger(c));
});

test("vfx lens: a particle shrinks away near the lens, gone inside its first distance", () => {
  const p = emitter({ name: "lens", count: 1, life: [5, 5], size: flat(0.2), lens: [0.5, 2] });
  const at = frame(p, 1, { camera: [AT[0], AT[1], AT[2] + 0.3] })[0];
  assert.equal(at.size, 0);
  assert.equal(at.on, false);
  assert.ok(at.alive);
  assert.ok(frame(p, 1, { camera: [AT[0], AT[1], AT[2] + 5] })[0].size > 0.19);
});

test("vfx shader: one GLSL text for every part, every uniform declared, the hooks replaced", () => {
  const declared = [...VFX_VERTEX_HEADER.matchAll(/uniform \w+ (uVfx\w+)/g)].map((m) => m[1]);
  const vertexNames = Object.entries(VFX_UNIFORM_NAMES).filter(([k]) => k !== "cut" && k !== "core3").map(([, v]) => v);
  assert.deepEqual(new Set(declared), new Set(vertexNames));
  for (const base of [ShaderLib.basic.vertexShader, ShaderLib.lambert.vertexShader]) {
    const text = vfxVertexShader(base);
    assert.ok(base.includes("#include <uv_vertex>") && base.includes("#include <begin_vertex>"));
    assert.ok(!text.includes("#include <begin_vertex>"), "begin_vertex replaced");
    assert.ok(text.includes("vfxParticle(vfxPos, vfxVel, vfxSize, vfxAgeN, vfxAge, vfxSeed, vfxShown);"));
    assert.ok(text.indexOf("vfxParticle(vfxPos") < text.indexOf("#include <uv_vertex>"));
    assert.ok(text.includes("vec3 transformed = vfxVertex;"));
  }
  assert.ok(!vfxVertexShader(ShaderLib.lambert.vertexShader).includes("#include <beginnormal_vertex>"));
  const basic = vfxBasicFragment(ShaderLib.basic.fragmentShader);
  assert.ok(!basic.includes("#include <map_fragment>") && basic.includes("uVfxCut"));
  const lit = vfxLitFragment(ShaderLib.lambert.fragmentShader);
  assert.ok(lit.includes("diffuseColor.rgb *= vVfxColour;") && lit.includes("totalEmissiveRadiance += vVfxColour * vVfxGlow;"));
  // No per-part text: every part's values have the same keys, none of them strings.
  const keys = [burst, loop].map((p) => Object.keys(vfxUniformValues(p, { time: 0, at: AT, scale: 1, seed: "s", emitFor: 1 })).sort().join());
  assert.equal(new Set(keys).size, 1);
  for (const v of Object.values(vfxUniformValues(loop, { time: 0, at: AT, scale: 1, seed: "s", emitFor: 1 }))) assert.notEqual(typeof v, "string");
});
