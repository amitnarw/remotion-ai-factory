/**
 * src/generator/pipeline/captions.ts — on-screen captions from the timed lines.
 *
 * Pure. Each spoken line is cut into short chunks (by format, breaking at
 * syntactic boundaries so a phrase is never split across a comma or a
 * determiner). Every word gets a time, estimated from its share of the
 * line's characters within the line's measured duration. Word-by-word caption
 * animations use these times. The hook line gets no caption: the Hook card
 * shows it. Without a narrator, each beat's "say" becomes a caption over the beat.
 */
import type { VideoFormat } from "../spec.schema";
import type { Timeline, TimedLine } from "./timeline";
import type { WriterBeat } from "./writer";

export const CHUNK_CHARS: Record<VideoFormat, number> = { "9:16": 25, "1:1": 30, "16:9": 42 };

export interface Caption {
  text: string;
  from: number;
  to: number;
  keyword: string[];
  speaker?: string;
  words: Array<{ text: string; from: number; to: number }>;
}

const q = (sec: number) => Math.round(sec * 1000) / 1000;
const endsPhrase = (w: string) => /[.,!?;:]$/.test(w);

/** Words that must never end a caption chunk (determiners, prepositions, auxiliaries, pronouns, …). */
export const ILLEGAL_CHUNK_END = new Set([
  "a", "an", "the", "this", "that", "these", "those", "my", "your", "his", "her", "its", "our", "their",
  "some", "any", "every", "each", "no", "another", "both", "all", "half", "many", "few", "more", "most",
  "less", "much", "enough", "several",
  "of", "in", "on", "at", "by", "for", "with", "from", "into", "over", "under", "after", "before", "to",
  "than", "as",
  "is", "are", "was", "were", "am", "be", "been", "being", "has", "have", "had", "do", "does", "did",
  "will", "would", "can", "could", "should", "must",
  "i", "you", "he", "she", "it", "we", "they", "who", "which",
]);

const CLAUSE_SPLIT = /[,;:—]/;
const SENTENCE_SPLIT = /[.!?]+/;

/** Normalise a word for boundary checks: lowercase, strip punctuation. */
function norm(w: string): string {
  return w.toLowerCase().replace(/[^a-z0-9'-]/gu, "");
}

/** Is `w` a legal last word of a caption chunk? */
function isLegalChunkEnd(w: string): boolean {
  return !ILLEGAL_CHUNK_END.has(norm(w));
}

/** Is `w` a legal first word of a caption chunk (not an opening punctuation mark)? */
function isLegalChunkStart(w: string): boolean {
  return !/^[“"'(-]/.test(w);
}

/**
 * Group words into caption chunks using syntactic boundaries, not just size.
 *
 * 1. Split into sentences at [.!?] (punctuation stays attached).
 * 2. A short sentence (≤ maxChars and ≤ 6 words) is one chunk.
 * 3. Otherwise split at clause boundaries (, ; : —); a clause that fits is one chunk.
 * 4. Otherwise greedily accumulate words up to maxChars, breaking only at a
 *    legal boundary (never after a determiner/preposition/auxiliary/pronoun).
 * 5. Never emit a 1-word chunk unless the word is ≥ 6 chars and has a stress match.
 * 6. Merge a chunk shorter than 2 words into its neighbour inside the same sentence.
 */
export function chunkWords(
  words: string[],
  maxChars: number,
  stressMatches: Set<string> = new Set(),
): string[][] {
  const out: string[][] = [];

  // Split into sentences at [.!?].
  let sentence: string[] = [];
  const flushSentence = (sent: string[]) => {
    if (sent.length === 0) return;
    const text = sent.join(" ");
    if (text.length <= maxChars && sent.length <= 6) {
      out.push(sent);
      return;
    }
    // Split at clause boundaries.
    let clause: string[] = [];
    const flushClause = (cl: string[]) => {
      if (cl.length === 0) return;
      const ct = cl.join(" ");
      if (ct.length <= maxChars) {
        out.push(cl);
        return;
      }
      // Greedy-accumulate up to maxChars, breaking at legal boundaries.
      // Track the last legal break so we never exceed maxChars by much.
      let cur: string[] = [];
      let acc = 0;
      let lastLegal = -1; // index in cur of the last legal break point
      for (const w of cl) {
        const add = (cur.length ? 1 : 0) + w.length;
        if (cur.length && acc + add > maxChars) {
          if (lastLegal >= 0) {
            // Break at the last legal boundary.
            out.push(cur.slice(0, lastLegal + 1));
            const rest = cur.slice(lastLegal + 1);
            cur = [...rest, w];
            acc = 0;
            for (let x = 0; x < cur.length; x++) acc += (x ? 1 : 0) + cur[x].length;
            lastLegal = isLegalChunkEnd(cur[cur.length - 1]) ? cur.length - 1 : -1;
          } else if (isLegalChunkEnd(cur[cur.length - 1]) && isLegalChunkStart(w)) {
            // Can break right here.
            out.push(cur);
            cur = [w];
            acc = w.length;
            lastLegal = isLegalChunkEnd(w) ? 0 : -1;
          } else {
            // No legal break anywhere: break anyway rather than exceed maxChars.
            out.push(cur);
            cur = [w];
            acc = w.length;
            lastLegal = isLegalChunkEnd(w) ? 0 : -1;
          }
        } else {
          acc += add;
          cur.push(w);
          if (isLegalChunkEnd(w)) lastLegal = cur.length - 1;
        }
      }
      if (cur.length) out.push(cur);
    };
    for (const w of sent) {
      clause.push(w);
      if (CLAUSE_SPLIT.test(w)) {
        const cw = clause.pop()!; // the punctuation word stays with the clause
        flushClause(clause);
        clause = [cw];
      }
    }
    if (clause.length) flushClause(clause);
  };

  for (const w of words) {
    sentence.push(w);
    if (SENTENCE_SPLIT.test(w)) {
      flushSentence(sentence);
      sentence = [];
    }
  }
  if (sentence.length) flushSentence(sentence);

  // Post-process: never emit a 1-word chunk unless it's ≥ 6 chars with stress.
  // Don't merge a chunk whose last word ends in punctuation (a natural clause
  // boundary — "heavier," standing alone is fine).
  const merged: string[][] = [];
  for (let i = 0; i < out.length; i++) {
    const chunk = out[i];
    const isPunctuationEnd = endsPhrase(chunk[chunk.length - 1]);
    if (
      chunk.length === 1 &&
      !isPunctuationEnd &&
      !(chunk[0].length >= 6 && stressMatches.has(norm(chunk[0])))
    ) {
      // Merge into next chunk if there is one.
      if (i + 1 < out.length) {
        out[i + 1] = [...chunk, ...out[i + 1]];
      } else if (merged.length > 0) {
        merged[merged.length - 1] = [...merged[merged.length - 1], ...chunk];
      } else {
        merged.push(chunk);
      }
      continue;
    }
    merged.push(chunk);
  }
  return merged;
}

/**
 * Enforce readability floors on chunks using real/timed word durations:
 * - minimum 0.3 s per word; merge short chunks with the next one in the same line.
 * - maximum 20 CPS (chars / duration); extend display or merge if exceeded.
 *
 * Returns adjusted chunks with `from`/`to` set from wordTimes.
 */
export function enforceReadability(
  chunks: string[][],
  timed: Array<{ text: string; from: number; to: number }>,
): Array<{ text: string; from: number; to: number; words: typeof timed }> {
  const out: Array<{ text: string; from: number; to: number; words: typeof timed }> = [];
  let wordIdx = 0;

  for (const chunk of chunks) {
    if (wordIdx >= timed.length) break;
    const end = Math.min(wordIdx + chunk.length, timed.length);
    const chunkWords = timed.slice(wordIdx, end);
    wordIdx = end;
    if (chunkWords.length === 0) continue;

    const from = chunkWords[0].from;
    let to = chunkWords[chunkWords.length - 1].to;

    // Minimum 0.3 s per word.
    const minDur = chunk.length * 0.3;
    if (to - from < minDur) {
      // Merge with next chunk if available; otherwise extend.
      to = from + minDur;
    }

    // Maximum 20 CPS.
    const cps = chunk.join(" ").length / Math.max(to - from, 0.001);
    if (cps > 20) {
      const needed = chunk.join(" ").length / 20;
      to = Math.max(to, from + needed);
    }

    out.push({ text: chunk.join(" "), from: q(from), to: q(to), words: chunkWords });
  }

  // Hold each caption a little after its last word, never into the next one.
  for (let k = 0; k < out.length; k++) {
    const next = out[k + 1];
    const hold = out[k].to + 0.15;
    out[k].to = q(next ? Math.min(hold, next.from) : out[k].to);
    if (out[k].to <= out[k].from) out[k].to = q(out[k].from + 0.1);
  }

  return out;
}

function captionsForLine(
  line: Pick<TimedLine, "text" | "at" | "dur" | "kind" | "who">,
  maxChars: number,
  stress: string,
): Caption[] {
  const timed = wordTimes(line.text, line.at, line.dur);
  const words = timed.map((w) => w.text);
  const stressMatches = stress ? new Set<string>([norm(stress)]) : new Set<string>();

  const chunks = chunkWords(words, maxChars, stressMatches);
  const readable = enforceReadability(chunks, timed);

  return readable.map((c) => ({
    text: c.text,
    from: c.from,
    to: c.to,
    keyword: stressIn(c.text.split(/\s+/).filter(Boolean), stress),
    speaker: line.kind === "dialog" ? line.who : undefined,
    words: c.words,
  }));
}

export function buildCaptions(timeline: Timeline, beats: WriterBeat[], format: VideoFormat, narration: boolean): Caption[] {
  const maxChars = CHUNK_CHARS[format];
  const byId = new Map(beats.map((b) => [b.id, b]));
  const out: Caption[] = [];
  for (const tb of timeline.beats) {
    const beat = byId.get(tb.id);
    const stress = beat?.stress ?? "";
    if (tb.lines.length > 0) {
      for (const line of tb.lines) out.push(...captionsForLine(line, maxChars, stress));
    } else if (!narration && beat?.say) {
      // No narrator: the beat's text is shown as a caption across the beat.
      const at = tb.from + 0.2;
      const dur = Math.max(0.6, tb.to - tb.from - 0.4);
      out.push(...captionsForLine({ text: beat.say, at, dur, kind: "narration", who: "narrator" }, maxChars, stress));
    }
  }
  out.sort((a, b) => a.from - b.from);
  // Each caption stays a little after its last word, but never into the next one (across lines/beats).
  for (let k = 0; k < out.length; k++) {
    const next = out[k + 1];
    const hold = out[k].to + 0.15;
    out[k].to = q(next ? Math.min(hold, next.from) : Math.min(hold, timeline.duration));
    if (out[k].to <= out[k].from) out[k].to = q(out[k].from + 0.1);
  }
  return out;
}

/** Does a spoken word carry the stress word? Either may contain the other
 *  ("burst" matches "bursting" after a rewrite), with at least 4 letters. */
export function matchesStress(word: string, stress: string): boolean {
  const w = word.toLowerCase().replace(/[^a-z0-9]/g, "");
  const s = stress.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!w || !s) return false;
  if (w === s) return true;
  return Math.min(w.length, s.length) >= 4 && (w.includes(s) || s.includes(w));
}

function stressIn(words: string[], stress: string): string[] {
  const hit = words.find((w) => matchesStress(w, stress));
  return hit ? [hit.replace(/[^\p{L}\p{N}'-]/gu, "")] : [];
}

/** Word times inside one line: weight = characters (+3 for a trailing pause). */
export function wordTimes(text: string, at: number, dur: number): Array<{ text: string; from: number; to: number }> {
  const words = text.split(/\s+/).filter(Boolean);
  const weights = words.map((w) => w.length + (endsPhrase(w) ? 3 : 0));
  const total = weights.reduce((s, v) => s + v, 0) || 1;
  let acc = 0;
  return words.map((w, i) => {
    const from = at + (dur * acc) / total;
    acc += weights[i];
    return { text: w, from: q(from), to: q(at + (dur * acc) / total) };
  });
}
