/**
 * src/generator/audio-warp.ts — bullet time's sound (docs/factory/14-bullet-
 * time.md §3.5), run at the end of resolveAudio, once every cue has its file.
 * Only a spec whose scene has a bulletTime is touched; every other spec comes
 * back as it was.
 *
 * Inside the window the world's sound slows with the picture, on the sound
 * clock (src/world/warp.ts: the warp with its hold at SOUND_FLOOR, so a frozen
 * world hums about 14 semitones down instead of going silent):
 *   - every ambience bed and music cue that plays through the window is cut
 *     at the window's start; from there a pre-rendered file plays the same
 *     source on, read along the sound clock (cubic interpolation: tape-style
 *     varispeed, the pitch sliding down and back up), low-passed with a
 *     cutoff that follows the rate (open at full speed, about 700 Hz at the
 *     floor) and 4 dB down at the floor. It starts where the bed had got to
 *     and runs to the cue's end, so nothing restarts;
 *   - the world's one-shots inside the window (the shots, the world events'
 *     hits) are slowed the same way from their start.
 * The voice, the captions and the body's own sounds (the heartbeat) stay on
 * real time; the music still ducks under speech (audio.tsx).
 *
 * The device's one-shots, placed by the assembler from the director's choice
 * (tags starting "bt_"), get their files here: the time drop (a synthesized
 * sub drop and a dark whoosh), the gunshots (the library's shot-01), a whiz
 * per projectile (synthesized, centred on its pass), a reverse swell ending
 * on the window's end (whoosh_dissolve reversed) and the impacts (the
 * library's metal hits, at normal speed).
 *
 * Pure TypeScript and deterministic (ffmpeg only decodes); the files go to
 * public/whatif-audio/<id>/bt-*.wav, named by a hash of what made them, so an
 * edit that moves the window re-renders them and anything else reuses them.
 */
import { createHash } from "crypto";
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { FFMPEG, measureLoudness } from "./ffmpeg";
import { pickEntry, type LibraryEntry } from "./audio-library";
import type { ShotSpec } from "./spec.schema";
import { makeRng } from "../world/rng";
import { SOUND_FLOOR, bulletClock, type BulletClock } from "../world/warp";

const ROOT = process.cwd();
export const SAMPLE_RATE = 48000;
/** Bump when the processing changes (the file names carry it). */
const VERSION = 1;
/** The low-pass's cutoff at full speed and at the floor (Hz), and the level drop at the floor (dB). */
const OPEN_HZ = 18000;
const FLOOR_HZ = 700;
const FLOOR_DB = -4;
/** The swell's and the drop's lengths (s): the assembler places them with these. */
export const SWELL_SECONDS = 1.6;
export const DROP_SECONDS = 1.8;
export const WHIZ_SECONDS = 1.6;

/** The device's cue tags (the assembler writes them; resolveAudio leaves them to this step). */
export const BT_TAGS = {
  drop: "bt_drop",
  shot: "bt_shot",
  whiz: "bt_whiz",
  swell: "bt_swell",
  impact: "bt_impact",
} as const;
export function isDeviceTag(tag: string): boolean {
  return tag.startsWith("bt_");
}
/** The library's shot (doc §1, "shot-01"), else any file tagged "shot". */
const SHOT_ID = "oga-100cc0-shot-01";

export interface WarpFile {
  file: string;
  kind: string;
  durSec: number;
  peakDb: number;
}
export interface WarpReport {
  files: WarpFile[];
  /** Cues and beds that could not be made (no source, no ffmpeg). */
  skipped: string[];
}

type Audio = NonNullable<ShotSpec["audio"]>;
type Bed = NonNullable<Audio["ambient"]>[number] & { fadeIn?: number; fadeOut?: number };
type Music = NonNullable<Audio["music"]>[number];
type Stereo = { l: Float32Array; r: Float32Array };

/* ------------------------------------------------------------------ */
/*  Decode, write                                                      */
/* ------------------------------------------------------------------ */

const decoded = new Map<string, Stereo | null>();

/** A file under public/ (or under `base`) as 48 kHz stereo floats. ffmpeg
 *  only decodes: the bundled build has the WAV muxer and 16/24-bit PCM only,
 *  so it writes a 24-bit WAV to stdout (its data size unknown on a pipe) and
 *  this reads it. Kept until clearDecoded. */
export function decode(rel: string, base = join(ROOT, "public")): Stereo | null {
  const abs = join(base, rel);
  if (decoded.has(abs)) return decoded.get(abs)!;
  let out: Stereo | null = null;
  if (existsSync(abs)) {
    const r = spawnSync(FFMPEG, ["-v", "error", "-i", abs, "-vn", "-f", "wav", "-acodec", "pcm_s24le", "-ac", "2", "-ar", String(SAMPLE_RATE), "-"], { maxBuffer: 1024 * 1024 * 1024 });
    const buf = r.status === 0 ? (r.stdout as Buffer) : null;
    const at = buf ? buf.indexOf("data", 12) : -1;
    if (buf && at > 0) {
      const start = at + 8;
      const n = Math.floor((buf.length - start) / 6);
      const l = new Float32Array(n);
      const rr = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        l[i] = buf.readIntLE(start + i * 6, 3) / 8388608;
        rr[i] = buf.readIntLE(start + i * 6 + 3, 3) / 8388608;
      }
      out = { l, r: rr };
    }
  }
  decoded.set(abs, out);
  return out;
}

/** Forgets the decoded files (a music file is tens of MB). */
export function clearDecoded(): void {
  decoded.clear();
}

/** 16-bit stereo WAV bytes. */
export function wavBytes(s: Stereo): Buffer {
  const n = s.l.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 4, 40);
  const q = (x: number) => Math.max(-32768, Math.min(32767, Math.round(x * 32767)));
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(q(s.l[i]), 44 + i * 4);
    buf.writeInt16LE(q(s.r[i]), 46 + i * 4);
  }
  return buf;
}

/** The peak of a stereo buffer (dBFS). */
export function peakDb(s: Stereo): number {
  let p = 0;
  for (const ch of [s.l, s.r]) for (let i = 0; i < ch.length; i++) p = Math.max(p, Math.abs(ch[i]));
  return p > 0 ? 20 * Math.log10(p) : -Infinity;
}

/* ------------------------------------------------------------------ */
/*  The varispeed                                                      */
/* ------------------------------------------------------------------ */

/** A state-variable low-pass (Simper's), one per channel; the cutoff may change every block. */
export class LowPass {
  private ic1 = 0;
  private ic2 = 0;
  private a1 = 1;
  private a2 = 0;
  private a3 = 0;
  set(fc: number) {
    const g = Math.tan((Math.PI * Math.min(fc, SAMPLE_RATE * 0.45)) / SAMPLE_RATE);
    const k = Math.SQRT2;
    this.a1 = 1 / (1 + g * (g + k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }
  run(v0: number): number {
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    return v2;
  }
}

/** Catmull-Rom between samples at fractional index p (wrapping when `loop`, silence past the ends otherwise). */
function cubic(x: Float32Array, p: number, loop: boolean): number {
  const n = x.length;
  const i = Math.floor(p);
  const f = p - i;
  const at = (k: number) => (loop ? x[((k % n) + n) % n] : k < 0 || k >= n ? 0 : x[k]);
  const y0 = at(i - 1);
  const y1 = at(i);
  const y2 = at(i + 1);
  const y3 = at(i + 2);
  return y1 + 0.5 * f * (y2 - y0 + f * (2 * y0 - 5 * y1 + 4 * y2 - y3 + f * (3 * (y1 - y2) + y3 - y0)));
}

/** How slowed the sound is at a rate: 1 at full speed, 0 at the floor. */
const openness = (rate: number) => Math.max(0, Math.min(1, (rate - SOUND_FLOOR) / (1 - SOUND_FLOOR)));

/**
 * A source read along the sound clock from video time `start` for `seconds`:
 * output sample i (real time start + i / SR) reads the source at
 * clock.sound(t) - clock.sound(origin) seconds (where the cue's file began
 * playing at `origin`), looping or not, low-passed and turned down by the
 * rate. Outside the window the clock is real time and the output is the
 * source itself, unfiltered.
 */
export function varispeed(src: Stereo, clock: BulletClock, opts: { origin: number; start: number; seconds: number; loop: boolean }): Stereo {
  const m = Math.max(1, Math.round(opts.seconds * SAMPLE_RATE));
  const out: Stereo = { l: new Float32Array(m), r: new Float32Array(m) };
  const lp = [new LowPass(), new LowPass()];
  const s0 = clock.sound(opts.origin);
  const n = src.l.length;
  const BLOCK = 32;
  let u = 1;
  let gain = 1;
  let mix = 1;
  let last = m;
  for (let i = 0; i < m; i++) {
    const t = opts.start + i / SAMPLE_RATE;
    if (i % BLOCK === 0) {
      u = openness(clock.soundRate(t));
      const fc = FLOOR_HZ * Math.pow(OPEN_HZ / FLOOR_HZ, u);
      lp[0].set(fc);
      lp[1].set(fc);
      gain = Math.pow(10, (FLOOR_DB * (1 - u)) / 20);
      // Dry at full speed (the file is the source there), the low-pass as it slows.
      mix = u * u * u;
    }
    const p = (clock.sound(t) - s0) * SAMPLE_RATE;
    if (!opts.loop && p >= n + 2) {
      last = i;
      break;
    }
    const l = cubic(src.l, p, opts.loop);
    const r = cubic(src.r, p, opts.loop);
    out.l[i] = gain * (mix * l + (1 - mix) * lp[0].run(l));
    out.r[i] = gain * (mix * r + (1 - mix) * lp[1].run(r));
  }
  // A one-shot ends where its source does.
  return last < m ? { l: out.l.slice(0, Math.max(1, last)), r: out.r.slice(0, Math.max(1, last)) } : out;
}

/* ------------------------------------------------------------------ */
/*  The device's synthesized sounds                                    */
/* ------------------------------------------------------------------ */

/** Scales a buffer so its peak is `db` dBFS (the synthesized sounds leave headroom; their gain comes from their measured loudness). */
function normalize(s: Stereo, db: number): Stereo {
  const p = peakDb(s);
  if (!Number.isFinite(p)) return s;
  const k = Math.pow(10, (db - p) / 20);
  for (const ch of [s.l, s.r]) for (let i = 0; i < ch.length; i++) ch[i] *= k;
  return s;
}

/** The time drop: a sub sweeping down (90 to 32 Hz) and a dark whoosh. */
export function synthDrop(seed: string): Stereo {
  const n = Math.round(DROP_SECONDS * SAMPLE_RATE);
  const out: Stereo = { l: new Float32Array(n), r: new Float32Array(n) };
  const rng = makeRng(`${seed}:bt-drop`);
  const lp = [new LowPass(), new LowPass()];
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const f = 32 + 58 * Math.exp(-t / 0.45);
    phase += (2 * Math.PI * f) / SAMPLE_RATE;
    const sub = Math.sin(phase) * (1 - Math.exp(-t / 0.012)) * Math.exp(-t / 0.85) * 0.7;
    if (i % 32 === 0) {
      const fc = 150 + 1100 * Math.exp(-t / 0.5);
      lp[0].set(fc);
      lp[1].set(fc);
    }
    const env = Math.pow(Math.sin(Math.PI * Math.min(1, t / 1.3)), 2) * 0.5;
    out.l[i] = sub + env * lp[0].run(rng() * 2 - 1);
    out.r[i] = sub + env * lp[1].run(rng() * 2 - 1);
  }
  return normalize(out, -3);
}

/** A slowed fly-by, centred on its middle: a band of air sweeping down past
 *  the ear with a low hum, panned across (`side` +1 left to right, -1 back). */
export function synthWhiz(seed: string, side: 1 | -1): Stereo {
  const n = Math.round(WHIZ_SECONDS * SAMPLE_RATE);
  const out: Stereo = { l: new Float32Array(n), r: new Float32Array(n) };
  const rng = makeRng(`${seed}:bt-whiz`);
  const mid = WHIZ_SECONDS / 2;
  // A band-pass from two low-passes (the difference).
  const hi = new LowPass();
  const lo = new LowPass();
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const fc = 450 + 2150 / (1 + Math.exp((t - mid) * 7));
    if (i % 32 === 0) {
      hi.set(fc * 1.5);
      lo.set(fc * 0.6);
    }
    const noise = rng() * 2 - 1;
    const band = hi.run(noise) - lo.run(noise);
    const env = Math.exp(-((t - mid) ** 2) / (2 * 0.26 ** 2));
    phase += (2 * Math.PI * (70 + 70 / (1 + Math.exp((t - mid) * 6)))) / SAMPLE_RATE;
    const v = env * (1.6 * band + 0.25 * Math.sin(phase));
    const theta = Math.PI / 4 + side * (Math.PI / 4) * Math.tanh((t - mid) * 4);
    out.l[i] = v * Math.cos(theta);
    out.r[i] = v * Math.sin(theta);
  }
  return normalize(out, -3);
}

/** The reverse swell: whoosh_dissolve backwards, fading in, cut to SWELL_SECONDS (its loud end last). */
export function synthSwell(): Stereo | null {
  const src = decode("sfx/whoosh_dissolve.wav");
  if (!src) return null;
  const n = Math.min(src.l.length, Math.round(SWELL_SECONDS * SAMPLE_RATE));
  const out: Stereo = { l: new Float32Array(n), r: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    // The reversed file's last n samples: the original's first n, backwards.
    const k = n - 1 - i;
    const fade = Math.min(1, i / (0.4 * SAMPLE_RATE));
    out.l[i] = src.l[k] * fade;
    out.r[i] = src.r[k] * fade;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  The pass                                                           */
/* ------------------------------------------------------------------ */

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * Bullet time's sound for a resolved spec (every cue already has its file
 * and gain): the device's cues get their files, and the world's sound through
 * the window is slowed. Returns the spec unchanged (the same object) when no
 * scene has a bullet time. `gainFor` brings a measured file to its kind's
 * loudness (audio-resolve.ts).
 */
export function warpAudio(
  spec: ShotSpec,
  opts: { seed: string; library: LibraryEntry[]; gainFor: (e: Pick<LibraryEntry, "kind" | "lufs" | "truePeakDb">) => number; outDir?: string },
): { spec: ShotSpec; report: WarpReport | null } {
  const scene = spec.scenes.find((s) => s.bulletTime);
  const clock = scene?.bulletTime ? bulletClock(scene.bulletTime) : null;
  if (!scene || !clock) return { spec, report: null };
  const { a, d } = clock.edges;
  const report: WarpReport = { files: [], skipped: [] };
  const rel = `whatif-audio/${spec.id}`;
  const dir = opts.outDir ?? join(ROOT, "public", rel);
  const duration = Math.max(...spec.scenes.map((s) => s.to));
  const win = clock.window;
  const winKey = `${win.from}|${win.to}|${win.rampIn}|${win.rampOut}|${win.rate}`;

  /** Writes (or reuses) a file named by what made it; returns its path under public/. */
  const write = (kind: string, key: string, make: () => Stereo | null): string | null => {
    const hash = createHash("sha1").update(`${VERSION}|${kind}|${key}`).digest("hex").slice(0, 12);
    const name = `bt-${kind}-${hash}.wav`;
    const abs = join(dir, name);
    if (!existsSync(abs)) {
      const s = make();
      if (!s) return null;
      mkdirSync(dir, { recursive: true });
      writeFileSync(abs, wavBytes(s));
      report.files.push({ file: `${rel}/${name}`, kind, durSec: r3(s.l.length / SAMPLE_RATE), peakDb: Math.round(peakDb(s) * 10) / 10 });
    } else report.files.push({ file: `${rel}/${name}`, kind, durSec: r3((statSync(abs).size - 44) / 4 / SAMPLE_RATE), peakDb: NaN });
    return `${rel}/${name}`;
  };
  const sourceKey = (file: string) => {
    const abs = join(ROOT, "public", file);
    return existsSync(abs) ? `${file}:${statSync(abs).size}` : file;
  };
  const gainOf = (file: string) => {
    const m = measureLoudness(join(ROOT, "public", file));
    return opts.gainFor({ kind: "sfx", lufs: m.lufs, truePeakDb: m.truePeakDb });
  };
  const inWindow = (t: number) => t >= a - 1e-6 && t < d;

  /* ---- the device's cues ---- */
  for (const ev of spec.events ?? []) {
    for (const cue of ev.sfx ?? []) {
      if (!isDeviceTag(cue.tag)) continue;
      const at = (cue.at as number | undefined) ?? ev.t;
      let file: string | null = null;
      let gain: number | undefined;
      if (cue.tag === BT_TAGS.drop) {
        file = write("drop", `${opts.seed}`, () => synthDrop(opts.seed));
        if (file) gain = gainOf(file);
      } else if (cue.tag === BT_TAGS.whiz) {
        const side = (ev.name.charCodeAt(ev.name.length - 1) % 2 ? 1 : -1) as 1 | -1;
        file = write("whiz", `${opts.seed}|${ev.name}|${side}`, () => synthWhiz(`${opts.seed}|${ev.name}`, side));
        if (file) gain = gainOf(file) * 0.8;
      } else if (cue.tag === BT_TAGS.swell) {
        file = write("swell", sourceKey("sfx/whoosh_dissolve.wav"), synthSwell);
        if (file) gain = gainOf(file) * 0.9;
      } else if (cue.tag === BT_TAGS.shot || cue.tag === BT_TAGS.impact) {
        // Library one-shots: the shot slowed from its start (a world sound in
        // the window), the impacts at normal speed.
        const entry =
          cue.tag === BT_TAGS.shot
            ? (opts.library.find((e) => e.id === SHOT_ID) ?? pickEntry(opts.library, ["sfx"], [["shot"]], `${opts.seed}|${ev.name}`))
            : pickEntry(opts.library, ["sfx"], [["impact", "metal", "heavy"], ["impact", "metal"]], `${opts.seed}|${ev.name}`);
        if (entry) {
          gain = opts.gainFor(entry);
          if (cue.tag === BT_TAGS.shot && inWindow(at)) {
            const src = decode(entry.file);
            file = src ? write("shot", `${sourceKey(entry.file)}|${winKey}|${at}`, () => varispeed(src, clock, { origin: at, start: at, seconds: src.l.length / SAMPLE_RATE / SOUND_FLOOR + 0.2, loop: false })) : null;
          } else file = entry.file;
        }
      }
      if (file) {
        cue.file = file;
        cue.gain = gain ?? 1;
        if (cue.tag === BT_TAGS.swell) cue.at = r3(Math.max(0, d - SWELL_SECONDS));
      } else report.skipped.push(`${ev.name}:${cue.tag}`);
    }
    // A cue that got no file can't play (the render would fail on it).
    ev.sfx = (ev.sfx ?? []).filter((c) => !isDeviceTag(c.tag) || !!c.file);
  }

  /* ---- the world's one-shots in the window: slowed from their start ---- */
  for (const ev of spec.events ?? []) {
    if (!ev.name.startsWith("world-") || !inWindow(ev.t)) continue;
    for (const cue of ev.sfx ?? []) {
      const srcFile = cue.file ?? `sfx/${cue.tag}.wav`;
      const src = decode(srcFile);
      if (!src) {
        report.skipped.push(`${ev.name}:${cue.tag}`);
        continue;
      }
      const at = (cue.at as number | undefined) ?? ev.t;
      const len = cue.to ? Math.max(0.1, (cue.to as number) - at) : src.l.length / SAMPLE_RATE / SOUND_FLOOR + 0.2;
      const file = write("hit", `${sourceKey(srcFile)}|${winKey}|${at}|${len}`, () => varispeed(src, clock, { origin: at, start: at, seconds: len, loop: false }));
      if (file) cue.file = file;
    }
  }

  /* ---- beds and music through the window: cut at its start, slowed on ---- */
  const audio: Audio = spec.audio ?? {};
  const beds: Bed[] = [];
  for (const bed of (audio.ambient ?? []) as Bed[]) {
    const end = bed.to ?? duration;
    // The body's own sound (a heartbeat) stays on real time.
    if (bed.tag.startsWith("heartbeat_") || !(bed.from < d && end > a)) {
      beds.push(bed);
      continue;
    }
    const srcFile = bed.file ?? `sfx/${bed.tag}.wav`;
    const src = decode(srcFile);
    if (!src) {
      report.skipped.push(`bed:${bed.tag}`);
      beds.push(bed);
      continue;
    }
    const start = Math.max(bed.from, a);
    const file = write("bed", `${sourceKey(srcFile)}|${winKey}|${bed.from}|${end}`, () => varispeed(src, clock, { origin: bed.from, start, seconds: end - start, loop: true }));
    if (!file) {
      beds.push(bed);
      continue;
    }
    if (bed.from < a) beds.push({ ...bed, to: r3(a), fadeOut: undefined });
    const { fadeIn, ...rest } = bed;
    beds.push({ ...rest, from: r3(start), to: bed.to ?? null, file, loop: false, ...(bed.from >= a && fadeIn ? { fadeIn } : {}) });
  }
  if (audio.ambient) audio.ambient = beds.map((x) => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined)) as Bed);

  const music: Music[] = [];
  for (const m of audio.music ?? []) {
    const end = m.to ?? duration;
    if (!m.file || !(m.from < d && end > a)) {
      music.push(m);
      continue;
    }
    const src = decode(m.file);
    if (!src) {
      report.skipped.push(`music:${m.mood ?? m.file}`);
      music.push(m);
      continue;
    }
    const start = Math.max(m.from, a);
    const file = write("music", `${sourceKey(m.file)}|${winKey}|${m.from}|${end}`, () => varispeed(src, clock, { origin: m.from, start, seconds: end - start, loop: m.loop ?? true }));
    if (!file) {
      music.push(m);
      continue;
    }
    if (m.from < a) music.push({ ...m, to: r3(a), fadeOut: 0 });
    music.push({ ...m, from: r3(start), file, loop: false, fadeIn: m.from < a ? 0 : m.fadeIn });
  }
  if (audio.music) audio.music = music;
  spec.audio = audio;
  // The decoded sources are large (a music file is tens of MB): not kept.
  decoded.clear();
  return { spec, report };
}
