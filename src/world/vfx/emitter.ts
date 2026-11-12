/**
 * src/world/vfx/emitter.ts
 *
 * The factory's own particle emitter in closed form (docs/factory/
 * 21-vfx-effekseer.md §6.1; Latta 2004, the reaction particles' way,
 * react/particles.ts): a fixed pool of instances whose state at time t is a
 * formula of t, the emitter's seed and the instance's index. Nothing is
 * integrated, nothing is kept between frames, and any frame (t = 80 s of a
 * looping fire included) draws on its own.
 *
 * Spawning:
 *  - a burst: instance i is born once, at `spread × u` (u its own random,
 *    or i / count when `ordered`);
 *  - a loop: births at k / rate for k = i, i + count, i + 2·count, ...
 *    (instance i shows the newest at or before t, born at k / rate), none
 *    from `emitFor` on. A particle lives at most life[1] ≤ count / rate,
 *    so each instance shows one particle at a time and a fire or a smoke
 *    column runs for a whole video with no history and no warm-up.
 *    Each cycle k draws its own randoms (the hash takes the cycle).
 *
 * Randomness is an integer hash (Wellons' lowbias32) of (seed, index,
 * cycle) in GLSL ES 3.00's uint arithmetic: exact on every GPU, and the
 * TypeScript mirror gives the same bits (Math.imul).
 *
 * Motion over the particle's age a, in Effekseer's vocabulary (21 §6.1:
 * position, velocity, acceleration): a spawn shape (ball, disc, ring),
 * a launch cone round +y blended outward from the spawn point, constant
 * acceleration (gravity, buoyancy) under linear drag toward the wind
 * (p = p0 + vt·a + (v0 − vt)(1 − e^(−k·a))/k, vt = wind + accel / k),
 * or ballistic without drag, landing on the ground with one bounce; an
 * orbit round the effect's axis (magic), a wobble that grows with age.
 * The whole part scales about its origin: positions, speeds and
 * accelerations by `scale`, times unchanged.
 *
 * Look over the age (0..1 of the particle's life): size, alpha and glow
 * curves (four keys each, linear between) and a colour ramp (four keys,
 * linear, or stepped for the toon look). Alpha is a billboard's opacity;
 * on a lit or card part it is how much is left (1 whole, 0 dissolved).
 *
 * Renderers (one GLSL text, `uVfxRender` picks): camera-facing billboards,
 * billboards stretched along the analytic velocity, tumbling meshes (a
 * low-poly puff or a chunk; their faces shrink to their centres as they
 * dissolve, face by face), and flat cards on the ground. Sprites come from a
 * sheet (flipbook.ts) at frame floor(age × fps).
 *
 * The GLSL text is the same for every part and family (the patch.ts rule):
 * every difference rides on uniforms. `vfxParticleAt` mirrors the vertex
 * shader in TypeScript for the tests; keep the two in step.
 */
import { makeRng } from "../rng";
import { flipbookFrame, SHEET_GRID, type VfxSheet } from "./flipbook";

export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];

/** A curve over the particle's age 0..1: values `v` at key ages `k` (rising), linear between, held outside. */
export interface Curve {
  v: Vec4;
  k: Vec4;
}

/** A colour ramp over the age: sRGB hex keys at ages `k`; `step` holds each key's colour until the next (toon). */
export interface Ramp {
  c: [string, string, string, string];
  k: Vec4;
  step: boolean;
}

/** Up to four (age, value) keys; fewer are padded with the last. */
export function curve(...keys: [number, number][]): Curve {
  const ks = keys.length ? keys : [[0, 1] as [number, number]];
  const at = (i: number) => ks[Math.min(i, ks.length - 1)];
  return { v: [at(0)[1], at(1)[1], at(2)[1], at(3)[1]], k: [at(0)[0], at(1)[0], at(2)[0], at(3)[0]] };
}

/** A constant curve. */
export const flat = (v: number): Curve => curve([0, v]);

/** Up to four (age, colour) keys; fewer are padded with the last. */
export function ramp(keys: [number, string][], step = false): Ramp {
  const at = (i: number) => keys[Math.min(i, keys.length - 1)];
  return { c: [at(0)[1], at(1)[1], at(2)[1], at(3)[1]], k: [at(0)[0], at(1)[0], at(2)[0], at(3)[0]], step };
}

export type VfxRender = "billboard" | "stretched" | "mesh" | "flat";
/** glow: additive, unlit; card: an opaque alpha-tested sprite, unlit (flames); lit: an opaque mesh under the world's lights. */
export type VfxMaterialKind = "glow" | "card" | "lit";
export type VfxGeometryKind = "quad" | "puff" | "chunk";
export type SpawnShape = "ball" | "disc" | "ring";

/** One emitter: a part of an effect (a fireball, its smoke, its sparks). */
export interface EmitterParams {
  /** A name for the part (the mesh's). */
  name: string;
  /** The pool's size: the most particles alive at once. A loop needs at least ⌈rate × life[1]⌉ + 1. */
  count: number;
  /** A loop emits at `rate` while the effect lasts; a burst emits its count once. */
  loop: boolean;
  /** Loop: births per second. */
  rate: number;
  /** Burst: the births spread over this long, seconds. */
  spread: number;
  /** Burst: births in index order over the spread (a staggered train), else random. */
  ordered: boolean;
  /** The part starts this long after the effect, seconds. */
  delay: number;
  /** A particle's life range, seconds. */
  life: [number, number];
  /** Where particles are born round the part's origin, metres at scale 1. */
  shape: SpawnShape;
  radius: number;
  /** Disc and ring: born up to this high. */
  height: number;
  /** Ball and disc: radius × u^core (1/3 fills a ball evenly; lower empties the core). */
  core: number;
  /** The part's origin from the effect's spot, metres at scale 1. */
  offset: Vec3;
  /** The launch cone's half-angle from +y, radians (π: every way). */
  cone: number;
  /** Launch speed range, m/s at scale 1. */
  speed: [number, number];
  /** 0..1: the launch turned toward the spawn point's direction out from the origin. */
  outward: number;
  /** Constant acceleration, m/s² at scale 1 (gravity down, buoyancy up). */
  accel: Vec3;
  /** Linear drag, 1/s (0: ballistic). */
  drag: number;
  /** The air's drift, m/s at scale 1 (what drag pulls toward). */
  wind: Vec3;
  /** Land on the effect's ground height (ballistic parts bounce once, dragged ones slide). */
  ground: boolean;
  /** Ballistic: the one bounce's restitution (0: none). */
  bounce: number;
  /** Turn rate range round the effect's vertical axis, rad/s (0: none). */
  orbit: [number, number];
  /** Wobble: amplitude at the end of life (m at scale 1) and angular frequency (rad/s). */
  wobble: [number, number];
  /** Spin rate range, rad/s (billboards turn in the view; meshes tumble). */
  spin: [number, number];
  /** Size over the age, metres at scale 1 (a billboard's side, a mesh's width). */
  size: Curve;
  /** ± share of the size per particle. */
  sizeJitter: number;
  /** Stretched: extra length per m/s of speed, seconds. */
  stretch: number;
  colour: Ramp;
  /** ± share of the brightness per particle. */
  tint: number;
  /** Card: the hot core's colour (the sheet's red band). */
  core3: string;
  alpha: Curve;
  /** Glow over the age: a billboard's brightness, a lit part's emissive heat (× its colour). */
  glow: Curve;
  render: VfxRender;
  material: VfxMaterialKind;
  geometry: VfxGeometryKind;
  /** Mesh: lumps (puffs) and squash (chunks), shares of the radius. */
  lump: number;
  squash: number;
  sheet: VfxSheet;
  /** The sheet's first cell. */
  cell: number;
  /** Cells in the flipbook (1: a still cell). */
  frames: number;
  /** Flipbook frames per second of age (0: a random still cell among `frames`). */
  fps: number;
  flipLoop: boolean;
  /** Start on a random frame. */
  flipRandom: boolean;
  /** Near the lens: gone at x metres, whole from y (to its edge). */
  lens: [number, number];
}

/** Every part's defaults: one particle at the origin that never moves. */
export const EMITTER_BASE: EmitterParams = {
  name: "part",
  count: 1,
  loop: false,
  rate: 0,
  spread: 0,
  ordered: false,
  delay: 0,
  life: [1, 1],
  shape: "ball",
  radius: 0,
  height: 0,
  core: 0.5,
  offset: [0, 0, 0],
  cone: 0,
  speed: [0, 0],
  outward: 0,
  accel: [0, 0, 0],
  drag: 0,
  wind: [0, 0, 0],
  ground: false,
  bounce: 0,
  orbit: [0, 0],
  wobble: [0, 0],
  spin: [0, 0],
  size: flat(1),
  sizeJitter: 0,
  stretch: 0,
  colour: ramp([[0, "#ffffff"]]),
  tint: 0,
  core3: "#ffffff",
  alpha: flat(1),
  glow: flat(1),
  render: "billboard",
  material: "glow",
  geometry: "quad",
  lump: 0,
  squash: 0,
  sheet: "glow",
  cell: 0,
  frames: 1,
  fps: 0,
  flipLoop: true,
  flipRandom: false,
  lens: [0.3, 1.2],
};

/** A part from the defaults. */
export const emitter = (p: Partial<EmitterParams>): EmitterParams => ({ ...EMITTER_BASE, ...p });

/** The smallest pool a loop needs (each instance shows one particle at a time). */
export const loopCount = (rate: number, lifeMax: number): number => Math.ceil(rate * lifeMax) + 1;

/** A dissolving mesh's faces start shrinking over this share of the alpha's fall (each at its own random), each over the rest. */
export const DISSOLVE_SPREAD = 0.4;

/** "No ground": the ground height uniform's value. */
export const NO_GROUND = -1e6;

/** A seed string as a 24-bit integer (exact in a float uniform). */
export function saltOf(seed: string): number {
  return Math.floor(makeRng(`vfx:${seed}`)() * 16777216);
}

/** sRGB to linear, as three's ColorManagement does. */
export function srgbToLinear(c: number): number {
  return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}

/** A hex colour as linear RGB (three's Color.set on a hex string). */
export function linearHex(h: string): Vec3 {
  return [1, 3, 5].map((i) => srgbToLinear(parseInt(h.slice(i, i + 2), 16) / 255)) as Vec3;
}

const RENDER_CODE: Record<VfxRender, number> = { billboard: 0, stretched: 1, mesh: 2, flat: 3 };
const SHAPE_CODE: Record<SpawnShape, number> = { ball: 0, disc: 1, ring: 2 };

/** A part's uniforms at one frame (plain numbers; linear colours). */
export interface VfxUniformValues {
  /** Seconds on the part's clock (the effect's, less its delay). */
  time: number;
  salt: number;
  count: number;
  /** loop 0/1, rate, emitFor (seconds on the part's clock), spread. */
  emitter: Vec4;
  ordered: number;
  life: [number, number];
  /** The part's origin, world. */
  origin: Vec3;
  scale: number;
  /** The ground's height, world (NO_GROUND: none). */
  ground: number;
  /** shape, radius, height, core. */
  spawn: Vec4;
  /** cone, speed min, speed max, outward. */
  launch: Vec4;
  accel: Vec3;
  wind: Vec3;
  drag: number;
  bounce: number;
  orbit: [number, number];
  wobble: [number, number];
  spin: [number, number];
  sizeV: Vec4;
  sizeK: Vec4;
  sizeJitter: number;
  stretch: number;
  colour: [Vec3, Vec3, Vec3, Vec3];
  colourK: Vec4;
  colourStep: number;
  tint: number;
  alphaV: Vec4;
  alphaK: Vec4;
  glowV: Vec4;
  glowK: Vec4;
  render: number;
  /** lump, squash. */
  mesh: [number, number];
  /** cols, rows, first cell, frames. */
  sprite: Vec4;
  /** fps, loop 0/1, random start 0/1, unused. */
  flip: Vec4;
  lens: [number, number];
  /** Fragment: 1 card (alpha-tested bands), 0 glow or lit. */
  cut: number;
  /** Fragment: the card's core colour. */
  core3: Vec3;
}

/** A part's uniform values at one frame. */
export function vfxUniformValues(
  p: EmitterParams,
  frame: {
    /** Seconds since the effect's start (its own clock). */
    time: number;
    /** The effect's spot, world (its ground). */
    at: Vec3;
    scale: number;
    seed: string;
    /** A loop's emitting time, seconds on the effect's clock. */
    emitFor: number;
  },
): VfxUniformValues {
  const s = Math.max(1e-3, frame.scale);
  const grid = SHEET_GRID[p.sheet];
  return {
    time: frame.time - p.delay,
    salt: saltOf(`${frame.seed}:${p.name}`),
    count: Math.max(1, Math.floor(p.count)),
    emitter: [p.loop ? 1 : 0, p.rate, Math.max(0, frame.emitFor - p.delay), p.spread],
    ordered: p.ordered ? 1 : 0,
    life: [p.life[0], Math.max(p.life[0], p.life[1])],
    origin: [frame.at[0] + p.offset[0] * s, frame.at[1] + p.offset[1] * s, frame.at[2] + p.offset[2] * s],
    scale: s,
    ground: p.ground ? frame.at[1] : NO_GROUND,
    spawn: [SHAPE_CODE[p.shape], p.radius, p.height, Math.max(0.05, p.core)],
    launch: [p.cone, p.speed[0], p.speed[1], p.outward],
    accel: [...p.accel],
    wind: [...p.wind],
    drag: p.drag,
    bounce: p.bounce,
    orbit: [...p.orbit],
    wobble: [...p.wobble],
    spin: [...p.spin],
    sizeV: [...p.size.v],
    sizeK: [...p.size.k],
    sizeJitter: p.sizeJitter,
    stretch: p.stretch,
    colour: p.colour.c.map(linearHex) as [Vec3, Vec3, Vec3, Vec3],
    colourK: [...p.colour.k],
    colourStep: p.colour.step ? 1 : 0,
    tint: p.tint,
    alphaV: [...p.alpha.v],
    alphaK: [...p.alpha.k],
    glowV: [...p.glow.v],
    glowK: [...p.glow.k],
    render: RENDER_CODE[p.render],
    mesh: [p.lump, p.squash],
    sprite: [grid.cols, grid.rows, p.cell, Math.max(1, p.frames)],
    flip: [p.fps, p.flipLoop ? 1 : 0, p.flipRandom ? 1 : 0, 0],
    lens: [...p.lens],
    cut: p.material === "card" ? 1 : 0,
    core3: linearHex(p.core3),
  };
}

/** GLSL uniform name of each value (one table, so the GLSL and the TypeScript can't drift apart unnoticed). */
export const VFX_UNIFORM_NAMES: Record<keyof VfxUniformValues, string> = {
  time: "uVfxTime",
  salt: "uVfxSalt",
  count: "uVfxCount",
  emitter: "uVfxEmitter",
  ordered: "uVfxOrdered",
  life: "uVfxLife",
  origin: "uVfxOrigin",
  scale: "uVfxScale",
  ground: "uVfxGround",
  spawn: "uVfxSpawn",
  launch: "uVfxLaunch",
  accel: "uVfxAccel",
  wind: "uVfxWind",
  drag: "uVfxDrag",
  bounce: "uVfxBounce",
  orbit: "uVfxOrbit",
  wobble: "uVfxWobble",
  spin: "uVfxSpin",
  sizeV: "uVfxSizeV",
  sizeK: "uVfxSizeK",
  sizeJitter: "uVfxSizeJitter",
  stretch: "uVfxStretch",
  colour: "uVfxColour",
  colourK: "uVfxColourK",
  colourStep: "uVfxColourStep",
  tint: "uVfxTint",
  alphaV: "uVfxAlphaV",
  alphaK: "uVfxAlphaK",
  glowV: "uVfxGlowV",
  glowK: "uVfxGlowK",
  render: "uVfxRender",
  mesh: "uVfxMesh",
  sprite: "uVfxSprite",
  flip: "uVfxFlip",
  lens: "uVfxLens",
  cut: "uVfxCut",
  core3: "uVfxCore",
};

/* ------------------------------------------------------------------ */
/*  The shader                                                          */
/* ------------------------------------------------------------------ */

/** Declarations and the particle function, prepended to the vertex shader. */
export const VFX_VERTEX_HEADER = /* glsl */ `
uniform float uVfxTime;
uniform float uVfxSalt;
uniform float uVfxCount;
uniform vec4 uVfxEmitter;
uniform float uVfxOrdered;
uniform vec2 uVfxLife;
uniform vec3 uVfxOrigin;
uniform float uVfxScale;
uniform float uVfxGround;
uniform vec4 uVfxSpawn;
uniform vec4 uVfxLaunch;
uniform vec3 uVfxAccel;
uniform vec3 uVfxWind;
uniform float uVfxDrag;
uniform float uVfxBounce;
uniform vec2 uVfxOrbit;
uniform vec2 uVfxWobble;
uniform vec2 uVfxSpin;
uniform vec4 uVfxSizeV;
uniform vec4 uVfxSizeK;
uniform float uVfxSizeJitter;
uniform float uVfxStretch;
uniform vec3 uVfxColour[4];
uniform vec4 uVfxColourK;
uniform float uVfxColourStep;
uniform float uVfxTint;
uniform vec4 uVfxAlphaV;
uniform vec4 uVfxAlphaK;
uniform vec4 uVfxGlowV;
uniform vec4 uVfxGlowK;
uniform float uVfxRender;
uniform vec2 uVfxMesh;
uniform vec4 uVfxSprite;
uniform vec4 uVfxFlip;
uniform vec2 uVfxLens;
attribute float aVfxIndex;
attribute vec4 aVfxFace;
varying vec3 vVfxColour;
varying float vVfxAlpha;
varying float vVfxGlow;

const float VFX_TAU = 6.28318530718;
const float VFX_DISSOLVE_SPREAD = ${DISSOLVE_SPREAD.toFixed(2)};

uint vfxHash(uint x) {
  x ^= x >> 16u;
  x *= 0x7feb352du;
  x ^= x >> 15u;
  x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}
float vfxRand(uint h, uint k) {
  return float(vfxHash(h ^ (k * 0x9e3779b9u)) >> 8u) * (1.0 / 16777216.0);
}
float vfxCurve(vec4 v, vec4 k, float u) {
  if (u <= k.x) return v.x;
  if (u <= k.y) return mix(v.x, v.y, (u - k.x) / max(k.y - k.x, 1e-5));
  if (u <= k.z) return mix(v.y, v.z, (u - k.y) / max(k.z - k.y, 1e-5));
  if (u <= k.w) return mix(v.z, v.w, (u - k.z) / max(k.w - k.z, 1e-5));
  return v.w;
}
vec3 vfxRamp(float u) {
  vec4 k = uVfxColourK;
  if (uVfxColourStep > 0.5) {
    if (u < k.y) return uVfxColour[0];
    if (u < k.z) return uVfxColour[1];
    if (u < k.w) return uVfxColour[2];
    return uVfxColour[3];
  }
  if (u <= k.x) return uVfxColour[0];
  if (u <= k.y) return mix(uVfxColour[0], uVfxColour[1], (u - k.x) / max(k.y - k.x, 1e-5));
  if (u <= k.z) return mix(uVfxColour[1], uVfxColour[2], (u - k.y) / max(k.z - k.y, 1e-5));
  if (u <= k.w) return mix(uVfxColour[2], uVfxColour[3], (u - k.z) / max(k.w - k.z, 1e-5));
  return uVfxColour[3];
}
mat3 vfxAxisAngle(vec3 a, float g) {
  float c = cos(g);
  float s = sin(g);
  float k = 1.0 - c;
  return mat3(
    k * a.x * a.x + c,       k * a.x * a.y + s * a.z, k * a.x * a.z - s * a.y,
    k * a.x * a.y - s * a.z, k * a.y * a.y + c,       k * a.y * a.z + s * a.x,
    k * a.x * a.z + s * a.y, k * a.y * a.z - s * a.x, k * a.z * a.z + c);
}

/** The particle this instance shows at uVfxTime: its centre and velocity (world), size (world, 0 when not drawn), age and seed. */
void vfxParticle(out vec3 pos, out vec3 vel, out float size, out float ageN, out float age, out uint seed, out float shown) {
  float idx = aVfxIndex;
  float n = uVfxCount;
  float tau = uVfxTime;
  float cycle = 0.0;
  float birth = 0.0;
  if (uVfxEmitter.x > 0.5) {
    // A loop: births at k / rate, k = idx + cycle * n; the newest at or before tau, none from emitFor on.
    float r = uVfxEmitter.y;
    cycle = min(floor((tau * r - idx) / n), ceil((uVfxEmitter.z * r - idx) / n) - 1.0);
    birth = (idx + cycle * n) / r;
  }
  uint h = vfxHash(uint(uVfxSalt) + vfxHash(uint(idx) + 0x9e3779b9u * uint(max(cycle, 0.0))));
  seed = h;
  if (uVfxEmitter.x <= 0.5) birth = uVfxEmitter.w * (uVfxOrdered > 0.5 ? idx / n : vfxRand(h, 0u));
  age = tau - birth;
  float life = mix(uVfxLife.x, uVfxLife.y, vfxRand(h, 1u));
  ageN = clamp(age / life, 0.0, 1.0);
  float on = (cycle >= 0.0 && age >= 0.0 && age < life) ? 1.0 : 0.0;

  // Born in the spawn shape round the origin.
  float u1 = vfxRand(h, 2u);
  float az = VFX_TAU * vfxRand(h, 3u);
  float u3 = vfxRand(h, 4u);
  float u4 = vfxRand(h, 5u);
  vec3 off;
  if (uVfxSpawn.x < 0.5) {
    float z = 2.0 * u1 - 1.0;
    float rr = sqrt(max(0.0, 1.0 - z * z));
    off = vec3(rr * cos(az), z, rr * sin(az)) * (uVfxSpawn.y * pow(u3, uVfxSpawn.w));
  } else if (uVfxSpawn.x < 1.5) {
    float rr = uVfxSpawn.y * pow(u3, uVfxSpawn.w);
    off = vec3(rr * cos(az), uVfxSpawn.z * u4, rr * sin(az));
  } else {
    off = vec3(uVfxSpawn.y * cos(az), uVfxSpawn.z * u4, uVfxSpawn.y * sin(az));
  }

  // Launched in a cone round +y, turned outward from the origin.
  float ca = 1.0 - (1.0 - cos(uVfxLaunch.x)) * vfxRand(h, 6u);
  float sa = sqrt(max(0.0, 1.0 - ca * ca));
  float az2 = VFX_TAU * vfxRand(h, 7u);
  vec3 dir = vec3(sa * cos(az2), ca, sa * sin(az2));
  float ol = length(off);
  if (uVfxLaunch.w > 0.0 && ol > 1e-4) {
    vec3 m = mix(dir, off / ol, uVfxLaunch.w);
    float ml = length(m);
    if (ml > 1e-4) dir = m / ml;
  }
  vec3 v0 = dir * mix(uVfxLaunch.y, uVfxLaunch.z, vfxRand(h, 8u));

  // Motion (unscaled: the whole part scales about its origin).
  float tt = max(age, 0.0);
  float k = uVfxDrag;
  float hg = (uVfxGround - uVfxOrigin.y) / uVfxScale;
  bool grounded = uVfxGround > -1e5;
  vec3 p;
  vec3 v;
  if (k > 1e-4) {
    vec3 vt = uVfxWind + uVfxAccel / k;
    float e = exp(-k * tt);
    p = off + vt * tt + (v0 - vt) * (1.0 - e) / k;
    v = vt + (v0 - vt) * e;
    if (grounded && p.y < hg) {
      p.y = hg;
      v.y = 0.0;
    }
  } else {
    vec3 w0 = v0 + uVfxWind;
    p = off + w0 * tt + 0.5 * uVfxAccel * tt * tt;
    v = w0 + uVfxAccel * tt;
    if (grounded && uVfxAccel.y < 0.0) {
      // Touch-down, then one bounce (up at bounce × the landing speed, half the sideways speed), then at rest.
      float g = -uVfxAccel.y;
      float d = max(off.y - hg, 0.0);
      float tl = (w0.y + sqrt(w0.y * w0.y + 2.0 * g * d)) / g;
      if (tt >= tl) {
        vec3 pl = off + w0 * tl + 0.5 * uVfxAccel * tl * tl;
        vec3 vl = w0 + uVfxAccel * tl;
        float vb = uVfxBounce * abs(vl.y);
        float tb = 2.0 * vb / g;
        float sb = min(tt - tl, tb);
        vec2 hv = vl.xz * 0.5;
        p = vec3(pl.x + hv.x * sb, hg + vb * sb - 0.5 * g * sb * sb, pl.z + hv.y * sb);
        v = tt - tl < tb ? vec3(hv.x, vb - g * sb, hv.y) : vec3(0.0);
        p.y = max(p.y, hg);
      }
    }
  }
  // An orbit round the vertical axis (0: no turn).
  float om = mix(uVfxOrbit.x, uVfxOrbit.y, vfxRand(h, 9u));
  float th = om * tt;
  float oc = cos(th);
  float os = sin(th);
  p = vec3(oc * p.x - os * p.z, p.y, os * p.x + oc * p.z);
  v = vec3(oc * v.x - os * v.z, v.y, os * v.x + oc * v.z) + om * vec3(-p.z, 0.0, p.x);
  // A wobble growing with age.
  float ph = VFX_TAU * vfxRand(h, 10u);
  float wf = uVfxWobble.y;
  p += uVfxWobble.x * ageN * vec3(sin(wf * tt + ph), 0.5 * sin(1.7 * wf * tt + 2.0 * ph), cos(1.3 * wf * tt + ph));

  pos = uVfxOrigin + p * uVfxScale;
  vel = v * uVfxScale;
  float sz = vfxCurve(uVfxSizeV, uVfxSizeK, ageN) * (1.0 + uVfxSizeJitter * (2.0 * vfxRand(h, 11u) - 1.0)) * uVfxScale;
  shown = on * smoothstep(uVfxLens.x, uVfxLens.y, length(pos - cameraPosition) - 0.5 * sz);
  size = sz * shown;
}
`;

/** Replaces the start of main (uv_vertex is its first include in Basic and Lambert). */
const MAIN_START = /* glsl */ `vec3 vfxPos;
vec3 vfxVel;
float vfxSize;
float vfxAgeN;
float vfxAge;
uint vfxSeed;
float vfxShown;
vfxParticle(vfxPos, vfxVel, vfxSize, vfxAgeN, vfxAge, vfxSeed, vfxShown);
float vfxSpinA = VFX_TAU * vfxRand(vfxSeed, 12u) + mix(uVfxSpin.x, uVfxSpin.y, vfxRand(vfxSeed, 13u)) * max(vfxAge, 0.0);
vec3 vfxRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
vec3 vfxUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
vec2 vfxQ = mat2(cos(vfxSpinA), sin(vfxSpinA), -sin(vfxSpinA), cos(vfxSpinA)) * position.xy;
vec3 vfxVertex = vfxPos;
vec3 vfxNormal = vec3(0.0, 1.0, 0.0);
vVfxAlpha = vfxCurve(uVfxAlphaV, uVfxAlphaK, vfxAgeN);
vVfxGlow = vfxCurve(uVfxGlowV, uVfxGlowK, vfxAgeN);
vVfxColour = vfxRamp(vfxAgeN) * (1.0 + uVfxTint * (2.0 * vfxRand(vfxSeed, 20u) - 1.0));
if (uVfxRender < 0.5) {
  // A billboard facing the lens, turning in the view.
  vfxVertex = vfxPos + (vfxRight * vfxQ.x + vfxUp * vfxQ.y) * vfxSize;
  vfxNormal = cross(vfxRight, vfxUp);
} else if (uVfxRender < 1.5) {
  // A billboard along the velocity, longer the faster it goes.
  float vfxSpd = length(vfxVel);
  vec3 vfxAx = vfxSpd > 1e-3 ? vfxVel / vfxSpd : vfxUp;
  vec3 vfxSide = cross(vfxAx, normalize(cameraPosition - vfxPos));
  float vfxSl = length(vfxSide);
  vfxSide = vfxSl > 1e-4 ? vfxSide / vfxSl : vfxRight;
  float vfxLen = (vfxSize + vfxSpd * uVfxStretch * vfxShown);
  vfxVertex = vfxPos + vfxSide * position.x * vfxSize + vfxAx * position.y * vfxLen;
  vfxNormal = cross(vfxSide, vfxAx);
} else if (uVfxRender < 2.5) {
  // A tumbling mesh (its size is its width): lumpy (puffs) or squashed (chunks); dissolving, each face shrinks to its centre.
  float vfxKeep = clamp((vVfxAlpha - VFX_DISSOLVE_SPREAD * aVfxFace.w) / (1.0 - VFX_DISSOLVE_SPREAD), 0.0, 1.0);
  float vfxLumpPh = VFX_TAU * vfxRand(vfxSeed, 14u);
  vec3 vfxLk = vec3(3.1, 2.3, 1.7);
  vec3 vfxV = position * (1.0 + uVfxMesh.x * sin(dot(position, vfxLk) + vfxLumpPh));
  vec3 vfxC = aVfxFace.xyz * (1.0 + uVfxMesh.x * sin(dot(aVfxFace.xyz, vfxLk) + vfxLumpPh));
  vfxV = vfxC + (vfxV - vfxC) * vfxKeep;
  vfxV *= vec3(1.0, 1.0 - uVfxMesh.y * vfxRand(vfxSeed, 15u), 1.0 - 0.6 * uVfxMesh.y * vfxRand(vfxSeed, 16u));
  float vfxAz = VFX_TAU * vfxRand(vfxSeed, 18u);
  float vfxAy = 2.0 * vfxRand(vfxSeed, 17u) - 1.0;
  float vfxAr = sqrt(max(0.0, 1.0 - vfxAy * vfxAy));
  mat3 vfxR = vfxAxisAngle(vec3(vfxAr * cos(vfxAz), vfxAy, vfxAr * sin(vfxAz)), vfxSpinA);
  vfxVertex = vfxPos + vfxR * vfxV * (0.5 * vfxSize);
  vfxNormal = vfxR * normal;
} else {
  // A flat card on the ground, turning about +y.
  vfxVertex = vfxPos + vec3(vfxQ.x, 0.0, -vfxQ.y) * vfxSize;
}
#include <uv_vertex>
#ifdef USE_MAP
  float vfxFrames = uVfxSprite.w;
  float vfxF = 0.0;
  if (vfxFrames > 1.5) {
    float vfxR0 = vfxRand(vfxSeed, 19u);
    if (uVfxFlip.x > 0.0) {
      vfxF = floor(max(vfxAge, 0.0) * uVfxFlip.x + (uVfxFlip.z > 0.5 ? vfxR0 * vfxFrames : 0.0));
      vfxF = uVfxFlip.y > 0.5 ? vfxF - vfxFrames * floor(vfxF / vfxFrames) : min(vfxF, vfxFrames - 1.0);
    } else vfxF = floor(vfxR0 * vfxFrames);
  }
  float vfxCell = uVfxSprite.z + vfxF;
  vMapUv = (uv + vec2(vfxCell - uVfxSprite.x * floor(vfxCell / uVfxSprite.x), floor(vfxCell / uVfxSprite.x))) / uVfxSprite.xy;
#endif`;

const NORMAL = /* glsl */ `vec3 objectNormal = vfxNormal;`;
const BEGIN = /* glsl */ `vec3 transformed = vfxVertex;`;

/** The patched vertex shader (Basic or Lambert): the same text for every part. */
export function vfxVertexShader(base: string): string {
  return (VFX_VERTEX_HEADER + base)
    .replace("#include <uv_vertex>", MAIN_START)
    .replace("#include <beginnormal_vertex>", NORMAL)
    .replace("#include <begin_vertex>", BEGIN);
}

const FRAGMENT_HEADER = /* glsl */ `uniform float uVfxCut;
uniform vec3 uVfxCore;
varying vec3 vVfxColour;
varying float vVfxAlpha;
varying float vVfxGlow;
`;

/** Basic (glow and card): the sprite, tinted, and either soft (glow) or cut by its outline and dissolve noise (card). */
const BASIC_MAP = /* glsl */ `#ifdef USE_MAP
  vec4 vfxTex = texture2D( map, vMapUv );
#else
  vec4 vfxTex = vec4( 1.0 );
#endif
if ( uVfxCut > 0.5 ) {
  // A card: toon bands from the sheet's heat (red), the hot core in its own colour; the outline hard, eaten by the noise (green) as it dissolves.
  diffuseColor.rgb *= mix( vVfxColour * ( 0.7 + 0.3 * vfxTex.r ), uVfxCore, vfxTex.r * vfxTex.r ) * vVfxGlow;
  diffuseColor.a = step( 0.5, vfxTex.a ) * step( 1.0 - vVfxAlpha, vfxTex.g * 0.98 + 0.01 );
} else {
  diffuseColor.rgb *= vfxTex.rgb * vVfxColour * vVfxGlow;
  diffuseColor.a *= vfxTex.a * vVfxAlpha;
}`;

/** The patched fragment shader of a Basic part (glow, card). */
export function vfxBasicFragment(base: string): string {
  return FRAGMENT_HEADER + base.replace("#include <map_fragment>", BASIC_MAP);
}

/** The patched fragment shader of a lit (Lambert) part: its colour lit, plus its heat as emission. */
export function vfxLitFragment(base: string): string {
  return (
    FRAGMENT_HEADER +
    base
      .replace("#include <color_fragment>", "#include <color_fragment>\n\tdiffuseColor.rgb *= vVfxColour;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += vVfxColour * vVfxGlow;")
  );
}

/* ------------------------------------------------------------------ */
/*  The same formula in TypeScript (tests)                              */
/* ------------------------------------------------------------------ */

/** Wellons' lowbias32, as the shader's vfxHash (uint arithmetic). */
export function vfxHash(x: number): number {
  x >>>= 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

/** The shader's vfxRand: 24 bits of the hash, 0..1 (exact in float32). */
export function vfxRand(h: number, k: number): number {
  return (vfxHash((h ^ Math.imul(k, 0x9e3779b9)) >>> 0) >>> 8) / 16777216;
}

/** The particle's seed (the shader's h). */
export function particleSeed(salt: number, index: number, cycle: number): number {
  return vfxHash((salt + vfxHash((index + Math.imul(0x9e3779b9, Math.max(0, cycle))) >>> 0)) >>> 0);
}

const mix = (a: number, b: number, u: number) => a + (b - a) * u;
const smoothstep = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/** The shader's vfxCurve. */
export function curveAt(v: Vec4, k: Vec4, u: number): number {
  if (u <= k[0]) return v[0];
  if (u <= k[1]) return mix(v[0], v[1], (u - k[0]) / Math.max(k[1] - k[0], 1e-5));
  if (u <= k[2]) return mix(v[1], v[2], (u - k[1]) / Math.max(k[2] - k[1], 1e-5));
  if (u <= k[3]) return mix(v[2], v[3], (u - k[2]) / Math.max(k[3] - k[2], 1e-5));
  return v[3];
}

/** The shader's vfxRamp (linear colours). */
export function rampAt(c: readonly Vec3[], k: Vec4, step: boolean, u: number): Vec3 {
  const lerp = (a: Vec3, b: Vec3, x: number): Vec3 => [mix(a[0], b[0], x), mix(a[1], b[1], x), mix(a[2], b[2], x)];
  if (step) return [...(u < k[1] ? c[0] : u < k[2] ? c[1] : u < k[3] ? c[2] : c[3])] as Vec3;
  if (u <= k[0]) return [...c[0]] as Vec3;
  if (u <= k[1]) return lerp(c[0], c[1], (u - k[0]) / Math.max(k[1] - k[0], 1e-5));
  if (u <= k[2]) return lerp(c[1], c[2], (u - k[1]) / Math.max(k[2] - k[1], 1e-5));
  if (u <= k[3]) return lerp(c[2], c[3], (u - k[2]) / Math.max(k[3] - k[2], 1e-5));
  return [...c[3]] as Vec3;
}

/** One particle at one frame (the vertex shader's numbers). */
export interface VfxParticleState {
  /** Drawn at all (alive, and not shrunk away at the lens). */
  on: boolean;
  /** Alive (born, not yet dead), whatever the lens. */
  alive: boolean;
  /** The loop's cycle (0 for a burst; negative: not born yet). */
  cycle: number;
  seed: number;
  /** Seconds since its birth, and its share of its life. */
  age: number;
  ageN: number;
  life: number;
  /** Its centre and velocity, world. */
  pos: Vec3;
  vel: Vec3;
  /** Its size, world metres (0: not drawn). */
  size: number;
  colour: Vec3;
  alpha: number;
  glow: number;
  /** The flipbook cell it shows. */
  cell: number;
}

/** Instance `index` at one frame: the vertex shader's vfxParticle, in TypeScript. */
export function vfxParticleAt(u: VfxUniformValues, index: number, camera: Vec3): VfxParticleState {
  const n = u.count;
  const tau = u.time;
  const [loop, rate, emitFor, spread] = u.emitter;
  let cycle = 0;
  let birth = 0;
  if (loop > 0.5) {
    cycle = Math.min(Math.floor((tau * rate - index) / n), Math.ceil((emitFor * rate - index) / n) - 1);
    birth = (index + cycle * n) / rate;
  }
  const h = particleSeed(u.salt, index, cycle);
  if (loop <= 0.5) birth = spread * (u.ordered > 0.5 ? index / n : vfxRand(h, 0));
  const age = tau - birth;
  const life = mix(u.life[0], u.life[1], vfxRand(h, 1));
  const ageN = Math.min(1, Math.max(0, age / life));
  const alive = cycle >= 0 && age >= 0 && age < life;

  const u1 = vfxRand(h, 2);
  const az = 2 * Math.PI * vfxRand(h, 3);
  const u3 = vfxRand(h, 4);
  const u4 = vfxRand(h, 5);
  const [shape, radius, height, core] = u.spawn;
  let off: Vec3;
  if (shape < 0.5) {
    const z = 2 * u1 - 1;
    const rr = Math.sqrt(Math.max(0, 1 - z * z));
    const R = radius * Math.pow(u3, core);
    off = [rr * Math.cos(az) * R, z * R, rr * Math.sin(az) * R];
  } else if (shape < 1.5) {
    const rr = radius * Math.pow(u3, core);
    off = [rr * Math.cos(az), height * u4, rr * Math.sin(az)];
  } else off = [radius * Math.cos(az), height * u4, radius * Math.sin(az)];

  const [cone, s0, s1, outward] = u.launch;
  const ca = 1 - (1 - Math.cos(cone)) * vfxRand(h, 6);
  const sa = Math.sqrt(Math.max(0, 1 - ca * ca));
  const az2 = 2 * Math.PI * vfxRand(h, 7);
  let dir: Vec3 = [sa * Math.cos(az2), ca, sa * Math.sin(az2)];
  const ol = Math.hypot(...off);
  if (outward > 0 && ol > 1e-4) {
    const m: Vec3 = [mix(dir[0], off[0] / ol, outward), mix(dir[1], off[1] / ol, outward), mix(dir[2], off[2] / ol, outward)];
    const ml = Math.hypot(...m);
    if (ml > 1e-4) dir = [m[0] / ml, m[1] / ml, m[2] / ml];
  }
  const sp = mix(s0, s1, vfxRand(h, 8));
  const v0: Vec3 = [dir[0] * sp, dir[1] * sp, dir[2] * sp];

  const tt = Math.max(age, 0);
  const k = u.drag;
  const hg = (u.ground - u.origin[1]) / u.scale;
  const grounded = u.ground > -1e5;
  let p: Vec3;
  let v: Vec3;
  if (k > 1e-4) {
    const vt = [0, 1, 2].map((j) => u.wind[j] + u.accel[j] / k);
    const e = Math.exp(-k * tt);
    p = [0, 1, 2].map((j) => off[j] + vt[j] * tt + ((v0[j] - vt[j]) * (1 - e)) / k) as Vec3;
    v = [0, 1, 2].map((j) => vt[j] + (v0[j] - vt[j]) * e) as Vec3;
    if (grounded && p[1] < hg) {
      p[1] = hg;
      v[1] = 0;
    }
  } else {
    const w0 = [0, 1, 2].map((j) => v0[j] + u.wind[j]);
    p = [0, 1, 2].map((j) => off[j] + w0[j] * tt + 0.5 * u.accel[j] * tt * tt) as Vec3;
    v = [0, 1, 2].map((j) => w0[j] + u.accel[j] * tt) as Vec3;
    if (grounded && u.accel[1] < 0) {
      const g = -u.accel[1];
      const d = Math.max(off[1] - hg, 0);
      const tl = (w0[1] + Math.sqrt(w0[1] * w0[1] + 2 * g * d)) / g;
      if (tt >= tl) {
        const pl = [0, 1, 2].map((j) => off[j] + w0[j] * tl + 0.5 * u.accel[j] * tl * tl);
        const vl = [0, 1, 2].map((j) => w0[j] + u.accel[j] * tl);
        const vb = u.bounce * Math.abs(vl[1]);
        const tb = (2 * vb) / g;
        const sb = Math.min(tt - tl, tb);
        const hv = [vl[0] * 0.5, vl[2] * 0.5];
        p = [pl[0] + hv[0] * sb, hg + vb * sb - 0.5 * g * sb * sb, pl[2] + hv[1] * sb];
        v = tt - tl < tb ? [hv[0], vb - g * sb, hv[1]] : [0, 0, 0];
        p[1] = Math.max(p[1], hg);
      }
    }
  }
  const om = mix(u.orbit[0], u.orbit[1], vfxRand(h, 9));
  const oc = Math.cos(om * tt);
  const os = Math.sin(om * tt);
  p = [oc * p[0] - os * p[2], p[1], os * p[0] + oc * p[2]];
  v = [oc * v[0] - os * v[2] - om * p[2], v[1], os * v[0] + oc * v[2] + om * p[0]];
  const ph = 2 * Math.PI * vfxRand(h, 10);
  const [wa, wf] = u.wobble;
  p = [p[0] + wa * ageN * Math.sin(wf * tt + ph), p[1] + wa * ageN * 0.5 * Math.sin(1.7 * wf * tt + 2 * ph), p[2] + wa * ageN * Math.cos(1.3 * wf * tt + ph)];

  const pos: Vec3 = [u.origin[0] + p[0] * u.scale, u.origin[1] + p[1] * u.scale, u.origin[2] + p[2] * u.scale];
  const vel: Vec3 = [v[0] * u.scale, v[1] * u.scale, v[2] * u.scale];
  const sz = curveAt(u.sizeV, u.sizeK, ageN) * (1 + u.sizeJitter * (2 * vfxRand(h, 11) - 1)) * u.scale;
  const shown = (alive ? 1 : 0) * smoothstep(u.lens[0], u.lens[1], Math.hypot(pos[0] - camera[0], pos[1] - camera[1], pos[2] - camera[2]) - 0.5 * sz);
  const tint = 1 + u.tint * (2 * vfxRand(h, 20) - 1);
  const colour = rampAt(u.colour, u.colourK, u.colourStep > 0.5, ageN).map((c) => c * tint) as Vec3;
  const [fps, flipLoop, flipRandom] = u.flip;
  const cell = u.sprite[2] + flipbookFrame(Math.max(age, 0), fps, u.sprite[3], flipLoop > 0.5, vfxRand(h, 19), flipRandom > 0.5);
  return {
    on: shown > 0 && sz * shown > 0,
    alive,
    cycle,
    seed: h,
    age,
    ageN,
    life,
    pos,
    vel,
    size: sz * shown,
    colour,
    alpha: curveAt(u.alphaV, u.alphaK, ageN),
    glow: curveAt(u.glowV, u.glowK, ageN),
    cell,
  };
}
