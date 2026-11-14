/**
 * src/generator/qa/photographer.ts — the photographer role, first version:
 * one draft still from the middle of every shot, checked by code.
 *
 * Code checks what code can measure exactly (08-phase3-research.md §4):
 *   exposure   mean luma, crushed shadows, clipped highlights (night is allowed darker);
 *   flat frame one colour fills most of the frame: a prop against the lens, a
 *              wall, or an empty sky or sea;
 *   colour     a nearly colourless daytime frame (washed out).
 * With a vision model (the "vision" role, chosen in Settings -> AI models -> Model roles)
 * each still also gets neutral yes/no questions (vision.ts): is the subject
 * there, is the world in the state the story says. Nothing here blocks a
 * render: problems are reported per shot.
 *
 * A bullet time's window (docs/factory/14-bullet-time.md, risk 11) is judged
 * as what it is: a still from a shot over the hold is taken in the hold, its
 * colour floor allows for the hold's grade (less saturated on purpose), and
 * the check carries notes that the world standing still there (things
 * hanging in the air, people and traffic frozen, trails in the air) is
 * intended, for whoever reads the report.
 */
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { videoFrameOf } from "../../compositions/brand/length";
import type { ShotSpec, SpecShot } from "../spec.schema";
import { colourfulness, dominantColourShare, exposureVerdict, lumaStats, type LumaStats } from "./metrics";
import { decodePng } from "./png";
import { askVision, visionQuestions } from "./vision";
import type { RoleModel } from "../pipeline/llm";
import { lightningAt } from "../../compositions/lightning";
import { reactionAt } from "../../world/react/reaction";
import { sunElevationAt } from "../../world/lapse";
import { HOLD_DESATURATE, holdDepth, sceneClock, warpEdges } from "../../world/warp";
import { lightWordFor, worldSunOf } from "../look-choice";

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
  /** A bullet time's hold depth at the still (0..1, holdDepth): the grade
   *  takes HOLD_DESATURATE of the saturation off at 1, so the colour floor
   *  comes down with it. */
  hold?: number;
}
/** Below this (Hasler-Süsstrunk M), a daytime frame looks washed out. */
export const MIN_COLOUR_DAY = 8;

export interface ShotCheck {
  beat: string;
  subject: string;
  size: string;
  frame: number;
  still: string;
  /** Exposure rules used: day, night, space, or dark (after a lights-out event). */
  light: "day" | "night" | "space" | "dark";
  luma: LumaStats;
  colour: number;
  flat: number;
  problems: string[];
  /** What is intended in this still and must not be read as a fault (a
   *  bullet time's frozen world); empty or absent for most stills. */
  notes?: string[];
}

/** The scene on screen at time t. */
function sceneAt(spec: ShotSpec, t: number) {
  return spec.scenes.find((s) => t >= s.from && t < s.to) ?? spec.scenes[spec.scenes.length - 1];
}

/** A bullet time on screen at time t: its window, its hold (the world at its
 *  slowest), the world's rate there and how deep into the hold t is (0 on
 *  the window's edges, 1 through the hold). Null outside every window. */
export function bulletAt(spec: ShotSpec, t: number): { from: number; to: number; hold: [number, number]; rate: number; depth: number; projectiles: number } | null {
  const scene = sceneAt(spec, t);
  const bt = scene?.bulletTime;
  if (!bt || t < bt.from || t >= bt.to) return null;
  const { b, c } = warpEdges(bt);
  return { from: bt.from, to: bt.to, hold: [b, c], rate: bt.rate, depth: holdDepth(sceneClock(scene), t), projectiles: bt.projectiles?.length ?? 0 };
}

/** The hold of the bullet time a shot's middle falls in, in the shot's frames [first, last], or null. */
function holdFrames(spec: ShotSpec, shot: SpecShot, fps: number): [number, number] | null {
  const mid = (shot.from + shot.to) / 2;
  for (const s of spec.scenes) {
    const bt = s.bulletTime;
    if (!bt || mid < bt.from || mid >= bt.to) continue;
    const { b, c } = warpEdges(bt);
    const first = Math.max(Math.ceil(b * fps), Math.ceil(shot.from * fps));
    const last = Math.min(Math.ceil(c * fps) - 1, Math.ceil(shot.to * fps) - 1);
    if (last >= first) return [first, last];
  }
  return null;
}

/**
 * The frame in the middle of each shot. In a storm, a frame inside a
 * lightning flash (white on purpose for a few frames) moves to the nearest
 * frame of the shot without one. A shot whose middle is in a bullet time's
 * window is judged in the hold (the frozen moment the device is for, not a
 * ramp), at the frame of it nearest the shot's middle.
 */
export function shotFrames(spec: ShotSpec): Array<{ shot: SpecShot; frame: number }> {
  const fps = spec.fps ?? 30;
  const stormAt = (t: number) => sceneAt(spec, t)?.look?.weather === "storm";
  return (spec.shots ?? []).map((shot) => {
    const mid = Math.round(((shot.from + shot.to) / 2) * fps);
    const [first, last] = holdFrames(spec, shot, fps) ?? [Math.ceil(shot.from * fps), Math.max(Math.ceil(shot.from * fps), Math.ceil(shot.to * fps) - 1)];
    const clear = (f: number) => !stormAt(f / fps) || lightningAt(f / fps) === 0;
    const near = Math.min(last, Math.max(first, mid));
    for (let d = 0; d <= last - first; d++) {
      for (const f of [near + d, near - d]) if (f >= first && f <= last && clear(f)) return { shot, frame: f };
    }
    return { shot, frame: near };
  });
}

/** What a still at time t shows on purpose (the report's notes for it). */
export function stillNotes(spec: ShotSpec, t: number): string[] {
  const bt = bulletAt(spec, t);
  if (!bt) return [];
  const pace = bt.rate <= 0 ? "stands still" : `runs at 1/${Math.round(1 / bt.rate)} of real time`;
  const notes = [
    `bullet time (${bt.from.toFixed(1)}-${bt.to.toFixed(1)} s, the hold ${bt.hold[0].toFixed(1)}-${bt.hold[1].toFixed(1)} s): the world ${pace} on purpose; things hanging in the air, people and traffic frozen mid-move, the hero moving slowly and ${bt.projectiles ? "projectiles with trails and rings in the air" : "nothing else moving"} are intended, not faults`,
  ];
  if (bt.depth > 0.01) notes.push(`the hold's grade is ${(HOLD_DESATURATE * bt.depth * 100).toFixed(0)}% less saturated on purpose (the colour floor allows for it)`);
  return notes;
}

/** Which exposure rules apply to the scene on screen at time t. */
export function lightAt(spec: ShotSpec, t: number): ShotCheck["light"] {
  const scene = sceneAt(spec, t);
  if (scene?.kit === "space") return "space";
  // A lights-out event darkens the world on purpose from its moment on.
  if ((spec.worldEvents ?? []).some((e) => e.name === "lights-out" && typeof e.t === "number" && t >= e.t)) return "dark";
  // So does the counter's "dark" reaction in a world place, once it has
  // taken more than half the power (world/react/reaction.ts).
  if (scene?.kit === "world" && spec.statPanel?.react === "dark" && reactionAt(spec, scene, t).power < 0.5) return "dark";
  // A world place is lit by its real sun, so its still is judged by that sun
  // (night rules once it has set), not by the scene's word: a time-lapse's at
  // the still's own frame, any other's at its moment (as its grade is,
  // look-choice.ts worldSunOf). A world choice that does not resolve keeps its word.
  if (scene?.kit === "world" && scene.world) {
    const elevation = scene.world.lapse ? sunElevationAt(scene.world, scene, t) : worldSunOf(scene);
    if (elevation !== null) return lightWordFor(elevation) === "night" ? "night" : "day";
  }
  return scene?.look?.timeOfDay === "night" ? "night" : "day";
}

/** The code checks on one decoded still. */
export function judgeStill(png: Buffer, light: ShotCheck["light"], opts: JudgeOptions = {}): Pick<ShotCheck, "luma" | "colour" | "flat" | "problems"> {
  const img = decodePng(png);
  const luma = lumaStats(img);
  const colour = colourfulness(img);
  const flat = dominantColourShare(img);
  const problems = [...exposureVerdict(luma, light).problems];
  // Space is black sky around a planet, and a blacked-out world is one dark
  // colour by intent: a flat background is expected there (the exposure floor
  // still catches a frame with nothing in it).
  const flatLimit = opts.indoor ? MAX_FLAT_INDOOR : light === "night" ? MAX_FLAT_NIGHT : MAX_FLAT;
  if (flat > flatLimit && light !== "space" && light !== "dark") problems.push(`one flat colour covers ${(flat * 100).toFixed(0)}% of the frame (a prop against the lens, a wall, or empty sky or sea)`);
  const minColour = colourFloor(opts.hold ?? 0);
  if (light === "day" && colour < minColour) problems.push(`almost no colour (colourfulness ${colour.toFixed(1)})`);
  return { luma, colour, flat, problems };
}

/** The daytime colour floor at a bullet time's hold depth (0 outside a
 *  window): colourfulness falls with the grade's saturation. */
export function colourFloor(hold: number): number {
  return MIN_COLOUR_DAY * (1 - HOLD_DESATURATE * Math.min(1, Math.max(0, hold)));
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
      // The video shows the story's frame after a channel brand's intro (none: the same frame).
      await renderStill({ composition, serveUrl, output: still, frame: videoFrameOf(spec, frame), inputProps, scale: input.scale ?? 0.5, puppeteerInstance: browser, chromiumOptions, overwrite: true });
      const tSec = frame / (spec.fps ?? 30);
      const light = lightAt(spec, tSec);
      const onScreen = sceneAt(spec, tSec);
      const png = readFileSync(still);
      const hold = bulletAt(spec, tSec)?.depth ?? 0;
      const check: ShotCheck = {
        beat: shot.beat ?? String(frame),
        subject: shot.subject,
        size: shot.size,
        frame,
        still,
        light,
        ...judgeStill(png, light, { indoor: onScreen?.kit === "interior", hold }),
        notes: stillNotes(spec, tSec),
      };
      if (input.vision) check.problems.push(...(await askVision({ png, beat: check.beat, questions: visionQuestions(spec, shot, tSec), model: input.vision })));
      checks.push(check);
      input.onShot?.(check);
    }
    writeFileSync(join(outDir, "qa.json"), JSON.stringify({ when: new Date().toISOString(), checks }, null, 2));
    return checks;
  } finally {
    await browser.close({ silent: true });
  }
}
