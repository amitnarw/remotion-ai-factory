/**
 * src/generator/statPanel.ts
 *
 * Interpolation helpers for the escalation stat panel (StatHud + StreetStage
 * camera zoom). All read from spec.statPanel so picture and HUD can never
 * disagree about the current value/zoom.
 */
import type { StatPanelSpec } from "./spec.schema";

const BEAT_BLEND = 0.9; // seconds to blend from the previous beat's value

function activeIndex(panel: StatPanelSpec, t: number): number {
  const beats = panel.beats;
  let idx = 0;
  for (let i = 0; i < beats.length; i++) {
    if (t >= beats[i].t) idx = i;
  }
  return idx;
}

function easeOut(x: number): number {
  return 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
}

/** Numeric value the HUD should show at time t (previous → current blend). */
export function statValueAt(panel: StatPanelSpec, t: number): number {
  const idx = activeIndex(panel, t);
  return parseFloat(panel.beats[idx].value);
}

/** Suffix unit string ("x" renders "16x"). */
export function statUnitAt(panel: StatPanelSpec): string {
  return panel.unit ?? "x";
}

/** Current subline of the active beat. */
export function statSubAt(panel: StatPanelSpec, t: number): string {
  return panel.beats[activeIndex(panel, t)].sub;
}

/** Camera zoom multiplier at time t (blended like the value). */
export function statZoomAt(panel: StatPanelSpec, t: number): number {
  const idx = activeIndex(panel, t);
  const cur = panel.beats[idx];
  if (idx === 0) return cur.zoom;
  const prev = panel.beats[idx - 1];
  const f = (t - cur.t) / BEAT_BLEND;
  if (f >= 1) return cur.zoom;
  return prev.zoom + (cur.zoom - prev.zoom) * easeOut(f);
}

/** Current pulse in BPM at time t: jumps on each beat, settled within 0.6s
 *  so the heartbeat audio/graphic follows the pop without lingering behind. */
export function statBpmAt(panel: StatPanelSpec, t: number): number {
  const idx = activeIndex(panel, t);
  const cur = panel.beats[idx];
  if (idx === 0) return cur.bpm;
  const prev = panel.beats[idx - 1];
  const f = (t - cur.t) / 0.6;
  if (f >= 1) return cur.bpm;
  return prev.bpm + (cur.bpm - prev.bpm) * easeOut(Math.min(1, Math.max(0, f)));
}

/** The beat index currently active (0 = base). */
export function statIndexAt(panel: StatPanelSpec, t: number): number {
  return activeIndex(panel, t);
}
