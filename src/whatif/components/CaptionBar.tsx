/**
 * CaptionBar.tsx — the narration zone (bottom).
 *
 * Works with or without voice tracks: cues are time-boxed text with optional
 * yellow keywords. Text pops in with a small spring rise and cross-fades out.
 * This is where characters "speak" when a video has no audio narration, or
 * reinforces it when it does.
 */
import * as React from "react";
import { useCurrentFrame } from "remotion";
import { CANVAS, COLORS, FONTS, TEXT_GLOW } from "../theme";
import { entranceStyle, exitStyle } from "../motion";

export interface CaptionCue {
  text: string;
  /** Seconds. */
  from: number;
  to: number;
  highlight?: string[];
}

interface CaptionBarProps {
  cues: CaptionCue[];
  fps: number;
  durationSec: number;
  size?: number;
}

function markedWords(text: string, highlight?: string[]) {
  if (!highlight?.length) return [{ w: text, hl: false }];
  const hlSet = highlight.map((h) => h.toLowerCase());
  return text.split(" ").map((w) => {
    const clean = w.toLowerCase().replace(/[^a-z0-9']/g, "");
    return { w, hl: hlSet.includes(clean) };
  });
}

export const CaptionBar: React.FC<CaptionBarProps> = ({
  cues,
  fps,
  durationSec,
  size = 46,
}) => {
  const frame = useCurrentFrame();
  const sec = frame / fps;

  const active = cues.find((c) => sec >= c.from && sec < c.to);
  if (!active) return null;

  const startF = active.from * fps;
  const endF = active.to * fps;
  const enter = entranceStyle(frame, fps, {
    from: startF,
    riseFrom: 20,
    scaleFrom: 0.985,
  });
  // Hold the cue readable until the last ~5 frames, then snap out.
  const exit = exitStyle(frame, {
    from: Math.max(startF + 4, Math.floor(endF) - 5),
    durationFrames: 5,
    riseTo: -10,
    scaleTo: 0.995,
  });
  if (frame >= Math.floor(endF)) return null;
  if (sec > durationSec - 0.05) return null;

  return (
    <div
      style={{
        position: "absolute",
        left: CANVAS.sidePadding,
        right: CANVAS.sidePadding,
        bottom: CANVAS.captionBottom,
        display: "flex",
        justifyContent: "center",
        zIndex: 40,
        ...enter,
        ...exit,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          fontFamily: FONTS.text,
          fontWeight: 800,
          color: COLORS.white,
          ...TEXT_GLOW,
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: size * 0.26,
            rowGap: size * 0.18,
            background: "rgba(6,4,16,0.34)",
            borderRadius: 22,
            padding: "16px 30px",
            backdropFilter: "blur(2px)",
          }}
        >
          {markedWords(active.text, active.highlight).map((item, i) => (
            <span
              key={`${active.text}-${i}`}
              style={{
                fontSize: size,
                lineHeight: 1.25,
                color: item.hl ? COLORS.highlight : COLORS.white,
              }}
            >
              {item.w}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

/** A comic-style speech bubble anchored to a character, for dialog scenes. */
export const SpeechBubble: React.FC<{
  text: string;
  highlight?: string[];
  from: number;
  to: number;
  fps: number;
  /** Anchor: character position in px on the canvas. */
  x: number;
  y: number;
  /** Bubble grows above the anchor when true. */
  above?: boolean;
  size?: number;
}> = ({ text, highlight, from, to, fps, x, y, above = true, size = 40 }) => {
  const frame = useCurrentFrame();
  if (frame < from || frame > to) return null;
  const enter = entranceStyle(frame, fps, {
    from,
    scaleFrom: 0.6,
    riseFrom: above ? 18 : -18,
  });
  const words = markedWords(text, highlight);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: `translate(-50%, ${above ? "-100%" : "0%"})`,
        zIndex: 42,
        ...enter,
      }}
    >
      <div
        style={{
          background: COLORS.white,
          borderRadius: 28,
          padding: `22px 30px`,
          maxWidth: 560,
          boxShadow: "0 14px 40px rgba(4,4,12,0.35)",
          position: "relative",
        }}
      >
        <div
          style={{
            fontFamily: FONTS.text,
            fontWeight: 800,
            fontSize: size,
            lineHeight: 1.3,
            color: COLORS.ink,
            display: "flex",
            flexWrap: "wrap",
            gap: size * 0.24,
          }}
        >
          {words.map((w, i) => (
            <span key={i} style={{ color: w.hl ? "#c2410c" : COLORS.ink }}>
              {w.w}
            </span>
          ))}
        </div>
        {/* tail */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: above ? undefined : -12,
            top: above ? -12 : undefined,
            marginLeft: -12,
            width: 24,
            height: 24,
            background: COLORS.white,
            transform: `rotate(${above ? 45 : 225}deg)`,
            borderRadius: 4,
          }}
        />
      </div>
    </div>
  );
};
