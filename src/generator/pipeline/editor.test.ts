import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { sampleFilm } from "../film/testFilm";
import { askEditor, beatPaths, checkEdits, describeFilm } from "./editor";
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
  assert.match(checkEdits(film, { kind: "video" }, [{ op: "set", path: "story.beats[b1].pace", value: "slow" }])!, /pace/);
  assert.match(checkEdits(film, { kind: "beat", beat: "b2" }, [{ op: "set", path: "story.beats[b1].say", value: "x" }])!, /Only change beat b2/);
  assert.equal(checkEdits(film, { kind: "beat", beat: "b2" }, [{ op: "set", path: "sound.hits[0].sound", value: "whoosh" }]), null);
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
