/**
 * Hook.tsx — the opening premise card ("What if gravity disappeared...").
 */
import { useCurrentFrame } from "remotion";
import * as React from "react";

interface HookProps {
  text: string;
  keywordHighlight?: string[];
  startFrame: number;
  endFrame: number;
}

export const Hook: React.FC<HookProps> = ({
  text,
  keywordHighlight = [],
  startFrame,
  endFrame,
}) => {
  const frame = useCurrentFrame();
  if (frame < startFrame || frame > endFrame) return null;

  const highlight = keywordHighlight.length
    ? new RegExp(keywordHighlight.join("|"), "i")
    : null;

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
          fontFamily: "system-ui, -apple-system, sans-serif",
          fontSize: 48,
          fontWeight: 900,
          color: "#ffffff",
          textAlign: "center",
          textTransform: "uppercase",
          lineHeight: 1.2,
          maxWidth: "90vw",
          textShadow: "0 3px 6px rgba(0,0,0,0.45)",
          letterSpacing: 0.2,
          paddingLeft: 40,
          paddingRight: 40,
        }}
        dangerouslySetInnerHTML={{
          __html: highlight
            ? text.replace(
                highlight,
                `<span style="color:#3b82f6;font-weight:900">$&</span>`,
              )
            : text,
        }}
      />
    </div>
  );
};
