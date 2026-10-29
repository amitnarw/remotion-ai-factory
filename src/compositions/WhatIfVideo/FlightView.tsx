/**
 * FlightView.tsx — the flight between two world scenes (Phase 6 step 1).
 * Rendered as an overlay above the stage canvas while a spec.flights window
 * runs: the world engine's flight path, time-compressed to the window's
 * length (WorldFlight accepts a dur for that). The two places come from the
 * surrounding scenes' world choices.
 */
import { Sequence } from "remotion";
import { WorldFlight, type FlightLook } from "../../world/WorldFlight";
import type { SceneType, ShotSpec } from "../../generator/spec.schema";
import { lookFor } from "../../generator/look-choice";

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
  // keeps its look across the flight's edges.
  const look: FlightLook = {
    a: lookFor(a, spec.story?.mood),
    b: lookFor(b, spec.story?.mood),
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
        from={{ place: a.world.place, moment: { date: a.world.date, time: a.world.time } }}
        to={{ place: b.world.place, moment: { date: b.world.date, time: b.world.time } }}
        dur={dur}
        mood={spec.story?.mood}
        look={look}
        labels={false}
        // A place blacked out, broken or lifting stays so from the air.
        reaction={{ spec, a, b, start: win.from }}
      />
    </Sequence>
  );
};