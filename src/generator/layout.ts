/**
 * src/generator/layout.ts — where on-screen text and cards may go, per frame
 * shape. Shared by the captions, the hook card and the HUD cards, and by the
 * dashboard preview, so they all agree.
 *
 * Safe areas keep text clear of the UI the platforms draw over a video
 * (9:16 Shorts / TikTok / Reels: the top bar, the action rail on the right and
 * the title / description block at the bottom). Sizes are given for a frame
 * whose short side is 1080 px and scale with the real frame.
 */
import type { CaptionLook } from "./caption-style";

export type FrameShape = "portrait" | "square" | "landscape";

export function frameShape(width: number, height: number): FrameShape {
  if (height > width * 1.1) return "portrait";
  if (width > height * 1.1) return "landscape";
  return "square";
}

/** Distance from each edge that text and cards keep clear of, as fractions of the frame. */
export interface SafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const SAFE_AREA: Record<FrameShape, SafeArea> = {
  // Shorts/TikTok/Reels together (their published ad safe zones, 2025-2026):
  // top bar, the like/comment/share rail on the right, and the channel, title
  // and music block that covers the bottom ~35%.
  portrait: { top: 0.15, right: 0.178, bottom: 0.35, left: 0.111 },
  // Feed squares: a title-safe margin and room for the feed's controls.
  square: { top: 0.05, right: 0.05, bottom: 0.1, left: 0.05 },
  // Landscape: title-safe (90%) plus the player's controls at the bottom.
  landscape: { top: 0.05, right: 0.05, bottom: 0.12, left: 0.05 },
};

/** Px per "1080 px" design unit: the short side of the frame decides. */
function unit(width: number, height: number): number {
  return Math.min(width, height) / 1080;
}

/**
 * Caption text scale. Short-form captions are drawn at ~7.5% of the width on
 * 9:16 (the default 44 px look becomes ~81 px), ~6% on squares and ~3% on
 * landscape.
 */
export function captionScale(width: number, height: number): number {
  const boost: Record<FrameShape, number> = { portrait: 1.84, square: 1.47, landscape: 1.3 };
  return unit(width, height) * boost[frameShape(width, height)];
}

/** HUD card scale: cards are designed on a 1080-wide portrait frame. */
export function hudScale(width: number, height: number): number {
  // A 470-px counter card covers ~39% of a 9:16 width, ~27% of a square's
  // (it was ~45%) and ~20% of a landscape frame.
  const factor: Record<FrameShape, number> = { portrait: 0.9, square: 0.62, landscape: 0.8 };
  return unit(width, height) * factor[frameShape(width, height)];
}

/** Vertical centre of the caption block for each named position, in % of the frame height. */
const CAPTION_Y: Record<FrameShape, Record<CaptionLook["position"], number>> = {
  // "bottom" stops above the platform's title block (the safe edge is 65%).
  portrait: { top: 21, upper: 32, middle: 45, lower: 52, bottom: 58 },
  square: { top: 12, upper: 30, middle: 50, lower: 70, bottom: 80 },
  landscape: { top: 12, upper: 30, middle: 50, lower: 72, bottom: 81 },
};

export function captionCentrePct(position: CaptionLook["position"], width: number, height: number): number {
  return CAPTION_Y[frameShape(width, height)][position];
}

/** Vertical centre of the hook card, in % of the frame height: on 9:16, inside the safe band below the HUD cards. */
export function hookCentrePct(width: number, height: number): number {
  return frameShape(width, height) === "portrait" ? 42 : 50;
}

/** Side margin for centred text: the wider of the two safe sides, so centred text stays centred. */
export function centredTextMargin(width: number, height: number): number {
  const s = SAFE_AREA[frameShape(width, height)];
  return Math.max(s.left, s.right);
}

/**
 * Font size that fits `text` into at most `maxLines` lines of `boxWidth` px.
 * Bold caps average ~0.62 em per character (Inter 800 / Archivo Black).
 */
export function fitFontSize(text: string, preferred: number, boxWidth: number, maxLines: number): number {
  const chars = Math.max(1, text.length);
  const fits = (boxWidth * maxLines * 0.9) / (chars * 0.62);
  const longestWord = Math.max(1, ...text.split(/\s+/).map((w) => w.length));
  const wordFits = boxWidth / (longestWord * 0.66);
  return Math.max(12, Math.min(preferred, fits, wordFits));
}

/**
 * A readable outline for light text over a busy 3D picture: a thin dark
 * stroke all round plus a soft drop shadow. `px` is the frame's text scale.
 */
export function textOutline(px: number, strength: "outline" | "soft"): string {
  const drop = `0 ${3 * px}px ${10 * px}px rgba(0,0,0,0.5)`;
  if (strength === "soft") return `0 ${2 * px}px ${6 * px}px rgba(0,0,0,0.55), ${drop}`;
  const o = 2.4 * px;
  const d = o * 0.71;
  const ring = [
    [o, 0], [-o, 0], [0, o], [0, -o],
    [d, d], [-d, d], [d, -d], [-d, -d],
  ].map(([x, y]) => `${x.toFixed(2)}px ${y.toFixed(2)}px 0 rgba(0,0,0,0.85)`);
  return [...ring, drop].join(", ");
}
