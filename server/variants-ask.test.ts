/**
 * The dashboard's variants request (POST /api/runs/:runId/variants): what it
 * takes, what it refuses, and the CLI argument it becomes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkVariantsAsk, variantsArg } from "./variants-ask";

const run = { format: "9:16" as const, asWritten: false };

test("a variants request: counts with the original, the run's own format always in", () => {
  const got = checkVariantsAsk({ hooks: 3, endings: 2, formats: ["16:9"] }, run);
  assert.ok("ask" in got);
  assert.deepEqual(got.ask, { hooks: 3, endings: 2, formats: ["9:16", "16:9"] });
  assert.equal(variantsArg(got.ask), "hooks=3,endings=2,formats=9:16,16:9");
  const formatsOnly = checkVariantsAsk({ formats: ["1:1", "9:16"] }, run);
  assert.ok("ask" in formatsOnly);
  assert.deepEqual(formatsOnly.ask, { hooks: 1, endings: 1, formats: ["9:16", "1:1"] });
});

test("a variants request is refused when it asks for nothing new or for too much", () => {
  for (const body of [{}, { hooks: 1, endings: 1, formats: ["9:16"] }]) {
    const got = checkVariantsAsk(body, run);
    assert.ok("error" in got && /Nothing to make/.test(got.error));
  }
  for (const body of [{ hooks: 5 }, { hooks: 0 }, { hooks: 2.5 }, { endings: 4 }, { formats: ["4:3"] }, { formats: "16:9" }]) {
    assert.ok("error" in checkVariantsAsk(body as Record<string, unknown>, run), JSON.stringify(body));
  }
});

test("a script as written varies only in format", () => {
  const asWritten = { format: "16:9" as const, asWritten: true };
  assert.ok("error" in checkVariantsAsk({ hooks: 2 }, asWritten));
  assert.ok("error" in checkVariantsAsk({ endings: 2, formats: ["9:16"] }, asWritten));
  const got = checkVariantsAsk({ formats: ["9:16"] }, asWritten);
  assert.ok("ask" in got);
  assert.deepEqual(got.ask.formats, ["16:9", "9:16"]);
});
