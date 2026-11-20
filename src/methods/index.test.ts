import { test } from "node:test";
import assert from "node:assert/strict";
import { SettingsSchema } from "../generator/spec.schema";
import { listMethods, METHOD_INFO, methodIdOf, resolveMethod } from "./index";
import { METHODS } from "./types";
test("every method is registered, in a stable order", () => {
  const ids = listMethods().map((m) => m.id);
  assert.deepEqual(ids, [...METHODS]);
});

test("an empty settings object carries no method, which means factory (old specs are unchanged)", () => {
  const s = SettingsSchema.parse({});
  assert.equal(s.method, undefined);
  assert.equal(s.lemoStyleMode, undefined);
});

test("a spec with settings that predate this field resolves to factory", () => {
  // Exactly what an existing run's props look like: no method key at all.
  assert.equal(methodIdOf({ settings: SettingsSchema.parse({ format: "9:16" }) }), "factory");
  assert.equal(methodIdOf({}), "factory");
});

test("factory is available; the other two say so honestly", () => {
  const byId = Object.fromEntries(listMethods().map((m) => [m.id, m]));
  assert.equal(byId.factory.available, true);
  assert.equal(byId.animation.available, false);
  assert.equal(byId.lemo.available, false);
});

test("the catalogue (UI) and the implementations agree", () => {
  for (const m of listMethods()) {
    assert.equal(m.summary, METHOD_INFO[m.id].summary, `${m.id} summary drifted from METHOD_INFO`);
    assert.equal(m.available, METHOD_INFO[m.id].available, `${m.id} availability drifted from METHOD_INFO`);
    assert.ok(METHOD_INFO[m.id].note === undefined || !m.available, `${m.id} is available but carries a note`);
  }
});

test("selecting an unbuilt method is a readable error, not a stack trace", async () => {
  await assert.rejects(
    () => resolveMethod({ settings: { method: "lemo" } } as never).render({} as never),
    /not built yet.*Phases 4/s,
  );
});

test("animation has a renderer but is not yet selectable in the product", () => {
  const m = resolveMethod({ settings: { method: "animation" } } as never);
  assert.equal(typeof m.render, "function");
  assert.equal(m.available, false, "flip this only after the stills gate in the doc");
});

test("an unknown method id lists the valid methods", () => {
  assert.throws(
    () => resolveMethod({ settings: { method: "nope" } } as never),
    /unknown video method "nope".*factory, animation, lemo/,
  );
});

test("lemo forced mode requires a style id", () => {
  assert.equal(SettingsSchema.safeParse({ method: "lemo", lemoStyleMode: "forced" }).success, false);
  assert.equal(
    SettingsSchema.safeParse({ method: "lemo", lemoStyleMode: "forced", lemoStyle: "risograph" }).success,
    true,
  );
  // forced is meaningless for the other methods and never blocks them
  assert.equal(SettingsSchema.safeParse({ method: "factory", lemoStyleMode: "forced" }).success, true);
});
