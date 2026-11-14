/**
 * The repo-root .env: one reader and one writer for the CLI and the
 * dashboard server (16-code-map-pipeline.md §7.5 item 6: they used to have a
 * loader each, with different rules).
 *
 * Why: resolveModel and llm.ts read process.env[apiKeyEnv] directly. A CLI
 * run (generate, milestone, photographer) on a machine where the key only
 * lives in .env used to see no key at all, and, for a matching offline family
 * premise, silently fell back to a template instead of the AI pipeline.
 *
 * The rule:
 * - loadDotEnv() applies .env once and never over a variable that is already
 *   set, so a value exported in the shell wins for that run;
 * - the server applies it with { override: true } whenever it needs the keys:
 *   a key saved on the Settings page takes effect without a restart, and the
 *   CLI jobs it starts inherit its environment;
 * - saveDotEnv() changes the named keys in place and keeps every other line,
 *   comments included.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LINE = /^([A-Z_][A-Z0-9_]*)=(.*)$/;

let loaded = false;

export function dotEnvPath(root = process.cwd()): string {
  return join(root, ".env");
}

/** The variables a .env text sets (KEY=value or KEY="value"; other lines are ignored). */
export function parseDotEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = LINE.exec(line);
    if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return env;
}

/** The variables .env sets ({} without the file). */
export function readDotEnv(root = process.cwd()): Record<string, string> {
  const path = dotEnvPath(root);
  return existsSync(path) ? parseDotEnv(readFileSync(path, "utf8")) : {};
}

/**
 * Apply .env to process.env. By default once per process, never over a
 * variable already set; with `override` every time, over anything.
 */
export function loadDotEnv(opts: { override?: boolean; root?: string } = {}): void {
  if (!opts.override) {
    if (loaded) return;
    loaded = true;
  }
  for (const [k, v] of Object.entries(readDotEnv(opts.root))) {
    if (!opts.override && process.env[k]) continue;
    process.env[k] = v;
  }
}

/** Set keys in .env: a key's line is changed where it is, new keys are added at the end, every other line stays. */
export function saveDotEnv(updates: Record<string, string>, root = process.cwd()): void {
  const path = dotEnvPath(root);
  const lines = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/) : [];
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  const left = { ...updates };
  const out = lines.map((line) => {
    const m = LINE.exec(line);
    if (!m || !(m[1] in left)) return line;
    const v = left[m[1]];
    delete left[m[1]];
    return `${m[1]}="${v}"`;
  });
  for (const [k, v] of Object.entries(left)) out.push(`${k}="${v}"`);
  writeFileSync(path, `${out.join("\n")}\n`);
}
