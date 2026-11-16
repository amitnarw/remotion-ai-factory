/**
 * Phase 2 — required visual blocker: unit tests for
 * `unresolvedRequiredVisuals`, `validateVisualCoverage` and `VisualBlockError`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  unresolvedRequiredVisuals,
  validateVisualCoverage,
  VisualBlockError,
  type UnresolvedVisual,
} from "./run";
import type { CapabilityKind } from "../library/types";
import type { NeedsFile } from "../library/match";
import type { AcquisitionFile, AcquisitionItem, Approval } from "../library/acquire/types";
import type { ShotSpec } from "../spec.schema";
import type { WriterStory } from "./writer";

const shot = (beat: string): NonNullable<ShotSpec["shots"]>[number] => ({
  subject: "phone",
  size: "MS",
  angle: "eye",
  side: "auto",
  move: "static",
  place: "center",
  energy: "normal",
  style: "smooth",
  from: 0,
  to: 10,
  beat,
});

function need(
  id: string,
  overrides: Partial<{
    kind: ("set" | "character" | "prop" | "vehicle" | "animal");
    what: string;
    beats: string[];
    must: boolean;
    status: "have" | "close" | "download" | "build" | "data" | "skip";
    use?: { id: string; kind: CapabilityKind; name: string; castId?: string };
    choice?: { action: Approval["action"] | "fallback"; ref?: string; at: string };
  }> = {},
): NonNullable<NeedsFile["needs"]>[number] {
  return {
    id,
    kind: overrides.kind ?? "prop",
    what: overrides.what ?? "a smartphone",
    words: ["phone"],
    beats: overrides.beats ?? ["b1"],
    must: overrides.must ?? true,
    status: overrides.status ?? "download",
    ...(overrides.use ? { use: overrides.use } : {}),
    ...(overrides.choice ? { choice: overrides.choice } : {}),
    judged: "code",
    candidates: [],
  };
}

function acquisition(overrides: { items: Partial<AcquisitionItem>[] }): AcquisitionFile {
  return {
    version: 1,
    at: "2026-11-05T12:00:00.000Z",
    policy: { ccByModels: true, ccByMusic: false },
    inventory: { before: "0", after: "0" },
    items: overrides.items.map((i) => ({
      need: i.need ?? "n1",
      choice: i.choice ?? "skip",
      result: i.result ?? "skipped",
      status: { before: "download", after: "download" },
      ...i,
    })),
    warnings: [],
  };
}

function spec(overrides: {
  scenes?: NonNullable<ShotSpec["scenes"]>;
  shots?: NonNullable<ShotSpec["shots"]>;
}): ShotSpec {
  return {
    id: "test",
    title: "Test",
    fps: 30,
    width: 1080,
    height: 1920,
    scenes: overrides.scenes ?? [],
    shots: overrides.shots ?? [],
    hook: { text: "Hook", t: 0, duration: 2.5 },
    events: [],
    captions: [],
  } as unknown as ShotSpec;
}

function story(beats: Array<{ id: string; say: string }>): WriterStory {
  return {
    title: "Test",
    hook: "Hook",
    mood: "documentary",
    characters: [],
    beats: beats as NonNullable<WriterStory["beats"]>,
  };
}

test("unresolvedRequiredVisuals: must-have visual with failed acquisition is unresolved", () => {
  const needs: NeedsFile = {
    version: 1,
    inventory: "inv",
    warnings: [],
    needs: [
      need("n5", { kind: "set", what: "cellular towers", beats: ["b2"], must: true, status: "download" }),
      need("n6", { kind: "prop", what: "smartphone", beats: ["b1"], must: true, status: "download" }),
      need("n7", { kind: "prop", what: "ringtone", beats: ["b1"], must: false, status: "download" }), // not must-have: excluded
    ],
  };
  const acq = acquisition({
    items: [
      { need: "n5", result: "failed", reason: "no source offers anything for it", choice: "fallback" },
      { need: "n6", result: "refused", choice: "skip" },
    ],
  });

  const unresolved = unresolvedRequiredVisuals(needs, acq);
  assert.deepEqual(
    unresolved.map((u) => u.id),
    ["n5", "n6"],
    "both must-have visual needs are unresolved",
  );
  assert.equal(unresolved[0].what, "cellular towers");
  assert.deepEqual(unresolved[0].beats, ["b2"]);
  assert.equal(unresolved[1].what, "smartphone");
  // The sound need is not visual: excluded.
  assert.ok(!unresolved.some((u) => u.id === "n7"));
});

test("unresolvedRequiredVisuals: taken-in, already-in-stock, have, and accepted substitute are resolved", () => {
  const needs: NeedsFile = {
    version: 1,
    inventory: "inv",
    warnings: [],
    needs: [
      need("n1", { kind: "prop", what: "phone", must: true, status: "have", use: { id: "kenney:phone", kind: "model", name: "phone" } }),
      need("n2", { kind: "prop", what: "tower", must: true, status: "close", use: { id: "kenney:tower", kind: "model", name: "tower" }, choice: { action: "close", at: "now" } }),
      need("n3", { kind: "prop", what: "phone", must: true, status: "download" }), // nothing available
    ],
  };
  const acq = acquisition({
    items: [
      { need: "n1", result: "taken-in", choice: "get", ref: "kenney:phone" },
      { need: "n2", result: "already-in-stock", choice: "close" },
      { need: "n3", result: "failed", choice: "fallback" },
    ],
  });

  const unresolved = unresolvedRequiredVisuals(needs, acq);
  assert.deepEqual(unresolved.map((u) => u.id), ["n3"], "only the need with nothing available is unresolved");
});

test("unresolvedRequiredVisuals: optional needs do not block", () => {
  const needs: NeedsFile = {
    version: 1,
    inventory: "inv",
    warnings: [],
    needs: [need("n1", { kind: "prop", what: "phone", must: false, status: "download" })],
  };
  const acq = acquisition({ items: [{ need: "n1", result: "failed", choice: "skip" }] });

  const unresolved = unresolvedRequiredVisuals(needs, acq);
  assert.deepEqual(unresolved, [], "optional needs are not unresolved");
});

test("unresolvedRequiredVisuals: a need with a stand-in is resolved even before the user chooses", () => {
  const needs: NeedsFile = {
    version: 1,
    inventory: "inv",
    warnings: [],
    needs: [
      // The match found a kit that stands in for the room ("close"): it can be
      // shown, so it is not a missing visual (gate 2 may still offer a better one).
      need("n1", { kind: "set", what: "a feast hall", must: true, status: "close", use: { id: "interior", kind: "kit", name: "interior" } }),
      // Nothing stands in for the workshop ("build"): nothing can be shown.
      need("n2", { kind: "set", what: "a workshop", must: true, status: "build" }),
    ],
  };
  const acq = acquisition({ items: [] });

  const unresolved = unresolvedRequiredVisuals(needs, acq);
  assert.deepEqual(unresolved.map((u) => u.id), ["n2"], "the stand-in resolves one; the build with nothing on screen blocks");
});

test("validateVisualCoverage: missing shot coverage is flagged", () => {
  const specObj = spec({ shots: [] }); // no shots at all
  const needs: NeedsFile = {
    version: 1,
    inventory: "inv",
    warnings: [],
    needs: [need("n1", { kind: "prop", what: "phone", beats: ["b1"], must: true, use: { id: "kenney:phone", kind: "model", name: "phone" } })],
  };

  const problems = validateVisualCoverage(specObj, story([{ id: "b1", say: "x" }]), needs);
  assert.ok(problems.some((p) => p.includes("no camera shot covering it")), "missing shot coverage is flagged");
});

test("validateVisualCoverage: accepted substitute wired into a scene passes", () => {
  const specObj = spec({
    scenes: [
      {
        scene: "street-block",
        kit: "street-block",
        from: 0,
        to: 10,
        cast: [{ asset: "kenney:phone", count: 1 }],
      },
    ],
    shots: [shot("b1")],
  });
  const needs: NeedsFile = {
    version: 1,
    inventory: "inv",
    warnings: [],
    needs: [need("n1", { kind: "prop", what: "phone", beats: ["b1"], must: true, use: { id: "kenney:phone", kind: "model", name: "phone" } })],
  };

  const problems = validateVisualCoverage(specObj, story([{ id: "b1", say: "x" }]), needs);
  assert.deepEqual(problems, [], "wired-in substitute produces no problems");
});

test("validateVisualCoverage: accepted substitute NOT wired into a scene is flagged", () => {
  const specObj = spec({
    scenes: [{ scene: "street-block", kit: "street-block", from: 0, to: 10 }],
    shots: [shot("b1")],
  });
  const needs: NeedsFile = {
    version: 1,
    inventory: "inv",
    warnings: [],
    needs: [need("n1", { kind: "prop", what: "phone", beats: ["b1"], must: true, use: { id: "kenney:phone", kind: "model", name: "phone" } })],
  };

  const problems = validateVisualCoverage(specObj, story([{ id: "b1", say: "x" }]), needs);
  assert.ok(problems.some((p) => p.includes("not wired into any scene")), "unwired substitute is flagged");
});

test("validateVisualCoverage: nothing available for a required visual is flagged", () => {
  const specObj = spec({
    scenes: [{ scene: "street-block", kit: "street-block", from: 0, to: 10 }],
    shots: [shot("b1")],
  });
  const needs: NeedsFile = {
    version: 1,
    inventory: "inv",
    warnings: [],
    needs: [need("n1", { kind: "prop", what: "phone", beats: ["b1"], must: true, status: "download" })], // no use
  };

  const problems = validateVisualCoverage(specObj, story([{ id: "b1", say: "x" }]), needs);
  assert.ok(problems.some((p) => p.includes("not available")), "nothing available is flagged");
});

test("VisualBlockError: names the run and the unresolved needs", () => {
  const unresolved: UnresolvedVisual[] = [
    { id: "n5", kind: "set", what: "cellular towers", beats: ["b2"], reason: "no source offers anything for it" },
    { id: "n6", kind: "prop", what: "smartphone", beats: ["b1"], reason: "refused" },
  ];
  const err = new VisualBlockError("phone-history", unresolved);
  assert.equal(err.name, "VisualBlockError");
  assert.ok(err.message.includes("phone-history"));
  assert.ok(err.message.includes("cellular towers"));
  assert.ok(err.message.includes("smartphone"));
  assert.deepEqual(err.unresolved, unresolved);
});
