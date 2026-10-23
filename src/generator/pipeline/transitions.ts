/**
 * src/generator/pipeline/transitions.ts — how each scene hands over to the
 * next (Phase 3). Film rules, no model call:
 *   - into or out of space, or day <-> night: dip to black (time or scale jumps);
 *   - a new place at the same time of day: a whip pan (energy, same moment);
 *   - same place, new weather: a short dip to white;
 *   - a world event (the water returns, the lights go out): a white flash.
 * Cuts between shots inside a scene stay hard cuts. Everything is an overlay
 * or a camera move, so only one 3D scene is ever drawn (08-phase3-research.md §2).
 */
import type { ShotSpec, SpecTransition } from "../spec.schema";

type Scene = ShotSpec["scenes"][number];
type WorldEvent = NonNullable<ShotSpec["worldEvents"]>[number];

const FLASH_EVENTS = new Set(["water-vanish", "water-return", "lights-out"]);

export function planTransitions(scenes: Scene[], worldEvents: WorldEvent[]): SpecTransition[] {
  const out: SpecTransition[] = [];
  for (let i = 0; i + 1 < scenes.length; i++) {
    const a = scenes[i];
    const b = scenes[i + 1];
    const t = b.from;
    const night = (s: Scene) => s.look?.timeOfDay === "night";
    if (a.kit === "space" || b.kit === "space" || night(a) !== night(b)) out.push({ t, type: "dip-black", dur: 0.6 });
    else if (a.kit !== b.kit) out.push({ t, type: "whip", dur: 0.34 });
    else out.push({ t, type: "dip-white", dur: 0.3 });
  }
  for (const e of worldEvents) {
    if (!FLASH_EVENTS.has(e.name)) continue;
    if (out.some((x) => Math.abs(x.t - e.t) < 0.5)) continue; // a scene change is already marking it
    out.push({ t: e.t, type: "flash", dur: 0.14 });
  }
  return out.sort((x, y) => x.t - y.t);
}
