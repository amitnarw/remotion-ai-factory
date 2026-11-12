/**
 * src/generator/library/capabilities.ts — the registry entries that come
 * from the code's constants: where a story can happen, what people and the
 * world can do, how the camera films, and what goes on screen.
 *
 * The NAMES always come from the code (SceneSchema's kits, PLACES,
 * ACTOR_ACTIONS, STAT_REACTS, WORLD_EVENTS, SHOT_MOVES, ...). The HELP comes
 * from the words the director is already told: the director's inventory
 * (pipeline/director.ts directorInventory, whose KIT_GUIDE, TIME, CAMERA,
 * COUNTER, WORLD EVENTS and SHOTS blocks are read clause by clause), the
 * world block (world/director-context.ts) and the helpers' own help tables
 * (ACTION_HELP, REACT_HELP, KIT_SUBJECTS). Where the code has a name and no
 * words (a shot size "ECU", a transition "whip"), a gloss adds plain words;
 * each gloss is a Record over the code's own union type, so a new size or
 * move that is not glossed fails to compile instead of drifting.
 *
 * Planned capabilities (designed, not built: bullet time, model sets, the
 * graphics layer) and open build requests (build-requests/*.json) are
 * entries too, with status "planned": a need that matches one becomes a
 * build request for that id.
 *
 * Plugs in: registry.ts buildRegistry. Tests: registry.test.ts.
 */
import { CAMERA_STYLES, HERO_PROP_STYLES, SPACE_SUBJECTS, TIME_OF_DAY, WEATHER_LOOKS, WORLD_EVENTS } from "../ai/knowledge";
import { CAPTION_PRESET_NAMES } from "../caption-style";
import { SHOT_ANGLES, SHOT_MOVES, SHOT_SIDES, SHOT_SIZES, SHOT_STYLES } from "../camera/shot";
import { KIT_SUBJECTS } from "../camera/subjects";
import { ACTIONS as CAST_ACTIONS, REACT_HELP, directorInventory } from "../pipeline/director";
import { STAT_REACTS, SceneSchema, TRANSITION_TYPES, type ShotSpec } from "../spec.schema";
import { ACTION_HELP, ACTOR_ACTIONS, CLIP_KEYS } from "../../world/actors/script";
import { ANCHOR_VOCAB, anchorsForPrompt } from "../../world/cityAnchors";
import { worldDirectorContext } from "../../world/director-context";
import { LAPSE_WORDS } from "../../world/lapse";
import { SET_SPOTS, SET_SUBJECTS, modelSetDefs, type SetKind } from "../../world/modelset/sets";
import { PLACES, REGION_STYLES } from "../../world/places";
import { VFX_FAMILIES, VFX_PALETTES, familyPreset, type VfxFamily } from "../../world/vfx/families";
import { capability, type BuildKind, type BuildRequestFile, type Capability, type CapabilityKind } from "./types";

/* ---------------- reading the director's own words ---------------- */

/** The director's inventory and the world block, as the director reads them. Empty strings if either can't be built. */
export function directorTexts(): { director: string; world: string } {
  const safe = (f: () => string) => {
    try {
      return f();
    } catch {
      return "";
    }
  };
  return { director: safe(() => directorInventory("")), world: safe(() => worldDirectorContext()) };
}

/** A block of a prompt text: the line that starts with `label`, and the indented lines under it. */
export function blockOf(text: string, label: string): string {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.trimStart().startsWith(label));
  if (i < 0) return "";
  const indent = lines[i].length - lines[i].trimStart().length;
  const out = [lines[i].trim()];
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j];
    if (!l.trim() || l.length - l.trimStart().length <= indent) break;
    out.push(l.trim());
  }
  return out.join("\n");
}

/** A paragraph of a prompt text: from the line that starts with `label` to the next blank line. */
export function paragraphOf(text: string, label: string): string {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.trimStart().startsWith(label));
  if (i < 0) return "";
  const out: string[] = [];
  for (let j = i; j < lines.length && lines[j].trim(); j++) out.push(lines[j].trim());
  return out.join(" ");
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Does a clause name `name` as a word ("_" and "-" also read as spaces)? */
function mentions(clause: string, name: string): boolean {
  const forms = [name, name.replace(/[_-]/g, " ")];
  return forms.some((f) => new RegExp(`(^|[^a-z0-9_-])${escapeRe(f.toLowerCase())}([^a-z0-9_-]|$)`).test(clause.toLowerCase()));
}

/**
 * The clauses of a text about one name: split at ";", "." and line ends (and
 * at commas with `commas`, for lines like "push_in for tension, orbit for
 * wonder"), and kept when they mention the name (or one of its other
 * forms). A clause that names more than half of `siblings` is the list
 * itself, not a description: only its brackets are read ("storm (storm adds
 * lightning)"). A leading prompt label ("WORLD EVENTS (optional, at beats): ") is dropped.
 */
export function clausesAbout(text: string, names: readonly string[], siblings: readonly string[] = [], opts: { commas?: boolean } = {}): string {
  const clauses = text
    .split(opts.commas ? /;\s+|\.\s+|,\s+|\n/ : /;\s+|\.\s+|\n/)
    .map((c) => c.trim().replace(/^-\s+/, "").replace(/^[A-Z][A-Z -]+(\([^)]*\))?:\s*/, ""))
    .filter(Boolean);
  const listy = (c: string) => siblings.filter((s) => mentions(c, s)).length > Math.max(2, siblings.length / 2);
  // A clause that is only the name ("orbit_left" in a list, "move: static") says nothing about it.
  const bare = (c: string, name: string) =>
    c.toLowerCase().replace(/^[a-z]+:\s*/, "").replace(/[^a-z0-9]+/g, "") === name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  for (const name of names) {
    const hit: string[] = [];
    for (const c of clauses) {
      if (!mentions(c, name) || bare(c, name)) continue;
      if (!listy(c)) hit.push(c);
      else for (const m of c.matchAll(/\(([^)]*)\)/g)) if (mentions(m[1], name)) hit.push(m[1]);
    }
    if (hit.length) return hit.join("; ");
  }
  return "";
}

/** KIT_GUIDE's lines in the director's inventory: kit -> its words ("park / boardwalk / pier / city-street" shares one line). */
export function kitGuide(directorText: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = directorText.split("\n");
  const start = lines.findIndex((l) => l.startsWith("WORLDS"));
  if (start < 0) return out;
  for (let i = start + 1; i < lines.length && lines[i].trim(); i++) {
    const m = /^- ([a-z][a-z-]*(?: \/ [a-z][a-z-]*)*): (.+)$/.exec(lines[i].trim());
    if (m) for (const kit of m[1].split(" / ")) out.set(kit, m[2]);
  }
  return out;
}

/* ---------------- glosses: plain words for names the code gives no words ---------------- */

type Of<T extends readonly string[]> = T[number];

const SIZE_WORDS: Record<Of<typeof SHOT_SIZES>, string> = {
  ECU: "extreme close-up: a detail, an eye, a hand, macro",
  CU: "close-up: a face or one object filling the frame",
  MS: "medium shot: a person from the waist up",
  FS: "full shot: the whole body, head to toe",
  WS: "wide shot: the subject in its surroundings",
  EWS: "extreme wide shot: establishing, aerial, the whole place",
};
const ANGLE_WORDS: Record<Of<typeof SHOT_ANGLES>, string> = {
  eye: "eye level, neutral, straight on",
  low: "low angle looking up at the subject",
  high: "high angle looking down on the subject",
  overhead: "overhead, top-down, bird's eye view, a map view from above",
  dutch: "dutch angle, tilted, canted frame",
};
const SIDE_WORDS: Record<Of<typeof SHOT_SIDES>, string> = {
  front: "from the front, facing the subject",
  left34: "three-quarter view from the left",
  right34: "three-quarter view from the right",
  left: "profile from the left side",
  right: "profile from the right side",
  back: "from behind, over the shoulder",
  auto: "the side the camera solver picks",
};
const MOVE_WORDS: Record<Of<typeof SHOT_MOVES>, string> = {
  static: "a locked, still camera that does not move",
  push_in: "the camera pushes in: dolly in, moves closer, zoom in",
  pull_out: "the camera pulls out: dolly out, moves away, zoom out, a reveal",
  truck_left: "the camera slides sideways to the left: track, pan left",
  truck_right: "the camera slides sideways to the right: track, pan right",
  crane_up: "the camera rises: crane up, pedestal up, a reveal from above",
  crane_down: "the camera descends: crane down, lowers",
  orbit_left: "the camera circles around the subject to the left: orbit, arc, revolve",
  orbit_right: "the camera circles around the subject to the right: orbit, arc, revolve",
  follow: "the camera follows a moving subject: tracking shot, chase",
  dolly_zoom: "dolly zoom, vertigo effect: the background stretches while the subject stays, a shock",
};
const STYLE_WORDS: Record<Of<typeof SHOT_STYLES>, string> = {
  locked: "tripod, perfectly still frame",
  smooth: "smooth, steadicam, gimbal, glide",
  handheld: "handheld, shaky, documentary, urgent, chaos",
};
const TRANSITION_WORDS: Record<Of<typeof TRANSITION_TYPES>, string> = {
  "dip-black": "a fade to black between scenes",
  "dip-white": "a fade through white between scenes",
  flash: "a white flash cut between scenes",
  whip: "a whip pan: a fast blurred swing of the camera between scenes",
};

/** The spec fields drawn as on-screen graphics (the HUD), with plain words for each. Keys are checked against the spec. */
const HUD_WORDS: Partial<Record<keyof ShotSpec, { name: string; words: string; block?: string }>> = {
  statPanel: { name: "counter", words: "an on-screen counter: a big number that escalates, a stat card, a score", block: "COUNTER" },
  timer: { name: "timer", words: "an on-screen clock or countdown timer: time without something", block: "TIMER" },
  captions: { name: "captions", words: `captions, subtitles, on-screen words in sync with the voice; styles ${CAPTION_PRESET_NAMES.join(", ")}` },
  hook: { name: "hook", words: "the opening title card: the premise as text on screen" },
};

/**
 * The effect families (world/vfx/families.ts) in a story's words: what each
 * draws, and what a breakdown would call it. A Record over the families, so
 * a new one that is not described fails to compile.
 */
const VFX_WORDS: Record<VfxFamily, { help: string; strong: string[] }> = {
  explosion: {
    help: "an explosion: a flash, a toon fireball, smoke, chunks of debris that land and bounce, sparks and a shock ring on the ground; a blast, a bomb going off",
    strong: ["explosion", "blast", "fireball", "bomb", "detonation"],
  },
  fire: {
    help: "a fire burning: flames, a warm glow, embers and a thin smoke, for as long as the story needs; a blaze, a burning car or building, a bonfire",
    strong: ["flames", "blaze", "bonfire", "burning"],
  },
  smoke: {
    help: "smoke or dust rising and drifting in a column: grey, black or white smoke, or a low pale dust cloud; steam",
    strong: ["smoke", "dust cloud", "steam"],
  },
  sparks: {
    help: "sparks: a fountain of sparks with a glint at the source, gold, electric or red; a short circuit, a grinder, fireworks",
    strong: ["sparks", "short circuit", "fireworks"],
  },
  impact: {
    help: "an impact: a puff of dust spreading over the ground, debris and a shock ring, a small flash; a crash, a heavy landing, a shockwave",
    strong: ["impact", "shockwave", "crash"],
  },
  magic: {
    help: "magic: a glowing burst, rings, orbiting sparkles and rising motes, arcane, frost, nature or gold; a spell, an enchantment, a portal",
    strong: ["magic", "spell", "enchantment", "portal"],
  },
};

/* ---------------- planned: designed, not built ---------------- */

/**
 * Capabilities with a design and no code yet. Each becomes a build request
 * with this id when a need matches it. `built` says how to tell, from the
 * code itself, that it has landed: the entry then turns into a built one
 * (`spec` names what the plan writes) and the request is no longer offered.
 */
const PLANNED: Array<{
  request: string;
  kind: CapabilityKind;
  buildKind: BuildKind;
  title: string;
  help: string;
  design: string;
  strong: string[];
  where?: string[];
  built?: { when: () => boolean; spec: string };
}> = [
  {
    request: "camera-bullet-time",
    kind: "device",
    buildKind: "camera",
    title: "Bullet time",
    help:
      "bullet time: the world slows or freezes while the camera keeps moving round the subject; projectiles crawl past with trails, " +
      "a person leans back out of their way (a dodge), the camera sweeps an arc round the frozen moment, the sound sinks and slows",
    design: "docs/factory/14-bullet-time.md",
    strong: ["bullet time", "slow motion", "slowmo", "freeze", "dodge", "frozen"],
    where: ["world"],
    // 14-bullet-time.md: one device, `scene.bulletTime`, on world scenes.
    built: { when: () => "bulletTime" in SceneSchema.shape, spec: "bulletTime" },
  },
  {
    request: "set-type-model-set",
    kind: "set-type",
    buildKind: "set-type",
    title: "Model sets: a downloaded model staged as the whole set",
    help:
      "a model set: one downloaded model staged as the whole set, such as a ship deck, a plane cabin, a cave, a throne room, " +
      "a lighthouse, a temple or a hall; actors walk its floor, the camera stays inside it",
    design: "docs/factory/15-producer.md §4 (Would a generic model set close part of the gap?)",
    strong: ["model set", "deck", "cabin", "cave", "hall"],
    // 19-model-sets.md: scene.modelSet, staged by ModelSetStage (ships and lighthouses so far).
    built: { when: () => "modelSet" in SceneSchema.shape, spec: "modelSet" },
  },
  {
    request: "graphic-graphics-layer",
    kind: "graphic",
    buildKind: "graphic",
    title: "The graphics layer: maps, routes, labels, stat cards",
    help:
      "an animated flight line between cities on the globe, a map with a route line, a distance counter, city and country labels, " +
      "animated stat cards, small maps, diagrams",
    design: "docs/factory/05-plan.md (Phase 6 step 7, the graphics layer)",
    strong: ["map", "route", "label", "diagram", "infographic"],
  },
];

const KIND_OF_BUILD: Record<BuildKind, CapabilityKind> = {
  "set-type": "set-type",
  effect: "device",
  camera: "device",
  device: "device",
  action: "action",
  graphic: "graphic",
};

/* ---------------- the entries ---------------- */

export function codeCapabilities(src: { directorText: string; worldText: string; buildRequests: BuildRequestFile[] }): Capability[] {
  const dir = src.directorText;
  const out: Capability[] = [];
  const push = (...e: Capability[]) => out.push(...e);

  // Where: the kits (the schema's own list), with the director's guide and the camera's subjects.
  const guide = kitGuide(dir);
  const kits = SceneSchema.shape.kit.unwrap().options;
  for (const kit of kits) {
    const subjects = KIT_SUBJECTS[kit] ?? {};
    // The world block's opening sentences (its place list is the places' own entries).
    const own = kit === "world" ? paragraphOf(src.worldText, "WORLD:").split(/(?<=\.)\s+/).slice(0, 2).join(" ") : guide.get(kit) ?? "";
    push(
      capability({
        id: `kit:${kit}`,
        kind: "kit",
        name: kit,
        help: [own, Object.entries(subjects).map(([n, what]) => `${n}: ${what}`).join("; ")].filter(Boolean).join(" | "),
        strong: Object.keys(subjects).filter((n) => n !== "scene"),
        weak: kit === "space" ? [...SPACE_SUBJECTS] : [],
        source: "spec.schema.ts SceneSchema.kit; director.ts KIT_GUIDE; camera/subjects.ts KIT_SUBJECTS",
      }),
    );
  }

  // Model sets: each catalog model a scene can be staged on (world/modelset/sets.ts).
  const SET_WORDS: Record<SetKind, string[]> = { ship: ["ship", "deck", "sea", "sail", "mast", "boat"], tower: ["lighthouse", "coast", "islet", "rocks", "sea", "tower"] };
  for (const d of modelSetDefs()) {
    push(
      capability({
        id: `model-set:${d.id}`,
        kind: "set-type",
        name: d.id,
        called: d.name,
        help: `a model set: ${d.help}; spots ${Object.keys(SET_SPOTS[d.kind]).join(", ")}; the camera frames ${Object.keys(SET_SUBJECTS[d.kind]).join(", ")}`,
        strong: [d.name, ...SET_WORDS[d.kind]],
        where: ["model-set"],
        source: "world/modelset/sets.ts modelSetDefs; spec.schema.ts scene.modelSet",
      }),
    );
  }

  // Real places, their looks and their spots.
  for (const p of Object.values(PLACES)) {
    const style = REGION_STYLES[p.style];
    const marks = (p.landmarks ?? []).map((l) => l.asset);
    push(
      capability({
        id: `place:${p.id}`,
        kind: "place",
        name: p.id,
        help: `${p.name}, ${p.country}: a real place at its real sun and season; the look: ${style.label}${marks.length ? `; landmarks: ${marks.map((m) => m.replace(/^landmark-/, "").replace(/-/g, " ")).join(", ")}` : ""}`,
        strong: [p.name, p.country, p.style, ...marks.map((m) => m.replace(/^landmark-/, ""))],
        where: ["world"],
        source: "world/places.ts PLACES",
      }),
    );
  }
  for (const s of Object.values(REGION_STYLES)) {
    const places = Object.values(PLACES).filter((p) => p.style === s.id).map((p) => p.id);
    push(
      capability({
        id: `region-style:${s.id}`,
        kind: "region-style",
        name: s.id,
        help: `a city look: ${s.label}${places.length ? `; places in it: ${places.join(", ")}` : ""}`,
        places,
        where: ["world"],
        source: "world/places.ts REGION_STYLES",
      }),
    );
  }
  const anchorText = anchorsForPrompt();
  for (const spot of ANCHOR_VOCAB) {
    push(
      capability({
        id: `spot:world:${spot}`,
        kind: "spot",
        name: spot,
        help: `a named spot of a real place's city: ${clausesAbout(anchorText, [spot, spot.split("-")[0]], ANCHOR_VOCAB) || spot.replace(/-/g, " ")}`,
        where: ["world"],
        source: "world/cityAnchors.ts ANCHOR_VOCAB",
      }),
    );
  }
  for (const [kit, subjects] of Object.entries(KIT_SUBJECTS)) {
    for (const [name, what] of Object.entries(subjects)) {
      if (name === "scene") continue;
      push(capability({ id: `spot:${kit}:${name}`, kind: "spot", name, help: `in the ${kit} set: ${what}`, where: [kit], source: "camera/subjects.ts KIT_SUBJECTS" }));
    }
  }

  // What people do: the featured actors' actions, and the kit casts' extra ones.
  for (const a of ACTOR_ACTIONS) {
    const key = (CLIP_KEYS as readonly string[]).includes(a) ? a : undefined;
    push(
      capability({
        id: `action:${a}`,
        kind: "action",
        name: a,
        help: `a featured actor can ${ACTION_HELP[a]}${key ? `; it plays the "${key}" clip` : ""}`,
        where: ["world"],
        source: "world/actors/script.ts ACTOR_ACTIONS, ACTION_HELP",
      }),
    );
  }
  for (const a of CAST_ACTIONS) {
    if ((ACTOR_ACTIONS as readonly string[]).includes(a)) continue;
    push(
      capability({
        id: `cast-action:${a}`,
        kind: "action",
        name: a,
        help: `a cast model in a kit set (park, pier, boardwalk, city street) can ${a.replace(/-/g, " ")}`,
        where: ["kit cast"],
        source: "pipeline/director.ts ACTIONS",
      }),
    );
  }

  // What the world does: counter reactions, world events, weather, time of day.
  for (const r of STAT_REACTS) {
    push(
      capability({
        id: `reaction:${r}`,
        kind: "reaction",
        name: r,
        help: `a real place reacts to the counter, bigger at each step: ${REACT_HELP[r]}`,
        where: ["world"],
        source: "spec.schema.ts STAT_REACTS; director.ts REACT_HELP",
      }),
    );
  }
  const events = blockOf(dir, "WORLD EVENTS");
  for (const ev of WORLD_EVENTS) {
    push(
      capability({
        id: `event:${ev}`,
        kind: "event",
        name: ev,
        help: `a world event at a beat: ${clausesAbout(events, [ev], WORLD_EVENTS) || ev.replace(/-/g, " ")}`,
        source: "ai/knowledge.ts WORLD_EVENTS; director.ts WORLD EVENTS",
      }),
    );
  }
  // The effects a world scene draws (scene.vfx; docs/factory/21-vfx-effekseer.md).
  for (const k of VFX_FAMILIES) {
    const once = familyPreset(k).loop ? "keeps going for as long as the director says" : "plays once at its beat";
    push(
      capability({
        id: `effect:${k}`,
        kind: "effect",
        name: k,
        help: `${VFX_WORDS[k].help}; an effect in a world scene on a city spot, ${once}; palettes ${VFX_PALETTES[k].join(", ")}`,
        strong: VFX_WORDS[k].strong,
        where: ["world"],
        source: "world/vfx/families.ts VFX_FAMILIES; spec.schema.ts scene.vfx",
      }),
    );
  }
  const weather = blockOf(dir, "WEATHER:");
  for (const w of WEATHER_LOOKS) {
    const said = clausesAbout(weather, [w], WEATHER_LOOKS);
    push(
      capability({
        id: `weather:${w}`,
        kind: "weather",
        name: w,
        help: `scene weather: ${w}${said ? ` (${said})` : ""}`,
        source: "ai/knowledge.ts WEATHER_LOOKS; director.ts WEATHER",
      }),
    );
  }
  const time = blockOf(dir, "TIME (time):");
  for (const t of TIME_OF_DAY) {
    push(
      capability({
        id: `time:${t}`,
        kind: "time",
        name: t,
        help: `time of day: ${clausesAbout(time, [t], TIME_OF_DAY) || t}`,
        source: "ai/knowledge.ts TIME_OF_DAY; director.ts TIME",
      }),
    );
  }

  // Devices: the time-lapse, flights, the pulse row, the hero prop.
  const lapse = paragraphOf(src.worldText, "TIME-LAPSE");
  push(
    capability({
      id: "device:time-lapse",
      kind: "device",
      name: "lapse",
      help: lapse || "a time-lapse: the clock runs on over a scene, the sun moves, the city lights up",
      strong: ["time-lapse", "timelapse", "time passing", "hours later"],
      weak: [...LAPSE_WORDS],
      where: ["world"],
      source: "world/director-context.ts TIME-LAPSE; world/lapse.ts",
    }),
  );
  push(
    capability({
      id: "device:flight",
      kind: "device",
      name: "flight",
      help: clausesAbout(src.worldText, ["flight"]) || "a flight over the globe between two places",
      strong: ["flight", "fly", "globe", "travel"],
      where: ["world"],
      source: "world/director-context.ts; spec flights",
    }),
  );
  const counter = blockOf(dir, "COUNTER");
  push(
    capability({
      id: "device:pulse",
      kind: "device",
      name: "bpm",
      help: clausesAbout(counter, ["bpm"]) || "a red pulse row on the counter with a heartbeat sound",
      strong: ["heartbeat", "pulse", "ekg"],
      source: "director.ts COUNTER bpm",
    }),
  );
  const prop = blockOf(dir, "PROP");
  push(
    capability({
      id: "device:hero-prop",
      kind: "device",
      name: "prop",
      help: prop || "a hero prop on the street that grows or vanishes with the story",
      strong: ["hero prop"],
      where: ["street-block"],
      source: "director.ts PROP; ai/knowledge.ts HERO_PROP_STYLES",
    }),
  );
  for (const style of HERO_PROP_STYLES) {
    if (style === "none") continue;
    push(
      capability({
        id: `hero-prop:${style}`,
        kind: "hero-prop",
        name: style,
        help: `a procedural hero prop on the street: ${style.replace(/-/g, " ")}, that multiplies or vanishes beat by beat`,
        where: ["street-block"],
        source: "ai/knowledge.ts HERO_PROP_STYLES",
      }),
    );
  }
  for (const t of TRANSITION_TYPES) {
    push(capability({ id: `transition:${t}`, kind: "transition", name: t, help: TRANSITION_WORDS[t], source: "spec.schema.ts TRANSITION_TYPES" }));
  }

  // The camera: sizes, angles, sides, moves, styles, and the operator styles.
  const shots = blockOf(dir, "SHOTS");
  const line = (label: string) => shots.split("\n").find((l) => l.startsWith(label)) ?? "";
  const camera = (kind: CapabilityKind, names: readonly string[], gloss: Record<string, string>, label: string, source: string, alt?: (n: string) => string[]) => {
    const text = label ? line(label) : "";
    for (const n of names) {
      const said = clausesAbout(text, [n, ...(alt?.(n) ?? [])], names, { commas: true });
      push(capability({ id: `${kind}:${n}`, kind, name: n, help: [gloss[n], said].filter(Boolean).join("; "), source }));
    }
  };
  // The size and side lines are bare lists (and the side line's bracket is about "place"): their glosses say it all.
  camera("shot-size", SHOT_SIZES, SIZE_WORDS, "", "camera/shot.ts SHOT_SIZES");
  camera("shot-angle", SHOT_ANGLES, ANGLE_WORDS, "angle:", "camera/shot.ts SHOT_ANGLES");
  camera("shot-side", SHOT_SIDES, SIDE_WORDS, "", "camera/shot.ts SHOT_SIDES");
  camera("camera-move", SHOT_MOVES, MOVE_WORDS, "move:", "camera/shot.ts SHOT_MOVES", (n) => [n.split("_")[0]]);
  camera("shot-style", SHOT_STYLES, STYLE_WORDS, "energy:", "camera/shot.ts SHOT_STYLES");
  const cameraStyles = blockOf(dir, "CAMERA (camera):");
  for (const c of CAMERA_STYLES) {
    push(
      capability({
        id: `camera-style:${c}`,
        kind: "camera-style",
        name: c,
        help: `a camera operator style for a whole scene: ${clausesAbout(cameraStyles, [c], CAMERA_STYLES) || c.replace(/-/g, " ")}`,
        source: "ai/knowledge.ts CAMERA_STYLES; director.ts CAMERA",
      }),
    );
  }

  // On screen: the HUD fields of the spec.
  for (const [field, g] of Object.entries(HUD_WORDS)) {
    if (!g) continue;
    const said = g.block ? blockOf(dir, g.block).split("\n")[0] : "";
    push(capability({ id: `graphic:${g.name}`, kind: "graphic", name: g.name, help: [g.words, said].filter(Boolean).join(" | "), strong: [field], source: `spec.schema.ts ShotSpecSchema.${field}` }));
  }

  // Planned, then open build requests (one entry per request id).
  for (const p of PLANNED) {
    if (p.built?.when()) {
      const id = p.request.replace(/^[a-z]+-/, "");
      push(capability({ id: `${p.kind}:${id}`, kind: p.kind, name: p.built.spec, help: p.help, strong: p.strong, where: p.where, source: p.design }));
      continue;
    }
    push(
      capability({
        id: `planned:${p.request}`,
        kind: p.kind,
        name: p.request,
        called: p.title,
        help: p.help,
        strong: p.strong,
        status: "planned",
        where: p.where,
        planned: { request: p.request, buildKind: p.buildKind, title: p.title, design: p.design },
        source: p.design,
      }),
    );
  }
  for (const r of src.buildRequests) {
    if (r.status === "done" || r.status === "declined" || PLANNED.some((p) => p.request === r.id)) continue;
    push(
      capability({
        id: `planned:${r.id}`,
        kind: KIND_OF_BUILD[r.kind] ?? "device",
        name: r.id,
        called: r.title,
        help: `${r.title}${r.what ? `: ${r.what}` : ""}`,
        status: "planned",
        planned: { request: r.id, buildKind: r.kind, title: r.title, design: r.design },
        source: `build-requests/${r.id}.json`,
      }),
    );
  }
  return out;
}
