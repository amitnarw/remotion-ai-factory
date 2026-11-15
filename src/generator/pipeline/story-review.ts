/**
 * src/generator/pipeline/story-review.ts — story-quality findings before
 * approval (producer phase P2, 15-producer.md §7).
 *
 * The run asks the writer's model to write a story, then asks two reviewers
 * (the claims judge and the story checker) plus deterministic checks what they
 * think. Their output becomes a set of findings here: each with a stable id, a
 * category, a severity, a beat location, an explanation, and an optional
 * proposed correction. Suggestions do not block. A critical finding must be
 * corrected or explicitly overridden before the run may proceed.
 *
 * Persisted once per story version as output/<run>/story.review.json, with the
 * story's hash, which review checks completed/failed, and the user's
 * disposition. An edited story invalidates every resolution and override.
 */
import { createHash } from "crypto";
import { z } from "zod";
import type { WriterStory } from "./writer";
import type { StoryCheck } from "./checker";
import type { ClaimsCheck, ClaimRow } from "./claims";

export const STORY_REVIEW_VERSION = 1;

/** Where in the story a finding belongs. */
export type StoryLocation = { beat: string; kind: "say" | "hook" | "story" };

/** What kind of problem the finding is. */
export type ReviewCategory = "factuality" | "clarity" | "premise-match" | "coherence" | "hook";

/** Critical: may mislead, break the premise, lose essential source content,
 *  make the story incoherent, or make the hook unusable. Suggestion: style,
 *  wording, pacing — shown but never blocking. */
export type ReviewSeverity = "critical" | "suggestion";

/** How a finding is resolved. */
export type ReviewFindingStatus = "open" | "corrected" | "overridden";

export interface StoryFinding {
  /** Stable: sha256 of category|severity|beat|kind|explanation[:proposal], first 12 hex. */
  id: string;
  category: ReviewCategory;
  severity: ReviewSeverity;
  location: StoryLocation;
  /** Plain-language explanation of the problem. */
  explanation: string;
  /** The model's suggested rewording, when it offered one. */
  proposedCorrection?: string;
  /** open: nothing done yet; corrected: a new story version fixed it;
   *  overridden: the user deliberately proceeded despite it. */
  status: ReviewFindingStatus;
}

/** Execution state of each required review input. */
export type ReviewCheckState = "done" | "skipped" | "failed" | "unavailable";

export interface ReviewChecks {
  claims: ReviewCheckState;
  checker: ReviewCheckState;
  /** Hook timing — deterministic; always runnable for a planned story. */
  hook: ReviewCheckState;
  /** Did every required check complete? */
  allRequiredDone(): boolean;
}

export interface ReviewDisposition {
  /** pending: awaiting the user's decision; blocked: critical findings open;
   *  cleared: critical findings resolved or overridden for this story hash. */
  state: "pending" | "blocked" | "cleared";
  /** The story hash this disposition was last evaluated against. */
  storyHash: string;
  /** Override record, if any: which findings, why, who, when. */
  override?: { findings: string[]; reason: string; by: string; at: string };
}

export interface StoryReview {
  version: typeof STORY_REVIEW_VERSION;
  /** Hash of the story text this review was built against. */
  storyHash: string;
  channelId: string;
  policy: string;
  generatedAt: string;
  findings: StoryFinding[];
  checks: ReviewChecks;
  disposition: ReviewDisposition;
  /** Human summary, saved next to finding JSON for the dashboard/CLI. */
  summary?: string;
}

export const ReviewFindingSchema = z.object({
  id: z.string().min(1),
  category: z.enum(["factuality", "clarity", "premise-match", "coherence", "hook"]),
  severity: z.enum(["critical", "suggestion"]),
  location: z.object({ beat: z.string().min(1), kind: z.enum(["say", "hook", "story"]) }),
  explanation: z.string().min(3),
  proposedCorrection: z.string().optional(),
  status: z.enum(["open", "corrected", "overridden"]),
});

export const StoryReviewSchema = z.object({
  version: z.number().int(),
  storyHash: z.string().min(1),
  channelId: z.string().min(1),
  policy: z.string().min(1),
  generatedAt: z.string().min(1),
  findings: z.array(ReviewFindingSchema),
  checks: z.object({
    claims: z.enum(["done", "skipped", "failed", "unavailable"]),
    checker: z.enum(["done", "skipped", "failed", "unavailable"]),
    hook: z.enum(["done", "skipped", "failed", "unavailable"]),
  }),
  disposition: z.object({
    state: z.enum(["pending", "blocked", "cleared"]),
    storyHash: z.string().min(1),
    override: z
      .object({ findings: z.array(z.string()), reason: z.string().min(1), by: z.string(), at: z.string() })
      .optional(),
  }),
  summary: z.string().optional(),
});

/** Stable id for a finding: content-addressed so the same problem gets the same
 *  id across runs, and a changed explanation gets a new id. */
export function findingId(category: ReviewCategory, beat: string, kind: StoryLocation["kind"], explanation: string): string {
  const body = `${category}|${beat}|${kind}|${explanation}`;
  return createHash("sha256").update(body).digest("hex").slice(0, 12);
}

/** Default check states. */
export function emptyChecks(): ReviewChecks {
  return {
    claims: "unavailable",
    checker: "unavailable",
    hook: "done",
    allRequiredDone: () => false,
  };
}

export function pendingDisposition(storyHash: string): ReviewDisposition {
  return { state: "pending", storyHash, override: undefined };
}

/** Is the review clear to proceed: no open critical findings. */
export function isClear(review: { state?: string; findings?: StoryFinding[] }): boolean {
  return !review.findings?.some((f) => f.severity === "critical" && f.status === "open");
}

/** Human one-liner for each finding. */
export function findingLine(f: StoryFinding): string {
  const loc = f.location.kind === "hook" ? `hook` : `beat ${f.location.beat}`;
  return `${f.severity === "critical" ? "critical" : "suggestion"} [${f.category}] ${loc}: ${f.explanation}${f.proposedCorrection ? ` — suggest: "${f.proposedCorrection}"` : ""}`;
}

/** Human summary of a review: counts by severity and category. */
export function reviewSummary(review: StoryReview): string {
  const crit = review.findings.filter((f) => f.severity === "critical").length;
  const sugg = review.findings.filter((f) => f.severity === "suggestion").length;
  const openCrit = review.findings.filter((f) => f.severity === "critical" && f.status === "open").length;
  const parts = [];
  if (crit) parts.push(`${crit} critical`);
  if (sugg) parts.push(`${sugg} suggestion`);
  if (openCrit) parts.push(`${openCrit} unresolved`);
  const checks = [];
  if (review.checks.claims !== "done") checks.push(`claims: ${review.checks.claims}`);
  if (review.checks.checker !== "done") checks.push(`checker: ${review.checks.checker}`);
  const tail = checks.length ? ` (${checks.join(", ")})` : "";
  return `${parts.length ? parts.join(", ") : "no findings"}${tail}`;
}

/** A claim becomes a critical finding for documentary/non-fiction policy when it
 *  needs a source ("source" verdict) or is speculation told as fact
 *  (speculative, not framed). "known" claims are not findings; unverifiable
 *  and dropped claims are ignored. */
export function findingsFromClaims(rows: ClaimRow[], beats: Set<string>, policy: string): StoryFinding[] {
  const out: StoryFinding[] = [];
  const isDoc = policy === "strict";
  for (const r of rows) {
    const flagged = r.verdict === "source" || (r.verdict === "speculative" && !r.framed);
    if (!flagged) continue;
    const beat = beats.has(r.beat) ? r.beat : "hook";
    const explanation =
      r.verdict === "source"
        ? `states as fact "${r.claim}" which would need a source`
        : `states as fact speculation "${r.claim}" without saying it is uncertain`;
    out.push({
      id: findingId("factuality", beat, "say", explanation),
      category: "factuality",
      severity: isDoc ? "critical" : "suggestion",
      location: { beat, kind: "say" },
      explanation,
      ...(r.reword ? { proposedCorrection: r.reword } : {}),
      status: "open",
    });
  }
  return out;
}

/** Checker notes become suggestions; lost plot points (adapt only) become
 *  critical coherence findings; a premise mismatch is a critical
 *  premise-match finding. */
export function findingsFromChecker(check: StoryCheck | undefined, mode: "premise" | "adapt" | "as-written"): StoryFinding[] {
  const out: StoryFinding[] = [];
  if (!check) return out;
  for (const n of check.notes) {
    out.push({
      id: findingId("clarity", n.beat, "say", n.note),
      category: "clarity",
      severity: "suggestion",
      location: { beat: n.beat, kind: "say" },
      explanation: n.note,
      status: "open",
    });
  }
  if (mode === "adapt" && check.lost?.length) {
    for (const p of check.lost) {
      out.push({
        id: findingId("coherence", "story", "story", `source-story point "${p}" is not told by any beat`),
        category: "coherence",
        severity: "critical",
        location: { beat: "story", kind: "story" },
        explanation: `adapted from your story but no beat tells "${p}"`,
        status: "open",
      });
    }
  }
  if (check.premiseMatch && check.premiseMatch.match === "mismatch") {
    out.push({
      id: findingId("premise-match", "story", "story", check.premiseMatch.note),
      category: "premise-match",
      severity: "critical",
      location: { beat: "story", kind: "story" },
      explanation: check.premiseMatch.note,
      status: "open",
    });
  }
  return out;
}

/** Deterministic hook-length finding: a voiced hook over 3.5 seconds is a
 *  critical finding when its timing is measured; when it is only estimated
 *  (plan-time word-count timing) it is a suggestion, not a blocker.
 *  Never changes the user's words. */
export function findingFromHook(hookDurSeconds: number, beats: Set<string>, estimated: boolean): StoryFinding[] {
  if (hookDurSeconds <= 3.5) return [];
  const beat = beats.has("hook") ? "hook" : [...beats][0];
  if (estimated) {
    return [
      {
        id: findingId("hook", beat, "hook", `hook lasts ${hookDurSeconds.toFixed(1)} seconds (estimated)`),
        category: "hook",
        severity: "suggestion",
        location: { beat, kind: "hook" },
        explanation: `the hook is estimated at ${hookDurSeconds.toFixed(1)}s; under 3s keeps viewers watching (timing will be measured at render)`,
        status: "open",
      },
    ];
  }
  return [
    {
      id: findingId("hook", beat, "hook", `hook lasts ${hookDurSeconds.toFixed(1)} seconds`),
      category: "hook",
      severity: "critical",
      location: { beat, kind: "hook" },
      explanation: `the hook lasts ${hookDurSeconds.toFixed(1)}s; under 3s keeps viewers watching`,
      status: "open",
    },
  ];
}

function makeChecks(
  claims: ReviewCheckState,
  checker: ReviewCheckState,
  /** Claims are required (policy is strict or note; not skipped). */
  claimsRequired: boolean,
  /** Checker is required (story gate is on or mode is adapt). */
  checkerRequired: boolean,
): ReviewChecks {
  return {
    claims,
    checker,
    hook: "done",
    allRequiredDone: () =>
      (!claimsRequired || claims === "done" || claims === "skipped") &&
      (!checkerRequired || checker === "done" || checker === "skipped"),
  };
}

export interface BuildReviewInput {
  story: WriterStory;
  timeline: { hook: { to: number; from: number } };
  claims: ClaimsCheck | null;
  check: StoryCheck | undefined;
  mode: "premise" | "adapt" | "as-written";
  channelId: string;
  policy: string;
  claimsCheckState: ReviewCheckState;
  checkerCheckState: ReviewCheckState;
  /** Claims are required (policy is strict or note; not skipped). */
  claimsRequired: boolean;
  /** Checker is required (story gate is on or mode is adapt). */
  checkerRequired: boolean;
  /** True when the hook timing is estimated from word counts rather than
   *  measured from real audio. Estimated hook findings are suggestions,
   *  not critical blockers. */
  hookEstimated: boolean;
  /** The previously saved review, when the story hash is unchanged: carried-over
   *  dispositions (corrected/overridden) keep the user's earlier decisions. */
  priorReview?: StoryReview;
}

/** Build a story review from claims, checker output, and deterministic checks,
 *  with no model call of its own. All findings start open; disposition is
 *  pending until the user acts. A prior review carries over overridden findings
 *  (the user's explicit choice to proceed despite them) regardless of story
 *  hash; corrected findings carry over only when the story is unchanged. */
export function buildReview(input: BuildReviewInput): StoryReview {
  const beats = new Set(input.story.beats.map((b) => b.id));
  beats.add("hook");
  const findings: StoryFinding[] = [];
  findings.push(...findingsFromClaims(input.claims?.claims ?? [], beats, input.policy));
  findings.push(...findingsFromChecker(input.check, input.mode));
  findings.push(...findingFromHook(input.timeline.hook.to - input.timeline.hook.from, beats, input.hookEstimated));
  const storyHash = stableHash(input.story);
  const prior = input.priorReview;
  const sameStory = prior && prior.storyHash === storyHash;
  const priorById = new Map((prior?.findings ?? []).map((f) => [f.id, f]));
  for (const f of findings) {
    const priorF = priorById.get(f.id);
    if (priorF && priorF.status === "overridden") {
      f.status = priorF.status;
    } else if (sameStory && priorF && priorF.status === "corrected") {
      f.status = priorF.status;
    }
  }
  const disposition = pendingDisposition(storyHash);
  return {
    version: STORY_REVIEW_VERSION,
    storyHash,
    channelId: input.channelId,
    policy: input.policy,
    generatedAt: new Date().toISOString(),
    findings,
    checks: makeChecks(input.claimsCheckState, input.checkerCheckState, input.claimsRequired, input.checkerRequired),
    disposition,
    summary: undefined,
  };
}

/** JSON with sorted keys, so the same value always hashes the same. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    return v;
  });
}

/** A short hash of any JSON value; key order does not matter. */
function stableHash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex").slice(0, 16);
}
