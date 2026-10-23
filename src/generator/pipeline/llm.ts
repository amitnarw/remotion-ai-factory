/**
 * src/generator/pipeline/llm.ts — one way to ask any pipeline role for JSON.
 *
 * callRole() resolves the role's model, sends the prompt, and turns the reply
 * into a typed value even when the model doesn't follow the schema exactly:
 *   1. lenient parse   — strips <think> blocks, code fences, prose, trailing commas
 *   2. normalize       — the role's own cleanup (key aliases, beat refs, enums)
 *   3. zod             — the role's small schema
 *   4. essential check — the role says what it cannot do without
 * A failure goes back to the model with the exact problems (repair loop).
 *
 * Ollama cloud treats `format` (the JSON schema) as a hint, not a rule, so the
 * steps above are what actually make the output usable. Calls stream, which
 * keeps long "thinking" replies under the HTTP header timeout.
 *
 * Fixtures (no key needed):
 *   FACTORY_LLM_FIXTURES=<dir>  replay raw replies from <dir>/<label>-<n>.txt
 *   FACTORY_LLM_RECORD=<dir>    save every real reply there (to make fixtures)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { generateText } from "ai";
import { Ollama } from "ollama";
import { z } from "zod";
import { loadAiConfig, resolveModel, type ModelReference } from "../ai/provider-registry";
import { pickRoleModel, type RoleName } from "../ai/roles";

/* ---------------- model resolution ---------------- */

export interface RoleModel {
  provider: string;
  model: string;
}

/**
 * The provider/model each role uses. The writer comes from the CLI flags or
 * its role assignment; any other role uses its own assignment, or the
 * writer's model when it has none (so a user who only picked a writer still
 * gets a working pipeline, all on that one model).
 */
export function resolveRoleModels(
  roles: RoleName[],
  cli: { provider?: string; model?: string } = {},
): Record<string, RoleModel> {
  const config = loadAiConfig();
  const writerPick = pickRoleModel(config.roles, "writer", cli.provider, cli.model);
  const writer: RoleModel = {
    provider: writerPick.provider ?? config.defaultProvider ?? "gateway",
    model: writerPick.model ?? config.defaultModel ?? "",
  };
  const out: Record<string, RoleModel> = { writer };
  for (const role of roles) {
    if (role === "writer") continue;
    const own = pickRoleModel(config.roles, role);
    out[role] = own.provider && own.model ? { provider: own.provider, model: own.model } : writer;
  }
  return out;
}

/* ---------------- lenient JSON ---------------- */

/** Pull one JSON value out of a model reply, forgiving the usual mistakes. */
export function lenientJson(raw: string): unknown {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence) text = fence[1].trim();
  const firstObj = text.indexOf("{");
  const firstArr = text.indexOf("[");
  const start = firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr);
  if (start === -1) throw new Error("the reply contains no JSON");
  const closer = text[start] === "{" ? "}" : "]";
  const end = text.lastIndexOf(closer);
  if (end <= start) throw new Error("the reply's JSON is cut off");
  let blob = text.slice(start, end + 1);
  try {
    return JSON.parse(blob);
  } catch {
    blob = blob
      .replace(/,\s*([}\]])/g, "$1") // trailing commas
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'");
    return JSON.parse(blob);
  }
}

/* ---------------- normalize helpers (used by the roles) ---------------- */

/** Arrays stay as they are; a single value becomes a one-item array; nothing -> []. */
export function asArray<T = unknown>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (v === null || v === undefined || v === "") return [];
  return [v as T];
}

/** Closest allowed value for a free-text enum answer, or undefined. */
export function fuzzyEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.toLowerCase().trim().replace(/[\s_]+/g, "-");
  const exact = allowed.find((a) => a === v);
  if (exact) return exact;
  const loose = allowed.find((a) => a.startsWith(v) || v.startsWith(a) || v.includes(a));
  if (loose) return loose;
  // Word match, ignoring a plural "s": "coins" -> "coin-stacks", "bills" -> "bill-columns".
  const stem = (w: string) => w.replace(/s$/, "");
  const words = v.split("-").map(stem).filter((w) => w.length > 2);
  return allowed.find((a) => a.split("-").map(stem).some((t) => words.includes(t)));
}

/** Beat references in any common form -> "bN": 3, "3", "B3", "beat 3", "b3". */
export function beatRef(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return `b${Math.round(value)}`;
  if (typeof value !== "string") return undefined;
  const m = /(\d+)/.exec(value);
  return m ? `b${Number(m[1])}` : undefined;
}

/* ---------------- calling a role ---------------- */

export interface CallOptions<T> {
  role: RoleName;
  /** Used for logs and fixture file names: "<label>-<attempt>.txt". */
  label: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** Role-specific cleanup of the parsed reply before zod. */
  normalize?: (raw: unknown) => unknown;
  /** A problem that makes the value unusable (re-ask), or null. */
  essential?: (value: T) => string | null;
  models: Record<string, RoleModel>;
  maxAttempts?: number;
  /** Base64 PNG/JPEG images for a vision model (Ollama only). Sent with temperature 0. */
  images?: string[];
}

export interface CallResult<T> {
  value: T;
  provider: string;
  model: string;
  attempts: number;
}

const fixtureCounters = new Map<string, number>();

/** Reset fixture replay counters (tests). */
export function resetFixtureCounters() {
  fixtureCounters.clear();
}

function contractFor(schema: z.ZodType): string {
  try {
    const json = z.toJSONSchema(schema, { unrepresentable: "any", io: "input" });
    return (
      "\n\nReply with ONE JSON object matching this schema exactly (field names as given, no extra keys, no markdown, no commentary):\n" +
      JSON.stringify(json)
    );
  } catch {
    return "\n\nReply with ONE JSON object only — no markdown, no commentary.";
  }
}

async function askModel(rm: RoleModel, system: string, prompt: string, schema: z.ZodType, images?: string[]): Promise<string> {
  const config = loadAiConfig();
  const resolved = resolveModel(config, rm.provider, rm.model);
  if (!resolved.reference) throw new Error(resolved.error ?? `cannot resolve ${rm.provider}/${rm.model}`);
  if (!resolved.hasKey) throw new Error(`API key not set for provider "${rm.provider}"`);
  const provCfg = config.providers?.[rm.provider];
  const isOllama = rm.provider === "ollama" || provCfg?.package === "ollama";

  if (isOllama && provCfg) {
    const host = (provCfg.baseUrl ?? "http://localhost:11434/v1").replace(/\/v1\/?$/, "");
    const apiKey = provCfg.apiKeyEnv ? process.env[provCfg.apiKeyEnv] ?? "" : "";
    const client = new Ollama({ host, headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined });
    const stream = await client.chat({
      model: rm.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt + contractFor(schema), ...(images?.length ? { images } : {}) },
      ],
      format: z.toJSONSchema(schema, { unrepresentable: "any", io: "input" }) as object,
      // Judging stills: the same picture should get the same answer.
      ...(images?.length ? { options: { temperature: 0 } } : {}),
      stream: true,
    });
    let content = "";
    let thinking = "";
    for await (const part of stream) {
      content += part.message?.content ?? "";
      thinking += part.message?.thinking ?? "";
    }
    // Some thinking models put the JSON in the thinking channel and leave content empty.
    return content.trim() ? content : thinking;
  }

  if (images?.length) throw new Error(`images need an Ollama vision model; "${rm.provider}" is not Ollama`);
  const result = await generateText({
    model: resolved.reference as ModelReference,
    system,
    prompt: prompt + contractFor(schema),
  });
  return result.text;
}

function fixtureReply(dir: string, label: string): string {
  const n = (fixtureCounters.get(label) ?? 0) + 1;
  fixtureCounters.set(label, n);
  const file = join(dir, `${label}-${n}.txt`);
  if (!existsSync(file)) throw new Error(`fixture missing: ${file}`);
  return readFileSync(file, "utf8");
}

function recordReply(dir: string, label: string, attempt: number, raw: string) {
  mkdirSync(dir, { recursive: true });
  let n = attempt;
  while (existsSync(join(dir, `${label}-${n}.txt`))) n += 1;
  writeFileSync(join(dir, `${label}-${n}.txt`), raw);
}

function describeZod(error: z.ZodError): string {
  return error.issues
    .slice(0, 12)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

/** Ask a role for a value of type T, repairing up to maxAttempts times. */
export async function callRole<T>(opts: CallOptions<T>): Promise<CallResult<T>> {
  const rm = opts.models[opts.role] ?? opts.models.writer;
  const fixtures = process.env.FACTORY_LLM_FIXTURES;
  const record = process.env.FACTORY_LLM_RECORD;
  const max = opts.maxAttempts ?? 3;
  let prompt = opts.prompt;
  let lastProblem = "";

  for (let attempt = 1; attempt <= max; attempt++) {
    const started = Date.now();
    console.log(`[llm] ${opts.label} attempt ${attempt}/${max} — ${fixtures ? "fixture" : `${rm.provider}/${rm.model}`}`);
    const raw = fixtures ? fixtureReply(fixtures, opts.label) : await askModel(rm, opts.system, prompt, opts.schema, opts.images);
    if (record && !fixtures) recordReply(record, opts.label, attempt, raw);

    let problem = "";
    try {
      const parsed = lenientJson(raw);
      const cleaned = opts.normalize ? opts.normalize(parsed) : parsed;
      const result = opts.schema.safeParse(cleaned);
      if (!result.success) {
        problem = describeZod(result.error);
      } else {
        const essential = opts.essential?.(result.data) ?? null;
        if (!essential) {
          console.log(`[llm] ${opts.label} ok in ${((Date.now() - started) / 1000).toFixed(1)}s`);
          return { value: result.data, provider: rm.provider, model: rm.model, attempts: attempt };
        }
        problem = essential;
      }
    } catch (e) {
      problem = (e as Error).message;
    }

    lastProblem = problem;
    console.warn(`[llm] ${opts.label} attempt ${attempt} unusable: ${problem.slice(0, 300)}`);
    prompt =
      opts.prompt +
      `\n\nYOUR PREVIOUS REPLY COULD NOT BE USED. Problems: ${problem}\n` +
      `Your previous reply (fix it, don't start over):\n${raw.slice(0, 3000)}`;
  }

  throw new Error(
    `${opts.label}: no usable reply after ${max} attempts from ${rm.provider}/${rm.model}. Last problem: ${lastProblem}. ` +
      `Try a stronger model for the ${opts.role} role in Providers → Model roles.`,
  );
}
