/**
 * src/world/geo.ts
 *
 * Earth geometry and the sun, as pure functions.
 *
 * Globe frame (unit sphere, three.js y-up): north pole = +y, (lat 0, lon 0)
 * = +z, (lat 0, lon 90E) = +x.
 * Local ground frame (metres): x = east, y = up, z = south (so north = -z).
 */

export type Vec3 = [number, number, number];

const RAD = Math.PI / 180;
export const EARTH_RADIUS_M = 6_371_000;

export function latLonToUnit(lat: number, lon: number): Vec3 {
  const la = lat * RAD;
  const lo = lon * RAD;
  return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
}

export function unitToLatLon([x, y, z]: Vec3): { lat: number; lon: number } {
  return {
    lat: Math.asin(Math.max(-1, Math.min(1, y))) / RAD,
    lon: Math.atan2(x, z) / RAD,
  };
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function scale(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

/** Angle between two unit vectors (radians). */
export function angleBetween(a: Vec3, b: Vec3): number {
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
}

/** Great-circle interpolation between unit vectors. `t` may run past 0..1
 *  to continue along the same circle. */
export function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  const omega = angleBetween(a, b);
  if (omega < 1e-9) return a;
  const s = Math.sin(omega);
  const wa = Math.sin((1 - t) * omega) / s;
  const wb = Math.sin(t * omega) / s;
  return normalize([a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb]);
}

/** Initial compass bearing from A to B (degrees clockwise from north). */
export function bearing(latA: number, lonA: number, latB: number, lonB: number): number {
  const p1 = latA * RAD;
  const p2 = latB * RAD;
  const dl = (lonB - lonA) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) / RAD) % 360 + 360) % 360;
}

/** Where (lat, lon) lies in the ground frame of a place at (lat0, lon0):
 *  [x east, z south] in metres. Flat-earth approximation, fine within
 *  tens of kilometres. */
export function groundOffset(lat0: number, lon0: number, lat: number, lon: number): [number, number] {
  const mPerDegLat = 110_574;
  const mPerDegLon = 111_320 * Math.cos(lat0 * RAD);
  return [(lon - lon0) * mPerDegLon, -(lat - lat0) * mPerDegLat];
}

/** Local east and north unit vectors at a point on the globe. */
export function localAxes(n: Vec3): { east: Vec3; north: Vec3 } {
  const pole: Vec3 = [0, 1, 0];
  const east = Math.abs(n[1]) > 0.9999 ? ([1, 0, 0] as Vec3) : normalize(cross(pole, n));
  return { east, north: cross(n, east) };
}

/** Direction (in the ground frame: x east, y up, z south) for a compass
 *  heading and a pitch above the horizon, both in degrees. */
export function headingToGround(headingDeg: number, pitchDeg = 0): Vec3 {
  const h = headingDeg * RAD;
  const p = pitchDeg * RAD;
  return [Math.sin(h) * Math.cos(p), Math.sin(p), -Math.cos(h) * Math.cos(p)];
}

/* ------------------------------------------------------------------ */
/*  Time                                                               */
/* ------------------------------------------------------------------ */

/** UTC milliseconds for a local date ("2026-10-23"), local clock time
 *  ("09:15") and the place's UTC offset in hours. */
export function localToUtcMs(date: string, time: string, utcOffsetHours: number): number {
  const [y, mo, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return Date.UTC(y, mo - 1, d, hh, mm) - utcOffsetHours * 3_600_000;
}

function dayOfYear(utcMs: number): number {
  const d = new Date(utcMs);
  return Math.floor((utcMs - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000) + 1;
}

/* ------------------------------------------------------------------ */
/*  Sun (NOAA general solar position; accurate to about a degree)      */
/* ------------------------------------------------------------------ */

function solarTerms(utcMs: number) {
  const d = new Date(utcMs);
  const hours = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  const g = ((2 * Math.PI) / 365) * (dayOfYear(utcMs) - 1 + (hours - 12) / 24);
  const eqTimeMin =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  return { utcMinutes: hours * 60, eqTimeMin, decl };
}

export interface SunLocal {
  /** Degrees above the horizon (negative = below). */
  elevation: number;
  /** Compass azimuth, degrees clockwise from north. */
  azimuth: number;
  /** Unit vector toward the sun in the ground frame (x east, y up, z south). */
  dir: Vec3;
}

export function sunAt(utcMs: number, lat: number, lon: number): SunLocal {
  const { utcMinutes, eqTimeMin, decl } = solarTerms(utcMs);
  const trueSolarMin = utcMinutes + eqTimeMin + 4 * lon;
  const ha = (trueSolarMin / 4 - 180) * RAD;
  const la = lat * RAD;
  const east = -Math.cos(decl) * Math.sin(ha);
  const north = Math.cos(la) * Math.sin(decl) - Math.sin(la) * Math.cos(decl) * Math.cos(ha);
  const up = Math.sin(la) * Math.sin(decl) + Math.cos(la) * Math.cos(decl) * Math.cos(ha);
  return {
    elevation: Math.asin(Math.max(-1, Math.min(1, up))) / RAD,
    azimuth: ((Math.atan2(east, north) / RAD) % 360 + 360) % 360,
    dir: normalize([east, up, -north]),
  };
}

/** The point on Earth where the sun is straight overhead. */
export function subsolarPoint(utcMs: number): { lat: number; lon: number } {
  const { utcMinutes, eqTimeMin, decl } = solarTerms(utcMs);
  const lon = (720 - utcMinutes - eqTimeMin) / 4;
  return { lat: decl / RAD, lon: ((lon + 540) % 360) - 180 };
}

/* ------------------------------------------------------------------ */
/*  Season                                                             */
/* ------------------------------------------------------------------ */

export type Season = "spring" | "summer" | "autumn" | "winter" | "tropical";

/** Meteorological season for a latitude and month (1-12). Inside the
 *  tropics there is no temperate season. */
export function seasonAt(lat: number, month: number): Season {
  if (Math.abs(lat) < 23.5) return "tropical";
  const north: Season[] = ["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "autumn", "autumn", "autumn", "winter"];
  const s = north[(month - 1 + 12) % 12];
  if (lat >= 0) return s;
  return ({ winter: "summer", summer: "winter", spring: "autumn", autumn: "spring" } as const)[s as "winter"];
}
