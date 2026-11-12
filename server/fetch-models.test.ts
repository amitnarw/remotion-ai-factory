// Run: npx tsx --test server/fetch-models.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchProviderModels } from "./fetch-models";

test("an ollama provider lists its models from Ollama's own /api/tags", async () => {
  const real = globalThis.fetch;
  const asked: { url: string; auth?: string }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    asked.push({ url: String(input), auth: headers.Authorization });
    return new Response(JSON.stringify({ models: [{ name: "glm-5.3-flash" }, { name: "deepseek-v3.1:671b" }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const cloud = await fetchProviderModels("ollama", { package: "ollama", baseUrl: "https://ollama.com/v1" }, "key");
    assert.deepEqual(cloud.models, ["deepseek-v3.1:671b", "glm-5.3-flash"]);
    assert.deepEqual(asked[0], { url: "https://ollama.com/api/tags", auth: "Bearer key" });
    // A local server on Ollama's port, and an entry without a base URL (the cloud).
    await fetchProviderModels("local", { package: "ollama", baseUrl: "http://localhost:11434/v1" }, "");
    assert.equal(asked[1].url, "http://localhost:11434/api/tags");
    await fetchProviderModels("ollama", { package: "ollama" }, "key");
    assert.equal(asked[2].url, "https://ollama.com/api/tags");
  } finally {
    globalThis.fetch = real;
  }
});
