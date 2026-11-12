/**
 * scripts/publish.ts — the publish pack of a finished run (docs/factory/20-publish.md).
 *
 * Usage:
 *   npx tsx scripts/publish.ts <run> [--bundle out/<folder>] [--frame N] [--no-thumbnail] [--output-dir <dir>]
 *
 * Reads output/<run>/ (props.json or spec.json, report.json, brief.json,
 * qa/qa.json) and writes output/<run>/publish/{publish.json, description.txt,
 * thumbnail.png}. The titles and tags are one call on the writer role's
 * model (recorded replies: FACTORY_LLM_FIXTURES=<dir> with publish-1.txt);
 * without a model they come from code, and publish.json says so.
 * --bundle: a bundle folder whose public/ is a junction (default: the cached
 * render bundle in out/phase4-bundles/). --output-dir: read and write runs
 * there instead of output/ (trials). Nothing is uploaded anywhere.
 */
import { join } from "path";
import { makePublishPack } from "../src/generator/publish";

const args = process.argv.slice(2);
const id = args.find((a, i) => !a.startsWith("--") && !["--bundle", "--frame", "--output-dir"].includes(args[i - 1] ?? ""));
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!id) {
  console.error("usage: npx tsx scripts/publish.ts <run> [--bundle out/<folder>] [--frame N] [--no-thumbnail] [--output-dir <dir>]");
  process.exit(2);
}

async function main() {
  const bundle = opt("bundle");
  const frame = opt("frame");
  const outputDir = opt("output-dir");
  const pack = await makePublishPack(id!, {
    outputDir: outputDir ? join(process.cwd(), outputDir) : undefined,
    serveUrl: bundle ? join(process.cwd(), bundle) : undefined,
    frame: frame !== undefined ? Number(frame) : undefined,
    thumbnail: !args.includes("--no-thumbnail"),
  });
  console.log("");
  pack.titles.forEach((t, i) => console.log(`Title ${i + 1}: ${t}`));
  console.log(`Tags: ${pack.tags.join(", ")}`);
  console.log(`Credits: ${pack.credits.length ? pack.credits.join(" / ") : "none (no CC-BY model in this video)"}`);
  console.log(`Chapters: ${pack.chapters.length || "none (a Short)"}`);
  console.log(`Thumbnail: ${pack.thumbnail.file ? `${pack.thumbnail.width}x${pack.thumbnail.height}, frame ${pack.thumbnail.frame}` : `not written (${pack.thumbnail.skipped})`}`);
  console.log(`PUBLISH_DIR: ${outputDir ?? "output"}/${id}/publish`);
}

main().catch((e) => {
  console.error(`[publish] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
