/**
 * src/generator/pipeline/sound.ts — the Sound designer: music, beds and hits.
 *
 * A rules baseline always exists (beds by kit, weather and time of day, music
 * from the writer's mood; a scene at a real world place sounds like that
 * place at its moment, see placeSound). The LLM sound designer may replace the music and
 * beds and add hits, choosing ONLY from a fixed vocabulary of named sounds;
 * audio-resolve turns each name into a library file or its synthesized
 * fallback, so every name plays. If the LLM call fails, the baseline stands.
 *
 * Sounds tied to devices (counter pops, the heartbeat ladder, world-event
 * hits) are added by the assembler, which knows their exact times. So is a
 * time-lapse's ambience (lapseAmbience): its light changes inside the scene,
 * and the place's sound follows it, on the spec's exact seconds. So is a
 * storm's thunder (stormThunder), on the lightning's own clock.
 *
 * Weather at a world place (docs/factory/18-world-weather.md): the world
 * draws the director's rain and storm, so the rules give its rain bed over
 * the stretches it falls (worldRainStretches: from the scene's start, or its
 * rain-start, to its rain-stop or end), on top of the place's own beds, and
 * the designer hears the weather in the scene's name.
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { z } from "zod";
import { MOOD_TAGS, SOUND_QUERY } from "../audio-resolve";
import { resolveWorldLapse, resolveWorldScene } from "../../world/director-context";
import { lapseClock, type LapseWorld } from "../../world/lapse";
import { worldWeather } from "../../world/weather/weather";
import { modelSetDef, type ModelSetDef, type SetKind } from "../../world/modelset/sets";
import { VFX_SOUND } from "../../world/vfx/spec";
import { LIGHTNING_PERIOD } from "../../compositions/lightning";
import type { ShotSpec } from "../spec.schema";
import type { ResolvedPlace } from "../../world/places";
import { Surface } from "../../world/surface";
import { asArray, beatRef, callRole, fuzzyEnum, type RoleModel } from "./llm";
import type { Direction } from "./director";
import type { Timeline } from "./timeline";
import type { WriterStory } from "./writer";

export interface SoundPlan {
  music: Array<{ start: string; mood: string }>;
  beds: Array<{ start: string; end: string | null; sound: string; level: number }>;
  hits: Array<{ beat: string; at: "start" | "end"; sound: string }>;
}

const MOODS = Object.keys(MOOD_TAGS);

/** Every sound name the designer may use: library-backed names + the synthesized catalog. */
export function soundVocabulary(): string[] {
  const names = new Set(Object.keys(SOUND_QUERY));
  const catalog = join(process.cwd(), "public", "sfx", "sfx.catalog.json");
  if (existsSync(catalog)) {
    try {
      const roles = (JSON.parse(readFileSync(catalog, "utf8")) as { roles?: Record<string, unknown> }).roles ?? {};
      for (const r of Object.keys(roles)) if (!r.startsWith("music_")) names.add(r);
    } catch {
      /* synth catalog unreadable: library names only */
    }
  }
  return [...names].sort();
}

/** Beds each world carries by default: [sound, level]. */
const BEDS_BY_KIT: Record<string, Array<[string, number]>> = {
  "street-block": [["street_murmur", 0.55], ["traffic", 0.3]],
  "city-street": [["street_murmur", 0.45], ["traffic", 0.25]],
  park: [["forest_birds", 0.35], ["street_murmur", 0.25]],
  boardwalk: [["ocean_waves", 0.4], ["street_murmur", 0.25]],
  pier: [["ocean_waves", 0.45]],
  space: [["space_cosmic_wind", 0.35]],
  ocean: [["ocean_waves", 0.5]],
  countryside: [["wind_city", 0.3], ["forest_birds", 0.3]],
  forest: [["forest_birds", 0.4], ["wind_city", 0.2]],
  river: [["forest_stream", 0.45], ["forest_birds", 0.2]],
  interior: [["interior_room_tone", 0.35]],
};

type DirectedScene = Direction["scenes"][number];

/** A model set's beds by its kind: a ship's open sea and the wind in its
 *  rigging, a lighthouse's surf on the rocks and the coast's wind. (Creaks
 *  need a creak sound name in audio-resolve.ts first: 19-model-sets.md.) */
const BEDS_BY_SET: Record<SetKind, Array<[string, number]>> = {
  ship: [["ocean_waves", 0.5], ["wind_city", 0.25]],
  tower: [["ocean_waves", 0.45], ["wind_city", 0.3]],
};

/** The model set a scene is staged on, as the assembler will stage it (a world place wins). */
function setOf(s: DirectedScene): ModelSetDef | undefined {
  if (!s.modelSet) return undefined;
  if (s.worldPlace && resolveWorldScene(s.worldPlace).ok) return undefined;
  return modelSetDef(s.modelSet.model);
}

/** A place's light, as its sound hears it. */
export type Light = "day" | "low sun" | "night";

/** The light for a sun elevation (degrees): night under -6 (civil dusk: the
 *  birds fall quiet and the insects start), low sun under 10, else day. */
export function lightOf(elevation: number): Light {
  return elevation < -6 ? "night" : elevation < 10 ? "low sun" : "day";
}

/** What kind of place it sounds like: a city or a town, a desert, a coast. */
function placeKind(rp: ResolvedPlace): string {
  const town = rp.style.id === "european-village";
  const desert = rp.surface === Surface.Desert;
  const coast = rp.surface === Surface.Ocean || rp.surface === Surface.Lake;
  return `${desert ? "desert city" : town ? "town" : "city"}${coast ? " on the coast" : ""}`;
}

/**
 * How a real place sounds at its moment (Phase 6 world scenes), from what the
 * world engine knows about it: a city (crowd and traffic) or a town (a
 * distant murmur), desert (dry wind) or coast (waves, gulls by day), and the
 * light from the real sun (day, low sun, night: birds by day, insects on warm
 * nights, everything human quieter after dark). Names come from the sound
 * vocabulary. The scene's weather is added on top (soundRules), not here:
 * this is the place itself.
 */
export function placeSound(rp: ResolvedPlace): { label: string; beds: Array<[string, number]> } {
  const town = rp.style.id === "european-village";
  const desert = rp.surface === Surface.Desert;
  const coast = rp.surface === Surface.Ocean || rp.surface === Surface.Lake;
  const light = lightOf(rp.sun.elevation);
  const by = (day: number, low: number, night: number) => (light === "night" ? night : light === "low sun" ? low : day);
  const beds: Array<[string, number]> = [];
  if (town) beds.push(["street_murmur", by(0.25, 0.22, 0.12)]);
  else beds.push(["street_murmur", by(0.5, 0.45, 0.3)], ["traffic", by(0.3, 0.25, 0.15)]);
  // Birds by day (a coast has its gulls instead); crickets on warm nights.
  if (light !== "night") {
    if (!coast) beds.push(["forest_birds", town ? by(0.35, 0.4, 0) : desert ? 0.12 : by(0.15, 0.2, 0)]);
  } else if (rp.season !== "winter") beds.push(["night_insects", town || desert ? 0.3 : 0.15]);
  if (desert) beds.push(["wind_city", 0.2]);
  if (coast) {
    beds.push(["ocean_waves", 0.3]);
    if (light !== "night") beds.push(["ocean_gulls", 0.2]);
  }
  return { label: `${rp.place.id}, ${rp.moment.date} ${rp.moment.time} (${placeKind(rp)}, ${light})`, beds };
}

/* ---- the time-lapse (Phase 6 step 4, 13-light-and-time.md Part B) ---- */

/** The crossfade where a lapse's light changes (seconds), centred on the change. */
export const LAPSE_CROSSFADE = 2;

/** An ambience bed as the spec holds it (spec.audio.ambient), with its fades:
 *  the seconds it rises from silence at its start and falls to silence at its end. */
export interface AmbientBed {
  tag: string;
  from: number;
  to?: number | null;
  vol?: number;
  fadeIn?: number;
  fadeOut?: number;
}

/** One stretch of a lapse scene in one light, and the place at its middle. */
export interface LapseStretch {
  from: number;
  to: number;
  light: Light;
  place: ResolvedPlace;
}

/** A light a lapse holds for less than this at its start or end (seconds) is not heard. */
const MIN_STRETCH = 0.1;

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * A lapse scene by light: its stretches between the moments the sun crosses
 * 10 and -6 degrees (to the millisecond of video time). One stretch when the
 * light never changes, none without a lapse. A stretch at either end shorter
 * than MIN_STRETCH joins its neighbour: a light the scene only touches is not
 * heard.
 */
export function lapseStretches(world: LapseWorld, scene: { from: number; to: number }): LapseStretch[] {
  const clock = lapseClock(world, scene);
  if (!clock) return [];
  const lightAt = (t: number) => lightOf(clock.at(t).sun.elevation);
  // Sixty looks a second, then halving to the change: the light needs
  // minutes of clock to move, so no change hides between two looks.
  const n = Math.max(1, Math.ceil((scene.to - scene.from) * 60));
  const cuts: number[] = [];
  let lo = scene.from;
  let was = lightAt(lo);
  for (let i = 1; i <= n; i++) {
    const t = scene.from + ((scene.to - scene.from) * i) / n;
    const now = lightAt(t);
    if (now !== was) {
      let a = lo;
      let b = t;
      for (let k = 0; k < 40 && b - a > 1e-6; k++) {
        const mid = (a + b) / 2;
        if (lightAt(mid) === was) a = mid;
        else b = mid;
      }
      cuts.push(r3(b));
    }
    lo = t;
    was = now;
  }
  while (cuts.length && cuts[0] - scene.from < MIN_STRETCH) cuts.shift();
  while (cuts.length && scene.to - cuts[cuts.length - 1] < MIN_STRETCH) cuts.pop();
  const edges = [scene.from, ...cuts, scene.to];
  return edges.slice(0, -1).map((from, i) => {
    const to = edges[i + 1];
    const place = clock.at((from + to) / 2);
    return { from, to, light: lightOf(place.sun.elevation), place };
  });
}

/**
 * A lapse scene's place sound (placeSound) in each of its lights, as beds on
 * the video's seconds. Where the light changes the beds cross over
 * LAPSE_CROSSFADE seconds centred on the change: the birds fade out, the
 * insects in, the crowd and traffic drop to their night level (a sound whose
 * level changes is two beds crossfading). A change near the scene's edge
 * keeps its whole crossfade, moved inside the scene; two changes closer than
 * a crossfade share the time between them. A sound at one level throughout
 * plays on unbroken. The scene's own cuts stay hard, as the picture's are.
 * Empty when the light never changes (the scene keeps its one sound).
 */
export function lapseBeds(world: LapseWorld, scene: { from: number; to: number }): AmbientBed[] {
  const stretches = lapseStretches(world, scene);
  if (stretches.length < 2) return [];
  const cuts = stretches.slice(1).map((s) => s.from);
  // Each change's crossfade window: centred on it, inside the scene and
  // inside the half-way points to its neighbouring changes.
  const windows = cuts.map((c, i) => {
    const lo = i > 0 ? (cuts[i - 1] + c) / 2 : scene.from;
    const hi = i + 1 < cuts.length ? (c + cuts[i + 1]) / 2 : scene.to;
    const len = Math.min(LAPSE_CROSSFADE, hi - lo);
    const from = r3(Math.max(lo, Math.min(hi - len, c - len / 2)));
    return { from, to: r3(from + len), len: r3(len) };
  });
  const levels = stretches.map((s) => new Map(placeSound(s.place).beds));
  const sounds = [...new Set(levels.flatMap((m) => [...m.keys()]))];
  const out: AmbientBed[] = [];
  for (const tag of sounds) {
    let run = null as { from: number; level: number; fadeIn?: number } | null;
    for (let i = 0; i < levels.length; i++) {
      const level = levels[i].get(tag) ?? 0;
      if (level === (run?.level ?? 0)) continue;
      const w = windows[i - 1];
      if (run) {
        out.push({ tag, from: run.from, to: w.to, vol: run.level, ...(run.fadeIn ? { fadeIn: run.fadeIn } : {}), fadeOut: w.len });
        run = null;
      }
      if (level > 0) run = i === 0 ? { from: scene.from, level } : { from: w.from, level, fadeIn: w.len };
    }
    if (run) out.push({ tag, from: run.from, to: scene.to, vol: run.level, ...(run.fadeIn ? { fadeIn: run.fadeIn } : {}) });
  }
  return out;
}

/**
 * The spec's ambience with each lapse scene's light followed (for the
 * assembler, once the beds are on seconds). In a lapse scene whose light
 * changes, the place sounds that change with it (lapseBeds: crowd, traffic,
 * birds, insects, gulls) are replaced inside the scene by lapseBeds' beds.
 * The designer still decides which sounds play and how loud: a sound it left
 * out stays out, and one it chose keeps its level against the rule's at the
 * scene's start (birds chosen 50% louder stay 50% louder as they fade). A
 * sound that only comes with the later light (insects at nightfall) comes in
 * at the rule's level. Every other bed (waves, wind, rain, the heartbeat
 * ladder) is untouched, and so is every scene without a lapse.
 */
export function lapseAmbience<B extends AmbientBed>(scenes: Array<{ from: number; to: number; world?: LapseWorld | null }>, ambient: B[]): Array<B | AmbientBed> {
  let beds: Array<B | AmbientBed> = [...ambient];
  for (const scene of scenes) {
    const lapse = scene.world ? lapseBeds(scene.world, scene) : [];
    if (!lapse.length) continue;
    const moving = new Set(lapse.filter((b) => b.fadeIn || b.fadeOut).map((b) => b.tag));
    const inScene = (b: AmbientBed) => b.from < scene.to && (b.to ?? Infinity) > scene.from;
    const chosen = new Map<string, number>();
    for (const b of beds) if (moving.has(b.tag) && inScene(b) && !chosen.has(b.tag)) chosen.set(b.tag, b.vol ?? 0.35);
    const atStart = (tag: string) => lapse.find((b) => b.tag === tag && b.from === scene.from)?.vol ?? 0;
    // The moving sounds leave the scene; what plays before and after it stays.
    beds = beds.flatMap((b) => {
      if (!moving.has(b.tag) || !inScene(b)) return [b];
      const keep: Array<B | AmbientBed> = [];
      if (b.from < scene.from) keep.push({ ...b, to: scene.from });
      if ((b.to ?? Infinity) > scene.to) keep.push({ ...b, from: scene.to });
      return keep;
    });
    for (const b of lapse) {
      if (!moving.has(b.tag)) continue;
      const start = atStart(b.tag);
      const mine = chosen.get(b.tag);
      if (mine === undefined && start > 0) continue; // the designer left it out of this scene
      const scale = mine !== undefined && start > 0 ? mine / start : 1;
      beds.push({ ...b, vol: r3(Math.min(1, (b.vol ?? 0) * scale)) });
    }
  }
  return beds;
}

/** A directed scene's lapse with its end as a clock time (a word turned into
 *  one), or null when it has none the assembler would keep. */
export function directedLapse(s: DirectedScene): (LapseWorld & { lapse: { to: string } }) | null {
  const w = s.worldPlace;
  if (!w?.lapse) return null;
  const l = resolveWorldLapse(w);
  return l.ok && l.lapse ? { place: w.place, date: w.date, time: w.time, lapse: l.lapse } : null;
}

/** A scene's place sound when it happens at a world place the assembler can
 *  show (else null: its kit). A lapse is named by both its times and the
 *  lights it passes through; its beds are its first moment's (the rest
 *  follow the light in the assembler, lapseAmbience). */
function worldSound(s: DirectedScene): ReturnType<typeof placeSound> | null {
  if (!s.worldPlace) return null;
  const w = resolveWorldScene(s.worldPlace);
  if (!w.ok) return null;
  const sound = placeSound(w.place);
  const lapse = directedLapse(s);
  if (!lapse) return sound;
  // Over a long span, so only a light the lapse barely touches is left out.
  const lights = lapseStretches(lapse, { from: 0, to: 60 }).map((x) => x.light);
  const rp = w.place;
  return { ...sound, label: `${rp.place.id}, ${rp.moment.date} from ${rp.moment.time} to ${lapse.lapse.to} (${placeKind(rp)}, a time-lapse: ${lights.join(" to ")})` };
}

/** What the sound designer is told a scene is: the place and moment for a world scene, else kit and look. */
export function sceneSoundLabel(s: DirectedScene): string {
  const world = worldSound(s);
  // A world place's weather is drawn, so the designer hears of it too.
  if (world) return `${world.label}${s.weather !== "none" ? `, ${s.weather}` : ""}`;
  const set = setOf(s);
  if (set) return `${set.kind === "ship" ? "on the deck of a ship at sea" : "a lighthouse on a rocky islet in the sea"}, ${s.time}${s.weather !== "none" ? `, ${s.weather}` : ""}`;
  return `${s.kit}, ${s.time}${s.weather !== "none" ? `, ${s.weather}` : ""}`;
}

/** The rain bed's level (a kit scene's rain and storm play it at this too). */
export const RAIN_BED = 0.4;

/**
 * Where it rains in a world scene, as beat stretches (the rain bed's): as the
 * world draws it (world/weather/weather.ts worldWeather). The director's rain
 * or storm falls from the scene's start, unless its first rain event is a
 * rain-start; each rain-start or rain-stop inside the scene turns it on or
 * off. A rain-start in a dry scene makes it rain (the assembler sets the
 * scene's weather to rain there). `end` is the next scene's start beat (null:
 * the video's end); `order` a beat's index.
 */
export function worldRainStretches(
  s: Pick<DirectedScene, "start" | "weather">,
  end: string | null,
  events: Direction["world"],
  order: (id: string) => number,
): Array<{ start: string; end: string | null }> {
  const lo = order(s.start);
  const hi = end ? order(end) : Infinity;
  const steps = events
    .filter((e) => (e.event === "rain-start" || e.event === "rain-stop") && order(e.beat) >= lo && order(e.beat) < hi)
    .sort((a, b) => order(a.beat) - order(b.beat));
  const wet = s.weather === "rain" || s.weather === "storm";
  if (!wet && !steps.some((e) => e.event === "rain-start")) return [];
  const out: Array<{ start: string; end: string | null }> = [];
  let open: string | null = steps.length && steps[0].event === "rain-start" ? null : s.start;
  for (const e of steps) {
    if (e.event === "rain-start") open ??= e.beat;
    else if (open !== null) {
      if (e.beat !== open) out.push({ start: open, end: e.beat });
      open = null;
    }
  }
  if (open !== null) out.push({ start: open, end });
  return out;
}

/** A storm's thunder follows each strong lightning flash by this much (seconds). */
export const THUNDER_DELAY = 0.25;
/** No thunder this close to a rain-start, which brings its own crack (the assembler's EVENT_HIT). */
const THUNDER_CLEAR = 1.5;

/**
 * A storm's thunder: a thunder_crack after each strong flash of the
 * lightning clock (compositions/lightning.ts, the same seconds the stages
 * flash on), in every storm scene. A world storm thunders only while its rain
 * falls hard enough to flash (worldWeather's flash). None while a flight
 * covers the picture or a bullet time holds its moment, and none within
 * THUNDER_CLEAR of a rain-start. The assembler adds these to spec.events.
 */
export function stormThunder(
  scenes: ShotSpec["scenes"],
  worldEvents: NonNullable<ShotSpec["worldEvents"]>,
  flights: NonNullable<ShotSpec["flights"]> = [],
): Array<{ t: number; name: string; targets: string[]; sfx: Array<{ tag: string }> }> {
  const out: Array<{ t: number; name: string; targets: string[]; sfx: Array<{ tag: string }> }> = [];
  const covered = (t: number) =>
    flights.some((f) => t >= f.from && t <= f.to) || scenes.some((s) => s.bulletTime && t >= s.bulletTime.from && t <= s.bulletTime.to);
  for (const scene of scenes) {
    if (scene.look?.weather !== "storm") continue;
    const plan = scene.kit === "world" ? worldWeather(scene, worldEvents) : null;
    for (let k = Math.ceil(scene.from / LIGHTNING_PERIOD); k * LIGHTNING_PERIOD < scene.to; k++) {
      const flash = k * LIGHTNING_PERIOD;
      const t = Math.round((flash + THUNDER_DELAY) * 1000) / 1000;
      if (t >= scene.to || covered(flash)) continue;
      if (plan && plan.at(flash).flash < 0.5) continue;
      if (worldEvents.some((e) => e.name === "rain-start" && Math.abs(e.t - flash) < THUNDER_CLEAR)) continue;
      out.push({ t, name: `thunder-${k}`, targets: [], sfx: [{ tag: "thunder_crack" }] });
    }
  }
  return out;
}

/** The baseline: beds per scene (kit, weather, night; a world place by its character), music from the story's mood. */
export function soundRules(story: WriterStory, direction: Direction): SoundPlan {
  const ids = story.beats.map((b) => b.id);
  const order = (id: string) => ids.indexOf(id);
  const scenes = [...direction.scenes].filter((s) => order(s.start) >= 0).sort((a, b) => order(a.start) - order(b.start));
  const beds: SoundPlan["beds"] = [];
  scenes.forEach((s, i) => {
    const end = scenes[i + 1]?.start ?? null;
    const world = worldSound(s);
    if (world) {
      for (const [sound, level] of world.beds) beds.push({ start: s.start, end, sound, level });
      // Its rain, where it falls (the world draws it).
      for (const r of worldRainStretches(s, end, direction.world, order)) beds.push({ ...r, sound: "rain_hiss", level: RAIN_BED });
      return;
    }
    const set = setOf(s);
    for (const [sound, level] of set ? BEDS_BY_SET[set.kind] : BEDS_BY_KIT[s.kit] ?? []) {
      // birds sleep at night: crickets instead
      const swapped = s.time === "night" && sound === "forest_birds" ? "night_insects" : sound;
      beds.push({ start: s.start, end, sound: swapped, level });
    }
    if (s.weather === "rain" || s.weather === "storm") beds.push({ start: s.start, end, sound: "rain_hiss", level: RAIN_BED });
  });
  return { music: [{ start: ids[0] ?? "b1", mood: story.mood }], beds, hits: [] };
}

const SoundSchema = z.object({
  music: z.array(z.object({ start: z.string(), mood: z.string() })),
  beds: z.array(z.object({ start: z.string(), end: z.string().nullable(), sound: z.string(), level: z.number().min(0.05).max(1) })),
  hits: z.array(z.object({ beat: z.string(), at: z.enum(["start", "end"]), sound: z.string() })),
});

/** Map a free-text sound name onto the vocabulary (exact, then by words). */
export function matchSound(name: unknown, vocab: string[]): string | undefined {
  if (typeof name !== "string") return undefined;
  const v = name.toLowerCase().trim().replace(/[\s-]+/g, "_");
  if (vocab.includes(v)) return v;
  const words = v.split("_").filter((w) => w.length > 2);
  if (words.length === 0) return undefined;
  return (
    vocab.find((n) => n.startsWith(`${words[0]}_`) && words.every((w) => n.includes(w))) ??
    vocab.find((n) => words.every((w) => n.includes(w))) ??
    vocab.find((n) => words.some((w) => n.startsWith(w)))
  );
}

export function normalizeSound(raw: unknown, vocab: string[]): unknown {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const get = (k: string) => o[k] ?? o[k.charAt(0).toUpperCase() + k.slice(1)];
  return {
    music: asArray<Record<string, unknown>>(get("music"))
      .map((m) => ({ start: beatRef(m.start ?? m.beat ?? m.from) ?? "b1", mood: fuzzyEnum(m.mood ?? m.style, MOODS) ?? "" }))
      .filter((m) => m.mood),
    beds: asArray<Record<string, unknown>>(get("beds") ?? get("ambience"))
      .map((b) => ({
        start: beatRef(b.start ?? b.from ?? b.beat) ?? "b1",
        end: beatRef(b.end ?? b.to) ?? null,
        sound: matchSound(b.sound ?? b.name ?? b.tag, vocab) ?? "",
        level: Math.max(0.05, Math.min(1, Number(b.level ?? b.volume ?? b.vol) || 0.35)),
      }))
      .filter((b) => b.sound),
    hits: asArray<Record<string, unknown>>(get("hits") ?? get("sfx"))
      .map((h) => ({
        beat: beatRef(h.beat ?? h.at_beat ?? h.start) ?? "",
        at: h.at === "end" ? ("end" as const) : ("start" as const),
        sound: matchSound(h.sound ?? h.name ?? h.tag, vocab) ?? "",
      }))
      .filter((h) => h.beat && h.sound),
  };
}

const SYSTEM = `You are the sound designer of short "what if" videos.
For each part of the story you choose the background music mood, the ambience beds, and short hits (one-shot sounds) on key beats.
Use ONLY the sound names and moods listed. Refer to beats as "b1", "b2", ... Never write seconds.
Hits are for moments that matter: a reveal, an impact, a change. At most one hit per beat, and not on every beat.
Reply with JSON only.`;

/** The sound designer's prompt: each beat with its length and its scene (a world scene by its place and moment). */
export function soundPrompt(input: { story: WriterStory; direction: Direction; timeline: Timeline; rules: SoundPlan; vocab: string[] }): string {
  const sceneAt = new Map<string, string>();
  const order = input.story.beats.map((b) => b.id);
  const sorted = [...input.direction.scenes].sort((a, b) => order.indexOf(a.start) - order.indexOf(b.start));
  for (const b of input.story.beats) {
    const s = [...sorted].reverse().find((sc) => order.indexOf(sc.start) <= order.indexOf(b.id));
    if (s) sceneAt.set(b.id, sceneSoundLabel(s));
  }
  const len = new Map(input.timeline.beats.map((b) => [b.id, b.to - b.from]));
  // The director's effects (docs/factory/21-vfx-effekseer.md): marked on their beats, with the hits they bring.
  const fx = new Map<string, string[]>();
  for (const sc of input.direction.scenes) for (const e of sc.vfx ?? []) fx.set(e.beat, [...(fx.get(e.beat) ?? []), e.kind]);
  const kinds = [...new Set([...fx.values()].flat())];
  const fxNote = kinds.length
    ? `\nA beat marked [effects: ...] shows a visual effect that already plays its own sound at its start (${kinds.map((k) => `${k}: ${(VFX_SOUND as Record<string, string | null>)[k] ?? "none"}`).join(", ")}), and a fire or sparks a bed while it burns: don't add the same hit there; add another only if the story needs more.`
    : "";
  return `Story: "${input.story.title}" (mood: ${input.story.mood})
Beats:
${input.story.beats.map((b) => `${b.id} (${(len.get(b.id) ?? 0).toFixed(1)}s, ${sceneAt.get(b.id) ?? "?"}): ${b.see}${fx.has(b.id) ? `  [effects: ${fx.get(b.id)!.join(", ")}]` : ""}`).join("\n")}

Music moods: ${MOODS.join(", ")}
Sound names: ${input.vocab.join(", ")}
A scene at a real place (named with its date and local time) should sound like that place at that moment.
A time-lapse scene (named "from HH:MM to HH:MM") changes its light as it plays: give it the beds of its first moment;
its crowd, traffic, birds and insects then follow the light by rule, keeping the levels you chose.${fxNote}

A starting plan you may improve:
${JSON.stringify(input.rules)}

JSON shape:
{ "music": [{ "start": "b1", "mood": "${input.story.mood}" }],
  "beds": [{ "start": "b1", "end": null, "sound": "street_murmur", "level": 0.5 }],
  "hits": [{ "beat": "b3", "at": "start", "sound": "impact_soft_bodies" }] }`;
}

export async function designSound(input: {
  story: WriterStory;
  direction: Direction;
  timeline: Timeline;
  models: Record<string, RoleModel>;
  /** The channel's guidance (ai/channels.ts soundGuide), appended to the prompt; "" for what-if. */
  guide?: string;
}): Promise<{ plan: SoundPlan; source: "llm" | "rules"; warning?: string }> {
  const rules = soundRules(input.story, input.direction);
  const vocab = soundVocabulary();
  const prompt = soundPrompt({ ...input, rules, vocab }) + (input.guide ?? "");
  try {
    const result = await callRole({
      role: "sound",
      label: "sound",
      system: SYSTEM,
      prompt,
      schema: SoundSchema,
      models: input.models,
      normalize: (raw) => normalizeSound(raw, vocab),
    });
    const v = result.value;
    return {
      source: "llm",
      plan: {
        music: v.music.length ? v.music : rules.music,
        beds: v.beds.length ? v.beds : rules.beds,
        hits: v.hits,
      },
    };
  } catch (e) {
    return { source: "rules", plan: rules, warning: `sound designer failed, using the rules: ${(e as Error).message.slice(0, 200)}` };
  }
}
