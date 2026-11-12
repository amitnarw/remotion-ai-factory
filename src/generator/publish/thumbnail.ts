/**
 * src/generator/publish/thumbnail.ts — render the publish pack's thumbnail:
 * one still of the video's own composition (WhatIfVideo) at the picked
 * frame, from thumbnailSpec (no captions, the hook over the picture in the
 * run's caption style), as a PNG at thumbnailSize (1280x720 for landscape,
 * else the format's own size).
 *
 * The bundle: `serveUrl` when given (a bundle folder whose public/ is a
 * junction, as the photographer takes one), else the chunked render's cached
 * bundle (render/bundle.ts ensureBundle, built once per source tree).
 *
 * YouTube takes a custom thumbnail of at most 2 MB. A PNG over that (a
 * 1080x1920 still of a busy scene is about 3 MB) gets a JPEG copy beside it,
 * thumbnail.jpg, and that is the one to upload.
 */
import { existsSync, mkdirSync, statSync } from "fs";
import { basename, dirname, join } from "path";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import type { ShotSpec } from "../spec.schema";
import type { CaptionStyleInput } from "../caption-style";
import { ensureBundle } from "../render/bundle";
import { runFfmpeg } from "../ffmpeg";
import { thumbnailSize, thumbnailSpec } from "./pack";

const COMPOSITION = "WhatIfVideo";

export interface ThumbnailRender {
  spec: ShotSpec;
  frame: number;
  /** The PNG to write. */
  out: string;
  /** The channel's caption style, used when the run's settings name none. */
  captions?: CaptionStyleInput;
  serveUrl?: string;
  log?: (line: string) => void;
}

/** A thumbnail renderer: writes `out`, says its size. Tests pass their own. */
export type RenderThumbnail = (r: ThumbnailRender) => Promise<{ width: number; height: number }>;

export const renderThumbnail: RenderThumbnail = async (r) => {
  const log = r.log ?? ((l: string) => console.log(l));
  const serveUrl = r.serveUrl ?? (await ensureBundle({ log })).dir;
  const inputProps = { spec: thumbnailSpec(r.spec, r.captions) };
  const size = thumbnailSize(r.spec);
  const chromiumOptions = { gl: "angle" as const };
  mkdirSync(dirname(r.out), { recursive: true });
  const browser = await openBrowser("chrome", { chromiumOptions });
  try {
    const composition = await selectComposition({ serveUrl, id: COMPOSITION, inputProps, puppeteerInstance: browser, chromiumOptions });
    await renderStill({
      composition,
      serveUrl,
      output: r.out,
      frame: r.frame,
      inputProps,
      imageFormat: "png",
      scale: size.scale,
      puppeteerInstance: browser,
      chromiumOptions,
      overwrite: true,
    });
  } finally {
    await browser.close({ silent: true });
  }
  return { width: size.width, height: size.height };
};

/** YouTube's limit for a custom thumbnail. */
export const THUMB_MAX_BYTES = 2 * 1024 * 1024;

/**
 * The file to upload: the PNG when it is within 2 MB, else a JPEG copy
 * beside it (ffmpeg, the best quality that fits). Null when neither fits.
 */
export function uploadableThumbnail(png: string): { file: string; bytes: number } | null {
  const bytes = statSync(png).size;
  if (bytes <= THUMB_MAX_BYTES) return { file: basename(png), bytes };
  const jpg = join(dirname(png), basename(png).replace(/\.png$/i, "") + ".jpg");
  for (const q of [2, 3, 5, 8]) {
    const r = runFfmpeg(["-y", "-v", "error", "-i", png, "-q:v", String(q), "-frames:v", "1", jpg]);
    if (r.ok && existsSync(jpg) && statSync(jpg).size <= THUMB_MAX_BYTES) return { file: basename(jpg), bytes: statSync(jpg).size };
  }
  return null;
}
