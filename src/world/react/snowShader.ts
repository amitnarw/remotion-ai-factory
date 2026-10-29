/**
 * src/world/react/snowShader.ts
 *
 * The three.js side of snow (snow.ts): the shared cover uniforms the place
 * writes every frame, the `onBeforeCompile` patches that whiten the world's
 * materials, and the snowfall volume.
 *
 *  - `patchSnowCover`: every world material (ground, terrain, walls, roofs,
 *    props, trees, dressing, kit pieces): snow on what faces up.
 *  - `patchSnowCards`: the far kit cards: the same, plus a band below each
 *    building's top (their `aSnowTop` attribute, snowCardAttribute).
 *  - `buildSnowfall`: the flakes, one instanced draw of camera-facing quads
 *    moved in the vertex shader (no CPU work per frame but a few uniforms).
 *
 * Every patch is applied once per material (a WeakSet per patch: the kit
 * materials are shared across files) and names itself in the program cache
 * key. The cover uniforms are module-wide (one place is drawn at a time),
 * written every frame; at rest (cover 0) the patch's branch is never taken.
 */
import * as THREE from "three";
import { patchMaterial } from "../atmosphere/patch";
import { keyBefore } from "./waterShader";
import {
  cardSnowTops,
  SNOW_COLOUR,
  SNOWFALL_COLOUR,
  SNOWFALL_FRAGMENT,
  SNOWFALL_OPACITY,
  SNOWFALL_VERTEX,
  snowfallSeeds,
  snowShaders,
  type SnowfallValues,
  type SnowState,
} from "./snow";

/** The shared cover uniforms (one place at a time). */
export const SNOW_UNIFORMS = {
  /** 0..1: the snow cover (0: none, the branch is never taken). */
  uSnLevel: { value: 0 },
  uSnColour: { value: new THREE.Color(SNOW_COLOUR) },
};

/** Writes a frame's cover into the shared uniforms (null: nothing happened). */
export function setSnowUniforms(s: SnowState | null): void {
  const c = s?.cover ?? 0;
  SNOW_UNIFORMS.uSnLevel.value = Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0;
}

const PATCHED = new Map<string, WeakSet<THREE.Material>>();

/** Patches `mat` once per tag, and names the patch in its program cache key. */
function patchOnce(mat: THREE.Material, tag: string, fn: (shader: THREE.WebGLProgramParametersWithUniforms) => void): boolean {
  let done = PATCHED.get(tag);
  if (!done) PATCHED.set(tag, (done = new WeakSet()));
  if (done.has(mat)) return false;
  done.add(mat);
  // The key before the patch (waterShader.ts keyBefore: a default key's
  // value is taken now, so no two keys that differed are merged).
  const key = keyBefore(mat);
  patchMaterial(mat, fn);
  mat.customProgramCacheKey = () => `${key()}|${tag}`;
  return true;
}

function bindCover(shader: THREE.WebGLProgramParametersWithUniforms, cards: boolean): void {
  shader.uniforms.uSnLevel = SNOW_UNIFORMS.uSnLevel;
  shader.uniforms.uSnColour = SNOW_UNIFORMS.uSnColour;
  const s = snowShaders(shader.vertexShader, shader.fragmentShader, cards);
  shader.vertexShader = s.vertex;
  shader.fragmentShader = s.fragment;
}

/**
 * Snow cover on a world material: lit or unlit, any mesh material (the
 * white goes into the albedo before lighting, the roughness of a standard
 * material up). Apply before the material's first compile, or set
 * `needsUpdate` after. Not on the far cards (patchSnowCards).
 */
export function patchSnowCover(mat: THREE.Material): void {
  patchOnce(mat, "react-snow", (shader) => bindCover(shader, false));
}

/** The far cards' cover: the slope term (their roof cards) plus a band
 *  below each building's top. Their geometry needs `aSnowTop`. */
export function patchSnowCards(mat: THREE.Material): void {
  patchOnce(mat, "react-snow-cards", (shader) => bindCover(shader, true));
}

/** The `aSnowTop` attribute of the far cards' merged mesh (kitLod.ts FarCards). */
export function snowCardAttribute(cards: { position: Float32Array; index: Uint32Array; ranges: Uint32Array }): THREE.BufferAttribute {
  return new THREE.BufferAttribute(cardSnowTops(cards), 1);
}

/* ------------------------------------------------------------------ */
/*  Snowfall                                                            */
/* ------------------------------------------------------------------ */

export interface SnowfallLayer {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  count: number;
  /** Writes one frame's values, and the flakes' colour and brightness. */
  set(v: SnowfallValues, look?: { colour?: string; light?: number }): void;
  dispose(): void;
}

/**
 * The snowfall of a place: `count` flakes (snow.ts snowfallCount keeps the
 * scene within §5's budget) as instanced quads, seeded by the place. A
 * transparent ShaderMaterial (no depth write) with the world's log depth,
 * tone mapping and colour space; it ignores the fog (35 m at most) and
 * casts no shadow. Never frustum-culled: positions come from the shader.
 */
export function buildSnowfall(placeId: string, count: number): SnowfallLayer {
  const n = Math.max(0, Math.floor(count));
  const quad = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex(quad.getIndex());
  geometry.setAttribute("position", quad.getAttribute("position"));
  geometry.setAttribute("uv", quad.getAttribute("uv"));
  const seeds = snowfallSeeds(placeId, n);
  ["aSfA", "aSfB", "aSfC"].forEach((name, k) => geometry.setAttribute(name, new THREE.InstancedBufferAttribute(seeds[k], 4)));
  geometry.instanceCount = n;
  const colour = new THREE.Color(SNOWFALL_COLOUR);
  const material = new THREE.ShaderMaterial({
    name: "react-snowfall",
    uniforms: {
      uSfTime: { value: 0 },
      uSfFall: { value: 0 },
      uSfWind: { value: new THREE.Vector2() },
      uSfColumn: { value: new THREE.Vector2() },
      uSfLens: { value: new THREE.Vector2() },
      uSfViewH: { value: 0 },
      uSfMinPx: { value: 0 },
      uSfColour: { value: colour.clone() },
      uSfOpacity: { value: SNOWFALL_OPACITY },
    },
    vertexShader: SNOWFALL_VERTEX,
    fragmentShader: SNOWFALL_FRAGMENT,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "react-snowfall";
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  const u = material.uniforms;
  const tint = new THREE.Color();
  return {
    mesh,
    material,
    count: n,
    set(v, look) {
      u.uSfTime.value = v.time;
      u.uSfFall.value = v.fall;
      (u.uSfWind.value as THREE.Vector2).set(v.wind[0], v.wind[1]);
      (u.uSfColumn.value as THREE.Vector2).set(v.column[0], v.column[1]);
      (u.uSfLens.value as THREE.Vector2).set(v.lens[0], v.lens[1]);
      u.uSfViewH.value = v.viewH;
      u.uSfMinPx.value = v.minPx;
      tint.set(look?.colour ?? SNOWFALL_COLOUR).multiplyScalar(Math.max(0, look?.light ?? 1));
      (u.uSfColour.value as THREE.Color).copy(tint);
      mesh.visible = n > 0 && v.fall > 0;
    },
    dispose() {
      geometry.dispose();
      quad.dispose();
      material.dispose();
    },
  };
}
