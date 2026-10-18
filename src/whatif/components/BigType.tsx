/**
 * BigType.tsx — the typographic statement block.
 *
 * Word-by-word spring entrance with ~2–4 frame word stagger (3–6 frame
 * choreography rule), highlight words in the signature yellow, static line
 * tilts for editorial energy, exits snap (faster than entrances).
 */
import * as React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, FONTS, MOTION, TEXT_GLOW } from "../theme";
import { breathe, entranceStyle, exitStyle } from "../motion";

export interface BigTypeLine {
  text: string;
  /** Words to render in yellow, case-insensitive. */
  highlight?: string[];
  /** Static tilt, degrees (defaults alternate ±1.5). */
  tilt?: number;
  /** Per-line size override (key words can go bigger). */
  size?: number;
}

interface BigTypeProps {
  lines: BigTypeLine[];
  from: number;
  /** Exit begins ~9 frames before this frame when provided. */
  to?: number;
  size?: number;
  /** Vertical position: "hook" (upper third) or "lower" (lower third). */
  position?: "hook" | "lower" | number;
  align?: "center" | "left";
}

/** Split a line into words, flagging highlight matches. */
function wordsOf(
  text: string,
  highlight: string[] | undefined,
): { w: string; hl: boolean }[] {
  const words = text.split(" ").filter(Boolean);
  if (!highlight?.length) return words.map((w) => ({ w, hl: false }));
  const hlSet = highlight.map((h) => h.toLowerCase());
  return words.map((w) => {
    const clean = w.toLowerCase().replace(/[^a-z0-9']/g, "");
    return { w, hl: hlSet.includes(clean) };
  });
}

function resolveTop(
  position: BigTypeProps["position"],
  size: number,
): number | undefined {
  if (typeof position === "number") return position;
  if (position === "lower") return undefined; // bottom-anchored flex end
  return size * 0.8; // hook position default
}

export const BigType: React.FC<BigTypeProps> = ({
  lines,
  from,
  to,
  size = 96,
  position = "hook",
  align = "center",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const exit = to !== undefined ? exitStyle(frame, { from: to - 9, durationFrames: 9, riseTo: -34, scaleTo: 0.97 }) : null;
  if (to !== undefined && frame >= to) return null;
  if (frame < from) return null;

  const breath = breathe(frame, fps, 2.4, 8.5);
  const top = resolveTop(position, size);
  const isLower = position === "lower";

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: isLower ? undefined : top,
        bottom: isLower ? CANVAS_BOTTOM_CAPTION_GAP(size) : undefined,
        display: "flex",
        flexDirection: "column",
        alignItems: align === "center" ? "center" : "flex-start",
        gap: Math.max(8, size * 0.1),
        paddingLeft: align === "center" ? 44 : 76,
        paddingRight: align === "center" ? 44 : 60,
        zIndex: 30,
        pointerEvents: "none",
        ...exit,
      }}
    >
      {lines.map((line, li) => {
        const tilt = line.tilt ?? (li % 2 === 0 ? -1.5 : 1.6);
        return (
          <div
            key={li}
            style={{
              fontFamily: FONTS.display,
              fontSize: line.size ?? size,
              lineHeight: 1.02,
              color: COLORS.white,
              letterSpacing: 0.5,
              textAlign: align === "center" ? "center" : "left",
              transform: `rotate(${tilt}deg) translateY(${(breath * (li % 2 === 0 ? 1 : -0.7)).toFixed(1)}px)`,
            }}
          >
            {wordsOf(line.text, line.highlight).map((item, wi) => {
              const delay = li * MOTION.stagger * 2 + wi * 2.4;
              const style = entranceStyle(frame, fps, {
                from,
                delay,
                riseFrom: 54,
                scaleFrom: 0.86,
                rotateFrom: tilt > 0 ? -3 : 3,
              });
              if (item.hl) {
                return (
                  <span
                    key={wi}
                    style={{
                      ...spanBase(size),
                      ...style,
                      color: COLORS.highlight,
                    }}
                  >
                    {item.w}
                  </span>
                );
              }
              return (
                <span key={wi} style={{ ...spanBase(size), ...style }}>
                  {item.w}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};

/** Marginal space reserved above the caption zone for lower-position type. */
function CANVAS_BOTTOM_CAPTION_GAP(size: number): number {
  return 320 + size * 0.1;
}

function spanBase(size: number): React.CSSProperties {
  return {
    fontFamily: FONTS.display,
    display: "inline-block",
    marginRight: size * 0.22,
    textShadow: TEXT_GLOW.textShadow,
  };
}

/** Convenience: one-line giant statement. */
export const BigStatement: React.FC<{
  text: string;
  highlight?: string[];
  from: number;
  to?: number;
  size?: number;
  position?: BigTypeProps["position"];
}> = ({ text, highlight, from, to, size, position }) => (
  <BigType
    lines={[{ text, highlight }]}
    from={from}
    to={to}
    size={size}
    position={position}
  />
);
