/**
 * src/world/react/particles.ts
 *
 * Confetti, banknotes and lift chips as stateless GPU particles
 * (docs/factory/11-world-reactions.md §5; Latta 2004): each particle's
 * position and turn are a formula of its seeds (instance attributes), the
 * time uniform and the burst uniforms. Nothing is integrated, nothing is
 * written per frame but a handful of uniforms, and any frame can be drawn
 * on its own.
 *
 * Kinds (one instanced mesh each, one draw call):
 *  - confetti: coloured chips that tumble (Andersen, Pesavento & Wang 2005:
 *    a steady end-over-end turn while drifting down);
 *  - notes: generic banknotes that flutter (rock about ±40° while swinging
 *    side to side and sinking slowly; textures.ts);
 *  - chips: small chips that rise off the plaza with the lift level (their
 *    release times are per-scene attributes read off the level track) and
 *    drop as the rigid pieces do when it falls back (gravity on): from
 *    where they are, under gravity, pulled harder when that would take
 *    longer than lift.ts DROP_LAND_MAX.
 *
 * Burst particles leave the epicentre at their burst's time, rise against
 * drag and settle to a slow fall with the breeze (the closed-form linear
 * drag solution), then lie flat on the ground. An ambient share fills
 * boxes just ahead of the lens, wrapped like the rain, its density set by
 * a uniform (the level, a little late). Every particle shrinks away near
 * the lens (`lens`: gone at its first distance).
 *
 * The GLSL text is the same for every kind and instance (patch.ts rule):
 * all differences ride on uniforms. Every uniform defaults to "no
 * reaction": no bursts and no ambient draw nothing. `particleAt` mirrors
 * the vertex shader in TypeScript for the tests; keep the two in step.
 */
import { makeRng } from "../rng";
import type { Vec3 } from "./lift";
import { DROP_LAND_MAX, DROP_SPEED_MAX, G, HOP_FLOOR, heldLand, RELEASE_FRONT_SPEED, RELEASE_JITTER, THRESHOLD_FLOOR, WEIGHT_POWER } from "./lift";
import { crossings, levelOf, MAX_BURSTS, sceneBursts, type Burst, type LevelTrack } from "./track";

export type ParticleKind = "confetti" | "notes" | "chips";

/** Most particles per kind. §5's table gives a scene up to 6,000 confetti
 *  or banknotes plus 2,000 chips; a scene has one counter reaction, so a
 *  lift scene (no confetti, no notes) spends 4,000 on its chips and a
 *  confetti or money scene none, every scene staying inside the table. */
export const PARTICLE_BUDGET: Record<ParticleKind, number> = { confetti: 6000, notes: 3000, chips: 4000 };

/** §5's per-scene particle budget: confetti or banknotes plus chips. */
export const SCENE_PARTICLE_BUDGET = 6000 + 2000;

/** The particle kinds each counter reaction draws. */
export const REACTION_PARTICLES: Record<"lift" | "confetti" | "money", ParticleKind[]> = {
  lift: ["chips"],
  confetti: ["confetti"],
  money: ["notes"],
};

/** The tunable look of a kind: every number here is a uniform. */
export interface ParticleParams {
  count: number;
  /** 0 tumble (confetti), 1 flutter (notes), 2 rise with the lift (chips). */
  mode: 0 | 1 | 2;
  /** Quad width and height, metres. */
  size: [number, number];
  /** ± share of size per particle. */
  sizeJitter: number;
  /** Tints (≤ 8, sRGB hex); one per particle by seed. */
  palette: string[];
  /** Sprite cells in the atlas (rows). */
  cells: number;
  /** Launch height above the ground and launch disc radius, metres. */
  launch: [number, number];
  /** Launch cone half-angle from vertical, radians. */
  cone: number;
  /** Launch spread exponent: launch radius = launch[1]·u^core and the
   *  cone's angle = cone·u^core; 0.5 is even, lower empties the core
   *  (more at the rim and the cone's edge). */
  core: number;
  /** Launch speed range, m/s. */
  speed: [number, number];
  /** Linear drag, 1/s (how fast a launch dies into the slow fall). */
  drag: number;
  /** Terminal fall speed range, m/s. */
  fall: [number, number];
  /** A burst's particles leave over this long, seconds. */
  spread: number;
  /** Breeze, m/s (x, z). */
  wind: [number, number];
  /** Side sway amplitude, metres (tumble: a slow helix; flutter: the swing). */
  sway: number;
  /** Tumble rate or flutter angular frequency range, rad/s. */
  rate: [number, number];
  /** Flutter rock amplitude, radians. */
  flutter: number;
  /** Flutter lift at the swing's ends, metres. */
  bob: number;
  /** 1: landed particles lie on the ground; 0: they vanish. */
  settle: number;
  /** Lying height above the ground, metres (plus up to as much again). */
  restLift: number;
  /** Lens fade: gone at x, full size from y (metres from the lens). */
  lens: [number, number];
  /** Share of particles in the ambient volume (the rest burst). */
  ambientShare: number;
  /** Ambient boxes' half-sizes round the camera, near and far layer, metres. */
  ambientReach: [number, number];
  /** How far ahead of the lens the ambient boxes sit, in box half-sizes
   *  along the view's level heading (0: centred on the lens; most of what
   *  is behind the lens is wasted). */
  ambientAhead: number;
  /** Ambient band height above the ground, metres. */
  ambientTop: number;
  /** Ambient particles thin out to nothing this far from the epicentre, metres. */
  radius: number;
  /** An ambient particle shows once its burst's front has reached it: the
   *  front's speed out from the launch point, m/s (the air fills as the
   *  burst spreads, not in one frame). */
  ambientFront: number;
  /** ...growing in over this much of the front's travel, metres. */
  ambientFade: number;
  /** A falling particle stops rocking (notes) over its last metres above
   *  the ground, so it lands flat without a snap. */
  settleHeight: number;
  /** Total burst gain that uses every burst particle. */
  fullGain: number;
  /** chips: rise speed range, m/s. */
  rise: [number, number];
  /** chips: the rise's smooth start, seconds. */
  tau0: number;
  /** chips: they lift off a disc this wide round the epicentre, metres. */
  chipRadius: number;
  /** chips: grow in over this long after release, seconds. */
  grow: number;
  /** Burst particles grow in over this long as they leave, seconds: no pop
   *  out of thin air, and short enough to keep the burst's punch. */
  burstGrow: number;
}

/** The reference's chip colours (ref-gravity-confetti): bright, saturated. */
export const CONFETTI_PALETTE = ["#d8443a", "#f2c94c", "#3fa36b", "#3b6fd8", "#ef8a3c", "#8e5bc2", "#e86fa5", "#f4f1ea"];

const BASE: Omit<ParticleParams, "count" | "mode" | "size" | "palette"> = {
  sizeJitter: 0.35,
  cells: 3,
  launch: [1.5, 12],
  cone: 0.95,
  core: 0.42,
  speed: [14, 34],
  drag: 1.4,
  fall: [0.9, 1.7],
  spread: 0.6,
  wind: [0.6, 0.25],
  sway: 0.35,
  rate: [5, 11],
  flutter: 0,
  bob: 0,
  settle: 1,
  restLift: 0.02,
  lens: [3, 8],
  ambientShare: 0.55,
  ambientReach: [14, 35],
  ambientAhead: 0.7,
  ambientTop: 22,
  radius: 80,
  ambientFront: 12,
  ambientFade: 8,
  settleHeight: 1.2,
  fullGain: 1,
  rise: [1.5, 4.5],
  tau0: 0.3,
  chipRadius: 42,
  grow: 0.25,
  burstGrow: 0.18,
};

/** The three kinds' looks (constants to tune at the visual check). */
export const PARTICLE_KINDS: Record<ParticleKind, ParticleParams> = {
  confetti: { ...BASE, count: PARTICLE_BUDGET.confetti, mode: 0, size: [0.27, 0.27], palette: CONFETTI_PALETTE },
  notes: {
    ...BASE,
    count: PARTICLE_BUDGET.notes,
    mode: 1,
    // Stylised big money: a real note (0.16 m) is a speck in a plaza WS.
    size: [0.8, 0.37],
    sizeJitter: 0.12,
    palette: ["#ffffff"],
    launch: [1.5, 9],
    cone: 1.0,
    core: 0.35,
    speed: [8, 18],
    drag: 1.0,
    fall: [0.55, 0.95],
    spread: 0.8,
    wind: [0.5, 0.2],
    sway: 1.3,
    rate: [2.2, 3.6],
    flutter: 0.7,
    bob: 0.25,
    lens: [3, 9],
    ambientShare: 0.5,
    ambientTop: 20,
  },
  chips: {
    ...BASE,
    count: PARTICLE_BUDGET.chips,
    mode: 2,
    size: [0.3, 0.3],
    sizeJitter: 0.5,
    palette: CONFETTI_PALETTE,
    fall: [0.8, 1.4],
    sway: 0.25,
    rate: [3, 8],
    ambientShare: 0,
  },
};

/** One particle's seeds: four vec4 attributes, 0..1. */
export interface ParticleSeeds {
  a: [number, number, number, number];
  b: [number, number, number, number];
  c: [number, number, number, number];
  d: [number, number, number, number];
}

/** Seeds for a kind at a place: makeRng(`${placeId}:react:${kind}`). */
export function particleSeeds(placeId: string, kind: ParticleKind, count: number): Float32Array[] {
  const r = makeRng(`${placeId}:react:${kind}`);
  const out = [0, 1, 2, 3].map(() => new Float32Array(count * 4));
  for (let i = 0; i < count; i++) for (const arr of out) for (let k = 0; k < 4; k++) arr[i * 4 + k] = r();
  return out;
}

/** Particle i's seeds from the four attribute arrays. */
export function seedsOf(arrays: readonly Float32Array[], i: number): ParticleSeeds {
  const q = (a: Float32Array): [number, number, number, number] => [a[i * 4], a[i * 4 + 1], a[i * 4 + 2], a[i * 4 + 3]];
  return { a: q(arrays[0]), b: q(arrays[1]), c: q(arrays[2]), d: q(arrays[3]) };
}

/** "Never" for a chip's release or drop time, seconds. */
export const NEVER = 1e6;

/** A chip thrown by a full step hops this high, metres (smaller steps
 *  less, small beats not at all: lift.ts HOP_FLOOR). */
export const CHIP_HOP = 3;
/** Seconds either side of a chip's release over which its step is measured. */
const CHIP_STEP_WINDOW = 0.45;

/** Point in a polygon (even winding). */
function insidePoly(x: number, z: number, poly: readonly (readonly [number, number])[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * Chips' per-scene values (the aRelease attribute, 4 per chip): release
 * time, drop time, weight (how fast it rises: the level after its release
 * to the lift's WEIGHT_POWER, so a small beat's chips only drift) and hop
 * (metres: a big step throws them). Each chip lets go when the level
 * reaches its threshold (seed a.z, so the released share follows the
 * level), delayed by its distance from the epicentre like the rigid
 * pieces. With `clip`, chips whose spot is off the plaza never show (they
 * would rise out of the roofs round it).
 */
export function chipReleases(
  seeds: readonly Float32Array[],
  count: number,
  track: LevelTrack | null,
  chipRadius: number,
  clip?: { epi: readonly [number, number]; polygon: readonly (readonly [number, number])[] },
): Float32Array {
  const out = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) out.set([NEVER, NEVER, 0, 0], i * 4);
  if (!track) return out;
  for (let i = 0; i < count; i++) {
    const s = seedsOf(seeds, i);
    const r0 = chipRadius * Math.sqrt(s.b[0]);
    if (clip) {
      const az = 2 * Math.PI * s.b[1];
      if (!insidePoly(clip.epi[0] + r0 * Math.cos(az), clip.epi[1] + r0 * Math.sin(az), clip.polygon)) continue;
    }
    const theta = THRESHOLD_FLOOR + (1 - THRESHOLD_FLOOR) * s.a[2];
    const { up, down } = crossings(track, theta);
    if (!up.length) continue;
    const delay = r0 / RELEASE_FRONT_SPEED + s.a[1] * RELEASE_JITTER;
    const d = down.find((x) => x > up[0]);
    const after = levelOf(track, up[0] + CHIP_STEP_WINDOW);
    const step = after - levelOf(track, up[0] - CHIP_STEP_WINDOW);
    out[i * 4] = up[0] + delay;
    out[i * 4 + 1] = d === undefined ? NEVER : d + delay;
    out[i * 4 + 2] = after ** WEIGHT_POWER;
    out[i * 4 + 3] = CHIP_HOP * (0.6 + 0.8 * s.a[3]) * Math.min(1, Math.max(0, (step - HOP_FLOOR) / (1 - HOP_FLOOR)));
  }
  return out;
}

/** The uniform values of a layer at one frame (plain numbers). */
export interface ParticleUniformValues extends Omit<ParticleParams, "count" | "palette"> {
  time: number;
  /** The epicentre: x, ground height, z. */
  epi: Vec3;
  burstT: number[];
  burstG: number[];
  /** Ambient density 0..1 (0: none). */
  ambient: number;
  paletteSize: number;
}

/** A layer's uniform values: no bursts and no ambient unless given. */
export function particleUniformValues(
  params: ParticleParams,
  frame: { time: number; epi: Vec3; bursts?: readonly Burst[]; ambient?: number },
): ParticleUniformValues {
  const list = sceneBursts(frame.bursts ?? []);
  const burstT = new Array<number>(MAX_BURSTS).fill(0);
  const burstG = new Array<number>(MAX_BURSTS).fill(0);
  list.forEach((b, k) => {
    burstT[k] = b.t;
    burstG[k] = b.gain;
  });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { count, palette, ...rest } = params;
  return {
    ...rest,
    time: frame.time,
    epi: frame.epi,
    burstT,
    burstG,
    ambient: Math.min(1, Math.max(0, frame.ambient ?? 0)),
    paletteSize: Math.max(1, Math.min(8, palette.length)),
  };
}

/** GLSL uniform name of each value (one table, so the GLSL and the
 *  TypeScript can't drift apart without the test noticing). */
export const UNIFORM_NAMES: Record<keyof ParticleUniformValues, string> = {
  time: "uRpTime",
  mode: "uRpMode",
  epi: "uRpEpi",
  burstT: "uRpBurstT",
  burstG: "uRpBurstG",
  fullGain: "uRpFullGain",
  ambient: "uRpAmbient",
  ambientShare: "uRpAmbientShare",
  ambientReach: "uRpAmbReach",
  ambientAhead: "uRpAmbAhead",
  ambientTop: "uRpAmbTop",
  radius: "uRpRadius",
  ambientFront: "uRpAmbFront",
  ambientFade: "uRpAmbFade",
  settleHeight: "uRpSettleH",
  size: "uRpSize",
  sizeJitter: "uRpSizeJitter",
  launch: "uRpLaunch",
  cone: "uRpCone",
  core: "uRpCore",
  speed: "uRpSpeed",
  drag: "uRpDrag",
  fall: "uRpFall",
  spread: "uRpSpread",
  wind: "uRpWind",
  sway: "uRpSway",
  rate: "uRpRate",
  flutter: "uRpFlutter",
  bob: "uRpBob",
  settle: "uRpSettle",
  restLift: "uRpRestLift",
  lens: "uRpLens",
  rise: "uRpRise",
  tau0: "uRpTau0",
  chipRadius: "uRpChipRadius",
  grow: "uRpGrow",
  burstGrow: "uRpBurstGrow",
  cells: "uRpCells",
  paletteSize: "uRpPaletteSize",
};

/* ------------------------------------------------------------------ */
/*  The shader                                                          */
/* ------------------------------------------------------------------ */

/** Declarations and the particle function, prepended to the vertex shader. */
export const PARTICLE_HEADER = /* glsl */ `
uniform float uRpTime;
uniform float uRpMode;
uniform vec3 uRpEpi;
uniform float uRpBurstT[${MAX_BURSTS}];
uniform float uRpBurstG[${MAX_BURSTS}];
uniform float uRpFullGain;
uniform float uRpAmbient;
uniform float uRpAmbientShare;
uniform vec2 uRpAmbReach;
uniform float uRpAmbAhead;
uniform float uRpAmbTop;
uniform float uRpRadius;
uniform float uRpAmbFront;
uniform float uRpAmbFade;
uniform float uRpSettleH;
uniform vec2 uRpSize;
uniform float uRpSizeJitter;
uniform vec2 uRpLaunch;
uniform float uRpCone;
uniform float uRpCore;
uniform vec2 uRpSpeed;
uniform float uRpDrag;
uniform vec2 uRpFall;
uniform float uRpSpread;
uniform vec2 uRpWind;
uniform float uRpSway;
uniform vec2 uRpRate;
uniform float uRpFlutter;
uniform float uRpBob;
uniform float uRpSettle;
uniform float uRpRestLift;
uniform vec2 uRpLens;
uniform vec2 uRpRise;
uniform float uRpTau0;
uniform float uRpChipRadius;
uniform float uRpGrow;
uniform float uRpBurstGrow;
uniform float uRpCells;
uniform vec3 uRpPalette[8];
uniform float uRpPaletteSize;
attribute vec4 aSeedA;
attribute vec4 aSeedB;
attribute vec4 aSeedC;
attribute vec4 aSeedD;
attribute vec4 aRelease;

const float RP_TAU = 6.28318530718;
const float RP_G = ${G.toFixed(2)};
const float RP_LAND_MAX = ${DROP_LAND_MAX.toFixed(3)};
const float RP_SPEED_MAX = ${DROP_SPEED_MAX.toFixed(1)};
const mat3 RP_FLAT = mat3(1.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 1.0, 0.0);

mat3 rpAxisAngle(vec3 a, float g) {
  float c = cos(g);
  float s = sin(g);
  float k = 1.0 - c;
  return mat3(
    k * a.x * a.x + c,       k * a.x * a.y + s * a.z, k * a.x * a.z - s * a.y,
    k * a.x * a.y - s * a.z, k * a.y * a.y + c,       k * a.y * a.z + s * a.x,
    k * a.x * a.z + s * a.y, k * a.y * a.z - s * a.x, k * a.z * a.z + c);
}
mat3 rpRotY(float g) { float c = cos(g); float s = sin(g); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rpRotZ(float g) { float c = cos(g); float s = sin(g); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
float rpRamp(float tau, float tau0) { return tau <= 0.0 ? 0.0 : tau - tau0 * (1.0 - exp(-tau / tau0)); }

/** The burst an item belongs to, by cumulative gain (track.ts burstPick). */
int rpSlot(float u, out float total) {
  total = 0.0;
  for (int k = 0; k < ${MAX_BURSTS}; k++) total += max(uRpBurstG[k], 0.0);
  float pick = u * total;
  float acc = 0.0;
  int slot = -1;
  for (int k = 0; k < ${MAX_BURSTS}; k++) {
    acc += max(uRpBurstG[k], 0.0);
    if (slot < 0 && pick < acc) slot = k;
  }
  return slot < 0 ? ${MAX_BURSTS - 1} : slot;
}

void rpParticle(out vec3 pos, out mat3 rot, out float scale) {
  vec4 A = aSeedA;
  vec4 B = aSeedB;
  vec4 C = aSeedC;
  vec4 D = aSeedD;
  float t = uRpTime;
  float phase = RP_TAU * A.w;
  float rate = mix(uRpRate.x, uRpRate.y, C.y);
  float fall = mix(uRpFall.x, uRpFall.y, D.z);
  vec3 vt = vec3(uRpWind.x, -fall, uRpWind.y);
  float yg = uRpEpi.y + uRpRestLift * (1.0 + D.x);
  float tt = 0.0;
  float env = 1.0;
  float vis = 0.0;
  // The motion clock at touch-down (-1: it never lands).
  float tland = -1.0;
  // A chip after its drop: seconds into its fall (held at touch-down; -1 before), its rise's length and its fall's.
  float chipS = -1.0;
  float chipD = 0.0;
  float chipL = 0.0;
  bool landed = false;
  pos = uRpEpi;

  if (uRpMode > 1.5) {
    // Chips: lift off the plaza at their release (a hop on a big step,
    // then a drift as fast as the level allows), fall back at their drop.
    float rel = aRelease.x;
    float drop = aRelease.y;
    if (t >= rel) {
      float r0 = uRpChipRadius * sqrt(B.x);
      float az0 = RP_TAU * B.y;
      vec2 dir = vec2(cos(az0), sin(az0));
      vec2 outw = dir * (0.15 + 0.35 * B.z) * aRelease.z;
      float tauR = min(t, drop) - rel;
      float R = rpRamp(tauR, uRpTau0);
      float vr = mix(uRpRise.x, uRpRise.y, B.w) * aRelease.z;
      float hop = aRelease.w * (1.0 - exp(-tauR / uRpTau0));
      pos = uRpEpi + vec3(r0 * dir.x + (0.5 * uRpWind.x * aRelease.z + outw.x) * R + 0.35 * hop * dir.x, uRpRestLift + vr * R + hop, r0 * dir.y + (0.5 * uRpWind.y * aRelease.z + outw.y) * R + 0.35 * hop * dir.y);
      tt = tauR;
      env = 1.0 - exp(-tauR / uRpTau0);
      if (drop < 5.0e5) {
        // Gravity on: it falls from its height and rising speed at the drop
        // (the rise's and the hop's), under gravity, or pulled harder to
        // touch down sooner (lift.ts fallPlan).
        float tauD = drop - rel;
        float eD = exp(-tauD / uRpTau0);
        float yd = uRpRestLift + vr * rpRamp(tauD, uRpTau0) + aRelease.w * (1.0 - eD);
        // The rise's tumble keeps the pace it always had (as if it drifted
        // down at its fall speed), so no frame before gravity-on changes; the
        // fall turns it on to land flat.
        tland = tauD + max(0.0, yd - (yg - uRpEpi.y)) / fall + uRpTau0;
        float v0 = vr * (1.0 - eD) + aRelease.w * eD / uRpTau0;
        float dh = max(0.0, yd - (yg - uRpEpi.y));
        float g = RP_G;
        float sl = (v0 + sqrt(v0 * v0 + 2.0 * g * dh)) / g;
        // Held to RP_LAND_MAX, or longer where that would land faster than RP_SPEED_MAX (lift.ts heldLand).
        float held = sl > RP_LAND_MAX ? max(RP_LAND_MAX, 2.0 * dh / max(1.0e-3, RP_SPEED_MAX - v0)) : 1.0e6;
        if (held < sl) {
          g = 2.0 * (dh + v0 * held) / (held * held);
          sl = held;
        }
        chipD = tauD;
        chipL = sl;
        if (t > drop) {
          float s = min(t - drop, sl);
          pos.y += v0 * s - 0.5 * g * s * s;
          // Its clock stops at touch-down: no tumbling or sliding on the ground.
          tt = tauR + s;
          chipS = s;
          if (t - drop >= sl) landed = true;
        }
      }
      vis = smoothstep(0.0, uRpGrow, t - rel);
    }
  } else if (A.x < uRpAmbientShare) {
    // Ambient: a world-fixed drift wrapped into boxes just ahead of the
    // lens (along its level heading, as the rain's boxes round it). Each
    // belongs to a burst like the burst particles, and grows in as that
    // burst's front reaches it: the air fills as the burst spreads.
    float total;
    int slot = rpSlot(A.y, total);
    float amb = smoothstep(0.95 * A.z, 0.95 * A.z + 0.05, uRpAmbient);
    if (total > 0.0 && amb > 0.0 && A.z < min(1.0, total / uRpFullGain)) {
      float R = A.y < 0.5 ? uRpAmbReach.x : uRpAmbReach.y;
      vec2 head = -vec2(viewMatrix[0][2], viewMatrix[2][2]);
      float hl = length(head);
      vec2 centre = cameraPosition.xz + (hl > 1e-3 ? head / hl : vec2(0.0)) * (uRpAmbAhead * R);
      vec3 p = vec3(B.x * 2.0 * R, B.y * uRpAmbTop, B.z * 2.0 * R) + vt * t;
      vec2 lo = centre - R;
      p.xz = lo + mod(p.xz - lo, 2.0 * R);
      float yb = uRpEpi.y + 0.3;
      p.y = yb + mod(p.y - yb, uRpAmbTop);
      float dc = length(p.xz - centre);
      float de = length(p.xz - uRpEpi.xz);
      float front = (t - uRpBurstT[slot]) * uRpAmbFront - length(p - (uRpEpi + vec3(0.0, uRpLaunch.x, 0.0)));
      // Every edge fades to exactly 0 before the wrap, so a wrap never shows.
      vis = amb * smoothstep(0.0, uRpAmbFade, front) * (1.0 - smoothstep(0.6 * R, 0.95 * R, dc)) * (1.0 - smoothstep(0.7 * uRpRadius, uRpRadius, de))
        * smoothstep(yb + 0.2, yb + 1.7, p.y) * (1.0 - smoothstep(yb + uRpAmbTop - 3.0, yb + uRpAmbTop - 0.2, p.y));
      pos = p;
      tt = t + 37.0 * A.w;
    }
  } else {
    // Burst: out of the epicentre at the burst's time (Latta: a formula of
    // the start values and the time), drag into a slow fall, then lie flat.
    float total;
    int slot = rpSlot(A.y, total);
    if (total > 0.0) {
      float tau = t - (uRpBurstT[slot] + D.w * uRpSpread);
      if (tau >= 0.0 && A.z < min(1.0, total / uRpFullGain)) {
        float r0 = uRpLaunch.y * pow(B.x, uRpCore);
        float az = RP_TAU * B.y;
        vec3 p0 = uRpEpi + vec3(r0 * cos(az), uRpLaunch.x, r0 * sin(az));
        float el = uRpCone * pow(B.z, uRpCore);
        vec3 v0 = mix(uRpSpeed.x, uRpSpeed.y, B.w) * vec3(sin(el) * cos(az), cos(el), sin(el) * sin(az));
        float k = uRpDrag;
        // Landing time: past the apex the drag term has died away; one Newton step.
        float tl = (p0.y - yg + (v0.y + fall) / k) / fall;
        float El = 1.0 - exp(-k * tl);
        float yl = p0.y - fall * tl + (v0.y + fall) * El / k;
        float dyl = -fall + (v0.y + fall) * (1.0 - El);
        tl -= (yl - yg) / dyl;
        landed = uRpSettle > 0.5 && tau >= tl;
        if (uRpSettle > 0.5) tland = tl;
        tt = landed ? tl : tau;
        float E = 1.0 - exp(-k * tt);
        pos = p0 + vt * tt + (v0 - vt) * E / k;
        env = E;
        // Grown in as it leaves the launch (no pop out of thin air).
        vis = (!landed && pos.y < yg - 0.05) ? 0.0 : smoothstep(0.0, uRpBurstGrow, tau);
      }
    }
  }

  // 1 on the ground, 0 from settleHeight up: the rocking dies down to land flat.
  float settleK = 1.0 - smoothstep(0.0, uRpSettleH, pos.y - yg);
  if (uRpMode < 0.5 || uRpMode > 1.5) {
    // Tumble: end over end about a seeded level axis (Andersen et al.),
    // paced so that one that touches down does so lying flat (a whole
    // number of half-turns); a slow helix.
    pos.x += uRpSway * env * sin(0.3 * rate * tt + phase);
    pos.z += uRpSway * env * cos(0.3 * rate * tt + phase);
    float spin = rate;
    if (tland > 0.0) spin = (floor((rate * tland + phase) / 3.14159265359 + 0.5) * 3.14159265359 - phase) / tland;
    vec3 axis = vec3(cos(RP_TAU * C.w), 0.0, sin(RP_TAU * C.w));
    float ang = spin * tt + phase;
    if (chipS >= 0.0) {
      // A falling chip turns from its angle at the drop to the nearest flat one at touch-down.
      float a0 = spin * chipD + phase;
      float a1 = floor((a0 + spin * chipL) / 3.14159265359 + 0.5) * 3.14159265359;
      ang = a0 + (a1 - a0) * (chipL > 0.0 ? chipS / chipL : 1.0);
    }
    rot = rpAxisAngle(axis, ang) * rpRotY(RP_TAU * C.z) * RP_FLAT;
  } else {
    // Flutter: swing along the note's long side, rocking with the swing.
    float yaw = RP_TAU * C.z + 0.25 * (C.w - 0.5) * tt;
    float rock = sin(rate * tt + phase) * env * (1.0 - settleK);
    pos += vec3(cos(yaw), 0.0, -sin(yaw)) * (uRpSway * rock) + vec3(0.0, uRpBob * rock * rock, 0.0);
    rot = rpRotY(yaw) * rpRotZ(uRpFlutter * rock) * RP_FLAT;
  }
  if (landed) pos.y = yg;

  float size = 1.0 + uRpSizeJitter * (2.0 * C.x - 1.0);
  float reach = 0.5 * max(uRpSize.x, uRpSize.y) * size;
  scale = vis * size * smoothstep(uRpLens.x, uRpLens.y, length(pos - cameraPosition) - reach);
}
`;

/** Replaces the start of main (uv_vertex is its first include in Lambert). */
const MAIN_START = /* glsl */ `vec3 rpPos;
mat3 rpRot;
float rpScale;
rpParticle(rpPos, rpRot, rpScale);
#include <uv_vertex>
#ifdef USE_MAP
  vMapUv = vec2(uv.x, (uv.y + floor(aSeedD.y * uRpCells)) / uRpCells);
#endif`;

const COLOR = /* glsl */ `#ifdef USE_COLOR
  vColor = uRpPalette[int(min(floor(aSeedD.x * uRpPaletteSize), uRpPaletteSize - 1.0))];
#endif`;

const NORMAL = /* glsl */ `vec3 objectNormal = rpRot * vec3( normal );`;

const BEGIN = /* glsl */ `vec3 transformed = rpPos + rpRot * vec3( position.x * uRpSize.x * rpScale, position.y * uRpSize.y * rpScale, 0.0 );`;

/** The patched vertex shader: the same text for every kind (uniforms only). */
export function particleVertexShader(base: string): string {
  const out = (PARTICLE_HEADER + base)
    .replace("#include <uv_vertex>", MAIN_START)
    .replace("#include <color_vertex>", COLOR)
    .replace("#include <beginnormal_vertex>", NORMAL)
    .replace("#include <begin_vertex>", BEGIN);
  return out;
}

/* ------------------------------------------------------------------ */
/*  The same formula in TypeScript (tests)                              */
/* ------------------------------------------------------------------ */

type M3 = [number, number, number, number, number, number, number, number, number];

/** Row-major 3×3 (m[r * 3 + c]). */
function mul(a: M3, b: M3): M3 {
  const o = new Array(9).fill(0) as M3;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
}
const rotY = (g: number): M3 => [Math.cos(g), 0, Math.sin(g), 0, 1, 0, -Math.sin(g), 0, Math.cos(g)];
const rotZ = (g: number): M3 => [Math.cos(g), -Math.sin(g), 0, Math.sin(g), Math.cos(g), 0, 0, 0, 1];
const FLAT: M3 = [1, 0, 0, 0, 0, 1, 0, -1, 0];
function axisAngle(a: Vec3, g: number): M3 {
  const c = Math.cos(g);
  const s = Math.sin(g);
  const k = 1 - c;
  const [x, y, z] = a;
  return [k * x * x + c, k * x * y - s * z, k * x * z + s * y, k * x * y + s * z, k * y * y + c, k * y * z - s * x, k * x * z - s * y, k * y * z + s * x, k * z * z + c];
}
const smoothstep = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};
const mix = (a: number, b: number, u: number) => a + (b - a) * u;
const gmod = (x: number, y: number) => x - y * Math.floor(x / y);
const rampF = (tau: number, tau0: number) => (tau <= 0 ? 0 : tau - tau0 * (1 - Math.exp(-tau / tau0)));

export interface ParticleState {
  /** World centre of the quad. */
  pos: Vec3;
  /** Row-major turn of the quad (its normal is the third column). */
  rot: M3;
  /** 0: not drawn. */
  scale: number;
  landed: boolean;
}

/** track.ts burstPick on the uniform arrays (the shader's rpSlot). */
function slotOf(u: ParticleUniformValues, pickU: number): { slot: number; total: number } {
  let total = 0;
  for (let k = 0; k < MAX_BURSTS; k++) total += Math.max(u.burstG[k], 0);
  const pick = pickU * total;
  let acc = 0;
  let slot = -1;
  for (let k = 0; k < MAX_BURSTS; k++) {
    acc += Math.max(u.burstG[k], 0);
    if (slot < 0 && pick < acc) slot = k;
  }
  return { slot: slot < 0 ? MAX_BURSTS - 1 : slot, total };
}

/** One particle at one frame: the vertex shader's rpParticle, in TypeScript. */
export function particleAt(
  u: ParticleUniformValues,
  s: ParticleSeeds,
  release: readonly [number, number, number, number],
  camera: Vec3,
  /** The lens's view direction (world); the ambient boxes sit ahead of it. */
  look: Vec3 = [0, 0, -1],
): ParticleState {
  const [A, B, C, D] = [s.a, s.b, s.c, s.d];
  const t = u.time;
  const phase = 2 * Math.PI * A[3];
  const rate = mix(u.rate[0], u.rate[1], C[1]);
  const fall = mix(u.fall[0], u.fall[1], D[2]);
  const vt: Vec3 = [u.wind[0], -fall, u.wind[1]];
  const yg = u.epi[1] + u.restLift * (1 + D[0]);
  let tt = 0;
  let env = 1;
  let vis = 0;
  let tland = -1;
  let chipS = -1;
  let chipD = 0;
  let chipL = 0;
  let landed = false;
  let pos: Vec3 = [...u.epi];

  if (u.mode > 1.5) {
    const [rel, drop, weight, hopH] = release;
    if (t >= rel) {
      const r0 = u.chipRadius * Math.sqrt(B[0]);
      const az0 = 2 * Math.PI * B[1];
      const dir = [Math.cos(az0), Math.sin(az0)];
      const ow = (0.15 + 0.35 * B[2]) * weight;
      const tauR = Math.min(t, drop) - rel;
      const R = rampF(tauR, u.tau0);
      const vr = mix(u.rise[0], u.rise[1], B[3]) * weight;
      const hop = hopH * (1 - Math.exp(-tauR / u.tau0));
      pos = [
        u.epi[0] + r0 * dir[0] + (0.5 * u.wind[0] * weight + dir[0] * ow) * R + 0.35 * hop * dir[0],
        u.epi[1] + u.restLift + vr * R + hop,
        u.epi[2] + r0 * dir[1] + (0.5 * u.wind[1] * weight + dir[1] * ow) * R + 0.35 * hop * dir[1],
      ];
      tt = tauR;
      env = 1 - Math.exp(-tauR / u.tau0);
      if (drop < 5e5) {
        const tauD = drop - rel;
        const eD = Math.exp(-tauD / u.tau0);
        const yd = u.restLift + vr * rampF(tauD, u.tau0) + hopH * (1 - eD);
        tland = tauD + Math.max(0, yd - (yg - u.epi[1])) / fall + u.tau0;
        const v0 = vr * (1 - eD) + (hopH * eD) / u.tau0;
        const dh = Math.max(0, yd - (yg - u.epi[1]));
        let g = G;
        let sl = (v0 + Math.sqrt(v0 * v0 + 2 * g * dh)) / g;
        const held = sl > DROP_LAND_MAX ? heldLand(dh, v0, DROP_LAND_MAX, DROP_SPEED_MAX) : Infinity;
        if (held < sl) {
          g = (2 * (dh + v0 * held)) / (held * held);
          sl = held;
        }
        chipD = tauD;
        chipL = sl;
        if (t > drop) {
          const sd = Math.min(t - drop, sl);
          pos[1] += v0 * sd - 0.5 * g * sd * sd;
          tt = tauR + sd;
          chipS = sd;
          if (t - drop >= sl) landed = true;
        }
      }
      vis = smoothstep(0, u.grow, t - rel);
    }
  } else if (A[0] < u.ambientShare) {
    const { slot, total } = slotOf(u, A[1]);
    const amb = smoothstep(0.95 * A[2], 0.95 * A[2] + 0.05, u.ambient);
    if (total > 0 && amb > 0 && A[2] < Math.min(1, total / u.fullGain)) {
      const R = A[1] < 0.5 ? u.ambientReach[0] : u.ambientReach[1];
      const hl = Math.hypot(look[0], look[2]);
      const cx = camera[0] + (hl > 1e-3 ? look[0] / hl : 0) * u.ambientAhead * R;
      const cz = camera[2] + (hl > 1e-3 ? look[2] / hl : 0) * u.ambientAhead * R;
      const p: Vec3 = [B[0] * 2 * R + vt[0] * t, B[1] * u.ambientTop + vt[1] * t, B[2] * 2 * R + vt[2] * t];
      const lox = cx - R;
      const loz = cz - R;
      p[0] = lox + gmod(p[0] - lox, 2 * R);
      p[2] = loz + gmod(p[2] - loz, 2 * R);
      const yb = u.epi[1] + 0.3;
      p[1] = yb + gmod(p[1] - yb, u.ambientTop);
      const dc = Math.hypot(p[0] - cx, p[2] - cz);
      const de = Math.hypot(p[0] - u.epi[0], p[2] - u.epi[2]);
      const front = (t - u.burstT[slot]) * u.ambientFront - Math.hypot(p[0] - u.epi[0], p[1] - (u.epi[1] + u.launch[0]), p[2] - u.epi[2]);
      vis =
        amb *
        smoothstep(0, u.ambientFade, front) *
        (1 - smoothstep(0.6 * R, 0.95 * R, dc)) *
        (1 - smoothstep(0.7 * u.radius, u.radius, de)) *
        smoothstep(yb + 0.2, yb + 1.7, p[1]) *
        (1 - smoothstep(yb + u.ambientTop - 3, yb + u.ambientTop - 0.2, p[1]));
      pos = p;
      tt = t + 37 * A[3];
    }
  } else {
    const { slot, total } = slotOf(u, A[1]);
    if (total > 0) {
      const tau = t - (u.burstT[slot] + D[3] * u.spread);
      if (tau >= 0 && A[2] < Math.min(1, total / u.fullGain)) {
        const r0 = u.launch[1] * Math.pow(B[0], u.core);
        const az = 2 * Math.PI * B[1];
        const p0: Vec3 = [u.epi[0] + r0 * Math.cos(az), u.epi[1] + u.launch[0], u.epi[2] + r0 * Math.sin(az)];
        const el = u.cone * Math.pow(B[2], u.core);
        const sp = mix(u.speed[0], u.speed[1], B[3]);
        const v0: Vec3 = [sp * Math.sin(el) * Math.cos(az), sp * Math.cos(el), sp * Math.sin(el) * Math.sin(az)];
        const k = u.drag;
        let tl = (p0[1] - yg + (v0[1] + fall) / k) / fall;
        const El = 1 - Math.exp(-k * tl);
        const yl = p0[1] - fall * tl + ((v0[1] + fall) * El) / k;
        const dyl = -fall + (v0[1] + fall) * (1 - El);
        tl -= (yl - yg) / dyl;
        landed = u.settle > 0.5 && tau >= tl;
        if (u.settle > 0.5) tland = tl;
        tt = landed ? tl : tau;
        const E = 1 - Math.exp(-k * tt);
        pos = [0, 1, 2].map((j) => p0[j] + vt[j] * tt + ((v0[j] - vt[j]) * E) / k) as Vec3;
        env = E;
        vis = !landed && pos[1] < yg - 0.05 ? 0 : smoothstep(0, u.burstGrow, tau);
      }
    }
  }

  const settleK = 1 - smoothstep(0, u.settleHeight, pos[1] - yg);
  let rot: M3;
  if (u.mode < 0.5 || u.mode > 1.5) {
    pos[0] += u.sway * env * Math.sin(0.3 * rate * tt + phase);
    pos[2] += u.sway * env * Math.cos(0.3 * rate * tt + phase);
    const spin = tland > 0 ? (Math.floor((rate * tland + phase) / Math.PI + 0.5) * Math.PI - phase) / tland : rate;
    const axis: Vec3 = [Math.cos(2 * Math.PI * C[3]), 0, Math.sin(2 * Math.PI * C[3])];
    let ang = spin * tt + phase;
    if (chipS >= 0) {
      const a0 = spin * chipD + phase;
      const a1 = Math.floor((a0 + spin * chipL) / Math.PI + 0.5) * Math.PI;
      ang = a0 + (a1 - a0) * (chipL > 0 ? chipS / chipL : 1);
    }
    rot = mul(mul(axisAngle(axis, ang), rotY(2 * Math.PI * C[2])), FLAT);
  } else {
    const yaw = 2 * Math.PI * C[2] + 0.25 * (C[3] - 0.5) * tt;
    const rock = Math.sin(rate * tt + phase) * env * (1 - settleK);
    pos = [pos[0] + Math.cos(yaw) * u.sway * rock, pos[1] + u.bob * rock * rock, pos[2] - Math.sin(yaw) * u.sway * rock];
    rot = mul(mul(rotY(yaw), rotZ(u.flutter * rock)), FLAT);
  }
  if (landed) pos[1] = yg;

  const size = 1 + u.sizeJitter * (2 * C[0] - 1);
  const reach = 0.5 * Math.max(u.size[0], u.size[1]) * size;
  const lens = Math.hypot(pos[0] - camera[0], pos[1] - camera[1], pos[2] - camera[2]) - reach;
  return { pos, rot, scale: vis * size * smoothstep(u.lens[0], u.lens[1], lens), landed };
}
