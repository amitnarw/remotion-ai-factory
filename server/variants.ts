/**
 * server/variants.ts — the other versions of a finished run, on the dashboard
 * (docs/factory/15-producer.md §17): other hooks, other endings, other formats.
 *
 *   GET  /api/runs/:runId/variants   output/<run>/variants/variants.json (or no variants yet),
 *                                    plus the run's own format and length, and a variants job still running
 *   POST /api/runs/:runId/variants   { hooks?, endings?, formats? } -> { jobId }: a job that runs
 *                                    generate.ts variants <run> hooks=H,endings=E,formats=a,b
 *
 * The CLI does the work: the story, the plan and the unchanged lines' voices
 * are reused, and only what differs is voiced and rendered again, through the
 * chunked render's cache. Each variant plays at /media/<run>/variants/<id>/video.mp4.
 */
import type { Express, Response } from "express";
import fs from "fs";
import { join } from "path";
import { videoSeconds, type ShotSpec, type VideoFormat } from "../src/generator/spec.schema";
import { readBrief } from "../src/generator/pipeline/manifest";
import { createJob, getAllJobs, runJob } from "./jobs";
import { ROOT } from "./providers";
import { checkVariantsAsk, variantsArg } from "./variants-ask";

/** The run's planned spec (output/<run>/spec.json), or null. */
function readSpec(runId: string): ShotSpec | null {
  try {
    return JSON.parse(fs.readFileSync(join(ROOT, "output", runId, "spec.json"), "utf8")) as ShotSpec;
  } catch {
    return null;
  }
}

/** The run's own format, length, and whether its words are the user's own (as written). */
function current(runId: string, spec: ShotSpec): { format: VideoFormat; durationSec: number; asWritten: boolean } {
  let durationSec = 0;
  try {
    durationSec = Math.round(videoSeconds(spec) * 10) / 10;
  } catch { /* a spec without scenes: no length */ }
  return {
    format: spec.settings?.format ?? "9:16",
    durationSec,
    asWritten: readBrief(runId)?.mode === "as-written",
  };
}

/** The run's spec, or an answer saying why there is none. */
function checkRun(runId: string, res: Response): ShotSpec | null {
  if (!/^[a-z0-9-]+$/.test(runId)) {
    res.status(400).json({ error: "bad run id" });
    return null;
  }
  const spec = readSpec(runId);
  if (!spec) {
    res.status(404).json({ error: `No finished plan "${runId}" on the server`, fix: "Make the video first, then its variants" });
    return null;
  }
  return spec;
}

const busy = (status: string) => status === "running" || status === "queued";

export function registerVariantsRoutes(app: Express) {
  app.get("/api/runs/:runId/variants", (req, res) => {
    const { runId } = req.params;
    const spec = checkRun(runId, res);
    if (!spec) return;
    let file: Record<string, unknown> = { run: runId, variants: [] };
    try {
      file = JSON.parse(fs.readFileSync(join(ROOT, "output", runId, "variants", "variants.json"), "utf8"));
    } catch { /* no variants yet */ }
    const running = getAllJobs().find((j) => j.kind === "variants" && j.runId === runId && busy(j.status));
    res.json({ ...file, current: current(runId, spec), ...(running ? { jobId: running.id } : {}) });
  });

  app.post("/api/runs/:runId/variants", (req, res) => {
    const { runId } = req.params;
    const spec = checkRun(runId, res);
    if (!spec) return;
    const checked = checkVariantsAsk((req.body ?? {}) as Record<string, unknown>, current(runId, spec));
    if ("error" in checked) return res.status(400).json(checked);
    // One job per run at a time: a render of the run itself shares its chunks.
    for (const other of getAllJobs()) {
      if (busy(other.status) && (other.specId === runId || other.runId === runId)) {
        return res.status(409).json({
          error: other.kind === "variants" ? "Variants of this video are being made already" : "This video is being made right now",
          fix: "Wait for it to finish, then ask again",
          jobId: other.id,
        });
      }
    }
    // The job's premise is the report's, so the finished job finds the run's own video.
    let premise = spec.title || runId;
    try {
      const report = JSON.parse(fs.readFileSync(join(ROOT, "output", runId, "report.json"), "utf8")) as { premise?: string };
      if (report.premise) premise = report.premise;
    } catch { /* not rendered yet: the title */ }
    const job = createJob(premise);
    job.kind = "variants";
    job.specId = runId;
    job.runId = runId;
    job.variants = checked.ask;
    runJob(job, { extraArgs: ["variants", runId, variantsArg(checked.ask)] });
    res.json({ jobId: job.id });
  });
}
