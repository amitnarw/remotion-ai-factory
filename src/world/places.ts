/**
 * src/world/places.ts
 *
 * Places and regional styles. The AI names a place and a moment (date,
 * local time); `resolvePlace` works out everything the renderer needs:
 * the real sun position, the season, what the ground is, the city style,
 * and the UTC offset on that date (from the place's time-zone rule).
 *
 * Cities are generated from regional style rules (no map data), so a place
 * looks right for its region, not like the real street plan. Styles with a
 * `kit` build their core from real CC0 building kits (kits.ts); the others
 * generate box buildings.
 */
import { surfaceAt } from "./earth-grid";
import { groundOffset, localToUtcMs, seasonAt, sunAt, type Season, type SunLocal } from "./geo";
import type { KitSetId } from "./kits";
import { Surface } from "./surface";

export type RegionStyleId = "european-old-town" | "arab-desert-city" | "european-village" | "american-downtown";

/**
 * One ring of a kit-built city. A lot uses the first zone whose `within`
 * covers the distance from the city centre to the lot.
 */
export interface KitZone {
  /** Lots whose centre is closer than this to the city centre (m). */
  within: number;
  /** Kit sets (kits.ts KIT_SETS) and their weights; each lot draws one. */
  sets: Partial<Record<KitSetId, number>>;
  /** Storeys for modular kits (complete models come with their own). */
  floors: [number, number];
  /** A modular set's row along a wide lot is split into houses this wide (m). */
  houseWidth: [number, number];
  /** Deepest lot a building may use, from the street edge (m). */
  depth: number;
  /** Modular set that fills what a row of complete buildings leaves free
   *  at the end of a lot (so street walls have no holes). */
  infill?: KitSetId;
  /** Block interiors in this zone, if not the style's `yards`. */
  yards?: "garden" | "paved";
}

export interface KitStyle {
  zones: KitZone[];
  /** Block interiors behind the street walls: "garden" (grass, by season)
   *  or "paved" (the sidewalk slab). */
  yards: "garden" | "paved";
  /** Paints for a modular set's houses (kitPaint.ts): each house draws one
   *  (seeded by the house) for its wall swatch; "" keeps the kit's own. */
  paints?: Partial<Record<KitSetId, string[]>>;
  /** Water tanks (kits.ts WATER_TOWER) on the flat roofs of these sets'
   *  buildings, each with this chance (seeded by the building). */
  tanks?: { sets: KitSetId[]; chance: number };
}

export interface RegionStyle {
  id: RegionStyleId;
  label: string;
  /** "perimeter": buildings line the block edges around a courtyard.
   *  "dense": lots fill the whole block. */
  layout: "perimeter" | "dense";
  block: [number, number];
  street: number;
  avenue: number;
  sidewalk: number;
  lotWidth: [number, number];
  lotDepth: number;
  floors: [number, number];
  floorHeight: number;
  roof: "mansard" | "flat";
  walls: string[];
  roofColors: string[];
  sidewalkColor: string;
  roadColor: string;
  outskirts: string[];
  /** Window grid: metres per window column, window size as a fraction of the cell. */
  windows: { cell: number; w: number; h: number; glass: string };
  /** Street trees; `size` scales their height and crown (default 1);
   *  `avenueSides`: which avenue sidewalks are planted (broadleaf; default both). */
  trees: { kind: "broadleaf" | "palm"; avenueSpacing: number; parkChance: number; size?: number; avenueSides?: "both" | "north" | "south" | "none" };
  /** Sidewalk width on each side of the avenue (m); default 8 with
   *  broadleaf trees, 3 with palms. */
  avenueWalk?: number;
  landmark: "minaret" | null;
  /** The main plaza's bell tower (city.ts `belfry`): a square stone tower
   *  on a lot facing the plaza. Walls, trim (plinth, string courses,
   *  cornice), spire and clock colours; its width, the height of the
   *  shaft's top and the spire's height (m). */
  belfry?: { walls: string; trim: string; spire: string; clock: string; width: number; shaft: number; spireHeight: number };
  /** Half-size of the built area, suburbs included (m; default 2600). The
   *  terrain is flat under it and rises into the land beyond (terrain.ts),
   *  so a village keeps its hills close. At least the cars' avenue reach
   *  (traffic.ts AVENUE_REACH, 1500 m) plus a block. */
  outerHalf?: number;
  /** 0..1: how much the horizon takes on the ground colour (dust). */
  haze: number;
  /** Core buildings from CC0 kits instead of boxes (the suburbs stay boxes). */
  kit?: KitStyle;
}

export const REGION_STYLES: Record<RegionStyleId, RegionStyle> = {
  "european-old-town": {
    id: "european-old-town",
    label: "European old town (stone blocks, mansard roofs, tree-lined boulevards)",
    layout: "perimeter",
    block: [62, 92],
    street: 12,
    avenue: 34,
    sidewalk: 3.5,
    lotWidth: [10, 17],
    lotDepth: 15,
    floors: [5, 7],
    floorHeight: 3.3,
    roof: "mansard",
    // Stone and painted render: cream and limestone, ochre, rose, apricot,
    // pale yellow, sage and powder blue (each building draws one).
    walls: ["#efe4cc", "#e3d3b4", "#dccaa6", "#ecd29a", "#e9c2b2", "#e3a98c", "#f0e0a2", "#c9d3b2", "#c3d1da", "#e8c9a0"],
    roofColors: ["#7d8a96", "#6f7c88", "#87929c"],
    sidewalkColor: "#c9c1b2",
    roadColor: "#62656b",
    outskirts: ["#7f8a5a", "#9a8a55", "#6d7a4c", "#a8925e", "#857a52"],
    windows: { cell: 3.1, w: 0.42, h: 0.62, glass: "#2b3440" },
    trees: { kind: "broadleaf", avenueSpacing: 9, parkChance: 0.07 },
    landmark: null,
    // A Romanesque stone tower with a slate spire, over the six-storey blocks.
    belfry: { walls: "#ddd0b4", trim: "#c4b596", spire: "#5d6875", clock: "#f4efe2", width: 9, shaft: 34, spireHeight: 14 },
    haze: 0.1,
  },
  "arab-desert-city": {
    id: "arab-desert-city",
    label: "Arab desert city (dense concrete blocks, flat roofs, minarets, palms)",
    layout: "dense",
    block: [40, 62],
    street: 8,
    avenue: 30,
    sidewalk: 2,
    lotWidth: [9, 16],
    lotDepth: 0,
    floors: [3, 11],
    floorHeight: 3.1,
    roof: "flat",
    walls: ["#d8bf98", "#cfae86", "#e0c9a6", "#c89f7a", "#d9b48c", "#bfa284", "#e3d2b8"],
    roofColors: ["#c9b293", "#bba585", "#d4bf9f"],
    sidewalkColor: "#cdb895",
    roadColor: "#6a665e",
    outskirts: ["#d8bb86", "#cfae78", "#e0c592", "#c9a670"],
    windows: { cell: 3.4, w: 0.36, h: 0.42, glass: "#3a3a3c" },
    trees: { kind: "palm", avenueSpacing: 12, parkChance: 0.03 },
    landmark: "minaret",
    haze: 0.35,
  },
  "european-village": {
    id: "european-village",
    label: "European village / old town (half-timbered gabled houses, crooked streets, gardens)",
    layout: "perimeter",
    block: [40, 70],
    street: 12,
    avenue: 22,
    avenueWalk: 5,
    sidewalk: 3,
    lotWidth: [6, 10],
    lotDepth: 13,
    floors: [2, 3],
    floorHeight: 3.2,
    roof: "flat",
    // Painted houses, as in Colmar's Petite Venise: yellow, apricot, coral,
    // sky blue, mint, pink, lilac and cream.
    walls: ["#f2d27a", "#eaa97e", "#dc8070", "#9fc4d8", "#a9cf9c", "#ebb8c6", "#c6abd6", "#f0e6d2"],
    roofColors: ["#b0503e", "#9c4a3a", "#c0634a"],
    sidewalkColor: "#c6bba6",
    roadColor: "#6a6863",
    outskirts: ["#8a9256", "#a09a5c", "#7a8a4c", "#b0a064", "#8f8a52"],
    windows: { cell: 3.2, w: 0.34, h: 0.5, glass: "#3a3530" },
    // Small limes, so the trees do not hide the two-to-four-storey houses.
    trees: { kind: "broadleaf", avenueSpacing: 15, parkChance: 0.05, size: 0.68, avenueSides: "north" },
    landmark: null,
    // The church tower over the market square: cream render, red sandstone
    // trim and a steep red-tiled spire.
    belfry: { walls: "#efe3c8", trim: "#c9876b", spire: "#b5523c", clock: "#f7f2e4", width: 7, shaft: 24, spireHeight: 11 },
    // A small town: the fields and hills begin a block past the cars' reach.
    outerHalf: 1600,
    haze: 0.08,
    kit: {
      yards: "garden",
      // Petite Venise: yellow, ochre, apricot, coral, red, sky blue, mint,
      // pink and cream render; one house in ten keeps the kit's lilac.
      paints: { "fantasy-town": ["#f1cf6a", "#dcae52", "#f0ac7c", "#e2806a", "#c95f4f", "#93bcdf", "#a3d3a2", "#efb4c6", "#f2e7cc", ""] },
      zones: [
        { within: 330, sets: { "fantasy-town": 1 }, floors: [2, 4], houseWidth: [6, 10], depth: 13 },
        { within: Infinity, sets: { "fantasy-town": 1 }, floors: [2, 3], houseWidth: [6, 11], depth: 13 },
      ],
    },
  },
  "american-downtown": {
    id: "american-downtown",
    label: "American downtown (street grid, towers and shops in the centre, walk-ups and houses further out)",
    layout: "dense",
    block: [64, 200],
    street: 18,
    avenue: 34,
    sidewalk: 4,
    lotWidth: [12, 30],
    lotDepth: 30,
    floors: [2, 5],
    floorHeight: 3,
    roof: "flat",
    walls: ["#a4553f", "#b8a48a", "#8c8f94", "#c9bda6", "#9a4b3b", "#d4ccc0"],
    roofColors: ["#6b6e72", "#7a7c80", "#5d6064"],
    sidewalkColor: "#b8b5ae",
    roadColor: "#4f5257",
    outskirts: ["#7f8a64", "#8a8f6c", "#6f7a58", "#958f6a"],
    windows: { cell: 2.8, w: 0.5, h: 0.55, glass: "#2a3340" },
    // A few small trees: big crowns hid the shop fronts in the walking shots.
    trees: { kind: "broadleaf", avenueSpacing: 32, parkChance: 0.04, size: 0.6 },
    landmark: null,
    haze: 0.12,
    kit: {
      yards: "paved",
      // The Building Kit's mid-rises in red and brown brick, sandstone,
      // limestone and cream stone (its walls are a slate lilac).
      paints: { "building-kit": ["#9c4a36", "#b05a40", "#8a3e31", "#a8603f", "#7c4636", "#c9a77c", "#d6c9ad", "#cfc4ae", "#b8ad98", "#e3d9c3"] },
      // Wooden water tanks on most walk-ups and mid-rises, as in the reference aerial.
      tanks: { sets: ["walkups", "building-kit"], chance: 0.6 },
      // Brick walk-ups with shop fronts between the towers and the stone
      // mid-rises (the Kenney shop models were pastel).
      zones: [
        { within: 330, sets: { "commercial-towers": 0.45, walkups: 0.55 }, floors: [5, 8], houseWidth: [12, 18], depth: 30, infill: "building-kit" },
        { within: 520, sets: { walkups: 0.55, "building-kit": 0.45 }, floors: [3, 6], houseWidth: [10, 16], depth: 24, infill: "building-kit" },
        { within: Infinity, sets: { "suburban-houses": 0.65, "building-kit": 0.35 }, floors: [2, 4], houseWidth: [10, 14], depth: 22, yards: "garden" },
      ],
    },
  },
};

/* ------------------------------------------------------------------ */
/*  Time zones                                                          */
/* ------------------------------------------------------------------ */

/**
 * Summer-time rules:
 * - "eu": last Sunday of March to last Sunday of October, switching at
 *   01:00 UTC.
 * - "us": second Sunday of March to first Sunday of November, switching at
 *   02:00 local time.
 * - "egypt": last Friday of April 00:00 to the end of the last Thursday of
 *   October (24:00), local time (the rule Egypt has used since 2023).
 * - "none": no summer time.
 * The hour that happens twice when clocks go back reads as summer time for
 * "us" and "egypt", as standard time for "eu"; the hour skipped in spring
 * resolves to either side. Neither matters for a scene's light.
 */
export type DstRule = "eu" | "us" | "egypt" | "none";

export interface TimeZoneRule {
  /** Standard-time UTC offset in hours. */
  std: number;
  dst: DstRule;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Day of the month of the nth `weekday` (0 = Sunday) in a month (1-12). */
function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}

/** Day of the month of the last `weekday` (0 = Sunday) in a month (1-12). */
function lastWeekday(year: number, month: number, weekday: number): number {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastDay = new Date(Date.UTC(year, month - 1, days)).getUTCDay();
  return days - ((lastDay - weekday + 7) % 7);
}

/** The UTC offset (hours) a time-zone rule gives on a local date and time. */
export function utcOffsetFor(tz: TimeZoneRule, date: string, time: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  // The local wall clock, counted as if it were UTC.
  const local = Date.UTC(y, mo - 1, d, hh, mm);
  let summer = false;
  if (tz.dst === "eu") {
    const utc = local - tz.std * HOUR;
    summer = utc >= Date.UTC(y, 2, lastWeekday(y, 3, 0), 1) && utc < Date.UTC(y, 9, lastWeekday(y, 10, 0), 1);
  } else if (tz.dst === "us") {
    summer = local >= Date.UTC(y, 2, nthWeekday(y, 3, 0, 2), 2) && local < Date.UTC(y, 10, nthWeekday(y, 11, 0, 1), 2);
  } else if (tz.dst === "egypt") {
    summer = local >= Date.UTC(y, 3, lastWeekday(y, 4, 5)) && local < Date.UTC(y, 9, lastWeekday(y, 10, 4)) + DAY;
  }
  return tz.std + (summer ? 1 : 0);
}

/* ------------------------------------------------------------------ */
/*  Places                                                              */
/* ------------------------------------------------------------------ */

/**
 * A place's own colours on its region's look (resolvePlace lays them over
 * the region style): the layout, streets, kits, traffic and sound stay the
 * region's, keyed by its id, so Rome is an old town in Roman ochre and
 * terracotta, not a new style.
 */
export interface PlaceLook {
  walls?: string[];
  roofColors?: string[];
  sidewalkColor?: string;
  /** The bell tower's colours and shape (the region's, where left out). */
  belfry?: Partial<NonNullable<RegionStyle["belfry"]>>;
  /** Kit styles: paints per modular set (KitStyle.paints). */
  paints?: KitStyle["paints"];
  /** Kit styles: water tanks on the flat roofs; null for none. */
  tanks?: KitStyle["tanks"] | null;
}

/**
 * Water round a place where the surface map is too coarse to draw it
 * (terrain.ts, an Ocean surface): bays and straits, land with hills
 * everywhere else. Each body is placed at a real latitude and longitude,
 * pulled in along its bearing to LANDMARK_MAX_DISTANCE as a landmark is
 * (placeOffset), so a strait still runs under the bridge that spans it.
 */
export interface PlaceWater {
  /** Bays: discs of open water, radius in metres. */
  bays: { at: [number, number]; r: number }[];
  /** Straits: bands of water `width` metres wide along a line through `at`
   *  on a compass `bearing`, from `from` to `to` metres along it (negative:
   *  behind the point). `bluff`: within `reach` metres of `at` along the
   *  band, both banks stand at least this high (a bridge's ends land on
   *  them, as the Golden Gate's on its headlands). */
  straits: { at: [number, number]; bearing: number; width: number; from: number; to: number; bluff?: { height: number; reach: number } }[];
  /** The land's hill height, metres (the Ocean surface's own is 70). */
  hills: number;
}

export interface PlaceDef {
  id: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
  style: RegionStyleId;
  /** Local time: standard offset and summer-time rule. */
  tz: TimeZoneRule;
  /** Typical cloud cover, 0..1. */
  cloudiness: number;
  /** Ground around the city when the surface map is too coarse to say
   *  (e.g. Cairo sits on a green river strip inside desert). */
  terrain?: Surface;
  /** Famous landmarks at their real positions: a catalog asset id
   *  (src/world/data/world-catalog.json) and where it stands; `clear`: the
   *  open ground round its footprint, metres (default 40). */
  landmarks?: { asset: string; lat: number; lon: number; rotY?: number; clear?: number }[];
  /** The place's own colours on its region's look. */
  look?: PlaceLook;
  /** Bays and straits the surface map can't draw (an Ocean terrain). */
  water?: PlaceWater;
}

/** Landmarks (and a place's bays and straits) farther than this from the
 *  city's centre are pulled in along their true bearing, so they stay
 *  visible through the haze and still sit in the right direction. */
export const LANDMARK_MAX_DISTANCE = 7000;

/** Where a point near a place lies in its ground frame (x east, z south,
 *  metres), pulled in along its bearing to LANDMARK_MAX_DISTANCE. */
export function placeOffset(place: Pick<PlaceDef, "lat" | "lon">, lat: number, lon: number): [number, number] {
  let [x, z] = groundOffset(place.lat, place.lon, lat, lon);
  const dist = Math.hypot(x, z);
  if (dist > LANDMARK_MAX_DISTANCE) {
    x *= LANDMARK_MAX_DISTANCE / dist;
    z *= LANDMARK_MAX_DISTANCE / dist;
  }
  return [x, z];
}

/** The places this build can show. The AI chooses from this list. */
export const PLACES: Record<string, PlaceDef> = {
  paris: {
    id: "paris", name: "Paris", country: "France", lat: 48.857, lon: 2.352, style: "european-old-town", cloudiness: 0.55,
    tz: { std: 1, dst: "eu" },
    landmarks: [{ asset: "landmark-eiffel-tower", lat: 48.8584, lon: 2.2945 }],
  },
  cairo: {
    id: "cairo", name: "Cairo", country: "Egypt", lat: 30.044, lon: 31.236, style: "arab-desert-city", cloudiness: 0.12, terrain: Surface.Desert,
    tz: { std: 2, dst: "egypt" },
    landmarks: [{ asset: "landmark-pyramids-of-giza", lat: 29.9792, lon: 31.1342, rotY: 0.3 }],
  },
  colmar: {
    // Alsace wine town in the Rhine plain, the Vosges to the west; one of
    // the driest towns in France.
    id: "colmar", name: "Colmar", country: "France", lat: 48.0794, lon: 7.3585, style: "european-village", cloudiness: 0.35,
    tz: { std: 1, dst: "eu" },
  },
  "new-york": {
    // On the harbour: the Ocean terrain gives a coast and open water on one side.
    id: "new-york", name: "New York", country: "USA", lat: 40.7128, lon: -74.006, style: "american-downtown", cloudiness: 0.3, terrain: Surface.Ocean,
    tz: { std: -5, dst: "us" },
    landmarks: [
      { asset: "landmark-empire-state-building", lat: 40.7484, lon: -73.9857 },
      { asset: "landmark-statue-of-liberty", lat: 40.6892, lon: -74.0445 },
    ],
  },
  rome: {
    // Centred on Piazza Venezia; the Colosseum stands 1.1 km to the
    // south-east, at the end of the Via dei Fori Imperiali, its long axis
    // roughly east-west, in open ground (its piazza, the Forum and the
    // Palatine to the west, the Colle Oppio park to the north-east). Ochre
    // and terracotta render under tiled roofs, and a brick campanile with a
    // low tiled roof by the main square.
    id: "rome", name: "Rome", country: "Italy", lat: 41.896, lon: 12.4825, style: "european-old-town", cloudiness: 0.3,
    tz: { std: 1, dst: "eu" },
    landmarks: [{ asset: "landmark-colosseum", lat: 41.8902, lon: 12.4922, rotY: Math.PI / 2, clear: 250 }],
    look: {
      walls: ["#dca35e", "#c97d4f", "#bb6649", "#e7c072", "#e9b88e", "#ebe0c8", "#d99c86", "#b95e4b", "#e2cfa4", "#d8b27c"],
      roofColors: ["#b3603f", "#a6553a", "#c06d4a"],
      sidewalkColor: "#cdbfa6",
      belfry: { walls: "#b8724f", trim: "#e6dcc4", spire: "#a95c3e", clock: "#f4efe2", width: 8, shaft: 34, spireHeight: 6 },
    },
  },
  london: {
    // Centred on Trafalgar Square; Big Ben's clock tower stands 0.8 km to
    // the south. London stock and red brick, Portland stone and white
    // stucco under slate, and a stone church tower with a lead spire.
    // Summer time follows the EU's rule (01:00 UTC, the last Sundays of
    // March and October). The river is not drawn: the city's flat square
    // has no river through it.
    id: "london", name: "London", country: "UK", lat: 51.508, lon: -0.1281, style: "european-old-town", cloudiness: 0.65,
    tz: { std: 0, dst: "eu" },
    landmarks: [{ asset: "landmark-big-ben", lat: 51.5007, lon: -0.1246 }],
    look: {
      walls: ["#b89b6c", "#c9ae7d", "#9c4d3d", "#a8603f", "#7e5b49", "#e3ddcf", "#ece7dc", "#e6dcc3", "#bfa47a", "#8f4a3a"],
      roofColors: ["#5b636c", "#4f5760", "#6a727a"],
      sidewalkColor: "#bdb8ae",
      belfry: { walls: "#e3ddcf", trim: "#cdc6b6", spire: "#59626b", clock: "#f4efe2", width: 9, shaft: 30, spireHeight: 20 },
    },
  },
  "san-francisco": {
    // Centred on Union Square. The bay lies north and east of the city and
    // the Golden Gate strait runs west under the bridge (7.2 km to the
    // west-north-west, pulled in to 7 km), the Marin headlands across it;
    // the surface map's quarter-degree cells only say "ocean" here. White,
    // cream and buff stone mid-rises (laid as ashlar, kitPaint.ts) between
    // the brick walk-ups, pastel houses further out; no water tanks.
    id: "san-francisco", name: "San Francisco", country: "USA", lat: 37.788, lon: -122.4075, style: "american-downtown", cloudiness: 0.35, terrain: Surface.Ocean,
    tz: { std: -8, dst: "us" },
    // Turned half round: the model's grass block (left out, landmarks.ts) is its north end.
    landmarks: [{ asset: "landmark-golden-gate-bridge", lat: 37.8199, lon: -122.4783, rotY: Math.PI + 0.087 }],
    water: {
      bays: [
        { at: [37.84, -122.38], r: 3600 },
        { at: [37.785, -122.35], r: 2300 },
      ],
      straits: [{ at: [37.8199, -122.4783], bearing: 270, width: 1100, from: -7600, to: 4500, bluff: { height: 90, reach: 900 } }],
      hills: 160,
    },
    look: {
      walls: ["#efe8da", "#e6d6b8", "#d9c39a", "#c9d6c4", "#bfcfdc", "#e5c3bd", "#f3efe6", "#d4cbbd"],
      paints: { "building-kit": ["#f2eee4", "#e9dcc0", "#e3d3bd", "#d9c7a8", "#cfc6b8", "#f6f1e7", "#e6dcc8", "#c9bfae", "#ddd5c6", "#efe3cf"] },
      tanks: null,
    },
  },
};

export interface Moment {
  /** Local date, "YYYY-MM-DD". */
  date: string;
  /** Local clock time, "HH:MM". */
  time: string;
  /** The place's UTC offset on that date, in hours (summer time included).
   *  Leave it out to have resolvePlace work it out from the place's `tz`. */
  utcOffset?: number;
}

export interface ResolvedPlace {
  place: PlaceDef;
  /** The moment asked for, with its UTC offset filled in. */
  moment: Moment & { utcOffset: number };
  utcMs: number;
  sun: SunLocal;
  season: Season;
  month: number;
  surface: Surface;
  style: RegionStyle;
}

const PLACE_STYLES = new Map<string, RegionStyle>();

/**
 * A place's region style with its own look laid over (PlaceLook): one object
 * per place, so the stage's memos keep their keys. A place without a look
 * gets its region's style object itself.
 */
export function placeStyle(place: PlaceDef): RegionStyle {
  const base = REGION_STYLES[place.style];
  const look = place.look;
  if (!look) return base;
  let style = PLACE_STYLES.get(place.id);
  if (!style) {
    const { paints, tanks, belfry, ...colours } = look;
    const kit = base.kit && (paints !== undefined || tanks !== undefined) ? { ...base.kit, ...(paints !== undefined ? { paints } : {}), tanks: tanks === null ? undefined : (tanks ?? base.kit.tanks) } : base.kit;
    style = { ...base, ...colours, belfry: base.belfry && belfry ? { ...base.belfry, ...belfry } : base.belfry, kit };
    PLACE_STYLES.set(place.id, style);
  }
  return style;
}

export function resolvePlace(placeId: string, moment: Moment): ResolvedPlace {
  const place = PLACES[placeId];
  if (!place) {
    throw new Error(`Unknown place "${placeId}". Known: ${Object.keys(PLACES).join(", ")}`);
  }
  const utcOffset = moment.utcOffset ?? utcOffsetFor(place.tz, moment.date, moment.time);
  const utcMs = localToUtcMs(moment.date, moment.time, utcOffset);
  const month = Number(moment.date.split("-")[1]);
  return {
    place,
    moment: { ...moment, utcOffset },
    utcMs,
    sun: sunAt(utcMs, place.lat, place.lon),
    season: seasonAt(place.lat, month),
    month,
    surface: place.terrain ?? surfaceAt(place.lat, place.lon),
    style: placeStyle(place),
  };
}
