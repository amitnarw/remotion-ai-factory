/**
 * src/whatif/story/writer.ts — the Story Studio writer.
 *
 * Turns a typed topic (or the user's own full story) into a validated
 * Storyboard — the complete movie plan: beats, camera language, on-screen
 * text, narration/dialogue, ambience/SFX placement and music mood.
 *
 * Quality machinery (research-grounded — Kling/Higgsfield camera grammar,
 * Veo-style layered per-beat audio, Shorts retention data, Harmon's story
 * circle):
 *   1. STORY BIBLE system prompt — the director's craft rules.
 *   2. Repair loop — schema violations fed back verbatim (≤3 attempts).
 *   3. STORY DOCTOR — a second opinion pass; concrete issues → one revise.
 *
 * Uses the provider configured in ai.config.json (.env keys from the
 * dashboard). Providers with package "ollama" go through the native Ollama
 * client with schema-constrained output.
 */
import { generateObject, zodSchema } from "ai";
import { Ollama } from "ollama";
import { z } from "zod";
import {
  parseStoryboard,
  storyboardIssues,
  StoryboardSchema,
  type Storyboard,
} from "../storyboard/schema";
import { loadAiConfig, resolveModel, type ModelReference } from "../../generator/ai/provider-registry";

/* ------------------------------------------------------------------ */
/*  The story bible — the director's craft, distilled                  */
/* ------------------------------------------------------------------ */

export const STORY_BIBLE = `
You are the HEAD WRITER & DIRECTOR of a premium animated "What If" Shorts studio.
Your videos are vertical 1080x1920 cartoons starring a round blob character in
stylized 3D-feeling sets — think Zack D. Films: bold, funny, physical, cruel-but-
harmless comedy physics, cross-section ideas, and a narrator with a deep voice.

You output ONE JSON object: a complete STORYBOARD (beats + camera + text + voice
+ audio plan). Every field must be renderable — only use the exact vocabulary
below. NO markdown fences, NO commentary.

## STORY STRUCTURE (compressed story circle — follow it)
Write hook and payoff FIRST, then bridge them. Beats in 15-45s videos:
1 HOOK (2-3s): the premise as a question or shock. BigType text = 1-3 words.
2 NORMAL (2.5-5s): ordinary world; the character is happy/safe. Plant ONE detail
  (a mug, a door, a balloon) the payoff will reuse.
3 EVENT (2-5s): the "what if" flips. The single most surprising visual of the film.
4 ESCALATE (2x beats, 4-8s total): consequences worsen, each beat NEWER and BIGGER
  than the last. Comedy of escalation. The character's mood worsens.
5 APEX (2-3s): maximum intensity — the biggest camera move, loudest sound.
6 PAYOFF/RESET (3-5s): twist, punchline or warm landing. Answers the hook. If
  loopable=true, end on a frame that makes sense right before the hook replays.

## PACING (hard rules from retention data)
- 50-60% of viewers leave within 3s: beat 1 must slap — loudest sound motion and
  boldest text of the whole video.
- NEW story beat every 5-7s; a visual change (scene, camera move or big effect)
  at least every 4s. Same scene twice in a row MUST change the camera move.
- Escalation order: nothing may be smaller than the beat before it.

## CAMERA (each beat: shot size + angle + ONE move + intensity)
Emotional grammar — choose moves FOR the story, not decoration:
  static = calm/neutral   push-in = intimacy, realization   pull-back = reveal context/isolation
  pan/truck = follow action or show scale   tilt = height/power   crane = epic reveal
  orbit = heroic/momentous (once per video max)   dutch = wrongness/panic
  crash-zoom = shock or comedy beat   whip-pan = burst of speed   rack-focus = reveal a detail
  handheld = chaos/panic   low angle = power, high angle = vulnerability, top-down = fate/god's eye
- Shot sizes: establishing(wide location) > wide > medium > cu(face) > ecu(one detail).
- Reserve the biggest move for the APEX beat. Speeds: intensity 0.5 slow … 2 aggressive.

## WHAT YOU SEE (scene + character + text + audio per beat)
- see: 4-20 words describing the shot — ONLY what the renderer draws: the scene,
  the blob (pose, expression, action), the planted mug and the scene's OWN
  weather/props. NEVER invent new objects, characters or locations — if it
  is not listed above, it cannot appear in the "see" field.
- scene: "room" (warm home) | "city-night" (neon street) | "sky" (open clouds) |
  "tech-void" (dark abstract void — hooks, science facts).
- character (the blob): pose idle/walk/point/shrug/float/fall; expression
  neutral/smile/wow/worry. Character may be null (empty world shots).
- text: 1-3 UPPERCASE lines, each <=14 chars. Beat 1 = the hook words. Payoff beat
  often repeats a callback word from beat 2's planted detail.
- narration (<= 2.4 words per second of the beat, minus 0.6s pad): ONE idea per
  beat, short punchy sentences, concrete nouns, no filler. Present tense.
- dialogue (the CHARACTER speaks — short, <= 12 words, funny/desperate).
- ambience: ONE bed for the WHOLE video (it runs underneath everything):
  wind_city for outdoors/city stories, ambient_tense for voids/dread, none for
  fully calm or voice-heavy films.
- sfx: 0-3 per beat with an onset time (seconds from beat start). Place sounds ON
  the action (door=pick something solid, crash=impact, whoosh=motion). Available
  roles: whoosh_dissolve, rumble_deep, clothing_flutter, impact_soft_bodies,
  scream_distant, pop_light, rise_short.
- props: plant "mug" in 1-2 beats (normal world or payoff) — details viewers
  notice on loop.
- music: one mood for the whole video (dark-tension / warm-curious / epic-lift).

## VOICE (how it's told)
- voice.mode: "narrator" (default — deep, deadpan, dramatic), "character" (the
  blob speaks everything), "both" (narrator + the blob's reactions), "silent"
  (text-only, sound design carries it). Pick what serves the story; for
  "What if..." topics prefer narrator or both.
- If the narration mentions numbers/scale/physics, they go in the text lines too.

## LENGTH
Beats must sum to targetSeconds (±0.4s). 15s = 4-5 beats, 20s = 5-6, 30s = 6-8,
45s+ = 8-9 beats (still escalate, still one payoff).

Return ONLY the JSON storyboard object.
`.trim();

/* ------------------------------------------------------------------ */
/*  Prompts                                                            */
/* ------------------------------------------------------------------ */

const VOICE_LIST_NOTE = `NARRATOR VOICES (exact ids from the local engine): narratorVoice
"Bruno" (deep male, paces well), characterVoice "Rosie" (bright, funny female).
NEVER use "Bella" (this voice rambles past the line). Only set these two
fields; never invent voice names.`;

function buildUserPrompt(req: PlanRequest): string {
  const length =
    req.feedback && req.feedback.trim().length > 0
      ? `\n\n## REWRITE REQUEST\nThe director rejected your previous storyboard with this note:\n"""${req.feedback.trim()}"""\nAddress EVERY point in the note. Keep everything that works.`
      : "";
  if (req.mode === "topic") {
    return `TOPIC: "${req.input}"
TARGET LENGTH: ${req.seconds} seconds.
Write the full storyboard: invent the story this topic implies — the hook, the
normal world, the flip, the escalation, the apex and the payoff. Be playful,
physical and specific. The blob is your actor.
${VOICE_LIST_NOTE}${length}`;
  }
  return `Here is the FULL STORY the director wrote (the source of truth — do not
change its events, characters or words unless the note demands it):

"""${req.input}"""

TARGET LENGTH: ${req.seconds} seconds.
Your job is DIRECTING, not rewriting: break the story into beats, choose scene /
camera / text for each, write or trim the narration faithfully (≤ 2.4 words/sec
per beat), place sounds on the actions, and mark who speaks what. Keep its
beginning, middle and end exactly.
${VOICE_LIST_NOTE}${length}`;
}

const DOCTOR_SCHEMA = z.object({
  issues: z
    .array(z.string().max(300))
    .max(6)
    .describe("Concrete, fixable story problems — empty if it's already strong"),
});

const DOCTOR_SYSTEM = `
You are the STORY DOCTOR for viral vertical "What if" cartoons. You review a
storyboard JSON and list concrete, fixable problems. Judge:
1. HOOK — would beat 1 stop a scroller in <1.5s? Is its text 1-3 words and bold?
2. Does the payoff answer the hook? Is there a twist or smile in the last beat?
3. Any two consecutive beats that feel the same (no escalation, same camera)?
4. Are camera moves emotionally motivated (push-in=realize, pull-back=reveal…)?
5. Are sounds ON actions, and is the loudest beat the APEX?
6. Narration: too long for its beat (≤2.4 words/sec)? Any beat with zero visual
   change vs the previous one?
7. Loopability: does the end flow back into the beginning?
Report ONLY real problems, each in one short actionable sentence prefixed by the
beat number (e.g. "beat 3: camera repeats push-in from beat 2 — use truck-left").
If the storyboard is genuinely tight, return an empty list.
`.trim();

export interface PlanRequest {
  mode: "topic" | "story";
  /** topic (mode topic) or full story text (mode story). */
  input: string;
  seconds: number;
  /** Director's note for a rewrite pass. */
  feedback?: string;
  provider?: string;
  model?: string;
  /** Previous storyboard JSON — when rewriting, the model repairs THIS. */
  previous?: Storyboard | null;
}

export interface PlanResult {
  storyboard: Storyboard;
  provider: string;
  model: string;
  attempts: number;
  doctorIssues: string[];
}

/* ------------------------------------------------------------------ */
/*  LLM plumbing (mirrors generate-spec.ts patterns)                   */
/* ------------------------------------------------------------------ */

function extractJson(content: string): unknown {
  const s = content.indexOf("{");
  const e = content.lastIndexOf("}");
  const blob = s >= 0 && e > s ? content.slice(s, e + 1) : content.trim();
  return JSON.parse(blob);
}

const CONTRACT_NOTE = (() => {
  try {
    const schemaJson = z.toJSONSchema(StoryboardSchema, {
      unrepresentable: "any",
      io: "input",
    });
    return (
      "\n\nOUTPUT CONTRACT — respond with EXACTLY one JSON object matching this schema " +
      "(field names mandatory, spelled exactly; no extra keys, no markdown fences):\n" +
      JSON.stringify(schemaJson)
    );
  } catch {
    return "\n\nRespond with ONLY one JSON object — no commentary, no markdown fences.";
  }
})();

function repairContext(violations?: string, raw?: string): string {
  let ctx = "\n\nPREVIOUS ATTEMPT FAILED VALIDATION. Fix every violation, return ONE corrected JSON object.";
  if (violations) ctx += `\nField violations:\n${violations.slice(0, 800)}`;
  if (raw) ctx += `\nYour previous output (repair THIS — don't start over):\n${raw.slice(0, 3500)}`;
  return ctx;
}

function extractFailure(e: unknown): { violations?: string; raw?: string } {
  const rawText = (e as { text?: unknown; rawText?: unknown } | null)?.rawText ?? (e as { text?: unknown } | null)?.text;
  const raw = typeof rawText === "string" && rawText.trim() ? rawText : undefined;
  const err = e as {
    message?: string;
    cause?: unknown;
    issues?: Array<{ path?: Array<string | number | symbol>; message?: string }>;
  };
  const issues =
    (err.issues && err.issues.length ? err.issues : null) ??
    ((err.cause as { issues?: unknown })?.issues as typeof err.issues | undefined) ??
    null;
  if (issues && issues.length) {
    return {
      violations: issues
        .slice(0, 10)
        .map((i) => `${(i.path ?? []).join(".") || "(root)"}: ${i.message ?? "invalid"}`)
        .join("; "),
      raw,
    };
  }
  return { violations: err.message?.slice(0, 500), raw };
}

/** Deterministic music seed from the title. */
function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (Math.abs(h) % 99999) + 1;
}

/** Call the model for one object. Logs via onLog. */
async function callModel(
  reference: ModelReference,
  provider: string,
  model: string,
  cfg: { baseUrl?: string; apiKeyEnv?: string },
  ollama: { host: string; apiKey: string } | null,
  system: string,
  prompt: string,
  schema: z.ZodTypeAny,
  onLog: (line: string) => void,
): Promise<unknown> {
  if (ollama) {
    const client = new Ollama({
      host: ollama.host,
      headers: ollama.apiKey ? { Authorization: `Bearer ${ollama.apiKey}` } : undefined,
    });
    const response = await client.chat({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      format: z.toJSONSchema(schema, { unrepresentable: "any", io: "input" }),
      stream: false,
    });
    const content = response.message?.content ?? "";
    let parsed: unknown;
    try {
      parsed = extractJson(content);
    } catch {
      const err = new Error("response was not parsable JSON");
      (err as { rawText?: string }).rawText = content.slice(0, 2500);
      throw err;
    }
    onLog(`[plan] ${provider}/${model} responded (${response.eval_count ?? "?"} tokens)`);
    return parsed;
  }
  const result = await generateObject({
    model: reference,
    schema: zodSchema(schema as never),
    system,
    prompt,
  });
  onLog(`[plan] ${provider}/${model} responded (${result.usage?.totalTokens ?? "?"} tokens)`);
  return result.object as unknown;
}

/* ------------------------------------------------------------------ */
/*  Main entry                                                         */
/* ------------------------------------------------------------------ */

const MAX_ATTEMPTS = 3;

export async function writeStoryboard(
  req: PlanRequest,
  onLog: (line: string) => void = () => {},
): Promise<PlanResult> {
  const config = loadAiConfig();
  // Resolution order: explicit → configured default → any provider with a
  // usable key ("ollama" first if present — the factory's text-provider of
  // choice). A provider without a usable key is skipped, not fatal.
  const candidates = [
    req.provider,
    config.defaultProvider,
    config.providers?.ollama && config.providers.ollama.apiKeyEnv
      ? "ollama"
      : undefined,
    ...Object.keys(config.providers ?? {}),
  ].filter((p): p is string => Boolean(p));
  let resolved: ReturnType<typeof resolveModel> | null = null;
  for (const name of [...new Set(candidates)]) {
    const r = resolveModel(config, name, req.model);
    if (r.reference && r.hasKey) {
      resolved = r;
      break;
    }
    onLog(`[plan] provider "${name}" skipped (${r.error ?? r.hasKey ? "no usable key" : "unavailable"})`);
  }
  if (!resolved || !resolved.reference || !resolved.hasKey) {
    throw new Error(
      "No AI provider with a usable key found for story writing.\n→ Fix: open the Providers tab and save your key (Ollama / gateway / OpenAI…)",
    );
  }
  // Default model: prefer story-strong text models in this order.
  const prefers = ["glm-5.3-flash", "glm-5.3", "glm-5.2", "gpt-oss:120b", "kimi-k2.6", "glm-4.7"];
  const providerModels = config.providers?.[resolved.provider]?.models ?? [];
  if (!req.model) {
    const preferred = prefers.find((m) => providerModels.includes(m));
    if (preferred) resolved = { ...resolved, model: preferred };
  }
  const reference = resolved.reference as NonNullable<typeof resolved.reference>;
  const provCfg = config.providers?.[resolved.provider];
  const ollama =
    (resolved.provider === "ollama" || provCfg?.package === "ollama") && provCfg
      ? {
          host: (provCfg.baseUrl ?? "http://localhost:11434/v1").replace(/\/v1\/?$/, ""),
          apiKey: provCfg.apiKeyEnv ? process.env[provCfg.apiKeyEnv] ?? "" : "",
        }
      : null;

  // --- 1. Draft (with repair loop) ---
  let draft: Storyboard | null = null;
  let failures: { violations?: string; raw?: string } | undefined;
  let attempts = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attempts = attempt;
    onLog(`[plan] writing the story — attempt ${attempt}/${MAX_ATTEMPTS} (${resolved.provider}/${resolved.model})`);
    const prompt =
      buildUserPrompt(req) +
      (req.previous
        ? `\n\nPREVIOUS STORYBOARD (improve THIS per the note — keep its slug-worthy spine):\n${JSON.stringify(req.previous).slice(0, 6000)}`
        : "") +
      CONTRACT_NOTE +
      (failures ? repairContext(failures.violations, failures.raw) : "");
    try {
      const raw = await callModel(
        reference,
        resolved.provider,
        resolved.model,
        provCfg ?? {},
        ollama,
        STORY_BIBLE,
        prompt,
        StoryboardSchema,
        onLog,
      );
      const parsed = parseStoryboard(raw);
      if (!parsed) {
        const issues = storyboardIssues(raw);
        failures = { violations: issues.join("; "), raw: JSON.stringify(raw).slice(0, 3500) };
        onLog(`[plan] schema violations: ${issues.slice(0, 3).join("; ")}`);
        continue;
      }
      draft = parsed;
      break;
    } catch (e) {
      failures = extractFailure(e);
      onLog(`[plan] attempt ${attempt} failed: ${(failures.violations ?? "unknown").slice(0, 200)}`);
    }
  }
  if (!draft) {
    throw new Error(
      `Story writing failed after ${MAX_ATTEMPTS} attempts with ${resolved.provider}/${resolved.model}. ` +
        `Last problem: ${failures?.violations ?? failures?.raw?.slice(0, 200) ?? "unknown"}. ` +
        `→ Fix: try a stronger model (Providers tab) or press Rewrite again`,
    );
  }

  // --- 2. The story doctor ---
  let doctorIssues: string[] = [];
  try {
    onLog("[plan] story doctor reviewing…");
    const review = await callModel(
      reference,
      resolved.provider,
      resolved.model,
      provCfg ?? {},
      ollama,
      DOCTOR_SYSTEM,
      `STORYBOARD:\n${JSON.stringify(draft, null, 1)}\n\nList concrete problems (or an empty list).`,
      DOCTOR_SCHEMA,
      onLog,
    ) as z.infer<typeof DOCTOR_SCHEMA>;
    doctorIssues = (review?.issues ?? []).filter((s) => typeof s === "string" && s.trim());
  } catch (e) {
    // Cloud models sometimes answer with plain bullet text — recover it.
    const f = extractFailure(e);
    const recovered = (f.raw ?? "")
      .split(/\r?\n/)
      .map((s) => s.replace(/^\s*[-*\d.]+\s*/, "").trim())
      .filter((s) => /beat\s*\d+/i.test(s))
      .slice(0, 5);
    if (recovered.length > 0) {
      doctorIssues = recovered;
      onLog(`[plan] doctor (recovered from text): ${recovered.length} issue(s)`);
    } else {
      onLog(`[plan] doctor skipped (${e instanceof Error ? e.message.slice(0, 120) : "error"})`);
    }
  }

  // --- 3. Revise if the doctor found real problems ---
  if (doctorIssues.length > 0) {
    onLog(`[plan] doctor: ${doctorIssues.length} issue(s) — revising…`);
    try {
      const raw = await callModel(
        reference,
        resolved.provider,
        resolved.model,
        provCfg ?? {},
        ollama,
        STORY_BIBLE,
        buildUserPrompt(req) +
          `\n\n## STORY DOCTOR REPORT — fix every issue\n${doctorIssues.map((s) => `- ${s}`).join("\n")}` +
          `\n\nPREVIOUS STORYBOARD:\n${JSON.stringify(draft).slice(0, 6000)}` +
          CONTRACT_NOTE,
        StoryboardSchema,
        onLog,
      );
      const revised = parseStoryboard(raw);
      if (revised) draft = revised;
      else onLog("[plan] revision failed schema — keeping the doctor-rejected draft");
    } catch {
      onLog("[plan] revision errored — keeping the draft");
    }
  }

  // --- 4. Deterministic finish ---
  if (!draft.music.seed) draft.music.seed = seedFrom(draft.title);
  onLog(
    `[plan] storyboard ready — "${draft.title}" · ${draft.beats.length} beats · ${draft.targetSeconds}s · voice: ${draft.voice.mode}`,
  );
  return {
    storyboard: draft,
    provider: resolved.provider,
    model: resolved.model,
    attempts,
    doctorIssues,
  };
}
