/**
 * src/world/react/ReactionParticles.tsx
 *
 * One kind of reaction particle (confetti, banknotes or lift chips) as a
 * single instanced draw: a quad per particle, its seeds as instance
 * attributes, its motion in the vertex shader (particles.ts). Per frame
 * only the uniforms change (time, bursts, ambient), so frames render in
 * any order in any tab.
 *
 * The material is a two-sided, alpha-tested MeshLambertMaterial (opaque:
 * no sorting) patched with `patchMaterial`, so the world's lights, fog,
 * logarithmic depth and tone mapping apply as to any world material. It
 * casts no shadow (the shadow pass would not see the shader's motion).
 *
 * Draw it as a sibling of GroundWorld, in world coordinates.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { patchMaterial } from "../atmosphere/patch";
import type { Vec3 } from "./lift";
import {
  chipReleases,
  PARTICLE_KINDS,
  particleSeeds,
  particleUniformValues,
  particleVertexShader,
  UNIFORM_NAMES,
  type ParticleKind,
  type ParticleParams,
  type ParticleUniformValues,
} from "./particles";
import { banknoteAtlas, confettiAtlas, type PixelAtlas } from "./textures";
import { MAX_BURSTS, NO_BURSTS, type Burst, type LevelTrack } from "./track";

/** three.js' program cache key for the particle material (its patch
 *  differs from other patched Lambert materials with the same settings). */
const PROGRAM_KEY = "world-react-particles-v1";

const textures = new Map<string, THREE.DataTexture>();

function atlasTexture(name: "notes" | "confetti"): THREE.DataTexture {
  const hit = textures.get(name);
  if (hit) return hit;
  const px: PixelAtlas = name === "notes" ? banknoteAtlas() : confettiAtlas();
  const tex = new THREE.DataTexture(px.data, px.width, px.height, THREE.RGBAFormat);
  // The note colours are sRGB; the confetti shapes are white (any space).
  tex.colorSpace = name === "notes" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false;
  tex.needsUpdate = true;
  textures.set(name, tex);
  return tex;
}

type Uniforms = Record<string, THREE.IUniform>;

/** Uniform objects for every value (filled by applyParticleUniforms). */
function makeUniforms(palette: readonly string[]): Uniforms {
  const u: Uniforms = {};
  const vec2 = new Set(["uRpAmbReach", "uRpSize", "uRpLaunch", "uRpSpeed", "uRpFall", "uRpWind", "uRpRate", "uRpLens", "uRpRise"]);
  for (const name of Object.values(UNIFORM_NAMES)) {
    if (name === "uRpBurstT" || name === "uRpBurstG") u[name] = { value: new Float32Array(MAX_BURSTS) };
    else if (name === "uRpEpi") u[name] = { value: new THREE.Vector3() };
    else if (vec2.has(name)) u[name] = { value: new THREE.Vector2() };
    else u[name] = { value: 0 };
  }
  const colours = palette.length ? palette : ["#ffffff"];
  u.uRpPalette = { value: Array.from({ length: 8 }, (_, i) => new THREE.Color(colours[Math.min(i, colours.length - 1)])) };
  return u;
}

/** Copies one frame's values into the uniform objects. */
export function applyParticleUniforms(u: Uniforms, v: ParticleUniformValues): void {
  for (const key of Object.keys(UNIFORM_NAMES) as (keyof ParticleUniformValues)[]) {
    const target = u[UNIFORM_NAMES[key]];
    const val = v[key];
    if (target.value instanceof Float32Array) target.value.set(val as number[]);
    else if (target.value instanceof THREE.Vector3) target.value.set(...(val as Vec3));
    else if (target.value instanceof THREE.Vector2) target.value.set(...(val as [number, number]));
    else target.value = val as number;
  }
}

export interface ParticleLayer {
  mesh: THREE.Mesh;
  uniforms: Uniforms;
  seeds: Float32Array[];
  count: number;
  /** Writes the chips' per-scene [release, drop, weight, hop] values. */
  setReleases(times: Float32Array): void;
  dispose(): void;
}

/** Builds the instanced quads and the patched material of one kind. */
export function buildParticleLayer(
  kind: ParticleKind,
  placeId: string,
  look: ParticleParams,
  opts: { receiveShadow?: boolean; patch?: (m: THREE.Material) => void; patchKey?: string } = {},
): ParticleLayer {
  const count = Math.max(0, Math.floor(look.count));
  const plane = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setIndex(plane.getIndex());
  for (const name of ["position", "normal", "uv"]) geo.setAttribute(name, plane.getAttribute(name));
  const seeds = particleSeeds(placeId, kind, count);
  ["aSeedA", "aSeedB", "aSeedC", "aSeedD"].forEach((name, k) => geo.setAttribute(name, new THREE.InstancedBufferAttribute(seeds[k], 4)));
  // Chips' per-scene [release, drop, weight, hop] (never released until set).
  const release = new THREE.InstancedBufferAttribute(chipReleases(seeds, count, null, look.chipRadius), 4);
  geo.setAttribute("aRelease", release);
  geo.instanceCount = count;

  const uniforms = makeUniforms(look.palette);
  const material = new THREE.MeshLambertMaterial({
    name: `react-${kind}`,
    map: atlasTexture(kind === "notes" ? "notes" : "confetti"),
    vertexColors: true,
    side: THREE.DoubleSide,
    alphaTest: 0.5,
  });
  patchMaterial(material, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = particleVertexShader(shader.vertexShader);
  });
  opts.patch?.(material);
  material.customProgramCacheKey = () => `${PROGRAM_KEY}|${opts.patchKey ?? ""}`;

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = `react-${kind}`;
  // Positions come from the shader: the geometry's own bounds mean nothing.
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = opts.receiveShadow ?? false;
  return {
    mesh,
    uniforms,
    seeds,
    count,
    setReleases(times) {
      (release.array as Float32Array).set(times.subarray(0, count * 4));
      release.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      plane.dispose();
      material.dispose();
    },
  };
}

export interface ReactionParticlesProps {
  kind: ParticleKind;
  /** The place id (seeds: makeRng(`${placeId}:react:${kind}`)). */
  placeId: string;
  /** The epicentre: x, ground height, z (debris.ts reactionSite). */
  epicentre: Vec3;
  /** Seconds, in the same time base as the bursts and the track. */
  t: number;
  /** The scene's bursts (all of them, static per scene). Default none. */
  bursts?: readonly Burst[];
  /** Ambient density 0..1 (e.g. the level). Default 0. */
  ambient?: number;
  /** chips: the scene's level track (their release times). */
  track?: LevelTrack | null;
  /** chips: the ground they lift off (the plaza or avenue stretch); chips
   *  whose spot is off it never show. Default: the whole chip disc. */
  polygon?: readonly (readonly [number, number])[];
  /** Overrides of the kind's look (PARTICLE_KINDS). */
  params?: Partial<ParticleParams>;
  receiveShadow?: boolean;
  /** Extra material patches (height fog, mood palette), applied once per
   *  layer; a new patch rebuilds the layer, so pass a memoized one (GroundWorld's
   *  is one per scene: its fog and palette uniforms are that scene's). */
  patch?: (m: THREE.Material) => void;
  /** Names the extra patches in the program cache key (the shader's code). */
  patchKey?: string;
}

export function ReactionParticles({
  kind,
  placeId,
  epicentre,
  t,
  bursts = NO_BURSTS,
  ambient = 0,
  track = null,
  polygon,
  params,
  receiveShadow = false,
  patch,
  patchKey,
}: ReactionParticlesProps) {
  // Keyed on the overrides' content, not their identity (an inline object
  // would otherwise rebuild the layer every frame).
  const paramsKey = params ? JSON.stringify(params) : "";
  // paramsKey stands for params.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const look = useMemo((): ParticleParams => ({ ...PARTICLE_KINDS[kind], ...params }), [kind, paramsKey]);
  // The patch is applied once per layer, so a new patch is a new layer: the
  // uniforms it binds are the current scene's (a GroundWorld kept through two
  // scenes of a place gives the second its own fog; keeping the first scene's
  // drew this layer one way after it and another in a fresh tab).
  const layer = useMemo(
    () => buildParticleLayer(kind, placeId, look, { receiveShadow, patch, patchKey }),
    [kind, placeId, look, receiveShadow, patch, patchKey],
  );
  useEffect(() => () => layer.dispose(), [layer]);
  // Chips: release times per scene, from the track (static within it).
  const releases = useMemo(
    () =>
      look.mode === 2
        ? chipReleases(layer.seeds, layer.count, track, look.chipRadius, polygon ? { epi: [epicentre[0], epicentre[2]], polygon } : undefined)
        : null,
    // The epicentre is fixed per scene; its numbers stand for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layer, track, look, polygon, epicentre[0], epicentre[2]],
  );
  // What the release attribute holds now (rewritten only when it changes).
  const written = useRef<{ layer: ParticleLayer | null; releases: Float32Array | null }>({ layer: null, releases: null });
  const [ex, ey, ez] = epicentre;

  useFrame(() => {
    if (releases && (written.current.layer !== layer || written.current.releases !== releases)) {
      layer.setReleases(releases);
      written.current = { layer, releases };
    }
    applyParticleUniforms(layer.uniforms, particleUniformValues(look, { time: t, epi: [ex, ey, ez], bursts, ambient }));
  });

  return <primitive object={layer.mesh} />;
}
