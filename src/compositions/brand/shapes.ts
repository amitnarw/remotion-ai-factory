/**
 * src/compositions/brand/shapes.ts — the brand marks' outlines (no Flubber,
 * so the Settings page can draw them without the morph code). Our own simple
 * shapes, one closed path each, in a 100 x 100 box; marks.ts morphs them.
 */
import type { BrandMark } from "./brand";

/** "dot" starts the intro's morph; "bell" ends the outro button's. */
export const MARK_PATHS: Record<BrandMark | "dot" | "bell", string> = {
  dot: "M50,44 A6,6 0 1,1 49.99,44 Z",
  circle: "M50,8 A42,42 0 1,1 49.99,8 Z",
  play: "M30,14 L86,50 L30,86 Z",
  bolt: "M58,6 L20,56 L46,56 L38,94 L80,40 L54,40 Z",
  star: "M50,6 L61,38 L95,38 L67,58 L78,92 L50,71 L22,92 L33,58 L5,38 L39,38 Z",
  diamond: "M50,4 L92,50 L50,96 L8,50 Z",
  drop: "M50,6 C64,30 82,46 82,64 A32,32 0 1,1 18,64 C18,46 36,30 50,6 Z",
  bell: "M50,10 C30,10 24,28 24,46 L24,64 L14,76 L86,76 L76,64 L76,46 C76,28 70,10 50,10 Z",
};

