import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import { spawn } from "child_process";
import { join, basename } from "path";
import fs from "fs";
import { loadConfig, saveConfig, loadEnv, saveEnv, ROOT } from "./providers";
import { keyUrlFor, actionable } from "./error-hints";
import { fetchProviderModels } from "./fetch-models";
import { createJob, createStoryJob, createPlanJob, createStoryboardJob, getJob, getAllJobs, premiseSlug, runJob, runStoryJob, runPlanJob, runStoryboardJob, subscribeSSE, type PlanJobRequest } from "./jobs";
import { STORY_META } from "../src/whatif/videos/story-meta";
import {
  BANNED_VOICES,
  DEFAULT_CHARACTER,
  DEFAULT_NARRATOR,
  KNOWN_VOICES,
  pickVoice,
  SAMPLE_TEXT,
} from "../src/whatif/audio/voices";
import {
  cleanSoundMap,
  loadCatalog,
  loadSoundDesign,
  saveSoundDesign,
} from "../src/whatif/audio/sfx-catalog";
import { loadAiConfig, resolveModel } from "../src/generator/ai/provider-registry";
import { buildFamilySpec } from "../src/generator/build-family-spec";

const app = express();
app.use(cors());
app.use(express.json());

/* ------------ Voice-sample backend (local KittenTTS) ---------------- */
const PYTHON = join(
  "C:",
  "Users",
  "Narwal",
  "Desktop",
  "kitten-tts-test",
  ".venv",
  "Scripts",
  "python.exe",
);
const SAMPLES_DIR = join(ROOT, "public", "whatif-audio", "voice-samples");
let voiceSampleJobRunning = false;

function voiceSampleBackendAvailable(): boolean {
  try {
    fs.accessSync(PYTHON);
    return true;
  } catch {
    return false;
  }
}

/** Fire a KittenTTS batch to record sample wavs (async, no waiting). */
function spawnVoiceSamples(ids: string[], done?: () => void): void {
  if (!voiceSampleBackendAvailable()) {
    done?.();
    return;
  }
  fs.mkdirSync(SAMPLES_DIR, { recursive: true });
  const jobPath = join(ROOT, "output", `.voice-samples-${ids.length}.json`);
  fs.writeFileSync(
    jobPath,
    JSON.stringify({
      outDir: SAMPLES_DIR,
      lines: ids.map((id) => ({ id, text: SAMPLE_TEXT, voice: id })),
    }),
  );
  const child = spawn(
    PYTHON,
    [join(ROOT, "scripts", "story-tts.py"), jobPath],
    {
      cwd: ROOT,
      stdio: ["ignore", "ignore", "ignore"],
      env: { ...process.env, ...loadEnv(), PYTHONUTF8: "1", HF_HUB_OFFLINE: "1" },
    },
  );
  child.on("close", () => {
    try { fs.rmSync(jobPath, { force: true }); } catch { /* ignore */ }
    done?.();
  });
}

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

app.get("/api/voices", (_req, res) => {
  const samplesDir = join(ROOT, "public", "whatif-audio", "voice-samples");
  const voices = KNOWN_VOICES.map((v) => {
    const sampleFile = join(samplesDir, `${v.id}.wav`);
    return {
      id: v.id,
      pace: v.pace,
      sample: fs.existsSync(sampleFile) ? `/whatif-audio/voice-samples/${v.id}.wav` : null,
    };
  });
  // Warm the sample cache in the background on first inquiry (one batch).
  const pending = voices.filter((v) => !v.sample);
  if (pending.length > 0 && !voiceSampleJobRunning && voiceSampleBackendAvailable()) {
    voiceSampleJobRunning = true;
    spawnVoiceSamples(
      pending.map((v) => v.id),
      () => {
        voiceSampleJobRunning = false;
      },
    );
  }
  // Surface the storyboard-saved cast (any approved/draft story can adopt it).
  res.json({ voices, defaultNarrator: DEFAULT_NARRATOR, defaultCharacter: DEFAULT_CHARACTER });
});

app.post("/api/voices/sample", (req, res) => {
  const { voice } = req.body as { voice?: string };
  if (!voice || !pickVoice(voice, "") || BANNED_VOICES.has(voice)) {
    return res.status(400).json({ error: "Unknown or unavailable voice", voice });
  }
  const sampleFile = join(ROOT, "public", "whatif-audio", "voice-samples", `${voice}.wav`);
  if (fs.existsSync(sampleFile)) {
    return res.json({ url: `/whatif-audio/voice-samples/${voice}.wav`, cached: true });
  }
  spawnVoiceSamples([voice]);
  res.json({ url: null, note: `${voice} is being recorded — press play again in ~30s` });
});

// ---------- Story Studio (storyboard plan → review → approve → render) ----------
app.post("/api/story/plan", (req, res) => {
  const body = req.body as Partial<PlanJobRequest>;
  const mode = body.mode === "story" ? "story" : "topic";
  const input = typeof body.input === "string" ? body.input.trim() : "";
  if (input.length < 3) {
    return res.status(400).json({
      error: mode === "story" ? "The story text is missing or too short" : "The topic is missing or too short",
      fix: mode === "story"
        ? "Paste the whole story (a couple of sentences minimum)"
        : 'Type a topic like "What if the moon was twice as close?"',
    });
  }
  const seconds = Math.min(60, Math.max(10, Math.round(Number(body.seconds) || 20)));
  const planReq: PlanJobRequest = {
    mode,
    input,
    seconds,
    feedback: typeof body.feedback === "string" ? body.feedback.slice(0, 1000) : undefined,
    provider: typeof body.provider === "string" ? body.provider : undefined,
    model: typeof body.model === "string" ? body.model : undefined,
    slug: typeof body.slug === "string" && /^[a-z0-9-]+$/.test(body.slug) ? body.slug : undefined,
  };
  // One plan job at a time (the writer is the expensive step).
  const busy = getAllJobs().find((j) => j.engine === "plan" && (j.status === "running" || j.status === "queued"));
  if (busy) {
    return res.status(409).json({
      error: `A story is already being written (job ${busy.id}) — wait for it to finish`,
      jobId: busy.id,
    });
  }
  const job = createPlanJob(input, planReq.provider, planReq.model);
  runPlanJob(job, planReq);
  res.json({ jobId: job.id });
});

app.post("/api/story/voice", (req, res) => {
  const { slug, mode, narratorVoice, characterVoice } = req.body as {
    slug?: string;
    mode?: string;
    narratorVoice?: string;
    characterVoice?: string;
  };
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return res.status(400).json({ error: "slug required" });
  }
  const p = join(ROOT, "public", "whatif-data", slug, "storyboard.json");
  try {
    const sb = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
    const voice = ((sb.voice as object) ?? {}) as { mode?: string; narratorVoice?: string; characterVoice?: string };
    if (mode !== undefined) {
      const modes = ["narrator", "character", "both", "silent"];
      if (!modes.includes(mode)) {
        return res.status(400).json({ error: `mode must be one of: ${modes.join(", ")}` });
      }
      voice.mode = mode;
    }
    if (narratorVoice !== undefined) {
      if (BANNED_VOICES.has(narratorVoice) || !pickVoice(narratorVoice, "")) {
        return res.status(400).json({ error: `"${narratorVoice}" is not an available narrator voice` });
      }
      voice.narratorVoice = narratorVoice;
    }
    if (characterVoice !== undefined) {
      if (BANNED_VOICES.has(characterVoice) || !pickVoice(characterVoice, "")) {
        return res.status(400).json({ error: `"${characterVoice}" is not an available blob voice` });
      }
      voice.characterVoice = characterVoice;
    }
    sb.voice = voice;
    fs.writeFileSync(p, JSON.stringify(sb, null, 2));
    res.json({ ok: true, voice: sb.voice });
  } catch {
    res.status(404).json({ error: `No storyboard for "${slug}"` });
  }
});

app.get("/api/story/drafts", (_req, res) => {
  const dir = join(ROOT, "public", "whatif-data");
  const drafts: Array<{ slug: string; title: string; seconds: number; createdAt: number; approved: boolean }> = [];
  try {
    for (const slug of fs.readdirSync(dir)) {
      try {
        const sb = JSON.parse(fs.readFileSync(join(dir, slug, "storyboard.json"), "utf8")) as Record<string, unknown>;
        drafts.push({
          slug,
          title: (sb.title as string) ?? slug,
          seconds: Number(sb.targetSeconds ?? 0),
          createdAt: Number(sb.createdAt ?? 0),
          approved: fs.existsSync(join(dir, slug, "approved")),
        });
      } catch { /* skip broken drafts */ }
    }
  } catch { /* no drafts dir yet */ }
  drafts.sort((a, b) => b.createdAt - a.createdAt);
  res.json({ drafts });
});

app.get("/api/story/:slug", (req, res) => {
  const p = join(ROOT, "public", "whatif-data", req.params.slug, "storyboard.json");
  try {
    const sb = JSON.parse(fs.readFileSync(p, "utf8"));
    res.json({ slug: req.params.slug, storyboard: sb });
  } catch {
    res.status(404).json({ error: `No storyboard for "${req.params.slug}"` });
  }
});

app.post("/api/story/approve", (req, res) => {
  const { slug } = req.body as { slug?: string };
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return res.status(400).json({ error: "slug required", fix: "Approve from the story review screen" });
  }
  const sbPath = join(ROOT, "public", "whatif-data", slug, "storyboard.json");
  let title = slug;
  try {
    const sb = JSON.parse(fs.readFileSync(sbPath, "utf8")) as { title?: string; targetSeconds?: number };
    if (sb.title) title = sb.title;
    fs.writeFileSync(join(ROOT, "public", "whatif-data", slug, "approved"), new Date().toISOString());
  } catch {
    return res.status(404).json({
      error: `No storyboard found for "${slug}"`,
      fix: "Write the story first (Generate → type a topic → Step 2)",
    });
  }
  for (const other of getAllJobs()) {
    if (
      (other.status === "running" || other.status === "queued") &&
      other.engine === "storyboard" &&
      other.slug === slug
    ) {
      return res.status(409).json({
        error: `"${title}" is already rendering (job ${other.id})`,
        jobId: other.id,
      });
    }
  }
  const job = createStoryboardJob(title);
  runStoryboardJob(job, slug);
  res.json({ jobId: job.id });
});

// ---------- Story engine (agent-authored compositions) ----------
app.get("/api/stories", (_req, res) => {
  res.json({
    stories: STORY_META.map((v) => ({
      slug: v.slug,
      title: v.title,
      durationSec: v.durationInFrames / v.fps,
      fps: v.fps,
      sfxRoles: v.sfxRoles ?? [],
    })),
  });
});

// ---------- Sound design (per-video SFX variant chooser) ----------
app.get("/api/sound-design/:slug", (req, res) => {
  const slug = req.params.slug;
  const meta = STORY_META.find((v) => v.slug === slug);
  if (!meta) {
    return res.status(404).json({
      error: `No registered story video with slug "${slug}"`,
      fix: "Pick a story on the Generate tab — registered videos live in src/whatif/videos/",
    });
  }
  const catalog = loadCatalog();
  if (!catalog) {
    return res.json({
      slug,
      available: false,
      roles: [],
      selection: {},
      fixHint: 'Run "npm run sfx" to build the sound library',
    });
  }
  const design = loadSoundDesign(slug);
  const roles = (meta.sfxRoles ?? []).map((role) => {
    const def = catalog.roles[role];
    return def
      ? {
          id: role,
          label: def.label,
          description: def.description,
          family: def.family,
          variants: def.variants.map((v) => ({
            id: v.id,
            file: v.file,
            // Absolute-ish URL for <audio> auditioning.
            url: `/${v.file}`,
            dur: v.dur,
            source: v.source,
            pack: v.pack,
            peakDb: v.peakDb,
            rmsDb: v.rmsDb,
            autoRank: v.autoRank,
          })),
        }
      : { id: role, label: role, description: "", family: "event", variants: [] };
  });
  res.json({
    slug,
    available: true,
    roles,
    selection: design?.map ?? {},
    catalogGeneratedAt: catalog.generatedAt,
  });
});

app.post("/api/sound-design/:slug", (req, res) => {
  const slug = req.params.slug;
  const meta = STORY_META.find((v) => v.slug === slug);
  if (!meta) {
    return res.status(404).json({ error: `No registered story video with slug "${slug}"` });
  }
  const catalog = loadCatalog();
  if (!catalog) {
    return res.status(503).json({
      error: "SFX catalog not built yet",
      fix: 'Run "npm run sfx" (synth library) on the server; the sound-design panel unlocks after that',
    });
  }
  const { map } = req.body as { map?: Record<string, unknown> };
  if (map === undefined || map === null || typeof map !== "object") {
    return res.status(400).json({ error: "body must be { map: { role: choice } }" });
  }
  let cleaned: Record<string, string>;
  try {
    cleaned = cleanSoundMap(catalog, map);
  } catch (e) {
    return res.status(400).json({
      error: e instanceof Error ? e.message : "invalid sound design map",
      fix: "Set each role to \"auto\" or one of its listed variants",
    });
  }
  saveSoundDesign({ slug, map: cleaned, updatedAt: Date.now() });
  res.json({ ok: true, slug, map: cleaned });
});

app.post("/api/generate-story", (req, res) => {
  const { slug, soundDesign } = req.body as {
    slug?: string;
    soundDesign?: Record<string, unknown>;
  };
  const meta = slug ? STORY_META.find((v) => v.slug === slug) : undefined;
  if (!meta) {
    return res.status(400).json({
      error: slug
        ? `No registered story video with slug "${slug}".`
        : "slug required",
      fix: "Pick a video from the list on the Generate tab — registered story videos live in src/whatif/videos/",
    });
  }
  // Optional per-render sound design — persisted for future renders too.
  if (soundDesign && typeof soundDesign === "object") {
    const catalog = loadCatalog();
    if (!catalog) {
      return res.status(503).json({
        error: "SFX catalog not built yet",
        fix: 'Run "npm run sfx" on the server, then retry',
      });
    }
    let cleaned: Record<string, string>;
    try {
      cleaned = cleanSoundMap(catalog, soundDesign);
    } catch (e) {
      return res.status(400).json({
        error: e instanceof Error ? e.message : "invalid sound design map",
        fix: "Set each role to \"auto\" or one of its listed variants",
      });
    }
    saveSoundDesign({ slug: meta.slug, map: cleaned, updatedAt: Date.now() });
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
