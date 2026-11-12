import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalPath } from "./root";

test("a lowercase drive letter is upper-cased; other paths are left as they are", () => {
  assert.equal(canonicalPath("c:\\Users\\Dell\\repo"), "C:\\Users\\Dell\\repo");
  assert.equal(canonicalPath("d:/work/repo"), "D:/work/repo");
  assert.equal(canonicalPath("C:\\Users\\Dell\\repo"), "C:\\Users\\Dell\\repo");
  assert.equal(canonicalPath("/home/user/repo"), "/home/user/repo");
  assert.equal(canonicalPath("relative\\c:path"), "relative\\c:path");
});
