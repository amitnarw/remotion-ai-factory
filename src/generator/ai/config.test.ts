/**
 * The AI config and .env, read and written one way for the CLI and the
 * server (16-code-map-pipeline.md §7.5 items 6 and 7).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadDotEnv, readDotEnv, saveDotEnv } from "../env";
import { AI_CONFIG_FILE, AI_LOCAL_FILE, readAiConfig, saveAiConfig } from "./provider-registry";

const tracked = {
  $schema: "http://json-schema.org/draft-07/schema#",
  defaultProvider: "ollama",
  providers: {
    ollama: { package: "ollama", baseUrl: "https://ollama.com/v1", apiKeyEnv: "OLLAMA_API_KEY", models: ["glm-5.3", "glm-5.3-flash"] },
    nvidia: { package: "openai", baseUrl: "https://integrate.api.nvidia.com/v1", apiKeyEnv: "NVIDIA_API_KEY", models: ["nemotron"] },
  },
  roles: { writer: { provider: "nvidia", model: "nemotron" } },
};

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "ai-config-"));
  writeFileSync(join(dir, AI_CONFIG_FILE), JSON.stringify(tracked, null, 2));
  return dir;
}

test("the dashboard's changes go to this machine's file; the tracked file is never written", () => {
  const dir = root();
  const before = readFileSync(join(dir, AI_CONFIG_FILE), "utf8");
  const cfg = readAiConfig(dir).config;
  assert.equal(cfg.roles?.writer?.model, "nemotron");
  cfg.roles = { ...cfg.roles, writer: { provider: "ollama", model: "glm-5.3-flash" }, director: { provider: "ollama", model: "glm-5.3" } };
  cfg.providers.ollama = { ...cfg.providers.ollama, models: ["glm-5.3", "glm-5.3-flash", "qwen3"] };
  delete cfg.providers.nvidia;
  saveAiConfig(cfg, dir);
  assert.equal(readFileSync(join(dir, AI_CONFIG_FILE), "utf8"), before, "ai.config.json is untouched");
  const local = JSON.parse(readFileSync(join(dir, AI_LOCAL_FILE), "utf8"));
  assert.deepEqual(Object.keys(local).sort(), ["providers", "roles"], "only what differs: no default provider");
  assert.equal(local.providers.nvidia, null, "a removed provider is null");
  assert.deepEqual(local.providers.ollama.models, ["glm-5.3", "glm-5.3-flash", "qwen3"]);
  const again = readAiConfig(dir).config;
  assert.equal(again.roles?.writer?.model, "glm-5.3-flash");
  assert.equal(again.roles?.director?.model, "glm-5.3");
  assert.equal(again.providers.nvidia, undefined);
  assert.equal(again.defaultProvider, "ollama");
  // Back to the shared settings: nothing differs, so the local file goes.
  saveAiConfig(JSON.parse(JSON.stringify(tracked)), dir);
  assert.equal(existsSync(join(dir, AI_LOCAL_FILE)), false);
});

test("a broken config file is named, not read as empty in silence", () => {
  const dir = root();
  writeFileSync(join(dir, AI_LOCAL_FILE), JSON.stringify({ roles: { writer: "ollama" } }));
  const { config, problems } = readAiConfig(dir);
  assert.equal(config.roles?.writer?.model, "nemotron", "the broken local file is left out; the shared one still counts");
  assert.match(problems.join(" "), /ai\.config\.local\.json is not a valid config/);
  writeFileSync(join(dir, AI_CONFIG_FILE), "{ not json");
  assert.match(readAiConfig(dir).problems.join(" "), /ai\.config\.json could not be read/);
});

test(".env: one parser; a save keeps the other lines; the CLI never overrides, the server does", () => {
  const dir = mkdtempSync(join(tmpdir(), "dotenv-"));
  writeFileSync(join(dir, ".env"), '# keys\nOLLAMA_API_KEY="old"\nOTHER=1\n');
  saveDotEnv({ OLLAMA_API_KEY: "new", FREESOUND_API_KEY: "fs" }, dir);
  assert.equal(readFileSync(join(dir, ".env"), "utf8"), '# keys\nOLLAMA_API_KEY="new"\nOTHER=1\nFREESOUND_API_KEY="fs"\n');
  assert.deepEqual(readDotEnv(dir), { OLLAMA_API_KEY: "new", OTHER: "1", FREESOUND_API_KEY: "fs" });
  const keep = process.env.FREESOUND_API_KEY;
  try {
    process.env.FREESOUND_API_KEY = "from-the-shell";
    loadDotEnv({ override: true, root: dir });
    assert.equal(process.env.FREESOUND_API_KEY, "fs", "the server applies what was saved");
  } finally {
    if (keep === undefined) delete process.env.FREESOUND_API_KEY;
    else process.env.FREESOUND_API_KEY = keep;
  }
});
