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
  /** What is wrong with ai.config.json or ai.config.local.json (a broken file is not used). */
  problems?: string[];
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
  /** "cancelled": stopped with DELETE /api/jobs/:id (it stays listed). */
  status: "queued" | "running" | "done" | "failed" | "cancelled";
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
  /** Plan jobs: the run they planned (output/<runId>/). */
  runId?: string;
  /** Plan jobs that stopped at a gate: the story waits, or gate 2's shopping list. */
  gate?: "story" | "shop";
  /** Plan jobs that continue a run rather than start one. */
  resume?: boolean;
  /** Plan jobs: false when the story gate was turned off. */
  storyGate?: boolean;
  /** "variants": a job that makes the other versions of a finished run. */
  kind?: "variants" | "publish";
  /** Variants jobs: what was asked. */
  variants?: VariantsAsk;
  storyboard?: unknown;
  error?: string;
  createdAt: number;
}

/* ---------- Spec engine: the AI writes the plan, you review and approve, then it renders ---------- */

/** Start a plan job: the AI writes the shot spec. Nothing renders yet.
 *  `storyGate: false` plans straight through; otherwise it stops after the story. */
export async function planSpec(body: {
  premise: string;
  provider?: string;
  model?: string;
  audio?: unknown;
  settings?: unknown;
  storyGate?: boolean;
  /** false: never stop at the shopping list (gate 2). */
  shopGate?: boolean;
  storyFrom?: string;
  /** The channel (unset: what-if). */
  channel?: string;
  /** The user's own story or script, and how to use it. */
  script?: string;
  mode?: "adapt" | "as-written";
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
  /** "story": the plan stopped after the story, which waits for approval. "shop": at gate 2's shopping list. */
  gate?: "story" | "shop";
  runId?: string;
  /** Gate 2: what the library is missing, and the offers for it. */
  shopping?: ShoppingList;
  story?: import("../../src/generator/pipeline/writer").WriterStory;
  /** The story's timed length (seconds) and whether the writer revised it to fit. */
  length?: { duration: number; target: number; revised: boolean };
  approved?: boolean;
  /** Gate 1: the story checker's notes, the facts it claims, and (a story rewritten from yours) the plot points it lost. */
  check?: import("../../src/generator/pipeline/checker").StoryCheck;
  /** The claims check at the story gate (story.claims.json), when it ran. */
  claims?: import("../../src/generator/pipeline/claims").ClaimsCheck;
  /** The critic's notes on an approved story, kept as proposals. */
  notes?: Array<{ beat: string; problem: string; fix: string }>;
  /** What the story needs, grouped by what the library has (read-only until gate 2). */
  needs?: Array<{
    status: "have" | "close" | "download" | "build" | "data" | "skip";
    title: string;
    items: Array<{ id: string; kind: string; what: string; must: boolean; beats: string[]; use?: string; then?: string }>;
  }>;
}

/** Poll a plan job's spec until it is ready. */
export async function getJobSpec(jobId: string): Promise<SpecResponse> {
  return json(await fetch(`${BASE}/spec/${jobId}`));
}

/** A channel the factory makes videos for (channels/<id>.json). */
export interface ChannelInfo {
  id: string;
  name: string;
  genre: string;
  description: string;
  modes: Array<"premise" | "adapt" | "as-written">;
  scriptMode: "adapt" | "as-written";
  structure: Array<{ part: string; share: number; purpose: string }>;
  formats: { default?: "9:16" | "16:9" | "1:1"; allowed: Array<{ format: "9:16" | "16:9" | "1:1"; min: number; max: number }> };
  captions: import("../../src/generator/caption-style").CaptionStyleInput | null;
  voices: { narration?: { enabled: boolean; engine: "kitten2" | "voxcpm2"; voice?: string }; dialogs?: { enabled: boolean; engine: "kitten2" | "voxcpm2"; defaultVoice?: string } };
  storyGate: boolean;
  shopGate: boolean;
  version: number;
}

/** Every channel, what-if first. */
export async function getChannels(): Promise<ChannelInfo[]> {
  return json(await fetch(`${BASE}/channels`));
}

/** A channel's profile as its file holds it (channels/<id>.json), with the music moods and story modes it may name. */
export type ChannelProfileFile = Record<string, unknown> & { id: string; version: number; name: string };

export async function getChannelProfile(id: string): Promise<{ profile: ChannelProfileFile; moods: string[]; modes: string[] }> {
  return json(await fetch(`${BASE}/channels/${encodeURIComponent(id)}`));
}

/** Save an edited profile; its version goes up when it changed. */
export async function saveChannelProfile(profile: ChannelProfileFile): Promise<{ ok: true; changed: boolean; version: number; profile: ChannelProfileFile }> {
  return json(
    await fetch(`${BASE}/channels/${encodeURIComponent(profile.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile }),
    }),
  );
}

/** A new channel, copied from another. */
export async function copyChannel(from: string, id: string, name: string): Promise<{ ok: true; id: string; profile: ChannelProfileFile }> {
  return json(
    await fetch(`${BASE}/channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, id, name }),
    }),
  );
}

/** Continue a run in a new plan job: approves the story that waits at the gate,
 *  or goes on from the stage it stopped at. At gate 2, `choices` are the user's:
 *  approvals as the CLI writes them ("n6=bigsoundbank:1048", "n2=close",
 *  "n3=build", "n9=skip") and `allFree` for "Approve every CC0 pick". */
export async function resumeRun(runId: string, choices?: { approvals?: string[]; allFree?: boolean }): Promise<{ jobId: string }> {
  return json(
    await fetch(`${BASE}/plan/${runId}/resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(choices ?? {}),
    }),
  );
}

export interface RunStatus {
  id: string;
  premise: string;
  stages: Array<{ name: string; state: string; model?: string; error?: string }>;
  next: string | null;
  nextLabel: string | null;
  complete: boolean;
  waitsForStory: boolean;
  /** Gate 2's shopping list waits for the user's choices. */
  waitsForShopping?: boolean;
}

/* ---------- Gate 2 and the assets (src/generator/library/acquire) ---------- */

export type ShopOffer = import("../../src/generator/library/acquire/types").Offer;
export type SourceStatus = import("../../src/generator/library/acquire/types").SourceStatus;
export type BuildRequest = import("../../src/generator/library/acquire/types").BuildRequest;

/** One need on gate 2's list: what it is, what stands in meanwhile, and the offers. */
export interface ShoppingNeed {
  need: string;
  kind: string;
  what: string;
  must: boolean;
  status: string;
  type: "model" | "sound" | "ambience" | "music" | null;
  words: string[];
  beats: string[];
  /** The stand-in's id and name. */
  use?: string;
  useName?: string;
  offers: ShopOffer[];
  notes: string[];
}

/** Gate 2's shopping list (output/<run>/shopping.json, the needs that wait). */
export interface ShoppingList {
  inventory: string;
  /** The run still waits for the choices. */
  waiting: boolean;
  needs: ShoppingNeed[];
  sources: SourceStatus[];
  /** The sources this list searched ([] searched none); unset in lists from before it was recorded. */
  searched?: string[];
  warnings: string[];
}

/** Gate 2, from a need's card: more offers for that need (up to 20 from each source). */
export async function moreOffers(runId: string, need: string): Promise<{ need: ShoppingNeed }> {
  return json(
    await fetch(`${BASE}/runs/${runId}/offers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ need }),
    }),
  );
}

/** Gate 2: a link pasted on a need's card, read as an offer (nothing is downloaded). */
export async function offerFromLink(runId: string, need: string, url: string): Promise<{ offer: ShopOffer }> {
  return json(
    await fetch(`${BASE}/runs/${runId}/link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ need, url }),
    }),
  );
}

/** One item acquisition took in (acquired.catalog.json). */
export interface AcquiredInfo {
  id: string;
  kind: "model" | "sound";
  ref: string;
  source: string;
  title: string;
  author: string;
  page: string;
  licence: string;
  tier: "free" | "credit" | "never";
  credit?: string;
  fetchedAt: string;
  need?: { run?: string; id: string; kind: string; what: string; words: string[] };
  notes: string[];
  /** Held back on a re-download (its licence or its file changed). */
  held?: string;
  /** Its files are on this computer. */
  onDisk: boolean;
}

export interface AssetsResponse {
  sources: SourceStatus[];
  /** The build-request queue, most asked first. */
  requests: BuildRequest[];
  unreadable: string[];
  acquired: AcquiredInfo[];
}

/** The Assets page: the sources, the build requests and what was acquired. */
export async function getAssets(): Promise<AssetsResponse> {
  return json(await fetch(`${BASE}/assets`));
}

/** A run's stages: what is done and where a resume starts. */
export async function getRun(runId: string): Promise<RunStatus> {
  return json(await fetch(`${BASE}/runs/${runId}`));
}

/** Render an approved plan. This is the only way a spec becomes a video.
 *  Every button that makes a video (Approve on the review, the editor's Make
 *  the video, Try again on the render screen) sends the same thing: the plan's
 *  id alone. The server renders it with the plan's own voices (the recasts
 *  included) through the chunked, cached renderer, so a later render reuses
 *  every chunk an edit did not change. */
export async function renderSpec(specId: string): Promise<{ jobId: string }> {
  return json(
    await fetch(`${BASE}/render-spec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ specId }),
    }),
  );
}

/* ---------- Variants: other hooks, endings and formats of a finished run (15-producer.md §17) ---------- */

export type VariantFormat = "9:16" | "16:9" | "1:1";

/** Hooks and endings in all, the original counted; the formats (the run's own is always one). */
export interface VariantsAsk {
  hooks: number;
  endings: number;
  formats: VariantFormat[];
}

/** One version of the run (output/<run>/variants/variants.json). Hook and ending 1 are the original. */
export interface VariantInfo {
  id: string;
  hook: number;
  ending: number;
  format: VariantFormat;
  differs: Array<"hook" | "ending" | "format">;
  hookText?: string;
  endingText?: string;
  /** "kept": as long as the run's own video in that format, so its unchanged chunks are reused. */
  timing?: "kept" | "longer";
  state: "planned" | "rendered" | "failed";
  /** Relative to output/<run>/. */
  video?: string;
  durationSec?: number;
  chunks?: { total: number; rendered: number; reused: number };
  error?: string;
  renderedAt?: string;
}

export interface VariantsResponse {
  run: string;
  updatedAt?: string;
  base?: { format: VariantFormat; hook: string; ending: string; video: string };
  hooks?: string[];
  endings?: string[];
  variants: VariantInfo[];
  /** The run's own video: its format, length, and whether its words are the user's own (as written). */
  current: { format: VariantFormat; durationSec: number; asWritten: boolean };
  /** A variants job of this run still running. */
  jobId?: string;
}

export async function getVariants(runId: string): Promise<VariantsResponse> {
  return json(await fetch(`${BASE}/runs/${encodeURIComponent(runId)}/variants`));
}

/** Make the variants in a job: only what differs is voiced and rendered again. */
export async function makeVariants(runId: string, ask: Partial<VariantsAsk>): Promise<{ jobId: string }> {
  return json(
    await fetch(`${BASE}/runs/${encodeURIComponent(runId)}/variants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ask),
    }),
  );
}

/** A finished video's publish pack (output/<id>/publish/publish.json, 20-publish.md); `jobId` while one is being made. */
export type PublishPackInfo = import("../../src/generator/publish").PublishPack & { jobId?: string };

export async function getPublishPack(id: string): Promise<PublishPackInfo> {
  return json(await fetch(`${BASE}/videos/${encodeURIComponent(id)}/publish`));
}

/** Make the publish pack in a job (titles, description, tags, thumbnail); nothing is uploaded. */
export async function makePublishPack(id: string): Promise<{ jobId: string }> {
  return json(await fetch(`${BASE}/videos/${encodeURIComponent(id)}/publish`, { method: "POST" }));
}

/* Voice casting */
export interface VoiceInfo {
  id: string;
  pace?: "fast" | "steady" | "slow";
  sample?: string | null;
  sampleKey?: string;
  previewReady?: boolean;
  label?: string;
  gender?: "male" | "female" | "neutral";
  age?: string;
}

export async function setDefaultProvider(name: string): Promise<{ ok: boolean }> {
  return json(await fetch(`${BASE}/providers/${encodeURIComponent(name)}/default`, { method: "POST" }));
}
export async function deleteProvider(name: string): Promise<{ ok: boolean }> {
  return json(await fetch(`${BASE}/providers/${encodeURIComponent(name)}`, { method: "DELETE" }));
}
export interface VoicesResponse {
  voices: VoiceInfo[];
  available?: boolean;
  engines?: { id: string; label: string; note: string }[];
  /** VoxCPM2 only: what each preset voice sounds like. */
  descriptions?: { id: string; description: string; quality?: string; tags?: string[] }[];
  defaultNarrator?: string;
  defaultCharacter?: string;
}
export async function getVoices(engine?: string): Promise<VoicesResponse> {
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
/** Stop a running job (it stays listed as cancelled); a finished job is removed. */
export async function cancelJob(id: string): Promise<{ cancelled: boolean; deleted?: boolean }> {
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

export async function voiceSample(body: { engine: string; voice?: string; voiceDesc?: string; text?: string }, signal?: AbortSignal): Promise<Blob> {
  const r = await fetch(`${BASE}/voice-sample`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
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
  /** Milliseconds, or an ISO date string in newer reports. */
  generatedAt?: number | string;
  reviewFolder?: string;
}

async function errorText(r: Response): Promise<string> {
  let text = `HTTP ${r.status}`;
  try {
    const body = (await r.json()) as { error?: string; fix?: string };
    if (body.error) text = body.error;
    if (body.fix) text += `\nHow to fix it: ${body.fix}`;
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
  /** PUT only: how much the approved spec changed (story lines / captions). */
  changed?: { lines: number; captions: number };
  /** True while the server re-voices/re-measures edited lines in the background. */
  measuring?: boolean;
}

export interface FilmResponse extends FilmState {
  id: string;
  fields: EditorFields;
  /** An as-written run: Ask AI may change the script's words only to words you type. */
  wordsLocked?: boolean;
}

export interface FilmChangeResponse extends FilmState {
  redo: FilmRedo;
  summary?: string[];
}

/** Wording saves through the approved spec (PUT /api/film/:id). */
export type SaveEditsSpec = (mutate: (spec: import("../../src/generator/spec.schema").ShotSpec) => import("../../src/generator/spec.schema").ShotSpec) => Promise<string | null>;
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

/** Is the background voice measurement still running (a text answer came back on estimates)? */
export async function getFilmStatus(id: string): Promise<{ id: string; measuring: boolean; startedAt?: number; error?: string }> {
  return json(await fetch(filmUrl(id, "status")));
}

/** The editor writes its edited spec here: story wording is adopted into the
 *  film ("reflow": re-voice + re-time), caption wording is kept on its timing
 *  window ("keep timing" - the voice is untouched). */
export async function putFilm(
  id: string,
  body: { spec: unknown },
): Promise<FilmChangeResponse & { changed?: { lines: number; captions: number }; measuring?: boolean }> {
  return json(await fetch(filmUrl(id), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
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

/** Every job the server knows (running, finished and failed), newest last. */
export interface JobListItem {
  id: string;
  status: Job["status"];
  premise: string;
  createdAt: number;
  /** "story": a plan job that stopped for the story's approval; "shop": at gate 2's shopping list. */
  gate?: "story" | "shop";
}
export async function listJobs(): Promise<JobListItem[]> {
  return json(await fetch(`${BASE}/jobs`));
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

/* ---------- The producer you talk to (P5): notes on a run, proposals, confirm, undo ---------- */

export type ProducerTurn = import("../../src/generator/pipeline/notes").Turn;
export type ProducerProposal = import("../../src/generator/pipeline/notes").Proposal & {
  state: import("../../src/generator/pipeline/notes").ProposalState;
  n: number;
};

/** One run's conversation with the producer. */
export interface ProducerConversation {
  id: string;
  /** "plan": the plan is made (changes are editor versions); "story": only the story is written. */
  phase: "plan" | "story" | "none";
  turns: ProducerTurn[];
  proposals: ProducerProposal[];
  standing: string[];
  canUndo: boolean;
}

export async function getProducer(runId: string): Promise<ProducerConversation> {
  return json(await fetch(`${BASE}/producer/${runId}`));
}

async function producerPost<T>(runId: string, route: string, body: unknown): Promise<T> {
  return json(
    await fetch(`${BASE}/producer/${runId}/${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    }),
  );
}

/** A note to the producer: its answer and proposals. Nothing changes until one is applied. */
export function sayToProducer(runId: string, text: string): Promise<ProducerConversation & { reply: string; notes: string[] }> {
  return producerPost(runId, "say", { text });
}

export function applyProposal(runId: string, proposal: string): Promise<ProducerConversation & { done: { summary: string[]; version?: number } }> {
  return producerPost(runId, "ok", { proposal });
}

export function discardProposal(runId: string, proposal: string): Promise<ProducerConversation> {
  return producerPost(runId, "no", { proposal });
}

export function undoProducer(runId: string): Promise<ProducerConversation & { done: { summary: string[] } }> {
  return producerPost(runId, "undo", {});
}

export interface VoiceReference {
  id: string; label: string; archetype: string; tags: string[];
  transcript: string; url: string; duration: number; sr: number; channels: number;
  license: string; createdAt: number; notes?: string;
}
export async function listVoiceReferences(): Promise<VoiceReference[]> {
  const r = await fetch(`${BASE}/voice-references`); if (!r.ok) throw new Error(await r.text());
  return r.json();
}
export async function uploadVoiceReference(body: { id?: string; label: string; archetype?: string; tags?: string[]; audioBase64: string; transcript: string; license?: string; consent: boolean; notes?: string }): Promise<VoiceReference> {
  const r = await fetch(`${BASE}/voice-references`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
export async function deleteVoiceReference(id: string): Promise<void> {
  const r = await fetch(`${BASE}/voice-references/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!r.ok) throw new Error(await r.text());
}
export async function auditionVoiceReference(id: string, body: { engine?: string; text?: string } = {}): Promise<Blob> {
  const r = await fetch(`${BASE}/voice-references/${encodeURIComponent(id)}/audition`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await r.text());
  return r.blob();
}
