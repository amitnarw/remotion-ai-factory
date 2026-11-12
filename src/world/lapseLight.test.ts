import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { generateCity } from "./city";
import { sunAt } from "./geo";
import { landmarksFor } from "./landmarks";
import { lapseClock, type LapseWorld } from "./lapse";
import { DUSK_BUILD, elevationRange, lapseLight, lapseShape, placeLight } from "./lapseLight";
import { resolvePlace } from "./places";
import { mixHex, nightFor, skyFor, sunGlowFor } from "./sky";
import { paintSkyDome, skyDome } from "./skyDome";
import { placeTraffic, PRESENT, trafficPlan, type TrafficPlan } from "./traffic";
import { carLightsFor, duskFor, isDusk } from "./atmosphere/dusk";
import { applyHeightFog, heightFogLive, setHeightFogLive, type HeightFogOptions } from "./atmosphere/fog";
import { keyFor, moonFor } from "./atmosphere/moon";
import { shaftStrength, sunShafts } from "./atmosphere/shafts";
import { starsFor } from "./atmosphere/stars";
import { setWaterLive, waterLive, waterMaterial } from "./atmosphere/water";
import { darkRig, type DarkLit } from "./react/darkShader";

const FPS = 30;
const SCENE = { from: 4, to: 14 };

/** Lapses through every kind of light: a dusk, a day, a night, a dawn, and a
 *  long one over noon to night. */
const LAPSES: LapseWorld[] = [
  { place: "paris", date: "2026-10-30", time: "17:00", lapse: { to: "19:30" } },
  { place: "paris", date: "2026-06-21", time: "09:00", lapse: { to: "13:00" } },
  { place: "colmar", date: "2026-12-10", time: "20:00", lapse: { to: "23:30" } },
  { place: "cairo", date: "2026-03-15", time: "04:30", lapse: { to: "07:30" } },
  { place: "new-york", date: "2026-10-23", time: "11:00", lapse: { to: "22:00" } },
];

const clockOf = (w: LapseWorld) => {
  const clock = lapseClock(w, SCENE);
  assert.ok(clock, `${w.place} ${w.time}-${w.lapse?.to} has a clock`);
  return clock;
};

/** Every frame's video time in the scene. */
const frames = () => Array.from({ length: Math.round((SCENE.to - SCENE.from) * FPS) + 1 }, (_, i) => SCENE.from + i / FPS);

test("lapse light: the first frame lights the place as the static scene at its start does", () => {
  for (const w of LAPSES) {
    const start = resolvePlace(w.place, { date: w.date, time: w.time });
    const e = start.sun.elevation;
    const L = placeLight(start);
    // GroundWorld's own formulas for a scene without a lapse.
    const sky = skyFor(e, start.style.haze, start.style.outskirts[0]);
    assert.deepEqual(L.sky, sky);
    assert.deepEqual(L.key, keyFor(start.sun, sky));
    assert.deepEqual(L.moon, moonFor(start.sun));
    assert.deepEqual(L.fill, { sky: sky.ambientSky, ground: sky.ambientGround, intensity: sky.ambient * 2.4 });
    assert.equal(L.glow, sunGlowFor(e));
    assert.equal(L.night, nightFor(e));
    assert.equal(L.stars, starsFor(e));
    assert.equal(L.dusk, duskFor(e));
    assert.equal(L.carLights, carLightsFor(e));
    assert.equal(L.shafts, shaftStrength(e));
    assert.equal(L.disc, e > -1);
    assert.equal(L.birds, e > -2);
    assert.deepEqual(L.fog, { horizon: sky.horizon, zenith: sky.zenith, sunColor: sky.sunColor, sunDir: start.sun.dir, sunStrength: 0.35 * sunGlowFor(e) });
    assert.deepEqual(L.water, { sky: mixHex(sky.horizon, sky.zenith, 0.35), sunColor: sky.sunColor, sunDir: start.sun.dir });
    assert.equal(L.traffic, placeTraffic(start));
    // The clock's first frame (and anything before it) is that place, and so is the sun at its moment.
    const clock = clockOf(w);
    assert.deepEqual(placeLight(clock.at(SCENE.from)), L);
    assert.deepEqual(placeLight(clock.at(0)), L);
    assert.deepEqual(lapseLight(start, start.utcMs), L);
    // The last frame is the end's moment.
    assert.deepEqual(placeLight(clock.at(SCENE.to)), placeLight(resolvePlace(w.place, { date: w.date, time: w.lapse!.to })));
  }
});

test("lapse light: a pure function of the moment, the same in any frame order", () => {
  const clock = clockOf(LAPSES[0]);
  const ts = frames();
  const forward = ts.map((t) => JSON.stringify(placeLight(clock.at(t))));
  const shuffled = [...ts.keys()].sort((a, b) => ((a * 7919) % 101) - ((b * 7919) % 101));
  for (const i of shuffled) assert.equal(JSON.stringify(placeLight(clock.at(ts[i]))), forward[i]);
  // The light moves: Paris on 30 October from 17:00 to 19:30 goes from the low sun to night.
  const first = placeLight(clock.at(SCENE.from));
  const last = placeLight(clock.at(SCENE.to));
  assert.ok(first.sun.elevation > 3 && last.sun.elevation < -14, `${first.sun.elevation} -> ${last.sun.elevation}`);
  assert.equal(first.dusk < 0.5 && last.dusk === 1 && last.stars === 1, true);
  assert.equal(first.key.moon, false);
  assert.equal(last.key.moon, true);
});

test("lapse shape: every piece any frame shows is built from the first frame", () => {
  for (const w of LAPSES) {
    const clock = clockOf(w);
    const shape = lapseShape(clock.start, clock.end);
    for (const t of frames()) {
      const L = placeLight(clock.at(t));
      const at = `${w.place} ${w.time}-${w.lapse!.to} at ${t.toFixed(3)} s (sun ${L.sun.elevation.toFixed(2)})`;
      assert.ok(L.sun.elevation >= shape.low - 1e-9 && L.sun.elevation <= shape.high + 1e-9, `${at}: within the range`);
      // The materials: day's draw no window, night's every window, the dusk patches anything between.
      if (L.dusk > 0) assert.ok(shape.dusk > 0, `${at}: lit windows need the night's or the dusk's materials`);
      if (L.dusk < 1) assert.ok(shape.dusk < 1, `${at}: dark windows need the day's or the dusk's materials`);
      if (isDusk(L.dusk)) assert.equal(shape.dusk, DUSK_BUILD, `${at}: the dusk patches`);
      if (L.stars > 0) assert.ok(shape.stars, `${at}: stars`);
      if (L.moon.light > 0) assert.ok(shape.moon, `${at}: the moon`);
      if (L.shafts > 0) assert.ok(shape.shafts, `${at}: shafts`);
      if (L.birds) assert.ok(shape.birds, `${at}: the flock`);
    }
  }
});

test("lapse shape: a day lapse keeps the day's materials, a night lapse the night's, a dusk the patches", () => {
  const shapeOf = (i: number) => {
    const clock = clockOf(LAPSES[i]);
    return lapseShape(clock.start, clock.end);
  };
  const dusk = shapeOf(0);
  assert.equal(dusk.dusk, DUSK_BUILD);
  assert.deepEqual([dusk.stars, dusk.moon, dusk.shafts, dusk.birds], [true, true, true, true]);
  const day = shapeOf(1);
  assert.equal(day.dusk, 0);
  assert.deepEqual([day.stars, day.moon, day.birds], [false, false, true]);
  const night = shapeOf(2);
  assert.equal(night.dusk, 1);
  assert.deepEqual([night.stars, night.moon, night.shafts, night.birds], [true, true, false, false]);
  const dawn = shapeOf(3);
  assert.equal(dawn.dusk, DUSK_BUILD, "a dawn crosses the band the other way");
  assert.ok(dawn.birds && dawn.moon && dawn.shafts);
});

test("lapse shape: the sun's highest point between the ends counts (a lapse over noon)", () => {
  const start = resolvePlace("paris", { date: "2026-06-21", time: "09:00" });
  const end = resolvePlace("paris", { date: "2026-06-21", time: "18:00" });
  const [low, high] = elevationRange(start, end);
  assert.equal(low, Math.min(start.sun.elevation, end.sun.elevation));
  assert.ok(high > Math.max(start.sun.elevation, end.sun.elevation) + 10, `noon ${high}`);
  // Within a few hundredths of a degree of the highest sun of the day, minute by minute.
  let best = -90;
  for (let m = 0; m <= 9 * 60; m++) best = Math.max(best, sunAt(start.utcMs + m * 60_000, start.place.lat, start.place.lon).elevation);
  assert.ok(Math.abs(best - high) < 0.01, `${best} vs ${high}`);
  // At noon the sun is far above the shafts' gate (22): a lapse wholly above it builds none.
  const noon = lapseShape(resolvePlace("paris", { date: "2026-06-21", time: "12:00" }), resolvePlace("paris", { date: "2026-06-21", time: "15:00" }));
  assert.equal(noon.shafts, false);
});

test("sky dome: a repaint draws exactly the dome built for that sky, whatever it showed before", () => {
  const place = (time: string) => resolvePlace("paris", { date: "2026-10-30", time });
  const domeOf = (time: string) => {
    const L = placeLight(place(time));
    return { L, mesh: skyDome(L.sky, L.sun.dir, null, L.glow, L.night) };
  };
  const colours = (m: THREE.Mesh) => Array.from((m.geometry.getAttribute("color") as THREE.BufferAttribute).array);
  const dusk = domeOf("17:40");
  const night = domeOf("19:30");
  const day = domeOf("12:00");
  // Built at the day, repainted through the night to the dusk: the dusk's own colours.
  paintSkyDome(day.mesh, night.L.sky, night.L.sun.dir, night.L.glow, night.L.night);
  assert.deepEqual(colours(day.mesh), colours(night.mesh));
  paintSkyDome(day.mesh, dusk.L.sky, dusk.L.sun.dir, dusk.L.glow, dusk.L.night);
  assert.deepEqual(colours(day.mesh), colours(dusk.mesh));
  assert.ok((day.mesh.geometry.getAttribute("color") as THREE.BufferAttribute).version > 0, "the new colours are uploaded");
});

type Shader = { vertexShader: string; fragmentShader: string; uniforms: Record<string, THREE.IUniform> };
const fakeShader = (fragment: string): Shader => ({ vertexShader: "#include <project_vertex>", fragmentShader: fragment, uniforms: {} });
const compile = (mat: THREE.Material, fragment: string) => {
  const s = fakeShader(fragment);
  (mat.onBeforeCompile as (s: unknown) => void)(s);
  return s;
};
const sameValue = (a: THREE.IUniform, b: THREE.IUniform) => {
  const x = a.value as THREE.Color | THREE.Vector3;
  const y = b.value as THREE.Color | THREE.Vector3;
  return x.equals(y as never);
};

test("height fog and water: a lapse's shared uniforms start at the static values and are what every material reads", () => {
  const L0 = placeLight(resolvePlace("paris", { date: "2026-10-30", time: "17:00" }));
  const L1 = placeLight(resolvePlace("paris", { date: "2026-10-30", time: "18:20" }));
  const opts: HeightFogOptions = { ...L0.fog, density: 0.0012 };
  const still = new THREE.MeshStandardMaterial();
  applyHeightFog(still, opts);
  const stillShader = compile(still, "#include <fog_fragment>");
  const live = heightFogLive(opts);
  const a = new THREE.MeshStandardMaterial();
  const b = new THREE.MeshStandardMaterial();
  for (const m of [a, b]) applyHeightFog(m, { ...opts, live });
  const sa = compile(a, "#include <fog_fragment>");
  const sb = compile(b, "#include <fog_fragment>");
  for (const k of ["uHFogLo", "uHFogHi", "uHFogSun", "uHFogSunDir"] as const) {
    assert.ok(sameValue(sa.uniforms[k], stillShader.uniforms[k]), `${k}: the first frame's value is the static one`);
    assert.equal(sa.uniforms[k], live[k], `${k}: shared`);
    assert.equal(sb.uniforms[k], live[k], `${k}: shared`);
  }
  assert.equal(sa.fragmentShader, stillShader.fragmentShader, "the same program text");
  // A later frame's light, written once, reaches every material; written back, it is the start's again.
  setHeightFogLive(live, L1.fog);
  assert.ok(!sameValue(sa.uniforms.uHFogLo, stillShader.uniforms.uHFogLo));
  setHeightFogLive(live, L0.fog);
  for (const k of ["uHFogLo", "uHFogHi", "uHFogSun", "uHFogSunDir"] as const) assert.ok(sameValue(sa.uniforms[k], stillShader.uniforms[k]));

  const wOpts = { ...L0.water, deep: "#2e7d84" };
  const wStill = compile(waterMaterial(wOpts).mat, "#include <colorspace_fragment>");
  const wLive = waterLive(wOpts);
  const wLapse = compile(waterMaterial({ ...wOpts, live: wLive }).mat, "#include <colorspace_fragment>");
  for (const k of ["uWatSky", "uWatSun", "uWatSunDir"] as const) {
    assert.ok(sameValue(wLapse.uniforms[k], wStill.uniforms[k]), `${k}: the first frame's value is the static one`);
    assert.equal(wLapse.uniforms[k], wLive[k]);
  }
  setWaterLive(wLive, L1.water);
  assert.ok(!sameValue(wLapse.uniforms.uWatSky, wStill.uniforms.uWatSky), "a later frame's sky");
});

test("dark rig in a lapse: each frame's lit values, never the first seen", () => {
  const sun = new THREE.DirectionalLight("#ffc98a", 2.3);
  const hemi = new THREE.HemisphereLight("#a9c0dd", "#7a6a58", 2.16);
  const disk = new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.MeshBasicMaterial({ color: "#ffc98a" }));
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.MeshStandardMaterial({ emissive: "#c9d2e0", emissiveIntensity: 0.35 }));
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ opacity: 0 }));
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog("#f2c595", 300, 7000);
  scene.background = new THREE.Color("#f2c595");
  const rig = darkRig({ sun, hemi, disk, clouds, moon, horizon: "#f2c595" });
  const litOf = (time: string): DarkLit => {
    const L = placeLight(resolvePlace("paris", { date: "2026-10-30", time }));
    return { sun: L.key.intensity, hemi: L.fill.intensity, cloud: 0.35, moon: L.moon.light, disk: new THREE.Color(L.sky.sunColor), horizon: new THREE.Color(L.sky.horizon) };
  };
  const state = () => JSON.stringify([sun.intensity, hemi.intensity, (disk.material as THREE.MeshBasicMaterial).color, moon.material.opacity, (scene.fog as THREE.Fog).color, scene.background]);
  const late = litOf("19:00");
  const early = litOf("17:10");
  rig(null, scene, late);
  const lateState = state();
  assert.equal(sun.intensity, late.sun);
  assert.equal(moon.material.opacity, late.moon);
  assert.ok((scene.fog as THREE.Fog).color.equals(late.horizon));
  rig(null, scene, early);
  const earlyState = state();
  // A rig made now (it records what it sees: the early light) still draws each frame from its own values.
  const again = darkRig({ sun, hemi, disk, clouds, moon, horizon: "#000000" });
  again(null, scene, late);
  assert.equal(state(), lateState);
  rig(null, scene, early);
  assert.equal(state(), earlyState);
});

test("traffic in a lapse: the arrivals follow the density at each step, the same every run", () => {
  const place = resolvePlace("paris", { date: "2026-10-30", time: "17:00" });
  const layout = generateCity(place.style, {
    clearings: landmarksFor(place.place).map((l): [number, number, number] => [l.x, l.z, l.clearRadius]),
    seed: place.place.id,
    season: place.season,
    cloudiness: place.place.cloudiness,
    cloudPassages: [[-75, 0]],
  });
  const scene = { from: 0, to: 12 };
  const run = (densityAt?: (t: number) => number): TrafficPlan =>
    trafficPlan(layout.roads, place.style, { seed: "paris", scene, lens: (t) => [-70 + (40 * t) / 12, 4.4, 3], density: 1, densityAt, warmup: 20 });
  const thinning = (t: number) => (t < 0 ? 1 : 0.15);
  const a = run(thinning);
  const b = run(thinning);
  assert.deepEqual(Array.from(a.table), Array.from(b.table), "deterministic");
  const still = run();
  const steady = run(() => 1);
  // A street that thins at the scene's start sees fewer cars than one that does not.
  assert.ok(a.stats.cars < steady.stats.cars, `${a.stats.cars} < ${steady.stats.cars}`);
  // At the same density all through, the arrivals keep their pace (the waits are the same draws).
  assert.ok(Math.abs(steady.stats.cars - still.stats.cars) <= 2, `${steady.stats.cars} vs ${still.stats.cars}`);
  // Until the density moves, the street is the same car for car.
  // (The cars present, in a fixed order: slots are numbered over the whole scene.)
  const poses = (p: TrafficPlan, t: number) => {
    const out = new Float32Array(p.cars.length * 4);
    p.poseAt(t, out);
    const cars: string[] = [];
    for (let i = 0; i < p.cars.length; i++) if (out[i * 4 + 3] & PRESENT) cars.push(Array.from(out.subarray(i * 4, i * 4 + 4)).join(","));
    return cars.sort();
  };
  for (const t of [-0.1, 0]) assert.deepEqual(poses(a, t), poses(steady, t), `at ${t} s`);
});

test("shafts in a lapse: the fan turns to the frame's sun, nothing kept from the frame before", () => {
  const opts = { sunDir: [0.6, 0.25, 0.4] as [number, number, number], color: "#ffc98a", at: [0, 0, 0] as [number, number, number], strength: 0.4, seed: "paris" };
  const a = sunShafts(opts);
  const b = sunShafts(opts);
  const pose = (s: ReturnType<typeof sunShafts>) => JSON.stringify(s.group.children.map((c) => [c.position.toArray(), c.quaternion.toArray(), ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).color.toArray()]));
  const built = pose(a);
  a.setSun([-0.2, 0.5, 0.7], "#ff9a52", 1);
  a.setSun([0.1, 0.1, -0.9], "#ffffff", 0.5);
  b.setSun([0.1, 0.1, -0.9], "#ffffff", 0.5);
  assert.equal(pose(a), pose(b), "a frame's pose is its own");
  // The halo on the new ray.
  const halo = a.group.children[a.group.children.length - 1];
  const dir = new THREE.Vector3(0.1, 0.1, -0.9).normalize();
  assert.ok(halo.position.clone().normalize().distanceTo(dir) < 1e-6);
  // Each blade still holds the ray (its geometry's long axis, turned).
  const blade = a.group.children[0] as THREE.Mesh;
  const p = blade.geometry.getAttribute("position");
  const along = new THREE.Vector3(p.getX(2) - p.getX(1), p.getY(2) - p.getY(1), p.getZ(2) - p.getZ(1)).applyQuaternion(blade.quaternion).normalize();
  assert.ok(along.distanceTo(dir) < 1e-5, "the blade along the sun's ray");
  // Back at its own sun the fan is as built; the halo's strength follows.
  a.setSun(opts.sunDir, opts.color, opts.strength);
  assert.equal(pose(a), built);
  a.setFade(1);
  const haloMat = (halo as THREE.Mesh).material as THREE.MeshBasicMaterial;
  assert.ok(Math.abs(haloMat.opacity - 0.55 * 0.4) < 1e-12);
});
