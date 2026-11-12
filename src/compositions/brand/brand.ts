/**
 * src/compositions/brand/brand.ts — a channel's brand (docs/factory/15-producer.md §7, "Brand").
 *
 * A channel profile may carry a `brand`: its name and logo, three colours, the
 * caption and title fonts (from the fonts the project ships, caption-style.ts),
 * an intro bumper (1-2 s, the name or logo revealed), an outro bumper (2-4 s,
 * the name and a call to subscribe, as text only) and a corner watermark.
 *
 * The brand reaches the render as `spec.brand` (the assembler copies the
 * profile's brand into the spec). A spec without one renders exactly as before:
 * every helper here returns its input unchanged when there is no brand, and the
 * composition mounts the same tree as before (WhatIfVideo/index.tsx).
 *
 * Pure: no React, no fs. Used by the composition, ai/channels.ts (the profile
 * schema) and the Settings → Channels page.
 */
import { z } from "zod";
import { CAPTION_FONTS, FONT_STACKS, mixHex, type CaptionLook, type HudLook } from "../../generator/caption-style";
import type { ShotSpec } from "../../generator/spec.schema";
import { secToFrame } from "../../generator/timing";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "a colour like #ffffff");

/** The shapes a brand without a logo image shows in its bumpers (marks.ts). */
export const BRAND_MARKS = ["circle", "play", "bolt", "star", "diamond", "drop"] as const;
export type BrandMark = (typeof BRAND_MARKS)[number];

/** A logo lives in public/brand/<channel>/: "brand/<channel>/<file>.(svg|png|webp|jpg)". */
export const LOGO_PATH = /^brand\/[a-z0-9-]+\/[A-Za-z0-9._-]+\.(svg|png|webp|jpe?g)$/;

export const INTRO_SECONDS = { min: 1, max: 2, default: 1.5 } as const;
export const OUTRO_SECONDS = { min: 2, max: 4, default: 3 } as const;

export const BrandSchema = z.object({
  /** The channel's name as the bumpers and the watermark write it. */
  name: z.string().trim().min(1).max(40),
  /** An image under public/brand/<channel>/, or none (the bumpers show the mark and the name). */
  logo: z.string().regex(LOGO_PATH, "a file under public/brand/<channel>/, e.g. brand/action/logo.svg").optional(),
  /** The shape drawn when there is no logo, morphed in by the intro (Flubber). */
  mark: z.enum(BRAND_MARKS).default("circle"),
  colors: z.object({
    /** Keywords, the HUD's fact line and label, the bumpers' mark. */
    accent: hex,
    /** Caption and HUD text, the bumpers' name. */
    text: hex,
    /** The bumpers' background and the caption box (when the caption look has one). */
    background: hex,
  }),
  /** Fonts from the bundled set; unset keeps the caption look's own. */
  fonts: z
    .object({
      caption: z.enum(CAPTION_FONTS).optional(),
      /** The hook title, the HUD's big numbers and the bumpers' name. */
      title: z.enum(CAPTION_FONTS).optional(),
    })
    .default({}),
  intro: z.object({ seconds: z.number().min(INTRO_SECONDS.min).max(INTRO_SECONDS.max).default(INTRO_SECONDS.default) }).optional(),
  outro: z
    .object({
      seconds: z.number().min(OUTRO_SECONDS.min).max(OUTRO_SECONDS.max).default(OUTRO_SECONDS.default),
      /** The call to subscribe, written on screen only (never voiced). */
      subscribe: z.string().trim().min(1).max(60).default("Subscribe for more"),
    })
    .optional(),
  /** The logo (or the name) small in a top corner, over the video between the bumpers. */
  watermark: z.boolean().default(false),
});
export type Brand = z.infer<typeof BrandSchema>;
/** What a profile file may hold (defaults not filled in yet). */
export type BrandInput = z.input<typeof BrandSchema>;

/**
 * The spec's brand, or undefined. The spec schema carries it as `brand`
 * (once spec.schema.ts has the field; until then a spec passed straight to the
 * composition may still hold it). A brand that does not parse is ignored, so a
 * render never fails on it.
 */
export function brandOf(spec: ShotSpec): Brand | undefined {
  const raw = (spec as ShotSpec & { brand?: unknown }).brand;
  if (raw == null) return undefined;
  const parsed = BrandSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** The bumpers' lengths in frames (0 for one the brand does not have). */
export function bumperFrames(brand: Brand | undefined, fps: number): { intro: number; outro: number } {
  return {
    intro: brand?.intro ? secToFrame(brand.intro.seconds, fps) : 0,
    outro: brand?.outro ? secToFrame(brand.outro.seconds, fps) : 0,
  };
}

/**
 * The whole video's length in frames: the intro, the story's own length, the
 * outro. Without a brand it is `secToFrame(videoSeconds(spec), fps)`, as before.
 * Root.tsx's specMetadata and render/index.ts use this once wired (status/brand.md).
 */
export function brandedFrames(bodyFrames: number, brand: Brand | undefined, fps: number): number {
  const b = bumperFrames(brand, fps);
  return b.intro + bodyFrames + b.outro;
}

/** Display fonts shipped in one weight only: drawn bolder, the browser would smear them. */
export const SINGLE_WEIGHT_FONTS: ReadonlyArray<CaptionLook["font"]> = ["anton", "bebas-neue", "archivo-black"];

/** The weight to draw a brand font with: its only weight for a single-weight display font, else `wanted`. */
export function brandWeight<W extends number>(font: CaptionLook["font"] | undefined, wanted: W): W | 400 {
  return font && SINGLE_WEIGHT_FONTS.includes(font) ? 400 : wanted;
}

/** The caption look with the brand's colours and caption font; the same look without a brand. */
export function brandCaptionLook(look: CaptionLook, brand: Brand | undefined): CaptionLook {
  if (!brand) return look;
  return {
    ...look,
    font: brand.fonts.caption ?? look.font,
    weight: brandWeight(brand.fonts.caption, look.weight),
    color: brand.colors.text,
    highlight: brand.colors.accent,
    backgroundColor: brand.colors.background,
  };
}

/** The hook's look: the caption look with the brand's title font. */
export function brandTitleLook(look: CaptionLook, brand: Brand | undefined): CaptionLook {
  if (!brand?.fonts.title) return look;
  return { ...look, font: brand.fonts.title };
}

/** The HUD look with the brand's colours and title font. `text` and `cardAccent` are only set by a brand. */
export type BrandedHudLook = HudLook & {
  /** The text HUD's label and value colour (white without a brand). */
  text?: string;
  /** The card HUD's label colour (red without a brand). */
  cardAccent?: string;
};

export function brandHudLook(hud: HudLook, brand: Brand | undefined): BrandedHudLook {
  if (!brand) return hud;
  return {
    ...hud,
    valueFont: brand.fonts.title ? FONT_STACKS[brand.fonts.title] : hud.valueFont,
    // As resolveHudStyle does with the highlight: a touch lighter, so small capitals read over a dark scene.
    accent: mixHex(brand.colors.accent, "#ffffff", 0.25),
    text: brand.colors.text,
    cardAccent: brand.colors.accent,
  };
}

/** The font stack for the bumpers' name: the title font, else the caption font, else Inter. */
export function brandTitleFont(brand: Brand): string {
  return FONT_STACKS[brand.fonts.title ?? brand.fonts.caption ?? "inter"];
}

/** The bumpers' and the hook's title weight: 700, or 400 for a single-weight display font. */
export function brandTitleWeight(brand: Brand | undefined): 700 | 400 {
  return brandWeight(brand?.fonts.title ?? brand?.fonts.caption, 700);
}

/** True when the brand draws anything at all (a brand with no bumpers and no watermark still recolours the captions). */
export function brandDraws(brand: Brand | undefined): boolean {
  return !!brand && (!!brand.intro || !!brand.outro || brand.watermark);
}
