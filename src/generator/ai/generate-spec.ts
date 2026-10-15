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
- Format: vertical 1080x1920, 30fps, duration 15-75s.
- Scenes must tile contiguously (no gaps, no overlaps) — every second covered.
- Every number drives picture, caption, timer AND audio — sync is arithmetic
  (frame = seconds * fps), so everything stays frame-locked automatically.
- Style: blocky low-poly 3D, pastel sky/fog, simple characters, simulation HUD.
- NO voiceover. Sound = one-shots pinned to event frames + ambient bed beneath.
- Timer counts UP from event start: "TIME WITHOUT GRAVITY 0:01.57".
- Captions: UPPERCASE, one highlighted keyword.
- Hook at t=0 (2.5s) with the premise as a question.

Scene keys: "city" | "first-person".
SFX tags must exist in public/sfx/<tag>.wav (see sfx.catalog.json).
`;

export interface GenerateSpecResult {
  spec: ShotSpec;
  provider: string;
  model: string;
  attempts: number;
  source: "llm" | "offline-fallback";
}

function buildUserPrompt(premise: string): string {
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
`;
}

/**
 * Generate a spec with the LLM, validating + repairing up to MAX_REPAIR_ATTEMPTS.
 */
async function generateWithModel(
  reference: ModelReference,
  provider: string,
  model: string,
  premise: string,
): Promise<ShotSpec> {
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    try {
      const result = await generateObject({
        model: reference,
        schema: zodSchema(ShotSpecSchema),
        system: SYSTEM_PROMPT,
        prompt: buildUserPrompt(premise) + (lastError ? `\n\nPREVIOUS ATTEMPT FAILED: ${lastError}. Fix the JSON and re-emit a valid spec.` : ""),
      });

      const spec = result.object as unknown;
      return validateSpec(spec); // throws if invalid
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      // continue to next attempt
    }
  }

  throw new Error(
    `LLM spec generation failed after ${MAX_REPAIR_ATTEMPTS} attempts: ${lastError}`,
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

  const spec = await generateWithModel(
    resolved.reference,
    resolved.provider,
    resolved.model,
    premise,
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
