/**
 * src/methods/animation/index.ts — method B: the hand-coded film renderer.
 *
 * Not built yet. Phase 3 of docs/factory/23-visual-methods.md builds it:
 * Playwright + installed Chrome, deterministic frame stepping, clean-room
 * primitives (the source animation skill has no licence, so we reimplement).
 *
 * It owns its whole picture — renderer, scenes, decorative type, palette — and
 * uses the repo's voice, music, SFX and subtitles like every other method.
 * It has no styles.
 *
 * `available: false` makes selecting it fail with a readable message instead
 * of a stack trace, and keeps the method registry honest.
 */
import { METHOD_INFO, type MethodImpl } from "../types";

export const animationMethod: MethodImpl = {
  id: "animation",
  summary: METHOD_INFO.animation.summary,
  available: METHOD_INFO.animation.available,

  async render(): Promise<never> {
    throw new Error(
      "method 'animation' is not built yet — it is Phase 3 of docs/factory/23-visual-methods.md. " +
        "Use --method factory for now.",
    );
  },
};
