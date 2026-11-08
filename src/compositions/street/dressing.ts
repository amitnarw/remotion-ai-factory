/**
 * src/compositions/street/dressing.ts — the New York dressing of the street
 * block (quality-refs README, gate item 3; ref-toilets-*.jpeg): rooftop water
 * towers, crosswalks with mast-arm traffic lights, hydrants and trash bags at
 * the curbs. CC0 models from the world catalog (src/world/data/world-catalog.json:
 * KayKit City Builder Bits, the Quaternius Downtown City decals) and the asset
 * index (the Poly Pizza trash bags).
 *
 * Pure layout: StreetStage draws it, and its camera blockers (streetBlockers)
 * are measured from the same numbers. Everything stands out of the traffic
 * lanes and the walkers' paths:
 *   - the road between the curbs (|x| < 4.46) holds only the flat crosswalks;
 *   - the sidewalk strollers walk |x| 5.21..6.79 (their legs from 5.06, their
 *     shoulders from 4.96), so the curb props stand on the kerb strip from
 *     |x| 4.6: the low hydrants and bags up to 5.04, under the legs' reach,
 *     the tall signal poles up to 4.94, under the shoulders';
 *   - the trash piles stand against the building fronts (|x| 8.2..8.7), past
 *     the strollers' far shoulder (7.04);
 *   - nothing on the curb strip of the hero props' sidewalk where their row
 *     can reach (StreetStage HERO_ZONE).
 */
import { random } from "remotion";

/** Model files (world-catalog ids in the comments). */
export const DRESSING_MODELS = {
  /** kaykit-city-builder-bits-watertower: a wooden tank on legs, 0.67 tall, 0.498 wide */
  waterTower: "assets/world/kaykit/city-builder-bits/watertower.gltf",
  /** kaykit-city-builder-bits-firehydrant: 0.225 tall, 0.136 round */
  hydrant: "assets/world/kaykit/city-builder-bits/firehydrant.gltf",
  /** kaykit-city-builder-bits-trafficlight-c: a pole at the origin, its mast arm and heads out along -x */
  signal: "assets/world/kaykit/city-builder-bits/trafficlight_C.gltf",
  /** quaternius-downtown-city-megakit-decal-crosswalk: a 4.54 x 5.43 quad, 5 stripes long along its x */
  crosswalk: "assets/world/quaternius/downtown-city-megakit/Decal_Crosswalk.gltf",
} as const;

/** The crosswalk decal: its quad's half sizes (model x, z) and its plane's height. */
export const CROSSWALK_DECAL = { halfX: 2.269, halfZ: 2.713, planeY: -0.148 };

/** A placed near-row building (StreetStage Placement). */
interface RowSlot {
  x: number;
  z: number;
  rotY: number;
  height: number;
}

/**
 * A flat stretch of each row model's main roof: [x, z, roof height, the
 * largest flat disc's radius there] in units of the model's height, before
 * the row's turn (+z is the street face). Measured from the GLBs (a height
 * map of each roof, a disc kept within 0.6% of the height and inside the
 * outline). Left out, with no such stretch: building-m, and the low-detail
 * blocks with grooved, stepped or peaked tops (b, c, d, f, g, i, j, l, m).
 */
const ROOF_SPOTS: Record<string, [number, number, number, number]> = {
  "building-a": [-0.056, 0.076, 0.928, 0.2],
  "building-b": [0.183, 0.178, 0.928, 0.135],
  "building-c": [0.219, 0.156, 0.896, 0.2],
  "building-d": [0.113, 0.138, 0.928, 0.075],
  "building-e": [0.619, 0.066, 0.896, 0.2],
  "building-f": [-0.04, 0.035, 0.945, 0.17],
  "building-g": [0.02, 0.032, 0.945, 0.17],
  "building-h": [-0.056, 0.082, 0.928, 0.2],
  "building-i": [-0.009, 0.009, 0.952, 0.17],
  "building-j": [0.014, 0.101, 0.945, 0.2],
  "building-k": [0.016, 0.037, 0.816, 0.2],
  "building-l": [-0.035, 0.065, 0.881, 0.17],
  "building-n": [0.25, 0.179, 0.806, 0.17],
  "low-detail-building-a": [-0.003, 0.003, 1, 0.075],
  "low-detail-building-e": [-0.029, 0.036, 0.844, 0.075],
  "low-detail-building-h": [-0.003, 0.036, 0.976, 0.06],
  "low-detail-building-k": [0.041, 0.056, 0.935, 0.075],
  "low-detail-building-n": [-0.008, 0.008, 0.929, 0.135],
  "building-skyscraper-a": [-0.049, 0.071, 0.972, 0.12],
  "building-skyscraper-b": [0.004, 0.004, 0.982, 0.06],
  "building-skyscraper-c": [0.055, -0.004, 0.882, 0.06],
  "building-skyscraper-d": [0.003, -0.015, 0.951, 0.075],
  "building-skyscraper-e": [-0.033, -0.046, 0.98, 0.09],
};

/** The tank model's half width per metre of its height (0.249 / 0.67). */
export const TOWER_RADIUS = 0.372;
/** Tank heights: a New York tank stands 3-5 m on its legs; a roof too small
 *  for a 2.6 m one gets none. */
const TOWER_H: [number, number] = [2.6, 4.4];

export interface WaterTower {
  x: number;
  z: number;
  /** The roof it stands on. */
  y: number;
  h: number;
  rotY: number;
}

/**
 * Water tanks on about three in four of the near row's roofs that have room
 * for one, as in the reference aerial. `near` is a layout's near row
 * (file -> slots). A tank is as big as its roof's flat disc allows (95% of
 * it), up to 4.4 m tall.
 */
export function waterTowers(specId: string, near: Record<string, RowSlot[]>): WaterTower[] {
  const out: WaterTower[] = [];
  for (const [file, list] of Object.entries(near)) {
    const spot = ROOF_SPOTS[file.split("/").pop()?.replace(/\.glb$/i, "") ?? ""];
    if (!spot) continue;
    for (const p of list) {
      const h = Math.min(TOWER_H[1], (0.95 * spot[3] * p.height) / TOWER_RADIUS);
      if (h < TOWER_H[0]) continue;
      const key = `street-${specId}-wt-${p.x.toFixed(2)}-${p.z.toFixed(2)}`;
      if (random(key) > 0.75) continue;
      // the spot turned with the row (three.js Y rotation)
      const mx = spot[0] * p.height;
      const mz = spot[1] * p.height;
      const c = Math.cos(p.rotY);
      const s = Math.sin(p.rotY);
      out.push({
        x: p.x + mx * c + mz * s,
        z: p.z - mx * s + mz * c,
        y: spot[2] * p.height,
        h,
        rotY: random(`${key}-r`) * Math.PI * 2,
      });
    }
  }
  return out;
}

/** |x| of the signal poles (0.155 m round at the base) and of the hydrants
 *  and curb bags (up to 0.22 m round): on the sidewalk's kerb strip, which
 *  starts at 4.6. */
export const CURB_X = 4.78;
export const HYDRANT_X = 4.82;

/**
 * The crosswalks (z of their centre lines), from the camera end: the one at
 * the near corner and two down the block, so the aerial reads crossing after
 * crossing like the reference avenue. Each is 2.8 m deep (CROSSING_DEPTH).
 */
export const CROSSINGS = [4.4, -41.5, -77];
export const CROSSING_DEPTH = 2.8;

export interface Signal {
  x: number;
  z: number;
  /** 0 on the right curb (the arm reaches over the right lane, -x), PI on the left. */
  rotY: number;
}

/** A mast-arm signal's sizes (trafficlight_C at SIGNAL_H): the arm, the heads under it, the walk signal on the pole. */
export const SIGNAL_H = 5.0;
export const SIGNAL_ARM = { reach: 3.95, bottom: 3.0, halfZ: 0.75 };
export const SIGNAL_BOX = { bottom: 1.9, top: 3.0, out: 0.16, in: 0.27, halfZ: 0.75 };

export interface Bag {
  /** "pile": two bags, "one": a single bag (BAG_H). */
  kind: "pile" | "one";
  x: number;
  z: number;
  rotY: number;
}

export interface CurbDressing {
  hydrants: Array<{ x: number; z: number; rotY: number }>;
  signals: Signal[];
  bags: Bag[];
}

/** A hydrant's height and footprint radius (the model is 0.6 as wide as tall). */
export const HYDRANT_H = 0.72;
export const HYDRANT_R = 0.22;
/** Bag heights: a pile is 0.85 x 0.49 m, a single bag 0.4 m round. */
export const BAG_H = { pile: 0.5, one: 0.45 };

/**
 * The curb dressing. `keepClear` is the sidewalk side (-1, 1) and stretch of
 * z the story's hero props can reach; the curb strip there stays empty.
 * Places were picked against the street's furniture (StreetStage): the lamp
 * posts (|x| 9), the street trees (x -7.9), the bush balls (8.85), the café
 * (right, z -7.4..-27.6), the parked cars at the curbs (x ±3.55, up to 1.12 m
 * wide: right z -21, -44; left z -12, -33) and the dumpster corner (left,
 * z -23.6..-26.3).
 */
export function curbDressing(keepClear?: { side: -1 | 1; z0: number; z1: number }): CurbDressing {
  const clear = (x: number, z: number) => !keepClear || Math.sign(x) !== keepClear.side || z < keepClear.z0 || z > keepClear.z1;

  const hydrants = [
    ...[-0.5, -15, -33, -53, -69].map((z) => ({ x: HYDRANT_X, z, rotY: Math.PI / 2 })),
    ...[-1.5, -24, -47, -63, -82].map((z) => ({ x: -HYDRANT_X, z, rotY: -Math.PI / 2 })),
  ].filter((h) => clear(h.x, h.z));

  // Each crossing: a signal on each curb, its arm over that side's lane.
  // Down the block they stand diagonally. At the near corner both stand past
  // the crossing (z 1.0), always ahead of the stage's own operator rig
  // (CameraRig: its lens walks z 15.6 down to 2.4 at most, 3.2-3.6 m up,
  // where the heads hang), so no head comes near the lens.
  const signals: Signal[] = [];
  CROSSINGS.forEach((z, i) => {
    const right = i === 0 ? z - 3.4 : z + 2;
    const left = i === 0 ? z - 3.4 : z - 2;
    signals.push({ x: CURB_X, z: right, rotY: 0 }, { x: -CURB_X, z: left, rotY: Math.PI });
  });

  const bags: Bag[] = [
    // against the building fronts, long side along the street
    ...[-6.5, -22.5, -30, -46, -57, -65].map((z, i) => ({ kind: (i % 3 === 2 ? "one" : "pile") as Bag["kind"], x: 8.45, z, rotY: Math.PI / 2 + (i % 2 ? 0.25 : -0.2) })),
    ...[-9, -27.3, -40, -48, -62.5, -75].map((z, i) => ({ kind: (i % 3 === 1 ? "one" : "pile") as Bag["kind"], x: -8.45, z, rotY: -Math.PI / 2 + (i % 2 ? -0.3 : 0.15) })),
    // a bag put out at the curb beside a hydrant
    { kind: "one", x: HYDRANT_X, z: -15.75, rotY: 0.6 },
    { kind: "one", x: HYDRANT_X, z: -53.75, rotY: 2.1 },
    { kind: "one", x: -HYDRANT_X, z: -47.75, rotY: 1.2 },
  ];

  return { hydrants, signals, bags: bags.filter((b) => clear(b.x, b.z)) };
}
