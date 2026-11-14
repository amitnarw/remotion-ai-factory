import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join } from "path";
import type { Need } from "../../pipeline/breakdown";
import { buildDraft } from "../match";
import { buildRegistry } from "../registry";
import { fileRequest, formatQueue, rankRequests, readRequests, requestId } from "./requests";
import { tempRoot } from "./testing";

const climb: Need = { id: "n3", kind: "action", what: "he climbs the spiral stairs", words: ["climb", "stairs"], beats: ["b3"], who: "keeper", must: false };
const fight: Need = { id: "n7", kind: "action", what: "two men fight on the deck", words: ["fight", "punch"], beats: ["b5", "b6"], must: true };

test("one request per capability: asks collect there, counted once per run and need", () => {
  const { requestsDir: dir } = tempRoot();
  const draft = buildDraft(climb);
  assert.equal(draft.id, "action-climb");
  const a = fileRequest(dir, draft, { run: "keeper-aaaaaa", need: "n3", beats: ["b3"], at: "2026-11-04T10:00:00Z" }, "a story needs it; nothing close in stock");
  assert.equal(a.created, true);
  assert.equal(a.request.status, "open");
  const again = fileRequest(dir, draft, { run: "keeper-aaaaaa", need: "n3", beats: ["b3", "b4"], at: "2026-11-04T11:00:00Z" }, "x");
  assert.equal(again.created, false);
  assert.equal(again.request.count, 1, "the same run and need only update their line");
  assert.deepEqual(again.request.asks[0].beats, ["b3", "b4"]);
  fileRequest(dir, draft, { run: "tower-bbbbbb", need: "n2", beats: ["b1"], at: "2026-11-04T12:00:00Z" }, "x");
  const file = JSON.parse(readFileSync(join(dir, "action-climb.json"), "utf8"));
  assert.equal(file.count, 2);
  assert.equal(file.why, "a story needs it; nothing close in stock");
  assert.equal(file.acceptance, draft.acceptance);
  assert.equal(file.fallback, "leave it out of the picture");
});

test("the queue ranks by how often runs ask; done and declined go last", () => {
  const { requestsDir: dir } = tempRoot();
  fileRequest(dir, buildDraft(climb), { run: "r1", need: "n3", beats: [], at: "2026-11-01" }, "w");
  for (const run of ["r1", "r2", "r3"]) fileRequest(dir, buildDraft(fight), { run, need: "n7", beats: [], at: "2026-11-02" }, "w");
  const { requests, bad } = readRequests(dir);
  assert.deepEqual(bad, []);
  assert.deepEqual(rankRequests(requests).map((r) => r.id), ["action-fight", "action-climb"]);
  const done = requests.map((r) => (r.id === "action-fight" ? { ...r, status: "done" as const } : r));
  assert.deepEqual(rankRequests(done).map((r) => r.id), ["action-climb", "action-fight"]);
  assert.match(formatQueue(requests), /3x {2}action-fight \(action, open\)/);
});

test("an open request is a planned capability for the next match", () => {
  const { requestsDir: dir } = tempRoot();
  fileRequest(dir, buildDraft(climb), { run: "r1", need: "n3", beats: [], at: "2026-11-01" }, "w");
  const reg = buildRegistry({ world: [], cast: [], library: [], synth: {}, acquired: { models: [], sounds: [] }, buildRequests: readRequests(dir).requests });
  assert.equal(reg.get("planned:action-climb")?.status, "planned");
});

test("request ids are safe file names", () => {
  assert.equal(requestId("Camera: Bullet Time!"), "camera-bullet-time");
  assert.throws(() => requestId("../"), /usable/);
});
