/**
 * server/producer.ts — the producer you talk to, on the dashboard (P5,
 * docs/factory/15-producer.md §2 and §16): one conversation per run.
 *
 *   GET  /api/producer/:runId        the conversation: turns, proposals and their state, standing notes
 *   POST /api/producer/:runId/say    { text } -> the producer's answer and its proposals (nothing applied)
 *   POST /api/producer/:runId/ok     { proposal } -> applied; a finished plan's change is a film version
 *   POST /api/producer/:runId/no     { proposal } -> turned down
 *   POST /api/producer/:runId/undo   the last applied proposal taken back
 *
 * A finished plan's notes run in the film's queue (server/film.ts), like the
 * editor's own changes, and its playable spec follows each change.
 */
import type { Express, Response } from "express";
import { resolveRoleModels } from "../src/generator/pipeline/llm";
import { readBrief } from "../src/generator/pipeline/manifest";
import { confirm, conversation, discard, PRODUCER_ROLES, runPhase, say, undoLast, type Applied } from "../src/generator/pipeline/producer";
import { queueFilmChange, refreshFilm } from "./film";
import { applyEnv } from "./providers";

function checkRun(id: string, res: Response): boolean {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    res.status(400).json({ error: "bad run id" });
    return false;
  }
  if (runPhase(id) === "none") {
    res.status(404).json({ error: `"${id}" has no story yet`, fix: "Give notes once the story is written" });
    return false;
  }
  return true;
}

function fail(res: Response, e: unknown) {
  res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
}

/** A finished plan's change runs in the film's queue, and its spec follows the new version. */
async function inQueue(id: string, work: () => Applied): Promise<Applied & { measuring?: boolean }> {
  if (runPhase(id) !== "plan") return work();
  return queueFilmChange(id, async () => {
    const a = work();
    if (a.version === undefined || !a.redo) return a;
    return { ...a, ...(await refreshFilm(id, a.redo)) };
  });
}

export function registerProducerRoutes(app: Express) {
  app.get("/api/producer/:runId", (req, res) => {
    const { runId } = req.params;
    if (!checkRun(runId, res)) return;
    res.json({ id: runId, ...conversation(runId) });
  });

  app.post("/api/producer/:runId/say", async (req, res) => {
    const { runId } = req.params;
    if (!checkRun(runId, res)) return;
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) return res.status(400).json({ error: "say what to change" });
    applyEnv();
    const models = resolveRoleModels([...PRODUCER_ROLES], readBrief(runId)?.cli);
    if (!process.env.FACTORY_LLM_FIXTURES && !models.producer?.model) {
      return res.status(400).json({ error: "No model chosen for the Producer (or the Writer)", fix: "Choose one in Settings > AI models > Model roles" });
    }
    try {
      // On a finished plan it reads the film as the queue leaves it.
      const got = runPhase(runId) === "plan" ? await queueFilmChange(runId, () => say(runId, text, { models })) : await say(runId, text, { models });
      res.json({ ...got, ...conversation(runId) });
    } catch (e) {
      fail(res, e);
    }
  });

  for (const [route, act] of [
    ["ok", (id: string, p: string) => inQueue(id, () => confirm(id, p))],
    ["no", async (id: string, p: string) => {
      discard(id, p);
      return { proposal: p, summary: ["discarded"], phase: runPhase(id) } as Applied;
    }],
  ] as const) {
    app.post(`/api/producer/:runId/${route}`, async (req, res) => {
      const { runId } = req.params;
      if (!checkRun(runId, res)) return;
      const proposal = typeof req.body?.proposal === "string" ? req.body.proposal : "";
      if (!/^p\d+$/.test(proposal)) return res.status(400).json({ error: "name the proposal (p1, p2...)" });
      try {
        const done = await act(runId, proposal);
        res.json({ done, ...conversation(runId) });
      } catch (e) {
        fail(res, e);
      }
    });
  }

  app.post("/api/producer/:runId/undo", async (req, res) => {
    const { runId } = req.params;
    if (!checkRun(runId, res)) return;
    try {
      const done = await inQueue(runId, () => undoLast(runId));
      res.json({ done, ...conversation(runId) });
    } catch (e) {
      fail(res, e);
    }
  });
}
