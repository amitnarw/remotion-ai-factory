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
import { newRunId } from "../pipeline/manifest";
import type { AudioConfig } from "../pipeline/voice";
import { DEFAULT_CHANNEL, loadChannel } from "./channels";
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
  /** A new run id unless the caller names one (the CLI, the milestone, the tests). */
  id: string = newRunId(premise),
  /** The run's gates, a story to reuse, the channel, and how the story is made (pipeline/run.ts runPlan). */
  run: Pick<Parameters<typeof runPlan>[0], "storyGate" | "storyFrom" | "channel" | "mode" | "script" | "shopGate" | "shopSources" | "shop"> = {},
): Promise<GenerateSpecResult> {
  // The channel's format and caption style, where the caller chose none.
  const profile = loadChannel(run.channel ?? DEFAULT_CHANNEL);
  const settings = SettingsSchema.parse({
    ...(profile.formats.default && settingsInput.format === undefined ? { format: profile.formats.default } : {}),
    ...(profile.captions && settingsInput.captions === undefined ? { captions: profile.captions } : {}),
    ...settingsInput,
  });

  // A bare CLI call passes no voice settings (the dashboard and the milestone
  // script pick theirs explicitly): the channel's voices. For what-if that is
  // narration with Kitten 2's Bruno, the product's default (the dashboard's
  // switch starts on). Without it a plain `npm run generate` planned a video
  // whose beats all had "no spoken line".
  const audioConfig: AudioConfig = !audio.narration && !audio.dialogs ? { ...audio, ...profile.voices } : audio;

  const plan = async (): Promise<GenerateSpecResult> => {
    const { spec, report } = await runPlan({ id, premise, settings, audio: audioConfig, cli: { provider: providerName, model: modelId }, ...run });
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

