/**
 * Blob.tsx — the parametric cartoon character (2D vector, flat cel style).
 *
 * One character, many lives: head tone (dark/light), outfit colors, pose,
 * expression, breathing + blinking are all props. Poses are hand-tuned arm
 * and leg rotations driven by springs/sin — never keyframe tweens.
 *
 * Entrance/exit motion belongs to the PARENT (use yourEntrance here).
 */
import * as React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";

export type BlobPose =
  | "idle"
  | "walk"
  | "point"
  | "shrug"
  | "float"
  | "fall"
  | "land";
export type BlobExpression = "neutral" | "smile" | "wow" | "worry";
export type BlobHead = "dark" | "light";

export interface BlobProps {
  head?: BlobHead;
  /** Hoodie color. */
  body?: string;
  /** Pants color. */
  pants?: string;
  pose?: BlobPose;
  expression?: BlobExpression;
  /** Deterministic blink/personality seed. */
  seed?: number;
  /** Horizontal flip. */
  flip?: boolean;
  /** Walk cycle speed for the walk pose (steps/sec). */
  walkSpeed?: number;
  style?: React.CSSProperties;
  /** Overall size multiplier (design size is 220×320). */
  scale?: number;
}

const HEAD_COLORS: Record<BlobHead, { fill: string; rim: string; eye: string }> =
  {
    dark: { fill: "#151318", rim: "#2c2933", eye: "#ffffff" },
    light: { fill: "#f4ede2", rim: "#d8cfc0", eye: "#12121a" },
  };

export const Blob: React.FC<BlobProps> = ({
  head = "dark",
  body = "#2563eb",
  pants = "#1e293b",
  pose = "idle",
  expression = "neutral",
  seed = 1,
  flip = false,
  walkSpeed = 2.1,
  style,
  scale = 1,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const H = HEAD_COLORS[head];

  // --- Idle breathing (always on, tiny) -----------------------------------
  const breath = Math.sin(((t + seed * 0.7) / 3.2) * Math.PI * 2) * 3;

  // --- Blink (deterministic double-blink every ~3.4s) ---------------------
  const blinkPhase = (t + seed * 1.3) % 3.4;
  const blink =
    blinkPhase < 0.09 || (blinkPhase > 0.12 && blinkPhase < 0.17) ? 0.12 : 1;

  // --- Pose arithmetic ------------------------------------------------------
  let armL = 18; // degrees; 0 = hanging straight down, + = outward
  let armR = -18;
  let legL = 0;
  let legR = 0;
  let bodyTilt = 0;
  let bob = 0;

  switch (pose) {
    case "idle":
      armL = 24 + Math.sin((t / 2.6) * Math.PI * 2 + seed) * 3;
      armR = -24 - Math.sin((t / 2.6) * Math.PI * 2 + seed + 0.8) * 3;
      bob = breath * 0.6;
      break;
    case "walk": {
      const w = t * walkSpeed * Math.PI * 2;
      legL = Math.sin(w) * 26;
      legR = -Math.sin(w) * 26;
      armL = 30 + Math.sin(w + Math.PI) * 22;
      armR = -30 - Math.sin(w) * 22;
      bob = Math.abs(Math.sin(w * 2)) * -5;
      break;
    }
    case "point":
      armR = 128; // one arm thrust up-right
      armL = 14;
      bodyTilt = -3;
      break;
    case "shrug":
      armL = 84;
      armR = -84;
      bodyTilt = 2;
      break;
    case "float":
      armL = 138;
      armR = -132;
      legL = 14;
      legR = -20;
      bodyTilt = Math.sin((t / 2.4) * Math.PI * 2 + seed) * 7;
      bob = Math.sin((t / 3.1) * Math.PI * 2) * 7;
      break;
    case "fall":
      armL = 165 + Math.sin(t * 9) * 8;
      armR = -160 - Math.sin(t * 9 + 1) * 8;
      legL = 34;
      legR = -30;
      bodyTilt = Math.sin(t * 7) * 5;
      break;
    case "land":
      armL = -6;
      armR = 10;
      legL = 22;
      legR = 14;
      bob = 0;
      break;
  }

  const faceParts = (
    <>
      {/* Eyes */}
      {[-26, 26].map((ex, ei) => (
        <g
          key={ei}
          transform={`translate(0 ${H.eye === "#ffffff" ? 0 : 0})`}
        >
          <ellipse
            cx={110 + ex}
            cy={112}
            rx={7.5}
            ry={9 * blink}
            fill={H.eye}
          />
        </g>
      ))}
      {/* Brows for expression depth */}
      {(expression === "worry" || expression === "wow") &&
        [-26, 26].map((ex, ei) => (
          <g key={`brow-${ei}`}>
            <line
              x1={110 + ex - 12}
              y1={88 + (expression === "worry" ? (ei === 0 ? 0 : 5) : 0)}
              x2={110 + ex + 12}
              y2={86 + (expression === "worry" ? (ei === 0 ? 6 : 1) : -2)}
              stroke={H.eye}
              strokeWidth={4.5}
              strokeLinecap="round"
              opacity={0.9}
            />
          </g>
        ))}
      {/* Mouth */}
      {expression === "smile" && (
        <path
          d="M92 136 Q 110 152 128 136"
          stroke={H.eye}
          strokeWidth={6}
          fill="none"
          strokeLinecap="round"
        />
      )}
      {expression === "wow" && (
        <ellipse cx={110} cy={142} rx={12} ry={15} fill={H.eye} />
      )}
      {expression === "neutral" && (
        <line
          x1={99}
          y1={140}
          x2={121}
          y2={142}
          stroke={H.eye}
          strokeWidth={6}
          strokeLinecap="round"
        />
      )}
      {expression === "worry" && (
        <path
          d="M92 146 Q 104 136 116 146 L128 143"
          stroke={H.eye}
          strokeWidth={6}
          fill="none"
          strokeLinecap="round"
        />
      )}
    </>
  );

  return (
    <div
      style={{
        width: 220,
        height: 320,
        transform: `scale(${flip ? -scale : scale}, ${scale})`,
        transformOrigin: "center bottom",
        ...style,
        position: "absolute" as const,
      }}
    >
      <svg
        viewBox="0 0 220 320"
        style={{ width: "100%", height: "100%", overflow: "visible" }}
      >
        <g
          transform={`translate(0 ${bob}) rotate(${bodyTilt} 110 190)`}
          style={{ transformOrigin: "110px 190px" }}
        >
          {/* Legs */}
          <g transform={`translate(85 276) rotate(${legL})`}>
            <rect
              x={-9}
              y={0}
              width={18}
              height={44}
              rx={9}
              fill={pants}
            />
            <ellipse cx={0} cy={50} rx={15} ry={9} fill="#0e0e14" />
          </g>
          <g transform={`translate(135 276) rotate(${legR})`}>
            <rect x={-9} y={0} width={18} height={44} rx={9} fill={pants} />
            <ellipse cx={0} cy={50} rx={15} ry={9} fill="#0e0e14" />
          </g>

          {/* Hoodie body */}
          <path
            d={`M64 178
                Q 60 158 74 150
                L 146 150
                Q 160 158 156 178
                Q 158 232 150 280
                L 70 280
                Q 62 232 64 178 Z`}
            fill={body}
          />
          {/* Hood collar */}
          <ellipse cx={110} cy={158} rx={44} ry={16} fill={body} />
          <path
            d="M66 160 Q 110 186 154 160"
            stroke="rgba(0,0,0,0.28)"
            strokeWidth={7}
            fill="none"
            strokeLinecap="round"
          />
          {/* Body shading strip */}
          <path
            d="M132 156 Q 142 210 134 278"
            stroke="rgba(0,0,0,0.16)"
            strokeWidth={14}
            fill="none"
            strokeLinecap="round"
          />

          {/* Arms */}
          <g
            transform={`translate(66 176) rotate(${armL})`}
            strokeLinecap="round"
          >
            <rect
              x={-8}
              y={0}
              width={16}
              height={52}
              rx={8}
              fill={body}
              transform="translate(0 -8)"
            />
            <circle cx={0} cy={54} r={10} fill={H.fill} />
          </g>
          <g
            transform={`translate(154 176) rotate(${armR})`}
            strokeLinecap="round"
          >
            <rect
              x={-8}
              y={-8}
              width={16}
              height={52}
              rx={8}
              fill={body}
            />
            <circle cx={0} cy={54} r={10} fill={H.fill} />
          </g>

          {/* Head (blob) — slight squash breathing */}
          <g transform={`translate(110 122) scale(1 ${1 + breath * 0.0016}) translate(-110 -122)`}>
            <ellipse cx={110} cy={112} rx={62} ry={58} fill={H.fill} />
            <ellipse
              cx={110}
              cy={112}
              rx={62}
              ry={58}
              fill="none"
              stroke={H.rim}
              strokeWidth={5}
              opacity={0.55}
            />
            <ellipse
              cx={92}
              cy={92}
              rx={22}
              ry={16}
              fill="rgba(255,255,255,0.14)"
            />
            {faceParts}
          </g>
        </g>
      </svg>
    </div>
  );
};

/**
 * Small hand props the character can hold (mug, book, phone).
 * Positioned relative to the hand when pose=point or idle — anchors are
 * coarse; parents tune x/y.
 */
export const PropMug: React.FC<{ style?: React.CSSProperties }> = ({
  style,
}) => (
  <svg viewBox="0 0 60 50" style={{ width: 56, position: "absolute", ...style }}>
    <rect x={6} y={8} width={40} height={34} rx={8} fill="#e76f51" />
    <path
      d="M46 16 Q 58 18 56 27 Q 54 35 44 33"
      stroke="#e76f51"
      strokeWidth={7}
      fill="none"
    />
    <ellipse cx={26} cy={9} rx={19} ry={5} fill="#8b4a34" />
  </svg>
);
