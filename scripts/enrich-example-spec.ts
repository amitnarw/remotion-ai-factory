/**
 * scripts/enrich-example-spec.ts
 * One-time: resolve the asset ids in spec.example.gravity.json to their
 * catalog file paths (validateAssets) and write the resolved file: fields
 * back into the committed JSON, so the bundled demo renders without a CLI
 * presence. Safe to re-run; exits 1 if the catalog lacks an id (exact fix
 * in the message).
 */
import { join } from "path";
import { writeFileSync, readFileSync } from "fs";
import { validateAssets } from "../src/generator/asset-catalog";
import gravitySpec from "../src/generator/spec.example.gravity.json";

const spec = JSON.parse(JSON.stringify(gravitySpec)) as typeof gravitySpec;
try {
  validateAssets(spec);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
const outPath = join(__dirname, "..", "src", "generator", "spec.example.gravity.json");
const out = JSON.stringify(spec, null, 2) + "\n";
// Keep the trailing-newline behavior of the original file.
const hadNewline = readFileSync(outPath, "utf8").endsWith("\n");
writeFileSync(outPath, hadNewline ? out : out.trimEnd());
console.log("enriched spec.example.gravity.json with resolved asset file paths");
