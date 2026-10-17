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

export interface Job {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  progress: number;
  logs: string[];
  premise: string;
  provider?: string;
  model?: string;
  output?: JobOutput;
  error?: string;
  createdAt: number;
}

export interface Video {
  id: string;
  premise: string;
  provider?: string;
  model?: string;
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
    const body = (await r.json()) as { error?: string };
    if (body.error) text = body.error;
  } catch {
    /* non-JSON error body — keep generic */
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
  name: string;
  ok: boolean;
  model?: string;
  error?: string;
  note?: string;
}

export interface FetchModelsResult {
  ok: boolean;
  models: string[];
  source: string;
  error?: string;
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
