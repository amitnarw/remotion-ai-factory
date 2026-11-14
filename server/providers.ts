/**
 * server/providers.ts — the server's view of ai.config.json and .env, through
 * the same readers and writers the CLI uses (src/generator/ai/provider-registry.ts
 * and src/generator/env.ts; 16-code-map-pipeline.md §7.5 items 6 and 7).
 *
 * The dashboard's changes go to ai.config.local.json, this machine's choices
 * laid over the tracked ai.config.json, which the dashboard never rewrites.
 * Keys go to .env, with every other line kept.
 */
import { join } from "path";
import { loadDotEnv, readDotEnv, saveDotEnv } from "../src/generator/env";
import { readAiConfig, saveAiConfig, type AiConfig } from "../src/generator/ai/provider-registry";

// Project root derived from THIS file (server must never depend on CWD —
// starting the process from server/ or elsewhere must not break paths).
const ROOT = join(__dirname, "..");

export type { AiConfig };
export type ProviderConfig = AiConfig["providers"][string];

/** This machine's AI config: the tracked defaults with its own choices over them. */
export function loadConfig(): AiConfig {
  return readAiConfig(ROOT).config;
}

/** What is wrong with either config file (shown on the Settings page), or []. */
export function configProblems(): string[] {
  return readAiConfig(ROOT).problems;
}

/** Save the dashboard's changes (to ai.config.local.json; the tracked file stays as it is). */
export function saveConfig(cfg: AiConfig) {
  saveAiConfig(cfg, ROOT);
}

/** The keys .env holds. */
export function loadEnv(): Record<string, string> {
  return readDotEnv(ROOT);
}

/** Apply .env over the server's environment, so a key saved a moment ago is used (and the jobs it starts inherit it). */
export function applyEnv(): void {
  loadDotEnv({ override: true, root: ROOT });
}

export function saveEnv(updates: Record<string, string>) {
  saveDotEnv(updates, ROOT);
}

export { ROOT };
