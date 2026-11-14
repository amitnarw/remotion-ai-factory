import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SceneSchema } from "../spec.schema";
import { actsOf, breakDownStory, crowdedBeats, mergeNeeds, needsFor, normalizeBreakdown, type Need } from "./breakdown";
import { resetFixtureCounters } from "./llm";
import type { WriterStory } from "./writer";

const models = { writer: { provider: "ollama", model: "fixture" } };

function fixtures(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "breakdown-fixtures-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

function story(beats: number): WriterStory {
  return {
    title: "Test story",
    hook: "What if?",
    mood: "tense",
    characters: [{ name: "Ana", gender: "female", age: "adult", look: "a red coat" }],
    beats: Array.from({ length: beats }, (_, i) => ({ id: `b${i + 1}`, say: `line ${i + 1}`, lines: [], see: `shot ${i + 1}`, pace: "normal" as const, stress: "" })),
  };
}

async function withFixtures<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  resetFixtureCounters();
  process.env.FACTORY_LLM_FIXTURES = dir;
  try {
    return await fn();
  } finally {
    delete process.env.FACTORY_LLM_FIXTURES;
    resetFixtureCounters();
  }
}

test("a messy breakdown reply becomes clean needs", () => {
  const ids = ["b1", "b2", "b3", "b4"];
  const out = normalizeBreakdown(
    {
      items: [
        { type: "Location", description: "a harbour at night", keywords: "harbour, night", in: "b1-b3", required: "yes" },
        { kind: "person", name: "Ana in a red coat", tags: ["Woman", "coat"], beats: [2, "beat 4"], character: "Ana", must: false, style: "red coat" },
        { kind: "sfx", what: "a door slams", words: ["door"], beats: ["b9"], must: true },
        { kind: "nonsense-kind", what: "something", words: ["x"], beats: ["b1"], must: true },
      ],
    },
    ids,
  ) as { needs: Array<Omit<Need, "id">> };
  assert.deepEqual(out.needs, [
    { kind: "set", what: "a harbour at night", words: ["harbour", "night"], beats: ["b1", "b2", "b3"], must: true },
    { kind: "character", what: "Ana in a red coat", words: ["woman", "coat"], beats: ["b2", "b4"], who: "Ana", must: false, look: "red coat" },
  ]);
});

test("the same kind and words make one need; ids follow the merged order", () => {
  const ids = ["b1", "b2", "b3", "b4"];
  const needs = mergeNeeds(
    [
      [
        { kind: "set", what: "a harbour", words: ["harbour", "night"], beats: ["b3"], must: false },
        { kind: "prop", what: "a lantern", words: ["lantern"], beats: ["b1"], must: true },
      ],
      [{ kind: "set", what: "the harbour again", words: ["night", "Harbour"], beats: ["b1"], must: true, fallback: "any port" }],
    ],
    ids,
  );
  assert.equal(needs.length, 2);
  assert.deepEqual(needs[0], { id: "n1", kind: "set", what: "a harbour", words: ["harbour", "night"], beats: ["b1", "b3"], must: true, fallback: "any port" });
  assert.equal(needs[1].id, "n2");
});

test("a beat that brings in too many new needs is a warning, never a cut", () => {
  const n = (i: number, beats: string[]): Need => ({ id: `n${i}`, kind: "prop", what: `thing ${i}`, words: [`w${i}`], beats, must: false });
  assert.deepEqual(crowdedBeats([n(1, ["b1", "b2"]), n(2, ["b1"]), n(3, ["b1"]), n(4, ["b1"])]), []);
  assert.deepEqual(crowdedBeats([1, 2, 3, 4, 5].map((i) => n(i, ["b2"]))), ["b2 brings in 5 new needs (about 3 per beat is the rule)"]);
});

test("a breakdown with no set is asked again", async () => {
  const noSet = '{"needs": [{"kind": "prop", "what": "a lantern", "words": ["lantern"], "beats": ["b1"], "must": true}]}';
  const good = '{"needs": [{"kind": "set", "what": "a harbour", "words": ["harbour"], "beats": ["b1", "b2"], "must": true}, {"kind": "prop", "what": "a lantern", "words": ["lantern"], "beats": ["b2"], "must": true}]}';
  const bd = await withFixtures(fixtures({ "breakdown-1.txt": noSet, "breakdown-2.txt": good }), () => breakDownStory({ story: story(3), models }));
  assert.deepEqual(bd.needs.map((x) => [x.id, x.kind]), [["n1", "set"], ["n2", "prop"]]);
  assert.equal(bd.calls, 1);
});

test("a long story is read one act at a time and merged", async () => {
  const long = story(30);
  assert.deepEqual(actsOf(long.beats).map((a) => a.length), [15, 15]);
  const act1 = '{"needs": [{"kind": "set", "what": "a harbour", "words": ["harbour"], "beats": ["b1", "b14"], "must": true}]}';
  // Act 2 names the same set again, a beat of act 1 (not its own) and a new need.
  const act2 = '{"needs": [{"kind": "set", "what": "the harbour", "words": ["harbour"], "beats": ["b20", "b3"], "must": false}, {"kind": "music", "what": "tense music", "words": ["tense"], "beats": ["b30"], "must": false}]}';
  const bd = await withFixtures(fixtures({ "breakdown-act-1-1.txt": act1, "breakdown-act-2-1.txt": act2 }), () => breakDownStory({ story: long, models }));
  assert.equal(bd.calls, 2);
  assert.deepEqual(bd.needs.map((x) => [x.id, x.kind, x.beats.join(" ")]), [["n1", "set", "b1 b14 b20"], ["n2", "music", "b30"]]);
});

test("the channel's allowed kinds keep other needs out", async () => {
  const reply = '{"needs": [{"kind": "set", "what": "a harbour", "words": ["harbour"], "beats": ["b1"], "must": true}, {"kind": "effect", "what": "bullet time", "words": ["bullet", "time"], "beats": ["b2"], "must": true}]}';
  const bd = await withFixtures(fixtures({ "breakdown-1.txt": reply }), () => breakDownStory({ story: story(3), models, allow: ["set", "music"] }));
  assert.deepEqual(bd.needs.map((x) => x.kind), ["set"]);
});

// The two fixture stories end to end (test-fixtures/breakdown/). They read the sound library, which only a
// machine that ran `npm run audio:library` has, so they skip elsewhere.
const FIXTURES = join(process.cwd(), "test-fixtures", "breakdown");
const haveLibrary = existsSync(join(process.cwd(), "public", "library", "audio-library.json"));

async function fixtureStory(name: string) {
  const dir = join(FIXTURES, name);
  const s = JSON.parse(readFileSync(join(dir, "story.json"), "utf8")) as WriterStory;
  const { breakdown, needs } = await withFixtures(dir, () => needsFor({ story: s, models }));
  return { breakdown, byId: new Map(needs.needs.map((m) => [m.id, m])), needs };
}

test("the doc's worked example: The keeper's last night (15-producer.md §3)", { skip: !haveLibrary && "no public/library/audio-library.json" }, async () => {
  const { breakdown, byId, needs } = await fixtureStory("keeper");
  assert.equal(breakdown.needs.length, 10);
  const want: Record<string, [string, string?]> = {
    n1: ["have", "model-set:landmark-lighthouse"],
    n2: ["close", "model:kenney-graveyard-kit-character-keeper"],
    n3: ["skip"],
    n4: ["have", "model:kaykit-halloween-bits-lantern-hanging"],
    n5: ["have", "weather:storm"],
    n6: ["close", "sound:ocean_ship_horn"],
    n7: ["have", "bed:ocean_waves"],
    n8: ["have", "music-mood:sad"],
    n9: ["close", "model:kenney-pirate-kit-ship-ghost"],
    n10: ["have", "camera-move:orbit_left"],
  };
  for (const [id, [status, use]] of Object.entries(want)) {
    const m = byId.get(id)!;
    assert.equal(m.status, status, `${id} ${m.what}`);
    if (use) assert.equal(m.use?.id, use, `${id} ${m.what}`);
  }
  assert.match(byId.get("n1")!.note ?? "", /landmark-lighthouse-cottage is in stock, but not as a model set/, "the CC-BY cottage can't be one yet");
  assert.equal(byId.get("n3")!.build?.id, "action-climb");
  assert.equal(byId.get("n6")!.then, "download");
  assert.ok(byId.get("n7")!.also?.includes("wind_city"));
  assert.match(byId.get("n8")!.note ?? "", /thin/);
  assert.ok(needs.needs.every((m) => m.judged === "model" || m.candidates.length === 0));
});

test("an action story: Last Delivery, with every kind of gap", { skip: !haveLibrary && "no public/library/audio-library.json" }, async () => {
  const { breakdown, byId } = await fixtureStory("rooftop");
  assert.equal(breakdown.needs.length, 17);
  assert.deepEqual(breakdown.warnings, []);
  const bulletBuilt = "bulletTime" in SceneSchema.shape;
  const want: Record<string, [string, string?]> = {
    n1: ["have", "place:rome"],
    n2: ["have", "place:paris"],
    n3: ["have", "model:polypizza-hoodie-character"],
    n4: ["have", "action:run"],
    n5: ["have", "action:jump"],
    n6: ["have", "action:punch"],
    n7: [bulletBuilt ? "have" : "build"],
    n8: ["have", "model:polypizza-police-car"],
    n9: ["download"],
    n10: ["have", "effect:explosion"],
    n11: ["close", "sound:city_siren"],
    n12: ["data"],
    n13: ["have", "bed:traffic"],
    n14: ["have", "music-mood:tense"],
    n15: ["have", "camera-style:handheld-urgency"],
    n16: ["have", "graphic:timer"],
    n17: ["build"],
  };
  for (const [id, [status, use]] of Object.entries(want)) {
    const m = byId.get(id)!;
    assert.equal(m.status, status, `${id} ${m.what}`);
    if (use) assert.equal(m.use?.id, use, `${id} ${m.what}`);
  }
  assert.match(byId.get("n1")!.note ?? "", /Rome shows Colosseum/);
  if (!bulletBuilt) assert.equal(byId.get("n7")!.build?.id, "camera-bullet-time");
  assert.deepEqual(byId.get("n9")!.download?.words, ["motorbike", "motorcycle"]);
  assert.match(byId.get("n12")!.data ?? "", /oga-100cc0-shot-01/);
  assert.equal(byId.get("n17")!.build?.id, "graphic-graphics-layer");
});
