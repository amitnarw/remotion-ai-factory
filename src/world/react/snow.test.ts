import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import type { Vec3 } from "./lift";
import { PARTICLE_KINDS, REACTION_PARTICLES, SCENE_PARTICLE_BUDGET, type ParticleKind } from "./particles";
import type { ReactionSpec } from "./reaction";
import {
  cardBandAt,
  cardSnowTops,
  flakeAt,
  hasSnow,
  SNOW_CARD_BAND,
  SNOW_DENSITY_EDGE,
  SNOW_FALL,
  SNOW_FLAKES,
  SNOW_FRAGMENT_HEADER,
  SNOW_LAYERS,
  SNOW_LENS,
  SNOW_REST,
  SNOW_ROUGHNESS,
  SNOW_SWAY,
  SNOW_VERTEX,
  SNOWFALL_FRAGMENT,
  SNOWFALL_VERTEX,
  snowCoverAt,
  snowfallBudget,
  snowfallCount,
  snowfallLayers,
  snowfallSeeds,
  snowfallValues,
  snowNoise,
  snowPlan,
  snowShaders,
} from "./snow";
import { buildSnowfall, patchSnowCards, patchSnowCover, setSnowUniforms, snowCardAttribute, SNOW_UNIFORMS } from "./snowShader";
import { patchWaterMarks } from "./waterShader";

const SCENE = { from: 0, to: 24 };
const FPS = 30;
const beat = (t: number, value: string, scale: number) => ({ t, value, zoom: 1, sub: "", scale });
/** A snow counter that climbs (1x, 2x, 16x), falls back (4x) and climbs again. */
const COUNTER: ReactionSpec = {
  statPanel: { react: "snow", beats: [beat(1, "1", 1), beat(3, "2", 2), beat(6, "16", 16), beat(9, "4", 4), beat(12, "8", 8)] },
  worldEvents: [],
};
/** Snow from the events: it starts, stops, starts again. */
const EVENTS: ReactionSpec = {
  statPanel: { react: "confetti", beats: [beat(1, "1", 1), beat(5, "16", 16)] },
  worldEvents: [
    { t: 2, name: "snow-start" },
    { t: 8, name: "snow-stop" },
    { t: 14, name: "snow-start" },
  ],
};
const DRY: ReactionSpec = { statPanel: { react: "lift", beats: [beat(1, "1", 1), beat(5, "16", 16)] }, worldEvents: [{ t: 3, name: "water-rise" }] };

const frames = () => Array.from({ length: Math.round(SCENE.to * FPS) + 1 }, (_, i) => i / FPS);
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}
/** Ground, roof and wall points round the city. */
function points(n: number, seed = 5): Vec3[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => [(r() - 0.5) * 900, r() * 30, (r() - 0.5) * 900] as Vec3);
}

const declared = (glsl: string) => [...glsl.matchAll(/uniform\s+\w+\s+(\w+)/g)].map((m) => m[1]);
function wellFormed(glsl: string, what: string): void {
  for (const [o, c] of [["(", ")"], ["{", "}"], ["[", "]"]]) assert.equal(glsl.split(o).length, glsl.split(c).length, `${what}: ${o}${c} balanced`);
  assert.ok(!/\$\{|undefined|NaN|Infinity/.test(glsl), `${what}: no template leftovers`);
}
function compile(mat: THREE.Material, lib: { vertexShader: string; fragmentShader: string }) {
  const shader = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: {} as Record<string, THREE.IUniform> };
  (mat.onBeforeCompile as (s: unknown, r: unknown) => void)(shader, null);
  return shader;
}

const CAMERA: Vec3 = [-290, 1.7, -60];
const LOOK: Vec3 = [0.6, -0.05, -0.8];

/** Every flake of a place at one frame. */
function flakes(seeds: Float32Array[], t: number, fall: number, camera = CAMERA, viewH = 0) {
  const u = snowfallValues({ cover: 0, fall, time: t }, viewH);
  const n = seeds[0].length / 4;
  return Array.from({ length: n }, (_, i) => flakeAt(seeds, i, u, camera, LOOK));
}

test("snow: without snow nothing changes (no cover, no flakes, the uniforms at rest)", () => {
  assert.equal(hasSnow(DRY), false);
  assert.equal(hasSnow(COUNTER), true);
  assert.equal(hasSnow(EVENTS), true);
  const plan = snowPlan(DRY, SCENE);
  for (const t of [0, 3, 9.5, 23]) assert.deepEqual(plan(t), { ...SNOW_REST, time: t });
  for (const p of points(600)) {
    for (const ny of [-1, 0, 0.5, 1]) assert.equal(snowCoverAt(p, ny, 0), 0);
    assert.equal(cardBandAt(p, p[1], 0), 0);
  }
  // No flake is drawn at rest, wherever the lens is.
  const seeds = snowfallSeeds("paris", SNOW_FLAKES);
  for (const t of [0, 4.2, 17]) assert.equal(flakes(seeds, t, 0).filter((f) => f.alpha > 0).length, 0);
  const layer = buildSnowfall("paris", 300);
  layer.set(snowfallValues(null));
  assert.equal(layer.mesh.visible, false, "no draw call at rest");
  layer.set(snowfallValues({ cover: 0, fall: 0.5, time: 3 }));
  assert.equal(layer.mesh.visible, true);
  layer.dispose();
  // The shared cover uniform goes back to 0 exactly; the shader's branch needs > 0.
  setSnowUniforms(snowPlan(COUNTER, SCENE)(10));
  assert.ok(SNOW_UNIFORMS.uSnLevel.value > 0);
  setSnowUniforms(null);
  assert.equal(SNOW_UNIFORMS.uSnLevel.value, 0);
  assert.ok(snowShaders(THREE.ShaderLib.standard.vertexShader, THREE.ShaderLib.standard.fragmentShader).fragment.includes("if ( uSnLevel > 0.0 )"));
});

test("snow: a pure function of t and the place, whatever order frames are asked in", () => {
  const times = frames();
  for (const spec of [COUNTER, EVENTS]) {
    const a = snowPlan(spec, SCENE);
    const inOrder = times.map((t) => a(t));
    const b = snowPlan(spec, SCENE);
    const r = rng(3);
    const order = [...times].sort(() => r() - 0.5);
    const got = new Map(order.map((t) => [t, b(t)] as const));
    times.forEach((t, i) => assert.deepEqual(got.get(t), inOrder[i]));
  }
  // Seeds from the place and the kind only.
  assert.deepEqual(snowfallSeeds("paris", 500), snowfallSeeds("paris", 500));
  assert.notDeepEqual(snowfallSeeds("colmar", 500), snowfallSeeds("paris", 500));
  // A flake is a formula of (seeds, t, lens): the same answer in any order.
  const seeds = snowfallSeeds("paris", 400);
  const one = flakes(seeds, 7.3, 0.8);
  flakes(seeds, 2.1, 0.3);
  assert.deepEqual(flakes(seeds, 7.3, 0.8), one);
  // The noise is static: the same at every time, in [0, 1].
  for (const p of points(300)) {
    const n = snowNoise(p, 0.02);
    assert.ok(n >= 0 && n <= 1);
    assert.equal(snowNoise(p, 0.02), n);
  }
});

test("snow: the cover never goes down (counter falls, snow-stop), and the patch only spreads with it", () => {
  for (const spec of [COUNTER, EVENTS]) {
    const plan = snowPlan(spec, SCENE);
    let prev = -Infinity;
    for (const t of [...frames(), ...Array.from({ length: 3000 }, (_, i) => (i * SCENE.to) / 3000 + 0.0011)].sort((a, b) => a - b)) {
      const s = plan(t);
      assert.ok(s.cover >= prev, `t ${t}: cover ${prev} -> ${s.cover}`);
      assert.ok(s.cover >= 0 && s.cover <= 1 && s.fall >= 0 && s.fall <= 1);
      prev = s.cover;
    }
  }
  // The counter's fall to 4x keeps the 16x cover; snow-stop stops the fall only.
  const counter = snowPlan(COUNTER, SCENE);
  assert.ok(Math.abs(counter(8).cover - 1) < 1e-9 && Math.abs(counter(11).cover - 1) < 1e-9);
  const events = snowPlan(EVENTS, SCENE);
  assert.ok(events(12).fall < 1e-9 && events(12).cover > 0.5, "the snow stops falling; what settled stays");
  // Pointwise: more cover never takes snow away anywhere.
  const r = rng(9);
  for (const p of points(1500)) {
    const ny = r() * 2 - 1;
    let last = 0;
    for (let l = 0; l <= 1.0001; l += 0.02) {
      const c = snowCoverAt(p, ny, l);
      assert.ok(c >= last - 1e-12, `cover fell at level ${l.toFixed(2)}`);
      last = c;
    }
    let band = 0;
    for (let l = 0; l <= 1.0001; l += 0.05) {
      const b = cardBandAt(p, p[1] + 0.4, l);
      assert.ok(b >= band - 1e-12);
      band = b;
    }
  }
});

test("snow: settles on what faces up — patchy at 2x, white at the top level, never on walls", () => {
  const pts = points(3000);
  const share = (ny: number, level: number, at = 0.5) => pts.filter((p) => snowCoverAt(p, ny, level) > at).length / pts.length;
  // Flat ground and roofs: a 2x beat dusts it in patches, 16x covers it.
  const dust = share(1, 0.25);
  assert.ok(dust > 0.05 && dust < 0.6, `2x: ${dust}`);
  assert.ok(share(1, 0.5) > dust + 0.15, "4x covers more");
  assert.ok(share(1, 1, 0.99) > 0.97, `16x: ${share(1, 1, 0.99)}`);
  // 45° roofs hold most of it, a 70° mansard some, roofs past 73° none, walls and undersides none.
  assert.ok(share(Math.SQRT1_2, 1) > 0.8);
  const mansard = share(Math.cos((70 * Math.PI) / 180), 1, 0);
  assert.ok(mansard > 0 && mansard < 0.6, `70°: ${mansard}`);
  for (const ny of [Math.cos((73.5 * Math.PI) / 180), 0, -0.5, -1]) assert.equal(share(ny, 1, 0), 0, `ny ${ny}`);
  // Far away the fine octave fades to its mean: the noise stays in range and smooth.
  for (const p of points(200)) {
    const near = snowNoise(p, 0.01);
    const far = snowNoise(p, 50);
    assert.ok(far >= 0 && far <= 1 && Math.abs(far - 0.5) < 1e-9, "both octaves at their mean");
    assert.ok(near >= 0 && near <= 1);
  }
});

test("snow: the far cards' band hangs from each building's top", () => {
  // Two buildings of two quads each (4 vertices per face, fans), tops 12 m and 30 m.
  const quad = (x: number, y0: number, y1: number): number[] => [x, y0, 0, x + 4, y0, 0, x + 4, y1, 0, x, y1, 0];
  const position = new Float32Array([...quad(0, 0, 6), ...quad(0, 6, 12), ...quad(20, 0, 15), ...quad(20, 15, 30), ...quad(50, 0, 3)]);
  const fan = (v: number) => [v, v + 1, v + 2, v, v + 2, v + 3];
  const index = new Uint32Array([...fan(0), ...fan(4), ...fan(8), ...fan(12)]);
  const ranges = new Uint32Array([0, 12, 12, 24]);
  const tops = cardSnowTops({ position, index, ranges });
  assert.deepEqual([...tops.slice(0, 8)], Array(8).fill(12));
  assert.deepEqual([...tops.slice(8, 16)], Array(8).fill(30));
  assert.deepEqual([...tops.slice(16)], [0, 0, 0, 0], "vertices of no building stay 0");
  const attr = snowCardAttribute({ position, index, ranges });
  assert.equal(attr.itemSize, 1);
  assert.equal(attr.count, position.length / 3);
  // At full cover: white at the top, bare well below it.
  for (const p of points(300)) {
    const top = p[1] + 1;
    assert.ok(cardBandAt([p[0], top, p[2]], top, 1) === 1);
    assert.equal(cardBandAt([p[0], top - SNOW_CARD_BAND * 1.41, p[2]], top, 1), 0);
  }
});

test("snowfall: within §5's budget beside any reaction's particles; 0.8–1.5 m/s with a sideways sway", () => {
  // §5: a scene's GPU particles stay within confetti or banknotes (6,000)
  // plus chips (2,000), whatever the counter draws beside the snow.
  assert.ok(SNOW_FLAKES <= 6000);
  assert.equal(snowfallCount(), SNOW_FLAKES);
  for (const kinds of [[], ...Object.values(REACTION_PARTICLES)] as ParticleKind[][]) {
    const others = kinds.reduce((n, k) => n + PARTICLE_KINDS[k].count, 0);
    const snow = snowfallBudget(kinds);
    assert.ok(snow >= 0 && snow + others <= SCENE_PARTICLE_BUDGET, `${kinds.join("+") || "snow alone"}: ${snow} + ${others}`);
  }
  for (const n of [0, 1, 999, 2000, SNOW_FLAKES]) {
    const layers = snowfallLayers(n);
    assert.equal(layers.length, SNOW_LAYERS.length);
    assert.equal(layers.reduce((a, b) => a + b, 0), n);
    assert.ok(layers.every((m) => m >= 0));
    assert.equal(snowfallSeeds("paris", n)[0].length, 4 * n);
  }
  // One draw call: one instanced mesh of SNOW_FLAKES quads.
  const layer = buildSnowfall("paris", snowfallCount());
  assert.equal((layer.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount, SNOW_FLAKES);
  assert.equal(layer.mesh.frustumCulled, false);
  layer.dispose();
  // Seeds: fall speed and sway within the numbers; measured, the flakes fall at it.
  const seeds = snowfallSeeds("paris", SNOW_FLAKES);
  const u0 = snowfallValues({ cover: 0, fall: 1, time: 4 });
  const u1 = snowfallValues({ cover: 0, fall: 1, time: 4.25 });
  let measured = 0;
  for (let i = 0; i < SNOW_FLAKES; i++) {
    const [v, sway] = [seeds[1][i * 4], seeds[1][i * 4 + 1]];
    assert.ok(v >= SNOW_FALL[0] && v <= SNOW_FALL[1], `speed ${v}`);
    assert.ok(sway >= SNOW_SWAY[0] && sway <= SNOW_SWAY[1]);
    const a = flakeAt(seeds, i, u0, CAMERA, LOOK);
    const b = flakeAt(seeds, i, u1, CAMERA, LOOK);
    const dy = a.pos[1] - b.pos[1];
    if (Math.abs(dy) < 2) {
      measured++;
      assert.ok(Math.abs(dy / 0.25 - v) < 1e-3, `flake ${i} falls at ${dy / 0.25}, seeded ${v}`);
      // It sways sideways (and drifts with the breeze) no faster than its
      // amplitude allows (a wrap round the box, 12 m or more, aside).
      const side = Math.hypot(b.pos[0] - a.pos[0], b.pos[2] - a.pos[2]);
      if (side < 2) assert.ok(side < 0.25 * (Math.hypot(0.35, 0.12) + 1.5 * sway * 1.5) + 1e-6);
    }
  }
  assert.ok(measured > 0.9 * SNOW_FLAKES);
});

test("snowfall: the drawn share follows snowfall, nothing at the lens, no pops between frames", () => {
  const seeds = snowfallSeeds("paris", SNOW_FLAKES);
  const n = SNOW_FLAKES;
  // The density factor alone (the threshold): its mean follows `fall`
  // (exactly mid-range; a little under it near none and over it near full,
  // where the fade-in edge is cut off), 0 at 0 and 1 at 1.
  const density = (fall: number) => {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const th = seeds[0][i * 4 + 3] * (1 - SNOW_DENSITY_EDGE);
      const x = Math.min(1, Math.max(0, (fall - th) / SNOW_DENSITY_EDGE));
      sum += x * x * (3 - 2 * x);
    }
    return sum / n;
  };
  let last = -1;
  for (let fall = 0; fall <= 1.0001; fall += 0.05) {
    const d = density(fall);
    assert.ok(Math.abs(d - fall) < 0.12, `fall ${fall.toFixed(2)}: ${d}`);
    assert.ok(d >= last);
    last = d;
  }
  assert.equal(density(0), 0);
  assert.ok(Math.abs(density(1) - 1) < 1e-12);
  assert.ok(Math.abs(density(0.5) - 0.5) < 0.03);
  // Drawn flakes: none within SNOW_LENS[0] of the lens; more with more snowfall.
  const drawn = (fall: number) => flakes(seeds, 6.4, fall).filter((f) => f.alpha > 0);
  const full = drawn(1);
  const half = drawn(0.5);
  assert.ok(full.length > 1000, `drawn at full snowfall: ${full.length}`);
  assert.ok(half.length < 0.8 * full.length && half.length > 0.3 * full.length, `half: ${half.length} of ${full.length}`);
  const ll = Math.hypot(...LOOK);
  for (const f of full) {
    const depth = ((f.pos[0] - CAMERA[0]) * LOOK[0] + (f.pos[1] - CAMERA[1]) * LOOK[1] + (f.pos[2] - CAMERA[2]) * LOOK[2]) / ll;
    assert.ok(depth >= SNOW_LENS[0], `a flake ${depth.toFixed(2)} m from the lens`);
    assert.ok(f.alpha <= 1);
  }
  // Consecutive frames (30 fps, a lens on the move): a flake that jumps (a
  // wrap) is invisible on both sides; one that doesn't fades smoothly.
  for (let k = 0; k < 60; k++) {
    const t = 3 + k / FPS;
    const camA: Vec3 = [CAMERA[0] + 2 * t, CAMERA[1], CAMERA[2] - t];
    const camB: Vec3 = [CAMERA[0] + 2 * (t + 1 / FPS), CAMERA[1], CAMERA[2] - (t + 1 / FPS)];
    const a = flakes(seeds, t, 1, camA);
    const b = flakes(seeds, t + 1 / FPS, 1, camB);
    for (let i = 0; i < n; i++) {
      const jump = Math.hypot(a[i].pos[0] - b[i].pos[0], a[i].pos[1] - b[i].pos[1], a[i].pos[2] - b[i].pos[2]);
      if (jump > 1) assert.ok(a[i].alpha < 0.02 && b[i].alpha < 0.02, `flake ${i} wrapped while showing (${a[i].alpha}, ${b[i].alpha})`);
      else assert.ok(Math.abs(a[i].alpha - b[i].alpha) < 0.2, `flake ${i} popped ${a[i].alpha} -> ${b[i].alpha}`);
    }
  }
  // Far flakes keep at least SNOW_MIN_PX on screen, fading to keep their ink.
  const floored = flakes(seeds, 6.4, 1, CAMERA, 1920).filter((f) => f.alpha > 0);
  const plain = flakes(seeds, 6.4, 1, CAMERA, 0).filter((f) => f.alpha > 0);
  assert.ok(floored.length <= plain.length);
  assert.ok(floored.some((f, i) => f.size > seeds[2][i * 4 + 1]), "some far flakes grow to the floor");
});

test("snow shader: one GLSL text for every material, applied once, named in the program key", () => {
  const libs = { standard: THREE.ShaderLib.standard, basic: THREE.ShaderLib.basic, lambert: THREE.ShaderLib.lambert, phong: THREE.ShaderLib.phong };
  const a = new THREE.MeshStandardMaterial({ vertexColors: true });
  const b = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
  const key = a.customProgramCacheKey();
  patchSnowCover(a);
  const once = a.onBeforeCompile;
  patchSnowCover(a);
  assert.equal(a.onBeforeCompile, once, "a shared material is patched once");
  assert.ok(a.customProgramCacheKey().endsWith("|react-snow") && a.customProgramCacheKey() !== key);
  patchSnowCover(b);
  const sa = compile(a, libs.standard);
  const sb = compile(b, libs.standard);
  assert.equal(sa.vertexShader, sb.vertexShader);
  assert.equal(sa.fragmentShader, sb.fragmentShader);
  assert.equal(sa.fragmentShader, snowShaders(libs.standard.vertexShader, libs.standard.fragmentShader).fragment);
  for (const name of declared(SNOW_FRAGMENT_HEADER)) assert.equal(sa.uniforms[name], (SNOW_UNIFORMS as Record<string, THREE.IUniform>)[name], `${name} bound`);
  // Every kind of material takes the same snippets, each include kept once.
  for (const lib of Object.values(libs)) {
    for (const cards of [false, true]) {
      const s = snowShaders(lib.vertexShader, lib.fragmentShader, cards);
      assert.ok(s.vertex.includes(SNOW_VERTEX) && s.fragment.startsWith(SNOW_FRAGMENT_HEADER));
      assert.equal(s.fragment.split("#include <alphahash_fragment>").length, 2);
      assert.equal(s.vertex.split("#include <project_vertex>").length, 2);
      assert.equal(s.fragment.includes("snBand( vSnPos"), cards);
      assert.equal(s.vertex.includes("vSnTop = aSnowTop;"), cards);
      wellFormed(s.vertex, "vertex");
      wellFormed(s.fragment, "fragment");
    }
  }
  assert.ok(snowShaders(libs.standard.vertexShader, libs.standard.fragmentShader).fragment.includes(SNOW_ROUGHNESS));
  // The far cards' variant is its own patch with its own key.
  const cardsMat = new THREE.MeshStandardMaterial({ alphaTest: 0.5 });
  patchSnowCards(cardsMat);
  assert.ok(cardsMat.customProgramCacheKey().endsWith("|react-snow-cards"));
  assert.ok(compile(cardsMat, libs.standard).vertexShader.includes("attribute float aSnowTop;"));
  // Water and snow on one material: both patches, both names, each include once.
  const both = new THREE.MeshStandardMaterial();
  patchSnowCover(both);
  patchWaterMarks(both);
  const sw = compile(both, libs.standard);
  assert.ok(both.customProgramCacheKey().endsWith("|react-snow|react-water"));
  assert.ok(sw.fragmentShader.includes("snCover(") && sw.fragmentShader.includes("rwWet("));
  assert.equal(sw.fragmentShader.split("#include <alphahash_fragment>").length, 2);
  wellFormed(sw.fragmentShader, "water + snow");
  // No randomness or clock in the cover.
  assert.ok(!/random|time/i.test(SNOW_FRAGMENT_HEADER));
});

test("snowfall shader: every uniform it declares is provided; the world's log depth and colour space", () => {
  const layer = buildSnowfall("paris", 10);
  const u = layer.material.uniforms;
  for (const name of [...declared(SNOWFALL_VERTEX), ...declared(SNOWFALL_FRAGMENT)]) assert.ok(name in u, `${name} provided`);
  for (const inc of ["#include <logdepthbuf_pars_vertex>", "#include <logdepthbuf_vertex>"]) assert.ok(SNOWFALL_VERTEX.includes(inc));
  for (const inc of ["#include <logdepthbuf_fragment>", "#include <tonemapping_fragment>", "#include <colorspace_fragment>"]) assert.ok(SNOWFALL_FRAGMENT.includes(inc));
  wellFormed(SNOWFALL_VERTEX, "snowfall vertex");
  wellFormed(SNOWFALL_FRAGMENT, "snowfall fragment");
  assert.ok(layer.material.transparent && !layer.material.depthWrite);
  // The look: the colour times the brightness; the defaults draw nothing.
  layer.set(snowfallValues({ cover: 0, fall: 1, time: 2 }, 1080), { colour: "#ffffff", light: 0.5 });
  const c = u.uSfColour.value as THREE.Color;
  assert.ok(Math.abs(c.r - 0.5) < 1e-6 && Math.abs(c.b - 0.5) < 1e-6);
  assert.equal(u.uSfViewH.value, 1080);
  assert.equal(u.uSfTime.value, 2);
  layer.dispose();
});
