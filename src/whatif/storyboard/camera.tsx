/**
 * src/whatif/storyboard/camera.tsx — compiles storyboard camera language into
 * real per-frame transforms.
 *
 * The vocabulary matches the industry grammar the LLM writes (dolly/push-in,
 * pan/tilt/truck, crane, orbit, dutch, crash zoom, whip pan, handheld, rack
 * focus), and the emotional meanings are honored: push-in = intimacy,
 * pull-back = reveal, low angle = power, high angle = vulnerability,
 * crash-zoom = shock, dramatic moves reserved for apex beats (the renderer
 * just executes what the approved board says).
 */
import * as React from "react";
import {
  AbsoluteFill,
  random,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from "remotion";
import type { Beat } from "./schema";

/** Per-move transform effects. `p` = progress 0..1 through the beat. */
interface CameraEffect {
  scale: number; // extra zoom factor multiplier (1 = none)
  tx: number; // 0..1 of width
  ty: number; // 0..1 of height
  rotate: number; // degrees
  blur: number; // px
}

function effectFor(beat: Beat, p: number, frame: number, fps: number): CameraEffect {
  const i = beat.shot.intensity ?? 1;
  const ease = (from: number, to: number): number =>
    interpolate(p, [0, 1], [from, to], { easing: Easing.inOut(Easing.cubic) });
  switch (beat.shot.move) {
    case "static":
      return { scale: 1, tx: 0, ty: 0, rotate: 0, blur: 0 };
    case "push-in":
      return { scale: ease(1, 1 + 0.14 * i), tx: 0, ty: 0, rotate: 0, blur: 0 };
    case "pull-back":
      return { scale: ease(1 + 0.14 * i, 1), tx: 0, ty: 0, rotate: 0, blur: 0 };
    case "pan-left":
    case "truck-left":
      return { scale: 1 + 0.04 * i, tx: ease(0.05 * i, -0.05 * i), ty: 0, rotate: 0, blur: 0 };
    case "pan-right":
    case "truck-right":
      return { scale: 1 + 0.04 * i, tx: ease(-0.05 * i, 0.05 * i), ty: 0, rotate: 0, blur: 0 };
    case "tilt-up":
      return { scale: 1 + 0.03 * i, tx: 0, ty: ease(0.05 * i, -0.03 * i), rotate: 0, blur: 0 };
    case "tilt-down":
      return { scale: 1 + 0.03 * i, tx: 0, ty: ease(-0.05 * i, 0.03 * i), rotate: 0, blur: 0 };
    case "crane-up":
      return { scale: ease(1, 1 + 0.06 * i), tx: 0, ty: ease(0.06 * i, -0.04 * i), rotate: 0, blur: 0 };
    case "crane-down":
      return { scale: ease(1 + 0.06 * i, 1), tx: 0, ty: ease(-0.06 * i, 0.04 * i), rotate: 0, blur: 0 };
    case "orbit": {
      // Half-orbit feel: horizontal sweep with a gentle arc (no true 3D spin).
      const sweep = Math.sin(p * Math.PI);
      return { scale: 1 + 0.08 * i * sweep, tx: 0.09 * i * sweep * (i > 1 ? -1 : 1), ty: 0, rotate: 2 * sweep * i, blur: 0 };
    }
    case "dutch":
      return { scale: 1 + 0.05 * i, tx: 0, ty: 0, rotate: ease(-2.5 * i, 2.5 * i), blur: 0 };
    case "crash-zoom": {
      // Fast in the first 40%, then settle.
      const zoom = interpolate(Math.min(p, 0.4) / 0.4, [0, 1], [1, 1 + 0.32 * i], {
        easing: Easing.out(Easing.cubic),
      });
      return { scale: p < 0.4 ? zoom : 1 + 0.32 * i, tx: 0, ty: 0, rotate: 0, blur: p < 0.12 ? (0.12 - p) * 40 * i : 0 };
    }
    case "whip-pan": {
      // Violent lateral slide that settles with overshoot.
      const settle = interpolate(Math.min(p, 0.35) / 0.35, [0, 1], [0.28 * i, 0], {
        easing: Easing.out(Easing.cubic),
      });
      return { scale: 1 + 0.05 * i, tx: settle, ty: 0, rotate: 0, blur: settle > 0.03 ? settle * 55 : 0 };
    }
    case "handheld": {
      const n = (k: string, amp: number): number =>
        (random(`${k}-${beat.shot.move}-${Math.floor(frame / 2)}`) * 2 - 1) *
        amp *
        (0.85 + 0.15 * Math.sin((frame / fps) * 6.3));
      return {
        scale: 1 + 0.03 * i,
        tx: n("hx", 0.008 * i),
        ty: n("hy", 0.008 * i),
        rotate: n("hr", 0.5 * i),
        blur: 0,
      };
    }
    case "rack-focus":
      return { scale: 1 + 0.06 * i, tx: 0, ty: 0, rotate: 0, blur: ease(7 * i, 0) };
    default:
      return { scale: 1, tx: 0, ty: 0, rotate: 0, blur: 0 };
  }
}

/** Base scale per shot size (how close the framing sits). */
export function sizeScale(size: Beat["shot"]["size"]): number {
  switch (size) {
    case "establishing":
      return 1.0;
    case "wide":
      return 1.1;
    case "medium":
      return 1.26;
    case "cu":
      return 1.48;
    case "ecu":
      return 1.75;
  }
}

/**
 * Wraps the beat's scene in the camera move. Renders slightly larger than the
 * frame so pans/trucks never reveal edges; angle tweaks add a fixed tilt.
 */
export const CameraShot: React.FC<{
  beat: Beat;
  /** Beat length in frames. */
  durationInFrames: number;
  children: React.ReactNode;
}> = ({ beat, durationInFrames, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = Math.max(0, Math.min(1, frame / Math.max(1, durationInFrames - 1)));
  const fx = effectFor(beat, p, frame, fps);

  // Headroom so no combination can expose the edges.
  const base = sizeScale(beat.shot.size) * 1.18;

  const angleRotate =
    beat.shot.angle === "high"
      ? -6
      : beat.shot.angle === "low"
        ? 5
        : 0;

  return (
    <AbsoluteFill style={{ overflow: "visible", backgroundColor: "transparent" }}>
      <AbsoluteFill
        style={{
          transform: `scale(${base})`,
        }}
      >
        <AbsoluteFill
          style={{
            transform: `translate(${fx.tx * 100}%, ${fx.ty * 100}%) scale(${fx.scale}) rotate(${fx.rotate + angleRotate}deg)`,
            filter: fx.blur > 0.05 ? `blur(${fx.blur.toFixed(2)}px)` : undefined,
          }}
        >
          {children}
        </AbsoluteFill>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};