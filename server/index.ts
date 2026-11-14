import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import { spawn, spawnSync } from "child_process";
import { join, basename } from "path";
import fs from "fs";
import { applyEnv, configProblems, loadConfig, saveConfig, loadEnv, saveEnv, ROOT } from "./providers";
import { FFMPEG } from "../src/generator/ffmpeg";
import { reportTime } from "../src/generator/ai/knowledge";
import { keyUrlFor, actionable } from "./error-hints";
import { fetchProviderModels } from "./fetch-models";
import { createJob, getJob, getAllJobs, premiseSlug, runJob, deleteJob, subscribeSSE } from "./jobs";
import { cancelActivity, listActivities, getActivity, subscribeActivitySSE, serverLogLines, activityState } from "./activity";
import { resolveModel } from "../src/generator/ai/provider-registry";
import { buildFamilySpec } from "../src/generator/build-family-spec";
import { SettingsSchema, type VideoSettings } from "../src/generator/spec.schema";
import { ROLE_DEFS, ROLE_NAMES, pickRoleModel } from "../src/generator/ai/roles";
import { resolveRoleModels } from "../src/generator/pipeline/llm";
import { canReassemble, reassemble } from "../src/generator/pipeline/run";
import { isComplete, nextStage, readBrief, readRun, STAGE_LABELS, STAGES, waitsForShopping, waitsForStory } from "../src/generator/pipeline/manifest";
import { DEFAULT_CHANNEL, listChannels, loadChannel, readChannelFile, saveChannel, STORY_MODES, type ChannelProfile, type StoryMode } from "../src/generator/ai/channels";
import { MOOD_TAGS } from "../src/generator/audio-resolve";
import { scriptPremise } from "../src/generator/pipeline/script";
import { SECTIONS, shoppingList } from "../src/generator/library/shopping";
import type { NeedsFile } from "../src/generator/library/match";
import { findOffers, offerFromLink, parseApprovals, type Shopping } from "../src/generator/library/acquire/acquire";
import type { SourceId } from "../src/generator/library/acquire/types";
import { acquirePaths, readAcquired } from "../src/generator/library/acquire/catalog";
import { rankRequests, readRequests } from "../src/generator/library/acquire/requests";
import { sourceStatus } from "../src/generator/library/acquire/sources";
import { ttsStatus, startInstall, getTtsJob } from "./tts";
import { AUDITION_TEXT, KNOWN_VOICES, VOXCPM_VOICE_DESCRIPTIONS, TTS_ENGINES, voxDescription, voxTransform, voxReferenceId, voiceLabel, voiceMeta } from "../src/generator/voices";
import { resolveTtsPython } from "../src/generator/tts-python";
import { cacheKey, synthesizeLines, voicePreviewKey, voicePreviewLine, type VoiceLine } from "../src/generator/tts";
import { queueFilmChange, registerFilmRoutes } from "./film";
import { registerProducerRoutes } from "./producer";
import { registerVariantsRoutes } from "./variants";
import { registerPublishRoutes } from "./publish";
import { checkRecast } from "../src/generator/film/recast";
import { captionOverrides } from "../src/generator/film/store";
import { applyCaptionOverrides } from "../src/generator/film/diff";

const app = express();
app.use(cors());
app.use(express.json());
// Editor (Phase 4): versioned edits, "Ask AI", undo/redo.
registerFilmRoutes(app);
// The producer you talk to (P5): notes on a run, proposals, confirm and undo.
registerProducerRoutes(app);
// Variants (15-producer.md §17): other hooks, endings and formats of a finished run.
registerVariantsRoutes(app);
registerPublishRoutes(app);

// ---------- Providers ----------
/** Model role assignments: which provider/model each pipeline step uses. */
app.get("/api/roles", (_req, res) => {
  const cfg = loadConfig();
  res.json({
    roles: ROLE_DEFS.map((d) => ({ ...d, assignment: cfg.roles?.[d.name] ?? null })),
    providers: Object.entries(cfg.providers).map(([name, c]) => ({ name, models: c.models ?? [] })),
    defaultProvider: cfg.defaultProvider ?? null,
    problems: configProblems(),
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
        fix: "Add it in Settings → AI models first",
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
  res.json({ providers: out, defaultProvider: cfg.defaultProvider, problems: configProblems() });
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
      fix: `Save your key in Settings → AI models — create one at ${keyUrlFor(name)}`,
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
      const cfg2 = loadConfig();
      applyEnv();
      const resolution = resolveModel(cfg2, name, chosenModel);
      if (!resolution.reference) {
        return res.json({
          ...base,
          ok: false,
          error: resolution.error ?? "could not resolve model reference",
          fix: "Pick another model in Settings → AI models, or check the provider's baseUrl/package in ai.config.json",
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
      // Persist the live list so the dashboard + CLI use real models.
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
/**
 * Every pipeline role must have a working key (roles without their own model
 * use the writer's). The problem as an API error, or null.
 */
function rolesProblem(cli: { provider?: string; model?: string }, reader = false): { error: string; fix: string } | null {
  const savedEnv = loadEnv();
  const config = loadConfig();
  // The script reader is asked only for a script as written.
  const roleModels = resolveRoleModels(["writer", ...(reader ? (["reader"] as const) : []), "checker", "breakdown", "matcher", "director", "sound", "critic"], cli);
  for (const [role, rm] of Object.entries(roleModels)) {
    const pc = config.providers?.[rm.provider];
    if (!pc) {
      return { error: `the ${role} role uses provider "${rm.provider}", which is not configured`, fix: "Fix it in Settings → AI models → Model roles" };
    }
    if (pc.apiKeyEnv && rm.provider !== "gateway" && !savedEnv[pc.apiKeyEnv]) {
      return {
        error: `API key not set for provider "${rm.provider}" (used by the ${role} role)`,
        fix: `Save your key in Settings → AI models — create one at ${keyUrlFor(rm.provider)}`,
      };
    }
    if (!rm.model) {
      return { error: `no model chosen for the ${role} role`, fix: "Choose one in Settings → AI models → Model roles" };
    }
  }
  return null;
}

/** The plan job that is writing now, if any (one at a time: the writer is the expensive step). */
function busyPlan() {
  return getAllJobs().find((j) => j.engine === "plan" && (j.status === "running" || j.status === "queued"));
}

app.post("/api/plan", async (req, res) => {
  const body = req.body as {
    input?: string;
    premise?: string;
    provider?: string;
    model?: string;
    audio?: unknown;
    settings?: unknown;
    /** false: plan straight through, without stopping for the story's approval. Unset: the channel decides (on). */
    storyGate?: boolean;
    /** false: never stop at the shopping list (gate 2). Unset: the channel decides (on). */
    shopGate?: boolean;
    /** The sources gate 2 searches (acquire/sources ids; [] searches none). Unset: every default source. */
    shopSources?: string[];
    /** A run whose story this plan reuses. */
    storyFrom?: string;
    /** The channel (channels/<id>.json); unset: what-if. */
    channel?: string;
    /** The user's own story or script, and how to use it: adapt or as-written (unset: the channel's script mode). */
    script?: string;
    mode?: string;
  };
  // The channel and the story mode, checked before anything starts.
  let profile: ChannelProfile;
  try {
    profile = loadChannel(typeof body.channel === "string" && body.channel ? body.channel : DEFAULT_CHANNEL);
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : String(e), fix: "Pick a channel from the list" });
  }
  const script = typeof body.script === "string" && body.script.trim() ? body.script : undefined;
  if (script && script.length > 60_000) {
    return res.status(400).json({ error: "the story is too long (over 60,000 characters)", fix: "Paste a shorter story; 16:9 videos hold about 10 minutes" });
  }
  const mode = typeof body.mode === "string" && body.mode ? body.mode : script ? profile.writer.scriptMode : "premise";
  if (!(STORY_MODES as readonly string[]).includes(mode) || !profile.writer.modes.includes(mode as StoryMode)) {
    return res.status(400).json({ error: `the ${profile.name} channel does not use the "${mode}" story mode`, fix: `Choose one of: ${profile.writer.modes.join(", ")}` });
  }
  if (mode !== "premise" && !script) {
    return res.status(400).json({ error: "this story mode needs your story", fix: "Paste your story, or write an idea instead" });
  }
  // A pasted story names itself when no idea was typed.
  const typed = (body.input ?? body.premise ?? "").trim();
  const premise = typed.length >= 6 || !script ? typed : scriptPremise(script);
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
  applyEnv();
  const config = loadConfig();
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
        fix: `Add it in Settings → AI models, or pick one of: ${known}, or "offline"`,
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
          fix: "Start the local server (e.g. `ollama serve`) first — or switch the provider to its cloud URL in Settings → AI models — don't render into a dead endpoint",
        });
      }
    }
    if (provCfg.apiKeyEnv && provName !== "gateway") {
      if (!savedEnv[provCfg.apiKeyEnv]) {
        return res.status(400).json({
          error: `API key not set for provider "${provName}" (${provCfg.apiKeyEnv})`,
          fix: `Save your key in Settings → AI models — create one at ${keyUrlFor(provName)}`,
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
  const busy = busyPlan();
  if (busy) {
    return res.status(409).json({
      error: `A plan is already being written (job ${busy.id}) — wait for it to finish`,
      jobId: busy.id,
    });
  }
  // Every pipeline role must have a working key (roles without their own
  // model use the writer's).
  if (!fixtures && provName !== "offline") {
    const problem = rolesProblem(
      {
        provider: typeof body.provider === "string" ? body.provider : undefined,
        model: typeof body.model === "string" ? body.model : undefined,
      },
      mode === "as-written",
    );
    if (problem) return res.status(400).json(problem);
  }
  // A story of an earlier run to plan with again (no writer call).
  // The sources gate 2 may search, when the request limits them.
  const shopSources = Array.isArray(body.shopSources) ? body.shopSources.map(String) : undefined;
  const strange = (shopSources ?? []).filter((s) => !sourceStatus().some((x) => x.id === s));
  if (strange.length) {
    return res.status(400).json({ error: `no source called ${strange.join(", ")}`, fix: `Use some of: ${sourceStatus().map((x) => x.id).join(", ")}` });
  }
  const storyFrom = typeof body.storyFrom === "string" && body.storyFrom ? body.storyFrom : undefined;
  if (storyFrom && (!/^[a-z0-9-]+$/.test(storyFrom) || !fs.existsSync(join(ROOT, "output", storyFrom, "story.json")))) {
    return res.status(400).json({ error: `no saved story for "${storyFrom}"`, fix: "Write the idea again from Step 1" });
  }

  // Under fixtures no configured model writes anything: say so in the job
  // (GET /api/spec) and in plan.json (jobs.ts relabels it when the plan is done).
  const job = fixtures ? createJob(premise, "fixtures", process.env.FACTORY_LLM_FIXTURES) : createJob(premise, provName, model);
  job.engine = "plan";
  job.explicitModel = !fixtures && (typeof body.provider === "string" || typeof body.model === "string");
  // The story gate: as the request says, else as the channel says (on).
  job.storyGate = body.storyGate === undefined ? profile.gates.story : body.storyGate !== false;
  // Gate 2 likewise: stop at the shopping list when the library is missing something.
  job.shopGate = body.shopGate === undefined ? profile.gates.shop : body.shopGate !== false;
  if (shopSources) job.shopSources = shopSources;
  if (storyFrom) job.storyFrom = storyFrom;
  if (profile.id !== DEFAULT_CHANNEL) job.channel = profile.id;
  if (script) {
    // The CLI reads the story from a file (a long one would pass Windows' command-line limit).
    const rel = `output/plan-${job.id}-script.txt`;
    fs.mkdirSync(join(ROOT, "output"), { recursive: true });
    fs.writeFileSync(join(ROOT, rel), script);
    job.scriptFile = rel;
    job.mode = mode;
  }
  if (body.audio) {
    job.audio = body.audio;
    // Voice comes first in the pipeline, so the plan needs the voice settings too.
    const rel = `output/plan-${job.id}-audio.json`;
    fs.mkdirSync(join(ROOT, "output"), { recursive: true });
    fs.writeFileSync(join(ROOT, rel), JSON.stringify(body.audio, null, 2));
    job.audioFile = rel;
  }
  if (settings) job.settings = settings;
  runJob(job, { noRender: true });
  res.json({ jobId: job.id });
});

/**
 * The critic's notes that were kept as proposals (the approved story is
 * locked, so they were not applied), or undefined.
 */
function criticNotes(runId: string): Array<{ beat: string; problem: string; fix: string }> | undefined {
  const run = readRun(runId);
  if (run?.stages.critic.state !== "done" || run.stages.critic.facts?.applied !== false) return undefined;
  try {
    const issues = JSON.parse(fs.readFileSync(join(ROOT, "output", runId, "critique.json"), "utf8"));
    return Array.isArray(issues) && issues.length ? issues : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What the story needs and what the library has for it (needs.json, P3), as
 * the plan review shows it: read-only until gate 2. Undefined when the run
 * has no breakdown.
 */
function storyNeeds(runId: string): Array<{ status: string; title: string; items: Array<{ id: string; kind: string; what: string; must: boolean; beats: string[]; use?: string; then?: string }> }> | undefined {
  try {
    const file = JSON.parse(fs.readFileSync(join(ROOT, "output", runId, "needs.json"), "utf8")) as NeedsFile;
    const groups = shoppingList(file);
    return SECTIONS.filter((s) => groups[s.status].length).map((s) => ({
      status: s.status,
      title: s.title,
      items: groups[s.status].map((n) => ({
        id: n.id,
        kind: n.kind,
        what: n.what,
        must: n.must,
        beats: n.beats,
        ...(n.use ? { use: n.use.name } : {}),
        ...(n.then ? { then: n.then } : {}),
      })),
    }));
  } catch {
    return undefined;
  }
}

/**
 * Gate 2's shopping list as the dashboard shows it: the needs that wait for a
 * choice (shopping.json), each with its beats and the name of its stand-in
 * (needs.json), the sources and what went wrong searching. Undefined when
 * the files are missing.
 */
function shoppingFor(runId: string) {
  try {
    const dir = join(ROOT, "output", runId);
    const shopping = JSON.parse(fs.readFileSync(join(dir, "shopping.json"), "utf8")) as Shopping;
    const needs = JSON.parse(fs.readFileSync(join(dir, "needs.json"), "utf8")) as NeedsFile;
    const run = readRun(runId);
    const waiting = run?.gates.shop.needs;
    const byId = new Map(needs.needs.map((n) => [n.id, n]));
    return {
      inventory: shopping.inventory,
      waiting: !!run && waitsForShopping(run),
      needs: shopping.needs
        .filter((n) => !waiting || waiting.includes(n.need))
        .map((n) => {
          const m = byId.get(n.need);
          return { ...n, beats: m?.beats ?? [], ...(m?.use ? { useName: m.use.name } : {}) };
        }),
      sources: shopping.sources,
      ...(shopping.searched ? { searched: shopping.searched } : {}),
      warnings: shopping.warnings,
    };
  } catch {
    return undefined;
  }
}

/**
 * Continue a run in a new plan job: approve the story that waits at the gate
 * (as it is on disk now), or go on from the stage a crash or a restart
 * stopped. Finished stages are kept and saved model replies are replayed.
 * At gate 2 the body carries the choices: `approvals` as the CLI writes them
 * ("n6=bigsoundbank:1048", "n2=close", "n3=build", "n9=skip") and `allFree`
 * for "Approve every CC0 pick"; the needs not named keep their stand-ins.
 */
app.post("/api/plan/:runId/resume", (req, res) => {
  const { runId } = req.params;
  if (!/^[a-z0-9-]+$/.test(runId)) return res.status(400).json({ error: "bad run id" });
  const body = (req.body ?? {}) as { approvals?: unknown; allFree?: unknown };
  const approvals = Array.isArray(body.approvals) ? body.approvals.filter((a): a is string => typeof a === "string") : [];
  try {
    parseApprovals(approvals);
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : String(e), fix: "For each need choose an offer, keep the stand-in, ask for it to be built, or skip it" });
  }
  const run = readRun(runId);
  const brief = readBrief(runId);
  if (!run || !brief) {
    return res.status(404).json({ error: `no saved run "${runId}" on the server`, fix: "Write the idea again from Step 1" });
  }
  if (isComplete(run)) {
    return res.status(409).json({ error: "this plan is already written", fix: "Open it in the editor, or approve it from its review" });
  }
  const busy = busyPlan();
  if (busy) {
    return res.status(409).json({ error: `A plan is already being written (job ${busy.id}) — wait for it to finish`, jobId: busy.id });
  }
  applyEnv();
  const fixtures = !!process.env.FACTORY_LLM_FIXTURES;
  if (!fixtures) {
    const problem = rolesProblem(brief.cli ?? {}, brief.mode === "as-written");
    if (problem) return res.status(400).json(problem);
  }
  const writer = pickRoleModel(loadConfig().roles, "writer", brief.cli?.provider, brief.cli?.model);
  const job = fixtures
    ? createJob(brief.premise, "fixtures", process.env.FACTORY_LLM_FIXTURES)
    : createJob(brief.premise, writer.provider ?? loadConfig().defaultProvider, writer.model);
  job.engine = "plan";
  job.resume = true;
  job.runId = runId;
  const choices = [...(approvals.length ? ["--approve", approvals.join(",")] : []), ...(body.allFree === true ? ["--all-cc0"] : [])];
  runJob(job, { extraArgs: ["--resume", runId, "--no-render", ...choices] });
  res.json({ jobId: job.id });
});

/**
 * Gate 2, from a need's card: the sources asked again for that need alone,
 * up to 20 offers from each (the run's own sources), saved in shopping.json.
 * Nothing is downloaded.
 */
app.post("/api/runs/:runId/offers", async (req, res) => {
  const { runId } = req.params;
  if (!/^[a-z0-9-]+$/.test(runId)) return res.status(400).json({ error: "bad run id" });
  const need = typeof req.body?.need === "string" ? req.body.need : "";
  const dir = join(ROOT, "output", runId);
  try {
    const needs = JSON.parse(fs.readFileSync(join(dir, "needs.json"), "utf8")) as NeedsFile;
    const shopping = JSON.parse(fs.readFileSync(join(dir, "shopping.json"), "utf8")) as Shopping;
    if (!shopping.needs.some((n) => n.need === need)) return res.status(404).json({ error: `${need || "that need"} is not on this shopping list` });
    const sources = readBrief(runId)?.shopSources as SourceId[] | undefined;
    const found = await findOffers(needs, { ...(sources ? { sources } : {}), only: [need], more: true, run: runId });
    const fresh = found.needs.find((n) => n.need === need);
    if (!fresh) return res.status(404).json({ error: `${need} has nothing to download any more` });
    const next: Shopping = { ...shopping, needs: shopping.needs.map((n) => (n.need === need ? fresh : n)), warnings: [...new Set([...shopping.warnings, ...found.warnings])] };
    fs.writeFileSync(join(dir, "shopping.json"), JSON.stringify(next, null, 2));
    const m = needs.needs.find((n) => n.id === need);
    res.json({ need: { ...fresh, beats: m?.beats ?? [], ...(m?.use ? { useName: m.use.name } : {}) } });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e), fix: "Try again; a source may be down" });
  }
});

/** Gate 2: a link pasted on a need's card, read by its source as an offer (nothing is downloaded; approve it as nN=<link>). */
app.post("/api/runs/:runId/link", async (req, res) => {
  const { runId } = req.params;
  if (!/^[a-z0-9-]+$/.test(runId)) return res.status(400).json({ error: "bad run id" });
  const body = (req.body ?? {}) as { need?: unknown; url?: unknown };
  try {
    const needs = JSON.parse(fs.readFileSync(join(ROOT, "output", runId, "needs.json"), "utf8")) as NeedsFile;
    const offer = await offerFromLink(needs, String(body.need ?? ""), String(body.url ?? "").trim());
    res.json({ offer });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e), fix: "Paste the link of the item's own page" });
  }
});

/** The channels a video can be made for: what each makes, its story modes and the choices it starts with. */
app.get("/api/channels", (_req, res) => {
  res.json(
    listChannels().map((c) => ({
      id: c.id,
      name: c.name,
      genre: c.genre,
      description: c.description,
      modes: c.writer.modes,
      scriptMode: c.writer.scriptMode,
      structure: c.writer.structure,
      formats: c.formats,
      captions: c.captions ?? null,
      voices: c.voices,
      storyGate: c.gates.story,
      shopGate: c.gates.shop,
      version: c.version,
    })),
  );
});

/**
 * The channel profiles settings page: one profile as its file holds it, a
 * saved edit (checked as a plan checks it; the version goes up when it
 * changed), and a new channel copied from another.
 */
app.get("/api/channels/:id", (req, res) => {
  const raw = readChannelFile(req.params.id);
  if (!raw) return res.status(404).json({ error: `no channel "${req.params.id}"` });
  res.json({ profile: raw, moods: Object.keys(MOOD_TAGS), modes: STORY_MODES });
});

app.put("/api/channels/:id", (req, res) => {
  const body = (req.body ?? {}) as { profile?: unknown };
  const profile = body.profile && typeof body.profile === "object" && !Array.isArray(body.profile) ? (body.profile as Record<string, unknown>) : null;
  if (!profile) return res.status(400).json({ error: "the profile is missing", fix: "Send { profile: { ... } }" });
  if (profile.id !== req.params.id) return res.status(400).json({ error: `the profile's id is "${String(profile.id)}", not "${req.params.id}"`, fix: "A channel keeps its id; copy it to make a new one" });
  try {
    const saved = saveChannel(profile);
    res.json({ ok: true, changed: saved.changed, version: saved.profile.version, profile: readChannelFile(req.params.id) });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e), fix: "Fix the fields named, then save again" });
  }
});

app.post("/api/channels", (req, res) => {
  const body = (req.body ?? {}) as { from?: unknown; id?: unknown; name?: unknown };
  const from = typeof body.from === "string" ? readChannelFile(body.from) : null;
  if (!from) return res.status(400).json({ error: "pick a channel to start from" });
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : id;
  try {
    const saved = saveChannel({ ...from, id, name }, { create: true });
    res.json({ ok: true, id: saved.profile.id, profile: readChannelFile(saved.profile.id) });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e), fix: "Use lower-case letters, digits and dashes, and a name no channel has" });
  }
});

app.get("/api/runs/:runId", (req, res) => {
  const { runId } = req.params;
  if (!/^[a-z0-9-]+$/.test(runId)) return res.status(400).json({ error: "bad run id" });
  const run = readRun(runId);
  if (!run) return res.status(404).json({ error: `no saved run "${runId}"` });
  const next = nextStage(run);
  res.json({
    id: run.id,
    premise: run.premise,
    stages: STAGES.map((name) => ({ name, state: run.stages[name].state, model: run.stages[name].model, error: run.stages[name].error })),
    gate: run.gates.story,
    shopGate: run.gates.shop,
    next,
    nextLabel: next ? STAGE_LABELS[next] : null,
    complete: !next,
    waitsForStory: waitsForStory(run),
    waitsForShopping: waitsForShopping(run),
  });
});

/**
 * The Assets page: each source and its state (with the keys saved in .env),
 * the build-request queue in the order to take it (most asked first), and
 * what acquisition took in (acquired.catalog.json), with whether its files
 * are on this machine.
 */
app.get("/api/assets", (_req, res) => {
  const paths = acquirePaths(ROOT);
  const { requests, bad } = readRequests(paths.requestsDir);
  const cat = readAcquired(paths.catalogFile);
  res.json({
    sources: sourceStatus({ ...process.env, ...loadEnv() }),
    requests: rankRequests(requests),
    unreadable: bad,
    acquired: cat.items.map((i) => ({
      id: i.id,
      kind: i.kind,
      ref: i.ref,
      source: i.source,
      title: i.title,
      author: i.author,
      page: i.page,
      licence: i.licence,
      tier: i.tier,
      ...(i.credit ? { credit: i.credit } : {}),
      fetchedAt: i.fetchedAt,
      ...(i.need ? { need: i.need } : {}),
      notes: i.notes,
      ...(i.held ? { held: i.held } : {}),
      onDisk: i.files.every((f) => fs.existsSync(join(paths.publicDir, f.file))),
    })),
  });
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
  // The story gate: the plan stopped after the story, which waits for approval.
  if (job.gate === "story" && job.runId && !job.specId) {
    const dir = join(ROOT, "output", job.runId);
    try {
      const story = JSON.parse(fs.readFileSync(join(dir, "story.json"), "utf8"));
      const timeline = JSON.parse(fs.readFileSync(join(dir, "timeline.json"), "utf8")) as { duration?: number; target?: number };
      const run = readRun(job.runId);
      // The story checker's notes, claims and lost plot points, when it was asked (it changes nothing).
      let check: unknown;
      try {
        check = run?.stages.check.state === "done" ? JSON.parse(fs.readFileSync(join(dir, "story.check.json"), "utf8")) : undefined;
      } catch {
        check = undefined;
      }
      // The claims check (claims.ts), when it ran: each factual claim and its verdict.
      let claims: unknown;
      try {
        claims = run?.stages.claims?.state === "done" ? JSON.parse(fs.readFileSync(join(dir, "story.claims.json"), "utf8")) : undefined;
      } catch {
        claims = undefined;
      }
      return res.json({
        ready: true,
        gate: "story",
        runId: job.runId,
        story,
        ...(check ? { check } : {}),
        ...(claims ? { claims } : {}),
        length: { duration: timeline.duration ?? 0, target: timeline.target ?? 0, revised: !!run?.stages.story.facts?.revised },
        approved: run?.gates.story.state === "approved",
        provider: job.provider,
        model: job.model,
      });
    } catch {
      return res.status(500).json({ error: `the story of "${job.runId}" is missing on disk`, fix: "Write the idea again from Step 1" });
    }
  }
  // Gate 2: the plan stopped at the shopping list, which waits for the user's choices.
  if (job.gate === "shop" && job.runId && !job.specId) {
    const shopping = shoppingFor(job.runId);
    if (!shopping) return res.status(500).json({ error: `the shopping list of "${job.runId}" is missing on disk`, fix: "Write the idea again from Step 1" });
    return res.json({ ready: true, gate: "shop", runId: job.runId, shopping, provider: job.provider, model: job.model });
  }
  if (!job.specId) {
    return res.status(404).json({ error: "this job produced no plan — write the idea again" });
  }
  const p = join(ROOT, "output", job.specId, "spec.json");
  try {
    const spec = JSON.parse(fs.readFileSync(p, "utf8"));
    res.json({ ready: true, specId: job.specId, spec, provider: job.provider, model: job.model, notes: criticNotes(job.specId), needs: storyNeeds(job.specId) });
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
  const { name, voice } = (req.body ?? {}) as { name?: unknown; voice?: unknown };
  if (!/^[a-z0-9-]+$/.test(specId)) {
    return res.status(400).json({ error: "bad plan id" });
  }
  if (!canReassemble(specId)) {
    return res.status(404).json({ error: `plan "${specId}" has no saved stages`, fix: "Write the plan again" });
  }
  const dir = join(ROOT, "output", specId);
  /** The name must be a character of the story, the voice one the dialogs engine knows. */
  const problem = () => {
    const story = JSON.parse(fs.readFileSync(join(dir, "story.json"), "utf8")) as { characters?: Array<{ name: string }> };
    const plan = JSON.parse(fs.readFileSync(join(dir, "plan.json"), "utf8")) as { audio?: { dialogs?: { engine?: string } } };
    return checkRecast({ characters: story.characters ?? [], engine: plan.audio?.dialogs?.engine, name, voice });
  };
  try {
    // Checked before queueing (and again in the queue, after any edit ahead of it).
    const early = problem();
    if (early) return res.status(400).json(early);
    // The film's queue: a recast rewrites the stage files the editor's
    // background measurement reads.
    const out = await queueFilmChange(specId, async () => {
      const late = problem();
      if (late) return { problem: late };
      const planPath = join(dir, "plan.json");
      const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
      plan.audio = plan.audio ?? {};
      plan.audio.dialogs = { ...(plan.audio.dialogs ?? {}), voices: { ...(plan.audio.dialogs?.voices ?? {}), [name as string]: voice } };
      fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
      const { spec, warnings } = await reassemble(specId, "plan");
      // The editor's keep-timing caption wording stays on screen (and on the
      // film: reading it records the recast as a version that keeps it).
      const overrides = captionOverrides(specId);
      if (overrides.length > 0) {
        const applied = applyCaptionOverrides(spec, overrides);
        if (applied < overrides.length) warnings.push(`${overrides.length - applied} kept caption wording(s) no longer line up with a caption window`);
      }
      fs.writeFileSync(join(dir, "spec.json"), JSON.stringify(spec, null, 2));
      return { spec, warnings };
    });
    if ("problem" in out) return res.status(400).json(out.problem);
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/**
 * Render an approved plan's spec (never renders without this call). The
 * dashboard's three render buttons (Approve, the editor's Make the video, Try
 * again) send only the plan's id, so they render alike: with the plan's own
 * voices (plan.json, with any recast) and through the chunked, cached
 * renderer, which a later render after an edit reuses. `audio` overrides the
 * voices and `chunked: false` renders in one pass, for other callers.
 */
app.post("/api/render-spec", (req, res) => {
  const { specId, audio, chunked } = req.body as { specId?: string; audio?: unknown; chunked?: boolean };
  if (!specId || !/^[a-z0-9-]+$/.test(specId)) {
    return res.status(400).json({ error: "specId required", fix: "Approve from the review screen" });
  }
  const specPathRel = join("output", specId, "spec.json");
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
  if (audio) job.audio = audio;
  if (audio) {
    try {
      const sidecar = join(ROOT, "output", specId, "audio.json");
      fs.writeFileSync(sidecar, JSON.stringify(audio, null, 2));
    } catch { /* ignore */ }
  }
  const extra = ["--from-spec", specPathRel.replace(/\\/g, "/")];
  if (audio) extra.push("--audio-file", `output/${specId}/audio.json`);
  // The chunked, cached renderer unless asked otherwise: a render after an edit reuses the unchanged chunks.
  if (chunked !== false) extra.push("--chunked");
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
      // A plan job that stopped at a gate: its story, or its shopping list, waits for you.
      ...(j.gate ? { gate: j.gate } : {}),
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
  applyEnv();
  const config = loadConfig();
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
        fix: `Add it in Settings → AI models, or pick one of: ${known}, or "offline"`,
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
          fix: "Start the local server (e.g. `ollama serve`) first — or switch the provider to its cloud URL in Settings → AI models — don't render into a dead endpoint",
        });
      }
    }
    // Gateway has a free tier that works without a key — only enforce for others.
    if (provCfg.apiKeyEnv && provName !== "gateway") {
      const key = savedEnv[provCfg.apiKeyEnv];
      if (!key) {
        return res.status(400).json({
          error: `API key not set for provider "${provName}" (${provCfg.apiKeyEnv})`,
          fix: `Save your key in Settings → AI models — create one at ${keyUrlFor(provName)}`,
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
        fix: "Open Settings → AI models and press 'Get models' to load the real model list, then pick one under Model roles",
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
  // One call, one video: this route has no review screen, so no story gate.
  job.storyGate = false;
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

// ---------- Activity: everything the factory is doing right now ----------
/** All activities, newest first. Running ones first within their group. */
app.get("/api/activity", (_req, res) => {
  const acts = listActivities();
  const running = acts.filter((a) => a.status === "queued" || a.status === "running");
  const finished = acts.filter((a) => a.status === "done" || a.status === "failed" || a.status === "cancelled");
  res.json({ running, finished });
});

/** One activity's full state. */
app.get("/api/activity/:id", (req, res) => {
  const act = getActivity(req.params.id);
  if (!act) return res.status(404).json({ error: "unknown activity" });
  res.json({ ...act, state: activityState(req.params.id) });
});

/** Live stream for one activity (SSE). */
app.get("/api/activity/:id/stream", (req, res) => {
  const act = getActivity(req.params.id);
  if (!act) return res.status(404).json({ error: "unknown activity" });
  subscribeActivitySSE(req.params.id, res);
});

/** Download an activity's log as plain text. */
app.get("/api/activity/:id/log", (req, res) => {
  const act = getActivity(req.params.id);
  if (!act) return res.status(404).json({ error: "unknown activity" });
  res.type("text/plain").send(`${act.label} (${act.id})\nStarted: ${new Date(act.startedAt).toISOString()}\nStatus: ${act.status}\n${act.error ? "Error: " + act.error + "\n" : ""}\n---\n${(act.logs ?? []).join("\n")}`);
});

/** Cancel a running or queued activity. */
app.post("/api/activity/:id/cancel", (req, res) => {
  const ok = cancelActivity(req.params.id);
  if (!ok) return res.status(400).json({ error: "cannot cancel that activity" });
  res.json({ ok: true });
});

/** Server-wide log ring buffer (newest first): provider checks, TTS install, warnings, errors. */
app.get("/api/logs/server", (_req, res) => {
  res.json({ logs: serverLogLines(500) });
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
  const body = req.body as { engine?: string; voice?: string; voiceDesc?: string; text?: string; referenceWav?: string; voiceStyle?: string; voiceTransform?: { semitones?: number; tempo?: number; saturation?: number } };
  const engine: "kitten2" | "voxcpm2" = body.engine === "voxcpm2" ? "voxcpm2" : "kitten2";
  if (!resolveTtsPython(engine)) {
    return res.status(400).json({ error: "engine not installed", fix: "Install it in Settings → Voice engines first" });
  }
  const text = body.text || AUDITION_TEXT;
  const voice = body.voice || (engine === "kitten2" ? "Bruno" : "narrator-calm");
  const voiceDesc = engine === "voxcpm2" ? voxDescription(voice, body.voiceDesc) : undefined;
  const voiceTransform = engine === "voxcpm2" ? (body.voiceTransform ?? voxTransform(voice)) : undefined;
  const refId = voxReferenceId(voice);
  const presetRefWav = refId ? join(REF_ROOT, refId, "reference.wav") : null;
  const referenceWav = body.referenceWav ?? (presetRefWav && fs.existsSync(presetRefWav) ? presetRefWav : undefined);
  const voiceStyle = body.voiceStyle;
  const key = cacheKey({ engine, voice, voiceDesc, text, referenceWav, voiceStyle, voiceTransform });
  try {
    // One synthesis per distinct sample: a second click on the same voice waits
    // for the first, and each sample gets its own job folder, so two auditions
    // never share (or overwrite) a job file. Samples stay out of public/.
    let job = sampleJobs.get(key);
    if (!job) {
      const id = `_sample-${key.slice(0, 12)}`;
      const line = { id: "sample", text, at: 0, engine, voice, voiceDesc, referenceWav, voiceStyle, voiceTransform, kind: "narration" as const };
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

// ---------- Voice preview route (definition-hash keyed, immutable) ----------
app.get("/api/voice-preview/:engine/:voice/:key.wav", (req, res) => {
  const engine = req.params.engine === "voxcpm2" ? "voxcpm2" : "kitten2";
  const voice = safeId(req.params.voice || "") || req.params.voice || "";
  const learned = voicePreviewKey(engine, voice);
  if (!learned || learned !== req.params.key) return res.status(404).end();
  const wav = join(ROOT, ".cache", "voice", learned + ".wav");
  if (!fs.existsSync(wav)) return res.status(404).end();
  res.type("audio/wav").sendFile(wav, { dotfiles: "allow", maxAge: 31536000, immutable: true });
});

// ---------- Voice preview warmup (hash-keyed, only missing/stale) ----------
app.post("/api/voice-previews/warm", async (req, res) => {
  const body = (req.body ?? {}) as { engine?: string; voices?: string[] };
  const engine: "kitten2" | "voxcpm2" = body.engine === "voxcpm2" ? "voxcpm2" : "kitten2";
  if (!resolveTtsPython(engine)) return res.status(400).json({ error: "engine not installed" });
  const list = engine === "voxcpm2" ? VOXCPM_VOICE_DESCRIPTIONS : KNOWN_VOICES;
  const requested = (body.voices ?? []).filter(Boolean);
  const voices = requested.length ? requested : (list as ReadonlyArray<{ id: string }>).map((v) => v.id);
  const results: Array<{ voice: string; ok: boolean; url?: string; error?: string }> = [];
  for (const voice of voices) {
    const key = voicePreviewKey(engine, voice);
    const wavExisting = key ? join(ROOT, ".cache", "voice", `${key}.wav`) : null;
    if (key && wavExisting && fs.existsSync(wavExisting)) {
      results.push({ voice, ok: true, url: `/api/voice-preview/${engine}/${voice}/${key}.wav` });
      continue;
    }
    try {
      const line = voicePreviewLine(engine, voice);
      if (!line) throw new Error("unknown voice");
      const m = await synthesizeLines([line], `_preview-${engine}-${voice}`, { publish: false });
      const file = m.lines[0]?.file;
      if (!file || !fs.existsSync(file)) throw new Error("no file");
      results.push({ voice, ok: true, url: `/api/voice-preview/${engine}/${voice}/${key}.wav` });
    } catch (e) {
      results.push({ voice, ok: false, error: (e instanceof Error ? e.message : String(e)).slice(-200) });
    }
  }
  res.json({ engine, warmed: results.filter((r) => r.ok).length, total: results.length, results });
});

// ---------- Voice reference design (premium cloning) ----------
app.post("/api/voice-reference/design", async (req, res) => {
  const body = req.body as { engine?: string; voice?: string; voiceDesc?: string; text?: string; referenceWav?: string; voiceStyle?: string; voiceTransform?: { semitones?: number; tempo?: number; saturation?: number } };
  const engine: "kitten2" | "voxcpm2" = body.engine === "voxcpm2" ? "voxcpm2" : "kitten2";
  if (!resolveTtsPython(engine)) {
    return res.status(400).json({ error: "engine not installed", fix: "Install it in Settings -> Voice engines first" });
  }
  const text = body.text || AUDITION_TEXT;
  const voice = body.voice || (engine === "kitten2" ? "Bruno" : "narrator-calm");
  const voiceDesc = engine === "voxcpm2" ? voxDescription(voice, body.voiceDesc) : undefined;
  const voiceTransform = engine === "voxcpm2" ? (body.voiceTransform ?? voxTransform(voice)) : undefined;
  const referenceWav = body.referenceWav;
  const id = `_ref-${Date.now().toString(36)}`;
  try {
    const line = { id: "sample", text, at: 0, engine, voice, voiceDesc, referenceWav, voiceStyle: body.voiceStyle, voiceTransform, kind: "narration" as const };
    const m = await synthesizeLines([line], id, { publish: true });
    const file = m.lines[0]?.file ?? `voice/${id}/sample.wav`;
    res.json({ id, file, url: `/media/${file}` });
  } catch (e) {
    res.status(500).json({ error: "reference design failed", detail: (e instanceof Error ? e.message : String(e)).slice(-500) });
  }
});

app.get("/api/videos", (_req, res) => {
  const dir = join(ROOT, "output");
  if (!fs.existsSync(dir)) return res.json([]);
  // Per-video folders (output/<id>/report.json, since 2026-10-25) and the old
  // flat files (output/<id>-report.json). Paths are returned relative to
  // output/, as the dashboard loads them from /media/<path>.
  const found: Array<{ id: string; reportFile: string; base: string }> = [];
  for (const f of fs.readdirSync(dir)) {
    const p = join(dir, f);
    if (f.endsWith("-report.json")) found.push({ id: f.replace("-report.json", ""), reportFile: p, base: "" });
    else if (fs.statSync(p).isDirectory() && fs.existsSync(join(p, "report.json"))) found.push({ id: f, reportFile: join(p, "report.json"), base: `${f}/` });
  }
  type Report = { id?: string; output?: string; spec?: string; generatedAt?: unknown; [key: string]: unknown };
  const videos: Report[] = found.flatMap(({ id, reportFile, base }) => {
    let report: Report;
    try {
      report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
    } catch {
      return [];
    }
    const reviewDir = base ? `${base}review` : (report.id || id) + "-review";
    const reviewExists = fs.existsSync(join(dir, reviewDir));
    const thumbRel = base ? `${base}thumb.jpg` : `${id}-thumb.jpg`;
    const thumbPath = join(dir, thumbRel);
    if (!fs.existsSync(thumbPath) && report.output) {
      const mp4Abs = join(dir, `${base}${basename(report.output)}`);
      if (fs.existsSync(mp4Abs)) {
        try {
          const thumb = spawn(FFMPEG, ["-y", "-i", mp4Abs, "-ss", "00:00:01", "-vframes", "1", "-q:v", "3", thumbPath], { stdio: "ignore", detached: true });
          // No ffmpeg at all: no thumbnail (an unhandled spawn error would stop the server).
          thumb.on("error", () => undefined);
          thumb.unref();
        } catch { /* ignore */ }
      }
    }
    return [{
      ...report,
      id,
      output: report.output ? `${base}${basename(report.output)}` : undefined,
      spec: report.spec ? `${base}${basename(report.spec)}` : undefined,
      reviewFolder: reviewExists ? reviewDir : undefined,
      thumbnail: fs.existsSync(thumbPath) ? thumbRel : undefined,
    }];
  });
  // generatedAt is an ISO date: newest first.
  videos.sort((a, b) => reportTime(b.generatedAt) - reportTime(a.generatedAt));
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

// Resolve the stable URL for a pre-rendered audition preview, if it exists.

// ---------- Voice references (premium, lawful recorded clips) ----------
const REF_ROOT = join(ROOT, "public", "voice", "references");
interface VoiceRefMeta {
  id: string; label: string; archetype: string; tags: string[];
  transcript: string; url: string; duration: number; sr: number; channels: number;
  license: string; consent: boolean; createdAt: number; notes?: string;
}
function safeId(s: string): string { return String(s || "").replace(/[^a-z0-9-]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase(); }
function probeAudio(path: string): { duration: number; sr: number; channels: number } | null {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-i", path], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  const txt = `${r.stderr ?? ""}
${r.stdout ?? ""}`;
  const dm = txt.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
  if (!dm) return null;
  const dur = Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3]);
  const hzMatch = txt.match(/(\d{4,6})\s*Hz/);
  const sr = hzMatch ? Number(hzMatch[1]) : 0;
  let channels = 1;
  if (/stereo/i.test(txt)) channels = 2;
  else if (/(\d+)\s*channels/i.test(txt)) { const m = txt.match(/(\d+)\s*channels/i); channels = m ? Number(m[1]) : 1; }
  return { duration: Math.round(dur * 100) / 100, sr, channels };
}
function readRefs(): VoiceRefMeta[] {
  if (!fs.existsSync(REF_ROOT)) return [];
  const out: VoiceRefMeta[] = [];
  for (const d of fs.readdirSync(REF_ROOT, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const metaPath = join(REF_ROOT, d.name, "meta.json");
    if (!fs.existsSync(metaPath)) continue;
    try { out.push(JSON.parse(fs.readFileSync(metaPath, "utf8")) as VoiceRefMeta); } catch { /* skip */ }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}
app.get("/api/voice-references", (_req, res) => {
  res.json(readRefs());
});
app.post("/api/voice-references", (req, res) => {
  const b = (req.body ?? {}) as { id?: string; label?: string; archetype?: string; tags?: string[]; audioBase64?: string; transcript?: string; license?: string; consent?: boolean; notes?: string };
  if (!b.audioBase64) return res.status(400).json({ error: "audioBase64 (wav/mp3/ogg) required" });
  if (!b.consent) return res.status(400).json({ error: "consent is required for storing and deriving a voice" });
  const id = safeId(b.id || b.label || `voice-${Date.now().toString(36)}`) || `voice-${Date.now().toString(36)}`;
  const dir = join(REF_ROOT, id);
  fs.mkdirSync(dir, { recursive: true });
  const src = join(dir, "upload.bin");
  const buf = Buffer.from(b.audioBase64, "base64");
  fs.writeFileSync(src, buf);
  const out = join(dir, "reference.wav");
  // normalise to 48 kHz mono wav
  const r = spawnSync(FFMPEG, ["-y", "-i", src, "-vn", "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", out], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  try { fs.unlinkSync(src); } catch { /* ignore */ }
  if (!fs.existsSync(out)) return res.status(500).json({ error: "conversion failed", detail: (r.stderr ?? "").slice(-300) });
  const probe = probeAudio(out);
  if (!probe || probe.duration < 3 || probe.duration > 20) return res.status(400).json({ error: "clip must be 3-20 seconds" });
  const meta: VoiceRefMeta = {
    id, label: (b.label || id).slice(0, 64),
    archetype: b.archetype || "narrator", tags: Array.isArray(b.tags) ? b.tags : [],
    transcript: (b.transcript ?? "").trim(), url: `/media/voice/references/${id}/reference.wav`,
    duration: probe.duration, sr: probe.sr, channels: 1,
    license: b.license || "unknown", consent: true, createdAt: Date.now(), notes: b.notes,
  };
  fs.writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  res.json(meta);
});
app.delete("/api/voice-references/:id", (req, res) => {
  const id = safeId(req.params.id || "");
  const dir = join(REF_ROOT, id);
  if (!id) return res.status(400).json({ error: "invalid id" });
  if (!fs.existsSync(dir)) return res.status(404).json({ error: "not found" });
  fs.rmSync(dir, { recursive: true, force: true });
  res.json({ ok: true });
});
app.post("/api/voice-references/:id/audition", async (req, res) => {
  const id = safeId(req.params.id || "");
  const metaPath = join(REF_ROOT, id, "meta.json");
  if (!fs.existsSync(metaPath)) return res.status(404).json({ error: "not found" });
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as VoiceRefMeta;
  const body = (req.body ?? {}) as { engine?: string; text?: string };
  const engine: "kitten2" | "voxcpm2" = body.engine === "voxcpm2" ? "voxcpm2" : "voxcpm2";
  const voice = meta.label || id;
  const line: VoiceLine = { id: "sample", text: body.text || AUDITION_TEXT, at: 0, engine, voice, voiceDesc: undefined, referenceWav: join(REF_ROOT, id, "reference.wav"), referenceText: meta.transcript, kind: "narration" };
  try {
    const nId = `_ref-audition-${id}`;
    const m = await synthesizeLines([line], nId, { publish: false });
    const wav = m.lines[0]?.file;
    if (!wav || !fs.existsSync(wav)) throw new Error("no file");
    res.setHeader("Content-Type", "audio/wav");
    res.sendFile(wav, { dotfiles: "allow" });
    fs.rmSync(join(ROOT, "output", `${nId}-voice`), { recursive: true, force: true });
  } catch (e) {
    res.status(500).json({ error: "audition failed", detail: (e instanceof Error ? e.message : String(e)).slice(-400) });
  }
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
      voices: VOXCPM_VOICE_DESCRIPTIONS.map((v) => {
        const m = voiceMeta(v.id) ?? undefined;
         const key = voicePreviewKey("voxcpm2", v.id);
         const ready = !!key && fs.existsSync(join(ROOT, ".cache", "voice", `${key}.wav`));
        return {
          id: v.id,
          label: voiceLabel(v.id),
          sample: key ? `/api/voice-preview/voxcpm2/${v.id}/${key}.wav` : null,
           sampleKey: key ?? undefined,
           previewReady: ready,
          gender: m?.gender,
          age: m?.age,
        };
      }),
      descriptions: VOXCPM_VOICE_DESCRIPTIONS,
      defaultNarrator: VOXCPM_VOICE_DESCRIPTIONS[0].id,
      defaultCharacter: "character-hero",
      venvPath: voxcpmPython,
    });
  }
  res.json({
    engine: "kitten2",
    available: kittenAvailable,
    voices: KNOWN_VOICES.map((v) => {
        const m = voiceMeta(v.id) ?? undefined;
        const key = voicePreviewKey("kitten2", v.id);
        const ready = !!key && fs.existsSync(join(ROOT, ".cache", "voice", `${key}.wav`));
        return {
          ...v,
          label: v.label ?? voiceLabel(v.id),
           sample: key ? `/api/voice-preview/kitten2/${v.id}/${key}.wav` : null,
           sampleKey: key ?? undefined,
           previewReady: ready,
          age: m?.age,
           gender: m?.gender,
        };
      }),
    defaultNarrator: "Bruno",
    defaultCharacter: "Rosie",
    venvPath: kittenPython,
    engines: TTS_ENGINES,
  });
});

/** A running job is cancelled (it stays listed as cancelled); a finished one is deleted. */
app.delete("/api/jobs/:id", (req, res) => {
  const done = deleteJob(req.params.id);
  if (!done) return res.status(404).json({ error: "unknown job" });
  res.json({ cancelled: done === "cancelled", deleted: done === "deleted" });
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
  // The per-video folder (output/<id>/: spec, stage files, video, report),
  // its self-review, and the voice files its plan and render made. A folder
  // that is a link (a junction) is never deleted through.
  const folders: Array<[string, string]> = [
    [join(dir, id), `${id}/`],
    [join(dir, `${id}-review`), `${id}-review`],
    [join(dir, `${id}-voice`), `${id}-voice`],
    [join(ROOT, "public", "voice", id), `public/voice/${id}`],
  ];
  for (const [p, label] of folders) {
    try {
      const st = fs.lstatSync(p, { throwIfNoEntry: false });
      if (!st?.isDirectory() || st.isSymbolicLink()) continue;
      fs.rmSync(p, { recursive: true, force: true });
      deleted += 1;
    } catch (e) {
      errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const voiceManifest = join(dir, `${id}-voice.json`);
  if (fs.existsSync(voiceManifest)) {
    try {
      fs.unlinkSync(voiceManifest);
    } catch (e) {
      errors.push(`${id}-voice.json: ${e instanceof Error ? e.message : String(e)}`);
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

// PORT lets a second server run beside the dashboard's (tests, screenshots).
const PORT = Number(process.env.PORT) || 5178;
app.listen(PORT, "127.0.0.1", () => {
  console.log(`Server listening on http://127.0.0.1:${PORT}`);
});
