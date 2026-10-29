/**
 * src/world/react/slabDust.ts
 *
 * Dust puffs where slabs break off (docs/factory/11-world-reactions.md §5):
 * about one per ten slabs (slab.ts dustPuffs), each a soft sprite that
 * appears at its slab's release, expands, drifts up and fades out over
 * DUST_LIFE seconds. Stateless on the GPU like the reaction particles
 * (Latta 2004): a puff is a formula of its spot, its start time and the
 * time uniform, so any frame draws on its own. One instanced draw call,
 * no shadow.
 *
 * The sprite is procedural (`puffSprite`: a lumpy soft disc); the Kenney
 * smoke pack the proposal names is not downloaded. Billboarded in the
 * vertex shader from the view matrix; lit as level ground (its normal
 * points up), so the night dims it like the paving. Uniforms only
 * (patch.ts rule); `puffAt` mirrors the vertex shader for the tests.
 */
import * as THREE from "three";
import { patchMaterial } from "../atmosphere/patch";
import { makeRng } from "../rng";
import type { DustPuffs } from "./slab";

type Vec3 = [number, number, number];

/** A puff's life, seconds. */
export const DUST_LIFE = 1.5;
/** Its size (m) as it starts and as it fades, at seed 0.5. */
export const DUST_SIZE: [number, number] = [0.8, 4.2];
/** How far it rises (m) and drifts sideways (m) over its life. */
export const DUST_RISE = 1.1;
export const DUST_DRIFT = 0.9;
/** Most opacity. */
export const DUST_OPACITY = 0.62;
/** The dust's colour (sRGB): pale earth. */
export const DUST_COLOUR = "#9a8a74";
/** Lens fade: gone at x, full from y (metres from the lens to its edge). */
export const DUST_LENS: [number, number] = [0.6, 3];

/** A puff at one frame (the vertex shader's numbers). */
export interface PuffState {
  centre: Vec3;
  /** Quad size, metres (0: not drawn). */
  size: number;
  alpha: number;
}

const smoothstep = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/** Puff i at time t, seen from `eye`: the vertex shader in TypeScript. */
export function puffAt(puffs: DustPuffs, i: number, t: number, eye: Vec3): PuffState {
  const [x, y, z, start] = puffs.spot.subarray(i * 4, i * 4 + 4);
  const [sz, , dr] = puffs.seed.subarray(i * 4, i * 4 + 4);
  const tau = t - start;
  const u = tau / DUST_LIFE;
  if (!(tau > 0) || u >= 1) return { centre: [x, y, z], size: 0, alpha: 0 };
  const grow = 1 - (1 - u) * (1 - u);
  const size = (DUST_SIZE[0] + (DUST_SIZE[1] - DUST_SIZE[0]) * grow) * (0.7 + 0.6 * sz);
  const az = 2 * Math.PI * dr;
  const centre: Vec3 = [x + Math.cos(az) * DUST_DRIFT * grow, y + 0.3 * size + DUST_RISE * grow, z + Math.sin(az) * DUST_DRIFT * grow];
  const lens = smoothstep(DUST_LENS[0], DUST_LENS[1], Math.hypot(centre[0] - eye[0], centre[1] - eye[1], centre[2] - eye[2]) - 0.5 * size);
  const alpha = DUST_OPACITY * smoothstep(0, 0.08, u) * (1 - smoothstep(0.3, 1, u));
  return { centre, size: size * lens, alpha: lens > 0 ? alpha : 0 };
}

const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);

const HEADER = /* glsl */ `
uniform float uSdTime;
attribute vec4 aPuff;
attribute vec4 aPuffSeed;
varying float vSdAlpha;
varying float vSdShade;
`;

/** Replaces begin_vertex: the billboard at the puff's centre (world: the mesh sits at the origin). */
const BEGIN = /* glsl */ `
float sdTau = uSdTime - aPuff.w;
float sdU = sdTau / ${f(DUST_LIFE)};
float sdOn = ( sdTau > 0.0 && sdU < 1.0 ) ? 1.0 : 0.0;
float sdGrow = 1.0 - ( 1.0 - clamp( sdU, 0.0, 1.0 ) ) * ( 1.0 - clamp( sdU, 0.0, 1.0 ) );
float sdSize = mix( ${f(DUST_SIZE[0])}, ${f(DUST_SIZE[1])}, sdGrow ) * ( 0.7 + 0.6 * aPuffSeed.x );
float sdAz = 6.28318530718 * aPuffSeed.z;
vec3 sdC = aPuff.xyz + vec3( cos( sdAz ) * ${f(DUST_DRIFT)} * sdGrow, 0.3 * sdSize + ${f(DUST_RISE)} * sdGrow, sin( sdAz ) * ${f(DUST_DRIFT)} * sdGrow );
float sdLens = smoothstep( ${f(DUST_LENS[0])}, ${f(DUST_LENS[1])}, length( sdC - cameraPosition ) - 0.5 * sdSize );
vSdAlpha = ${f(DUST_OPACITY)} * sdOn * smoothstep( 0.0, 0.08, sdU ) * ( 1.0 - smoothstep( 0.3, 1.0, sdU ) );
vSdShade = 0.85 + 0.3 * aPuffSeed.w;
float sdTurn = 6.28318530718 * aPuffSeed.y + 0.4 * sdU;
vec2 sdQ = mat2( cos( sdTurn ), sin( sdTurn ), -sin( sdTurn ), cos( sdTurn ) ) * position.xy;
vec3 sdRight = vec3( viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0] );
vec3 sdUp = vec3( viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1] );
vec3 transformed = sdC + ( sdRight * sdQ.x + sdUp * sdQ.y ) * sdSize * sdLens * sdOn;
`;

/** The patched shaders' text (the same for every puff layer). */
export function dustShaders(vertex: string, fragment: string): { vertex: string; fragment: string } {
  return {
    vertex: HEADER + vertex.replace("#include <beginnormal_vertex>", "vec3 objectNormal = vec3( 0.0, 1.0, 0.0 );").replace("#include <begin_vertex>", BEGIN),
    fragment:
      "varying float vSdAlpha;\nvarying float vSdShade;\n" +
      fragment.replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= vSdShade;\ndiffuseColor.a *= vSdAlpha;"),
  };
}

/** The sprite: a lumpy soft disc, white with alpha, `n` px square (pure). */
export function puffSprite(n = 64): Uint8Array<ArrayBuffer> {
  const r = makeRng("react:dust-sprite");
  // A few soft blobs round the centre make the lumps.
  const blobs = Array.from({ length: 7 }, () => {
    const a = 2 * Math.PI * r();
    const d = 0.12 + 0.16 * r();
    return { x: 0.5 + Math.cos(a) * d, y: 0.5 + Math.sin(a) * d, s: 0.16 + 0.1 * r() };
  });
  blobs.push({ x: 0.5, y: 0.5, s: 0.3 });
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n;
      const v = (y + 0.5) / n;
      let a = 0;
      for (const b of blobs) a = Math.max(a, Math.exp(-((u - b.x) ** 2 + (v - b.y) ** 2) / (2 * b.s * b.s * 0.5)));
      // Nothing past the quad's inscribed circle: no square edge.
      a *= 1 - smoothstep(0.38, 0.5, Math.hypot(u - 0.5, v - 0.5));
      const i = (y * n + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(255 * Math.min(1, a));
    }
  }
  return data;
}

let spriteTex: THREE.DataTexture | null = null;
function spriteTexture(): THREE.DataTexture {
  if (spriteTex) return spriteTex;
  const n = 64;
  const tex = new THREE.DataTexture(puffSprite(n), n, n, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  spriteTex = tex;
  return tex;
}

/** three.js' program cache key for the dust material. */
const PROGRAM_KEY = "world-react-dust-v1";

export interface DustLayer {
  mesh: THREE.Mesh;
  uTime: { value: number };
  dispose(): void;
}

/** One instanced quad per puff, its spot and seeds as instance attributes. */
export function buildDustLayer(puffs: DustPuffs, opts: { patch?: (m: THREE.Material) => void; patchKey?: string } = {}): DustLayer {
  const plane = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setIndex(plane.getIndex());
  for (const name of ["position", "normal", "uv"]) geo.setAttribute(name, plane.getAttribute(name));
  geo.setAttribute("aPuff", new THREE.InstancedBufferAttribute(puffs.spot, 4));
  geo.setAttribute("aPuffSeed", new THREE.InstancedBufferAttribute(puffs.seed, 4));
  geo.instanceCount = puffs.count;
  const uTime = { value: 0 };
  const material = new THREE.MeshLambertMaterial({
    name: "react-dust",
    color: DUST_COLOUR,
    map: spriteTexture(),
    transparent: true,
    depthWrite: false,
  });
  patchMaterial(material, (shader) => {
    shader.uniforms.uSdTime = uTime;
    const s = dustShaders(shader.vertexShader, shader.fragmentShader);
    shader.vertexShader = s.vertex;
    shader.fragmentShader = s.fragment;
  });
  opts.patch?.(material);
  material.customProgramCacheKey = () => `${PROGRAM_KEY}|${opts.patchKey ?? ""}`;
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = "react-dust";
  // Positions come from the shader.
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // After the opaque world and the slabs.
  mesh.renderOrder = 2;
  return {
    mesh,
    uTime,
    dispose() {
      geo.dispose();
      plane.dispose();
      material.dispose();
    },
  };
}
