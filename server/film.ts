/**
 * server/film.ts — the editor's routes (Phase 4).
 *
 *   GET  /api/film/:id          current film, history, playable spec, field choices
 *   GET  /api/film/:id/status   is the background voice measurement still running?
 *   PUT  /api/film/:id          the approved (edited) spec: story wording is
 *                               adopted (re-voiced from cache, re-timed), caption
 *                               wording is kept on its timing window
 *   POST /api/film/:id/edit     { edits, source?, summary? } -> new version, re-prepared
 *   POST /api/film/:id/ask      { target, request } -> proposal (not saved)
 *   POST /api/film/:id/undo     previous version
 *   POST /api/film/:id/redo     next version
 *
 * Text edits answer FAST: they come back on estimated timing for the changed
 * lines (prepareFilm(voice:"estimate")) while the persistent Kitten worker
 * re-voices them in the background; GET /status says when the real timing has
 * landed, and the next read of the film returns it.
 *
 * Requests for one film run one at a time: an edit re-voices and re-times,
 * and two at once would race on the stage files.
 */
import type { Express, Response } from "express";
import { readFileSync } from "fs";
import { join } from "path";
import { applyEdits, EditError, type Edit, type Redo, type Film } from "../src/generator/film/edits";
import { diffCaptions, diffTextEdits, dropOverridesForBeats, editsFromTextDiff, mergeOverrides } from "../src/generator/film/diff";
import { editorFields } from "../src/generator/film/fields";
import { prepareFilm, type PreparedFilm } from "../src/generator/film/prepare";
import { openFilm, redoFilm, saveFilm, undoFilm } from "../src/generator/film/store";
import { askEditor, type EditTarget } from "../src/generator/pipeline/editor";
import { resolveRoleModels } from "../src/generator/pipeline/llm";
import { canReassemble } from "../src/generator/pipeline/run";
import type { ShotSpec } from "../src/generator/spec.schema";

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

/* ------------------------------------------------------------------ */
/*  Background voice measurement (the second half of fast text edits)  */
/* ------------------------------------------------------------------ */

/** Films with a background measurement running; the status route answers from it. */
const measures = new Map<string, { startedAt: number; error?: string }>();

function startMeasure(id: string): boolean {
  if (measures.has(id)) return true; // already running
  const state: { startedAt: number; error?: string } = { startedAt: Date.now() };
  const task = serial(id, async () => {
    try {
      await prepareFilm(id, { voice: "measure" });
      console.log(`[film] ${id}: background voice measurement done in ${((Date.now() - state.startedAt) / 1000).toFixed(1)}s`);
    } catch (e) {
      state.error = String(e instanceof Error ? e.message : e).slice(0, 300);
      console.log(`[film] ${id}: background voice measurement failed: ${state.error}`);
    }
  });
  void task.then(
    () => measures.delete(id),
    () => measures.delete(id),
  );
  measures.set(id, state);
  return true;
}

/** Answer with measured timing when the cache covers it, else estimate + measure later. */
async function prepareThenMeasure(id: string, redo: Redo): Promise<{ prepared: PreparedFilm; measuring: boolean }> {
  // A wording edit answers at once on estimates (changed lines only; the
  // rest come from the voice cache measured); everything else re-measures
  // right away (cache hits cost nothing).
  const prepared = await prepareFilm(id, { voice: redo === "voice" ? "estimate" : "measure" });
  const measuring = prepared.measured ? false : startMeasure(id);
  return { prepared, measuring };
}

/* ------------------------------------------------------------------ */
/*  PUT /api/film/:id — write the approved (edited) spec               */
/* ------------------------------------------------------------------ */

/** Light shape-check of the spec the editor PUTs (the film edits validate the rest). */
function specFromRequest(input: unknown): ShotSpec {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new EditError("spec must be an object");
  const put = input as ShotSpec;
  if (typeof put.title !== "string" || !put.title) throw new EditError("spec.title is missing");
  if (put.story?.hook !== undefined && typeof put.story.hook !== "string") throw new EditError("spec.story.hook must be text");
  if (put.story?.beats !== undefined && !Array.isArray(put.story.beats)) throw new EditError("spec.story.beats must be a list");
  if (put.captions !== undefined && !Array.isArray(put.captions)) throw new EditError("spec.captions must be a list");
  return put;
}

/** The last prepared spec (for the caption-wording diff); null when missing. */
function lastPrepared(id: string): ShotSpec | null {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), "output", `${id}-spec.json`), "utf8")) as ShotSpec;
  } catch {
    return null;
  }
}

/** The timed windows (from/to) of the beats whose say a save is reflowing. */
function sayWindows(spec: ShotSpec | null, changedPaths: string[]): Array<{ from: number; to: number }> {
  const ids = changedPaths
    .map((p) => /^story\.beats\[([^\]]+)\]\.say$/.exec(p))
    .filter(Boolean)
    .map((m) => m![1]!);
  if (ids.length === 0 || !spec?.story) return [];
  return (spec.story.beats ?? [])
    .filter((b) => ids.includes(b.id ?? "") && typeof b.from === "number")
    .map((b) => ({ from: b.from as number, to: (b.to as number | undefined) ?? (b.from as number) }));
}

const quote = (t: string): string => {
  const s = t.trim();
  return `"${s.length > 50 ? `${s.slice(0, 47)}...` : s}"`;
};

export function registerFilmRoutes(app: Express) {
  app.get("/api/film/:id", async (req, res) => {
    const { id } = req.params;
    if (!checkId(id, res)) return;
    try {
      const out = await serial(id, async () => {
        const { film, head } = openFilm(id);
        // Fast open: measured timing when the cache covers every line, else
        // estimates now and the background measurement (worker) below.
        const prepared = await prepareFilm(id, { voice: "estimate" });
        const measuring = prepared.measured ? false : startMeasure(id);
        return { id, film, head, ...prepared, fields: editorFields(), measuring };
      });
      res.json(out);
    } catch (e) {
      fail(res, e);
    }
  });

  /** Is the background voice measurement (edits answered from estimates) still running? */
  app.get("/api/film/:id/status", (req, res) => {
    const entry = measures.get(req.params.id);
    res.json({ id: req.params.id, measuring: !!entry, startedAt: entry?.startedAt, error: entry?.error });
  });

  /**
   * The approved (edited) spec: story wording is adopted into the film (a
   * changed line is re-voiced from the cache and the video re-times —
   * "reflow"); caption wording becomes a keep-timing override (the voice and
   * the window stay). Both land as a versioned save.
   */
  app.put("/api/film/:id", async (req, res) => {
    const { id } = req.params;
    if (!checkId(id, res)) return;
    const body = req.body as { spec?: unknown };
    try {
      const out = await serial(id, async () => {
        const put = specFromRequest(body.spec);
        const { film: film0, head } = openFilm(id);
        let film: Film = film0;
        const texts = diffTextEdits(film, put);
        const captions = diffCaptions(lastPrepared(id), put);
        if (texts.length === 0 && captions.length === 0) {
          const prepared = await prepareFilm(id, { voice: "measure" });
          const measuring = prepared.measured ? false : startMeasure(id);
          return { id, head, ...prepared, changed: { lines: 0, captions: 0 }, measuring };
        }
        // A reflow makes its beat's captions follow the story again: drop the
        // keep-timing overrides inside the changed beats' windows.
        const windows = sayWindows(put, texts.map((c) => c.path));
        let next: Film = film;
        const droppedCount =
          windows.length > 0 ? (film.captions?.length ?? 0) - dropOverridesForBeats(film.captions, windows).length : 0;
        if (windows.length > 0) next = { ...next, captions: dropOverridesForBeats(film.captions, windows) };
        let redo: Redo = "assemble";
        const summary: string[] = [];
        if (droppedCount > 0) summary.push(`the reflow re-captions ${droppedCount} kept wording(s) from the story`);
        const edits: Edit[] = editsFromTextDiff(texts);
        if (edits.length > 0) {
          const result = applyEdits(film, edits);
          next = result.film;
          redo = result.redo;
          summary.push(...result.summary);
        }
        if (captions.length > 0 || film.captions?.length) {
          next = { ...next, captions: mergeOverrides(film.captions, captions) };
          for (const c of captions) {
            summary.push(`caption at ${c.from.toFixed(1)}s: ${quote(c.before)} to ${quote(c.after)} (voice kept)`);
          }
        }
        const saved = saveFilm(id, next, { source: "user", summary, redo }, undefined);
        const { prepared, measuring } = await prepareThenMeasure(id, redo);
        return { id, head: saved, ...prepared, changed: { lines: texts.length, captions: captions.length }, measuring };
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
        // A reflowed beat is re-captioned from the story again (see PUT).
        const windows = sayWindows(lastPrepared(id), body.edits!.map((e) => e.path));
        let savedFilm = result.film;
        if (windows.length > 0) {
          const dropped = dropOverridesForBeats(savedFilm.captions, windows);
          if (dropped.length !== (savedFilm.captions?.length ?? 0)) {
            summary.push(`the reflow re-captions ${(savedFilm.captions?.length ?? 0) - dropped.length} kept wording(s) from the story`);
            savedFilm = { ...savedFilm, captions: dropped };
          }
        }
        const head = saveFilm(id, savedFilm, { source: body.source === "ai" ? "ai" : "user", summary, redo: result.redo }, undefined);
        const { prepared, measuring } = await prepareThenMeasure(id, result.redo);
        return { id, head, film: result.film, redo: result.redo, summary, ...prepared, measuring };
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
      return res.status(400).json({ error: "No model chosen for the Editor (or the Writer)", fix: "Choose one in Providers > Model roles" });
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
          const { prepared, measuring } = await prepareThenMeasure(id, moved.redo);
          return { id, head: moved.head, film: moved.film, redo: moved.redo, ...prepared, measuring };
        });
        if (!out) return res.status(409).json({ error: `nothing to ${route}` });
        res.json(out);
      } catch (e) {
        fail(res, e);
      }
    });
  }
}
