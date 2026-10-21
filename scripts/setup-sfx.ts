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
 *   street_murmur      babbling crowd voices + far traffic bed
 *   heartbeat_bpm70…150  chesty lub-dub beds at 5 tempos (StatHud PULSE)
 *   car_pass           doppler rise-fall engine pass-by
 *   horn_distant       two-tone horn, far away
 *   bike_bell          two bright bell pings
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

/** wind_city — gusty band-passed air bed. 16s, −6 dBFS (bed level). */
function windCity(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(30.0);
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
    30.0,
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
  out.scale((t) => smoothstep(t, 1.2) * smoothstep(30.0 - t, 1.5));
  return out.data;
}

/** ambient_tense — detuned drone + sub pulse + creeping air. 16s, −8. */
function ambientTense(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(30.0);
  const drones = [new Osc(), new Osc(), new Osc(), new Osc()];
  const dfreq = [55, 55.7, 110.03, 164.8];
  const dgain = [0.3, 0.3, 0.16, 0.07];
  const swellPh = rng.next() * Math.PI * 2;
  out.layer(0, 30.0, (_x, t) => {
    const swell = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.09 * t + swellPh);
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += drones[k].sine(dfreq[k]) * dgain[k];
    return sum * swell;
  });
  // Heartbeat pulses with human-ish jitter.
  let at = 1.4;
  while (at < 29.2) {
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
    30.0,
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
  out.scale((t) => smoothstep(t, 0.8) * smoothstep(30.0 - t, 0.9));
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
/*  Street-life roles (heartbeat, murmur, traffic one-shots)            */
/* ================================================================== */

/** Continuous heartbeat bed at a fixed BPM: chesty lub-dub thumps. */
function heartBed(bpm: number): (seed: number) => Float32Array {
  return (seed: number) => {
    const out = new Buf(30.0);
    const period = 60 / bpm;
    let at = 0.30;
    let k = 0;
    while (at < 29.2) {
      // human-ish micro-jitter every few beats
      const beatAt = at + (k % 4 === 3 ? 0.05 : 0);
      const lub = new Osc();
      out.layer(beatAt, 0.4, (_x, t) => {
        const f = 46 + 26 * Math.exp(-t / 0.05);
        return lub.sine(f) * ampEnv(t, 0.008, 0.15) * 0.95;
      });
      const dub = new Osc();
      out.layer(beatAt + 0.19, 0.3, (_x, t) => {
        const f = 42 + 20 * Math.exp(-t / 0.06);
        return dub.sine(f) * ampEnv(t, 0.01, 0.12) * 0.55;
      });
      const chest = new Svf();
      const chestSrc = new Rng(seed + k * 17);
      out.layer(
        beatAt,
        0.5,
        (x, t) => chest.filter(x, 68, 1.1).lp * ampEnv(t, 0.004, 0.1) * 0.3,
        () => chestSrc.next() * 2 - 1,
      );
      at += period;
      k += 1;
    }
    // soft edges so tempo-crossfades stay clean
    out.scale((t) => smoothstep(t, 0.25) * smoothstep(30.0 - t, 0.4));
    return out.data;
  };
}

/** street_murmur — babbling crowd voices + distant traffic bed. No white hiss. */
function streetMurmur(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(30.0);
  const air = brownSource(seed + 40, 170, 8);
  const bed = new Svf();
  const ph: number[] = [];
  const rates: number[] = [];
  const base: number[] = [];
  for (let k = 0; k < 5; k++) {
    ph.push(rng.next() * Math.PI * 2);
    rates.push(rng.range(1.8, 3.6));
    base.push(96 + k * 21 + rng.range(-6, 6));
  }
  const voices = [new Osc(), new Osc(), new Osc(), new Osc(), new Osc()];
  out.layer(
    0,
    30.0,
    (_x, t) => {
      let s = 0;
      for (let k = 0; k < 5; k++) {
        const f = base[k] * (1 + 0.05 * Math.sin(2 * Math.PI * (0.7 + 0.11 * k) * t + ph[k]));
        const chatter = 0.35 + 0.65 * Math.abs(Math.sin(2 * Math.PI * rates[k] * t + ph[k] * 1.7));
        s += voices[k].buzz(f, 3) * 0.05 * chatter;
      }
      return s + bed.filter(air(), 240, 0.8).lp * 0.12;
    },
    () => air(),
  );
  // distant horn chirps twice, tucked behind the crowd.
  const horn1 = new Osc();
  const horn2 = new Osc();
  const hornTone = new Svf();
  out.layer(9.4, 0.8, (_x, t) => {
    const env = ampEnv(t, 0.12, 0.5) * 0.3;
    const tone = (horn1.sine(362) * 0.6 + horn2.sine(455) * 0.6) * env;
    return hornTone.filter(tone, 850, 0.9).lp;
  });
  out.layer(16.9, 0.6, (_x, t) => {
    const env = ampEnv(t, 0.1, 0.35) * 0.24;
    const tone = (horn1.sine(423) * 0.6 + horn2.sine(523) * 0.6) * env;
    return hornTone.filter(tone, 900, 0.9).lp;
  });
  out.scale((t) => smoothstep(t, 0.7) * smoothstep(30.0 - t, 0.9));
  return out.data;
}

/** car_pass — one vehicle rolling past the microphone (amplitude + doppler). */
function carPass(seed: number): Float32Array {
  const out = new Buf(2.6);
  const rumble = brownSource(seed + 3, 130, 10);
  const rumbleF = new Svf();
  out.layer(
    0,
    2.6,
    (x, t) => {
      const env = Math.pow(Math.sin(Math.PI * (t / 2.6)), 1.6);
      return rumbleF.filter(x, 215, 0.8).lp * env * 0.95;
    },
    () => rumble(),
  );
  const roll = brownSource(seed + 1, 320, 9);
  const low = new Svf();
  out.layer(
    0,
    2.6,
    (x, t) => {
      const env = Math.pow(Math.sin(Math.PI * (t / 2.6)), 1.6);
      const dopF = 360 + 620 * Math.sin(Math.PI * (t / 2.6));
      return low.filter(x, Math.max(dopF, 480), 1.1).bp * env * 0.55;
    },
    () => roll(),
  );
  const sheen = brownSource(seed + 2, 520, 6);
  const high = new Svf();
  out.layer(
    0.2,
    2.2,
    (x, t) => {
      const env = Math.pow(Math.sin(Math.PI * ((t + 0.2) / 2.6)), 1.6);
      const f = 1500 + 800 * Math.sin(Math.PI * ((t + 0.2) / 2.6));
      return high.filter(x, f, 2.6).bp * env * 0.2;
    },
    () => sheen(),
  );
  return out.data;
}

/** horn_distant — two-tone bus horn, filtered far away with one echo. */
function hornDistant(seed: number): Float32Array {
  const out = new Buf(1.2);
  const a = new Osc();
  const b = new Osc();
  const tone = new Svf();
  out.layer(0.05, 1.0, (_x, t) => {
    const env = ampEnv(t, 0.12, 0.65) * 0.8;
    const voiced = a.sine(362) * 0.6 + b.sine(455) * 0.6;
    return tone.filter(voiced, 820, 0.9).lp * env;
  });
  const lpCut = { y: 0.5 };
  const roomSvf = new Svf();
  for (let i = 0; i < out.data.length; i++) {
    out.data[i] = roomSvf.filter(out.data[i], 900, 0.8).lp;
  }
  void lpCut;
  // simple echo tap for distance
  const snap = Float32Array.from(out.data);
  for (let i = 0; i < out.n; i++) {
    if (i >= 1323) out.data[i] += snap[i - 1323] * 0.22; // 30 ms
  }
  return out.data;
}

/** bike_bell — two bright bell pings ("ding ding"). */
function bikeBell(seed: number): Float32Array {
  const out = new Buf(1.0);
  const ring = (at: number, oscs: Array<[Osc, number]>, gain: number) => {
    out.layer(at, 0.6, (_x, t) => {
      let s = 0;
      for (const [o, f] of oscs) s += o.sine(f) * 0.5;
      const shimmer = 1 + 0.35 * Math.sin(2 * Math.PI * 6.4 * t);
      return s * ampEnv(t, 0.004, 0.4) * shimmer * gain;
    });
  };
  ring(0.06, [[new Osc(), 2370], [new Osc(), 3560]], 0.6);
  ring(0.32, [[new Osc(), 2280], [new Osc(), 3420]], 0.5);
  const cut = { y: 0 };
  for (let i = 0; i < out.data.length; i++) {
    out.data[i] = highpass1p(out.data[i], cut, 350);
  }
  void seed;
  return out.data;
}

/* ================================================================== */
/** rain_hiss — shaped noise bed: mid-high hiss with slow gust undulation,
 *  zero static wall. 30s ambient bed (peak −24). */
function rainHiss(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(30.0);
  const air = () => wht(rng);
  const hiss = new Svf();
  const ph = [0, 0, 0].map(() => rng.next() * Math.PI * 2);
  const gust = { y: 1.0 };
  out.layer(
    0,
    30.0,
    (_x, t) => {
      let raw = 1.0;
      raw += 0.15 * Math.sin(2 * Math.PI * 0.06 * t + ph[0]);
      raw += 0.1 * Math.sin(2 * Math.PI * 0.11 * t + ph[1]);
      const g = glide(Math.max(0.6, Math.min(1.3, raw)), gust, 900);
      return hiss.filter(air(), 3400 + 1200 * g, 2.5).bp * g * 0.34;
    },
    () => air(),
  );
  out.scale((t) => smoothstep(t, 1.0) * smoothstep(30.0 - t, 1.0));
  return out.data;
}

/** thunder_crack — sub thump + high crack + low roll after. 2.5s (peak −5). */
function thunderCrack(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(2.5);
  const thump = new Osc();
  out.layer(0, 1.0, (_x, t) => {
    const f = 55 + 35 * Math.exp(-t / 0.12);
    return thump.sine(f) * ampEnv(t, 0.005, 0.5) * 0.9;
  });
  const crack = new Svf();
  const cut = { y: 900 };
  out.layer(0.02, 0.5, (x, t) => {
    const fc = glide(2600 - 1800 * decay(t, 0.15), cut, 60);
    return crack.filter(x, fc, 1.5).bp * ampEnv(t, 0.002, 0.4) * 0.5;
  }, () => wht(rng));
  const roll = new Svf();
  const rumble = brownSource(seed + 11, 110, 8);
  out.layer(0.35, 1.9, (_x, t) => roll.filter(rumble(), 150, 0.9).lp * decay(Math.max(0, t - 0.35), 0.6) * 0.25);
  return out.data;
}

/* ================================================================== */
/*  NEW SOUND GENERATORS — extensive world sound library              */
/* ================================================================== */

/* ------------------------------------------------------------------ */
/*  OCEAN WORLD SOUNDS                                                */
/* ------------------------------------------------------------------ */

/** ocean_waves — rolling wave breaks with foam hiss. 30s bed. */
function oceanWaves(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(30.0);
  const air = () => wht(rng);
  const wave = new Svf();
  const foam = new Svf();
  const ph = [0, 0, 0].map(() => rng.next() * Math.PI * 2);
  const swell = { y: 1.0 };
  out.layer(0, 30.0, (_x, t) => {
    let raw = 1.0;
    raw += 0.3 * Math.sin(2 * Math.PI * 0.08 * t + ph[0]);
    raw += 0.2 * Math.sin(2 * Math.PI * 0.15 * t + ph[1]);
    const g = glide(Math.max(0.5, Math.min(1.4, raw)), swell, 600);
    // Strong lowpass on wave body, quieter foam with less high-freq content
    const waveCore = wave.filter(air(), 150 + 400 * g, 2.0).lp * g * 0.55;
    const foamCore = foam.filter(air(), 900 + 800 * g, 3.0).hp * g * 0.10;
    return waveCore + foamCore;
  }, () => air());
  out.scale((t) => smoothstep(t, 1.5) * smoothstep(30.0 - t, 1.5));
  return out.data;
}

/** ocean_gulls — distant seagull calls. 30s bed with sparse events. */
function oceanGulls(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(30.0);
  const gull = new Osc();
  const filter = new Svf();
  for (let i = 0; i < 8; i++) {
    const t0 = 2 + rng.next() * 26;
    const dur = 0.8 + rng.next() * 1.5;
    const baseF = 800 + rng.next() * 1200;
    out.layer(t0, t0 + dur, (_x, t) => {
      const ft = t - t0;
      const f = baseF * (1 + 0.3 * Math.sin(ft * 8 + rng.next() * 6));
      const env = ampEnv(ft, 0.05, dur * 0.6) * (0.5 + rng.next() * 0.5);
      return filter.filter(gull.sine(f), 3000, 1.5).bp * env * 0.3;
    });
  }
  out.scale((t) => smoothstep(t, 1.0) * smoothstep(30.0 - t, 1.0));
  return out.data;
}

/** ocean_ship_horn — deep foghorn blast. 8s event. */
function oceanShipHorn(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(8.0);
  const horn = new Osc();
  const filter = new Svf();
  const f0 = 80 + rng.next() * 40;
  out.layer(0, 6.0, (_x, t) => {
    const f = f0 * (1 + 0.08 * Math.sin(t * 1.5));
    const env = ampEnv(t, 0.3, 2.5) * decay(t, 1.5);
    return filter.filter(horn.sine(f), 400, 3.5).lp * env * 0.8;
  });
  // Echo
  out.layer(1.2, 5.0, (_x, t) => {
    const ft = t - 1.2;
    const f = f0 * (1 + 0.05 * Math.sin(ft * 1.2));
    const env = ampEnv(ft, 0.5, 2.0) * decay(ft, 2.5) * 0.25;
    return filter.filter(horn.sine(f), 500, 3.5).lp * env * 0.3;
  });
  out.scale((t) => smoothstep(t, 0.5) * smoothstep(8.0 - t, 1.0));
  return out.data;
}

/** ocean_splash — water splash impact. 1.5s event. */
function oceanSplash(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(1.5);
  const splash = new Svf();
  const air = () => wht(rng);
  out.layer(0, 1.0, (x, t) => {
    const env = ampEnv(t, 0.003, 0.3) * decay(t, 0.4);
    return splash.filter(x, 800 + 4000 * decay(t, 0.3), 1.5).bp * env * 0.6;
  }, air);
  // Droplets
  const drip = new Osc();
  for (let i = 0; i < 6; i++) {
    const t0 = 0.15 + rng.next() * 0.8;
    out.layer(t0, t0 + 0.4, (_x, t) => {
      const ft = t - t0;
      const f = 600 + rng.next() * 1200;
      return drip.sine(f) * ampEnv(ft, 0.005, 0.12) * 0.3 * decay(ft, 0.5);
    });
  }
  out.scale((t) => smoothstep(t, 0.1) * smoothstep(1.5 - t, 0.3));
  return out.data;
}

/** underwater_bubbles — gentle bubble stream. 30s bed. */
function underwaterBubbles(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(30.0);
  const pop = new Osc();
  const filter = new Svf();
  for (let i = 0; i < 15; i++) {
    const t0 = rng.next() * 28;
    out.layer(t0, t0 + 0.3, (_x, t) => {
      const ft = t - t0;
      const f = 40 + rng.next() * 120;
      const env = ampEnv(ft, 0.008, 0.1) * 0.5;
      return filter.filter(pop.sine(f), 200, 1.2).lp * env * 0.4;
    });
  }
  out.scale((t) => smoothstep(t, 1.0) * smoothstep(30.0 - t, 1.0));
  return out.data;
}

/* ------------------------------------------------------------------ */
/*  FOREST WORLD SOUNDS                                               */
/* ------------------------------------------------------------------ */

/** forest_birds — diverse bird chorus. 30s bed with layered calls. */
function forestBirds(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(30.0);
  const bird = new Osc();
  const filter = new Svf();
  const species = [
    { baseF: 1400, spread: 300, dur: 0.6, interval: 3.5 },   // Warbler
    { baseF: 600, spread: 250, dur: 1.2, interval: 6.0 },    // Thrush
    { baseF: 1800, spread: 500, dur: 0.4, interval: 2.0 },   // Finch
    { baseF: 400, spread: 120, dur: 2.0, interval: 8.0 },    // Owl (distant)
    { baseF: 1600, spread: 500, dur: 0.5, interval: 4.0 },   // Woodpecker
  ];
  for (let s = 0; s < species.length; s++) {
    const sp = species[s];
    for (let i = 0; i < 6; i++) {
      const t0 = 1 + rng.next() * 28;
      const dur = sp.dur * (0.7 + rng.next() * 0.6);
      out.layer(t0, t0 + dur, (_x, t) => {
        const ft = t - t0;
        const f = sp.baseF + (rng.next() - 0.5) * sp.spread;
        const trill = 1 + 0.4 * Math.sin((t - t0) * 15 + s * 2);
        const env = ampEnv(ft, 0.03, dur * 0.7) * (0.4 + rng.next() * 0.4);
        return filter.filter(bird.sine(f * trill), sp.baseF + 1200, 3.0).bp * env * 0.28;
      });
    }
  }
  out.scale((t) => smoothstep(t, 1.0) * smoothstep(30.0 - t, 1.0));
  return out.data;
}

/** forest_wind_leaves — wind through canopy. 30s bed. */
function forestWindLeaves(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(30.0);
  const leaf = () => wht(rng);
  const filter = new Svf();
  const ph = [0, 0, 0].map(() => rng.next() * Math.PI * 2);
  const gust = { y: 1.0 };
  out.layer(0, 30.0, (_x, t) => {
    let raw = 1.0;
    raw += 0.35 * Math.sin(2 * Math.PI * 0.04 * t + ph[0]);
    raw += 0.25 * Math.sin(2 * Math.PI * 0.09 * t + ph[1]);
    raw += 0.15 * Math.sin(2 * Math.PI * 0.22 * t + ph[2]);
    const g = glide(Math.max(0.4, Math.min(1.6, raw)), gust, 500);
    return filter.filter(leaf(), 150 + 700 * g, 3.5).lp * g * 0.4;
  }, leaf);
  out.scale((t) => smoothstep(t, 1.5) * smoothstep(30.0 - t, 1.5));
  return out.data;
}

/** forest_stream — babbling brook. 30s bed. */
function forestStream(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(30.0);
  const water = () => wht(rng);
  const filter = new Svf();
  const ph = [0, 0].map(() => rng.next() * Math.PI * 2);
  const flow = { y: 1.0 };
  out.layer(0, 30.0, (_x, t) => {
    let raw = 1.0;
    raw += 0.2 * Math.sin(2 * Math.PI * 0.12 * t + ph[0]);
    raw += 0.15 * Math.sin(2 * Math.PI * 0.05 * t + ph[1]);
    const g = glide(Math.max(0.7, Math.min(1.3, raw)), flow, 700);
    return filter.filter(water(), 300 + 900 * g, 2.5).lp * g * 0.4;
  }, water);
  out.scale((t) => smoothstep(t, 1.0) * smoothstep(30.0 - t, 1.0));
  return out.data;
}

/** forest_insects — crickets, cicadas. 30s bed (night). */
function forestInsects(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(30.0);
  const osc = new Osc();
  const filter = new Svf();
  const types: Array<{ baseF: number; spread: number; dur: number; interval: number }> = [
    { baseF: 2500, spread: 400, dur: 0.8, interval: 1.5 },  // Cricket
    { baseF: 3500, spread: 1000, dur: 3.0, interval: 4.0 }, // Cicada
    { baseF: 3000, spread: 800, dur: 1.5, interval: 2.5 },  // Katydid
  ];
  for (let k = 0; k < types.length; k++) {
    const tp = types[k];
    for (let i = 0; i < 8; i++) {
      const t0 = 0.5 + rng.next() * 29;
      const dur = tp.dur * (0.6 + rng.next() * 0.8);
      out.layer(t0, t0 + dur, (_x, tt) => {
        const ft = tt - t0;
        const f = tp.baseF + (rng.next() - 0.5) * tp.spread;
        const mod = 1 + 0.6 * Math.sin(ft * 20 + k * 3);
        const env = ampEnv(ft, 0.02, dur * 0.6) * (0.5 + rng.next() * 0.4);
        return filter.filter(osc.sine(f * mod), tp.baseF * 0.8, 3.0).bp * env * 0.2;
      });
    }
  }
  out.scale((t) => smoothstep(t, 1.0) * smoothstep(30.0 - t, 1.0));
  return out.data;
}

/* ------------------------------------------------------------------ */
/*  COUNTRYSIDE SOUNDS                                                */
/* ------------------------------------------------------------------ */

/** countryside_wind — open field wind. 30s bed. */
function countrysideWind(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(30.0);
  const air = () => wht(rng);
  const filter = new Svf();
  const ph = [0, 0, 0].map(() => rng.next() * Math.PI * 2);
  const gust = { y: 1.0 };
  out.layer(0, 30.0, (_x, t) => {
    let raw = 1.0;
    raw += 0.4 * Math.sin(2 * Math.PI * 0.03 * t + ph[0]);
    raw += 0.3 * Math.sin(2 * Math.PI * 0.07 * t + ph[1]);
    raw += 0.2 * Math.sin(2 * Math.PI * 0.18 * t + ph[2]);
    const g = glide(Math.max(0.3, Math.min(1.8, raw)), gust, 400);
    return filter.filter(air(), 150 + 800 * g, 3.0).lp * g * 0.4;
  }, air);
  out.scale((t) => smoothstep(t, 2.0) * smoothstep(30.0 - t, 2.0));
  return out.data;
}

/** countryside_crickets — evening crickets. 30s bed. */
function countrysideCrickets(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(30.0);
  const osc = new Osc();
  const filter = new Svf();
  for (let i = 0; i < 12; i++) {
    const t0 = 0.5 + rng.next() * 29;
    const dur = 0.8 + rng.next() * 1.5;
    out.layer(t0, t0 + dur, (_x, t) => {
      const ft = t - t0;
      const f = 1200 + rng.next() * 300;
      const mod = 1 + 0.5 * Math.sin(ft * 12 + i * 2);
      const env = ampEnv(ft, 0.02, 0.6) * (0.6 + rng.next() * 0.3);
      return filter.filter(osc.sine(f * mod), 1600, 3.5).bp * env * 0.15;
    });
  }
  out.scale((t) => smoothstep(t, 1.0) * smoothstep(30.0 - t, 1.0));
  return out.data;
}

/** countryside_rooster — rooster crow. 3s event. */
function countrysideRooster(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(3.0);
  const crow = new Osc();
  const filter = new Svf();
  const f0 = 350 + rng.next() * 200;
  out.layer(0, 2.5, (_x, t) => {
    const phrase = Math.floor(t / 0.6);
    const f = f0 * (1 + 0.4 * Math.sin(t * 2.5 + phrase * 2));
    const env = ampEnv(t, 0.05, 0.8) * (0.7 + 0.3 * Math.sin(t * 3));
    return filter.filter(crow.sine(f), 1200, 2.0).bp * env * 0.7;
  });
  // Echo
  out.layer(0.8, 2.5, (_x, t) => {
    const ft = t - 0.8;
    const f = f0 * 0.9;
    const env = ampEnv(ft, 0.1, 1.5) * decay(ft, 1.2) * 0.25;
    return filter.filter(crow.sine(f), 800, 2.5).bp * env * 0.3;
  });
  out.scale((t) => smoothstep(t, 0.2) * smoothstep(3.0 - t, 0.5));
  return out.data;
}

/** farm_animals — cow, sheep, pig sounds. 30s bed. */
function farmAnimals(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(30.0);
  const animal = new Osc();
  const filter = new Svf();
  const animals = [
    { id: "cow", baseF: 180, dur: 1.5, interval: 10, vol: 0.6 },
    { id: "sheep", baseF: 350, dur: 0.6, interval: 5, vol: 0.5 },
    { id: "pig", baseF: 400, dur: 0.4, interval: 7, vol: 0.4 },
  ];
  for (let a = 0; a < animals.length; a++) {
    const an = animals[a];
    for (let i = 0; i < 5; i++) {
      const t0 = 1 + rng.next() * 28;
      const dur = an.dur * (0.7 + rng.next() * 0.6);
      out.layer(t0, t0 + dur, (_x, t) => {
        const ft = t - t0;
        const f = an.baseF * (1 + 0.2 * Math.sin(ft * 4 + a * 3));
        const env = ampEnv(ft, 0.05, dur * 0.7) * an.vol * (0.7 + rng.next() * 0.3);
        return filter.filter(animal.sine(f), an.baseF * 1.5, 1.5).bp * env * 0.4;
      });
    }
  }
  out.scale((t) => smoothstep(t, 1.0) * smoothstep(30.0 - t, 1.0));
  return out.data;
}

/* ------------------------------------------------------------------ */
/*  CITY SOUNDS                                                       */
/* ------------------------------------------------------------------ */

/** city_traffic_dense — heavy traffic bed. 30s. */
function cityTrafficDense(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(30.0);
  const engine = new Osc();
  const filter = new Svf();
  const tire = () => wht(rng);
  const tireFilter = new Svf();
  const ph = [0, 0].map(() => rng.next() * Math.PI * 2);
  out.layer(0, 30.0, (_x, t) => {
    let raw = 1.0;
    raw += 0.2 * Math.sin(2 * Math.PI * 0.08 * t + ph[0]);
    raw += 0.15 * Math.sin(2 * Math.PI * 0.15 * t + ph[1]);
    const g = glide(Math.max(0.5, Math.min(1.4, raw)), { y: 1 }, 800);
    const eng = filter.filter(engine.sine(80 + 40 * Math.sin(t * 0.5)), 100 + 150 * g, 1.5).lp * g * 0.45;
    const tir = tireFilter.filter(tire(), 500 + 600 * g, 2.5).lp * g * 0.12;
    return eng + tir;
  }, () => engine.sine(80));
  out.scale((t) => smoothstep(t, 1.0) * smoothstep(30.0 - t, 1.0));
  return out.data;
}

/** city_crowd — pedestrian crowd murmur. 30s bed. */
function cityCrowd(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(30.0);
  const murmur = () => wht(rng);
  const filter = new Svf();
  const formants = [500, 900, 1500, 2200];
  out.layer(0, 30.0, (_x, t) => {
    let raw = 0;
    for (let i = 0; i < 4; i++) {
      raw += Math.sin(2 * Math.PI * formants[i] * 0.001 * t + i * 1.5) * 0.25;
    }
    const env = 0.15 + 0.1 * Math.sin(t * 0.15) + 0.05 * Math.sin(t * 0.4);
    return filter.filter(murmur(), 250 + 1200 * env, 3.0).lp * env * 0.3;
  }, murmur);
  out.scale((t) => smoothstep(t, 1.0) * smoothstep(30.0 - t, 1.0));
  return out.data;
}

/** city_siren — emergency siren. 4s event. */
function citySiren(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(4.0);
  const siren = new Osc();
  const filter = new Svf();
  const f0 = 400 + rng.next() * 300;
  out.layer(0, 3.5, (_x, t) => {
    const f = f0 + 600 * Math.sin(2 * Math.PI * 0.8 * t);
    const env = ampEnv(t, 0.1, 1.5) * (0.8 + 0.2 * Math.sin(t * 2));
    return filter.filter(siren.sine(f), f * 1.2, 2.0).bp * env * 0.9;
  });
  out.scale((t) => smoothstep(t, 0.2) * smoothstep(4.0 - t, 0.5));
  return out.data;
}

/** city_construction — jackhammer, drill. 30s bed. */
function cityConstruction(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(30.0);
  const hammer = new Osc();
  const filter = new Svf();
  const impact = () => wht(rng);
  out.layer(0, 30.0, (_x, t) => {
    const rate = 8 + 4 * Math.sin(t * 0.5);
    const beat = Math.floor(t * rate) / rate;
    const env = ampEnv(t - beat, 0.001, 0.06) * (0.6 + 0.4 * Math.sin(t * 0.3));
    const hit = filter.filter(impact(), 1000, 3.5).lp * env * 0.7;
    const body = filter.filter(hammer.sine(60), 100, 1.8).lp * decay(t - beat, 0.15) * 0.25;
    return hit + body;
  }, impact);
  out.scale((t) => smoothstep(t, 1.0) * smoothstep(30.0 - t, 1.0));
  return out.data;
}

/** city_metro — subway rumble, brakes. 30s bed. */
function cityMetro(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(30.0);
  const rumble = new Osc();
  const brake = new Svf();
  const air = () => wht(rng);
  out.layer(0, 30.0, (_x, t) => {
    const base = rumble.sine(35) * decay(t % 8, 2) * 0.2;
    const pass = (Math.sin(t * 0.4) > 0.7) ? 1 : 0;
    const brakeSnd = pass * brake.filter(air(), 1000 - 700 * Math.sin(t * 2), 3.0).lp * ampEnv(t % 8, 0.2, 1.5) * 0.35;
    return base + brakeSnd;
  }, air);
  out.scale((t) => smoothstep(t, 1.0) * smoothstep(30.0 - t, 1.0));
  return out.data;
}

/** city_horn — car horn blasts. 2s event. */
function cityHorn(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(2.0);
  const horn = new Osc();
  const filter = new Svf();
  const f1 = 420 + rng.next() * 80;
  const f2 = 520 + rng.next() * 100;
  out.layer(0, 0.8, (_x, t) => {
    const env = ampEnv(t, 0.02, 0.35);
    return filter.filter(horn.sine(f1), 800, 2.0).bp * env * 0.7;
  });
  out.layer(0.9, 1.6, (_x, t) => {
    const ft = t - 0.9;
    const env = ampEnv(ft, 0.02, 0.3);
    return filter.filter(horn.sine(f2), 1000, 2.0).bp * env * 0.6;
  });
  out.scale((t) => smoothstep(t, 0.1) * smoothstep(2.0 - t, 0.3));
  return out.data;
}

/* ------------------------------------------------------------------ */
/*  INTERIOR SOUNDS                                                   */
/* ------------------------------------------------------------------ */

/** interior_room_tone — HVAC, subtle hum. 30s bed. */
function interiorRoomTone(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(30.0);
  const hum = new Osc();
  const filter = new Svf();
  out.layer(0, 30.0, (_x, t) => {
    const wob = 1 + 0.02 * Math.sin(t * 0.15);
    return filter.filter(hum.sine(55 * wob), 80, 3.0).lp * 0.12;
  });
  // Occasional duct rattle
  const rattle = new Osc();
  for (let i = 0; i < 5; i++) {
    const t0 = 3 + rng.next() * 24;
    out.layer(t0, t0 + 2, (_x, t) => {
      const ft = t - t0;
      return filter.filter(rattle.sine(40 + 30 * Math.sin((t - t0) * 8)), 60, 2.0).lp * ampEnv(ft, 0.1, 0.5) * 0.08;
    });
  }
  out.scale((t) => smoothstep(t, 1.0) * smoothstep(30.0 - t, 1.0));
  return out.data;
}

/** interior_footsteps — footsteps on wood/tile. 2s event. */
function interiorFootsteps(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(2.0);
  const step = () => wht(rng);
  const filter = new Svf();
  for (let i = 0; i < 6; i++) {
    const t0 = i * 0.32 + rng.next() * 0.08;
    out.layer(t0, t0 + 0.15, (_x, t) => {
      const ft = t - t0;
      return filter.filter(step(), 300 + 2000 * Math.exp(-ft / 0.05), 2.0).bp * ampEnv(ft, 0.002, 0.08) * 0.6;
    });
  }
  out.scale((t) => smoothstep(t, 0.1) * smoothstep(2.0 - t, 0.2));
  return out.data;
}

/** interior_door_creak — old door opening. 1.5s event. */
function interiorDoorCreak(seed: number): Float32Array {
  const out = new Buf(1.5);
  const creak = new Osc();
  const filter = new Svf();
  out.layer(0, 1.2, (_x, t) => {
    const f = 180 + 120 * Math.exp(-t / 0.4);
    const env = ampEnv(t, 0.05, 0.6) * (1 - t / 1.2);
    return filter.filter(creak.sine(f), 300, 2.5).bp * env * 0.5;
  });
  out.scale((t) => smoothstep(t, 0.1) * smoothstep(1.5 - t, 0.3));
  return out.data;
}

/** interior_clock_tick — wall clock. 30s bed. */
function interiorClockTick(seed: number): Float32Array {
  const out = new Buf(30.0);
  const tick = new Osc();
  const filter = new Svf();
  out.layer(0, 30.0, (_x, t) => {
    const beat = Math.floor(t);
    const ft = t - beat;
    if (ft > 0.05) return 0;
    return filter.filter(tick.sine(800), 2000, 3.0).bp * ampEnv(ft, 0.001, 0.03) * 0.5;
  });
  out.scale((t) => smoothstep(t, 1.0) * smoothstep(30.0 - t, 1.0));
  return out.data;
}

/* ------------------------------------------------------------------ */
/*  SPACE SOUNDS                                                      */
/* ------------------------------------------------------------------ */

/** space_cosmic_wind — solar wind, solar flares. 30s bed. */
function spaceCosmicWind(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(30.0);
  const solar = () => wht(rng);
  const filter = new Svf();
  const ph = [0, 0, 0].map(() => rng.next() * Math.PI * 2);
  const flare = { y: 1.0 };
  out.layer(0, 30.0, (_x, t) => {
    let raw = 1.0;
    raw += 0.4 * Math.sin(2 * Math.PI * 0.02 * t + ph[0]);
    raw += 0.3 * Math.sin(2 * Math.PI * 0.05 * t + ph[1]);
    raw += 0.2 * Math.sin(2 * Math.PI * 0.12 * t + ph[2]);
    const g = glide(Math.max(0.3, Math.min(2.0, raw)), flare, 300);
    return filter.filter(solar(), 80 + 500 * g, 2.0).lp * g * 0.28;
  }, solar);
  out.scale((t) => smoothstep(t, 2.0) * smoothstep(30.0 - t, 2.0));
  return out.data;
}

/** space_ship_engine — ship engine hum. 30s bed. */
function spaceShipEngine(seed: number): Float32Array {
  const out = new Buf(30.0);
  const engine = new Osc();
  const filter = new Svf();
  out.layer(0, 30.0, (_x, t) => {
    const f0 = 45 + 5 * Math.sin(t * 0.08);
    const harm2 = 0.3 * Math.sin(2 * Math.PI * 90 * t + 1.2);
    const harm3 = 0.15 * Math.sin(2 * Math.PI * 135 * t + 2.4);
    const wob = 1 + 0.05 * Math.sin(t * 0.12);
    return filter.filter(engine.sine(f0 * wob) + harm2 + harm3, 80 + 200 * Math.sin(t * 0.15), 2.5).lp * (0.4 + 0.1 * Math.sin(t * 0.08));
  });
  out.scale((t) => smoothstep(t, 1.0) * smoothstep(30.0 - t, 1.0));
  return out.data;
}

/** space_whoosh — ship flyby. 3s event. */
function spaceWhoosh(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(3.0);
  const whoosh = new Svf();
  const cut = { y: 800 };
  out.layer(0, 3.0, (_x, t) => {
    const fc = glide(60 + 1800 * Math.exp(-t / 1.2), cut, 200);
    const env = smoothstep(t, 0.3) * decay(t, 1.5);
    return whoosh.filter(wht(rng), fc, 2.0).bp * env * 0.55;
  }, () => wht(rng));
  out.scale((t) => smoothstep(t, 0.1) * smoothstep(3.0 - t, 0.3));
  return out.data;
}

/** space_radio — radio chatter, static. 30s bed. */
function spaceRadio(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Buf(30.0);
  const ph = [0, 0, 0].map(() => rng.next() * Math.PI * 2);
  out.layer(0, 30.0, (_x, t) => {
    // Low-frequency radio carrier + voice-like modulation
    const carrier = Math.sin(2 * Math.PI * 300 * t) * 0.1;
    const voice =
      Math.sin(2 * Math.PI * (250 + 50 * Math.sin(t * 0.3)) * t + ph[0]) * 0.2 +
      Math.sin(2 * Math.PI * (400 + 30 * Math.sin(t * 0.5)) * t + ph[1]) * 0.15;
    const vEnv = 0.3 + 0.3 * Math.sin(t * 0.07);
    return carrier + voice * vEnv;
  });
  out.scale((t) => smoothstep(t, 1.0) * smoothstep(30.0 - t, 1.0));
  return out.data;
}

/* ------------------------------------------------------------------ */
/*  MUSIC / BACKGROUND TRACKS PER WORLD                               */
/* ------------------------------------------------------------------ */

/** music_ocean_ambient — peaceful ocean ambient. 60s loop. */
function musicOceanAmbient(seed: number): Float32Array {
  const out = new Buf(60.0);
  const pad = new Osc();
  const filter = new Svf();
  const chords = [
    [174.61, 220.00, 261.63], // F3, A3, C4
    [196.00, 246.94, 293.66], // G3, B3, D4
    [146.83, 196.00, 220.00], // D3, G3, A3
    [130.81, 174.61, 220.00], // C3, F3, A3
  ];
  const chordDur = 15.0;
  for (let c = 0; c < 4; c++) {
    const t0 = c * chordDur;
    const chord = chords[c];
    out.layer(t0, t0 + chordDur, (_x, t) => {
      const ft = t - t0;
      const env = smoothstep(ft, 2.0) * smoothstep(chordDur - ft, 2.0);
      let sum = 0;
      for (const f of chord) {
        sum += pad.sine(f) * 0.25;
      }
      return filter.filter(sum, 1200, 2.0).lp * env * 0.25;
    });
  }
  out.scale((t) => smoothstep(t, 3.0) * smoothstep(60.0 - t, 3.0));
  return out.data;
}

/** music_forest_ambient — mystical forest ambient. 60s loop. */
function musicForestAmbient(seed: number): Float32Array {
  const out = new Buf(60.0);
  const pad = new Osc();
  const filter = new Svf();
  const chords = [
    [138.59, 185.00, 220.00], // C#3, F#3, A3
    [123.47, 164.81, 207.65], // B2, E3, G#3
    [110.00, 146.83, 185.00], // A2, D3, F#3
    [146.83, 196.00, 246.94], // D3, G3, B3
  ];
  for (let c = 0; c < 4; c++) {
    const t0 = c * 15.0;
    const chord = chords[c];
    out.layer(t0, t0 + 15.0, (_x, t) => {
      const ft = t - t0;
      const env = smoothstep(ft, 2.0) * smoothstep(15.0 - ft, 2.0);
      let sum = 0;
      for (const f of chord) {
        sum += pad.sine(f) * 0.2;
      }
      sum += pad.sine(chord[0] * 0.5) * 0.15; // sub
      return filter.filter(sum, 800, 2.5).lp * env * 0.2;
    });
  }
  out.scale((t) => smoothstep(t, 3.0) * smoothstep(60.0 - t, 3.0));
  return out.data;
}

/** music_countryside_ambient — pastoral folk ambient. 60s loop. */
function musicCountrysideAmbient(seed: number): Float32Array {
  const out = new Buf(60.0);
  const guitar = new Osc();
  const bass = new Osc();
  const filter = new Svf();
  const chords = [
    [196.00, 246.94, 293.66], // G3, B3, D4
    [146.83, 196.00, 246.94], // D3, G3, B3
    [130.81, 174.61, 220.00], // C3, F3, A3
    [174.61, 220.00, 261.63], // F3, A3, C4
  ];
  for (let c = 0; c < 4; c++) {
    const t0 = c * 15.0;
    const chord = chords[c];
    out.layer(t0, t0 + 15.0, (_x, t) => {
      const ft = t - t0;
      const pick = 0.5 + 0.5 * Math.sin(ft * 8);
      const env = smoothstep(ft, 1.5) * smoothstep(15.0 - ft, 2.0);
      let sum = 0;
      for (const f of chord) {
        sum += guitar.sine(f) * 0.18 * pick;
      }
      sum += bass.sine(chord[0] * 0.5) * 0.35; // strong bass
      return filter.filter(sum, 800, 3.5).lp * env * 0.32;
    });
  }
  out.scale((t) => smoothstep(t, 2.0) * smoothstep(60.0 - t, 2.0));
  return out.data;
}

/** music_cinematic_tension — slow building tension. 60s loop. */
function musicCinematicTension(seed: number): Float32Array {
  const out = new Buf(60.0);
  const drone = new Osc();
  const pulse = new Osc();
  const filter = new Svf();
  out.layer(0, 60.0, (_x, t) => {
    const droneSnd = drone.sine(55) * 0.3 + drone.sine(110) * 0.15;
    const pulseSnd = pulse.sine(1.2) * ampEnv(t % 8, 0.1, 2.0) * 0.1;
    const swell = 0.3 + 0.7 * smoothstep(t % 20, 10) * (1 - smoothstep((t % 20) - 10, 10));
    return filter.filter(droneSnd + pulseSnd, 200 + 500 * swell, 2.0).lp * swell * 0.35;
  });
  out.scale((t) => smoothstep(t, 3.0) * smoothstep(60.0 - t, 3.0));
  return out.data;
}

/* ================================================================== */
/*  ROLE TABLE — EXPANDED                                             */
/* ================================================================== */
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
  family: "ambient" | "event" | "music";
  tags: string[];
  /** Objective v2 sanity checks: band-share minimums so flat noise can't ship. */
  checks: { low?: number; mid?: number; high?: number; zcrMax?: number };
}

const SEEDS: Record<string, number> = {
  // New ocean sounds
  ocean_waves: 1001,
  ocean_gulls: 1002,
  ocean_ship_horn: 1003,
  ocean_splash: 1004,
  underwater_bubbles: 1005,
  // Forest sounds
  forest_birds: 1101,
  forest_wind_leaves: 1102,
  forest_stream: 1103,
  forest_insects: 1104,
  // Countryside sounds
  countryside_wind: 1201,
  countryside_crickets: 1202,
  countryside_rooster: 1203,
  farm_animals: 1204,
  // City sounds
  city_traffic_dense: 1301,
  city_crowd: 1302,
  city_siren: 1303,
  city_construction: 1304,
  city_metro: 1305,
  city_horn: 1306,
  // Interior sounds
  interior_room_tone: 1401,
  interior_footsteps: 1402,
  interior_door_creak: 1403,
  interior_clock_tick: 1404,
  // Space sounds
  space_cosmic_wind: 1501,
  space_ship_engine: 1502,
  space_whoosh: 1503,
  space_radio: 1504,
  // Music tracks
  music_ocean_ambient: 1601,
  music_forest_ambient: 1602,
  music_countryside_ambient: 1603,
  music_cinematic_tension: 1605,
  // Existing sounds
  whoosh_dissolve: 303,
  rumble_deep: 505,
  clothing_flutter: 909,
  impact_soft_bodies: 202,
  scream_distant: 808,
  wind_city: 606,
  ambient_tense: 707,
  rain_hiss: 818,
  thunder_crack: 919,
  pop_light: 101,
  rise_short: 404,
  street_murmur: 111,
  car_pass: 112,
  horn_distant: 113,
  bike_bell: 114,
  heartbeat_bpm70: 170,
  heartbeat_bpm90: 190,
  heartbeat_bpm110: 210,
  heartbeat_bpm130: 230,
  heartbeat_bpm150: 250,
};

const ROLES: Record<string, RoleDef> = {


  // ============ OCEAN WORLD SOUNDS ============
  ocean_waves: {
    build: oceanWaves,
    dur: 30,
    peak: -18,
    label: "Ocean waves",
    description: "Rolling wave breaks with foam hiss; ambient bed for ocean scenes.",
    family: "ambient",
    tags: ["ambient", "ocean", "waves", "water", "bed", "waves"],
    checks: { high: 0.6, low: 0.05 },
  },
  ocean_gulls: {
    build: oceanGulls,
    dur: 30,
    peak: -14,
    label: "Seagulls",
    description: "Distant seagull calls over the ocean; sparse calls with ocean bed.",
    family: "ambient",
    tags: ["ambient", "ocean", "birds", "gulls", "bed", "coastal"],
    checks: { high: 0.4, zcrMax: 3.0 },
  },
  ocean_ship_horn: {
    build: oceanShipHorn,
    dur: 8,
    peak: -4,
    label: "Ship horn",
    description: "Deep foghorn blast with echo; maritime event.",
    family: "event",
    tags: ["ship", "horn", "foghorn", "maritime", "event"],
    checks: { low: 0.4 },
  },
  ocean_splash: {
    build: oceanSplash,
    dur: 1.5,
    peak: -3,
    label: "Ocean splash",
    description: "Water splash impact with droplets; wave impact event.",
    family: "event",
    tags: ["splash", "water", "ocean", "impact", "event"],
    checks: { high: 0.5 },
  },
  underwater_bubbles: {
    build: underwaterBubbles,
    dur: 30,
    peak: -28,
    label: "Underwater bubbles",
    description: "Gentle bubble stream; underwater ambient bed.",
    family: "ambient",
    tags: ["ambient", "underwater", "bubbles", "water", "bed"],
    checks: { high: 0.3, low: 0.05 },
  },

  // ============ FOREST WORLD SOUNDS ============
  forest_birds: {
    build: forestBirds,
    dur: 30,
    peak: -12,
    label: "Forest birds",
    description: "Diverse bird chorus with warblers, thrushes, finches; forest ambient bed.",
    family: "ambient",
    tags: ["ambient", "forest", "birds", "birds", "bed", "nature"],
    checks: { high: 0.5, zcrMax: 4.0 },
  },
  forest_wind_leaves: {
    build: forestWindLeaves,
    dur: 30,
    peak: -10,
    label: "Forest wind",
    description: "Wind through canopy with leaf rustle; forest ambient bed.",
    family: "ambient",
    tags: ["ambient", "forest", "wind", "leaves", "bed", "nature"],
    checks: { high: 0.35, zcrMax: 2.5 },
  },
  forest_stream: {
    build: forestStream,
    dur: 30,
    peak: -20,
    label: "Forest stream",
    description: "Babbling brook with gentle water flow; forest water bed.",
    family: "ambient",
    tags: ["ambient", "forest", "stream", "water", "brook", "bed"],
    checks: { high: 0.45, low: 0.1 },
  },
  forest_insects: {
    build: forestInsects,
    dur: 30,
    peak: -16,
    label: "Forest insects",
    description: "Crickets, cicadas, katydids; night forest ambient bed.",
    family: "ambient",
    tags: ["ambient", "forest", "insects", "crickets", "cicadas", "night", "bed"],
    checks: { high: 0.95, zcrMax: 5.0 },
  },

  // ============ COUNTRYSIDE SOUNDS ============
  countryside_wind: {
    build: countrysideWind,
    dur: 30,
    peak: -8,
    label: "Countryside wind",
    description: "Open field wind with grass rustle; pastoral ambient bed.",
    family: "ambient",
    tags: ["ambient", "countryside", "wind", "fields", "bed", "pastoral"],
    checks: { high: 0.3, zcrMax: 2.0 },
  },
  countryside_crickets: {
    build: countrysideCrickets,
    dur: 30,
    peak: -14,
    label: "Countryside crickets",
    description: "Evening crickets in open fields; pastoral night bed.",
    family: "ambient",
    tags: ["ambient", "countryside", "crickets", "night", "bed", "evening"],
    checks: { high: 0.5, zcrMax: 4.0 },
  },
  countryside_rooster: {
    build: countrysideRooster,
    dur: 3,
    peak: -2,
    label: "Rooster crow",
    description: "Morning rooster crow with echo; farm event.",
    family: "event",
    tags: ["rooster", "farm", "morning", "event", "crow"],
    checks: { low: 0.3 },
  },
  farm_animals: {
    build: farmAnimals,
    dur: 30,
    peak: -12,
    label: "Farm animals",
    description: "Cows, sheep, pigs; farm ambient bed with animal calls.",
    family: "ambient",
    tags: ["ambient", "farm", "animals", "cow", "sheep", "pig", "bed"],
    checks: { low: 0.35, zcrMax: 2.0 },
  },

  // ============ CITY SOUNDS ============
  city_traffic_dense: {
    build: cityTrafficDense,
    dur: 30,
    peak: -8,
    label: "City traffic",
    description: "Heavy traffic with engines and tires; dense city bed.",
    family: "ambient",
    tags: ["ambient", "city", "traffic", "cars", "bed", "urban"],
    checks: { low: 0.3, zcrMax: 2.5 },
  },
  city_crowd: {
    build: cityCrowd,
    dur: 30,
    peak: -16,
    label: "City crowd",
    description: "Pedestrian crowd murmur with distant voices; urban bed.",
    family: "ambient",
    tags: ["ambient", "city", "crowd", "people", "bed", "urban", "murmur"],
    checks: { high: 0.3, zcrMax: 3.0 },
  },
  city_siren: {
    build: citySiren,
    dur: 4,
    peak: -4,
    label: "Emergency siren",
    description: "Emergency vehicle siren wail; urban event.",
    family: "event",
    tags: ["siren", "emergency", "police", "ambulance", "event", "urban"],
    checks: { high: 0.5, low: 0.3 },
  },
  city_construction: {
    build: cityConstruction,
    dur: 30,
    peak: -5,
    label: "Construction site",
    description: "Jackhammer and drill impacts; construction bed.",
    family: "ambient",
    tags: ["ambient", "construction", "jackhammer", "drill", "bed", "urban"],
    checks: { high: 0.4, zcrMax: 3.5 },
  },
  city_metro: {
    build: cityMetro,
    dur: 30,
    peak: -10,
    label: "Metro subway",
    description: "Subway rumble with brake screeches; underground transit bed.",
    family: "ambient",
    tags: ["ambient", "metro", "subway", "train", "rumble", "bed", "underground"],
    checks: { low: 0.4, zcrMax: 2.0 },
  },
  city_horn: {
    build: cityHorn,
    dur: 2,
    peak: -3,
    label: "Car horn",
    description: "Two-tone car horn blast; traffic event.",
    family: "event",
    tags: ["horn", "car", "traffic", "event", "urban"],
    checks: { high: 0.3 },
  },

  // ============ INTERIOR SOUNDS ============
  interior_room_tone: {
    build: interiorRoomTone,
    dur: 30,
    peak: -30,
    label: "Room tone",
    description: "HVAC hum with subtle duct rattle; quiet room bed.",
    family: "ambient",
    tags: ["ambient", "interior", "room", "hvac", "bed", "quiet", "room"],
    checks: { low: 0.8, zcrMax: 0.5 },
  },
  interior_footsteps: {
    build: interiorFootsteps,
    dur: 2,
    peak: -6,
    label: "Footsteps",
    description: "Footsteps on wood or tile floor; interior event.",
    family: "event",
    tags: ["footsteps", "interior", "wood", "tile", "event", "movement"],
    checks: { zcrMax: 4.0 },
  },
  interior_door_creak: {
    build: interiorDoorCreak,
    dur: 1.5,
    peak: -4,
    label: "Door creak",
    description: "Old door opening creak; interior event.",
    family: "event",
    tags: ["door", "creak", "interior", "event", "door"],
    checks: { low: 0.2 },
  },
  interior_clock_tick: {
    build: interiorClockTick,
    dur: 30,
    peak: -22,
    label: "Clock tick",
    description: "Wall clock ticking; quiet interior bed.",
    family: "ambient",
    tags: ["ambient", "interior", "clock", "tick", "bed", "quiet", "time"],
    checks: { zcrMax: 2.0 },
  },

  // ============ SPACE SOUNDS ============
  space_cosmic_wind: {
    build: spaceCosmicWind,
    dur: 30,
    peak: -12,
    label: "Cosmic wind",
    description: "Solar wind with solar flares; deep space ambient bed.",
    family: "ambient",
    tags: ["ambient", "space", "cosmic", "solar", "wind", "bed", "deep space"],
    checks: { high: 0.4, low: 0.1 },
  },
  space_ship_engine: {
    build: spaceShipEngine,
    dur: 30,
    peak: -10,
    label: "Ship engine",
    description: "Spaceship engine hum with harmonics; sci-fi bed.",
    family: "ambient",
    tags: ["ambient", "space", "ship", "engine", "sci-fi", "bed", "vehicle"],
    checks: { low: 0.35, zcrMax: 1.5 },
  },
  space_whoosh: {
    build: spaceWhoosh,
    dur: 3,
    peak: -4,
    label: "Ship flyby",
    description: "Spaceship flyby whoosh; sci-fi event.",
    family: "event",
    tags: ["whoosh", "space", "ship", "flyby", "event", "sci-fi"],
    checks: { high: 0.5 },
  },
  space_radio: {
    build: spaceRadio,
    dur: 30,
    peak: -18,
    label: "Space radio",
    description: "Radio chatter with static; comms bed.",
    family: "ambient",
    tags: ["ambient", "space", "radio", "comms", "static", "bed", "sci-fi"],
    checks: { high: 0.25, zcrMax: 2.0 },
  },

  // ============ MUSIC / BACKGROUND TRACKS ============
  music_ocean_ambient: {
    build: musicOceanAmbient,
    dur: 60,
    peak: -14,
    label: "Ocean ambient music",
    description: "Peaceful ocean ambient music with slow chord progression; 60s loop.",
    family: "music",
    tags: ["music", "ocean", "ambient", "peaceful", "loop", "background"],
    checks: { low: 0.2, zcrMax: 1.0 },
  },
  music_forest_ambient: {
    build: musicForestAmbient,
    dur: 60,
    peak: -14,
    label: "Forest ambient music",
    description: "Mystical forest ambient music with slow chord progression; 60s loop.",
    family: "music",
    tags: ["music", "forest", "ambient", "mystical", "loop", "background"],
    checks: { low: 0.2, zcrMax: 1.0 },
  },
  music_countryside_ambient: {
    build: musicCountrysideAmbient,
    dur: 60,
    peak: -14,
    label: "Countryside ambient music",
    description: "Pastoral folk ambient music with guitar picks; 60s loop.",
    family: "music",
    tags: ["music", "countryside", "ambient", "pastoral", "folk", "loop", "background"],
    checks: { low: 0.2, zcrMax: 1.0 },
  },
  music_cinematic_tension: {
    build: musicCinematicTension,
    dur: 60,
    peak: -10,
    label: "Cinematic tension music",
    description: "Slow building cinematic tension with drone and pulse; 60s loop.",
    family: "music",
    tags: ["music", "cinematic", "tension", "drone", "pulse", "loop", "background"],
    checks: { low: 0.3, zcrMax: 1.0 },
  },

  // Existing roles below...
  street_murmur: {
    build: streetMurmur,
    dur: 30,
    peak: -9,
    label: "Street-life bed — crowd chatter",
    description: "Babbling voices + distant traffic bed with two far horn chirps. No white hiss.",
    family: "ambient",
    tags: ["ambient", "street", "crowd", "city", "bed", "murmur"],
    checks: { low: 0.2, zcrMax: 0.6 },
  },
  heartbeat_bpm70: {
    build: heartBed(70),
    dur: 30,
    peak: -11,
    label: "Heartbeat bed — 70 BPM (calm)",
    description: "Chesty lub-dub thumps at a resting pace; StatHud PULSE bed.",
    family: "ambient",
    tags: ["ambient", "heartbeat", "body", "bed", "calm"],
    checks: { low: 0.55 },
  },
  heartbeat_bpm90: {
    build: heartBed(90),
    dur: 30,
    peak: -11,
    label: "Heartbeat bed — 90 BPM (alert)",
    description: "Chesty lub-dub thumps ramping up; StatHud PULSE bed.",
    family: "ambient",
    tags: ["ambient", "heartbeat", "body", "bed"],
    checks: { low: 0.55 },
  },
  heartbeat_bpm110: {
    build: heartBed(110),
    dur: 30,
    peak: -11,
    label: "Heartbeat bed — 110 BPM (racing)",
    description: "Chesty lub-dub thumps, noticeably faster; StatHud PULSE bed.",
    family: "ambient",
    tags: ["ambient", "heartbeat", "body", "bed", "race"],
    checks: { low: 0.55 },
  },
  heartbeat_bpm130: {
    build: heartBed(130),
    dur: 30,
    peak: -11,
    label: "Heartbeat bed — 130 BPM (excited)",
    description: "Chesty lub-dub thumps at an excited pace; StatHud PULSE bed.",
    family: "ambient",
    tags: ["ambient", "heartbeat", "body", "bed", "excited"],
    checks: { low: 0.55 },
  },
  heartbeat_bpm150: {
    build: heartBed(150),
    dur: 30,
    peak: -11,
    label: "Heartbeat bed — 150 BPM (max)",
    description: "Chesty lub-dub thumps near max pace; StatHud PULSE bed.",
    family: "ambient",
    tags: ["ambient", "heartbeat", "body", "bed", "max"],
    checks: { low: 0.55 },
  },
  car_pass: {
    build: carPass,
    dur: 2.6,
    peak: -8,
    label: "Car pass-by",
    description: "Rolling engine body with a doppler rise-fall, no static wall.",
    family: "event",
    tags: ["car", "traffic", "pass", "doppler", "street"],
    checks: { low: 0.35 },
  },
  horn_distant: {
    build: hornDistant,
    dur: 1.2,
    peak: -10,
    label: "Distant horn",
    description: "Two-tone horn, far away with a soft echo.",
    family: "event",
    tags: ["horn", "traffic", "distant", "street"],
    checks: { low: 0.3 },
  },
  bike_bell: {
    build: bikeBell,
    dur: 1.0,
    peak: -10,
    label: "Bicycle bell",
    description: "Two bright bell pings cutting through the street.",
    family: "event",
    tags: ["bell", "bike", "street", "ping"],
    checks: { zcrMax: 6.5 },
  },
  wind_city: {
    build: windCity,
    dur: 30,
    peak: -6,
    label: "City ambience — gusts",
    description: "Slow gusty air with a low-mid body. Ambient bed; no white hiss.",
    family: "ambient",
    tags: ["ambient", "wind", "city", "bed"],
    checks: { high: 0.28, zcrMax: 2.0 },
  },
  ambient_tense: {
    build: ambientTense,
    dur: 30,
    peak: -8,
    label: "Tension drone bed",
    description: "Detuned low drone with a soft sub pulse and creeping air.",
    family: "ambient",
    tags: ["ambient", "tense", "bed"],
    checks: { low: 0.4, zcrMax: 1.0 },
  },
  rain_hiss: {
    build: rainHiss,
    dur: 30,
    peak: -24,
    label: "Rain hiss",
    description: "Steady mid-high rainfall hiss with slow gust undulation; ambient bed for rainy scenes.",
    family: "ambient",
    tags: ["ambient", "rain", "weather", "bed", "hiss"],
    checks: { high: 0.95, low: 0 },
  },
  thunder_crack: {
    build: thunderCrack,
    dur: 2.5,
    peak: -5,
    label: "Thunder crack",
    description: "Low sub thump followed by a high crack and a rolling tail; storm one-shot.",
    family: "event",
    tags: ["thunder", "weather", "storm", "crack"],
    checks: { low: 0.3 },
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



