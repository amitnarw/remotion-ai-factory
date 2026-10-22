/**
 * Captions.tsx — the caption line(s) on screen. Position, font, colour, box and
 * entry animation all come from one resolved CaptionLook (see
 * src/generator/caption-style.ts). Keyword highlighting is drawn with React
 * spans, not injected HTML.
 */
import { useCurrentFrame, useVideoConfig } from "remotion";
import * as React from "react";
import "./fonts";
import {
  CaptionLook,
  FONT_STACKS,
  POSITION_PCT,
  hexToRgba,
  resolveCaptionStyle,
} from "../../generator/caption-style";

interface CaptionItem {
  text: string;
  sub?: string;
  from: number;
  to: number;
  keyword?: string[];
  /** "serif-italic" = the narration plate (serif, lowercase, italic) regardless of the chosen look. */
  style?: "bold" | "serif-italic";
}

interface CaptionsProps {
  captions: CaptionItem[];
  fps?: number;
  /** Resolved look. Omit for the default (bold pop). */
  style?: CaptionLook;
}

/** Ease-out with a small overshoot: a caption "pops" into place. */
function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

/** Split a line into words and mark the ones that contain a keyword. */
function markKeywords(text: string, keywords: string[] | undefined): Array<{ word: string; hit: boolean }> {
  const keys = (keywords ?? []).map((k) => k.toLowerCase()).filter(Boolean);
  return text.split(/\s+/).filter(Boolean).map((word) => ({
    word,
    hit: keys.some((k) => word.toLowerCase().replace(/[^a-z0-9]/g, "").includes(k.replace(/[^a-z0-9]/g, ""))),
  }));
}

export const Captions: React.FC<CaptionsProps> = ({ captions, fps = 30, style }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const seconds = frame / fps;
  const active = captions.find((c) => seconds >= c.from && seconds <= c.to);
  if (!active) return null;

  // Narration plates keep their own look; everything else uses the chosen style.
  const look: CaptionLook =
    active.style === "serif-italic"
      ? { ...resolveCaptionStyle(style), font: "serif", italic: true, uppercase: false, weight: 400 }
      : resolveCaptionStyle(style);

  const scale = width / 1080;
  const duration = Math.max(0.01, active.to - active.from);
  const local = Math.max(0, seconds - active.from);
  const enter = Math.min(1, local / 0.25);
  const words = markKeywords(look.uppercase ? active.text.toUpperCase() : active.text, active.keyword);

  // Entry animation. word-reveal spreads the caption's time evenly over its words
  // (real word timings come with voice timing in Phase 2).
  let blockOpacity = enter;
  let blockTransform = "translateY(-50%)";
  if (look.animation === "none") blockOpacity = 1;
  if (look.animation === "pop") blockTransform = `translateY(-50%) scale(${0.7 + 0.3 * easeOutBack(enter)})`;
  if (look.animation === "slide-up") blockTransform = `translateY(calc(-50% + ${(1 - enter) * 40 * scale}px))`;

  const wordVisible = (i: number) => {
    if (look.animation !== "word-reveal") return true;
    return local >= (i / Math.max(1, words.length)) * duration * 0.8;
  };

  const box =
    look.background === "none"
      ? {}
      : {
          background: hexToRgba(look.backgroundColor, look.backgroundOpacity),
          padding: `${10 * scale}px ${24 * scale}px`,
          borderRadius: look.background === "pill" ? 999 : 12 * scale,
        };

  return (
    <div
      style={{
        position: "absolute",
        top: `calc(${POSITION_PCT[look.position] + look.offsetPct}%)`,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        zIndex: 20,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          transform: blockTransform,
          opacity: blockOpacity,
          maxWidth: "92%",
          textAlign: "center",
          fontFamily: FONT_STACKS[look.font],
          fontWeight: look.font === "archivo-black" ? 400 : look.weight,
          fontStyle: look.italic ? "italic" : "normal",
          fontSize: look.size * scale,
          lineHeight: 1.2,
          color: look.color,
          letterSpacing: look.uppercase ? 0.5 : 0,
          textShadow: look.shadow ? `0 ${2 * scale}px ${6 * scale}px rgba(0,0,0,0.45)` : "none",
          ...box,
        }}
      >
        {words.map((w, i) => (
          <span
            key={`${i}-${w.word}`}
            style={{
              color: w.hit ? look.highlight : look.color,
              fontWeight: w.hit ? 900 : undefined,
              opacity: wordVisible(i) ? 1 : 0,
              marginRight: i < words.length - 1 ? "0.25em" : 0,
            }}
          >
            {w.word}
          </span>
        ))}
        {active.sub && (
          <div
            style={{
              marginTop: 8 * scale,
              fontSize: 20 * scale,
              color: look.color,
              opacity: 0.85,
              textTransform: look.uppercase ? "uppercase" : "none",
              letterSpacing: 0.3,
              fontWeight: 600,
            }}
          >
            {active.sub}
          </div>
        )}
      </div>
    </div>
  );
};
