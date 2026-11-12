/**
 * src/generator/publish/titles.ts — the publish pack's one model call: three
 * title options and the tags, asked of the writer role's model (no role of
 * its own). Code cleans the reply to YouTube's limits (pack.ts) and adds the
 * places the video shows to the tags. When no model can answer (no key, no
 * recorded reply), code titles stand in and the pack says so.
 *
 * Recorded replies: FACTORY_LLM_FIXTURES=<dir> replays <dir>/publish-<n>.txt.
 */
import { z } from "zod";
import { asArray, callRole, type RoleModel } from "../pipeline/llm";
import type { ShotSpec } from "../spec.schema";
import { videoSeconds } from "../spec.schema";
import type { ChannelProfile } from "../ai/channels";
import { cleanTags, cleanTitles, isLongForm, placeNames, shortLabel, TITLE_SOFT } from "./pack";

export const TITLE_COUNT = 3;

export const TitlesReplySchema = z.object({
  titles: z.array(z.string().min(1)).min(TITLE_COUNT),
  tags: z.array(z.string().min(1)).min(1),
});
export type TitlesReply = z.infer<typeof TitlesReplySchema>;

export interface TitlesResult {
  titles: string[];
  tags: string[];
  /** "model": the writer's model answered; "code": the stand-ins (see warning). */
  source: "model" | "code";
  model?: RoleModel;
  warning?: string;
}

/** Key aliases and shapes a model sends instead of { titles, tags }; cleaned to the limits. */
export function normalizeTitles(raw: unknown): unknown {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = (keys: string[]) => keys.map((k) => o[k]).find((v) => v !== undefined);
  const split = (v: unknown) => (typeof v === "string" ? v.split(/[,\n]/) : asArray(v));
  const titles = asArray(pick(["titles", "title_options", "titleOptions", "options", "title"])).map((t) =>
    t && typeof t === "object" ? ((t as Record<string, unknown>).title ?? (t as Record<string, unknown>).text ?? "") : t,
  );
  return {
    titles: cleanTitles(titles),
    tags: cleanTags(split(pick(["tags", "keywords", "tag"]) ?? [])),
  };
}

export function titlesSystem(channel: ChannelProfile): string {
  return [
    `You write the YouTube title options and tags for one finished video of the channel "${channel.name}" (${channel.genre}).`,
    `The channel: ${channel.description}`,
    "Rules:",
    `- Exactly ${TITLE_COUNT} title options, each a different angle: the premise or question, the payoff, the most surprising image.`,
    `- Each title at most ${TITLE_SOFT} characters, in the video's language, sentence case, no emoji, no hashtags, no quotes round it.`,
    "- Promise only what the video shows. No \"you won't believe\", no ALL CAPS words, no question to the viewer that the video does not answer.",
    "- 8 to 15 tags: short search phrases a viewer would type, lowercase, the most specific first (the premise, the places, the subject), then the genre. No '#'.",
  ].join("\n");
}

/** The prompt: what the video is, in its own words. */
export function titlesPrompt(spec: ShotSpec, premise?: string): string {
  const beats = (spec.story?.beats ?? [])
    .map((b) => b.say?.trim() || b.lines?.map((l) => `${l.who}: ${l.text}`).join(" ") || "")
    .filter(Boolean);
  const places = placeNames(spec);
  const secs = Math.round(videoSeconds(spec));
  return [
    premise ? `Premise: "${premise}"` : "",
    `Working title: "${spec.story?.title ?? spec.title}"`,
    `Hook (the first line, shown on screen): "${spec.hook.text}"`,
    spec.story?.mood ? `Mood: ${spec.story.mood}` : "",
    places.length ? `Places shown: ${places.join(", ")}` : "",
    `Format: ${isLongForm(spec) ? "a long-form YouTube video" : "a YouTube Short"}, ${spec.settings?.format ?? "9:16"}, ${secs} s.`,
    beats.length ? `What the narrator says, in order:\n${beats.map((b, i) => `${i + 1}. ${b}`).join("\n")}` : "",
    "",
    `JSON shape: { "titles": ["...", "...", "..."], "tags": ["...", "..."] }`,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/**
 * Titles when no model answers, three when the video has the words: the
 * story's title, the hook, the premise, the title with the places shown, the
 * first line (distinct, cleaned).
 */
export function codeTitles(spec: ShotSpec, premise?: string): string[] {
  const title = spec.story?.title ?? spec.title;
  const places = placeNames(spec);
  const first = spec.story?.beats.find((b) => b.say?.trim())?.say?.trim();
  return cleanTitles(
    [title, spec.title, spec.hook.text, premise, places.length ? `${title}: ${places.join(", ")}` : undefined, first ? shortLabel(first, 10) : undefined].filter(
      (t): t is string => !!t,
    ),
  ).slice(0, TITLE_COUNT);
}

/** Code tags: the places shown, then the channel's genre. */
export function codeTags(spec: ShotSpec, channel: ChannelProfile): string[] {
  return [...placeNames(spec).map((p) => p.toLowerCase()), channel.genre.toLowerCase(), channel.name.toLowerCase()];
}

/**
 * Ask the writer role's model for three titles and the tags. The places
 * shown are always tags (after the model's own); a failed call falls back to
 * code titles and tags, with the reason in `warning`.
 */
export async function askTitles(input: {
  spec: ShotSpec;
  channel: ChannelProfile;
  models: Record<string, RoleModel>;
  premise?: string;
}): Promise<TitlesResult> {
  const { spec, channel, models, premise } = input;
  try {
    const result = await callRole({
      role: "writer",
      label: "publish",
      system: titlesSystem(channel),
      prompt: titlesPrompt(spec, premise),
      schema: TitlesReplySchema,
      normalize: normalizeTitles,
      essential: (v) => (v.titles.length < TITLE_COUNT ? `only ${v.titles.length} distinct titles; write exactly ${TITLE_COUNT}` : null),
      models,
    });
    return {
      titles: result.value.titles.slice(0, TITLE_COUNT),
      tags: cleanTags([...result.value.tags, ...placeNames(spec).map((p) => p.toLowerCase())]),
      source: "model",
      model: { provider: result.provider, model: result.model },
    };
  } catch (e) {
    return {
      titles: codeTitles(spec, premise),
      tags: cleanTags(codeTags(spec, channel)),
      source: "code",
      warning: `titles and tags from code: the writer's model gave none (${e instanceof Error ? e.message.slice(0, 200) : String(e)})`,
    };
  }
}
