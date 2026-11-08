/**
 * src/world/react/darkShader.ts
 *
 * The three.js side of lights out (dark.ts): one set of shared uniforms the
 * place writes every frame, and `onBeforeCompile` patches that switch a
 * material's own light off per light (dkLit, from a per-vertex or
 * per-instance key [x, z, id]) or fade the sky dome to DARK_SKY.
 *
 *  - `patchDarkEmissive`: a lit material's emissive (the box-city walls'
 *    night windows, the far cards' glow, the lamp heads) times dkLit(aDark).
 *  - `patchDarkBasic`: an unlit additive material (the lamps' light pools)
 *    times dkLit(aDark).
 *  - `patchDarkSky`: the gradient dome mixes toward its DARK_SKY colours.
 *  - The kit window glow (kitWindows.ts) carries the same code itself, keyed
 *    by the glow copies' instanceColor.
 *
 * Every patch is applied once per material (a WeakSet: the kit materials
 * are shared across files) and names itself in the program cache key. The
 * uniforms are module-wide: one place is drawn at a time, and GroundWorld
 * writes them every frame (its rest values without a reaction), so a scene
 * without lights out renders exactly as before: dkLit is exactly 1 and every
 * mix is exactly 0.
 */
import * as THREE from "three";
import { patchMaterial } from "../atmosphere/patch";
import { DARK_GLSL, DARK_REST, DARK_SKY, discFade, type DarkState } from "./dark";

/** The shared uniforms (one place at a time). */
export const DARK_UNIFORMS = {
  uDarkCentre: { value: new THREE.Vector2() },
  uDarkReach: { value: 0 },
  uDarkPast: { value: 0 },
  uDarkTick: { value: 0 },
  /** 0 lit .. 1: how far the sky has gone to DARK_SKY (dome, height fog). */
  uDarkSky: { value: 0 },
  /** The sky's brightness against its lit self (the drawn water's light). */
  uDarkSkyGain: { value: 1 },
  /** Self-lit kit materials (unlit, or a fixed emissive): the key light's factor. */
  uDarkUnlit: { value: 1 },
};

/** Writes a frame's state into the shared uniforms (null: nothing happened). */
export function setDarkUniforms(s: DarkState | null): void {
  const v = s ?? DARK_REST;
  DARK_UNIFORMS.uDarkCentre.value.set(v.centre[0], v.centre[1]);
  DARK_UNIFORMS.uDarkReach.value = v.reach;
  DARK_UNIFORMS.uDarkPast.value = v.past;
  DARK_UNIFORMS.uDarkTick.value = v.tick;
  DARK_UNIFORMS.uDarkSky.value = v.sky;
  DARK_UNIFORMS.uDarkSkyGain.value = v.skyGain;
  DARK_UNIFORMS.uDarkUnlit.value = v.key;
}

const WAVE = ["uDarkCentre", "uDarkReach", "uDarkPast", "uDarkTick"] as const;

/** Binds the wave's shared uniforms into a program. */
export function bindDarkWave(uniforms: Record<string, THREE.IUniform>): void {
  for (const k of WAVE) uniforms[k] = DARK_UNIFORMS[k];
}

const PATCHED = new WeakSet<THREE.Material>();

/** Patches `mat` once, and names the patch in its program cache key (the
 *  chained onBeforeCompile alone reads the same for every patched material). */
function patchOnce(mat: THREE.Material, tag: string, fn: (shader: THREE.WebGLProgramParametersWithUniforms) => void): void {
  if (PATCHED.has(mat)) return;
  PATCHED.add(mat);
  patchMaterial(mat, fn);
  const key = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${key()}|${tag}`;
}

/** Vertex side of a keyed patch: dkLit of the per-vertex or per-instance aDark. */
function keyedVertex(shader: THREE.WebGLProgramParametersWithUniforms): void {
  bindDarkWave(shader.uniforms);
  shader.vertexShader =
    "attribute vec3 aDark;\nflat varying float vDarkLit;\n" +
    DARK_GLSL +
    shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n  vDarkLit = dkLit( aDark );");
}

/** A lit material's emissive goes out with its light (geometry: an aDark key per vertex or instance). */
export function patchDarkEmissive(mat: THREE.Material): void {
  patchOnce(mat, "dark-emissive", (shader) => {
    keyedVertex(shader);
    shader.fragmentShader =
      "flat varying float vDarkLit;\n" +
      shader.fragmentShader.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n  totalEmissiveRadiance *= vDarkLit;");
  });
}

/** An unlit (additive) material goes out with its light (geometry: an aDark key). */
export function patchDarkBasic(mat: THREE.Material): void {
  patchOnce(mat, "dark-basic", (shader) => {
    keyedVertex(shader);
    shader.fragmentShader =
      "flat varying float vDarkLit;\n" +
      shader.fragmentShader.replace("#include <opaque_fragment>", "#include <opaque_fragment>\n  gl_FragColor.rgb *= vDarkLit;");
  });
}

/**
 * A self-lit kit material ignores the lights, so it dims with the key light
 * by hand (the whole piece, no wave: it stands for daylight, not a powered
 * lamp). Unlit materials (glTF KHR_materials_unlit loads as a
 * MeshBasicMaterial; Kenney's retro-urban kit is all unlit) dim whole; an
 * emissive one dims its emissive (Kenney's building-kit glass glows a fixed
 * pale blue). Returns whether the material is self-lit.
 */
export function patchDarkSelfLit(mat: THREE.Material): boolean {
  const std = mat as THREE.MeshStandardMaterial;
  if ((mat as THREE.MeshBasicMaterial).isMeshBasicMaterial) {
    patchOnce(mat, "dark-unlit", (shader) => {
      shader.uniforms.uDarkUnlit = DARK_UNIFORMS.uDarkUnlit;
      shader.fragmentShader =
        "uniform float uDarkUnlit;\n" +
        shader.fragmentShader.replace("#include <opaque_fragment>", "#include <opaque_fragment>\n  gl_FragColor.rgb *= uDarkUnlit;");
    });
    return true;
  }
  if (std.isMeshStandardMaterial && (std.emissiveMap || std.emissive.r + std.emissive.g + std.emissive.b > 0)) {
    patchOnce(mat, "dark-selflit", (shader) => {
      shader.uniforms.uDarkUnlit = DARK_UNIFORMS.uDarkUnlit;
      shader.fragmentShader =
        "uniform float uDarkUnlit;\n" +
        shader.fragmentShader.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n  totalEmissiveRadiance *= uDarkUnlit;");
    });
    return true;
  }
  return false;
}

/** The aDark keys as an attribute: per vertex, or per instance of an InstancedMesh. */
export function darkKeyAttribute(keys: Float32Array, instanced: boolean): THREE.BufferAttribute {
  return instanced ? new THREE.InstancedBufferAttribute(keys, 3) : new THREE.BufferAttribute(keys, 3);
}

/**
 * The sky dome fades to DARK_SKY with uDarkSky: a second colour per vertex
 * (the dark gradient by the vertex's height, as the dome's own), mixed in
 * after the vertex colours. `radius` is the dome's.
 */
export function patchDarkSky(mesh: THREE.Mesh): void {
  const geo = mesh.geometry;
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const zenith = new THREE.Color(DARK_SKY.zenith);
  const horizon = new THREE.Color(DARK_SKY.horizon);
  const below = horizon.clone().multiplyScalar(0.8);
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    if (v.y >= 0) c.copy(horizon).lerp(zenith, Math.pow(v.y, 0.55));
    else c.copy(horizon).lerp(below, Math.min(1, -v.y * 6));
    c.toArray(colors, i * 3);
  }
  geo.setAttribute("aDarkSky", new THREE.BufferAttribute(colors, 3));
  patchOnce(mesh.material as THREE.Material, "dark-sky", (shader) => {
    shader.uniforms.uDarkSky = DARK_UNIFORMS.uDarkSky;
    shader.vertexShader =
      "attribute vec3 aDarkSky;\nuniform float uDarkSky;\n" +
      shader.vertexShader.replace("#include <color_vertex>", "#include <color_vertex>\n  vColor.rgb = mix( vColor.rgb, aDarkSky, uDarkSky );");
  });
}

/** DARK_SKY's horizon in linear light (the scene fog and background fade to it). */
export const DARK_HORIZON = new THREE.Color(DARK_SKY.horizon);

/** Each dimmed object's lit value, recorded the first time a rig sees it
 *  (before anything dimmed it), so a rebuilt rig never takes a dimmed value. */
const LIT = new WeakMap<object, number | THREE.Color>();
function litValue<T extends number | THREE.Color>(owner: object, now: T): T {
  if (!LIT.has(owner)) LIT.set(owner, typeof now === "number" ? now : now.clone());
  return LIT.get(owner) as T;
}

/**
 * What a place dims each frame besides the patched materials: the sun or
 * moon (key), the sky light (fill), the sun's and the moon's discs, the
 * clouds' own glow, the scene fog and background (to DARK_SKY's horizon).
 * The returned function writes the shared uniforms too, and with null (no
 * reaction) puts every lit value back exactly.
 *
 * The discs fade out with the key (opacity, dark.ts discFade), never to a
 * dark disc over the sky: the sun's opaque disc turns translucent only while
 * dimmed. The clouds' glow (the sky's and the city's light on them) falls
 * with the darker of the sky and the key, so a blackout under a night sky
 * (whose gain stays 1) still takes it down.
 */
export function darkRig(o: {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  disk: THREE.Mesh;
  clouds: THREE.Mesh;
  /** The moon's additive disc (atmosphere/moon.ts), at night. */
  moon?: THREE.Sprite | null;
  /** The lit fog and background colour (the sky's horizon). */
  horizon: string;
}): (s: DarkState | null, scene: THREE.Scene) => void {
  const disk = o.disk.material as THREE.MeshBasicMaterial;
  const clouds = o.clouds.material as THREE.MeshStandardMaterial;
  const moon = o.moon ? (o.moon.material as THREE.SpriteMaterial) : null;
  const base = {
    sun: litValue(o.sun, o.sun.intensity),
    hemi: litValue(o.hemi, o.hemi.intensity),
    disk: litValue(disk, disk.color),
    cloud: litValue(clouds, clouds.emissiveIntensity),
    moon: moon ? litValue(moon, moon.opacity) : 0,
  };
  const horizon = new THREE.Color(o.horizon);
  return (s, scene) => {
    const v = s ?? DARK_REST;
    setDarkUniforms(s);
    o.sun.intensity = base.sun * v.key;
    o.hemi.intensity = base.hemi * v.fill;
    disk.color.copy(base.disk);
    const shown = discFade(v.key);
    if (disk.transparent !== shown < 1) {
      disk.transparent = shown < 1;
      disk.needsUpdate = true;
    }
    disk.opacity = shown;
    if (moon) moon.opacity = base.moon * shown;
    clouds.emissiveIntensity = base.cloud * Math.min(v.skyGain, v.key);
    if (scene.fog instanceof THREE.Fog) scene.fog.color.copy(horizon).lerp(DARK_HORIZON, v.sky);
    if (scene.background instanceof THREE.Color) scene.background.copy(horizon).lerp(DARK_HORIZON, v.sky);
  };
}
