/**
 * Loads the repo-root .env into process.env — once, and without overriding
 * variables the caller already set (a shell/exported value wins).
 *
 * Why: resolveModel and llm.ts read process.env[apiKeyEnv] directly, and the
 * dashboard server applies .env itself. A CLI run (generate, milestone,
 * photographer) on a machine where the key only lives in .env used to see
 * no key at all — and, for a matching offline family premise, silently fell
 * back to a template instead of the AI pipeline.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

let loaded = false;

export function loadDotEnv(): void {
  if (loaded) return;
  loaded = true;
  const path = join(process.cwd(), ".env");
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    if (process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
}
