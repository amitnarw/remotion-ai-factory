/**
 * src/generator/pipeline/claims.ts — a story's factual claims need support
 * (docs/factory/15-producer.md §18). Borrowed from a motion-design system's
 * rule that "a 240% lift" must come from real data.
 *
 *   1. code      finds the spoken sentences with a specific figure or a
 *                factual marker: numbers, dates, records, "scientists say",
 *                named real people or events (findClaims; no model)
 *   2. a model   (the critic role's) judges each one: "known" (common
 *                knowledge), "speculative" (fine in a what-if when framed as
 *                one) or "source" (needs a source), with a suggested rewording
 *   3. by channel (the profile's id or genre, claimsPolicy):
 *                strict   documentary: a flagged claim goes to the writer, once,
 *                         and code puts the new sentence in place of the old
 *                note     what-if and any other non-fiction: listed only
 *                skip     drama, action and other fiction: no real-world claims
 *
 * It never blocks the run. When nothing is flagged it changes nothing: no
 * warning, the same story. Saved as output/<run>/story.claims.json by the
 * run's "claims" stage, and listed at the story gate and on the dashboard's
 * story review. The call from run.ts is one line: claimsStage(...).
 */
import { z } from "zod";
import type { ChannelProfile } from "../ai/channels";
import { asArray, callRole, fuzzyEnum, type RoleModel } from "./llm";
import { stableHash } from "./manifest";
import type { WriterStory } from "./writer";

export type ClaimsPolicy = "strict" | "note" | "skip";
export const VERDICTS = ["known", "speculative", "source"] as const;
export type ClaimVerdict = (typeof VERDICTS)[number];

/** What code saw in a sentence. */
export type ClaimMarker = "figure" | "date" | "record" | "authority" | "person" | "event" | "name";

/** A spoken sentence that may state a real-world fact (found by code). */
export interface ClaimSentence {
  /** c1, c2, ... in story order. */
  id: string;
  /** "hook" or the beat id. */
  beat: string;
  /** Where in the beat: its narration, or a character's line (by its index in `lines`). */
  where: "hook" | "say" | { line: number };
  sentence: string;
  markers: ClaimMarker[];
}

/** One judged claim, as the gate lists it. */
export interface ClaimRow {
  id: string;
  beat: string;
  sentence: string;
  /** The claim in a few words. */
  claim: string;
  verdict: ClaimVerdict;
  /** Speculative, but told as a what-if or a guess (not as fact). */
  framed: boolean;
  /** A suggested rewording ("" when none is needed). */
  reword: string;
  markers: ClaimMarker[];
  /** A claim needing a source, or speculation told as fact. */
  flagged: boolean;
  /** Strict channels: the writer's new sentence, now in the story. */
  rewritten?: string;
}

export interface ClaimsCheck {
  channel: string;
  policy: ClaimsPolicy;
  claims: ClaimRow[];
  flagged: number;
  /** Strict: what the writer's one fix changed, and the story it made (stableHash), so the fix is never asked twice. */
  fixed?: { beats: string[]; story: string };
}

/* ---------------- the channel's policy ---------------- */

/** By the profile's existing id and genre: documentary strict, what-if notes, fiction skips. */
export function claimsPolicy(p: Pick<ChannelProfile, "id" | "genre">): ClaimsPolicy {
  const s = `${p.id} ${p.genre}`;
  if (/documentar/i.test(s)) return "strict";
  if (/what-?if/i.test(s)) return "note";
  if (/drama|action|story|fiction|thriller|comedy|horror|fantasy/i.test(s)) return "skip";
  return "note";
}

/* ---------------- 1. code finds the sentences ---------------- */

const ABBREV = /\b(?:Dr|Mr|Mrs|Ms|St|Prof|Gen|Lt|Sgt|Capt|Mt|vs|etc|approx|No|U\.S|e\.g|i\.e)\.$/i;

/** A text's sentences (a decimal point or an abbreviation does not end one). */
export function sentences(text: string): string[] {
  const parts = text.trim().split(/(?<=[.!?…]["'”’)]?)\s+(?=["'“‘(]?[A-Z0-9])/);
  const out: string[] = [];
  for (const p of parts) {
    if (out.length && ABBREV.test(out[out.length - 1])) out[out.length - 1] += ` ${p}`;
    else if (p.trim()) out.push(p.trim());
  }
  return out;
}

const MONTH = "January|February|March|April|May|June|July|August|September|October|November|December";
const NUMBER_WORD = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety";
const UNIT = "centimet|millimet|met(?:re|er)|kilomet|mile|kilo|gram|ton|degree|percent|per cent|year|centur|decade|feet|foot|inch|litre|liter|calorie|volt|light-year";

const MARKERS: Array<[ClaimMarker, RegExp]> = [
  ["figure", /\d|%|\b(?:hundreds?|thousands?|millions?|billions?|trillions?|dozens?|percent|per cent|half of|a third of|a quarter of|twice as|times (?:more|less|faster|slower|bigger|larger|smaller|as))\b/i],
  ["figure", new RegExp(`\\b(?:${NUMBER_WORD})\\s+(?:${UNIT})`, "i")],
  ["date", new RegExp(`\\b(?:${MONTH})\\b|\\b(?:1[0-9]{3}|20[0-9]{2})s?\\b|\\bcentury\\b|\\b(?:in|since|until|by) the (?:twenties|thirties|forties|fifties|sixties|seventies|eighties|nineties)\\b`)],
  ["record", /\b(?:world'?s|records?|ever recorded|on record|in (?:recorded )?history|largest|biggest|tallest|highest|deepest|longest|oldest|fastest|hottest|coldest|richest|deadliest|most (?:visited|famous|common|popular)|first (?:person|man|woman|ever|to))\b/i],
  ["authority", /\b(?:scientists?|researchers?|experts?|economists?|physicists?|biologists?|astronomers?|psychologists?|studies|study shows?|research|historians?|doctors?|statistics|surveys?|according to|evidence|proven|proves|officially|it is a fact|a fact that|data (?:shows?|says?))\b/i],
  ["authority", /\b(?:NASA|CERN|UNESCO|WHO|the UN)\b/],
  ["person", /\b(?:Dr|Professor|Prof|President|King|Queen|Emperor|Empress|Pope|Sir|General|Saint|Pharaoh|Prime Minister)\.?\s+[A-Z][a-z]+/],
  ["event", /\b(?:war|revolution|battle|treaty|earthquake|eruption|plague|pandemic|olympics|moon landing|empire|dynasty|independence|tsunami|famine|the great (?:fire|flood|depression))\b/i],
];

/** Capitalized names inside a sentence (not its first word, not the story's own characters): "Marie Curie", "World War II". */
function namedThings(sentence: string, cast: Set<string>): boolean {
  const body = sentence.replace(/^\W*\S+/, "");
  const names = body.match(/\b[A-Z][a-z]+(?:\s+(?:of\s+|the\s+|de\s+)?[A-Z][a-zA-Z]+)+/g) ?? [];
  const speaks = /\b([A-Z][a-z]{2,})\s+(?:said|says|wrote|discovered|invented|proved|claimed|found|built|founded|painted|declared)\b/.exec(body);
  return names.some((n) => !n.split(/\s+/).every((w) => cast.has(w))) || (!!speaks && !cast.has(speaks[1]));
}

/** The spoken sentences that may state a real-world fact, in story order. Code only, exact. */
export function findClaims(story: WriterStory, max = 24): ClaimSentence[] {
  const cast = new Set(story.characters.flatMap((c) => c.name.split(/\s+/)));
  const out: ClaimSentence[] = [];
  const look = (beat: string, where: ClaimSentence["where"], text: string) => {
    for (const sentence of sentences(text)) {
      const markers = [...new Set(MARKERS.filter(([, re]) => re.test(sentence)).map(([m]) => m))];
      if (!markers.includes("person") && namedThings(sentence, cast)) markers.push("name");
      if (markers.length) out.push({ id: `c${out.length + 1}`, beat, where, sentence, markers });
    }
  };
  if (story.hookVoiced !== false) look("hook", "hook", story.hook);
  for (const b of story.beats) {
    look(b.id, "say", b.say);
    b.lines.forEach((l, i) => look(b.id, { line: i }, l.text));
  }
  return out.slice(0, max);
}

/* ---------------- 2. the critic's model judges them ---------------- */

/** The judge's verdicts, plus "none": the sentence states no real-world fact after all (dropped). */
const JUDGED = [...VERDICTS, "none"] as const;

const JudgeSchema = z.object({
  claims: z.array(
    z.object({ id: z.string(), claim: z.string(), verdict: z.enum(JUDGED), framed: z.boolean(), reword: z.string() }),
  ),
});

const VERDICT_ALIASES: Record<string, (typeof JUDGED)[number]> = {
  "not-a-claim": "none", "no-claim": "none", fiction: "none", invented: "none",
  common: "known", "common-knowledge": "known", supported: "known", fact: "known", true: "known",
  speculation: "speculative", guess: "speculative", hypothetical: "speculative",
  check: "source", "needs-a-source": "source", "needs-source": "source", unsupported: "source", doubtful: "source", false: "source", wrong: "source",
};

function verdictOf(v: unknown): (typeof JUDGED)[number] | undefined {
  const s = typeof v === "string" ? v.toLowerCase().trim().replace(/[\s_]+/g, "-") : String(v ?? "");
  return VERDICT_ALIASES[s] ?? fuzzyEnum(s, JUDGED);
}

/** The judge's prompt: the found sentences with their beats. */
export function claimsPrompt(found: ClaimSentence[], story: WriterStory, p: ChannelProfile, policy: ClaimsPolicy): string {
  const isWhatIf = policy === "note" && /what-?if/i.test(`${p.id} ${p.genre}`);
  const whatIf = isWhatIf
    ? `This whole video imagines a what-if: its consequences are speculation by design. A speculative sentence told as part of the what-if (a consequence of the premise, "would", "could", "imagine") is "framed": true and fine. Told as a fact about the real world, it is "framed": false.`
    : `This video states facts: speculation is fine only when the sentence says it is uncertain ("may", "some researchers think"), then "framed": true; told as fact, "framed": false.`;
  return `Check the factual claims in this ${p.genre} video before it is filmed. You have no web access: judge from what is widely known.
For each sentence below:
- "verdict": "known" when common knowledge supports it (what any encyclopedia agrees on); "speculative" when it is a guess, an extrapolation or an imagined consequence; "source" when a specific figure, date, record, quote or attribution would need a source to be stated as fact, or is doubtful or wrong; "none" when it states no real-world fact after all (a figure of speech, the story's own invented detail).
- "framed": ${whatIf}
- "claim": the claim in a few words.
- "reword": for "source", or "speculative" not framed, the sentence said again within what is widely known (round or drop the figure, attribute it, say it is uncertain${isWhatIf ? ", or tell it as part of the what-if" : ""}), in the story's voice and about as long; otherwise "".

TITLE: "${story.title}"
${found.map((c) => `${c.id} (${c.beat}): "${c.sentence}"`).join("\n")}

JSON shape: { "claims": [{ "id": "c1", "claim": "...", "verdict": "source", "framed": false, "reword": "..." }] }`;
}

/** Flagged: a claim needing a source, or speculation told as fact. */
export function isFlagged(r: Pick<ClaimRow, "verdict" | "framed">): boolean {
  return r.verdict === "source" || (r.verdict === "speculative" && !r.framed);
}

/** Ask the critic's model about the sentences code found. */
export async function judgeClaims(input: {
  found: ClaimSentence[];
  story: WriterStory;
  profile: ChannelProfile;
  policy: ClaimsPolicy;
  models: Record<string, RoleModel>;
}): Promise<ClaimRow[]> {
  const { found } = input;
  if (!found.length) return [];
  const ids = new Set(found.map((c) => c.id));
  const result = await callRole({
    role: "critic",
    label: "claims",
    system: `${input.profile.critic.intro}\nYou check the factual claims of a story before it is filmed. You never rewrite the story: you judge each claim and suggest a rewording.\nReply with JSON only.`,
    prompt: claimsPrompt(found, input.story, input.profile, input.policy),
    schema: JudgeSchema,
    models: input.models,
    normalize: (raw) => {
      const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      return {
        claims: asArray<Record<string, unknown>>(o.claims ?? o.verdicts ?? o.sentences ?? raw)
          .map((c) => {
            const id = String(c.id ?? c.sentence_id ?? "").trim().toLowerCase();
            return {
              id: /^\d+$/.test(id) ? `c${id}` : id,
              claim: String(c.claim ?? c.summary ?? c.text ?? "").trim(),
              verdict: verdictOf(c.verdict ?? c.status),
              framed: c.framed === true || c.framed === "true",
              reword: String(c.reword ?? c.rewording ?? c.suggestion ?? "").trim(),
            };
          })
          .filter((c) => ids.has(c.id)),
      };
    },
    essential: (v) => {
      const got = new Set(v.claims.map((c) => c.id));
      const missing = found.filter((c) => !got.has(c.id)).map((c) => c.id);
      return missing.length ? `judge every sentence; missing: ${missing.join(", ")}` : null;
    },
  });
  const byId = new Map(result.value.claims.map((c) => [c.id, c]));
  const rows: ClaimRow[] = [];
  for (const c of found) {
    const j = byId.get(c.id);
    if (!j || j.verdict === "none") continue;
    const verdict: ClaimVerdict = j.verdict;
    const flagged = isFlagged({ verdict, framed: j.framed });
    rows.push({ id: c.id, beat: c.beat, sentence: c.sentence, claim: j.claim || c.sentence, verdict, framed: j.framed, reword: flagged ? j.reword : "", markers: c.markers, flagged });
  }
  return rows;
}

/* ---------------- 3. strict channels: the writer fixes them, once ---------------- */

const FixSchema = z.object({ sentences: z.array(z.object({ id: z.string(), text: z.string().min(3) })) });

/** Put `to` in place of the sentence `from` where code found it. Unchanged when it is not there. */
function replaceSentence(story: WriterStory, c: ClaimSentence, to: string): WriterStory {
  const swap = (text: string) => (text.includes(c.sentence) ? text.replace(c.sentence, () => to) : text);
  if (c.where === "hook") return { ...story, hook: swap(story.hook) };
  const where = c.where;
  return {
    ...story,
    beats: story.beats.map((b) =>
      b.id !== c.beat ? b : where === "say" ? { ...b, say: swap(b.say) } : { ...b, lines: b.lines.map((l, i) => (i === where.line ? { ...l, text: swap(l.text) } : l)) },
    ),
  };
}

/** The writer rewrites only the flagged sentences; code puts each in place of the old one. One call, never repeated. */
export async function fixClaims(input: {
  story: WriterStory;
  found: ClaimSentence[];
  rows: ClaimRow[];
  profile: ChannelProfile;
  models: Record<string, RoleModel>;
}): Promise<{ story: WriterStory; rows: ClaimRow[] }> {
  const flagged = input.rows.filter((r) => r.flagged);
  if (!flagged.length) return { story: input.story, rows: input.rows };
  const ids = new Set(flagged.map((r) => r.id));
  const prompt = `A fact check of your ${input.profile.genre} script found sentences that state as fact what would need a source, and the video cannot cite one. Rewrite ONLY these sentences, each about as long as it is and in the same voice, keeping what the beat is about: keep to what is widely known, round or drop the figure, attribute it, or say it is uncertain.
${flagged.map((r) => `${r.id} (${r.beat}): "${r.sentence}"\n  problem: ${r.verdict === "source" ? "needs a source" : "speculation told as fact"} (${r.claim})${r.reword ? `\n  suggested: "${r.reword}"` : ""}`).join("\n")}

Reply as { "sentences": [{ "id": "c2", "text": "the new sentence" }] }.`;
  const result = await callRole({
    role: "writer",
    label: "writer-claims",
    system: "You are the writer of a short video script. Reply with JSON only.",
    prompt,
    schema: FixSchema,
    models: input.models,
    normalize: (raw) => {
      const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      return {
        sentences: asArray<Record<string, unknown>>(o.sentences ?? o.edits ?? raw)
          .map((e) => ({ id: String(e.id ?? "").trim().toLowerCase(), text: String(e.text ?? e.sentence ?? e.say ?? "").trim() }))
          .filter((e) => ids.has(e.id) && e.text),
      };
    },
  });
  const byFound = new Map(input.found.map((c) => [c.id, c]));
  let story = input.story;
  const done = new Map<string, string>();
  for (const e of result.value.sentences) {
    const c = byFound.get(e.id);
    if (!c || e.text === c.sentence) continue;
    const next = replaceSentence(story, c, e.text);
    if (next !== story && stableHash(next) !== stableHash(story)) {
      story = next;
      done.set(e.id, e.text);
    }
  }
  return { story, rows: input.rows.map((r) => (done.has(r.id) ? { ...r, rewritten: done.get(r.id) } : r)) };
}

/* ---------------- the stage ---------------- */

/** What the stage depends on (its input hash in run.json): the story, and the channel's words the judge reads. */
export function claimsInputs(story: WriterStory, profile: ChannelProfile): unknown {
  return { story, channel: profile.id, genre: profile.genre, intro: profile.critic.intro, policy: claimsPolicy(profile) };
}

/** The flagged claims as plan warnings (none flagged: none). */
export function claimsWarnings(c: ClaimsCheck | null): string[] {
  if (!c?.flagged) return [];
  const fixed = c.claims.filter((r) => r.rewritten).length;
  const open = c.claims.filter((r) => r.flagged && !r.rewritten);
  const out: string[] = [];
  if (fixed) out.push(`the writer reworded ${fixed} claim(s) that needed a source (story.claims.json)`);
  if (open.length) {
    const what = c.policy === "note" ? "may need a source or a what-if framing" : "need a source";
    out.push(`${open.length} claim(s) ${what}: ${open.map((r) => `${r.beat} "${r.claim}"`).join("; ")} (story.claims.json)`);
  }
  return out;
}

/**
 * The run's "claims" stage in one call. Skip channels make no call; a story
 * with no sentence code finds makes no call. A strict channel's flagged
 * claims go to the writer once, unless `rewrite` is false (an approved
 * story, the user's own script): then they are listed only. `previous` is
 * the saved story.claims.json: the story this stage already fixed is kept
 * as it is, with no call.
 */
export async function claimsStage(input: {
  story: WriterStory;
  profile: ChannelProfile;
  models: Record<string, RoleModel>;
  /** false: never change a word (an approved story, as written). */
  rewrite: boolean;
  previous?: ClaimsCheck | null;
}): Promise<{ check: ClaimsCheck | null; story: WriterStory; warnings: string[] }> {
  const { story, profile } = input;
  const policy = claimsPolicy(profile);
  if (policy === "skip") return { check: null, story, warnings: [] };
  if (input.previous?.fixed && input.previous.fixed.story === stableHash(story)) {
    return { check: input.previous, story, warnings: claimsWarnings(input.previous) };
  }
  const found = findClaims(story);
  let rows = await judgeClaims({ found, story, profile, policy, models: input.models });
  let out = story;
  let fixed: ClaimsCheck["fixed"];
  if (policy === "strict" && input.rewrite && rows.some((r) => r.flagged)) {
    const f = await fixClaims({ story, found, rows, profile, models: input.models });
    rows = f.rows;
    out = f.story;
    const beats = [...new Set(rows.filter((r) => r.rewritten).map((r) => r.beat))];
    if (beats.length) fixed = { beats, story: stableHash(out) };
  }
  const check: ClaimsCheck = { channel: profile.id, policy, claims: rows, flagged: rows.filter((r) => r.flagged).length, ...(fixed ? { fixed } : {}) };
  return { check, story: out, warnings: claimsWarnings(check) };
}

/** The check as lines, for the CLI's story gate: every flagged claim, then the rest in one line. */
export function formatClaims(c: ClaimsCheck): string[] {
  const label: Record<ClaimVerdict, string> = { known: "known", speculative: "speculative", source: "needs a source" };
  const out: string[] = [];
  for (const r of c.claims.filter((x) => x.flagged)) {
    const v = r.verdict === "speculative" ? "speculative, told as fact" : label[r.verdict];
    out.push(`Claim in ${r.beat} (${v}): "${r.sentence}"`);
    if (r.rewritten) out.push(`  the writer changed it to: "${r.rewritten}"`);
    else if (r.reword) out.push(`  suggested: "${r.reword}"`);
  }
  const fine = c.claims.filter((x) => !x.flagged);
  if (fine.length) out.push(`Fine as told (${fine.length}): ${fine.map((r) => `${r.beat} ${r.verdict === "known" ? "known" : c.policy === "note" ? "part of the what-if" : "said as uncertain"}: ${r.claim}`).join("; ")}`);
  return out;
}
