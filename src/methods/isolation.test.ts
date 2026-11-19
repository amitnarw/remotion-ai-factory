/**
 * src/methods/isolation.test.ts — "do not mix", enforced by the build.
 *
 * The user's rule: a video is made by exactly one method, and no method
 * borrows another's picture, code or styles (docs/factory/23-visual-methods.md
 * §11.1). This test reads every file under src/methods/<id>/ and fails if it
 * imports another method's directory.
 *
 * src/methods/index.ts is the registry and may import all three; only the
 * method directories themselves are scanned.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const METHOD_IDS = ["factory", "animation", "lemo"] as const;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

/** Every module specifier a file imports. */
function importsOf(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const out: string[] = [];
  const re = /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

/** True when a relative specifier points into another method's directory. */
function crossesInto(spec: string, self: string): string | null {
  if (!spec.startsWith(".")) return null;
  for (const other of METHOD_IDS) {
    if (other === self) continue;
    if (spec.includes(`/${other}/`) || new RegExp(`\\.\\./${other}(/|$)`).test(spec)) return other;
  }
  return null;
}

test("no method imports another method's code or styles", () => {
  const violations: string[] = [];
  for (const id of METHOD_IDS) {
    let files: string[] = [];
    try {
      files = walk(join(ROOT, id));
    } catch {
      continue; // a method with no code yet is not a violation
    }
    for (const file of files) {
      for (const spec of importsOf(file)) {
        const other = crossesInto(spec, id);
        if (other) violations.push(`${relative(ROOT, file)} imports ${spec} (${other})`);
      }
    }
  }
  assert.deepEqual(violations, [], `methods must not import each other:\n${violations.join("\n")}`);
});
