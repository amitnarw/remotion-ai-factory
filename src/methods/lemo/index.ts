/**
 * src/methods/lemo/index.ts — method C: the 99-style library.
 *
 * Not built yet. Phases 4–7 of docs/factory/23-visual-methods.md build it:
 * 96 usable style packs (3 need an image generator and stay unsupported),
 * 12 medium renderers, a lemo-only house look, and the per-segment router.
 *
 * Isolation: nothing in here is imported by factory or animation, and this file
 * imports neither. Style packs are readable only from this directory.
 */
import { METHOD_INFO, type MethodImpl } from "../types";

export const lemoMethod: MethodImpl = {
  id: "lemo",
  summary: METHOD_INFO.lemo.summary,
  available: METHOD_INFO.lemo.available,

  async render(): Promise<never> {
    throw new Error(
      "method 'lemo' is not built yet — it is Phases 4–7 of docs/factory/23-visual-methods.md. " +
        "Use --method factory for now.",
    );
  },
};
