import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveWorldScene, worldDirectorContext } from "./director-context";
import { PLACES } from "./places";

test("director context lists every place and stays prompt-sized", () => {
  const text = worldDirectorContext();
  for (const id of Object.keys(PLACES)) assert.ok(text.includes(`- ${id}:`), `missing place ${id}`);
  assert.ok(text.includes("eiffel-tower"), "landmarks are named");
  assert.ok(text.length < 9000, `context is ${text.length} characters`);
});

test("director choices are validated with errors that can be sent back", () => {
  const good = resolveWorldScene({ place: "paris", date: "2026-10-23", time: "09:15" });
  assert.equal(good.ok, true);
  const unknown = resolveWorldScene({ place: "atlantis", date: "2026-10-23", time: "09:15" });
  assert.ok(!unknown.ok && /choose one of: .*paris/.test(unknown.error));
  const badTime = resolveWorldScene({ place: "paris", date: "2026-10-23", time: "25:00" });
  assert.ok(!badTime.ok && /HH:MM/.test(badTime.error));
  const badDate = resolveWorldScene({ place: "paris", date: "2026-02-30", time: "10:00" });
  assert.ok(!badDate.ok && /does not exist/.test(badDate.error));
});
