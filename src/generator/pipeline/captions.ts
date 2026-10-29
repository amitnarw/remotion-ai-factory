/**
 * src/generator/pipeline/captions.ts — on-screen captions from the timed lines.
 *
 * Pure. Each spoken line is cut into short chunks (by format, breaking at
 * punctuation) and every word gets a time, estimated from its share of the
 * line's characters within the line's measured duration. Word-by-word caption
 * animations use these times. The hook line gets no caption: the Hook card
 * shows it. Without a narrator, each beat's "say" becomes a caption over the beat.
 */
import type { VideoFormat } from "../spec.schema";
import type { Timeline, TimedLine } from "./timeline";
import type { WriterBeat } from "./writer";

export const CHUNK_CHARS: Record<VideoFormat, number> = { "9:16": 18, "1:1": 24, "16:9": 40 };

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

/**
 * Group words into caption chunks: first at punctuation (a phrase is never
 * split across a comma), then each long phrase into chunks of about equal
 * length, so "feels heavier," stays together instead of "heavier, then it".
 */
export function chunkWords(words: string[], maxChars: number): string[][] {
  const phrases: string[][] = [];
  let cur: string[] = [];
  for (const w of words) {
    cur.push(w);
    if (endsPhrase(w)) {
      phrases.push(cur);
      cur = [];
    }
  }
  if (cur.length) phrases.push(cur);

  const out: string[][] = [];
  for (const p of phrases) {
    const text = p.join(" ");
    if (text.length <= maxChars) {
      out.push(p);
      continue;
    }
    const n = Math.ceil(text.length / maxChars);
    const target = text.length / n;
    let chunk: string[] = [];
    let acc = 0;
    let made = 0;
    for (const w of p) {
      const add = (chunk.length ? 1 : 0) + w.length;
      const closer = Math.abs(acc - target) < Math.abs(acc + add - target);
      if (chunk.length && (acc + add > maxChars || (made < n - 1 && closer))) {
        out.push(chunk);
        made += 1;
        chunk = [];
        acc = 0;
      }
      acc += (chunk.length ? 1 : 0) + w.length;
      chunk.push(w);
    }
    if (chunk.length) out.push(chunk);
  }
  return out;
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

function captionsForLine(line: Pick<TimedLine, "text" | "at" | "dur" | "kind" | "who">, maxChars: number, stress: string): Caption[] {
  const timed = wordTimes(line.text, line.at, line.dur);
  const out: Caption[] = [];
  let i = 0;
  for (const chunk of chunkWords(timed.map((w) => w.text), maxChars)) {
    const words = timed.slice(i, i + chunk.length);
    i += chunk.length;
    out.push({
      text: chunk.join(" "),
      from: words[0].from,
      to: words[words.length - 1].to,
      keyword: stressIn(chunk, stress),
      speaker: line.kind === "dialog" ? line.who : undefined,
      words,
    });
  }
  return out;
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
  // Each caption stays a little after its last word, but never into the next one.
  out.sort((a, b) => a.from - b.from);
  for (let k = 0; k < out.length; k++) {
    const next = out[k + 1];
    const hold = out[k].to + 0.15;
    out[k].to = q(next ? Math.min(hold, next.from) : Math.min(hold, timeline.duration));
    if (out[k].to <= out[k].from) out[k].to = q(out[k].from + 0.1);
  }
  return out;
}
