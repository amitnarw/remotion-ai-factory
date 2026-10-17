import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const CONFIG_PATH = join(ROOT, "ai.config.json");
const ENV_PATH = join(ROOT, ".env");

export interface ProviderConfig {
  package?: string;
  apiKeyEnv?: string;
  baseUrl?: string;
  models?: string[];
}

export interface AiConfig {
  defaultProvider?: string;
  defaultModel?: string;
  providers: Record<string, ProviderConfig>;
}

export function loadConfig(): AiConfig {
  if (!existsSync(CONFIG_PATH)) return { providers: {} };
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return { providers: {} };
  }
}

export function saveConfig(cfg: AiConfig) {
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

export function loadEnv(): Record<string, string> {
  if (!existsSync(ENV_PATH)) return {};
  const text = readFileSync(ENV_PATH, "utf8");
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return env;
}

export function saveEnv(updates: Record<string, string>) {
  const env = loadEnv();
  Object.assign(env, updates);
  const lines = Object.entries(env).map(([k, v]) => `${k}="${v}"`);
  writeFileSync(ENV_PATH, lines.join("\n") + "\n");
}
