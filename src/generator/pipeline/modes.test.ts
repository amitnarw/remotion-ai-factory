/**
 * Channels and story modes in a run (producer phase P2): a script as written,
 * a story adapted, the channel's limits on the director and the sound.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { criticSystem, directorGuide, loadChannel, soundGuide } from "../ai/channels";
import { SettingsSchema, validateSpec } from "../spec.schema";
import { DirectorSchema, normalizeDirector } from "./director";
import { resetFixtureCounters, setModelAsker } from "./llm";
import { readBrief, readRun, runDir, setOutputDir } from "./manifest";
import { channelDirection, channelSound, resumePlan, runPlan, StoryGateStop } from "./run";
import { checkWords, parseScript } from "./script";
import { buildTimeline, naturalLength } from "./timeline";
import { writerPrompt, type WriterStory } from "./writer";
import type { PlannedLine } from "./voice";

const PIPE = join(process.cwd(), "test-fixtures", "pipeline");
const KEEPER = join(PIPE, "keeper-as-written");
const script = readFileSync(join(KEEPER, "script.txt"), "utf8");
const audio = JSON.parse(readFileSync(join(KEEPER, "audio.json"), "utf8"));

// The run folders go to a temp folder, not output/.
setOutputDir(mkdtempSync(join(tmpdir(), "modes-test-")));

function fixtures(from: string, opts: { without?: string[]; add?: Record<string, string> } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "modes-fixtures-"));
  cpSync(from, dir, { recursive: true });
  for (const f of readdirSync(dir)) if (opts.without?.some((p) => f.startsWith(p))) rmSync(join(dir, f));
  for (const [name, text] of Object.entries(opts.add ?? {})) writeFileSync(join(dir, name), text);
  resetFixtureCounters();
  process.env.FACTORY_LLM_FIXTURES = dir;
  return dir;
}

/** The run's folder, and the voice files the plan published for it (tts.ts keeps them under output/ and public/). */
function cleanup(id: string) {
  delete process.env.FACTORY_LLM_FIXTURES;
  rmSync(runDir(id), { recursive: true, force: true });
  rmSync(join(process.cwd(), "output", `${id}-voice`), { recursive: true, force: true });
  rmSync(join(process.cwd(), "output", `${id}-voice.json`), { force: true });
  rmSync(join(process.cwd(), "public", "voice", id), { recursive: true, force: true });
}

test("a drama script as written keeps every word, sets its own length, and is never sped up", async () => {
  const id = "fixture-test-as-written";
  try {
    fixtures(KEEPER);
    const { spec, report } = await runPlan({ id, premise: "The Keeper's Last Night", settings: SettingsSchema.parse({ format: "16:9" }), audio, channel: "drama", script });
    assert.doesNotThrow(() => validateSpec(spec));
    const story = JSON.parse(readFileSync(join(runDir(id), "story.json"), "utf8")) as WriterStory;
    assert.equal(checkWords(story, parseScript(script)), null, "word for word");
    assert.equal(story.hook, "The keeper had kept the light for forty years.");
    assert.deepEqual(story.characters.map((c) => `${c.name} ${c.gender} ${c.age}`), ["Mara female adult", "Tom male old"]);
    assert.equal(story.beats[0].see, "A storm rolls in over the sea at dusk, the lighthouse lamp flickering", "the reader filled the missing direction");
    assert.equal(story.beats[1].see, "A lighthouse on a rocky coast, waves breaking, a stormy night", "the script's own direction is kept");
    const brief = readBrief(id)!;
    assert.equal(brief.mode, "as-written");
    assert.equal(brief.channel, "drama");
    assert.ok(brief.settings.targetDuration! > 20 && brief.settings.targetDuration! < 50, `the script's length: ${brief.settings.targetDuration}`);
    const voice = JSON.parse(readFileSync(join(runDir(id), "voice.json"), "utf8")) as PlannedLine[];
    assert.ok(voice.every((l) => l.tempo === undefined), "no line is sped up");
    assert.ok(report.warnings.some((w) => /does not use the counter, the timer/.test(w)), report.warnings.join(" | "));
    assert.ok(report.warnings.some((w) => /music in epic became ambient/.test(w)));
    const direction = JSON.parse(readFileSync(join(runDir(id), "direction.json"), "utf8"));
    assert.equal(direction.counter, null);
    assert.equal(direction.timer, null);
    assert.equal(readRun(id)!.stages.story.model, "fixtures");
  } finally {
    cleanup(id);
  }
});

test("after the gate the story is broken down and matched against the library (P3)", async () => {
  const id = "fixture-test-breakdown";
  try {
    fixtures(KEEPER);
    await runPlan({ id, premise: "The Keeper's Last Night", settings: SettingsSchema.parse({ format: "16:9" }), audio, channel: "drama", script });
    const run = readRun(id)!;
    assert.equal(run.stages.breakdown.state, "done");
    assert.equal(run.stages.match.state, "done");
    const breakdown = JSON.parse(readFileSync(join(runDir(id), "breakdown.json"), "utf8")) as { needs: Array<{ id: string; kind: string }> };
    assert.ok(breakdown.needs.some((n) => n.kind === "set"));
    const needs = JSON.parse(readFileSync(join(runDir(id), "needs.json"), "utf8")) as { inventory: string; needs: Array<{ id: string; status: string }> };
    assert.equal(needs.needs.length, breakdown.needs.length, "every need is matched");
    assert.ok(needs.needs.every((n) => ["have", "close", "download", "build", "data", "skip"].includes(n.status)));
    assert.ok(needs.inventory, "matched against a versioned inventory");
  } finally {
    cleanup(id);
  }
});

test("recorded replies with no breakdown plan as before: the breakdown is skipped", async () => {
  const id = "fixture-test-no-breakdown";
  const money = join(PIPE, "money-doubles");
  try {
    fixtures(money);
    await runPlan({ id, premise: "What if money doubled every 3 seconds?", settings: SettingsSchema.parse({ format: "9:16", targetDuration: 25 }), audio: JSON.parse(readFileSync(join(money, "audio.json"), "utf8")) });
    const run = readRun(id)!;
    assert.equal(run.stages.breakdown.state, "skipped");
    assert.equal(run.stages.match.state, "skipped");
    assert.equal(run.stages.assemble.state, "done");
  } finally {
    cleanup(id);
  }
});

test("the channel's words reach the director, the sound designer and the critic", async () => {
  const id = "fixture-test-guides";
  const drama = loadChannel("drama");
  // Each role answered from the keeper's recorded replies, by its system text; every prompt kept.
  const sent: Array<{ role: string; system: string; prompt: string }> = [];
  const roleOf = (system: string) =>
    system.startsWith("You are the film director") ? "director"
    : system.startsWith("You are the sound designer") ? "sound"
    : system.includes("You read a script the user wrote") ? "reader"
    : system.startsWith("You are the production breakdown") ? "breakdown"
    : system.includes("You review a finished plan") ? "critic"
    : "other";
  const asked = new Map<string, number>();
  setModelAsker(async (_rm, system, prompt) => {
    const role = roleOf(system);
    sent.push({ role, system, prompt });
    if (role === "critic") return JSON.stringify({ issues: [] });
    // The matcher: unanswered, so code gives the verdicts.
    if (role === "other") throw new Error("no recorded reply");
    const n = (asked.get(role) ?? 0) + 1;
    asked.set(role, n);
    return readFileSync(join(KEEPER, `${role}-${n}.txt`), "utf8");
  });
  try {
    delete process.env.FACTORY_LLM_FIXTURES;
    const settings = SettingsSchema.parse({ format: "16:9", critic: true });
    await runPlan({ id, premise: "The Keeper's Last Night", settings, audio, channel: "drama", script, cli: { provider: "ollama", model: "fixture" } });
    const director = sent.find((s) => s.role === "director");
    const sound = sent.find((s) => s.role === "sound");
    const critic = sent.find((s) => s.role === "critic");
    assert.ok(directorGuide(drama) && director?.prompt.endsWith(directorGuide(drama)), "the director's prompt ends with the channel's guide");
    assert.ok(soundGuide(drama) && sound?.prompt.endsWith(soundGuide(drama)), "so does the sound designer's");
    assert.equal(critic?.system, criticSystem(drama), "the critic edits a drama");
    assert.notEqual(criticSystem(drama), criticSystem(loadChannel()));
  } finally {
    setModelAsker();
    cleanup(id);
  }
});

test("a reader that changes a word is asked again", async () => {
  const id = "fixture-test-as-written-repair";
  const good = readFileSync(join(KEEPER, "reader-1.txt"), "utf8");
  const changed = good.replace('"beat": "b2", "see"', '"beat": "b2", "say": "He climbed the old stairs.", "see"');
  try {
    fixtures(KEEPER, { add: { "reader-1.txt": changed, "reader-2.txt": good } });
    await runPlan({ id, premise: "The Keeper's Last Night", settings: SettingsSchema.parse({ format: "16:9" }), audio, channel: "drama", script });
    const story = JSON.parse(readFileSync(join(runDir(id), "story.json"), "utf8")) as WriterStory;
    assert.equal(story.beats[1].say, "He climbed the stairs one last time. His knees ached on every step.");
  } finally {
    cleanup(id);
  }
});

test("a script too long for its format stops before any model is asked", async () => {
  const id = "fixture-test-as-written-long";
  const long = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1} goes on and on about the sea and the light and the keeper.`).join("\n\n");
  try {
    fixtures(KEEPER, { without: ["reader", "director", "sound"] });
    await assert.rejects(
      runPlan({ id, premise: "Long", settings: SettingsSchema.parse({ format: "9:16" }), audio, channel: "drama", script: long }),
      /runs about \d+s when read aloud, and 9:16 allows 90s; a script is never cut or sped up/,
    );
  } finally {
    cleanup(id);
  }
});

test("a story is adapted from the user's text: the writer sees it as its source", async () => {
  const p = loadChannel("what-if");
  const settings = SettingsSchema.parse({ format: "9:16", targetDuration: 25 });
  const prompt = writerPrompt("Money doubles", settings, { narration: true, characters: false }, 7, 2.3, p, "Once upon a time a coin doubled.");
  assert.match(prompt, /^Premise: "Money doubles"\n\nSource story, the user's own\. Rewrite it into the beats below/);
  assert.match(prompt, /"""\nOnce upon a time a coin doubled\.\n"""/);
  assert.equal(writerPrompt("Money doubles", settings, { narration: true, characters: false }, 7, 2.3, p).includes("Source story"), false);

  const id = "fixture-test-adapt";
  const money = join(PIPE, "money-doubles");
  try {
    fixtures(money, { add: { "writer-adapt-1.txt": readFileSync(join(money, "writer-1.txt"), "utf8") }, without: ["writer-1"] });
    const moneyAudio = JSON.parse(readFileSync(join(money, "audio.json"), "utf8"));
    const { spec } = await runPlan({ id, premise: "Money doubles", settings, audio: moneyAudio, mode: "adapt", script: "My story: one coin on a café table doubles every three seconds until it outweighs the planet." });
    assert.doesNotThrow(() => validateSpec(spec));
    assert.equal(readBrief(id)!.mode, "adapt");
  } finally {
    cleanup(id);
  }
});

test("an adapted story is checked at the gate: the plot points no beat tells are listed as lost", async () => {
  const id = "fixture-test-adapt-check";
  const money = join(PIPE, "money-doubles");
  const checker = JSON.stringify({
    notes: [{ beat: "b2", note: "The doubling is told, not shown: let the second coin appear on screen." }, { beat: "b99", note: "no such beat" }],
    claims: [{ beat: "b1", claim: "Coins double every three seconds", verdict: "check" }],
    plot: [
      { point: "One coin on a cafe table doubles", beats: ["b1", "b2"] },
      { point: "The coins outweigh the planet", beats: [] },
      { point: "A bank closes its doors", beats: ["b42"] },
    ],
  });
  const settings = SettingsSchema.parse({ format: "9:16", targetDuration: 25 });
  const moneyAudio = JSON.parse(readFileSync(join(money, "audio.json"), "utf8"));
  const source = "My story: one coin on a café table doubles every three seconds until it outweighs the planet, and a bank closes its doors.";
  try {
    fixtures(money, { add: { "writer-adapt-1.txt": readFileSync(join(money, "writer-1.txt"), "utf8"), "checker-1.txt": checker }, without: ["writer-1"] });
    const stop = await runPlan({ id, premise: "Money doubles", settings, audio: moneyAudio, mode: "adapt", script: source, storyGate: true }).then(
      () => assert.fail("the plan should stop at the story gate"),
      (e: unknown) => e,
    );
    assert.ok(stop instanceof StoryGateStop);
    assert.deepEqual(stop.check?.lost, ["The coins outweigh the planet", "A bank closes its doors"], "code decides: no beat, or no real beat, tells them");
    assert.deepEqual(stop.check?.notes.map((n) => n.beat), ["b2"], "a note on a beat that does not exist is dropped");
    assert.deepEqual(stop.check?.claims, [{ beat: "b1", claim: "Coins double every three seconds", status: "check" }]);
    const saved = JSON.parse(readFileSync(join(runDir(id), "story.check.json"), "utf8"));
    assert.deepEqual(saved.lost, stop.check?.lost);
    assert.equal(readRun(id)!.stages.check.state, "done");
    // The approval keeps the check: it is not asked again (there is no checker-2 reply).
    const { report } = await resumePlan(id, { approveStory: true });
    assert.equal(readRun(id)!.stages.check.state, "done");
    assert.ok(report.warnings.some((w) => /lost 2 plot point\(s\) of yours/.test(w)), report.warnings.join(" | "));
    assert.ok(!report.warnings.some((w) => /story check was skipped/.test(w)));
  } finally {
    cleanup(id);
  }
});

test("recorded replies with no checker reply skip the story check, as do runs with no gate", async () => {
  const id = "fixture-test-no-check";
  const money = join(PIPE, "money-doubles");
  try {
    fixtures(money);
    const moneyAudio = JSON.parse(readFileSync(join(money, "audio.json"), "utf8"));
    await runPlan({ id, premise: "What if money doubled every 3 seconds?", settings: SettingsSchema.parse({ format: "9:16", targetDuration: 25 }), audio: moneyAudio, storyGate: true }).catch((e) => {
      if (!(e instanceof StoryGateStop)) throw e;
      assert.equal(e.check, undefined);
    });
    assert.equal(readRun(id)!.stages.check.state, "skipped");
  } finally {
    cleanup(id);
  }
});

test("a mode the channel does not allow, or a mode without its script, is refused", async () => {
  const settings = SettingsSchema.parse({ format: "9:16" });
  await assert.rejects(runPlan({ id: "x-modes-1", premise: "p", settings, audio, mode: "as-written", script }), /What if channel does not make stories from your script as written/);
  await assert.rejects(runPlan({ id: "x-modes-2", premise: "p", settings, audio, mode: "adapt" }), /needs your story or script/);
  await assert.rejects(runPlan({ id: "x-modes-3", premise: "p", settings, audio, mode: "premise", script }), /choose adapt or as-written/);
  await assert.rejects(runPlan({ id: "x-modes-4", premise: "p", settings, audio, channel: "horror" }), /No channel "horror"/);
});

test("a channel's devices are dropped from the director's choices; what-if keeps them all", () => {
  const d = DirectorSchema.parse(
    normalizeDirector({
      scenes: [{ start: "b1", kit: "street-block", time: "noon" }],
      counter: { title: "Money", unit: "x", steps: [{ beat: "b1", value: "1", sub: "one", bpm: 90 }] },
      timer: { label: "Gone", startBeat: "b1", endBeat: null },
      prop: { style: "coin-stacks", growth: "multiply", anchor: "sidewalk-left" },
      world: [{ beat: "b1", event: "lights-out" }],
    }),
  );
  const all = channelDirection(d, loadChannel("what-if").devices);
  assert.equal(all.direction, d, "what-if: untouched");
  assert.deepEqual(all.dropped, []);
  const drama = channelDirection(d, loadChannel("drama").devices);
  assert.equal(drama.direction.counter, null);
  assert.equal(drama.direction.timer, null);
  assert.equal(drama.direction.prop, null);
  assert.equal(drama.direction.world.length, 1, "drama keeps world events");
  assert.deepEqual(drama.dropped, ["the counter", "the timer", "the hero prop"]);
  assert.ok(d.counter, "the director's own answer is not changed");
  const doc = channelDirection(d, loadChannel("documentary").devices);
  assert.equal(doc.direction.counter?.steps[0].bpm, undefined, "documentary keeps the counter without the pulse");
});

test("a channel's moods: a mood it does not use becomes its fallback", () => {
  const plan = { music: [{ start: "b1", mood: "epic" }, { start: "b3", mood: "documentary" }], beds: [], hits: [] };
  assert.deepEqual(channelSound(plan, loadChannel("what-if")).changed, []);
  const doc = channelSound(plan, loadChannel("documentary"));
  assert.deepEqual(doc.plan.music.map((m) => m.mood), ["documentary", "documentary"]);
  assert.equal(doc.changed.length, 1);
});

test("the natural length is the timeline's length when it is asked for exactly that", () => {
  const beats = ["b1", "b2", "b3"].map((id, i) => ({ id, say: "x", lines: [], see: "x", pace: (["quick", "normal", "linger"] as const)[i], stress: "" }));
  const lines: PlannedLine[] = [
    { id: "hook", beatId: "hook", who: "narrator", kind: "narration", text: "x", engine: "kitten2", voice: "Bruno", dur: 2.4, estimated: true },
    { id: "b1-n1", beatId: "b1", who: "narrator", kind: "narration", text: "x", engine: "kitten2", voice: "Bruno", dur: 3.1, estimated: true },
    { id: "b2-n1", beatId: "b2", who: "narrator", kind: "narration", text: "x", engine: "kitten2", voice: "Bruno", dur: 1.2, estimated: true },
  ];
  const natural = naturalLength({ beats, lines, format: "16:9" });
  const timeline = buildTimeline({ beats, lines, format: "16:9", target: natural, cap: 600, wps: 2.3 });
  assert.ok(Math.abs(timeline.duration - natural) < 0.1, `${timeline.duration} vs ${natural}`);
  assert.equal(timeline.reviseWords, 0);
});
