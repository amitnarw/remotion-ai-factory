/**
 * src/generator/publish/index.ts — the publish pack of a finished run
 * (docs/factory/20-publish.md): everything a YouTube upload needs, written to
 * output/<run>/publish/:
 *   publish.json     the titles, description, chapters, credits, tags and the thumbnail's frame
 *   description.txt  the description as it is pasted
 *   thumbnail.png    one still of the video at the picked frame, the hook over it
 * A variant's pack (pipeline/variants.ts) goes in output/<run>/variants/<id>/publish/,
 * made from the variant's own spec (its hook, ending, format and length).
 * Only files are written: nothing is uploaded anywhere.
 *
 * The titles and tags are one call on the writer role's model (titles.ts);
 * the rest is code (pack.ts). The call's reply is kept in the run's
 * .calls/ like every other role's, so publishing again asks no model.
 */
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { DEFAULT_CHANNEL, loadChannel, type ChannelProfile } from "../ai/channels";
import { resolveRoleModels, withCallCache, type RoleModel } from "../pipeline/llm";
import { videoSeconds } from "../spec.schema";
import {
  buildDescription,
  channelOf,
  chaptersOf,
  creditsOf,
  hashtagsOf,
  pickThumbnail,
  readRun,
  readVariantRun,
  summaryOf,
  thumbnailSize,
  type Chapter,
  type RunFiles,
  type ThumbnailPick,
} from "./pack";
import { askTitles } from "./titles";
import { renderThumbnail, uploadableThumbnail, type RenderThumbnail } from "./thumbnail";

export const PUBLISH_DIR = "publish";
export const PUBLISH_VERSION = 1;

export interface PublishPack {
  v: number;
  run: string;
  /** A variant's pack: the variant's id (output/<run>/variants/<variant>/). */
  variant?: string;
  channel: string;
  /** The video file, relative to the pack's folder. */
  video: string;
  format: string;
  durationSec: number;
  titles: string[];
  /** "model": the writer's model wrote the titles and tags; "code": stand-ins (see warnings). */
  titlesFrom: "model" | "code";
  model?: RoleModel;
  description: string;
  hook: string;
  summary: string;
  chapters: Chapter[];
  credits: string[];
  tags: string[];
  hashtags: string[];
  /** The picked frame; `file` is null when no still was written, and `skipped` says why. `upload`: the file within YouTube's 2 MB (the PNG, or its JPEG copy). */
  thumbnail: ThumbnailPick & { file: string | null; width: number; height: number; upload?: string; bytes?: number; skipped?: string };
  warnings: string[];
}

export interface PublishOptions {
  /** output/ (tests use a temp folder). */
  outputDir?: string;
  /** The role models; default: the Settings' (resolveRoleModels), the writer's for the call. */
  models?: Record<string, RoleModel>;
  /** A bundle folder for the thumbnail (default: the cached render bundle). */
  serveUrl?: string;
  /** false: write publish.json and description.txt only. */
  thumbnail?: boolean;
  /** Use this frame instead of the pick. */
  frame?: number;
  /** Tests: a renderer that needs no browser. */
  render?: RenderThumbnail;
  channel?: ChannelProfile;
  /** The pack of this variant of the run (output/<id>/variants/<variant>/) instead of the run's own. */
  variant?: string;
  log?: (line: string) => void;
}

/** The pack's folder of a run, or of one of its variants. */
export function publishDir(id: string, outputDir = join(process.cwd(), "output"), variant?: string): string {
  return variant ? join(outputDir, id, "variants", variant, PUBLISH_DIR) : join(outputDir, id, PUBLISH_DIR);
}

/** The pack of a run read from disk (no file written). The titles are the one model call. */
export async function buildPack(run: RunFiles, opts: PublishOptions = {}): Promise<PublishPack> {
  const { spec } = run;
  const channelId = channelOf(run) ?? DEFAULT_CHANNEL;
  const channel = opts.channel ?? loadChannel(channelId);
  const premise = run.brief?.premise ?? run.report?.premise;
  const models = opts.models ?? resolveRoleModels(["writer"]);
  const titles = await withCallCache(join(run.dir, ".calls"), () => askTitles({ spec, channel, models, premise }));
  const chapters = chaptersOf(spec);
  const credits = creditsOf(spec, run.report?.credits);
  const summary = summaryOf(spec);
  const hashtags = hashtagsOf(spec, titles.tags);
  const description = buildDescription({ hook: spec.hook.text, summary, chapters, credits, hashtags });
  const fps = spec.fps ?? 30;
  const pick: ThumbnailPick =
    opts.frame !== undefined
      ? { frame: opts.frame, t: opts.frame / fps, beat: beatAt(run, opts.frame / fps), from: "given", why: "the frame asked for" }
      : pickThumbnail(spec, run.qa);
  const size = thumbnailSize(spec);
  return {
    v: PUBLISH_VERSION,
    run: run.id,
    ...(run.variant ? { variant: run.variant } : {}),
    channel: channel.id,
    video: run.variant ? "../video.mp4" : `../${run.report?.output ?? "video.mp4"}`,
    format: spec.settings?.format ?? "9:16",
    durationSec: Math.round(videoSeconds(spec) * 100) / 100,
    titles: titles.titles,
    titlesFrom: titles.source,
    ...(titles.model ? { model: titles.model } : {}),
    description,
    hook: spec.hook.text,
    summary,
    chapters,
    credits,
    tags: titles.tags,
    hashtags,
    thumbnail: { ...pick, file: null, width: size.width, height: size.height, skipped: "not rendered yet" },
    warnings: titles.warning ? [titles.warning] : [],
  };
}

function beatAt(run: RunFiles, t: number): string {
  return (run.spec.story?.beats ?? []).find((b) => (b.from ?? 0) <= t && t < (b.to ?? 0))?.id ?? (t < run.spec.hook.t + run.spec.hook.duration ? "hook" : "");
}

/**
 * Make the publish pack of output/<id>/ and write it to output/<id>/publish/
 * (a variant's: output/<id>/variants/<variant>/publish/).
 * A thumbnail that fails to render leaves the text files and says why in
 * publish.json's warnings (and `thumbnail.skipped`).
 */
export async function makePublishPack(id: string, opts: PublishOptions = {}): Promise<PublishPack> {
  const log = opts.log ?? ((l: string) => console.log(l));
  const run = opts.variant ? readVariantRun(id, opts.variant, opts.outputDir) : readRun(id, opts.outputDir);
  const dir = publishDir(id, opts.outputDir, opts.variant);
  mkdirSync(dir, { recursive: true });
  const channelId = channelOf(run) ?? DEFAULT_CHANNEL;
  const channel = opts.channel ?? loadChannel(channelId);
  const pack = await buildPack(run, { ...opts, channel });
  log(`[publish] titles (${pack.titlesFrom}): ${pack.titles.join(" | ")}`);
  if (pack.warnings.length) for (const w of pack.warnings) log(`[publish] warning: ${w}`);

  if (opts.thumbnail === false) {
    pack.thumbnail = { ...pack.thumbnail, file: null, skipped: "--no-thumbnail" };
  } else {
    const file = "thumbnail.png";
    try {
      log(`[publish] thumbnail: frame ${pack.thumbnail.frame} (${pack.thumbnail.why})`);
      const size = await (opts.render ?? renderThumbnail)({
        spec: run.spec,
        frame: pack.thumbnail.frame,
        out: join(dir, file),
        captions: channel.captions,
        serveUrl: opts.serveUrl,
        log,
      });
      pack.thumbnail = { ...pack.thumbnail, file, width: size.width, height: size.height };
      delete pack.thumbnail.skipped;
      const upload = uploadableThumbnail(join(dir, file));
      if (upload) Object.assign(pack.thumbnail, { upload: upload.file, bytes: upload.bytes });
      else pack.warnings.push("the thumbnail is over YouTube's 2 MB even as a JPEG");
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      pack.thumbnail = { ...pack.thumbnail, file: null, skipped: why.slice(0, 300) };
      pack.warnings.push(`no thumbnail: ${why.slice(0, 300)}`);
      log(`[publish] warning: no thumbnail: ${why.slice(0, 300)}`);
    }
  }

  writeFileSync(join(dir, "publish.json"), JSON.stringify(pack, null, 2) + "\n");
  writeFileSync(join(dir, "description.txt"), pack.description + "\n");
  log(`[publish] wrote ${join(dir, "publish.json")}, description.txt${pack.thumbnail.file ? `, ${pack.thumbnail.file}` : ""}${pack.thumbnail.upload && pack.thumbnail.upload !== pack.thumbnail.file ? ` (upload ${pack.thumbnail.upload}: the PNG is over 2 MB)` : ""}`);
  return pack;
}

export { readRun, readVariantRun } from "./pack";
