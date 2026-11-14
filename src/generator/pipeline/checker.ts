/**
 * src/generator/pipeline/checker.ts — the story checker (producer P2,
 * docs/factory/15-producer.md §2 and §7): a second reading of the story
 * before gate 1. It only comments; it never changes a word.
 *
 *   notes   what would make viewers lose the thread, in the channel's terms
 *           (its critic's "what makes a beat weak"), at most 5, each on a beat
 *   claims  the story's statements of real-world fact, each "known" or "check"
 *           (every claim for a documentary; the models have no web access, so
 *           the user confirms them at the gate). Not asked when the run's
 *           claims stage (claims.ts) judged them already: the gate shows that
 *           check, so the list stays empty.
 *   plot    adapt only: the plot points of the user's own story, in order, each
 *           with the beats that tell it. Code, not the model, decides what was
 *           lost: a point no beat of the story tells.
 *
 * Saved as output/<run>/story.check.json by the run's "check" stage
 * (run.ts) and shown at the story gate.
 */
import { z } from "zod";
import type { ChannelProfile, StoryMode } from "../ai/channels";
import { asArray, beatRef, callRole, fuzzyEnum, type RoleModel } from "./llm";
import type { WriterStory } from "./writer";

export interface StoryCheck {
  notes: Array<{ beat: string; note: string }>;
  claims: Array<{ beat: string; claim: string; status: "known" | "check" }>;
  /** Adapt: the user's story's plot points, each with the beats that tell it. */
  plot?: Array<{ point: string; beats: string[] }>;
  /** Adapt: the plot points no beat tells. */
  lost?: string[];
}

const STATUS = ["known", "check"] as const;

const CheckSchema = z.object({
  notes: z.array(z.object({ beat: z.string(), note: z.string().min(3) })).max(5),
  claims: z.array(z.object({ beat: z.string(), claim: z.string().min(3), status: z.enum(STATUS) })).max(20),
  plot: z.array(z.object({ point: z.string().min(3), beats: z.array(z.string()) })).max(15).optional(),
});
/** The same without claims (the claims stage judged them): the model is not asked for them, the list is empty. */
const NoClaimsSchema: z.ZodType<z.infer<typeof CheckSchema>> = CheckSchema.omit({ claims: true }).transform((v) => ({ ...v, claims: [] }));

/** A documentary lists every factual claim; other genres only the claims of real-world fact they make. */
function claimsRule(p: ChannelProfile): string {
  return /documentar/i.test(`${p.id} ${p.genre}`)
    ? `"claims": EVERY factual claim the story makes, each with the beat it is in, and "known" when it is widely established, "check" when it needs a source.`
    : `"claims": only statements presented as real-world fact (numbers, history, science), usually none; each "known" or "check".`;
}

/**
 * The checker's prompt: the story beat by beat, and for adapt the user's own
 * story. `claims: false` leaves the claims out (the claims stage judged them);
 * otherwise the prompt is the one of before.
 */
export function checkerPrompt(story: WriterStory, p: ChannelProfile, mode: StoryMode, source?: string, opts: { claims?: boolean } = {}): string {
  const withClaims = opts.claims !== false;
  const beats = story.beats
    .map((b) => [`${b.id}: "${b.say}"`, ...b.lines.map((l) => `${l.who}: "${l.text}"`), `shows: ${b.see}`].join(" | "))
    .join("\n");
  const adapt =
    mode === "adapt" && source
      ? `\n\nTHE USER'S OWN STORY, which this story adapts:\n"""\n${source.trim().slice(0, 12000)}\n"""\n"plot": the plot points of the user's story, in order, at most 12, each in a few words, with "beats": the beats of the adapted story that tell it ([] when none does).`
      : "";
  return `Check this ${p.genre} story before it is filmed. You never rewrite it: you only comment.
"notes": at most 5 notes on what would lose the viewer, in this genre's terms: ${p.critic.watchFor} Each on the beat it is about. None when the story is strong.
${withClaims ? `${claimsRule(p)}\n` : ""}
TITLE: "${story.title}"
HOOK: "${story.hook}"
${beats}${adapt}

JSON shape: { "notes": [{ "beat": "b2", "note": "..." }]${withClaims ? `, "claims": [{ "beat": "b3", "claim": "...", "status": "check" }]` : ""}${adapt ? `, "plot": [{ "point": "...", "beats": ["b1", "b2"] }]` : ""} }`;
}

/** Ask the checker. For adapt, a plot point is lost when no beat of the story tells it. */
export async function checkStory(input: {
  story: WriterStory;
  profile: ChannelProfile;
  mode: StoryMode;
  /** The user's own story (adapt). */
  source?: string;
  /** false when the run's claims stage judged the claims: the checker leaves them out. */
  claims?: boolean;
  models: Record<string, RoleModel>;
}): Promise<StoryCheck> {
  const { story, profile, mode } = input;
  const withClaims = input.claims !== false;
  const ids = new Set(story.beats.map((b) => b.id));
  const adapt = mode === "adapt" && !!input.source?.trim();
  const ref = (v: unknown) => {
    const b = beatRef(v);
    return b && ids.has(b) ? b : "";
  };
  const result = await callRole({
    role: "checker",
    label: "checker",
    system: `${profile.critic.intro}\nYou are the story checker: you read a story before it is filmed and comment on it. You never change a word of it.\nReply with JSON only.`,
    prompt: checkerPrompt(story, profile, mode, input.source, { claims: withClaims }),
    schema: withClaims ? CheckSchema : NoClaimsSchema,
    models: input.models,
    normalize: (raw) => {
      const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      return {
        notes: asArray<Record<string, unknown>>(o.notes ?? o.issues)
          .map((n) => ({ beat: ref(n.beat ?? n.id), note: String(n.note ?? n.problem ?? n.text ?? "").trim() }))
          .filter((n) => n.beat && n.note)
          .slice(0, 5),
        claims: asArray<Record<string, unknown>>(o.claims ?? o.facts)
          .map((c) => ({ beat: ref(c.beat ?? c.id), claim: String(c.claim ?? c.text ?? "").trim(), status: fuzzyEnum(c.status ?? c.verdict, STATUS) ?? "check" }))
          .filter((c) => c.beat && c.claim)
          .slice(0, 20),
        ...(adapt
          ? {
              plot: asArray<Record<string, unknown>>(o.plot ?? o.points ?? o.plotPoints).map((x) => ({
                point: String(x.point ?? x.text ?? x.event ?? "").trim(),
                beats: asArray<unknown>(x.beats ?? x.beat).map(ref).filter(Boolean),
              })),
            }
          : {}),
      };
    },
    essential: (v) => (adapt && !v.plot?.length ? `list the plot points of the user's story in "plot", each with the beats that tell it` : null),
  });
  const v = result.value;
  return {
    notes: v.notes,
    claims: v.claims,
    ...(adapt ? { plot: v.plot ?? [], lost: (v.plot ?? []).filter((x) => x.beats.length === 0).map((x) => x.point) } : {}),
  };
}

/** The check as lines, for the CLI's story gate and the plan's warnings. */
export function formatCheck(c: StoryCheck): string[] {
  const out: string[] = [];
  if (c.lost?.length) out.push(`Lost from your story (no beat tells it): ${c.lost.map((p) => `"${p}"`).join("; ")}`);
  for (const n of c.notes) out.push(`Note on ${n.beat}: ${n.note}`);
  for (const x of c.claims) out.push(`Claim in ${x.beat} (${x.status === "check" ? "to check" : "known"}): ${x.claim}`);
  return out;
}
