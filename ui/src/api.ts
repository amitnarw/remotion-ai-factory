const BASE = "/api";

export interface ProviderInfo {
  name: string;
  package?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  models?: string[];
  keyConfigured: boolean;
  isDefault: boolean;
}

export interface ProvidersResponse {
  providers: ProviderInfo[];
  defaultProvider?: string;
}

export interface JobOutput {
  mp4: string;
  spec: unknown;
  report: string;
}

export interface StageSpan {
  stage: string;
  startedAt: number;
  endedAt?: number;
}

export interface Job {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  progress: number;
  stage?: string;
  etaSec?: number | null;
  timeline?: StageSpan[];
  logs: string[];
  premise: string;
  provider?: string;
  model?: string;
  engine?: "template" | "story" | "plan" | "storyboard";
  output?: JobOutput;
  slug?: string;
  specId?: string;
  storyboard?: unknown;
  error?: string;
  createdAt: number;
}

/* ---------- Spec engine: AI writes the plan → you review → approve → render ---------- */

/** Start a plan job: the AI writes the shot spec. Nothing renders yet. */
export async function planSpec(body: {
  premise: string;
  provider?: string;
  model?: string;
  audio?: unknown;
}): Promise<{ jobId: string }> {
  return json(
    await fetch(`${BASE}/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export interface SpecResponse {
  ready: boolean;
  status?: string;
  stage?: string;
  progress?: number;
  specId?: string;
  spec?: import("../../src/generator/spec.schema").ShotSpec;
  error?: string;
}

/** Poll a plan job's spec until it is ready. */
export async function getJobSpec(jobId: string): Promise<SpecResponse> {
  return json(await fetch(`${BASE}/spec/${jobId}`));
}

/** Render an approved plan. This is the only way a spec becomes a video. */
export async function renderSpec(specId: string, audio?: unknown): Promise<{ jobId: string }> {
  return json(
    await fetch(`${BASE}/render-spec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ specId, audio }),
    }),
  );
}

/* Voice casting */
export interface VoiceInfo {
  id: string;
  pace: "fast" | "steady" | "slow";
  sample: string | null;
}

export async function getVoices(engine?: string): Promise<{ voices: VoiceInfo[]; available?: boolean; engines?: { id: string; label: string; note: string }[] }> {
  const q = engine ? `?engine=${encodeURIComponent(engine)}` : "";
  return json(await fetch(`${BASE}/voices${q}`));
}

export interface Video {
  id: string;
  premise: string;
  provider?: string;
  model?: string;
  engine?: "template" | "story";
  music?: { mood?: string; seed?: number };
  scenes?: number;
  events?: number;
  durationSec?: number | string;
  output?: string;
  spec?: string;
  generatedAt?: number;
  reviewFolder?: string;
}

async function errorText(r: Response): Promise<string> {
  let text = `HTTP ${r.status}`;
  try {
    const body = (await r.json()) as { error?: string; fix?: string };
    if (body.error) text = body.error;
    if (body.fix) text += `\n→ Fix: ${body.fix}`;
  } catch {
    /* non-JSON error body, keep generic */
  }
  return text;
}

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(await errorText(r));
  return (await r.json()) as T;
}

export async function getProviders(): Promise<ProvidersResponse> {
  return json(await fetch(`${BASE}/providers`));
}

export async function setProviderKey(name: string, key: string) {
  const r = await fetch(`${BASE}/providers/${name}/key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });
  if (!r.ok) throw new Error(await errorText(r));
  return r.json();
}

export async function setProviderConfig(
  name: string,
  body: { baseUrl?: string; models?: string[] },
) {
  const r = await fetch(`${BASE}/providers/${name}/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await errorText(r));
  return r.json();
}

export async function addProvider(body: {
  name: string;
  package?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
}) {
  const r = await fetch(`${BASE}/providers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await errorText(r));
  return r.json();
}

export interface TestResult {
  name?: string;
  ok: boolean;
  model?: string;
  error?: string;
  note?: string;
  fix?: string;
  latencyMs?: number;
  modelsCount?: number;
}

export interface FetchModelsResult {
  ok: boolean;
  models: string[];
  source: string;
  error?: string;
  fix?: string;
}

export async function fetchProviderModels(name: string): Promise<FetchModelsResult> {
  const r = await fetch(`${BASE}/providers/${name}/models`);
  if (!r.ok) throw new Error(await errorText(r));
  return (await r.json()) as FetchModelsResult;
}

export async function testProvider(name: string, model?: string): Promise<TestResult> {
  const r = await fetch(`${BASE}/providers/${name}/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });
  return r.json();
}

export async function generateVideo(
  premise: string,
  provider?: string,
  model?: string,
) {
  const r = await fetch(`${BASE}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ premise, provider, model }),
  });
  if (!r.ok) throw new Error(await errorText(r));
  return (await r.json()) as { jobId: string };
}

export async function getJob(id: string): Promise<Job> {
  return json(await fetch(`${BASE}/jobs/${id}`));
}

export async function listVideos(): Promise<Video[]> {
  return json(await fetch(`${BASE}/videos`));
}

export async function deleteVideo(id: string): Promise<{ ok: boolean; deleted: number }> {
  const r = await fetch(`${BASE}/videos/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error(await errorText(r));
  return (await r.json()) as { ok: boolean; deleted: number };
}
