/**
 * src/world/flight.ts
 *
 * The camera path for one journey between two places, as a pure function
 * of time: a street-level shot at A, a climb through the clouds, a flight
 * over the globe along the great circle, a descent through the clouds, and
 * a low glide over B.
 *
 * The ground and the globe are drawn at different scales (metres versus
 * Earth radii), so the switch between them happens inside the cloud layer,
 * where the veil is fully closed. Everything else is continuous.
 */
import {
  bearing,
  EARTH_RADIUS_M,
  headingToGround,
  latLonToUnit,
  normalize,
  scale,
  slerp,
  type Vec3,
} from "./geo";
import type { ResolvedPlace } from "./places";

export interface GroundPose {
  pos: Vec3;
  target: Vec3;
}

export interface GlobePose {
  pos: Vec3;
  target: Vec3;
  up: Vec3;
  altitudeKm: number;
}

export interface FlightFrame {
  /** Which ground scene to draw, or null while over the globe. */
  ground: { side: "a" | "b"; pose: GroundPose } | null;
  globe: GlobePose | null;
  /** Cloud veil over the picture, 0..1 (1 hides the scale switch). */
  veil: number;
  /** The clock shown on the globe: runs from A's moment to B's. */
  utcMs: number;
}

/** Seconds. */
export const TIMING = {
  dollyEnd: 2.6,
  seam1: 5.0,
  seam2: 9.6,
  descendEnd: 12.0,
  end: 15.0,
  veilRamp: 0.65,
};

// Leave the cloud high enough that the globe's ~55 km facets read as a
// planet, not as a few huge triangles filling the frame.
const GLOBE_LOW_KM = 1400;
const GLOBE_PEAK_KM = 6500;
const R_KM = EARTH_RADIUS_M / 1000;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const x = clamp01(v);
  return x * x * (3 - 2 * x);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpAngle = (a: number, b: number, t: number) => {
  const d = ((b - a + 540) % 360) - 180;
  return a + d * t;
};
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** Where the camera climbs out of A and drops into B (ground x, z), so the
 *  city can put clouds there. */
export const CLOUD_PASSAGES: Record<"a" | "b", [number, number]> = {
  a: [-75, 0],
  b: [-410, 0],
};

export function travelCourse(a: ResolvedPlace, b: ResolvedPlace) {
  const nA = latLonToUnit(a.place.lat, a.place.lon);
  const nB = latLonToUnit(b.place.lat, b.place.lon);
  const depart = bearing(a.place.lat, a.place.lon, b.place.lat, b.place.lon);
  // The course on arrival: the bearing onward along the same great circle.
  const beyond = slerp(nA, nB, 1.05);
  const beyondLat = (Math.asin(beyond[1]) * 180) / Math.PI;
  const beyondLon = (Math.atan2(beyond[0], beyond[2]) * 180) / Math.PI;
  const arrive = bearing(b.place.lat, b.place.lon, beyondLat, beyondLon);
  const distanceKm = Math.acos(Math.max(-1, Math.min(1, nA[0] * nB[0] + nA[1] * nB[1] + nA[2] * nB[2]))) * R_KM;
  return { nA, nB, depart, arrive, distanceKm };
}

function veilAt(t: number): number {
  const v = (seam: number) => smooth(1 - Math.abs(t - seam) / TIMING.veilRamp);
  return Math.max(v(TIMING.seam1), v(TIMING.seam2));
}

// The opening shot looks west along the avenue, with the morning sun behind
// the camera so the facades are lit; the climb then turns toward B.
function groundA(t: number, depart: number): GroundPose {
  if (t < TIMING.dollyEnd) {
    const u = t / TIMING.dollyEnd;
    const pos: Vec3 = [lerp(200, 130, u), 4.5, 3];
    return { pos, target: add(pos, scale(headingToGround(270, 5), 120)) };
  }
  const u = clamp01((t - TIMING.dollyEnd) / (TIMING.seam1 - TIMING.dollyEnd));
  const climb = Math.pow(u, 1.6);
  const altitude = 4.5 * Math.pow(2300 / 4.5, climb);
  const pos: Vec3 = [lerp(130, -90, u), altitude, lerp(3, 0, smooth(u))];
  // Crane straight up the avenue first; turn toward B only above the roofs.
  const heading = lerpAngle(270, depart, smooth((u - 0.5) / 0.5));
  const pitch = lerp(5, -78, smooth((u - 0.2) / 0.8));
  return { pos, target: add(pos, scale(headingToGround(heading, pitch), 200)) };
}

function groundB(t: number, arrive: number): GroundPose {
  if (t < TIMING.descendEnd) {
    const u = clamp01((t - TIMING.seam2) / (TIMING.descendEnd - TIMING.seam2));
    const fall = 1 - Math.pow(1 - u, 1.8);
    const altitude = 2100 * Math.pow(60 / 2100, fall);
    const pos: Vec3 = [lerp(-420, -300, u), altitude, 0];
    const heading = lerpAngle(arrive, 90, smooth(u));
    const pitch = lerp(-80, -18, smooth(u));
    return { pos, target: add(pos, scale(headingToGround(heading, pitch), 200)) };
  }
  const u = clamp01((t - TIMING.descendEnd) / (TIMING.end - TIMING.descendEnd));
  const pos: Vec3 = [lerp(-300, -150, u), lerp(60, 34, smooth(u)), 0];
  return { pos, target: add(pos, scale(headingToGround(90, lerp(-18, -10, smooth(u))), 200)) };
}

function globePose(t: number, nA: Vec3, nB: Vec3): GlobePose {
  const p = smooth((t - TIMING.seam1) / (TIMING.seam2 - TIMING.seam1));
  const lift = Math.sin(Math.PI * p);
  const altitudeKm = GLOBE_LOW_KM * Math.pow(GLOBE_PEAK_KM / GLOBE_LOW_KM, lift);
  const here = slerp(nA, nB, p);
  const lead = 0.06 + 0.4 * lift;
  const ahead = slerp(nA, nB, p + 0.001);
  return {
    pos: scale(here, 1 + altitudeKm / R_KM),
    target: slerp(nA, nB, p + lead),
    up: normalize([ahead[0] - here[0], ahead[1] - here[1], ahead[2] - here[2]]),
    altitudeKm,
  };
}

export function flightAt(t: number, a: ResolvedPlace, b: ResolvedPlace): FlightFrame {
  const course = travelCourse(a, b);
  const veil = veilAt(t);
  if (t < TIMING.seam1) {
    return { ground: { side: "a", pose: groundA(t, course.depart) }, globe: null, veil, utcMs: a.utcMs };
  }
  if (t >= TIMING.seam2) {
    return { ground: { side: "b", pose: groundB(t, course.arrive) }, globe: null, veil, utcMs: b.utcMs };
  }
  const p = smooth((t - TIMING.seam1) / (TIMING.seam2 - TIMING.seam1));
  return {
    ground: null,
    globe: globePose(t, course.nA, course.nB),
    veil,
    utcMs: lerp(a.utcMs, b.utcMs, p),
  };
}
