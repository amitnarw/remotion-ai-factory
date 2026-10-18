/**
 * CityNight.tsx — the purple night city: gradient sky, stars, moon,
 * two parallax building rows with deterministic lit windows, glowing street.
 * Pure backdrop — characters/objects overlay via the parent composition.
 */
import * as React from "react";
import { random } from "remotion";
import { PALETTES } from "../theme";

interface Building {
  x: number;
  w: number;
  h: number;
  windows: { x: number; y: number; s: number; warm: boolean }[];
  antenna?: boolean;
  rooftopBox?: boolean;
}

function makeRow(
  start: number,
  endWidth: number,
  yBase: number,
  minH: number,
  maxH: number,
  winDensity: number,
  seed: string,
  proseiy: number,
): Building[] {
  const out: Building[] = [];
  let x = start;
  let i = 0;
  while (x < endWidth) {
    const w = 130 + Math.floor(random(`${seed}-w-${i}`) * 150);
    const h = minH + random(`${seed}-h-${i}`) * (maxH - minH);
    const cols = Math.max(2, Math.floor(w / 58));
    const rows = Math.floor((h - 60) / proseiy);
    const windows: Building["windows"] = [];
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (random(`${seed}-win-${i}-${c}-${r}`) < winDensity) {
          windows.push({
            x: 14 + c * 52,
            y: 34 + r * proseiy,
            s: 16 + Math.floor(random(`${seed}-s-${i}-${c}-${r}`) * 12),
            warm: random(`${seed}-wc-${i}-${c}-${r}`) > 0.28,
          });
        }
      }
    }
    const ant = random(`${seed}-ant-${i}`) > 0.82;
    const boxh = random(`${seed}-box-${i}`) > 0.74;
    out.push({ x, w, h, windows, antenna: ant, rooftopBox: boxh });
    x += w + Math.floor(6 + random(`${seed}-gap-${i}`) * 26);
    i++;
  }
  return out;
}

const FAR = makeRow(-30, 1120, 940, 320, 640, 0.28, "city-far", 74);
const NEAR = makeRow(-60, 1160, 1040, 420, 780, 0.46, "city-near", 92);

export const CityNight: React.FC = () => {
  const P = PALETTES.cityNight;

  const stars = Array.from({ length: 70 }).map((_, i) => ({
    x: random(`star-${i}`) * 1080,
    y: random(`star-y-${i}`) * 800,
    r: 1 + random(`star-r-${i}`) * 2.2,
    o: 0.3 + random(`star-o-${i}`) * 0.7,
  }));

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <svg
        viewBox="0 0 1080 1920"
        preserveAspectRatio="none"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      >
        <defs>
          <linearGradient id="city-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={P.skyTop} />
            <stop offset="55%" stopColor={P.skyMid} />
            <stop offset="100%" stopColor={P.skyBottom} />
          </linearGradient>
          <radialGradient id="moon-glow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor={P.moon} stopOpacity="0.55" />
            <stop offset="100%" stopColor={P.moon} stopOpacity="0" />
          </radialGradient>
          <linearGradient id="city-street" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#241144" />
            <stop offset="100%" stopColor={P.street} />
          </linearGradient>
        </defs>

        {/* Sky */}
        <defs>
          <radialGradient id="glow-pool" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor="#ffb163" stopOpacity="0.5" />
            <stop offset="70%" stopColor="#ffb163" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#ffb163" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect x={0} y={0} width={1080} height={1240} fill="url(#city-sky)" />

        {/* Stars */}
        {stars.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#fff" opacity={s.o} />
        ))}

        {/* Moon */}
        <circle cx={852} cy={286} r={210} fill="url(#moon-glow)" />
        <circle cx={852} cy={286} r={64} fill={P.moon} />
        <circle cx={828} cy={266} r={11} fill="#d9c9a8" opacity={0.55} />
        <circle cx={874} cy={306} r={8} fill="#d9c9a8" opacity={0.4} />

        {/* Far row */}
        {FAR.map((b, i) => (
          <g key={`far-${i}`}>
            <rect x={b.x} y={940 - b.h} width={b.w} height={b.h} fill={P.buildingFar} />
            {b.windows.map((w, j) => (
              <rect
                key={j}
                x={b.x + w.x}
                y={940 - b.h + w.y}
                width={w.s}
                height={w.s}
                rx={3}
                fill={w.warm ? P.window : P.windowCool}
                opacity={0.5}
              />
            ))}
          </g>
        ))}

        {/* Near row */}
        {NEAR.map((b, i) => (
          <g key={`near-${i}`}>
            <rect x={b.x} y={1040 - b.h} width={b.w} height={b.h} fill={P.building} />
            {b.antenna && (
              <line
                x1={b.x + b.w / 2}
                y1={1040 - b.h}
                x2={b.x + b.w / 2}
                y2={1040 - b.h - 74}
                stroke={P.building}
                strokeWidth={7}
              />
            )}
            {b.antenna && (
              <circle
                cx={b.x + b.w / 2}
                cy={1040 - b.h - 78}
                r={7}
                fill={P.window}
                opacity={0.9}
              />
            )}
            {b.rooftopBox && (
              <rect
                x={b.x + b.w / 2 - 28}
                y={1040 - b.h - 40}
                width={56}
                height={40}
                fill={P.building}
              />
            )}
            {b.windows.map((w, j) => (
              <rect
                key={j}
                x={b.x + w.x}
                y={1040 - b.h + w.y}
                width={w.s}
                height={w.s}
                rx={3.5}
                fill={w.warm ? P.window : P.windowCool}
                opacity={0.85}
              />
            ))}
          </g>
        ))}

        {/* Street */}
        <rect x={0} y={1040} width={1080} height={880} fill="url(#city-street)" />
        {/* Street glow pools (light from windows, narrow + soft) */}
        <ellipse cx={240} cy={1110} rx={230} ry={30} fill="url(#glow-pool)" />
        <ellipse cx={700} cy={1140} rx={170} ry={24} fill="url(#glow-pool)" opacity={0.8} />
        <ellipse cx={1010} cy={1118} rx={140} ry={22} fill="url(#glow-pool)" opacity={0.7} />
        {/* Traffic dashes */}
        {[1180, 1260, 1350, 1460, 1580].map((dy, i) => (
          <g key={dy}>
            {Array.from({ length: 3 }).map((_, k) => (
              <rect
                key={k}
                x={60 + k * 380 + (i % 2) * 90}
                y={dy}
                width={86}
                height={12}
                rx={6}
                fill="#5d4090"
                opacity={0.5}
              />
            ))}
          </g>
        ))}
      </svg>
    </div>
  );
};
