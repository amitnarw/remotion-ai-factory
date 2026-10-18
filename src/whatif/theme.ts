/**
 * src/whatif/theme.ts — single source of truth for the story-engine look.
 *
 * Every color, font, spacing value and motion preset the per-video
 * compositions use comes from here. No magic numbers in video files.
 */
import * as React from "react";
import type { SpringConfig } from "remotion";
import { staticFile } from "remotion";
import { loadFont } from "@remotion/fonts";

/**
 * Fonts load from LOCAL woff2 files (public/fonts/) — no network at render
 * time. loadFont() internally holds the frame until the font is ready, so
 * the first frame already renders with the real typefaces.
 */

const DISPLAY_FAMILY = "Archivo Black";
const TEXT_FAMILY = "Inter";

/** Only load fonts where they can load (render browser context). */
if (typeof document !== "undefined") {
  loadFont({
    family: DISPLAY_FAMILY,
    url: staticFile("fonts/archivo-black-latin-400-normal.woff2"),
    weight: "400",
  }).catch((e) => console.error("[fonts] Archivo Black failed:", e));

  for (const weight of ["400", "700", "800"] as const) {
    loadFont({
      family: TEXT_FAMILY,
      url: staticFile(`fonts/inter-latin-${weight}-normal.woff2`),
      weight,
    }).catch((e) => console.error(`[fonts] Inter ${weight} failed:`, e));
  }
}

export const FONTS = {
  /** Heavy grotesque display — hooks, big statements, numerals. */
  display: `${DISPLAY_FAMILY}, "Arial Black", "Segoe UI", sans-serif`,
  /** Workhorse UI text — captions, HUD labels. */
  text: `${TEXT_FAMILY}, "Segoe UI", system-ui, sans-serif`,
} as const;

/** Vertical 1080×1920 canvas geometry. */
export const CANVAS = {
  width: 1080,
  height: 1920,
  /** Content-safe horizontal padding. */
  sidePadding: 72,
  /** Baseline for the caption bar (from bottom). */
  captionBottom: 168,
  /** Baseline for the hook / big-type block center (from top). */
  hookCenter: 560,
} as const;

/**
 * Palettes. A scene picks one palette from the theme; videos never hardcode
 * colors outside these constants.
 */
export const PALETTES = {
  /** Dark tech void — the hook / opener world. */
  techVoid: {
    top: "#04070f",
    bottom: "#0a1230",
    glowA: "rgba(76,201,240,0.55)",
    glowB: "rgba(157,78,221,0.45)",
    grid: "rgba(120,170,255,0.28)",
    gridBright: "rgba(160,210,255,0.55)",
    accent: "#4cc9f0",
  },
  /** Warm room interior — the "normal life" world. */
  room: {
    wall: "#31304b",
    wallLight: "#4d4a72",
    floor: "#493659",
    floorLight: "#5c4570",
    window: "#8ecae6",
    windowGlow: "rgba(255,196,107,0.55)",
    accent: "#ffb703",
  },
  /** Purple night city — the chaos world. */
  cityNight: {
    skyTop: "#120a2e",
    skyMid: "#3b1160",
    skyBottom: "#6d28d9",
    building: "#160a2b",
    buildingFar: "#27114a",
    window: "#ffc46b",
    windowCool: "#7de0ff",
    moon: "#fff3d6",
    street: "#1d0f38",
    streetGlow: "rgba(255,164,91,0.35)",
  },
  /** Deep sky — floating / apex world. */
  sky: {
    top: "#101235",
    bottom: "#5a3fa8",
    cloud: "rgba(255,255,255,0.92)",
    cloudSoft: "rgba(255,255,255,0.35)",
    sun: "rgba(255,214,112,0.9)",
  },
} as const;

/** Shared semantic colors across palettes. */
export const COLORS = {
  ink: "#0b0b14",
  white: "#ffffff",
  /** Signature highlight yellow for typed statements. */
  highlight: "#ffd644",
  highlightDeep: "#ffb703",
  danger: "#ff5d5d",
  cool: "#4cc9f0",
  shadow: "rgba(4,4,12,0.45)",
} as const;

/**
 * Motion presets. Rules encoded here:
 *  - entrances are spring-driven (never linear, never instant),
 *  - stagger offsets between 3–6 frames,
 *  - exits are faster than entrances.
 */
export const MOTION = {
  /** Standard entrance spring — visible, lively, ~20 frames to settle. */
  entrance: { stiffness: 110, damping: 14, mass: 0.9, overshootClamping: false } as SpringConfig,
  /** Softer background drift spring — slow, cinematic. */
  drift: { stiffness: 26, damping: 22, mass: 1.4, overshootClamping: false } as SpringConfig,
  /** Exit spring — snappier (exits faster than entrances). */
  exit: { stiffness: 220, damping: 24, mass: 0.85, overshootClamping: false } as SpringConfig,
  /** Per-item stagger offset (3–6 frames) for choreographed groups. */
  stagger: 4,
  /** Idle breathing period, seconds. */
  breathePeriod: 3.2,
  /** Idle breathing amplitude, px at 1080 wide. */
  breatheAmplitude: 6,
} as const;

/** Two-decade-preserving text shadows for HUD text over busy scenes. */
export const TEXT_GLOW: React.CSSProperties = {
  textShadow: "0 2px 0 rgba(4,4,12,0.55), 0 12px 40px rgba(4,4,12,0.45)",
};

export type Palette = (typeof PALETTES)[keyof typeof PALETTES];
