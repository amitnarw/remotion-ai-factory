/**
 * src/world/react/buildingsShader.ts
 *
 * The box cities' side of buildings lifting (buildings.ts; Paris, Cairo):
 * their walls, mansard roofs and rooftop clutter are three merged meshes
 * (meshes.ts), so a lifting building moves in the vertex shader. Each vertex
 * carries its building's key (`liftKey`: its index + 1; 0 for a building
 * that never lifts, and for a geometry without the attribute, whose default
 * reads 0) in an `aLiftId` attribute (the walls' from their `aDark` key, the
 * roofs' and rooftop boxes' by footprint); up to LIFT_SLOTS lifting
 * buildings sit in three uniform arrays:
 *
 *   uLiftPivot[k] = (pivot.xyz, the building's key; 0: the slot is empty)
 *   uLiftAt[k]    = (where the pivot is now, scale: 1 drawn, 0 hidden by the lens)
 *   uLiftQuat[k]  = the lean, x y z w
 *
 * and a vertex of building k goes to at + scale·R(p − pivot), its normal to
 * R·n: the same rigid motion buildings.ts' buildingMatrix gives (and
 * KitInstances applies to a kit building's instances). A hidden building's
 * vertices all collapse onto its pivot: nothing drawn, no shadow.
 *
 * Every slot is empty while its building rests (buildingUniforms writes
 * only moving ones), and a vertex that matches no slot is returned as it
 * came: the walls are exactly unchanged. The patch is applied once per
 * material (a WeakSet) and names itself in the program cache key; the GLSL
 * text is the same for every material (§4.3 rule 3), the uniforms are
 * module-wide (one place is drawn at a time, as darkShader.ts' are).
 *
 * The shadow pass doesn't see a vertex patch unless its depth material has
 * it too: `buildingLiftDepthMaterial` is the walls' customDepthMaterial.
 * `undersideGeometry` closes a lifted building's open bottom (the box walls
 * have no floor, a lifted one would show the sky through it from below).
 *
 * `liftVertex` / `liftNormal` are the TypeScript side of LIFT_GLSL, for the tests.
 */
import * as THREE from "three";
import { patchMaterial } from "../atmosphere/patch";
import { BUILDING_MAX, buildingPose, insideFootprint, rotateByQuat, type BuildingPlan, type LiftingBuilding } from "./buildings";
import type { Vec3 } from "./lift";

/** Lifting buildings the shader holds (buildings.ts caps a set at BUILDING_MAX). */
export const LIFT_SLOTS = BUILDING_MAX;
/** The per-vertex building key attribute. Not `aDark`: darkShader.ts
 *  declares that one itself, and both patches may sit on the walls. */
export const LIFT_ID_ATTRIBUTE = "aLiftId";

/** A building's key in aLiftId and uLiftPivot's w: its index + 1 (0: none,
 *  which is also what a geometry without the attribute reads). */
export const liftKey = (id: number): number => id + 1;
/** A roof or rooftop triangle belongs to the building whose footprint,
 *  shrunk by this much (m), holds its centroid (a neighbour's party wall
 *  lies on the footprint's edge). */
export const FOOTPRINT_EPS = 0.01;
/** A lifted building's underside (sRGB): the foundations' dark concrete. */
export const UNDERSIDE_COLOUR = "#4a443d";
/** Kit buildings' undersides sit this far inside their box (eaves and
 *  shutters stand out past the walls). */
export const KIT_UNDERSIDE_INSET = 0.3;

/** The uniform arrays' values: 4 floats per slot each. */
export interface LiftUniformState {
  pivot: Float32Array;
  at: Float32Array;
  quat: Float32Array;
}

/** Every slot empty (key 0): nothing moves. */
export function liftRest(out?: LiftUniformState): LiftUniformState {
  const s = out ?? { pivot: new Float32Array(4 * LIFT_SLOTS), at: new Float32Array(4 * LIFT_SLOTS), quat: new Float32Array(4 * LIFT_SLOTS) };
  s.pivot.fill(0);
  s.at.fill(0);
  s.quat.fill(0);
  for (let k = 0; k < LIFT_SLOTS; k++) s.quat[k * 4 + 3] = 1;
  return s;
}

/** The shared uniforms (one place at a time). Rest until a place writes them. */
export const LIFT_UNIFORMS = (() => {
  const s = liftRest();
  return { uLiftPivot: { value: s.pivot }, uLiftAt: { value: s.at }, uLiftQuat: { value: s.quat } };
})();

/**
 * The uniforms for a scene's plan at t seen from `eye` (the render
 * camera's pure position): slot k holds plan building k while it moves,
 * empty otherwise. Pure: the same arguments give the same values.
 */
export function buildingUniforms(plan: BuildingPlan, t: number, eye: Vec3, out?: LiftUniformState): LiftUniformState {
  const s = liftRest(out);
  const n = Math.min(LIFT_SLOTS, plan.buildings.length);
  for (let k = 0; k < n; k++) {
    const pose = buildingPose(plan, k, t, eye);
    if (!pose.moving) continue;
    const b = plan.buildings[k];
    s.pivot.set([b.pivot[0], b.pivot[1], b.pivot[2], liftKey(b.id)], k * 4);
    s.at.set([pose.at[0], pose.at[1], pose.at[2], pose.scale], k * 4);
    s.quat.set(pose.quat, k * 4);
  }
  return s;
}

/** Writes a frame's uniforms (null: nothing moves, every slot empty). */
export function setLiftUniforms(s: LiftUniformState | null): void {
  if (!s) {
    liftRest({ pivot: LIFT_UNIFORMS.uLiftPivot.value, at: LIFT_UNIFORMS.uLiftAt.value, quat: LIFT_UNIFORMS.uLiftQuat.value });
    return;
  }
  LIFT_UNIFORMS.uLiftPivot.value.set(s.pivot);
  LIFT_UNIFORMS.uLiftAt.value.set(s.at);
  LIFT_UNIFORMS.uLiftQuat.value.set(s.quat);
}

/* ------------------------------------------------------------------ */
/*  The shader                                                          */
/* ------------------------------------------------------------------ */

/**
 * GLSL (WebGL2) for the vertex shader: the attribute, the uniform arrays
 * and lfMove / lfTurn. Identical text for every material.
 */
export const LIFT_GLSL = /* glsl */ `
attribute float ${LIFT_ID_ATTRIBUTE};
uniform vec4 uLiftPivot[ ${LIFT_SLOTS} ];
uniform vec4 uLiftAt[ ${LIFT_SLOTS} ];
uniform vec4 uLiftQuat[ ${LIFT_SLOTS} ];
vec3 lfRot( vec4 q, vec3 v ) {
  vec3 t = 2.0 * cross( q.xyz, v );
  return v + q.w * t + cross( q.xyz, t );
}
int lfSlot() {
  for ( int k = 0; k < ${LIFT_SLOTS}; k ++ ) {
    if ( uLiftPivot[ k ].w > 0.5 && abs( ${LIFT_ID_ATTRIBUTE} - uLiftPivot[ k ].w ) < 0.5 ) return k;
  }
  return -1;
}
vec3 lfMove( vec3 p ) {
  int k = lfSlot();
  if ( k < 0 ) return p;
  return uLiftAt[ k ].xyz + uLiftAt[ k ].w * lfRot( uLiftQuat[ k ], p - uLiftPivot[ k ].xyz );
}
vec3 lfTurn( vec3 n ) {
  int k = lfSlot();
  if ( k < 0 || uLiftAt[ k ].w <= 0.0 ) return n;
  return lfRot( uLiftQuat[ k ], n );
}
`;

/** The patch itself (exported for the tests): binds the uniforms, adds
 *  LIFT_GLSL, moves the normal after beginnormal_vertex and the position
 *  after begin_vertex (before skinning, projection, world position and fog). */
export function liftShader(shader: Pick<THREE.WebGLProgramParametersWithUniforms, "uniforms" | "vertexShader">): void {
  shader.uniforms.uLiftPivot = LIFT_UNIFORMS.uLiftPivot;
  shader.uniforms.uLiftAt = LIFT_UNIFORMS.uLiftAt;
  shader.uniforms.uLiftQuat = LIFT_UNIFORMS.uLiftQuat;
  shader.vertexShader =
    LIFT_GLSL +
    shader.vertexShader
      .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\n  objectNormal = lfTurn( objectNormal );")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n  transformed = lfMove( transformed );");
}

const PATCHED = new WeakSet<THREE.Material>();

/** Patches `mat` once (its geometry needs an aLiftId attribute), and names
 *  the patch in its program cache key. Apply it only in a scene where
 *  buildings lift: a patched program may round a last bit differently, so
 *  a scene without keeps its walls' own program, byte for byte. */
export function patchBuildingLift(mat: THREE.Material): void {
  if (PATCHED.has(mat)) return;
  PATCHED.add(mat);
  patchMaterial(mat, liftShader);
  const key = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${key()}|building-lift`;
}

/** Whether a material carries the lift patch. */
export function hasBuildingLift(mat: THREE.Material): boolean {
  return PATCHED.has(mat);
}

let depthMaterial: THREE.MeshDepthMaterial | null = null;

/** The shadow pass' depth material with the lift (three's own packing for
 *  directional and spot lights), shared: set it as the walls', roofs' and
 *  rooftop boxes' customDepthMaterial in a lifting scene. */
export function buildingLiftDepthMaterial(): THREE.MeshDepthMaterial {
  if (depthMaterial) return depthMaterial;
  depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depthMaterial.name = "building-lift-depth";
  patchBuildingLift(depthMaterial);
  return depthMaterial;
}

/* ------------------------------------------------------------------ */
/*  The TypeScript side                                                 */
/* ------------------------------------------------------------------ */

/** The slot a vertex with this aLiftId key falls in (-1: none), as lfSlot. */
function slotOf(s: LiftUniformState, key: number): number {
  for (let k = 0; k < LIFT_SLOTS; k++) {
    const w = s.pivot[k * 4 + 3];
    if (w > 0.5 && Math.abs(key - w) < 0.5) return k;
  }
  return -1;
}

const quatAt = (s: LiftUniformState, k: number): [number, number, number, number] => [s.quat[k * 4], s.quat[k * 4 + 1], s.quat[k * 4 + 2], s.quat[k * 4 + 3]];

/** Where LIFT_GLSL's lfMove puts a vertex p whose aLiftId is `key` (p
 *  itself, the very same numbers, when no slot holds that key). */
export function liftVertex(s: LiftUniformState, key: number, p: Vec3): Vec3 {
  const k = slotOf(s, key);
  if (k < 0) return p;
  const arm = rotateByQuat(quatAt(s, k), [p[0] - s.pivot[k * 4], p[1] - s.pivot[k * 4 + 1], p[2] - s.pivot[k * 4 + 2]]);
  const w = s.at[k * 4 + 3];
  return [s.at[k * 4] + w * arm[0], s.at[k * 4 + 1] + w * arm[1], s.at[k * 4 + 2] + w * arm[2]];
}

/** Where LIFT_GLSL's lfTurn turns a normal n whose vertex's aLiftId is `key`. */
export function liftNormal(s: LiftUniformState, key: number, n: Vec3): Vec3 {
  const k = slotOf(s, key);
  if (k < 0 || s.at[k * 4 + 3] <= 0) return n;
  return rotateByQuat(quatAt(s, k), n);
}

/* ------------------------------------------------------------------ */
/*  Attributes                                                          */
/* ------------------------------------------------------------------ */

/** The walls' aLiftId (one per vertex) from their aDark keys [x, z, index]
 *  (meshes.ts buildingsGeometry): the building's key where it is one of
 *  `ids`, 0 elsewhere. */
export function wallLiftIds(aDark: ArrayLike<number>, ids: Iterable<number>): Float32Array {
  const lifting = new Set(ids);
  const n = Math.floor(aDark.length / 3);
  const out = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    const id = aDark[v * 3 + 2];
    if (lifting.has(id)) out[v] = liftKey(id);
  }
  return out;
}

/**
 * The aLiftId of a non-indexed geometry that has no building key (meshes.ts
 * mansardGeometry, propsGeometry: the roofs and rooftop boxes stand inside
 * their building's footprint): each triangle gets the key of the lifting
 * building whose footprint, shrunk by FOOTPRINT_EPS, holds its centroid,
 * 0 elsewhere. All three of a triangle's vertices get the same value.
 */
export function roofLiftIds(position: ArrayLike<number>, buildings: readonly Pick<LiftingBuilding, "id" | "rest">[]): Float32Array {
  const n = Math.floor(position.length / 3);
  const out = new Float32Array(n);
  for (let v = 0; v + 2 < n; v += 3) {
    const cx = (position[v * 3] + position[v * 3 + 3] + position[v * 3 + 6]) / 3;
    const cz = (position[v * 3 + 2] + position[v * 3 + 5] + position[v * 3 + 8]) / 3;
    const b = buildings.find((x) => insideFootprint(x.rest, cx, cz, FOOTPRINT_EPS));
    if (b) out.fill(liftKey(b.id), v, v + 3);
  }
  return out;
}

/** The aLiftId attribute from per-vertex keys. */
export function liftIdAttribute(ids: Float32Array): THREE.BufferAttribute {
  return new THREE.BufferAttribute(ids, 1);
}

/**
 * The lifting buildings' undersides: one quad per building on its base
 * (its footprint, `inset` metres in), facing down, with the attributes the
 * walls' material reads (position, normal, colour, a plain-wall uv, aDark,
 * aLiftId). At rest it lies under the ground, facing it; lifted, it closes
 * the building's bottom. Draw it with the walls' material (box cities) or a
 * vertex-coloured standard material with the same patches (kit cities: the
 * buildings move by instance matrix, their undersides by the same uniforms).
 */
export function undersideGeometry(buildings: readonly LiftingBuilding[], inset = 0): THREE.BufferGeometry {
  const pos: number[] = [];
  const keys: number[] = [];
  const ids: number[] = [];
  for (const b of buildings) {
    const { rest } = b;
    const c = Math.cos(rest.rotY);
    const s = Math.sin(rest.rotY);
    const x0 = rest.min[0] + inset;
    const x1 = rest.max[0] - inset;
    const z0 = rest.min[2] + inset;
    const z1 = rest.max[2] - inset;
    if (!(x1 > x0 && z1 > z0)) continue;
    const y = rest.min[1];
    const at = (lx: number, lz: number) => [rest.x + lx * c + lz * s, y, rest.z - lx * s + lz * c];
    // (x0,z0) (x1,z0) (x1,z1) and (x0,z0) (x1,z1) (x0,z1): wound to face -y.
    for (const [lx, lz] of [[x0, z0], [x1, z0], [x1, z1], [x0, z0], [x1, z1], [x0, z1]]) {
      pos.push(...at(lx, lz));
      keys.push(rest.x, rest.z, b.id);
      ids.push(liftKey(b.id));
    }
  }
  const n = pos.length / 3;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(new Array(n).fill([0, -1, 0]).flat(), 3));
  const col = new THREE.Color(UNDERSIDE_COLOUR);
  g.setAttribute("color", new THREE.Float32BufferAttribute(new Array(n).fill([col.r, col.g, col.b]).flat(), 3));
  // meshes.ts' plain-wall uv (no window).
  g.setAttribute("uv", new THREE.Float32BufferAttribute(new Array(n).fill([0.03, 0.03]).flat(), 2));
  g.setAttribute("aDark", new THREE.Float32BufferAttribute(keys, 3));
  g.setAttribute(LIFT_ID_ATTRIBUTE, new THREE.Float32BufferAttribute(ids, 1));
  return g;
}
