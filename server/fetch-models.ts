/**
 * server/fetch-models.ts
 *
 * Fetches the REAL model list for each provider from that provider's own API
 * (what the account actually has access to) instead of the static seeds in
 * ai.config.json. Mirrors how OpenCode resolves model catalogs:
 *   - per-provider REST endpoints using the user's API key
 *   - OpenAI-compatible "/models" endpoint for any baseUrl-based provider
 *   - native Ollama "/api/tags" for local installs + Ollama Cloud
 *
 * Results are persisted into ai.config.json by the caller (server/index.ts).
 */

export interface ProviderEntry {
  package?: string;
  apiKeyEnv?: string;
  baseUrl?: string;
}

export interface FetchModelsResult {
  ok: boolean;
  models: string[];
  /** which endpoint the list came from */
  source: string;
  error?: string;
}

type Json = Record<string, unknown>;

function bearer(key: string): Record<string, string> {
  return key ? { Authorization: `Bearer ${key}` } : {};
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function uniqSorted(ids: Array<string | undefined>): string[] {
  return Array.from(new Set(ids.filter((x): x is string => !!x))).sort();
}

async function getJson(url: string, headers: Record<string, string>): Promise<Json> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 160);
    try {
      const body = JSON.parse(text) as Json;
      const err = body.error;
      detail = typeof err === "string" ? err : (asStr((err as Json | undefined)?.message) ?? detail);
    } catch {
      /* keep raw text */
    }
    throw new Error(`HTTP ${res.status} from ${url} — ${detail}`);
  }
  try {
    return JSON.parse(text) as Json;
  } catch {
    throw new Error(`Non-JSON response from ${url}`);
  }
}

async function fetchOpenAiCompat(name: string, baseUrl: string, apiKey: string): Promise<FetchModelsResult> {
  const url = new URL(baseUrl);
  const isOllama = /(^|\.)ollama\.com$/.test(url.hostname) || url.port === "11434";
  if (isOllama) {
    const raw = await getJson(`${url.origin}/api/tags`, bearer(apiKey));
    const models = uniqSorted(asArray(raw.models).map((m) => asStr((m as Json).name)));
    if (models.length === 0) throw new Error(`Ollama at ${url.origin} returned no models`);
    return { ok: true, models, source: `${url.origin}/api/tags (Ollama native)` };
  }
  const raw = await getJson(`${baseUrl.replace(/\/+$/, "")}/models`, bearer(apiKey));
  const models = uniqSorted(asArray(raw.data).map((m) => asStr((m as Json).id)));
  if (models.length === 0) throw new Error(`${baseUrl}/models returned no models`);
  return { ok: true, models, source: `${baseUrl}/models (OpenAI-compatible)` };
}

async function fetchAnthropic(apiKey: string): Promise<FetchModelsResult> {
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const raw = await getJson("https://api.anthropic.com/v1/models", {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  });
  const models = uniqSorted(asArray(raw.data).map((m) => asStr((m as Json).id)));
  if (models.length === 0) throw new Error("Anthropic /v1/models returned no models");
  return { ok: true, models, source: "api.anthropic.com/v1/models" };
}

async function fetchGoogle(apiKey: string): Promise<FetchModelsResult> {
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");
  const raw = await getJson(
    `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(apiKey)}`,
    {},
  );
  const models = uniqSorted(
    asArray(raw.models).map((m) => (asStr((m as Json).name) ?? "").replace(/^models\//, "")),
  );
  if (models.length === 0) throw new Error("Generative Language API returned no models");
  return { ok: true, models, source: "generativelanguage.googleapis.com/v1beta/models" };
}

async function fetchGateway(apiKey: string): Promise<FetchModelsResult> {
  const raw = await getJson("https://ai-gateway.vercel.sh/v1/models", bearer(apiKey));
  const models = uniqSorted(asArray(raw.data).map((m) => asStr((m as Json).id)));
  if (models.length === 0) throw new Error("AI Gateway /v1/models returned no models");
  return { ok: true, models, source: "ai-gateway.vercel.sh/v1/models" };
}

/** Fetch the live model list for one provider entry. Throws on failure. */
export function fetchProviderModels(
  name: string,
  pc: ProviderEntry,
  apiKey: string,
): Promise<FetchModelsResult> {
  const pkg = pc.package ?? name;
  if (name === "gateway" || pkg === "gateway") return fetchGateway(apiKey);
  if (pkg === "openai") {
    return fetchOpenAiCompat(name, pc.baseUrl ?? "https://api.openai.com/v1", apiKey);
  }
  if (pkg === "anthropic") return fetchAnthropic(apiKey);
  if (pkg === "google") return fetchGoogle(apiKey);
  throw new Error(`No live model listing for package "${pkg}" (provider "${name}")`);
}