/**
 * src/world/crowd.ts
 *
 * Background people for the generated city: a deterministic cast of walkers
 * along the avenue's sidewalks (some crossing it), plus a cluster that
 * stands around talking in the plaza or on the sidewalk. Every script refers
 * to the anchors of cityAnchors.ts (or plain [x, z] points on them), so
 * planActor gives stride-matched walking and poseAt is a pure function of t.
 *
 * The cast is a fixed-size ordered list; callers slice it by the camera's
 * altitude (crowdLevel), so a wide street shot shows the whole crowd and a
 * high aerial shows fewer (or none).
 */
import type { RegionStyle } from "./places";
import { makeRng } from "./rng";
import type { ActorScriptInput } from "./actors/script";
import type { CityAnchors } from "./cityAnchors";
import { cityAnchors } from "./cityAnchors";
import type { CityLayout } from "./city";

/** Who these people read as; the casting matches role words to models. */
const ROLES = ["woman, 30s", "businessman", "student", "old man", "woman, 20s", "man, 40s", "shopper", "woman, 50s", "worker", "young man", "tourist", "man, 30s"];

/** What some of them carry in one hand (an at-least-one rule; most carry nothing). */
const CARRIES = ["bag", "box", "briefcase"] as const;

export interface CrowdOptions {
  /** Walkers along the sidewalks (default 30; half of them in the near stretch). */
  walk?: number;
  /** People standing in the plaza / on the sidewalk in a loose group (default 10). */
  linger?: number;
  /** People crossing the avenue (default 3). */
  cross?: number;
  /** The stretch of the avenue the crowd works (default [-120, 50] m:
   *  the stretch a street-level camera of the WorldStage poses sees). */
  span?: [number, number];
}

/** How much of the crowd a camera at `altitude` metres keeps to draw:
 *  "full" at street level, "half" from the air, none from very high. */
export function crowdLevel(altitude: number): "full" | "half" | "none" {
  if (altitude > 110) return "none";
  if (altitude > 34) return "half";
  return "full";
}

/** Full-crowd count for a level (to slice the full list down to). */
export function crowdCountFor(level: "full" | "half" | "none", opts: CrowdOptions = {}): number {
  if (level === "none") return 0;
  const walkers = Math.round((opts.walk ?? 30) * (level === "full" ? 1 : 0.5));
  const linger = Math.round((opts.linger ?? 10) * (level === "full" ? 1 : 0.5));
  const cross = level === "full" ? (opts.cross ?? 3) : Math.round((opts.cross ?? 3) / 2);
  return walkers + linger + cross;
}

/**
 * One deterministic cast: walkers first, then crossers, then the standing
 * cluster, so slicing keeps a sensible mix at any density.
 */
export function crowdFor(
  seed: string,
  style: RegionStyle,
  anchors: CityAnchors,
  opts: CrowdOptions = {},
): ActorScriptInput[] {
  const r = makeRng(`crowd:${seed}`);
  const half = style.avenue / 2;
  const walk = style.avenueWalk ?? (style.trees.kind === "broadleaf" ? 8 : 3);
  const zN = -(half - walk / 2);
  const zS = -zN;
  const [x0, x1] = opts.span ?? [-120, 60];
  const out: ActorScriptInput[] = [];
  let k = 0;
  const id = () => `bg-${k++}`;

  // --- walkers: both sidewalks, both directions, strided steps ---------------
  const walkCount = opts.walk ?? 30;
  for (let i = 0; i < walkCount; i++) {
    const dir = i % 2 === 0 ? 1 : -1; // east / west
    const north = i % 4 < 2;
    const z = (north ? zN : zS) + (r() - 0.5) * 1.4;
    // Half the walkers work the near stretch (where a street-level camera
    // of the WorldStage poses sits), the rest spread over the span.
    const from = i % 2 === 0 ? -85 + r() * 120 : x0 + r() * (x1 - x0);
    const to = from + dir * (48 + r() * 80);
    // Every fourth walker carries something (a bag, a box, a briefcase in
    // turn), so any wide shot has at least one.
    const carry = i % 4 === 1 ? CARRIES[Math.floor(i / 4) % 3] : undefined;
    out.push({
      id: id(),
      role: ROLES[i % ROLES.length],
      start: [from, z],
      facing: dir > 0 ? Math.PI / 2 : -Math.PI / 2,
      ...(carry ? { carry } : {}),
      steps: [{ at: 0.05 + ((i * 0.37) % 1.8), action: "walk", to: [to, z + (r() - 0.5) * 1.2] }],
    });
  }

  // --- crossers: straight across the avenue ----------------------------------
  const crossCount = opts.cross ?? 3;
  for (let i = 0; i < crossCount; i++) {
    const x = -70 + r() * 75;
    const from = i % 2 === 0 ? zN : zS;
    out.push({
      id: id(),
      role: ROLES[(i + 4) % ROLES.length],
      start: [x, from],
      facing: from < 0 ? 0 : Math.PI,
      steps: [{ at: 0.3 + i * 1.7, action: "walk", to: [x + (r() - 0.5) * 4, from < 0 ? zS : zN] }],
    });
  }

  // --- the standing cluster: plaza life, else a huddle on the sidewalk ------
  const lingerCount = opts.linger ?? 10;
  const [bx, bz] = anchors.plaza
    ? [anchors.plaza.pos[0], anchors.plaza.pos[2]]
    : [x0 + 18, zS + walk * 1.6];
  const centreY = anchors.groundAt?.(bx, bz) ?? 0.04;
  for (let i = 0; i < lingerCount; i++) {
    const a = (i / lingerCount) * Math.PI * 2 + r() * 0.8;
    const dist = 2 + r() * 4.5;
    const x = bx + Math.cos(a) * dist;
    const z = bz + Math.sin(a) * dist * 0.8;
    const toward = Math.atan2(bx - x, bz - z);
    const steps: ActorScriptInput["steps"] = [{ at: i * 0.35, action: "idle" }];
    // Pairs talk; one waves at the avenue.
    if (i % 3 === 1) steps.push({ at: 1.5 + i * 1.1, action: "talk", target: [bx, centreY + 1.3, bz], for: 4 + r() * 4 });
    if (i % 5 === 3) steps.push({ at: 3 + i, action: "wave", target: [x + 30, centreY + 1, z], for: 2.4 });
    out.push({
      id: id(),
      role: ROLES[(i * 5) % ROLES.length],
      start: [x, z],
      facing: toward,
      steps,
    });
  }

  return out;
}

/**
 * The crowd of a place: anchors and scripts from its city layout, ready for
 * ActorsLayer. The same (seed, layout) always gives the same crowd.
 */
export function cityCrowd(seed: string, style: RegionStyle, layout: CityLayout, opts: CrowdOptions = {}): { anchors: CityAnchors; scripts: ActorScriptInput[] } {
  const anchors = cityAnchors(layout, style);
  const scripts = crowdFor(seed, style, anchors, opts);
  return { anchors, scripts };
}