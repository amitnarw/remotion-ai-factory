/**
 * src/generator/ai/generate-spec.ts — premise -> validated ShotSpec.
 *
 * With an AI provider (or recorded fixtures): the Phase 2 pipeline
 * (src/generator/pipeline/run.ts) — writer, voice, timeline, director, sound,
 * assemble. Without a provider key: the offline template families
 * (build-family-spec.ts).
 *
 * The old single-call writer (one prompt, three fixed story families) is gone:
 * every role now has its own small task, and code does all the timing.
 */
import { SettingsSchema, validateSpec, type ShotSpec, type VideoSettings } from "../spec.schema";
import { runPlan, type PlanReport } from "../pipeline/run";
import type { AudioConfig } from "../pipeline/voice";
import { loadAiConfig, resolveModel } from "./provider-registry";
import { pickRoleModel } from "./roles";

export interface GenerateSpecResult {
  spec: ShotSpec;
  provider: string;
  model: string;
  source: "pipeline" | "offline-fallback";
  report?: PlanReport;
}

export async function generateSpec(
  premise: string,
  providerName: string | undefined,
  modelId: string | undefined,
  settingsInput: Partial<VideoSettings> = {},
  audio: AudioConfig = {},
  id: string = slug(premise),
): Promise<GenerateSpecResult> {
  const settings = SettingsSchema.parse(settingsInput);

  const plan = async (): Promise<GenerateSpecResult> => {
    const { spec, report } = await runPlan({ id, premise, settings, audio, cli: { provider: providerName, model: modelId } });
    return { spec, provider: report.models.writer.provider, model: report.models.writer.model, source: "pipeline", report };
  };

  // Recorded fixtures stand in for the models (tests, machines without a key).
  if (process.env.FACTORY_LLM_FIXTURES) return plan();

  const config = loadAiConfig();
  const writer = pickRoleModel(config.roles, "writer", providerName, modelId);
  const resolved = resolveModel(config, writer.provider, writer.model);

  // A key is set but the model can't be resolved (e.g. none chosen): say so,
  // never fall back to the templates silently.
  if (resolved.hasKey && !resolved.reference) {
    throw new Error(resolved.error ?? `Could not resolve a model for provider "${resolved.provider}"`);
  }
  if (resolved.reference && resolved.hasKey) return plan();

  // No provider key: offline template families.
  const { buildFamilySpec } = await import("../build-family-spec");
  const family = buildFamilySpec(premise);
  if (family) {
    return {
      spec: validateSpec({ ...family, id, title: premise, settings }),
      provider: "offline",
      model: "templates",
      source: "offline-fallback",
    };
  }
  throw new Error(
    resolved.error ??
      `No AI provider configured and no offline template matches: "${premise}".\n` +
        `Set a provider key (see ai.config.json / .env.example) and choose a Writer model, or use a ` +
        `supported family: gravity, time-stop, spin-stop, air, water, oxygen, ` +
        `electrons, protons, neutrons, light, sun-set.`,
  );
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "video";
}
