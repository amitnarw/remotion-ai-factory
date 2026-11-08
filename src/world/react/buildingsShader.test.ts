import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { generateCity, type CityLayout } from "../city";
import { kitTown } from "../kitTown";
import { landmarksFor } from "../landmarks";
import { buildingsGeometry, mansardGeometry, propsGeometry } from "../meshes";
import { resolvePlace, type RegionStyle } from "../places";
import { buildingMatrix, buildingMotion, buildingPlan, placeLiftingBuildings, type BuildingPlan, type BuildingSet } from "./buildings";
import {
  KIT_UNDERSIDE_INSET,
  LIFT_GLSL,
  LIFT_ID_ATTRIBUTE,
  LIFT_SLOTS,
  LIFT_UNIFORMS,
  buildingLiftDepthMaterial,
  buildingUniforms,
  hasBuildingLift,
  liftNormal,
  liftRest,
  liftShader,
  liftKey,
  liftVertex,
  patchBuildingLift,
  roofLiftIds,
  setLiftUniforms,
  undersideGeometry,
  wallLiftIds,
} from "./buildingsShader";
import { patchDarkEmissive } from "./darkShader";
import type { Vec3 } from "./lift";
import { reactionPlan, type ReactionSpec } from "./reaction";
import { levelTrack } from "./track";

interface Place {
  layout: CityLayout;
  style: RegionStyle;
  set: BuildingSet;
  plan: BuildingPlan;
}

/** The Paris money video's counter as "lift" (16x at 12.97 s). */
const LIFT_16X: ReactionSpec = {
  statPanel: {
    react: "lift",
    beats: [
      { t: 4.549, value: "1", scale: 1 },
      { t: 8.077, value: "2", scale: 1.75 },
      { t: 12.97, value: "1048576", scale: 16 },
    ],
  } as unknown as ReactionSpec["statPanel"],
  worldEvents: [],
};
const SCENE = { from: 11.033, to: 19.933 };
const FAR_EYE: Vec3 = [5000, 300, 5000];

const places = new Map<string, Place>();
function placeOf(id: string): Place {
  const hit = places.get(id);
  if (hit) return hit;
  const place = resolvePlace(id, { date: "2026-10-23", time: "11:00" });
  const layout = generateCity(place.style, {
    clearings: landmarksFor(place.place).map((l): [number, number, number] => [l.x, l.z, l.clearRadius]),
    seed: place.place.id,
    season: place.season,
    cloudiness: place.place.cloudiness,
    cloudPassages: [[-75, 0]],
  });
  const set = placeLiftingBuildings(layout, place.style, kitTown(layout.kitBuildings), place.place.id);
  const react = reactionPlan(LIFT_16X, SCENE);
  const plan = buildingPlan(set, levelTrack((t) => react(t).lift, 0, SCENE.to));
  const out = { layout, style: place.style, set, plan };
  places.set(id, out);
  return out;
}

const vec = (a: ArrayLike<number>, v: number): Vec3 => [a[v * 3], a[v * 3 + 1], a[v * 3 + 2]];
const apply = (m: THREE.Matrix4, p: Vec3): Vec3 => new THREE.Vector3(...p).applyMatrix4(m).toArray() as Vec3;
const turn = (m: THREE.Matrix4, n: Vec3): Vec3 => new THREE.Vector3(...n).applyMatrix3(new THREE.Matrix3().setFromMatrix4(m)).toArray() as Vec3;
const near = (a: Vec3, b: Vec3, eps: number) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < eps;

/** Paris' walls with their lift ids. */
function walls() {
  const { layout, style, set } = placeOf("paris");
  const g = buildingsGeometry(layout.buildings, style);
  const ids = wallLiftIds(g.getAttribute("aDark").array, set.buildings.map((b) => b.id));
  return { g, ids, pos: g.getAttribute("position").array, normal: g.getAttribute("normal").array };
}

test("buildings shader: the defaults leave the walls unchanged, vertex for vertex", () => {
  // Rest until a place writes them.
  const rest = liftRest();
  assert.deepEqual(LIFT_UNIFORMS.uLiftPivot.value, rest.pivot);
  assert.deepEqual(LIFT_UNIFORMS.uLiftAt.value, rest.at);
  assert.deepEqual(LIFT_UNIFORMS.uLiftQuat.value, rest.quat);
  for (let k = 0; k < LIFT_SLOTS; k++) assert.equal(rest.pivot[k * 4 + 3], 0, "every slot empty (key 0)");
  // Every wall vertex and normal comes back as it went in (the very same numbers).
  const { ids, pos, normal } = walls();
  for (let v = 0; v < ids.length; v++) {
    const p = vec(pos, v);
    const n = vec(normal, v);
    const q = liftVertex(rest, ids[v], p);
    const m = liftNormal(rest, ids[v], n);
    for (let i = 0; i < 3; i++) {
      assert.ok(Object.is(q[i], p[i]) && Object.is(m[i], n[i]), `vertex ${v}`);
    }
  }
  // Before the beat a scene's uniforms are the rest exactly; null puts them back.
  const { plan } = placeOf("paris");
  assert.deepEqual(buildingUniforms(plan, 12, FAR_EYE), rest);
  setLiftUniforms(buildingUniforms(plan, 17, FAR_EYE));
  assert.notDeepEqual(LIFT_UNIFORMS.uLiftPivot.value, rest.pivot);
  setLiftUniforms(null);
  assert.deepEqual(LIFT_UNIFORMS.uLiftPivot.value, rest.pivot);
  assert.deepEqual(LIFT_UNIFORMS.uLiftAt.value, rest.at);
  assert.deepEqual(LIFT_UNIFORMS.uLiftQuat.value, rest.quat);
  // The GLSL moves a vertex only through a filled slot.
  assert.ok(LIFT_GLSL.includes(`uLiftPivot[ k ].w > 0.5 && abs( ${LIFT_ID_ATTRIBUTE} - uLiftPivot[ k ].w ) < 0.5`));
  assert.ok(LIFT_GLSL.includes("if ( k < 0 ) return p;"));
  // A geometry without the attribute reads 0: it never moves, even with every slot filled.
  const busy = buildingUniforms(plan, 17, FAR_EYE);
  assert.ok(busy.pivot.some((w, i) => i % 4 === 3 && w > 0));
  const p: Vec3 = [1, 2, 3];
  assert.equal(liftVertex(busy, 0, p), p);
});

test("buildings shader: a lifting building's vertices move exactly as the plan's matrix, the others not at all", () => {
  const { plan, set } = placeOf("paris");
  const { ids, pos, normal } = walls();
  const t = 17;
  const u = buildingUniforms(plan, t, FAR_EYE);
  const slot = new Map(set.buildings.map((b, k) => [liftKey(b.id), k]));
  const mats = set.buildings.map((_, k) => buildingMatrix(plan, k, t, FAR_EYE));
  let moved = 0;
  for (let v = 0; v < ids.length; v++) {
    const p = vec(pos, v);
    const n = vec(normal, v);
    if (ids[v] === 0) {
      assert.equal(liftVertex(u, ids[v], p), p);
      continue;
    }
    const k = slot.get(ids[v])!;
    assert.ok(buildingMotion(plan, k, t).moving);
    // Float32 uniforms: a millimetre or two at a few hundred metres from the origin.
    assert.ok(near(liftVertex(u, ids[v], p), apply(mats[k], p), 2e-3), `building ${ids[v]} vertex ${v}`);
    assert.ok(near(liftNormal(u, ids[v], n), turn(mats[k], n), 1e-5));
    moved++;
  }
  assert.equal(moved, 30 * set.buildings.length, "30 wall vertices per building");
  // The lens: a hidden building's vertices all collapse onto its pivot.
  const k = 0;
  const b = set.buildings[k];
  const eye: Vec3 = apply(mats[k], b.centre);
  const hidden = buildingUniforms(plan, t, eye);
  assert.equal(hidden.at[k * 4 + 3], 0);
  const at: Vec3 = [hidden.at[0], hidden.at[1], hidden.at[2]];
  for (let v = 0; v < ids.length; v++) if (ids[v] === liftKey(b.id)) assert.deepEqual(liftVertex(hidden, liftKey(b.id), vec(pos, v)), at);
});

test("buildings shader: one GLSL text, at the right include points, patched once beside lights out", () => {
  for (const lib of [THREE.ShaderLib.standard, THREE.ShaderLib.depth]) {
    const shader = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: lib.vertexShader };
    liftShader(shader);
    const vs = shader.vertexShader;
    assert.ok(vs.startsWith(LIFT_GLSL));
    assert.equal(vs.split("transformed = lfMove( transformed );").length, 2, "moved once");
    assert.ok(vs.includes("#include <begin_vertex>\n  transformed = lfMove( transformed );"));
    assert.ok(vs.includes("#include <beginnormal_vertex>\n  objectNormal = lfTurn( objectNormal );"));
    // Before the projection and the world position (fog, shadows); the depth shader has no world position.
    for (const inc of ["#include <project_vertex>", "#include <worldpos_vertex>"]) {
      if (lib === THREE.ShaderLib.standard || vs.includes(inc)) assert.ok(vs.indexOf("lfMove( transformed )") < vs.indexOf(inc), inc);
    }
    assert.equal(shader.uniforms.uLiftPivot, LIFT_UNIFORMS.uLiftPivot, "the shared uniforms, by reference");
    assert.equal(shader.uniforms.uLiftAt, LIFT_UNIFORMS.uLiftAt);
    assert.equal(shader.uniforms.uLiftQuat, LIFT_UNIFORMS.uLiftQuat);
  }
  // The same text for every material (§4.3 rule 3).
  const a = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader };
  const b = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader };
  liftShader(a);
  liftShader(b);
  assert.equal(a.vertexShader, b.vertexShader);

  // Once per material; beside the lights-out patch in either order, each attribute declared once.
  const compile = (mat: THREE.Material) => {
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader } as unknown as THREE.WebGLProgramParametersWithUniforms;
    mat.onBeforeCompile(shader, null as unknown as THREE.WebGLRenderer);
    return shader.vertexShader;
  };
  const liftFirst = new THREE.MeshStandardMaterial();
  patchBuildingLift(liftFirst);
  patchBuildingLift(liftFirst);
  patchDarkEmissive(liftFirst);
  const darkFirst = new THREE.MeshStandardMaterial();
  patchDarkEmissive(darkFirst);
  patchBuildingLift(darkFirst);
  for (const mat of [liftFirst, darkFirst]) {
    const vs = compile(mat);
    assert.equal(vs.split(`attribute float ${LIFT_ID_ATTRIBUTE};`).length, 2, "aLiftId declared once");
    assert.equal(vs.split("attribute vec3 aDark;").length, 2, "aDark declared once");
    assert.equal(vs.split("lfMove( transformed )").length, 2);
    assert.ok(vs.includes("vDarkLit = dkLit( aDark );"));
    assert.ok(hasBuildingLift(mat));
    assert.equal(mat.customProgramCacheKey().split("|building-lift").length, 2);
  }
  assert.ok(!hasBuildingLift(new THREE.MeshStandardMaterial()));
  // The shadow pass' depth material carries it too.
  const depth = buildingLiftDepthMaterial();
  assert.equal(buildingLiftDepthMaterial(), depth);
  assert.equal(depth.depthPacking, THREE.RGBADepthPacking);
  assert.ok(hasBuildingLift(depth));
});

test("buildings shader: the mansard roofs and rooftop boxes are tagged with their building, nothing else", () => {
  const { layout, set } = placeOf("paris");
  const lifting = new Set(set.buildings.map((b) => b.id));
  // Walls: 30 vertices per building, in order.
  const { ids } = walls();
  layout.buildings.forEach((_, i) => {
    for (let v = i * 30; v < i * 30 + 30; v++) assert.equal(ids[v], lifting.has(i) ? liftKey(i) : 0);
  });
  // Mansards: 30 vertices per mansard building, in order.
  const roofs = roofLiftIds(mansardGeometry(layout.buildings).getAttribute("position").array, set.buildings);
  let m = 0;
  let tagged = 0;
  layout.buildings.forEach((b, i) => {
    if (b.roof !== "mansard") return;
    for (let v = m * 30; v < m * 30 + 30; v++) assert.equal(roofs[v], lifting.has(i) ? liftKey(i) : 0, `mansard of #${i}`);
    if (lifting.has(i)) tagged++;
    m++;
  });
  assert.equal(roofs.length, m * 30);
  assert.ok(tagged > 0);
  // Rooftop boxes: 30 vertices per prop; a prop on a lifting building's roof is its.
  const props = roofLiftIds(propsGeometry(layout.props).getAttribute("position").array, set.buildings);
  let onRoofs = 0;
  layout.props.forEach((p, j) => {
    const owner = set.buildings.find(({ id }) => {
      const b = layout.buildings[id];
      const c = Math.cos(b.rotY);
      const s = Math.sin(b.rotY);
      const lx = c * (p.x - b.x) - s * (p.z - b.z);
      const lz = s * (p.x - b.x) + c * (p.z - b.z);
      const roof = Math.abs(p.y - b.h) < 1e-9 || Math.abs(p.y - (b.h + 4)) < 1e-9;
      return roof && Math.abs(lx) < b.w / 2 && Math.abs(lz) < b.d / 2;
    });
    if (owner) onRoofs++;
    for (let v = j * 30; v < j * 30 + 30; v++) assert.equal(props[v], owner ? liftKey(owner.id) : 0, `prop ${j}`);
  });
  assert.ok(onRoofs > 0, "the lifting buildings have rooftop boxes");
});

test("buildings shader: the undersides close each lifted building's bottom", () => {
  for (const [id, inset] of [["paris", 0], ["new-york", KIT_UNDERSIDE_INSET]] as const) {
    const { set, plan } = placeOf(id);
    const g = undersideGeometry(set.buildings, inset);
    const pos = g.getAttribute("position").array;
    const normal = g.getAttribute("normal").array;
    const ids = g.getAttribute(LIFT_ID_ATTRIBUTE).array;
    const keys = g.getAttribute("aDark").array;
    assert.equal(pos.length / 3, 6 * set.buildings.length);
    assert.equal(g.getAttribute("uv").count, pos.length / 3);
    assert.equal(g.getAttribute("color").count, pos.length / 3);
    set.buildings.forEach((b, k) => {
      for (let v = k * 6; v < k * 6 + 6; v++) {
        assert.equal(ids[v], liftKey(b.id));
        assert.deepEqual([keys[v * 3], keys[v * 3 + 1], keys[v * 3 + 2]], [Math.fround(b.rest.x), Math.fround(b.rest.z), b.id]);
        assert.deepEqual(vec(normal, v), [0, -1, 0]);
        assert.ok(Math.abs(pos[v * 3 + 1] - b.rest.min[1]) < 1e-6, "on its base");
      }
      // Wound to face down.
      for (const tri of [k * 6, k * 6 + 3]) {
        const [a, c, d] = [vec(pos, tri), vec(pos, tri + 1), vec(pos, tri + 2)];
        const e1 = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
        const e2 = new THREE.Vector3(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
        assert.ok(e1.cross(e2).normalize().y < -0.999);
      }
      // Carried with its building by the same uniforms.
      const t = 17;
      const u = buildingUniforms(plan, t, FAR_EYE);
      const mat = buildingMatrix(plan, k, t, FAR_EYE);
      for (let v = k * 6; v < k * 6 + 6; v++) assert.ok(near(liftVertex(u, liftKey(b.id), vec(pos, v)), apply(mat, vec(pos, v)), 2e-3));
    });
  }
});
