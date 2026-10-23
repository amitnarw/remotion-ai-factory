/**
 * Hook.tsx — the opening premise card ("What if gravity disappeared...").
 * Same caption look as the captions; keyword highlighting uses React spans.
 * The size fits the text into at most 3 lines inside the safe area.
 */
import { useCurrentFrame, useVideoConfig } from "remotion";
import * as React from "react";
import "./fonts";
import { CaptionLook, FONT_STACKS, resolveCaptionStyle } from "../../generator/caption-style";
import { captionScale, centredTextMargin, fitFontSize, hookCentrePct, textOutline } from "../../generator/layout";

interface HookProps {
  text: string;
  keywordHighlight?: string[];
  startFrame: number;
  endFrame: number;
  style?: CaptionLook;
}

export const Hook: React.FC<HookProps> = ({ text, keywordHighlight = [], startFrame, endFrame, style }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  if (frame < startFrame || frame > endFrame) return null;

  const look = resolveCaptionStyle(style);
  const scale = captionScale(width, height);
  const margin = centredTextMargin(width, height);
  const boxWidth = width * (1 - 2 * margin);
  const shown = look.uppercase ? text.toUpperCase() : text;
  const fontSize = fitFontSize(shown, 52 * scale, boxWidth, 3);
  const centre = hookCentrePct(width, height);
  const keys = keywordHighlight.map((k) => k.toLowerCase()).filter(Boolean);
  const words = shown.split(/\s+/).filter(Boolean);

  return (
    <div
      style={{
        position: "absolute",
        // A band centred on the hook's height, as tall as the frame allows.
        top: `${centre - Math.min(centre, 100 - centre)}%`,
        bottom: `${100 - centre - Math.min(centre, 100 - centre)}%`,
        left: `${margin * 100}%`,
        right: `${margin * 100}%`,
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
          boxSizing: "border-box",
          maxWidth: "100%",
          fontFamily: FONT_STACKS[look.font],
          fontWeight: look.font === "archivo-black" ? 400 : 800,
          fontStyle: look.italic ? "italic" : "normal",
          fontSize,
          color: look.color,
          textAlign: "center",
          lineHeight: 1.18,
          textShadow: look.shadow ? textOutline(scale, "outline") : "none",
        }}
      >
        {words.map((word, i) => {
          const hit = keys.some((k) => word.toLowerCase().replace(/[^a-z0-9]/g, "").includes(k.replace(/[^a-z0-9]/g, "")));
          // A real space between words, so the line wraps between words (with
          // margins only, the browser saw one long word and split it anywhere).
          return (
            <React.Fragment key={`${i}-${word}`}>
              {i > 0 && " "}
              <span style={{ color: hit ? look.highlight : look.color, fontWeight: hit ? 900 : undefined }}>{word}</span>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
