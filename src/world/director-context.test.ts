import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveWorldLapse, resolveWorldScene, worldDirectorContext } from "./director-context";
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

test("director context teaches the time-lapse and the stepped jump", () => {
  const text = worldDirectorContext();
  assert.ok(text.includes('"lapse": { "to": "HH:MM" }'), "the answer shape");
  for (const w of ["dawn (sunrise)", "noon", "dusk (blue hour", "night (full night sky)"]) assert.ok(text.includes(w), `the word ${w}`);
  assert.ok(/at most one per video/.test(text) && /at least 3 s/.test(text), "the limits");
  assert.ok(/by nightfall/.test(text) && /day to night/.test(text), "when to use it");
  assert.ok(/wide and slow/.test(text), "how to film it");
  assert.ok(/stepped jump: the cut dips/.test(text), "the stepped alternative");
});

test("a world choice's lapse: words become real times, problems carry real times, the place survives", () => {
  const base = { place: "paris", date: "2026-10-23", time: "17:00" };
  const none = resolveWorldLapse(base);
  assert.ok(none.ok && none.lapse === undefined, "no lapse");
  const clock = resolveWorldLapse({ ...base, lapse: { to: "19:30" } }, { from: 2, to: 8 });
  assert.ok(clock.ok && clock.lapse?.to === "19:30", "a clock time passes through");
  const night = resolveWorldLapse({ ...base, lapse: { to: "night" } });
  assert.ok(night.ok && /^19:5\d$/.test(night.lapse?.to ?? ""), `night is a clock time from the real sun (${night.ok ? night.lapse?.to : night.error})`);
  // The sun barely moves: refused, with the day's real times for the repair.
  const still = resolveWorldLapse({ place: "paris", date: "2026-06-21", time: "12:00", lapse: { to: "12:30" } });
  assert.ok(!still.ok && /barely moves/.test(still.error) && /sunset 21:5\d/.test(still.error), still.ok ? "accepted" : still.error);
  // Too short on screen, backward, a word that never comes, an unknown word.
  const short = resolveWorldLapse({ ...base, lapse: { to: "19:30" } }, { from: 0, to: 2 });
  assert.ok(!short.ok && /at least 3 s/.test(short.error));
  const back = resolveWorldLapse({ ...base, lapse: { to: "09:00" } });
  assert.ok(!back.ok && /later than time/.test(back.error));
  const gone = resolveWorldLapse({ ...base, time: "21:00", lapse: { to: "dusk" } });
  assert.ok(!gone.ok && /never comes after 21:00/.test(gone.error));
  const word = resolveWorldLapse({ ...base, lapse: { to: "evening" } });
  assert.ok(!word.ok && /lapse.to must be HH:MM .*night, dusk, dawn, noon/.test(word.error), word.ok ? "accepted" : word.error);
  // A lapse that can't be used never costs the scene its place.
  assert.equal(resolveWorldScene({ ...base, lapse: { to: "evening" } }).ok, true);
});
