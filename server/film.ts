/**
 * server/film.ts — the editor's routes (Phase 4).
 *
 *   GET  /api/film/:id         current film, history, playable spec, field choices
 *   POST /api/film/:id/edit    { edits, source?, summary? } -> new version, re-prepared spec
 *   POST /api/film/:id/ask     { target, request } -> proposed edits (not saved)
 *   POST /api/film/:id/undo    previous version
 *   POST /api/film/:id/redo    next version
 *
 * Requests for one film run one at a time: an edit re-voices and re-times,
 * and two at once would race on the stage files.
 */
import type { Express, Response } from "express";
import { applyEdits, EditError, type Edit } from "../src/generator/film/edits";
import { editorFields } from "../src/generator/film/fields";
import { prepareFilm } from "../src/generator/film/prepare";
import { openFilm, redoFilm, saveFilm, undoFilm } from "../src/generator/film/store";
import { askEditor, type EditTarget } from "../src/generator/pipeline/editor";
import { resolveRoleModels } from "../src/generator/pipeline/llm";
import { canReassemble } from "../src/generator/pipeline/run";

const queues = new Map<string, Promise<unknown>>();

function serial<T>(id: string, work: () => Promise<T>): Promise<T> {
  const prev = queues.get(id) ?? Promise.resolve();
  const next = prev.then(work, work);
  queues.set(id, next.catch(() => undefined));
  return next;
}

function fail(res: Response, e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  res.status(e instanceof EditError ? 400 : 500).json({ error: message });
}

function checkId(id: string, res: Response): boolean {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    res.status(400).json({ error: "bad video id" });
    return false;
  }
  if (!canReassemble(id)) {
    res.status(404).json({ error: `"${id}" has no saved plan stages`, fix: "Write the plan again from Step 1" });
    return false;
  }
  return true;
}

export function registerFilmRoutes(app: Express) {
  app.get("/api/film/:id", async (req, res) => {
    const { id } = req.params;
    if (!checkId(id, res)) return;
    try {
      const out = await serial(id, async () => {
        const { film, head } = openFilm(id);
        const prepared = await prepareFilm(id);
        return { id, film, head, ...prepared, fields: editorFields() };
      });
      res.json(out);
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/api/film/:id/edit", async (req, res) => {
    const { id } = req.params;
    if (!checkId(id, res)) return;
    const body = req.body as { edits?: Edit[]; source?: "user" | "ai"; summary?: string };
    if (!Array.isArray(body.edits) || body.edits.length === 0) return res.status(400).json({ error: "edits are required" });
    try {
      const out = await serial(id, async () => {
        const { film } = openFilm(id);
        const result = applyEdits(film, body.edits!);
        const summary = body.summary ? [body.summary, ...result.summary] : result.summary;
        const head = saveFilm(id, result.film, { source: body.source === "ai" ? "ai" : "user", summary, redo: result.redo }, undefined);
        const prepared = await prepareFilm(id);
        return { head, film: result.film, redo: result.redo, summary, ...prepared };
      });
      res.json(out);
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/api/film/:id/ask", async (req, res) => {
    const { id } = req.params;
    if (!checkId(id, res)) return;
    const body = req.body as { target?: EditTarget; request?: string };
    if (!body.request?.trim()) return res.status(400).json({ error: "say what to change" });
    const target: EditTarget = body.target?.kind === "beat" && body.target.beat ? body.target : { kind: "video" };
    const models = resolveRoleModels(["editor"]);
    if (!process.env.FACTORY_LLM_FIXTURES && !models.editor?.model) {
      return res.status(400).json({ error: "No model chosen for the Editor (or the Writer)", fix: "Choose one in Providers → Model roles" });
    }
    try {
      const out = await serial(id, async () => {
        const { film } = openFilm(id);
        const reply = await askEditor({ film, target, request: body.request!, models });
        return { summary: reply.summary, edits: reply.edits, redo: reply.result.redo, changes: reply.result.summary };
      });
      res.json(out);
    } catch (e) {
      fail(res, e);
    }
  });

  for (const [route, move] of [["undo", undoFilm], ["redo", redoFilm]] as const) {
    app.post(`/api/film/:id/${route}`, async (req, res) => {
      const { id } = req.params;
      if (!checkId(id, res)) return;
      try {
        const out = await serial(id, async () => {
          const moved = move(id);
          if (!moved) return null;
          const prepared = await prepareFilm(id);
          return { head: moved.head, film: moved.film, redo: moved.redo, ...prepared };
        });
        if (!out) return res.status(409).json({ error: `nothing to ${route}` });
        res.json(out);
      } catch (e) {
        fail(res, e);
      }
    });
  }
}
