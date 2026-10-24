/**
 * scripts/probe-nvidia.ts — one cheap structured call to a provider to check
 * it answers, is JSON-clean, and how fast. Exercises the repo's real dispatch
 * (ai.config.json -> resolveModel -> generateText, the same path askModel's
 * non-ollama branch takes). Default: the NVIDIA NIM Nemotron super.
 *   npx tsx scripts/probe-nvidia.ts nvidia nvidia/nemotron-3.5-super-vl-120b-a12b
 */
import { loadDotEnv } from "../src/generator/env";
import { generateText } from "ai";
import type { ModelReference } from "../src/generator/ai/provider-registry";
import { loadAiConfig, resolveModel } from "../src/generator/ai/provider-registry";

async function main(): Promise<void> {
  loadDotEnv();
  const provider = process.argv[2] ?? "nvidia";
  const model = process.argv[3] ?? "nvidia/nemotron-3.5-super-vl-120b-a12b";
  const started = Date.now();
  const resolved = resolveModel(loadAiConfig(), provider, model);
  if (!resolved.reference) throw new Error(resolved.error ?? "cannot resolve");
  if (!resolved.hasKey) throw new Error(`API key not set for "${provider}" (expected in ${process.env[loadAiConfig().providers?.[provider]?.apiKeyEnv ?? ""] ? "" : "the env"})`);
  const r = await generateText({
    model: resolved.reference as ModelReference,
    system:
      "You write what-if video plans as strict JSON. Reply with ONE JSON object only - no markdown, no commentary.",
    prompt:
      'Give: {"title":"<short title about clocks in Paris>","mood":"<one of upbeat|tense|ambient>","beats":[{"say":"<one short line>"},{"say":"<one short line>"}]}.',
  });
  console.log(`[${provider}/${model}] ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(r.text.slice(0, 600));
}

main();
