/**
 * src/generator/ai/generate-spec.ts
 *
 * Turns a free-text premise into a validated ShotSpec using any AI provider.
 *
 * Uses AI SDK v7 generateObject with zodSchema output validation, so the LLM
 * (of ANY provider) can only return spec-shaped JSON. Includes a repair loop
 * (max 3 attempts) and graceful fallback to offline template families.
 *
 * This is the "LLM branch" previously scaffolded in generate.ts — now wired.
 */
import { generateObject, zodSchema } from "ai";
import { Ollama } from "ollama";
import { z } from "zod";
import { validateAssets } from "../asset-catalog";
import { buildKnowledge } from "./knowledge";
import {
  ShotSpec,
  ShotSpecSchema,
  SettingsSchema,
  formatDims,
  maxDurationFor,
  validateSpec,
  type VideoSettings,
} from "../spec.schema";
import {
  loadAiConfig,
  resolveModel,
  type ModelReference,
} from "./provider-registry";
import { pickRoleModel } from "./roles";

const MAX_REPAIR_ATTEMPTS = 3;

const SYSTEM_PROMPT = `
You are the DIRECTOR and author for a vertical "What If" Shorts factory
(a whole WORLD library: a lived-in low-poly city street at any time of day,
space with planets, and CC0 model-set locations — no voiceover, event-synced
sound effects + ambient beds, stat/timer HUD, italic storytelling captions).

You CREATE each story from the inventories given in the user message:
every scene kit, asset id, sound id, prop style and accent is real and listed
there. Never invent an id, a location, a style, or a name not present in those
lists — anything unknown is rejected and you must replace it with a listed item.

You decide EVERYTHING a director decides: where this happens (which world),
at what time of day, whether there are cars/crowds/props, how the camera
films it, and which shots tell the story — then you also write the text
layers and sound cues so picture, words and audio are one film.

Every story is fresh: NEVER reuse locations, time-of-day, camera style,
compositions, hero props, accent palettes, cast, or beat pacing from the
"MEMORY" list — variation is part of authoring.

Output ONLY a single JSON object conforming to the zod schema below. No prose,
no markdown fences.

Rules:
- Format, total duration and scene count come from the SETTINGS block in the user message. Follow it exactly. 30fps.
- Scenes must start at t=0 and tile contiguously (no gaps, no overlaps) — every second covered.
- Every number drives picture, caption, timer AND audio — sync is arithmetic
  (frame = seconds * fps), so everything stays frame-locked automatically.
- The picture must SHOW the premise: pick the matching heroProp style
  (see the toolkit) unless the world/zoom alone truly tells the story.
- NO voiceover. Sound = one-shots pinned to event frames + ambient bed beneath.
- Hook at t=0 (~2.5s) with the premise as a question.
- Weather (scenes[i].look.weather — none | clear | rain | snow | storm):
  rain/snow/storm put falling particles on screen; storm flashes lightning.
  If the premise is about rain starting or stopping, set the weather look
  AND add worldEvents rain-start / rain-stop at the times the captions say
  they happen — the picture must show the weather, not just say it.
`;

export interface GenerateSpecResult {
  spec: ShotSpec;
  provider: string;
  model: string;
  attempts: number;
  source: "llm" | "offline-fallback";
}

/**
 * buildUserPrompt — full real inventories + memory injected, so the model
 * knows exactly what exists and never repeats itself.
 */
const KNOWLEDGE = `
=== KNOWLEDGE (all of it is real; choose from these only) ===
{KNOWLEDGE}
=== END KNOWLEDGE ===

HARD RULES:
- EVERY scene declares: scenes[i] = { scene: <same string as kit>, kit: <one from
  the scene library>, from, to, look: { timeOfDay: <one from the menu> } }.
  A scene without .kit or without .look.timeOfDay is REJECTED.
- MULTIPLE SHOTS ALLOWED (1-3 scenes unless SETTINGS gives a scene count; they tile contiguously). A cut between
  scenes = a location/time-of-day CHANGE (open in the most striking setting,
  e.g. the earth from orbit, then land on the street; or a golden-hour street
  that turns to night). Every shot must feel different from the others.
- cast: NEVER put cast on street-block, space or
  ocean (they populate themselves); kit scenes (park/pier/boardwalk/interior/
  city-street) DO take 2-6 cast entries from the model catalog to dress the
  place:
    • people/animals use complete character ids (pick who fits the premise)
    • vehicles use COMPLETE vehicles only (taxi/suv/police_car/sports_car/
      car, or car-kit van/truck/tractor) — NEVER part pieces such as
      car_kit_box / cone / wheel / debris, and no "detail-*" trims
    • street furniture: city_kit_roads lights or signs; buildings:
      city_kit_commercial/suburban building-*; greenery: nature_kit
      tree/bush/grass (the engine dresses the skyline itself too).
- scenes[0].street is REQUIRED on street-block scenes (crowdCount,
  vehicleCount, accent, cameraStyle).
- PREMISE VISIBILITY: the picture must SHOW the premise happening. Escalation
  = statPanel beats (the number literally grows the planet/raises the ocean/
  multiplies the street prop). "Gone/vanished/back" stories = spec.worldEvents
  entries (water-vanish / water-return / rain-start / rain-stop / lights-out)
  at the times the captions say they happen.

THREE story families, pick by what the premise says:

1) STREET ESCALATION ("doubled / multiplied every N seconds" and kin):
   - statPanel with 5 beats: t = 2, 5, 8, 11, 14 (adjust spacing only if D !=
     15; the last beat keeps >= 1s before the end); value "1" then doubles
     each beat ("2","4","8","16"); zoom 1 then doubles (2,4,8,16); sub =
     ALL-CAPS concrete punchline; bpm 76 -> 152. Title names the SUBJECT
     ("YOUR MONEY", "THE PRICE OF COFFEE").
   - heroProp matched to the subject with growth "multiply".
   - scenes[0].street.cameraStyle: pick ONE per story, different from what
     the memory stories used.
   - events: one pop_light exactly at each beat t, optionally 1-2 street SFX
     BETWEEN beats (car_pass, horn_distant, bike_bell — never overlapping a
     beat pop).
   - audio.ambient: street_murmur 0->D vol 0.55 + heartbeat ladder
     (heartbeat_bpm70/90/110/130/150, restart: true, segmented by nearest
     bpm: <=82->70, <=99->90, <=119->110, <=139->130, else 150; the last
     segment ends at D).
   - NO timer HUD.

2) STREET VANISH / "gone for N seconds" (any "X disappears" premise):
   - timer { label: "TIME WITHOUT WATER" style, startT: when it vanishes
     (~2.5s), endT: when it returns (~1s before the end). If it never
     returns, endT = D - 1 }.
   - heroProp matching the subject with growth "vanish" (water-puddles for
     water, ice-crystals for cold/ice, orb-pedestal for power/fame; no match
     → "none" and tell it through the world).
   - events: whoosh_dissolve at the vanish moment, impact_soft_bodies at the
     return moment (or rise_short), plus pop_light at the hook.
   - audio.ambient: street_murmur 0->D vol 0.55 + wind_city or ambient_tense
     0->D vol 0.35.
   - NO statPanel. Set the street's time-of-day by the premise's mood.

3) SPACE (moon / planet / earth / cosmic premises):
   - scenes[0] = { scene: "space", kit: "space", from: 0, to: D, subject:
     earth | moon | mars, look: { timeOfDay: "night" } } — no street knobs,
     no cast, no heroProp (the PLANET is the subject; the stat beats multiply
     its size on screen).
   - statPanel with 5 beats exactly like family 1 (the title names the world:
     "THE MOON", "OUR PLANET"); events: pop_light at each beat + whoosh_dissolve
     near t=1; audio.ambient: ambient_tense 0->D vol 0.4 (optionally +
     wind_city 0->D vol 0.25 for scale-onset dread).
   - "night" is the only valid look.timeOfDay for space scenes.

Captions for ALL families: style "serif-italic", one per beat/event moment,
starting ~0.2s after each moment, about what the viewer is SEEING — name the
PLACE and the TIME the way a narrator would: "On the day side of the moon
..." / "At midnight on the empty street ...". Hook at t=0 for ~2.5s with the
premise as a question.

Write the story's complete ShotSpec now.
`;

/** The user's production settings as hard constraints for the writer. */
function settingsBlock(settings: VideoSettings): string {
  const dims = formatDims(settings.format);
  const max = maxDurationFor(settings.format);
  const duration = settings.targetDuration
    ? `about ${settings.targetDuration}s (must stay between 8s and ${max}s)`
    : settings.format === "16:9"
      ? "between 60s and 180s"
      : "between 12s and 45s";
  const scenes = settings.sceneCount ? `exactly ${settings.sceneCount}` : "1 to 6";
  return `
=== SETTINGS (mandatory) ===
- format: ${settings.format} (${dims.width}x${dims.height}, 30fps)
- total duration: ${duration}
- scenes: ${scenes}
=== END SETTINGS ===`;
}

function buildUserPrompt(premise: string, settings: VideoSettings): string {
  return `
Premise: "${premise}"
${settingsBlock(settings)}

${KNOWLEDGE.replace("{KNOWLEDGE}", buildKnowledge(premise))}
`;
}

/** Direct-connection descriptor for the native Ollama branch. */
export interface OllamaDirect {
  host: string;
  apiKey: string;
}

/**
 * Generate a spec with the LLM, validating + repairing up to MAX_REPAIR_ATTEMPTS.
 * Each repair attempt tells the model EXACTLY what failed: the field-level
 * zod violations and its own previous raw output — so a model that *can* emit
 * schema-valid JSON converges instead of repeating the same mistake.
 */

/** Extract the first JSON object from model chatter (markdown fences, prose). */
function extractJson(content: string): unknown {
  const s = content.indexOf("{");
  const e = content.lastIndexOf("}");
  const blob = s >= 0 && e > s ? content.slice(s, e + 1) : content.trim();
  return JSON.parse(blob);
}

/** Compact JSON-schema contract embedded into the prompt (needed because
 * ollama CLOUD models don't apply `format` enforcement — that only works for
 * locally-served models; local installs still get it via the request.) */
const OLLAMA_CONTRACT_TEXT = (() => {
  try {
    const schemaJson = z.toJSONSchema(ShotSpecSchema, { unrepresentable: "any", io: "input" });
    return (
      "\n\nOUTPUT CONTRACT — respond with EXACTLY one JSON object matching this schema. " +
      "Field names are mandatory and spelled exactly as given (no extra keys, no markdown fences, no commentary):\n" +
      JSON.stringify(schemaJson)
    );
  } catch {
    return "\n\nRespond with ONLY one JSON object conforming to the described schema — no commentary, no markdown fences.";
  }
})();
async function generateWithModel(
  reference: ModelReference,
  provider: string,
  model: string,
  premise: string,
  settings: VideoSettings,
  ollamaDirect: OllamaDirect | null = null,
): Promise<ShotSpec> {
  let lastFailure: { violations?: string; rawOutput?: string } | null = null;
  const fullPrompt =
    buildUserPrompt(premise, settings) + (lastFailure ? buildRepairContext(lastFailure) : "");

  for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    const started = Date.now();
    const promptForAttempt =
      attempt === 1
        ? fullPrompt
        : buildUserPrompt(premise, settings) + (lastFailure ? buildRepairContext(lastFailure) : "");
    console.log(
      `[AI] attempt ${attempt}/${MAX_REPAIR_ATTEMPTS} — prompting ${provider}/${model}...`,
    );
    try {
      let spec: unknown;
      let totalTokens: number | undefined;
      if (ollamaDirect) {
        // Native Ollama: pass the schema via `format` — Ollama enforces it
        // SERVER-SIDE (constrained decoding), so the model physically cannot
        // emit JSON that doesn't match. Timing sanity is then checked by
        // validateSpec; violations feed the repair loop.
        const client = new Ollama({
          host: ollamaDirect.host,
          headers: ollamaDirect.apiKey
            ? { Authorization: `Bearer ${ollamaDirect.apiKey}` }
            : undefined,
        });
        const response = await client.chat({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: promptForAttempt + OLLAMA_CONTRACT_TEXT },
          ],
          format: z.toJSONSchema(ShotSpecSchema, { unrepresentable: "any", io: "input" }),
          stream: false,
        });
        totalTokens = response.eval_count ?? undefined;
        const content = response.message?.content ?? "";
        try {
          spec = extractJson(content);
        } catch {
          // No JSON blob at all — recover via the repair loop:
          lastFailure = { rawOutput: content.slice(0, 2000) };
          throw new Error("response contained no parsable JSON object");
        }
      } else {
        // OpenAI-compatible / SDK providers: generateObject requests
        // provider-level JSON mode (response_format).
        const result = await generateObject({
          model: reference,
          schema: zodSchema(ShotSpecSchema),
          system: SYSTEM_PROMPT,
          prompt: promptForAttempt,
        });
        spec = result.object as unknown;
        totalTokens = result.usage?.totalTokens;
      }

      const secs = ((Date.now() - started) / 1000).toFixed(1);
      console.log(
        `[AI] response received in ${secs}s${totalTokens ? ` (${totalTokens} tokens)` : ""}`,
      );
      // Our settings win over whatever the model wrote into the settings field.
      const valid = validateSpec({ ...(spec as object), settings }); // throws ZodError if invalid
      validateAssets(valid); // throws if a cast asset id doesn't exist (repairable)
      console.log(
        `[AI] spec validation — PASS (${valid.scenes.length} scenes, ${(valid.events ?? []).length} events)`,
      );
      return valid;
    } catch (e) {
      lastFailure = extractFailure(e);
      const summary = lastFailure.violations
        ? lastFailure.violations.slice(0, 300)
        : "unknown schema failure";
      console.error(`[AI] attempt ${attempt} failed — schema violations: ${summary}`);
      // continue to next attempt with precise repair context
    }
  }

  const detail = lastFailure?.violations ?? lastErrorOf(lastFailure);
  throw new Error(
    `LLM spec generation failed after ${MAX_REPAIR_ATTEMPTS} attempts with ${provider}/${model}. ` +
      `Last schema violations: ${detail ?? "unknown"}. ` +
      `The model likely can't reliably emit strict schema JSON — try a stronger model.`,
  );
}

/** Human hint appended when every attempt failed with schema violations. */
function lastErrorOf(f: { violations?: string; rawOutput?: string } | null): string | undefined {
  if (!f) return undefined;
  if (f.violations) return f.violations;
  if (f.rawOutput) return `raw output started: ${f.rawOutput.slice(0, 120)}`;
  return undefined;
}

/** Build a repair prompt block with the model's own output + exact violations. */
function buildRepairContext(f: { violations?: string; rawOutput?: string }): string {
  let ctx = `\n\nPREVIOUS ATTEMPT FAILED VALIDATION. Fix every violation and return ONE corrected JSON object.`;
  if (f.violations) {
    ctx += `\nField violations (path: problem):\n${f.violations}`;
  }
  if (f.rawOutput) {
    ctx += `\nYour previous raw output (repair THIS, don't start over):\n${f.rawOutput.slice(0, 3000)}`;
  }
  return ctx;
}

/**
 * Pull actionable details out of AI SDK NoObjectGeneratedError (.text = raw
 * model output, .cause = the zod error with .issues) or a plain ZodError.
 */
function extractFailure(e: unknown): { violations?: string; rawOutput?: string } {
  const rawText = (e as { text?: unknown } | null)?.text;
  const rawOutput = typeof rawText === "string" && rawText.trim() ? rawText : undefined;
  const err = e as {
    message?: string;
    cause?: unknown;
    issues?: Array<{ path?: Array<string | number | symbol>; message?: string }>;
  };
  const details: { violations?: string; rawOutput?: string } = { rawOutput };

  const issuesSource =
    (err.issues && err.issues.length ? err : null) ?? (isZodLike(err.cause) ? (err.cause as ZodLike) : null);
  const issues = issuesSource?.issues;
  if (Array.isArray(issues) && issues.length) {
    details.violations = issues
      .slice(0, 12)
      .map((i) => `${(i.path ?? []).join(".") || "(root)"}: ${i.message ?? "invalid"}`)
      .join("; ");
  } else if (err.message) {
    details.violations = err.message.slice(0, 600);
  } else if (err.cause instanceof Error && err.cause.message) {
    details.violations = err.cause.message.slice(0, 200);
  }
  return details;
}

interface ZodLike {
  issues?: Array<{ path?: Array<string | number | symbol>; message?: string }>;
}
function isZodLike(v: unknown): boolean {
  return (
    typeof v === "object" &&
    v !== null &&
    Array.isArray((v as ZodLike).issues) &&
    (v as ZodLike).issues!.length > 0
  );
}

/**
 * Public entry point. Resolves the model, generates (or falls back to offline),
 * returns a validated ShotSpec + provenance info.
 */
export async function generateSpec(
  premise: string,
  providerName: string | undefined,
  modelId: string | undefined,
  settingsInput: Partial<VideoSettings> = {},
): Promise<GenerateSpecResult> {
  const settings = SettingsSchema.parse(settingsInput);
  const config = loadAiConfig();
  // The writer role decides the model unless the caller named one explicitly.
  const pick = pickRoleModel(config.roles, "writer", providerName, modelId);
  const resolved = resolveModel(config, pick.provider, pick.model);

  // Offline path: no provider configured or resolution failed → use templates.
  if (!resolved.reference || !resolved.hasKey) {
    const { buildFamilySpec } = await import("../build-family-spec");
    const family = buildFamilySpec(premise);
    if (family) {
      const spec = { ...family, id: slug(premise), title: premise, settings };
      return {
        spec: validateSpec(spec),
        provider: "offline",
        model: "templates",
        attempts: 0,
        source: "offline-fallback",
      };
    }
    throw new Error(
      resolved.error ??
        `No AI provider configured and no offline template matches: "${premise}".\n` +
          `Set a provider key (see ai.config.json / .env.example) or use a ` +
          `supported family: gravity, time-stop, spin-stop, air, water, oxygen, ` +
          `electrons, protons, neutrons, light, sun-set.`,
    );
  }

  const provCfg = config.providers?.[resolved.provider];
  const ollamaDirect: OllamaDirect | null =
    (resolved.provider === "ollama" || provCfg?.package === "ollama") && provCfg
      ? {
          host: (provCfg.baseUrl ?? "http://localhost:11434/v1").replace(/\/v1\/?$/, ""),
          apiKey: provCfg.apiKeyEnv ? process.env[provCfg.apiKeyEnv] ?? "" : "",
        }
      : null;

  const spec = await generateWithModel(
    resolved.reference,
    resolved.provider,
    resolved.model,
    premise,
    settings,
    ollamaDirect,
  );

  return {
    spec,
    provider: resolved.provider,
    model: resolved.model,
    attempts: 1,
    source: "llm",
  };
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "video";
}
