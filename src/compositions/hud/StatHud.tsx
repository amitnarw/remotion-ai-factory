/**
 * StatHud.tsx — the escalation stat panel from the "What If Fun facts"
 * reference: small caps title ("YOUR EYESIGHT"), huge value ("16×") and
 * an all-caps subline. The red EKG pulse with the BPM number is a device the
 * director can attach to the panel (optional `bpm` on every beat): it renders
 * only when every beat carries one — never a default decoration.
 *
 * Two looks, chosen by the caption look (HudLook, caption-style.ts): "text",
 * the reference channels' HUD drawn over the picture with no card (spaced
 * capitals label, big serif value, gold fact line, a thin EKG line) on the
 * left at mid-height; and "card", the white card in the top-left corner.
 *
 * Driven from spec.statPanel.beats; values/zoom/bpm blend toward the active
 * beat over ~0.9s so every escalation reads as a change happening on screen.
 */
import { useCurrentFrame, useVideoConfig } from "remotion";
import * as React from "react";
import "./fonts";
import type { StatPanelSpec } from "../../generator/spec.schema";
import { statIndexAt, statBpmAt, statSubAt, statUnitAt, statValueAt, statZoomAt } from "../../generator/statPanel";
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

/** One ECG-like pulse waveform cycle: baseline with P bump, QRS spike, T bump. */
function ecgY(phase: number): number {
  const p = ((phase % 1) + 1) % 1;
  // gaussian-ish helpers
  const g = (x: number, c: number, w: number): number => Math.exp(-((x - c) * (x - c)) / (2 * w * w));
  return 0.06 * g(p, 0.16, 0.03) - 0.05 * g(p, 0.3, 0.012) + 1 * g(p, 0.33, 0.02) - 0.22 * g(p, 0.38, 0.05) + 0.2 * g(p, 0.58, 0.08);
}

function pulsePath(bpm: number, width: number, height: number, scrollCycles: number): string {
  const cycles = Math.max(1, Math.round((bpm / 60) * 1.9));
  const points: string[] = [];
  const N = 72;
  for (let i = 0; i <= N; i++) {
    const x01 = i / N;
    const y = ecgY(x01 * cycles + scrollCycles);
    const px = x01 * width;
    const py = height - 5 - y * (height - 13);
    points.push(`${i === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`);
  }
  return points.join(" ");
}

/** Short enough for the card: 7 -> "7", 12.5 -> "12.5", 1048 -> "1,048", 1048576 -> "1.05M". */
export function formatStat(value: number): string {
  const compact = (v: number, suffix: string) => `${Number(v.toPrecision(3))}${suffix}`;
  if (value >= 1e9) return compact(value / 1e9, "B");
  if (value >= 1e6) return compact(value / 1e6, "M");
  if (value >= 10000) return compact(value / 1e3, "K");
  if (value >= 10) return Math.round(value).toLocaleString("en-US");
  return value.toFixed(1).replace(/\.0$/, "");
}

/**
 * The pulse/EKG row is the director's device: shown only when the panel's
 * beats carry an authored bpm (the always-on row was deleted per the intent
 * audit — nothing renders unless it was chosen).
 */
export function hasPulseRow(panel?: StatPanelSpec): boolean {
  return !!panel && panel.beats.length > 0 && panel.beats.every((b) => b.bpm != null);
}

interface StatHudProps {
  panel?: StatPanelSpec;
  fps?: number;
  /** Card or text over the picture (from the caption look). Omit for the card. */
  hud?: HudLook;
  /** 0..1: the flight's cloud veil, for the text HUD's dark glow (as the captions). */
  glow?: number;
  /** Text HUD: design px to move up (negative) from the column's base, e.g. above a timer. */
  offsetY?: number;
  /** Text HUD: design height of the whole HUD column (layout.ts hudStack). */
  column?: number;
  /** Text HUD: the hook title's frames; the column stands where the hook is, so it waits. */
  hook?: { from: number; to: number };
}

export const StatHud: React.FC<StatHudProps> = ({ panel, fps = 30, hud, glow = 0, offsetY = 0, column, hook }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = frame / fps;
  if (!panel) return null;

  const unit = statUnitAt(panel);
  const value = statValueAt(panel, t);
  const shown = formatStat(value);
  const sub = statSubAt(panel, t);
  const hasPulse = hasPulseRow(panel);
  const bpmAt = hasPulse ? statBpmAt(panel, t) : undefined;
  const bpm = bpmAt != null ? Math.round(bpmAt) : 0;
  const phase = bpmAt != null ? (frame / fps) * (bpmAt / 60) : 0;
  const idx = statIndexAt(panel, t);
  const beat = panel.beats[idx];
  const sinceBeat = Math.max(0, t - beat.t);
  const pop = sinceBeat < 0.35 ? 1 + (1 - sinceBeat / 0.35) * 0.08 : 1;
  const fade = sinceBeat < 0.3 ? sinceBeat / 0.3 : 1;

  if (hud?.kind === "text") {
    const opacity = clearOfHook(frame, hook);
    if (opacity <= 0) return null;
    const L = TEXT_HUD_LINE;
    const place = textHudPlacement(width, height, hud.caption, column ?? L.label + L.value + L.fact + (hasPulse ? L.pulse : 0));
    const text = `${shown}${unit}`;
    return (
      <div
        style={{
          position: "absolute",
          left: place.left,
          bottom: place.bottom,
          transform: `translateY(${offsetY * place.scale}px) scale(${place.scale})`,
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
          {panel.title}
        </div>
        <div
          style={{
            height: L.value,
            lineHeight: `${L.value}px`,
            fontFamily: hud.valueFont,
            fontSize: text.length <= 7 ? 98 : 82,
            fontWeight: 400,
            fontVariantNumeric: "lining-nums tabular-nums",
            transform: `scale(${pop})`,
            transformOrigin: "left center",
          }}
        >
          {text}
        </div>
        <div
          style={{
            height: L.fact,
            lineHeight: `${L.fact}px`,
            fontSize: 21,
            fontWeight: 800,
            letterSpacing: "0.12em",
            color: hud.accent,
            textTransform: "uppercase",
            opacity: fade,
          }}
        >
          {sub}
        </div>
        {hasPulse && (
          // The reference's EKG device: a red dot, the BPM figure and a thin red line, no card.
          <div style={{ height: L.pulse, display: "flex", alignItems: "center", gap: 12 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                background: "#e0342b",
                boxShadow: "0 1px 3px rgba(0,0,0,0.6)",
                opacity: 0.45 + 0.55 * Math.abs(Math.sin(phase * Math.PI)),
              }}
            />
            <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.1em", fontVariantNumeric: "tabular-nums", minWidth: 86 }}>
              {bpm} BPM
            </span>
            <svg
              width={250}
              height={34}
              viewBox="0 0 250 34"
              style={{
                display: "block",
                overflow: "visible",
                filter: `drop-shadow(0 1px 2px rgba(0,0,0,0.65))${glow > 0.01 ? ` drop-shadow(0 0 10px rgba(0,0,0,${(0.7 * glow).toFixed(3)}))` : ""}`,
              }}
            >
              <path d={pulsePath(bpm, 250, 34, phase)} stroke="#ff3b30" strokeWidth={2.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        // Designed on a 1080-wide portrait frame; scaled and kept inside the
        // safe area for each frame shape (src/generator/layout.ts).
        top: SAFE_AREA[frameShape(width, height)].top * height,
        left: SAFE_AREA[frameShape(width, height)].left * width,
        transform: `scale(${hudScale(width, height)})`,
        transformOrigin: "top left",
        width: 470,
        zIndex: 20,
        pointerEvents: "none",
        background: "rgba(255,255,255,0.94)",
        borderRadius: 26,
        padding: "26px 30px 22px 30px",
        boxShadow: "0 18px 44px rgba(10,16,32,0.22), 0 2px 0 rgba(255,255,255,0.65) inset",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <div
        style={{
          fontSize: 21,
          fontWeight: 900,
          letterSpacing: 2.2,
          color: "#e0342b",
          textTransform: "uppercase",
        }}
      >
        {panel.title}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 6,
          transform: `scale(${pop})`,
          transformOrigin: "left center",
        }}
      >
        <span
          style={{
            // Shrink with the text so long numbers stay inside the card.
            fontSize: shown.length + unit.length <= 3 ? 116 : shown.length + unit.length <= 5 ? 92 : 72,
            fontWeight: 900,
            color: "#101828",
            lineHeight: 1.02,
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
          }}
        >
          {shown}
          {unit}
        </span>
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 22,
          fontWeight: 800,
          letterSpacing: 1.1,
          color: "#101828",
          textTransform: "uppercase",
          opacity: fade,
          minHeight: 28,
        }}
      >
        {sub}
      </div>
      {hasPulse && (
        <>
          <div style={{ height: 2, background: "rgba(16,24,40,0.12)", margin: "16px 0 12px 0", borderRadius: 2 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span
                style={{
                  width: 11,
                  height: 11,
                  borderRadius: 6,
                  background: "#e0342b",
                  display: "inline-block",
                  opacity: 0.45 + 0.55 * Math.abs(Math.sin(phase * Math.PI)),
                }}
              />
              <span style={{ color: "#e0342b", fontSize: 15, fontWeight: 900, letterSpacing: 1.8, whiteSpace: "nowrap" }}>
                PULSE
              </span>
            </div>
            <svg width="100%" height="46" viewBox="0 0 246 46" style={{ flex: 1, display: "block" }}>
              <path
                d={pulsePath(bpm, 246, 46, phase)}
                stroke="#e11d48"
                strokeWidth={3.2}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div
              style={{
                fontSize: 26,
                fontWeight: 900,
                color: "#101828",
                fontVariantNumeric: "tabular-nums",
                minWidth: 74,
                textAlign: "right",
              }}
            >
              {bpm} BPM
            </div>
          </div>
        </>
      )}
    </div>
  );
};

/**
 * ZoomVignette — darkens the frame edges more as the stat zoom rises, giving
 * the "zoomed in on your eyes" feel of the reference.
 */
export const ZoomVignette: React.FC<{ panel?: StatPanelSpec; fps?: number }> = ({ panel, fps = 30 }) => {
  const frame = useCurrentFrame();
  const t = frame / fps;
  if (!panel) return null;
  const zoom = statZoomAt(panel, t);
  const a = Math.min(0.4, (Math.log2(zoom) / 5) * 0.4);
  if (a <= 0.001) return null;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 10,
        pointerEvents: "none",
        background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 42%, rgba(6,10,18,${a.toFixed(3)}) 100%)`,
      }}
    />
  );
};
