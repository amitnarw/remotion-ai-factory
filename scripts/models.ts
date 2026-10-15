/**
 * scripts/models.ts
 *
 * Lists configured AI providers, their models, and API-key status.
 *
 * Usage:
 *   npm run models
 *
 * Output example:
 *   Provider   Package   Key configured   Models
 *   gateway    gateway   Yes              openai/gpt-5.4, ...
 *   openai     openai    No               gpt-5.4, ...
 */
import { loadAiConfig, getProviderStatus } from "../src/generator/ai/provider-registry";

function pad(s: string, len: number): string {
  return s + " ".repeat(Math.max(0, len - s.length));
}

function main() {
  const config = loadAiConfig();
  const status = getProviderStatus(config);

  console.log("AI Video Factory — Providers\n");
  console.log(
    `${pad("Provider", 12)} ${pad("Package", 14)} ${pad("Key", 16)} Models`,
  );
  console.log(
    `${"-".repeat(12)} ${"-".repeat(14)} ${"-".repeat(16)} ${"-".repeat(40)}`,
  );

  for (const p of status) {
    const key = p.keyConfigured ? "YES" : "no ";
    const models = (p.models ?? []).slice(0, 3).join(", ");
    const more = p.models && p.models.length > 3 ? ` (+${p.models.length - 3})` : "";
    console.log(
      `${pad(p.provider, 12)} ${pad(p.package ?? "-", 14)} ${pad(key, 16)} ${models}${more}`,
    );
  }

  const anyKey = status.some((p) => p.keyConfigured);
  console.log("");
  if (anyKey) {
    console.log("At least one provider key is configured — LLM spec generation is available.");
    console.log(`Default provider: ${config.defaultProvider ?? "gateway"}`);
  } else {
    console.log("No provider keys configured — only offline template families are available.");
    console.log("Copy .env.example to .env and add a key to enable LLM generation (any provider).");
  }
}

main();
