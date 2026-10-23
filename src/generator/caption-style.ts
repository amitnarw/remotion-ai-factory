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

export const CAPTION_PRESET_NAMES = ["bold-pop", "clean", "documentary", "neon", "minimal"] as const;
export const CAPTION_POSITIONS = ["top", "upper", "middle", "lower", "bottom"] as const;
export const CAPTION_FONTS = ["inter", "archivo-black", "serif"] as const;
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

export const CAPTION_PRESETS: Record<(typeof CAPTION_PRESET_NAMES)[number], Partial<CaptionLook>> = {
  "bold-pop": { font: "inter", weight: 800, uppercase: true, size: 44, highlight: "#3b82f6", animation: "pop" },
  clean: { font: "inter", weight: 700, uppercase: false, size: 40, highlight: "#facc15", animation: "fade" },
  documentary: { font: "serif", weight: 400, italic: true, uppercase: false, size: 46, highlight: "#f5d68a", shadow: true, animation: "fade" },
  neon: { font: "archivo-black", weight: 400, uppercase: true, size: 48, highlight: "#39ff14", shadow: false, animation: "word-reveal" },
  minimal: { font: "inter", weight: 700, uppercase: false, size: 36, background: "pill", backgroundOpacity: 0.55, animation: "slide-up" },
};

/** Full look from an optional, partial user style: preset, then overrides. */
export function resolveCaptionStyle(input?: CaptionStyleInput | null): CaptionLook {
  const preset = CAPTION_PRESETS[input?.preset ?? "bold-pop"];
  const explicit = Object.fromEntries(
    Object.entries(input ?? {}).filter(([k, v]) => k !== "preset" && v !== undefined),
  );
  return { ...BASE, ...preset, ...explicit } as CaptionLook;
}

/** CSS font stacks. The bundled fonts are loaded in hud/fonts.ts. */
export const FONT_STACKS: Record<(typeof CAPTION_FONTS)[number], string> = {
  inter: "'Inter', system-ui, sans-serif",
  "archivo-black": "'Archivo Black', 'Arial Black', sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
};

export function hexToRgba(color: string, alpha: number): string {
  const n = parseInt(color.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
