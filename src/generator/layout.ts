/**
 * src/generator/layout.ts — where on-screen text and cards may go, per frame
 * shape. Shared by the captions, the hook card and the HUD (cards or text over
 * the picture), and by the dashboard preview, so they all agree.
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

/**
 * The text HUD (the reference channels' look, quality-refs/): a label, a big
 * serif value and a fact line drawn over the picture, no card. Line heights in
 * px on a 1080-wide portrait frame; both HUDs use them, so a counter and a
 * timer can be stacked before they are drawn.
 */
export const TEXT_HUD_LINE = { label: 34, value: 106, fact: 32, pulse: 46, gap: 26 } as const;

/** Text HUD scale: designed on a 1080-wide portrait frame; a little smaller on squares and landscape. */
export function textHudScale(width: number, height: number): number {
  const factor: Record<FrameShape, number> = { portrait: 1, square: 0.84, landscape: 0.86 };
  return unit(width, height) * factor[frameShape(width, height)];
}

/**
 * Where the text HUD's column stands: its left edge (fraction of the width)
 * and the line its bottom sits on (fraction of the height). Mid-height on the
 * left like the references (they put it at ~43-50% on 9:16), just above a
 * two-line caption at the default "bottom" position, so a taller column (the
 * EKG row, a counter above a timer) grows upward, away from the captions.
 */
const TEXT_HUD_ANCHOR: Record<FrameShape, { left: number; base: number }> = {
  portrait: { left: SAFE_AREA.portrait.left, base: 0.505 },
  square: { left: 0.065, base: 0.6 },
  landscape: { left: 0.055, base: 0.6 },
};

/** The caption settings the text HUD keeps clear of. */
export type CaptionBlock = Pick<CaptionLook, "position" | "offsetPct" | "size">;

/**
 * Pixel placement of the text HUD column: `left` and `bottom` are px from the
 * frame's left and bottom edges, `scale` is px per design px. `column` is the
 * column's design height (see hudStack). If the column would overlap the
 * caption block (two lines of the caption look, plus a gap), it moves above
 * the captions, or below them when there is no room above.
 */
export function textHudPlacement(
  width: number,
  height: number,
  caption: CaptionBlock,
  column: number,
): { left: number; bottom: number; scale: number } {
  const shape = frameShape(width, height);
  const safe = SAFE_AREA[shape];
  const scale = textHudScale(width, height);
  const h = (column * scale) / height;
  const gap = 0.02;
  const half = (2 * caption.size * 1.2 * captionScale(width, height)) / 2 / height;
  const centre = (captionCentrePct(caption.position, width, height) + caption.offsetPct) / 100;
  const capTop = centre - half - gap;
  const capBottom = centre + half + gap;
  let base = TEXT_HUD_ANCHOR[shape].base;
  if (base > capTop && base - h < capBottom) {
    const below = capBottom + h;
    base = capTop - h >= safe.top || below > 1 - safe.bottom ? capTop : below;
  }
  return { left: TEXT_HUD_ANCHOR[shape].left * width, bottom: (1 - base) * height, scale };
}

/**
 * How the counter and the timer share the screen, in design px. Cards: the
 * timer card drops below the counter card (as before). Text: one column on
 * the anchor line; the timer sits at its bottom and the counter rises above.
 */
export function hudStack(
  kind: "text" | "card",
  has: { counter: boolean; pulse: boolean; timer: boolean },
): { counterOffsetY: number; timerOffsetY: number; column: number } {
  if (kind === "card") return { counterOffsetY: 0, timerOffsetY: has.counter ? 300 : 0, column: 0 };
  const L = TEXT_HUD_LINE;
  const counter = has.counter ? L.label + L.value + L.fact + (has.pulse ? L.pulse : 0) : 0;
  const timer = has.timer ? L.label + L.value : 0;
  const gap = has.counter && has.timer ? L.gap : 0;
  return { counterOffsetY: has.counter && has.timer ? -(timer + gap) : 0, timerOffsetY: 0, column: counter + gap + timer };
}

/**
 * Opacity of a text HUD while the hook title is up: 0 during the hook (used
 * when the column reaches the hook, see textHudMeetsHook), fading back in over
 * `fade` frames after it (and out over `fade` frames before a hook that
 * starts later).
 */
export function clearOfHook(frame: number, hook: { from: number; to: number } | undefined, fade = 8): number {
  if (!hook) return 1;
  if (frame >= hook.from && frame <= hook.to) return 0;
  if (frame > hook.to) return Math.min(1, (frame - hook.to) / fade);
  return Math.min(1, (hook.from - frame) / fade);
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

/**
 * Vertical centre of the hook title, in % of the frame height. With the text
 * HUD it sits high, as in the references (quality-refs/), so the HUD column
 * mid-left can show with it; with the cards it stays mid-frame (on 9:16,
 * inside the safe band below the cards).
 */
export function hookCentrePct(width: number, height: number, hud: "text" | "card" = "card"): number {
  const shape = frameShape(width, height);
  if (hud === "text") return HOOK_HIGH[shape];
  return shape === "portrait" ? 42 : 50;
}

/** The text-HUD hook's centre: a three-line hook stays inside the safe top. */
const HOOK_HIGH: Record<FrameShape, number> = { portrait: 25, square: 22, landscape: 20 };

/** The hook's largest size (Hook.tsx: 52 design px, at most 3 lines of 1.18). */
const HOOK_MAX = { size: 52, lines: 3, lineHeight: 1.18 } as const;

/**
 * Whether the text HUD column reaches the raised hook's band (its tallest,
 * three-line extent). Only then must the HUD wait for the hook; a single
 * counter or timer stands clear of it.
 */
export function textHudMeetsHook(width: number, height: number, caption: CaptionBlock, column: number): boolean {
  const hookHalf = (HOOK_MAX.size * captionScale(width, height) * HOOK_MAX.lines * HOOK_MAX.lineHeight) / 2 / height;
  const hookBottom = hookCentrePct(width, height, "text") / 100 + hookHalf;
  const place = textHudPlacement(width, height, caption, column);
  const columnTop = 1 - (place.bottom + column * place.scale) / height;
  return columnTop < hookBottom + 0.01;
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

/**
 * White and gold text vanishes into a white frame (a flight's cloud veil): a
 * wide dark glow, only while it is white. `glow` is 0..1, `px` the text scale.
 * Empty when there is no veil.
 */
export function veilGlow(px: number, glow: number): string {
  if (glow <= 0.01) return "";
  return `0 0 ${16 * px}px rgba(0,0,0,${(0.7 * glow).toFixed(3)}), 0 0 ${32 * px}px rgba(0,0,0,${(0.5 * glow).toFixed(3)})`;
}

/**
 * Shadow for the text HUD's white and gold lines, in design px (the HUD is
 * scaled as a block): a tight dark edge for the small capitals, the captions'
 * soft shadow, and the captions' veil glow while the frame turns white.
 */
export function textHudShadow(glow: number): string {
  return ["0 1px 2px rgba(0,0,0,0.7)", textOutline(1.3, "soft"), veilGlow(1.5, glow)].filter(Boolean).join(", ");
}
