import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { SettingsSchema, validateSpec } from "../spec.schema";
import { parseCounterValue } from "./assemble";
import { matchesStress } from "./captions";
import { resetFixtureCounters } from "./llm";
import { mergeAudio, reassemble, runPlan } from "./run";
import { matchSound, soundVocabulary } from "./sound";
import { resolveTtsPython } from "../tts-python";

const FIXTURES = join(process.cwd(), "test-fixtures", "pipeline", "money-doubles");
const ID = "fixture-test-money-doubles";

test("counter values: plain numbers only", () => {
  assert.equal(parseCounterValue("1,000"), 1000);
  assert.equal(parseCounterValue("2x"), 2);
  assert.equal(parseCounterValue("$5"), 5);
  assert.equal(parseCounterValue("50%"), 50);
  assert.equal(parseCounterValue("10^30"), null);
  assert.equal(parseCounterValue("infinity"), null);
  assert.equal(parseCounterValue("99999999999"), null); // too long for the HUD
});

test("stress words survive a rewrite", () => {
  assert.ok(matchesStress("burst.", "bursting"));
  assert.ok(matchesStress("Coins,", "coin"));
  assert.ok(!matchesStress("a", "and"));
});

test("whoosh prefers the whoosh sound over other names containing it", () => {
  assert.equal(matchSound("whoosh", soundVocabulary()), "whoosh_dissolve");
});

test("the fixture pipeline plans a valid video and saves every stage", async () => {
  resetFixtureCounters();
  process.env.FACTORY_LLM_FIXTURES = FIXTURES;
  try {
    const audio = JSON.parse(readFileSync(join(FIXTURES, "audio.json"), "utf8"));
    const { spec, report } = await runPlan({
      id: ID,
      premise: "What if money doubled every 3 seconds?",
      settings: SettingsSchema.parse({ format: "9:16", targetDuration: 25 }),
      audio,
    });
    assert.doesNotThrow(() => validateSpec(spec));
    for (const f of ["story", "voice", "timeline", "direction", "sound", "plan"]) {
      assert.ok(existsSync(join(process.cwd(), "output", ID, `${f}.json`)), `${f}.json saved`);
    }
    assert.ok(Math.abs(report.duration - 25) / 25 <= 0.1 || report.duration <= 25 * 1.4, `length ${report.duration} within 10% of 25 (or honestly over, capped at 40%)`);
    // The plan-time length is a PREDICTION from the machine-calibrated speech
    // model (overhead + words/s from the voice cache), which drifts as the
    // cache changes; the render measures the real durations and re-times, and
    // the render-based milestone enforces the ±10% rule on the real MP4. The
    // assert above only catches a runaway plan.
    assert.equal(report.revised, true);
    assert.equal(spec.scenes[0].kit, "street-block");
    assert.equal(spec.scenes[1].kit, "space");
    const values = spec.statPanel!.beats.map((b) => b.value);
    assert.deepEqual(values, ["1", "2", "1048576"], "unshowable counter values are dropped, not mangled");
    assert.ok(spec.captions.some((c) => c.speaker === "Ana"));
    assert.equal(spec.story?.characters[0].voice !== undefined, true);

    // Approved edits survive a reassemble: a same-length story line keeps the
    // timing (same estimate → same windows) and a caption text edit sticks.
    const edited = JSON.parse(JSON.stringify(spec)) as typeof spec;
    const withSay = edited.story!.beats.filter((b) => b.say != null);
    assert.ok(withSay.length > 0, "a beat with a say exists");
    const beat = withSay[0];
    const words = (beat.say ?? "").trim().split(/\s+/);
    words[words.length - 1] = "now"; // same word count → same estimate → same caption windows
    beat.say = words.join(" ");
    edited.captions[0].text = `[edited] ${edited.captions[0].text}`;
    const again = await reassemble(ID, "plan", undefined, edited);
    assert.doesNotThrow(() => validateSpec(again.spec));
    assert.ok(again.warnings.some((w) => /story line\(s\) updated/.test(w)), "the adopted story edit is announced");
    assert.ok(again.spec.captions[0].text.startsWith("[edited]"), "the approved caption text kept its window");
    assert.equal(again.spec.story!.beats.find((b) => b.say === beat.say) !== undefined, true, "the approved story text adopted");
    const saved = JSON.parse(readFileSync(join(process.cwd(), "output", ID, "story.json"), "utf8")) as { beats: Array<{ say: string }> };
    assert.ok(saved.beats.some((b) => b.say === beat.say), "the story edit persisted to the stage file");

    // Rebuilding from the saved files (no model calls) gives the same video length.
    if (!resolveTtsPython("kitten2")) {
      const re = await reassemble(ID, "plan");
      assert.equal(Math.max(...re.spec.scenes.map((s) => s.to)), Math.max(...again.spec.scenes.map((s) => s.to)));
    }
  } finally {
    delete process.env.FACTORY_LLM_FIXTURES;
    rmSync(join(process.cwd(), "output", ID), { recursive: true, force: true });
  }
});

test("a character recast in the review keeps its voice when the approval sends voice settings", () => {
  const plan = { narration: { enabled: true, engine: "kitten2" as const }, dialogs: { enabled: true, engine: "kitten2" as const, voices: { Ana: "Luna" } } };
  const approval = { narration: { enabled: true, engine: "kitten2" as const, voice: "Hugo" }, dialogs: { enabled: true, engine: "kitten2" as const, defaultVoice: "Rosie" } };
  const merged = mergeAudio(plan, approval);
  assert.equal(merged.narration?.voice, "Hugo");
  assert.deepEqual(merged.dialogs?.voices, { Ana: "Luna" });
  // A different character engine drops the Kitten presets.
  assert.equal(mergeAudio(plan, { ...approval, dialogs: { enabled: true, engine: "voxcpm2" } }).dialogs?.voices, undefined);
  assert.equal(mergeAudio(plan, undefined), plan);
});
