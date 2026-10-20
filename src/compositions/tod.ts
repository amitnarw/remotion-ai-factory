/**
 * src/compositions/tod.ts — shared time-of-day interpolation utilities.
 *
 * Provides deterministic interpolation between two TOD look tables,
 * so stages can animate continuous time-of-day arcs (dawn -> noon -> dusk).
 */
import * as THREE from "three";

/** Generic linear interpolation for numbers. */
function lerpNum(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Linear interpolation for color strings (hex). */
function lerpColor(a: string, b: string, t: number): string {
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  const cr = lerpNum(ca.r, cb.r, t);
  const cg = lerpNum(ca.g, cb.g, t);
  const cb_ = lerpNum(ca.b, cb.b, t);
  return new THREE.Color(cr, cg, cb_).getHexString();
}

/** Interpolate a THREE.Vector3-like tuple. */
function lerpVec3(a: readonly [number, number, number], b: readonly [number, number, number], t: number): [number, number, number] {
  return [
    lerpNum(a[0], b[0], t),
    lerpNum(a[1], b[1], t),
    lerpNum(a[2], b[2], t),
  ];
}

/** Interpolate a color pair tuple (e.g., sky, hemi). */
function lerpColorPair(a: readonly [string, string], b: readonly [string, string], t: number): [string, string] {
  return [lerpColor(a[0], b[0], t), lerpColor(a[1], b[1], t)];
}

/** Type guard for numeric arrays of specific length. */
function isNumberArray(arr: unknown, len: number): arr is readonly number[] {
  return Array.isArray(arr) && arr.length === len && arr.every((v) => typeof v === "number");
}

/** Type guard for string arrays of specific length. */
function isStringArray(arr: unknown, len: number): arr is readonly string[] {
  return Array.isArray(arr) && arr.length === len && arr.every((v) => typeof v === "string");
}

/** Interpolate two TOD look objects.
 *  Both objects must have the same structure (matching keys).
 */
export function lerpTodLook<T extends Record<string, unknown>>(
  a: T,
  b: T,
  t: number
): T {
  const result = {} as T;
  const keys = Object.keys(a) as (keyof T)[];
  for (const key of keys) {
    const va = a[key];
    const vb = b[key];
    if (typeof va === "number" && typeof vb === "number") {
      result[key] = lerpNum(va, vb, t) as T[keyof T];
    } else if (isNumberArray(va, 3) && isNumberArray(vb, 3)) {
      const vecA = va as readonly [number, number, number];
      const vecB = vb as readonly [number, number, number];
      result[key] = lerpVec3(vecA, vecB, t) as T[keyof T];
    } else if (isStringArray(va, 2) && isStringArray(vb, 2)) {
      const strA = va as readonly [string, string];
      const strB = vb as readonly [string, string];
      result[key] = lerpColorPair(strA, strB, t) as T[keyof T];
    } else if (isNumberArray(va, 2) && isNumberArray(vb, 2)) {
      const vecA = va as readonly [number, number];
      const vecB = vb as readonly [number, number];
      result[key] = [lerpNum(vecA[0], vecB[0], t), lerpNum(vecA[1], vecB[1], t)] as T[keyof T];
    } else if (typeof va === "string" && typeof vb === "string") {
      result[key] = lerpColor(va, vb, t) as T[keyof T];
    } else {
      result[key] = t < 0.5 ? va : vb;
    }
  }
  return result;
}

/** TOD look table type. */
export interface TodLookTable {
  [tod: string]: Record<string, unknown>;
}

/** Time-of-day look configuration. */
export interface TodLook {
  sky: string;
  fogNear: number;
  fogFar: number;
  sun: [number, number, number];
  sunColor: string;
  sunIntensity: number;
  hemi: [string, string, number];
  ambient: number;
  rim: [string, number];
  cloudColor: string;
  cloudOpacity: number;
  lamps: number;
  stars: number;
  disc: "sun" | "moon" | null;
  discPos: [number, number, number];
  discColor: string;
}

/** Compute the TOD interpolation factor for a given scene time.
 *  Returns 0..1 where 0 = scene.from (start TOD), 1 = scene.to (end TOD).
 */
export function getTimeSpanFactor(
  sceneTime: number,
  sceneFrom: number,
  sceneTo: number,
  timeSpanDuration?: number
): number {
  const duration = timeSpanDuration ?? (sceneTo - sceneFrom);
  if (duration <= 0) return 0;
  return Math.min(1, Math.max(0, (sceneTime - sceneFrom) / duration));
}
 
/** Get the active TOD look for a scene at a given time, with optional timeSpan interpolation. */
export function getActiveTodLook(
  scene: { look?: { timeOfDay?: string; timeSpan?: { to: string; duration?: number } }; from?: number; to?: number },
  sceneFrom: number,
  sceneTo: number,
  currentTime: number,
  todTables: TodLookTable,
  defaultTod: string
): TodLook {
  const baseTod = scene.look?.timeOfDay ?? defaultTod;
  const timeSpan = scene.look?.timeSpan;

  if (!timeSpan) {
    return (todTables[baseTod] ?? todTables[defaultTod]) as unknown as TodLook;
  }

  const targetTod = timeSpan.to;
  const baseLook = todTables[baseTod] ?? todTables[defaultTod];
  const targetLook = todTables[targetTod] ?? todTables[defaultTod];

  const factor = getTimeSpanFactor(currentTime, sceneFrom, sceneTo, timeSpan.duration);
  return lerpTodLook(baseLook, targetLook, factor) as unknown as TodLook;
}