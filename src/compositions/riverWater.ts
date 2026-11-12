/**
 * src/compositions/riverWater.ts — the river's water over time (RiverStage):
 * the counter's level, and the director's water events (docs/factory/
 * 18-world-weather.md, "River water events"). Until 2026-11-04 the stage read
 * no world events, though the director offers them for a river and the
 * assembler keeps them (with their sound hits).
 *
 *  - water-rise: the river floods its banks: the level climbs RISE_M over
 *    RISE_S and the flood spreads over the valley floor (the stage draws a
 *    flood sheet just under the river while the level stands above the floor).
 *  - water-vanish: the river drains: the level falls under the channel's bed
 *    (DRAIN_M) over DRAIN_S, faster as it goes, the waterfall and its pool
 *    dry up (flow), the wet bed dries to silt.
 *  - water-return: back to the counter's level over RETURN_S, from a flood
 *    or a drain (rising back with a small settle, as the ocean does).
 *
 * Each event eases from where the water was toward its own level, and the
 * counter keeps moving the level underneath (a closed form: every event is a
 * blend over the one before), so a frame is a pure function of (spec, t).
 * The events are the video's, in time order, as OceanStage reads them: a
 * river after a drained world scene opens drained. Without water events the
 * level is the counter's alone, exactly as before.
 *
 * Plain imports only (no three.js, no React).
 */
import type { ShotSpec } from "../generator/spec.schema";
import { statScaleAt } from "../generator/statPanel";

/** The counter raises the river this much per step of its scale (metres). */
export const COUNTER_M = 0.3;
/** A water-rise floods the river this much over its level, metres, over RISE_S seconds. */
export const RISE_M = 1.5;
export const RISE_S = 2.5;
/** A water-vanish drains the river to this level, metres (the channel's bed
 *  lies at BED_Y, the waves reach 0.14 m above the mean), over DRAIN_S. */
export const DRAIN_M = 1.2;
export const DRAIN_S = 1.6;
/** A water-return brings it back over RETURN_S, with a settle of RETURN_SETTLE metres from a drain. */
export const RETURN_S = 1.8;
export const RETURN_SETTLE = 0.15;
/** The channel's bed, world y (RiverStage draws it there). */
export const BED_Y = -0.8;

/** The river at one moment. */
export interface RiverWater {
  /** The water's mean level, metres (0: bank-full, the valley floor at 0). */
  level: number;
  /** 0..1: how much river there is (1 flowing, 0 drained: the falls dry up). */
  flow: number;
  /** Whether the spec moves the water by events at all (else the stage draws as before). */
  events: boolean;
}

const WATER_EVENTS = new Set(["water-rise", "water-vanish", "water-return"]);

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (v: number) => {
  const x = clamp01(v);
  return x * x * (3 - 2 * x);
};

/** a toward b by k (0..1), exactly b at 1. */
const toward = (a: number, b: number, k: number) => (k >= 1 ? b : a + (b - a) * k);

/** Whether a spec has river water events. */
export function hasRiverEvents(spec: Pick<ShotSpec, "worldEvents">): boolean {
  return (spec.worldEvents ?? []).some((e) => WATER_EVENTS.has(e.name));
}

/** The counter's level at t (metres), as the stage always had it. */
function counterLevel(spec: Pick<ShotSpec, "statPanel">, t: number): number {
  const panel = spec.statPanel ?? null;
  return panel ? (statScaleAt(panel, t) - 1) * COUNTER_M : 0;
}

/**
 * The river's water at video time t. Build-free and pure: call it per frame
 * (the stage) or per sample (the camera's anchors).
 */
export function riverWaterAt(spec: Pick<ShotSpec, "statPanel" | "worldEvents">, t: number): RiverWater {
  const base = counterLevel(spec, t);
  if (!hasRiverEvents(spec)) return { level: base, flow: 1, events: false };
  const steps = (spec.worldEvents ?? [])
    .filter((e) => WATER_EVENTS.has(e.name) && Number.isFinite(e.t) && e.t <= t)
    .sort((a, b) => a.t - b.t);
  let level = base;
  for (const e of steps) {
    const u = t - e.t;
    if (e.name === "water-rise") level = toward(level, base + RISE_M, smooth(u / RISE_S));
    else if (e.name === "water-vanish") {
      // Draining: slow at first, then away.
      const f = clamp01(u / DRAIN_S);
      level = toward(level, -DRAIN_M, f * f);
    } else {
      const from = level;
      level = toward(from, base, smooth(u / RETURN_S));
      // Back up from under the bed: a little past, then settling.
      if (from < base && u < RETURN_S) level += RETURN_SETTLE * Math.sin(Math.PI * clamp01(u / RETURN_S));
    }
  }
  // The river is there while its surface stands over the bed.
  const flow = smooth((level - (BED_Y - 0.2)) / (0 - 0.2 - (BED_Y - 0.2)));
  return { level, flow, events: true };
}
