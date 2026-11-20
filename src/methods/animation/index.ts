/**
 * src/methods/animation/index.ts — method B: the hand-coded 3D film.
 *
 * It owns its whole picture: renderer, scenes, palette, decorative type. It
 * uses the repo's voice, music, SFX and subtitles like every other method, and
 * imports no factory stage and no lemo pack.
 *
 * The source animation skill has no licence, so the renderer and kit are a
 * clean-room reimplementation (see renderer.ts and scene/kit.ts).
 *
 * Status: the renderer and the reference `shore` scene are built; the method
 * stays `available: false` until the stills gate and the recipe coverage for
 * other subjects pass review (docs/factory/23-visual-methods.md Phase 3).
 */
import { videoFrames } from "../../compositions/brand/length";
import { resolveCaptionStyle } from "../../generator/caption-style";
import type { ShotSpec } from "../../generator/spec.schema";
import { METHOD_INFO, type MethodContext, type MethodImpl, type MethodResult } from "../types";
import { renderAnimation, type SceneData } from "./renderer";

/** Which scene recipe a beat gets. Method B has one look, several stages. */
function recipeFor(spec: ShotSpec): string {
  // A data film is a composition, not a subject: it wins over keywords.
  if (spec.data?.kind === "depth") return "depth";
  const text = `${spec.title} ${(spec.scenes ?? []).map((s) => `${s.scene} ${s.kit ?? ""}`).join(" ")}`.toLowerCase();
  if (/ocean|sea|beach|shore|wave|coast|tide|harbour|harbor|jetty|boat|canoe|pier/.test(text)) return "sea";
  return "sea"; // the only reviewed stage so far; named honestly in the README
}

export function sceneDataFor(spec: ShotSpec): SceneData {
  const fps = spec.fps ?? 30;
  const frames = videoFrames(spec, fps);
  return {
    title: spec.title,
    fps,
    duration: frames / fps,
    width: spec.width ?? 1080,
    height: spec.height ?? 1920,
    recipe: recipeFor(spec),
    palette: spec.palette ? [spec.palette] : undefined,
    data: spec.data,
    // Scene times are seconds (spec.schema videoSeconds), unlike events and
    // captions which are frames. Never divide these by fps.
    beats: (spec.scenes ?? []).map((s) => ({ from: s.from, to: s.to, label: s.scene })),
    // Captions are shared content: same words, same resolved look, same
    // layout helpers as the factory. Method B only chooses how they are drawn.
    captions: (spec.captions ?? []).map((c) => ({
      text: c.text,
      sub: c.sub,
      from: c.from,
      to: c.to,
      keyword: c.keyword,
      style: c.style,
    })),
    captionLook: resolveCaptionStyle(spec.settings?.captions),
    captionsEnabled: spec.settings?.captions?.enabled !== false,
  };
}

export const animationMethod: MethodImpl = {
  id: "animation",
  summary: METHOD_INFO.animation.summary,
  available: METHOD_INFO.animation.available,

  async render(ctx: MethodContext): Promise<MethodResult> {
    const data = sceneDataFor(ctx.spec);
    const r = await renderAnimation({
      data,
      workDir: `${ctx.runDir}/animation`,
      out: ctx.out,
      scale: ctx.quality === "draft" ? 0.5 : 1,
      log: ctx.log,
      onProgress: ctx.onProgress,
    });
    return {
      path: r.path,
      frames: r.frames,
      method: "animation",
      meta: {
        recipe: data.recipe,
        renderSeconds: r.seconds,
        width: r.width,
        height: r.height,
      },
    };
  },
};
