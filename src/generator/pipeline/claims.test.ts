import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadChannel } from "../ai/channels";
import { claimsInputs, claimsPolicy, claimsPrompt, claimsStage, findClaims, formatClaims, sentences } from "./claims";
import { resetFixtureCounters, setModelAsker } from "./llm";
import { stableHash } from "./manifest";
import type { WriterStory } from "./writer";

const FIX = join(process.cwd(), "test-fixtures", "claims");
const models = { writer: { provider: "ollama", model: "fixture" }, critic: { provider: "ollama", model: "fixture" } };
const story = (name: string): WriterStory => JSON.parse(readFileSync(join(FIX, name, "story.json"), "utf8"));
const documentary = loadChannel("documentary");
const whatIf = loadChannel("what-if");

/** Recorded replies from `dir`; any real model call fails the test. */
async function withReplies<T>(dir: string | null, fn: () => Promise<T>): Promise<T> {
  resetFixtureCounters();
  if (dir) process.env.FACTORY_LLM_FIXTURES = dir;
  else delete process.env.FACTORY_LLM_FIXTURES;
  setModelAsker(async () => {
    throw new Error("no model call expected");
  });
  try {
    return await fn();
  } finally {
    delete process.env.FACTORY_LLM_FIXTURES;
    setModelAsker();
    resetFixtureCounters();
  }
}

test("the policy comes from the channel's id or genre: documentary strict, what-if notes, drama and action skip", () => {
  assert.equal(claimsPolicy(documentary), "strict");
  assert.equal(claimsPolicy(whatIf), "note");
  assert.equal(claimsPolicy(loadChannel("drama")), "skip");
  assert.equal(claimsPolicy(loadChannel("action")), "skip");
  // A channel copied from another keeps its genre, so it keeps its policy.
  assert.equal(claimsPolicy({ id: "my-history", genre: "documentary" }), "strict");
  assert.equal(claimsPolicy({ id: "science-explainer", genre: "explainer" }), "note");
});

test("code finds the sentences with figures, dates, records, authorities and named things, and nothing else", () => {
  const found = findClaims(story("documentary"));
  assert.deepEqual(
    found.map((c) => [c.id, c.beat, c.sentence]),
    [
      ["c1", "hook", "The Eiffel Tower grows 15 centimetres every summer."],
      ["c2", "b1", "Gustave Eiffel's company built it in just over two years, for the 1889 World's Fair."],
      ["c3", "b2", "Scientists say iron towers will outlast stone ones by 400 years."],
      ["c4", "b3", "Every seven years, sixty tonnes of paint are brushed on by hand."],
      ["c5", "b4", "It was the tallest structure in the world until 1930."],
      ["c6", "b5", "More than 300 million people have visited it."],
    ],
  );
  assert.deepEqual(found[2].markers, ["figure", "authority"]);
  assert.deepEqual(found[5].where, { line: 0 });
  // b4's second sentence and b5's narration state nothing specific.
  assert.ok(!found.some((c) => /symbol of Paris|how long it will stand/.test(c.sentence)));
  // The story's own characters are not real people.
  const w = findClaims(story("what-if"));
  assert.ok(!w.some((c) => /Sophie/.test(c.sentence)));
  assert.ok(w.some((c) => c.beat === "b4" && c.markers.includes("authority")));
  // Named real people by title, and named things inside a sentence.
  const named = (say: string) => findClaims({ ...story("what-if"), hook: "x", beats: [{ ...story("what-if").beats[1], say, lines: [] }] }).map((c) => c.markers);
  assert.deepEqual(named("Then President Lincoln walks in."), [["person"]]);
  assert.deepEqual(named("It looks like the Golden Gate Bridge."), [["name"]]);
  assert.deepEqual(named("The croissant smells good."), []);
});

test("sentences do not end at a decimal point or an abbreviation", () => {
  assert.deepEqual(sentences(`It costs 3.5 euros. Dr. Smith said so! Then "Why?" she asks.`), ["It costs 3.5 euros.", "Dr. Smith said so!", `Then "Why?" she asks.`]);
});

test("the judge's prompt lists each sentence with its beat, and frames speculation by the channel", () => {
  const s = story("what-if");
  const p = claimsPrompt(findClaims(s), s, whatIf, "note");
  assert.match(p, /c4 \(b4\): "Scientists say a human brain cannot count past 4 billion\."/);
  assert.match(p, /imagines a what-if/);
  assert.doesNotMatch(claimsPrompt(findClaims(s), s, documentary, "strict"), /imagines a what-if/);
});

test("what-if only notes: a claim needing a source is listed with a rewording, and the story is unchanged", async () => {
  const s = story("what-if");
  const got = await withReplies(join(FIX, "what-if"), () => claimsStage({ story: s, profile: whatIf, models, rewrite: true }));
  assert.equal(got.story, s);
  assert.ok(got.check);
  assert.equal(got.check.policy, "note");
  // c2 is the story's own invented detail ("none"), so it is dropped.
  assert.deepEqual(got.check.claims.map((c) => [c.id, c.verdict, c.flagged]), [["c1", "speculative", false], ["c3", "speculative", false], ["c4", "source", true]]);
  assert.equal(got.check.flagged, 1);
  assert.equal(got.check.claims[2].reword, "Nobody could count that high in one lifetime.");
  assert.equal(got.check.fixed, undefined);
  assert.equal(got.warnings.length, 1);
  assert.match(got.warnings[0], /1 claim\(s\) may need a source or a what-if framing: b4/);
  const lines = formatClaims(got.check);
  assert.equal(lines[0], `Claim in b4 (needs a source): "Scientists say a human brain cannot count past 4 billion."`);
  assert.equal(lines[1], `  suggested: "Nobody could count that high in one lifetime."`);
  assert.match(lines[2], /^Fine as told \(2\): hook part of the what-if/);
});

test("when nothing is flagged nothing changes: the same story and no warning", async () => {
  const full = story("what-if");
  const s = { ...full, beats: full.beats.filter((b) => b.id !== "b4") };
  const got = await withReplies(join(FIX, "what-if-clean"), () => claimsStage({ story: s, profile: whatIf, models, rewrite: true }));
  assert.equal(got.story, s);
  assert.equal(got.check?.flagged, 0);
  assert.deepEqual(got.warnings, []);
});

test("documentary is strict: the writer rewrites only the flagged sentences, once, and code puts them in place", async () => {
  const s = story("documentary");
  const got = await withReplies(join(FIX, "documentary"), () => claimsStage({ story: s, profile: documentary, models, rewrite: true }));
  const c = got.check!;
  assert.deepEqual(c.claims.filter((r) => r.flagged).map((r) => r.id), ["c3", "c6"]);
  assert.deepEqual(c.fixed?.beats, ["b2", "b5"]);
  assert.equal(c.fixed?.story, stableHash(got.story));
  assert.equal(got.story.beats[1].say, "Iron lasts only as long as its paint; left bare, it rusts long before stone wears away.");
  assert.equal(got.story.beats[4].lines[0].text, "Hundreds of millions of people have climbed it since it opened.");
  // Everything else is word for word the same.
  assert.equal(got.story.hook, s.hook);
  assert.equal(got.story.beats[4].say, s.beats[4].say);
  for (const i of [0, 2, 3]) assert.deepEqual(got.story.beats[i], s.beats[i]);
  assert.equal(c.claims.find((r) => r.id === "c3")?.rewritten, got.story.beats[1].say);
  assert.match(got.warnings[0], /the writer reworded 2 claim\(s\)/);
  const lines = formatClaims(c);
  assert.ok(lines.includes(`  the writer changed it to: "${got.story.beats[1].say}"`));

  // The story the stage fixed comes back on a resume: kept as it is, with no call and no second fix.
  const again = await withReplies(null, () => claimsStage({ story: got.story, profile: documentary, models, rewrite: true, previous: c }));
  assert.equal(again.check, c);
  assert.equal(again.story, got.story);
});

test("a story that may not change (approved, or the user's script) is only listed, with no writer call", async () => {
  const dir = mkdtempSync(join(tmpdir(), "claims-"));
  copyFileSync(join(FIX, "documentary", "claims-1.txt"), join(dir, "claims-1.txt"));
  const s = story("documentary");
  const got = await withReplies(dir, () => claimsStage({ story: s, profile: documentary, models, rewrite: false }));
  assert.equal(got.story, s);
  assert.equal(got.check?.flagged, 2);
  assert.equal(got.check?.fixed, undefined);
  assert.match(got.warnings[0], /2 claim\(s\) need a source/);
});

test("drama and action make no call, and neither does a story with nothing specific in it", async () => {
  for (const id of ["drama", "action"]) {
    const got = await withReplies(null, () => claimsStage({ story: story("documentary"), profile: loadChannel(id), models, rewrite: true }));
    assert.equal(got.check, null);
    assert.deepEqual(got.warnings, []);
  }
  const plain: WriterStory = { ...story("what-if"), hook: "What if bread were free?", beats: [{ ...story("what-if").beats[1], say: "The baker smiles.", lines: [] }] };
  const got = await withReplies(null, () => claimsStage({ story: plain, profile: whatIf, models, rewrite: true }));
  assert.deepEqual(got.check?.claims, []);
  assert.deepEqual(got.warnings, []);
});

test("the stage's inputs change with the story and the channel's words", () => {
  const s = story("what-if");
  assert.equal(stableHash(claimsInputs(s, whatIf)), stableHash(claimsInputs(structuredClone(s), whatIf)));
  assert.notEqual(stableHash(claimsInputs(s, whatIf)), stableHash(claimsInputs(s, documentary)));
  assert.notEqual(stableHash(claimsInputs(s, whatIf)), stableHash(claimsInputs({ ...s, hook: "What if?" }, whatIf)));
});
