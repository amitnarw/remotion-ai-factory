/**
 * depth-plan.ts — the pure timeline of the data film.
 *
 * No three.js, no DOM: this is the one place that decides what the number on
 * screen should read at a given second. The 3D stage and the HUD both read it,
 * and so does the demo spec when it writes its captions, so the picture, the
 * counter and the words can never drift apart.
 *
 * Scale: 1 unit = 50 m down to 1 000 m, then 1 unit = 250 m. The elbow is where
 * the film says so on screen.
 */

export interface DepthItem {
  label: string;
  value: number;
  unit?: string;
  note?: string;
  art?: string;
}

export interface DepthBlock {
  kind: string;
  title?: string;
  unit?: string;
  source?: string;
  items: DepthItem[];
}

/** Piecewise depth → world units (metres down are negative y). */
export function toWorld(depth: number): number {
  const d = Math.max(0, depth);
  if (d <= 1000) return d * 0.02;
  return 20 + (d - 1000) * 0.004;
}

export interface Stop {
  item: DepthItem;
  /** Seconds the camera lands on this depth. */
  at: number;
  /** The stop's window: it enters at `from` and the next descent starts at `to`. */
  from: number;
  to: number;
}

export interface DepthPlan {
  stops: Stop[];
  /** Depth in metres at time t. */
  depthAt: (t: number) => number;
  /** When the closing card appears. */
  closeAt: number;
  hookEnd: number;
  duration: number;
}

const HOOK = 3;
const CLOSE = 3;
/** How far into a stop's window the camera lands, as a fraction. */
const ARRIVE = 0.55;

/**
 * Stops are spread evenly between the hook and the close. The camera descends
 * to a stop's depth, holds it for the rest of the window (so the counter is
 * exactly the cited number while the caption is up), then falls to the next.
 */
export function depthPlan(block: DepthBlock, duration: number): DepthPlan {
  const items = [...block.items].sort((a, b) => a.value - b.value);
  const hookEnd = Math.min(HOOK, duration * 0.12);
  const closeAt = Math.max(hookEnd + 1, duration - CLOSE);
  const per = (closeAt - hookEnd) / Math.max(1, items.length);
  const stops: Stop[] = items.map((item, i) => {
    const from = hookEnd + i * per;
    return { item, from, to: from + per, at: from + per * ARRIVE };
  });

  const last = stops.length ? stops[stops.length - 1].item.value : 0;
  const timeline: [number, number][] = [
    [0, 0],
    [hookEnd, 0],
  ];
  for (const s of stops) {
    timeline.push([s.at, s.item.value]);
    timeline.push([s.to, s.item.value]);
  }
  if (!stops.length || closeAt > stops[stops.length - 1].to + 1e-6) timeline.push([closeAt, last]);
  timeline.push([duration, last]);

  const depthAt = (t: number) => keys(t, timeline);
  return { stops, depthAt, closeAt, hookEnd, duration };
}

/** A piecewise-linear key track, clamped at both ends. */
function keys(t: number, pts: [number, number][]): number {
  if (!pts.length) return 0;
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [t1, v1] = pts[i];
    if (t <= t1) {
      const [t0, v0] = pts[i - 1];
      const f = t1 === t0 ? 1 : (t - t0) / (t1 - t0);
      return v0 + (v1 - v0) * f;
    }
  }
  return pts[pts.length - 1][1];
}
