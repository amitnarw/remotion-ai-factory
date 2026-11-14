import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join } from "path";
import { checkWords, normalizeWords, parseScript, scriptBeats, scriptPremise, scriptSpeakers, scriptSpoken, storySpoken } from "./script";
import type { WriterStory } from "./writer";

const KEEPER = readFileSync(join(process.cwd(), "test-fixtures", "pipeline", "keeper-as-written", "script.txt"), "utf8");

test("a script is read into narration, characters' lines, directions and act breaks", () => {
  const parsed = parseScript(KEEPER);
  assert.equal(parsed.title, "The Keeper's Last Night");
  assert.deepEqual(
    parsed.blocks.map((b) => b.kind),
    ["say", "see", "say", "line", "line", "break", "see", "say", "line"],
  );
  assert.deepEqual(scriptSpeakers(parsed), ["Mara", "Tom"], "a screenplay's MARA is Mara");
  const line = parsed.blocks.find((b) => b.kind === "line");
  assert.deepEqual(line, { kind: "line", who: "Mara", text: "Dad, come down. The boat can wait." });
});

test("directions inside a paragraph or a line are never spoken", () => {
  const parsed = parseScript("She ran [close on her feet] to the door.\n\nAna: (whispering) Is anyone there?");
  assert.deepEqual(scriptSpoken(parsed), [
    { who: "narrator", text: "She ran to the door." },
    { who: "Ana", text: "Is anyone there?" },
  ]);
  assert.deepEqual(parsed.blocks.filter((b) => b.kind === "see").map((b) => (b as { text: string }).text), ["close on her feet", "whispering"]);
  assert.equal(parseScript("Rule one: never stop.").blocks[0].kind, "say", "a lower-case word before a colon is narration");
});

test("beats: a paragraph starts one, lines join it, a direction belongs to the beat after it", () => {
  const { hook, hookVoiced, beats } = scriptBeats(parseScript(KEEPER), 18);
  assert.equal(hook, "The keeper had kept the light for forty years.", "the first sentence is the hook, read aloud");
  assert.equal(hookVoiced, true);
  assert.equal(beats.length, 3);
  assert.equal(beats[0].say, "Tonight the storm came early, and the lamp was failing.");
  assert.equal(beats[0].see, "", "no direction given");
  assert.equal(beats[1].see, "A lighthouse on a rocky coast, waves breaking, a stormy night");
  assert.equal(beats[1].lines.length, 2);
  assert.equal(beats[2].see, "The lamp room, rain running down the glass", "the act break ends beat 2");
  assert.deepEqual(beats.map((b) => b.id), ["b1", "b2", "b3"]);
});

test("a long paragraph is split at sentence ends; a script that opens with dialogue has a silent hook", () => {
  const long = Array.from({ length: 6 }, (_, i) => `Sentence number ${i + 1} has six words.`).join(" ");
  const { beats } = scriptBeats(parseScript(`Intro line here.\n\n${long}`), 12);
  assert.ok(beats.length >= 3, `split into ${beats.length} beats`);
  assert.ok(beats.every((b) => b.say.split(" ").length <= 12));
  const opens = scriptBeats(parseScript("# A Title\n\nTOM: Hello there.\n\nThe rest is narration."), 18);
  assert.equal(opens.hook, "A Title");
  assert.equal(opens.hookVoiced, false);
  assert.equal(opens.beats[0].lines[0].text, "Hello there.");
});

test("the word check passes the script's own words and names the first change", () => {
  const parsed = parseScript(KEEPER);
  const { hook, beats } = scriptBeats(parsed, 18);
  const story: WriterStory = { title: "T", hook, mood: "sad", characters: [], beats: beats.map((b) => ({ ...b, pace: "normal" as const, stress: "" })) };
  assert.equal(checkWords(story, parsed), null);
  assert.equal(storySpoken(story)[0].text, hook);

  const changed = structuredClone(story);
  changed.beats[1].say = "He climbed the old stairs one last time. His knees ached on every step.";
  assert.match(checkWords(changed, parsed) ?? "", /the script has narrator: "stairs", the story narrator: "old"/);

  const moved = structuredClone(story);
  moved.beats[1].lines[1].who = "Mara";
  assert.match(checkWords(moved, parsed) ?? "", /Tom/, "a line given to another character is a change");

  const quotes = structuredClone(story);
  quotes.beats[1].lines[0].text = "Dad,  come down.   The boat can wait.";
  assert.equal(checkWords(quotes, parsed), null, "spacing is forgiven");
  assert.equal(normalizeWords("“Run,” she said’s"), "\"Run,\" she said's");
});

test("a script's premise is its title, else its first sentence", () => {
  assert.equal(scriptPremise(KEEPER), "The Keeper's Last Night");
  assert.equal(scriptPremise("The rain stopped. Then it started again."), "The rain stopped.");
});
