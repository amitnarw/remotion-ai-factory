/**
 * src/world/vfx/VfxLayer.tsx
 *
 * Draws a scene's effects (docs/factory/21-vfx-effekseer.md §6): each
 * effect is its family's parts (families.ts), each part one instanced draw
 * of a fixed count whose particles are a formula of the frame's time in the
 * vertex shader (emitter.ts). Per frame only uniforms change, and a flash
 * light's position, colour and intensity, so frames render in any order in
 * any tab: a looping fire at t = 80 s draws as it would in a sequence.
 *
 * The rules it keeps (docs/factory/17-code-map-world.md §1.6):
 *  - nothing is created mid-scene: every part's mesh and the one flash light
 *    are in the scene from the layer's first frame (a particle not alive is
 *    collapsed to a point, never hidden), so every program compiles there;
 *  - nothing is frustum culled, and each mesh has a fixed bounding sphere
 *    round its effect (three sorts transparent meshes by it), and a fixed
 *    render order: opaque parts after the world's opaque meshes, glows after
 *    the world's transparent ones (the slab dust's 2);
 *  - the lens comes from the shader's own camera at draw time (billboards,
 *    the near fade), never from `camera` in a frame callback;
 *  - one flash light per layer, made only when some effect has one: it
 *    takes the brightest flash of the frame, at intensity 0 between them.
 *
 * Materials: glows are additive MeshBasicMaterials (no depth write, no fog:
 * fog would add haze to an additive glow); cards are alpha-tested opaque
 * MeshBasicMaterials (the toon flames); lit parts are flat-shaded
 * MeshLambertMaterials under the world's lights, fog and the caller's patch
 * (height fog, mood palette). No shadows (the shadow pass would not see the
 * shader's motion).
 *
 * Mounted by GroundWorld only when a scene lists effects (the intent rule);
 * with none it is not mounted and the scene draws exactly as before.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { patchMaterial } from "../atmosphere/patch";
import {
  EMITTER_BASE,
  VFX_UNIFORM_NAMES,
  vfxBasicFragment,
  vfxLitFragment,
  vfxUniformValues,
  vfxVertexShader,
  type EmitterParams,
  type Vec3,
  type VfxGeometryKind,
  type VfxUniformValues,
} from "./emitter";
import { effectLength, familyPreset, flashIntensity, type FamilyPreset } from "./families";
import { sheetPixels, type VfxSheet } from "./flipbook";
import type { PlacedVfx } from "./spec";

/** three.js' program cache key for the effects' materials. */
const PROGRAM_KEY = "world-vfx-v1";
/** Render order: opaque parts after the world's opaque meshes; glows after its transparent ones. */
export const VFX_ORDER = { opaque: 1, glow: 3 } as const;

const textures = new Map<VfxSheet, THREE.DataTexture>();

/** A sheet as a texture, made once per tab (its pixels are pure data). */
function sheetTexture(kind: VfxSheet): THREE.DataTexture {
  const hit = textures.get(kind);
  if (hit) return hit;
  const px = sheetPixels(kind);
  const tex = new THREE.DataTexture(px.data, px.width, px.height, THREE.RGBAFormat);
  // Data channels (shape, heat, noise), not colours.
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false;
  tex.needsUpdate = true;
  textures.set(kind, tex);
  return tex;
}

/** A part's base mesh: a unit quad, or a low-poly puff or chunk, each face with its centre and a random (aVfxFace). */
function baseGeometry(kind: VfxGeometryKind): THREE.BufferGeometry {
  if (kind === "quad") {
    const g = new THREE.PlaneGeometry(1, 1);
    g.setAttribute("aVfxFace", new THREE.Float32BufferAttribute(new Float32Array(4 * 4), 4));
    return g;
  }
  // Polyhedra are non-indexed: three vertices per face.
  const g = new THREE.IcosahedronGeometry(1, kind === "puff" ? 1 : 0);
  const pos = g.getAttribute("position");
  const face = new Float32Array(pos.count * 4);
  // A fixed per-face random (the order faces dissolve in), the same for every tab.
  let h = 0x2545f491;
  for (let f = 0; f < pos.count; f += 3) {
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
    const r = ((h >>> 8) & 0xffff) / 65536;
    const cx = (pos.getX(f) + pos.getX(f + 1) + pos.getX(f + 2)) / 3;
    const cy = (pos.getY(f) + pos.getY(f + 1) + pos.getY(f + 2)) / 3;
    const cz = (pos.getZ(f) + pos.getZ(f + 1) + pos.getZ(f + 2)) / 3;
    for (let k = 0; k < 3; k++) face.set([cx, cy, cz, r], (f + k) * 4);
  }
  g.setAttribute("aVfxFace", new THREE.Float32BufferAttribute(face, 4));
  return g;
}

type Uniforms = Record<string, THREE.IUniform>;

/** Uniform objects for every value (filled by applyVfxUniforms). */
function makeUniforms(): Uniforms {
  const u: Uniforms = {};
  const sample = vfxUniformValues(EMITTER_BASE, { time: 0, at: [0, 0, 0], scale: 1, seed: "", emitFor: 0 });
  for (const key of Object.keys(VFX_UNIFORM_NAMES) as (keyof VfxUniformValues)[]) {
    const v = sample[key];
    const name = VFX_UNIFORM_NAMES[key];
    if (key === "colour") u[name] = { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) };
    else if (typeof v === "number") u[name] = { value: 0 };
    else if (v.length === 2) u[name] = { value: new THREE.Vector2() };
    else if (v.length === 3) u[name] = { value: new THREE.Vector3() };
    else u[name] = { value: new THREE.Vector4() };
  }
  return u;
}

/** Copies one frame's values into the uniform objects (linear colours as plain vectors: no colour management). */
export function applyVfxUniforms(u: Uniforms, v: VfxUniformValues): void {
  for (const key of Object.keys(VFX_UNIFORM_NAMES) as (keyof VfxUniformValues)[]) {
    const target = u[VFX_UNIFORM_NAMES[key]];
    const val = v[key];
    if (key === "colour") (target.value as THREE.Vector3[]).forEach((c, i) => c.set(...v.colour[i]));
    else if (typeof val === "number") target.value = val;
    else (target.value as THREE.Vector2 | THREE.Vector3 | THREE.Vector4).fromArray(val as number[]);
  }
}

interface PartMesh {
  mesh: THREE.Mesh;
  part: EmitterParams;
  uniforms: Uniforms;
  dispose(): void;
}

/** One part of one effect: its instanced mesh and material, fixed for the scene. */
function buildPart(part: EmitterParams, sphere: THREE.Sphere, opts: { patch?: (m: THREE.Material) => void; patchKey?: string }): PartMesh {
  const base = baseGeometry(part.geometry);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setIndex(base.getIndex());
  for (const name of ["position", "normal", "uv", "aVfxFace"]) geo.setAttribute(name, base.getAttribute(name));
  const count = Math.max(1, Math.floor(part.count));
  geo.setAttribute("aVfxIndex", new THREE.InstancedBufferAttribute(Float32Array.from({ length: count }, (_, i) => i), 1));
  geo.instanceCount = count;
  // Fixed: three sorts transparent meshes by it, and would otherwise compute it once per tab.
  geo.boundingSphere = sphere.clone();

  const uniforms = makeUniforms();
  let material: THREE.Material;
  if (part.material === "lit") {
    material = new THREE.MeshLambertMaterial({ name: `vfx-${part.name}`, flatShading: true });
    patchMaterial(material, (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = vfxVertexShader(shader.vertexShader);
      shader.fragmentShader = vfxLitFragment(shader.fragmentShader);
    });
    // The world's height fog and mood palette, as on the reaction particles.
    opts.patch?.(material);
  } else {
    const glow = part.material === "glow";
    material = new THREE.MeshBasicMaterial({
      name: `vfx-${part.name}`,
      map: sheetTexture(part.sheet),
      side: THREE.DoubleSide,
      ...(glow ? { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false } : { alphaTest: 0.5 }),
    });
    patchMaterial(material, (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = vfxVertexShader(shader.vertexShader);
      shader.fragmentShader = vfxBasicFragment(shader.fragmentShader);
    });
  }
  const lit = part.material === "lit";
  material.customProgramCacheKey = () => `${PROGRAM_KEY}|${part.material}|${lit ? (opts.patchKey ?? "") : ""}`;

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = `vfx-${part.name}`;
  // Positions come from the shader; drawn every frame, so every program compiles on the first.
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = part.material === "glow" ? VFX_ORDER.glow : VFX_ORDER.opaque;
  return {
    mesh,
    part,
    uniforms,
    dispose() {
      geo.dispose();
      base.dispose();
      material.dispose();
    },
  };
}

/** An effect's clock at layer time t, and its emitting time, both on that clock. */
export function effectClock(e: PlacedVfx, preset: FamilyPreset, t: number): { time: number; emitFor: number } {
  const warm = e.warm && preset.loop ? preset.warmup : 0;
  const emit = preset.loop ? (e.duration ?? preset.length) : preset.length;
  return { time: t - e.start + warm, emitFor: emit + warm };
}

interface Built {
  group: THREE.Group;
  effects: { effect: PlacedVfx; preset: FamilyPreset; parts: PartMesh[] }[];
  light: THREE.PointLight | null;
  dispose(): void;
}

function build(effects: readonly PlacedVfx[], opts: { patch?: (m: THREE.Material) => void; patchKey?: string }): Built {
  const group = new THREE.Group();
  group.name = "vfx";
  const built = effects.map((effect) => {
    const preset = familyPreset(effect.family, effect.palette);
    const s = effect.scale ?? 1;
    const r = preset.reach * s;
    const sphere = new THREE.Sphere(new THREE.Vector3(effect.at[0], effect.at[1] + 0.5 * r, effect.at[2]), r);
    const parts = preset.parts.map((p) => buildPart(p, sphere, opts));
    for (const p of parts) group.add(p.mesh);
    return { effect, preset, parts };
  });
  // One flash light for the layer, from its first frame (at 0 between flashes).
  const light = built.some((b) => b.preset.light) ? new THREE.PointLight(0xffffff, 0, 1, 2) : null;
  if (light) {
    light.name = "vfx-flash";
    light.castShadow = false;
    group.add(light);
  }
  return {
    group,
    effects: built,
    light,
    dispose() {
      for (const b of built) for (const p of b.parts) p.dispose();
      light?.dispose();
    },
  };
}

/** The flash of the frame: the brightest effect's light (intensity 0: none). */
export function flashAt(effects: readonly PlacedVfx[], t: number): { at: Vec3; colour: string; intensity: number; range: number } | null {
  let best: { at: Vec3; colour: string; intensity: number; range: number } | null = null;
  for (const e of effects) {
    const preset = familyPreset(e.family, e.palette);
    if (!preset.light) continue;
    const { time, emitFor } = effectClock(e, preset, t);
    const s = e.scale ?? 1;
    const f = preset.light;
    const intensity = flashIntensity(f, time, emitFor) * s * s;
    if (!best || intensity > best.intensity) best = { at: [e.at[0], e.at[1] + f.lift * s, e.at[2]], colour: f.colour, intensity, range: f.range * s };
  }
  return best;
}

export interface VfxLayerProps {
  /** The scene's effects, placed (spec.ts placeEffects); static per scene. */
  effects: readonly PlacedVfx[];
  /** Seconds, in the effects' time base (the place's clock). */
  t: number;
  /** Extra patches for the lit parts (height fog, mood palette), applied once per layer: change `patchKey` to apply another. */
  patch?: (m: THREE.Material) => void;
  patchKey?: string;
}

export function VfxLayer({ effects, t, patch, patchKey }: VfxLayerProps) {
  // Keyed on the list's content, not its identity (a list made each frame would rebuild the layer).
  const key = JSON.stringify(effects);
  const patchRef = useRef(patch);
  patchRef.current = patch;
  // key stands for effects.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const built = useMemo(() => build(effects, { patch: patchRef.current, patchKey }), [key, patchKey]);
  useEffect(() => () => built.dispose(), [built]);

  useFrame(() => {
    for (const { effect, preset, parts } of built.effects) {
      const { time, emitFor } = effectClock(effect, preset, t);
      const s = effect.scale ?? 1;
      for (const p of parts) applyVfxUniforms(p.uniforms, vfxUniformValues(p.part, { time, at: effect.at, scale: s, seed: effect.seed, emitFor }));
    }
    if (built.light) {
      const f = flashAt(built.effects.map((b) => b.effect), t);
      // Every value written every frame (none from the frame before).
      built.light.position.fromArray(f ? f.at : [0, 0, 0]);
      built.light.color.set(f ? f.colour : "#ffffff");
      built.light.intensity = f ? f.intensity : 0;
      built.light.distance = f ? f.range : 1;
    }
  });

  return <primitive object={built.group} />;
}

/** Whether any effect of the list shows anything at t (for checks; the layer always draws its meshes). */
export function vfxActiveAt(effects: readonly PlacedVfx[], t: number): boolean {
  return effects.some((e) => {
    const preset = familyPreset(e.family, e.palette);
    const { time, emitFor } = effectClock(e, preset, t);
    return time >= 0 && time < effectLength(preset, emitFor);
  });
}
