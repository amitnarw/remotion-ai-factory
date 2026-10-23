import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import { join, basename } from "path";
import fs from "fs";
import { loadConfig, saveConfig, loadEnv, saveEnv, ROOT } from "./providers";
const FFMPEG = join(ROOT, "node_modules", "@remotion", "compositor-win32-x64-msvc", "ffmpeg.exe");
import { keyUrlFor, actionable } from "./error-hints";
import { fetchProviderModels } from "./fetch-models";
import { createJob, getJob, getAllJobs, premiseSlug, runJob, cancelJob, subscribeSSE, removeJobFile } from "./jobs";
import { loadAiConfig, resolveModel } from "../src/generator/ai/provider-registry";
import { buildFamilySpec } from "../src/generator/build-family-spec";
import { SettingsSchema, type VideoSettings } from "../src/generator/spec.schema";
import { ROLE_DEFS, ROLE_NAMES, pickRoleModel } from "../src/generator/ai/roles";
import { resolveRoleModels } from "../src/generator/pipeline/llm";
import { canReassemble, reassemble } from "../src/generator/pipeline/run";
import { ttsStatus, startInstall, getTtsJob } from "./tts";
import { KNOWN_VOICES, VOXCPM_VOICE_DESCRIPTIONS, TTS_ENGINES, voxDescription } from "../src/generator/voices";
import { resolveTtsPython } from "../src/generator/tts-python";
import { cacheKey, synthesizeLines } from "../src/generator/tts";
import { registerFilmRoutes } from "./film";

const app = express();
app.use(cors());
app.use(express.json());
// Editor (Phase 4): versioned edits, "Ask AI", undo/redo.
registerFilmRoutes(app);

// ---------- Providers ----------
/** Model role assignments: which provider/model each pipeline step uses. */
app.get("/api/roles", (_req, res) => {
  const cfg = loadConfig();
  res.json({
    roles: ROLE_DEFS.map((d) => ({ ...d, assignment: cfg.roles?.[d.name] ?? null })),
    providers: Object.entries(cfg.providers).map(([name, c]) => ({ name, models: c.models ?? [] })),
    defaultProvider: cfg.defaultProvider ?? null,
  });
});

app.put("/api/roles", (req, res) => {
  const body = req.body as { roles?: Record<string, { provider?: string; model?: string } | null> };
  const cfg = loadConfig();
  const next: Record<string, { provider?: string; model?: string }> = { ...(cfg.roles ?? {}) };
  for (const [name, value] of Object.entries(body.roles ?? {})) {
    if (!ROLE_NAMES.includes(name)) {
      return res.status(400).json({ error: `unknown role "${name}"`, fix: `Use one of: ${ROLE_NAMES.join(", ")}` });
    }
    if (value === null || (!value?.provider && !value?.model)) {
      delete next[name]; // cleared: the role falls back to the default provider
      continue;
    }
    const provider = (value.provider ?? "").trim();
    if (!provider || !cfg.providers[provider]) {
      return res.status(400).json({
        error: `provider "${provider}" is not configured`,
        fix: "Add it in the Providers tab first",
      });
    }
    const model = (value.model ?? "").trim();
    if (!model) {
      return res.status(400).json({ error: `pick a model for the ${name} role`, fix: "Choose a model from the list" });
    }
    const known = cfg.providers[provider].models ?? [];
    if (known.length && !known.includes(model)) {
      return res.status(400).json({
        error: `model "${model}" is not in the ${provider} list`,
        fix: "Open the provider card and press Get models, then choose again",
      });
    }
    next[name] = { provider, model };
  }
  cfg.roles = next;
  saveConfig(cfg);
  res.json({ ok: true, roles: next });
});

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

app.post("/api/providers/:name/default", (req, res) => {
  const { name } = req.params;
  const cfg = loadConfig();
  if (!cfg.providers[name]) return res.status(400).json({ error: "unknown provider" });
  cfg.defaultProvider = name;
  saveConfig(cfg);
  res.json({ ok: true });
});

app.delete("/api/providers/:name", (req, res) => {
  const { name } = req.params;
  const cfg = loadConfig();
  if (!cfg.providers[name]) return res.status(404).json({ error: "unknown provider" });
  if (cfg.defaultProvider === name) cfg.defaultProvider = undefined;
  delete cfg.providers[name];
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

// ---------- Plan Studio: spec engine (AI writes the plan, you approve) ----------
app.post("/api/plan", async (req, res) => {
  const body = req.body as { input?: string; premise?: string; provider?: string; model?: string; audio?: unknown; settings?: unknown };
  const premise = (body.input ?? body.premise ?? "").trim();
  if (premise.length < 6) {
    return res.status(400).json({
      error: "the idea is missing or too short",
      fix: 'Type a full "what if" scenario, e.g. "What if money doubled every 3 seconds?"',
    });
  }
  // Validate settings before anything is created, so a bad request leaves no job behind.
  let settings: VideoSettings | undefined;
  if (body.settings !== undefined) {
    const parsed = SettingsSchema.safeParse(body.settings);
    if (!parsed.success) {
      return res.status(400).json({
        error: `invalid video settings: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
        fix: "Pick a format (9:16, 16:9 or 1:1), a length within the format's limit, a scene count from 1 to 12, and a quality of draft or final",
      });
    }
    settings = parsed.data;
  }
  // An explicit provider/model from the request wins; otherwise the writer role decides, never mixing providers.
  const pick = pickRoleModel(
    loadConfig().roles,
    "writer",
    typeof body.provider === "string" ? body.provider : undefined,
    typeof body.model === "string" ? body.model : undefined,
  );
  const provider = pick.provider;
  const model = pick.model;

  // Fail fast BEFORE spawning: validate provider + key + resolution.
  const savedEnv = loadEnv();
  for (const [k, v] of Object.entries(savedEnv)) process.env[k] = v;
  const config = loadAiConfig();
  const provName = provider ?? config.defaultProvider ?? "gateway";
  // Test mode: recorded fixtures stand in for every model, so no key or model is needed.
  const fixtures = !!process.env.FACTORY_LLM_FIXTURES;
  if (fixtures) {
    console.log(`[plan] FACTORY_LLM_FIXTURES is set: using recorded fixtures, skipping provider checks`);
  } else if (provName === "offline") {
    if (!buildFamilySpec(premise)) {
      return res.status(400).json({
        error:
          'No offline template matches this premise and the plan always comes from the AI. ' +
          "Supported offline families: gravity, time-stop, spin-stop, air, water, oxygen, " +
          "electrons, protons, neutrons, light, sun-set, doubling — " +
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
    const baseUrl = provCfg.baseUrl ?? "";
    if (/^(http:\/\/)?(localhost|127\.0\.0\.1)/.test(baseUrl)) {
      try {
        await fetch(baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "") + "/api/tags", {
          signal: AbortSignal.timeout(2000),
        });
      } catch {
        return res.status(400).json({
          error: `Local endpoint ${baseUrl} is not reachable`,
          fix: "Start the local server (e.g. `ollama serve`) first — or switch the provider to its cloud URL in the Providers tab — don't render into a dead endpoint",
        });
      }
    }
    if (provCfg.apiKeyEnv && provName !== "gateway") {
      if (!savedEnv[provCfg.apiKeyEnv]) {
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
  }

  // One plan job at a time (the writer is the expensive step).
  const busy = getAllJobs().find((j) => j.engine === "plan" && (j.status === "running" || j.status === "queued"));
  if (busy) {
    return res.status(409).json({
      error: `A plan is already being written (job ${busy.id}) — wait for it to finish`,
      jobId: busy.id,
    });
  }
  // Every pipeline role must have a working key (roles without their own
  // model use the writer's).
  if (!fixtures && provName !== "offline") {
    const roleModels = resolveRoleModels(["writer", "director", "sound", "critic"], {
      provider: typeof body.provider === "string" ? body.provider : undefined,
      model: typeof body.model === "string" ? body.model : undefined,
    });
    for (const [role, rm] of Object.entries(roleModels)) {
      const pc = config.providers?.[rm.provider];
      if (!pc) {
        return res.status(400).json({ error: `the ${role} role uses provider "${rm.provider}", which is not configured`, fix: "Fix it in Providers → Model roles" });
      }
      if (pc.apiKeyEnv && rm.provider !== "gateway" && !savedEnv[pc.apiKeyEnv]) {
        return res.status(400).json({
          error: `API key not set for provider "${rm.provider}" (used by the ${role} role)`,
          fix: `Save your key in the Providers tab — create one at ${keyUrlFor(rm.provider)}`,
        });
      }
      if (!rm.model) {
        return res.status(400).json({ error: `no model chosen for the ${role} role`, fix: "Choose one in Providers → Model roles" });
      }
    }
  }

  const job = createJob(premise, provName, model);
  job.engine = "plan";
  (job as any).explicitModel = typeof body.provider === "string" || typeof body.model === "string";
  if (body.audio) {
    (job as any).audio = body.audio;
    // Voice comes first in the pipeline, so the plan needs the voice settings too.
    const rel = `output/plan-${job.id}-audio.json`;
    fs.mkdirSync(join(ROOT, "output"), { recursive: true });
    fs.writeFileSync(join(ROOT, rel), JSON.stringify(body.audio, null, 2));
    (job as any).audioFile = rel;
  }
  if (settings) (job as any).settings = settings;
  runJob(job, { noRender: true });
  res.json({ jobId: job.id });
});

/** Read the spec a finished plan job produced. */
app.get("/api/spec/:jobId", (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({
      error: "unknown or expired job — the server may have restarted; write the idea again",
    });
  }
  if (job.status === "running" || job.status === "queued") {
    return res.json({ ready: false, status: job.status, stage: job.stage, progress: job.progress });
  }
  if (job.status === "failed") {
    return res.status(500).json({ error: job.error ?? "plan failed — see the job logs" });
  }
  if (!job.specId) {
    return res.status(404).json({ error: "this job produced no plan — write the idea again" });
  }
  const p = join(ROOT, "output", `${job.specId}-spec.json`);
  try {
    const spec = JSON.parse(fs.readFileSync(p, "utf8"));
    res.json({ ready: true, specId: job.specId, spec, provider: job.provider, model: job.model });
  } catch {
    res.status(500).json({
      error: `the plan file for "${job.specId}" is missing on disk`,
      fix: "Write the idea again from Step 1",
    });
  }
});

/**
 * Give a character a different voice and rebuild the plan from its saved stage
 * files (no model calls). Kitten lines are synthesized again (cached), others
 * are re-estimated; the render measures everything anyway.
 */
app.post("/api/plan/:specId/recast", async (req, res) => {
  const { specId } = req.params;
  const { name, voice } = req.body as { name?: string; voice?: string };
  if (!/^[a-z0-9-]+$/.test(specId) || !name || !voice) {
    return res.status(400).json({ error: "specId, character name and voice are required" });
  }
  if (!canReassemble(specId)) {
    return res.status(404).json({ error: `plan "${specId}" has no saved stages`, fix: "Write the plan again" });
  }
  try {
    const planPath = join(ROOT, "output", specId, "plan.json");
    const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
    plan.audio = plan.audio ?? {};
    plan.audio.dialogs = { ...(plan.audio.dialogs ?? {}), voices: { ...(plan.audio.dialogs?.voices ?? {}), [name]: voice } };
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
    const { spec, warnings } = await reassemble(specId, "plan");
    fs.writeFileSync(join(ROOT, "output", `${specId}-spec.json`), JSON.stringify(spec, null, 2));
    res.json({ spec, warnings });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Render an approved plan's spec (never renders without this call). */
app.post("/api/render-spec", (req, res) => {
  const { specId, audio, chunked } = req.body as { specId?: string; audio?: unknown; chunked?: boolean };
  if (!specId || !/^[a-z0-9-]+$/.test(specId)) {
    return res.status(400).json({ error: "specId required", fix: "Approve from the review screen" });
  }
  const specPathRel = join("output", `${specId}-spec.json`);
  const specPath = join(ROOT, specPathRel);
  if (!fs.existsSync(specPath)) {
    return res.status(404).json({
      error: `No approved plan "${specId}" on the server`,
      fix: "Write the idea again from Step 1",
    });
  }
  let title = specId;
  try {
    const spec = JSON.parse(fs.readFileSync(specPath, "utf8")) as { title?: string };
    if (spec.title) title = spec.title;
  } catch { /* title fallback */ }
  for (const other of getAllJobs()) {
    if (
      (other.status === "running" || other.status === "queued") &&
      (other.specId === specId || (other.premise && premiseSlug(other.premise) === premiseSlug(title)))
    ) {
      return res.status(409).json({
        error: `"${title}" is already rendering (job ${other.id})`,
        jobId: other.id,
      });
    }
  }
  const job = createJob(title);
  job.specId = specId;
  if (audio) (job as any).audio = audio;
  if (audio) {
    try {
      const sidecar = join(ROOT, "output", `${specId}-audio.json`);
      fs.writeFileSync(sidecar, JSON.stringify(audio, null, 2));
    } catch { /* ignore */ }
  }
  const extra = ["--from-spec", specPathRel.replace(/\\/g, "/")];
  if (audio) extra.push("--audio-file", `output/${specId}-audio.json`);
  // The editor's Make-the-video button renders through the chunked, cached renderer.
  if (chunked) extra.push("--chunked");
  runJob(job, { extraArgs: extra });
  res.json({ jobId: job.id });
});

app.get("/api/jobs", (_req, res) => {
  res.json(
    getAllJobs().map((j) => ({
      id: j.id,
      status: j.status,
      premise: j.premise,
      createdAt: j.createdAt,
    })),
  );
});
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

// ---------- Voice sample (audition) ----------
/**
 * Voice audition. Goes through the same cache as the render (so a voice heard
 * once is instant next time) and runs the engine without blocking the server:
 * on a CPU, Kitten 2 needs ~30 s to load and ~40-50 s per line.
 */
/** Audition syntheses in progress, by cache key. */
const sampleJobs = new Map<string, Promise<string>>();
app.post("/api/voice-sample", async (req, res) => {
  const body = req.body as { engine?: string; voice?: string; voiceDesc?: string; text?: string };
  const engine: "kitten2" | "voxcpm2" = body.engine === "voxcpm2" ? "voxcpm2" : "kitten2";
  if (!resolveTtsPython(engine)) {
    return res.status(400).json({ error: "engine not installed", fix: "Install it from the Setup tab first" });
  }
  const text = body.text || "Hey there! This is my real voice. Let's make something amazing together.";
  const voice = body.voice || (engine === "kitten2" ? "Bruno" : "narrator-calm");
  const voiceDesc = engine === "voxcpm2" ? voxDescription(voice, body.voiceDesc) : undefined;
  const key = cacheKey({ engine, voice, voiceDesc, text });
  try {
    // One synthesis per distinct sample: a second click on the same voice waits
    // for the first, and each sample gets its own job folder, so two auditions
    // never share (or overwrite) a job file. Samples stay out of public/.
    let job = sampleJobs.get(key);
    if (!job) {
      const id = `_sample-${key.slice(0, 12)}`;
      const line = { id: "sample", text, at: 0, engine, voice, voiceDesc, kind: "narration" as const };
      job = synthesizeLines([line], id, { publish: false })
        .then((m) => m.lines[0].file)
        .finally(() => {
          sampleJobs.delete(key);
          fs.rmSync(join(ROOT, "output", `${id}-voice`), { recursive: true, force: true });
        });
      sampleJobs.set(key, job);
    }
    const wavPath = await job;
    if (!fs.existsSync(wavPath)) throw new Error("the engine produced no file");
    res.setHeader("Content-Type", "audio/wav");
    // The cache is under .cache/; sendFile refuses dot-folders unless told otherwise.
    res.sendFile(wavPath, { dotfiles: "allow" });
  } catch (e) {
    res.status(500).json({ error: "sample generation failed", detail: (e instanceof Error ? e.message : String(e)).slice(-500) });
  }
});
app.get("/api/videos", (_req, res) => {
  const dir = join(ROOT, "output");
  if (!fs.existsSync(dir)) return res.json([]);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith("-report.json"));
  const videos = files.map((f) => {
    const id = f.replace("-report.json", "");
    const report = JSON.parse(fs.readFileSync(join(dir, f), "utf8"));
    const reviewDir = (report.id || id) + "-review";
    const reviewExists = fs.existsSync(join(dir, reviewDir));
    const thumbPath = join(dir, `${id}-thumb.jpg`);
    if (!fs.existsSync(thumbPath) && report.output) {
      const mp4Abs = join(dir, basename(report.output));
      if (fs.existsSync(mp4Abs) && fs.existsSync(FFMPEG)) {
        try {
          const { spawn: sp } = require("child_process");
          sp(FFMPEG, ["-y", "-i", mp4Abs, "-ss", "00:00:01", "-vframes", "1", "-q:v", "3", thumbPath], { stdio: "ignore", detached: true }).unref();
        } catch { /* ignore */ }
      }
    }
    return {
      id,
      ...report,
      output: report.output ? basename(report.output) : undefined,
      spec: report.spec ? basename(report.spec) : undefined,
      reviewFolder: reviewExists ? reviewDir : undefined,
      thumbnail: fs.existsSync(thumbPath) ? `${id}-thumb.jpg` : undefined,
    };
  });
  videos.sort((a, b) => (b.generatedAt || 0) - (a.generatedAt || 0));
  res.json(videos);
});

// ---------- TTS model status / install ----------
app.get("/api/tts/status", (_req, res) => {
  res.json(ttsStatus());
});

app.post("/api/tts/install/:engine", (req, res) => {
  const engine = req.params.engine as "kitten2" | "voxcpm2";
  if (engine !== "kitten2" && engine !== "voxcpm2") {
    return res.status(400).json({ error: "unknown engine" });
  }
  const id = startInstall(engine);
  res.json({ jobId: id });
});

app.get("/api/tts/job/:id", (req, res) => {
  const job = getTtsJob(req.params.id);
  if (!job) return res.status(404).json({ error: "unknown install job" });
  res.json({
    id: job.id,
    engine: job.engine,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    message: job.message,
    error: job.error,
    logTail: job.log.slice(-20),
    startedAt: job.startedAt,
    lastActivityAt: job.lastActivityAt,
  });
});

// ---------- TTS voices / engines ----------
app.get("/api/voices", (req, res) => {
  const engine = (req.query.engine as string) || "kitten2";
  const kittenPython = resolveTtsPython("kitten2");
  const voxcpmPython = resolveTtsPython("voxcpm2");
  const kittenAvailable = !!kittenPython;
  const voxcpmAvailable = !!voxcpmPython;
  if (engine === "voxcpm2") {
    return res.json({
      engine,
      available: voxcpmAvailable,
      voices: VOXCPM_VOICE_DESCRIPTIONS.map((v) => ({ id: v.id, pace: "steady" as const, sample: null })),
      descriptions: VOXCPM_VOICE_DESCRIPTIONS,
      defaultNarrator: VOXCPM_VOICE_DESCRIPTIONS[0].id,
      defaultCharacter: VOXCPM_VOICE_DESCRIPTIONS[2].id,
      venvPath: voxcpmPython,
    });
  }
  res.json({
    engine: "kitten2",
    available: kittenAvailable,
    voices: KNOWN_VOICES,
    defaultNarrator: "Bruno",
    defaultCharacter: "Rosie",
    venvPath: kittenPython,
    engines: TTS_ENGINES,
  });
});

app.delete("/api/jobs/:id", (req, res) => {
  removeJobFile(req.params.id);
  const ok = cancelJob(req.params.id);
  if (!ok) return res.status(404).json({ error: "job not running or unknown" });
  res.json({ cancelled: true });
});
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
// SFX library for the sound-design audition players (public/sfx tree:
// synth + cc0 wavs + sfx.catalog.json).
app.use("/sfx", express.static(join(ROOT, "public", "sfx"), { index: false }));

// ---------- JSON 404 for API/media (never return HTML) ----------
app.use("/api", (_req, res) => {
  res.status(404).type("application/json").send(JSON.stringify({ error: "api route not found" }));
});
app.use("/media", (_req, res) => {
  res.status(404).type("application/json").send(JSON.stringify({ error: "media file not found" }));
});
app.use("/sfx", (_req, res) => {
  res.status(404).type("application/json").send(JSON.stringify({ error: "sfx file not found" }));
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
