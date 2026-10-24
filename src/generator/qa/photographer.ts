/**
 * src/generator/qa/photographer.ts — the photographer role, first version:
 * one draft still from the middle of every shot, checked by code.
 *
 * Code checks what code can measure exactly (08-phase3-research.md §4):
 *   exposure   mean luma, crushed shadows, clipped highlights (night is allowed darker);
 *   flat frame one colour fills most of the frame: a prop against the lens, a
 *              wall, or an empty sky or sea;
 *   colour     a nearly colourless daytime frame (washed out).
 * With a vision model (the "vision" role, chosen in Providers -> Model roles)
 * each still also gets neutral yes/no questions (vision.ts): is the subject
 * there, is the world in the state the story says. Nothing here blocks a
 * render: problems are reported per shot.
 */
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import type { ShotSpec, SpecShot } from "../spec.schema";
import { colourfulness, dominantColourShare, exposureVerdict, lumaStats, type LumaStats } from "./metrics";
import { decodePng } from "./png";
import { askVision, visionQuestions } from "./vision";
import type { RoleModel } from "../pipeline/llm";

const ROOT = process.cwd();
const COMPOSITION = "WhatIfVideo";

/** Above this share, one flat colour fills the frame. */
export const MAX_FLAT = 0.55;
/**
 * Indoors a tight frame is often MOSTLY wall: the furniture is right against
 * it, and the lens cannot step outside (the room bounds). The flat check
 * trips indoors only when even that wall frame is one colour beyond this
 * share - the interior FS/CU flags (lamp 59%, table 58%) read as the room,
 * not as a lens against a prop.
 */
export const MAX_FLAT_INDOOR = 0.8;
/**
 * At night one dark tone (the sky, a dark facade) can legitimately cover
 * most of the frame; the flat share only reads as a bug in daylight.
 */
export const MAX_FLAT_NIGHT = 0.7;

/** Options of the still check. */
export interface JudgeOptions {
  /** Interior kit (the room walls may legitimately fill the frame). */
  indoor?: boolean;
}
/** Below this (Hasler-Süsstrunk M), a daytime frame looks washed out. */
export const MIN_COLOUR_DAY = 8;

export interface ShotCheck {
  beat: string;
  subject: string;
  size: string;
  frame: number;
  still: string;
  /** Exposure rules used: day, night or space. */
  light: "day" | "night" | "space";
  luma: LumaStats;
  colour: number;
  flat: number;
  problems: string[];
}

/** The frame in the middle of each shot. */
export function shotFrames(spec: ShotSpec): Array<{ shot: SpecShot; frame: number }> {
  const fps = spec.fps ?? 30;
  return (spec.shots ?? []).map((shot) => ({ shot, frame: Math.round(((shot.from + shot.to) / 2) * fps) }));
}

/** Which exposure rules apply to the scene on screen at time t. */
function lightAt(spec: ShotSpec, t: number): ShotCheck["light"] {
  const scene = spec.scenes.find((s) => t >= s.from && t < s.to) ?? spec.scenes[spec.scenes.length - 1];
  if (scene?.kit === "space") return "space";
  return scene?.look?.timeOfDay === "night" ? "night" : "day";
}

/** The code checks on one decoded still. */
export function judgeStill(png: Buffer, light: ShotCheck["light"], opts: JudgeOptions = {}): Pick<ShotCheck, "luma" | "colour" | "flat" | "problems"> {
  const img = decodePng(png);
  const luma = lumaStats(img);
  const colour = colourfulness(img);
  const flat = dominantColourShare(img);
  const problems = [...exposureVerdict(luma, light).problems];
  // Space is black sky around a planet: a flat background is expected there.
  const flatLimit = opts.indoor ? MAX_FLAT_INDOOR : light === "night" ? MAX_FLAT_NIGHT : MAX_FLAT;
  if (flat > flatLimit && light !== "space") problems.push(`one flat colour covers ${(flat * 100).toFixed(0)}% of the frame (a prop against the lens, a wall, or empty sky or sea)`);
  if (light === "day" && colour < MIN_COLOUR_DAY) problems.push(`almost no colour (colourfulness ${colour.toFixed(1)})`);
  return { luma, colour, flat, problems };
}

/**
 * Render the middle frame of every shot and check it. `serveUrl` reuses an
 * existing Remotion bundle folder (bundling copies public/ and takes a minute).
 */
export async function checkShots(input: {
  spec: ShotSpec;
  outDir: string;
  serveUrl?: string;
  scale?: number;
  /** Vision model for the yes/no questions; omit to run the code checks only. */
  vision?: RoleModel;
  onShot?: (c: ShotCheck) => void;
}): Promise<ShotCheck[]> {
  const { spec, outDir } = input;
  mkdirSync(outDir, { recursive: true });
  const serveUrl = input.serveUrl ?? (await bundle({ entryPoint: join(ROOT, "src", "index.ts") }));
  const chromiumOptions = { gl: "angle" as const };
  const browser = await openBrowser("chrome", { chromiumOptions });
  const inputProps = { spec };
  try {
    const composition = await selectComposition({ serveUrl, id: COMPOSITION, inputProps, puppeteerInstance: browser, chromiumOptions });
    const checks: ShotCheck[] = [];
    for (const { shot, frame } of shotFrames(spec)) {
      const still = join(outDir, `${shot.beat ?? frame}.png`);
      await renderStill({ composition, serveUrl, output: still, frame, inputProps, scale: input.scale ?? 0.5, puppeteerInstance: browser, chromiumOptions, overwrite: true });
      const tSec = frame / (spec.fps ?? 30);
      const light = lightAt(spec, tSec);
      const onScreen = spec.scenes.find((sc) => tSec >= sc.from && tSec < sc.to) ?? spec.scenes[spec.scenes.length - 1];
      const png = readFileSync(still);
      const check: ShotCheck = { beat: shot.beat ?? String(frame), subject: shot.subject, size: shot.size, frame, still, light, ...judgeStill(png, light, { indoor: onScreen?.kit === "interior" }) };
      if (input.vision) check.problems.push(...(await askVision({ png, beat: check.beat, questions: visionQuestions(spec, shot), model: input.vision })));
      checks.push(check);
      input.onShot?.(check);
    }
    writeFileSync(join(outDir, "qa.json"), JSON.stringify({ when: new Date().toISOString(), checks }, null, 2));
    return checks;
  } finally {
    await browser.close({ silent: true });
  }
}
