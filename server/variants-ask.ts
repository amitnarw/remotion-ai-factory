/**
 * server/variants-ask.ts — the variants request's check (pure, no I/O), used
 * by POST /api/runs/:runId/variants (server/variants.ts).
 */
import { FORMATS, type VideoFormat } from "../src/generator/spec.schema";

/** Hooks and endings in all, the original counted (the CLI's limits). */
export const MAX_HOOKS = 4;
export const MAX_ENDINGS = 3;

export interface VariantsAsk {
  hooks: number;
  endings: number;
  /** The run's own format first, then the others asked for. */
  formats: VideoFormat[];
}

/**
 * The request's counts and formats, checked: hooks 1-4 and endings 1-3 (the
 * original counted), formats among the three, and at least one version that
 * differs from the run's own video. A script as written keeps its words, so
 * it varies only in format.
 */
export function checkVariantsAsk(
  body: { hooks?: unknown; endings?: unknown; formats?: unknown },
  run: { format: VideoFormat; asWritten: boolean },
): { ask: VariantsAsk } | { error: string; fix: string } {
  const count = (v: unknown, max: number, what: string): number | string => {
    if (v === undefined || v === null) return 1;
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= max ? n : `${what} must be a whole number from 1 to ${max} (1 is the original only)`;
  };
  const hooks = count(body.hooks, MAX_HOOKS, "hooks");
  if (typeof hooks === "string") return { error: hooks, fix: `Choose 1 to ${MAX_HOOKS} hooks` };
  const endings = count(body.endings, MAX_ENDINGS, "endings");
  if (typeof endings === "string") return { error: endings, fix: `Choose 1 to ${MAX_ENDINGS} endings` };
  const raw = body.formats === undefined || body.formats === null ? [] : body.formats;
  if (!Array.isArray(raw) || raw.some((f) => typeof f !== "string" || !(FORMATS as readonly string[]).includes(f))) {
    return { error: `formats must be a list of ${FORMATS.join(", ")}`, fix: "Tick the shapes you want" };
  }
  // The run's own format is always one of them.
  const formats = Array.from(new Set([run.format, ...(raw as VideoFormat[])]));
  if (run.asWritten && (hooks > 1 || endings > 1)) {
    return { error: "This story is your script as written, so its hook and ending stay your own words", fix: "Ask only for other shapes" };
  }
  if (hooks === 1 && endings === 1 && formats.length === 1) {
    return { error: "Nothing to make: every version would be the video you have", fix: "Ask for more hooks, more endings or another shape" };
  }
  return { ask: { hooks, endings, formats } };
}

/** The CLI's argument: hooks=3,endings=2,formats=9:16,16:9 */
export function variantsArg(ask: VariantsAsk): string {
  return `hooks=${ask.hooks},endings=${ask.endings},formats=${ask.formats.join(",")}`;
}
