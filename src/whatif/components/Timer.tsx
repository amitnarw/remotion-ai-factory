/**
 * Timer.tsx — circular countdown HUD.
 * A ring that drains while gigantic monospace-centered numbers count an event
 * window down (e.g. the 5 seconds gravity was off). Used by story videos.
 */
import * as React from "react";
import { useCurrentFrame } from "remotion";
import { COLORS, FONTS, TEXT_GLOW } from "../theme";
import { entranceStyle, exitStyle } from "../motion";

interface TimerProps {
  /** Seconds window. */
  from: number;
  to: number;
  /** Label under the timer, e.g. "GRAVITY OFF". */
  label?: string;
  /** Total countdown length, seconds (defaults to to - from). */
  totalSec?: number;
  fps: number;
  size?: number;
}

export const Timer: React.FC<TimerProps> = ({
  from,
  to,
  label,
  totalSec,
  fps,
  size = 300,
}) => {
  const frame = useCurrentFrame();
  const sec = frame / fps;
  if (sec < from || sec > to) return null;

  const total = totalSec ?? to - from;
  const remaining = Math.max(0, to - sec);
  const fraction = Math.min(1, Math.max(0, remaining / total));
  const display = `${Math.floor(remaining / 60)}:${String(
    Math.floor(remaining % 60),
  ).padStart(2, "0")}.${Math.floor((remaining % 1) * 10)}`;

  const R = size / 2 - 17;
  const CIRC = 2 * Math.PI * R;

  const enter = entranceStyle(frame, fps, {
    from: Math.floor(from * fps),
    scaleFrom: 0.55,
    riseFrom: 0,
  });
  const exit = exitStyle(frame, {
    from: Math.floor((to - 0.5) * fps),
    durationFrames: 8,
    scaleTo: 1.5,
  });

  const urgency = fraction < 0.34;

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: 300,
        transform: `translateX(-50%)`,
        zIndex: 45,
        pointerEvents: "none",
        ...enter,
        ...exit,
      }}
    >
      <div
        style={{
          width: size,
          height: size,
          position: "relative",
          filter: `drop-shadow(0 18px 40px rgba(4,4,12,0.5)) drop-shadow(0 0 26px ${
            urgency ? "rgba(255,93,93,0.4)" : "rgba(76,201,240,0.35)"
          })`,
        }}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <defs>
            <linearGradient id="timer-ring" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={urgency ? COLORS.danger : COLORS.cool} />
              <stop offset="100%" stopColor={COLORS.highlight} />
            </linearGradient>
          </defs>
          {/* track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={R}
            stroke="rgba(255,255,255,0.18)"
            strokeWidth={13}
            fill="none"
          />
          {/* progress */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={R}
            stroke="url(#timer-ring)"
            strokeWidth={13}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - fraction)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 2,
          }}
        >
          <div
            style={{
              fontFamily: FONTS.display,
              fontSize: size * 0.3,
              color: COLORS.white,
              ...TEXT_GLOW,
            }}
          >
            {display}
          </div>
          {label && (
            <div
              style={{
                fontFamily: FONTS.text,
                fontWeight: 800,
                fontSize: size * 0.093,
                letterSpacing: 5,
                color: COLORS.highlight,
                textTransform: "uppercase",
              }}
            >
              {label}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
