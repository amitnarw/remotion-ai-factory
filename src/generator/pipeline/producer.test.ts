/**
 * The producer you talk to (P5), on recorded replies: notes of different
 * kinds each reach the stage they need, nothing changes before a confirm, and
 * each confirmed change can be undone. A finished plan of the money-doubles
 * replies, and a run waiting at its story gate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SettingsSchema } from "../spec.schema";
import { openFilm } from "../film/store";
import { resetFixtureCounters, type RoleModel } from "./llm";
import { readRun, runDir, setOutputDir } from "./manifest";
import { standingNotes } from "./notes";
import { confirm, conversation, discard, runPhase, say, undoLast } from "./producer";
import { resumePlan, runPlan, StoryGateStop } from "./run";
import type { WriterStory } from "./writer";

const out = mkdtempSync(join(tmpdir(), "producer-test-"));
setOutputDir(out);

const MONEY = join(process.cwd(), "test-fixtures", "pipeline", "money-doubles");
const audio = JSON.parse(readFileSync(join(MONEY, "audio.json"), "utf8"));
const settings = SettingsSchema.parse({ format: "9:16", targetDuration: 25 });
const fixture = { provider: "fixture", model: "fixture" };
const models = Object.fromEntries(["producer", "editor", "director", "sound", "writer", "matcher"].map((r) => [r, fixture])) as Record<string, RoleModel>;

/** The money-doubles replies, plus the producer's and the roles' replies to the notes. */
function fixtures(add: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "producer-fixtures-"));
  cpSync(MONEY, dir, { recursive: true });
  for (const [name, reply] of Object.entries(add)) writeFileSync(join(dir, name), typeof reply === "string" ? reply : JSON.stringify(reply));
  resetFixtureCounters();
  process.env.FACTORY_LLM_FIXTURES = dir;
  return dir;
}

function cleanup(id: string) {
  delete process.env.FACTORY_LLM_FIXTURES;
  rmSync(runDir(id), { recursive: true, force: true });
  rmSync(join(process.cwd(), "output", `${id}-voice`), { recursive: true, force: true });
  rmSync(join(process.cwd(), "output", `${id}-voice.json`), { force: true });
  rmSync(join(process.cwd(), "public", "voice", id), { recursive: true, force: true });
}

const director = readFileSync(join(MONEY, "director-1.txt"), "utf8");
const night = director.replace('{"start": "b1", "kit": "street-block", "time": "golden"', '{"start": "b1", "kit": "street-block", "time": "night"');

test("five notes on a finished plan: each reaches its stage, nothing changes before ok, and each is undone", async () => {
  const id = "fixture-test-producer";
  const requests = mkdtempSync(join(tmpdir(), "producer-requests-"));
  try {
    fixtures({
      "producer-1.txt": { reply: "I will restage scene 1 at night.", actions: [{ kind: "restage", note: "make it night", scenes: [1] }] },
      "director-2.txt": night,
      "producer-2.txt": { reply: "The intro will have no music.", actions: [{ kind: "resound", note: "no music in the intro" }] },
      "sound-2.txt": { music: [{ start: "b5", mood: "epic" }], beds: [{ start: "b1", end: "b5", sound: "street murmur", level: 0.5 }, { start: "b5", end: null, sound: "space_cosmic_wind", level: 0.4 }], hits: [{ beat: "b3", at: "start", sound: "coins" }, { beat: "b5", at: "start", sound: "whoosh" }] },
      "producer-3.txt": { reply: "A shorter hook.", actions: [{ kind: "edit", note: "make the hook shorter" }] },
      "editor-1.txt": { summary: "A shorter hook.", edits: [{ op: "set", path: "story.hook", value: "Your money doubles every three seconds." }] },
      "producer-4.txt": { reply: "The writer rewrites beat 2.", actions: [{ kind: "story", note: "make it funnier", beats: ["b2"] }] },
      "writer-notes-1.txt": { edits: [{ beat: "b2", say: "Three seconds later the coin has a twin, and it looks smug." }] },
      "producer-5.txt": { reply: "Noted for the rest of this video.", actions: [{ kind: "keep", note: "no dutch angles" }] },
      "producer-6.txt": { reply: "Bullet time on a coin is a new device; I can ask for it.", actions: [{ kind: "build", note: "bullet time on the falling coin", what: "bullet time on a falling coin" }] },
      "producer-7.txt": { reply: "It is about 25 seconds: seven beats, the voice sets the length.", actions: [{ kind: "question", note: "" }] },
    });
    await runPlan({ id, premise: "What if money doubled every 3 seconds?", settings, audio });
    assert.equal(runPhase(id), "plan");
    const root = join(runDir(id), "..");
    const o = { models, requestsDir: requests };
    const film = () => openFilm(id, root).film;
    const golden = film().direction.scenes.find((s) => s.start === "b1")!.time;

    // 1. restage: the director, for scene 1 only.
    const r1 = await say(id, "make scene 1 at night", o);
    assert.equal(r1.proposals.length, 1);
    assert.equal(r1.proposals[0].action, "restage");
    assert.ok(r1.proposals[0].changes.some((c) => /scene 1: .*golden.* -> .*night/.test(c)), r1.proposals[0].changes.join(" | "));
    assert.equal(film().direction.scenes[0].time, golden, "nothing changes before ok");
    const a1 = confirm(id, r1.proposals[0].id, o);
    assert.equal(film().direction.scenes.find((s) => s.start === "b1")!.time, "night");
    assert.equal(film().direction.scenes.find((s) => s.start === "b5")!.kit, "space", "scene 2 is as it was");
    assert.equal(a1.version, 2);

    // 2. resound: the sound designer, with the note.
    const r2 = await say(id, "no music in the intro", o);
    assert.equal(r2.proposals[0].action, "resound");
    confirm(id, r2.proposals[0].id, o);
    assert.deepEqual(film().sound.music.map((m) => m.start), ["b5"]);

    // 3. edit: the editor role on exact paths.
    const r3 = await say(id, "make the hook shorter", o);
    confirm(id, r3.proposals[0].id, o);
    assert.equal(film().story.hook, "Your money doubles every three seconds.");

    // 4. story: the writer rewrites the named beat.
    const r4 = await say(id, "make beat 2 funnier", o);
    assert.equal(r4.proposals[0].action, "story");
    confirm(id, r4.proposals[0].id, o);
    assert.match(film().story.beats[1].say, /looks smug/);

    // 5. keep: a standing note for the rest of the video.
    const r5 = await say(id, "no dutch angles from now on", o);
    confirm(id, r5.proposals[0].id, o);
    assert.deepEqual(standingNotes(id), ["no dutch angles"]);

    // 6. build: a build request, filed only on ok.
    const r6 = await say(id, "bullet time on the falling coin", o);
    assert.equal(readdirSync(requests).length, 0, "nothing filed before ok");
    confirm(id, r6.proposals[0].id, o);
    const filed = readdirSync(requests);
    assert.equal(filed.length, 1);
    assert.equal(JSON.parse(readFileSync(join(requests, filed[0]), "utf8")).asks[0].run, id);

    // 7. question: an answer, nothing changes.
    const r7 = await say(id, "why is it 25 seconds long?", o);
    assert.equal(r7.proposals.length, 0);
    assert.match(r7.reply, /seven beats/);

    // Undo, newest first: each change goes back.
    undoLast(id, o);
    assert.equal(readdirSync(requests).length, 0, "the request held only this ask, so it is gone");
    undoLast(id, o);
    assert.deepEqual(standingNotes(id), []);
    undoLast(id, o);
    assert.doesNotMatch(film().story.beats[1].say, /looks smug/);
    undoLast(id, o);
    assert.notEqual(film().story.hook, "Your money doubles every three seconds.");
    undoLast(id, o);
    assert.deepEqual(film().sound.music.map((m) => m.start), ["b1", "b5"]);
    undoLast(id, o);
    assert.equal(film().direction.scenes.find((s) => s.start === "b1")!.time, golden);
    assert.throws(() => undoLast(id, o), /nothing the producer did is left to undo/);
    const c = conversation(id);
    assert.equal(c.turns.filter((t) => t.kind === "user").length, 7);
    assert.ok(c.proposals.every((p) => p.state === "undone"));
  } finally {
    cleanup(id);
  }
});

test("at the story gate: a story note rewrites story.json (the gate asks again), a scene note waits for the director", async () => {
  const id = "fixture-test-producer-gate";
  try {
    fixtures({
      "producer-1.txt": { reply: "The writer rewrites beat 2, and the director will stage the plaza at night.", actions: [{ kind: "story", note: "sadder", beats: ["b2"] }, { kind: "restage", note: "the first scene at night" }] },
      "writer-notes-1.txt": { edits: [{ beat: "b2", say: "Three seconds later there are two, and nobody smiles." }] },
      "producer-2.txt": { reply: "Thrown away.", actions: [{ kind: "keep", note: "only close-ups" }] },
    });
    const stop = await runPlan({ id, premise: "What if money doubled every 3 seconds?", settings, audio, storyGate: true }).catch((e: unknown) => e);
    assert.ok(stop instanceof StoryGateStop);
    assert.equal(runPhase(id), "story");
    const r = await say(id, "make beat 2 sadder, and the first scene at night", { models });
    assert.deepEqual(r.proposals.map((p) => p.action), ["story", "keep"]);
    for (const p of r.proposals) confirm(id, p.id, { models });
    const story = JSON.parse(readFileSync(join(runDir(id), "story.json"), "utf8")) as WriterStory;
    assert.match(story.beats[1].say, /nobody smiles/);
    assert.deepEqual(standingNotes(id), ["the first scene at night"]);
    // A proposal turned down changes nothing.
    const r2 = await say(id, "only close-ups", { models });
    discard(id, r2.proposals[0].id);
    assert.throws(() => confirm(id, r2.proposals[0].id, { models }), /discarded already/);
    assert.deepEqual(standingNotes(id), ["the first scene at night"]);
    // The edited story is approved and planned on: the director gets the standing note.
    await resumePlan(id, { approveStory: true });
    const run = readRun(id)!;
    assert.equal(run.stages.assemble.state, "done");
    assert.ok(existsSync(join(runDir(id), "notes.jsonl")));
    assert.match(JSON.parse(readFileSync(join(runDir(id), "story.json"), "utf8")).beats[1].say, /nobody smiles/, "the approved story is the edited one");
  } finally {
    cleanup(id);
  }
});
