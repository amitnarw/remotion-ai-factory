/**
 * src/world/traffic.ts
 *
 * Traffic in the world cities (docs/factory/12-traffic.md): a small
 * lane-graph simulation over the city's own streets, run once per scene from
 * fixed inputs and read back per frame. Pure data (no three.js), seeded and
 * deterministic: every render tab computes the same table.
 * Ground frame as roads.ts: metres, x = east, y = up, z = south. Cars keep
 * to the right.
 *
 * API
 *   streetGraph(roads, style) -> StreetGraph
 *     the drivable streets (alleys and strips under MIN_ASPHALT left out)
 *     and the avenue to +/-AVENUE_REACH, split into edges at junctions;
 *     junctions closer than MERGE_LEN are merged into one.
 *   trafficPlan(roads, style, opts) -> TrafficPlan
 *     opts.seed    the place id
 *     opts.scene   {from, to} in video seconds: the table covers it, after a
 *                  WARMUP from the same fixed start in every tab
 *     opts.lens    the scene's camera at video time t: the simulated area
 *                  follows it, and while a low lens stands within reach of
 *                  a lane that stretch is closed (cars stop before it; a car
 *                  caught inside it is taken off the road)
 *     opts.aim     where that camera looks: the area covers what it sees
 *     opts.halt    t -> true while everyone brakes to a stop (a flood, the
 *                  ground cracking, things lifting)
 *     opts.slow    t -> speed factor (snow)
 *     opts.closed  ground polygons no car stands on in the scene (the
 *                  avenue stretch that breaks into slabs)
 *     opts.walkers t -> the featured actors' footprints [x, z, r]: a lane
 *                  stretch within reach of where one stands, or will in
 *                  WALK_AHEAD s, is closed (cars stop WALK_HOLD short of
 *                  it; one already inside it stops short of the actor)
 *   TrafficPlan.cars    per slot: its model (TRAFFIC_MODELS) and length
 *   TrafficPlan.poseAt(t, out, lens?) writes [x, z, yaw, flags] per slot
 *     (flags: PRESENT, BRAKE); yaw turns the model's +z front onto the road.
 *   TrafficPlan.signals the lit junctions' cycles; TrafficPlan.heads one
 *     light head per signalled approach (SIGNAL_MODELS), on the kerb at its
 *     right just behind the stop line, facing the cars that come;
 *     TrafficPlan.lightsAt(t, out) writes each head's light at video time t
 *     (lightAt: 2 green, 1 amber, 0 red), the same the cars obey.
 *
 * How (ideas borrowed, code our own, no dependencies):
 *   - Lanes: one or two per direction by the asphalt's width (the avenue's
 *     follow its painted lines), offset to the right of the centre line and
 *     cut back at each junction until clear of the crossing roads plus a
 *     crosswalk (a bend: by its angle, for a 6 m turning radius).
 *   - Junctions joined by a street too short for a lane between their stop
 *     lines act as one cluster (A/B Street's complex intersections).
 *   - Turn paths: cubic curves through the box from lane end to lane start,
 *     or through a cluster's short streets in their lanes (mitred, corners
 *     cut by Chaikin); straight on, right from the outer lane, left from the
 *     inner; no U-turns, none tighter than MIN_TURN_R or longer than
 *     MAX_TURN where there is another way on. Two turn paths conflict when
 *     the cars on them (a car's length into the lanes at both ends) come
 *     within CLEAR of each other, or they end in the same lane.
 *   - Control: fixed-time two-phase lights where two big roads cross
 *     (green, amber, all-red; a green wave along the avenue), priority where
 *     one big road passes side streets, give-way between streets, free at a
 *     bend. Left turns give way to oncoming traffic; a flow kept waiting by
 *     a crossing one goes first after STARVE seconds.
 *   - Never through each other: cars queue in single lanes and follow their
 *     leader with the Intelligent Driver Model (Treiber, Hennecke, Helbing
 *     2000), clamped behind the leader's back. A car enters a turn path only
 *     once the junction grants it (A/B Street): its light is green, no
 *     conflicting path is in use, it has nobody to give way to, and the exit
 *     lane has room for it. It holds the path until its tail is out of the
 *     box.
 *   - Deterministic: a fixed DT step from scene.from - WARMUP, seeded
 *     choices (makeRng and an integer hash), no state between frames.
 */
import type { Vec3 } from "./geo";
import type { RegionStyle, ResolvedPlace } from "./places";
import { makeRng } from "./rng";
import type { Road, RoadKind, XZ } from "./roads";

/* ------------------------------------------------------------------ */
/*  Models and constants                                                */
/* ------------------------------------------------------------------ */

export interface TrafficModel {
  /** World catalog id (catalog.ts). */
  id: string;
  /** Path under public/. */
  file: string;
  /** Body in metres: bumper to bumper, side to side, ground to roof. */
  length: number;
  width: number;
  height: number;
  /** The body's centre along the model's +z (its front), metres. */
  centreZ: number;
  /** Model units to metres. */
  scale: number;
  /** The model's origin stands this high over the road (wheels below it). */
  lift: number;
}

const KAYKIT = "assets/world/kaykit/city-builder-bits/";
/** KayKit City Builder Bits (CC0): five cars sharing one small texture,
 *  1,200-1,300 triangles each, facing +z. Sizes from the world catalog. */
export const TRAFFIC_MODELS: readonly TrafficModel[] = [
  { id: "kaykit-city-builder-bits-car-hatchback", file: `${KAYKIT}car_hatchback.gltf`, length: 4.03, width: 2.09, height: 1.84, centreZ: 0.04, scale: 5, lift: 0.31 },
  { id: "kaykit-city-builder-bits-car-sedan", file: `${KAYKIT}car_sedan.gltf`, length: 4.69, width: 2.09, height: 1.84, centreZ: -0.02, scale: 5, lift: 0.31 },
  { id: "kaykit-city-builder-bits-car-stationwagon", file: `${KAYKIT}car_stationwagon.gltf`, length: 4.69, width: 2.09, height: 1.84, centreZ: -0.02, scale: 5, lift: 0.31 },
  { id: "kaykit-city-builder-bits-car-taxi", file: `${KAYKIT}car_taxi.gltf`, length: 4.69, width: 2.09, height: 2.17, centreZ: -0.02, scale: 5, lift: 0.31 },
  { id: "kaykit-city-builder-bits-car-police", file: `${KAYKIT}car_police.gltf`, length: 4.69, width: 2.09, height: 2.06, centreZ: -0.02, scale: 5, lift: 0.31 },
];

export interface SignalModel {
  /** World catalog id (catalog.ts). */
  id: string;
  /** Path under public/. */
  file: string;
  /** Model units to metres. */
  scale: number;
  /** Its lamp faces, in the model's frame in metres: where each face's
   *  lenses stand (x, z: the middle of the lens drum) and which way they
   *  look (nx, nz). Face 0 looks along the model's +z. */
  faces: readonly { x: number; z: number; nx: number; nz: number }[];
  /** Lens heights by the light each shows (lightAt): red 0, amber 1, green 2. */
  lamps: readonly [number, number, number];
  /** A lens drum's radius and depth (the lit or unlit cover drawn over it). */
  lens: number;
  depth: number;
  /** Boxes no lens may enter, [x0, x1, y0, y1, z0, z1] in the model's frame
   *  (the pole, the head, an arm). */
  solid: readonly (readonly [number, number, number, number, number, number])[];
  /** Model B's street lamp under its arm (x, y, z), lit at night. */
  bulb: readonly [number, number, number] | null;
}

/** KayKit City Builder Bits traffic lights (CC0, the cars' texture), measured
 *  from the files (scale 5, metres):
 *   - A: a corner pole, 3.65 m, with two heads at right angles: one looking
 *     along +z, one along -x (a far-side head for the crossing street);
 *   - B: A with a taller pole and a street lamp on an arm toward -x;
 *   - C: a mast arm reaching 3.3 m toward -x, its head looking along +z.
 *  The lenses' colours are in the shared texture: the layer covers each lens
 *  with an unlit or a lit drum, so only the light shown glows. */
export const SIGNAL_MODELS: readonly SignalModel[] = [
  {
    id: "kaykit-city-builder-bits-trafficlight-a",
    file: `${KAYKIT}trafficlight_A.gltf`,
    scale: 5,
    faces: [
      { x: 0, z: 0.42, nx: 0, nz: 1 },
      { x: -0.42, z: 0, nx: -1, nz: 0 },
    ],
    lamps: [3.437, 3.107, 2.777],
    lens: 0.138,
    depth: 0.16,
    solid: [[-0.72, 0.22, 0, 3.66, -0.22, 0.58]],
    bulb: null,
  },
  {
    id: "kaykit-city-builder-bits-trafficlight-b",
    file: `${KAYKIT}trafficlight_B.gltf`,
    scale: 5,
    faces: [
      { x: 0, z: 0.42, nx: 0, nz: 1 },
      { x: -0.42, z: 0, nx: -1, nz: 0 },
    ],
    lamps: [3.437, 3.107, 2.777],
    lens: 0.138,
    depth: 0.16,
    solid: [
      [-0.72, 0.22, 0, 4.81, -0.22, 0.58],
      [-1.2, 0, 4.4, 4.81, -0.16, 0.16],
    ],
    bulb: [-1.005, 4.44, 0],
  },
  {
    id: "kaykit-city-builder-bits-trafficlight-c",
    file: `${KAYKIT}trafficlight_C.gltf`,
    scale: 5,
    faces: [{ x: -3.32, z: 0.35, nx: 0, nz: 1 }],
    lamps: [4.637, 4.307, 3.977],
    lens: 0.138,
    depth: 0.13,
    solid: [
      [-0.2, 0.2, 0, 4.86, -0.7, 0.7],
      [-3.84, 0, 3.75, 4.86, -0.2, 0.7],
    ],
    bulb: null,
  },
];
export const SIGNAL_A = 0;
export const SIGNAL_B = 1;
export const SIGNAL_C = 2;

/** The road surface's height (city.ts avenue, meshes.ts asphalt). */
export const TRAFFIC_ROAD_Y = 0.12;
/** Simulation step, seconds; a frame interpolates between two steps. */
export const TRAFFIC_DT = 0.1;
/** Seconds simulated before the scene starts, so queues have formed. */
export const WARMUP = 30;
/** The avenue's simulated reach east and west, metres. */
export const AVENUE_REACH = 1500;
/** Narrowest asphalt that carries cars (Paris streets: 5 m, two narrow lanes). */
export const MIN_ASPHALT = 4.4;
/** Junctions joined by a street shorter than this are one junction. */
export const MERGE_LEN = 10;
/** Two cars' paths closer than this (centre to centre) conflict. */
export const CLEAR = 2.6;
/** A car's body reaches this far behind its front (the longest model). */
const REACH = 4.7;
/** A lens below this height can be hit by a car (tallest roof 2.17 m). */
export const LENS_LOW = 3.4;
/** Flag bits in a pose. */
export const PRESENT = 1;
export const BRAKE = 2;

/** Widest lane, metres. */
const LANE_MAX = 3.5;
/** Junctions joined by a street shorter than this are one cluster. */
const CLUSTER_LEN = 20;
/** The longest turn path through a junction cluster (a longer one holds the box too long). */
const MAX_TURN = 45;
/** A street at least this long keeps its lanes, whatever its stop lines. */
const CLUSTER_MAX = 40;
/** Seconds a flow waits for a crossing one before it goes first. */
const STARVE = 6;
/** Seconds a car gives way before it goes once the box is clear. */
const GIVE_UP = 10;
/** Shortest lane left between two stop lines (else the street joins the junction). */
const MIN_LANE = 8.5;
const CAR_HALF_W = 1.05;
/** Metres kept between a car body and a low lens. */
const LENS_PAD = 0.7;
/** Cars wait this far short of a low lens in their lane, so none stops in
 *  its face. At a cut its lane is cleared (where nobody sees the cars go)
 *  from its start to LENS_AHEAD past the lens; cars then go round it. */
const LENS_HOLD = 12;
const LENS_AHEAD = 10;
/** Featured actors in the carriageway (opts.walkers): a lane is closed
 *  where an actor's footprint will come within WALK_PAD of a car body over
 *  the next WALK_AHEAD seconds (sampled every WALK_DT), so cars brake in
 *  time; they wait WALK_HOLD short of it, and a car already inside that
 *  stretch WALK_GAP short of the actor. */
const WALK_AHEAD = 3;
const WALK_DT = 0.25;
const WALK_PAD = 0.15;
const WALK_HOLD = 3;
const WALK_GAP = 0.8;
/** The simulated area's widest radius around a lens or what it looks at
 *  (higher up, cars are too small to see). */
const AREA_MAX = 900;
const BEND_SETBACK = 1;
/** A bend keeps at least this turning radius (metres). */
const BEND_RADIUS = 6;
const MAX_SETBACK = 30;
/** A stop line stands this far back from the crossing road's asphalt (the crosswalk). */
const STOP_BACK = 1.5;
/** Turn paths tighter than this (metres) are left out where there is another way on. */
const MIN_TURN_R = 3;
/** Intelligent Driver Model: comfortable acceleration and braking (m/s^2),
 *  time headway (s), jam distance (m); a hard braking limit. */
const IDM_A = 1.4;
const IDM_B = 2.2;
const IDM_T = 1.2;
const IDM_S0 = 2;
const B_MAX = 8;
/** Bumper to bumper, never closer (the hard clamp). */
const MIN_GAP = 0.6;
/** Stopping at a line: the obstacle sits this far past it, so a car halts
 *  about 0.4 m short of it. */
const STOP_SLACK = IDM_S0 - 0.4;
/** Braking when the story halts the street. */
const HALT_B = 3.5;
/** How far ahead a car looks for leaders and lines. */
const LOOK = 120;
/** Lateral acceleration in turns, m/s^2. */
const TURN_LAT = 2.4;
/** A light head's pole stands this far onto the sidewalk past the kerb (the
 *  corner heads reach 0.67 m back toward the road at 1.6-3.6 m up). */
const POLE_IN = 0.8;
/** ... this far behind its approach's stop line, or farther back (up to
 *  POLE_BACK_MAX) until it is clear: POLE_CLEAR off every drawn asphalt
 *  strip, a car's half width plus POLE_PATH off every turn path, and
 *  POLE_TREE off any spot city.ts may plant a street tree on. */
const POLE_BACK = 1;
const POLE_BACK_MAX = 14;
const POLE_CLEAR = 0.5;
const POLE_PATH = 0.4;
const POLE_TREE = 1.2;
/** A lens keeps this far out of a head's solids (the camera's near plane is 0.5 m). */
const HEAD_LENS_PAD = 0.7;
/** Sidewalk heights (cityAnchors GROUND, meshes.ts): a road's sidewalk band,
 *  else the core's slab. */
const BAND_Y = 0.08;
const SLAB_Y = 0.04;
/** The avenue's asphalt runs this far each way (city.ts outerHalf). */
const AVENUE_OUTER = 2600;
/** The core's half size, where city.ts plants the avenue's trees. */
const CORE_HALF = 600;

const SPEED: Record<RoadKind, number> = { avenue: 13, main: 11, street: 7.5, alley: 0 };
/** Cars per second entering one lane where a road comes into the simulated area. */
const SPAWN: Record<RoadKind, number> = { avenue: 0.1, main: 0.06, street: 0.015, alley: 0 };
/** Mean metres between cars in a lane at the start. */
const SPACING: Record<RoadKind, number> = { avenue: 30, main: 42, street: 90, alley: 1e9 };
const RANK: Record<RoadKind, number> = { avenue: 3, main: 2, street: 1, alley: 0 };

/**
 * How much traffic a place has at its moment, as a density factor: what the
 * director's choice of place and time gives, matching how the place sounds
 * (pipeline/sound.ts placeSound: a city's traffic bed by day, lower at low
 * sun, half at night; a town only murmurs, so its cars are few).
 */
export function placeTraffic(rp: Pick<ResolvedPlace, "style" | "sun">): number {
  const e = rp.sun.elevation;
  const light = e < -6 ? 0.5 : e < 10 ? 0.85 : 1;
  return (rp.style.id === "european-village" ? 0.3 : 1) * light;
}

/** Model weights by city look: taxis rule New York. */
function modelWeights(style: RegionStyle): number[] {
  return style.id === "american-downtown" ? [1, 2, 1, 4, 0.4] : [3, 3, 2, 0.4, 0.25];
}

/* ------------------------------------------------------------------ */
/*  Geometry                                                            */
/* ------------------------------------------------------------------ */

interface Poly {
  pts: XZ[];
  cum: number[];
  len: number;
}

function poly(pts: XZ[]): Poly {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum, len: cum[cum.length - 1] };
}

/** Point and unit direction at arc length s (extrapolated past both ends). */
function at(p: Poly, s: number, out: number[]): void {
  const { pts, cum } = p;
  let i = 0;
  if (s <= 0) i = 0;
  else if (s >= p.len) i = pts.length - 2;
  else {
    let lo = 0;
    let hi = pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    i = lo;
  }
  const a = pts[i];
  const b = pts[i + 1];
  const seg = cum[i + 1] - cum[i] || 1e-9;
  const ux = (b[0] - a[0]) / seg;
  const uz = (b[1] - a[1]) / seg;
  const u = s - cum[i];
  out[0] = a[0] + ux * u;
  out[1] = a[1] + uz * u;
  out[2] = ux;
  out[3] = uz;
}

/** The polyline offset d metres to its right (right of (ux, uz) is (-uz, ux)). */
function offsetLine(pts: XZ[], d: number): XZ[] {
  const n = pts.length;
  const out: XZ[] = [];
  const dir = (i: number): XZ => {
    const dx = pts[i + 1][0] - pts[i][0];
    const dz = pts[i + 1][1] - pts[i][1];
    const l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  };
  for (let i = 0; i < n; i++) {
    const u1 = i > 0 ? dir(i - 1) : dir(0);
    const u2 = i < n - 1 ? dir(i) : dir(n - 2);
    let mx = -u1[1] - u2[1];
    let mz = u1[0] + u2[0];
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) {
      mx = -u1[1];
      mz = u1[0];
    } else {
      mx /= ml;
      mz /= ml;
    }
    // Mitre: the bisector stretched so both offset segments keep distance d.
    const k = 1 / Math.max(0.5, mx * -u1[1] + mz * u1[0]);
    out.push([pts[i][0] + mx * d * k, pts[i][1] + mz * d * k]);
  }
  return out;
}

/** The piece of a polyline between arc lengths s0 and s1. */
function slice(p: Poly, s0: number, s1: number): XZ[] {
  const o = [0, 0, 0, 0];
  at(p, s0, o);
  const out: XZ[] = [[o[0], o[1]]];
  for (let i = 1; i < p.pts.length - 1; i++) if (p.cum[i] > s0 + 0.05 && p.cum[i] < s1 - 0.05) out.push(p.pts[i]);
  at(p, s1, o);
  out.push([o[0], o[1]]);
  return out;
}

function distToSegment(px: number, pz: number, a: XZ, b: XZ): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const u = l2 > 0 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l2)) : 0;
  return Math.hypot(px - a[0] - dx * u, pz - a[1] - dz * u);
}

function distToLine(px: number, pz: number, pts: readonly XZ[]): number {
  let d = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) d = Math.min(d, distToSegment(px, pz, pts[i], pts[i + 1]));
  return d;
}

function pointInPolygon(x: number, z: number, poly: readonly XZ[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (poly[i][1] > z !== poly[j][1] > z && x < ((poly[j][0] - poly[i][0]) * (z - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) c = !c;
  }
  return c;
}

/** Cubic curve from p0 (heading u) to p3 (heading v), sampled about every 0.75 m. */
function curve(p0: XZ, u: XZ, p3: XZ, v: XZ): XZ[] {
  const chord = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
  const k = chord * 0.42;
  const p1: XZ = [p0[0] + u[0] * k, p0[1] + u[1] * k];
  const p2: XZ = [p3[0] - v[0] * k, p3[1] - v[1] * k];
  const n = Math.max(4, Math.ceil(chord / 0.75));
  const out: XZ[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = (1 - t) ** 3;
    const b = 3 * (1 - t) ** 2 * t;
    const c = 3 * (1 - t) * t * t;
    const d = t ** 3;
    out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
  }
  return out;
}

function unit(a: XZ, b: XZ): XZ {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l = Math.hypot(dx, dz) || 1;
  return [dx / l, dz / l];
}

/** Where the line from p heading d meets the line through q with heading e:
 *  ahead of p, and within 15 m of q; else `fallback`. */
function meet(p: XZ, d: XZ, q: XZ, e: XZ, fallback: XZ): XZ {
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 0.05) return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const s = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
  const x: XZ = [p[0] + d[0] * s, p[1] + d[1] * s];
  return s > 0.5 && Math.hypot(x[0] - q[0], x[1] - q[1]) < 15 ? x : fallback;
}

/** Chaikin corner cutting, the end points (and so the end headings) kept. */
function chaikin(pts: readonly XZ[], rounds: number): XZ[] {
  let cur = pts.slice();
  for (let r = 0; r < rounds; r++) {
    const next: XZ[] = [cur[0]];
    for (let i = 0; i + 1 < cur.length; i++) {
      const [ax, az] = cur[i];
      const [bx, bz] = cur[i + 1];
      if (i > 0) next.push([0.75 * ax + 0.25 * bx, 0.75 * az + 0.25 * bz]);
      if (i + 2 < cur.length) next.push([0.25 * ax + 0.75 * bx, 0.25 * az + 0.75 * bz]);
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}

/** The polyline with extra points so no segment is longer than `step`. */
function resample(pts: readonly XZ[], step: number): XZ[] {
  const out: XZ[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / step);
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  return out;
}

/** Points every `step` metres of arc along the polyline (and its end). */
function even(pts: readonly XZ[], step: number): XZ[] {
  const P = poly(pts as XZ[]);
  const o = [0, 0, 0, 0];
  const out: XZ[] = [];
  for (let s = 0; s < P.len; s += step) {
    at(P, s, o);
    out.push([o[0], o[1]]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Tightest turning radius along a path, measured on points a metre apart. */
function minRadius(path: readonly XZ[]): number {
  const pts = even(path, 1);
  let r = Infinity;
  for (let i = 1; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const [cx, cz] = pts[i + 1];
    const cross = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax));
    if (cross < 1e-9) continue;
    r = Math.min(r, (Math.hypot(bx - ax, bz - az) * Math.hypot(cx - bx, cz - bz) * Math.hypot(cx - ax, cz - az)) / (2 * cross));
  }
  return r;
}

/** Signed angle from heading u to heading v, radians (positive: a right turn). */
function turnAngle(u: XZ, v: XZ): number {
  return Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]);
}

/** Integer hash of two integers (choices that must not depend on call order). */
function mix(a: number, b: number): number {
  let h = Math.imul(a ^ Math.imul(b + 0x9e3779b9, 0x85ebca6b), 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}
const u01 = (h: number) => h / 4294967296;

/* ------------------------------------------------------------------ */
/*  The street graph                                                    */
/* ------------------------------------------------------------------ */

export interface GraphNode {
  id: number;
  x: number;
  z: number;
  /** Incident edge ends: [edge id, 0 at its start | 1 at its end]. */
  ends: [number, 0 | 1][];
  /** On the avenue (its z is exactly 0). */
  avenue: boolean;
}

export interface GraphEdge {
  id: number;
  a: number;
  b: number;
  /** Centre line from node a to node b. */
  pts: XZ[];
  len: number;
  kind: RoadKind;
  /** Half the asphalt (the avenue: its carriage, kerb to centre). */
  half: number;
  /** Lane centres right of the centre line, inner first, per direction. */
  offsets: number[];
}

export interface StreetGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** The avenue's raised median half-width (palm avenues), else 0. */
  median: number;
}

/** The avenue's lanes, matching city.ts's painted lines: two per direction
 *  between the centre (or the palm median) and the kerb. */
export function avenueLanes(style: RegionStyle): { offsets: number[]; carriage: number; median: number } {
  const half = style.avenue / 2;
  const walk = style.avenueWalk ?? (style.trees.kind === "broadleaf" ? 8 : 3);
  const carriage = half - walk;
  const median = style.trees.kind === "palm" ? 2.2 : 0;
  const mark = median ? median + (carriage - median) / 2 : carriage / 2;
  return { offsets: [(median + mark) / 2, (mark + carriage) / 2], carriage, median };
}

/** Asphalt width of a street as meshes.ts draws it. */
export function asphaltOf(road: Road, style: RegionStyle): number {
  return road.kind === "alley" ? road.width * 0.8 : Math.max(3, road.width - 2 * style.sidewalk);
}

function laneOffsets(asphalt: number): number[] {
  const half = asphalt / 2;
  const n = asphalt >= 12 ? 2 : 1;
  const w = Math.min(LANE_MAX, half / n);
  return Array.from({ length: n }, (_, i) => (i + 0.5) * w);
}

const graphCache = new WeakMap<readonly Road[], Map<string, StreetGraph>>();

/** streetGraph, kept per roads array and look (a place's scenes share one). */
export function streetGraphFor(roads: readonly Road[], style: RegionStyle): StreetGraph {
  let byStyle = graphCache.get(roads);
  if (!byStyle) graphCache.set(roads, (byStyle = new Map()));
  let g = byStyle.get(style.id);
  if (!g) byStyle.set(style.id, (g = streetGraph(roads, style)));
  return g;
}

export function streetGraph(roads: readonly Road[], style: RegionStyle, coreHalf = 600): StreetGraph {
  const av = avenueLanes(style);
  const key = (p: XZ) => `${p[0]},${p[1]}`;
  const drive = roads
    .filter((r) => r.kind !== "alley" && asphaltOf(r, style) >= MIN_ASPHALT)
    .map((r) => ({ road: r, pts: r.closed ? r.points.slice(0, -1) : r.points.slice() }));
  const seen = new Map<string, number>();
  for (const d of drive) for (const p of d.pts) seen.set(key(p), (seen.get(key(p)) ?? 0) + 1);
  const onAvenue = (p: XZ) => p[1] === 0 && Math.abs(p[0]) <= coreHalf;

  // Nodes: road ends, shared vertices, avenue crossings (exactly z = 0).
  const nodeOf = new Map<string, number>();
  const raw: { x: number; z: number; avenue: boolean }[] = [];
  const node = (p: XZ) => {
    const k = key(p);
    let id = nodeOf.get(k);
    if (id === undefined) {
      id = raw.length;
      raw.push({ x: p[0], z: p[1], avenue: onAvenue(p) });
      nodeOf.set(k, id);
    }
    return id;
  };
  const isNode = (d: (typeof drive)[number], i: number) =>
    (!d.road.closed && (i === 0 || i === d.pts.length - 1)) || (seen.get(key(d.pts[i])) ?? 0) >= 2 || onAvenue(d.pts[i]);

  type RawEdge = { a: number; b: number; pts: XZ[]; kind: RoadKind; half: number };
  const rawEdges: RawEdge[] = [];
  for (const d of drive) {
    let pts = d.pts;
    if (d.road.closed) {
      let j = pts.findIndex((_, i) => isNode(d, i));
      if (j < 0) j = 0;
      pts = [...pts.slice(j), ...pts.slice(0, j), pts[j]];
    }
    const flags = pts.map((p, i) => (d.road.closed ? i === 0 || i === pts.length - 1 || (seen.get(key(p)) ?? 0) >= 2 || onAvenue(p) : isNode(d, i)));
    if (d.road.closed && !flags.some((f, i) => f && i > 0 && i < pts.length - 1)) flags[0] = flags[pts.length - 1] = true;
    const half = asphaltOf(d.road, style) / 2;
    let start = 0;
    for (let i = 1; i < pts.length; i++) {
      if (!flags[i]) continue;
      const piece: XZ[] = [pts[start]];
      for (let j = start + 1; j <= i; j++) {
        const q = pts[j];
        const last = piece[piece.length - 1];
        if (j < i && Math.hypot(q[0] - last[0], q[1] - last[1]) < 0.05) continue;
        piece.push(q);
      }
      if (piece.length >= 2) rawEdges.push({ a: node(pts[start]), b: node(pts[i]), pts: piece, kind: d.road.kind, half });
      start = i;
    }
  }

  // Merge junctions joined by very short streets into one.
  const len = (pts: XZ[]) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
  const degree = new Array(raw.length).fill(0);
  for (const e of rawEdges) {
    degree[e.a]++;
    degree[e.b]++;
  }
  const parent = raw.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const short = rawEdges.map((e) => e.a !== e.b && degree[e.a] > 1 && degree[e.b] > 1 && len(e.pts) < MERGE_LEN);
  rawEdges.forEach((e, i) => {
    if (!short[i]) return;
    const ra = find(e.a);
    const rb = find(e.b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  });
  const groups = new Map<number, number[]>();
  raw.forEach((_, i) => {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  });
  const nodes: GraphNode[] = [];
  const nodeId = new Map<number, number>();
  for (const [r, members] of groups) {
    const avenueMembers = members.filter((m) => raw[m].avenue);
    const use = avenueMembers.length ? avenueMembers : members;
    const x = use.reduce((s, m) => s + raw[m].x, 0) / use.length;
    const z = avenueMembers.length ? 0 : use.reduce((s, m) => s + raw[m].z, 0) / use.length;
    nodeId.set(r, nodes.length);
    nodes.push({ id: nodes.length, x, z, ends: [], avenue: avenueMembers.length > 0 });
  }
  const edges: GraphEdge[] = [];
  rawEdges.forEach((e, i) => {
    const a = nodeId.get(find(e.a))!;
    const b = nodeId.get(find(e.b))!;
    if (short[i] && a === b) return;
    const pts = e.pts.map((p): XZ => [p[0], p[1]]);
    pts[0] = [nodes[a].x, nodes[a].z];
    pts[pts.length - 1] = [nodes[b].x, nodes[b].z];
    const l = len(pts);
    if (l < 0.5) return;
    edges.push({ id: edges.length, a, b, pts, len: l, kind: e.kind, half: e.half, offsets: laneOffsets(e.half * 2) });
  });

  // The avenue: split at every crossing, running on to +/-AVENUE_REACH.
  const stops = nodes.filter((n) => n.avenue).sort((p, q) => p.x - q.x);
  const west: GraphNode = { id: nodes.length, x: -AVENUE_REACH, z: 0, ends: [], avenue: true };
  nodes.push(west);
  const east: GraphNode = { id: nodes.length, x: AVENUE_REACH, z: 0, ends: [], avenue: true };
  nodes.push(east);
  const chain = [west, ...stops, east];
  for (let i = 0; i + 1 < chain.length; i++) {
    const p = chain[i];
    const q = chain[i + 1];
    if (q.x - p.x < 0.5) continue;
    edges.push({ id: edges.length, a: p.id, b: q.id, pts: [[p.x, 0], [q.x, 0]], len: q.x - p.x, kind: "avenue", half: av.carriage, offsets: av.offsets });
  }

  // A street whose middle runs inside another road's asphalt is that road
  // (generator leftovers: a thin loop of two main roads in Paris, a street
  // piece inside the avenue in Colmar): the lower-ranked or shorter goes.
  const CELL = 20;
  const buckets = new Map<string, number[]>();
  for (const e of edges) {
    const seen = new Set<string>();
    for (let i = 0; i + 1 < e.pts.length; i++) {
      const [ax, az] = e.pts[i];
      const [bx, bz] = e.pts[i + 1];
      for (let cx = Math.floor((Math.min(ax, bx) - e.half) / CELL); cx <= Math.floor((Math.max(ax, bx) + e.half) / CELL); cx++) {
        for (let cz = Math.floor((Math.min(az, bz) - e.half) / CELL); cz <= Math.floor((Math.max(az, bz) + e.half) / CELL); cz++) {
          const k = `${cx},${cz}`;
          if (seen.has(k)) continue;
          seen.add(k);
          const list = buckets.get(k);
          if (list) list.push(e.id);
          else buckets.set(k, [e.id]);
        }
      }
    }
  }
  const dropped = new Set<number>();
  const o4 = [0, 0, 0, 0];
  for (const e of edges) {
    if (e.kind === "avenue") continue;
    const margin = Math.max(6, e.half);
    if (e.len < 2 * margin + 2) continue;
    const P = poly(e.pts);
    const inside = new Map<number, number>();
    let n = 0;
    for (let s = margin; s <= e.len - margin; s += 2, n++) {
      at(P, s, o4);
      const near = new Set(buckets.get(`${Math.floor(o4[0] / CELL)},${Math.floor(o4[1] / CELL)}`) ?? []);
      for (const id of near) {
        if (id === e.id || dropped.has(id)) continue;
        if (distToLine(o4[0], o4[1], edges[id].pts) < edges[id].half) inside.set(id, (inside.get(id) ?? 0) + 1);
      }
    }
    for (const [id, count] of inside) {
      if (count < 0.6 * n) continue;
      const o = edges[id];
      if (RANK[o.kind] > RANK[e.kind] || (RANK[o.kind] === RANK[e.kind] && (o.len > e.len || (o.len === e.len && o.id < e.id)))) {
        dropped.add(e.id);
        break;
      }
    }
  }
  // Then the dead ends this leaves inside the map, until none is left.
  const onMapEdge = (n: GraphNode) => Math.max(Math.abs(n.x), Math.abs(n.z)) >= coreHalf - 3 || Math.abs(n.x) >= AVENUE_REACH;
  for (let changed = true; changed; ) {
    changed = false;
    const deg = new Array(nodes.length).fill(0);
    for (const e of edges) {
      if (dropped.has(e.id)) continue;
      deg[e.a]++;
      deg[e.b]++;
    }
    for (const e of edges) {
      if (dropped.has(e.id) || e.kind === "avenue") continue;
      if ((deg[e.a] === 1 && !onMapEdge(nodes[e.a])) || (deg[e.b] === 1 && !onMapEdge(nodes[e.b]))) {
        dropped.add(e.id);
        changed = true;
      }
    }
  }
  const kept = edges.filter((e) => !dropped.has(e.id));
  kept.forEach((e, i) => (e.id = i));
  for (const e of kept) {
    nodes[e.a].ends.push([e.id, 0]);
    nodes[e.b].ends.push([e.id, 1]);
  }
  return { nodes, edges: kept, median: av.median };
}

/** Unit direction from a node out along an edge end (averaged over 6 m). */
function outward(e: GraphEdge, end: 0 | 1): XZ {
  const p = end === 0 ? e.pts : [...e.pts].reverse();
  const P = poly(p);
  const o = [0, 0, 0, 0];
  at(P, Math.min(6, P.len), o);
  const dx = o[0] - p[0][0];
  const dz = o[1] - p[0][1];
  const l = Math.hypot(dx, dz) || 1;
  return [dx / l, dz / l];
}

/** The first `reach` metres of an edge from one end. */
function endPiece(e: GraphEdge, end: 0 | 1, reach = 40): XZ[] {
  const p = poly(end === 0 ? e.pts : [...e.pts].reverse());
  return slice(p, 0, Math.min(reach, p.len));
}

/* ------------------------------------------------------------------ */
/*  Lanes, turn paths, signals                                          */
/* ------------------------------------------------------------------ */

type Turn = "straight" | "right" | "left";
type Control = "signal" | "priority" | "yield" | "free";

interface PathBase {
  id: number;
  P: Poly;
  vmax: number;
  queue: Car[];
  /** Static closures (the story's broken ground): [sA, sB] arc ranges. */
  closed: [number, number][];
  /** This step's lens closure. */
  lens: [number, number] | null;
  /** This step's closure for featured actors: [from, to] where they will
   *  be over WALK_AHEAD s, and [from, to] where they are now (Infinity
   *  when none is on the path yet). */
  walk: [number, number, number, number] | null;
  /** The last car that drove off this path's end, and its odometer then. */
  lastOut: Car | null;
  leaveOdo: number;
}

interface Lane extends PathBase {
  kind: "lane";
  edge: GraphEdge;
  dir: 0 | 1;
  index: number;
  from: number;
  to: number;
  outs: Conn[];
  sink: boolean;
  source: boolean;
  key: string;
}

interface Conn extends PathBase {
  kind: "conn";
  from: Lane;
  to: Lane;
  node: number;
  turn: Turn;
  /** Signal phase 0 or 1 at a lit junction, else -1. */
  phase: number;
  conflicts: Conn[];
  /** Turn paths from the same lane, and the arc where this one leaves them. */
  siblings: { c: Conn; at: number }[];
  /** From a side street where a big road has priority. */
  minor: boolean;
  /** Paths this one gives way to: a left turn to oncoming traffic in the
   *  same green or on a priority road, a side street to the big road. */
  yieldTo: Conn[];
  /** Extra gap a follower keeps on this path (tight turns). */
  pad: number;
  /** The car waiting at its stop line for this path, since when. */
  waitCar: Car | null;
  waitSince: number;
  /** Cars holding this path. */
  occ: number;
}

type Path = Lane | Conn;

/** A fixed-time light: the cycle (s), its offset, and each phase's green
 *  (phase 0, the main axis, from the cycle's start; phase 1 after an amber
 *  and an all-red). */
export interface Signal {
  cycle: number;
  offset: number;
  green: [number, number];
}

/** A lit junction (cluster): its root node, where it stands, its cycle. */
export interface TrafficSignal extends Signal {
  node: number;
  x: number;
  z: number;
}

/**
 * One light head: a KayKit traffic light on the kerb at the right of a
 * signalled approach, just behind its stop line, its main face (+z) toward
 * the cars that come. Pure data; the layer draws it (TrafficSignals.tsx).
 */
export interface SignalHead {
  /** The pole's foot: ground metres and the sidewalk's height there. */
  x: number;
  y: number;
  z: number;
  /** Turns the model's +z (its main face) toward the approaching cars. */
  yaw: number;
  /** SIGNAL_MODELS index. */
  model: number;
  /** Index into TrafficPlan.signals, and the phase of its approach. */
  signal: number;
  phase: number;
  /** The phase the corner models' second face (-x, across the approach's
   *  lanes) shows: a far-side head for the cars coming from the left; -1
   *  when no approach comes from there (the face stays dark). */
  cross: number;
  /** The approach: its heading into the junction (at its kerb lane's
   *  stop), its lanes' stop points (where a car's front halts; inner lane
   *  first, the kerb lane last), and its edge end ("edge:end"). */
  dir: XZ;
  stops: XZ[];
  approach: string;
}

const AMBER = 3;
const ALL_RED = 2;

/** Light of a phase at time t: 2 green, 1 amber, 0 red. The cars obey it
 *  (no car is let into the junction on red) and the heads show it. */
export function lightAt(sig: Signal, phase: number, t: number): number {
  const u = (((t + sig.offset) % sig.cycle) + sig.cycle) % sig.cycle;
  const [ga, gb] = sig.green;
  const startB = ga + AMBER + ALL_RED;
  const local = phase === 0 ? u : u - startB;
  const g = phase === 0 ? ga : gb;
  if (local >= 0 && local < g) return 2;
  if (local >= g && local < g + AMBER) return 1;
  return 0;
}

interface Car {
  id: number;
  model: number;
  len: number;
  /** Desired speed as a share of each path's limit. */
  factor: number;
  path: Path;
  /** Front bumper's arc length on its path. */
  s: number;
  v: number;
  odo: number;
  next: Conn | null;
  granted: boolean;
  holds: { c: Conn; until: number }[];
  /** Previous paths, most recent first (the body trails onto them). */
  hist: Path[];
  slot: number;
  decisions: number;
  /** Its last request was refused for a crossing path in use. */
  blocked: boolean;
  acc: number;
  ds: number;
  alive: boolean;
}

/* ------------------------------------------------------------------ */
/*  The plan                                                            */
/* ------------------------------------------------------------------ */

export interface TrafficOptions {
  seed: string;
  scene: { from: number; to: number };
  lens?: (t: number) => Vec3;
  /** Where the lens looks at video time t: the area covers what it sees. */
  aim?: (t: number) => Vec3;
  halt?: (t: number) => boolean;
  slow?: (t: number) => number;
  closed?: readonly (readonly XZ[])[];
  /** The featured actors at video time t, as footprints [x, z, radius]
   *  (generator/camera/world.ts castWalkers): cars stop for one in their
   *  lane. Before the scene they stand where it starts. */
  walkers?: (t: number) => readonly (readonly [number, number, number])[];
  /** Traffic density factor (1: as tuned). */
  density?: number;
  /** The density at video time t, for a scene whose moment moves (a time
   *  lapse, docs/factory/13-light-and-time.md): the arrivals follow it at
   *  each step, while the cars on the road at the start follow `density`.
   *  Without it the arrivals keep `density` (the plan as before, draw for
   *  draw). */
  densityAt?: (t: number) => number;
  warmup?: number;
  /** For tests: record every request to enter a lit junction (debug.grants). */
  trace?: boolean;
}

export interface TrafficStats {
  /** Cars that drove in the simulation. */
  cars: number;
  /** Slots in the table (cars seen in the scene). */
  slots: number;
  /** Most cars present at one step of the scene. */
  peak: number;
  /** Cars taken off the road by the lens (all / during the scene). */
  lensRemoved: number;
  lensRemovedInScene: number;
  /** Lanes ending at a junction with no way on (cars vanish there). */
  deadEnds: number;
  lanes: number;
  turnPaths: number;
  signals: number;
  /** Light heads drawn, and signalled approaches left without one (no clear
   *  spot on the kerb, or the scene's lens passes through every model). */
  heads: number;
  headsDropped: number;
  /** Milliseconds to build and run, and per phase. */
  ms: number;
  phases: { graph: number; lanes: number; turns: number; conflicts: number; run: number };
}

export interface TrafficPlan {
  cars: { model: number; length: number }[];
  t0: number;
  dt: number;
  steps: number;
  /** steps x slots x [x, z, yaw, flags]. */
  table: Float32Array;
  stats: TrafficStats;
  /** Writes each slot's [x, z, yaw, flags] at video time t into out (length
   *  slots x 4); a lens below LENS_LOW hides any car within reach of it.
   *  Returns the number of cars present. */
  poseAt(t: number, out: Float32Array, lens?: Vec3): number;
  /** The lit junctions, and one light head per signalled approach. */
  signals: TrafficSignal[];
  heads: SignalHead[];
  /** Writes each head's light at video time t into out (length heads):
   *  2 green, 1 amber, 0 red, as the cars of its approach obey it. */
  lightsAt(t: number, out: Uint8Array): void;
  /** For tests and previews: the lanes and turn paths as polylines; with
   *  opts.trace, every request to enter a lit junction as [t, head, code]
   *  (code 0 refused on red, 1 refused on amber, 2 let in, 3 refused for
   *  anything else; head -1 when its approach has none). */
  debug: {
    lanes: { pts: XZ[]; kind: RoadKind; sink: boolean; source: boolean }[];
    turns: { pts: XZ[]; turn: Turn; node: number; phase: number }[];
    signals: { node: number; x: number; z: number }[];
    grants: number[];
  };
}

export function trafficPlan(roads: readonly Road[], style: RegionStyle, opts: TrafficOptions): TrafficPlan {
  const started = performance.now();
  const phases = { graph: 0, lanes: 0, turns: 0, conflicts: 0, run: 0 };
  let mark = started;
  const lap = (k: keyof typeof phases) => {
    const now = performance.now();
    phases[k] += now - mark;
    mark = now;
  };
  const graph = streetGraphFor(roads, style);
  lap("graph");
  const { nodes, edges } = graph;
  const seedInt = mix(Math.floor(makeRng(`traffic:${opts.seed}`)() * 4294967296), 7);
  const density = opts.density ?? 1;
  const warmup = opts.warmup ?? WARMUP;
  const { from, to } = opts.scene;
  const t0 = from - warmup;

  // The simulated area: junctions near the lens's ground track (wider for
  // a high lens) and around what it looks at, every avenue junction, and the
  // streets touching them.
  let inArea: (n: GraphNode) => boolean = () => true;
  if (opts.lens) {
    const near: [number, number, number][] = [];
    for (let t = from; ; t = Math.min(to, t + 0.5)) {
      const [x, y, z] = opts.lens(t);
      near.push([x, z, Math.min(AREA_MAX, 320 + 2 * Math.max(0, y))]);
      if (opts.aim) {
        const [ax, ay, az] = opts.aim(t);
        near.push([ax, az, Math.min(AREA_MAX, 320 + 0.6 * Math.hypot(ax - x, ay - y, az - z))]);
      }
      if (t >= to) break;
    }
    inArea = (n) => n.avenue || near.some(([x, z, r]) => Math.hypot(n.x - x, n.z - z) < r);
  }
  const areaNode = nodes.map((n) => n.ends.length > 1 && inArea(n));
  // Lanes, cut back at their junctions until clear of the crossing roads.
  const paths: Path[] = [];
  const lanes: Lane[] = [];
  const lanesAt = new Map<number, { ins: Lane[]; outs: Lane[] }>();
  const at4 = [0, 0, 0, 0];
  const cosDeg = (d: number) => Math.cos((d * Math.PI) / 180);
  // A junction on the area's edge is cut back too: cars leaving and arriving
  // there keep out of each other's way. A bend is cut back by its angle, so
  // its turn keeps a radius of BEND_RADIUS.
  const setback = (P: Poly, nodeId: number, e: GraphEdge, end: 0 | 1, fromEnd: boolean): number => {
    const n = nodes[nodeId];
    const limit = Math.min(MAX_SETBACK, P.len);
    if (n.ends.length === 1) return 0;
    const mine = outward(e, end);
    if (n.ends.length === 2) {
      if (!areaNode[nodeId]) return 0;
      const [id, en] = n.ends[0][0] === e.id && n.ends[0][1] === end ? n.ends[1] : n.ends[0];
      const o = outward(edges[id], en);
      const deflection = Math.PI - Math.acos(Math.max(-1, Math.min(1, mine[0] * o[0] + mine[1] * o[1])));
      return Math.min(limit, Math.max(BEND_SETBACK, BEND_RADIUS * Math.tan(Math.min(deflection, 2.6) / 2)));
    }
    const others = n.ends
      .filter(([id, en]) => !(id === e.id && en === end))
      .filter(([id, en]) => {
        const o = outward(edges[id], en);
        return mine[0] * o[0] + mine[1] * o[1] > cosDeg(155);
      })
      .map(([id, en]) => ({ half: edges[id].half, pts: endPiece(edges[id], en) }));
    for (let s = 0.5; s <= limit; s += 0.5) {
      at(P, fromEnd ? P.len - s : s, at4);
      if (others.every((o) => distToLine(at4[0], at4[1], o.pts) >= o.half + CAR_HALF_W + STOP_BACK)) return Math.min(limit, s + 0.5);
    }
    return limit;
  };
  // Every lane's full cut-back at both ends.
  const candidates = edges.filter((e) => e.kind === "avenue" || areaNode[e.a] || areaNode[e.b]);
  const cuts = new Map<number, { dir: 0 | 1; index: number; full: Poly; s0: number; s1: number }[]>();
  for (const e of candidates) {
    const list: { dir: 0 | 1; index: number; full: Poly; s0: number; s1: number }[] = [];
    for (const dir of [0, 1] as const) {
      const base = dir === 0 ? e.pts : [...e.pts].reverse();
      e.offsets.forEach((d, index) => {
        const full = poly(offsetLine(base, d));
        const s0 = setback(full, dir === 0 ? e.a : e.b, e, dir === 0 ? 0 : 1, false);
        const s1 = setback(full, dir === 0 ? e.b : e.a, e, dir === 0 ? 1 : 0, true);
        list.push({ dir, index, full, s0, s1 });
      });
    }
    cuts.set(e.id, list);
  }

  // Junctions joined by a street too short for a whole lane between their
  // stop lines (or shorter than CLUSTER_LEN) act as one: their turn paths
  // run through the short street in one go, so no car ever waits inside the
  // box. A cluster of one node is a plain junction.
  const cparent = nodes.map((_, i) => i);
  const cfind = (i: number): number => (cparent[i] === i ? i : (cparent[i] = cfind(cparent[i])));
  const inner = new Set<number>();
  for (const e of candidates) {
    if (!areaNode[e.a] || !areaNode[e.b]) continue;
    if (e.len >= CLUSTER_LEN && (e.len >= CLUSTER_MAX || cuts.get(e.id)!.every((c) => c.s0 + c.s1 + MIN_LANE <= c.full.len))) continue;
    inner.add(e.id);
    const ra = cfind(e.a);
    const rb = cfind(e.b);
    if (ra !== rb) cparent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
  const usedEdges = candidates.filter((e) => !inner.has(e.id));

  for (const e of usedEdges) {
    for (const cut of cuts.get(e.id)!) {
      const { dir, index, full } = cut;
      const fromNode = dir === 0 ? e.a : e.b;
      const toNode = dir === 0 ? e.b : e.a;
      let { s0, s1 } = cut;
      if (s0 + s1 > full.len - 3) {
        const k = Math.max(0, full.len - 3) / Math.max(1e-6, s0 + s1);
        s0 *= k;
        s1 *= k;
      }
      const lane: Lane = {
        kind: "lane",
        id: paths.length,
        P: poly(slice(full, s0, full.len - s1)),
        vmax: SPEED[e.kind],
        queue: [],
        closed: [],
        lens: null,
        walk: null,
        lastOut: null,
        leaveOdo: 0,
        edge: e,
        dir,
        index,
        from: fromNode,
        to: toNode,
        outs: [],
        sink: false,
        source: !areaNode[fromNode],
        key: `${e.id}:${dir}:${index}`,
      };
      paths.push(lane);
      lanes.push(lane);
      for (const [n, side] of [[cfind(fromNode), "outs"], [cfind(toNode), "ins"]] as const) {
        let entry = lanesAt.get(n);
        if (!entry) lanesAt.set(n, (entry = { ins: [], outs: [] }));
        entry[side].push(lane);
      }
    }
  }

  // Control per junction (cluster): lights where two big roads cross (three
  // or more approaches on the avenue or main roads), priority where one big
  // road passes side streets, give-way between streets, free at a bend.
  const members = new Map<number, number[]>();
  nodes.forEach((n) => {
    if (!areaNode[n.id]) return;
    const r = cfind(n.id);
    const m = members.get(r);
    if (m) m.push(n.id);
    else members.set(r, [n.id]);
  });
  const control = new Map<number, Control>();
  const signals = new Map<number, Signal>();
  const phaseOfEnd = new Map<string, number>();
  for (const [root, list] of members) {
    const ends = list.flatMap((id) => nodes[id].ends.filter(([e]) => !inner.has(e)));
    if (ends.length < 3) {
      control.set(root, "free");
      continue;
    }
    const kinds = ends.map(([id]) => edges[id].kind);
    const major = kinds.filter((k) => RANK[k] >= 2).length;
    // Side streets give way where one big road passes; equal streets give
    // way to each other; two big roads crossing get lights.
    if (major < 3) {
      control.set(root, major === 2 ? "priority" : "yield");
      continue;
    }
    // The major axis: the best-ranked pair of roughly opposite approaches.
    const dirs = ends.map(([id, en]) => outward(edges[id], en));
    let axis: XZ | null = null;
    let best = -1;
    for (let i = 0; i < dirs.length; i++) {
      for (let j = i + 1; j < dirs.length; j++) {
        const dot = dirs[i][0] * dirs[j][0] + dirs[i][1] * dirs[j][1];
        if (dot > cosDeg(140)) continue;
        const score = RANK[kinds[i]] + RANK[kinds[j]] - dot * 0.01;
        if (score > best) {
          best = score;
          axis = dirs[i];
        }
      }
    }
    if (!axis) {
      let top = 0;
      kinds.forEach((k, i) => {
        if (RANK[k] > RANK[kinds[top]]) top = i;
      });
      axis = dirs[top];
    }
    const phaseOf = dirs.map((d) => (Math.abs(d[0] * axis![0] + d[1] * axis![1]) > cosDeg(40) ? 0 : 1));
    if (!phaseOf.includes(0) || !phaseOf.includes(1)) {
      control.set(root, "yield");
      continue;
    }
    control.set(root, "signal");
    ends.forEach(([id, en], i) => phaseOfEnd.set(`${id}:${en}`, phaseOf[i]));
    const onAvenue = list.filter((id) => nodes[id].avenue);
    const cycle = onAvenue.length ? 44 : 40;
    const ga = Math.round((cycle - 2 * (AMBER + ALL_RED)) * 0.62);
    const gb = cycle - 2 * (AMBER + ALL_RED) - ga;
    // A green wave eastward along the avenue; elsewhere a seeded offset.
    const x = onAvenue.reduce((s, id) => s + nodes[id].x, 0) / Math.max(1, onAvenue.length);
    const offset = onAvenue.length ? -x / 12 : u01(mix(seedInt, root + 1)) * cycle;
    signals.set(root, { cycle, offset, green: [ga, gb] });
  }

  lap("lanes");
  // Turn paths through each junction of the area, and through a cluster's
  // short streets on the way (in their lane for the turn).
  const innerAt = new Map<number, [GraphEdge, 0 | 1][]>();
  for (const id of inner) {
    const e = edges[id];
    if (e.a === e.b) continue;
    for (const [n, dir] of [[e.a, 0], [e.b, 1]] as const) {
      const list = innerAt.get(n);
      if (list) list.push([e, dir]);
      else innerAt.set(n, [[e, dir]]);
    }
  }
  /** The short streets from node a to node b inside a cluster (fewest first). */
  const route = (a: number, b: number): [GraphEdge, 0 | 1][] | null => {
    if (a === b) return [];
    const prev = new Map<number, { from: number; e: GraphEdge; dir: 0 | 1 } | null>([[a, null]]);
    const queue = [a];
    while (queue.length) {
      const n = queue.shift()!;
      for (const [e, dir] of innerAt.get(n) ?? []) {
        const m = dir === 0 ? e.b : e.a;
        if (prev.has(m)) continue;
        prev.set(m, { from: n, e, dir });
        if (m === b) {
          const out: [GraphEdge, 0 | 1][] = [];
          for (let step = prev.get(b); step; step = prev.get(step.from)) out.unshift([step.e, step.dir]);
          return out;
        }
        queue.push(m);
      }
    }
    return null;
  };
  const conns: Conn[] = [];
  const connsAt = new Map<number, Conn[]>();
  const medianZ = graph.median > 0 ? graph.median + CAR_HALF_W : 0;
  for (const [root, { ins, outs }] of lanesAt) {
    if (!areaNode[root]) continue;
    const bend = control.get(root) === "free";
    const avenueHere = (members.get(root) ?? []).some((id) => nodes[id].avenue);
    const here: Conn[] = [];
    for (const li of ins) {
      const end = [0, 0, 0, 0];
      at(li.P, li.P.len, end);
      const u: XZ = [end[2], end[3]];
      const made: Conn[] = [];
      // Turns tighter than MIN_TURN_R wait here in case nothing else is left.
      const tight: { lo: Lane; turn: Turn; pts: XZ[]; r: number }[] = [];
      let forced = false;
      const tryPair = (lo: Lane, turn: Turn, via: [GraphEdge, 0 | 1][], given?: XZ[]) => {
        const st = [0, 0, 0, 0];
        at(lo.P, 0, st);
        const v: XZ = [st[2], st[3]];
        const p0: XZ = [end[0], end[1]];
        const p1: XZ = [st[0], st[1]];
        let pts: XZ[];
        if (given) pts = given;
        else if (!via.length) pts = curve(p0, u, p1, v);
        else {
          // Through each short street in its lane for the turn: the lanes
          // as a control polygon from the stop line to the next lane's
          // start (headings kept), corners cut smooth (Chaikin).
          // Consecutive lanes meet where their lines cross (the mitre), so
          // the polygon never doubles back at a corner.
          const pieces = via.map(([k, dir]) => {
            const n = k.offsets.length;
            const idx = turn === "right" ? n - 1 : turn === "left" ? 0 : Math.min(li.index, n - 1);
            return offsetLine(dir === 0 ? k.pts : [...k.pts].reverse(), k.offsets[idx]);
          });
          const ctrl: XZ[] = [p0];
          let from: XZ = p0;
          let head: XZ = u;
          for (const piece of pieces) {
            const d0 = unit(piece[0], piece[1]);
            ctrl.push(meet(from, head, piece[0], d0, piece[0]), ...piece.slice(1, -1));
            from = piece[piece.length - 1];
            head = unit(piece[piece.length - 2], from);
          }
          const x = meet(from, head, p1, [-v[0], -v[1]], from);
          ctrl.push(x, p1);
          pts = chaikin(ctrl.filter((q, i) => i === 0 || Math.hypot(q[0] - ctrl[i - 1][0], q[1] - ctrl[i - 1][1]) > 0.05), 5);
        }
        pts = resample(pts, 0.75);
        const r = minRadius(pts);
        if (!bend && r < MIN_TURN_R && !forced) {
          tight.push({ lo, turn, pts, r });
          return;
        }
        // Palm avenues: the raised median is never crossed.
        if (medianZ && avenueHere && pts.some((q) => Math.abs(q[1]) < medianZ && Math.abs(q[0]) <= 600)) return;
        const P = poly(pts);
        if (P.len > MAX_TURN && !forced) return;
        const vmax = Math.min(li.vmax, lo.vmax, Math.max(3, Math.sqrt(TURN_LAT * r)));
        const phase = control.get(root) === "signal" ? phaseOfEnd.get(`${li.edge.id}:${li.dir === 0 ? 1 : 0}`) ?? 0 : -1;
        // Followers keep a longer gap through a tight turn (their bodies swing).
        const pad = Math.max(0, (BEND_RADIUS - r) * 0.5);
        const minor = control.get(root) === "priority" && RANK[li.edge.kind] < 2;
        made.push({ kind: "conn", id: -1, P, vmax, pad, queue: [], closed: [], lens: null, walk: null, lastOut: null, leaveOdo: 0, from: li, to: lo, node: root, turn, phase, minor, conflicts: [], siblings: [], yieldTo: [], waitCar: null, waitSince: 0, occ: 0 });
      };
      const pairs: { lo: Lane; turn: Turn; ok: boolean; via: [GraphEdge, 0 | 1][] }[] = [];
      for (const lo of outs) {
        if (lo.edge === li.edge && lo.dir !== li.dir) continue; // no U-turns
        const via = route(li.to, lo.from);
        if (!via) continue;
        const st = [0, 0, 0, 0];
        at(lo.P, 0, st);
        const ang = turnAngle(u, [st[2], st[3]]);
        const deg = Math.abs((ang * 180) / Math.PI);
        if (!bend && deg > 150) continue;
        const turn: Turn = bend || deg < 35 ? "straight" : ang > 0 ? "right" : "left";
        const nIn = li.edge.offsets.length;
        const nOut = lo.edge.offsets.length;
        const ok =
          turn === "straight" ? lo.index === Math.min(li.index, nOut - 1) : turn === "right" ? li.index === nIn - 1 && lo.index === nOut - 1 : li.index === 0 && lo.index === 0;
        pairs.push({ lo, turn, ok, via });
      }
      for (const p of pairs) if (p.ok) tryPair(p.lo, p.turn, p.via);
      // No way on by the lane rules: any lane of each road, nearest index.
      if (!made.length) for (const p of pairs) if (p.lo.index === Math.min(li.index, p.lo.edge.offsets.length - 1)) tryPair(p.lo, p.turn, p.via);
      // Still none: the widest tight turn, rather than cars vanishing here.
      if (!made.length && tight.length) {
        const best = tight.reduce((a, b) => (b.r > a.r ? b : a));
        if (best.r >= 1.2) {
          forced = true;
          tryPair(best.lo, best.turn, [], best.pts);
          forced = false;
        }
      }
      for (const c of made) {
        c.id = paths.length;
        paths.push(c);
        conns.push(c);
        here.push(c);
        li.outs.push(c);
      }
    }
    connsAt.set(root, here);
  }

  lap("turns");
  // Conflicts between the turn paths of each junction (cluster). A car on a
  // turn path reaches back into its lane and on into the next one by up to
  // its length, so each path is tested with those ends.
  const swept = (c: Conn): { pts: XZ[]; lead: number } => {
    const pts: XZ[] = [];
    const a = c.from.P;
    for (let s = Math.max(0, a.len - REACH); s < a.len; s += 0.75) {
      at(a, s, at4);
      pts.push([at4[0], at4[1]]);
    }
    const lead = pts.length;
    pts.push(...c.P.pts);
    const b = c.to.P;
    for (let s = 0.75; s <= Math.min(REACH, b.len); s += 0.75) {
      at(b, s, at4);
      pts.push([at4[0], at4[1]]);
    }
    return { pts, lead };
  };
  // Points of a cluster's paths by cell (CLEAR wide): two paths are near
  // where a point of one has a point of the other in its 3 x 3 cells.
  const GAP = CLEAR + 0.2;
  for (const list of connsAt.values()) {
    const swepts = list.map(swept);
    const sweeps = swepts.map((w) => w.pts);
    const N = list.length;
    const cells = new Map<number, number[]>();
    const cellOf = (x: number, z: number) => (Math.floor(x / GAP) + 32768) * 65536 + (Math.floor(z / GAP) + 32768);
    sweeps.forEach((pts, i) => {
      for (let k = 0; k < pts.length; k++) {
        const key = cellOf(pts[k][0], pts[k][1]);
        const bucket = cells.get(key);
        if (bucket) bucket.push(i, k);
        else cells.set(key, [i, k]);
      }
    });
    /** For each point k of path i: does path j come within GAP of it? */
    const touches = (i: number, k: number, j: number): boolean => {
      const [x, z] = sweeps[i][k];
      const cx = Math.floor(x / GAP);
      const cz = Math.floor(z / GAP);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = cells.get((cx + dx + 32768) * 65536 + (cz + dz + 32768));
          if (!bucket) continue;
          for (let m = 0; m < bucket.length; m += 2) {
            if (bucket[m] !== j) continue;
            const q = sweeps[j][bucket[m + 1]];
            if ((q[0] - x) ** 2 + (q[1] - z) ** 2 < GAP * GAP) return true;
          }
        }
      }
      return false;
    };
    const near = new Set<number>();
    sweeps.forEach((pts, i) => {
      for (let k = 0; k < pts.length; k++) {
        const [x, z] = pts[k];
        const cx = Math.floor(x / GAP);
        const cz = Math.floor(z / GAP);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            const bucket = cells.get((cx + dx + 32768) * 65536 + (cz + dz + 32768));
            if (!bucket) continue;
            for (let m = 0; m < bucket.length; m += 2) {
              const j = bucket[m];
              if (j <= i || near.has(i * N + j)) continue;
              const q = sweeps[j][bucket[m + 1]];
              if ((q[0] - x) ** 2 + (q[1] - z) ** 2 < GAP * GAP) near.add(i * N + j);
            }
          }
        }
      }
    });
    // A path's own points start after its lane's reach (the swept prefix).
    const lead = swepts.map((w) => w.lead);
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const a = list[i];
        const b = list[j];
        if (a.from === b.from) {
          // Siblings: where each leaves the other.
          const leave = (pi: number, qi: number) => {
            const c = list[pi];
            for (let k = 0; k < c.P.pts.length; k++) if (!touches(pi, lead[pi] + k, qi)) return c.P.cum[k];
            return c.P.len;
          };
          a.siblings.push({ c: b, at: leave(i, j) });
          b.siblings.push({ c: a, at: leave(j, i) });
          continue;
        }
        if (a.to !== b.to && !near.has(i * N + j)) continue;
        a.conflicts.push(b);
        b.conflicts.push(a);
        // Left turns give way to oncoming traffic in the same green (or on
        // the priority road); side streets give way to the priority road.
        if (a.minor !== b.minor) (a.minor ? a : b).yieldTo.push(a.minor ? b : a);
        else if (!a.minor && a.phase === b.phase) {
          if (a.turn === "left" && b.turn !== "left") a.yieldTo.push(b);
          if (b.turn === "left" && a.turn !== "left") b.yieldTo.push(a);
        }
      }
    }
  }

  lap("conflicts");
  // Sinks and sources.
  let deadEnds = 0;
  for (const l of lanes) {
    if (!areaNode[l.to]) l.sink = true;
    else if (!l.outs.length) {
      l.sink = true;
      deadEnds++;
    }
  }

  // Light heads: one per signalled approach, on the kerb at its right just
  // behind the stop line of its kerb lane, facing the cars that come. Two
  // lanes a direction get the mast arm (C) over them; a big road's single
  // lane the pole with a lamp (B); a street the corner pole (A).
  const signalList: TrafficSignal[] = [];
  const heads: SignalHead[] = [];
  const headOfApproach = new Map<string, number>();
  let headsDropped = 0;
  {
    // The drawn strips (meshes.ts): asphalt and its sidewalk band per road
    // segment, each stretched past both ends by its half width.
    const segs: { ax: number; az: number; ux: number; uz: number; len: number; asphalt: number; band: number; main: boolean }[] = [];
    for (const r of roads) {
      for (let i = 0; i + 1 < r.points.length; i++) {
        const [ax, az] = r.points[i];
        const [bx, bz] = r.points[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 1e-6) continue;
        segs.push({ ax, az, ux: (bx - ax) / len, uz: (bz - az) / len, len, asphalt: asphaltOf(r, style) / 2, band: r.width / 2, main: r.kind === "main" });
      }
    }
    /** How far (x, z) lies outside a strip of half width h (0 inside). */
    const outside = (x: number, z: number, s: (typeof segs)[number], h: number) => {
      const dx = x - s.ax;
      const dz = z - s.az;
      const along = dx * s.ux + dz * s.uz;
      const across = Math.abs(dz * s.ux - dx * s.uz);
      return Math.hypot(Math.max(0, -h - along, along - s.len - h), Math.max(0, across - h));
    };
    const av = avenueLanes(style);
    // Street trees (city.ts): the avenue's rows (broadleaf, every
    // avenueSpacing from -CORE_HALF, jittered half a metre) and along the
    // main roads (from each vertex, every avenueSpacing, width / 2 - 2.5 out).
    const broadleaf = style.trees.kind === "broadleaf";
    const sides = style.trees.avenueSides ?? "both";
    const rows = broadleaf ? [-style.avenue / 2 + 4, style.avenue / 2 - 4].filter((z) => sides === "both" || (sides === "north") === z < 0) : [];
    const spacing = style.trees.avenueSpacing;
    const nearTree = (x: number, z: number, near: typeof segs): boolean => {
      for (const rz of rows) {
        if (Math.abs(z - rz) >= POLE_TREE || Math.abs(x) > CORE_HALF + POLE_TREE) continue;
        const k = Math.round((x + CORE_HALF) / spacing);
        if (Math.abs(x - (-CORE_HALF + k * spacing)) < POLE_TREE + 0.5) return true;
      }
      if (!broadleaf) return false;
      for (const s of near) {
        if (!s.main) continue;
        const along = (x - s.ax) * s.ux + (z - s.az) * s.uz;
        if (along < -POLE_TREE || along > s.len + POLE_TREE) continue;
        const off = s.band - 2.5;
        const k = Math.max(0, Math.min(Math.ceil(s.len / spacing) - 1, Math.round(along / spacing)));
        for (let j = k - 1; j <= k + 1; j++) {
          if (j < 0 || j * spacing >= s.len) continue;
          const px = s.ax + s.ux * j * spacing;
          const pz = s.az + s.uz * j * spacing;
          for (const side of [-1, 1]) if (Math.hypot(x - (px - s.uz * off * side), z - (pz + s.ux * off * side)) < POLE_TREE) return true;
        }
      }
      return false;
    };
    // The scene's lens, where it may come near a head (low enough).
    const lensPts: Vec3[] = [];
    if (opts.lens) {
      for (let t = from; ; t = Math.min(to, t + 0.1)) {
        const L = opts.lens(t);
        if (L[1] < 6) lensPts.push(L);
        if (t >= to) break;
      }
    }
    const lensHits = (model: SignalModel, x: number, y: number, z: number, yaw: number): boolean => {
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      for (const L of lensPts) {
        const dx = L[0] - x;
        const dz = L[2] - z;
        if (dx * dx + dz * dz > 25) continue;
        // Into the model's frame (the inverse of its turn about y).
        const lx = dx * c - dz * s;
        const lz = dx * s + dz * c;
        const ly = L[1] - y;
        const p = HEAD_LENS_PAD;
        for (const [x0, x1, y0, y1, z0, z1] of model.solid) if (lx > x0 - p && lx < x1 + p && ly > y0 - p && ly < y1 + p && lz > z0 - p && lz < z1 + p) return true;
      }
      return false;
    };
    const incoming = new Map<string, Lane[]>();
    for (const l of lanes) {
      const k = `${l.edge.id}:${l.dir === 0 ? 1 : 0}`;
      const list = incoming.get(k);
      if (list) list.push(l);
      else incoming.set(k, [l]);
    }
    const o4 = [0, 0, 0, 0];
    for (const [root, sig] of signals) {
      const si = signalList.length;
      signalList.push({ node: root, x: nodes[root].x, z: nodes[root].z, cycle: sig.cycle, offset: sig.offset, green: sig.green });
      const approaches: { key: string; edge: GraphEdge; ins: Lane[]; outer: Lane; u: XZ; phase: number }[] = [];
      for (const id of members.get(root) ?? []) {
        for (const [e, en] of nodes[id].ends) {
          if (inner.has(e)) continue;
          const key = `${e}:${en}`;
          const ins = (incoming.get(key) ?? []).filter((l) => cfind(l.to) === root).sort((a, b) => a.index - b.index);
          if (!ins.length) continue;
          const outer = ins[ins.length - 1];
          at(outer.P, outer.P.len, o4);
          approaches.push({ key, edge: edges[e], ins, outer, u: [o4[2], o4[3]], phase: phaseOfEnd.get(key) ?? 0 });
        }
      }
      const turnsHere = connsAt.get(root) ?? [];
      for (const ap of approaches) {
        const { edge: e, outer } = ap;
        const P = outer.P;
        const [sx, sz] = P.pts[P.pts.length - 1];
        const near = segs.filter((s) => outside(sx, sz, s, s.band) < POLE_BACK_MAX + 25);
        // From the kerb lane's centre out past the kerb onto the sidewalk.
        const lat = e.half - e.offsets[outer.index] + POLE_IN;
        let spot: { x: number; z: number; ux: number; uz: number } | null = null;
        for (let back = POLE_BACK; back <= POLE_BACK_MAX && back < P.len; back += 0.5) {
          at(P, P.len - back, o4);
          const x = o4[0] - o4[3] * lat;
          const z = o4[1] + o4[2] * lat;
          if (Math.abs(x) <= AVENUE_OUTER && Math.abs(z) < av.carriage + POLE_CLEAR) continue;
          if (near.some((s) => outside(x, z, s, s.asphalt) < POLE_CLEAR)) continue;
          if (turnsHere.some((c) => distToLine(x, z, c.P.pts) < CAR_HALF_W + POLE_PATH)) continue;
          if (nearTree(x, z, near)) continue;
          spot = { x, z, ux: o4[2], uz: o4[3] };
          break;
        }
        if (!spot) {
          headsDropped++;
          continue;
        }
        const { x, z, ux, uz } = spot;
        const y = near.some((s) => outside(x, z, s, s.band) <= 0) ? BAND_Y : SLAB_Y;
        const yaw = Math.atan2(-ux, -uz);
        const wish = e.offsets.length >= 2 ? SIGNAL_C : RANK[e.kind] >= 2 ? SIGNAL_B : SIGNAL_A;
        const model = [wish, SIGNAL_A].find((m) => !lensHits(SIGNAL_MODELS[m], x, y, z, yaw));
        if (model === undefined) {
          headsDropped++;
          continue;
        }
        // The corner models' second face looks across the approach's lanes
        // (left of it): it shows the cars that come from there their light.
        const rx = -uz;
        const rz = ux;
        let cross = -1;
        let best = cosDeg(35);
        for (const o of approaches) {
          const dot = o.u[0] * rx + o.u[1] * rz;
          if (o !== ap && dot > best) {
            best = dot;
            cross = o.phase;
          }
        }
        headOfApproach.set(ap.key, heads.length);
        heads.push({
          x,
          y,
          z,
          yaw,
          model,
          signal: si,
          phase: ap.phase,
          cross: SIGNAL_MODELS[model].faces.length > 1 ? cross : -1,
          dir: ap.u,
          stops: ap.ins.map((l): XZ => [l.P.pts[l.P.pts.length - 1][0], l.P.pts[l.P.pts.length - 1][1]]),
          approach: ap.key,
        });
      }
    }
  }
  const trace: number[] = [];
  const headOfConn = (c: Conn) => headOfApproach.get(`${c.from.edge.id}:${c.from.dir === 0 ? 1 : 0}`) ?? -1;

  // Static closures: the story's broken ground.
  const closedAreas = opts.closed ?? [];
  if (closedAreas.length) {
    for (const p of paths) {
      let open: number | null = null;
      for (let s = 0; s <= p.P.len + 1e-6; s += 1) {
        at(p.P, Math.min(s, p.P.len), at4);
        const inside = closedAreas.some((poly) => pointInPolygon(at4[0], at4[1], poly) || distToLine(at4[0], at4[1], [...poly, poly[0]]) < CAR_HALF_W + 0.5);
        if (inside && open === null) open = Math.max(0, s - 1);
        if (!inside && open !== null) {
          p.closed.push([open, s]);
          open = null;
        }
      }
      if (open !== null) p.closed.push([open, p.P.len + 1e9]);
    }
  }

  // The lens's (and the actors') grid: path samples every metre, by 8 m cell.
  const CELL = 8;
  const grid = new Map<number, number[]>();
  const cellKey = (cx: number, cz: number) => (cx + 4096) * 8192 + (cz + 4096);
  if (opts.lens || opts.walkers) {
    for (const p of paths) {
      for (let s = 0; s <= p.P.len; s += 1) {
        at(p.P, s, at4);
        const k = cellKey(Math.floor(at4[0] / CELL), Math.floor(at4[1] / CELL));
        let list = grid.get(k);
        if (!list) grid.set(k, (list = []));
        list.push(p.id, s, at4[0], at4[1]);
      }
    }
  }
  const lensPaths: Path[] = [];
  const reach = CAR_HALF_W + LENS_PAD + 0.5;
  const setLens = (L: Vec3) => {
    for (const p of lensPaths) p.lens = null;
    lensPaths.length = 0;
    if (L[1] >= LENS_LOW) return;
    const cx = Math.floor(L[0] / CELL);
    const cz = Math.floor(L[2] / CELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = grid.get(cellKey(cx + dx, cz + dz));
        if (!list) continue;
        for (let i = 0; i < list.length; i += 4) {
          if (Math.hypot(list[i + 2] - L[0], list[i + 3] - L[2]) > reach) continue;
          const p = paths[list[i]];
          const s = list[i + 1];
          if (!p.lens) {
            p.lens = [s - 0.5, s + 0.5];
            lensPaths.push(p);
          } else {
            p.lens[0] = Math.min(p.lens[0], s - 0.5);
            p.lens[1] = Math.max(p.lens[1], s + 0.5);
          }
        }
      }
    }
  };

  // The featured actors' closures at video time t (before the scene, where
  // they stand at its start): every path point within reach of a footprint
  // now or over the next WALK_AHEAD s.
  const walkPaths: Path[] = [];
  const setWalkers = (t: number) => {
    for (const p of walkPaths) p.walk = null;
    walkPaths.length = 0;
    const walkers = opts.walkers!;
    for (let k = 0; k * WALK_DT <= WALK_AHEAD + 1e-9; k++) {
      for (const [wx, wz, wr] of walkers(Math.max(from, t + k * WALK_DT))) {
        const r = CAR_HALF_W + wr + WALK_PAD;
        const cx = Math.floor(wx / CELL);
        const cz = Math.floor(wz / CELL);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            const list = grid.get(cellKey(cx + dx, cz + dz));
            if (!list) continue;
            for (let i = 0; i < list.length; i += 4) {
              if (Math.hypot(list[i + 2] - wx, list[i + 3] - wz) > r) continue;
              const p = paths[list[i]];
              const sa = list[i + 1] - 0.5;
              const sb = list[i + 1] + 0.5;
              if (!p.walk) {
                p.walk = [sa, sb, Infinity, -Infinity];
                walkPaths.push(p);
              } else {
                p.walk[0] = Math.min(p.walk[0], sa);
                p.walk[1] = Math.max(p.walk[1], sb);
              }
              if (k === 0) {
                p.walk[2] = Math.min(p.walk[2], sa);
                p.walk[3] = Math.max(p.walk[3], sb);
              }
            }
          }
        }
      }
    }
  };
  /** Where a car whose front is at `s` on a path stops for its actors'
   *  closure: WALK_HOLD short of the stretch, or, already inside it, short
   *  of the actor ahead (none: it is past them and drives on). */
  const walkStop = (w: [number, number, number, number], s: number): number => {
    const ahead = s <= w[0] ? w[0] : s <= w[2] ? w[2] : Infinity;
    if (ahead === Infinity) return Infinity;
    const hold = ahead === w[0] ? WALK_HOLD : WALK_GAP;
    return s <= ahead - hold ? ahead - hold : Math.max(s, ahead - WALK_GAP);
  };

  /* ---------------- cars ---------------- */

  const weights = modelWeights(style);
  const wsum = weights.reduce((a, b) => a + b, 0);
  const cars: Car[] = [];
  const modelOf = (id: number): number => {
    let r = u01(mix(seedInt, id * 2 + 1)) * wsum;
    let model = 0;
    while (model < weights.length - 1 && r >= weights[model]) r -= weights[model++];
    return model;
  };
  const newCar = (path: Lane, s: number, v: number): Car => {
    const id = cars.length;
    const model = modelOf(id);
    const car: Car = {
      id,
      model,
      len: TRAFFIC_MODELS[model].length,
      factor: 0.85 + 0.25 * u01(mix(seedInt, id * 2 + 2)),
      path,
      s,
      v,
      odo: 0,
      next: null,
      granted: false,
      holds: [],
      hist: [],
      slot: -1,
      decisions: 0,
      blocked: false,
      acc: 0,
      ds: 0,
      alive: true,
    };
    cars.push(car);
    return car;
  };
  const overlapsClosure = (p: Path, a: number, b: number) => p.closed.some(([c0, c1]) => a < c1 && b > c0);

  // Cars along every lane at the start, seeded per lane.
  for (const l of lanes) {
    const rng = makeRng(`traffic:${opts.seed}:init:${l.key}`);
    const mean = SPACING[l.edge.kind] / density;
    let s = 5 + rng() * mean;
    while (s < l.P.len - 3) {
      const car = newCar(l, s, 0);
      if (s - car.len < 0 || overlapsClosure(l, s - car.len, s)) {
        car.alive = false;
      } else {
        car.v = 0.6 * car.factor * l.vmax;
        l.queue.unshift(car);
      }
      s += car.len + IDM_S0 + 1 + -Math.log(1 - rng() * 0.999) * mean;
    }
  }
  // Arrivals where roads come into the area: a seeded Poisson stream per lane.
  // With a density that moves (densityAt), each wait is the same seeded draw
  // in expected arrivals, used up at the rate of each step (`acc`), so a
  // thinning street lengthens the waits as it thins; nothing reads the clock.
  const densityAt = opts.densityAt;
  const sources = lanes.filter((l) => l.source).map((l) => {
    const rng = makeRng(`traffic:${opts.seed}:src:${l.key}`);
    const rate = SPAWN[l.edge.kind] * density;
    const need = -Math.log(1 - rng() * 0.999);
    return { lane: l, rng, rate, base: SPAWN[l.edge.kind], next: t0 + need / rate, need, acc: 0 };
  });

  let lensRemoved = 0;
  let lensRemovedInScene = 0;
  const release = (car: Car) => {
    for (const h of car.holds) h.c.occ--;
    car.holds = [];
  };
  const remove = (car: Car) => {
    if (!car.alive) return;
    car.alive = false;
    release(car);
    const q = car.path.queue;
    const i = q.indexOf(car);
    if (i >= 0) q.splice(i, 1);
  };

  /** The car's body overlaps an arc range on its path or the paths behind it. */
  const bodyOverlaps = (car: Car, range: (p: Path) => [number, number] | null): boolean => {
    let back = car.len;
    let head = car.s;
    let p: Path = car.path;
    for (let k = 0; ; k++) {
      const r = range(p);
      if (r && head - back < r[1] && head > r[0]) return true;
      back -= head;
      if (back <= 0 || k >= car.hist.length) return false;
      p = car.hist[k];
      head = p.P.len;
    }
  };

  const signalOf = (c: Conn) => signals.get(c.node);

  /** Why a car may not enter turn path c now (null: it may). */
  const denyReason = (car: Car, c: Conn, d: number, t: number): string | null => {
    const ctl = control.get(c.node);
    if (ctl === "signal") {
      const light = lightAt(signalOf(c)!, c.phase, t);
      if (light === 0) return "red";
      // On amber, only a car that can no longer stop comfortably goes on.
      if (light === 1 && d > (car.v * car.v) / (2 * IDM_B)) return "amber";
    } else if (ctl === "yield" || c.minor) {
      // Slow to walking pace at the line first.
      if (d > 3.5 || car.v > 3) return "yield-approach";
    }
    for (const k of c.conflicts) if (k.occ > 0) return "conflict";
    // A flow kept waiting by a crossing one for STARVE seconds goes first
    // once the box is clear (the longer wait wins).
    for (const k of c.conflicts) {
      const w = k.waitCar;
      if (!w || !w.alive || w.granted || w.next !== k || !w.blocked) continue;
      if (t - k.waitSince > STARVE && (k.waitSince < c.waitSince || (k.waitSince === c.waitSince && k.id < c.id))) {
        if (control.get(k.node) !== "signal" || lightAt(signalOf(k)!, k.phase, t) === 2) return "fair";
      }
    }
    // Giving way to oncoming traffic (or the big road), until GIVE_UP.
    if (t - c.waitSince < GIVE_UP) {
      for (const k of c.yieldTo) {
        const h = k.from.queue[0];
        if (!h || h.granted) continue;
        const dh = k.from.P.len - h.s;
        const goes = ctl !== "signal" || lightAt(signalOf(k)!, k.phase, t) === 2;
        if (goes && dh < h.v * 4 + 6 && (h.next === null || h.next === k)) return "give-way";
      }
    }
    // Room in the exit lane for the whole car, stopped at its jam gap and
    // clear of the box (don't block the box).
    const out = c.to;
    const last = out.queue[out.queue.length - 1];
    let free = last ? last.s - last.len : out.P.len;
    // A lens closing the exit lane: the car must fit before its waiting stretch.
    if (out.lens) free = Math.min(free, out.lens[0] - LENS_HOLD - IDM_S0);
    // An actor on the turn path or in the exit lane: wait at the line.
    if (c.walk) return "walker";
    if (out.walk) free = Math.min(free, out.walk[0] - WALK_HOLD - IDM_S0);
    for (const o of c.queue) free -= o.len + IDM_S0;
    if (free < Math.min(car.len + IDM_S0 + 0.8, out.P.len)) return "room";
    return null;
  };

  const tryGrant = (car: Car, lane: Lane, t: number) => {
    const d = lane.P.len - car.s;
    if (d > (car.v * car.v) / (2 * IDM_B) + 25) return;
    if (!car.next) {
      // Straight on is likelier than a turn; a lane the lens closes is
      // avoided where there is another way on.
      const open = lane.outs.filter((c) => !c.lens && !c.to.lens && !c.walk && !c.to.walk);
      const ways = open.length ? open : lane.outs;
      let sum = 0;
      for (const c of ways) sum += c.turn === "straight" ? 3 : c.turn === "right" ? 1.2 : 1;
      let r = u01(mix(mix(seedInt, car.id + 0x51ed), car.decisions++)) * sum;
      let pick = ways[ways.length - 1];
      for (const c of ways) {
        const w = c.turn === "straight" ? 3 : c.turn === "right" ? 1.2 : 1;
        if (r < w) {
          pick = c;
          break;
        }
        r -= w;
      }
      car.next = pick;
    }
    const c = car.next;
    // Who waits for this path since when (fairness between crossing flows).
    if (c.waitCar !== car) {
      c.waitCar = car;
      c.waitSince = t;
    }
    const why = denyReason(car, c, d, t);
    if (opts.trace && c.phase >= 0) trace.push(t, headOfConn(c), why === null ? 2 : why === "red" ? 0 : why === "amber" ? 1 : 3);
    car.blocked = why === "conflict";
    if (why) return;
    c.waitCar = null;
    car.granted = true;
    c.occ++;
    car.holds.push({ c, until: car.odo + d + c.P.len + car.len + 0.3 });
  };

  /* ---------------- the run ---------------- */

  const nSteps = Math.ceil((to - t0) / TRAFFIC_DT) + 2;
  const recFrom = Math.max(0, Math.floor((from - t0) / TRAFFIC_DT) - 1);
  const records: number[][] = [];
  let slots = 0;
  let peak = 0;
  const slotModel: number[] = [];
  const order: Car[] = [];
  const leaders: (Car | null)[] = [];
  const p4 = [0, 0, 0, 0];
  let lastLens: Vec3 | null = null;
  const q4 = [0, 0, 0, 0];

  // One car's terms this step (hoisted: no closures per car and step): its
  // speed, the strongest IDM interaction term and how far its front may
  // move at most.
  const IDM_SQ = 2 * Math.sqrt(IDM_A * IDM_B);
  let cv = 0;
  let cAcc = Infinity;
  let cHard = Infinity;
  const cand = (gap: number, vl: number, hardGap = gap - MIN_GAP) => {
    const g = gap > 0.05 ? gap : 0.05;
    const sStar = IDM_S0 + Math.max(0, cv * IDM_T + (cv * (cv - vl)) / IDM_SQ);
    const term = -IDM_A * (sStar / g) * (sStar / g);
    if (term < cAcc) cAcc = term;
    if (hardGap < cHard) cHard = hardGap;
  };
  const nearestClosure = (q: Path, from: number): number => {
    let best = Infinity;
    for (const c of q.closed) if (c[1] > from && c[0] < best) best = c[0];
    if (q.lens && q.lens[1] > from && Math.max(0, q.lens[0] - LENS_HOLD) < best) best = Math.max(0, q.lens[0] - LENS_HOLD);
    if (q.walk) {
      const stop = walkStop(q.walk, from);
      if (Math.max(0, stop) < best) best = Math.max(0, stop);
    }
    return best;
  };
  // Turn paths from the same lane share their first metres: a car on a
  // sibling path whose tail has not left the shared part is ahead.
  // `base`: arc 0 of the path, from this car's front.
  const siblingsOn = (c: Conn, base: number, mine: number) => {
    for (const sib of c.siblings) {
      for (const o of sib.c.queue) {
        const tail = o.s - o.len;
        if (tail < sib.at && tail > mine) cand(base + tail - Math.max(c.pad, sib.c.pad), o.v);
      }
    }
  };

  /** Position along the car's route `back` metres behind its front. */
  const backAt = (car: Car, back: number, out: number[]) => {
    let u = car.s - back;
    let p: Path = car.path;
    for (let k = 0; u < 0 && k < car.hist.length; k++) {
      p = car.hist[k];
      u += p.P.len;
    }
    at(p.P, u, out);
  };

  for (let step = 0; step < nSteps; step++) {
    const t = t0 + step * TRAFFIC_DT;
    const inScene = step >= recFrom;

    // The lens: before the scene it stands where the scene starts.
    if (opts.lens) {
      const L = opts.lens(Math.max(from, t));
      // A cut (or the start): the lens's lane is cleared behind it and a little ahead.
      const cut = !lastLens || Math.hypot(L[0] - lastLens[0], L[1] - lastLens[1], L[2] - lastLens[2]) > 3;
      lastLens = L;
      setLens(L);
      const zone = (q: Path): [number, number] | null => (q.lens ? (cut ? [-Infinity, q.lens[1] + LENS_AHEAD] : q.lens) : null);
      for (const p of lensPaths) {
        for (const car of [...p.queue]) {
          if (bodyOverlaps(car, zone)) {
            remove(car);
            lensRemoved++;
            if (inScene) lensRemovedInScene++;
          }
        }
      }
      // Bodies trailing back onto a closed path from the next one.
      if (lensPaths.length) for (const car of cars) {
        if (car.alive && car.hist.length && car.s < car.len && bodyOverlaps(car, zone)) {
          remove(car);
          lensRemoved++;
          if (inScene) lensRemovedInScene++;
        }
      }
    }

    // The featured actors: their lanes close ahead of them.
    if (opts.walkers) setWalkers(t);

    // The story: everyone brakes to a stop, or drives slower in snow.
    const halting = opts.halt?.(t) ?? false;
    const speed = opts.slow?.(t) ?? 1;

    // Arrivals.
    if (!halting) {
      for (const src of sources) {
        if (densityAt ? src.acc < src.need : t < src.next) continue;
        const l = src.lane;
        const last = l.queue[l.queue.length - 1];
        // The car that just drove off a short lane may still trail on it.
        const gone = l.lastOut;
        const room = last ? last.s - last.len : gone && gone.alive ? l.P.len + gone.odo - l.leaveOdo - gone.len : Infinity;
        const len = TRAFFIC_MODELS[modelOf(cars.length)].length + 0.1;
        if (room < len + IDM_S0 + 1 || overlapsClosure(l, 0, len) || (l.lens && l.lens[0] < len + 1) || (l.walk && l.walk[0] < len + WALK_HOLD)) continue;
        const car = newCar(l, len, 0);
        const want = car.factor * l.vmax * speed;
        car.v = last ? Math.min(want, last.v + Math.sqrt(2 * IDM_B * Math.max(0, room - car.s - IDM_S0))) : want;
        l.queue.push(car);
        if (densityAt) {
          src.acc = 0;
          src.need = -Math.log(1 - src.rng() * 0.999);
        } else src.next = t + -Math.log(1 - src.rng() * 0.999) / src.rate;
      }
    }
    // The waits run on through a halt, as the clock's do.
    if (densityAt) {
      const d = densityAt(t);
      for (const src of sources) src.acc += src.base * d * TRAFFIC_DT;
    }

    // Accelerations, in a fixed order: paths by id, each queue front first.
    order.length = 0;
    leaders.length = 0;
    for (const p of paths) {
      for (let i = 0; i < p.queue.length; i++) {
        order.push(p.queue[i]);
        leaders.push(i > 0 ? p.queue[i - 1] : null);
      }
    }
    for (let i = 0; i < order.length; i++) {
      const car = order[i];
      const leader = leaders[i];
      const p = car.path;
      if (!leader && p.kind === "lane" && !p.sink && !car.granted && !halting) tryGrant(car, p, t);
      const v = car.v;
      const v0 = Math.max(0.1, car.factor * p.vmax * speed);
      cv = v;
      cAcc = Infinity;
      cHard = Infinity;
      let bound = Infinity;
      if (leader) {
        const cl = nearestClosure(p, car.s);
        if (cl < leader.s) cand(cl - car.s, 0);
        cand(leader.s - leader.len - car.s - (p.kind === "conn" ? p.pad : 0), leader.v);
        if (p.kind === "conn") siblingsOn(p, -car.s, car.s);
      } else {
        // The car that just drove off this path's end.
        const lo = p.lastOut;
        let pad = p.kind === "conn" ? p.pad : 0;
        if (lo && lo.alive) {
          const past = lo.odo - p.leaveOdo;
          const loPad = lo.path.kind === "conn" ? lo.path.pad : 0;
          if (past - lo.len < LOOK) cand(p.P.len - car.s + past - lo.len - Math.max(pad, loPad), lo.v);
        }
        let off = -car.s;
        let q: Path = p;
        for (let depth = 0; depth < 5; depth++) {
          if (q.kind === "conn") pad = Math.max(pad, q.pad);
          const cl = nearestClosure(q, depth === 0 ? car.s : 0);
          if (Number.isFinite(cl)) cand(off + cl, 0);
          if (depth > 0) {
            const last = q.queue[q.queue.length - 1];
            if (last) {
              cand(off + last.s - last.len - pad, last.v);
              break;
            }
          }
          if (q.kind === "conn") siblingsOn(q, off, depth === 0 ? car.s : 0);
          const end = off + q.P.len;
          if (end > LOOK) break;
          let nx: Path;
          if (q.kind === "lane") {
            if (q.sink) break;
            if (depth === 0 && car.granted && car.next) nx = car.next;
            else {
              cand(end + STOP_SLACK, 0, end - 0.05);
              break;
            }
          } else nx = q.to;
          // Slow down in time for a tighter turn or a slower road.
          const vNext = car.factor * nx.vmax * speed;
          if (vNext < v && end > 0) bound = Math.min(bound, (vNext * vNext - v * v) / (2 * Math.max(end, 1)) + 0.3);
          off = end;
          q = nx;
        }
      }
      // IDM: free road plus the strongest interaction; past the road's speed
      // (a slower path, snow) it slows down comfortably.
      const r = v / v0;
      const free = Math.max(-IDM_B, IDM_A * (1 - r * r * r * r));
      let a = cAcc < Infinity ? free + cAcc : free;
      a = Math.max(-B_MAX, Math.min(IDM_A, a, bound));
      // The story halts the street: a steady stop, then standing still.
      if (halting) a = Math.min(a, v > 0 ? -HALT_B : 0);
      let vn = v + a * TRAFFIC_DT;
      let ds: number;
      if (vn < 0) {
        ds = a < 0 ? Math.max(0, (-v * v) / (2 * a)) : 0;
        vn = 0;
      } else ds = v * TRAFFIC_DT + 0.5 * a * TRAFFIC_DT * TRAFFIC_DT;
      if (ds > cHard) {
        ds = Math.max(0, cHard);
        vn = Math.min(vn, ds / TRAFFIC_DT);
      }
      car.acc = a;
      car.ds = Math.max(0, ds);
      car.v = vn;
    }

    // Moves, in the same order (a queue's front moves before its followers).
    for (const car of order) {
      if (!car.alive) continue;
      car.s += car.ds;
      car.odo += car.ds;
      for (;;) {
        const p = car.path;
        if (car.s <= p.P.len) break;
        // Leaving the area (a few hundred metres from the lens, or the map's edge).
        if (p.kind === "lane" && p.sink) {
          remove(car);
          break;
        }
        let nx: Path;
        if (p.kind === "lane") {
          if (!car.granted || !car.next) {
            car.odo -= car.s - p.P.len;
            car.s = p.P.len;
            break;
          }
          nx = car.next;
          car.next = null;
          car.granted = false;
        } else nx = p.to;
        const q = p.queue;
        if (q[0] === car) q.shift();
        else q.splice(q.indexOf(car), 1);
        p.lastOut = car;
        p.leaveOdo = car.odo - (car.s - p.P.len);
        car.s -= p.P.len;
        car.hist.unshift(p);
        if (car.hist.length > 3) car.hist.length = 3;
        car.path = nx;
        nx.queue.push(car);
      }
      for (let k = car.holds.length - 1; k >= 0; k--) {
        if (car.odo >= car.holds[k].until) {
          car.holds[k].c.occ--;
          car.holds.splice(k, 1);
        }
      }
    }

    // The table.
    if (inScene) {
      const rec: number[] = [];
      let present = 0;
      for (const p of paths) {
        for (const car of p.queue) {
          if (car.slot < 0) {
            car.slot = slots++;
            slotModel.push(car.model);
          }
          backAt(car, car.len * 0.2, p4);
          backAt(car, car.len * 0.8, q4);
          const brake = car.acc < -1 || car.v < 0.5 ? BRAKE : 0;
          rec.push(car.slot, (p4[0] + q4[0]) / 2, (p4[1] + q4[1]) / 2, Math.atan2(p4[0] - q4[0], p4[1] - q4[1]), PRESENT | brake);
          present++;
        }
      }
      peak = Math.max(peak, present);
      records.push(rec);
    }
  }

  lap("run");
  const steps = records.length;
  const table = new Float32Array(steps * slots * 4);
  records.forEach((rec, k) => {
    for (let i = 0; i < rec.length; i += 5) {
      const o = (k * slots + rec[i]) * 4;
      table[o] = rec[i + 1];
      table[o + 1] = rec[i + 2];
      table[o + 2] = rec[i + 3];
      table[o + 3] = rec[i + 4];
    }
  });
  const tStart = t0 + recFrom * TRAFFIC_DT;
  const carsOut = slotModel.map((m) => ({ model: m, length: TRAFFIC_MODELS[m].length }));

  const poseAt = (t: number, out: Float32Array, lens?: Vec3): number => {
    const k = Math.max(0, Math.min(steps - 1, (t - tStart) / TRAFFIC_DT));
    const i = Math.min(steps - 1, Math.floor(k));
    const j = Math.min(steps - 1, i + 1);
    const f = k - i;
    const low = lens && lens[1] < LENS_LOW;
    let n = 0;
    for (let s = 0; s < slots; s++) {
      const a = (i * slots + s) * 4;
      const b = (j * slots + s) * 4;
      const fa = table[a + 3];
      const fb = table[b + 3];
      const o = s * 4;
      const near = f < 0.5 ? fa : fb;
      if (!(near & PRESENT)) {
        out[o + 3] = 0;
        continue;
      }
      let x: number;
      let z: number;
      let yaw: number;
      if (fa & PRESENT && fb & PRESENT) {
        x = table[a] + (table[b] - table[a]) * f;
        z = table[a + 1] + (table[b + 1] - table[a + 1]) * f;
        let dy = table[b + 2] - table[a + 2];
        if (dy > Math.PI) dy -= 2 * Math.PI;
        if (dy < -Math.PI) dy += 2 * Math.PI;
        yaw = table[a + 2] + dy * f;
      } else {
        const c = f < 0.5 ? a : b;
        x = table[c];
        z = table[c + 1];
        yaw = table[c + 2];
      }
      if (low) {
        // A car within reach of a low lens is not drawn (the next step takes it off).
        const dx = lens![0] - x;
        const dz = lens![2] - z;
        const along = dx * Math.sin(yaw) + dz * Math.cos(yaw);
        const side = dx * Math.cos(yaw) - dz * Math.sin(yaw);
        if (Math.abs(along) < carsOut[s].length / 2 + LENS_PAD && Math.abs(side) < CAR_HALF_W + LENS_PAD) {
          out[o + 3] = 0;
          continue;
        }
      }
      out[o] = x;
      out[o + 1] = z;
      out[o + 2] = yaw;
      out[o + 3] = near;
      n++;
    }
    return n;
  };

  const lightsAt = (t: number, out: Uint8Array): void => {
    for (let i = 0; i < heads.length; i++) out[i] = lightAt(signalList[heads[i].signal], heads[i].phase, t);
  };

  return {
    cars: carsOut,
    t0: tStart,
    dt: TRAFFIC_DT,
    steps,
    table,
    poseAt,
    signals: signalList,
    heads,
    lightsAt,
    stats: {
      cars: cars.length,
      slots,
      peak,
      lensRemoved,
      lensRemovedInScene,
      deadEnds,
      lanes: lanes.length,
      turnPaths: conns.length,
      signals: signals.size,
      heads: heads.length,
      headsDropped,
      ms: performance.now() - started,
      phases,
    },
    debug: {
      lanes: lanes.map((l) => ({ pts: l.P.pts, kind: l.edge.kind, sink: l.sink, source: l.source })),
      turns: conns.map((c) => ({ pts: c.P.pts, turn: c.turn, node: c.node, phase: c.phase })),
      signals: [...signals.keys()].map((id) => ({ node: id, x: nodes[id].x, z: nodes[id].z })),
      grants: trace,
    },
  };
}
