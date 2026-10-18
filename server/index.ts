import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import { join, basename } from "path";
import fs from "fs";
import { loadConfig, saveConfig, loadEnv, saveEnv, ROOT } from "./providers";
import { keyUrlFor, actionable } from "./error-hints";
import { fetchProviderModels } from "./fetch-models";
import { createJob, createStoryJob, getJob, getAllJobs, premiseSlug, runJob, runStoryJob, subscribeSSE } from "./jobs";
import { STORY_META } from "../src/whatif/videos/story-meta";
import { loadAiConfig, resolveModel } from "../src/generator/ai/provider-registry";
import { buildFamilySpec } from "../src/generator/build-family-spec";

const app = express();
app.use(cors());
app.use(express.json());

// ---------- Providers ----------
app.get("/api/providers", (_req, res) => {
  const cfg = loadConfig();
  const env = loadEnv();
  const out = Object.entries(cfg.providers).map(([name, c]) => ({
    name,
    package: c.package,
    apiKeyEnv: c.apiKeyEnv,
    baseUrl: c.baseUrl,
    models: c.models,
    keyConfigured: !!env[c.apiKeyEnv!],
    isDefault: name === cfg.defaultProvider,
  }));
  res.json({ providers: out, defaultProvider: cfg.defaultProvider });
});

app.post("/api/providers/:name/key", (req, res) => {
  const { name } = req.params;
  const { key } = req.body as { key?: string };
  if (!name) return res.status(400).json({ error: "bad request" });
  const cfg = loadConfig();
  const pc = cfg.providers[name];
  if (!pc || !pc.apiKeyEnv) {
    return res.status(400).json({ error: "provider doesn't need an API key (local or keyless)" });
  }
  const k = (key ?? "").trim();
  if (!k) {
    return res.status(400).json({
      error: "empty key",
      fix: `paste your full API key — create one at ${keyUrlFor(name)}`,
    });
  }
  if (/[\r\n"]/.test(k)) {
    return res.status(400).json({
      error: "key contains invalid characters (quotes or line breaks)",
      fix: "paste the key exactly as copied — no surrounding quotes, single line",
    });
  }
  if (k.length < 8) {
    return res.status(400).json({
      error: `key too short to be valid (${k.length} chars)`,
      fix: `copy the FULL key from ${keyUrlFor(name)} — keys are much longer`,
    });
  }
  saveEnv({ [pc.apiKeyEnv]: k });
  res.json({ ok: true });
});

app.post("/api/providers/:name/config", (req, res) => {
  const { name } = req.params;
  const { baseUrl, models } = req.body as { baseUrl?: string; models?: string[] };
  const cfg = loadConfig();
  const pc = cfg.providers[name];
  if (!pc) return res.status(400).json({ error: "unknown provider" });
  if (baseUrl !== undefined) pc.baseUrl = baseUrl;
  if (models !== undefined) pc.models = models;
  saveConfig(cfg);
  res.json({ ok: true });
});

app.post("/api/providers", (req, res) => {
  const { name, package: pkg, baseUrl, apiKeyEnv } = req.body as {
    name?: string; package?: string; baseUrl?: string; apiKeyEnv?: string;
  };
  if (!name) return res.status(400).json({ error: "name required" });
  const cfg = loadConfig();
  cfg.providers[name] = { package: pkg, baseUrl, apiKeyEnv, models: [] };
  saveConfig(cfg);
  res.json({ ok: true });
});

app.post("/api/providers/:name/test", async (req, res) => {
  const { name } = req.params;
  const { model } = req.body as { model?: string };
  const cfg = loadConfig();
  const pc = cfg.providers[name];
  if (!pc) return res.status(400).json({ error: "unknown provider" });
  const env = loadEnv();
  const chosenModel = model || pc.models?.[0] || "";
  const apiKey = pc.apiKeyEnv ? env[pc.apiKeyEnv] ?? "" : "";

  // Keyed (non-gateway) providers can't work without a key — fail fast with a fix.
  if (pc.apiKeyEnv && !apiKey && name !== "gateway") {
    return res.json({
      ok: false,
      model: chosenModel,
      error: `API key not set (${pc.apiKeyEnv})`,
      fix: `Save your key in the Providers tab — create one at ${keyUrlFor(name)}`,
    });
  }

  // REAL connection test: live-call the provider's model-listing endpoint.
  const t0 = Date.now();
  try {
    const result = await fetchProviderModels(name, pc, apiKey);
    pc.models = result.models;
    saveConfig(cfg);
    const base = {
      model: chosenModel,
      latencyMs: Date.now() - t0,
      modelsCount: result.models.length,
    };

    // For providers whose model catalog is PUBLIC (ollama, openrouter,
    // gateway), the list proves nothing about the key — the key only matters
    // for generation. Run a real 1-token generation as the credential check.
    if (name === "ollama" || name === "openrouter" || name === "gateway") {
      const cfg2 = loadAiConfig();
      for (const [k, v] of Object.entries(loadEnv())) process.env[k] = v;
      const resolution = resolveModel(cfg2, name, chosenModel);
      if (!resolution.reference) {
        return res.json({
          ...base,
          ok: false,
          error: resolution.error ?? "could not resolve model reference",
          fix: "Pick another model on the Generate tab, or check the provider's baseUrl/package in ai.config.json",
        });
      }
      const { generateText } = await import("ai");
      const gen = await generateText({
        model: resolution.reference,
        prompt: "Reply with the single word: OK",
        maxOutputTokens: 10,
      });
      return res.json({
        ...base,
        ok: true,
        note: `key verified by a real generation (${gen.usage?.totalTokens ?? 0} tokens in ${Date.now() - t0}ms)`,
      });
    }

    return res.json({
      ...base,
      ok: true,
      note: `${result.models.length} models verified live from ${result.source}`,
    });
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const { message, fix } = actionable(raw, name);
    return res.json({
      ok: false,
      model: chosenModel,
      error: message,
      fix,
      modelsCount: (pc.models ?? []).length,
    });
  }
});

// ---------- Live model listing (real API data per provider) ----------
app.get("/api/providers/:name/models", (req, res) => {  const { name } = req.params;
  const cfg = loadConfig();
  const pc = cfg.providers[name];
  if (!pc) return res.status(404).json({ error: "unknown provider" });
  const env = loadEnv();
  const apiKey = pc.apiKeyEnv ? env[pc.apiKeyEnv] ?? "" : "";
  fetchProviderModels(name, pc, apiKey)
    .then((result) => {
      // Persist the live list so the Generate tab + CLI use real models.
      pc.models = result.models;
      saveConfig(cfg);
      res.json(result);
    })
    .catch((e) => {
      const raw = e instanceof Error ? e.message : String(e);
      const { message, fix } = actionable(raw, name);
      res.json({
        ok: false,
        models: pc.models ?? [],
        source: "(previous list)",
        error: message,
        fix,
      });
    });
});

// ---------- Story engine (agent-authored compositions) ----------
app.get("/api/stories", (_req, res) => {
  res.json({
    stories: STORY_META.map((v) => ({
      slug: v.slug,
      title: v.title,
      durationSec: v.durationInFrames / v.fps,
      fps: v.fps,
    })),
  });
});

app.post("/api/generate-story", (req, res) => {
  const { slug } = req.body as { slug?: string };
  const meta = slug ? STORY_META.find((v) => v.slug === slug) : undefined;
  if (!meta) {
    return res.status(400).json({
      error: slug
        ? `No registered story video with slug "${slug}".`
        : "slug required",
      fix: "Pick a video from the list on the Generate tab — registered story videos live in src/whatif/videos/",
    });
  }
  // Never render the same story twice concurrently (same output/report).
  for (const other of getAllJobs()) {
    if (
      (other.status === "running" || other.status === "queued") &&
      other.engine === "story" &&
      other.logs.some((l) => l.includes(`[render] story-${slug}`))
    ) {
      return res.status(409).json({
        error: `Already rendering "${meta.title}" (job ${other.id}) — wait for it to finish`,
        jobId: other.id,
      });
    }
  }
  const job = createStoryJob(meta.slug, meta.title);
  runStoryJob(job, meta.slug);
  res.json({ jobId: job.id });
});

// ---------- Jobs ----------
app.post("/api/generate", async (req, res) => {
  const { premise, provider, model } = req.body as { premise?: string; provider?: string; model?: string };
  if (!premise) {
    return res.status(400).json({ error: "premise required", fix: 'type a "what if …" question, e.g. "What if gravity disappeared for just 5 seconds?"' });
  }
  const trimmed = premise.trim();
  if (trimmed.length < 6) {
    return res.status(400).json({
      error: "premise too short — describe a full 'what if' scenario",
      fix: 'e.g. "What if gravity disappeared for just 5 seconds?"',
    });
  }

  // Fail fast BEFORE spawning the CLI: validate provider + key + resolution.
  const savedEnv = loadEnv();
  for (const [k, v] of Object.entries(savedEnv)) process.env[k] = v;
  const config = loadAiConfig();
  const provName = provider ?? config.defaultProvider ?? "gateway";

  if (provName === "offline") {
    // Offline template families need no provider/key — but only 11 known
    // premises are templated. Catch mismatches here instead of mid-render.
    if (!buildFamilySpec(trimmed)) {
      return res.status(400).json({
        error:
          'No offline template matches this premise. Supported families: gravity, time-stop, ' +
          "spin-stop, air, water, oxygen, electrons, protons, neutrons, light, sun-set — " +
          "or configure an AI provider key for arbitrary premises.",
      });
    }
  } else {
    const provCfg = config.providers?.[provName];
    if (!provCfg) {
      const known = Object.keys(config.providers ?? {}).join(", ") || "(none)";
      return res.status(400).json({
        error: `Provider "${provName}" is not configured`,
        fix: `Add it in the Providers tab, or pick one of: ${known}, or "offline"`,
      });
    }
    // Local endpoints fail cryptically mid-render — ping them now, fix now.
    const baseUrl = provCfg.baseUrl ?? "";
    if (/^(http:\/\/)?(localhost|127\.0\.0\.1)/.test(baseUrl)) {
      try {
        await fetch(
          baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "") + "/api/tags",
          { signal: AbortSignal.timeout(2000) },
        );
      } catch {
        return res.status(400).json({
          error: `Local endpoint ${baseUrl} is not reachable`,
          fix: "Start the local server (e.g. `ollama serve`) first — or switch the provider to its cloud URL in the Providers tab — don't render into a dead endpoint",
        });
      }
    }
    // Gateway has a free tier that works without a key — only enforce for others.
    if (provCfg.apiKeyEnv && provName !== "gateway") {
      const key = savedEnv[provCfg.apiKeyEnv];
      if (!key) {
        return res.status(400).json({
          error: `API key not set for provider "${provName}" (${provCfg.apiKeyEnv})`,
          fix: `Save your key in the Providers tab — create one at ${keyUrlFor(provName)}`,
        });
      }
    }
    const resolution = resolveModel(config, provName, model);
    if (!resolution.reference || resolution.error) {
      return res.status(400).json({
        error: resolution.error ?? `Could not resolve model "${model ?? "(default)"}" for provider "${provName}"`,
        fix: `Check that provider "${provName}"'s baseUrl/package in ai.config.json are correct, or pick another provider`,
      });
    }
    const chosenModelId = model ?? provCfg.models?.[0];
    if (!chosenModelId) {
      return res.status(400).json({
        error: `Provider "${provName}" has no model available`,
        fix: "Open the Providers tab and click 'Fetch models' to load the real model list, then pick one on the Generate tab",
      });
    }
  }

  // Never run two renders of the same premise at once — they share the same
  // output filenames and would overwrite each other.
  const newSlug = premiseSlug(trimmed);
  for (const other of getAllJobs()) {
    if (
      (other.status === "running" || other.status === "queued") &&
      premiseSlug(other.premise) === newSlug
    ) {
      return res.status(409).json({
        error: `Already rendering this premise (job ${other.id}) — wait for it to finish or view it in the running panel`,
        jobId: other.id,
      });
    }
  }

  const job = createJob(trimmed, provName, model);
  runJob(job);
  res.json({ jobId: job.id });
});

app.get("/api/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "not found" });
  res.json(job);
});

app.get("/api/jobs/:id/events", (req, res) => {
  // Unknown ids (e.g. after a server restart) must 404 immediately —
  // otherwise the browser's EventSource waits on a dead stream forever.
  if (!getJob(req.params.id)) {
    return res.status(404).json({ error: "unknown or expired job — the server may have restarted; start again" });
  }
  subscribeSSE(req.params.id, res);
});

// ---------- Videos ----------
app.get("/api/videos", (_req, res) => {
  const dir = join(ROOT, "output");
  if (!fs.existsSync(dir)) return res.json([]);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith("-report.json"));
  const videos = files.map((f) => {
    const id = f.replace("-report.json", "");
    const report = JSON.parse(fs.readFileSync(join(dir, f), "utf8"));
    const reviewDir = (report.id || id) + "-review";
    const reviewExists = fs.existsSync(join(dir, reviewDir));
    return {
      id,
      ...report,
      output: report.output ? basename(report.output) : undefined,
      spec: report.spec ? basename(report.spec) : undefined,
      reviewFolder: reviewExists ? reviewDir : undefined,
    };
  });
  videos.sort((a, b) => (b.generatedAt || 0) - (a.generatedAt || 0));
  res.json(videos);
});

// ---------- Delete a video (all artifacts for one premise id) ----------
app.delete("/api/videos/:id", (req, res) => {
  const { id } = req.params;
  // Strict id format blocks path traversal (e.g. "..") before any fs call.
  if (!/^[a-z0-9-]+$/.test(id)) {
    return res.status(400).json({ error: "invalid video id" });
  }
  const dir = join(ROOT, "output");
  if (!fs.existsSync(dir)) return res.status(404).json({ error: "video not found" });
  let deleted = 0;
  const errors: string[] = [];
  for (const f of fs.readdirSync(dir)) {
    const isOurs =
      (f.endsWith(".mp4") && f.startsWith(id + "-")) ||
      f === `${id}-spec.json` ||
      f === `${id}-report.json` ||
      f === `FAILED-${id}.log`;
    if (!isOurs) continue;
    try {
      fs.unlinkSync(join(dir, f));
      deleted += 1;
    } catch (e) {
      errors.push(`${f}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const reviewDir = join(dir, `${id}-review`);
  if (fs.existsSync(reviewDir)) {
    try {
      fs.rmSync(reviewDir, { recursive: true, force: true });
      deleted += 1;
    } catch (e) {
      errors.push(`${id}-review: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (deleted === 0) {
    return res.status(404).json({ error: `nothing found for "${id}"` });
  }
  res.json({ ok: true, deleted, errors: errors.length ? errors : undefined });
});

// ---------- Media ----------
app.use("/media", express.static(join(ROOT, "output"), { index: false }));

// ---------- JSON 404 for API/media (never return HTML) ----------
app.use("/api", (_req, res) => {
  res.status(404).type("application/json").send(JSON.stringify({ error: "api route not found" }));
});
app.use("/media", (_req, res) => {
  res.status(404).type("application/json").send(JSON.stringify({ error: "media file not found" }));
});

// ---------- Catch-all JSON error middleware ----------
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  void _next;
  res.status(err.status || 500).type("application/json").send(JSON.stringify({ error: err.message || "internal server error" }));
};
app.use(errorHandler);

// ---------- Built UI fallback ----------
// Express 5 route patterns don't accept bare "*", so use plain middleware.
const UI_DIST = join(ROOT, "ui", "dist");
if (fs.existsSync(join(UI_DIST, "index.html"))) {
  app.use(express.static(UI_DIST, { index: false }));
  app.use((_req, res, next) => {
    if (_req.path.startsWith("/api") || _req.path.startsWith("/media")) {
      return next();
    }
    res.sendFile(join(UI_DIST, "index.html"));
  });
}

const PORT = 5178;
app.listen(PORT, "127.0.0.1", () => {
  console.log(`Server listening on http://127.0.0.1:${PORT}`);
});
