import { test } from "node:test";
import assert from "node:assert/strict";
import { calibratedWps, castVoices, estimateDuration, planLines, sentences, speedUp, voiceLines } from "./voice";
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
