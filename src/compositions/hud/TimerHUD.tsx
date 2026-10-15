/**
 * TimerHUD.tsx — the "TIME WITHOUT ___ 0:01.57" overlay seen on Atomic What If.
 * Driven entirely by useCurrentFrame so it stays locked to the simulation clock.
 */
import { useCurrentFrame } from "remotion";
import * as React from "react";
import { formatTimer } from "../../generator/timing";

interface TimerHUDProps {
  label: string;
  startFrame: number;
  endFrame: number;
}

export const TimerHUD: React.FC<TimerHUDProps> = ({
  label,
  startFrame,
  endFrame,
}) => {
  const frame = useCurrentFrame();
  const fps = 30;

  const active = frame >= startFrame && frame <= endFrame;

  if (!active) return null;

  const seconds = Math.max(0, (frame - startFrame) / fps);

  return (
    <div
      style={{
        position: "absolute",
        top: 72,
        left: 56,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 24,
        fontWeight: 800,
        color: "#1a2332",
        textShadow: "0 1px 0 rgba(255,255,255,0.6)",
        zIndex: 20,
        letterSpacing: 0.5,
      }}
    >
      <div style={{ color: "#f59e0b", fontSize: 16, marginBottom: 4 }}>
        {label.toUpperCase()}
      </div>
      <div style={{ fontSize: 40, lineHeight: 1 }}>
        {formatTimer(seconds)}
      </div>
    </div>
  );
};
