/**
 * src/world/vfx/families.ts
 *
 * The six effect families (docs/factory/21-vfx-effekseer.md §6.2), each a
 * preset of the closed-form emitter (emitter.ts): a few parts, and a flash
 * light where it fits (one point light whose intensity is a closed-form
 * curve of the effect's time, `flashIntensity`). Stylized low-poly: puffs
 * and chunks are faceted meshes lit by the world, fire is a toon flipbook,
 * glows and sparks are additive.
 *
 *  - explosion: a flash, a toon fireball (faceted puffs on a stepped ramp,
 *    white to yellow to orange to charcoal), smoke, chunks that land and
 *    bounce, sparks, a ground shock ring; an orange flash light. One-shot.
 *  - fire: flame cards (the flame flipbook, looping), a warm halo, embers,
 *    a thin smoke; a flickering light. A loop.
 *  - smoke: a rising, drifting column of faceted puffs ("dust": low and
 *    pale). A loop.
 *  - sparks: a fountain of stretched sparks with a glint at the source; a
 *    flickering light. A loop (a short duration gives a burst).
 *  - impact: a puff ring spreading over the ground, debris, a shock ring,
 *    a small flash. One-shot.
 *  - magic: a glow burst, three rings, orbiting sparkles and rising motes;
 *    a coloured light pulse. One-shot.
 *
 * A palette swaps a family's colours (and for smoke's "dust" its motion
 * too), so the director can vary an effect through data (21 §4). Every
 * number here is a uniform: tune them on the preview's stills.
 */
import { curve, emitter, flat, loopCount, ramp, type EmitterParams } from "./emitter";
import { GLOW_CELL, SHEET_GRID } from "./flipbook";

export const VFX_FAMILIES = ["explosion", "fire", "smoke", "sparks", "impact", "magic"] as const;
export type VfxFamily = (typeof VFX_FAMILIES)[number];

/** Each family's palettes; the first is the default. */
export const VFX_PALETTES: Record<VfxFamily, readonly string[]> = {
  explosion: ["fire", "plasma", "toxic"],
  fire: ["fire", "gas", "witch"],
  smoke: ["grey", "black", "white", "dust"],
  sparks: ["gold", "electric", "red"],
  impact: ["dust", "stone", "snow"],
  magic: ["arcane", "frost", "nature", "gold"],
};

/** The flash light of an effect (a point light; none when null). */
export interface FlashLight {
  colour: string;
  /** Candela at the peak (three's physically based units), at scale 1. */
  peak: number;
  /** The light reaches nothing past this, metres at scale 1. */
  range: number;
  /** Its height over the effect's spot, metres at scale 1. */
  lift: number;
  /** One-shot: up over `attack`, then down to nothing over `decay`, seconds. */
  attack: number;
  decay: number;
  /** A loop's light: held while the effect emits (in and out over `fade` s), with a flicker of this share. */
  hold: boolean;
  flicker: number;
  fade: number;
}

export interface FamilyPreset {
  family: VfxFamily;
  palette: string;
  parts: EmitterParams[];
  light: FlashLight | null;
  /** A loop emits for its duration; a one-shot plays once. */
  loop: boolean;
  /** A one-shot's length, or a loop's default emitting time, seconds. */
  length: number;
  /** How long after a loop stops its last particles live, seconds. */
  tail: number;
  /** Everything stays within this of the spot, metres at scale 1 (the bounding sphere). */
  reach: number;
  /** A warm loop starts this far into its clock (already burning). */
  warmup: number;
}

const G = -9.8;
const PI = Math.PI;

/** A loop part's pool from its rate and longest life. */
const looped = (p: Partial<EmitterParams> & { rate: number; life: [number, number] }): EmitterParams => emitter({ ...p, loop: true, count: loopCount(p.rate, p.life[1]) });

/* ------------------------------------------------------------------ */
/*  Explosion                                                            */
/* ------------------------------------------------------------------ */

const EXPLOSION_COLOURS: Record<string, { hot: [string, string, string]; smoke: [string, string]; spark: string; light: string }> = {
  fire: { hot: ["#fff3b0", "#ffbe2e", "#f45d1c"], smoke: ["#4a4340", "#77716c"], spark: "#ffcf6a", light: "#ffae5c" },
  plasma: { hot: ["#f2f6ff", "#8fd0ff", "#4a6cff"], smoke: ["#3c4150", "#5e6475"], spark: "#b8e4ff", light: "#8cc8ff" },
  toxic: { hot: ["#f6ffd0", "#c4f25a", "#5fae2e"], smoke: ["#3f4a36", "#5f6b52"], spark: "#e2ff8a", light: "#b6f06a" },
};

function explosion(palette: string): FamilyPreset {
  const c = EXPLOSION_COLOURS[palette] ?? EXPLOSION_COLOURS.fire;
  const flash = emitter({
    name: "flash",
    count: 2,
    life: [0.28, 0.32],
    offset: [0, 1.6, 0],
    size: curve([0, 3], [0.25, 9], [1, 11]),
    sizeJitter: 0.15,
    colour: ramp([[0, c.hot[0]]]),
    alpha: curve([0, 1], [0.35, 0.7], [1, 0]),
    glow: flat(3),
    sheet: "burst",
    frames: SHEET_GRID.burst.frames,
    fps: SHEET_GRID.burst.frames / 0.3,
    flipLoop: false,
  });
  const fireball = emitter({
    name: "fireball",
    count: 24,
    spread: 0.12,
    life: [0.9, 1.4],
    offset: [0, 1.2, 0],
    shape: "ball",
    radius: 0.9,
    core: 0.5,
    cone: PI,
    speed: [5, 10],
    outward: 1,
    accel: [0, 4, 0],
    drag: 3,
    wobble: [0.3, 3],
    spin: [-1.2, 1.2],
    size: curve([0, 0.8], [0.1, 3], [0.45, 4.4], [1, 2]),
    sizeJitter: 0.35,
    colour: ramp([[0, c.hot[0]], [0.14, c.hot[1]], [0.32, c.hot[2]], [0.55, c.smoke[0]]], true),
    glow: curve([0, 3.2], [0.3, 2], [0.5, 0.6], [0.56, 0.15]),
    alpha: curve([0, 1], [0.6, 1], [1, 0.35]),
    render: "mesh",
    material: "lit",
    geometry: "puff",
    lump: 0.14,
  });
  const smoke = emitter({
    name: "smoke",
    count: 30,
    spread: 0.7,
    delay: 0.25,
    life: [2.4, 3.6],
    offset: [0, 1.4, 0],
    shape: "ball",
    radius: 1.6,
    core: 0.5,
    cone: 0.7,
    speed: [2.5, 5.5],
    outward: 0.4,
    accel: [0, 1.8, 0],
    drag: 0.8,
    wind: [0.6, 0, 0.2],
    wobble: [0.5, 1.5],
    spin: [-0.6, 0.6],
    size: curve([0, 0.6], [0.15, 2.6], [0.55, 3.6], [1, 1.6]),
    sizeJitter: 0.3,
    colour: ramp([[0, c.smoke[0]], [0.5, c.smoke[1]], [1, c.smoke[1]]]),
    tint: 0.08,
    glow: flat(0.05),
    alpha: curve([0, 0], [0.06, 1], [0.6, 1], [1, 0.35]),
    render: "mesh",
    material: "lit",
    geometry: "puff",
    lump: 0.16,
  });
  const chunks = emitter({
    name: "chunks",
    count: 22,
    spread: 0.04,
    life: [2.6, 3.4],
    offset: [0, 0.8, 0],
    shape: "ball",
    radius: 0.6,
    cone: 1.15,
    speed: [7, 15],
    outward: 0.5,
    accel: [0, G, 0],
    ground: true,
    bounce: 0.3,
    spin: [4, 10],
    size: curve([0, 0.6], [0.85, 0.6], [1, 0.2]),
    sizeJitter: 0.5,
    colour: ramp([[0, "#ffb347"], [0.06, "#3d3632"], [1, "#3d3632"]], true),
    tint: 0.15,
    glow: curve([0, 1.6], [0.06, 0]),
    alpha: curve([0, 1], [0.85, 1], [1, 0]),
    render: "mesh",
    material: "lit",
    geometry: "chunk",
    squash: 0.45,
  });
  const sparks = emitter({
    name: "sparks",
    count: 60,
    spread: 0.05,
    life: [0.5, 1.2],
    offset: [0, 1.2, 0],
    shape: "ball",
    radius: 0.4,
    cone: 1.4,
    speed: [9, 22],
    outward: 0.7,
    accel: [0, G, 0],
    drag: 1.2,
    ground: true,
    size: curve([0, 0.13], [1, 0.06]),
    stretch: 0.05,
    colour: ramp([[0, "#fffbe0"], [0.4, c.spark], [1, c.hot[2]]]),
    glow: flat(4),
    alpha: curve([0, 1], [0.6, 1], [1, 0]),
    render: "stretched",
    cell: GLOW_CELL.streak,
  });
  const shock = emitter({
    name: "shock",
    count: 1,
    life: [0.45, 0.45],
    offset: [0, 0.08, 0],
    size: curve([0, 1], [0.25, 9], [0.5, 13], [1, 16]),
    colour: ramp([[0, c.hot[0]]]),
    alpha: curve([0, 1], [1, 0]),
    glow: flat(2.5),
    render: "flat",
    cell: GLOW_CELL.ring,
  });
  return {
    family: "explosion",
    palette,
    parts: [smoke, chunks, fireball, shock, sparks, flash],
    light: { colour: c.light, peak: 2400, range: 80, lift: 2, attack: 0.03, decay: 0.75, hold: false, flicker: 0, fade: 0 },
    loop: false,
    length: 4.5,
    tail: 0,
    reach: 28,
    warmup: 0,
  };
}

/* ------------------------------------------------------------------ */
/*  Fire                                                                 */
/* ------------------------------------------------------------------ */

const FIRE_COLOURS: Record<string, { flame: [string, string, string, string]; core: string; ember: string; halo: string; smoke: [string, string]; light: string }> = {
  fire: { flame: ["#ffcc45", "#ff9a2a", "#e5521f", "#b8331a"], core: "#fff1b8", ember: "#ffb347", halo: "#ff7a24", smoke: ["#5a5552", "#8a847f"], light: "#ff9a40" },
  gas: { flame: ["#9fe2ff", "#5aa8ff", "#3a62e8", "#2a3ab0"], core: "#f0fbff", ember: "#a8dcff", halo: "#3f7cff", smoke: ["#3a3c44", "#585b66"], light: "#7fb4ff" },
  witch: { flame: ["#c9ff7a", "#7fe04a", "#3fae3a", "#2a7a3a"], core: "#f4ffd8", ember: "#d4ff8a", halo: "#5fd84a", smoke: ["#383f36", "#566052"], light: "#8fe060" },
};

function fire(palette: string): FamilyPreset {
  const c = FIRE_COLOURS[palette] ?? FIRE_COLOURS.fire;
  const flames = looped({
    name: "flames",
    rate: 14,
    life: [1, 1.4],
    shape: "disc",
    radius: 0.55,
    core: 0.6,
    cone: 0.2,
    speed: [0.6, 1.2],
    accel: [0, 1.5, 0],
    drag: 0.5,
    wobble: [0.12, 6],
    spin: [-0.25, 0.25],
    size: curve([0, 0.4], [0.12, 2], [0.6, 1.6], [1, 0.4]),
    sizeJitter: 0.3,
    colour: ramp([[0, c.flame[0]], [0.4, c.flame[1]], [0.75, c.flame[2]], [1, c.flame[3]]]),
    core3: c.core,
    glow: curve([0, 1.15], [0.5, 1.05], [1, 0.85]),
    alpha: curve([0, 1], [0.55, 1], [0.85, 0.45], [1, 0]),
    material: "card",
    sheet: "flame",
    frames: SHEET_GRID.flame.frames,
    fps: 14,
    flipRandom: true,
    lens: [0.4, 1.6],
  });
  const halo = looped({
    name: "halo",
    rate: 3,
    life: [1.1, 1.3],
    offset: [0, 0.7, 0],
    shape: "disc",
    radius: 0.25,
    cone: 0.1,
    speed: [0.2, 0.4],
    size: curve([0, 1.6], [0.5, 2.6], [1, 1.6]),
    colour: ramp([[0, c.halo]]),
    glow: flat(0.9),
    alpha: curve([0, 0], [0.3, 0.5], [0.7, 0.5], [1, 0]),
  });
  const embers = looped({
    name: "embers",
    rate: 10,
    life: [1.2, 2.2],
    offset: [0, 0.3, 0],
    shape: "disc",
    radius: 0.5,
    cone: 0.35,
    speed: [1.5, 3.2],
    accel: [0, 0.8, 0],
    drag: 0.6,
    wobble: [0.35, 4],
    size: curve([0, 0.07], [0.8, 0.07], [1, 0]),
    colour: ramp([[0, "#ffe07a"], [0.5, c.ember], [1, c.flame[3]]]),
    glow: flat(3),
    alpha: curve([0, 0], [0.1, 1], [0.7, 1], [1, 0]),
  });
  const smoke = looped({
    name: "smoke",
    rate: 4,
    life: [2.5, 3.5],
    offset: [0, 2, 0],
    shape: "disc",
    radius: 0.4,
    cone: 0.25,
    speed: [1.6, 2.4],
    accel: [0, 0.6, 0],
    drag: 0.4,
    wind: [0.5, 0, 0.15],
    wobble: [0.4, 1.2],
    spin: [-0.5, 0.5],
    size: curve([0, 0.5], [0.3, 1.4], [0.75, 2.2], [1, 0.8]),
    sizeJitter: 0.25,
    colour: ramp([[0, c.smoke[0]], [1, c.smoke[1]]]),
    tint: 0.08,
    glow: flat(0.05),
    alpha: curve([0, 0], [0.1, 1], [0.7, 1], [1, 0.35]),
    render: "mesh",
    material: "lit",
    geometry: "puff",
    lump: 0.16,
  });
  return {
    family: "fire",
    palette,
    parts: [smoke, flames, halo, embers],
    light: { colour: c.light, peak: 70, range: 20, lift: 1.5, attack: 0, decay: 0, hold: true, flicker: 0.25, fade: 0.8 },
    loop: true,
    length: 10,
    tail: 4,
    reach: 7,
    warmup: 4,
  };
}

/* ------------------------------------------------------------------ */
/*  Smoke or dust                                                        */
/* ------------------------------------------------------------------ */

const SMOKE_COLOURS: Record<string, [string, string, string]> = {
  grey: ["#7d7873", "#9a958f", "#b2ada7"],
  black: ["#2f2c2a", "#3e3a38", "#55514e"],
  white: ["#d6d3cf", "#e2e0dc", "#eceae7"],
  dust: ["#b3a388", "#c0b197", "#cdbfa6"],
};

function smoke(palette: string): FamilyPreset {
  const c = SMOKE_COLOURS[palette] ?? SMOKE_COLOURS.grey;
  const dust = palette === "dust";
  const puffs = looped({
    name: "puffs",
    rate: dust ? 3.5 : 2.5,
    life: dust ? [3, 4] : [5, 6.5],
    offset: [0, 0.4, 0],
    shape: "disc",
    radius: dust ? 2.2 : 0.8,
    core: 0.6,
    cone: dust ? 1.2 : 0.25,
    speed: dust ? [0.6, 1.4] : [1.6, 2.6],
    outward: dust ? 0.5 : 0,
    accel: [0, dust ? 0.12 : 0.6, 0],
    drag: dust ? 0.6 : 0.3,
    wind: [0.9, 0, 0.3],
    wobble: [0.6, 1.2],
    spin: [-0.5, 0.5],
    size: dust ? curve([0, 0.8], [0.3, 2.6], [0.75, 3.6], [1, 1.6]) : curve([0, 0.8], [0.3, 2.8], [0.75, 4.2], [1, 1.8]),
    sizeJitter: 0.3,
    colour: ramp([[0, c[0]], [0.5, c[1]], [1, c[2]]]),
    tint: 0.08,
    glow: flat(0.05),
    alpha: curve([0, 0], [0.08, 1], [0.7, 1], [1, 0.35]),
    render: "mesh",
    material: "lit",
    geometry: "puff",
    lump: 0.16,
  });
  return { family: "smoke", palette, parts: [puffs], light: null, loop: true, length: 12, tail: dust ? 4 : 6, reach: dust ? 9 : 13, warmup: dust ? 4 : 6 };
}

/* ------------------------------------------------------------------ */
/*  Sparks                                                               */
/* ------------------------------------------------------------------ */

const SPARK_COLOURS: Record<string, { ramp: [string, string, string, string]; glint: string; light: string }> = {
  gold: { ramp: ["#fffbe0", "#ffd060", "#ff8a20", "#c84a10"], glint: "#fff4c8", light: "#ffd890" },
  electric: { ramp: ["#ffffff", "#bfe8ff", "#5ab0ff", "#3050d0"], glint: "#e8f6ff", light: "#a8d8ff" },
  red: { ramp: ["#fff0e0", "#ff9a7a", "#ff4a30", "#a01a10"], glint: "#ffe0d0", light: "#ff9070" },
};

function sparks(palette: string): FamilyPreset {
  const c = SPARK_COLOURS[palette] ?? SPARK_COLOURS.gold;
  const shower = looped({
    name: "sparks",
    rate: 80,
    life: [0.4, 0.9],
    offset: [0, 0.2, 0],
    shape: "ball",
    radius: 0.1,
    cone: 0.5,
    speed: [5, 11],
    accel: [0, G, 0],
    drag: 0.8,
    ground: true,
    size: curve([0, 0.14], [1, 0.08]),
    stretch: 0.06,
    colour: ramp([[0, c.ramp[0]], [0.3, c.ramp[1]], [0.7, c.ramp[2]], [1, c.ramp[3]]]),
    glow: flat(4),
    alpha: curve([0, 0], [0.06, 1], [0.7, 1], [1, 0]),
    render: "stretched",
    cell: GLOW_CELL.streak,
  });
  const glint = looped({
    name: "glint",
    rate: 8,
    life: [0.08, 0.14],
    offset: [0, 0.2, 0],
    size: curve([0, 0.2], [0.3, 1.4], [1, 0]),
    sizeJitter: 0.3,
    spin: [-2, 2],
    colour: ramp([[0, c.glint]]),
    glow: flat(3),
    alpha: flat(1),
    cell: GLOW_CELL.star,
  });
  return {
    family: "sparks",
    palette,
    parts: [shower, glint],
    light: { colour: c.light, peak: 15, range: 12, lift: 1, attack: 0, decay: 0, hold: true, flicker: 0.6, fade: 0.15 },
    loop: true,
    length: 4,
    tail: 1,
    reach: 4,
    warmup: 1,
  };
}

/* ------------------------------------------------------------------ */
/*  Impact                                                               */
/* ------------------------------------------------------------------ */

const IMPACT_COLOURS: Record<string, { dust: [string, string, string]; chips: string }> = {
  dust: { dust: ["#cbbca2", "#c0b097", "#b5a58b"], chips: "#6d655b" },
  stone: { dust: ["#a3a19c", "#93918c", "#85837e"], chips: "#5e5c58" },
  snow: { dust: ["#f2f5f8", "#e6ebf0", "#dce3ea"], chips: "#cfd8e0" },
};

function impact(palette: string): FamilyPreset {
  const c = IMPACT_COLOURS[palette] ?? IMPACT_COLOURS.dust;
  const ring = emitter({
    name: "puffs",
    count: 14,
    spread: 0.03,
    life: [0.9, 1.4],
    offset: [0, 0.15, 0],
    shape: "ring",
    radius: 0.4,
    height: 0.1,
    cone: PI / 2,
    speed: [6, 11],
    outward: 1,
    accel: [0, 0.6, 0],
    drag: 3.5,
    wobble: [0.15, 2],
    spin: [-1, 1],
    size: curve([0, 0.4], [0.3, 1.2], [0.75, 1.5], [1, 0.5]),
    sizeJitter: 0.3,
    colour: ramp([[0, c.dust[0]], [0.5, c.dust[1]], [1, c.dust[2]]]),
    tint: 0.06,
    glow: flat(0.06),
    alpha: curve([0, 1], [0.6, 1], [1, 0.35]),
    render: "mesh",
    material: "lit",
    geometry: "puff",
    lump: 0.14,
  });
  const debris = emitter({
    name: "debris",
    count: 12,
    spread: 0.02,
    life: [1.2, 1.6],
    offset: [0, 0.2, 0],
    shape: "ball",
    radius: 0.2,
    cone: 0.8,
    speed: [3.5, 7.5],
    outward: 0.3,
    accel: [0, G, 0],
    ground: true,
    bounce: 0.25,
    spin: [6, 14],
    size: curve([0, 0.26], [0.85, 0.26], [1, 0.08]),
    sizeJitter: 0.5,
    colour: ramp([[0, c.chips]]),
    tint: 0.15,
    glow: flat(0),
    alpha: curve([0, 1], [0.85, 1], [1, 0]),
    render: "mesh",
    material: "lit",
    geometry: "chunk",
    squash: 0.45,
  });
  const shock = emitter({
    name: "shock",
    count: 1,
    life: [0.3, 0.3],
    offset: [0, 0.06, 0],
    size: curve([0, 0.5], [0.4, 3.6], [1, 5]),
    colour: ramp([[0, "#fff3dc"]]),
    alpha: curve([0, 0.7], [1, 0]),
    glow: flat(1),
    render: "flat",
    cell: GLOW_CELL.ring,
  });
  const flash = emitter({
    name: "flash",
    count: 1,
    life: [0.16, 0.16],
    offset: [0, 0.4, 0],
    size: curve([0, 1.4], [1, 2.6]),
    colour: ramp([[0, "#fff6e0"]]),
    alpha: curve([0, 1], [1, 0]),
    glow: flat(2),
    sheet: "burst",
    frames: SHEET_GRID.burst.frames,
    fps: SHEET_GRID.burst.frames / 0.16,
    flipLoop: false,
  });
  return {
    family: "impact",
    palette,
    parts: [ring, debris, shock, flash],
    light: { colour: "#fff0d8", peak: 220, range: 14, lift: 0.6, attack: 0.02, decay: 0.18, hold: false, flicker: 0, fade: 0 },
    loop: false,
    length: 1.7,
    tail: 0,
    reach: 9,
    warmup: 0,
  };
}

/* ------------------------------------------------------------------ */
/*  Magic or energy                                                      */
/* ------------------------------------------------------------------ */

const MAGIC_COLOURS: Record<string, { ramp: [string, string, string, string]; ring: string; light: string }> = {
  arcane: { ramp: ["#ffffff", "#f3c6ff", "#b46bff", "#6b3bd6"], ring: "#d49bff", light: "#b884ff" },
  frost: { ramp: ["#ffffff", "#d4f6ff", "#7fd8ff", "#3f8ce0"], ring: "#9fe4ff", light: "#8fd8ff" },
  nature: { ramp: ["#ffffff", "#e8ffc4", "#8fe060", "#3f9e4a"], ring: "#b8f080", light: "#a8ec7a" },
  gold: { ramp: ["#ffffff", "#fff0b8", "#ffc848", "#d88a20"], ring: "#ffe08a", light: "#ffd070" },
};

function magic(palette: string): FamilyPreset {
  const c = MAGIC_COLOURS[palette] ?? MAGIC_COLOURS.arcane;
  const burst = emitter({
    name: "burst",
    count: 2,
    life: [0.5, 0.6],
    offset: [0, 1.2, 0],
    size: curve([0, 0.5], [0.2, 4], [1, 5]),
    sizeJitter: 0.1,
    colour: ramp([[0, c.ramp[1]]]),
    alpha: curve([0, 1], [0.2, 0.9], [1, 0]),
    glow: flat(1.8),
  });
  const rings = emitter({
    name: "rings",
    count: 3,
    spread: 0.5,
    ordered: true,
    life: [0.95, 1],
    offset: [0, 0.1, 0],
    size: curve([0, 0.5], [0.5, 7], [1, 9]),
    colour: ramp([[0, c.ring]]),
    alpha: curve([0, 0], [0.1, 1], [0.5, 0.7], [1, 0]),
    glow: flat(3),
    render: "flat",
    cell: GLOW_CELL.ring,
  });
  const halo = emitter({
    name: "halo",
    count: 1,
    delay: 0.05,
    life: [0.6, 0.6],
    offset: [0, 1.2, 0],
    size: curve([0, 0.5], [0.4, 4.5], [1, 6]),
    colour: ramp([[0, c.ring]]),
    alpha: curve([0, 1], [1, 0]),
    glow: flat(2),
    cell: GLOW_CELL.ring,
  });
  const sparkles = emitter({
    name: "sparkles",
    count: 70,
    spread: 0.35,
    life: [1, 1.8],
    offset: [0, 0.3, 0],
    shape: "ring",
    radius: 0.6,
    height: 0.4,
    cone: 0.5,
    speed: [1.5, 4.5],
    outward: 0.5,
    accel: [0, 1.2, 0],
    drag: 1.2,
    orbit: [2.5, 4.5],
    spin: [-3, 3],
    size: curve([0, 0], [0.15, 0.4], [0.7, 0.25], [1, 0]),
    sizeJitter: 0.3,
    colour: ramp([[0, c.ramp[0]], [0.3, c.ramp[1]], [0.7, c.ramp[2]], [1, c.ramp[3]]]),
    glow: flat(3.5),
    alpha: flat(1),
    cell: GLOW_CELL.star,
  });
  const motes = emitter({
    name: "motes",
    count: 40,
    spread: 1.2,
    life: [1.2, 2],
    offset: [0, 0.2, 0],
    shape: "disc",
    radius: 1.8,
    cone: 0.15,
    speed: [0.5, 1.2],
    accel: [0, 0.8, 0],
    wobble: [0.2, 3],
    size: curve([0, 0], [0.2, 0.12], [0.8, 0.1], [1, 0]),
    colour: ramp([[0, c.ramp[1]], [1, c.ramp[2]]]),
    glow: flat(2),
    alpha: flat(1),
  });
  return {
    family: "magic",
    palette,
    parts: [rings, motes, sparkles, halo, burst],
    light: { colour: c.light, peak: 220, range: 30, lift: 1.2, attack: 0.05, decay: 0.9, hold: false, flicker: 0, fade: 0 },
    loop: false,
    length: 3.4,
    tail: 0,
    reach: 10,
    warmup: 0,
  };
}

const BUILD: Record<VfxFamily, (palette: string) => FamilyPreset> = { explosion, fire, smoke, sparks, impact, magic };

/** A family's preset in a palette (an unknown palette: the family's default). */
export function familyPreset(family: VfxFamily, palette?: string): FamilyPreset {
  const list = VFX_PALETTES[family];
  return BUILD[family](palette && list.includes(palette) ? palette : list[0]);
}

const smoothstep = (a: number, b: number, x: number) => {
  if (b <= a) return x >= b ? 1 : 0;
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/**
 * The flash light's intensity (candela, before the effect's scale) at
 * `time` seconds on the effect's clock; `emitFor` is a loop's emitting
 * time. One-shot: up over the attack, down to nothing over the decay
 * (squared, like a flash fading). Held: in and out over `fade`, with a
 * flicker of three sines. 0 before the start and after the end.
 */
export function flashIntensity(f: FlashLight, time: number, emitFor: number): number {
  if (!(time >= 0)) return 0;
  if (!f.hold) {
    if (time < f.attack) return f.peak * smoothstep(0, f.attack, time);
    const u = Math.min(1, (time - f.attack) / Math.max(1e-3, f.decay));
    return f.peak * (1 - u) * (1 - u);
  }
  const env = smoothstep(0, f.fade, time) * (1 - smoothstep(emitFor, emitFor + f.fade, time));
  const flick = 1 + f.flicker * (0.5 * Math.sin(9.1 * time) + 0.3 * Math.sin(13.7 * time + 1.3) + 0.2 * Math.sin(23.3 * time + 2.1));
  return f.peak * env * Math.max(0, flick);
}

/** How long an effect shows anything, seconds on its clock (a loop: its emitting time plus its tail). */
export function effectLength(p: FamilyPreset, emitFor: number): number {
  if (!p.loop) return Math.max(p.length, ...p.parts.map((x) => x.delay + x.spread + x.life[1]));
  return emitFor + Math.max(p.tail, ...p.parts.map((x) => x.delay + x.life[1]));
}
