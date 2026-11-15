/**
 * scripts/scalp-test.ts — render the G0.1 scalp still using the Remotion
 * Node.js API (same pattern as scripts/photographer.ts).
 *
 *   npx tsx scripts/scalp-test.ts
 *
 * Writes out/scalp-test.png. The user inspects it and answers:
 *   does the scalp read as a head, or as a hole/mannequin?
 */
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";

const ROOT = process.cwd();
const OUT = join(ROOT, "out");
const PNG = join(OUT, "scalp-test.png");

async function renderScalpStill(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  if (existsSync(PNG)) rmSync(PNG, { force: true });

  console.log("[scalp-test] bundling src/index.ts...");
  const serveUrl = await bundle(join(ROOT, "src", "index.ts"));
  console.log("[scalp-test] bundled at", serveUrl);

  const chromiumOptions = { gl: "angle" as const };
  const browser = await openBrowser("chrome", { chromiumOptions });
  try {
    const composition = await selectComposition({
      serveUrl,
      id: "ScalpTest",
      inputProps: {},
      puppeteerInstance: browser,
      chromiumOptions,
    });
    console.log(`[scalp-test] composition: ${composition.id} ${composition.width}x${composition.height} @ ${composition.fps}fps`);

    await renderStill({
      composition,
      serveUrl,
      output: PNG,
      frame: 0,
      inputProps: {},
      scale: 1,
      puppeteerInstance: browser,
      chromiumOptions,
      overwrite: true,
    });
    console.log(`[scalp-test] wrote ${PNG}`);
    console.log("[scalp-test] G0.1: inspect out/scalp-test.png — does the scalp read as a head, or as a hole/mannequin?");
  } finally {
    await browser.close({ silent: true });
  }
}

renderScalpStill().catch((e) => {
  console.error("[scalp-test]", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
