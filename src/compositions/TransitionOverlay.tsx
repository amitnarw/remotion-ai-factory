/**
 * TransitionOverlay.tsx — scene-to-scene transitions drawn over the picture
 * (Phase 3; planned in src/generator/pipeline/transitions.ts).
 *
 * dip-black / dip-white: fade to a colour and back, peaking on the cut.
 * flash: a few white frames.
 * whip: the camera turns fast through the cut (whipYaw, used by ShotCamera)
 * and the picture blurs at the fastest moment (whipBlur, used on the canvas).
 * All of it is a pure function of the time, like the rest of the composition.
 */
import * as React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { SpecTransition } from "../generator/spec.schema";

/** The transition whose window contains t, and where t sits in it (-1 .. 1, 0 = the cut). */
export function transitionAt(transitions: SpecTransition[] | undefined, t: number): { tr: SpecTransition; x: number } | undefined {
  for (const tr of transitions ?? []) {
    const half = tr.dur / 2;
    if (t >= tr.t - half && t < tr.t + half) return { tr, x: (t - tr.t) / half };
  }
  return undefined;
}

const WHIP_DEG = 75;

/**
 * Extra yaw (radians) for a whip pan: the outgoing shot speeds up into the
 * turn, the incoming shot comes out of it and settles, so the motion reads as
 * one continuous swing to the right across the cut.
 */
export function whipYaw(transitions: SpecTransition[] | undefined, t: number): number {
  const at = transitionAt(transitions, t);
  if (!at || at.tr.type !== "whip") return 0;
  const deg = at.x < 0 ? -WHIP_DEG * Math.pow(1 + at.x, 3) : WHIP_DEG * Math.pow(1 - at.x, 3);
  return (deg * Math.PI) / 180;
}

/** Blur (px on a 1080 frame) for the fastest part of a whip. */
export function whipBlur(transitions: SpecTransition[] | undefined, t: number): number {
  const at = transitionAt(transitions, t);
  if (!at || at.tr.type !== "whip") return 0;
  return 22 * Math.pow(1 - Math.abs(at.x), 2);
}

const smooth = (x: number) => x * x * (3 - 2 * x);

export const TransitionOverlay: React.FC<{ transitions?: SpecTransition[] }> = ({ transitions }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const at = transitionAt(transitions, frame / (fps || 30));
  if (!at || at.tr.type === "whip") return null;
  const peak = smooth(1 - Math.abs(at.x));
  const style: React.CSSProperties = { position: "absolute", inset: 0, zIndex: 18, pointerEvents: "none" };
  if (at.tr.type === "flash") {
    // Bright on the cut, fading fast.
    return <div style={{ ...style, background: "#ffffff", opacity: 0.8 * Math.pow(peak, 1.5) }} />;
  }
  return <div style={{ ...style, background: at.tr.type === "dip-white" ? "#f8f5ef" : "#000000", opacity: peak }} />;
};
