/**
 * src/generator/film/diff.ts — what an approved spec changed, and how it is
 * applied back (Phase 4, keep-timing vs reflow).
 *
 * The editor PUTs its (edited) spec to /api/film/:id. This module reads the
 * diff between that spec and the film's own state:
 *
 *   - story wording (hook, a beat's say, a character line) -> edits that go
 *     through the versioned film store: re-voices only the changed lines
 *     (the voice cache reuses the rest) and re-times ("reflow");
 *   - caption wording -> keep-timing overrides saved on the film
 *     (film.captions, applied over the rebuilt captions in prepareFilm):
 *     the voice and the timing windows stay, only the words on screen change.
 *
 * Pure, no server imports, so it can be checked on its own (diff.test.ts).
 */
import type { ShotSpec } from "../spec.schema";
import { wordTimes } from "../pipeline/captions";
import type { CaptionOverride, Edit, Film } from "./edits";

export interface TextChange {
  path: string;
  before: string;
  after: string;
}

export interface CaptionChange {
  /** Window start of the caption AS BUILT (the base spec's from). */
  from: number;
  before: string;
  after: string;
  keyword?: string[];
}

export interface FilmDiff {
  /** Story wording changes ("reflow": adopt + re-voice + re-time). */
  texts: TextChange[];
  /** Caption wording changes ("keep timing": voice and window stay). */
  captions: CaptionChange[];
}

interface StoryBeatLike {
  id?: string;
  say?: string;
  lines?: Array<{ who?: string; text?: string }>;
}

/**
 * Narration-wording diff between the film (source of truth) and the approved
 * spec: the hook and each beat's say (edits are written the way film/edits.ts
 * reads them: beats by id). Character DIALOG lines are deliberately NOT
 * diffed here: the approved (playable) spec's timed lines include narrator
 * lines that the film's dialog-only lines list does not contain, so a lines
 * diff would read narrator lines as speaker changes; dialog wording edits go
 * through POST /edit (one validated set per line, same fast re-voice).
 */
export function diffTextEdits(film: Film, put: ShotSpec): TextChange[] {
  const out: TextChange[] = [];
  const story = put.story;
  if (typeof story?.hook === "string" && story.hook !== film.story.hook) {
    out.push({ path: "story.hook", before: film.story.hook, after: story.hook });
  }
  const baseBeats = new Map<string, StoryBeatLike>(film.story.beats.map((b) => [b.id, b as StoryBeatLike]));
  for (const b of (story?.beats ?? []) as StoryBeatLike[]) {
    const base = b.id ? baseBeats.get(b.id) : undefined;
    if (!base) continue; // the film decides the beat list; unknown ids are noise
    if (typeof b.say === "string" && b.say !== base.say) {
      out.push({ path: "story.beats[" + b.id + "].say", before: base.say ?? "", after: b.say });
    }
  }
  return out;
}

/** The versioned edits for a text diff (each becomes one set). */
export function editsFromTextDiff(texts: TextChange[]): Edit[] {
  return texts.map((t) => ({ op: "set" as const, path: t.path, value: t.after }));
}

/**
 * Caption-wording diff: the approved spec vs the last prepared spec. Matching
 * by index is right here: both arrays are the build's caption list in story
 * order, and only texts (plus keywords) can differ within one window.
 */
export function diffCaptions(base: ShotSpec | null, put: ShotSpec): CaptionChange[] {
  const baseCaps = base?.captions ?? [];
  const putCaps = put.captions ?? [];
  const out: CaptionChange[] = [];
  const n = Math.min(baseCaps.length, putCaps.length);
  for (let i = 0; i < n; i++) {
    const before = baseCaps[i];
    const after = putCaps[i];
    if (!after || !before || after.text === before.text) continue;
    out.push({ from: before.from, before: before.text, after: after.text, keyword: after.keyword });
  }
  return out;
}

/** Keep-timing overrides for the film: the newer wording wins on the same window. */
const overrideKey = (from: number): number => Math.round(from * 10) / 10;

export function mergeOverrides(old: CaptionOverride[] | undefined, adds: CaptionChange[]): CaptionOverride[] {
  const map = new Map<number, CaptionOverride>();
  for (const o of old ?? []) map.set(overrideKey(o.from), o);
  for (const c of adds) map.set(overrideKey(c.from), { from: c.from, text: c.after, keyword: c.keyword });
  return [...map.values()].filter((o) => typeof o.text === "string" && Number.isFinite(o.from));
}

/**
 * When a beat's narration is adopted (reflow), that beat's captions follow
 * the story again: a keep-timing override inside the beat's window would
 * otherwise clobber the NEW story text on screen. Drop those (every other
 * kept wording survives). Windows come from the timed spec's beats.
 */
export function dropOverridesForBeats(
  overrides: CaptionOverride[] | undefined,
  windows: Array<{ from: number; to: number }>,
): CaptionOverride[] {
  if (!overrides?.length) return [];
  return overrides.filter((o) => !windows.some((w) => o.from >= w.from - 0.2 && o.from <= w.to + 0.35));
}

/**
 * Apply the keep-timing wording over the freshly built captions (a re-timing
 * may have moved a window slightly; +-0.35 s is the same caption, the rule
 * keepCaptionTexts in pipeline/run.ts uses). Returns how many applied.
 */
export function applyCaptionOverrides(spec: ShotSpec, overrides: CaptionOverride[] | undefined): number {
  if (!overrides?.length) return 0;
  let applied = 0;
  for (const o of overrides) {
    let best: { text: string; from: number; to: number; keyword?: string[]; words?: unknown } | null = null;
    let bestD = Infinity;
    for (const c of spec.captions ?? []) {
      const d = Math.abs(c.from - o.from);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (!best || bestD > 0.35 || best.text === o.text) continue;
    best.text = o.text;
    best.keyword = o.keyword ?? best.keyword;
    best.words = wordTimes(o.text, best.from, best.to);
    applied += 1;
  }
  return applied;
}
