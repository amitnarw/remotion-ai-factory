/**
 * FlightView.tsx — the flight between two world scenes (Phase 6 step 1).
 * Rendered as an overlay above the stage canvas while a spec.flights window
 * runs: the world engine's flight path, time-compressed to the window's
 * length (WorldFlight accepts a dur for that). The two places come from the
 * surrounding scenes' world choices. The window overlaps both scenes, so a
 * place with a time-lapse is met where its lapse has got to: left as the
 * window opens, reached as it closes (src/world/lapse.ts). The light then
 * carries on from the last frame seen, and into the first one after.
 */
import { Sequence } from "remotion";
import { WorldFlight, type FlightLook } from "../../world/WorldFlight";
import type { SceneType, ShotSpec } from "../../generator/spec.schema";
import { lapseLookFor, lookFor } from "../../generator/look-choice";
import { lapseClock } from "../../world/lapse";
import type { Moment } from "../../world/places";

export interface FlightWindow {
  from: number;
  to: number;
}

type WorldScene = SceneType & { world: NonNullable<SceneType["world"]> };

/** The two world scenes a flight window joins (the scene it ends in, and
 *  the last world scene before it), or null when it joins none: then
 *  nothing is drawn over the stage. The spec's own scene objects. */
export function flightScenes(spec: ShotSpec, win: FlightWindow): { a: WorldScene; b: WorldScene } | null {
  const idx = spec.scenes.findIndex((s) => win.to - 0.01 >= s.from && win.to - 0.01 < s.to);
  if (idx <= 0) return null;
  const b = spec.scenes[idx];
  const a = [...spec.scenes.slice(0, idx)].reverse().find((s) => s.world != null);
  if (!a?.world || !b.world) return null;
  return { a: a as WorldScene, b: b as WorldScene };
}

/** The moment of a world scene a flight meets at video time `at` (it leaves
 *  scene A as its window opens, reaches scene B as it closes): where its
 *  lapse has got to by then (with the scene's fixed UTC offset), else its
 *  own date and time. */
export function departureMoment(a: WorldScene, at: number): Moment {
  const clock = lapseClock(a.world, a);
  return clock ? clock.at(at).moment : { date: a.world.date, time: a.world.time };
}

export const FlightView: React.FC<{
  spec: ShotSpec;
  window: FlightWindow;
}> = ({ spec, window: win }) => {
  const fps = spec.fps ?? 30;
  const ends = flightScenes(spec, win);
  if (!ends) return null;
  const { a, b } = ends;
  const dur = win.to - win.from;
  const start = Math.round(win.from * fps);
  // The same grade the main canvas gives each end (index.tsx: lookFor of the
  // scene and the story's mood, the same quality and grain), so the picture
  // keeps its look across the flight's edges. A time-lapse end grades as its
  // stage does there: the end look's operator, blended as far as the lapse
  // has gone when the flight opens (A) or closes (B).
  const mood = spec.story?.mood;
  const lapseA = lapseLookFor(a, mood);
  const lapseB = lapseLookFor(b, mood);
  const look: FlightLook = {
    a: lapseA ? lapseA.to : lookFor(a, mood),
    b: lapseB ? lapseB.to : lookFor(b, mood),
    ...(lapseA ? { aFrom: lapseA.from, aBlend: lapseA.mix(win.from) } : {}),
    ...(lapseB ? { bFrom: lapseB.from, bBlend: lapseB.mix(win.to) } : {}),
    quality: spec.settings?.quality === "draft" ? "draft" : "final",
    grain: 0.3,
    grainSeed: start,
  };
  return (
    <Sequence
      from={start}
      durationInFrames={Math.max(1, Math.round(dur * fps))}
      name="flight"
    >
      <WorldFlight
        from={{ place: a.world.place, moment: departureMoment(a, win.from) }}
        to={{ place: b.world.place, moment: departureMoment(b, win.to) }}
        dur={dur}
        mood={spec.story?.mood}
        look={look}
        labels={false}
        // A place blacked out, broken or lifting stays so from the air.
        reaction={{ spec, a, b, start: win.from }}
        // And a place in the rain is in the rain from the air.
        weather={{ a, b, events: spec.worldEvents }}
      />
    </Sequence>
  );
};