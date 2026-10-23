/**
 * tracks.ts: the editor timeline's rows. Times come from the playable spec;
 * the film says what each item edits (its index in direction.shots,
 * direction.scenes, sound.hits or sound.music, the same order the assembler
 * reads them in). Pure, no React, so it can be checked on its own.
 */
import type { ShotSpec } from "@/generator/spec.schema";
import type { Film } from "@/generator/film/edits";

export type TrackKey = "beats" | "shots" | "captions" | "voice" | "music" | "sounds" | "scenes";
export type ItemKind = "hook" | "beat" | "shot" | "caption" | "voice" | "music" | "hit" | "sfx" | "scene";

export interface TrackItem {
  /** Unique across all tracks, e.g. "beat:b3", "shot:4". */
  id: string;
  kind: ItemKind;
  from: number;
  to: number;
  label: string;
  /** The story beat this belongs to ("hook" for the opening), for Ask AI and the beat form. */
  beat?: string;
  /** Index in the spec list it was read from. */
  specIndex: number;
  /** Index in the film list the Inspector edits; absent when the item was picked automatically. */
  filmIndex?: number;
  /** Dialog line index in film.story.beats[beat].lines (voice items only). */
  line?: number;
  /** Row inside the track, so overlapping items stay clickable. */
  lane: number;
  detail?: string;
}

export interface Track {
  key: TrackKey;
  label: string;
  items: TrackItem[];
  lanes: number;
  /** Thin marks drawn on the row (scene transitions). */
  markers?: Array<{ t: number; label: string }>;
}

/** "b3-2" (second shot of a long beat) belongs to "b3". */
export const baseBeat = (id: string) => id.replace(/-\d+$/, "");
const isBeat = (id: string | undefined): id is string => !!id && /^b\d+$/.test(id);

/** How long a one-shot sound is drawn, in seconds. */
export const POINT_SEC = 0.4;

const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);

function assignLanes(items: TrackItem[], minDur = 0): number {
  const ends: number[] = [];
  for (const it of [...items].sort((a, b) => a.from - b.from)) {
    const end = Math.max(it.to, it.from + minDur);
    let lane = ends.findIndex((e) => e <= it.from + 0.02);
    if (lane < 0) {
      lane = ends.length;
      ends.push(end);
    } else ends[lane] = end;
    it.lane = lane;
  }
  return Math.max(1, ends.length);
}

export function deriveTracks(spec: ShotSpec, film: Film): Track[] {
  const beats = spec.story?.beats ?? [];
  const firstFrom = beats[0]?.from ?? spec.hook?.duration ?? 0;
  const beatOrder = new Map(film.story.beats.map((b, i) => [b.id, i]));
  const beatFrom = new Map(beats.map((b) => [b.id, b.from ?? 0]));
  const beatAt = (t: number): string | undefined => {
    if (t < firstFrom) return "hook";
    return beats.find((b) => t >= (b.from ?? 0) && t < (b.to ?? 0))?.id ?? beats[beats.length - 1]?.id;
  };

  /* ---- beats (and the opening hook) ---- */
  const beatItems: TrackItem[] = [];
  if (firstFrom > 0.05) {
    beatItems.push({ id: "hook", kind: "hook", from: 0, to: firstFrom, label: `Opening: ${clip(film.story.hook)}`, beat: "hook", specIndex: -1, lane: 0 });
  }
  beats.forEach((b, i) => {
    if (b.from === undefined || b.to === undefined) return;
    const say = film.story.beats.find((x) => x.id === b.id)?.say ?? b.say ?? "";
    beatItems.push({ id: `beat:${b.id}`, kind: "beat", from: b.from, to: b.to, label: `${b.id} ${clip(say)}`, beat: b.id, specIndex: i, lane: 0, detail: b.pace });
  });

  /* ---- shots: the director's shot for the beat, or one picked by film rules ---- */
  const shotItems: TrackItem[] = (spec.shots ?? []).map((s, i) => {
    const owner = s.beat ? baseBeat(s.beat) : beatAt(s.from);
    const fi = isBeat(owner) ? film.direction.shots.findIndex((d) => d.beat === owner) : -1;
    return {
      id: `shot:${i}`,
      kind: "shot" as const,
      from: s.from,
      to: s.to,
      label: `${s.size} ${s.subject} ${s.move.replace(/_/g, " ")}`,
      beat: owner,
      specIndex: i,
      filmIndex: fi >= 0 ? fi : undefined,
      lane: 0,
      detail: s.beat,
    };
  });

  /* ---- captions ---- */
  const captionItems: TrackItem[] = (spec.captions ?? []).map((c, i) => ({
    id: `caption:${i}`,
    kind: "caption" as const,
    from: c.from,
    to: c.to,
    label: c.text,
    beat: beatAt(c.from),
    specIndex: i,
    lane: 0,
  }));

  /* ---- voice: every planned line, timed by its voice file when there is one ---- */
  const files = new Map((spec.audio?.voiceFiles ?? []).map((v) => [v.id, v]));
  const voiceItems: TrackItem[] = [];
  const hookFile = files.get("hook");
  if (hookFile) {
    voiceItems.push({ id: "voice:hook", kind: "voice", from: hookFile.at, to: hookFile.at + (hookFile.dur ?? 1), label: `Narrator: ${clip(film.story.hook)}`, beat: "hook", specIndex: -1, lane: 0 });
  }
  beats.forEach((b) => {
    (b.lines ?? []).forEach((l, li) => {
      const f = files.get(l.id);
      const at = f?.at ?? l.at;
      const dur = f?.dur ?? l.dur;
      if (at === undefined) return;
      const dialog = /-d(\d+)$/.exec(l.id);
      voiceItems.push({
        id: `voice:${l.id}`,
        kind: "voice",
        from: at,
        to: at + (dur && dur > 0 ? dur : 1),
        label: `${l.who === "narrator" ? "Narrator" : l.who}: ${clip(l.text)}`,
        beat: b.id,
        specIndex: li,
        line: dialog ? Number(dialog[1]) - 1 : undefined,
        lane: 0,
        detail: f ? undefined : l.estimated ? "timing estimated" : undefined,
      });
    });
  });

  /* ---- music: spec cues follow the film's cues sorted by beat ---- */
  const musicOrder = film.sound.music
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => beatOrder.has(m.start))
    .sort((a, b) => beatOrder.get(a.m.start)! - beatOrder.get(b.m.start)!);
  const musicItems: TrackItem[] = (spec.audio?.music ?? []).map((m, i) => {
    const cue = musicOrder[i];
    return {
      id: `music:${i}`,
      kind: "music" as const,
      from: m.from,
      to: m.to ?? m.from + 1,
      label: m.mood ? `Music: ${m.mood}` : "Music",
      beat: cue?.m.start ?? beats[0]?.id,
      specIndex: i,
      filmIndex: cue?.i,
      lane: 0,
    };
  });

  /* ---- sounds: hits are the sound designer's, the rest come with events ---- */
  const seen = new Map<string, number>();
  const soundItems: TrackItem[] = [];
  (spec.events ?? []).forEach((e, i) => {
    const tags = (e.sfx ?? []).map((s) => s.tag);
    if (tags.length === 0) return;
    const hit = /^hit-(b\d+)-(start|end)$/.exec(e.name);
    const world = /^world-(.+)-(b\d+)$/.exec(e.name);
    let filmIndex: number | undefined;
    if (hit) {
      const nth = seen.get(e.name) ?? 0;
      seen.set(e.name, nth + 1);
      const matches = film.sound.hits.flatMap((h, hi) => (h.beat === hit[1] && h.at === hit[2] ? [hi] : []));
      filmIndex = matches[nth];
    }
    soundItems.push({
      id: `sound:${i}`,
      kind: hit && filmIndex !== undefined ? "hit" : "sfx",
      from: e.t,
      to: e.t + POINT_SEC,
      label: tags.join(", "),
      beat: hit?.[1] ?? world?.[2] ?? beatAt(e.t),
      specIndex: i,
      filmIndex,
      lane: 0,
      detail: hit ? `${hit[2] === "start" ? "start" : "end"} of ${hit[1]}` : world ? world[1].replace(/-/g, " ") : e.name,
    });
  });

  /* ---- scenes: matched to the director's scene that starts at the same time ---- */
  const sceneOrder = film.direction.scenes
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => beatOrder.has(s.start))
    .sort((a, b) => beatOrder.get(a.s.start)! - beatOrder.get(b.s.start)!);
  const sceneItems: TrackItem[] = spec.scenes.map((sc, i) => {
    const match =
      i === 0
        ? sceneOrder[0]
        : sceneOrder.find(({ s }) => Math.abs((beatFrom.get(s.start) ?? -99) - sc.from) < 0.02);
    const kit = sc.kit ?? sc.scene ?? "scene";
    const time = sc.look?.timeOfDay;
    return {
      id: `scene:${i}`,
      kind: "scene" as const,
      from: sc.from,
      to: sc.to,
      label: `${kit.replace(/-/g, " ")}${time ? `, ${time}` : ""}${sc.look?.weather && sc.look.weather !== "none" ? `, ${sc.look.weather}` : ""}`,
      beat: match ? (i === 0 ? beats[0]?.id ?? match.s.start : match.s.start) : beatAt(sc.from),
      specIndex: i,
      filmIndex: match?.i,
      lane: 0,
    };
  });

  const track = (key: TrackKey, label: string, items: TrackItem[], minDur = 0, extra: Partial<Track> = {}): Track => ({
    key,
    label,
    items,
    lanes: assignLanes(items, minDur),
    ...extra,
  });

  return [
    track("beats", "Beats", beatItems),
    track("shots", "Shots", shotItems),
    track("captions", "Captions", captionItems),
    track("voice", "Voice", voiceItems),
    track("music", "Music", musicItems),
    track("sounds", "Sounds", soundItems, 0.9),
    track("scenes", "Scenes", sceneItems, 0, { markers: (spec.transitions ?? []).map((t) => ({ t: t.t, label: t.type.replace(/-/g, " ") })) }),
  ];
}

export function findItem(tracks: Track[], id: string | null | undefined): TrackItem | undefined {
  if (!id) return undefined;
  for (const t of tracks) {
    const it = t.items.find((x) => x.id === id);
    if (it) return it;
  }
  return undefined;
}

/** The beat Ask AI should work on for this item, or null for the whole video. */
export function askTargetBeat(item: TrackItem | undefined): string | null {
  return item && isBeat(item.beat) ? item.beat : null;
}
