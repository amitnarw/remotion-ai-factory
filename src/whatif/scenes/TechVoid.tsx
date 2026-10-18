/**
 * TechVoid.tsx — the hook world: dark tech space with a drifting perspective
 * floor grid and floating glow rings. Pairs with GradientMesh(techVoid).
 */
import * as React from "react";
import { useCurrentFrame, useVideoConfig, random } from "remotion";
import { PALETTES } from "../theme";

export const TechVoid: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const P = PALETTES.techVoid;

  // Grid scroll: lines cycle through the interval so the floor stays alive.
  const LINE_COUNT = 11;

  const rings = [0, 1, 2].map((i) => {
    const seedX = random(`ring-x-${i}`) * 500 + 290;
    const baseY = 320 + i * 170 + random(`ring-y-${i}`) * 90;
    const y = baseY + Math.sin((t + i * 1.7) * 0.7) * 26;
    const w = 190 + i * 78;
    const squash = 0.32;
    return { x: seedX, y, w, squash, i };
  });

  const H_LINES = Array.from({ length: LINE_COUNT }).map((_, i) => i);

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", zIndex: 0 }}>
      {/* Perspective floor grid (lower half) */}
      <svg
        viewBox="0 0 1080 1920"
        preserveAspectRatio="none"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      >
        <defs>
          <linearGradient id="void-floor" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#050914" stopOpacity="0" />
            <stop offset="55%" stopColor="#0a1332" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#12245e" />
          </linearGradient>
        </defs>
        <rect x={0} y={920} width={1080} height={1000} fill="url(#void-floor)" />
        {/* Horizon-anchored converging verticals */}
        {[-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6].map((k) => {
          const spread = k * 220;
          return (
            <line
              key={k}
              x1={540}
              y1={930}
              x2={540 + spread * 2.6}
              y2={1920}
              stroke={P.grid}
              strokeWidth={2.5}
              opacity={0.6}
            />
          );
        })}
        {/* Horizontal lines: cycle 0..1 per line, perspective-eased */}
        {H_LINES.map((i) => {
          const phase =
            ((i / LINE_COUNT + t * 0.11) % 1 + 1) % 1;
          const p = Math.pow(phase, 2.6);
          const y = 946 + p * 974;
          const bright = Math.sin(phase * Math.PI) > 0.7;
          if (y > 1900) return null;
          return (
            <line
              key={i}
              x1={0}
              y1={y}
              x2={1080}
              y2={y}
              stroke={bright ? P.gridBright : P.grid}
              strokeWidth={bright ? 3.6 : 2}
              opacity={0.25 + p * 0.75}
            />
          );
        })}
      </svg>

      {/* Floating rings */}
      {rings.map((r) => (
        <React.Fragment key={r.i}>
          <div
            style={{
              position: "absolute",
              left: r.x,
              top: r.y,
              width: r.w,
              height: r.w * r.squash,
              borderRadius: "50%",
              border: `3px solid ${r.i % 2 === 0 ? P.accent : "rgba(157,78,221,0.65)"}`,
              boxShadow: `0 0 40px ${r.i % 2 === 0 ? "rgba(76,201,240,0.28)" : "rgba(157,78,221,0.3)"}`,
              transform: `translate(-50%,-50%) rotate(${Math.sin((t + r.i) * 0.5) * 8}deg)`,
              opacity: 0.8,
            }}
          />
        </React.Fragment>
      ))}
    </div>
  );
};
