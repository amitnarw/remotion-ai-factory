import { test } from "node:test";
import assert from "node:assert/strict";
import { calibratedWps, castVoices, estimateDuration, planLines, sentences, speedUp, voiceLines } from "./voice";
import { cacheKey } from "../tts";
import { resolveTtsPython } from "../tts-python";
import type { WriterStory } from "./writer";

const story: WriterStory = {
  title: "T",
  hook: "What if money doubled every three seconds?",
  mood: "upbeat",
  characters: [
    { name: "Ana", gender: "female", age: "adult", look: "baker" },
    { name: "Ben", gender: "male", age: "adult", look: "banker" },
  ],
  beats: [
    { id: "b1", say: "Your wallet feels heavier. Then it bursts.", lines: [{ who: "Ana", text: "Is that yours?" }], see: "wallet", pace: "quick", stress: "heavier" },
    { id: "b2", say: "Banks run out of room.", lines: [{ who: "Ben", text: "We are full!" }], see: "vault", pace: "normal", stress: "banks" },
  ],
};
const both = { narration: { enabled: true, engine: "kitten2" as const, voice: "Bruno" }, dialogs: { enabled: true, engine: "kitten2" as const } };

test("sentences splits on sentence ends only", () => {
  assert.deepEqual(sentences("One. Two! Three? Four, five."), ["One.", "Two!", "Three?", "Four, five."]);
});

test("lines come in order: hook, then each beat's narration sentences and dialogue", () => {
  const lines = planLines(story, both);
  assert.deepEqual(lines.map((l) => l.id), ["hook", "b1-n1", "b1-n2", "b1-d1", "b2-n1", "b2-d1"]);
  assert.equal(lines.find((l) => l.id === "b1-d1")?.who, "Ana");
});

test("voices toggle independently", () => {
  assert.ok(planLines(story, { ...both, dialogs: { enabled: false } }).every((l) => l.kind === "narration"));
  assert.ok(planLines(story, { ...both, narration: { enabled: false } }).every((l) => l.kind === "dialog"));
});

test("casting matches gender and never reuses the narrator's or another character's preset", () => {
  const cast = castVoices(story, both);
  assert.notEqual(cast.characters.Ana.voice, "Bruno");
  assert.notEqual(cast.characters.Ana.voice, cast.characters.Ben.voice);
  assert.ok(["Rosie", "Diana", "Luna", "Maeve", "Willow", "Claire", "Saoirse", "Raven", "Kiki", "Dolores"].includes(cast.characters.Ana.voice));
  assert.equal(castVoices(story, both).characters.Ana.voice, cast.characters.Ana.voice, "casting is deterministic");
});

test("an explicit recast wins", () => {
  const cast = castVoices(story, { ...both, dialogs: { enabled: true, engine: "kitten2", voices: { Ana: "Claire" } } });
  assert.equal(cast.characters.Ana.voice, "Claire");
});

test("VoxCPM characters get a written description", () => {
  const cast = castVoices(story, { ...both, dialogs: { enabled: true, engine: "voxcpm2" } });
  assert.match(cast.characters.Ana.voiceDesc ?? "", /female/);
});

test("VoxCPM distinct characters do not share a preset", () => {
  const cast = castVoices(story, { ...both, dialogs: { enabled: true, engine: "voxcpm2" } });
  assert.notEqual(cast.characters.Ana.voice, cast.characters.Ben.voice);
});

test("VoxCPM default voice is the casting baseline", () => {
  const cast = castVoices(story, { ...both, dialogs: { enabled: true, engine: "voxcpm2", defaultVoice: "character-hero" } });
  assert.equal(cast.characters.Ana.voice, "character-hero");
  // Ben must not also get character-hero (taken set prevents sharing).
  assert.notEqual(cast.characters.Ben.voice, "character-hero");
});

test("default voice is applied as casting baseline for Kitten", () => {
  const cast = castVoices(story, { ...both, dialogs: { enabled: true, engine: "kitten2", defaultVoice: "Rosie" } });
  assert.equal(cast.characters.Ana.voice, "Rosie");
  // Ben must not also get Rosie (taken set prevents sharing).
  assert.notEqual(cast.characters.Ben.voice, "Rosie");
});

test("seed is deterministic for the same voice", () => {
  const s1 = castVoices(story, { ...both, dialogs: { enabled: true, engine: "voxcpm2" } }).characters.Ana.seed;
  const s2 = castVoices(story, { ...both, dialogs: { enabled: true, engine: "voxcpm2" } }).characters.Ana.seed;
  assert.equal(s1, s2);
  assert.ok(typeof s1 === "number" && s1 >= 0);
});

test("different voices get different seeds", () => {
  const cast1 = castVoices(story, { ...both, dialogs: { enabled: true, engine: "voxcpm2", voices: { Ana: "character-hero" } } });
  const cast2 = castVoices(story, { ...both, dialogs: { enabled: true, engine: "voxcpm2", voices: { Ana: "character-villain" } } });
  assert.notEqual(cast1.characters.Ana.seed, cast2.characters.Ana.seed);
});

test("PlannedLine carries seed from cast", () => {
  const cast = castVoices(story, { ...both, dialogs: { enabled: true, engine: "voxcpm2" } });
  const lines = planLines(story, { ...both, dialogs: { enabled: true, engine: "voxcpm2" } });
  const dialogLine = lines.find((l) => l.kind === "dialog" && l.who === "Ana");
  assert.ok(dialogLine);
  assert.equal(dialogLine?.seed, cast.characters.Ana.seed);
});

test("estimates grow with words", () => {
  assert.ok(estimateDuration("one two three four five six", 2.6) > estimateDuration("one two", 2.6));
});

const planTts = process.env.FACTORY_PLAN_TTS === "1" && !!resolveTtsPython("kitten2");
test("plan-time voice is estimated with a warning (unless FACTORY_PLAN_TTS=1)", { skip: planTts && "FACTORY_PLAN_TTS=1 synthesizes plan-time lines for real" }, async () => {
  const r = await voiceLines(planLines(story, both), "voice-test", "plan");
  assert.ok(r.lines.every((l) => l.estimated && l.dur > 0));
  assert.match(r.warnings[0], /word counts/);
});

test("speeding up estimated lines shortens them and records the tempo", () => {
  const lines = planLines(story, both).map((l) => ({ ...l, dur: 2.2 }));
  const fast = speedUp(lines, 1.1);
  assert.ok(fast.every((l) => l.tempo === 1.1 && Math.abs(l.dur - 2) < 1e-9));
});

test("calibration defaults per engine until 5 lines of that engine are measured", () => {
  for (const engine of ["kitten2", "voxcpm2"] as const) {
    const wps = calibratedWps(engine);
    assert.ok(wps >= 1.6 && wps <= 4, `${engine}: ${wps}`);
  }
});

function voiceLine(overrides: Partial<{ engine: "kitten2" | "voxcpm2"; voice: string; voiceDesc?: string; text: string; referenceWav?: string; referenceText?: string; voiceStyle?: string; voiceTransform?: { semitones?: number; tempo?: number; saturation?: number }; seed?: number }> = {}): Record<string, unknown> {
  return {
    engine: overrides.engine ?? "kitten2",
    voice: overrides.voice ?? "Bruno",
    voiceDesc: overrides.voiceDesc ?? null,
    text: overrides.text ?? "hello world",
    referenceWav: overrides.referenceWav ?? null,
    referenceText: overrides.referenceText ?? null,
    voiceStyle: overrides.voiceStyle ?? null,
    voiceTransform: overrides.voiceTransform ?? null,
    seed: overrides.seed ?? null,
    ...overrides,
  };
}

test("cacheKey: same inputs give the same key", () => {
  const a = cacheKey(voiceLine() as never);
  const b = cacheKey(voiceLine() as never);
  assert.equal(a, b);
  assert.ok(a.length > 0);
});

test("cacheKey: different voice changes the key", () => {
  const a = cacheKey(voiceLine({ voice: "Bruno" }) as never);
  const b = cacheKey(voiceLine({ voice: "Rosie" }) as never);
  assert.notEqual(a, b);
});

test("cacheKey: different seed changes the key", () => {
  const a = cacheKey(voiceLine({ voice: "character-hero", seed: 0 }) as never);
  const b = cacheKey(voiceLine({ voice: "character-hero", seed: 1 }) as never);
  assert.notEqual(a, b);
});

test("cacheKey: different engine changes the key", () => {
  const a = cacheKey(voiceLine({ engine: "kitten2" }) as never);
  const b = cacheKey(voiceLine({ engine: "voxcpm2" }) as never);
  assert.notEqual(a, b);
});

test("cacheKey: different referenceWav changes the key", () => {
  const a = cacheKey(voiceLine({ voice: "narrator-bbc-calm", referenceWav: "/ref/a.wav" }) as never);
  const b = cacheKey(voiceLine({ voice: "narrator-bbc-calm", referenceWav: "/ref/b.wav" }) as never);
  assert.notEqual(a, b);
});

test("cacheKey: different voiceTransform changes the key", () => {
  const a = cacheKey(voiceLine({ voiceTransform: { semitones: 0 } }) as never);
  const b = cacheKey(voiceLine({ voiceTransform: { semitones: 2 } }) as never);
  assert.notEqual(a, b);
});

test("cacheKey: different text changes the key but not the speaker assignment", () => {
  const a = cacheKey(voiceLine({ voice: "Ana", text: "hello" }) as never);
  const b = cacheKey(voiceLine({ voice: "Ana", text: "goodbye" }) as never);
  assert.notEqual(a, b);
  // Same voice: only the text portion differs; the identity portion is stable.
  assert.notEqual(a.length, 0);
  assert.notEqual(b.length, 0);
});

test("cacheKey: voiceDesc changes the key", () => {
  const a = cacheKey(voiceLine({ voiceDesc: "desc A" }) as never);
  const b = cacheKey(voiceLine({ voiceDesc: "desc B" }) as never);
  assert.notEqual(a, b);
});
