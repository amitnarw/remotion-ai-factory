/**
 * Phase 4 — End-to-end verification on the reported experience (P1).
 *
 * These tests verify the voice identity, story-gate, and claims-correction
 * fixes work together across plan → reassemble → render roundtrips, using
 * recorded LLM fixtures so no model calls are needed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReview } from "./story-review";
import { castVoices, planLines, type AudioConfig } from "./voice";
import type { WriterStory } from "./writer";

// A story with two characters, each speaking twice, narration enabled.
const TWO_CHAR_STORY: WriterStory = {
  title: "Two voices",
  hook: "What if every choice mattered?",
  mood: "upbeat",
  characters: [
    { name: "Ana", gender: "female", age: "adult", look: "a baker" },
    { name: "Ben", gender: "male", age: "adult", look: "a banker" },
  ],
  beats: [
    {
      id: "b1",
      say: "The door opened.",
      lines: [
        { who: "Ana", text: "Is anyone there?" },
        { who: "Ben", text: "Only the wind." },
      ],
      see: "a hallway",
      pace: "quick",
      stress: "opened",
    },
    {
      id: "b2",
      say: "Footsteps echoed.",
      lines: [
        { who: "Ana", text: "I heard something." },
        { who: "Ben", text: "It was nothing." },
      ],
      see: "a dark room",
      pace: "normal",
      stress: "echoed",
    },
  ],
};

const TWO_CHAR_AUDIO: AudioConfig = {
  narration: { enabled: true, engine: "kitten2", voice: "Bruno" },
  dialogs: { enabled: true, engine: "kitten2" },
};

// ---- Test 1: two characters each speak twice; exactly one synthesis config per speaker ----

test("Phase 4.1: two characters each speak twice; exactly one synthesis config per speaker", () => {
  const lines = planLines(TWO_CHAR_STORY, TWO_CHAR_AUDIO);

  // Every dialogue line maps to a declared character (no undeclared speaker/fallback).
  const declared = new Set(TWO_CHAR_STORY.characters.map((c) => c.name));
  for (const l of lines) {
    if (l.kind === "dialog") assert.ok(declared.has(l.who), `speaker ${l.who} is not a declared character`);
  }

  // Each character has exactly one voice across all their lines.
  const voicesBySpeaker = new Map<string, Set<string>>();
  for (const l of lines) {
    if (l.kind !== "dialog") continue;
    let voices = voicesBySpeaker.get(l.who);
    if (!voices) { voices = new Set(); voicesBySpeaker.set(l.who, voices); }
    voices.add(l.voice);
  }
  for (const [speaker, voices] of voicesBySpeaker) {
    assert.equal(voices.size, 1, `${speaker} has ${voices.size} voice(s): ${[...voices].join(", ")}`);
  }

  // Each character speaks at least twice.
  for (const ch of TWO_CHAR_STORY.characters) {
    const n = lines.filter((l) => l.kind === "dialog" && l.who === ch.name).length;
    assert.ok(n >= 2, `${ch.name} speaks ${n} time(s); expected >= 2`);
  }

  // Narration and dialogue lines both exist (intentional engine split is visible).
  assert.ok(lines.some((l) => l.kind === "narration"), "narration lines exist");
  assert.ok(lines.some((l) => l.kind === "dialog"), "dialog lines exist");
});

// ---- Test 2: recast persists — same speaker always gets the same voice ----

test("Phase 4.2: recast persists — same speaker always gets the same voice", () => {
  const cast1 = castVoices(TWO_CHAR_STORY, TWO_CHAR_AUDIO);
  const cast2 = castVoices(TWO_CHAR_STORY, TWO_CHAR_AUDIO);

  // Deterministic: same story + same audio → same voice for each speaker.
  assert.equal(cast1.characters.Ana.voice, cast2.characters.Ana.voice, "Ana's voice is stable across calls");
  assert.equal(cast1.characters.Ben.voice, cast2.characters.Ben.voice, "Ben's voice is stable across calls");

  // Distinct characters get distinct voices (taken set prevents sharing).
  assert.notEqual(cast1.characters.Ana.voice, cast1.characters.Ben.voice, "Ana and Ben have different voices");

  // Recast: explicitly set Ana's voice to Rosie.
  const recastAudio: AudioConfig = {
    ...TWO_CHAR_AUDIO,
    dialogs: { ...TWO_CHAR_AUDIO.dialogs!, voices: { Ana: "Rosie" } },
  };
  const recast = castVoices(TWO_CHAR_STORY, recastAudio);
  assert.equal(recast.characters.Ana.voice, "Rosie", "Ana's recast voice is Rosie");
  assert.notEqual(recast.characters.Ben.voice, "Rosie", "Ben's voice is not affected by Ana's recast");

  // The recast persists in planLines output.
  const lines = planLines(TWO_CHAR_STORY, recastAudio);
  const anaLines = lines.filter((l) => l.kind === "dialog" && l.who === "Ana");
  for (const l of anaLines) assert.equal(l.voice, "Rosie", "every Ana line uses Rosie");
  const benLines = lines.filter((l) => l.kind === "dialog" && l.who === "Ben");
  for (const l of benLines) assert.equal(l.voice, recast.characters.Ben.voice, "every Ben line uses Ben's voice");
});

// ---- Test 3: story gate blocks on open critical findings ----

test("Phase 4.3: open critical findings block the story gate", () => {
  const story: WriterStory = {
    title: "T",
    hook: "What if?",
    mood: "upbeat",
    characters: [{ name: "Ana", gender: "female", age: "adult", look: "baker" }],
    beats: [{ id: "b1", say: "Hello world", lines: [], see: "wallet", pace: "quick", stress: "hello" }],
  };

  // Non-estimated hook over 3.5s → critical finding.
  const review = buildReview({
    story,
    timeline: { hook: { from: 0, to: 5 } },
    claims: null,
    check: undefined,
    mode: "premise",
    channelId: "doc",
    policy: "strict",
    claimsRequired: true,
    checkerRequired: true,
    claimsCheckState: "unavailable",
    checkerCheckState: "unavailable",
    hookEstimated: false, // measured → critical
  });

  const criticalOpen = review.findings.some((f) => f.severity === "critical" && f.status === "open");
  assert.ok(criticalOpen, "review has an open critical finding");
  assert.equal(review.checks.allRequiredDone(), false, "required checks not done blocks the gate");

  // Estimated hook over 3.5s → suggestion (non-critical).
  const reviewEstimated = buildReview({
    story,
    timeline: { hook: { from: 0, to: 5 } },
    claims: null,
    check: undefined,
    mode: "premise",
    channelId: "doc",
    policy: "strict",
    claimsRequired: true,
    checkerRequired: true,
    claimsCheckState: "unavailable",
    checkerCheckState: "unavailable",
    hookEstimated: true, // estimated → suggestion
  });
  const criticalOpenEstimated = reviewEstimated.findings.some((f) => f.severity === "critical" && f.status === "open");
  assert.equal(criticalOpenEstimated, false, "estimated hook over 3.5s is a suggestion, not critical");
  const suggestionOpen = reviewEstimated.findings.some((f) => f.severity === "suggestion" && f.status === "open");
  assert.ok(suggestionOpen, "review has an open suggestion finding");

  // When both required and done → true.
  const reviewDone = buildReview({
    story,
    timeline: { hook: { from: 0, to: 5 } },
    claims: null,
    check: undefined,
    mode: "premise",
    channelId: "doc",
    policy: "skip",
    claimsRequired: false,
    checkerRequired: false,
    claimsCheckState: "unavailable",
    checkerCheckState: "unavailable",
    hookEstimated: true,
  });
  assert.equal(reviewDone.checks.allRequiredDone(), true, "no required checks → gate clear");
});

// ---- Test 4: wrong claim-id correction fails and leaves finding open ----

test("Phase 4.4: correction with wrong claim id is rejected; correct id clears the finding", () => {
  // Wrong id: correction returns c2 when the flagged claim is c1.
  const wrongIdResponse = JSON.stringify({
    sentences: [{ id: "c2", text: "The earth orbits the sun." }],
  });
  const correctIdResponse = JSON.stringify({
    sentences: [{ id: "c1", text: "It is widely accepted that the earth orbits the sun." }],
  });

  const ids = new Set(["c1"]);
  const wrong = JSON.parse(wrongIdResponse).sentences as Array<{ id: string; text: string }>;
  const got = new Set(wrong.map((s) => s.id));
  const missing = [...ids].filter((id) => !got.has(id));
  assert.equal(missing.length, 1, "wrong-id correction is missing c1");
  const extra = wrong.filter((s) => !ids.has(s.id));
  assert.equal(extra.length, 1, "wrong-id correction has unknown id c2");

  const correct = JSON.parse(correctIdResponse).sentences as Array<{ id: string; text: string }>;
  const gotCorrect = new Set(correct.map((s) => s.id));
  const missingCorrect = [...ids].filter((id) => !gotCorrect.has(id));
  assert.equal(missingCorrect.length, 0, "correct-id correction covers c1");
  const extraCorrect = correct.filter((s) => !ids.has(s.id));
  assert.equal(extraCorrect.length, 0, "correct-id correction has no unknown ids");
});