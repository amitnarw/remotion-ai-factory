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
 *
 * Two files, one reader (16-code-map-pipeline.md §7.5 items 6 and 7):
 *   ai.config.json        tracked: the shared defaults (the providers and their model lists)
 *   ai.config.local.json  git-ignored: this machine's choices, which the dashboard
 *                         writes (model roles, the default provider, keys' providers
 *                         added or removed, live model lists)
 * The local file is laid over the tracked one, provider by provider and role by
 * role (null removes one). The dashboard never rewrites the tracked file, so a
 * commit never carries one machine's choices to the other by accident. A file
 * that fails its check is named in a warning, never silently read as empty.
 */
import { readFileSync, existsSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { z } from "zod";
import { gateway } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { createOllama } from "ai-sdk-ollama";

/** The tracked file: the shared defaults. */
export const AI_CONFIG_FILE = "ai.config.json";
/** This machine's choices, laid over the defaults (git-ignored; the dashboard writes it). */
export const AI_LOCAL_FILE = "ai.config.local.json";

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

const RoleSchema = z.object({ provider: z.string().optional(), model: z.string().optional() });

export const AiConfigSchema = z.object({
  defaultProvider: z.string().optional(),
  defaultModel: z.string().optional(),
  providers: z.record(z.string(), ProviderConfigSchema),
  /** Per-role model choice (see roles.ts). Missing role = the default provider/model. */
  roles: z.record(z.string(), RoleSchema).optional(),
});

export type AiConfig = z.infer<typeof AiConfigSchema>;

/** The local file: only what differs from the tracked one; null removes a provider, a role or a default. */
const LocalConfigSchema = z.object({
  defaultProvider: z.string().nullable().optional(),
  defaultModel: z.string().nullable().optional(),
  providers: z.record(z.string(), ProviderConfigSchema.nullable()).optional(),
  roles: z.record(z.string(), RoleSchema.nullable()).optional(),
});
type LocalConfig = z.infer<typeof LocalConfigSchema>;

function readChecked<T>(root: string, file: string, schema: z.ZodType<T>, problems: string[]): T | null {
  const path = join(root, file);
  if (!existsSync(path)) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (parsed.success) return parsed.data;
    problems.push(`${file} is not a valid config, so it is not used: ${parsed.error.issues.slice(0, 4).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
  } catch (e) {
    problems.push(`${file} could not be read, so it is not used: ${(e as Error).message.slice(0, 160)}`);
  }
  return null;
}

/** The tracked defaults with this machine's choices laid over them. */
function layered(base: AiConfig, local: LocalConfig | null): AiConfig {
  if (!local) return base;
  const providers = { ...base.providers };
  for (const [k, v] of Object.entries(local.providers ?? {})) {
    if (v === null) delete providers[k];
    else providers[k] = { ...(providers[k] ?? {}), ...v };
  }
  const roles = { ...(base.roles ?? {}) };
  for (const [k, v] of Object.entries(local.roles ?? {})) {
    if (v === null) delete roles[k];
    else roles[k] = v;
  }
  const out: AiConfig = { ...base, providers, ...(base.roles || local.roles ? { roles } : {}) };
  for (const k of ["defaultProvider", "defaultModel"] as const) {
    if (local[k] === null) delete out[k];
    else if (local[k] !== undefined) out[k] = local[k];
  }
  return out;
}

/** The AI config of this machine: the tracked file, this machine's choices over it, and what was wrong with either. */
export function readAiConfig(root = process.cwd()): { config: AiConfig; problems: string[] } {
  const problems: string[] = [];
  const base = readChecked(root, AI_CONFIG_FILE, AiConfigSchema, problems) ?? { providers: {} };
  const local = readChecked(root, AI_LOCAL_FILE, LocalConfigSchema, problems);
  return { config: layered(base, local), problems };
}

const warned = new Set<string>();

/** Load the AI config (a missing file = an empty config; a broken one is named in a warning, once). */
export function loadAiConfig(root = process.cwd()): AiConfig {
  const { config, problems } = readAiConfig(root);
  for (const p of problems) {
    if (warned.has(p)) continue;
    warned.add(p);
    console.warn(`[ai] ${p}`);
  }
  return config;
}

/** JSON with sorted keys: the same value always compares the same. */
const sortedJson = (v: unknown) =>
  JSON.stringify(v, (_k, x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));

/**
 * Save the dashboard's changes. Only what differs from the tracked file is
 * written, to ai.config.local.json; with nothing different the local file
 * goes. The tracked file is never written.
 */
export function saveAiConfig(next: AiConfig, root = process.cwd()): void {
  const problems: string[] = [];
  const base = readChecked(root, AI_CONFIG_FILE, AiConfigSchema, problems) ?? { providers: {} };
  const local: LocalConfig = {};
  for (const k of ["defaultProvider", "defaultModel"] as const) {
    if ((next[k] ?? null) !== (base[k] ?? null)) local[k] = next[k] ?? null;
  }
  const diff = <T>(a: Record<string, T>, b: Record<string, T>) => {
    const out: Record<string, T | null> = {};
    for (const [k, v] of Object.entries(b)) if (sortedJson(v) !== sortedJson(a[k])) out[k] = v;
    for (const k of Object.keys(a)) if (!(k in b)) out[k] = null;
    return Object.keys(out).length ? out : undefined;
  };
  const providers = diff(base.providers, next.providers);
  const roles = diff(base.roles ?? {}, next.roles ?? {});
  if (providers) local.providers = providers;
  if (roles) local.roles = roles;
  const path = join(root, AI_LOCAL_FILE);
  if (Object.keys(local).length) writeFileSync(path, `${JSON.stringify(local, null, 2)}\n`);
  else if (existsSync(path)) rmSync(path);
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
      error: `No model chosen for provider "${name}". Choose a model for the Writer in Settings → AI models → Model roles (or pass --model).`,
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
