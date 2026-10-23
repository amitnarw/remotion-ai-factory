import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { applyEdits, beatOfEdit, EditError, parsePath } from "./edits";
import { sampleFilm } from "./testFilm";
import { openFilm, redoFilm, saveFilm, undoFilm } from "./store";

test("paths read ids, indexes and keys", () => {
  assert.deepEqual(parsePath("story.beats[b2].lines[0].text"), [{ key: "story" }, { key: "beats" }, { select: "b2" }, { key: "lines" }, { select: "0" }, { key: "text" }]);
  assert.throws(() => parsePath("story..beats"), EditError);
});

test("a text edit re-voices; a sound edit only re-assembles; nothing changes on failure", () => {
  const film = sampleFilm();
  const text = applyEdits(film, [{ op: "set", path: "story.beats[b2].say", value: "It is gone for good." }]);
  assert.equal(text.redo, "voice");
  assert.equal(text.film.story.beats[1].say, "It is gone for good.");
  assert.equal(film.story.beats[1].say, "And it never comes back.", "the original is untouched");

  const sound = applyEdits(film, [{ op: "set", path: "sound.hits[b2].sound", value: "whoosh" }]);
  assert.equal(sound.redo, "assemble");

  const pace = applyEdits(film, [{ op: "set", path: "story.beats[b1].pace", value: "quick" }]);
  assert.equal(pace.redo, "timeline");

  assert.throws(() => applyEdits(film, [{ op: "set", path: "story.beats[b1].pace", value: "slow" }]), /story\.beats\.0\.pace/);
  assert.throws(() => applyEdits(film, [{ op: "set", path: "story.beats[b9].say", value: "x" }]), /no entry "b9"; there are b1, b2/);
  assert.throws(() => applyEdits(film, [{ op: "set", path: "story.beats[b1].id", value: "b7" }]), /cannot be edited/);
  assert.throws(() => applyEdits(film, [{ op: "insert", path: "sound.hits", value: { beat: "b5", at: "start", sound: "boom" } }]), /"b5" is not a beat/);
  assert.throws(() => applyEdits(film, [{ op: "set", path: "story.beats[b2].lines[0].who", value: "Bob" }]), /not a character/);
});

test("lists: insert and remove entries", () => {
  const film = sampleFilm();
  const added = applyEdits(film, [{ op: "insert", path: "sound.hits", value: { beat: "b1", at: "end", sound: "splash" } }]);
  assert.equal(added.film.sound.hits.length, 2);
  const removed = applyEdits(film, [{ op: "remove", path: "sound.hits[0]" }]);
  assert.equal(removed.film.sound.hits.length, 0);
  // Beats themselves are structure (other stages point at them): no adding or removing.
  assert.throws(() => applyEdits(film, [{ op: "remove", path: "story.beats[b1]" }]), /cannot be (edited|added or removed)/);
});

test("beatOfEdit finds the beat an edit is about", () => {
  const film = sampleFilm();
  assert.equal(beatOfEdit(film, { op: "set", path: "story.beats[b2].say", value: "x" }), "b2");
  assert.equal(beatOfEdit(film, { op: "set", path: "sound.hits[0].sound", value: "x" }), "b2");
  assert.equal(beatOfEdit(film, { op: "insert", path: "sound.hits", value: { beat: "b1", at: "start", sound: "x" } }), "b1");
  assert.equal(beatOfEdit(film, { op: "set", path: "plan.settings.quality", value: "draft" }), null);
});

test("store: versions, undo, redo, and the stage files follow the current version", () => {
  const root = mkdtempSync(join(tmpdir(), "film-"));
  const id = "oceans";
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  const film = sampleFilm();
  for (const s of ["story", "direction", "sound", "plan"] as const) writeFileSync(join(dir, `${s}.json`), JSON.stringify(film[s]));

  assert.equal(openFilm(id, root).head.current, 1);
  const edited = applyEdits(film, [{ op: "set", path: "story.hook", value: "Imagine the sea just left." }]);
  const head = saveFilm(id, edited.film, { source: "user", summary: edited.summary, redo: edited.redo }, root);
  assert.equal(head.current, 2);
  const onDisk = () => JSON.parse(readFileSync(join(dir, "story.json"), "utf8")).hook;
  assert.equal(onDisk(), "Imagine the sea just left.");

  const undone = undoFilm(id, root)!;
  assert.equal(undone.head.current, 1);
  assert.equal(undone.redo, "voice");
  assert.equal(onDisk(), "What if the oceans vanished?");
  assert.equal(undoFilm(id, root), null, "nothing before v1");

  assert.equal(redoFilm(id, root)!.head.current, 2);
  assert.equal(onDisk(), "Imagine the sea just left.");

  // A new edit after an undo drops the undone version.
  undoFilm(id, root);
  const other = applyEdits(film, [{ op: "set", path: "sound.music[0].mood", value: "epic" }]);
  const after = saveFilm(id, other.film, { source: "ai", summary: other.summary, redo: other.redo }, root);
  assert.deepEqual(after.versions.map((v) => v.v), [1, 3]);
  assert.equal(redoFilm(id, root), null);
});
