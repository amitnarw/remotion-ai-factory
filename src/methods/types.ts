/**
 * src/methods/types.ts — the one interface every video method implements,
 * plus the method catalogue both the server and the UI read.
 *
 * A "method" is the thing that draws the picture for a whole video. There are
 * three and they never mix (docs/factory/23-visual-methods.md §1):
 *
 *   factory    — today's Remotion stage kits (default)
 *   animation  — the hand-coded WebGL film renderer
 *   lemo       — the 99-style library, auto-chosen per segment
 *
 * What is shared across all three lives in src/shared/ (spec types, timing,
 * audio, subtitles, mux). What a method owns is its picture: renderer, scenes,
 * palette, type, grain, transitions. No method imports another method's code;
 * src/methods/isolation.test.ts fails the build if one does.
 *
 * This file is pure (no renderer, no fs, no node built-ins) so the UI can
 * import the catalogue without pulling in a renderer.
 */
import type { MethodId, ShotSpec } from "../generator/spec.schema";

export { METHODS, LEMO_STYLE_MODES } from "../generator/spec.schema";
export type { LemoStyleMode, MethodId } from "../generator/spec.schema";

/** What a UI or CLI needs to know about a method, without its renderer. */
export interface MethodInfo {
  id: MethodId;
  label: string;
  /** One sentence, for a card or a CLI line. */
  summary: string;
  /** True once the method can render. One source of truth for UI and tests. */
  available: boolean;
  /** Why it is unavailable (shown while a method is still being built). */
  note?: string;
}

export const METHOD_INFO: Record<MethodId, MethodInfo> = {
  factory: {
    id: "factory",
    label: "Factory",
    summary: "The original Remotion stage kits.",
    available: true,
  },
  animation: {
    id: "animation",
    label: "Animation",
    summary: "Hand-coded 3D film with a real camera.",
    available: false,
    note: "Not built yet — docs/factory/23-visual-methods.md Phase 3.",
  },
  lemo: {
    id: "lemo",
    label: "Lemo",
    summary: "99 library styles, chosen per part of the story.",
    available: false,
    note: "Not built yet — docs/factory/23-visual-methods.md Phases 4–7.",
  },
};

export interface MethodContext {
  /** The fully validated spec (timing, audio files, captions all resolved). */
  spec: ShotSpec;
  /** The run id: output/<run>/ is this method's working directory. */
  runId: string;
  /** The run directory (output/<run>). */
  runDir: string;
  /** Where the method writes its silent video. */
  out: string;
  /** draft = half scale, final = full. */
  quality: "draft" | "final";
  /** The run's audio track, already rendered and mastered. Read-only. */
  audioWav?: string;
  /** Progress in frames, so the UI's job parser keeps working. */
  onProgress?: (done: number, total: number) => void;
  log: (line: string) => void;
}

export interface MethodResult {
  /** The silent video (H.264, exact frames, no audio stream). */
  path: string;
  frames: number;
  method: MethodId;
  /** Free-form facts for the run's manifest: style, recipe, media used. */
  meta: Record<string, unknown>;
}

export interface MethodImpl {
  id: MethodId;
  /** Mirrors METHOD_INFO[id] — a test keeps them in step. */
  summary: string;
  available: boolean;
  /** Renders exactly videoFrames(spec) frames of silent video. */
  render(ctx: MethodContext): Promise<MethodResult>;
}
