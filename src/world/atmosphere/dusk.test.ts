import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { buildKitNear, type KitModel } from "../KitInstances";
import { farCity, type CardAtlas } from "../kitFar";
import { clearWindowGlowCache, windowGlowMaterialFor } from "../kitWindows";
import { resolvePlace } from "../places";
import { darkLit, darkPlan, darkRand, type DarkKey, type DarkScene } from "../react/dark";
import { DARK_UNIFORMS, DUSK_UNIFORMS, patchDarkEmissive, patchDuskEmissive, setDuskUniform } from "../react/darkShader";
import type { ReactionSpec } from "../react/reaction";
import { lapseClock } from "../lapse";
import { NIGHT_FROM, NIGHT_FULL, nightFor, skyFor } from "../sky";
import { lampGroup } from "./dressing";
import {
  CAR_LIGHTS_LEAD,
  DUSK_FROM,
  DUSK_FULL,
  DUSK_GLSL,
  DUSK_RAMP,
  LAMP_ON_FROM,
  LAMP_ON_SPAN,
  LAMP_RAMP,
  LAMP_RUN,
  carLightsFor,
  duskFor,
  duskLit,
  duskMix,
  duskThreshold,
  isDusk,
  lampLit,
  lampThreshold,
  windowLit,
} from "./dusk";
import { SUN_KEY_FROM, sunKeyFor } from "./moon";
import { lampSpots } from "./night";
import { STARS_FROM, starsFor } from "./stars";

/** Sun elevations from 60 deg up to 60 deg down, every 0.01 deg. */
const SWEEP = Array.from({ length: 12001 }, (_, i) => 60 - i * 0.01);
/** Dusk amounts 0, 0.02 .. 1. */
const AMOUNTS = Array.from({ length: 51 }, (_, i) => i / 50);
/** Many buildings' keys (ids as the box city's and the kit town's indices). */
const HOUSES: DarkKey[] = Array.from({ length: 20000 }, (_, i) => [((i * 37) % 900) - 450, ((i * 91) % 700) - 350, i]);
/** The lamps' keys as dressing.ts gives them (lights-out ids from 1 000 000). */
const LAMPS: DarkKey[] = lampSpots(resolvePlace("paris", { date: "2026-10-23", time: "22:30" }).style).map((s, i) => [s.x, s.z, 1_000_000 + i]);

/** The city's mean light at a dusk amount, for thresholds uniform in
 *  [0, 1 - R) and a smoothstep over R from each: (R / (1 - R)) times the
 *  smoothstep's integral between (a - 1 + R) / R and a / R. */
function meanLight(a: number, R = DUSK_RAMP): number {
  const S = (u: number) => (u <= 0 ? 0 : u >= 1 ? u - 0.5 : u ** 3 - u ** 4 / 2);
  return (R / (1 - R)) * (S(a / R) - S((a - 1 + R) / R));
}

/** The elevation (degrees) at which the dusk reaches an amount (bisection). */
function elevationAt(amount: number): number {
  let hi = DUSK_FROM;
  let lo = DUSK_FULL;
  for (let i = 0; i < 60; i++) {
    const mid = (hi + lo) / 2;
    if (duskFor(mid) < amount) hi = mid;
    else lo = mid;
  }
  return (hi + lo) / 2;
}

test("dusk: exactly 0 by day and 1 at night, monotone and continuous between", () => {
  for (const e of [DUSK_FROM, 5.0001, 8, 30, 90]) assert.equal(duskFor(e), 0, `day at ${e}`);
  for (const e of [DUSK_FULL, -4.0001, -12, -60]) assert.equal(duskFor(e), 1, `night at ${e}`);
  let prev = duskFor(SWEEP[0]);
  for (const e of SWEEP.slice(1)) {
    const d = duskFor(e);
    assert.ok(d >= prev, `monotone at ${e.toFixed(2)}`);
    // A smoothstep over 9 degrees: never more than 0.0017 per 0.01 degree.
    assert.ok(d - prev < 0.002, `no jump at ${e.toFixed(2)} (${prev} -> ${d})`);
    assert.equal(isDusk(d), e < DUSK_FROM && e > DUSK_FULL, `in the band at ${e.toFixed(2)}`);
    prev = d;
  }
});

test("dusk: day and night map onto today's switch at 1 degree (only the band draws differently)", () => {
  // Every elevation fully lit was night before (elevation < 1), every one
  // with nothing lit was day: those frames take exactly today's code path.
  for (const e of SWEEP) {
    const d = duskFor(e);
    if (d === 1) assert.ok(e < 1, `lit at ${e}, day before`);
    if (d === 0) assert.ok(e >= 1, `unlit at ${e}, night before`);
  }
  // The changed frames: strictly between DUSK_FULL and DUSK_FROM.
  assert.ok(DUSK_FULL < 1 && DUSK_FROM > 1);
});

test("dusk: the lights lead the darkening sky, and the city is lit before the stars", () => {
  // The first windows light while the sun key and the sky are still the day's.
  assert.ok(DUSK_FROM > SUN_KEY_FROM && DUSK_FROM > NIGHT_FROM);
  assert.equal(sunKeyFor(DUSK_FROM), 1);
  assert.equal(nightFor(DUSK_FROM), 0);
  // More than half the city is lit as the sky starts to go to night ...
  assert.ok(duskFor(NIGHT_FROM) > 0.5, `${duskFor(NIGHT_FROM)}`);
  // ... and all of it while the sky is still mostly dusk's, as the first stars show.
  assert.ok(DUSK_FULL > NIGHT_FULL && nightFor(DUSK_FULL) < 0.3, `${nightFor(DUSK_FULL)}`);
  assert.ok(DUSK_FULL >= STARS_FROM && starsFor(DUSK_FULL) === 0);
  // Half the city is lit just after sunset.
  const half = elevationAt(0.5);
  assert.ok(half > 0 && half < 1, `${half}`);
});

test("dusk: car lights follow the dusk a degree early, 0 from 6 degrees up and 1 from 3 down as before", () => {
  const before = (e: number) => Math.max(0, Math.min(1, (6 - e) / 6));
  for (const e of SWEEP) {
    const c = carLightsFor(e);
    assert.equal(c, duskFor(e - CAR_LIGHTS_LEAD));
    assert.ok(c >= duskFor(e), `the cars lead at ${e}`);
    // Today's ends: off from 6 degrees up, on from 0 down; the curve's are inside them.
    if (e >= 6) assert.equal(c, before(e), `off at ${e}`);
    if (e <= DUSK_FULL + CAR_LIGHTS_LEAD) assert.equal(c, 1, `on at ${e}`);
    if (c === 1) assert.equal(before(e), 1, `fully on at ${e} as before`);
  }
});

test("dusk: each building's turn is seeded by its key, and the city's light tracks the dusk amount", () => {
  // Deterministic, uniform in [0, 1 - DUSK_RAMP), by the id alone (the place does not move it).
  for (const k of HOUSES.slice(0, 200)) {
    assert.equal(duskThreshold(k), duskThreshold([k[0] + 500, k[1] - 70, k[2]]));
    assert.ok(duskThreshold(k) >= 0 && duskThreshold(k) < 1 - DUSK_RAMP);
  }
  for (const a of AMOUNTS) {
    const lit = HOUSES.reduce((n, k) => n + duskLit(k, a), 0) / HOUSES.length;
    assert.ok(Math.abs(lit - meanLight(a)) < 0.015, `${(lit * 100).toFixed(1)} % lit at ${a}, ${(meanLight(a) * 100).toFixed(1)} expected`);
    assert.ok(Math.abs(lit - a) < DUSK_RAMP / 2 + 0.015, `${(lit * 100).toFixed(1)} % lit at ${a}`);
  }
  assert.ok(Math.abs(meanLight(0.5) - 0.5) < 1e-12, "half the city's light at half the dusk");
  assert.ok(HOUSES.every((k) => duskLit(k, 0) === 0), "none by day");
  assert.ok(HOUSES.every((k) => duskLit(k, 1) === 1), "all, fully, at night");
  // Once lit, lit for good as the dusk deepens (the city fills in, nothing blinks off).
  for (const k of HOUSES.slice(0, 2000)) {
    let was = 0;
    for (const a of AMOUNTS) {
      const now = duskLit(k, a);
      assert.ok(now >= was, `building ${k[2]} went dark at ${a}`);
      was = now;
    }
  }
  // Not the blackout's jitter (dark.ts salts it 7): a building's turn tells nothing of its place in the wave.
  let same = 0;
  for (const k of HOUSES.slice(0, 4000)) if (duskThreshold(k) < (1 - DUSK_RAMP) / 2 === darkRand(k[2], 7) < 0.5) same++;
  assert.ok(same > 1800 && same < 2200, `${same}`);
  // Neighbouring buildings do not light together.
  let pairs = 0;
  for (let i = 0; i < 4000; i++) if (duskLit(HOUSES[i], 0.5) > 0.5 === duskLit(HOUSES[i + 1], 0.5) > 0.5) pairs++;
  assert.ok(pairs > 1800 && pairs < 2200, `${pairs}`);
});

test("dusk: each building fades in over DUSK_RAMP; a still scene shows few part way", () => {
  for (const k of HOUSES.slice(0, 2000)) {
    const th = duskThreshold(k);
    assert.equal(duskLit(k, th), 0, "dark at its threshold");
    assert.equal(duskLit(k, th + DUSK_RAMP), 1, "fully lit one ramp on");
    assert.ok(Math.abs(duskLit(k, th + DUSK_RAMP / 2) - 0.5) < 1e-9, "half way at the ramp's middle");
    assert.ok(duskLit(k, th + DUSK_RAMP / 4) > 0 && duskLit(k, th + DUSK_RAMP / 4) < 0.5);
  }
  // A still dusk scene: about DUSK_RAMP / (1 - DUSK_RAMP) of its buildings
  // part way (8.5 %), a third of them between a quarter and three quarters lit.
  for (const a of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    const v = HOUSES.map((k) => duskLit(k, a));
    const part = v.filter((x) => x > 0 && x < 1).length / v.length;
    const half = v.filter((x) => x >= 0.25 && x <= 0.75).length / v.length;
    assert.ok(Math.abs(part - DUSK_RAMP / (1 - DUSK_RAMP)) < 0.01, `${(part * 100).toFixed(1)} % part way at ${a}`);
    assert.ok(half < 0.035, `${(half * 100).toFixed(1)} % half lit at ${a}`);
  }
});

test("dusk in a time lapse: a building comes on over about a third of a second, never in one frame", () => {
  // The verifier's lapse: Paris on 2026-10-23, 17:00 to 19:30 in 12 s at 30 fps.
  const FPS = 30;
  const clock = lapseClock({ place: "paris", date: "2026-10-23", time: "17:00", lapse: { to: "19:30" } }, { from: 0, to: 12 })!;
  const dusk = Array.from({ length: 12 * FPS }, (_, f) => duskFor(clock.at(f / FPS).sun.elevation));
  assert.equal(dusk[0], 0);
  assert.equal(dusk[dusk.length - 1], 1);
  const spans: number[] = [];
  for (const k of HOUSES.slice(0, 3000)) {
    let first = -1;
    let full = -1;
    let prev = 0;
    for (let f = 0; f < dusk.length; f++) {
      const v = duskLit(k, dusk[f]);
      // Before the ramp a building went from dark to fully lit between two frames.
      assert.ok(v - prev < 0.2, `building ${k[2]} gained ${v - prev} at f${f}`);
      if (v > 0 && first < 0) first = f;
      if (v === 1 && full < 0) full = f;
      prev = v;
    }
    spans.push((full - first + 1) / FPS);
  }
  spans.sort((x, y) => x - y);
  const median = spans[spans.length >> 1];
  const p90 = spans[Math.floor(spans.length * 0.9)];
  assert.ok(spans[0] >= 0.3 && median > 0.3 && median < 0.45 && p90 < 0.65, `${spans[0]} / ${median} / ${p90} s`);
});

test("dusk: the street lamps switch by stretch of avenue, around sunset", () => {
  assert.ok(LAMPS.length > 20);
  // A stretch (LAMP_RUN consecutive lamps) shares one photocell.
  for (const k of LAMPS) assert.equal(lampThreshold(k), lampThreshold(LAMPS[Math.floor((k[2] - 1_000_000) / LAMP_RUN) * LAMP_RUN]));
  const runs = new Set(LAMPS.map((k) => lampThreshold(k)));
  assert.ok(runs.size >= Math.floor(LAMPS.length / LAMP_RUN), `${runs.size} stretches`);
  for (const th of runs) assert.ok(th >= LAMP_ON_FROM && th < LAMP_ON_FROM + LAMP_ON_SPAN);
  // A stretch warms up over LAMP_RAMP from its turn.
  for (const k of LAMPS) {
    const th = lampThreshold(k);
    assert.equal(lampLit(k, th), 0);
    assert.ok(Math.abs(lampLit(k, th + LAMP_RAMP / 2) - 0.5) < 1e-9);
    assert.equal(lampLit(k, th + LAMP_RAMP), 1);
  }
  // None before LAMP_ON_FROM, all fully on by LAMP_ON_FROM + LAMP_ON_SPAN +
  // LAMP_RAMP (well before 1), filling in between.
  assert.ok(LAMP_ON_FROM + LAMP_ON_SPAN + LAMP_RAMP < 0.9);
  for (const a of AMOUNTS) {
    const on = LAMPS.reduce((n, k) => n + lampLit(k, a), 0);
    if (a <= LAMP_ON_FROM) assert.equal(on, 0, `lamps on at ${a}`);
    if (a >= LAMP_ON_FROM + LAMP_ON_SPAN + LAMP_RAMP) assert.equal(on, LAMPS.length, `lamps off at ${a}`);
  }
  assert.equal(LAMPS.reduce((n, k) => n + lampLit(k, 1), 0), LAMPS.length);
  // In degrees: from the sun on the horizon to about 2 degrees down.
  const first = elevationAt(LAMP_ON_FROM);
  const last = elevationAt(LAMP_ON_FROM + LAMP_ON_SPAN + LAMP_RAMP);
  assert.ok(first > -0.5 && first < 0.5 && last > -2.2 && last < -1.5, `${first} .. ${last}`);
});

test("dusk and lights out combine: a window is lit only if the dusk lit it and the wave has not put it out", () => {
  const spec: ReactionSpec = { statPanel: { beats: [{ t: 0.5, value: "1", zoom: 1, sub: "", scale: 1 }], react: "money" }, worldEvents: [{ t: 1, name: "lights-out" }] };
  const where: DarkScene = { centre: [0, 0], extent: 900, sky: skyFor(0) };
  const plan = darkPlan(spec, { from: 0, to: 10 }, where);
  const keys = HOUSES.slice(0, 600);
  for (const a of [0, 0.3, 0.7, 1]) {
    for (const t of [0, 1.5, 2.2, 4, 9]) {
      const s = plan(t, 30);
      for (const k of keys) assert.equal(windowLit(k, a, s), darkLit(k, s) * duskLit(k, a));
    }
  }
  // At rest the wave changes nothing; at full dark nothing is lit, however far the dusk.
  const rest = plan(0, 30);
  for (const k of keys) assert.equal(windowLit(k, 0.4, rest), duskLit(k, 0.4));
  assert.ok(keys.some((k) => windowLit(k, 0.4, rest) > 0 && windowLit(k, 0.4, rest) < 1), "some part way");
  const out = plan(9, 30);
  for (const k of keys) assert.equal(windowLit(k, 1, out), 0);
});

test("duskMix: exactly the day value at 0 and the night one at 1", () => {
  assert.equal(duskMix(0, 1, 0.4), 1);
  assert.equal(duskMix(1, 1, 0.4), 0.4);
  assert.equal(duskMix(-0.5, 1, 0.4), 1);
  assert.equal(duskMix(2, 1, 0.4), 0.4);
  let prev = 1;
  for (const a of AMOUNTS.slice(1, -1)) {
    const v = duskMix(a, 1, 0.4);
    assert.ok(v < prev && v > 0.4);
    prev = v;
  }
});

test("dusk shader: DUSK_GLSL is duskLit and lampLit; the dusk patches name themselves and carry the wave", () => {
  assert.ok(DUSK_GLSL.includes("uniform float uDusk;") && DUSK_GLSL.includes("float t = clamp( x, 0.0, 1.0 );\n  return t * t * ( 3.0 - 2.0 * t );"));
  assert.ok(DUSK_GLSL.includes(`dkDuskRamp( ( uDusk - ${1 - DUSK_RAMP} * dkRand( id, 16000001.0 ) ) / ${DUSK_RAMP} )`));
  assert.ok(DUSK_GLSL.includes(`uint( id ) / ${LAMP_RUN}u`));
  assert.ok(DUSK_GLSL.includes(`dkDuskRamp( ( uDusk - ( ${LAMP_ON_FROM} + ${LAMP_ON_SPAN} * dkRand( run, 16000003.0 ) ) ) / ${LAMP_RAMP} )`));
  // The shader's floats: DUSK_RAMP and 1 - DUSK_RAMP are exact, so at uDusk 0
  // nothing is lit and at 1 everything fully, for every key (dkRand is k / 2^24),
  // and in between the shader's turn is the TypeScript's to float precision.
  const F = Math.fround;
  assert.equal(F(DUSK_RAMP), DUSK_RAMP);
  assert.equal(F(1 - DUSK_RAMP), 1 - DUSK_RAMP);
  const ramp = (x: number) => {
    const t = Math.max(0, Math.min(1, x));
    return F(F(t * t) * F(3 - F(2 * t)));
  };
  const dkDusk = (r: number, u: number) => ramp(F(F(u - F(F(1 - DUSK_RAMP) * r)) / F(DUSK_RAMP)));
  const ends = [0, 1 / 16777216, 0.5, 1 - 2 / 16777216, 1 - 1 / 16777216];
  for (const r of [...ends, ...HOUSES.slice(0, 2000).map((k) => darkRand(k[2], 16_000_001))]) {
    assert.equal(dkDusk(r, 0), 0);
    assert.equal(dkDusk(r, 1), 1);
  }
  for (const k of HOUSES.slice(0, 2000)) {
    for (const a of AMOUNTS) assert.ok(Math.abs(dkDusk(darkRand(k[2], 16_000_001), F(a)) - duskLit(k, a)) < 1e-5);
  }
  const mat = new THREE.MeshStandardMaterial({ emissive: "#ffffff" });
  patchDuskEmissive(mat);
  const key = mat.customProgramCacheKey();
  assert.ok(key.endsWith("|dusk-emissive-windows"));
  // One patch per material: a lights-out patch after it changes nothing (it carries the wave already).
  const once = mat.onBeforeCompile;
  patchDarkEmissive(mat);
  assert.equal(mat.onBeforeCompile, once);
  assert.equal(mat.customProgramCacheKey(), key);
  const shader = {
    vertexShader: "void main() {\n#include <begin_vertex>\n}",
    fragmentShader: "void main() {\n#include <emissivemap_fragment>\n}",
    uniforms: {} as Record<string, THREE.IUniform>,
  };
  (mat.onBeforeCompile as (s: unknown) => void)(shader);
  assert.ok(shader.vertexShader.includes("vDarkLit = dkLit( aDark ) * mix( uDuskOff, 1.0, dkDusk( aDark.z ) );"));
  assert.ok(shader.vertexShader.indexOf("float dkRand") < shader.vertexShader.indexOf("float dkDusk"), "the dusk reads the dark's hash");
  assert.equal((shader.vertexShader.match(/attribute vec3 aDark;/g) ?? []).length, 1);
  assert.ok(shader.fragmentShader.includes("totalEmissiveRadiance *= vDarkLit;"));
  assert.equal(shader.uniforms.uDusk, DUSK_UNIFORMS.uDusk);
  assert.equal(shader.uniforms.uDarkReach, DARK_UNIFORMS.uDarkReach);
  assert.equal(shader.uniforms.uDuskOff.value, 0);
  setDuskUniform(0.37);
  assert.equal(DUSK_UNIFORMS.uDusk.value, 0.37);
  setDuskUniform(0);
});

/** A material's shader as its patches leave it (a stand-in for three's chunks). */
function compiled(mat: THREE.Material) {
  const shader = {
    vertexShader: "void main() {\n#include <begin_vertex>\n}",
    fragmentShader: "void main() {\n#include <emissivemap_fragment>\n#include <opaque_fragment>\n}",
    uniforms: {} as Record<string, THREE.IUniform>,
  };
  (mat.onBeforeCompile as (s: unknown) => void)(shader);
  return { key: mat.customProgramCacheKey(), vertex: shader.vertexShader, fragment: shader.fragmentShader };
}

/** The lamp group's meshes: their kind, the materials' looks and programs. */
function lampLook(group: THREE.Group) {
  return group.children.map((c) => {
    const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial & THREE.MeshBasicMaterial;
    return { geometry: (c as THREE.Mesh).geometry.type, opacity: m.opacity, emissive: m.emissiveIntensity, ...compiled(m) };
  });
}

test("dusk lamps: day and night are today's lamps exactly; at dusk each stretch waits for its turn", () => {
  const style = resolvePlace("paris", { date: "2026-10-23", time: "22:30" }).style;
  // Day (0) and night (1) take exactly the boolean's path: same meshes, looks and programs.
  assert.deepEqual(lampLook(lampGroup(style, 0)), lampLook(lampGroup(style, false)));
  assert.deepEqual(lampLook(lampGroup(style, 1)), lampLook(lampGroup(style, true)));
  const night = lampLook(lampGroup(style, true));
  assert.ok(night.some((l) => l.key.endsWith("|dark-emissive")) && night.some((l) => l.key.endsWith("|dark-basic")));
  assert.ok(night.every((l) => !l.vertex.includes("dkDusk") && !l.vertex.includes("uDusk")));
  // Dusk: the night's meshes and looks, the lamps' dusk turn in their programs.
  const dusk = lampLook(lampGroup(style, 0.7));
  assert.deepEqual(
    dusk.map((l) => [l.geometry, l.opacity, l.emissive]),
    night.map((l) => [l.geometry, l.opacity, l.emissive]),
  );
  assert.ok(dusk.some((l) => l.key.endsWith("|dusk-emissive-lamps")) && dusk.some((l) => l.key.endsWith("|dusk-basic-lamps")));
  for (const l of dusk.filter((x) => x.key.includes("|dusk-"))) assert.ok(l.vertex.includes("dkLampDusk( aDark.z )"));
  // A head not yet on keeps its day glow (0.02 of a night head's 1.6).
  const heads = lampGroup(style, 0.7).children.find((c) => ((c as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity === 1.6)!;
  const shader = { vertexShader: "#include <begin_vertex>", fragmentShader: "#include <emissivemap_fragment>", uniforms: {} as Record<string, THREE.IUniform> };
  ((heads as THREE.Mesh).material as THREE.Material).onBeforeCompile(shader as never, undefined as never);
  assert.ok(Math.abs(shader.uniforms.uDuskOff.value * 1.6 - 0.02) < 1e-12);
});

test("dusk kit glow: a separate material and program; the night copy is untouched", () => {
  clearWindowGlowCache();
  const glass = new THREE.MeshStandardMaterial({ name: "glass" });
  const night = windowGlowMaterialFor(glass, "#ffc073", 2.4)!;
  assert.equal(windowGlowMaterialFor(glass, "#ffc073", 2.4, false), night, "false is the night copy");
  const dusk = windowGlowMaterialFor(glass, "#ffc073", 2.4, true)!;
  assert.notEqual(dusk, night);
  assert.equal(windowGlowMaterialFor(glass, "#ffc073", 2.4, true), dusk, "shared per source material");
  assert.ok(dusk.customProgramCacheKey().endsWith("|dusk") && dusk.customProgramCacheKey() !== night.customProgramCacheKey());
  assert.equal(night.customProgramCacheKey(), night.onBeforeCompile.toString(), "the night copy keeps three's own key");
  const run = (m: THREE.Material) => {
    const s = { vertexShader: "#include <uv_vertex>", fragmentShader: "#include <colorspace_fragment>", uniforms: {} as Record<string, THREE.IUniform> };
    (m.onBeforeCompile as (x: unknown) => void)(s);
    return s;
  };
  const n = run(night);
  assert.ok(n.vertexShader.includes("#ifdef USE_INSTANCING_COLOR\n  vDarkLit = dkLit( instanceColor );\n#else\n  vDarkLit = 1.0;"));
  assert.ok(!n.vertexShader.includes("dkDusk") && !("uDusk" in n.uniforms));
  const d = run(dusk);
  assert.ok(d.vertexShader.includes("vDarkLit = dkLit( instanceColor ) * dkDusk( instanceColor.z );") && d.vertexShader.includes("uniform float uDusk;"));
  assert.equal(d.uniforms.uDusk, DUSK_UNIFORMS.uDusk);
  assert.equal(d.fragmentShader, n.fragmentShader, "the same glow, only its turn differs");

  // The near pieces: the dusk copy only in a dusk scene.
  const model: KitModel = { file: "glass.glb", parts: [{ geometry: new THREE.BoxGeometry(1, 1, 1), material: glass, matrix: new THREE.Matrix4() }] };
  const models = new Map([[model.file, model]]);
  const placements = [0, 1, 2].map((i) => ({ file: model.file, x: i * 10, y: 0, z: 0, rotY: 0, scale: 1 }));
  const of = new Int32Array([0, 0, 1]);
  const glowOf = (opts: { windowGlow?: boolean; dusk?: boolean }) =>
    buildKitNear(placements as never, models, of, opts).group.children.map((c) => (c as THREE.Mesh).material);
  assert.deepEqual(glowOf({ windowGlow: true }), [glass, night]);
  assert.deepEqual(glowOf({ windowGlow: true, dusk: false }), [glass, night]);
  assert.deepEqual(glowOf({ windowGlow: true, dusk: true }), [glass, dusk]);
  assert.deepEqual(glowOf({ dusk: true }), [glass], "no glow, no dusk");
  clearWindowGlowCache();
});

test("dusk far cards: farCity patches the cards for the dusk in a dusk scene, for lights out alone otherwise", () => {
  const glowMap = new THREE.DataTexture(new Uint8Array(16), 2, 2);
  const atlas = { faces: new Map(), map: new THREE.DataTexture(new Uint8Array(16), 2, 2), glow: glowMap, width: 2, height: 2, dispose() {} } as CardAtlas;
  const placements = [{ file: "a.glb", x: 0, y: 0, z: 0, rotY: 0, scale: 1 }];
  const buildings = [{ start: 0, end: 1, x: 0, z: 0 }] as never;
  const night = farCity(placements, buildings, atlas).mesh.material as THREE.MeshStandardMaterial;
  const lit = farCity(placements, buildings, atlas, { dusk: true }).mesh.material as THREE.MeshStandardMaterial;
  assert.ok(night.customProgramCacheKey().includes("dark-emissive") && !night.customProgramCacheKey().includes("dusk"), "the night's cards: lights out alone");
  assert.ok(lit.customProgramCacheKey().endsWith("|dusk-emissive-windows"));
  assert.ok(!lit.customProgramCacheKey().includes("dark-emissive"), "one patch or the other, never both");
  const s = compiled(lit);
  assert.equal((s.vertex.match(/attribute vec3 aDark;/g) ?? []).length, 1, "one key attribute");
  assert.ok(s.vertex.includes("dkLit( aDark ) * mix( uDuskOff, 1.0, dkDusk( aDark.z ) )"));
  // The same look: the glow atlas, its strength, the cut-outs.
  assert.equal(lit.emissiveMap, glowMap);
  assert.equal(lit.emissiveIntensity, 1.2);
  assert.ok(lit.emissive.equals(night.emissive));
  assert.equal(lit.alphaTest, 0.5);
  assert.equal(lit.name, "kit-far-cards");
});
