/**
 * src/generator/audio-room.ts — room and distance in the mix
 * (docs/factory/03-audio-sources.md, "Room and distance"). Run by
 * resolveAudio once every cue has its file, before bullet time's pass (so a
 * slowed world keeps its room).
 *
 * Every world sound used to play dry. Now:
 *   - **the room:** an effect is convolved with the impulse response of its
 *     scene's space, chosen from the scene's kit or world place: a small room
 *     (interior), a city slap and short echo (a street, a plaza, every world
 *     place), open air, almost dry (forest, countryside, ocean, park), open
 *     water (pier, river, boardwalk, a model set on the sea). Space has none;
 *   - **the distance:** the shot on screen when the effect plays says how far
 *     it is (the sound plan holds no distance): an EWS is far (a low-pass at
 *     3.5 kHz and 7 dB down, the room's level kept, so it sounds farther, not
 *     only quieter), a WS is between, an FS or closer is near (no filter, no
 *     level change, the room 3 dB lower);
 *   - **the beds** are recordings of their place, which already hold its
 *     space: only the small room's beds take the room.
 * Not touched: the voice, the music, the cut whooshes, the hook pop, the
 * designed sounds (whooshes, risers, stingers, UI) and bullet time's own cues.
 *
 * The impulse responses are generated (no CC0 impulse response is on disk):
 * seeded, decaying, darkening noise plus a few discrete reflections. They are
 * a processing kernel, not a sound in the mix. Remotion's ffmpeg has no
 * `afir` (nor `lowpass` or `aecho`), so the convolution is done here, by FFT,
 * the way audio-warp.ts does its varispeed: ffmpeg only decodes.
 *
 * Deterministic: a file is named by a hash of what made it (the room, the
 * distance, the source's bytes, this file's VERSION), written once to
 * public/whatif-audio/room/ and reused by every video. FACTORY_ROOM=off (or
 * resolveAudio's `room: false`) skips the pass: the spec is then exactly what
 * it was before this pass existed.
 */
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";
import { LowPass, SAMPLE_RATE, clearDecoded, decode, isDeviceTag, wavBytes } from "./audio-warp";
import type { ShotSpec } from "./spec.schema";
import type { ShotSize } from "./camera/shot";
import { makeRng } from "../world/rng";

const ROOT = process.cwd();
/** Bump when the processing changes in a way the definitions below don't show (the names carry it). */
const VERSION = 1;
/** The files are written this far under full scale; the cue's gain gives it back. */
export const HEADROOM = 0.5;
/** A processed effect's peak ceiling with its gain (dBFS; gainFor's per-cue ceiling). */
const CUE_CEILING_DB = -5;

export type Space = "room" | "street" | "field" | "open";
export type Distance = "near" | "mid" | "far";
type Stereo = { l: Float32Array; r: Float32Array };

/** A discrete reflection: its delay (ms), level (dB under the direct sound), side (-1 left, +1 right) and darkness (low-pass, Hz). */
export interface Reflection {
  ms: number;
  db: number;
  pan: number;
  hz: number;
}

export interface RoomDef {
  what: string;
  /** The diffuse tail: its decay to -60 dB (s), its energy under the direct sound (dB), where it starts (ms), and its low-pass at the start and late in the decay (Hz). */
  rt60: number;
  tailDb: number;
  predelayMs: number;
  brightHz: number;
  darkHz: number;
  reflections: Reflection[];
  /** A bed's send (dB on the impulse response), or null: the bed plays as recorded. */
  bedDb: number | null;
}

export const ROOMS: Readonly<Record<Space, RoomDef>> = {
  room: {
    what: "a small room (about 4 x 5 m): close walls, a short bright decay",
    rt60: 0.45,
    tailDb: -13,
    predelayMs: 4,
    brightHz: 7000,
    darkHz: 2500,
    reflections: [
      { ms: 7, db: -10, pan: -0.5, hz: 8000 },
      { ms: 11, db: -11, pan: 0.6, hz: 7000 },
      { ms: 16, db: -13, pan: -0.2, hz: 6000 },
      { ms: 23, db: -15, pan: 0.3, hz: 5000 },
    ],
    bedDb: -3,
  },
  street: {
    what: "a street or plaza: a slap off the facades across (10-15 m), a short flutter echo, a thin dark tail",
    rt60: 0.9,
    tailDb: -20,
    predelayMs: 20,
    brightHz: 5000,
    darkHz: 1800,
    reflections: [
      { ms: 58, db: -11, pan: 0.6, hz: 4500 },
      { ms: 87, db: -14, pan: -0.5, hz: 3500 },
      { ms: 145, db: -19, pan: 0.3, hz: 2500 },
      { ms: 203, db: -23, pan: -0.3, hz: 2000 },
    ],
    bedDb: null,
  },
  field: {
    what: "open air: nothing to reflect off but the ground and far trees, almost dry",
    rt60: 0.3,
    tailDb: -30,
    predelayMs: 8,
    brightHz: 6000,
    darkHz: 2500,
    reflections: [{ ms: 12, db: -22, pan: 0, hz: 5000 }],
    bedDb: null,
  },
  open: {
    what: "open water (a pier, a river): the water's surface and a far bank or hull, a late faint echo",
    rt60: 0.6,
    tailDb: -26,
    predelayMs: 15,
    brightHz: 5000,
    darkHz: 2000,
    reflections: [
      { ms: 170, db: -22, pan: 0.4, hz: 2500 },
      { ms: 260, db: -27, pan: -0.4, hz: 1800 },
    ],
    bedDb: null,
  },
};

/** How a distance changes an effect: the direct sound's level (dB) and low-pass (Hz, null: none), and the room's send (dB). */
export interface DistanceDef {
  directDb: number;
  lowpassHz: number | null;
  sendDb: number;
}
export const DISTANCES: Readonly<Record<Distance, DistanceDef>> = {
  near: { directDb: 0, lowpassHz: null, sendDb: -3 },
  mid: { directDb: -2.5, lowpassHz: 9000, sendDb: 0 },
  far: { directDb: -7, lowpassHz: 3500, sendDb: 0 },
};

/** The space of a scene's kit (a world place is a city or town: a street). */
const SPACE_BY_KIT: Readonly<Record<string, Space | null>> = {
  interior: "room",
  "street-block": "street",
  "city-street": "street",
  world: "street",
  forest: "field",
  countryside: "field",
  ocean: "field",
  park: "field",
  pier: "open",
  river: "open",
  boardwalk: "open",
  "model-set": "open",
  space: null,
};

type Scene = ShotSpec["scenes"][number];

/** The space a scene sounds in, or null (space, or a scene with no kit): dry. */
export function spaceOf(scene: Pick<Scene, "kit" | "world" | "scene">): Space | null {
  if (scene.world) return "street";
  if (scene.kit) return SPACE_BY_KIT[scene.kit] ?? null;
  return scene.scene === "city" || scene.scene === "street-block" ? "street" : null;
}

/** How far an effect is, from the shot on screen (none: near). */
export function distanceOf(size: ShotSize | undefined): Distance {
  return size === "EWS" ? "far" : size === "WS" ? "mid" : "near";
}

/** Designed sounds, not sounds of the world: they stay dry. */
const DESIGNED = new Set(["whoosh_dissolve", "rise_short", "pop_light", "ui_click", "stinger_hit"]);

/** The FACTORY_ROOM switch: on unless "off", "0", "false" or "no". */
export function roomEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.FACTORY_ROOM ?? "").trim().toLowerCase();
  return !["off", "0", "false", "no"].includes(v);
}

/* ------------------------------------------------------------------ */
/*  The impulse responses                                              */
/* ------------------------------------------------------------------ */

const impulses = new Map<Space, Stereo>();

/**
 * A room's impulse response without the direct sound (that is the dry
 * signal): the reflections, then the tail from the pre-delay, its energy
 * brought to `tailDb`. Seeded by the room's name, so every run makes the
 * same one.
 */
export function impulse(space: Space): Stereo {
  const hit = impulses.get(space);
  if (hit) return hit;
  const room = ROOMS[space];
  const p0 = Math.round((room.predelayMs / 1000) * SAMPLE_RATE);
  const lastRefl = Math.max(0, ...room.reflections.map((r) => r.ms));
  const n = Math.max(p0 + Math.round(room.rt60 * SAMPLE_RATE), Math.round(((lastRefl + 40) / 1000) * SAMPLE_RATE));
  const out: Stereo = { l: new Float32Array(n), r: new Float32Array(n) };
  const fadeLen = Math.round(n * 0.1);
  let energy = 0;
  [out.l, out.r].forEach((ch, c) => {
    const rng = makeRng(`room:${space}:${c}`);
    const lp = new LowPass();
    for (let i = p0; i < n; i++) {
      const t = (i - p0) / SAMPLE_RATE;
      if ((i - p0) % 32 === 0) lp.set(room.darkHz + (room.brightHz - room.darkHz) * Math.exp((-3 * t) / room.rt60));
      const env = Math.exp((-6.9078 * t) / room.rt60) * Math.min(1, t / 0.005);
      const fade = i >= n - fadeLen ? 0.5 + 0.5 * Math.cos((Math.PI * (i - (n - fadeLen))) / fadeLen) : 1;
      ch[i] = lp.run(rng() * 2 - 1) * env * fade;
      energy += ch[i] * ch[i];
    }
  });
  const k = energy > 0 ? Math.sqrt(Math.pow(10, room.tailDb / 10) / (energy / 2)) : 0;
  for (const ch of [out.l, out.r]) for (let i = 0; i < n; i++) ch[i] *= k;
  for (const r of room.reflections) {
    // A darker copy of the sound: the low-pass's own impulse response, unit gain at DC.
    const lp = new LowPass();
    lp.set(r.hz);
    const taps = Array.from({ length: 96 }, (_, i) => lp.run(i === 0 ? 1 : 0));
    const a = Math.pow(10, r.db / 20);
    const gl = a * (r.pan > 0 ? 1 - r.pan : 1);
    const gr = a * (r.pan < 0 ? 1 + r.pan : 1);
    const at = Math.round((r.ms / 1000) * SAMPLE_RATE);
    for (let i = 0; i < taps.length && at + i < n; i++) {
      out.l[at + i] += gl * taps[i];
      out.r[at + i] += gr * taps[i];
    }
  }
  impulses.set(space, out);
  return out;
}

/* ------------------------------------------------------------------ */
/*  Convolution (FFT, overlap-add)                                     */
/* ------------------------------------------------------------------ */

const plans = new Map<number, { rev: Uint32Array; cos: Float64Array; sin: Float64Array }>();

function plan(n: number) {
  let p = plans.get(n);
  if (p) return p;
  const bits = Math.round(Math.log2(n));
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  p = { rev, cos, sin };
  plans.set(n, p);
  return p;
}

/** In-place radix-2 FFT (inverse: conjugate twiddles, scaled by 1/n). */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  const { rev, cos, sin } = plan(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  const sign = inverse ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let s = 0; s < n; s += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step];
        const wi = sign * sin[k * step];
        const a = s + k;
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

/**
 * Each channel of `x` convolved with the same channel of `h`: both channels
 * in one complex FFT (left real, right imaginary). Linear: n + L - 1 samples;
 * `circular`: n samples, the tail wrapped onto the start, so a looped bed
 * stays seamless.
 */
export function convolve(x: Stereo, h: Stereo, circular: boolean): Stereo {
  const n = x.l.length;
  const L = h.l.length;
  let N = 1024;
  while (N < 2 * L) N <<= 1;
  const B = N - L + 1;
  // The impulse response's two spectra, from one FFT.
  const hr = new Float64Array(N);
  const hi = new Float64Array(N);
  hr.set(h.l);
  hi.set(h.r);
  fft(hr, hi);
  const Hl = { re: new Float64Array(N), im: new Float64Array(N) };
  const Hr = { re: new Float64Array(N), im: new Float64Array(N) };
  for (let k = 0; k < N; k++) {
    const a = hr[k], b = hi[k], c = hr[(N - k) % N], d = hi[(N - k) % N];
    Hl.re[k] = (a + c) / 2;
    Hl.im[k] = (b - d) / 2;
    Hr.re[k] = (b + d) / 2;
    Hr.im[k] = (c - a) / 2;
  }
  const len = n + L - 1;
  const yl = new Float64Array(len);
  const yr = new Float64Array(len);
  const zr = new Float64Array(N);
  const zi = new Float64Array(N);
  for (let s = 0; s < n; s += B) {
    zr.fill(0);
    zi.fill(0);
    const m = Math.min(B, n - s);
    for (let i = 0; i < m; i++) {
      zr[i] = x.l[s + i];
      zi[i] = x.r[s + i];
    }
    fft(zr, zi);
    const wr = new Float64Array(N);
    const wi = new Float64Array(N);
    for (let k = 0; k < N; k++) {
      const a = zr[k], b = zi[k], c = zr[(N - k) % N], d = zi[(N - k) % N];
      const xlr = (a + c) / 2, xli = (b - d) / 2;
      const xrr = (b + d) / 2, xri = (c - a) / 2;
      const pr = xlr * Hl.re[k] - xli * Hl.im[k];
      const pi = xlr * Hl.im[k] + xli * Hl.re[k];
      const qr = xrr * Hr.re[k] - xri * Hr.im[k];
      const qi = xrr * Hr.im[k] + xri * Hr.re[k];
      wr[k] = pr - qi;
      wi[k] = pi + qr;
    }
    fft(wr, wi, true);
    const end = Math.min(N, len - s);
    for (let i = 0; i < end; i++) {
      yl[s + i] += wr[i];
      yr[s + i] += wi[i];
    }
  }
  if (!circular) return { l: Float32Array.from(yl), r: Float32Array.from(yr) };
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let i = 0; i < len; i++) {
    l[i % n] += yl[i];
    r[i % n] += yr[i];
  }
  return { l, r };
}

/* ------------------------------------------------------------------ */
/*  One sound through a room                                           */
/* ------------------------------------------------------------------ */

/**
 * A sound in a room: the direct sound (at a distance: low-passed and turned
 * down) plus the room. `bed`: a looped bed (the room wrapped round, no
 * distance). Scaled by HEADROOM.
 */
export function inRoom(src: Stereo, space: Space, at: Distance | "bed"): Stereo {
  const room = ROOMS[space];
  const h = impulse(space);
  const sendDb = at === "bed" ? (room.bedDb ?? -Infinity) : DISTANCES[at].sendDb;
  const send = Math.pow(10, sendDb / 20);
  const scaled: Stereo = { l: h.l.map((v) => v * send), r: h.r.map((v) => v * send) };
  const wet = convolve(src, scaled, at === "bed");
  const d = at === "bed" ? { directDb: 0, lowpassHz: null } : DISTANCES[at];
  const g = Math.pow(10, d.directDb / 20);
  [src.l, src.r].forEach((ch, c) => {
    const out = c === 0 ? wet.l : wet.r;
    const lp = d.lowpassHz ? new LowPass() : null;
    lp?.set(d.lowpassHz!);
    for (let i = 0; i < ch.length; i++) out[i] += g * (lp ? lp.run(ch[i]) : ch[i]);
  });
  for (const ch of [wet.l, wet.r]) for (let i = 0; i < ch.length; i++) ch[i] *= HEADROOM;
  return wet;
}

/* ------------------------------------------------------------------ */
/*  The pass                                                           */
/* ------------------------------------------------------------------ */

export interface RoomCue {
  /** The event and cue tag, or "bed:<tag>". */
  what: string;
  space: Space;
  distance: Distance | "bed";
  file: string;
}
export interface RoomReport {
  cues: RoomCue[];
  /** Files made by this run (the rest were reused). */
  made: number;
}

const contentHashes = new Map<string, string>();
function contentHash(abs: string): string {
  let h = contentHashes.get(abs);
  if (!h) {
    h = createHash("sha1").update(readFileSync(abs)).digest("hex");
    contentHashes.set(abs, h);
  }
  return h;
}

/** The peak (dBFS) of a 16-bit stereo WAV this pass wrote. */
function filePeakDb(abs: string): number {
  const buf = readFileSync(abs);
  let p = 0;
  for (let i = 44; i + 1 < buf.length; i += 2) p = Math.max(p, Math.abs(buf.readInt16LE(i)));
  return p > 0 ? 20 * Math.log10(p / 32767) : -Infinity;
}

/**
 * Room and distance for a resolved spec (every cue has its file and gain).
 * Changes the spec in place and returns it with a report; a cue it can't
 * process (no file) keeps what it had.
 */
export function roomAudio(spec: ShotSpec, opts: { publicDir?: string; outDir?: string } = {}): { spec: ShotSpec; report: RoomReport } {
  const publicDir = opts.publicDir ?? join(ROOT, "public");
  const rel = "whatif-audio/room";
  const dir = opts.outDir ?? join(publicDir, rel);
  const report: RoomReport = { cues: [], made: 0 };
  const scenes = spec.scenes;
  const sceneAt = (t: number) => scenes.find((s) => t >= s.from && t < s.to) ?? (t >= scenes[scenes.length - 1].to ? scenes[scenes.length - 1] : undefined);
  const shotAt = (t: number) => (spec.shots ?? []).find((s) => t >= s.from && t < s.to);

  /** The processed file for a source (made once, then found by its name). */
  const make = (srcFile: string, space: Space, at: Distance | "bed"): string | null => {
    const abs = join(publicDir, srcFile);
    if (!existsSync(abs)) return null;
    const key = JSON.stringify({ v: VERSION, room: ROOMS[space], at, d: at === "bed" ? null : DISTANCES[at], src: contentHash(abs) });
    const name = `room-${space}-${at}-${createHash("sha1").update(key).digest("hex").slice(0, 12)}.wav`;
    const out = join(dir, name);
    if (!existsSync(out)) {
      const src = decode(srcFile, publicDir);
      if (!src) return null;
      mkdirSync(dir, { recursive: true });
      const tmp = `${out}.${process.pid}.part`;
      writeFileSync(tmp, wavBytes(inRoom(src, space, at)));
      renameSync(tmp, out);
      report.made += 1;
    }
    return `${rel}/${name}`;
  };

  for (const ev of spec.events ?? []) {
    if (!/^(world|counter|hit)-/.test(ev.name)) continue;
    for (const cue of ev.sfx ?? []) {
      if (isDeviceTag(cue.tag) || DESIGNED.has(cue.tag) || cue.file?.startsWith("library/stinger/")) continue;
      const t = (cue.at as number | undefined) ?? ev.t;
      const scene = sceneAt(t);
      const space = scene ? spaceOf(scene) : null;
      if (!space) continue;
      const distance = distanceOf(shotAt(t)?.size);
      const file = make(cue.file ?? `sfx/${cue.tag}.wav`, space, distance);
      if (!file) continue;
      let gain = (cue.gain ?? 1) / HEADROOM;
      // The library's per-cue ceiling, on the processed sound.
      const peak = filePeakDb(join(dir, file.slice(rel.length + 1)));
      if (cue.gain !== undefined && peak + 20 * Math.log10(gain) > CUE_CEILING_DB) gain = Math.pow(10, (CUE_CEILING_DB - peak) / 20);
      cue.file = file;
      cue.gain = gain;
      report.cues.push({ what: `${ev.name}:${cue.tag}`, space, distance, file });
    }
  }

  type Bed = NonNullable<NonNullable<ShotSpec["audio"]>["ambient"]>[number];
  const duration = Math.max(...scenes.map((s) => s.to));
  for (const bed of (spec.audio?.ambient ?? []) as Bed[]) {
    if (bed.tag.startsWith("heartbeat_")) continue;
    // The scene the bed plays most of.
    const end = bed.to ?? duration;
    const scene = [...scenes].sort((a, b) => Math.min(end, b.to) - Math.max(bed.from, b.from) - (Math.min(end, a.to) - Math.max(bed.from, a.from)))[0];
    const space = scene ? spaceOf(scene) : null;
    if (!space || ROOMS[space].bedDb === null) continue;
    const file = make(bed.file ?? `sfx/${bed.tag}.wav`, space, "bed");
    if (!file) continue;
    // A synthesized bed played at `vol`; with a file the level is gain x the
    // trim around 0.35 (audio.tsx), so its gain keeps the level it had.
    const vol = bed.vol ?? 0.35;
    const level = bed.file ? (bed.gain ?? 1) : vol / Math.min(2, Math.max(0.25, vol / 0.35));
    bed.file = file;
    bed.gain = level / HEADROOM;
    report.cues.push({ what: `bed:${bed.tag}`, space, distance: "bed", file });
  }
  clearDecoded();
  return { spec, report };
}
