/**
 * Hook.tsx — the opening premise card ("What if gravity disappeared...").
 * Same caption look as the captions; keyword highlighting uses React spans.
 */
import { useCurrentFrame, useVideoConfig } from "remotion";
import * as React from "react";
import "./fonts";
import { CaptionLook, FONT_STACKS, resolveCaptionStyle } from "../../generator/caption-style";

interface HookProps {
  text: string;
  keywordHighlight?: string[];
  startFrame: number;
  endFrame: number;
  style?: CaptionLook;
}

export const Hook: React.FC<HookProps> = ({ text, keywordHighlight = [], startFrame, endFrame, style }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  if (frame < startFrame || frame > endFrame) return null;

  const look = resolveCaptionStyle(style);
  const scale = width / 1080;
  const keys = keywordHighlight.map((k) => k.toLowerCase()).filter(Boolean);
  const words = (look.uppercase ? text.toUpperCase() : text).split(/\s+/).filter(Boolean);

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 25,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          fontFamily: FONT_STACKS[look.font],
          fontWeight: look.font === "archivo-black" ? 400 : 800,
          fontStyle: look.italic ? "italic" : "normal",
          fontSize: 48 * scale,
          color: look.color,
          textAlign: "center",
          lineHeight: 1.2,
          maxWidth: "90%",
          textShadow: look.shadow ? `0 ${3 * scale}px ${6 * scale}px rgba(0,0,0,0.45)` : "none",
          padding: `0 ${40 * scale}px`,
        }}
      >
        {words.map((word, i) => {
          const hit = keys.some((k) => word.toLowerCase().replace(/[^a-z0-9]/g, "").includes(k.replace(/[^a-z0-9]/g, "")));
          return (
            <span key={`${i}-${word}`} style={{ color: hit ? look.highlight : look.color, fontWeight: hit ? 900 : undefined, marginRight: i < words.length - 1 ? "0.25em" : 0 }}>
              {word}
            </span>
          );
        })}
      </div>
    </div>
  );
};
