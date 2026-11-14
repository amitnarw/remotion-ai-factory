/**
 * server/publish.ts — a finished video's publish pack, on the dashboard
 * (docs/factory/20-publish.md): three titles, the description with its
 * chapters and CC-BY credits, the tags, and a thumbnail.
 *
 *   GET  /api/videos/:id/publish   output/<id>/publish/publish.json (404 when there is none),
 *                                  plus a publish job of that video still running
 *   POST /api/videos/:id/publish   -> { jobId }: a job that runs scripts/publish.ts <id>
 *
 * The script does the work in a child process (the thumbnail opens a
 * browser, so the server stays free). Nothing is uploaded anywhere. The
 * files are served by the static /media route: /media/<id>/publish/thumbnail.png.
 */
import type { Express } from "express";
import fs from "fs";
import { join } from "path";
import { createJob, getAllJobs, runJob } from "./jobs";
import { ROOT } from "./providers";

const busy = (status: string) => status === "running" || status === "queued";

/** The video's report (premise, for the job's title), or null when it was never rendered. */
function readReport(id: string): { premise?: string } | null {
  try {
    return JSON.parse(fs.readFileSync(join(ROOT, "output", id, "report.json"), "utf8")) as { premise?: string };
  } catch {
    return null;
  }
}

export function registerPublishRoutes(app: Express) {
  app.get("/api/videos/:id/publish", (req, res) => {
    const { id } = req.params;
    if (!/^[a-z0-9-]+$/.test(id)) return res.status(400).json({ error: "bad video id" });
    const running = getAllJobs().find((j) => j.kind === "publish" && j.specId === id && busy(j.status));
    try {
      const pack = JSON.parse(fs.readFileSync(join(ROOT, "output", id, "publish", "publish.json"), "utf8"));
      return res.json({ ...pack, ...(running ? { jobId: running.id } : {}) });
    } catch {
      return res.status(404).json({ error: `No publish pack for "${id}" yet`, fix: "Make it with the Publish pack button", ...(running ? { jobId: running.id } : {}) });
    }
  });

  app.post("/api/videos/:id/publish", (req, res) => {
    const { id } = req.params;
    if (!/^[a-z0-9-]+$/.test(id)) return res.status(400).json({ error: "bad video id" });
    const report = readReport(id);
    if (!report || !fs.existsSync(join(ROOT, "output", id, "video.mp4"))) {
      return res.status(404).json({ error: `"${id}" has no finished video`, fix: "Make the video first, then its publish pack" });
    }
    const running = getAllJobs().find((j) => j.kind === "publish" && j.specId === id && busy(j.status));
    if (running) return res.status(409).json({ error: "Its publish pack is being made already", fix: "Wait for it to finish", jobId: running.id });
    // The job's premise is the report's, so the finished job finds the video itself.
    const job = createJob(report.premise || id);
    job.kind = "publish";
    job.specId = id;
    job.runId = id;
    runJob(job, { script: "scripts/publish.ts", extraArgs: [id] });
    res.json({ jobId: job.id });
  });
}
