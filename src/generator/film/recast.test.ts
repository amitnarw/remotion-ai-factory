import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRecast, voicesFor } from "./recast";

const characters = [{ name: "Mia" }, { name: "Old Tom" }];

test("recast: a character of the story and a voice of the dialogs engine pass", () => {
  assert.equal(checkRecast({ characters, name: "Mia", voice: "Luna" }), null);
  assert.equal(checkRecast({ characters, engine: "kitten2", name: "Old Tom", voice: "Marcus" }), null);
  assert.equal(checkRecast({ characters, engine: "voxcpm2", name: "Mia", voice: "character-child" }), null);
});

test("recast: an unknown character or voice is refused with the choices", () => {
  const zed = checkRecast({ characters, name: "Zed", voice: "Luna" });
  assert.match(zed!.error, /"Zed" is not a character/);
  assert.match(zed!.fix, /Mia, Old Tom/);

  const bad = checkRecast({ characters, name: "Mia", voice: "NotAVoice" });
  assert.match(bad!.error, /"NotAVoice" is not a KittenTTS 2 voice/);
  assert.match(bad!.fix, /Luna/);

  // Banned and other-engine voices are refused too.
  assert.notEqual(checkRecast({ characters, name: "Mia", voice: "Bella" }), null);
  assert.notEqual(checkRecast({ characters, engine: "voxcpm2", name: "Mia", voice: "Luna" }), null);
  assert.notEqual(checkRecast({ characters, engine: "kitten2", name: "Mia", voice: "narrator-calm" }), null);

  assert.match(checkRecast({ characters, name: "", voice: "Luna" })!.error, /required/);
  assert.match(checkRecast({ characters, name: "Mia", voice: 7 })!.error, /required/);
  assert.match(checkRecast({ characters: [], name: "Mia", voice: "Luna" })!.fix, /no characters/);
});

test("recast: the voice lists follow the engine", () => {
  assert.ok(voicesFor("kitten2").includes("Bruno"));
  assert.ok(!voicesFor("kitten2").includes("Bella"));
  assert.deepEqual(voicesFor("voxcpm2").slice(0, 2), ["narrator-calm", "narrator-warm"]);
});
