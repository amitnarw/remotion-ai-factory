import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import { join, basename } from "path";
import fs from "fs";
import { loadConfig, saveConfig, loadEnv, saveEnv } from "./providers";
import { fetchProviderModels } from "./fetch-models";
import { createJob, getJob, runJob, subscribeSSE } from "./jobs";
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
  if (!name || !key) return res.status(400).json({ error: "bad request" });
  const cfg = loadConfig();
  const pc = cfg.providers[name];
  if (!pc || !pc.apiKeyEnv) return res.status(400).json({ error: "no key env for provider" });
  saveEnv({ [pc.apiKeyEnv]: key });
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

app.post("/api/providers/:name/test", (req, res) => {
  const { name } = req.params;
  const { model } = req.body as { model?: string };
  const cfg = loadConfig();
  const pc = cfg.providers[name];
  if (!pc) return res.status(400).json({ error: "unknown provider" });
  const env = loadEnv();
  const chosenModel = model || pc.models?.[0] || "";
  const keyConfigured = !pc.apiKeyEnv || !!env[pc.apiKeyEnv];
  const modelKnown = !pc.models || pc.models.length === 0 || pc.models.includes(chosenModel);
  if (!keyConfigured) {
    return res.json({ ok: false, model: chosenModel, error: `API key env ${pc.apiKeyEnv} not set` });
  }
  if (!modelKnown) {
    return res.json({ ok: false, model: chosenModel, error: "model not in provider list" });
  }
  res.json({ ok: true, model: chosenModel, note: "config valid (no network call made)" });
});

// ---------- Live model listing (real API data per provider) ----------
app.get("/api/providers/:name/models", (req, res) => {
  const { name } = req.params;
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
      res.json({
        ok: false,
        models: pc.models ?? [],
        source: "(previous static list)",
        error: e instanceof Error ? e.message : String(e),
      });
    });
});

// ---------- Jobs ----------
app.post("/api/generate", (req, res) => {
  const { premise, provider, model } = req.body as { premise?: string; provider?: string; model?: string };
  if (!premise) return res.status(400).json({ error: "premise required" });
  const trimmed = premise.trim();
  if (trimmed.length < 6) {
    return res.status(400).json({ error: "premise too short — describe a full 'what if' scenario" });
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
      return res.status(400).json({ error: `Provider "${provName}" is not configured (known: ${known}, or pick "offline")` });
    }
    // Gateway has a free tier that works without a key — only enforce for others.
    if (provCfg.apiKeyEnv && provName !== "gateway") {
      const key = savedEnv[provCfg.apiKeyEnv];
      if (!key) {
        return res.status(400).json({
          error: `API key not set for provider "${provName}" — save it in the Providers tab first`,
        });
      }
    }
    const resolution = resolveModel(config, provName, model);
    if (!resolution.reference || resolution.error) {
      return res.status(400).json({
        error: resolution.error ?? `Could not resolve model "${model ?? "(default)"}" for provider "${provName}"`,
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
  subscribeSSE(req.params.id, res);
});

// ---------- Videos ----------
app.get("/api/videos", (_req, res) => {
  const dir = join(process.cwd(), "output");
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

// ---------- Media ----------
app.use("/media", express.static(join(process.cwd(), "output"), { index: false }));

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
const UI_DIST = join(process.cwd(), "ui", "dist");
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
