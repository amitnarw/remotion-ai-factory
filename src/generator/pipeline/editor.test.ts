import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { sampleFilm } from "../film/testFilm";
import { askEditor, beatPaths, describeFilm, editProblem, wordLockProblem } from "./editor";
import { resetFixtureCounters, type RoleModel } from "./llm";

const models = { editor: { provider: "fixture", model: "fixture" } } as unknown as Record<string, RoleModel>;

test("a beat's edit paths cover its text, lines, shots and hits, and nothing else", () => {
  const p = beatPaths(sampleFilm(), "b2");
  assert.ok(p.set.includes("story.beats[b2].say"));
  assert.ok(p.set.includes("story.beats[b2].lines[0].text"));
  assert.ok(p.set.includes("direction.shots[0].size"));
  assert.ok(p.set.includes("sound.hits[0].sound"));
  assert.ok(!p.set.some((s) => s.includes("[b1]")), "no paths of another beat");
  assert.ok(p.remove.includes("sound.hits[0]"));
  assert.throws(() => beatPaths(sampleFilm(), "b9"), /no beat "b9"/);
});

test("the prompt view of one beat shows only that beat, with paths and allowed values", () => {
  const text = describeFilm(sampleFilm(), { kind: "beat", beat: "b2" });
  assert.ok(text.includes("story.beats[b2].say"));
  assert.ok(!text.includes("story.beats[b1].say"));
  assert.ok(/Shot size: ECU\|CU\|MS\|FS\|WS\|EWS/.test(text), "shot sizes come from the schema");
});

test("edits that break the plan or leave the beat are sent back with the reason", () => {
  const film = sampleFilm();
  assert.match(editProblem(film, { kind: "video" }, [{ op: "set", path: "story.beats[b1].pace", value: "slow" }])!, /pace/);
  assert.match(editProblem(film, { kind: "beat", beat: "b2" }, [{ op: "set", path: "story.beats[b1].say", value: "x" }])!, /Only change beat b2/);
  assert.equal(editProblem(film, { kind: "beat", beat: "b2" }, [{ op: "set", path: "sound.hits[0].sound", value: "whoosh" }]), null);
});

test("ask AI: an off-target first reply is re-asked; the second applies", async () => {
  const dir = mkdtempSync(join(tmpdir(), "editor-fx-"));
  writeFileSync(join(dir, "editor-1.txt"), JSON.stringify({ summary: "x", edits: [{ op: "set", path: "story.beats[b1].say", value: "Wrong beat." }] }));
  writeFileSync(
    join(dir, "editor-2.txt"),
    JSON.stringify({ summary: "Sharper line and a closer shot.", edits: [{ op: "set", path: "story.beats[b2].say", value: "And the sea never returns." }, { action: "update", target: "direction.shots[0].size", value: "CU" }] }),
  );
  process.env.FACTORY_LLM_FIXTURES = dir;
  resetFixtureCounters();
  try {
    const out = await askEditor({ film: sampleFilm(), target: { kind: "beat", beat: "b2" }, request: "make it more dramatic", models });
    assert.equal(out.result.film.story.beats[1].say, "And the sea never returns.");
    assert.equal(out.result.film.direction.shots[0].size, "CU", "near-miss keys (action/target) are understood");
    assert.equal(out.result.redo, "voice");
  } finally {
    delete process.env.FACTORY_LLM_FIXTURES;
  }
});

test("the word lock: the script's words change only to words the user typed", () => {
  const film = sampleFilm();
  const say = (value: string) => [{ op: "set" as const, path: "story.beats[b2].say", value }];
  assert.match(wordLockProblem(film, say("And the sea is gone for good."), "make it more dramatic")!, /not the user's words/);
  assert.equal(wordLockProblem(film, say("And the sea is gone for good."), 'say "And the sea is gone for good." here'), null, "quoted words may be used");
  assert.equal(wordLockProblem(film, say("And the sea is gone for good."), "And the sea is gone for good."), null, "with no quotes the whole request counts");
  assert.equal(wordLockProblem(film, [{ op: "set", path: "direction.shots[0].size", value: "CU" }], "closer"), null, "shots are free");
  assert.match(wordLockProblem(film, [{ op: "remove", path: "story.beats[b2].lines[0]" }], "drop Mia's line")!, /removes the script's words/);
  assert.match(wordLockProblem(film, [{ op: "set", path: "story.hook", value: "Where did the water go?" }], "a better hook")!, /the hook/);
  // A line given to another speaker needs that speaker named.
  const two = sampleFilm();
  two.story.characters.push({ name: "Leo", gender: "male", age: "adult", look: "" });
  const moved = [{ op: "set" as const, path: "story.beats[b2].lines[0].who", value: "Leo" }];
  assert.match(wordLockProblem(two, moved, "give it to the other one")!, /not the user's words/);
  assert.equal(wordLockProblem(two, moved, "Leo says that line"), null);
});

test("ask AI on an as-written run: a reply that rewrites the words is re-asked", async () => {
  const dir = mkdtempSync(join(tmpdir(), "editor-lock-"));
  writeFileSync(join(dir, "editor-1.txt"), JSON.stringify({ summary: "x", edits: [{ op: "set", path: "story.beats[b2].say", value: "The sea is gone, forever." }] }));
  writeFileSync(join(dir, "editor-2.txt"), JSON.stringify({ summary: "A closer shot.", edits: [{ op: "set", path: "direction.shots[0].size", value: "CU" }] }));
  process.env.FACTORY_LLM_FIXTURES = dir;
  resetFixtureCounters();
  try {
    const out = await askEditor({ film: sampleFilm(), target: { kind: "beat", beat: "b2" }, request: "make it more dramatic", models, lockWords: true });
    assert.equal(out.result.film.story.beats[1].say, "And it never comes back.", "the words are the script's");
    assert.equal(out.result.film.direction.shots[0].size, "CU");
  } finally {
    delete process.env.FACTORY_LLM_FIXTURES;
  }
});
