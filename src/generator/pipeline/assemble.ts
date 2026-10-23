/**
 * src/generator/pipeline/assemble.ts — beats to a renderable spec.
 *
 * Pure (apart from the asset catalog lookup). Every role referred to beats;
 * here each reference becomes seconds from the timeline, so scenes tile, the
 * counter and timer land on the right words, and no cue falls outside the
 * video. Choices the world cannot show are dropped with a warning instead of
 * failing the plan (an event a kit can't display, a cast asset that isn't
 * installed, a scene too short to read).
 */
import { getAsset } from "../asset-catalog";
import type { ShotSpec, VideoSettings } from "../spec.schema";
import { matchesStress, type Caption } from "./captions";
import type { Direction } from "./director";
import { timeShots } from "./shots";
import { planTransitions } from "./transitions";
import type { SoundPlan } from "./sound";
import type { Timeline } from "./timeline";
import type { AudioConfig, CastVoice } from "./voice";
import type { WriterStory } from "./writer";

export interface AssembleInput {
  id: string;
  premise: string;
  settings: VideoSettings;
  story: WriterStory;
  timeline: Timeline;
  captions: Caption[];
  direction: Direction;
  sound: SoundPlan;
  casting: { narrator: CastVoice; characters: Record<string, CastVoice> };
  audio: AudioConfig;
}

const SELF_POPULATING = new Set(["street-block", "space", "ocean"]);
const WATER_KITS = new Set(["ocean", "pier", "river"]);
const LIGHTS_KITS = new Set(["street-block", "interior", "forest", "countryside"]);
const CROWD = { none: [0, 0], light: [12, 4], busy: [25, 9] } as const;
const EVENT_HIT: Record<string, string> = {
  "water-vanish": "whoosh_dissolve",
  "water-return": "splash",
  "water-rise": "splash",
  "rain-start": "thunder_crack",
  "rain-stop": "whoosh_dissolve",
  "lights-out": "rumble_deep",
};
const MIN_SCENE = 2;
const MAX_COUNTER = 1e10;

/**
 * A counter value the HUD can show: "1,000" -> 1000, "2x" -> 2, "$5" -> 5,
 * "50%" -> 50. Anything else ("10^30", "infinity", "a lot") is null, so the step
 * is dropped instead of showing a wrong number.
 */
export function parseCounterValue(raw: string): number | null {
  const cleaned = raw.trim().replace(/[,\s]/g, "").replace(/^[$€£¥]/, "").replace(/(x|×|%)$/i, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const v = parseFloat(cleaned);
  return v > 0 && v < MAX_COUNTER ? v : null;
}
const r3 = (n: number) => Math.round(n * 1000) / 1000;

type Scene = ShotSpec["scenes"][number];

/** Keep first, last and evenly spaced items, at most `max`. */
function thin<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(items[Math.round((i * (items.length - 1)) / (max - 1))]);
  return out;
}

function heartbeatTag(bpm: number): string {
  if (bpm <= 82) return "heartbeat_bpm70";
  if (bpm <= 99) return "heartbeat_bpm90";
  if (bpm <= 119) return "heartbeat_bpm110";
  if (bpm <= 139) return "heartbeat_bpm130";
  return "heartbeat_bpm150";
}

export function assemble(input: AssembleInput): { spec: Record<string, unknown>; warnings: string[] } {
  const { timeline, story, direction, settings } = input;
  const warnings: string[] = [];
  const D = timeline.duration;
  const index = new Map(timeline.beats.map((b, i) => [b.id, i]));
  const beatOf = (id: string) => timeline.beats[index.get(id) ?? -1];
  const fromOf = (id: string) => beatOf(id)?.from;

  /* ---- scenes ---- */
  const seen = new Set<string>();
  const ordered = direction.scenes
    .filter((s) => {
      if (!index.has(s.start)) {
        warnings.push(`scene at unknown beat ${s.start} dropped`);
        return false;
      }
      return true;
    })
    .sort((a, b) => index.get(a.start)! - index.get(b.start)!)
    .filter((s) => (seen.has(s.start) ? false : (seen.add(s.start), true)));
  if (ordered.length === 0) ordered.push({ ...direction.scenes[0], start: timeline.beats[0].id });
  ordered[0] = { ...ordered[0], start: timeline.beats[0].id };

  let spans = ordered.map((s, i) => ({
    s,
    from: i === 0 ? 0 : fromOf(s.start)!,
    to: i + 1 < ordered.length ? fromOf(ordered[i + 1].start)! : D,
  }));
  // A scene too short to read merges into the one before it.
  spans = spans.reduce<typeof spans>((acc, cur) => {
    if (acc.length && cur.to - cur.from < MIN_SCENE) {
      acc[acc.length - 1].to = cur.to;
      warnings.push(`scene at ${cur.s.start} was under ${MIN_SCENE}s and merged into the previous one`);
    } else acc.push({ ...cur });
    return acc;
  }, []);
  const maxScenes = settings.sceneCount ?? 6;
  if (spans.length > maxScenes) {
    warnings.push(`${spans.length} scenes trimmed to ${maxScenes}`);
    spans = spans.slice(0, maxScenes);
  }
  spans[spans.length - 1].to = D;

  let castDropped = 0;
  const scenes: Scene[] = spans.map(({ s, from, to }) => {
    const space = s.kit === "space";
    const scene: Scene = {
      scene: s.kit,
      kit: s.kit,
      // Exact beat times (already frame-aligned), so a scene starts exactly on its beat.
      from,
      to,
      look: {
        timeOfDay: space ? "night" : s.time,
        ...(s.weather !== "none" ? { weather: s.weather } : {}),
      },
    };
    if (space) scene.subject = s.subject === "none" ? "earth" : s.subject;
    if (s.kit === "street-block") {
      const [crowdCount, vehicleCount] = CROWD[s.crowd];
      scene.street = { crowdCount, vehicleCount, accent: s.accent, cameraStyle: s.camera };
    }
    if (SELF_POPULATING.has(s.kit) && s.cast.length) {
      warnings.push(`cast ignored on ${s.kit}: that world fills itself`);
    }
    if (!SELF_POPULATING.has(s.kit) && s.cast.length) {
      const cast = s.cast.filter((c) => {
        const ok = !!getAsset(c.asset);
        if (!ok) castDropped += 1;
        return ok;
      });
      if (cast.length) scene.cast = cast.map((c) => ({ asset: c.asset, count: c.count, action: c.action }));
    }
    return scene;
  });
  if (castDropped) warnings.push(`${castDropped} cast entr${castDropped === 1 ? "y" : "ies"} dropped (not in the installed asset catalog; run npm run assets)`);
  const sceneAt = (t: number) => scenes.find((s) => t >= s.from && t < s.to) ?? scenes[scenes.length - 1];

  /* ---- events, beds ---- */
  const events: NonNullable<ShotSpec["events"]> = [{ t: 0.05, name: "hook", targets: [], sfx: [{ tag: "pop_light" }] }];
  const ambient: NonNullable<NonNullable<ShotSpec["audio"]>["ambient"]> = [];

  /* ---- counter -> statPanel ---- */
  let statPanel: ShotSpec["statPanel"];
  if (direction.counter) {
    const used = new Set<string>();
    const steps = direction.counter.steps
      .filter((st) => index.has(st.beat) && !used.has(st.beat) && (used.add(st.beat), true))
      .map((st) => ({ ...st, v: parseCounterValue(st.value) }))
      .filter((st): st is typeof st & { v: number } => {
        if (st.v === null) warnings.push(`counter step at ${st.beat} dropped: "${st.value}" is not a plain number`);
        return st.v !== null;
      })
      .sort((a, b) => index.get(a.beat)! - index.get(b.beat)!);
    const kept = thin(steps, 8);
    if (kept.length >= 2) {
      const v0 = kept[0].v;
      const ratios = kept.map((st) => Math.max(1, st.v / v0));
      const top = Math.max(...ratios);
      // Huge ranges are spread evenly in log space over 1..16, so every step still visibly grows.
      const scales = ratios.map((rt) => (top > 16 ? 1 + (15 * Math.log(rt)) / Math.log(top) : rt));
      let lastT = -1;
      const beats = kept.map((st, i) => {
        const beat = beatOf(st.beat)!;
        const stress = story.beats[index.get(st.beat)!]?.stress ?? "";
        const word = stress
          ? input.captions.flatMap((c) => c.words).find((w) => w.from >= beat.from && w.from < beat.to && matchesStress(w.text, stress))
          : undefined;
        let t = Math.min(Math.max(beat.from + 0.15, word?.from ?? 0), D - 1.2);
        if (t <= lastT + 0.3) t = lastT + 0.3;
        lastT = t;
        const scale = i === 0 ? 1 : Math.min(16, Math.max(1, scales[i]));
        // bpm is a director device (optional, fear/urgency premises only per
        // the intent audit): propagated as chosen, never invented here. The
        // old assembler fabricated 76→152 and added a heartbeat bed under
        // every counting video — deleted.
        return {
          t: r3(t),
          value: Number.isInteger(st.v) ? String(st.v) : String(Number(st.v.toFixed(2))),
          zoom: Number(scale.toFixed(3)),
          scale: Number(scale.toFixed(3)),
          sub: st.sub.toUpperCase().slice(0, 28),
          ...(st.bpm != null ? { bpm: Math.round(Math.min(220, Math.max(40, st.bpm))) } : {}),
        };
      });
      statPanel = { title: direction.counter.title.toUpperCase().slice(0, 32), unit: direction.counter.unit, beats };
      beats.forEach((b, i) => {
        if (i > 0) events.push({ t: b.t, name: `counter-${i}`, targets: [], sfx: [{ tag: "pop_light" }] });
        // Heartbeat sound only follows the director's chosen pulse.
        if (b.bpm != null) {
          const end = i + 1 < beats.length ? beats[i + 1].t : D;
          ambient.push({ tag: heartbeatTag(b.bpm), from: i === 0 ? 0 : b.t, to: r3(end), vol: 0.35, restart: true });
        }
      });
    } else {
      warnings.push("counter dropped: fewer than 2 usable numeric steps");
    }
  }

  /* ---- timer ---- */
  let timer: ShotSpec["timer"];
  if (direction.timer && index.has(direction.timer.startBeat)) {
    const startT = fromOf(direction.timer.startBeat)!;
    const endT = direction.timer.endBeat && index.has(direction.timer.endBeat) ? fromOf(direction.timer.endBeat)! : D - 1;
    if (endT - startT >= 1.5) {
      timer = { label: direction.timer.label.toUpperCase().slice(0, 32), startT: r3(startT), endT: r3(endT), format: "m:ss.ccc", position: "top-left" };
    } else warnings.push("timer dropped: shorter than 1.5s");
  }

  /* ---- hero prop ---- */
  let heroProp: ShotSpec["heroProp"];
  if (direction.prop && direction.prop.style !== "none") {
    if (scenes.some((s) => s.kit === "street-block")) heroProp = { ...direction.prop };
    else warnings.push("prop dropped: only street scenes show a hero prop");
  }

  /* ---- world events ---- */
  const worldEvents: NonNullable<ShotSpec["worldEvents"]> = [];
  for (const w of direction.world) {
    if (!index.has(w.beat)) continue;
    const t = r3(fromOf(w.beat)! + 0.3);
    const scene = sceneAt(t);
    const kit = scene.kit ?? "";
    const ok = w.event.startsWith("water") ? WATER_KITS.has(kit) : w.event === "lights-out" ? LIGHTS_KITS.has(kit) : true;
    if (!ok) {
      warnings.push(`${w.event} at ${w.beat} dropped: the ${kit} world can't show it`);
      continue;
    }
    if (w.event === "rain-start" && scene.look && scene.look.weather !== "rain" && scene.look.weather !== "storm") scene.look.weather = "rain";
    worldEvents.push({ t, name: w.event });
    events.push({ t, name: `world-${w.event}-${w.beat}`, targets: [], sfx: [{ tag: EVENT_HIT[w.event] }] });
  }

  /* ---- sound plan ---- */
  for (const h of input.sound.hits) {
    const b = beatOf(h.beat);
    if (!b) continue;
    const t = h.at === "end" ? Math.max(b.from, b.to - 0.3) : b.from + 0.05;
    events.push({ t: r3(t), name: `hit-${h.beat}-${h.at}`, targets: [], sfx: [{ tag: h.sound }] });
  }
  for (const bed of input.sound.beds) {
    const from = bed.start === timeline.beats[0].id ? 0 : fromOf(bed.start);
    const to = bed.end ? fromOf(bed.end) : D;
    if (from === undefined || to === undefined || to - from < 0.5) continue;
    ambient.push({ tag: bed.sound, from: r3(from), to: r3(to), vol: bed.level });
  }
  const musicCues = [...input.sound.music].filter((m) => index.has(m.start)).sort((a, b) => index.get(a.start)! - index.get(b.start)!);
  const music = (musicCues.length ? musicCues : [{ start: timeline.beats[0].id, mood: story.mood }]).map((m, i, all) => ({
    mood: m.mood,
    from: i === 0 ? 0 : r3(fromOf(m.start)!),
    to: i + 1 < all.length ? r3(fromOf(all[i + 1].start)!) : D,
  }));

  /* ---- voice ---- */
  const timedLines = [...(timeline.hook.line ? [timeline.hook.line] : []), ...timeline.beats.flatMap((b) => b.lines)];
  const voiceFiles = timedLines
    .filter((l) => l.file)
    .map((l) => ({ id: l.id, file: l.file!, at: r3(l.at), dur: l.dur, kind: l.kind }));
  const voices: Record<string, string> = {};
  for (const [name, v] of Object.entries(input.casting.characters)) voices[name] = v.voice;

  /* ---- camera shots (Phase 3) ---- */
  const kitAt = (t: number) => (scenes.find((sc) => t >= sc.from && t < sc.to) ?? scenes[scenes.length - 1]).kit ?? "street-block";
  const shotPlan = timeShots({ directed: direction.shots ?? [], story, timeline, kitAt });
  warnings.push(...shotPlan.warnings);

  const spec = {
    id: input.id,
    title: story.title || input.premise,
    fps: 30,
    settings,
    story: {
      title: story.title,
      mood: story.mood,
      hook: story.hook,
      characters: story.characters.map((c) => ({ ...c, voice: input.casting.characters[c.name]?.voice })),
      beats: timeline.beats.map((tb) => {
        const wb = story.beats[index.get(tb.id)!];
        return {
          id: tb.id,
          from: tb.from,
          to: tb.to,
          say: wb.say,
          see: wb.see,
          pace: wb.pace,
          stress: wb.stress,
          lines: tb.lines.map((l) => ({ id: l.id, who: l.who, text: l.text, at: r3(l.at), dur: l.dur, estimated: l.estimated })),
        };
      }),
    },
    hook: { text: story.hook || input.premise, keywordHighlight: [], t: 0, duration: r3(Math.max(1.5, timeline.hook.to)) },
    events: events.filter((e) => e.t >= 0 && e.t <= D).sort((a, b) => a.t - b.t),
    captions: input.captions.map((c) => ({ text: c.text, from: c.from, to: c.to, keyword: c.keyword, ...(c.speaker ? { speaker: c.speaker } : {}), words: c.words })),
    ...(statPanel ? { statPanel } : {}),
    ...(heroProp ? { heroProp } : {}),
    ...(timer ? { timer } : {}),
    scenes,
    shots: shotPlan.shots,
    transitions: planTransitions(scenes, worldEvents),
    worldEvents,
    audio: {
      ambient,
      music,
      voiceFiles,
      narration: { enabled: !!input.audio.narration?.enabled, engine: input.casting.narrator.engine, voice: input.casting.narrator.voice },
      dialogs: {
        enabled: !!input.audio.dialogs?.enabled,
        engine: input.audio.dialogs?.engine ?? "kitten2",
        voices,
        ...(input.audio.dialogs?.defaultVoice ? { defaultVoice: input.audio.dialogs.defaultVoice } : {}),
      },
    },
  };
  return { spec, warnings };
}
