/**
 * FlightView.tsx — the flight between two world scenes (Phase 6 step 1).
 * Rendered as an overlay above the stage canvas while a spec.flights window
 * runs: the world engine's flight path, time-compressed to the window's
 * length (WorldFlight accepts a dur for that). The two places come from the
 * surrounding scenes' world choices.
 */
import { Sequence } from "remotion";
import { WorldFlight } from "../../world/WorldFlight";
import type { ShotSpec } from "../../generator/spec.schema";

export interface FlightWindow {
  from: number;
  to: number;
}

export const FlightView: React.FC<{
  spec: ShotSpec;
  window: FlightWindow;
}> = ({ spec, window: win }) => {
  const fps = spec.fps ?? 30;
  const idx = spec.scenes.findIndex((s) => win.to - 0.01 >= s.from && win.to - 0.01 < s.to);
  if (idx <= 0) return null;
  const b = spec.scenes[idx];
  const a = [...spec.scenes.slice(0, idx)].reverse().find((s) => s.world != null);
  if (!a?.world || !b.world) return null;
  const dur = win.to - win.from;
  return (
    <Sequence
      from={Math.round(win.from * fps)}
      durationInFrames={Math.max(1, Math.round(dur * fps))}
      name="flight"
    >
      <WorldFlight
        from={{ place: a.world.place, moment: { date: a.world.date, time: a.world.time } }}
        to={{ place: b.world.place, moment: { date: b.world.date, time: b.world.time } }}
        dur={dur}
        mood={spec.story?.mood}
      />
    </Sequence>
  );
};