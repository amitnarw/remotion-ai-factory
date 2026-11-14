/**
 * src/generator/pipeline/transitions.ts — how each scene hands over to the
 * next (Phase 3). Film rules, no model call:
 *   - into or out of space, or day <-> night: dip to black (time or scale jumps);
 *     a world scene is as light as its real sun at the cut (a time-lapse's
 *     end going out, its start coming in; any other's one moment), as its
 *     picture and grade are, whatever its word says;
 *   - a new place at the same time of day: a whip pan (energy, same moment);
 *   - same place, new weather: a short dip to white;
 *   - a world event (the water returns, the lights go out): a white flash;
 *   - a change of world place filmed as a flight (Phase 6): nothing — the
 *     flight (spec.flights, drawn over the stages by FlightView) is the
 *     transition, and no flash fires while one runs.
 * Cuts between shots inside a scene stay hard cuts. Everything is an overlay
 * or a camera move, so only one 3D scene is ever drawn (08-phase3-research.md §2).
 */
import type { ShotSpec, SpecTransition } from "../spec.schema";
import { lapseClock } from "../../world/lapse";
import { lightWordFor, worldSunOf } from "../look-choice";

type Scene = ShotSpec["scenes"][number];
type WorldEvent = NonNullable<ShotSpec["worldEvents"]>[number];
export type FlightWindow = NonNullable<ShotSpec["flights"]>[number];

const FLASH_EVENTS = new Set(["water-vanish", "water-return", "lights-out"]);

/** The flight window that films the cut into `scene`, if the cut is a flight. */
export function flightAtCut(scene: Pick<Scene, "from" | "flight">, flights: FlightWindow[] | undefined): FlightWindow | undefined {
  if (!scene.flight) return undefined;
  return (flights ?? []).find((f) => scene.from >= f.from && scene.from <= f.to);
}

/** True when the cut into `scene` is filmed as a flight (the scene is marked
 *  a flight and a planned flight window covers its start). */
export function isFlightCut(scene: Pick<Scene, "from" | "flight">, flights: FlightWindow[] | undefined): boolean {
  return flightAtCut(scene, flights) !== undefined;
}

/** Whether a scene reads as night at one of its cuts: a world scene by its
 *  real sun (night once it has set; a time-lapse's at that edge), any other
 *  (or a world choice that does not resolve) by its word. */
function nightAt(s: Scene, edge: "start" | "end"): boolean {
  const clock = s.kit === "world" && s.world ? lapseClock(s.world, s) : null;
  if (clock) return lightWordFor((edge === "start" ? clock.start : clock.end).sun.elevation) === "night";
  const sun = worldSunOf(s);
  if (sun !== null) return lightWordFor(sun) === "night";
  return s.look?.timeOfDay === "night";
}

export function planTransitions(scenes: Scene[], worldEvents: WorldEvent[], flights: FlightWindow[] = []): SpecTransition[] {
  const out: SpecTransition[] = [];
  for (let i = 0; i + 1 < scenes.length; i++) {
    const a = scenes[i];
    const b = scenes[i + 1];
    if (isFlightCut(b, flights)) continue; // the flight is the transition
    const t = b.from;
    if (a.kit === "space" || b.kit === "space" || nightAt(a, "end") !== nightAt(b, "start")) out.push({ t, type: "dip-black", dur: 0.6 });
    else if (a.kit !== b.kit) out.push({ t, type: "whip", dur: 0.34 });
    else out.push({ t, type: "dip-white", dur: 0.3 });
  }
  const inFlight = (t: number) => flights.some((f) => t >= f.from && t <= f.to);
  // A bullet time's window is one unbroken moment: no flash inside it.
  const inBullet = (t: number) => scenes.some((s) => s.bulletTime && t >= s.bulletTime.from && t <= s.bulletTime.to);
  for (const e of worldEvents) {
    if (!FLASH_EVENTS.has(e.name)) continue;
    if (inFlight(e.t)) continue; // the flight covers the picture
    if (inBullet(e.t)) continue;
    if (out.some((x) => Math.abs(x.t - e.t) < 0.5)) continue; // a scene change is already marking it
    out.push({ t: e.t, type: "flash", dur: 0.14 });
  }
  return out.sort((x, y) => x.t - y.t);
}
