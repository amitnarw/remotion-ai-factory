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

/**
 * How big the world should react at time t: the active beat's `scale` (1..16,
 * set by the assembler) or, for older specs without one, the value itself.
 * The HUD shows the value; the stages size things by this, so a value like
 * "1000000" can't blow the planet, ocean or street props out of the frame.
 */
export function statScaleAt(panel: StatPanelSpec, t: number): number {
  const beat = panel.beats[activeIndex(panel, t)];
  return beat.scale ?? statValueAt(panel, t);
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

/** BPM shown at t when the pulse device is in use, undefined when the panel
 *  has no authored bpm anywhere. Beats without a bpm hold the last chosen
 *  value, so a partial pulse choice still blends at the chosen beats. */
export function statBpmAt(panel: StatPanelSpec, t: number): number | undefined {
  if (!panel.beats.some((b) => b.bpm != null)) return undefined;
  const bpmFrom = (w: number): number => {
    for (let i = Math.min(w, panel.beats.length - 1); i >= 0; i--) {
      if (panel.beats[i].bpm != null) return panel.beats[i].bpm as number;
    }
    return panel.beats.find((b) => b.bpm != null)!.bpm as number;
  };
  const j = activeIndex(panel, t);
  const f = (t - panel.beats[j].t) / 0.6;
  if (f >= 1 || j === 0) return bpmFrom(j);
  const prev = bpmFrom(j - 1);
  return prev + (bpmFrom(j) - prev) * easeOut(Math.min(1, Math.max(0, f)));
}

/** The beat index currently active (0 = base). */
export function statIndexAt(panel: StatPanelSpec, t: number): number {
  return activeIndex(panel, t);
}
