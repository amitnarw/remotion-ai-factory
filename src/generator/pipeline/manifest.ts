/**
 * src/generator/pipeline/manifest.ts — a run: its id, what was asked, and
 * how far it got (producer phase P1, docs/factory/15-producer.md §2).
 *
 *   output/<run>/brief.json   what was asked: premise, settings, voices, models, the story gate
 *   output/<run>/run.json     the manifest: each stage's state, input hash, files, model,
 *                             times, error and warnings; the story gate's approval
 *   output/<run>/.calls/      the run's model replies (llm.ts withCallCache)
 *
 * A run id is the premise's slug plus 6 hex digits, so planning the same
 * premise again never overwrites an older run. A stage runs only when it
 * never finished, failed, or its inputs changed (their hash differs from the
 * one saved when it ran); a resume starts at the first such stage.
 */
import { createHash, randomBytes } from "crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import type { StoryMode } from "../ai/channels";
import type { VideoSettings } from "../spec.schema";
import type { AudioConfig } from "./voice";

let outputRoot = join(process.cwd(), "output");

/**
 * Tests only: keep the runs' folders (run.json, the stage files, .calls) in
 * `dir` instead of output/. No argument restores output/. The voice work
 * folders (tts.ts) and the render stay where they are.
 */
export function setOutputDir(dir?: string): void {
  outputRoot = dir ?? join(process.cwd(), "output");
}

/** The stages of a plan, in order. The story gate sits after the story check, gate 2 after the library match. */
export const STAGES = ["story", "claims", "voice", "check", "breakdown", "match", "director", "sound", "critic", "assemble"] as const;
export type StageName = (typeof STAGES)[number];

/** "skipped": an optional stage this run does not use (the critic when it is off). */
export type StageState = "waiting" | "running" | "done" | "failed" | "skipped";

export interface StageEntry {
  state: StageState;
  /** Hash of the inputs it ran with (stableHash). */
  inputHash?: string;
  /** The files it writes in output/<run>/. */
  files: string[];
  /** "provider/model" of the role it asked, when it asks one. */
  model?: string;
  startedAt?: string;
  endedAt?: string;
  error?: string;
  /** Warnings it gave, so a resumed run's report still lists them. */
  warnings?: string[];
  /** What the report needs on a resume: the story's length and revise, the sound's source. */
  facts?: Record<string, unknown>;
}

export interface Brief {
  premise: string;
  settings: VideoSettings;
  audio: AudioConfig;
  /** --provider / --model given when the run started (each role uses its own otherwise). */
  cli?: { provider?: string; model?: string };
  /** Gate 1: stop after the story until it is approved. */
  storyGate: boolean;
  /** The run whose story this run reuses instead of asking the writer. */
  storyFrom?: string;
  /** The channel (channels/<id>.json) and the version of its profile when the run started. Unset: what-if (runs from before P2). */
  channel?: string;
  channelVersion?: number;
  /** How the story is made. Unset: premise. */
  mode?: StoryMode;
  /** The user's own story or script (adapt, as-written), as given. */
  script?: string;
  /** Gate 2: stop at the shopping list when the library is missing something. Unset: off (runs from before P4, the tests, the milestone). */
  shopGate?: boolean;
  /** The sources gate 2 searches (acquire/sources ids; [] searches none). Unset: every default source. */
  shopSources?: string[];
}

export interface StoryGate {
  on: boolean;
  /** "waiting": the story is written and shown; "approved": it may go on. */
  state: "off" | "open" | "waiting" | "approved";
  /** Hash of the story that was approved: an edit after the approval asks again. */
  storyHash?: string;
  at?: string;
  by?: string;
}

/**
 * Gate 2: the shopping list. "waiting": shopping.json lists what the library
 * is missing and waits for the user's choices; "done": the choices were made
 * (acquisition.json), or nothing was missing (every need in stock or with a
 * stand-in).
 */
export interface ShopGate {
  on: boolean;
  state: "off" | "open" | "waiting" | "done";
  /** The needs that wait (waiting), or what was decided (done). */
  needs?: string[];
  at?: string;
  by?: string;
}

export interface RunManifest {
  id: string;
  version: 1;
  premise: string;
  createdAt: string;
  updatedAt: string;
  stages: Record<StageName, StageEntry>;
  gates: { story: StoryGate; shop: ShopGate };
}

/** The files each stage writes. */
const STAGE_FILES: Record<StageName, string[]> = {
  story: ["story.json"],
  claims: ["story.claims.json"],
  voice: ["voice.json", "timeline.json"],
  check: ["story.check.json"],
  breakdown: ["breakdown.json"],
  match: ["needs.json"],
  director: ["direction.json"],
  sound: ["sound.json"],
  critic: ["critique.json"],
  assemble: ["plan.json"],
};

/** What each stage is called in messages. */
export const STAGE_LABELS: Record<StageName, string> = {
  story: "the story",
  claims: "the claims check",
  voice: "the voice timing",
  check: "the story check",
  breakdown: "the breakdown",
  match: "the library match",
  director: "the director",
  sound: "the sound",
  critic: "the critic",
  assemble: "the assembly",
};

/** A premise as a file-safe slug (the CLI's rule), cut to 60 characters. */
export function slugOf(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "") || "run";
}

/** A new run id: `<slug>-<6 hex>`. It passes the server's `[a-z0-9-]+` checks. */
export function newRunId(premise: string, hex: string = randomBytes(3).toString("hex")): string {
  return `${slugOf(premise)}-${hex}`;
}

/** JSON with sorted keys, so the same value always hashes the same. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    return v;
  });
}

/** A short hash of any JSON value; key order does not matter. */
export function stableHash(value: unknown): string {
  return createHash("sha256").update(canonical(value) ?? "undefined").digest("hex").slice(0, 16);
}

/** A run's folder: output/<run>/. */
export function runDir(id: string): string {
  return join(outputRoot, id);
}

function readJson<T>(file: string): T | null {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : null;
  } catch {
    return null;
  }
}

export function readRun(id: string): RunManifest | null {
  const run = readJson<RunManifest>(join(runDir(id), "run.json"));
  if (!run) return null;
  // A run written before a stage existed (the breakdown and match came with
  // P3, the story check after P2) gets that stage: skipped when its plan is
  // complete, else waiting.
  const done = run.stages.assemble?.state === "done";
  for (const s of STAGES) run.stages[s] ??= { state: done ? "skipped" : "waiting", files: STAGE_FILES[s] };
  // Runs from before gate 2 (P4) plan on without it.
  run.gates.shop ??= { on: false, state: "off" };
  return run;
}

export function readBrief(id: string): Brief | null {
  return readJson<Brief>(join(runDir(id), "brief.json"));
}

export function writeRun(run: RunManifest): void {
  run.updatedAt = new Date().toISOString();
  mkdirSync(runDir(run.id), { recursive: true });
  writeFileSync(join(runDir(run.id), "run.json"), JSON.stringify(run, null, 2));
}

export function writeBrief(id: string, brief: Brief): void {
  mkdirSync(runDir(id), { recursive: true });
  writeFileSync(join(runDir(id), "brief.json"), JSON.stringify(brief, null, 2));
}

/**
 * Begin a run from scratch: a new manifest and brief. A fixed id that is
 * planned again (the tests, the milestone) starts clean: its old saved model
 * replies are removed, so nothing from the older plan is replayed.
 */
export function startRun(id: string, brief: Brief): RunManifest {
  rmSync(join(runDir(id), ".calls"), { recursive: true, force: true });
  const now = new Date().toISOString();
  const stages = Object.fromEntries(STAGES.map((s) => [s, { state: "waiting", files: STAGE_FILES[s] }])) as Record<StageName, StageEntry>;
  const run: RunManifest = {
    id,
    version: 1,
    premise: brief.premise,
    createdAt: now,
    updatedAt: now,
    stages,
    gates: { story: { on: brief.storyGate, state: brief.storyGate ? "open" : "off" }, shop: { on: !!brief.shopGate, state: brief.shopGate ? "open" : "off" } },
  };
  writeBrief(id, brief);
  writeRun(run);
  return run;
}

/** Done with these very inputs, and its files are still there: nothing to redo. */
export function isFresh(run: RunManifest, stage: StageName, inputHash: string): boolean {
  const e = run.stages[stage];
  return e.state === "done" && e.inputHash === inputHash && e.files.every((f) => existsSync(join(runDir(run.id), f)));
}

/** The first stage that has not finished (null when the plan is complete). */
export function nextStage(run: RunManifest): StageName | null {
  return STAGES.find((s) => run.stages[s].state !== "done" && run.stages[s].state !== "skipped") ?? null;
}

/** The plan is complete: every stage finished. After this the editor owns the run. */
export function isComplete(run: RunManifest): boolean {
  return nextStage(run) === null;
}

/** The story stage is done and the gate waits for the user. */
export function waitsForStory(run: RunManifest): boolean {
  return run.gates.story.on && run.gates.story.state === "waiting" && run.stages.story.state === "done";
}

/** Gate 2 waits: the shopping list is saved and the user has not chosen yet. */
export function waitsForShopping(run: RunManifest): boolean {
  return run.gates.shop.on && run.gates.shop.state === "waiting";
}

/** Hash of the story on disk now (the gate compares it with the approved one). */
export function storyHashOnDisk(id: string): string | null {
  const story = readJson<unknown>(join(runDir(id), "story.json"));
  return story ? stableHash(story) : null;
}

/** Approve the story as it is on disk now (it may have been edited at the gate). */
export function approveStory(run: RunManifest, by: string): void {
  const hash = storyHashOnDisk(run.id);
  if (!hash) throw new Error(`output/${run.id}/story.json is missing; there is no story to approve`);
  run.gates.story = { ...run.gates.story, state: "approved", storyHash: hash, at: new Date().toISOString(), by };
  writeRun(run);
}

/** One line per stage, for `--status` and the server. */
export function describeRun(run: RunManifest): string[] {
  const lines = STAGES.map((s) => {
    const e = run.stages[s];
    const when = e.endedAt ? ` ${e.endedAt.replace("T", " ").slice(0, 19)}` : "";
    const model = e.model ? ` (${e.model})` : "";
    const err = e.state === "failed" && e.error ? `: ${e.error.split(/\r?\n/)[0].slice(0, 160)}` : "";
    return `  ${s.padEnd(9)} ${e.state}${model}${when}${err}`;
  });
  const g = run.gates.story;
  const s = run.gates.shop;
  const shop = !s.on
    ? "off"
    : s.state === "waiting"
      ? `the shopping list waits for your choices (${s.needs?.join(", ") ?? "see shopping.json"})`
      : s.state === "done"
        ? `chosen${s.by ? ` (${s.by})` : ""}`
        : "not reached yet";
  // Gate 2 sits after the library match, before the director; gate 1 after the story check.
  lines.splice(STAGES.indexOf("match") + 1, 0, `  ${"gate 2".padEnd(9)} ${shop}`);
  lines.splice(STAGES.indexOf("check") + 1, 0, `  ${"gate".padEnd(9)} ${g.on ? (g.state === "approved" ? `story approved${g.by ? ` (${g.by})` : ""}` : g.state === "waiting" ? "waiting for your approval" : "story not written yet") : "off"}`);
  return lines;
}
