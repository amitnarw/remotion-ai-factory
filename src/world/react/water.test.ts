import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import type { Vec3 } from "./lift";
import { DRAIN_M, FLOOD_M, type ReactionSpec } from "./reaction";
import {
  DROP_VERTEX,
  FLOOD_BASE,
  FOAM_BELOW,
  FOAM_M,
  hasWater,
  LENS_CLEAR,
  lensFloor,
  lensFloorPlan,
  MARK_DT,
  maxLensFloor,
  WATER_FRAGMENT,
  WATER_FRAGMENT_HEADER,
  WATER_OFF,
  WATER_REST,
  WATER_ROUGHNESS,
  WATER_VERTEX,
  WET_SPLASH,
  waterLookAt,
  waterPlan,
  waterShaders,
  waterUniformValues,
  type WaterState,
} from "./water";
import { patchMaterial } from "../atmosphere/patch";
import { buildFlood, buildPondBeds, isReactSurface, keyBefore, patchWaterDrop, patchWaterMarks, reactSurfaceMaterials, setWaterUniforms, WATER_UNIFORMS } from "./waterShader";

const SCENE = { from: 0, to: 24 };
const FPS = 30;

const beat = (t: number, value: string, scale: number) => ({ t, value, zoom: 1, sub: "", scale });
/** A water counter (1x, 2x, 4x, 16x), the oceans vanishing at 12 s, returning at 16 s. */
const FLOOD: ReactionSpec = {
  statPanel: { react: "water", beats: [beat(1, "1", 1), beat(3, "2", 2), beat(5, "4", 4), beat(8, "16", 16)] },
  worldEvents: [
    { t: 12, name: "water-vanish" },
    { t: 16, name: "water-return" },
  ],
};
/** A falling water counter: the ocean drains, the streets never flood. */
const FALLING: ReactionSpec = {
  statPanel: { react: "water", beats: [beat(1, "100", 1), beat(4, "50", 1), beat(7, "0", 1)] },
  worldEvents: [],
};
/** No water at all: a money counter and other events. */
const DRY: ReactionSpec = {
  statPanel: { react: "money", beats: [beat(1, "1", 1), beat(5, "16", 16)] },
  worldEvents: [
    { t: 3, name: "lights-out" },
    { t: 6, name: "snow-start" },
  ],
};

/** Times on the 30 fps grid over the scene, and the same in a shuffled order. */
function frames(): number[] {
  return Array.from({ length: Math.round(SCENE.to * FPS) + 1 }, (_, i) => i / FPS);
}
function shuffled<T>(xs: readonly T[], seed = 7): T[] {
  const out = [...xs];
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
/** Wall points round the city at heights 0..4 m. */
function points(n: number): Vec3[] {
  let s = 11;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: n }, () => [(rand() - 0.5) * 600, rand() * 4, (rand() - 0.5) * 600] as Vec3);
}

/** Every `uniform type name` a GLSL text declares. */
const declared = (glsl: string) => [...glsl.matchAll(/uniform\s+\w+\s+(\w+)/g)].map((m) => m[1]);
/** The text is whole: balanced brackets, no template leftovers. */
function wellFormed(glsl: string, what: string): void {
  for (const [o, c] of [["(", ")"], ["{", "}"], ["[", "]"]]) {
    assert.equal(glsl.split(o).length, glsl.split(c).length, `${what}: ${o}${c} balanced`);
  }
  assert.ok(!/\$\{|undefined|NaN|Infinity/.test(glsl), `${what}: no template leftovers`);
}

/** Runs a material's patch chain on a ShaderLib template. */
function compile(mat: THREE.Material, lib: { vertexShader: string; fragmentShader: string }) {
  const shader = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: {} as Record<string, THREE.IUniform> };
  (mat.onBeforeCompile as (s: unknown, r: unknown) => void)(shader, null);
  return shader;
}

test("water: without water nothing changes (no surface, no mark, no drop, no foam, no lens floor)", () => {
  assert.equal(hasWater(DRY), false);
  assert.equal(hasWater(FLOOD), true);
  assert.equal(hasWater({ worldEvents: [{ t: 2, name: "water-rise" }] }), true);
  const plan = waterPlan(DRY, SCENE);
  for (const t of [0, 2, 5.5, 12, 23.9]) {
    assert.deepEqual(plan(t), { ...WATER_REST, time: t });
    assert.equal(lensFloor(DRY, SCENE, t), -Infinity);
  }
  // The rest uniforms draw nothing anywhere, on any surface.
  const rest = waterUniformValues(null);
  assert.deepEqual(rest, { surface: WATER_OFF, mark: WATER_OFF, foam: 0, drop: 0, time: 0 });
  for (const p of points(500)) for (const ny of [0, 0.5, 1]) assert.deepEqual(waterLookAt(p, ny, rest), { wet: 0, line: 0, foam: 0 });
  // A dry scene's frames say the same as rest.
  for (const t of [1, 9]) assert.deepEqual(waterUniformValues(plan(t)), { ...rest, time: t });
  // The shared uniforms go back to rest exactly.
  setWaterUniforms(waterPlan(FLOOD, SCENE)(10));
  assert.ok(WATER_UNIFORMS.uRwSurface.value > 0 && WATER_UNIFORMS.uRwMark.value > 0);
  setWaterUniforms(null);
  assert.deepEqual(
    [WATER_UNIFORMS.uRwSurface.value, WATER_UNIFORMS.uRwMark.value, WATER_UNIFORMS.uRwFoam.value, WATER_UNIFORMS.uRwDrop.value, WATER_UNIFORMS.uRwTime.value],
    [WATER_OFF, WATER_OFF, 0, 0, 0],
  );
  // The shader's guard: the rest mark never passes it.
  assert.ok(WATER_FRAGMENT.includes(`if ( uRwMark > ${WATER_OFF + 1}.0 )`));
  assert.ok(!(WATER_OFF > WATER_OFF + 1));
});

test("water: a pure function of t, whatever order frames are asked in", () => {
  const times = frames();
  const a = waterPlan(FLOOD, SCENE);
  const inOrder = times.map((t) => a(t));
  const b = waterPlan(FLOOD, SCENE);
  const byTime = new Map(shuffled(times).map((t) => [t, b(t)] as const));
  times.forEach((t, i) => assert.deepEqual(byTime.get(t), inOrder[i], `t ${t}`));
  // Asking again changes nothing.
  assert.deepEqual(a(9.5), a(9.5));
  const floors = lensFloorPlan(FLOOD, SCENE);
  const again = times.map((t) => floors(t));
  shuffled(times).forEach((t) => assert.equal(floors(t), again[times.indexOf(t)]));
});

test("water: the streets flood with each beat, the drain empties the ponds and coast, the return refills", () => {
  const plan = waterPlan(FLOOD, SCENE);
  const at = (t: number) => plan(t);
  assert.equal(at(0.5).surface, WATER_OFF, "dry before the counter moves");
  // 2x floods a quarter of FLOOD_M within the step (log2(2) / 4).
  assert.ok(Math.abs(at(3.6).water - FLOOD_M / 4) < 1e-6 && Math.abs(at(3.6).surface - (FLOOD_BASE + FLOOD_M / 4)) < 1e-6);
  // 16x: the whole FLOOD_M, the foam at full strength.
  assert.ok(Math.abs(at(10).surface - (FLOOD_BASE + FLOOD_M)) < 1e-6 && at(10).foam === 1);
  // Gate item 7: 80% of each step within 0.5 s.
  const step = at(8.5).water - at(7.99).water;
  assert.ok(step >= 0.8 * (FLOOD_M - FLOOD_M / 2), `step ${step}`);
  // water-vanish: the flood goes, then the water bodies drop DRAIN_M.
  assert.equal(at(14).surface, WATER_OFF);
  assert.ok(Math.abs(at(14).drop - DRAIN_M) < 1e-6 && at(14).foam === 0);
  // water-return: back to the counter's flood.
  assert.ok(Math.abs(at(20).water - FLOOD_M) < 1e-6 && at(20).drop === 0);
  // A falling counter drains and never floods.
  const fall = waterPlan(FALLING, SCENE);
  for (const t of frames()) {
    const s = fall(t);
    assert.equal(s.surface, WATER_OFF);
    assert.equal(s.mark, WATER_OFF);
    assert.ok(s.drop >= 0 && s.drop <= DRAIN_M + 1e-9);
  }
  assert.ok(Math.abs(fall(10).drop - DRAIN_M) < 1e-6, "all of it gone drains fully");
});

test("water: the high-water mark never goes down, follows the highest flood and stays after the drain", () => {
  const plan = waterPlan(FLOOD, SCENE);
  // Every frame, and a fine grid between frames.
  const times = [...frames(), ...Array.from({ length: 4000 }, (_, i) => (i * SCENE.to) / 4000 + 0.0037)].sort((x, y) => x - y);
  let prev = -Infinity;
  let highest = -Infinity;
  for (const t of times) {
    const s = plan(t);
    assert.ok(s.mark >= prev, `t ${t.toFixed(4)}: the mark went down ${prev} -> ${s.mark}`);
    prev = s.mark;
    if (s.surface > WATER_OFF) highest = Math.max(highest, s.surface);
    // The mark is the highest surface so far (the grid's running max, linear
    // between its points: within a millimetre).
    if (highest > WATER_OFF) assert.ok(Math.abs(s.mark - highest) < 2e-3, `t ${t.toFixed(4)}: mark ${s.mark} vs highest ${highest}`);
    else assert.equal(s.mark, WATER_OFF);
  }
  // After the drain the walls stay wet up to the mark (plus the splash), and the foam is gone.
  const drained = plan(14);
  assert.ok(Math.abs(drained.mark - (FLOOD_BASE + FLOOD_M)) < 2e-3);
  const u = waterUniformValues(drained);
  assert.ok(Math.abs(u.mark - (drained.mark + WET_SPLASH)) < 1e-12);
  let wetBelow = 0;
  for (const p of points(400)) {
    const wall = waterLookAt([p[0], drained.mark - 0.3, p[2]], 0, u);
    const above = waterLookAt([p[0], drained.mark + WET_SPLASH + 0.2, p[2]], 0, u);
    if (wall.wet > 0.99) wetBelow++;
    assert.equal(above.wet, 0);
    assert.equal(wall.foam, 0);
  }
  assert.equal(wetBelow, 400);
  // The mark's grid is fine enough: MARK_DT is under a frame.
  assert.ok(MARK_DT <= 1 / FPS);
});

test("water: foam within FOAM_M of the surface, on walls and slopes, not on flat ground", () => {
  const s: WaterState = waterPlan(FLOOD, SCENE)(10);
  const u = waterUniformValues(s);
  const h = s.surface;
  let foamed = 0;
  for (const p of points(800)) {
    for (const dy of [-0.3, -0.05, -FOAM_BELOW - 1e-3, -0.01, 0, 0.03, 0.06, 0.1, FOAM_M + 1e-3, 0.2, 0.5]) {
      const y = h + dy;
      const wall = waterLookAt([p[0], y, p[2]], 0, u);
      if (wall.foam > 0) {
        foamed++;
        assert.ok(dy >= -FOAM_BELOW && dy <= FOAM_M, `foam at ${dy} m from the surface`);
      }
      assert.ok(wall.foam <= 1);
      // Flat ground just above the water: wet, never white.
      assert.equal(waterLookAt([p[0], y, p[2]], 1, u).foam, 0);
    }
    // Right at the waterline a wall foams.
    assert.ok(waterLookAt([p[0], h + 0.02, p[2]], 0, u).foam > 0.3);
  }
  assert.ok(foamed > 800, "the waterline foams");
  // A rising flood darkens a band above its foam (the splash).
  assert.ok(waterLookAt([0, h + WET_SPLASH / 2, 0], 0, u).wet > 0.9);
  // Flat ground near the wet line goes wet as a whole: no wobble blotches
  // across a plaza (the wobble is for walls).
  for (const dy of [0.02, 0.06, 0.09, 0.11, 0.13]) {
    const wets = new Set(points(200).map((p) => waterLookAt([p[0], h + dy, p[2]], 1, u).wet.toFixed(9)));
    assert.equal(wets.size, 1, `flat ground ${dy} m above the water: ${[...wets].slice(0, 4)}`);
  }
  // Foam fades in with a shallow flood: none at rest, part at a few centimetres.
  assert.equal(waterPlan(FLOOD, SCENE)(0.5).foam, 0);
  const shallow = waterPlan({ worldEvents: [{ t: 1, name: "water-rise" }] }, SCENE)(1.4);
  assert.ok(shallow.water > 0 && shallow.foam > 0 && shallow.foam < 1);
});

test("water: the lens stays LENS_CLEAR above the flood; dry streets set no floor", () => {
  const plan = waterPlan(FLOOD, SCENE);
  const floor = lensFloorPlan(FLOOD, SCENE);
  for (const t of frames()) {
    const s = plan(t);
    if (s.surface > WATER_OFF) assert.ok(Math.abs(floor(t) - (s.surface + LENS_CLEAR)) < 1e-9, `t ${t}`);
    else assert.equal(floor(t), -Infinity, `t ${t}`);
    assert.equal(lensFloor(FLOOD, SCENE, t), floor(t));
  }
  assert.equal(LENS_CLEAR, 0.4);
  // A lens held over a whole shot keeps above its highest floor.
  const shot = maxLensFloor(FLOOD, SCENE, 2, 11);
  assert.ok(Math.abs(shot - (FLOOD_BASE + FLOOD_M + LENS_CLEAR)) < 1e-6);
  for (const t of frames().filter((x) => x >= 2 && x <= 11)) assert.ok(shot >= floor(t));
  assert.equal(maxLensFloor(FALLING, SCENE, 0, 20), -Infinity, "a drain sets no floor");
  assert.equal(maxLensFloor(DRY, SCENE, 0, 20), -Infinity);
});

test("water shader: one GLSL text for every material, applied once, named in the program key", () => {
  const libs = { standard: THREE.ShaderLib.standard, basic: THREE.ShaderLib.basic, lambert: THREE.ShaderLib.lambert, phong: THREE.ShaderLib.phong };
  for (const [name, lib] of Object.entries(libs)) {
    for (const inc of ["#include <project_vertex>"]) assert.ok(lib.vertexShader.includes(inc), `${name} has ${inc}`);
    assert.ok(lib.fragmentShader.includes("#include <alphahash_fragment>"), `${name} has alphahash_fragment`);
  }
  // The same text for every instance: two materials, the same template.
  const a = new THREE.MeshStandardMaterial({ vertexColors: true });
  const b = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
  const keyA = a.customProgramCacheKey();
  patchWaterMarks(a);
  const once = a.onBeforeCompile;
  patchWaterMarks(a);
  assert.equal(a.onBeforeCompile, once, "a shared material is patched once");
  assert.ok(a.customProgramCacheKey().endsWith("|react-water") && a.customProgramCacheKey() !== keyA);
  assert.equal(a.customProgramCacheKey().split("|react-water").length, 2, "named once");
  patchWaterMarks(b);
  const sa = compile(a, libs.standard);
  const sb = compile(b, libs.standard);
  assert.equal(sa.vertexShader, sb.vertexShader);
  assert.equal(sa.fragmentShader, sb.fragmentShader);
  const direct = waterShaders(libs.standard.vertexShader, libs.standard.fragmentShader);
  assert.equal(sa.fragmentShader, direct.fragment);
  // The snippets go in verbatim on every kind of material, each include kept once.
  for (const lib of Object.values(libs)) {
    const s = waterShaders(lib.vertexShader, lib.fragmentShader);
    assert.ok(s.vertex.includes(WATER_VERTEX) && s.fragment.includes(WATER_FRAGMENT) && s.fragment.startsWith(WATER_FRAGMENT_HEADER));
    assert.equal(s.vertex.split("#include <project_vertex>").length, 2);
    assert.equal(s.fragment.split("#include <alphahash_fragment>").length, 2);
    wellFormed(s.vertex, "vertex");
    wellFormed(s.fragment, "fragment");
  }
  // Only standard materials have a roughness to gloss.
  assert.ok(direct.fragment.includes(WATER_ROUGHNESS));
  assert.ok(!waterShaders(libs.basic.vertexShader, libs.basic.fragmentShader).fragment.includes("roughnessFactor *="));
  // Every uniform the GLSL declares is bound to the shared one.
  for (const name of declared(WATER_FRAGMENT_HEADER)) {
    assert.ok(name in sa.uniforms, `${name} bound`);
    assert.equal(sa.uniforms[name], (WATER_UNIFORMS as Record<string, THREE.IUniform>)[name]);
  }
  // No randomness and no clock but the time uniform.
  assert.ok(!/random|time\(/i.test(WATER_FRAGMENT_HEADER.replace(/uRwTime/g, "")));

  // The water bodies' drop: the shared uniform, after begin_vertex.
  const pond = new THREE.MeshStandardMaterial();
  patchWaterDrop(pond);
  const drop = pond.onBeforeCompile;
  patchWaterDrop(pond);
  assert.equal(pond.onBeforeCompile, drop);
  assert.ok(pond.customProgramCacheKey().endsWith("|react-water-drop"));
  const sp = compile(pond, libs.standard);
  assert.ok(sp.vertexShader.includes(DROP_VERTEX) && sp.vertexShader.startsWith("uniform float uRwDrop;"));
  assert.equal(sp.uniforms.uRwDrop, WATER_UNIFORMS.uRwDrop);
  assert.equal(WATER_UNIFORMS.uRwDrop.value, 0, "at rest the drop is exactly 0");
});

test("water: the flood plane shows only while the streets flood; the pond beds once they drain", () => {
  const plan = waterPlan(FLOOD, SCENE);
  const flood = buildFlood({ sky: "#bcd6ea", sunColor: "#fff3df", sunDir: [0.3, 0.8, 0.2] }, { half: 9000, patchKey: "mood" });
  const pos = flood.mesh.geometry.getAttribute("position");
  const xs = Array.from({ length: pos.count }, (_, i) => pos.getX(i));
  assert.deepEqual([Math.min(...xs), Math.max(...xs)], [-9000, 9000]);
  assert.ok(flood.mesh.geometry.getAttribute("aWat"), "the water material's shore attribute (deep everywhere)");
  assert.ok(flood.water.mat.customProgramCacheKey().startsWith("world-react-flood-v1|mood"));
  assert.equal(flood.mesh.visible, false, "hidden until set");
  flood.set(plan(0.5));
  assert.equal(flood.mesh.visible, false);
  flood.set(plan(10));
  assert.ok(flood.mesh.visible && Math.abs(flood.mesh.position.y - plan(10).surface) < 1e-12);
  assert.equal(flood.water.uTime.value, 10);
  flood.set(plan(14));
  assert.equal(flood.mesh.visible, false, "drained");
  flood.dispose();

  const beds = buildPondBeds([{ x: 10, z: 20, r: 8, radii: Array.from({ length: 20 }, () => 7), y: 0.2 }]);
  assert.equal(beds.group.visible, false);
  beds.set(plan(10).drop);
  assert.equal(beds.group.visible, false, "a flood leaves the ponds be");
  beds.set(plan(14).drop);
  assert.equal(beds.group.visible, true);
  beds.dispose();
});

test("water shader: a patch never merges two programs that differed (an unpatched and a patched material)", () => {
  // three's default key is onBeforeCompile's text, which patchMaterial makes
  // the same closure for every chain: taken lazily, an unpatched lamp head
  // and a fogged far disc would share one program once both take a patch.
  const plain = new THREE.MeshStandardMaterial();
  const fogged = new THREE.MeshStandardMaterial();
  patchMaterial(fogged, (s) => {
    s.fragmentShader = "/* fog */\n" + s.fragmentShader;
  });
  assert.notEqual(plain.customProgramCacheKey(), fogged.customProgramCacheKey());
  for (const m of [plain, fogged]) patchWaterMarks(m);
  assert.notEqual(plain.customProgramCacheKey(), fogged.customProgramCacheKey());
  // The ocean and the drawn water each take their own patch: different keys too.
  const pond = new THREE.MeshStandardMaterial();
  patchMaterial(pond, () => {});
  patchWaterDrop(pond);
  assert.notEqual(pond.customProgramCacheKey(), fogged.customProgramCacheKey());
  assert.equal(keyBefore(new THREE.MeshStandardMaterial())(), plain.customProgramCacheKey().replace("|react-water", ""));
});

test("water: the surfaces it marks are the opaque world materials, not glow, pools or the sky", () => {
  const std = new THREE.MeshStandardMaterial();
  const unlit = new THREE.MeshBasicMaterial();
  const cutout = new THREE.MeshStandardMaterial({ transparent: true, alphaTest: 0.5 });
  const glow = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const dome = new THREE.MeshBasicMaterial({ side: THREE.BackSide, depthWrite: false });
  const glass = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.5 });
  assert.deepEqual([std, unlit, cutout].map(isReactSurface), [true, true, true]);
  assert.deepEqual([glow, dome, glass, new THREE.PointsMaterial(), new THREE.LineBasicMaterial()].map(isReactSurface), [false, false, false, false, false]);
  const root = new THREE.Group();
  const water = new THREE.MeshStandardMaterial();
  for (const m of [std, std, unlit, glow, dome, water]) root.add(new THREE.Mesh(new THREE.BoxGeometry(), m));
  root.add(new THREE.InstancedMesh(new THREE.BoxGeometry(), cutout, 2));
  assert.deepEqual(new Set(reactSurfaceMaterials(root, new Set([water]))), new Set([std, unlit, cutout]));
});
