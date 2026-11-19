/**
 * src/methods/factory/index.ts — method A: the existing Remotion stage kits.
 *
 * This is deliberately thin. It owns no picture logic of its own: it calls the
 * same chunked, cached renderer the factory has always used, with the same
 * arguments. Selecting method A must be indistinguishable from not having a
 * method field at all (docs/factory/23-visual-methods.md §4).
 *
 * Do not add scene looks, palettes or captions here. If the factory's picture
 * improves, it improves in src/compositions/ and src/generator/, not here.
 */
import { renderChunked } from "../../generator/render";
import { METHOD_INFO, type MethodContext, type MethodImpl, type MethodResult } from "../types";

export const factoryMethod: MethodImpl = {
  id: "factory",
  summary: METHOD_INFO.factory.summary,
  available: METHOD_INFO.factory.available,

  async render(ctx: MethodContext): Promise<MethodResult> {
    const r = await renderChunked(ctx.spec, ctx.runId, {
      quality: ctx.quality,
      out: ctx.out,
      log: ctx.log,
      onFrames: ctx.onProgress,
    });
    return {
      path: r.output,
      frames: r.frames,
      method: "factory",
      meta: {
        chunks: r.chunks,
        audio: r.audio,
        renderSeconds: r.seconds,
      },
    };
  },
};
