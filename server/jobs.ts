import { spawn } from "child_process";
import fs from "fs";
import { type ServerResponse } from "http";
import { join, basename, isAbsolute } from "path";
import { loadEnv, ROOT } from "./providers";
import { actionable } from "./error-hints";

export interface StageSpan {
  stage: string;
  startedAt: number;
  endedAt?: number;
}

export interface Job {
  id: string;
  status: "queued" | "running" | "done" | "failed";
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
  /** Spec-engine jobs: the <id> of output/<id>-spec.json once written. */
  specId?: string;
  error?: string;
  createdAt: number;
}

const jobs = new Map<string, Job>();
const sseClients = new Map<string, Set<ServerResponse>>();
let jobIdCounter = 0;

function setStage(job: Job, stage: string) {
  if (job.stage === stage) return;
  const cur = job.timeline[job.timeline.length - 1];
  if (cur && cur.endedAt == null) cur.endedAt = Date.now();
  job.stage = stage;
  job.timeline.push({ stage, startedAt: Date.now() });
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
  evictOldJobs();
  return job;
}

export function createStoryJob(slug: string, title: string): Job {
  jobIdCounter += 1;
  const id = `${Date.now()}-s${jobIdCounter}`;
  const job: Job = {
    id,
    status: "queued",
    progress: 0,
    stage: "music",
    etaSec: null,
    timeline: [{ stage: "music", startedAt: Date.now() }],
    logs: [],
    premise: title,
    engine: "story",
    createdAt: Date.now(),
  };
  void slug;
  jobs.set(id, job);
  sseClients.set(id, new Set());
  evictOldJobs();
  return job;
}

export function getJob(id: string): Job | undefined { return jobs.get(id); }
export function getAllJobs(): Job[] { return Array.from(jobs.values()).sort((a, b) => b.createdAt - a.createdAt); }

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
  const finished = getAllJobs().filter((j) => j.status === "done" || j.status === "failed");
  for (let i = finished.length - 1; i >= 0 && jobs.size > 50; i--) {
    const victim = finished[i];
    for (const c of sseClients.get(victim.id) ?? []) {
      try { c.end(); } catch { /* ignore */ }
    }
    sseClients.delete(victim.id);
    jobs.delete(victim.id);
  }
}

function latestReportFor(premise: string): { mp4: string; spec: unknown; report: string } | undefined {
  const dir = join(ROOT, "output");
  if (!fs.existsSync(dir)) return undefined;
  const matches: Array<{ report: unknown; file: string }> = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith("-report.json")) continue;
    try {
      const report = JSON.parse(fs.readFileSync(join(dir, f), "utf8"));
      if (report && typeof report === "object" && (report as Record<string, unknown>).premise === premise) {
        matches.push({ report, file: f });
      }
    } catch { /* ignore */ }
  }
  if (matches.length === 0) return undefined;
  matches.sort(
    (a, b) =>
      Number((b.report as Record<string, unknown>).generatedAt || 0) -
      Number((a.report as Record<string, unknown>).generatedAt || 0),
  );
  const latest = matches[0] as { report: unknown; file: string };
  let spec: unknown = {};
  try {
    const specRaw = (latest.report as Record<string, unknown>).spec as string;
    const sp = isAbsolute(specRaw) ? specRaw : join(dir, specRaw);
    spec = JSON.parse(fs.readFileSync(sp, "utf8"));
  } catch { /* keep {} */ }
  return { mp4: basename((latest.report as Record<string, unknown>).output as string), spec, report: latest.file };
}

// The CLI's FAILED log policy writes output/FAILED-<slug>.log on failure.
// Extract the human-readable reason — but ONLY from a log written for THIS
// premise (slug match). Never attribute another premise's stale error here.
function failedLogError(premise: string): string | undefined {
  const dir = join(ROOT, "output");
  if (!fs.existsSync(dir)) return undefined;
  const slug = premiseSlug(premise);
  const match = fs
    .readdirSync(dir)
    .find((f) => f.startsWith("FAILED-") && f.endsWith(".log") && f.toLowerCase().includes(slug));
  if (!match) return undefined;
  const text = fs.readFileSync(join(dir, match), "utf8");
  const lines = text.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.startsWith("Error:"));
  if (idx >= 0) {
    return lines.slice(idx, idx + 4).join("\n").trim();
  }
  const tail = lines.filter((l) => l.trim()).slice(-5).join("\n");
  return tail || undefined;
}

export function runJob(job: Job, opts?: { extraArgs?: string[]; noRender?: boolean }) {
  job.status = "running";
  broadcast(job.id, { type: "status", status: "running" });
  const args = ["src/generator/generate.ts"];
  if (opts?.extraArgs) {
    // render-only: an approved spec — no provider/model flags needed
    args.push(...opts.extraArgs);
  } else {
    args.push(job.premise);
    if (opts?.noRender) args.push("--no-render");
    if (job.provider) args.push("--provider", job.provider);
    if (job.model) args.push("--model", job.model);
  }
  const child = spawn("npx", ["--no-install", "tsx", ...args], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    // Inject keys saved to .env via the dashboard — the CLI has no dotenv
    // loader and reads process.env directly.
    env: { ...process.env, ...loadEnv() },
  });
  const handleOutput = (text: string) => {
    // Strip ANSI color escapes (Remotion prints colored output) so the
    // dashboard log console doesn't show raw escape garbage.
    // eslint-disable-next-line no-control-regex
    const clean = text.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");
    job.logs.push(clean);
    broadcast(job.id, { type: "log", text: clean });
    let pct: number | undefined;
    let newStage: string | undefined;
    let eta: number | undefined;

    const rend = text.match(/Rendered\s+(\d+)\/(\d+)/);
    if (rend) {
      newStage = "render";
      pct = 25 + (parseInt(rend[1], 10) / parseInt(rend[2], 10)) * 67;
      const em = text.match(/time remaining:\s*(?:(\d+)m\s*([\d.]+)s|([\d.]+)s)/);
      if (em) {
        eta = em[1] ? parseInt(em[1], 10) * 60 + parseFloat(em[2]) : parseFloat(em[3]);
      }
    } else if (text.includes("[1/5]")) {
      newStage = "script";
    } else if (text.includes("[3/5]")) {
      // The CLI's own trace line marks the true bundle start — Remotion's
      // "Bundling N%" lines only appear after esbuild's silent work.
      newStage = "bundle";
    } else if (text.includes("Getting composition")) {
      newStage = "render";
    } else if (text.includes("[5/5]")) {
      newStage = "encode";
    } else {
      const bund = text.match(/Bundling\s+(\d+)%/);
      if (bund) {
        newStage = "bundle";
        pct = 15 + parseInt(bund[1], 10) * 0.1;
      } else {
        const enc = text.match(/Encoded\s+(\d+)\/(\d+)/);
        if (enc) {
          newStage = "encode";
          pct = 92 + (parseInt(enc[1], 10) / parseInt(enc[2], 10)) * 7;
        }
      }
    }

    let dirty = false;
    if (newStage) {
      setStage(job, newStage);
      dirty = true;
    }
    if (eta !== undefined) {
      job.etaSec = eta;
      dirty = true;
    }
    if (pct !== undefined) {
      const p = Math.min(99, Math.round(pct));
      if (p !== job.progress) {
        job.progress = p;
        dirty = true;
      }
    }
    if (dirty) {
      broadcast(job.id, {
        type: "progress",
        progress: job.progress,
        stage: job.stage,
        etaSec: job.etaSec,
      });
    }
  };
  child.stdout.on("data", (buf) => handleOutput(buf.toString()));
  child.stderr.on("data", (buf) => handleOutput(buf.toString()));
  child.on("close", (code) => {
    // Spec-engine plan jobs print a machine-readable PLAN_ID marker.
    const planLine = job.logs.join("").match(/PLAN_ID:\s*(\S+)/);
    if (planLine) job.specId = planLine[1];
    if (code === 0) {
      job.status = "done";
      job.progress = 100;
      job.etaSec = 0;
      setStage(job, "done");
      const out = latestReportFor(job.premise);
      if (out) job.output = out;
      broadcast(job.id, { type: "done", timeline: job.timeline });
    } else {
      job.status = "failed";
      setStage(job, "failed");
      const logError = failedLogError(job.premise);
      const logTail = job.logs
        .join("")
        .split(/\r?\n/)
        .filter((l) => l.trim() && !l.includes("Rendered "))
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
  });
}

export function subscribeSSE(jobId: string, res: ServerResponse) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write("\n");
  const clients = sseClients.get(jobId) ?? new Set();
  clients.add(res);
  sseClients.set(jobId, clients);
  res.on("close", () => { clients.delete(res); });
}

/**
 * Story-engine job: renders a registered agent-authored video
 * (scripts/render-story.ts <slug>). Stages: music → bundle → render → encode.
 */
export function runStoryJob(job: Job, slug: string) {
  job.status = "running";
  broadcast(job.id, { type: "status", status: "running" });
  const child = spawn(
    "npx",
    ["--no-install", "tsx", "scripts/render-story.ts", slug],
    {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ... process.env, FFMPEG_PATH: join(ROOT, "node_modules", "@remotion", "compositor-win32-x64-msvc", "ffmpeg.exe") },
    },
  );

  const handleOutput = (text: string) => {
    // eslint-disable-next-line no-control-regex
    const clean = text.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");
    job.logs.push(clean);
    broadcast(job.id, { type: "log", text: clean });
    let pct: number | undefined;
    let newStage: string | undefined;
    let eta: number | undefined;

    const rend = text.match(/Rendered\s+(\d+)\/(\d+)/);
    if (rend) {
      newStage = "render";
      pct = 30 + (parseInt(rend[1], 10) / parseInt(rend[2], 10)) * 62;
      const em = text.match(/time remaining:\s*(?:(\d+)m\s*([\d.]+)s|([\d.]+)s)/);
      if (em) {
        eta = em[1] ? parseInt(em[1], 10) * 60 + parseFloat(em[2]) : parseFloat(em[3]);
      }
    } else if (text.includes("[render]")) {
      newStage = "bundle";
      pct = 12;
    } else if (text.includes("[music]")) {
      newStage = "music";
      pct = 5;
    } else {
      const bund = text.match(/Bundling\s+(\d+)%/);
      if (bund) {
        newStage = "bundle";
        pct = 15 + parseInt(bund[1], 10) * 0.1;
      } else {
        const enc = text.match(/Encoded\s+(\d+)\/(\d+)/);
        if (enc) {
          newStage = "encode";
          pct = 92 + (parseInt(enc[1], 10) / parseInt(enc[2], 10)) * 7;
        }
      }
    }

    let dirty = false;
    if (newStage) {
      setStage(job, newStage);
      dirty = true;
    }
    if (eta !== undefined) {
      job.etaSec = eta;
      dirty = true;
    }
    if (pct !== undefined) {
      const p = Math.min(99, Math.round(pct));
      if (p !== job.progress) {
        job.progress = p;
        dirty = true;
      }
    }
    if (dirty) {
      broadcast(job.id, { type: "progress", progress: job.progress, stage: job.stage, etaSec: job.etaSec });
    }
  };
  child.stdout.on("data", (buf) => handleOutput(buf.toString()));
  child.stderr.on("data", (buf) => handleOutput(buf.toString()));
  child.on("close", (code) => {
    if (code === 0) {
      job.status = "done";
      job.progress = 100;
      job.etaSec = 0;
      setStage(job, "done");
      const reportPath = join(ROOT, "output", `${slug}-report.json`);
      try {
        const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as Record<string, unknown>;
        const mp4 = report.output as string;
        job.output = {
          mp4: mp4.split(/[\\/]/).pop() ?? mp4,
          spec: {},
          report: `${slug}-report.json`,
        };
      } catch {
        /* report missing — output stays unset */
      }
      broadcast(job.id, { type: "done", timeline: job.timeline });
    } else {
      job.status = "failed";
      setStage(job, "failed");
      const logTail = job.logs
        .join("")
        .split(/\r?\n/)
        .filter((l) => l.trim() && !l.includes("Rendered "))
        .slice(-5)
        .join("\n");
      job.error = logTail || `exit code ${code}`;
      const hint = actionable(job.error, job.provider);
      if (hint.fix) job.error += `\n→ Fix: ${hint.fix}`;
      broadcast(job.id, { type: "failed", error: job.error, timeline: job.timeline });
    }
    for (const c of sseClients.get(job.id) ?? []) {
      try { c.end(); } catch { /* ignore */ }
    }
    sseClients.delete(job.id);
  });
}
