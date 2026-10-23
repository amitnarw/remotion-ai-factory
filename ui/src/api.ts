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
  settings?: unknown;
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
  provider?: string;
  model?: string;
  error?: string;
}

/** Poll a plan job's spec until it is ready. */
export async function getJobSpec(jobId: string): Promise<SpecResponse> {
  return json(await fetch(`${BASE}/spec/${jobId}`));
}

/** Render an approved plan. This is the only way a spec becomes a video.
 *  `opts.chunked` renders via the chunked, cached renderer (src/generator/render).
 *  Only the chunks an edit changed are rendered; the rest is reused. */
export async function renderSpec(specId: string, audio?: unknown, opts?: { chunked?: boolean }): Promise<{ jobId: string }> {
  return json(
    await fetch(`${BASE}/render-spec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ specId, audio, chunked: opts?.chunked }),
    }),
  );
}

/* Voice casting */
export interface VoiceInfo {
  id: string;
  pace: "fast" | "steady" | "slow";
  sample: string | null;
}

export async function setDefaultProvider(name: string): Promise<{ ok: boolean }> {
  return json(await fetch(`${BASE}/providers/${encodeURIComponent(name)}/default`, { method: "POST" }));
}
export async function deleteProvider(name: string): Promise<{ ok: boolean }> {
  return json(await fetch(`${BASE}/providers/${encodeURIComponent(name)}`, { method: "DELETE" }));
}
export async function getVoices(engine?: string): Promise<{ voices: VoiceInfo[]; available?: boolean; engines?: { id: string; label: string; note: string }[] }> {
  const q = engine ? `?engine=${encodeURIComponent(engine)}` : "";
  return json(await fetch(`${BASE}/voices${q}`));
}
export interface TtsEngineStatus {
  id: string;
  label: string;
  sizeMB: number;
  python: string | null;
  installed: boolean;
}
export interface TtsStatus {
  kitten2: TtsEngineStatus;
  voxcpm2: TtsEngineStatus;
}
export interface TtsInstallJob {
  id: string;
  engine: string;
  status: "queued" | "running" | "done" | "failed";
  stage: string;
  progress: number;
  message: string;
  error?: string;
  logTail?: string[];
  startedAt?: number;
  lastActivityAt?: number;
}
export async function getTtsStatus(): Promise<TtsStatus> {
  return json(await fetch(`${BASE}/tts/status`));
}
export async function startTtsInstall(engine: string): Promise<{ jobId: string }> {
  return json(await fetch(`${BASE}/tts/install/${engine}`, { method: "POST" }));
}
export async function getTtsInstallJob(id: string): Promise<TtsInstallJob> {
  return json(await fetch(`${BASE}/tts/job/${id}`));
}
export async function cancelJob(id: string): Promise<{ cancelled: boolean }> {
  return json(await fetch(`${BASE}/jobs/${id}`, { method: "DELETE" }));
}
/** Give a character another voice; the server rebuilds the plan from its saved stages. */
export async function recastVoice(specId: string, name: string, voice: string): Promise<{ spec: unknown; warnings: string[] }> {
  return json(
    await fetch(`${BASE}/plan/${specId}/recast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, voice }),
    }),
  );
}

export async function voiceSample(body: { engine: string; voice?: string; voiceDesc?: string; text?: string }): Promise<Blob> {
  const r = await fetch(`${BASE}/voice-sample`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await r.text());
  return r.blob();
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
  thumbnail?: string;
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

export interface RoleInfo {
  name: string;
  label: string;
  description: string;
  usedFrom: string;
  assignment: { provider?: string; model?: string } | null;
}

export interface RolesResponse {
  roles: RoleInfo[];
  providers: { name: string; models: string[] }[];
  defaultProvider: string | null;
}

/** Which provider and model each pipeline role uses. */
export async function getRoles(): Promise<RolesResponse> {
  return json(await fetch(`${BASE}/roles`));
}

/** Save role choices. A null entry clears that role back to the default. */
export async function saveRoles(roles: Record<string, { provider: string; model: string } | null>) {
  return json(
    await fetch(`${BASE}/roles`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roles }),
    }),
  );
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

/* ---------- Editor (Phase 4): one planned video, versioned edits, Ask AI ---------- */

export type Film = import("../../src/generator/film/edits").Film;
export type FilmEdit = import("../../src/generator/film/edits").Edit;
export type FilmRedo = import("../../src/generator/film/edits").Redo;
export type FilmHead = import("../../src/generator/film/store").FilmHead;
export type FilmVersion = import("../../src/generator/film/store").FilmVersion;
export type FieldInfo = import("../../src/generator/film/fields").FieldInfo;
export type AudioReport = import("../../src/generator/audio-resolve").AudioReport;
type PlayableSpec = import("../../src/generator/spec.schema").ShotSpec;

/** What each editable thing has, and its choices (from the pipeline's schemas). */
export interface EditorFields {
  beat: Record<string, FieldInfo>;
  scene: Record<string, FieldInfo>;
  shot: Record<string, FieldInfo>;
  sound: { moods: string[]; sounds: string[] };
}

/** The current version, re-prepared: the spec plays in the Player as is. */
export interface FilmState {
  head: FilmHead;
  film: Film;
  spec: PlayableSpec;
  warnings: string[];
  audio: AudioReport;
  measured: boolean;
}

export interface FilmResponse extends FilmState {
  id: string;
  fields: EditorFields;
}

export interface FilmChangeResponse extends FilmState {
  redo: FilmRedo;
  summary?: string[];
}

export type FilmTarget = { kind: "beat"; beat: string } | { kind: "video" };

/** Ask AI's answer. Nothing is saved until it is sent back through editFilm. */
export interface FilmProposal {
  summary: string;
  edits: FilmEdit[];
  redo: FilmRedo;
  changes: string[];
}

const filmUrl = (id: string, action = "") => `${BASE}/film/${encodeURIComponent(id)}${action ? `/${action}` : ""}`;

function postJson(url: string, body?: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

/** The film, its history, the playable spec and the Inspector's field choices. */
export async function getFilm(id: string): Promise<FilmResponse> {
  return json(await fetch(filmUrl(id)));
}

/** Save edits as a new version. Throws the server's message when an edit is not allowed. */
export async function editFilm(
  id: string,
  body: { edits: FilmEdit[]; source?: "user" | "ai"; summary?: string },
): Promise<FilmChangeResponse> {
  return json(await postJson(filmUrl(id, "edit"), body));
}

/** Ask the Editor model for changes to one beat or the whole video. */
export async function askFilm(id: string, target: FilmTarget, request: string): Promise<FilmProposal> {
  return json(await postJson(filmUrl(id, "ask"), { target, request }));
}

export async function undoFilm(id: string): Promise<FilmChangeResponse> {
  return json(await postJson(filmUrl(id, "undo")));
}

export async function redoFilm(id: string): Promise<FilmChangeResponse> {
  return json(await postJson(filmUrl(id, "redo")));
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
