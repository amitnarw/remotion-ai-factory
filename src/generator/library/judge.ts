/**
 * src/generator/library/judge.ts — the matcher role: a small model judges the
 * top candidates code found for one need (docs/factory/15-producer.md §3,
 * "How a match is made", step 2).
 *
 * One call per need, with up to 5 candidates and their descriptions. For
 * each the model answers same (it IS the thing), close (it would do, and
 * what differs) or no. Code then applies the rules and picks (match.ts);
 * the model never picks an id itself. Answers can be cached on disk, keyed
 * by the need's kind, words and description, the candidates and the
 * inventory version, so the same need against the same stock is judged once.
 *
 * Without a model (no `models`, or the call fails) the matcher falls back
 * to code verdicts from the word coverage (codeVerdict).
 *
 * Plugs in: match.ts matchNeeds. The call runs on the "matcher" role
 * (MATCHER_ROLE, ai/roles.ts), which uses the writer's model when it has none.
 * Fixture label: "matcher-<need id>" (test-fixtures/breakdown/<story>/matcher-n4-1.txt).
 */
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { z } from "zod";
import type { RoleName } from "../ai/roles";
import { asArray, callRole, fuzzyEnum, type RoleModel } from "../pipeline/llm";
import type { Need } from "../pipeline/breakdown";

export const VERDICTS = ["same", "close", "no"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** The role whose model judges: many small calls, so a small model is enough. */
export const MATCHER_ROLE: RoleName = "matcher";

/** What the judge is shown of one candidate. */
export interface JudgeItem {
  id: string;
  kind: string;
  help: string;
  status: "built" | "planned";
}

export interface Judgement {
  verdict: Verdict;
  note: string;
}

const JudgeSchema = z.object({
  verdicts: z.array(z.object({ item: z.string(), verdict: z.enum(VERDICTS), note: z.string() })).min(1),
});

const VERDICT_ALIASES: Record<string, Verdict> = {
  yes: "same",
  match: "same",
  exact: "same",
  identical: "same",
  have: "same",
  true: "same",
  partial: "close",
  similar: "close",
  substitute: "close",
  "stand-in": "close",
  maybe: "close",
  somewhat: "close",
  near: "close",
  none: "no",
  different: "no",
  unrelated: "no",
  false: "no",
  reject: "no",
  mismatch: "no",
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}

function pick(o: Record<string, unknown>, keys: string[]): unknown {
  const byLower = new Map(Object.keys(o).map((k) => [k.toLowerCase(), k]));
  for (const k of keys) {
    const real = byLower.get(k.toLowerCase());
    if (real !== undefined && o[real] !== undefined && o[real] !== null) return o[real];
  }
  return undefined;
}

function verdictOf(v: unknown): Verdict | undefined {
  if (typeof v === "boolean") return v ? "same" : "no";
  const k = str(v).toLowerCase().replace(/[\s_]+/g, "-");
  return VERDICT_ALIASES[k] ?? fuzzyEnum(k, VERDICTS);
}

/** An item reference as the model wrote it -> one of `ids`: the id, the id without its kind prefix, or a 1-based number. */
function itemOf(v: unknown, ids: readonly string[]): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  if (ids.includes(s)) return s;
  const n = /^#?\s*(\d+)\.?$/.exec(s);
  if (n) return ids[Number(n[1]) - 1];
  return ids.find((id) => id.slice(id.indexOf(":") + 1) === s || id.endsWith(`:${s}`));
}

/** Accept the usual variations: a list under any common key, or an object keyed by item. */
export function normalizeJudge(raw: unknown, ids: readonly string[]): unknown {
  const o = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : { verdicts: raw }) as Record<string, unknown>;
  let list = asArray<Record<string, unknown>>(pick(o, ["verdicts", "items", "candidates", "results", "judgements", "judgments", "answers"]));
  if (!list.length) {
    // { "model:x": "same", "2": { "verdict": "close", "note": "..." } }
    list = Object.entries(o).map(([k, v]) => (v && typeof v === "object" ? { item: k, ...(v as Record<string, unknown>) } : { item: k, verdict: v }));
  }
  const seen = new Set<string>();
  const verdicts = list
    .filter((x) => x && typeof x === "object")
    .map((x) => ({
      item: itemOf(pick(x, ["item", "id", "candidate", "name", "ref", "number", "index"]), ids) ?? "",
      verdict: verdictOf(pick(x, ["verdict", "answer", "match", "judgement", "judgment", "result"])),
      note: str(pick(x, ["note", "reason", "why", "comment", "differs", "difference"])),
    }))
    .filter((x) => x.item && x.verdict && !seen.has(x.item) && seen.add(x.item));
  return { verdicts };
}

const SYSTEM = `You check what a video factory has in stock. It makes videos in a stylised low-poly 3D world.
For one thing a story needs, you get up to 5 items from the stock, each with a short description.
For each item answer:
- "same": it IS the thing (small differences of colour or detail are fine; the factory can recolour models);
- "close": it would do as a stand-in; say in "note" what differs;
- "no": it would not do.
Judge only from the descriptions. An item marked (planned) is not built yet: judge what it would be.
A place, a set, a camera move or a sound name counts as the thing when it gives what the need asks for.
Reply with JSON only.`;

export function judgePrompt(need: Need, items: readonly JudgeItem[]): string {
  return `Need ${need.id} (${need.kind}${need.must ? ", the story fails without it" : ""}): "${need.what}"
Search words: ${need.words.join(", ")}${need.look ? `\nLook: ${need.look}` : ""}${need.who ? `\nWho: ${need.who}` : ""}
In beats: ${need.beats.join(", ")}

Items:
${items.map((it, i) => `${i + 1}. ${it.id} (${it.kind}${it.status === "planned" ? ", planned" : ""}): ${it.help.slice(0, 240)}`).join("\n")}

JSON shape: { "verdicts": [{ "item": "${items[0]?.id ?? "<item id>"}", "verdict": "same", "note": "" }] }`;
}

function cacheKey(need: Need, items: readonly JudgeItem[], inventory: string): string {
  const words = [...new Set(need.words.map((w) => w.toLowerCase()))].sort();
  return createHash("sha256")
    .update(JSON.stringify([need.kind, words, need.what, need.look ?? "", items.map((i) => i.id), inventory]))
    .digest("hex")
    .slice(0, 20);
}

/** The judge's answer for one need: a verdict per item it named (items it left out get the code's verdict). */
export async function judgeNeed(
  need: Need,
  items: readonly JudgeItem[],
  opts: { models: Record<string, RoleModel>; inventory: string; role?: RoleName; cacheDir?: string },
): Promise<{ verdicts: Map<string, Judgement>; by: "model" | "cache"; model?: string }> {
  const ids = items.map((i) => i.id);
  const file = opts.cacheDir ? join(opts.cacheDir, `${cacheKey(need, items, opts.inventory)}.json`) : undefined;
  if (file && existsSync(file)) {
    try {
      const got = JudgeSchema.parse(normalizeJudge(JSON.parse(readFileSync(file, "utf8")), ids));
      return { verdicts: new Map(got.verdicts.map((v) => [v.item, { verdict: v.verdict, note: v.note }])), by: "cache" };
    } catch {
      /* a stale or broken cache file: ask again */
    }
  }
  const result = await callRole({
    role: opts.role ?? MATCHER_ROLE,
    label: `matcher-${need.id}`,
    system: SYSTEM,
    prompt: judgePrompt(need, items),
    schema: JudgeSchema,
    normalize: (raw) => normalizeJudge(raw, ids),
    models: opts.models,
    maxAttempts: 2,
  });
  if (file) {
    mkdirSync(opts.cacheDir!, { recursive: true });
    writeFileSync(file, JSON.stringify({ verdicts: result.value.verdicts }, null, 1));
  }
  return { verdicts: new Map(result.value.verdicts.map((v) => [v.item, { verdict: v.verdict, note: v.note }])), by: "model", model: `${result.provider}/${result.model}` };
}

/**
 * The verdict code gives without a model, from how many of the need's own
 * search words the candidate has: most of them, one by name -> same; a
 * third, or any one by name -> close; else no.
 */
export function codeVerdict(c: { coverage: number; strongHits: number }): Verdict {
  if (c.coverage >= 0.66 && c.strongHits > 0) return "same";
  if (c.coverage >= 0.34 || c.strongHits > 0) return "close";
  return "no";
}
