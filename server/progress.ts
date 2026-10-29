/**
 * server/progress.ts — a job's stage and progress from the CLI's output.
 * Pure, so it can be checked on its own (progress.test.ts).
 *
 * Plan jobs follow the pipeline's "@@STAGE <name>" markers only (each stage
 * has its own floor, PLAN_PROGRESS). Render jobs also read the CLI's traces
 * ([1/5], [voice], [3/5], [5/5]) and Remotion's own lines (Bundling n%,
 * Rendered n/m, Encoded n/m). Either way the bar never goes backwards: a
 * "[voice]" line printed late in a later stage must not pull it back.
 */

/** Plan jobs: the progress each pipeline stage starts at. */
export const PLAN_PROGRESS: Record<string, number> = { writer: 10, voice: 30, director: 50, sound: 70, critic: 80, assemble: 90 };

/** Render jobs: the order of the stages the log heuristics can move to. */
const RENDER_ORDER = ["script", "voice", "assemble", "bundle", "render", "encode"];

export interface LogSignal {
  stage?: string;
  pct?: number;
  eta?: number;
}

/** The "@@STAGE <name>" marker on one line, if any. */
export function stageMarker(line: string): string | null {
  const m = /^@@STAGE\s+(\w+)/.exec(line.trim());
  return m ? m[1] : null;
}

/** What one chunk of a render job's output says about its stage, progress and ETA. */
export function readRenderLog(text: string): LogSignal {
  const rend = text.match(/Rendered\s+(\d+)\/(\d+)/);
  if (rend) {
    const out: LogSignal = { stage: "render", pct: 25 + (parseInt(rend[1], 10) / parseInt(rend[2], 10)) * 67 };
    const em = text.match(/time remaining:\s*(?:(\d+)m\s*([\d.]+)s|([\d.]+)s)/);
    if (em) out.eta = em[1] ? parseInt(em[1], 10) * 60 + parseFloat(em[2]) : parseFloat(em[3]);
    return out;
  }
  if (text.includes("[1/5]")) return { stage: "script" };
  if (text.includes("[voice]")) return { stage: "voice", pct: 12 };
  // The CLI's own trace line marks the true bundle start; Remotion's
  // "Bundling N%" lines only appear after esbuild's silent work.
  if (text.includes("[3/5]")) return { stage: "bundle" };
  if (text.includes("Getting composition")) return { stage: "render" };
  if (text.includes("[5/5]")) return { stage: "encode" };
  const bund = text.match(/Bundling\s+(\d+)%/);
  if (bund) return { stage: "bundle", pct: 15 + parseInt(bund[1], 10) * 0.1 };
  const enc = text.match(/Encoded\s+(\d+)\/(\d+)/);
  if (enc) return { stage: "encode", pct: 92 + (parseInt(enc[1], 10) / parseInt(enc[2], 10)) * 7 };
  return {};
}

/** May a log heuristic move a render job from `current` to `next`? Only forwards. */
export function isLaterStage(current: string, next: string): boolean {
  if (current === next) return false;
  const a = RENDER_ORDER.indexOf(current);
  const b = RENDER_ORDER.indexOf(next);
  return a === -1 || b === -1 || b > a;
}

/** The next progress: never below the current one, and below 100 until the job is done. */
export function nextProgress(current: number, candidate: number | undefined): number {
  if (candidate === undefined || !Number.isFinite(candidate)) return current;
  return Math.max(current, Math.min(99, Math.round(candidate)));
}
