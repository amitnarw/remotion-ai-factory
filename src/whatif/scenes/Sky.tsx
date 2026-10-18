/**
 * Sky.tsx — the floating-up world: deep sky gradient, sun glow, flat
 * drifting clouds. Soft, vertigo-flavored.
 */
import * as React from "react";
import { useCurrentFrame, useVideoConfig, random } from "remotion";
import { PALETTES } from "../theme";

interface Cloud {
  x: number;
  y: number;
  w: number;
  speed: number;
  soft: boolean;
}

export const Sky: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const P = PALETTES.sky;

  const clouds: Cloud[] = Array.from({ length: 6 }).map((_, i) => ({
    x: random(`cl-${i}`) * 1200 - 120,
    y: random(`cl-y-${i}`) * 1500 + 100,
    w: 260 + random(`cl-w-${i}`) * 420,
    speed: 7 + random(`cl-s-${i}`) * 14,
    soft: i % 2 === 0,
  }));

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(180deg, ${P.top} 0%, ${P.bottom} 100%)`,
        }}
      />
      {/* Sun glow */}
      <div
        style={{
          position: "absolute",
          left: -160,
          top: 210,
          width: 620,
          height: 620,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${P.sun} 0%, transparent 62%)`,
        }}
      />
      {/* Clouds drift upward slowly (we are falling/being lifted feel) */}
      {clouds.map((c, i) => {
        const cy = ((c.y - t * c.speed) % 2100 + 2100) % 2100 - 200;
        const cx = c.x + Math.sin((t + i * 2) * 0.2) * 20;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: cx,
              top: cy,
              width: c.w,
              height: c.w * 0.36,
              opacity: c.soft ? 0.35 : 0.92,
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                bottom: 0,
                width: "42%",
                height: "68%",
                borderRadius: "50% 50% 46% 46%",
                background: c.soft ? P.cloudSoft : P.cloud,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: "24%",
                bottom: 0,
                width: "52%",
                height: "100%",
                borderRadius: "50% 50% 44% 44%",
                background: c.soft ? P.cloudSoft : P.cloud,
              }}
            />
            <div
              style={{
                position: "absolute",
                right: 0,
                bottom: 0,
                width: "38%",
                height: "62%",
                borderRadius: "50% 50% 46% 46%",
                background: c.soft ? P.cloudSoft : P.cloud,
              }}
            />
          </div>
        );
      })}
    </div>
  );
};
