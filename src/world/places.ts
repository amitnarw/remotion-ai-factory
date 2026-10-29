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
import { localToUtcMs, seasonAt, sunAt, type Season, type SunLocal } from "./geo";
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
    walls: ["#e9dcc0", "#e3d3b4", "#efe4cc", "#dccaa6", "#e6d8bd", "#d9c7a8"],
    roofColors: ["#7d8a96", "#6f7c88", "#87929c"],
    sidewalkColor: "#c9c1b2",
    roadColor: "#62656b",
    outskirts: ["#7f8a5a", "#9a8a55", "#6d7a4c", "#a8925e", "#857a52"],
    windows: { cell: 3.1, w: 0.42, h: 0.62, glass: "#2b3440" },
    trees: { kind: "broadleaf", avenueSpacing: 9, parkChance: 0.07 },
    landmark: null,
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
    walls: ["#efe6d2", "#e8d9bc", "#d9b38c", "#f2e2c4", "#e4cfa8"],
    roofColors: ["#b0503e", "#9c4a3a", "#c0634a"],
    sidewalkColor: "#c6bba6",
    roadColor: "#6a6863",
    outskirts: ["#8a9256", "#a09a5c", "#7a8a4c", "#b0a064", "#8f8a52"],
    windows: { cell: 3.2, w: 0.34, h: 0.5, glass: "#3a3530" },
    // Small limes, so the trees do not hide the two-to-four-storey houses.
    trees: { kind: "broadleaf", avenueSpacing: 15, parkChance: 0.05, size: 0.68, avenueSides: "north" },
    landmark: null,
    haze: 0.08,
    kit: {
      yards: "garden",
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
    trees: { kind: "broadleaf", avenueSpacing: 16, parkChance: 0.04, size: 0.85 },
    landmark: null,
    haze: 0.12,
    kit: {
      yards: "paved",
      zones: [
        { within: 330, sets: { "commercial-towers": 0.5, commercial: 0.5 }, floors: [5, 8], houseWidth: [12, 18], depth: 30, infill: "building-kit" },
        { within: 520, sets: { commercial: 0.5, "building-kit": 0.5 }, floors: [3, 6], houseWidth: [10, 16], depth: 24, infill: "building-kit" },
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
   *  (src/world/data/world-catalog.json) and where it stands. */
  landmarks?: { asset: string; lat: number; lon: number; rotY?: number }[];
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
    style: REGION_STYLES[place.style],
  };
}
