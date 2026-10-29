/**
 * src/generator/caption-style.ts
 *
 * Caption look: presets, the user's overrides, and the resolved style every
 * caption and hook is drawn with. Shared by the composition, the dashboard
 * (live preview and controls) and the spec validator, so they agree.
 *
 * Only fonts in public/fonts are offered. They ship with the project, so a
 * render looks the same on every machine.
 */
import { z } from "zod";

export const CAPTION_PRESET_NAMES = [
  "reference",
  "bold-pop",
  "clean",
  "documentary",
  "neon",
  "minimal",
] as const;
export const CAPTION_POSITIONS = ["top", "upper", "middle", "lower", "bottom"] as const;
export const CAPTION_FONTS = [
  "inter",
  "montserrat",
  "poppins",
  "bebas-neue",
  "anton",
  "oswald",
  "playfair-display",
  "merriweather",
  "lora",
  "nunito",
  "roboto-condensed",
  "archivo-black",
  "serif",
] as const;
export const CAPTION_ANIMATIONS = ["none", "fade", "pop", "slide-up", "word-reveal"] as const;
export const CAPTION_BACKGROUNDS = ["none", "box", "pill"] as const;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "a colour like #ffffff");

/** Every visual setting of a caption. Presets fill all of them. */
export interface CaptionLook {
  position: (typeof CAPTION_POSITIONS)[number];
  /** Nudge the block up (negative) or down (positive), as a % of frame height. */
  offsetPct: number;
  font: (typeof CAPTION_FONTS)[number];
  weight: 400 | 700 | 800;
  italic: boolean;
  /** Size in px on a 1080-wide frame; scales with the actual frame width. */
  size: number;
  uppercase: boolean;
  color: string;
  highlight: string;
  shadow: boolean;
  background: (typeof CAPTION_BACKGROUNDS)[number];
  backgroundColor: string;
  backgroundOpacity: number;
  animation: (typeof CAPTION_ANIMATIONS)[number];
}

/** What the user may send. Every field is optional; the preset fills the rest. */
export const CaptionStyleSchema = z.object({
  preset: z.enum(CAPTION_PRESET_NAMES).optional(),
  position: z.enum(CAPTION_POSITIONS).optional(),
  offsetPct: z.number().min(-20).max(20).optional(),
  font: z.enum(CAPTION_FONTS).optional(),
  weight: z.union([z.literal(400), z.literal(700), z.literal(800)]).optional(),
  italic: z.boolean().optional(),
  size: z.number().min(24).max(96).optional(),
  uppercase: z.boolean().optional(),
  color: hex.optional(),
  highlight: hex.optional(),
  shadow: z.boolean().optional(),
  background: z.enum(CAPTION_BACKGROUNDS).optional(),
  backgroundColor: hex.optional(),
  backgroundOpacity: z.number().min(0).max(1).optional(),
  animation: z.enum(CAPTION_ANIMATIONS).optional(),
});
export type CaptionStyleInput = z.infer<typeof CaptionStyleSchema>;

const BASE: CaptionLook = {
  position: "bottom",
  offsetPct: 0,
  font: "inter",
  weight: 800,
  italic: false,
  size: 44,
  uppercase: true,
  color: "#ffffff",
  highlight: "#3b82f6",
  shadow: true,
  background: "none",
  backgroundColor: "#000000",
  backgroundOpacity: 0.55,
  animation: "fade",
};

// Phase 7 reference bar (quality-refs/): serif italic white captions with a
// soft shadow and the keyword highlighted in gold (#d4af37 range), the default
// look; the hook renders with the same one so it reads as a serif title.
export const CAPTION_PRESETS: Record<(typeof CAPTION_PRESET_NAMES)[number], Partial<CaptionLook>> = {
  reference: { font: "serif", weight: 400, italic: true, uppercase: false, size: 46, color: "#ffffff", highlight: "#d4af37", shadow: true, animation: "fade" },
  "bold-pop": { font: "inter", weight: 800, uppercase: true, size: 44, highlight: "#3b82f6", animation: "pop" },
  clean: { font: "inter", weight: 700, uppercase: false, size: 40, highlight: "#facc15", animation: "fade" },
  documentary: { font: "serif", weight: 400, italic: true, uppercase: false, size: 46, highlight: "#f5d68a", shadow: true, animation: "fade" },
  neon: { font: "archivo-black", weight: 400, uppercase: true, size: 48, highlight: "#39ff14", shadow: false, animation: "word-reveal" },
  minimal: { font: "inter", weight: 700, uppercase: false, size: 36, background: "pill", backgroundOpacity: 0.55, animation: "slide-up" },
};

/** Full look from an optional, partial user style: preset, then overrides. */
export function resolveCaptionStyle(input?: CaptionStyleInput | null): CaptionLook {
  const preset = CAPTION_PRESETS[input?.preset ?? "reference"];
  const explicit = Object.fromEntries(
    Object.entries(input ?? {}).filter(([k, v]) => k !== "preset" && v !== undefined),
  );
  return { ...BASE, ...preset, ...explicit } as CaptionLook;
}

/**
 * How the HUD (the counter and the timer) is drawn. It follows the caption
 * look: the serif looks ("reference", the default, and "documentary") draw it
 * as text over the picture like the reference channels (quality-refs/): a
 * spaced-capitals label, a big serif value and a gold fact line, no card. The
 * other presets keep the white cards.
 */
export interface HudLook {
  kind: "text" | "card";
  /** Text HUD: the value's serif. The look's own bundled serif, else Playfair Display. */
  valueFont: string;
  /** Text HUD: the fact line's colour, the look's highlight (gold on the serif looks), a touch lighter so small capitals read over a dark scene. */
  accent: string;
  /** Where the captions sit, so the text HUD keeps clear of them (layout.ts). */
  caption: Pick<CaptionLook, "position" | "offsetPct" | "size">;
}

export const TEXT_HUD_PRESETS: ReadonlyArray<(typeof CAPTION_PRESET_NAMES)[number]> = ["reference", "documentary"];

/** The HUD look for a caption style (the same optional, partial input as resolveCaptionStyle). */
export function resolveHudStyle(input?: CaptionStyleInput | null): HudLook {
  const look = resolveCaptionStyle(input);
  const bundledSerif = look.font === "playfair-display" || look.font === "merriweather" || look.font === "lora";
  return {
    kind: TEXT_HUD_PRESETS.includes(input?.preset ?? "reference") ? "text" : "card",
    valueFont: FONT_STACKS[bundledSerif ? look.font : "playfair-display"],
    accent: mixHex(look.highlight, "#ffffff", 0.25),
    caption: { position: look.position, offsetPct: look.offsetPct, size: look.size },
  };
}

/** CSS font stacks. The bundled fonts are loaded in hud/fonts.ts. */
export const FONT_STACKS: Record<(typeof CAPTION_FONTS)[number], string> = {
  inter: "'Inter', system-ui, sans-serif",
  montserrat: "'Montserrat', system-ui, sans-serif",
  poppins: "'Poppins', system-ui, sans-serif",
  "bebas-neue": "'Bebas Neue', 'Arial Black', sans-serif",
  anton: "'Anton', 'Arial Black', sans-serif",
  oswald: "'Oswald', system-ui, sans-serif",
  "playfair-display": "'Playfair Display', Georgia, serif",
  merriweather: "'Merriweather', Georgia, serif",
  lora: "'Lora', Georgia, serif",
  nunito: "'Nunito', system-ui, sans-serif",
  "roboto-condensed": "'Roboto Condensed', 'Roboto', sans-serif",
  "archivo-black": "'Archivo Black', 'Arial Black', sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
};

export function hexToRgba(color: string, alpha: number): string {
  const n = parseInt(color.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** `a` moved toward `b` by `t` (0..1), both "#rrggbb". */
export function mixHex(a: string, b: string, t: number): string {
  const ca = parseInt(a.slice(1), 16);
  const cb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((ca >> s) & 255) * (1 - t) + ((cb >> s) & 255) * t);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("")}`;
}
