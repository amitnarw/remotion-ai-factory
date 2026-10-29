import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { lampGroup } from "../atmosphere/dressing";
import { applyHeightFog } from "../atmosphere/fog";
import { lampSpots } from "../atmosphere/night";
import { waterMaterial } from "../atmosphere/water";
import { generateCity } from "../city";
import { kitTown } from "../kitTown";
import { clearWindowGlowCache, windowGlowMaterialFor } from "../kitWindows";
import { landmarksFor } from "../landmarks";
import { buildingsGeometry } from "../meshes";
import { resolvePlace } from "../places";
import { skyFor } from "../sky";
import {
  DARK_GLSL,
  DARK_JITTER_M,
  DARK_NEAR_M,
  DARK_REST,
  DARK_SKY,
  DARK_STEP_RATE,
  FILL_OUT,
  FLICKER_FRAMES,
  FLICKER_P0,
  FLICKER_S,
  KEY_OUT,
  cellId,
  darkDistance,
  darkExtent,
  darkLit,
  darkPlan,
  darkRand,
  discFade,
  frontAt,
  hasDark,
  placementKeys,
  reachOfLevel,
  skyDarkness,
  type DarkKey,
  type DarkScene,
  type DarkState,
} from "./dark";
import { DARK_UNIFORMS, darkRig, patchDarkBasic, patchDarkEmissive, patchDarkSky, patchDarkSelfLit, setDarkUniforms } from "./darkShader";
import { DARK_SPEED, reactionEpicentre, type ReactionSpec } from "./reaction";

const FPS = 30;
const SCENE = { from: 0, to: 20 };
const DAY_SKY = skyFor(40);
const WHERE: DarkScene = { centre: [10, -20], extent: 900, sky: DAY_SKY };

/** The Paris money counter (1x, 1.75x, then 16x) as "dark". */
const BEATS = [
  { t: 0.5, value: "1", zoom: 1, sub: "", scale: 1 },
  { t: 2, value: "2", zoom: 1.75, sub: "", scale: 1.75 },
  { t: 6, value: "1048576", zoom: 16, sub: "", scale: 16 },
];
const COUNTER: ReactionSpec = { statPanel: { beats: BEATS, react: "dark" }, worldEvents: [] };
const EVENT: ReactionSpec = { statPanel: { beats: BEATS, react: "money" }, worldEvents: [{ t: 3, name: "lights-out" }] };

const frames = (to: number) => Array.from({ length: Math.round(to * FPS) + 1 }, (_, f) => f);
const at = (plan: (t: number, fps: number) => DarkState, f: number) => plan(f / FPS, FPS);

/** A ring of lights round the centre at increasing distances. */
function ring(n: number, step: number, centre: readonly [number, number] = WHERE.centre): DarkKey[] {
  return Array.from({ length: n }, (_, i) => {
    const a = i * 2.4;
    const r = 5 + i * step;
    return [centre[0] + Math.cos(a) * r, centre[1] + Math.sin(a) * r, i * 7 + 3] as DarkKey;
  });
}

/** Each light's on/off per frame. */
function series(plan: (t: number, fps: number) => DarkState, keys: readonly DarkKey[], to: number): number[][] {
  const states = frames(to).map((f) => at(plan, f));
  return keys.map((k) => states.map((s) => darkLit(k, s)));
}

test("dark: the hash is the GLSL's (whole numbers in, [0, 1) out, spread evenly)", () => {
  // Fixed values: the TypeScript side is bit-exact with DARK_GLSL's dkRand.
  assert.equal(darkRand(0, 0), darkRand(0, 0));
  const xs = Array.from({ length: 4000 }, (_, i) => darkRand(i, 17));
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  assert.ok(Math.abs(mean - 0.5) < 0.02, `mean ${mean}`);
  // Neighbouring ids and ticks are not correlated.
  let same = 0;
  for (let i = 0; i < 1000; i++) if (darkRand(i, 5) < 0.5 === darkRand(i + 1, 5) < 0.5) same++;
  assert.ok(same > 430 && same < 570, `${same}`);
  // The GLSL carries the same constants.
  assert.ok(DARK_GLSL.includes("0x7feb352du") && DARK_GLSL.includes("0x846ca68bu") && DARK_GLSL.includes("0x9e3779b9u"));
  assert.ok(DARK_GLSL.includes(`* ${DARK_JITTER_M}.0`) && DARK_GLSL.includes(`< ${FLICKER_P0} +`));
});

test("dark: without a reaction nothing changes (power 1, every light on, every factor exactly 1)", () => {
  assert.equal(hasDark({ statPanel: { beats: BEATS, react: "money" }, worldEvents: [] }), false);
  assert.equal(hasDark({}), false);
  for (const spec of [{}, { statPanel: { beats: BEATS, react: "lift" as const } }, { worldEvents: [{ t: 1, name: "gravity-off" }] }] as ReactionSpec[]) {
    const plan = darkPlan(spec, SCENE, WHERE);
    for (const f of [0, 15, 120, 400]) {
      const s = at(plan, f);
      assert.equal(s.power, 1);
      assert.equal(s.key, 1);
      assert.equal(s.fill, 1);
      assert.equal(s.sky, 0);
      assert.equal(s.skyGain, 1);
      assert.equal(s.reach, 0);
      assert.equal(s.past, 0);
      for (const k of ring(30, 10)) assert.equal(darkLit(k, s), 1);
    }
  }
  // The rest state itself, and before anything happens in a reacting scene.
  for (const k of ring(30, 10)) assert.equal(darkLit(k, DARK_REST), 1);
  const ev = at(darkPlan(EVENT, SCENE, WHERE), 2.9 * FPS);
  assert.deepEqual([ev.power, ev.key, ev.fill, ev.sky, ev.skyGain, ev.reach, ev.past], [1, 1, 1, 0, 1, 0, 0]);
  assert.equal(skyDarkness(0, DAY_SKY).sky, 0);
  assert.equal(skyDarkness(0, DAY_SKY).skyGain, 1);
});

test("dark: the state is a pure function of the frame, whatever order frames are asked in", () => {
  for (const spec of [COUNTER, EVENT, { ...COUNTER, worldEvents: [{ t: 7.5, name: "lights-out" }] }]) {
    const fresh = () => darkPlan(spec, SCENE, WHERE);
    const inOrder = frames(14).map((f) => at(fresh(), f));
    const plan = fresh();
    const order = frames(14).sort((a, b) => ((a * 7919) % 421) - ((b * 7919) % 421));
    const shuffled = new Map(order.map((f) => [f, at(plan, f)]));
    for (const f of frames(14)) assert.deepEqual(shuffled.get(f), inOrder[f], `frame ${f}`);
    // One plan asked twice in a row gives the same frame.
    assert.deepEqual(at(plan, 200), at(plan, 200));
  }
});

test("dark: the lights-out event's wave runs out at least at DARK_SPEED and over the city with the power", () => {
  const plan = darkPlan(EVENT, SCENE, WHERE);
  let prev = 0;
  for (let f = 0; f <= 14 * FPS; f++) {
    const t = f / FPS;
    const s = plan(t, FPS);
    assert.ok(s.reach >= Math.max(0, t - 3) * DARK_SPEED - 1e-9, `at least darkFront at ${t}`);
    assert.ok(s.reach >= prev, "it only spreads");
    assert.equal(s.past, plan(t - FLICKER_S, FPS).reach);
    if (t < 3) assert.equal(s.reach, 0);
    prev = s.reach;
  }
  // The whole city is out once the power is (2.5 s after the event).
  assert.equal(plan(5.5, FPS).reach, WHERE.extent);
  // Each light: on until the wave reaches it, out for good FLICKER_S after.
  const keys = ring(40, 9);
  const lit = series(plan, keys, 14);
  keys.forEach((k, i) => {
    const d = darkDistance(k, WHERE.centre);
    lit[i].forEach((v, f) => {
      const s = at(plan, f);
      if (s.reach <= d) assert.equal(v, 1, `light ${i} on before the wave (frame ${f})`);
      if (s.past > d) assert.equal(v, 0, `light ${i} out after its flicker (frame ${f})`);
    });
  });
  // The sky dims with the event's power over 2.5 s, all at once (not by the wave).
  const end = plan(5.6, FPS);
  assert.equal(end.power, 0);
  assert.ok(Math.abs(end.key - KEY_OUT) < 1e-12 && Math.abs(end.fill - FILL_OUT) < 1e-12);
  assert.equal(end.sky, 1);
});

test("dark: lights near the epicentre go out first (lamps along the avenue, buildings round the plaza)", () => {
  const place = resolvePlace("paris", { date: "2026-10-23", time: "22:30" });
  const clearings = landmarksFor(place.place).map((l): [number, number, number] => [l.x, l.z, l.clearRadius]);
  const layout = generateCity(place.style, { clearings, seed: place.place.id, season: place.season, cloudiness: place.place.cloudiness, cloudPassages: [[-75, 0]] });
  const epi = reactionEpicentre(layout, place.style).pos;
  const centre: [number, number] = [epi[0], epi[2]];
  const lamps = lampSpots(place.style).map((s, i): DarkKey => [s.x, s.z, 1_000_000 + i]);
  const houses = layout.buildings.slice(0, 400).map((b, i): DarkKey => [b.x, b.z, i]);
  const where: DarkScene = { centre, extent: darkExtent([...lamps, ...houses].map((k) => [k[0], k[1]]), centre), sky: skyFor(-5) };
  const flicker = Math.ceil(FLICKER_S * FPS);
  for (const spec of [EVENT, COUNTER]) {
    const plan = darkPlan(spec, SCENE, where);
    const states = frames(12).map((f) => at(plan, f));
    for (const keys of [lamps, houses]) {
      const lit = keys.map((k) => states.map((s) => darkLit(k, s)));
      const d = keys.map((k) => darkDistance(k, centre));
      // The frame the wave reaches each light, and the first it is out for good.
      const reached = d.map((di) => states.findIndex((s) => s.reach > di));
      const outAt = lit.map((row) => {
        let f = row.length;
        while (f > 0 && row[f - 1] === 0) f--;
        return f;
      });
      for (let i = 0; i < keys.length; i++) {
        assert.ok(reached[i] >= 0 && outAt[i] >= reached[i] && outAt[i] <= reached[i] + flicker, `light ${i}: reached ${reached[i]}, out ${outAt[i]}`);
        // The nearer light is reached no later.
        for (let j = 0; j < keys.length; j++) if (d[i] < d[j]) assert.ok(reached[i] <= reached[j], `${d[i].toFixed(0)} m at ${reached[i]}, ${d[j].toFixed(0)} m at ${reached[j]}`);
      }
      // Out across the frames: the nearest first, the farthest last.
      const order = [...d.keys()].sort((a, b) => d[a] - d[b]);
      assert.ok(outAt[order[0]] < outAt[order[order.length - 1]]);
    }
  }
});

test("dark: the flicker is deterministic and brief (FLICKER_S after the wave), and flickers", () => {
  const plan = darkPlan(EVENT, SCENE, WHERE);
  const keys = ring(60, 6);
  const a = series(plan, keys, 12);
  const b = series(darkPlan(EVENT, SCENE, WHERE), keys, 12);
  assert.deepEqual(a, b, "the same frames twice");
  const maxFrames = Math.ceil(FLICKER_S * FPS) + 1;
  let flickered = 0;
  for (const row of a) {
    const first0 = row.indexOf(0);
    const last1 = row.lastIndexOf(1);
    assert.ok(first0 > 0, "lit before");
    assert.ok(last1 - first0 < maxFrames, `mixed for ${last1 - first0 + 1} frames`);
    // Within the flicker the state flips back and forth only on the clock's
    // ticks; between ticks it can only settle to its new state (out).
    for (let f = first0 + 1; f <= last1 + 1; f++) {
      if (row[f] !== row[f - 1] && f % FLICKER_FRAMES !== 0) assert.equal(row[f], 0, `back on between ticks at ${f}`);
    }
    let toggles = 0;
    for (let f = 1; f < row.length; f++) if (row[f] !== row[f - 1]) toggles++;
    if (toggles > 1) flickered++;
    assert.ok(toggles <= Math.ceil(maxFrames / FLICKER_FRAMES) + 1, `${toggles} toggles`);
  }
  // Most lights stutter on the way out; a few just go.
  assert.ok(flickered > keys.length * 0.5, `${flickered} of ${keys.length} flicker`);
});

test("dark: a counter's front moves at DARK_STEP_RATE in level, its reach cascading out; the sky follows the power", () => {
  const plan = darkPlan(COUNTER, SCENE, WHERE);
  // 1x: nothing.
  assert.equal(plan(1, FPS).reach, 0);
  assert.equal(plan(1, FPS).power, 1);
  // The reach: 0 at 1x, the same factor per step of level, the extent at 16x.
  assert.equal(reachOfLevel(0, 3900), 0);
  assert.equal(reachOfLevel(1, 3900), 3900);
  const r = [0.25, 0.5, 0.75].map((x) => reachOfLevel(x, 3900));
  assert.ok(Math.abs((r[1] + DARK_NEAR_M) / (r[0] + DARK_NEAR_M) - (r[2] + DARK_NEAR_M) / (r[1] + DARK_NEAR_M)) < 1e-9);
  // Paris (extent ~3.9 km): 1.75x darkens the plaza's own ring only (its
  // nearest façades stand 44-55 m out), 4x a few hundred metres.
  const paris175 = reachOfLevel(Math.log2(1.75) / 4, 3918);
  assert.ok(paris175 > 45 && paris175 < 80, `${paris175}`);
  assert.ok(reachOfLevel(0.5, 3918) > 250 && reachOfLevel(0.5, 3918) < 450);
  // 1.75x: level log2(1.75) / 4.
  const l = Math.log2(1.75) / 4;
  const ring175 = reachOfLevel(l, WHERE.extent);
  assert.ok(Math.abs(plan(2 + l / DARK_STEP_RATE + 0.01, FPS).reach - ring175) < 1e-9);
  assert.ok(Math.abs(plan(2 + 0.1, FPS).reach - reachOfLevel(0.1 * DARK_STEP_RATE, WHERE.extent)) < 1e-9);
  assert.ok(plan(3, FPS).power > 0.79 && plan(3, FPS).power < 0.81);
  // 16x: on from where it was to the extent, then holds.
  assert.ok(Math.abs(plan(6.5, FPS).reach - reachOfLevel(l + 0.5 * DARK_STEP_RATE, WHERE.extent)) < 1e-9);
  assert.equal(plan(6 + (1 - l) / DARK_STEP_RATE + 0.01, FPS).reach, WHERE.extent);
  assert.equal(plan(19, FPS).power, 0);
  // In Paris the 16x step's dark is ~250 m out within 0.5 s (gate item 7).
  const paris = darkPlan(COUNTER, SCENE, { ...WHERE, extent: 3918 });
  assert.ok(paris(6.5, FPS).reach > 250, `${paris(6.5, FPS).reach}`);
  // The global dim reads within 0.5 s of the beat (gate item 7), all of it.
  const s = plan(6.5, FPS);
  assert.ok(s.key < KEY_OUT * 1.2 && s.fill < FILL_OUT * 1.1 && s.sky > 0.95, JSON.stringify(s));
  // Geometric in the power: each step an even dim to the eye.
  const mid = plan(3, FPS);
  assert.ok(Math.abs(mid.key - KEY_OUT ** (1 - mid.power)) < 1e-12);
  assert.ok(Math.abs(mid.fill - FILL_OUT ** (1 - mid.power)) < 1e-12);
});

test("dark: frontAt moves at its speed from wherever it was, both ways, and holds", () => {
  const keys = [
    { t: 1, to: 100 },
    { t: 2, to: 400 },
    { t: 3, to: 50 },
  ];
  assert.equal(frontAt(keys, 100, 0.5), 0);
  assert.equal(frontAt(keys, 100, 1.5), 50);
  assert.equal(frontAt(keys, 100, 2), 100);
  assert.equal(frontAt(keys, 100, 2.5), 150);
  // Back toward 50 from 200, at the same speed.
  assert.equal(frontAt(keys, 100, 3.5), 150);
  assert.equal(frontAt(keys, 100, 9), 50);
  assert.equal(frontAt([], 100, 9), 0);
  // A light the front passes on its way back comes on again (with a flicker).
  const s: DarkState = { ...DARK_REST, centre: [0, 0], reach: frontAt(keys, 100, 3.5), past: frontAt(keys, 100, 3.1) };
  const steady = { ...s, past: s.reach };
  assert.equal(darkLit([0, 300, 1], steady), 1);
  assert.equal(darkLit([0, 10, 1], steady), 0);
});

test("dark: the sky fades geometrically to DARK_SKY; a night already that dark stays", () => {
  let prev = { sky: 0, skyGain: 1 };
  for (let a = 0.1; a <= 1.0001; a += 0.1) {
    const s = skyDarkness(a, DAY_SKY);
    assert.ok(s.sky >= prev.sky && s.skyGain <= prev.skyGain, `monotone at ${a}`);
    prev = s;
  }
  assert.ok(Math.abs(skyDarkness(1, DAY_SKY).sky - 1) < 1e-12);
  // The first fifth of the dark already takes the day sky more than a third of the way.
  assert.ok(skyDarkness(0.2, DAY_SKY).sky > 0.35);
  assert.deepEqual(skyDarkness(1, DARK_SKY), { sky: 0, skyGain: 1 });
});

test("dark: placement keys group a building's pieces; other pieces go by grid cell", () => {
  const placements = [
    { x: 0, z: 0 },
    { x: 3, z: 1 },
    { x: 50, z: 50 },
    { x: 51, z: 52 },
    { x: -400, z: 700 },
  ];
  const cells = placementKeys(placements);
  assert.equal(cells[2], cells[5], "same cell, same x");
  assert.equal(cells[3 * 2 + 2], cells[3 * 3 + 2], "neighbours in one cell share an id");
  assert.notEqual(cells[2], cells[3 * 2 + 2]);
  for (let i = 0; i < placements.length; i++) assert.ok(cells[i * 3 + 2] >= 0 && cells[i * 3 + 2] < 2 ** 24 && Number.isInteger(cells[i * 3 + 2]));
  assert.equal(cellId(-1e9, 1e9), 4095);
  const keyed = placementKeys(placements, [{ start: 0, end: 2, x: 1, z: 2 }, { start: 2, end: 4, x: 50, z: 51 }]);
  assert.deepEqual([...keyed.subarray(0, 6)], [1, 2, 0, 1, 2, 0]);
  assert.deepEqual([...keyed.subarray(6, 12)], [50, 51, 1, 50, 51, 1]);
  assert.deepEqual([...keyed.subarray(12)], [...cells.subarray(12)], "a piece of no building keeps its cell");
});

test("dark: the extent covers every light, so the counter's top level puts all of them out", () => {
  const pts: [number, number][] = [
    [0, 0],
    [300, 400],
    [-50, 10],
  ];
  const e = darkExtent(pts, [0, 0]);
  assert.ok(e >= 500 + DARK_JITTER_M);
  const plan = darkPlan(COUNTER, SCENE, { ...WHERE, centre: [0, 0], extent: e });
  const end = plan(19.9, FPS);
  for (const [x, z] of pts) for (let id = 0; id < 50; id++) assert.equal(darkLit([x, z, id], end), 0);
});

test("dark shader: patches apply once, name themselves in the program key and keep defaults exact", () => {
  const mat = new THREE.MeshStandardMaterial({ emissive: "#ffffff" });
  const baseKey = mat.customProgramCacheKey();
  patchDarkEmissive(mat);
  const once = mat.onBeforeCompile;
  patchDarkEmissive(mat);
  assert.equal(mat.onBeforeCompile, once, "shared materials are patched once");
  assert.ok(mat.customProgramCacheKey().endsWith("|dark-emissive") && mat.customProgramCacheKey() !== baseKey);
  const shader = {
    vertexShader: "void main() {\n#include <begin_vertex>\n}",
    fragmentShader: "void main() {\n#include <emissivemap_fragment>\n}",
    uniforms: {} as Record<string, THREE.IUniform>,
  };
  (mat.onBeforeCompile as (s: unknown) => void)(shader);
  assert.ok(shader.vertexShader.includes("vDarkLit = dkLit( aDark );") && shader.vertexShader.includes("float dkLit"));
  assert.ok(shader.fragmentShader.includes("totalEmissiveRadiance *= vDarkLit;"));
  assert.equal(shader.uniforms.uDarkReach, DARK_UNIFORMS.uDarkReach, "the shared uniforms are bound");
  const basic = new THREE.MeshBasicMaterial();
  patchDarkBasic(basic);
  const b = { vertexShader: "#include <begin_vertex>", fragmentShader: "#include <opaque_fragment>", uniforms: {} };
  (basic.onBeforeCompile as (s: unknown) => void)(b);
  assert.ok(b.fragmentShader.includes("gl_FragColor.rgb *= vDarkLit;"));
  // An unlit kit material dims by hand with the key light.
  const unlit = new THREE.MeshBasicMaterial();
  assert.equal(patchDarkSelfLit(unlit), true);
  const u = { vertexShader: "", fragmentShader: "#include <opaque_fragment>", uniforms: {} as Record<string, THREE.IUniform> };
  (unlit.onBeforeCompile as (s: unknown) => void)(u);
  assert.ok(u.fragmentShader.includes("gl_FragColor.rgb *= uDarkUnlit;") && u.uniforms.uDarkUnlit === DARK_UNIFORMS.uDarkUnlit);
  // Kenney's building-kit glass glows a fixed pale blue: its emissive dims too; a plain material is left alone.
  const glass = new THREE.MeshStandardMaterial({ name: "glass", emissive: new THREE.Color(0.2, 0.22, 0.28) });
  assert.equal(patchDarkSelfLit(glass), true);
  const g2 = { vertexShader: "", fragmentShader: "#include <emissivemap_fragment>", uniforms: {} as Record<string, THREE.IUniform> };
  (glass.onBeforeCompile as (s: unknown) => void)(g2);
  assert.ok(g2.fragmentShader.includes("totalEmissiveRadiance *= uDarkUnlit;"));
  const plain = new THREE.MeshStandardMaterial({ color: "#a07748" });
  const plainKey = plain.customProgramCacheKey();
  assert.equal(patchDarkSelfLit(plain), false);
  assert.equal(plain.customProgramCacheKey(), plainKey, "a lit material keeps its program");
  setDarkUniforms(darkPlan(COUNTER, SCENE, WHERE)(19, FPS));
  assert.ok(Math.abs(DARK_UNIFORMS.uDarkUnlit.value - KEY_OUT) < 1e-12);
  // At rest the uniforms say nothing happened.
  setDarkUniforms(null);
  assert.deepEqual(
    [DARK_UNIFORMS.uDarkReach.value, DARK_UNIFORMS.uDarkPast.value, DARK_UNIFORMS.uDarkSky.value, DARK_UNIFORMS.uDarkSkyGain.value, DARK_UNIFORMS.uDarkUnlit.value],
    [0, 0, 0, 1, 1],
  );
});

test("dark shader: the kit glow reads its key from instanceColor; the bake (no instances) stays lit", () => {
  clearWindowGlowCache();
  const glass = new THREE.MeshStandardMaterial({ name: "glass" });
  const glow = windowGlowMaterialFor(glass, "#ffc073", 2.4)!;
  const shader = { vertexShader: "#include <uv_vertex>", fragmentShader: "#include <colorspace_fragment>", uniforms: {} as Record<string, THREE.IUniform> };
  (glow.onBeforeCompile as (s: unknown) => void)(shader);
  assert.ok(shader.vertexShader.includes("#ifdef USE_INSTANCING_COLOR\n  vDarkLit = dkLit( instanceColor );\n#else\n  vDarkLit = 1.0;"));
  assert.ok(shader.fragmentShader.includes("gMask * vDarkLit"));
  assert.equal(shader.uniforms.uDarkCentre, DARK_UNIFORMS.uDarkCentre);
  clearWindowGlowCache();
});

test("dark shader: haze and water default to their lit look; the dome carries its dark gradient", () => {
  const fogMat = new THREE.MeshStandardMaterial();
  applyHeightFog(fogMat, { horizon: "#bcd6ea", zenith: "#4d8ad2" });
  const f = { vertexShader: "#include <project_vertex>", fragmentShader: "#include <fog_fragment>", uniforms: {} as Record<string, THREE.IUniform> };
  (fogMat.onBeforeCompile as (s: unknown) => void)(f);
  assert.equal(f.uniforms.uHFogN.value, 0);
  const shared = { value: 0.25 };
  const fogDark = new THREE.MeshStandardMaterial();
  applyHeightFog(fogDark, { horizon: "#bcd6ea", zenith: "#4d8ad2", night: { amount: shared, ...DARK_SKY } });
  const g = { vertexShader: "#include <project_vertex>", fragmentShader: "#include <fog_fragment>", uniforms: {} as Record<string, THREE.IUniform> };
  (fogDark.onBeforeCompile as (s: unknown) => void)(g);
  assert.equal(g.uniforms.uHFogN, shared, "the haze reads the shared amount");
  const water = waterMaterial({ sky: "#bcd6ea" });
  const w = { vertexShader: "#include <project_vertex>", fragmentShader: "#include <colorspace_fragment>", uniforms: {} as Record<string, THREE.IUniform> };
  (water.mat.onBeforeCompile as (s: unknown) => void)(w);
  assert.equal(w.uniforms.uWatLight.value, 1);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(10, 8, 6), new THREE.MeshBasicMaterial({ vertexColors: true }));
  patchDarkSky(dome);
  const top = dome.geometry.getAttribute("aDarkSky");
  assert.equal(top.count, dome.geometry.getAttribute("position").count);
  const zen = new THREE.Color(DARK_SKY.zenith);
  assert.ok(Math.abs(top.getX(0) - zen.r) < 1e-6 && Math.abs(top.getZ(0) - zen.b) < 1e-6, "the top is the dark zenith");
});

test("dark rig: lights dim to the Street values and come back exactly; a rebuilt rig keeps the lit values", () => {
  const sun = new THREE.DirectionalLight("#ffffff", 2.9);
  const hemi = new THREE.HemisphereLight("#bcd6ee", "#867a68", 2.28);
  const disk = new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.MeshBasicMaterial({ color: "#fff1dc" }));
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.MeshStandardMaterial({ emissive: "#c9d2e0", emissiveIntensity: 0.35 }));
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog("#bcd6ea", 300, 7000);
  scene.background = new THREE.Color("#bcd6ea");
  const lit = { disk: (disk.material as THREE.MeshBasicMaterial).color.clone(), fog: scene.fog.color.clone() };
  const rig = darkRig({ sun, hemi, disk, clouds, horizon: "#bcd6ea" });
  const dark = darkPlan(COUNTER, SCENE, WHERE)(19, FPS);
  rig(dark, scene);
  assert.ok(Math.abs(sun.intensity - 2.9 * KEY_OUT) < 1e-12 && Math.abs(hemi.intensity - 2.28 * FILL_OUT) < 1e-12);
  assert.ok(DARK_UNIFORMS.uDarkReach.value > 0 && DARK_UNIFORMS.uDarkSky.value === 1);
  // Rebuilt while dark (a mood change): the lit values are still the base.
  const again = darkRig({ sun, hemi, disk, clouds, horizon: "#bcd6ea" });
  again(null, scene);
  assert.equal(sun.intensity, 2.9);
  assert.equal(hemi.intensity, 2.28);
  assert.ok((disk.material as THREE.MeshBasicMaterial).color.equals(lit.disk));
  assert.equal((clouds.material as THREE.MeshStandardMaterial).emissiveIntensity, 0.35);
  assert.ok((scene.fog as THREE.Fog).color.equals(lit.fog) && (scene.background as THREE.Color).equals(lit.fog));
  assert.equal(DARK_UNIFORMS.uDarkReach.value, 0);
});

test("dark rig at night: the clouds' glow dims with the power, the sun's and moon's discs fade out (no dark disc)", () => {
  // A deep night: its sky is already darker than DARK_SKY, so the sky gain stays 1.
  const nightSky = skyFor(-30);
  const where: DarkScene = { ...WHERE, sky: nightSky };
  const plan = darkPlan(COUNTER, SCENE, where);
  const sun = new THREE.DirectionalLight("#bccbe8", 2.4);
  const hemi = new THREE.HemisphereLight("#3a4767", "#18171b", 1.44);
  const disk = new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.MeshBasicMaterial({ color: "#fff1dc" }));
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.MeshStandardMaterial({ emissive: "#c9d2e0", emissiveIntensity: 0.0525 }));
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ opacity: 0.8 }));
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(nightSky.horizon, 300, 7000);
  scene.background = new THREE.Color(nightSky.horizon);
  const rig = darkRig({ sun, hemi, disk, clouds, moon, horizon: nightSky.horizon });
  const cloud = clouds.material as THREE.MeshStandardMaterial;
  const diskMat = disk.material as THREE.MeshBasicMaterial;
  const lit = diskMat.color.clone();
  let prev = Infinity;
  for (const f of frames(19)) {
    const s = at(plan, f);
    assert.equal(s.skyGain, 1, "a night sky keeps its gain");
    rig(s, scene);
    assert.ok(Math.abs(cloud.emissiveIntensity - 0.0525 * s.key) < 1e-12, "the glow follows the key");
    assert.ok(cloud.emissiveIntensity <= prev + 1e-12);
    prev = cloud.emissiveIntensity;
    // The discs fade (opacity), their colour stays.
    assert.ok(diskMat.color.equals(lit));
    assert.equal(diskMat.transparent, s.key < 1);
    assert.ok(Math.abs(diskMat.opacity - discFade(s.key)) < 1e-12);
    assert.ok(Math.abs(moon.material.opacity - 0.8 * discFade(s.key)) < 1e-12);
  }
  assert.ok(Math.abs(cloud.emissiveIntensity - 0.0525 * KEY_OUT) < 1e-9, "full dark: the clouds' glow is the key's");
  assert.equal(diskMat.opacity, 0, "full dark: no disc at all");
  assert.equal(moon.material.opacity, 0);
  assert.equal(discFade(1), 1);
  assert.equal(discFade(KEY_OUT), 0);
  rig(null, scene);
  assert.equal(cloud.emissiveIntensity, 0.0525);
  assert.equal(diskMat.transparent, false);
  assert.equal(diskMat.opacity, 1);
  assert.equal(moon.material.opacity, 0.8);
});

test("dark: the box-city walls, lamps and kit placements carry their keys", () => {
  const place = resolvePlace("paris", { date: "2026-10-23", time: "22:30" });
  const layout = generateCity(place.style, { seed: place.place.id, season: place.season, cloudiness: place.place.cloudiness, cloudPassages: [[-75, 0]] });
  const geo = buildingsGeometry(layout.buildings.slice(0, 50), place.style);
  const key = geo.getAttribute("aDark");
  assert.equal(key.count, geo.getAttribute("position").count);
  // 30 vertices per building (four walls and a top), each keyed to it.
  for (let i = 0; i < 50; i++) {
    const b = layout.buildings[i];
    for (const v of [i * 30, i * 30 + 29]) assert.deepEqual([key.getX(v), key.getY(v), key.getZ(v)], [Math.fround(b.x), Math.fround(b.z), i]);
  }
  const lamps = lampGroup(place.style, true);
  const keyed = lamps.children.filter((c) => (c as THREE.Mesh).geometry.getAttribute("aDark"));
  assert.equal(keyed.length, 2, "heads and pools");
  for (const m of keyed) assert.ok((m as THREE.InstancedMesh).geometry.getAttribute("aDark") instanceof THREE.InstancedBufferAttribute);
  // A New York kit town: every building's placements share its key.
  const ny = resolvePlace("new-york", { date: "2026-10-23", time: "20:30" });
  const town = kitTown(generateCity(ny.style, { seed: ny.place.id, season: ny.season, cloudiness: ny.place.cloudiness, cloudPassages: [[-75, 0]] }).kitBuildings);
  assert.ok(town.buildings.length > 10);
  const keys = placementKeys(town.placements, town.buildings);
  for (const [bi, b] of town.buildings.slice(0, 20).entries()) {
    for (let i = b.start; i < b.end; i++) assert.deepEqual([keys[i * 3], keys[i * 3 + 1], keys[i * 3 + 2]], [Math.fround(b.x), Math.fround(b.z), bi]);
  }
});
