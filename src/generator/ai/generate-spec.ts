/**
 * src/generator/ai/generate-spec.ts
 *
 * Turns a free-text premise into a validated ShotSpec using any AI provider.
 *
 * Uses AI SDK v7 generateObject with zodSchema output validation, so the LLM
 * (of ANY provider) can only return spec-shaped JSON. Includes a repair loop
 * (max 3 attempts) and graceful fallback to offline template families.
 *
 * This is the "LLM branch" previously scaffolded in generate.ts — now wired.
 */
import { generateObject, zodSchema } from "ai";
import { Ollama } from "ollama";
import { z } from "zod";
import { catalogForPrompt, validateAssets } from "../asset-catalog";
import { ShotSpec, ShotSpecSchema, validateSpec } from "../spec.schema";
import {
  loadAiConfig,
  resolveModel,
  type ModelReference,
} from "./provider-registry";

const MAX_REPAIR_ATTEMPTS = 3;

const SYSTEM_PROMPT = `
You are a shot-spec author for a vertical "What If" Shorts factory
(style: @atomicwhatif / @IFOLOGYFILMS — low-poly 3D simulation, no voiceover,
event-synced sound effects + ambient beds, "TIME WITHOUT ___" timer HUD,
uppercase fact captions with one highlighted keyword).

Output ONLY a single JSON object conforming to the zod schema below. No prose,
no markdown fences.

Rules:
- Format: vertical 1080x1920, 30fps, TOTAL duration 8-45s (hard cap 45s — this is a Short).
- Scenes must start at t=0 and tile contiguously (no gaps, no overlaps) — every second covered.
- At least 1 event with sfx cues; keep it to 6 scenes or fewer.
- Every number drives picture, caption, timer AND audio — sync is arithmetic
  (frame = seconds * fps), so everything stays frame-locked automatically.
- Style: blocky low-poly 3D, pastel sky/fog, simple characters, simulation HUD.
- NO voiceover. Sound = one-shots pinned to event frames + ambient bed beneath.
- Timer counts UP from event start: "TIME WITHOUT GRAVITY 0:01.57".
- Captions: UPPERCASE, one highlighted keyword.
- Hook at t=0 (2.5s) with the premise as a question.

Scene keys: "city" | "first-person" (legacy) — OR asset-driven sets: scene: "asset-stage" with kit + cast from the catalog below.
SFX tags must exist in public/sfx/<tag>.wav (see sfx.catalog.json).
`;

/** Injected asset knowledge: the LLM can only use what's listed here. */
const ASSET_GUIDE = `
ASSET CATALOG (ids are exact; use them in scenes[].cast[].asset):
{CATALOG}

Rules for asset-driven scenes (scene: "asset-stage"):
- kit: one of city-street | park | boardwalk | pier | interior
- cast: list WHO/WHAT is in the scene — asset id (exact), count, action
  (idle|walk|kneel|cheer|panic|fall|look-up), optional shirtColor/pantsColor (hex) for characters,
  zone (foreground|midground|background).
- Crowd variety: reuse ONE character asset with count 12-40 and VARY shirtColor/pantsColor per cast entry.
- Props (trees/buildings/food) have no action — just place them.
`;

export interface GenerateSpecResult {
  spec: ShotSpec;
  provider: string;
  model: string;
  attempts: number;
  source: "llm" | "offline-fallback";
}

/**
 * buildUserPrompt — now includes the per-premise asset catalog subset, so the
 * model knows exactly which assets it can cast.
 */
function buildUserPrompt(premise: string): string {
  const catalog = catalogForPrompt(premise);
  return `
Premise: "${premise}"

Generate a complete ShotSpec for this scenario. Choose sensible timing:
- hook at t=0 for 2.5s
- the main event starts around t=3.2 and lasts 5s
- gravity_off -> float -> gravity_on arc (or equivalent for non-gravity premises)
- captions describing what happens, timer counting up during the event
- city scene for the main shot, first-person POV for the aftermath
- Add sfx tags: whoosh_dissolve, rumble_deep, clothing_flutter,
  impact_soft_bodies, scream_distant (or scene-appropriate equivalents)
- Ambient bed: wind_city throughout

${ASSET_GUIDE.replace("{CATALOG}", catalog)}
`;
}

/** Direct-connection descriptor for the native Ollama branch. */
export interface OllamaDirect {
  host: string;
  apiKey: string;
}

/**
 * Generate a spec with the LLM, validating + repairing up to MAX_REPAIR_ATTEMPTS.
 * Each repair attempt tells the model EXACTLY what failed: the field-level
 * zod violations and its own previous raw output — so a model that *can* emit
 * schema-valid JSON converges instead of repeating the same mistake.
 */

/** Extract the first JSON object from model chatter (markdown fences, prose). */
function extractJson(content: string): unknown {
  const s = content.indexOf("{");
  const e = content.lastIndexOf("}");
  const blob = s >= 0 && e > s ? content.slice(s, e + 1) : content.trim();
  return JSON.parse(blob);
}

/** Compact JSON-schema contract embedded into the prompt (needed because
 * ollama CLOUD models don't apply `format` enforcement — that only works for
 * locally-served models; local installs still get it via the request.) */
const OLLAMA_CONTRACT_TEXT = (() => {
  try {
    const schemaJson = z.toJSONSchema(ShotSpecSchema, { unrepresentable: "any", io: "input" });
    return (
      "\n\nOUTPUT CONTRACT — respond with EXACTLY one JSON object matching this schema. " +
      "Field names are mandatory and spelled exactly as given (no extra keys, no markdown fences, no commentary):\n" +
      JSON.stringify(schemaJson)
    );
  } catch {
    return "\n\nRespond with ONLY one JSON object conforming to the described schema — no commentary, no markdown fences.";
  }
})();
async function generateWithModel(
  reference: ModelReference,
  provider: string,
  model: string,
  premise: string,
  ollamaDirect: OllamaDirect | null = null,
): Promise<ShotSpec> {
  let lastFailure: { violations?: string; rawOutput?: string } | null = null;
  const fullPrompt =
    buildUserPrompt(premise) + (lastFailure ? buildRepairContext(lastFailure) : "");

  for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    const started = Date.now();
    const promptForAttempt =
      attempt === 1
        ? fullPrompt
        : buildUserPrompt(premise) + (lastFailure ? buildRepairContext(lastFailure) : "");
    console.log(
      `[AI] attempt ${attempt}/${MAX_REPAIR_ATTEMPTS} — prompting ${provider}/${model}...`,
    );
    try {
      let spec: unknown;
      let totalTokens: number | undefined;
      if (ollamaDirect) {
        // Native Ollama: pass the schema via `format` — Ollama enforces it
        // SERVER-SIDE (constrained decoding), so the model physically cannot
        // emit JSON that doesn't match. Timing sanity is then checked by
        // validateSpec; violations feed the repair loop.
        const client = new Ollama({
          host: ollamaDirect.host,
          headers: ollamaDirect.apiKey
            ? { Authorization: `Bearer ${ollamaDirect.apiKey}` }
            : undefined,
        });
        const response = await client.chat({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: promptForAttempt + OLLAMA_CONTRACT_TEXT },
          ],
          format: z.toJSONSchema(ShotSpecSchema, { unrepresentable: "any", io: "input" }),
          stream: false,
        });
        totalTokens = response.eval_count ?? undefined;
        const content = response.message?.content ?? "";
        try {
          spec = extractJson(content);
        } catch {
          // No JSON blob at all — recover via the repair loop:
          lastFailure = { rawOutput: content.slice(0, 2000) };
          throw new Error("response contained no parsable JSON object");
        }
      } else {
        // OpenAI-compatible / SDK providers: generateObject requests
        // provider-level JSON mode (response_format).
        const result = await generateObject({
          model: reference,
          schema: zodSchema(ShotSpecSchema),
          system: SYSTEM_PROMPT,
          prompt: promptForAttempt,
        });
        spec = result.object as unknown;
        totalTokens = result.usage?.totalTokens;
      }

      const secs = ((Date.now() - started) / 1000).toFixed(1);
      console.log(
        `[AI] response received in ${secs}s${totalTokens ? ` (${totalTokens} tokens)` : ""}`,
      );
      const valid = validateSpec(spec); // throws ZodError if invalid
      validateAssets(valid); // throws if a cast asset id doesn't exist (repairable)
      console.log(
        `[AI] spec validation — PASS (${valid.scenes.length} scenes, ${(valid.events ?? []).length} events)`,
      );
      return valid;
    } catch (e) {
      lastFailure = extractFailure(e);
      const summary = lastFailure.violations
        ? lastFailure.violations.slice(0, 300)
        : "unknown schema failure";
      console.error(`[AI] attempt ${attempt} failed — schema violations: ${summary}`);
      // continue to next attempt with precise repair context
    }
  }

  const detail = lastFailure?.violations ?? lastErrorOf(lastFailure);
  throw new Error(
    `LLM spec generation failed after ${MAX_REPAIR_ATTEMPTS} attempts with ${provider}/${model}. ` +
      `Last schema violations: ${detail ?? "unknown"}. ` +
      `The model likely can't reliably emit strict schema JSON — try a stronger model.`,
  );
}

/** Human hint appended when every attempt failed with schema violations. */
function lastErrorOf(f: { violations?: string; rawOutput?: string } | null): string | undefined {
  if (!f) return undefined;
  if (f.violations) return f.violations;
  if (f.rawOutput) return `raw output started: ${f.rawOutput.slice(0, 120)}`;
  return undefined;
}

/** Build a repair prompt block with the model's own output + exact violations. */
function buildRepairContext(f: { violations?: string; rawOutput?: string }): string {
  let ctx = `\n\nPREVIOUS ATTEMPT FAILED VALIDATION. Fix every violation and return ONE corrected JSON object.`;
  if (f.violations) {
    ctx += `\nField violations (path: problem):\n${f.violations}`;
  }
  if (f.rawOutput) {
    ctx += `\nYour previous raw output (repair THIS, don't start over):\n${f.rawOutput.slice(0, 3000)}`;
  }
  return ctx;
}

/**
 * Pull actionable details out of AI SDK NoObjectGeneratedError (.text = raw
 * model output, .cause = the zod error with .issues) or a plain ZodError.
 */
function extractFailure(e: unknown): { violations?: string; rawOutput?: string } {
  const rawText = (e as { text?: unknown } | null)?.text;
  const rawOutput = typeof rawText === "string" && rawText.trim() ? rawText : undefined;
  const err = e as {
    message?: string;
    cause?: unknown;
    issues?: Array<{ path?: Array<string | number | symbol>; message?: string }>;
  };
  const details: { violations?: string; rawOutput?: string } = { rawOutput };

  const issuesSource =
    (err.issues && err.issues.length ? err : null) ?? (isZodLike(err.cause) ? (err.cause as ZodLike) : null);
  const issues = issuesSource?.issues;
  if (Array.isArray(issues) && issues.length) {
    details.violations = issues
      .slice(0, 12)
      .map((i) => `${(i.path ?? []).join(".") || "(root)"}: ${i.message ?? "invalid"}`)
      .join("; ");
  } else if (err.message) {
    details.violations = err.message.slice(0, 600);
  } else if (err.cause instanceof Error && err.cause.message) {
    details.violations = err.cause.message.slice(0, 200);
  }
  return details;
}

interface ZodLike {
  issues?: Array<{ path?: Array<string | number | symbol>; message?: string }>;
}
function isZodLike(v: unknown): boolean {
  return (
    typeof v === "object" &&
    v !== null &&
    Array.isArray((v as ZodLike).issues) &&
    (v as ZodLike).issues!.length > 0
  );
}

/**
 * Public entry point. Resolves the model, generates (or falls back to offline),
 * returns a validated ShotSpec + provenance info.
 */
export async function generateSpec(
  premise: string,
  providerName: string | undefined,
  modelId: string | undefined,
): Promise<GenerateSpecResult> {
  const config = loadAiConfig();
  const resolved = resolveModel(config, providerName, modelId);

  // Offline path: no provider configured or resolution failed → use templates.
  if (!resolved.reference || !resolved.hasKey) {
    const { buildFamilySpec } = await import("../build-family-spec");
    const family = buildFamilySpec(premise);
    if (family) {
      const spec = { ...family, id: slug(premise), title: premise };
      return {
        spec: validateSpec(spec),
        provider: "offline",
        model: "templates",
        attempts: 0,
        source: "offline-fallback",
      };
    }
    throw new Error(
      resolved.error ??
        `No AI provider configured and no offline template matches: "${premise}".\n` +
          `Set a provider key (see ai.config.json / .env.example) or use a ` +
          `supported family: gravity, time-stop, spin-stop, air, water, oxygen, ` +
          `electrons, protons, neutrons, light, sun-set.`,
    );
  }

  const provCfg = config.providers?.[resolved.provider];
  const ollamaDirect: OllamaDirect | null =
    (resolved.provider === "ollama" || provCfg?.package === "ollama") && provCfg
      ? {
          host: (provCfg.baseUrl ?? "http://localhost:11434/v1").replace(/\/v1\/?$/, ""),
          apiKey: provCfg.apiKeyEnv ? process.env[provCfg.apiKeyEnv] ?? "" : "",
        }
      : null;

  const spec = await generateWithModel(
    resolved.reference,
    resolved.provider,
    resolved.model,
    premise,
    ollamaDirect,
  );

  return {
    spec,
    provider: resolved.provider,
    model: resolved.model,
    attempts: 1,
    source: "llm",
  };
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "video";
}
