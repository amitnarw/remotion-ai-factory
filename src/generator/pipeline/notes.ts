/**
 * src/generator/pipeline/notes.ts — a run's conversation with the producer
 * (producer phase P5, docs/factory/15-producer.md §2 "The producer you talk
 * to"): output/<run>/notes.jsonl, one line per turn.
 *
 *   user       the user's note, as typed
 *   producer   the producer's answer and the proposals it made (nothing applied yet)
 *   applied    a proposal the user confirmed, and what undoes it
 *   discarded  a proposal the user turned down
 *   undone     an applied proposal taken back
 *
 * A proposal's state is read from the turns after it, so the file is only
 * ever appended to. Standing notes are the applied proposals that keep a
 * preference ("no dutch angles"); they go into the director's, the sound
 * designer's and the editor's prompts while the run lasts (standingNotes).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import type { Edit, Redo } from "../film/edits";
import type { BuildRequestDraft } from "../library/match";
import type { Need } from "./breakdown";
import { runDir } from "./manifest";
import type { WriterStory } from "./writer";

/** What a note asks for (15 §2's table, plus "keep" for a standing preference). */
export const ACTION_KINDS = ["edit", "restage", "resound", "story", "need", "build", "question", "settings", "keep"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export interface Proposal {
  /** "p1", "p2"...: unique in the run. */
  id: string;
  action: ActionKind;
  /** One line: what it changes. */
  summary: string;
  /** The diff, one line per change. */
  changes: string[];
  /** A complete plan: edits to the film (film/edits.ts), saved as a film version. */
  edits?: Edit[];
  redo?: Redo;
  /** A story still at its gates: the story as it would be saved to story.json. */
  story?: WriterStory;
  /** A preference that stays with the run. */
  standing?: string;
  /** A capability the factory lacks: the build request to file. */
  request?: { draft: BuildRequestDraft; beats: string[]; why: string };
  /** Something new that the library lacks: the need to put on the run's shopping list (needs.json). */
  need?: Need;
}

/** What undoes an applied proposal. */
export interface Undo {
  /** The film version the proposal saved (undo moves back from it). */
  film?: number;
  /** The story before the proposal (a story at its gates). */
  story?: WriterStory;
  /** A standing note was added. */
  standing?: string;
  /** A build request got this run's ask. */
  request?: string;
  /** A need was added to needs.json. */
  need?: string;
}

export type Turn =
  | { kind: "user"; at: string; n: number; text: string }
  | { kind: "producer"; at: string; n: number; reply: string; proposals: Proposal[] }
  | { kind: "applied"; at: string; proposal: string; summary: string[]; undo: Undo }
  | { kind: "discarded"; at: string; proposal: string }
  | { kind: "undone"; at: string; proposal: string; summary: string[] };

export type ProposalState = "open" | "applied" | "discarded" | "undone";

const file = (id: string) => join(runDir(id), "notes.jsonl");

/** Every turn of the run's conversation, oldest first. */
export function readTurns(id: string): Turn[] {
  const f = file(id);
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as Turn];
      } catch {
        return [];
      }
    });
}

export function appendTurn(id: string, turn: Turn): void {
  mkdirSync(runDir(id), { recursive: true });
  appendFileSync(file(id), `${JSON.stringify(turn)}\n`);
}

/** Every proposal the producer made, with its state now. */
export function proposals(turns: Turn[]): Array<Proposal & { state: ProposalState; n: number }> {
  const out: Array<Proposal & { state: ProposalState; n: number }> = [];
  for (const t of turns) {
    if (t.kind === "producer") out.push(...t.proposals.map((p) => ({ ...p, state: "open" as ProposalState, n: t.n })));
    else if (t.kind !== "user") {
      const p = out.find((x) => x.id === t.proposal);
      if (p) p.state = t.kind;
    }
  }
  return out;
}

/** The applied turn of a proposal still applied, latest first (what undo takes back). */
export function appliedTurns(turns: Turn[]): Array<Extract<Turn, { kind: "applied" }>> {
  const state = new Map(proposals(turns).map((p) => [p.id, p.state]));
  return turns.filter((t): t is Extract<Turn, { kind: "applied" }> => t.kind === "applied" && state.get(t.proposal) === "applied").reverse();
}

/** The run's standing notes: preferences the user confirmed, in the order given. */
export function standingNotes(id: string): string[] {
  const turns = readTurns(id);
  return appliedTurns(turns)
    .reverse()
    .map((t) => t.undo.standing)
    .filter((s): s is string => !!s);
}

/** The standing notes as a prompt block ("" when there are none, so prompts stay as they were). */
export function standingBlock(notes: readonly string[]): string {
  return notes.length ? `\nTHE USER'S STANDING NOTES for this video (keep to them):\n${notes.map((n) => `- ${n}`).join("\n")}` : "";
}

/** The next turn number and proposal number. */
export function nextNumbers(turns: Turn[]): { n: number; p: number } {
  const n = Math.max(0, ...turns.filter((t) => t.kind === "user").map((t) => (t as { n: number }).n)) + 1;
  const p = Math.max(0, ...proposals(turns).map((x) => Number(x.id.slice(1)) || 0)) + 1;
  return { n, p };
}
