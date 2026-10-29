/**
 * src/generator/film/store.ts — versioned edits of a planned video, with undo.
 *
 * The film is the pipeline's stage files in output/<id>/ (story, direction,
 * sound, plan). Every saved edit snapshots them to output/<id>/film/v<N>.json
 * and rewrites the stage files, so reassemble() always reads the current
 * version. Undo and redo move between snapshots; saving after an undo drops
 * the undone versions, like any editor.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { CaptionOverride, Film, Redo } from "./edits";

export interface FilmVersion {
  v: number;
  at: string;
  source: "plan" | "user" | "ai";
  summary: string[];
  redo: Redo | "none";
}

export interface FilmHead {
  current: number;
  versions: FilmVersion[];
}

const STAGES = ["story", "direction", "sound", "plan"] as const;

const defaultRoot = () => join(process.cwd(), "output");

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function writeJson(file: string, data: unknown) {
  writeFileSync(file, JSON.stringify(data, null, 2));
}

function paths(id: string, root: string) {
  if (!/^[\w.-]+$/.test(id)) throw new Error(`bad film id "${id}"`);
  const dir = join(root, id);
  const films = join(dir, "film");
  return { dir, films, head: join(films, "head.json"), version: (v: number) => join(films, `v${v}.json`) };
}

function readStages(dir: string): Film {
  const missing = STAGES.filter((s) => !existsSync(join(dir, `${s}.json`)));
  if (missing.length) throw new Error(`${dir} is missing ${missing.join(", ")}.json; write the plan again`);
  const [story, direction, sound, plan] = STAGES.map((s) => readJson(join(dir, `${s}.json`)));
  return { story, direction, sound, plan } as Film;
}

function writeStages(dir: string, film: Film) {
  for (const s of STAGES) writeJson(join(dir, `${s}.json`), film[s]);
}

/** Only the four stage files: what the pipeline (and a recast) writes. */
const stageOf = (f: Film): Film => ({ story: f.story, direction: f.direction, sound: f.sound, plan: f.plan });

/** The words the captions are built from (hook, narration, dialog lines). */
const wordingOf = (f: Film): string =>
  JSON.stringify([f.story?.hook, (f.story?.beats ?? []).map((b) => [b.id, b.say, (b.lines ?? []).map((l) => [l.who, l.text])])]);

/**
 * The current version with the stage files on disk adopted. Everything else on
 * the version (film.captions, the editor's keep-timing wording, and any other
 * editor-owned field) lives in the snapshots only, never on the stage files,
 * so it is carried over: a recast or a re-run stage must not drop it. Only
 * when the story wording itself changed (a new plan of the same premise) is
 * the caption wording dropped: it was written for the old words.
 */
function withStages(current: Film, onDisk: Film): { film: Film; note: string | null } {
  const film: Film = { ...current, ...stageOf(onDisk) };
  const kept = current.captions?.length ?? 0;
  if (kept === 0) return { film, note: null };
  if (wordingOf(current) !== wordingOf(onDisk)) {
    delete film.captions;
    return { film, note: `the story wording changed, so ${kept} kept caption wording(s) were dropped` };
  }
  return { film, note: `${kept} kept caption wording(s) carried over` };
}

/** Did the stage files change outside the editor (a voice recast, a new plan)? */
function changedOutside(current: Film, onDisk: Film): boolean {
  return JSON.stringify(stageOf(onDisk)) !== JSON.stringify(stageOf(current));
}

/** The current film and its history. The first open snapshots the plan as v1. */
export function openFilm(id: string, root = defaultRoot()): { film: Film; head: FilmHead } {
  const p = paths(id, root);
  if (!existsSync(p.head)) {
    const film = readStages(p.dir);
    mkdirSync(p.films, { recursive: true });
    writeJson(p.version(1), film);
    const head: FilmHead = { current: 1, versions: [{ v: 1, at: new Date().toISOString(), source: "plan", summary: ["the plan as written"], redo: "none" }] };
    writeJson(p.head, head);
    return { film, head };
  }
  const head = readJson<FilmHead>(p.head);
  const current = readJson<Film>(p.version(head.current));
  // Stage files changed outside the editor (a voice recast, a new plan):
  // keep them as a version so undo does not silently drop them.
  const onDisk = readStages(p.dir);
  if (changedOutside(current, onDisk)) {
    const { film, note } = withStages(current, onDisk);
    const v = Math.max(...head.versions.map((x) => x.v)) + 1;
    writeJson(p.version(v), film);
    const kept = head.versions.filter((x) => x.v <= head.current);
    const summary = ["changed outside the editor", ...(note ? [note] : [])];
    const next: FilmHead = { current: v, versions: [...kept, { v, at: new Date().toISOString(), source: "plan", summary, redo: "voice" }] };
    writeJson(p.head, next);
    return { film, head: next };
  }
  return { film: current, head };
}

/**
 * What openFilm would return, without writing anything (no v1 snapshot, no
 * "changed outside the editor" version). For checks that must not wait on, or
 * race with, the film's queue. `outside` says openFilm would first record a
 * "changed outside the editor" version (not in `head` yet). Null when the
 * film has no stage files.
 */
export function peekFilm(id: string, root = defaultRoot()): { film: Film; head: FilmHead; outside: boolean } | null {
  const p = paths(id, root);
  if (!STAGES.every((s) => existsSync(join(p.dir, `${s}.json`)))) return null;
  const onDisk = readStages(p.dir);
  if (!existsSync(p.head)) {
    const head: FilmHead = { current: 1, versions: [{ v: 1, at: new Date().toISOString(), source: "plan", summary: ["the plan as written"], redo: "none" }] };
    return { film: onDisk, head, outside: false };
  }
  const head = readJson<FilmHead>(p.head);
  const current = readJson<Film>(p.version(head.current));
  const outside = changedOutside(current, onDisk);
  return { film: outside ? withStages(current, onDisk).film : current, head, outside };
}

/** Saves an edited film as the next version and makes it current. */
export function saveFilm(
  id: string,
  film: Film,
  meta: { source: "user" | "ai"; summary: string[]; redo: Redo },
  root = defaultRoot(),
): FilmHead {
  const p = paths(id, root);
  const { head } = openFilm(id, root);
  const kept = head.versions.filter((v) => v.v <= head.current);
  const v = Math.max(0, ...head.versions.map((x) => x.v)) + 1;
  writeJson(p.version(v), film);
  const next: FilmHead = { current: v, versions: [...kept, { v, at: new Date().toISOString(), ...meta }] };
  writeJson(p.head, next);
  writeStages(p.dir, film);
  return next;
}

function moveTo(id: string, root: string, pickNext: (head: FilmHead, i: number) => number) {
  const p = paths(id, root);
  const { head } = openFilm(id, root);
  const i = head.versions.findIndex((v) => v.v === head.current);
  const j = pickNext(head, i);
  if (j < 0 || j >= head.versions.length || j === i) return null;
  const target = head.versions[j];
  const film = readJson<Film>(p.version(target.v));
  const next: FilmHead = { ...head, current: target.v };
  writeJson(p.head, next);
  writeStages(p.dir, film);
  // What has to be redone to show this version: whatever the step(s) between changed.
  const between = head.versions.slice(Math.min(i, j) + 1, Math.max(i, j) + 1);
  const redo = between.some((v) => v.redo === "voice") ? "voice" : between.some((v) => v.redo === "timeline") ? "timeline" : "assemble";
  return { film, head: next, redo: redo as Redo };
}

export function undoFilm(id: string, root = defaultRoot()) {
  return moveTo(id, root, (_h, i) => i - 1);
}

export function redoFilm(id: string, root = defaultRoot()) {
  return moveTo(id, root, (_h, i) => i + 1);
}


/**
 * The editor's keep-timing caption wording saved on the current version
 * (film.captions). prepareFilm applies it over the rebuilt captions.
 */
export function captionOverrides(id: string, root = defaultRoot()): CaptionOverride[] {
  try {
    // Never opened in the editor: no overrides (and do not start its history here).
    if (!existsSync(paths(id, root).head)) return [];
    return openFilm(id, root).film.captions ?? [];
  } catch {
    return [];
  }
}
