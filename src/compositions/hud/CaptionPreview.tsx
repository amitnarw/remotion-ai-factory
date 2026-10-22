/**
 * CaptionPreview.tsx — a still-life backdrop with one caption, for the
 * dashboard's live preview. Uses the exact same Captions component as the video.
 */
import { AbsoluteFill } from "remotion";
import * as React from "react";
import { Captions } from "./Captions";
import { CaptionStyleInput, resolveCaptionStyle } from "../../generator/caption-style";

export const CaptionPreview: React.FC<{ style: CaptionStyleInput; text: string; keyword?: string[] }> = ({
  style,
  text,
  keyword,
}) => (
  <AbsoluteFill style={{ background: "linear-gradient(170deg, #334155 0%, #0f172a 100%)" }}>
    <Captions
      captions={[{ text, from: 0, to: 1000, keyword }]}
      fps={30}
      style={resolveCaptionStyle(style)}
    />
  </AbsoluteFill>
);
