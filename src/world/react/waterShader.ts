/**
 * src/world/react/waterShader.ts
 *
 * The three.js side of water rising (water.ts): one set of shared uniforms
 * the place writes every frame, the `onBeforeCompile` patches, and the
 * meshes the reaction adds.
 *
 *  - `patchWaterMarks`: walls, roofs, props, the ground, the terrain, trees,
 *    kit pieces and far cards get darker and glossier below the wet line
 *    (the high-water mark) and foam where the flood meets them.
 *  - `patchWaterDrop`: the water bodies (the shared drawn-water material of
 *    the ponds and the fountain's pool, the coastal ocean's) drop with a
 *    drain.
 *  - `buildFlood`: the flood plane, the size of the terrain, drawn with the
 *    existing `waterMaterial` (atmosphere/water.ts) at the flood's surface.
 *  - `buildPondBeds`: wet mud under each pond, shown once it drains.
 *
 * Every patch is applied once per material (a WeakSet per patch: the kit
 * materials are shared across files) and names itself in the program cache
 * key. The uniforms are module-wide: one place is drawn at a time, and the
 * place writes them every frame (their rest values without water), so a
 * scene without water renders as before: the patch's branch is never taken
 * and the drop is exactly 0.
 */
import * as THREE from "three";
import { markWaterGeometry, pondGeometry, waterMaterial, type Pond, type WaterMaterial, type WaterOptions } from "../atmosphere/water";
import { patchMaterial } from "../atmosphere/patch";
import { dropShader, FLOOD_DEEP, FLOOD_HALF, FLOOD_SHORE, FOAM_COLOUR, WATER_OFF, waterShaders, waterUniformValues, type WaterState } from "./water";

/** The shared uniforms (one place at a time). */
export const WATER_UNIFORMS = {
  /** The flood's surface, world y (WATER_OFF: none). */
  uRwSurface: { value: WATER_OFF },
  /** The wet line, world y (WATER_OFF: none). */
  uRwMark: { value: WATER_OFF },
  /** The foam's strength, 0..1. */
  uRwFoam: { value: 0 },
  /** Seconds (the foam's lapping). */
  uRwTime: { value: 0 },
  /** Metres the water bodies have dropped. */
  uRwDrop: { value: 0 },
  uRwFoamColour: { value: new THREE.Color(FOAM_COLOUR) },
};

/** Writes a frame's state into the shared uniforms (null: nothing happened). */
export function setWaterUniforms(s: WaterState | null): void {
  const v = waterUniformValues(s);
  WATER_UNIFORMS.uRwSurface.value = v.surface;
  WATER_UNIFORMS.uRwMark.value = v.mark;
  WATER_UNIFORMS.uRwFoam.value = v.foam;
  WATER_UNIFORMS.uRwTime.value = v.time;
  WATER_UNIFORMS.uRwDrop.value = v.drop;
}

const PATCHED = new Map<string, WeakSet<THREE.Material>>();

/**
 * The key a material's programs had before a patch, as a function. three's
 * default key reads `onBeforeCompile.toString()` when asked, and after any
 * patchMaterial that text is the same closure for every chain: so the
 * default's value is taken now, before the patch, or two materials whose
 * keys differed (one unpatched, one patched) would share a program after.
 */
export function keyBefore(mat: THREE.Material): () => string {
  if (mat.customProgramCacheKey === THREE.Material.prototype.customProgramCacheKey) {
    const k = mat.onBeforeCompile.toString();
    return () => k;
  }
  return mat.customProgramCacheKey.bind(mat);
}

/** Patches `mat` once per tag, and names the patch in its program cache key
 *  (the chained onBeforeCompile alone reads the same for every patched
 *  material). Returns whether it patched now. */
function patchOnce(mat: THREE.Material, tag: string, fn: (shader: THREE.WebGLProgramParametersWithUniforms) => void): boolean {
  let done = PATCHED.get(tag);
  if (!done) PATCHED.set(tag, (done = new WeakSet()));
  if (done.has(mat)) return false;
  done.add(mat);
  const key = keyBefore(mat);
  patchMaterial(mat, fn);
  mat.customProgramCacheKey = () => `${key()}|${tag}`;
  return true;
}

const SURFACE_UNIFORMS = ["uRwSurface", "uRwMark", "uRwFoam", "uRwTime", "uRwFoamColour"] as const;

/**
 * Wet marks and foam on a world material (walls, roofs, props, ground,
 * terrain, trees, kit pieces, far cards). Lit or unlit, any mesh material:
 * the darkening and foam go into the albedo before lighting, the gloss into
 * a standard material's roughness. Apply before the material's first
 * compile, or set `needsUpdate` after.
 */
export function patchWaterMarks(mat: THREE.Material): void {
  patchOnce(mat, "react-water", (shader) => {
    for (const k of SURFACE_UNIFORMS) shader.uniforms[k] = WATER_UNIFORMS[k];
    const s = waterShaders(shader.vertexShader, shader.fragmentShader);
    shader.vertexShader = s.vertex;
    shader.fragmentShader = s.fragment;
  });
}

/** A water body drops with a drain: the shared drawn-water material (ponds
 *  and the fountain's pool) and the coastal ocean's. */
export function patchWaterDrop(mat: THREE.Material): void {
  patchOnce(mat, "react-water-drop", (shader) => {
    shader.uniforms.uRwDrop = WATER_UNIFORMS.uRwDrop;
    shader.vertexShader = dropShader(shader.vertexShader);
  });
}

const SURFACE_TYPES = new Set([
  "MeshStandardMaterial",
  "MeshPhysicalMaterial",
  "MeshLambertMaterial",
  "MeshPhongMaterial",
  "MeshToonMaterial",
  "MeshBasicMaterial",
]);

/**
 * Whether a material draws a world surface the water and snow should mark:
 * an opaque (or alpha-tested) mesh material that writes depth. Not additive
 * or blended layers (window glow, lamp pools, shafts), nor the sky dome
 * (back faces, no depth write).
 */
export function isReactSurface(mat: THREE.Material): boolean {
  return (
    SURFACE_TYPES.has(mat.type) &&
    mat.blending === THREE.NormalBlending &&
    mat.depthWrite &&
    (!mat.transparent || mat.alphaTest > 0) &&
    mat.side !== THREE.BackSide
  );
}

/** Every distinct surface material under `root` (isReactSurface), less `skip`
 *  (the water materials). */
export function reactSurfaceMaterials(root: THREE.Object3D, skip: ReadonlySet<THREE.Material> = new Set()): THREE.Material[] {
  const out = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (m && !skip.has(m) && isReactSurface(m)) out.add(m);
    }
  });
  return [...out];
}

/* ------------------------------------------------------------------ */
/*  The flood plane                                                     */
/* ------------------------------------------------------------------ */

/** three.js' program cache keys of the meshes added here. */
const FLOOD_KEY = "world-react-flood-v1";
const BED_KEY = "world-react-pond-bed-v1";

/** The `aWat` every flood vertex carries: deep water everywhere (the plane
 *  has no rim; the foam where it meets things is the surfaces' patch). */
const FLOOD_DEPTH = 50;

export interface FloodLayer {
  mesh: THREE.Mesh;
  water: WaterMaterial;
  /** Places the plane for a frame: at the surface, shown only while the streets flood. */
  set(s: WaterState): void;
  dispose(): void;
}

export interface FloodOptions {
  /** Half-size, metres (the terrain's extent). Default FLOOD_HALF. */
  half?: number;
  /** Extra patches (height fog, mood palette), applied once. */
  patch?: (m: THREE.Material) => void;
  /** Names `patch` in the program cache key. */
  patchKey?: string;
}

/**
 * The flood plane: one quad the size of the terrain, drawn with
 * `waterMaterial` (the place's own sky, sun and lights-out factor in `look`;
 * a murky deep colour unless `look.deep` says otherwise). It receives
 * shadows and casts none.
 */
export function buildFlood(look: WaterOptions, opts: FloodOptions = {}): FloodLayer {
  const half = opts.half ?? FLOOD_HALF;
  const geometry = markWaterGeometry(new THREE.PlaneGeometry(2 * half, 2 * half, 1, 1).rotateX(-Math.PI / 2), FLOOD_DEPTH);
  const water = waterMaterial({ deep: FLOOD_DEEP, shore: FLOOD_SHORE, ...look });
  water.mat.name = "react-flood";
  opts.patch?.(water.mat);
  water.mat.customProgramCacheKey = () => `${FLOOD_KEY}|${opts.patchKey ?? ""}`;
  const mesh = new THREE.Mesh(geometry, water.mat);
  mesh.name = "react-flood";
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.visible = false;
  return {
    mesh,
    water,
    set(s) {
      mesh.visible = s.surface > WATER_OFF;
      mesh.position.y = mesh.visible ? s.surface : 0;
      water.uTime.value = s.time;
    },
    dispose() {
      geometry.dispose();
      water.mat.dispose();
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Pond beds                                                           */
/* ------------------------------------------------------------------ */

/** A drained pond's bed: wet mud (sRGB) and its roughness. */
export const BED_COLOUR = "#4a3b2b";
export const BED_ROUGHNESS = 0.45;
/** The bed lies this far under the pond's water (between it and the park's ground), metres. */
export const BED_BELOW = 0.007;

export interface PondBeds {
  group: THREE.Group;
  /** Shows the beds once the water bodies drop (drop > 0). */
  set(drop: number): void;
  dispose(): void;
}

/** The beds under the ponds (water.ts pondsFor: the same ponds the place
 *  draws), hidden until a drain lowers the water below them. */
export function buildPondBeds(ponds: readonly Pond[], opts: { patch?: (m: THREE.Material) => void; patchKey?: string } = {}): PondBeds {
  const material = new THREE.MeshStandardMaterial({ name: "react-pond-bed", color: BED_COLOUR, roughness: BED_ROUGHNESS, metalness: 0 });
  opts.patch?.(material);
  material.customProgramCacheKey = () => `${BED_KEY}|${opts.patchKey ?? ""}`;
  const group = new THREE.Group();
  group.name = "react-pond-beds";
  const geometries: THREE.BufferGeometry[] = [];
  for (const pond of ponds) {
    const g = pondGeometry(pond);
    geometries.push(g);
    const mesh = new THREE.Mesh(g, material);
    mesh.position.y = -BED_BELOW;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.visible = false;
  return {
    group,
    set(drop) {
      group.visible = drop > 0 && ponds.length > 0;
    },
    dispose() {
      for (const g of geometries) g.dispose();
      material.dispose();
    },
  };
}
