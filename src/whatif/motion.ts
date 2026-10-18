/**
 * src/whatif/motion.ts — the motion-rule kit.
 *
 * Encodes the ten motion rules once so every video inherits them:
 *  - springs only (never linear tweens for entrances/exits),
 *  - entrances move 2–3 properties (opacity + transform),
 *  - staggered choreography via MOTION.stagger,
 *  - exits faster than entrances,
 *  - idle breathing = pure sin wave, no keyframes.
 *
 * Deterministic: uses remotion's spring()/interpolate()/random() only.
 */
import * as React from "react";
import {
  interpolate,
  spring,
  SpringConfig,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { MOTION } from "./theme";

/** Run a spring from a specific start frame (delay-aware transition). */
export function springAt(
  frame: number,
  start: number,
  config: SpringConfig,
  fps: number,
): number {
  return spring({
    frame: frame - start,
    fps,
    config,
    durationInFrames: undefined,
  });
}

export interface EntranceOptions {
  from: number;
  delay?: number;
  riseFrom?: number;
  scaleFrom?: number;
  config?: SpringConfig;
  rotateFrom?: number;
}

/**
 * PURE entrance style for a given frame — usable inside loops/maps (no hooks).
 * Rises, scales, rotates and fades with a spring.
 */
export function entranceStyle(
  frame: number,
  fps: number,
  options: EntranceOptions,
): React.CSSProperties {
  const {
    from,
    delay = 0,
    riseFrom = 48,
    scaleFrom = 0.92,
    config = MOTION.entrance,
    rotateFrom = 0,
  } = options;
  const start = from + delay;
  if (frame < start) {
    return { opacity: 0, pointerEvents: "none" };
  }
  const s = springAt(frame, start, config, fps);
  const y = interpolate(s, [0, 1], [riseFrom, 0]);
  const scale = interpolate(s, [0, 1], [scaleFrom, 1]);
  const rotate = rotateFrom ? interpolate(s, [0, 1], [rotateFrom, 0]) : 0;
  return {
    opacity: interpolate(s, [0, 0.55], [0, 1]),
    transform: `translateY(${y.toFixed(2)}px) scale(${scale.toFixed(4)})${
      rotate ? ` rotate(${rotate.toFixed(2)}deg)` : ""
    }`,
    willChange: "opacity, transform",
  };
}

/** Hook wrapper around entranceStyle for single elements. */
export function useEntrance(options: EntranceOptions): React.CSSProperties {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return entranceStyle(frame, fps, options);
}

export interface ExitOptions {
  from: number;
  durationFrames?: number;
  riseTo?: number;
  scaleTo?: number;
}

/**
 * PURE exit style: snappy fade-out that MOVES (exits faster than entrances).
 * Returns null before the exit window so entrances stay intact.
 */
export function exitStyle(
  frame: number,
  options: ExitOptions,
): React.CSSProperties | null {
  const {
    from,
    durationFrames = 11,
    riseTo = -26,
    scaleTo = 0.96,
  } = options;
  if (frame <= from) return null;
  const t = interpolate(frame, [from, from + durationFrames], [0, 1], {
    extrapolateRight: "clamp",
  });
  const y = t * riseTo;
  const scale = 1 + (scaleTo - 1) * t;
  return {
    opacity: 1 - t,
    transform: `translateY(${y.toFixed(1)}px) scale(${scale.toFixed(3)})`,
  };
}

/** Hook wrapper around exitStyle. */
export function useExit(options: ExitOptions): React.CSSProperties | null {
  const frame = useCurrentFrame();
  return exitStyle(frame, options);
}

/**
 * Idle breathing: sin wave over time, amplitude in px. Deterministic.
 */
export function breathe(
  frame: number,
  fps: number,
  amplitude: number = MOTION.breatheAmplitude,
  periodSec: number = MOTION.breathePeriod,
  phase: number = 0,
): number {
  return (
    Math.sin(((frame / fps + phase) / periodSec) * Math.PI * 2) * amplitude
  );
}

/** Float drift for weightless objects: layered sin waves + slow spin. */
export function floatDrift(
  frame: number,
  fps: number,
  seed = 0,
  amplitude = 14,
): { x: number; y: number; rotate: number } {
  const t = frame / fps;
  return {
    x: Math.sin((t + seed * 1.7) * 1.1) * amplitude,
    y: Math.sin((t + seed * 2.3) * 0.8) * amplitude * 0.8,
    rotate: Math.sin((t + seed * 3.1) * 0.6) * 7,
  };
}

/** Linear-ish camera drift helper (background layers only — continues forever). */
export function parallaxDrift(
  frame: number,
  fps: number,
  speed = 6,
): number {
  return frame * (speed / fps);
}

/**
 * Ken-Burns style slow push for full-frame scene containers.
 * Applies to whole scenes over their lifetime — subtle, no red herring motion.
 */
export function useScenePush(
  from: number,
  durationSec: number,
  pushTo = 1.06,
): React.CSSProperties {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = interpolate(
    frame,
    [from, from + durationSec * fps],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  // Ease-out for a push that decelerates instead of plodding linearly.
  const eased = 1 - Math.pow(1 - p, 2.2);
  const scale = 1 + (pushTo - 1) * eased;
  return {
    transform: `scale(${scale.toFixed(4)})`,
    willChange: "transform",
  };
}
