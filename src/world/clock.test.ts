/**
 * One clock for the place (docs/factory/14-bullet-time.md risk 1): a layer
 * that read the frame itself would keep moving while a bullet time freezes
 * the world. Under src/world only GroundWorld (the place's provider of time)
 * and the compositions and previews that own a canvas read the frame; every
 * layer takes its time from them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = join(process.cwd(), "src", "world");
/** The readers allowed: the place's provider, and compositions with their own canvas. */
const PROVIDERS = new Set(["Ground.tsx", "WorldFlight.tsx", "GlobeSpin.tsx", "react/ReactionsPreview.tsx", "react/darkPreview.tsx", "actors/ActorStage.tsx", "vfx/VfxPreview.tsx"]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

test("only the place's clock provider and the compositions read the frame under src/world", () => {
  const readers = files(ROOT)
    .filter((p) => /useCurrentFrame\s*\(/.test(readFileSync(p, "utf8")))
    .map((p) => relative(ROOT, p).replace(/\\/g, "/"));
  const strays = readers.filter((r) => !PROVIDERS.has(r));
  assert.deepEqual(strays, [], `these read the frame themselves (take t from GroundWorld): ${strays.join(", ")}`);
  for (const layer of ["atmosphere/Birds.tsx", "atmosphere/Flags.tsx", "actors/Actors.tsx", "TrafficLayer.tsx", "ProjectilesLayer.tsx"]) {
    assert.ok(!readers.includes(layer), `${layer} takes its time from props`);
  }
});
