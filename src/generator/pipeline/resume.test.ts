/**
 * Runs that stop and resume (producer phase P1), on the recorded
 * money-doubles replies. A resume is given fixtures with no writer replies
 * at all, so any writer call fails the test ("fixture missing").
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadChannel } from "../ai/channels";
import { SettingsSchema, validateSpec } from "../spec.schema";
import { checkerPrompt } from "./checker";
import { resetFixtureCounters } from "./llm";
import { isComplete, nextStage, readRun, runDir, setOutputDir, stableHash } from "./manifest";
import { resumePlan, runPlan, StoryGateStop } from "./run";
import type { WriterStory } from "./writer";

const SRC = join(process.cwd(), "test-fixtures", "pipeline", "money-doubles");
const audio = JSON.parse(readFileSync(join(SRC, "audio.json"), "utf8"));
const premise = "What if money doubled every 3 seconds?";
const settings = SettingsSchema.parse({ format: "9:16", targetDuration: 25 });

// The run folders go to a temp folder, not output/.
setOutputDir(mkdtempSync(join(tmpdir(), "resume-test-")));

/** A copy of the money-doubles replies: some files left out, some added. */
function fixtures(opts: { without?: string[]; add?: Record<string, string> } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "resume-fixtures-"));
  cpSync(SRC, dir, { recursive: true });
  for (const f of readdirSync(dir)) if (opts.without?.some((p) => f.startsWith(p))) rmSync(join(dir, f));
  for (const [name, text] of Object.entries(opts.add ?? {})) writeFileSync(join(dir, name), text);
  return dir;
}

function replay(dir: string) {
  resetFixtureCounters();
  process.env.FACTORY_LLM_FIXTURES = dir;
}

/** The run's folder, and the voice files the plan published for it (tts.ts keeps them under output/ and public/). */
function cleanup(...ids: string[]) {
  delete process.env.FACTORY_LLM_FIXTURES;
  for (const id of ids) {
    rmSync(runDir(id), { recursive: true, force: true });
    rmSync(join(process.cwd(), "output", `${id}-voice`), { recursive: true, force: true });
    rmSync(join(process.cwd(), "output", `${id}-voice.json`), { force: true });
    rmSync(join(process.cwd(), "public", "voice", id), { recursive: true, force: true });
  }
}

const isGateStop = (id: string) => (e: unknown) => e instanceof StoryGateStop && e.id === id && e.story.beats.length > 0;

test("the story gate stops after the story; approving it plans the rest with no writer call", async () => {
  const id = "fixture-test-gate";
  try {
    replay(SRC);
    await assert.rejects(runPlan({ id, premise, settings, audio, storyGate: true }), isGateStop(id));
    const stopped = readRun(id)!;
    assert.equal(stopped.stages.story.state, "done");
    assert.equal(stopped.stages.voice.state, "done");
    assert.equal(stopped.stages.director.state, "waiting");
    assert.equal(stopped.gates.story.state, "waiting");
    assert.equal(stopped.stages.story.model, "fixtures", "recorded replies are named as such");
    for (const f of ["brief", "run", "story", "voice", "timeline"]) assert.ok(existsSync(join(runDir(id), `${f}.json`)), `${f}.json saved`);
    assert.ok(!existsSync(join(runDir(id), "direction.json")), "nothing past the gate is planned");

    replay(fixtures({ without: ["writer"] }));
    const { spec, report } = await resumePlan(id, { approveStory: true });
    assert.doesNotThrow(() => validateSpec(spec));
    assert.equal(report.revised, true, "the story stage's revise is still reported");
    const done = readRun(id)!;
    assert.ok(isComplete(done));
    assert.equal(done.stages.critic.state, "skipped");
    assert.equal(done.gates.story.state, "approved");
    assert.equal(done.gates.story.storyHash, stableHash(JSON.parse(readFileSync(join(runDir(id), "story.json"), "utf8"))));
    await assert.rejects(resumePlan(id), /complete/, "a complete plan belongs to the editor");
  } finally {
    cleanup(id);
  }
});

test("a run killed in the director stage resumes there, with no writer call", async () => {
  const id = "fixture-test-director-crash";
  const broken = { "director-1.txt": "the model timed out", "director-2.txt": "still nothing", "director-3.txt": "no JSON here" };
  try {
    replay(fixtures({ add: broken }));
    await assert.rejects(runPlan({ id, premise, settings, audio }), /director: no usable reply/);
    const failed = readRun(id)!;
    assert.equal(failed.stages.story.state, "done");
    assert.equal(failed.stages.voice.state, "done");
    assert.equal(failed.stages.director.state, "failed");
    assert.match(failed.stages.director.error ?? "", /no usable reply/);
    assert.equal(nextStage(failed), "director");
    const story = readFileSync(join(runDir(id), "story.json"), "utf8");

    replay(fixtures({ without: ["writer"] }));
    const { spec } = await resumePlan(id);
    assert.doesNotThrow(() => validateSpec(spec));
    assert.equal(readFileSync(join(runDir(id), "story.json"), "utf8"), story, "the story is the one written before the crash");
    assert.ok(isComplete(readRun(id)!));
  } finally {
    cleanup(id);
  }
});

test("a story edited at the gate is timed again and approved as it is on disk", async () => {
  const id = "fixture-test-gate-edit";
  try {
    replay(SRC);
    await assert.rejects(runPlan({ id, premise, settings, audio, storyGate: true }), isGateStop(id));
    const before = readRun(id)!.stages.voice.inputHash;
    const file = join(runDir(id), "story.json");
    const story = JSON.parse(readFileSync(file, "utf8")) as WriterStory;
    story.beats[0].say = "One coin. That is how it starts.";
    writeFileSync(file, JSON.stringify(story, null, 2));

    replay(fixtures({ without: ["writer"] }));
    const { spec } = await resumePlan(id, { approveStory: true });
    const after = readRun(id)!;
    assert.notEqual(after.stages.voice.inputHash, before, "the voice is timed again for the new words");
    assert.equal(after.gates.story.storyHash, stableHash(story));
    assert.equal(spec.story?.beats[0].say, "One coin. That is how it starts.");
  } finally {
    cleanup(id);
  }
});

test("a resume without approval stops at the gate again", async () => {
  const id = "fixture-test-gate-again";
  try {
    replay(SRC);
    await assert.rejects(runPlan({ id, premise, settings, audio, storyGate: true }), isGateStop(id));
    replay(fixtures({ without: ["writer", "director", "sound"] }));
    await assert.rejects(resumePlan(id), isGateStop(id), "the kept story still waits for approval");
    // Turning the gate off for the run plans on without asking.
    replay(fixtures({ without: ["writer"] }));
    await resumePlan(id, { storyGate: false });
    assert.equal(readRun(id)!.gates.story.state, "off");
  } finally {
    cleanup(id);
  }
});

test("an approved story is locked: the critic's notes are kept as proposals", async () => {
  const id = "fixture-test-critic-locked";
  const notes = {
    "critic-1.txt": '{"issues":[{"beat":"b6","problem":"repeats b5","fix":"show the shops instead"}]}',
    "writer-notes-1.txt": '{"edits":[{"beat":"b6","say":"Shop prices flip faster than you can read."}]}',
  };
  const critic = SettingsSchema.parse({ format: "9:16", targetDuration: 25, critic: true });
  try {
    replay(fixtures({ add: notes }));
    await assert.rejects(runPlan({ id, premise, settings: critic, audio, storyGate: true }), isGateStop(id));
    const approved = JSON.parse(readFileSync(join(runDir(id), "story.json"), "utf8")) as WriterStory;
    replay(fixtures({ without: ["writer"], add: { "critic-1.txt": notes["critic-1.txt"] } }));
    const { spec, report } = await resumePlan(id, { approveStory: true });
    assert.equal(spec.story?.beats[5].say, approved.beats[5].say, "the approved words stay");
    assert.ok(report.warnings.some((w) => /kept as proposals/.test(w)), report.warnings.join(" | "));
    const run = readRun(id)!;
    assert.equal(run.stages.critic.facts?.applied, false);
    assert.equal(JSON.parse(readFileSync(join(runDir(id), "critique.json"), "utf8"))[0].beat, "b6");
  } finally {
    cleanup(id);
  }
});

test("with no gate the critic's notes are applied as before, and a resume keeps the plan", async () => {
  const id = "fixture-test-critic-applied";
  const critic = SettingsSchema.parse({ format: "9:16", targetDuration: 25, critic: true });
  try {
    replay(
      fixtures({
        add: {
          "critic-1.txt": '{"issues":[{"beat":"b6","problem":"repeats b5","fix":"show the shops instead"}]}',
          "writer-notes-1.txt": '{"edits":[{"beat":"b6","say":"Shop prices flip faster than you can read."}]}',
        },
      }),
    );
    const { spec } = await runPlan({ id, premise, settings: critic, audio });
    assert.equal(spec.story?.beats[5].say, "Shop prices flip faster than you can read.");
    const run = readRun(id)!;
    // The noted story is what the kept stages now stand for, so nothing is stale.
    run.stages.assemble.state = "waiting";
    writeFileSync(join(runDir(id), "run.json"), JSON.stringify(run, null, 2));
    replay(fixtures({ without: ["writer", "director", "sound", "critic"] }));
    const again = await resumePlan(id);
    assert.equal(again.spec.story?.beats[5].say, "Shop prices flip faster than you can read.");
  } finally {
    cleanup(id);
  }
});

test("a new run can reuse an earlier run's approved story, with no writer call and no second stop", async () => {
  const from = "fixture-test-reuse-from";
  const id = "fixture-test-reuse-to";
  try {
    replay(SRC);
    await assert.rejects(runPlan({ id: from, premise, settings, audio, storyGate: true }), isGateStop(from));
    replay(fixtures({ without: ["writer"] }));
    await resumePlan(from, { approveStory: true });

    replay(fixtures({ without: ["writer"] }));
    const { spec } = await runPlan({ id, premise, settings, audio, storyGate: true, storyFrom: from });
    assert.doesNotThrow(() => validateSpec(spec));
    assert.equal(readFileSync(join(runDir(id), "story.json"), "utf8"), readFileSync(join(runDir(from), "story.json"), "utf8"));
    const run = readRun(id)!;
    assert.equal(run.gates.story.state, "approved");
    assert.equal(run.stages.story.facts?.reusedFrom, from);
  } finally {
    cleanup(from, id);
  }
});

test("the claims check runs after the story when a claims reply is recorded, and its claims reach the story gate", async () => {
  const id = "fixture-test-claims";
  try {
    // One beat states a date, so the check finds a claim; the critic's model judges it (claims-1.txt).
    const writer = readFileSync(join(SRC, "writer-1.txt"), "utf8").replace("It starts with one coin on a café table.", "It starts with one coin, minted in 1971, on a café table.");
    const claims = JSON.stringify({ claims: [{ id: "c1", claim: "the coin was minted in 1971", verdict: "speculative", framed: false, reword: "It starts with one old coin on a café table." }] });
    replay(fixtures({ add: { "writer-1.txt": writer, "claims-1.txt": claims } }));
    const stop = await runPlan({ id, premise, settings, audio, storyGate: true }).then(
      () => assert.fail("the story gate should stop the plan"),
      (e: unknown) => e as StoryGateStop,
    );
    assert.ok(stop instanceof StoryGateStop);
    const run = readRun(id)!;
    assert.equal(run.stages.claims.state, "done");
    assert.ok(existsSync(join(runDir(id), "story.claims.json")));
    assert.equal(stop.claims?.policy, "note", "what-if only lists its claims");
    assert.deepEqual(stop.claims?.claims.map((c) => [c.id, c.verdict, c.flagged]), [["c1", "speculative", true]]);
    assert.match(JSON.parse(readFileSync(join(runDir(id), "story.json"), "utf8")).beats[0].say, /1971/, "a what-if story is not rewritten");
  } finally {
    cleanup(id);
  }
});

test("when the claims check ran, the story checker leaves the claims out, so the gate lists them once", async () => {
  const id = "fixture-test-claims-once";
  try {
    const writer = readFileSync(join(SRC, "writer-1.txt"), "utf8").replace("It starts with one coin on a café table.", "It starts with one coin, minted in 1971, on a café table.");
    const claims = JSON.stringify({ claims: [{ id: "c1", claim: "the coin was minted in 1971", verdict: "speculative", framed: false, reword: "It starts with one old coin on a café table." }] });
    // A reply that still lists a claim: it is not taken.
    const checker = JSON.stringify({ notes: [{ beat: "b2", note: "Let the second coin appear on screen." }], claims: [{ beat: "b1", claim: "the coin was minted in 1971", status: "check" }] });
    replay(fixtures({ add: { "writer-1.txt": writer, "claims-1.txt": claims, "checker-1.txt": checker } }));
    const stop = await runPlan({ id, premise, settings, audio, storyGate: true }).then(
      () => assert.fail("the story gate should stop the plan"),
      (e: unknown) => e as StoryGateStop,
    );
    assert.ok(stop instanceof StoryGateStop);
    assert.equal(readRun(id)!.stages.check.state, "done");
    assert.deepEqual(stop.check?.notes.map((n) => n.beat), ["b2"]);
    assert.deepEqual(stop.check?.claims, [], "the claims check judged them");
    assert.deepEqual(stop.claims?.claims.map((c) => c.id), ["c1"]);

    const story = JSON.parse(readFileSync(join(runDir(id), "story.json"), "utf8")) as WriterStory;
    const profile = loadChannel("what-if");
    const asked = checkerPrompt(story, profile, "premise", undefined, { claims: false });
    assert.ok(!/claims/i.test(asked), "the prompt asks for no claims");
    assert.equal(checkerPrompt(story, profile, "premise", undefined, { claims: true }), checkerPrompt(story, profile, "premise"), "without a claims check the prompt is the one of before");
    assert.match(checkerPrompt(story, profile, "premise"), /"claims": only statements presented as real-world fact/);
  } finally {
    cleanup(id);
  }
});
