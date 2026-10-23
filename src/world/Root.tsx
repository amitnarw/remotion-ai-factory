/**
 * src/world/Root.tsx — compositions for the one-world engine test build.
 * Separate from src/Root.tsx so the main factory is untouched.
 *
 *   npx remotion studio src/world/index.ts
 *   npx remotion render src/world/index.ts WorldFlight out/world-flight.mp4
 *   npx remotion render src/world/index.ts WorldFlightKits out/world-flight-kits.mp4
 */
import { Composition } from "remotion";
import { ActorStage, type ActorStageProps } from "./actors/ActorStage";
import { TIMING } from "./flight";
import { GlobeSpin, type GlobeSpinProps } from "./GlobeSpin";
import { KitPreview, type KitPreviewProps } from "./KitPreview";
import { PlaceView, type PlaceViewProps } from "./PlaceView";
import { WorldFlight, type WorldFlightProps } from "./WorldFlight";
import { WorldActors, type WorldActorsProps } from "./WorldActors";

const FPS = 30;

const parisToCairo: WorldFlightProps = {
  from: { place: "paris", moment: { date: "2026-10-23", time: "09:15", utcOffset: 2 } },
  to: { place: "cairo", moment: { date: "2026-10-23", time: "13:00", utcOffset: 3 } },
};

// Kit-built towns: an autumn morning in Alsace, then a New York afternoon.
// No utcOffset: resolvePlace works it out from each place's time zone.
const colmarToNewYork: WorldFlightProps = {
  from: { place: "colmar", moment: { date: "2026-10-23", time: "09:30" } },
  to: { place: "new-york", moment: { date: "2026-10-23", time: "14:30" } },
};

const placeView: PlaceViewProps = {
  place: "colmar",
  moment: { date: "2026-10-23", time: "10:00" },
  pos: [0, 140, 300],
  target: [0, 0, 0],
};

export const WorldRoot: React.FC = () => (
  <>
    <Composition
      id="WorldFlight"
      component={WorldFlight}
      durationInFrames={Math.round(TIMING.end * FPS)}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={parisToCairo}
    />
    <Composition
      id="WorldFlightKits"
      component={WorldFlight}
      durationInFrames={Math.round(TIMING.end * FPS)}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={colmarToNewYork}
    />
    <Composition
      id="WorldFlightWide"
      component={WorldFlight}
      durationInFrames={Math.round(TIMING.end * FPS)}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={parisToCairo}
    />
    <Composition
      id="WorldPlace"
      component={PlaceView}
      durationInFrames={1}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={placeView}
    />
    <Composition
      id="GlobeSpin"
      component={GlobeSpin}
      durationInFrames={12 * FPS}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ lat: 20, lon: 10, spin: true, distance: 3.4, month: 10 } satisfies GlobeSpinProps}
    />
    <Composition
      id="KitPreview"
      component={KitPreview}
      durationInFrames={1}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ mode: "street" } satisfies KitPreviewProps}
    />
    {/* Phase 5: the dressed world at street level - background crowd,
        plaza dressing, flags, lamps, birds (GroundWorld's life). */}
    <Composition
      id="WorldActors"
      component={WorldActors}
      durationInFrames={15 * FPS}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={{ place: "colmar", moment: { date: "2026-10-23", time: "09:30" } } satisfies WorldActorsProps}
    />
    <Composition
      id="WorldActorsWide"
      component={WorldActors}
      durationInFrames={15 * FPS}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ place: "colmar", moment: { date: "2026-10-23", time: "09:30" } } satisfies WorldActorsProps}
    />
    {/* Phase 5: scripted actors on a test plaza (src/world/actors/). */}
    <Composition
      id="ActorStage"
      component={ActorStage}
      durationInFrames={15 * FPS}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={{} satisfies ActorStageProps}
    />
    <Composition
      id="ActorStageWide"
      component={ActorStage}
      durationInFrames={15 * FPS}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{} satisfies ActorStageProps}
    />
  </>
);
