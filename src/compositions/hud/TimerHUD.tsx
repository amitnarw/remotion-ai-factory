/**
 * TimerHUD.tsx — the "TIME WITHOUT ___ 0:01.57" timer seen on Atomic What If.
 * Driven entirely by useCurrentFrame so it stays locked to the simulation clock.
 *
 * Two looks, chosen by the caption look (HudLook, caption-style.ts): "text",
 * the reference channels' HUD (a spaced-capitals label over a big serif time,
 * drawn over the picture with a soft shadow, no card) on the left at
 * mid-height; and "card", a white card like the counter's, so it reads over a
 * bright sky or a night scene. Both are scaled and placed per frame shape
 * (src/generator/layout.ts).
 */
import { useCurrentFrame, useVideoConfig } from "remotion";
import * as React from "react";
import "./fonts";
import { formatTimer } from "../../generator/timing";
import { FONT_STACKS, type HudLook } from "../../generator/caption-style";
import {
  SAFE_AREA,
  TEXT_HUD_LINE,
  clearOfHook,
  frameShape,
  hudScale,
  textHudPlacement,
  textHudShadow,
} from "../../generator/layout";

interface TimerHUDProps {
  label: string;
  startFrame: number;
  endFrame: number;
  fps?: number;
  /** Design px to move the HUD: cards down (e.g. below a counter card), text up from the column's base. */
  offsetY?: number;
  /** Card or text over the picture (from the caption look). Omit for the card. */
  hud?: HudLook;
  /** 0..1: the flight's cloud veil, for the text HUD's dark glow (as the captions). */
  glow?: number;
  /** Text HUD: design height of the whole HUD column (layout.ts hudStack). */
  column?: number;
  /** Text HUD: the hook title's frames; the column stands where the hook is, so it waits. */
  hook?: { from: number; to: number };
}

export const TimerHUD: React.FC<TimerHUDProps> = ({
  label,
  startFrame,
  endFrame,
  fps = 30,
  offsetY = 0,
  hud,
  glow = 0,
  column,
  hook,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  if (frame < startFrame || frame > endFrame) return null;

  const seconds = Math.max(0, (frame - startFrame) / fps);
  const enter = Math.min(1, (frame - startFrame) / 8);

  if (hud?.kind === "text") {
    const opacity = enter * clearOfHook(frame, hook);
    if (opacity <= 0) return null;
    const L = TEXT_HUD_LINE;
    const place = textHudPlacement(width, height, hud.caption, column ?? L.label + L.value);
    return (
      <div
        style={{
          position: "absolute",
          left: place.left,
          bottom: place.bottom,
          transform: `translateY(${offsetY * place.scale}px) scale(${place.scale * (0.96 + 0.04 * enter)})`,
          transformOrigin: "bottom left",
          opacity,
          zIndex: 20,
          pointerEvents: "none",
          color: "#ffffff",
          fontFamily: FONT_STACKS.inter,
          textShadow: textHudShadow(glow),
          whiteSpace: "nowrap",
        }}
      >
        <div
          style={{
            height: L.label,
            lineHeight: `${L.label}px`,
            fontSize: 25,
            fontWeight: 700,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          {label}
        </div>
        <div
          style={{
            height: L.value,
            lineHeight: `${L.value}px`,
            fontFamily: hud.valueFont,
            fontSize: 92,
            fontWeight: 400,
            fontVariantNumeric: "lining-nums tabular-nums",
          }}
        >
          {formatTimer(seconds)}
        </div>
      </div>
    );
  }

  const safe = SAFE_AREA[frameShape(width, height)];
  const scale = hudScale(width, height);

  return (
    <div
      style={{
        position: "absolute",
        top: safe.top * height,
        left: safe.left * width,
        transform: `translateY(${offsetY * scale}px) scale(${scale * (0.92 + 0.08 * enter)})`,
        transformOrigin: "top left",
        opacity: enter,
        zIndex: 20,
        pointerEvents: "none",
        background: "rgba(255,255,255,0.94)",
        borderRadius: 26,
        padding: "22px 30px 18px 30px",
        minWidth: 330,
        boxShadow: "0 18px 44px rgba(10,16,32,0.22), 0 2px 0 rgba(255,255,255,0.65) inset",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <div style={{ fontSize: 21, fontWeight: 900, letterSpacing: 2.2, color: "#e0342b", textTransform: "uppercase" }}>
        {label}
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 84,
          fontWeight: 900,
          color: "#101828",
          lineHeight: 1.02,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        {formatTimer(seconds)}
      </div>
    </div>
  );
};
