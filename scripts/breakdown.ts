/**
 * scripts/breakdown.ts — the shopping list for one story: the breakdown
 * (src/generator/pipeline/breakdown.ts) and the inventory match
 * (src/generator/library/match.ts), printed as gate 2 would show it: what we
 * have, what stands in, what to download, what to build
 * (docs/factory/15-producer.md §3, §4).
 *
 * Usage:
 *   npx tsx scripts/breakdown.ts <story.json> [--fixtures <dir>] [--no-judge] [--out <needs.json>] [--registry] [--verbose]
 *
 *   <story.json>   a writer story (output/<run>/story.json), or any JSON with one under "story"
 *   --fixtures     replay recorded replies from <dir> (breakdown-1.txt, matcher-<need>-1.txt);
 *                  default: $FACTORY_LLM_FIXTURES, else the story's own folder when it holds
 *                  breakdown-1.txt (test-fixtures/breakdown/<story>/), else the configured models
 *   --no-judge     code verdicts only (no matcher calls)
 *   --out          also write the matched needs (the needs.json a run would save)
 *   --registry     print the registry's size by kind first
 *   --verbose      keep the model-call log lines
 *
 * Examples:
 *   npx tsx scripts/breakdown.ts test-fixtures/breakdown/keeper/story.json
 *   npx tsx scripts/breakdown.ts test-fixtures/breakdown/rooftop/story.json --registry
 *
 * No paid model is called on fixtures. Without fixtures it uses the models
 * the roles are set to (Settings -> AI models), Ollama under the standing rules.
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { matchNeeds } from "../src/generator/library/match";
import { MATCHER_ROLE } from "../src/generator/library/judge";
import { registry } from "../src/generator/library/registry";
import { formatShoppingList } from "../src/generator/library/shopping";
import { BREAKDOWN_ROLE, breakDownStory } from "../src/generator/pipeline/breakdown";
import { resolveRoleModels, type RoleModel } from "../src/generator/pipeline/llm";
import type { WriterStory } from "../src/generator/pipeline/writer";

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function option(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/** The story in a file: a writer story, or one under "story". Beats without ids get b1..bN. */
function readStory(file: string): WriterStory {
  const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const s = (Array.isArray(raw.beats) ? raw : raw.story) as WriterStory | undefined;
  if (!s || !Array.isArray(s.beats) || !s.beats.length) throw new Error(`${file}: no story with beats in it (a writer story, or one under "story")`);
  return {
    title: s.title ?? "Untitled",
    hook: s.hook ?? "",
    mood: s.mood ?? "",
    characters: s.characters ?? [],
    beats: s.beats.map((b, i) => ({ ...b, id: b.id || `b${i + 1}`, lines: b.lines ?? [], say: b.say ?? "", see: b.see ?? "" })),
  };
}

async function main() {
  const file = process.argv[2];
  if (!file || file.startsWith("--")) {
    console.error("usage: npx tsx scripts/breakdown.ts <story.json> [--fixtures <dir>] [--no-judge] [--out <needs.json>] [--registry] [--verbose]");
    process.exit(2);
  }
  const story = readStory(resolve(file));

  const beside = dirname(resolve(file));
  const fixtures = option("fixtures") ?? process.env.FACTORY_LLM_FIXTURES ?? (existsSync(join(beside, "breakdown-1.txt")) ? beside : undefined);
  if (fixtures) process.env.FACTORY_LLM_FIXTURES = fixtures;

  if (!flag("verbose")) {
    // callRole logs every attempt; the list is what this command is for.
    for (const k of ["log", "warn"] as const) {
      const real = console[k].bind(console);
      console[k] = (...args: unknown[]) => {
        if (typeof args[0] === "string" && args[0].startsWith("[llm]")) return;
        real(...args);
      };
    }
  }

  const models: Record<string, RoleModel> = fixtures
    ? { writer: { provider: "fixtures", model: fixtures } }
    : resolveRoleModels([BREAKDOWN_ROLE, MATCHER_ROLE]);

  const reg = registry();
  if (flag("registry")) {
    console.log(`Registry ${reg.version}: ${reg.entries.length} capabilities`);
    console.log(Object.entries(reg.counts()).map(([k, n]) => `  ${k} ${n}`).join("\n"));
    console.log("");
  }

  const bd = await breakDownStory({ story, models });
  const needs = await matchNeeds(bd.needs, { models, judge: !flag("no-judge"), registry: reg });
  console.log(formatShoppingList({ ...needs, warnings: [...bd.warnings, ...needs.warnings] }, story.title));
  console.log(`\n(${fixtures ? `replayed from ${fixtures}` : `models: breakdown ${models[BREAKDOWN_ROLE]?.model ?? models.writer.model}, matcher ${models[MATCHER_ROLE]?.model ?? models.writer.model}`})`);

  const out = option("out");
  if (out) {
    writeFileSync(out, JSON.stringify(needs, null, 2));
    console.log(`needs written to ${out}`);
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
