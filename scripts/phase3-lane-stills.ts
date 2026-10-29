/**
 * scripts/phase3-lane-stills.ts - Phase 3 lane A QA (09-phase3-handoff.md
 * 3.1/3.3): one still per subject anchor for a kit, from an existing props
 * file, with the scene's kit / time of day overridden in memory. The world
 * kit is swept too: a real place + featured actors + one shot per subject
 * (written out of out/qa/laneA/). Nothing is written outside out/qa/laneA/.
 * No video is rendered.
 *
 * Usage:
 *   npx tsx scripts/phase3-lane-stills.ts --kit ocean --tod night --base output/milestone-oceans-vanish-16x9-props.json
 *   (no --kit): the lane check set - every subject anchor per stage + the night / look spots + world scenes
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import type { SceneType, ShotSpec, SpecShot } from "../src/generator/spec.schema";
import { subjectsFor } from "../src/generator/camera/subjects";
import { resolvePlace } from "../src/world/places";
import { worldAnchorNames } from "../src/generator/camera/world";
import { judgeStill, shotFrames, type ShotCheck } from "../src/generator/qa/photographer";


const OUT = join(process.cwd(), "out", "qa", "laneA");

const args = process.argv.slice(2);
const opt = (n: string) => {
  const i = args.indexOf("--" + n);
  return i >= 0 ? args[i + 1] : undefined;
};

/** Varied, deterministic shots: one per subject, size and angle cycling. */
function cycleShots(names: readonly string[], from: number, shotLen: number): SpecShot[] {
  const SIZES = ["EWS", "WS", "MS", "FS", "CU", "MS", "WS", "CU"] as const;
  const ANGLES = ["eye", "low", "high", "eye", "low"] as const;
  const MOVES = ["push_in", "orbit_right", "static", "crane_up", "static", "pull_out"] as const;
  return names.map((subject, i) => ({
    subject,
    size: SIZES[i % SIZES.length],
    angle: ANGLES[i % ANGLES.length],
    side: i % 2 === 0 ? "auto" : "left34",
    move: MOVES[i % MOVES.length],
    place: "auto",
    energy: "normal",
    style: "smooth",
    from: from + i * shotLen,
    to: from + (i + 1) * shotLen,
    beat: subject,
  }));
}

const STRIP = { statPanel: null, events: [], captions: [], timer: null, worldEvents: [] } as const;

/** A deep clone spec with one scene (kit + tod overridden) and a shot per subject. */
export function laneSpec(
  base: ShotSpec,
  kit: string,
  tod: string | undefined,
  extra?: { waterfall?: boolean; subject?: string },
): { spec: ShotSpec; name: string } {
  const names = subjectsFor(kit);
  if (kit === "river") {
    names.length = 0;
    names.push("scene", "river", "rocks");
    if (extra?.waterfall) names.push("waterfall");
  }
  const proto = JSON.parse(JSON.stringify(base.scenes[0]));
  proto.from = 0;
  const shotLen = 4;
  const dur = names.length * shotLen + 2;
  proto.to = dur;
  proto.kit = kit;
  // Anchor sweep = clean light: the inherit-the-base-scene weather (rain) put
  // streaks and shadowed tones over the anchor checks. Weather gets its own runs.
  proto.look = { ...(proto.look ?? {}), timeOfDay: tod ?? proto.look?.timeOfDay ?? "noon", weather: "clear" };
  if (kit === "river") {
    proto.riverConfig = { hasWaterfall: !!extra?.waterfall, waterfallHeight: extra?.waterfall ? 12 : undefined, flowDir: "z", length: 200, width: 12 };
  }
  if (kit === "space") proto.subject = extra?.subject ?? "earth";

  const spec = {
    ...JSON.parse(JSON.stringify(base)),
    scenes: [proto],
    shots: cycleShots(names, 0.5, shotLen),
    ...STRIP,
  } as unknown as ShotSpec;
  return { spec, name: kit + (tod ? "-" + tod : "") + (extra?.waterfall ? "-falls" : "") };
}

/** Featured performers of the world QA scenes: one waves, one carries a box
 *  to the plaza; anchor names valid at every place (avenue, its sides). */
const WORLD_CAST: SceneType["actors"] = [
  {
    role: "street musician",
    where: "sidewalk-north",
    do: [
      { at: 1, action: "wave", target: "avenue-west", for: 2 },
      { at: 4, action: "walk", to: "avenue-east" },
      { at: 9, action: "cheer", for: 2.5 },
    ],
  },
  {
    role: "box carrier",
    where: "sidewalk-south",
    carry: "box",
    do: [
      { at: 1, action: "idle" },
      { at: 4, action: "walk", to: "avenue-west" },
      { at: 9, action: "look", target: "street-musician-0" },
      { at: 12, action: "point", target: "avenue-east", for: 3 },
    ],
  },
];

/** A deep clone spec with one WORLD scene (a real place + featured actors)
 *  and one solver shot per subject the camera can frame there
 *  (worldAnchorNames). The spec's format can be forced for per-aspect checks. */
export function laneWorldSpec(
  base: ShotSpec,
  place: string,
  tod: string,
  extra?: { clock?: string; portrait?: boolean },
): { spec: ShotSpec; name: string } {
  const clock = extra?.clock ?? (tod === "night" ? "23:30" : "14:30");
  const proto = JSON.parse(JSON.stringify(base.scenes[0])) as Record<string, unknown>;
  const scene: SceneType = {
    ...proto,
    scene: "world-place",
    from: 0,
    to: 0,
    kit: "world",
    world: { place, date: "2026-07-14", time: clock },
    look: { ...((base.scenes[0].look ?? {}) as object), timeOfDay: tod, weather: "clear" },
    actors: JSON.parse(JSON.stringify(WORLD_CAST)),
  } as SceneType;

  const resolved = resolvePlace(place, { date: "2026-07-14", time: clock });
  const names = worldAnchorNames(scene, resolved);
  const shotLen = 4;
  const dur = names.length * shotLen + 2;
  scene.to = dur;

  const spec = {
    ...JSON.parse(JSON.stringify(base)),
    ...(extra?.portrait ? { settings: { ...(base.settings ?? {}), format: "9:16" } } : {}),
    scenes: [scene],
    shots: cycleShots(names, 0.5, shotLen),
    ...STRIP,
  } as unknown as ShotSpec;
  return { spec, name: `world-${place}-${tod}` };
}

/** Render the mid-shot stills of one lane spec into out/qa/laneA/<name>/. */
export async function runKit(input: { spec: ShotSpec; name: string; bundle: string; scale: number }): Promise<ShotCheck[]> {
  const outDir = join(OUT, input.name);
  mkdirSync(outDir, { recursive: true });
  const { renderStill, selectComposition, openBrowser } = await import("@remotion/renderer");
  const chromiumOptions = { gl: "angle" as const };
  const browser = await openBrowser("chrome", { chromiumOptions });
  const inputProps = { spec: input.spec };
  const checks: ShotCheck[] = [];
  try {
    const composition = await selectComposition({ serveUrl: input.bundle, id: "WhatIfVideo", inputProps, puppeteerInstance: browser, chromiumOptions });
    const kit = input.spec.scenes[0]?.kit;
    for (const { shot, frame } of shotFrames(input.spec)) {
      const still = join(outDir, (shot.beat ?? String(frame)) + ".png");
      await renderStill({ composition, serveUrl: input.bundle, output: still, frame, inputProps, scale: input.scale, puppeteerInstance: browser, chromiumOptions, overwrite: true });
      const png = readFileSync(still);
      const isNight = input.spec.scenes[0]?.look?.timeOfDay === "night";
      const light = kit === "space" ? ("space" as const) : isNight ? ("night" as const) : ("day" as const);
      const check: ShotCheck = { beat: shot.beat ?? String(frame), subject: shot.subject, size: shot.size, frame, still, light, ...judgeStill(png, light, { indoor: kit === "interior" }) };
      checks.push(check);
      console.log(
        "[lane] " + input.name + " " + check.subject.padEnd(14) + " " + check.size.padEnd(4) +
        " luma " + check.luma.mean.toFixed(3) + " crushed " + (check.luma.crushed * 100).toFixed(0) + "%" +
        " flat " + (check.flat * 100).toFixed(0) + "%" +
        " " + (check.problems.length ? "FLAG: " + check.problems.join("; ") : "ok"),
      );
    }
  } finally {
    await browser.close({ silent: true });
  }
  writeFileSync(join(outDir, "qa.json"), JSON.stringify({ when: new Date().toISOString(), checks }, null, 2));
  return checks;
}

function loadBase(rel: string): ShotSpec {
  const abs = join(process.cwd(), rel);
  if (!existsSync(abs)) throw new Error("missing props: " + rel);
  const raw = JSON.parse(readFileSync(abs, "utf8"));
  return (raw.spec ?? raw) as ShotSpec;
}

async function main() {
  const bundleDir = opt("bundle") ?? join(process.cwd(), "out", "phase3-lane-bundle");
  if (!existsSync(bundleDir)) throw new Error("no bundle at " + bundleDir + " - run: npx remotion bundle src/index.ts --out-dir out/phase3-lane-bundle");
  const scale = Number(opt("scale") ?? 0.5);

  // --kit <kit> [--tod <tod>] [--base <props>] [--waterfall] [--subject <name>] : one run.
  // Without --kit: the lane check set (09 3.1 - every subject anchor per stage) plus the
  // look / night trouble spots (09 3.3 and the night exposure floor) and the world scenes.
  const kit = opt("kit");
  type Run = { base: string; kit: string; tod?: string; extra?: { waterfall?: boolean; subject?: string }; world?: { place: string; tod: string; portrait: boolean }; note: string };
  const runs: Run[] = kit
    ? [{ base: opt("base") ?? "output/milestone-oceans-vanish-16x9-props.json", kit, tod: opt("tod"), extra: { waterfall: !!opt("waterfall"), subject: opt("subject") }, note: "single" }]
    : [
        // the world scenes (mission 1): a place + featured actors + a shot each,
        // filmed through the solver; portrait and landscape, day and night
        { base: "output/milestone-oceans-vanish-9x16-props.json", kit: "ocean", world: { place: "paris", tod: "noon", portrait: true }, note: "world portrait: paris + featured actors (solver shots)" },
        { base: "output/milestone-oceans-vanish-16x9-props.json", kit: "ocean", world: { place: "cairo", tod: "night", portrait: false }, note: "world night landscape: cairo minaret + vendors" },
        { base: "output/milestone-oceans-vanish-16x9-props.json", kit: "ocean", tod: "noon", note: "ocean re-check (beach parasol clearance)" },
        { base: "output/milestone-oceans-vanish-16x9-props.json", kit: "ocean", tod: "night", note: "night exposure floor" },
        { base: "output/milestone-oceans-vanish-16x9-props.json", kit: "space", extra: { subject: "earth" }, note: "space anchors" },
        { base: "output/milestone-forest-walks-16x9-props.json", kit: "forest", tod: "golden", note: "golden forest" },
        { base: "out/qc/countryside-noon.props.json", kit: "countryside", tod: "noon", note: "countryside anchors" },
        { base: "out/qc/countryside-night.props.json", kit: "countryside", tod: "night", note: "countryside night (barn side bias)" },
        { base: "output/milestone-forest-walks-16x9-props.json", kit: "river", tod: "afternoon", extra: { waterfall: true }, note: "river anchors + waterfall (rocks clearance)" },
        { base: "output/milestone-forest-walks-16x9-props.json", kit: "interior", tod: "dawn", note: "interior anchors (indoor flat limit)" },
      ];

  const summary: Record<string, unknown> = {};
  for (const run of runs) {
    const base = loadBase(run.base);
    const { spec, name } = run.world ? laneWorldSpec(base, run.world.place, run.world.tod, run.world) : laneSpec(base, run.kit, run.tod, run.extra);
    console.log("[lane] " + name + " (" + run.note + ")");
    const checks = await runKit({ spec, name, bundle: bundleDir, scale });
    summary[name] = { note: run.note, flagged: checks.filter((c) => c.problems.length).length, checks: checks.length };
  }
  writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
  console.log("[lane] done. Stills + qa.json under out/qa/laneA/");
}

if (args[0] !== "--imported") main().catch((e: unknown) => { console.error("[lane]", e instanceof Error ? e.message : String(e)); process.exit(1); });
