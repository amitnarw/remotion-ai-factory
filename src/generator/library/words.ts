/**
 * src/generator/library/words.ts — the words a need and a capability are
 * compared in (docs/factory/15-producer.md §3, "How a match is made", step 1).
 *
 * Both sides are cut into lower-case singular words with the world catalog's
 * own tokenizer (src/world/catalog.ts `tokenize`), so "Lanterns" and
 * "lantern_hanging" meet on "lantern". A light stemmer adds a second form for
 * verbs ("climbing" also tries "climb"), and a small synonyms table lets a
 * need's word find a capability named differently (cop is police, automobile
 * is car). The table is about words, not about what the factory has: every
 * capability name still comes from the code (registry.ts).
 *
 * Plugs in: registry.ts indexes every entry's words with these functions;
 * match.ts scores a need's words against them (WordIndex).
 */
import { tokenize } from "../../world/catalog";

/** Words that say nothing about what a thing is. */
export const STOP_WORDS: ReadonlySet<string> = new Set(
  (
    "a an the of in on at to from by for with without and or but nor as into onto under through " +
    "his her its their our your my he she they it them him this that these those there here who whom which what when where " +
    "is are was were be been being am has have had do doe did will would can could should may might must " +
    "very some any each every all one two three four five six few many much more most other another such " +
    "thing something someone somebody anything moment video story scene beat kind sort lot bit"
  ).split(/\s+/),
);

/**
 * A need's word -> words a capability may use for it. Read one way: the need
 * says the key, the capability says one of the values. Kept small; the
 * small-model judge (judge.ts) covers what words alone miss.
 */
export const SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  // people
  cop: ["police"],
  policeman: ["police"],
  officer: ["police", "swat"],
  guard: ["police", "swat"],
  guy: ["man"],
  gentleman: ["man"],
  lady: ["woman"],
  girl: ["woman", "female", "child"],
  boy: ["man", "male", "child"],
  kid: ["child"],
  elderly: ["old"],
  person: ["character", "man", "woman"],
  people: ["character", "crowd"],
  courier: ["delivery"],
  // vehicles
  automobile: ["car"],
  auto: ["car"],
  sedan: ["car"],
  taxi: ["car", "cab"],
  cab: ["taxi", "car"],
  motorcycle: ["motorbike", "bike"],
  motorbike: ["motorcycle", "bike"],
  vessel: ["ship", "boat"],
  ship: ["boat"],
  boat: ["ship"],
  sailboat: ["boat", "sail"],
  aircraft: ["plane", "airplane"],
  airplane: ["plane"],
  plane: ["airplane"],
  chopper: ["helicopter"],
  // places
  coast: ["beach", "shore", "sea", "ocean"],
  shore: ["beach", "coast", "sea"],
  seaside: ["beach", "sea", "coast"],
  sea: ["ocean"],
  ocean: ["sea"],
  harbour: ["harbor", "pier", "jetty"],
  harbor: ["harbour", "pier", "jetty"],
  dock: ["pier", "jetty"],
  wood: ["forest"],
  woods: ["forest"],
  jungle: ["forest", "tropical"],
  town: ["city", "village"],
  village: ["town", "countryside"],
  farm: ["countryside", "barn", "field"],
  square: ["plaza"],
  plaza: ["square"],
  street: ["road", "avenue"],
  avenue: ["street", "road"],
  alley: ["street"],
  room: ["interior"],
  apartment: ["interior", "room"],
  home: ["house", "interior"],
  rooftop: ["roof"],
  // light and weather
  lantern: ["lamp", "light"],
  lamp: ["light", "lantern"],
  torch: ["lamp", "light"],
  thunderstorm: ["storm", "thunder", "lightning"],
  lightning: ["storm", "thunder"],
  thunder: ["storm"],
  downpour: ["rain"],
  rainstorm: ["rain", "storm"],
  blizzard: ["snow", "storm"],
  blackout: ["dark", "lights-out", "power"],
  darkness: ["dark", "night"],
  quake: ["crack", "ground-break"],
  earthquake: ["crack", "ground-break", "quake"],
  flood: ["water", "water-rise"],
  weightless: ["lift", "gravity"],
  float: ["lift", "gravity"],
  sunset: ["dusk", "golden"],
  sunrise: ["dawn"],
  nightfall: ["night", "dusk"],
  midnight: ["night"],
  // camera
  circle: ["orbit"],
  circling: ["orbit"],
  spin: ["orbit"],
  arc: ["orbit"],
  zoom: ["push", "pull"],
  closeup: ["close"],
  aerial: ["overhead", "drone", "wide"],
  shaky: ["handheld"],
  shake: ["handheld"],
  tracking: ["follow"],
  chase: ["follow", "run"],
  tilted: ["dutch"],
  slowmo: ["slow", "motion"],
  // actions
  sprint: ["run"],
  dash: ["run"],
  flee: ["run", "panic"],
  leap: ["jump"],
  hop: ["jump"],
  applause: ["clap"],
  celebrate: ["cheer"],
  scared: ["panic", "cower"],
  cower: ["panic"],
  faint: ["fall"],
  collapse: ["fall"],
  stumble: ["fall"],
  shout: ["talk"],
  speak: ["talk"],
  chat: ["talk"],
  punch: ["fight", "hit"],
  fight: ["punch", "kick"],
  // sound
  foghorn: ["horn"],
  siren: ["alarm", "police"],
  gunshot: ["shot", "gun"],
  gun: ["shot"],
  bang: ["explosion", "shot"],
  boom: ["explosion"],
  blast: ["explosion"],
  crash: ["impact"],
  smash: ["glass", "impact"],
  thud: ["impact"],
  chime: ["bell"],
  seagull: ["gull"],
  gull: ["seagull"],
  surf: ["wave"],
  breeze: ["wind"],
  gust: ["wind"],
  // music
  sorrow: ["sad"],
  sorrowful: ["sad"],
  melancholy: ["sad"],
  tragic: ["sad"],
  mournful: ["sad"],
  gloomy: ["sad"],
  happy: ["upbeat"],
  cheerful: ["upbeat"],
  joyful: ["upbeat"],
  scary: ["tense", "horror"],
  suspenseful: ["tense", "suspense"],
  thrilling: ["tense", "epic"],
  heroic: ["epic"],
  grand: ["epic"],
  peaceful: ["ambient"],
  calm: ["ambient"],
  eerie: ["ambient", "mysterious"],
  funny: ["playful", "comedy"],
  futuristic: ["scifi", "sci-fi"],
};

/** Words never stemmed: the "-ing" or "-ed" is part of the noun. */
const KEEP_ENDING = new Set([
  "lightning", "morning", "evening", "ceiling", "building", "king", "ring", "wing", "thing", "string", "spring", "swing",
  "sling", "railing", "awning", "painting", "clothing", "bed", "shed", "red", "sled", "wed",
]);

/** A second, stemmed form for verbs: "climbing" -> "climb", "stopped" -> "stop". The word itself when none applies. */
export function stem(w: string): string {
  if (KEEP_ENDING.has(w)) return w;
  const undouble = (s: string) => (/([b-df-hj-np-tv-z])\1$/.test(s) && !/(ll|ss|zz)$/.test(s) ? s.slice(0, -1) : s);
  if (w.length > 5 && w.endsWith("ing")) return undouble(w.slice(0, -3));
  if (w.length > 4 && w.endsWith("ied")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith("ed")) return undouble(w.slice(0, -2));
  return w;
}

/** Lower-case singular words with the stop words left out, in order, each once. */
export function words(text: string | readonly string[]): string[] {
  const all = (typeof text === "string" ? [text] : text).flatMap((t) => tokenize(t));
  const out: string[] = [];
  for (const w of all) if (w.length > 1 && !STOP_WORDS.has(w) && !/^\d+$/.test(w) && !out.includes(w)) out.push(w);
  return out;
}

export interface WeightedWord {
  word: string;
  /** How much the need cares about it: its first search word 1.5 (the prompt puts the most telling noun first), the others 1, words of its description 0.5, its look 0.35. */
  weight: number;
  /** One of the need's own search words (what coverage counts). */
  own?: boolean;
  /** A compound of two adjacent words ("slow motion" -> "slowmotion"): it only adds when an entry is called by it, and then counts its parts as found. */
  parts?: [string, string];
}

/** Two adjacent words as one: "bullet time" -> "bullettime", the form multi-word aliases are indexed under. */
export function compound(a: string, b: string): string {
  return `${a}${b}`;
}

/** A need's words with their weights: search words first, then the description and the look, then adjacent pairs as compounds. */
export function needWords(need: { words: readonly string[]; what: string; look?: string }): WeightedWord[] {
  const out: WeightedWord[] = [];
  const add = (list: string[], weight: number, own = false) => {
    for (const w of list) if (!out.some((x) => x.word === w)) out.push({ word: w, weight: own && !out.length ? weight * 1.5 : weight, ...(own ? { own } : {}) });
  };
  add(words(need.words), 1, true);
  add(words(need.what), 0.5);
  add(words(need.look ?? ""), 0.35);
  const pairs = (list: string[], weight: number) => {
    for (let i = 0; i + 1 < list.length; i++) {
      const c = compound(list[i], list[i + 1]);
      if (!out.some((x) => x.word === c)) out.push({ word: c, weight, parts: [list[i], list[i + 1]] });
    }
  };
  for (const phrase of need.words) pairs(words(phrase), 1);
  pairs(words(need.what), 0.5);
  return out;
}

/** The forms a need's word is looked up in: itself, its stem, then its synonyms (weaker). */
export function variants(w: string): Array<[string, number]> {
  const out: Array<[string, number]> = [[w, 1]];
  const s = stem(w);
  if (s !== w && s.length > 2) out.push([s, 0.9]);
  for (const syn of SYNONYMS[w] ?? SYNONYMS[s] ?? []) for (const t of words(syn)) if (!out.some(([v]) => v === t)) out.push([t, 0.6]);
  return out;
}

/** A capability's words as the index sees them: what it is called (strong) and how it is described (weak). */
export interface Indexed {
  strong: ReadonlySet<string>;
  weak: ReadonlySet<string>;
}

/** One need word found in an entry: which form matched and how strongly. */
export interface WordHit {
  word: string;
  /** The entry word it met. */
  as: string;
  /** Before the word's weight and rarity: 3 a name or tag, 1.2 a description word, less for a prefix or synonym. */
  strength: number;
  strong: boolean;
}

/** "climb" and "climbing", "dodge" and "dodging": one word starts the other and is most of it (5 letters at least: "time" is not "timer"). */
function prefixOf(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 5 && long.startsWith(short) && short.length / long.length >= 0.6;
}

/** The best way a need's word appears in an entry, or null. */
export function hitWord(x: Indexed, w: string): WordHit | null {
  let best: WordHit | null = null;
  const keep = (h: WordHit) => {
    if (!best || h.strength > best.strength) best = h;
  };
  for (const [v, f] of variants(w)) {
    if (x.strong.has(v)) keep({ word: w, as: v, strength: 3 * f, strong: true });
    else if (x.weak.has(v)) keep({ word: w, as: v, strength: 1.2 * f, strong: false });
    else {
      for (const s of x.strong) if (prefixOf(v, s)) keep({ word: w, as: s, strength: 1.5 * f, strong: true });
      for (const s of x.weak) if (prefixOf(v, s)) keep({ word: w, as: s, strength: 0.6 * f, strong: false });
    }
  }
  return best;
}

export interface WordScore {
  score: number;
  /** Share of the need's own search words the entry has, 0..1. */
  coverage: number;
  hits: WordHit[];
}

/**
 * Scores entries against a need's words. Rare words count more (the same
 * inverse document frequency as the world catalog's scorer), and matching
 * more of the words beats matching one rare word strongly.
 */
export class WordIndex {
  private readonly df = new Map<string, number>();
  private readonly n: number;

  constructor(entries: readonly Indexed[]) {
    this.n = entries.length;
    for (const x of entries) for (const w of new Set([...x.strong, ...x.weak])) this.df.set(w, (this.df.get(w) ?? 0) + 1);
  }

  idf(w: string): number {
    return Math.log(1 + this.n / (1 + (this.df.get(w) ?? 0)));
  }

  score(x: Indexed, need: readonly WeightedWord[]): WordScore {
    const hits: WordHit[] = [];
    /** Need words the entry has, on their own or as part of a compound it is called by. */
    const found = new Set<string>();
    /** The best credit per entry word: "gunshot", "gun" and "shot" all meeting "shot" count once, at the best of them. */
    const credit = new Map<string, number>();
    const give = (as: string, v: number) => credit.set(as, Math.max(credit.get(as) ?? 0, v));
    for (const w of need) {
      if (w.parts) {
        // A compound only counts when the entry is called by it ("slow motion", "new york").
        if (!x.strong.has(w.word)) continue;
        hits.push({ word: w.word, as: w.word, strength: 3, strong: true });
        give(w.word, w.weight * 3 * this.idf(w.word));
        for (const p of w.parts) found.add(p);
        continue;
      }
      const h = hitWord(x, w.word);
      if (!h) continue;
      hits.push(h);
      found.add(w.word);
      give(h.as, w.weight * h.strength * this.idf(h.as));
    }
    let score = [...credit.values()].reduce((t, v) => t + v, 0);
    const plain = need.filter((w) => !w.parts);
    const all = plain.reduce((t, w) => t + w.weight, 0);
    const got = plain.filter((w) => found.has(w.word)).reduce((t, w) => t + w.weight, 0);
    if (all > 0) score *= 0.5 + (0.5 * got) / all;
    const own = plain.filter((w) => w.own);
    const coverage = own.length ? own.filter((w) => found.has(w.word)).length / own.length : all > 0 ? got / all : 0;
    return { score: Math.round(score * 1e6) / 1e6, coverage: Math.round(coverage * 1e6) / 1e6, hits };
  }
}
