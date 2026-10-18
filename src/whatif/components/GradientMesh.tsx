/**
 * GradientMesh.tsx — drifting multi-blob gradient background (layer 1).
 * Deterministic: positions derive from seeded random() + sin waves only.
 */
import * as React from "react";
import { useCurrentFrame, useVideoConfig, random } from "remotion";
import { PALETTES } from "../theme";

interface GradientMeshProps {
  /** Two-stop vertical base gradient. */
  top: string;
  bottom: string;
  /** Optional palette key to auto-pull glow colors. */
  glowA?: string;
  glowB?: string;
  seed?: number;
  /** Overall drift speed multiplier. */
  speed?: number;
}

export const GradientMesh: React.FC<GradientMeshProps> = ({
  top,
  bottom,
  glowA = "rgba(76,201,240,0.4)",
  glowB = "rgba(157,78,221,0.4)",
  seed = 0,
  speed = 1,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = (frame / fps) * speed;
  const n = 4;

  const blobs = Array.from({ length: n }).map((_, i) => {
    const sx = random(`gm-${seed}-x-${i}`);
    const sy = random(`gm-${seed}-y-${i}`);
    const r1 = random(`gm-${seed}-r-${i}`);
    const x = sx * 100 + Math.sin((t + sx * 9) * 0.22) * 22;
    const y = sy * 100 + Math.cos((t + sy * 6) * 0.17) * 18;
    const size = 55 + r1 * 30;
    const color = i % 2 === 0 ? glowA : glowB;
    return { x, y, size, color };
  });

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: `linear-gradient(180deg, ${top} 0%, ${bottom} 100%)`,
        overflow: "hidden",
      }}
    >
      {blobs.map((b, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${b.x}%`,
            top: `${b.y}%`,
            width: `${b.size}%`,
            aspectRatio: "1",
            borderRadius: "50%",
            background: `radial-gradient(circle, ${b.color} 0%, transparent 68%)`,
            transform: "translate(-50%, -50%)",
            filter: "blur(2px)",
          }}
        />
      ))}
    </div>
  );
};

/** Prebuilt palette presets for quick use. */
export const GradientPresets: Record<string, React.FC<{ seed?: number; speed?: number }>> =
  {
    techVoid: (p) => (
      <GradientMesh
        top={PALETTES.techVoid.top}
        bottom={PALETTES.techVoid.bottom}
        glowA={PALETTES.techVoid.glowA}
        glowB={PALETTES.techVoid.glowB}
        seed={p.seed ?? 3}
        speed={p.speed}
      />
    ),
    room: (p) => (
      <GradientMesh
        top={PALETTES.room.wall}
        bottom={PALETTES.room.floor}
        glowA="rgba(255,183,3,0.18)"
        glowB="rgba(142,202,230,0.14)"
        seed={p.seed ?? 11}
        speed={1.6}
      />
    ),
    sky: (p) => (
      <GradientMesh
        top={PALETTES.sky.top}
        bottom={PALETTES.sky.bottom}
        glowA="rgba(255,214,112,0.32)"
        glowB="rgba(157,78,221,0.5)"
        seed={p.seed ?? 7}
        speed={p.speed}
      />
    ),
  };
