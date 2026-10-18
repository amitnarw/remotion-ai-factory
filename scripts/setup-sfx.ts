/**
 * scripts/setup-sfx.ts — v2 SFX library. Replaces the v1 "taped white noise"
 * with deterministic shaped/tonal synthesis (DSP toolkit: scripts/sfx-synth.ts).
 *
 * Every role gets a genuine, band-shaped sound:
 *   whoosh_dissolve    bandpass sweep + pitch-drop "dissolve" tail
 *   rumble_deep        sub-bass cluster + gusty brown noise (no hiss)
 *   clothing_flutter   small bandpassed flutters (no static wall)
 *   impact_soft_bodies thump + lowpass body + squish sweep + room tail
 *   scream_distant     formant-voiced wail, lowpassed + echoed (distant)
 *   wind_city          gusty band-passed air, low-mid body, no white hiss
 *   ambient_tense      detuned drone + sub pulse + slowly creeping air
 *   pop_light          click + tonal pop + low pock
 *   rise_short         rising bandpass + rising gliss with sub anchor
 *
 * Catalog v2 (public/sfx/sfx.catalog.json):
 *   { version: 2, roles: { <tag>: { label, description, family, tags,
 *     variants: [{ id, file (public-relative), dur, source, peakDb, rmsDb,
 *                  autoRank, pack? }] } } }
 *
 * The dashboard sound-design chooser and scripts/render-story.ts consume this
 * file; CC0 field-recordings are merged in as extra variants by
 * scripts/setup-sfx-cc0.ts (same schema).
 *
 * Usage: npm run sfx
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  Rng,
  Buf,
  Svf,
  Osc,
  smoothstep,
  decay,
  ampEnv,
  analyze,
  normalizePeak,
  writeWav,
  highpass1p,
  type Analysis,
} from "./sfx-synth";

const SR = 44100;
const PUBLIC_SFX = join(process.cwd(), "public", "sfx");
const ATTRIB = join(PUBLIC_SFX, "ATTRIBUTIONS.md");
const CC0_HEADING = "## CC0 field recordings (Kenney)";

/* ------------------------------------------------------------------ */
/*  Small local helpers                                                */
/* ------------------------------------------------------------------ */

/** One-pole glide toward a target value (for cutoff sweeps) — tc in ms. */
function glide(target: number, state: { y: number }, tcMs: number): number {
  const g = 1 - Math.exp(-1 / ((tcMs / 1000) * SR));
  state.y += g * (target - state.y);
  return state.y;
}

/** True lowpassed noise source (brown-ish): one-pole LP of white, restored. */
function brownSource(seed: number, fc = 250, gain = 8): () => number {
  const rng = new Rng(seed);
  const a = 1 - Math.exp((-2 * Math.PI * fc) / SR);
  let y = 0;
  return () => {
    const x = rng.next() * 2 - 1;
    y += a * (x - y);
    return y * gain;
  };
}

const wht = (rng: Rng): number => rng.next() * 2 - 1;

const r1 = (x: number): number => Math.round(x * 10) / 10;

/* ================================================================== */
/*  Role generators — each owns its own seed (call-order independent)  */
/* ================================================================== */

/** pop_light — click + tonal pop + low pock. 0.3s, peak −2.5 dBFS. */
function popLight(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(0.3);
  // 1. Tiny mechanical click (bright, ~10 ms).
  const clickHp = { y: 0 };
  out.layer(
    0,
    0.012,
    (x, t) => x * ampEnv(t, 0.001, 0.004) * 0.5,
    () => highpass1p(wht(rng), clickHp, 1200),
  );
  // 2. Tonal "pop" — fast chirp down, the recognizable character.
  const pop = new Osc();
  out.layer(0.004, 0.09, (_x, t) => {
    const f = 600 + 1500 * Math.exp(-t / 0.028);
    return pop.sine(f) * ampEnv(t, 0.004, 0.028) * 0.9;
  });
  // 3. Low "pock" body, slightly late.
  const pock = new Osc();
  out.layer(0.012, 0.28, (_x, t) => {
    const f = 190 + 90 * Math.exp(-t / 0.05);
    return pock.sine(f) * ampEnv(t, 0.004, 0.045) * 0.7;
  });
  return out.data;
}

/** impact_soft_bodies — thump + body + squish + room tail. 1.2s, −2.5. */
function impactSoftBodies(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(1.2);
  const bodyNoise = brownSource(seed + 11, 380, 8);
  // 1. Tiny bright attack transient.
  const clickHp = { y: 0 };
  out.layer(
    0,
    0.02,
    (x, t) => x * ampEnv(t, 0.0005, 0.004) * 0.55,
    () => highpass1p(wht(rng), clickHp, 1800),
  );
  // 2. Thump — exponential pitch drop 150 → 46 Hz.
  const thump = new Osc();
  out.layer(0, 0.55, (_x, t) => {
    const f = 46 + 104 * Math.exp(-t / 0.08);
    return thump.sine(f) * ampEnv(t, 0.003, 0.16);
  });
  // 3. Lowpassed body of the soft impact.
  const bodySvf = new Svf();
  out.layer(0.002, 1.0, (_x, t) => {
    const s = bodySvf.filter(bodyNoise(), 340 - 120 * decay(t, 0.4), 0.8);
    return s.lp * ampEnv(t, 0.004, 0.22) * 0.75;
  });
  // 4. "Squish" — downward bandpass sweep 900 → 260 Hz.
  const squishSvf = new Svf();
  out.layer(0.008, 0.3, (_x, t) => {
    const s = squishSvf.filter(wht(rng), 260 + 700 * decay(t, 0.09), 4);
    return s.bp * ampEnv(t, 0.004, 0.07) * 0.32;
  });
  // 5. Room tail.
  const tailSvf = new Svf();
  out.layer(0.02, 1.18, (_x, t) => {
    const s = tailSvf.filter(bodyNoise(), 480, 1.2);
    return s.bp * decay(Math.max(0, t - 0.06), 0.35) * 0.22;
  });
  return out.data;
}

/** whoosh_dissolve — bandpass sweep + pitch-drop dissolve tail. 2.2s, −3. */
function whooshDissolve(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(2.2);
  const swoosh = new Svf();
  const shimmer = new Svf();
  const cut = { y: 2600 };
  out.layer(
    0,
    1.5,
    (x, t) => {
      const fc = glide(240 + 2360 * Math.exp(-t / 0.75), cut, 120);
      const env = smoothstep(t, 0.4) * (t < 0.55 ? 1 : decay(t - 0.55, 0.5));
      const core = swoosh.filter(x, fc, 1.7);
      const sparkle = shimmer.filter(x, fc * 3.6, 4);
      return core.bp * env + sparkle.bp * env * 0.25;
    },
    () => wht(rng),
  );
  // Dissolve tail: pitch-drop sine with vibrato + puff of air.
  const glideOsc = new Osc();
  const vibr = new Osc();
  const puff = new Svf();
  out.layer(
    0.85,
    1.35,
    (x, t) => {
      const lt = t - 0.85;
      const f = 170 + 450 * Math.exp(-lt / 0.85);
      const wob = 1 + 0.025 * vibr.sine(4.5);
      const tone = glideOsc.sine(f * wob) * ampEnv(lt, 0.06, 0.5) * 0.5;
      const air = puff.filter(x, 300, 1).bp * decay(lt, 0.4) * 0.3;
      return tone + air;
    },
    () => wht(rng),
  );
  return out.data;
}

/** rise_short — rising bandpass noise + gliss + sub anchor. 1.5s, −3. */
function riseShort(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(1.5);
  const cloud = new Svf();
  const cut = { y: 260 };
  out.layer(
    0,
    1.5,
    (x, t) => {
      const fc = glide(4200 - 3940 * decay(t, 0.62), cut, 90);
      const env = smoothstep(t, 1.3) * decay(Math.max(0, t - 1.32), 0.08);
      return cloud.filter(x, fc, 2.2).bp * env;
    },
    () => wht(rng),
  );
  // Rising gliss (two detuned buzz voices) with a 7 Hz tremolo.
  const v1 = new Osc();
  const v2 = new Osc();
  const trem = new Osc();
  out.layer(0.05, 1.42, (_x, t) => {
    const tt = t - 0.05;
    const f = 200 + 580 * (1 - Math.exp(-tt / 0.8));
    const wobble = 0.75 + 0.25 * Math.abs(trem.sine(7));
    return (v1.buzz(f, 4) + v2.buzz(f * 1.018, 4)) * 0.5 * ampEnv(tt, 0.15, 1.6) * wobble * 0.24;
  });
  // Sub anchor.
  const sub = new Osc();
  out.layer(0, 1.5, (_x, t) => {
    const f = 62 + 64 * smoothstep(t, 1.3);
    return sub.sine(f) * smoothstep(t, 0.2) * decay(Math.max(0, t - 1.2), 0.12) * 0.2;
  });
  return out.data;
}

/** rumble_deep — sub-bass cluster + gusty massaged noise. 6s, −4. */
function rumbleDeep(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(6.0);
  const oscs = [new Osc(), new Osc(), new Osc(), new Osc()];
  const freqs = [38, 52, 66.3, 82.5];
  const lfoRate = [0.11, 0.17, 0.27, 0.33];
  const lfoPhase = lfoRate.map(() => rng.next() * Math.PI * 2);
  const env = (t: number) => smoothstep(t, 0.8) * decay(Math.max(0, t - 4.3), 0.9);
  out.layer(0, 6.0, (_x, t) => {
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      const l = 0.65 + 0.35 * Math.sin(2 * Math.PI * lfoRate[k] * t + lfoPhase[k]);
      sum += oscs[k].sine(freqs[k]) * l * (k < 3 ? 0.5 : 0.12);
    }
    return sum * env(t) * 0.55;
  });
  // Gust-massaged brown noise low band (moving-mass feel, zero hiss).
  const gustNoise = brownSource(seed + 21, 120, 9);
  const bodyLp = new Svf();
  const cut = { y: 95 };
  out.layer(
    0,
    6.0,
    (x, t) => {
      const gust = 0.7 + 0.3 * Math.sin(2 * Math.PI * 0.23 * t + 1.3);
      const fc = glide(95 * (0.6 + 0.4 * gust), cut, 200);
      return bodyLp.filter(x, fc, 0.7).lp * env(t) * gust * 0.5;
    },
    () => gustNoise(),
  );
  // Sparse low crackles deep inside the rumble.
  for (let c = 0; c < 6; c++) {
    const at = 0.6 + c * 0.72 + rng.range(0, 0.3);
    const crack = new Svf();
    const fc = rng.range(380, 900);
    out.layer(at, 0.05, (x, t) => crack.filter(x, fc, 3).bp * decay(t, 0.014) * 0.16, () =>
      wht(rng),
    );
  }
  return out.data;
}

/** wind_city — gusty band-passed air bed. 12s, −6 dBFS (bed level). */
function windCity(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(12.0);
  const air = brownSource(seed + 31, 250, 8);
  // Gust curve: three slow pseudo-periods + smoothed glide.
  // Gust curve: three slow pseudo-periods + smoothed glide.
  const ph = [0, 0, 0].map(() => rng.next() * Math.PI * 2);
  const gustS = { y: 1.0 };
  const body = new Svf();
  const body2 = new Svf();
  const streak = new Svf();
  out.layer(
    0,
    12.0,
    (x, t) => {
      let raw = 1.05;
      raw += 0.24 * Math.sin(2 * Math.PI * 0.07 * t + ph[0]);
      raw += 0.18 * Math.sin(2 * Math.PI * 0.13 * t + ph[1]);
      raw += 0.11 * Math.sin(2 * Math.PI * 0.31 * t + ph[2]);
      const g = glide(Math.max(0.4, Math.min(1.5, raw)), gustS, 700);
      const fc = 150 + 300 * g;
      const a = body.filter(x, fc, 1.3).bp;
      const b = body2.filter(a, fc * 2.4, 2.0).bp;
      const whist = streak.filter(x, 1000 + 800 * g, 6).bp * g * g * 0.05;
      return (b + whist) * g;
    },
    () => air(),
  );
  // Soft edges, so the bed butts cleanly against scene cuts.
  out.scale((t) => smoothstep(t, 1.2) * smoothstep(12.0 - t, 1.5));
  return out.data;
}

/** ambient_tense — detuned drone + sub pulse + creeping air. 10s, −8. */
function ambientTense(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(10.0);
  const drones = [new Osc(), new Osc(), new Osc(), new Osc()];
  const dfreq = [55, 55.7, 110.03, 164.8];
  const dgain = [0.3, 0.3, 0.16, 0.07];
  const swellPh = rng.next() * Math.PI * 2;
  out.layer(0, 10.0, (_x, t) => {
    const swell = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.09 * t + swellPh);
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += drones[k].sine(dfreq[k]) * dgain[k];
    return sum * swell;
  });
  // Heartbeat pulses with human-ish jitter.
  let at = 1.4;
  while (at < 9.2) {
    const pulse = new Osc();
    out.layer(at, 0.6, (_x, t) => {
      const s = pulse.sine(44);
      return s * ampEnv(t, 0.01, 0.3) * 0.35;
    });
    at += 1.12 + rng.range(-0.15, 0.25);
  }
  // Creeping air: slowly cycling bandpass high up.
  const airSrc = (() => {
    const r = new Rng(seed + 71);
    return () => r.next() * 2 - 1;
  })();
  const airSvf = new Svf();
  out.layer(
    0,
    10.0,
    (x, t) => {
      const fc = 700 + 250 * Math.sin(2 * Math.PI * 0.08 * t);
      return airSvf.filter(x, fc, 3).bp * 0.05;
    },
    () => airSrc(),
  );
  // Low cut + soft edges.
  const cut = { y: 0 };
  for (let i = 0; i < out.data.length; i++) {
    out.data[i] = highpass1p(out.data[i], cut, 42);
  }
  out.scale((t) => smoothstep(t, 0.8) * smoothstep(10.0 - t, 0.9));
  return out.data;
}

/** scream_distant — formant-voiced wail, lowpassed + echoed. 2s, −6. */
function screamDistant(seed: number): Float32Array {
  const out = new Buf(2.0);
  const vib = new Osc();
  const lead = new Osc();
  const chorus = new Osc();
  const f1 = new Svf();
  const f2 = new Svf();
  const f3 = new Svf();
  const dist = new Svf();
  const roomBed = brownSource(seed + 51, 300, 8);
  const roomSvf = new Svf();
  // Pitch contour: rise 380→620 (0–0.5), hold, ease down to 310 (0.75–1.5).
  const pitch = (t: number): number => {
    const rise = 380 + 240 * smoothstep(t, 0.5);
    const held =
      t < 0.75 ? rise : rise - 310 * smoothstep(t - 0.75, 0.75);
    return Math.max(310, Math.min(625, held));
  };
  out.layer(
    0,
    2.0,
    (x, t) => {
      const env = ampEnv(t, 0.09, 1.4) * (t > 1.3 ? decay(t - 1.3, 0.3) : 1);
      const f = pitch(t) * (1 + 0.03 * vib.sine(5.4));
      const logo = lead.buzz(f, 5);
      const ch = chorus.buzz(f * 2.02, 5);
      // Three parallel formant resonators on the summed voice.
      const v = (logo * 0.75 + ch * 0.28) * env;
      const p1 = f1.filter(v, 640 + 260 * smoothstep(t, 0.55), 8).bp;
      const p2 = f2.filter(v, 1100 + 800 * smoothstep(t - 0.3, 1.2), 11).bp;
      const p3 = f3.filter(v, 2400, 14).bp;
      const voiced = (p1 + p2 * 0.6 + p3 * 0.35) * 1.4;
      const distant = dist.filter(voiced, 2300, 0.8).lp;
      const room = roomSvf.filter(x, 400, 1).bp * 0.05;
      return distant + room;
    },
    () => roomBed(),
  );
  // Distance echoes (read-only taps into a snapshot).
  const snap = Float32Array.from(out.data);
  for (let i = 0; i < out.n; i++) {
    let echo = 0;
    if (i >= 2293) echo += snap[i - 2293] * 0.32; // 52 ms
    if (i >= 4234) echo += snap[i - 4234] * 0.18; // 96 ms
    out.data[i] += echo;
  }
  return out.data;
}

/** clothing_flutter — small bandpassed fabric flaps. 0.9s, −8. */
function clothingFlutter(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(0.9);
  for (let b = 0; b < 4; b++) {
    const at = 0.02 + b * 0.18 + rng.range(0, 0.1);
    const dur = rng.range(0.07, 0.15);
    const fc0 = rng.range(1300, 2100);
    const tremRate = rng.range(13, 16);
    const flare = new Svf();
    out.layer(
      at,
      dur,
      (x, t) => {
        const fc = fc0 * (1 - 0.18 * (t / dur));
        const s = flare.filter(x, fc, 4.5).bp;
        const flut = 0.55 + 0.45 * Math.sin(2 * Math.PI * tremRate * t);
        return s * ampEnv(t, 0.012, dur / 3.2) * flut * 0.5;
      },
      () => wht(rng),
    );
  }
  // No thump bleed — cut lows.
  const cut = { y: 0 };
  for (let i = 0; i < out.data.length; i++) {
    out.data[i] = highpass1p(out.data[i], cut, 200);
  }
  return out.data;
}

/* ================================================================== */
/*  Role table + catalog writer                                        */
/* ================================================================== */
export interface SfxVariant {
  id: string;
  /** public/-relative path → works with staticFile(), /sfx URLs and fs. */
  file: string;
  dur: number;
  source: string;
  pack?: string;
  peakDb: number;
  rmsDb: number;
  /** Higher wins under "Auto (best)". */
  autoRank: number;
}

export interface SfxRole {
  label: string;
  description: string;
  family: string;
  tags: string[];
  variants: SfxVariant[];
}

export interface SfxCatalog {
  version: 2;
  generatedAt: number;
  roles: Record<string, SfxRole>;
}

interface RoleDef {
  build: (seed: number) => Float32Array;
  dur: number;
  peak: number;
  label: string;
  description: string;
  family: "ambient" | "event";
  tags: string[];
  /** Objective v2 sanity checks: band-share minimums so flat noise can't ship. */
  checks: { low?: number; mid?: number; high?: number; zcrMax?: number };
}

const SEEDS: Record<string, number> = {
  whoosh_dissolve: 303,
  rumble_deep: 505,
  clothing_flutter: 909,
  impact_soft_bodies: 202,
  scream_distant: 808,
  wind_city: 606,
  ambient_tense: 707,
  pop_light: 101,
  rise_short: 404,
};

const ROLES: Record<string, RoleDef> = {
  wind_city: {
    build: windCity,
    dur: 12,
    peak: -6,
    label: "City ambience — gusts",
    description: "Slow gusty air with a low-mid body. Ambient bed; no white hiss.",
    family: "ambient",
    tags: ["ambient", "wind", "city", "bed"],
    checks: { high: 0.28, zcrMax: 2.0 },
  },
  ambient_tense: {
    build: ambientTense,
    dur: 10,
    peak: -8,
    label: "Tension drone bed",
    description: "Detuned low drone with a soft sub pulse and creeping air.",
    family: "ambient",
    tags: ["ambient", "tense", "bed"],
    checks: { low: 0.4, zcrMax: 1.0 },
  },
  whoosh_dissolve: {
    build: whooshDissolve,
    dur: 2.2,
    peak: -3,
    label: "Dissolve whoosh",
    description: "Downward bandpass sweep, vibrating pitch-drop tail.",
    family: "event",
    tags: ["dissolve", "transition", "whoosh"],
    checks: {},
  },
  rumble_deep: {
    build: rumbleDeep,
    dur: 6,
    peak: -4,
    label: "Deep rumble",
    description: "Sub-bass cluster with gusty mass; the ground-disappears sound.",
    family: "event",
    tags: ["earthquake", "gravity", "tension", "rumble"],
    checks: { low: 0.45 },
  },
  clothing_flutter: {
    build: clothingFlutter,
    dur: 0.9,
    peak: -8,
    label: "Clothing flutter",
    description: "Short bandpassed fabric flaps while mid-air.",
    family: "event",
    tags: ["flutter", "cloth", "movement"],
    checks: {},
  },
  impact_soft_bodies: {
    build: impactSoftBodies,
    dur: 1.2,
    peak: -2.5,
    label: "Soft impact landing",
    description: "Thump with pitch drop, soft body and a squish sweep.",
    family: "event",
    tags: ["impact", "crash", "landing"],
    checks: { low: 0.3 },
  },
  scream_distant: {
    build: screamDistant,
    dur: 2,
    peak: -6,
    label: "Distant scream",
    description: "Formant-voiced wail, lowpassed with echoes — far away.",
    family: "event",
    tags: ["scream", "distant", "human"],
    checks: {},
  },
  pop_light: {
    build: popLight,
    dur: 0.3,
    peak: -2.5,
    label: "UI pop",
    description: "Bright click + tonal pop + low pock; UI ticks and reveal beats.",
    family: "event",
    tags: ["pop", "ui", "click"],
    checks: {},
  },
  rise_short: {
    build: riseShort,
    dur: 1.5,
    peak: -3,
    label: "Short riser",
    description: "Rising bandpass + rising gliss with sub anchor; pre-event lift.",
    family: "event",
    tags: ["rise", "buildup", "tension"],
    checks: {},
  },
};

const SYNTH_HEAD = `# SFX Attributions & catalogue

## Synth v2 (in-house DSP)

All \`synth\` variants below are generated 100% locally by
\`npm run sfx\` (\`scripts/setup-sfx.ts\` + \`scripts/sfx-synth.ts\`) — deterministic
shaped/tonal synthesis in Node, no external samples, no licensing concerns.

`;
const CC0_NOTE = `${CC0_HEADING}\n(variants listed here are appended by \`npm run sfx:cc0\`)\n`;

function main(): void {
  mkdirSync(PUBLIC_SFX, { recursive: true });

  const catalog: SfxCatalog = { version: 2, generatedAt: Date.now(), roles: {} };
  const lines: string[] = [];

  for (const [role, def] of Object.entries(ROLES)) {
    const samples = def.build(SEEDS[role] ?? 1);
    normalizePeak(samples, def.peak);
    writeWav(join(PUBLIC_SFX, `${role}.wav`), samples);
    const a: Analysis = analyze(samples);
    catalog.roles[role] = {
      label: def.label,
      description: def.description,
      family: def.family,
      tags: def.tags,
      variants: [
        {
          id: "synth",
          file: `sfx/${role}.wav`,
          dur: r1(samples.length / SR),
          source: "Synth v2 (in-house DSP)",
          peakDb: r1(a.peakDb),
          rmsDb: r1(a.rmsDb),
          autoRank: 50,
        },
      ],
    };
    lines.push(
      `${role.padEnd(20)} ${a.peakDb.toFixed(1).padStart(6)}dBpk  ${a.rmsDb
        .toFixed(1)
        .padStart(6)}dB rms   zcr=${a.zcr.toFixed(2)}  bands L/M/H = ${(
        a.bands.low * 100
      )
        .toFixed(0)
        .padStart(3)} / ${(a.bands.mid * 100).toFixed(0).padStart(3)} / ${(
        a.bands.high * 100
      )
        .toFixed(0)
        .padStart(3)}`,
    );

    // Objective shaped-noise guards — a flat-noise regression must fail here.
    const fail: string[] = [];
    if (def.checks.high !== undefined && a.bands.high > def.checks.high) {
      fail.push(`high-band energy ${(a.bands.high * 100).toFixed(0)}% > ${def.checks.high * 100}%`);
    }
    if (def.checks.low !== undefined && a.bands.low < def.checks.low) {
      fail.push(`low-band energy ${(a.bands.low * 100).toFixed(0)}% < ${def.checks.low * 100}%`);
    }
    if (def.checks.zcrMax !== undefined && a.zcr > def.checks.zcrMax) {
      fail.push(`zcr ${a.zcr.toFixed(2)} > ${def.checks.zcrMax}`);
    }
    if (fail.length > 0) {
      throw new Error(
        `${role} failed the v2 shaping check: ${fail.join("; ")}. Keep re-shaping the filter chain in setup-sfx.ts until the band-split targets hold.`,
      );
    }
  }

  // Catalog + attributions (CC0 section written by setup-sfx-cc0 is preserved).
  writeFileSync(
    join(PUBLIC_SFX, "sfx.catalog.json"),
    JSON.stringify(catalog, null, 2),
  );
  const existing = existsSync(ATTRIB) ? readFileSync(ATTRIB, "utf8") : "";
  const cc0At = existing.indexOf(CC0_HEADING);
  const preserved = cc0At >= 0 ? existing.slice(cc0At) : CC0_NOTE;
  writeFileSync(ATTRIB, SYNTH_HEAD + preserved);

  console.log(lines.join("\n"));
  console.log(
    `[sfx] v2 library ready: ${Object.keys(catalog.roles).length} roles (synth variants) → ${PUBLIC_SFX}`,
  );
}

/** CLI entry (guarded so other scripts can import this module safely). */
if (process.argv[1] && /setup-sfx(\.ts)?$/.test(process.argv[1])) {
  main();
}



