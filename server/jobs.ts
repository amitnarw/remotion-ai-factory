import { spawn, spawnSync } from "child_process";
import fs from "fs";
import { type ServerResponse } from "http";
import { join, basename, isAbsolute } from "path";
import { ROOT } from "./providers";
import { FFMPEG } from "../src/generator/ffmpeg";
import { reportTime } from "../src/generator/ai/knowledge";
import { actionable } from "./error-hints";
import { isLaterStage, nextProgress, PLAN_PROGRESS, readRenderLog, stageMarker } from "./progress";

export interface StageSpan {
  stage: string;
  startedAt: number;
  endedAt?: number;
}

export interface Job {
  id: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  progress: number;
  stage: string;
  etaSec: number | null;
  timeline: StageSpan[];
  logs: string[];
  premise: string;
  provider?: string;
  model?: string;
  /** "template" = spec pipeline; "story" = agent-authored composition;
   *  "plan" = story writing; "storyboard" = storyboard render pipeline. */
  engine?: "template" | "story" | "plan" | "storyboard";
  output?: { mp4: string; spec: unknown; report: string };
  /** Set by plan jobs (once the storyboard exists) + storyboard jobs. */
  slug?: string;
  storyboard?: unknown;
  /** Audio/TTS selection from the UI (narration/dialogs engine + voices). */
  audio?: unknown;
  /** Plan jobs: the voice settings file passed to the CLI (output/plan-<id>-audio.json). */
  audioFile?: string;
  /** Plan jobs: the video settings passed to the CLI. */
  settings?: unknown;
  /** Plan jobs: false when the request named no provider/model (each role uses its own). */
  explicitModel?: boolean;
  /** @internal handle to the spawned child process (for cancellation). */
  child?: import("child_process").ChildProcess;
  /** Spec-engine jobs: the <id> of output/<id>-spec.json once written. */
  specId?: string;
  /** Plan jobs: the run the CLI planned (output/<runId>/run.json), from its RUN_ID line. */
  runId?: string;
  /** Plan jobs that stopped at a gate: the story waits for approval (STORY_ID), or the shopping list for the user's choices (SHOP_ID). */
  gate?: "story" | "shop";
  /** Plan jobs: false skips the story gate (--no-story-gate). */
  storyGate?: boolean;
  /** Plan jobs: false skips gate 2, the shopping list (--no-shop-gate). */
  shopGate?: boolean;
  /** Plan jobs: the sources gate 2 searches (--sources; [] is none). */
  shopSources?: string[];
  /** Plan jobs that continue a run (--resume) rather than start one. */
  resume?: boolean;
  /** Plan jobs: the run whose story this plan reuses (--story-from). */
  storyFrom?: string;
  /** Plan jobs: the channel (--channel), the story mode (--mode) and the pasted story's file (--script, output/plan-<jobId>-script.txt). */
  channel?: string;
  mode?: string;
  scriptFile?: string;
  /** "variants": a job that makes the other versions of a finished run (generate.ts variants <run>, VARIANTS_ID).
   *  "publish": the publish pack of a finished run (scripts/publish.ts <run>, PUBLISH_DIR). */
  kind?: "variants" | "publish";
  /** Variants jobs: what was asked (hooks and endings in all, the formats). */
  variants?: { hooks: number; endings: number; formats: string[] };
  error?: string;
  createdAt: number;
}

const jobs = new Map<string, Job>();
const sseClients = new Map<string, Set<ServerResponse>>();
let jobIdCounter = 0;

/* ------------------------------------------------------------------ */
/*  Disk persistence — jobs survive a server restart                   */
/* ------------------------------------------------------------------ */

const JOBS_DIR = join(ROOT, "output", "jobs");
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const MAX_PERSISTED_LOGS = 400;

function writeJobFile(job: Job): void {
  try {
    fs.mkdirSync(JOBS_DIR, { recursive: true });
    // The child handle is process-bound and is never saved.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { child, ...rest } = job;
    const logs = rest.logs?.length > MAX_PERSISTED_LOGS ? rest.logs.slice(-MAX_PERSISTED_LOGS) : rest.logs ?? [];
    fs.writeFileSync(join(JOBS_DIR, `${job.id}.json`), JSON.stringify({ ...rest, logs }));
  } catch {
    /* persistence must never break the job */
  }
}

/** Persist a job. Debounced by default (progress can change several times a second). */
function persist(job: Job, immediate = false): void {
  if (immediate) {
    const t = saveTimers.get(job.id);
    if (t) clearTimeout(t);
    saveTimers.delete(job.id);
    writeJobFile(job);
    return;
  }
  if (saveTimers.has(job.id)) return;
  saveTimers.set(
    job.id,
    setTimeout(() => {
      saveTimers.delete(job.id);
      writeJobFile(job);
    }, 1500),
  );
}

/** Remove a job's file (used when a job is deleted from the dashboard). */
function deleteJobFile(id: string): void {
  const t = saveTimers.get(id);
  if (t) clearTimeout(t);
  saveTimers.delete(id);
  try { fs.rmSync(join(JOBS_DIR, `${id}.json`), { force: true }); } catch { /* ignore */ }
}

/** POST /api/plan's voice settings for the CLI (output/plan-<jobId>-audio.json): only needed while the job runs. */
function removePlanAudioFile(id: string): void {
  if (!/^[0-9]+-[0-9]+$/.test(id)) return;
  try { fs.rmSync(join(ROOT, "output", `plan-${id}-audio.json`), { force: true }); } catch { /* ignore */ }
  // The pasted story or script goes the same way (the run's brief keeps its text).
  try { fs.rmSync(join(ROOT, "output", `plan-${id}-script.txt`), { force: true }); } catch { /* ignore */ }
}

/**
 * Under FACTORY_LLM_FIXTURES no model wrote the plan, but the pipeline records
 * the configured role models in plan.json: name the fixtures instead.
 */
function markFixtureModels(specId: string): void {
  const fixtures = process.env.FACTORY_LLM_FIXTURES;
  if (!fixtures || !/^[a-z0-9-]+$/.test(specId)) return;
  const planPath = join(ROOT, "output", specId, "plan.json");
  try {
    const plan = JSON.parse(fs.readFileSync(planPath, "utf8")) as { models?: Record<string, unknown> };
    const roles = Object.keys(plan.models ?? {});
    plan.models = Object.fromEntries((roles.length ? roles : ["writer"]).map((r) => [r, { provider: "fixtures", model: fixtures }]));
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
  } catch { /* the plan check reports a missing plan */ }
}

/** Load jobs written by a previous server run; an in-flight job was killed with it. */
function loadJobsFromDisk(): void {
  if (!fs.existsSync(JOBS_DIR)) return;
  for (const f of fs.readdirSync(JOBS_DIR)) {
    if (!/^[0-9]+-[0-9]+\.json$/.test(f)) continue;
    let j: Job;
    try {
      j = JSON.parse(fs.readFileSync(join(JOBS_DIR, f), "utf8")) as Job;
    } catch {
      continue;
    }
    if (!j || typeof j.id !== "string" || jobs.has(j.id)) continue;
    if (j.status === "running" || j.status === "queued") {
      // The spawned CLI died with the server: mark it so the dashboard shows why.
      // A plan's run kept every stage that finished, so it can resume from there.
      j.status = "failed";
      const again = j.engine === "plan" && j.runId ? "Resume it to go on from the stage it stopped at." : "Run it again.";
      j.error = `${j.error ? j.error + "\n" : ""}Interrupted: the server restarted while this job was running. ${again}`;
      const open = j.timeline?.[j.timeline.length - 1];
      if (open && open.endedAt == null) open.endedAt = Date.now();
      j.timeline = [...(j.timeline ?? []), { stage: "failed", startedAt: Date.now() }];
      j.stage = "failed";
      j.logs = [...(j.logs ?? []), "Server restarted — job lost."];
    }
    j.child = undefined;
    j.logs ??= [];
    j.timeline ??= [{ stage: j.stage ?? "script", startedAt: Date.now() }];
    // Every restored job has ended: its plan voice-settings file is not needed any more.
    removePlanAudioFile(j.id);
    jobs.set(j.id, j);
    sseClients.set(j.id, new Set());
    const n = Number(j.id.split("-").pop());
    if (Number.isFinite(n) && n > jobIdCounter) jobIdCounter = n;
  }
}
loadJobsFromDisk();

/**
 * Plan voice-settings files left by older runs (their job is gone). The CLI
 * reads the file as it starts, so one older than an hour is never needed, even
 * by a job of another server sharing output/.
 */
function sweepPlanAudioFiles(): void {
  const dir = join(ROOT, "output");
  try {
    for (const f of fs.readdirSync(dir)) {
      const m = /^plan-([0-9]+-[0-9]+)-(?:audio\.json|script\.txt)$/.exec(f);
      if (!m || jobs.get(m[1])?.status === "running") continue;
      if (Date.now() - fs.statSync(join(dir, f)).mtimeMs > 60 * 60 * 1000) removePlanAudioFile(m[1]);
    }
  } catch { /* no output/ yet */ }
}
sweepPlanAudioFiles();

function setStage(job: Job, stage: string) {
  if (job.stage === stage) return;
  const cur = job.timeline[job.timeline.length - 1];
  if (cur && cur.endedAt == null) cur.endedAt = Date.now();
  job.stage = stage;
  job.timeline.push({ stage, startedAt: Date.now() });
  persist(job);
}

function broadcast(jobId: string, data: unknown) {
  const clients = sseClients.get(jobId);
  if (!clients) return;
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const c of [...clients]) {
    try { c.write(msg); } catch { /* ignore */ }
  }
}

export function createJob(premise: string, provider?: string, model?: string): Job {
  jobIdCounter += 1;
  const id = `${Date.now()}-${jobIdCounter}`;
  const job: Job = {
    id,
    status: "queued",
    progress: 0,
    stage: "script",
    etaSec: null,
    timeline: [{ stage: "script", startedAt: Date.now() }],
    logs: [],
    premise,
    provider,
    model,
    engine: "template",
    createdAt: Date.now(),
  };
  jobs.set(id, job);
  sseClients.set(id, new Set());
  persist(job, true);
  evictOldJobs();
  return job;
}

export function getJob(id: string): Job | undefined { return jobs.get(id); }

/**
 * DELETE /api/jobs/:id. A running job is cancelled (it stays listed as
 * cancelled); a finished one is removed from memory and disk, its SSE
 * clients closed and its plan voice-settings file deleted. Null when unknown.
 */
export function deleteJob(id: string): "cancelled" | "deleted" | null {
  const job = jobs.get(id);
  if (!job) return null;
  if (job.status === "running" || job.status === "queued") return cancelJob(id) ? "cancelled" : null;
  for (const c of sseClients.get(id) ?? []) {
    try { c.end(); } catch { /* ignore */ }
  }
  sseClients.delete(id);
  jobs.delete(id);
  deleteJobFile(id);
  removePlanAudioFile(id);
  return "deleted";
}
export function getAllJobs(): Job[] { return Array.from(jobs.values()).sort((a, b) => b.createdAt - a.createdAt); }
export function cancelJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job || (job.status !== "running" && job.status !== "queued")) return false;
  try { job.child?.kill("SIGTERM"); } catch { /* ignore */ }
  job.status = "cancelled";
  job.error = "Cancelled by user";
  persist(job, true);
  broadcast(job.id, { type: "failed", error: job.error });
  return true;
}

/** Shared premise slug — must match the CLI's slug in generate.ts. */
export function premiseSlug(premise: string): string {
  return (
    premise.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96) ||
    `premise-${Date.now()}`
  );
}

/** Keep the jobs map bounded — evict oldest finished jobs beyond 50. */
function evictOldJobs() {
  if (jobs.size <= 50) return;
  const finished = getAllJobs().filter((j) => j.status === "done" || j.status === "failed" || j.status === "cancelled");
  for (let i = finished.length - 1; i >= 0 && jobs.size > 50; i--) {
    const victim = finished[i];
    for (const c of sseClients.get(victim.id) ?? []) {
      try { c.end(); } catch { /* ignore */ }
    }
    sseClients.delete(victim.id);
    jobs.delete(victim.id);
    deleteJobFile(victim.id);
  }
}

/**
 * The report of the video a job made. `preferId` is the job's own folder
 * (output/<id>/): since every run has its own id, one premise can have
 * several videos, so the premise is only the fallback.
 */
function latestReportFor(premise: string, preferId?: string): { mp4: string; spec: unknown; report: string } | undefined {
  const dir = join(ROOT, "output");
  if (!fs.existsSync(dir)) return undefined;
  const matches: Array<{ report: unknown; file: string; videoDir: string }> = [];
  const own = preferId && /^[a-z0-9-]+$/.test(preferId) && fs.existsSync(join(dir, preferId, "report.json")) ? preferId : undefined;
  for (const f of own ? [own] : fs.readdirSync(dir)) {
    const videoDir = join(dir, f);
    if (!fs.statSync(videoDir).isDirectory()) continue;
    const reportFile = join(videoDir, "report.json");
    if (!fs.existsSync(reportFile)) continue;
    try {
      const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
      if (report && typeof report === "object" && (report as Record<string, unknown>).premise === premise) {
        matches.push({ report, file: f, videoDir });
      }
    } catch { /* ignore */ }
  }
  if (matches.length === 0) return undefined;
  // generatedAt is an ISO date: newest first.
  const when = (r: unknown) => reportTime((r as Record<string, unknown>).generatedAt);
  matches.sort((a, b) => when(b.report) - when(a.report));
  const latest = matches[0] as { report: unknown; file: string; videoDir: string };
  let spec: unknown = {};
  try {
    const specRaw = (latest.report as Record<string, unknown>).spec as string;
    const sp = isAbsolute(specRaw) ? specRaw : join(latest.videoDir, specRaw);
    spec = JSON.parse(fs.readFileSync(sp, "utf8"));
  } catch { /* keep {} */ }
  // Relative to output/, so the dashboard's /media/<path> finds it: <id>/video.mp4.
  return { mp4: `${latest.file}/${basename((latest.report as Record<string, unknown>).output as string)}`, spec, report: join(latest.videoDir, "report.json") };
}

// The CLI's FAILED log policy writes output/FAILED-<id>.log on failure.
// Extract the human-readable reason — but ONLY from a log written for THIS
// job: its run's own log when the CLI named the run (RUN_ID), else one for
// this premise (slug match). Never attribute another premise's stale error here.
function failedLogError(premise: string, runId?: string): string | undefined {
  const dir = join(ROOT, "output");
  if (!fs.existsSync(dir)) return undefined;
  const slug = premiseSlug(premise);
  const own = runId && /^[a-z0-9-]+$/.test(runId) ? `FAILED-${runId}.log` : undefined;
  const match = own
    ? fs.existsSync(join(dir, own)) ? own : undefined
    : fs.readdirSync(dir).find((f) => f.startsWith("FAILED-") && f.endsWith(".log") && f.toLowerCase().includes(slug));
  if (!match) return undefined;
  const text = fs.readFileSync(join(dir, match), "utf8");
  const lines = text.split(/\r?\n/);
  // Skip warning lines (FutureWarning, DeprecationWarning, etc.)
  const cleanLines = lines.filter((l) => !l.includes("FutureWarning") && !l.includes("DeprecationWarning") && !l.includes("UserWarning"));
  const idx = cleanLines.findIndex((l) => l.startsWith("Error:"));
  if (idx >= 0) {
    return cleanLines.slice(idx, idx + 4).join("\n").trim();
  }
  const tail = cleanLines.filter((l) => l.trim()).slice(-5).join("\n");
  return tail || undefined;
}

export function runJob(job: Job, opts?: { extraArgs?: string[]; noRender?: boolean; script?: string }) {
  job.status = "running";
  broadcast(job.id, { type: "status", status: "running" });
  // The CLI by default; another script (scripts/publish.ts) takes only extraArgs.
  const args = [opts?.script ?? "src/generator/generate.ts"];
  if (opts?.extraArgs) {
    // render-only: an approved spec — no provider/model flags needed
    args.push(...opts.extraArgs);
  } else {
    args.push(job.premise);
    if (opts?.noRender) args.push("--no-render");
    // Only a provider/model the request named explicitly; otherwise every
    // pipeline role uses its own assignment from Settings -> AI models -> Model roles.
    if (job.explicitModel !== false) {
      if (job.provider) args.push("--provider", job.provider);
      if (job.model) args.push("--model", job.model);
    }
    // The story gate and gate 2 are on unless the request turned them off.
    if (job.storyGate === false) args.push("--no-story-gate");
    if (job.shopGate === false) args.push("--no-shop-gate");
    if (job.shopSources) args.push("--sources", job.shopSources.length ? job.shopSources.join(",") : "none");
    if (job.storyFrom) args.push("--story-from", job.storyFrom);
    if (job.channel) args.push("--channel", job.channel);
    if (job.mode) args.push("--mode", job.mode);
    if (job.scriptFile) args.push("--script", job.scriptFile);
    const settings = job.settings;
    if (settings) args.push("--settings-json", JSON.stringify(settings));
    const audioFile = job.audioFile;
    if (audioFile) args.push("--audio-file", audioFile);
  }
  const child = spawn("npx", ["--no-install", "tsx", ...args], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    // The child inherits process.env, which the plan routes fill from .env
    // first; the CLI also reads .env itself (loadDotEnv, never overriding).
  });
  job.child = child;
  // "@@STAGE <name>" lines from the pipeline drive the stage pills. Output
  // arrives in chunks that can split a line, so keep the unfinished tail.
  let pending = "";
  const handleStageMarkers = (text: string) => {
    pending += text;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      // The run's id, as soon as the CLI names it: a job the server loses
      // (a restart) can still resume its run.
      const run = /^RUN_ID:\s*([a-z0-9-]+)/.exec(line.trim());
      if (run && !job.runId) {
        job.runId = run[1];
        persist(job);
      }
      const stage = stageMarker(line);
      if (!stage) continue;
      setStage(job, stage);
      if (job.engine === "plan") job.progress = nextProgress(job.progress, PLAN_PROGRESS[stage]);
      broadcast(job.id, { type: "progress", progress: job.progress, stage: job.stage, etaSec: job.etaSec });
    }
  };
  const handleOutput = (text: string) => {
    handleStageMarkers(text);
    // Strip ANSI color escapes (Remotion prints colored output) so the
    // dashboard log console doesn't show raw escape garbage.
    // eslint-disable-next-line no-control-regex
    const clean = text.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");
    job.logs.push(clean);
    broadcast(job.id, { type: "log", text: clean });
    // Plan jobs follow the @@STAGE markers only (a "[voice]" line used to pull
    // a plan back to 12% after the voice stage set 30); render jobs also read
    // the log lines. Stages only move forwards and progress never goes down.
    const signal = job.engine === "plan" ? {} : readRenderLog(text);

    let dirty = false;
    if (signal.stage && isLaterStage(job.stage, signal.stage)) {
      setStage(job, signal.stage);
      dirty = true;
    }
    if (signal.eta !== undefined) {
      job.etaSec = signal.eta;
      dirty = true;
    }
    const p = nextProgress(job.progress, signal.pct);
    if (p !== job.progress) {
      job.progress = p;
      dirty = true;
    }
    if (dirty) {
      broadcast(job.id, {
        type: "progress",
        progress: job.progress,
        stage: job.stage,
        etaSec: job.etaSec,
      });
      persist(job);
    }
  };
  child.stdout.on("data", (buf) => handleOutput(buf.toString()));
  child.stderr.on("data", (buf) => handleOutput(buf.toString()));
  child.on("close", (code) => {
    // Spec-engine plan jobs print machine-readable markers: RUN_ID as they
    // start, then PLAN_ID (the plan is written), STORY_ID (the story waits
    // at the gate for approval) or SHOP_ID (gate 2's shopping list waits).
    const all = job.logs.join("");
    const runLine = all.match(/RUN_ID:\s*(\S+)/);
    if (runLine) job.runId = runLine[1];
    const planLine = all.match(/PLAN_ID:\s*(\S+)/);
    if (planLine) job.specId = planLine[1];
    const storyLine = all.match(/STORY_ID:\s*(\S+)/);
    const shopLine = all.match(/SHOP_ID:\s*(\S+)/);
    if (storyLine && !planLine) {
      job.gate = "story";
      job.runId = storyLine[1];
    } else if (shopLine && !planLine) {
      job.gate = "shop";
      job.runId = shopLine[1];
    }
    removePlanAudioFile(job.id);
    if (job.status === "cancelled") {
      // DELETE /api/jobs/:id killed it: keep "cancelled" (not a failure to explain).
      setStage(job, "cancelled");
    } else if (code === 0) {
      if (job.engine === "plan" && job.specId) markFixtureModels(job.specId);
      job.status = "done";
      job.progress = 100;
      job.etaSec = 0;
      setStage(job, "done");
      const out = latestReportFor(job.premise, job.specId);
      if (out) job.output = out;
      // Extract a poster thumbnail for the Videos tab (best-effort). A
      // variants or publish job's output is the run's own video, which has one already.
      if (out?.mp4 && !job.kind) {
        const vid = out.mp4.split("/")[0] || job.specId || job.premise.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96);
        // Find the video directory
        const videoDir = join(ROOT, "output", vid);
        const mp4Abs = join(videoDir, "video.mp4");
        const thumbAbs = join(videoDir, "thumb.jpg");
        try {
          spawnSync(FFMPEG, ["-y", "-i", mp4Abs, "-ss", "00:00:01", "-vframes", "1", "-q:v", "3", thumbAbs], { stdio: "ignore" });
        } catch { /* ignore */ }
      }
      broadcast(job.id, { type: "done", timeline: job.timeline });
    } else {
      job.status = "failed";
      setStage(job, "failed");
      const logError = failedLogError(job.premise, job.runId);
      const logTail = job.logs
        .join("")
        .split(/\r?\n/)
        .filter((l) => l.trim() && !l.includes("Rendered ") && !l.includes("FutureWarning") && !l.includes("DeprecationWarning") && !l.includes("UserWarning"))
        .slice(-4)
        .join("\n");
      job.error = logError ?? (logTail || `exit code ${code}`);
      // Attach the actionable fix for known failure classes.
      const hint = actionable(job.error, job.provider);
      if (hint.fix) job.error += `\n→ Fix: ${hint.fix}`;
      broadcast(job.id, { type: "failed", error: job.error, timeline: job.timeline });
    }
    // Terminal state reached — release SSE sockets for this job.
    for (const c of sseClients.get(job.id) ?? []) {
      try { c.end(); } catch { /* ignore */ }
    }
    sseClients.delete(job.id);
    persist(job, true);
  });
}

export function subscribeSSE(jobId: string, res: ServerResponse) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write("\n");
  // Already finished (done, failed, cancelled, or restored after a restart):
  // send the final state and close; nothing would ever end this stream.
  const job = jobs.get(jobId);
  if (job && job.status !== "running" && job.status !== "queued") {
    const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    send({ type: "progress", progress: job.progress, stage: job.stage, etaSec: job.etaSec });
    send(job.status === "done" ? { type: "done", timeline: job.timeline } : { type: "failed", error: job.error ?? `job ${job.status}`, timeline: job.timeline });
    res.end();
    return;
  }
  const clients = sseClients.get(jobId) ?? new Set();
  clients.add(res);
  sseClients.set(jobId, clients);
  res.on("close", () => { clients.delete(res); });
}
