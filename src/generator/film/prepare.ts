/**
 * src/generator/film/prepare.ts — the current film as a playable spec.
 *
 * The same steps the render runs before drawing frames: rebuild the spec from
 * the stage files (voicing only lines the cache does not have yet, then
 * re-timing from the measured audio), and turn every sound cue into a library
 * file with its gain. The editor's live preview and the renderer share it, so
 * what the preview plays is what the render draws.
 *
 * Two Phase 4 modes:
 *   voice "measure"  — every line synthesized (cache hits cost nothing) and
 *                      the video timed from the real audio.
 *   voice "estimate" — the edit answers at once: cached lines keep their
 *                      measured length, only changed lines are estimated
 *                      (warning). The server re-measures in the background
 *                      (server/film.ts) and the UI refreshes when it lands.
 *
 * The editor's keep-timing caption wording (film.captions, saved with the
 * versions) is applied over the rebuilt captions with +-0.35 s window
 * matching — the voice and the window stay, only the words on screen change.
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { resolveAudio, type AudioReport } from "../audio-resolve";
import { reassemble } from "../pipeline/run";
import type { ShotSpec } from "../spec.schema";
import { applyCaptionOverrides } from "./diff";
import { captionOverrides } from "./store";

export interface PreparedFilm {
  /** Spec with voice files and resolved sound: hand it to the Player or the renderer. */
  spec: ShotSpec;
  warnings: string[];
  audio: AudioReport;
  /** True when every voice line was measured from real audio. */
  measured: boolean;
}

/** Is every line of the last voice stage measured (not an estimate)? */
function voiceAllMeasured(id: string, fallback: boolean): boolean {
  try {
    // voice.json is the voice stage's bare PlannedLine array (run.ts saves it directly).
    const parsed = JSON.parse(readFileSync(join(process.cwd(), "output", id, "voice.json"), "utf8")) as unknown;
    const lines: Array<{ estimated?: boolean }> = Array.isArray(parsed)
      ? parsed
      : (((parsed ?? {}) as { lines?: Array<{ estimated?: boolean }> }).lines ?? []);
    if (lines.length === 0) return fallback; // narration off (or nothing planned): nothing to measure
    return lines.every((l) => l.estimated !== true);
  } catch {
    return fallback;
  }
}

export async function prepareFilm(id: string, opts: { voice?: "measure" | "estimate" } = {}): Promise<PreparedFilm> {
  const voice = opts.voice ?? "measure";
  const warnings: string[] = [];
  let measured = voice === "measure";
  let re: Awaited<ReturnType<typeof reassemble>>;
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
  // The editor's keep-timing wording goes on top of the rebuilt captions.
  // Entries that no longer line up with a window stay saved on the film; they
  // can match again after the next re-timing (only this build drops them, and
  // the warning says so).
  const overrides = captionOverrides(id);
  if (overrides.length > 0) {
    const applied = applyCaptionOverrides(re.spec, overrides);
    if (applied < overrides.length) {
      warnings.push(
        `${overrides.length - applied} kept caption wording(s) no longer line up with a caption window (+-0.35 s after the re-timing) and were dropped from this build`,
      );
    }
  }
  // The approved-plan file the render step reads keeps following the edits.
  writeFileSync(join(process.cwd(), "output", `${id}-spec.json`), JSON.stringify(re.spec, null, 2));
  const resolved = resolveAudio(re.spec, id);
  // Honest answer in both modes: voice.json now marks only the genuinely
  // unmeasured lines, so an all-cache "estimate" answer IS measured (and an
  // already-measured film does not re-measure in a loop).
  measured = voiceAllMeasured(id, voice === "measure");
  return { spec: resolved.spec, warnings, audio: resolved.report, measured };
}
