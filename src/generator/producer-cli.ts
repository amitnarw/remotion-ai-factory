/**
 * src/generator/producer-cli.ts — `npm run producer -- <command>`: the
 * producer on the command line (docs/factory/15-producer.md §6, P5 §16).
 *
 *   new "<premise>" [flags]             a new run: npm run generate's flags (--channel, --script, --format...)
 *   resume <run> [flags]                go on from where the run stopped (approves a story that waits)
 *   status <run>                        each stage and gate, then the producer's open proposals and standing notes
 *   needs <run>                         the run's shopping list
 *   get <run> n6=<source>:<id> ...      gate 2's choices, then the rest of the plan (--all-cc0: every free pick)
 *   say <run> "<note>"                  a note to the producer: it answers with proposals; nothing changes yet
 *   ok <run> [p1 p2 ...]                apply proposals (every open one when none is named)
 *   no <run> [p1 ...]                   turn proposals down (every open one when none is named)
 *   undo <run>                          take back the last proposal applied
 *   notes <run>                         the conversation so far
 *
 * new, resume, status and get run src/generator/generate.ts with the same
 * flags. A change to a finished plan lands as an editor version (undo works
 * there too) and its spec.json is rebuilt, so the next render shows it.
 */
import { spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { prepareFilm } from "./film/prepare";
import { formatShopping, type Shopping } from "./library/acquire/acquire";
import type { NeedsFile } from "./library/match";
import { formatShoppingList } from "./library/shopping";
import { runDir } from "./pipeline/manifest";
import { confirm, conversation, discard, say, undoLast, type Applied } from "./pipeline/producer";
import type { Proposal } from "./pipeline/notes";

const USAGE = `npm run producer -- <command>
  new "<premise>" [flags]        a new run (npm run generate's flags)
  resume <run> [flags]           go on from where it stopped
  status <run>                   the stages, the gates, open proposals and standing notes
  needs <run>                    the shopping list
  get <run> n6=<source>:<id> ... gate 2's choices (--all-cc0 for every free pick), then the rest
  say <run> "<note>"             a note: the producer answers with proposals
  ok <run> [p1 p2 ...]           apply proposals (every open one when none is named)
  no <run> [p1 ...]              turn proposals down
  undo <run>                     take back the last proposal applied
  notes <run>                    the conversation`;

/** npm run generate with these arguments, in this process's tsx. */
function generate(args: string[]): number {
  const r = spawnSync(process.execPath, [...process.execArgv, join(process.cwd(), "src", "generator", "generate.ts"), ...args], { stdio: "inherit" });
  return r.status ?? 1;
}

function runOf(arg: string | undefined): string {
  if (!arg || !/^[a-z0-9][a-z0-9-]*$/.test(arg)) throw new Error(`name the run (its folder in output/), e.g. npm run producer -- say what-if-money-doubled-3f2a1c "..."\n\n${USAGE}`);
  if (!existsSync(runDir(arg))) throw new Error(`no run "${arg}" in output/`);
  return arg;
}

function printProposal(p: Proposal & { state?: string }): void {
  console.log(`  ${p.id}  [${p.action}]${p.state && p.state !== "open" ? ` (${p.state})` : ""} ${p.summary}`);
  for (const c of p.changes.slice(0, 12)) console.log(`        ${c}`);
  if (p.changes.length > 12) console.log(`        ... and ${p.changes.length - 12} more`);
}

/** After a change to a finished plan: its spec.json follows the film, so a render shows the change. */
async function rebuild(id: string, a: Applied): Promise<void> {
  if (a.phase !== "plan" || a.version === undefined) return;
  const prepared = await prepareFilm(id, { voice: "estimate" });
  for (const w of prepared.warnings) console.warn(`[film] ${w}`);
  console.log(`The plan is at version ${a.version} (${a.redo === "voice" ? "changed lines are voiced again at the render" : "no new voice needed"}).`);
  console.log(`  Render it:            npm run generate -- --resume ${id} --chunked`);
  console.log(`  Or open it in the editor (?tab=editor&film=${id}).`);
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "new":
      return generate(rest);
    case "resume":
      return generate(["--resume", runOf(rest[0]), ...rest.slice(1)]);
    case "get": {
      const id = runOf(rest[0]);
      const flags = rest.slice(1).filter((a) => a.startsWith("--"));
      const approvals = rest.slice(1).filter((a) => !a.startsWith("--"));
      return generate(["--resume", id, ...(approvals.length ? ["--approve", approvals.join(",")] : []), ...flags]);
    }
    case "status": {
      const id = runOf(rest[0]);
      const code = generate(["--status", id]);
      const c = conversation(id);
      const open = c.proposals.filter((p) => p.state === "open");
      if (open.length) {
        console.log("\nThe producer's proposals waiting for you (ok or no):");
        open.forEach(printProposal);
      }
      if (c.standing.length) console.log(`\nStanding notes:\n${c.standing.map((s) => `  - ${s}`).join("\n")}`);
      return code;
    }
    case "needs": {
      const id = runOf(rest[0]);
      const shopping = join(runDir(id), "shopping.json");
      const needs = join(runDir(id), "needs.json");
      if (existsSync(shopping)) console.log(formatShopping(JSON.parse(readFileSync(shopping, "utf8")) as Shopping));
      else if (existsSync(needs)) console.log(formatShoppingList(JSON.parse(readFileSync(needs, "utf8")) as NeedsFile));
      else console.log(`${id} has no breakdown yet: its needs are listed after the story is approved.`);
      return 0;
    }
    case "say": {
      const id = runOf(rest[0]);
      const text = rest.slice(1).join(" ").trim();
      if (!text) throw new Error(`say what to change: npm run producer -- say ${id} "make scene 2 at night"`);
      const got = await say(id, text);
      console.log(`\nProducer: ${got.reply || "(no answer)"}`);
      if (got.proposals.length) {
        console.log("\nProposed (nothing has changed yet):");
        got.proposals.forEach(printProposal);
        console.log(`\n  Apply:    npm run producer -- ok ${id}${got.proposals.length > 1 ? ` [${got.proposals.map((p) => p.id).join(" ")}]` : ""}`);
        console.log(`  Discard:  npm run producer -- no ${id}`);
      }
      return 0;
    }
    case "ok":
    case "no": {
      const id = runOf(rest[0]);
      const named = rest.slice(1);
      const ids = named.length ? named : conversation(id).proposals.filter((p) => p.state === "open").map((p) => p.id);
      if (!ids.length) throw new Error(`${id} has no open proposal; say a note first`);
      for (const pid of ids) {
        if (cmd === "no") {
          discard(id, pid);
          console.log(`${pid}: discarded`);
          continue;
        }
        const a = confirm(id, pid);
        console.log(`${pid}: applied`);
        for (const s of a.summary) console.log(`  ${s}`);
        await rebuild(id, a);
      }
      return 0;
    }
    case "undo": {
      const id = runOf(rest[0]);
      const a = undoLast(id);
      console.log(`${a.proposal}: undone`);
      for (const s of a.summary) console.log(`  ${s}`);
      await rebuild(id, a);
      return 0;
    }
    case "notes": {
      const id = runOf(rest[0]);
      const c = conversation(id);
      if (!c.turns.length) console.log(`No notes on ${id} yet: npm run producer -- say ${id} "..."`);
      for (const t of c.turns) {
        if (t.kind === "user") console.log(`\nYou: ${t.text}`);
        else if (t.kind === "producer") {
          console.log(`Producer: ${t.reply}`);
          for (const p of t.proposals) printProposal(c.proposals.find((x) => x.id === p.id) ?? p);
        } else if (t.kind === "applied") console.log(`  ${t.proposal} applied`);
        else if (t.kind === "discarded") console.log(`  ${t.proposal} discarded`);
        else if (t.kind === "undone") console.log(`  ${t.proposal} undone: ${t.summary.join("; ")}`);
      }
      if (c.standing.length) console.log(`\nStanding notes:\n${c.standing.map((s) => `  - ${s}`).join("\n")}`);
      return 0;
    }
    default:
      console.log(USAGE);
      return cmd ? 1 : 0;
  }
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(`[producer] ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  },
);
