/**
 * scripts/photographer.ts — check every shot of a planned or rendered video:
 * one draft still per shot, measured by code (src/generator/qa/photographer.ts).
 *
 * Usage:
 *   npx tsx scripts/photographer.ts <id> [--bundle out/<folder>] [--scale 0.5]
 * Reads output/<id>-props.json (after a render) or output/<id>-spec.json (a plan).
 * Writes output/<id>/qa/<beat>.png and output/<id>/qa/qa.json. Nothing is played.
 * When Providers -> Model roles has a "Photographer (vision)" model, each still
 * also gets yes/no questions (src/generator/qa/vision.ts); --no-vision skips them.
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { loadAiConfig } from "../src/generator/ai/provider-registry";
import { pickRoleModel } from "../src/generator/ai/roles";
import { checkShots } from "../src/generator/qa/photographer";
import { validateSpec } from "../src/generator/spec.schema";

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith("--"));
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!id) {
  console.error("usage: npx tsx scripts/photographer.ts <id> [--bundle out/<folder>] [--scale 0.5]");
  process.exit(2);
}

async function main() {
  const out = join(process.cwd(), "output");
  const propsPath = join(out, `${id}-props.json`);
  const specPath = join(out, `${id}-spec.json`);
  const raw = existsSync(propsPath) ? JSON.parse(readFileSync(propsPath, "utf8")).spec : JSON.parse(readFileSync(specPath, "utf8"));
  const spec = validateSpec(raw);
  if (!spec.shots?.length) throw new Error(`${id} has no shots (planned before Phase 3?)`);
  const bundleDir = opt("bundle");
  // Vision only with a model chosen for that role: the writer's model may not see images.
  const pick = pickRoleModel(loadAiConfig().roles, "vision");
  const vision = !args.includes("--no-vision") && pick.provider && pick.model ? { provider: pick.provider, model: pick.model } : undefined;
  console.log(`[qa] vision: ${vision ? `${vision.provider}/${vision.model}` : "off (no Photographer model chosen)"}`);
  const checks = await checkShots({
    spec,
    outDir: join(out, id!, "qa"),
    serveUrl: bundleDir ? join(process.cwd(), bundleDir) : undefined,
    scale: Number(opt("scale") ?? 0.5),
    vision,
    onShot: (c) =>
      console.log(
        `[qa] ${c.beat.padEnd(5)} ${c.subject.padEnd(9)} ${c.size.padEnd(3)} luma ${c.luma.mean.toFixed(2)} flat ${(c.flat * 100).toFixed(0)}% colour ${c.colour.toFixed(0)}  ${c.problems.length ? "FLAG: " + c.problems.join("; ") : "ok"}`,
      ),
  });
  const flagged = checks.filter((c) => c.problems.length).length;
  console.log(`[qa] ${checks.length} shots, ${flagged} flagged. Stills and qa.json in output/${id}/qa/`);
}

main().catch((e) => {
  console.error(`[qa] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
