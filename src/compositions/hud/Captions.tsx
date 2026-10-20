/**
 * Captions.tsx — uppercase fact captions with a highlighted keyword.
 */
import { useCurrentFrame } from "remotion";
import * as React from "react";

interface CaptionItem {
  text: string;
  sub?: string;
  from: number;
  to: number;
  keyword?: string[];
  style?: "bold" | "serif-italic";
}

interface CaptionsProps {
  captions: CaptionItem[];
  fps?: number;
}

export const Captions: React.FC<CaptionsProps> = ({ captions, fps = 30 }) => {
  const frame = useCurrentFrame();
  const seconds = frame / fps;

  const active = captions.find((c) => seconds >= c.from && seconds <= c.to);

  if (!active) return null;

  // serif-italic: the reference's lowercase italic narration plate
  if (active.style === "serif-italic") {
    return (
      <div
        style={{
          position: "absolute",
          bottom: 600,
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
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontStyle: "italic",
            fontWeight: 600,
            fontSize: 46,
            color: "#ffffff",
            textAlign: "center",
            textShadow: "0 2px 10px rgba(0,0,0,0.45)",
            maxWidth: "88vw",
            lineHeight: 1.3,
          }}
        >
          {active.text}
        </div>
      </div>
    );
  }

  const highlight = active.keyword?.length
    ? new RegExp(active.keyword.join("|"), "i")
    : null;

  const renderText = (str: string) => {
    if (!highlight) return str;
    return str.replace(
      highlight,
      (m) => `<span style="color:#3b82f6;font-weight:700">${m}</span>`,
    );
  };

  return (
    <div
      style={{
        position: "absolute",
        bottom: 150,
        left: 0,
        right: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        zIndex: 20,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          fontFamily: "system-ui, -apple-system, sans-serif",
          fontSize: 44,
          fontWeight: 900,
          color: "#ffffff",
          textAlign: "center",
          textTransform: "uppercase",
          letterSpacing: 0.5,
          textShadow: "0 2px 4px rgba(0,0,0,0.35)",
          maxWidth: "92vw",
          lineHeight: 1.15,
        }}
        dangerouslySetInnerHTML={{ __html: renderText(active.text) }}
      />
      {active.sub && (
        <div
          style={{
            marginTop: 8,
            fontSize: 20,
            color: "#e2e8f0",
            textShadow: "0 1px 3px rgba(0,0,0,0.45)",
            textTransform: "uppercase",
            letterSpacing: 0.3,
            fontWeight: 600,
          }}
        >
          {renderText(active.sub)}
        </div>
      )}
    </div>
  );
};
