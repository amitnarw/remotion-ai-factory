/**
 * StatHud.tsx — the escalation stat panel from the "What If Fun facts"
 * reference: small red caps title ("YOUR EYESIGHT"), huge value ("16×"),
 * all-caps subline, and a live red EKG pulse with the BPM number.
 *
 * Driven from spec.statPanel.beats; values/zoom/bpm blend toward the active
 * beat over ~0.9s so every escalation reads as a change happening on screen.
 */
import { useCurrentFrame } from "remotion";
import * as React from "react";
import type { StatPanelSpec } from "../../generator/spec.schema";
import { statIndexAt, statBpmAt, statSubAt, statUnitAt, statValueAt, statZoomAt } from "../../generator/statPanel";

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

export const StatHud: React.FC<{ panel?: StatPanelSpec; fps?: number }> = ({ panel, fps = 30 }) => {
  const frame = useCurrentFrame();
  const t = frame / fps;
  if (!panel) return null;

  const unit = statUnitAt(panel);
  const value = statValueAt(panel, t);
  const sub = statSubAt(panel, t);
  const bpm = Math.round(statBpmAt(panel, t));
  const idx = statIndexAt(panel, t);
  const beat = panel.beats[idx];
  const sinceBeat = Math.max(0, t - beat.t);
  const pop = sinceBeat < 0.35 ? 1 + (1 - sinceBeat / 0.35) * 0.08 : 1;
  const fade = sinceBeat < 0.3 ? sinceBeat / 0.3 : 1;

  const phase = (frame / fps) * (statBpmAt(panel, t) / 60);

  return (
    <div
      style={{
        position: "absolute",
        top: 96,
        left: 56,
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
            fontSize: value >= 100 ? 92 : 116,
            fontWeight: 900,
            color: "#101828",
            lineHeight: 1.02,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {value >= 10 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, "")}
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
