/**
 * src/generator/publish/pack.ts — the publish pack's pure parts
 * (docs/factory/20-publish.md): what a finished run is read from, the
 * credits, the chapters, the summary and the description, the tag and title
 * limits, and which frame becomes the thumbnail. No model call, no clock, no
 * render: the same run gives the same text.
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { formatDims, validateSpec, videoSeconds, type ShotSpec } from "../spec.schema";
import { introFrames } from "../../compositions/brand/length";
import type { CaptionStyleInput } from "../caption-style";
import { assetById, creditsFor } from "../../world/catalog";
import { creditsForPlaces } from "../../world/landmarks";
import { PLACES } from "../../world/places";
import { shotFrames, type ShotCheck } from "../qa/photographer";

/* ---------------- YouTube's limits ---------------- */

/** YouTube refuses a longer title. */
export const TITLE_MAX = 100;
/** Longer titles are cut off in search and on the watch page. */
export const TITLE_SOFT = 70;
export const DESCRIPTION_MAX = 5000;
/** All tags together, commas included (a tag with a space counts its quotes too). */
export const TAGS_MAX_TOTAL = 500;
/** Chapters: the first at 0:00, at least three, each at least 10 s. */
export const CHAPTER_MIN_SEC = 10;
export const CHAPTERS_MIN = 3;
/** Long form: a landscape video this long or longer gets chapters. */
export const LONG_FORM_SEC = 60;
/** The thumbnail of a landscape video (YouTube's recommended size). */
export const THUMB_LANDSCAPE = { width: 1280, height: 720 };

/* ---------------- the run ---------------- */

/** One photographer check as saved in qa/qa.json (the fields the pick reads). */
export type QaCheck = Pick<ShotCheck, "beat" | "frame" | "luma" | "colour" | "flat" | "problems"> & Partial<ShotCheck>;

export interface RunFiles {
  id: string;
  /** The run's folder (its .calls/ keep the titles reply), a variant's too. */
  dir: string;
  spec: ShotSpec;
  /** A variant of the run (output/<id>/variants/<variant>/): `spec` is the variant's own. */
  variant?: string;
  /** report.json, when the run was rendered. */
  report?: { credits?: string[]; channel?: string; output?: string; durationSec?: string | number; premise?: string };
  /** brief.json, when the run was planned with a manifest (P1 and later). */
  brief?: { premise?: string; channel?: string };
  /** qa/qa.json's checks, when the photographer ran. */
  qa?: QaCheck[];
}

function readJson<T>(file: string): T | undefined {
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/**
 * Read a finished run from output/<id>/: the rendered spec (props.json, with
 * the sound resolved) or the plan's spec.json, plus report.json, brief.json
 * and qa/qa.json when they exist.
 */
export function readRun(id: string, outputDir = join(process.cwd(), "output")): RunFiles {
  const dir = join(outputDir, id);
  const props = readJson<{ spec?: unknown }>(join(dir, "props.json"));
  const raw = props?.spec ?? readJson<unknown>(join(dir, "spec.json"));
  if (!raw) throw new Error(`no props.json or spec.json in ${dir}`);
  const spec = validateSpec(raw);
  const qa = readJson<{ checks?: QaCheck[] }>(join(dir, "qa", "qa.json"))?.checks;
  return {
    id,
    dir,
    spec,
    report: readJson(join(dir, "report.json")),
    brief: readJson(join(dir, "brief.json")),
    ...(qa?.length ? { qa } : {}),
  };
}

/**
 * A variant of a finished run (output/<id>/variants/<variant>/, made by
 * pipeline/variants.ts) read as a run of its own: the variant's spec with the
 * run's report, brief and .calls/. The photographer scored the run's own
 * video, so its stills pick the variant's frame only when the variant has
 * the run's format and length (timing "kept": the same frames); else the
 * thumbnail is the hook's shot, the new hook over it.
 */
export function readVariantRun(id: string, variant: string, outputDir = join(process.cwd(), "output")): RunFiles {
  if (!/^[\w-]+$/.test(variant)) throw new Error(`bad variant id "${variant}"`);
  const dir = join(outputDir, id);
  const vdir = join(dir, "variants", variant);
  const raw = readJson<{ spec?: unknown }>(join(vdir, "props.json"))?.spec ?? readJson<unknown>(join(vdir, "spec.json"));
  if (!raw) throw new Error(`no spec.json in ${vdir}; make the variant first`);
  const spec = validateSpec(raw);
  const file = readJson<{ base?: { format?: string }; variants?: Array<{ id: string; timing?: string }> }>(join(dir, "variants", "variants.json"));
  const entry = file?.variants?.find((v) => v.id === variant);
  const sameFrames = entry?.timing === "kept" && !!file?.base?.format && spec.settings?.format === file.base.format;
  const qa = sameFrames ? readJson<{ checks?: QaCheck[] }>(join(dir, "qa", "qa.json"))?.checks : undefined;
  return {
    id,
    dir,
    spec,
    variant,
    report: readJson(join(dir, "report.json")),
    brief: readJson(join(dir, "brief.json")),
    ...(qa?.length ? { qa } : {}),
  };
}

/** The channel a run was made for: its brief, else its report, else none (the caller's default). */
export function channelOf(run: Pick<RunFiles, "brief" | "report">): string | undefined {
  return run.brief?.channel ?? run.report?.channel;
}

/* ---------------- credits ---------------- */

/**
 * The CC-BY credit lines for every model the video used: the landmarks of
 * its world scenes' places (creditsForPlaces, as report.json has them) and a
 * model set's model (creditsFor), plus any line the report already lists.
 * Ids the catalog doesn't know are left out (creditsFor would throw on them).
 */
export function creditsOf(spec: ShotSpec, reportCredits: string[] = []): string[] {
  const places = spec.scenes.flatMap((s) => (s.world && PLACES[s.world.place] ? [PLACES[s.world.place]] : []));
  const models = spec.scenes.flatMap((s) => (s.modelSet?.model && assetById(s.modelSet.model) ? [s.modelSet.model] : []));
  const lines = [...new Set([...creditsForPlaces(places), ...creditsFor(models)])];
  // A report written before a credit line's wording changed names the same
  // model again: keep the catalog's line, add only models it doesn't name.
  const author = (l: string) => (/^"[^"]*" by (.+?)(?: \(|, |$)/.exec(l)?.[1] ?? "").toLowerCase();
  const url = (l: string) => /\((https?:\/\/[^)]+)\)/.exec(l)?.[1];
  const known = new Set(lines.flatMap((l) => [url(l) ?? l, author(l) + "|" + modelName(l)]));
  const extra = reportCredits.filter((l) => !known.has(url(l) ?? l) && !known.has(author(l) + "|" + modelName(l)));
  return [...new Set([...lines, ...extra])].sort();
}

const modelName = (l: string) => (/^"([^"]*)"/.exec(l)?.[1] ?? l).toLowerCase();

/* ---------------- chapters ---------------- */

export interface Chapter {
  /** Seconds from the start. */
  t: number;
  label: string;
}

/** m:ss, or h:mm:ss from an hour (YouTube's chapter stamps). */
export function stamp(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

/** A long-form video: landscape and a minute or more. Shorts get no chapters. */
export function isLongForm(spec: ShotSpec): boolean {
  return (spec.settings?.format ?? (spec.width > spec.height ? "16:9" : "9:16")) === "16:9" && videoSeconds(spec) >= LONG_FORM_SEC;
}

/** A short label from a line: its first clause, at most `words` words, no end punctuation. */
export function shortLabel(text: string, words = 7): string {
  const clause = text.trim().split(/(?<=[.!?;:])\s+|\s+[—–]\s+/)[0] ?? "";
  const w = clause.split(/\s+/).filter(Boolean);
  const cut = w.slice(0, words).join(" ") + (w.length > words ? "…" : "");
  return cut.replace(/[.,;:!?…]+$/, w.length > words ? "…" : "").trim();
}

/**
 * Chapters for a long-form video, from the beats' times: the first at 0:00
 * (the hook), then a new chapter at a beat's start once the current one has
 * run about a sixth of the video (10 s at least, 90 s at most), each named
 * by its first beat's line. A last chapter under 10 s joins the one before.
 * Fewer than three chapters, or a Short: none.
 */
export function chaptersOf(spec: ShotSpec): Chapter[] {
  if (!isLongForm(spec)) return [];
  const total = videoSeconds(spec);
  const target = Math.min(90, Math.max(CHAPTER_MIN_SEC, total / 6));
  const beats = (spec.story?.beats ?? []).filter((b) => typeof b.from === "number" && b.from! < total);
  const chapters: Chapter[] = [{ t: 0, label: shortLabel(spec.hook.text || spec.story?.title || spec.title) || "Intro" }];
  // A channel brand's intro plays first: every later chapter starts that much later in the video.
  const intro = introFrames(spec) / (spec.fps ?? 30);
  for (const b of beats) {
    const from = b.from! + intro;
    const last = chapters[chapters.length - 1];
    const line = b.say?.trim() || b.lines?.map((l) => l.text).join(" ").trim() || b.see?.trim() || "";
    if (!line || from - last.t < target || total + intro - from < CHAPTER_MIN_SEC) continue;
    chapters.push({ t: Math.round(from), label: shortLabel(line) });
  }
  return chapters.length >= CHAPTERS_MIN ? chapters : [];
}

/* ---------------- summary and description ---------------- */

/**
 * A short summary in the video's own words: its beats' lines in order until
 * about two to three sentences (at most 300 characters, cut at a sentence).
 */
export function summaryOf(spec: ShotSpec, max = 300): string {
  const lines = (spec.story?.beats ?? [])
    .map((b) => b.say?.trim() || b.lines?.map((l) => l.text).join(" ").trim() || "")
    .filter(Boolean);
  let out = "";
  for (const line of lines) {
    const next = out ? `${out} ${line}` : line;
    if (next.length > max) break;
    out = next;
    if (out.length >= max * 0.55) break;
  }
  if (!out && lines[0]) out = lines[0].slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
  return out;
}

export interface DescriptionParts {
  hook: string;
  summary: string;
  chapters: Chapter[];
  credits: string[];
  hashtags: string[];
}

/** The description: the hook, the summary, the chapters, the credits, the hashtags. */
export function buildDescription(p: DescriptionParts): string {
  const blocks: string[] = [];
  if (p.hook.trim()) blocks.push(p.hook.trim());
  if (p.summary.trim() && p.summary.trim() !== p.hook.trim()) blocks.push(p.summary.trim());
  if (p.chapters.length) blocks.push(["Chapters", ...p.chapters.map((c) => `${stamp(c.t)} ${c.label}`)].join("\n"));
  if (p.credits.length) blocks.push(["3D model credits", ...p.credits].join("\n"));
  if (p.hashtags.length) blocks.push(p.hashtags.join(" "));
  const text = blocks.join("\n\n");
  if (text.length > DESCRIPTION_MAX) {
    // Never cut the credits: shorten the summary instead.
    const over = text.length - DESCRIPTION_MAX;
    return buildDescription({ ...p, summary: p.summary.slice(0, Math.max(0, p.summary.length - over - 1)) });
  }
  return text;
}

/* ---------------- titles and tags ---------------- */

/** YouTube refuses < and > in titles, tags and descriptions. */
const stripAngles = (s: string) => s.replace(/[<>]/g, "");

/** One title: no quotes round it, no hashtags, one line, at most 100 characters (cut at a word). */
export function cleanTitle(raw: string): string {
  let t = stripAngles(String(raw)).replace(/\s+/g, " ").replace(/(^|\s)#\S+/g, " ").trim();
  t = t.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
  if (t.length > TITLE_MAX) t = t.slice(0, TITLE_MAX + 1).replace(/\s+\S*$/, "").replace(/[\s,;:–—-]+$/, "");
  return t;
}

/** Distinct, clean titles in their order. */
export function cleanTitles(raw: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const t = cleanTitle(String(r ?? ""));
    const key = t.toLowerCase();
    if (!t || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** How a tag counts against the 500: its length, plus 2 for the quotes a tag with a space gets. */
const tagCost = (t: string) => t.length + (/\s/.test(t) ? 2 : 0);

/** Distinct tags (case-insensitive), no '#', at most 60 characters each, all of them within 500 counted with commas. */
export function cleanTags(raw: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let total = 0;
  for (const r of raw) {
    const t = stripAngles(String(r ?? "")).replace(/^#+/, "").replace(/[,\s]+/g, " ").trim().slice(0, 60).trim();
    const key = t.toLowerCase();
    if (!t || seen.has(key)) continue;
    const cost = tagCost(t) + (out.length ? 1 : 0);
    if (total + cost > TAGS_MAX_TOTAL) continue;
    seen.add(key);
    out.push(t);
    total += cost;
  }
  return out;
}

/** The places a video shows, by name (code adds them to the tags). */
export function placeNames(spec: ShotSpec): string[] {
  return [...new Set(spec.scenes.flatMap((s) => (s.world && PLACES[s.world.place] ? [PLACES[s.world.place].name] : [])))];
}

/** Up to three hashtags from the tags (one word each), and #Shorts for a vertical video. */
export function hashtagsOf(spec: ShotSpec, tags: string[]): string[] {
  const vertical = (spec.settings?.format ?? "9:16") === "9:16";
  const words = tags
    .map((t) => t.replace(/[^\p{L}\p{N}]+/gu, ""))
    .filter((t) => t.length >= 3 && t.length <= 30);
  const picked = [...new Set(words.map((w) => w.toLowerCase()))].slice(0, vertical ? 2 : 3);
  return [...(vertical ? ["#Shorts"] : []), ...picked.map((w) => `#${w}`)];
}

/* ---------------- the thumbnail ---------------- */

export interface ThumbnailPick {
  frame: number;
  /** Seconds from the start. */
  t: number;
  beat: string;
  /** Why this frame: the photographer's best, or the hook's shot. */
  from: "photographer" | "hook" | "given";
  why: string;
}

/**
 * How good a photographer still looks for a thumbnail: colourful (the
 * Hasler-Süsstrunk value), not flat, exposed near the middle, little clipped
 * or crushed. A still the photographer flagged never wins over a clean one.
 */
export function stillScore(c: QaCheck): number {
  const exposure = 1 - Math.min(1, Math.abs(c.luma.mean - 0.45) * 2);
  const clip = Math.min(1, (c.luma.clipped ?? 0) * 4 + (c.luma.crushed ?? 0) * 4);
  const s = Math.max(0, c.colour) * (1 - Math.min(1, c.flat)) * (0.5 + 0.5 * exposure) * (1 - 0.5 * clip);
  return c.problems.length ? s - 1e6 : s;
}

/**
 * The thumbnail's frame: the still the photographer scored best when its
 * checks are saved (output/<run>/qa/qa.json, frames inside the video), else
 * the middle of the hook's shot (shotFrames: never in a lightning flash, in
 * a bullet time's hold), else the hook's middle.
 */
export function pickThumbnail(spec: ShotSpec, qa?: QaCheck[]): ThumbnailPick {
  const fps = spec.fps ?? 30;
  const last = Math.max(0, Math.round(videoSeconds(spec) * fps) - 1);
  const checks = (qa ?? []).filter((c) => Number.isFinite(c.frame) && c.frame >= 0 && c.frame <= last);
  if (checks.length) {
    const best = [...checks].sort((a, b) => stillScore(b) - stillScore(a) || a.frame - b.frame)[0];
    return {
      frame: best.frame,
      t: best.frame / fps,
      beat: best.beat,
      from: "photographer",
      why: `the photographer's best still (${best.beat}: colour ${best.colour.toFixed(0)}, flat ${(best.flat * 100).toFixed(0)}%, luma ${best.luma.mean.toFixed(2)}${best.problems.length ? `; flagged: ${best.problems.join("; ")}` : ""})`,
    };
  }
  const hookMid = spec.hook.t + spec.hook.duration / 2;
  const frames = shotFrames(spec);
  const hookShot =
    frames.find((f) => f.shot.beat === "hook") ??
    frames.find((f) => f.shot.from <= hookMid && hookMid < f.shot.to);
  if (hookShot) {
    return { frame: hookShot.frame, t: hookShot.frame / fps, beat: hookShot.shot.beat ?? "hook", from: "hook", why: `the middle of the hook's shot (${hookShot.shot.size} ${hookShot.shot.subject})` };
  }
  const frame = Math.min(last, Math.round(hookMid * fps));
  return { frame, t: frame / fps, beat: "hook", from: "hook", why: "the middle of the hook (no shots planned)" };
}

/** The still's size: 1280x720 for landscape, else the format's own size; `scale` turns the composition's size into it. */
export function thumbnailSize(spec: ShotSpec): { width: number; height: number; scale: number } {
  const dims = spec.settings ? formatDims(spec.settings.format) : { width: spec.width, height: spec.height };
  if (dims.width > dims.height) return { ...THUMB_LANDSCAPE, scale: THUMB_LANDSCAPE.width / dims.width };
  return { ...dims, scale: 1 };
}

/**
 * The spec the thumbnail is rendered from: the video's own, at the picked
 * frame, with no captions and the hook shown over the whole video, drawn by
 * the composition's Hook in the run's caption style (the channel's, when the
 * run named none). A still has no sound, so every sound cue is left out
 * (events keep their names and times, which the stages read; a plan's
 * unresolved sound path would fail the still). Everything else, so the
 * picture, stays as rendered.
 */
export function thumbnailSpec(spec: ShotSpec, captions?: CaptionStyleInput): ShotSpec {
  const style = spec.settings?.captions ?? captions;
  return {
    ...spec,
    captions: [],
    hook: { ...spec.hook, t: 0, duration: videoSeconds(spec) },
    events: (spec.events ?? []).map((e) => ({ ...e, sfx: [] })),
    ...(spec.audio ? { audio: { ...spec.audio, ambient: [], music: [], transitions: [], voiceFiles: [] } } : {}),
    ...(spec.settings && style ? { settings: { ...spec.settings, captions: style } } : {}),
    // A channel brand keeps its colours and fonts on the hook, without its bumpers: the still is the story's own frame.
    ...(spec.brand ? { brand: { ...spec.brand, intro: undefined, outro: undefined } } : {}),
  };
}
