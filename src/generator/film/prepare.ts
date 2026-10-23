/**
 * src/generator/film/prepare.ts — the current film as a playable spec.
 *
 * The same steps the render runs before drawing frames: rebuild the spec from
 * the stage files (voicing only lines the cache does not have yet, then
 * re-timing from the measured audio), and turn every sound cue into a library
 * file with its gain. The editor's live preview and the renderer share it, so
 * what the preview plays is what the render draws.
 */
import { writeFileSync } from "fs";
import { join } from "path";
import { resolveAudio, type AudioReport } from "../audio-resolve";
import { reassemble } from "../pipeline/run";
import type { ShotSpec } from "../spec.schema";

export interface PreparedFilm {
  /** Spec with voice files and resolved sound: hand it to the Player or the renderer. */
  spec: ShotSpec;
  warnings: string[];
  audio: AudioReport;
  /** True when every voice line was measured from real audio. */
  measured: boolean;
}

export async function prepareFilm(id: string, opts: { voice: "measure" | "estimate" } = { voice: "measure" }): Promise<PreparedFilm> {
  const warnings: string[] = [];
  let re: Awaited<ReturnType<typeof reassemble>>;
  let measured = opts.voice === "measure";
  try {
    re = await reassemble(id, measured ? "render" : "plan");
  } catch (e) {
    if (!measured) throw e;
    // No voice engine here (or it failed): preview with estimated timing.
    warnings.push(`voice not synthesized (${(e as Error).message.slice(0, 160)}); timing is estimated`);
    re = await reassemble(id, "plan");
    measured = false;
  }
  warnings.push(...re.warnings);
  // The approved-plan file the render step reads keeps following the edits.
  writeFileSync(join(process.cwd(), "output", `${id}-spec.json`), JSON.stringify(re.spec, null, 2));
  const resolved = resolveAudio(re.spec, id);
  return { spec: resolved.spec, warnings, audio: resolved.report, measured };
}
