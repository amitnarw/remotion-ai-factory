import { spawn } from "child_process";
import fs from "fs";
import { type ServerResponse } from "http";
import { join, basename, isAbsolute } from "path";
import { loadEnv } from "./providers";

export interface Job {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  progress: number;
  logs: string[];
  premise: string;
  provider?: string;
  model?: string;
  output?: { mp4: string; spec: unknown; report: string };
  error?: string;
  createdAt: number;
}

const jobs = new Map<string, Job>();
const sseClients = new Map<string, Set<ServerResponse>>();
let jobIdCounter = 0;

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
  const job: Job = { id, status: "queued", progress: 0, logs: [], premise, provider, model, createdAt: Date.now() };
  jobs.set(id, job);
  sseClients.set(id, new Set());
  return job;
}

export function getJob(id: string): Job | undefined { return jobs.get(id); }
export function getAllJobs(): Job[] { return Array.from(jobs.values()).sort((a, b) => b.createdAt - a.createdAt); }

function latestReportFor(premise: string): { mp4: string; spec: unknown; report: string } | undefined {
  const dir = join(process.cwd(), "output");
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
// Extract the human-readable reason (the "Error:" line and context after it).
function failedLogError(premise: string): string | undefined {
  const dir = join(process.cwd(), "output");
  if (!fs.existsSync(dir)) return undefined;
  const candidates = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("FAILED-") && f.endsWith(".log"))
    .map((f) => {
      const st = fs.statSync(join(dir, f));
      const slug = premise.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
      // prefer logs whose filename matches this premise's slug, then newest
      const slugMatch = f.toLowerCase().includes(slug) ? 1 : 0;
      return { f, mtime: st.mtimeMs, slugMatch };
    })
    .sort((a, b) => b.slugMatch - a.slugMatch || b.mtime - a.mtime);
  if (candidates.length === 0) return undefined;
  const text = fs.readFileSync(join(dir, candidates[0].f), "utf8");
  const lines = text.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.startsWith("Error:"));
  if (idx >= 0) {
    return lines.slice(idx, idx + 4).join("\n").trim();
  }
  const tail = lines.filter((l) => l.trim()).slice(-5).join("\n");
  return tail || undefined;
}

export function runJob(job: Job) {
  job.status = "running";
  broadcast(job.id, { type: "status", status: "running" });
  const args = ["src/generator/generate.ts", job.premise];
  if (job.provider) args.push("--provider", job.provider);
  if (job.model) args.push("--model", job.model);
  const child = spawn("npx", ["--no-install", "tsx", ...args], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    // Inject keys saved to .env via the dashboard — the CLI has no dotenv
    // loader and reads process.env directly.
    env: { ...process.env, ...loadEnv() },
  });
  const handleOutput = (text: string) => {
    job.logs.push(text);
    broadcast(job.id, { type: "log", text });
    const m = text.match(/Rendered\s+(\d+)\/(\d+)/);
    if (m) {
      const p = Math.round((parseInt(m[1], 10) / parseInt(m[2], 10)) * 100);
      if (p !== job.progress) { job.progress = p; broadcast(job.id, { type: "progress", progress: p }); }
    }
  };
  child.stdout.on("data", (buf) => handleOutput(buf.toString()));
  child.stderr.on("data", (buf) => handleOutput(buf.toString()));
  child.on("close", (code) => {
    if (code === 0) {
      job.status = "done";
      job.progress = 100;
      const out = latestReportFor(job.premise);
      if (out) job.output = out;
      broadcast(job.id, { type: "done" });
    } else {
      job.status = "failed";
      const logError = failedLogError(job.premise);
      const logTail = job.logs
        .join("")
        .split(/\r?\n/)
        .filter((l) => l.trim() && !l.includes("Rendered "))
        .slice(-4)
        .join("\n");
      job.error = logError ?? (logTail || `exit code ${code}`);
      broadcast(job.id, { type: "failed", error: job.error });
    }
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
