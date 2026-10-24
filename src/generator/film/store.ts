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
  // Only the four stage files count for this check: film.captions (the
  // editor's keep-timing wording) lives in the version snapshots only, never
  // on the stage files, so it must not look like "changed outside the editor".
  const stageOf = (f: Film): Film => ({ story: f.story, direction: f.direction, sound: f.sound, plan: f.plan });
  if (JSON.stringify(stageOf(onDisk)) !== JSON.stringify(stageOf(current))) {
    const v = Math.max(...head.versions.map((x) => x.v)) + 1;
    writeJson(p.version(v), onDisk);
    const kept = head.versions.filter((x) => x.v <= head.current);
    const next: FilmHead = { current: v, versions: [...kept, { v, at: new Date().toISOString(), source: "plan", summary: ["changed outside the editor"], redo: "voice" }] };
    writeJson(p.head, next);
    return { film: onDisk, head: next };
  }
  return { film: current, head };
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
    return openFilm(id, root).film.captions ?? [];
  } catch {
    return [];
  }
}
