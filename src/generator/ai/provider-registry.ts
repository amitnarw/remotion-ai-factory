/**
 * src/generator/ai/provider-registry.ts
 *
 * Multi-provider AI layer for shot-spec generation — the "OpenCode-style"
 * provider switching the user asked for. Loads ai.config.json, resolves a
 * --provider/--model selection to an AI SDK v7 model reference, and reports
 * which providers have their API keys configured.
 *
 * Supported providers (verified against ai@7 + @ai-sdk/* packages):
 *   gateway   — Vercel AI Gateway (default, 100+ models, free tier)
 *   openai    — @ai-sdk/openai
 *   anthropic — @ai-sdk/anthropic
 *   google    — @ai-sdk/google
 *   openrouter— OpenAI-compatible, https://openrouter.ai/api/v1
 *   ollama    — OpenAI-compatible, http://localhost:11434/v1 (no key needed)
 *
 * Any OpenAI-compatible endpoint (LM Studio, local models, etc.) can be added
 * by editing ai.config.json with package: "openai" and a baseUrl.
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { z } from "zod";
import { gateway } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { createOllama } from "ai-sdk-ollama";

const CONFIG_PATH = join(process.cwd(), "ai.config.json");

/** Type of an AI SDK model reference returned by any provider function. */
export type ModelReference =
  | ReturnType<typeof openai>
  | ReturnType<typeof anthropic>
  | ReturnType<typeof google>
  | ReturnType<typeof gateway>
  | ReturnType<ReturnType<typeof createOllama>>;

const ProviderConfigSchema = z.object({
  package: z.string().optional(),
  apiKeyEnv: z.string().optional(),
  baseUrl: z.string().optional(),
  models: z.array(z.string()).optional(),
});

export const AiConfigSchema = z.object({
  defaultProvider: z.string().optional(),
  defaultModel: z.string().optional(),
  providers: z.record(z.string(), ProviderConfigSchema),
  /** Per-role model choice (see roles.ts). Missing role = the default provider/model. */
  roles: z
    .record(z.string(), z.object({ provider: z.string().optional(), model: z.string().optional() }))
    .optional(),
});

export type AiConfig = z.infer<typeof AiConfigSchema>;

/** Load ai.config.json (lenient — missing file = empty config). */
export function loadAiConfig(): AiConfig {
  try {
    if (!existsSync(CONFIG_PATH)) return { providers: {} };
    const raw = readFileSync(CONFIG_PATH, "utf8");
    return AiConfigSchema.parse(JSON.parse(raw));
  } catch {
    return { providers: {} };
  }
}

/** Provider instances keyed by name. Only built when their key is present. */
export interface ResolvedModel {
  provider: string;        // config key (e.g. "openai")
  model: string;           // model id (e.g. "gpt-5-mini")
  reference: ModelReference | null; // AI SDK model reference passed to generateObject
  hasKey: boolean;         // whether an API key is configured for this provider
  error?: string;          // if resolution failed
}

/**
 * Resolve --provider/--model to a model reference.
 *
 * Resolution order:
 *   1. explicit --provider + --model flags
 *   2. ai.config.json defaultProvider + defaultModel
 *   3. fallback: offline template families (no AI needed)
 *
 * For "openrouter" / "ollama" we reuse the OpenAI provider with a custom
 * baseUrl, since they expose an OpenAI-compatible API.
 */
export function resolveModel(
  config: AiConfig,
  providerName: string | undefined,
  modelId: string | undefined,
): ResolvedModel {
  const providers = config.providers ?? {};
  const name = providerName ?? config.defaultProvider ?? "gateway";
  const provCfg = providers[name];

  if (!provCfg) {
    return {
      provider: name,
      model: modelId ?? "",
      reference: null,
      hasKey: false,
      error: `Provider "${name}" not found in ai.config.json`,
    };
  }

  const apiKey = provCfg.apiKeyEnv ? process.env[provCfg.apiKeyEnv] : undefined;
  const hasKey = provCfg.apiKeyEnv ? Boolean(apiKey) : true; // no key needed (ollama)

  // Determine the model id to use. Never the first entry of the provider's
  // list: that list is alphabetical, so it silently picked an arbitrary model.
  const model = modelId ?? config.defaultModel ?? "";
  if (!model) {
    return {
      provider: name,
      model: "",
      reference: null,
      hasKey,
      error: `No model chosen for provider "${name}". Choose a model for the Writer in Providers → Model roles (or pass --model).`,
    };
  }

  // Build the AI SDK model reference — dispatch on `package` (not name), so
  // "ollama" / "openrouter" / any custom OpenAI-compatible provider work.
  let reference: ModelReference | null = null;
  const pkg = provCfg.package ?? name;
  try {
    if (name === "gateway" || pkg === "gateway") {
      reference = gateway(model);
    } else if (name === "ollama" || pkg === "ollama") {
      // Native Ollama provider (ai-sdk-ollama) — uses Ollama's native /api/chat
      // with server-side enforced structured output (format: JSON schema),
      // unlike the OpenAI-compat path where the schema is only a suggestion.
      // ai.config baseUrl can be the /v1 OpenAI-compat URL — strip it to the
      // Ollama root (the native client appends /api/* routes itself).
      const nativeBase = (provCfg.baseUrl ?? "http://localhost:11434/v1").replace(/\/v1\/?$/, "");
      const ollamaProvider = createOllama({
        baseURL: nativeBase,
        apiKey: apiKey ?? "",
      });
      reference = ollamaProvider(model);
    } else if (pkg === "openai") {
      if (provCfg.baseUrl) {
        // OpenAI-compatible endpoint (openrouter, ollama cloud/local, LM Studio, ...)
        const customOpenAI = createOpenAI({
          baseURL: provCfg.baseUrl,
          apiKey: apiKey ?? "",
        });
        reference = customOpenAI(model);
      } else {
        reference = openai(model);
      }
    } else if (pkg === "anthropic") {
      reference = anthropic(model);
    } else if (pkg === "google") {
      reference = google(model);
    } else {
      return {
        provider: name,
        model,
        reference: null,
        hasKey,
        error: `No AI SDK provider implementation for package "${pkg}" (provider "${name}")`,
      };
    }
  } catch (e) {
    return {
      provider: name,
      model,
      reference: null,
      hasKey,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  return { provider: name, model, reference, hasKey };
}

/** Human-readable status of every configured provider. */
export function getProviderStatus(config: AiConfig) {
  const providers: Record<string, z.infer<typeof ProviderConfigSchema>> =
    config.providers ?? {};
  return Object.entries(providers).map(([name, cfg]) => {
    const apiKey = cfg.apiKeyEnv ? process.env[cfg.apiKeyEnv] : undefined;
    const resolution = resolveModel(config, name, cfg.models?.[0]);
    return {
      provider: name,
      package: cfg.package,
      models: cfg.models ?? [],
      keyConfigured: cfg.apiKeyEnv ? Boolean(apiKey) : true,
      baseUrl: cfg.baseUrl ?? null,
      available: resolution.reference != null,
      error: resolution.error,
    };
  });
}
