/**
 * TimerHUD.tsx — the "TIME WITHOUT ___ 0:01.57" card seen on Atomic What If.
 * Driven entirely by useCurrentFrame so it stays locked to the simulation clock.
 * Drawn as a card like the counter (StatHud), so it reads over a bright sky or
 * a night scene, and scaled and placed per frame shape (src/generator/layout.ts).
 */
import { useCurrentFrame, useVideoConfig } from "remotion";
import * as React from "react";
import { formatTimer } from "../../generator/timing";
import { SAFE_AREA, frameShape, hudScale } from "../../generator/layout";

interface TimerHUDProps {
  label: string;
  startFrame: number;
  endFrame: number;
  fps?: number;
  /** Design px to move the card down, e.g. below a counter card. */
  offsetY?: number;
}

export const TimerHUD: React.FC<TimerHUDProps> = ({ label, startFrame, endFrame, fps = 30, offsetY = 0 }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  if (frame < startFrame || frame > endFrame) return null;

  const seconds = Math.max(0, (frame - startFrame) / fps);
  const safe = SAFE_AREA[frameShape(width, height)];
  const scale = hudScale(width, height);
  const enter = Math.min(1, (frame - startFrame) / 8);

  return (
    <div
      style={{
        position: "absolute",
        top: safe.top * height,
        left: safe.left * width,
        transform: `translateY(${offsetY * scale}px) scale(${scale * (0.92 + 0.08 * enter)})`,
        transformOrigin: "top left",
        opacity: enter,
        zIndex: 20,
        pointerEvents: "none",
        background: "rgba(255,255,255,0.94)",
        borderRadius: 26,
        padding: "22px 30px 18px 30px",
        minWidth: 330,
        boxShadow: "0 18px 44px rgba(10,16,32,0.22), 0 2px 0 rgba(255,255,255,0.65) inset",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <div style={{ fontSize: 21, fontWeight: 900, letterSpacing: 2.2, color: "#e0342b", textTransform: "uppercase" }}>
        {label}
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 84,
          fontWeight: 900,
          color: "#101828",
          lineHeight: 1.02,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        {formatTimer(seconds)}
      </div>
    </div>
  );
};
