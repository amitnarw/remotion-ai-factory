/**
 * src/world/atmosphere/water.ts
 *
 * The drawn water of the city's open blocks (Phase 5 step 2): park blocks
 * get a wavy-edged pond with a shore blend, and the plaza fountain's pool
 * shares the same material. The look is one `onBeforeCompile` patch on a
 * MeshStandardMaterial (so night and light stay physically driven): an
 * animated ripple normal, a fake sky reflection that strengthens with the
 * viewing angle, a sun glint, a mud band and a foam line where the water
 * meets the bank. Cheap and deterministic: every animated uniform is
 * `uTime = frame / fps`, set by the caller.
 *
 * The shore is baked at build time as a per-vertex `aWat` attribute
 * (metres to the rim), so no depth pre-pass and no per-vertex work later.
 */
import * as THREE from "three";
import { makeRng } from "../rng";
import type { CityLayout } from "../city";
import { GROUND, openBlocks } from "../cityAnchors";
import { patchMaterial } from "./patch";

/* ------------------------------------------------------------------ */
/*  Where ponds go                                                      */
/* ------------------------------------------------------------------ */

function pointInPolygon(x: number, z: number, poly: readonly [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export interface Pond {
  x: number;
  z: number;
  /** Nominal radius (m); the rim waves between 0.8 and 1.0 of it. */
  r: number;
  /** Rim radius per angle step (SEG angles), r times a 0.8..1 noise. */
  radii: number[];
  /** The ground the pond sits on (the park's y). */
  y: number;
}

const SEG = 20;
/** Smooth 0..1 at s through cosine-interpolated knots. */
function smoothNoise(s: number, knots: number[]): number {
  const n = knots.length;
  const t = (s * n) % n;
  const i = Math.floor(t);
  const f = (t - i) * (1 - Math.cos(Math.PI * (t - i))) / 2; // cosine ease
  return knots[i % n] + (knots[(i + 1) % n] - knots[i % n]) * f;
}

/**
 * Ponds inside the park blocks, largest first: the disc must fit inside
 * the block with room for its bank. Deterministic per seed.
 */
export function pondsFor(layout: CityLayout, seed: string, max = 4): Pond[] {
  const r = makeRng(`ponds:${seed}`);
  const big = (a: { polygon: [number, number][] }) => {
    const xs = a.polygon.map((p) => p[0]);
    const zs = a.polygon.map((p) => p[1]);
    return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs)) > 2600;
  };
  const parks = openBlocks(layout, GROUND.park).filter((a) => big(a as never));
  const out: Pond[] = [];
  for (const park of parks) {
    if (out.length >= max) break;
    const [cx, cz] = park.polygon.reduce(([ax, az], p) => [ax + p[0], az + p[1]], [0, 0]).map((v) => v / park.polygon.length) as [number, number];
    // How far the block reaches in every direction (metres, from centre).
    let reach = Infinity;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      let t = 1;
      for (; t < 90; t += 1) {
        if (!pointInPolygon(cx + dx * t, cz + dz * t, park.polygon)) break;
      }
      reach = Math.min(reach, t - 1);
    }
    if (!isFinite(reach) || reach * 0.4 < 4) continue;
    const rr = reach * 0.4;
    const knots = Array.from({ length: 5 }, () => r());
    const radii = Array.from({ length: SEG }, (_, i) => rr * (0.8 + 0.2 * smoothNoise(i / SEG, knots)));
    out.push({ x: cx, z: cz, r: rr, radii, y: park.y });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Geometry: a radial disc whose rim follows `radii`                   */
/* ------------------------------------------------------------------ */

/** One-centre, two-ring disc: water shades from the rim (shore) inward. */
export function pondGeometry(pond: Pond, expand = 1): THREE.BufferGeometry {
  const rows = [0.55, 1];
  const pos: number[] = [];
  const uv: number[] = [];
  const wat: number[] = [];
  pos.push(pond.x, pond.y + 0.014, pond.z); // vertex 0: the centre
  uv.push(0, 0);
  wat.push(pond.radii[0]);
  const ringVerts: number[][] = [];
  for (const f of rows) {
    const row: number[] = [];
    for (let i = 0; i <= SEG; i++) {
      const a = (i % SEG) * ((Math.PI * 2) / SEG);
      const rad = pond.radii[i % SEG] * f * expand;
      pos.push(pond.x + Math.sin(a) * rad, pond.y + 0.014, pond.z + Math.cos(a) * rad);
      uv.push(f, i / SEG);
      wat.push((1 - f) * pond.radii[i % SEG] * expand);
      row.push(pos.length / 3 - 1);
    }
    ringVerts.push(row);
  }
  const idx: number[] = [];
  for (let i = 0; i < SEG; i++) idx.push(0, ringVerts[0][i], ringVerts[0][i + 1]);
  for (let i = 0; i < SEG; i++) {
    idx.push(ringVerts[0][i], ringVerts[1][i], ringVerts[1][i + 1], ringVerts[0][i], ringVerts[1][i + 1], ringVerts[0][i + 1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("aWat", new THREE.Float32BufferAttribute(wat, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Marks an arbitrary closed geometry (the fountain's pool disc) as water:
 *  every vertex is deep water (uWatShoreM metres or more from a rim). */
export function markWaterGeometry(geo: THREE.BufferGeometry, depth = 2.5): THREE.BufferGeometry {
  const n = geo.attributes.position.count;
  geo.setAttribute("aWat", new THREE.Float32BufferAttribute(new Float32Array(n).fill(depth), 1));
  return geo;
}

/** An annulus hugging the pond's rim: the bank the water blends into. */
export function bankGeometry(pond: Pond): THREE.BufferGeometry {
  const rows = [1.06, 1.3];
  const pos: number[] = [];
  const rowVerts: number[][] = [];
  for (const f of rows) {
    const row: number[] = [];
    for (let i = 0; i <= SEG; i++) {
      const a = (i % SEG) * ((Math.PI * 2) / SEG);
      const rad = pond.radii[i % SEG] * f;
      pos.push(pond.x + Math.sin(a) * rad, pond.y + 0.024, pond.z + Math.cos(a) * rad);
      row.push(pos.length / 3 - 1);
    }
    rowVerts.push(row);
  }
  const idx: number[] = [];
  for (let i = 0; i < SEG; i++) {
    idx.push(rowVerts[0][i], rowVerts[1][i], rowVerts[1][i + 1], rowVerts[0][i], rowVerts[1][i + 1], rowVerts[0][i + 1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------------ */
/*  The material                                                        */
/* ------------------------------------------------------------------ */

export interface WaterOptions {
  /** Reflection colour at grazing angles (the sky's horizon). */
  sky: string;
  deep?: string;
  /** The bank colour the shore band blends into. */
  shore?: string;
  foam?: string;
  /** Shore band width in metres (default 1.6). */
  shoreM?: number;
  /** How much the patch's water look replaces the lit base (0..1). */
  mix?: number;
  sunColor?: string;
  sunDir?: [number, number, number];
}

export interface WaterMaterial {
  mat: THREE.MeshStandardMaterial;
  /** Seconds into the video (frame / fps); set by the caller. */
  uTime: { value: number };
}

const WPRE_F = `
uniform float uWatTime;
uniform vec3 uWatDeep;
uniform vec3 uWatSky;
uniform vec3 uWatSun;
uniform vec3 uWatSunDir;
uniform vec3 uWatShore;
uniform vec3 uWatFoam;
uniform float uWatShoreM;
uniform float uWatMix;
`;

const WPRE_V = `
attribute float aWat;
varying vec3 vWatPos;
varying float vWatShore;
`;

export function waterMaterial(opts: WaterOptions): WaterMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: opts.deep ?? "#2e7d84",
    roughness: 0.16,
    metalness: 0,
  });
  const uTime = { value: 0 };
  patchMaterial(mat, (shader) => {
    shader.uniforms.uWatTime = uTime;
    shader.uniforms.uWatDeep = { value: new THREE.Color(opts.deep ?? "#2e7d84") };
    shader.uniforms.uWatSky = { value: new THREE.Color(opts.sky) };
    shader.uniforms.uWatSun = { value: new THREE.Color(opts.sunColor ?? "#ffffff").multiplyScalar(1.4) };
    shader.uniforms.uWatSunDir = { value: new THREE.Vector3(...(opts.sunDir ?? [0.3, 0.8, 0.2])).normalize() };
    shader.uniforms.uWatShore = { value: new THREE.Color(opts.shore ?? "#b3a077") };
    shader.uniforms.uWatFoam = { value: new THREE.Color(opts.foam ?? "#e8ecd8") };
    shader.uniforms.uWatShoreM = { value: opts.shoreM ?? 1.6 };
    shader.uniforms.uWatMix = { value: opts.mix ?? 0.85 };
    shader.vertexShader =
      WPRE_V +
      shader.vertexShader.replace(
        "#include <project_vertex>",
        `#include <project_vertex>
  vWatPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
  vWatShore = aWat;`,
      );
    shader.fragmentShader =
      WPRE_F +
      "varying vec3 vWatPos;\nvarying float vWatShore;\n" +
      shader.fragmentShader.replace(
        "#include <colorspace_fragment>",
        `#include <colorspace_fragment>
  {
    vec3 wV = normalize( cameraPosition - vWatPos );
    float wA = vWatPos.x * 1.9 + vWatPos.z * 1.3;
    vec3 wN = normalize( vec3(
      sin( wA + uWatTime * 1.6 + vWatPos.z * 2.1 ) * 0.055 + sin( vWatPos.z * 3.3 - uWatTime * 1.1 ) * 0.04,
      1.0,
      cos( vWatPos.x * 2.7 - uWatTime * 1.3 ) * 0.05 + sin( wA * 1.5 + uWatTime * 1.9 ) * 0.035
    ) );
    float wGraz = 1.0 - clamp( abs( wV.y ), 0.0, 1.0 );
    vec3 wRefl = mix( uWatDeep, uWatSky, 0.15 + 0.85 * pow( wGraz, 2.2 ) );
    wRefl += uWatSun * pow( max( dot( reflect( -wV, wN ), uWatSunDir ), 0.0 ), 90.0 );
    float wShal = 1.0 - clamp( vWatShore / uWatShoreM, 0.0, 1.0 );
    vec3 wCol = mix( wRefl, uWatShore, smoothstep( 0.72, 0.98, wShal ) );
    float wFoam = smoothstep( 0.55, 0.88, wShal ) *
      ( 0.55 + 0.45 * sin( vWatPos.x * 3.7 + vWatPos.z * 3.1 + uWatTime * 2.3 ) );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, wCol, uWatMix ) + uWatFoam * wFoam * 0.35;
  }`,
      );
  });
  return { mat, uTime };
}
