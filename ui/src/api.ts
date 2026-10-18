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
  storyboard?: unknown;
  error?: string;
  createdAt: number;
}

export interface StoryInfo {
  slug: string;
  title: string;
  durationSec: number;
  fps: number;
  sfxRoles?: string[];
}

export async function getStories(): Promise<StoryInfo[]> {
  const r = await json<{ stories: StoryInfo[] }>(await fetch(`${BASE}/stories`));
  return r.stories;
}

/* Story Studio — plan → review → approve → render */
export interface StoryDraft {
  slug: string;
  title: string;
  seconds: number;
  createdAt: number;
  approved: boolean;
}

export async function getStoryDrafts(): Promise<StoryDraft[]> {
  const r = await json<{ drafts: StoryDraft[] }>(await fetch(`${BASE}/story/drafts`));
  return r.drafts;
}

export interface PlanStartResult {
  jobId: string;
}

export async function planStory(body: {
  mode: "topic" | "story";
  input: string;
  seconds: number;
  feedback?: string;
  slug?: string;
  previous?: unknown;
}): Promise<PlanStartResult> {
  return json(
    await fetch(`${BASE}/story/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function getStory(slug: string): Promise<{ slug: string; storyboard: unknown }> {
  return json(await fetch(`${BASE}/story/${slug}`));
}

export async function approveStory(slug: string): Promise<{ jobId: string }> {
  return json(
    await fetch(`${BASE}/story/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug }),
    }),
  );
}

export async function setStoryVoiceMode(slug: string, mode: string): Promise<void> {
  const r = await fetch(`${BASE}/story/voice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, mode }),
  });
  if (!r.ok) throw new Error(await errorText(r));
}

export async function generateStory(
  slug: string,
  soundDesign?: Record<string, string>,
): Promise<{ jobId: string }> {
  return json(
    await fetch(`${BASE}/generate-story`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, soundDesign }),
    }),
  );
}

/* Sound design — per-role SFX variant chooser */
export interface SfxVariantInfo {
  id: string;
  file: string;
  url: string;
  dur: number;
  source: string;
  pack?: string;
  peakDb: number;
  rmsDb: number;
  autoRank: number;
}

export interface SoundRoleInfo {
  id: string;
  label: string;
  description: string;
  family: "ambient" | "event";
  variants: SfxVariantInfo[];
}

export interface SoundDesignResponse {
  slug: string;
  available: boolean;
  roles: SoundRoleInfo[];
  selection: Record<string, string>;
  catalogGeneratedAt?: number;
  fixHint?: string;
}

export async function getSoundDesign(slug: string): Promise<SoundDesignResponse> {
  return json(await fetch(`${BASE}/sound-design/${slug}`));
}

export async function saveSoundMap(
  slug: string,
  map: Record<string, string>,
): Promise<{ ok: boolean; map: Record<string, string> }> {
  return json(
    await fetch(`${BASE}/sound-design/${slug}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ map }),
    }),
  );
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
