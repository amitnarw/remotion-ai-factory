/**
 * src/compositions/brand/Bumpers.tsx — the channel's intro and outro bumpers
 * and its corner watermark (brand.ts).
 *
 *   BrandIntro  1-2 s: a dot grows and turns into the brand's mark (Flubber,
 *               marks.ts), or the logo scales in; then the name.
 *   BrandOutro  2-4 s: the mark or logo, the name, and the call to subscribe
 *               as text on a button whose icon turns from the mark into a bell.
 *               No voice: the outro is silent.
 *   Watermark   the logo or the name, small in the top corner inside the safe area.
 *
 * Every value is a closed function of the frame (interpolate, spring), so the
 * bumpers render the same in any tab, in any order.
 */
import * as React from "react";
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import "../hud/fonts";
import { FONT_STACKS, hexToRgba } from "../../generator/caption-style";
import { SAFE_AREA, frameShape } from "../../generator/layout";
import { brandTitleFont, brandTitleWeight, type Brand } from "./brand";
import { morphPath } from "./marks";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/**
 * The mark (a morph from `from` to the brand's mark at `t`) or the logo, in a
 * `size` px square. A logo grows by `grow` (1: the full square) through its
 * own width and height, never a CSS scale: Chrome rasterizes a scaled image at
 * a scale it may keep from another frame, so the same frame came out
 * differently from run to run.
 */
const MarkOrLogo: React.FC<{
  brand: Brand;
  size: number;
  morph: { from: "dot" | "bell"; to: "dot" | "bell" | "mark"; t: number };
  grow?: number;
  style?: React.CSSProperties;
}> = ({ brand, size, morph, grow = 1, style }) => {
  if (brand.logo) {
    const s = size * grow;
    return (
      <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", overflow: "visible", ...style }}>
        <Img src={staticFile(brand.logo)} style={{ width: s, height: s, flexShrink: 0, objectFit: "contain", display: "block" }} />
      </div>
    );
  }
  const from = morph.from;
  const to = morph.to === "mark" ? brand.mark : morph.to;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: "block", overflow: "visible", ...style }}>
      <path d={morphPath(from, to, morph.t)} fill={brand.colors.accent} />
    </svg>
  );
};

/** The frame's short side over 1080: every size below is designed on a 1080 frame. */
function useUnit(): number {
  const { width, height } = useVideoConfig();
  return Math.min(width, height) / 1080;
}

/** `frames`: the bumper's length (the Sequence's); unset, the composition's. */
type BumperProps = { brand: Brand; frames?: number };

export const BrandIntro: React.FC<BumperProps> = ({ brand, frames }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const u = useUnit();
  const n = Math.max(1, frames ?? durationInFrames);
  const p = frame / n;
  // The dot grows into the mark over the first 45 %, the name rises in after it.
  const morphT = interpolate(p, [0.08, 0.5], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const logoIn = spring({ frame, fps, config: { damping: 14, mass: 0.6 }, durationInFrames: Math.round(n * 0.5) });
  const nameIn = interpolate(p, [0.35, 0.7], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const out = interpolate(p, [0.86, 1], [1, 0], clamp);
  const markSize = 300 * u;
  return (
    <AbsoluteFill style={{ background: brand.colors.background, alignItems: "center", justifyContent: "center" }}>
      <div style={{ opacity: out, display: "flex", flexDirection: "column", alignItems: "center", gap: 44 * u }}>
        <MarkOrLogo
          brand={brand}
          size={markSize}
          morph={{ from: "dot", to: "mark", t: morphT }}
          grow={0.6 + 0.4 * logoIn}
          style={brand.logo ? { opacity: Math.min(1, Math.max(0, logoIn)) } : undefined}
        />
        <div
          style={{
            fontFamily: brandTitleFont(brand),
            fontSize: 96 * u,
            fontWeight: brandTitleWeight(brand),
            color: brand.colors.text,
            letterSpacing: `${0.02 + 0.1 * (1 - nameIn)}em`,
            opacity: nameIn,
            transform: `translateY(${(1 - nameIn) * 40 * u}px)`,
            textAlign: "center",
            whiteSpace: "nowrap",
          }}
        >
          {brand.name}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const BrandOutro: React.FC<BumperProps> = ({ brand, frames }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const u = useUnit();
  const n = Math.max(1, frames ?? durationInFrames);
  const inn = spring({ frame, fps, config: { damping: 15, mass: 0.7 }, durationInFrames: Math.round(fps * 0.7) });
  const button = spring({ frame: frame - Math.round(fps * 0.35), fps, config: { damping: 12, mass: 0.6 }, durationInFrames: Math.round(fps * 0.6) });
  // The button's icon: the brand's mark turning into a bell, then a small ring of the bell.
  const toBell = interpolate(frame, [fps * 0.6, fps * 1.2], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const ring = frame > fps * 1.2 ? Math.sin((frame - fps * 1.2) * 0.9) * Math.exp(-(frame - fps * 1.2) / (fps * 0.35)) * 14 : 0;
  const out = interpolate(frame, [n - Math.round(fps * 0.35), n], [1, 0], clamp);
  const subscribe = brand.outro?.subscribe ?? "Subscribe for more";
  const iconSize = 64 * u;
  return (
    <AbsoluteFill style={{ background: brand.colors.background, alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          opacity: out * inn,
          transform: `translateY(${(1 - inn) * 50 * u}px)`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 40 * u,
        }}
      >
        <MarkOrLogo brand={brand} size={200 * u} morph={{ from: "dot", to: "mark", t: 1 }} />
        <div style={{ fontFamily: brandTitleFont(brand), fontSize: 84 * u, fontWeight: brandTitleWeight(brand), color: brand.colors.text, textAlign: "center", whiteSpace: "nowrap" }}>
          {brand.name}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 22 * u,
            padding: `${22 * u}px ${44 * u}px`,
            borderRadius: 999,
            background: brand.colors.accent,
            boxShadow: `0 ${10 * u}px ${30 * u}px ${hexToRgba("#000000", 0.25)}`,
            transform: `scale(${0.7 + 0.3 * button})`,
            opacity: Math.min(1, Math.max(0, button)),
          }}
        >
          <svg width={iconSize} height={iconSize} viewBox="0 0 100 100" style={{ display: "block", transform: `rotate(${ring}deg)`, transformOrigin: "50% 10%" }}>
            <path d={morphPath(brand.logo ? "dot" : brand.mark, "bell", brand.logo ? 1 : toBell)} fill={brand.colors.background} />
          </svg>
          <span style={{ fontFamily: FONT_STACKS.inter, fontSize: 46 * u, fontWeight: 800, color: brand.colors.background, whiteSpace: "nowrap" }}>{subscribe}</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

/**
 * The logo, or the mark and the name in small spaced capitals, in the
 * top-right corner inside the platform's safe area. It fades in once the hook
 * title has gone (`after`, a frame), so the two never meet.
 */
export const Watermark: React.FC<{ brand: Brand; after?: number }> = ({ brand, after = 0 }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const u = Math.min(width, height) / 1080;
  const safe = SAFE_AREA[frameShape(width, height)];
  const shown = interpolate(frame, [after, after + Math.round(fps * 0.5)], [0, 0.72], clamp);
  if (shown <= 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: safe.top * height,
        right: safe.right * width,
        zIndex: 30,
        pointerEvents: "none",
        opacity: shown,
        display: "flex",
        alignItems: "center",
        gap: 12 * u,
      }}
    >
      {brand.logo ? (
        <Img src={staticFile(brand.logo)} style={{ width: 72 * u, height: 72 * u, objectFit: "contain", display: "block" }} />
      ) : (
        <>
          <svg width={30 * u} height={30 * u} viewBox="0 0 100 100" style={{ display: "block" }}>
            <path d={morphPath("dot", brand.mark, 1)} fill={brand.colors.accent} />
          </svg>
          <span
            style={{
              fontFamily: brandTitleFont(brand),
              fontSize: 26 * u,
              fontWeight: brandTitleWeight(brand),
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: brand.colors.text,
              textShadow: "0 1px 3px rgba(0,0,0,0.55)",
              whiteSpace: "nowrap",
            }}
          >
            {brand.name}
          </span>
        </>
      )}
    </div>
  );
};
