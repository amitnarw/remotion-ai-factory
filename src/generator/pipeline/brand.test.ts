/**
 * A channel's brand in a run (docs/factory/15-producer.md §7, "Brand"): the
 * plan's spec carries the profile's brand, a rebuild keeps it, and a what-if
 * plan has no brand key at all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { channelBrand, loadChannel } from "../ai/channels";
import { SettingsSchema } from "../spec.schema";
import { videoFrames, storyFrames } from "../../compositions/brand/length";
import { resetFixtureCounters } from "./llm";
import { runDir, setOutputDir } from "./manifest";
import { reassemble, runPlan } from "./run";

const BULLET = join(process.cwd(), "test-fixtures", "pipeline", "bullet-test");
const audio = JSON.parse(readFileSync(join(BULLET, "audio.json"), "utf8"));
const premise = "What if, once a day, the world stopped for one second, for everyone but you?";

// The run folders go to a temp folder, not output/.
setOutputDir(mkdtempSync(join(tmpdir(), "brand-test-")));

function cleanup(id: string) {
  delete process.env.FACTORY_LLM_FIXTURES;
  rmSync(runDir(id), { recursive: true, force: true });
  rmSync(join(process.cwd(), "output", `${id}-voice`), { recursive: true, force: true });
  rmSync(join(process.cwd(), "output", `${id}-voice.json`), { force: true });
  rmSync(join(process.cwd(), "public", "voice", id), { recursive: true, force: true });
}

test("an action-channel plan carries the channel's brand into its spec; a rebuild keeps it", async () => {
  const id = "fixture-test-brand-action";
  try {
    process.env.FACTORY_LLM_FIXTURES = BULLET;
    resetFixtureCounters();
    const { spec } = await runPlan({ id, premise, settings: SettingsSchema.parse({ format: "9:16", targetDuration: 38 }), audio, channel: "action" });
    const brand = channelBrand(loadChannel("action"));
    assert.ok(brand, "the action channel has a brand");
    assert.deepEqual(spec.brand, brand);
    assert.equal(videoFrames(spec), storyFrames(spec) + 45 + 90, "the video holds the 1.5 s intro and the 3 s outro");
    const again = await reassemble(id, "plan");
    assert.deepEqual(again.spec.brand, brand);
  } finally {
    cleanup(id);
  }
});

test("a what-if plan has no brand key", async () => {
  const id = "fixture-test-brand-what-if";
  try {
    process.env.FACTORY_LLM_FIXTURES = BULLET;
    resetFixtureCounters();
    const { spec } = await runPlan({ id, premise, settings: SettingsSchema.parse({ format: "9:16", targetDuration: 38 }), audio });
    assert.equal("brand" in spec, false);
    assert.equal(videoFrames(spec), storyFrames(spec));
  } finally {
    cleanup(id);
  }
});
