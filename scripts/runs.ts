/**
 * scripts/runs.ts — find a rendered video in output/, in either layout:
 *
 *   - a run folder (runs since 2026-11-04): output/<id>/spec.json (or only
 *     props.json, the spec inside), report.json and video.mp4;
 *   - the old flat files: output/<id>-spec.json, -props.json, -report.json
 *     and output/whatif-<id>-*.mp4 or output/<id>-<date>.mp4.
 *
 * Used by self-review.ts, audio-audit.ts and phase3-lane-stills.ts, which
 * once looked only for the flat files and so could not see a new run
 * (docs/factory/16-code-map-pipeline.md §7.5 item 12).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { validateSpec, type ShotSpec } from "../src/generator/spec.schema";

export const OUTPUT_DIR = join(process.cwd(), "output");

export interface Run {
  id: string;
  spec: ShotSpec;
  specPath: string;
  /** The run folder (null for the old flat files). */
  dir: string | null;
  /** Where the run's report lives (it may not exist yet). */
  reportPath: string;
  /** The props file, if there is one. */
  propsPath: string | null;
  /** The newest rendered MP4, if there is one. */
  mp4: string | null;
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "video"
  );
}

/** Every run in `out`: folders first, then flat files; newest first within each. */
export function listRuns(out = OUTPUT_DIR): Array<{ id: string; specPath: string; dir: string | null }> {
  if (!existsSync(out)) return [];
  const names = readdirSync(out);
  const newest = (a: { specPath: string }, b: { specPath: string }) => statSync(b.specPath).mtimeMs - statSync(a.specPath).mtimeMs;
  // A run folder holds spec.json, or only props.json (its spec inside, as the milestone's do).
  const folders = names
    .map((n) => ({ n, file: ["spec.json", "props.json"].map((f) => join(out, n, f)).find((f) => existsSync(f)) }))
    .filter((x): x is { n: string; file: string } => !!x.file)
    .map(({ n, file }) => ({ id: n, specPath: file, dir: join(out, n) }))
    .sort(newest);
  const flat = names
    .filter((n) => n.endsWith("-spec.json"))
    .map((n) => ({ id: n.replace(/-spec\.json$/, ""), specPath: join(out, n), dir: null }))
    .sort(newest);
  return [...folders, ...flat];
}

function newestFile(files: string[]): string | null {
  const there = files.filter((f) => existsSync(f));
  return there.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null;
}

/** The run's paths and its validated spec. */
export function openRun(r: { id: string; specPath: string; dir: string | null }, out = OUTPUT_DIR): Run {
  const raw = JSON.parse(readFileSync(r.specPath, "utf8"));
  const spec = validateSpec(raw.spec ?? raw);
  if (r.dir) {
    const props = join(r.dir, "props.json");
    return { ...r, spec, reportPath: join(r.dir, "report.json"), propsPath: existsSync(props) ? props : null, mp4: newestFile([join(r.dir, "video.mp4")]) };
  }
  const props = join(out, `${r.id}-props.json`);
  const mp4s = readdirSync(out)
    .filter((f) => f.endsWith(".mp4") && (f.startsWith(`whatif-${r.id}-`) || f.startsWith(`${r.id}-`)))
    .map((f) => join(out, f));
  return { ...r, spec, reportPath: join(out, `${r.id}-report.json`), propsPath: existsSync(props) ? props : null, mp4: newestFile(mp4s) };
}

/**
 * The run an id or a premise names: an exact id (or the premise's slug)
 * first, then the newest run whose id holds one of the query's words (longer
 * than 3 letters). Null when none does.
 */
export function findRun(idOrPremise: string, out = OUTPUT_DIR): Run | null {
  const runs = listRuns(out);
  const q = slug(idOrPremise);
  const words = q.split("-").filter((w) => w.length > 3);
  const hit = runs.find((r) => r.id === idOrPremise || r.id === q) ?? runs.find((r) => words.some((w) => r.id.includes(w)));
  return hit ? openRun(hit, out) : null;
}

/**
 * A props file named the old way (output/<id>-props.json) or by a run id:
 * the path itself when it exists, else the run folder's props.json.
 */
export function resolveProps(rel: string, out = OUTPUT_DIR): string {
  const abs = join(process.cwd(), rel);
  if (existsSync(abs)) return abs;
  const flat = /(?:^|[\\/])output[\\/](.+)-props\.json$/.exec(rel);
  for (const id of [flat?.[1], rel]) {
    if (!id) continue;
    const folder = join(out, id, "props.json");
    if (existsSync(folder)) return folder;
  }
  return abs;
}
