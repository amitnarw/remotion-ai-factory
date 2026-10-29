/**
 * src/world/Root.tsx â€” compositions for the one-world engine test build.
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
import { ReactionsPreview, type ReactionsPreviewProps } from "./react/ReactionsPreview";
import { ReactionsPreviewDark, type DarkPreviewProps } from "./react/darkPreview";

const FPS = 30;

// Lights out (milestone B): the same Paris counter as "dark", by day (the
// October morning) and at night (22:30).
const reactionsDark: DarkPreviewProps = { place: "paris", moment: { date: "2026-10-23", time: "11:00" } };
const reactionsDarkNight: DarkPreviewProps = { place: "paris", moment: { date: "2026-10-23", time: "22:30" } };
// The moonlit night (atmosphere/moon.ts, stars.ts): the same Paris night with
// the lens on the plaza's west side looking east-south-east, at the full moon
// low over the roofs (opposite the sun). No counter: the plain night; the
// "Dark" one is the same lens through the counter's blackout (the moon, its
// halo and the clouds' glow fade with the power).
const nightMoonLens = { pos: [-339, 8.2, -86.4] as [number, number, number], target: [-256, 18, -41.7] as [number, number, number] };
const nightMoon: DarkPreviewProps = { ...reactionsDarkNight, ...nightMoonLens, beats: [] };
const nightMoonDark: DarkPreviewProps = { ...reactionsDarkNight, ...nightMoonLens };

// World reactions (docs/factory/11-world-reactions.md, milestone A): the
// Paris plaza on a late-October morning, through GroundWorld's reaction
// prop; the counter steps 1.75x at 1.5 s and 16x at 4 s.
const parisPlaza = { place: "paris", moment: { date: "2026-10-23", time: "11:00" } };
const reactionsLift: ReactionsPreviewProps = { ...parisPlaza, react: "lift" };
const reactionsGravityOn: ReactionsPreviewProps = { ...parisPlaza, react: "lift", gravityOn: 8 };
const reactionsConfetti: ReactionsPreviewProps = { ...parisPlaza, react: "confetti" };
const reactionsMoney: ReactionsPreviewProps = { ...parisPlaza, react: "money" };
// Milestone B, the ground breaking: the same counter as "crack" (cracks at
// 1.5 s, the plaza breaks into slabs at the 16x beat), at night (22:30) like
// the reference's night frames.
const reactionsCrack: ReactionsPreviewProps = { place: "paris", moment: { date: "2026-10-23", time: "22:30" }, react: "crack" };

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
    {/* Lane C QA variants (Phase 5 step 2 + Phase 6 step 4): mood palette,
        sun shafts, drawn water and the night kit windows. */}
    <Composition
      id="WorldMoodUpbeat"
      component={WorldActors}
      durationInFrames={15 * FPS}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={{ place: "colmar", moment: { date: "2026-10-23", time: "12:00" }, mood: "upbeat" } satisfies WorldActorsProps}
    />
    <Composition
      id="WorldMoodTense"
      component={WorldActors}
      durationInFrames={15 * FPS}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={{ place: "colmar", moment: { date: "2026-10-23", time: "12:00" }, mood: "tense" } satisfies WorldActorsProps}
    />
    <Composition
      id="WorldMoodPastel"
      component={WorldActors}
      durationInFrames={15 * FPS}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={{ place: "colmar", moment: { date: "2026-10-23", time: "12:00" }, mood: "ambient" } satisfies WorldActorsProps}
    />
    <Composition
      id="WorldShafts"
      component={WorldActors}
      durationInFrames={15 * FPS}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={{ place: "colmar", moment: { date: "2026-10-23", time: "17:30" }, mood: "upbeat" } satisfies WorldActorsProps}
    />
    <Composition
      id="WorldPond"
      component={WorldActors}
      durationInFrames={15 * FPS}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={{
        place: "colmar",
        moment: { date: "2026-10-23", time: "12:00" },
        pos: [491, 3.2, 222],
        target: [515, 0.2, 207],
        fov: 55,
      } satisfies WorldActorsProps}
    />
    <Composition
      id="WorldNightKits"
      component={WorldActors}
      durationInFrames={15 * FPS}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={{ place: "colmar", moment: { date: "2026-10-23", time: "20:30" } } satisfies WorldActorsProps}
    />
    <Composition
      id="WorldNightNewYork"
      component={WorldActors}
      durationInFrames={15 * FPS}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={{ place: "new-york", moment: { date: "2026-10-23", time: "20:30" } } satisfies WorldActorsProps}
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
    {/* World reactions, milestone A (src/world/react/): a synthetic counter
        steps 1.75x at 1.5 s and 16x at 4 s; the gravity-on one drops back at 8 s. */}
    <Composition
      id="ReactionsPreview"
      component={ReactionsPreview}
      durationInFrames={10 * FPS}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={reactionsLift}
    />
    <Composition
      id="ReactionsPreviewGravityOn"
      component={ReactionsPreview}
      durationInFrames={12 * FPS}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={reactionsGravityOn}
    />
    <Composition
      id="ReactionsPreviewConfetti"
      component={ReactionsPreview}
      durationInFrames={10 * FPS}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={reactionsConfetti}
    />
    <Composition
      id="ReactionsPreviewMoney"
      component={ReactionsPreview}
      durationInFrames={10 * FPS}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={reactionsMoney}
    />
    {/* World reactions, milestone B: lights out (src/world/react/dark.ts).
        The counter as "dark" (1.75x at 1.5 s, 16x at 4 s); pass
        lightsOut (seconds) for the world event's wave instead or as well. */}
    <Composition
      id="ReactionsPreviewDark"
      component={ReactionsPreviewDark}
      durationInFrames={10 * FPS}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={reactionsDark}
    />
    <Composition
      id="ReactionsPreviewDarkNight"
      component={ReactionsPreviewDark}
      durationInFrames={10 * FPS}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={reactionsDarkNight}
    />
    <Composition
      id="WorldNightMoon"
      component={ReactionsPreviewDark}
      durationInFrames={10 * FPS}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={nightMoon}
    />
    <Composition
      id="WorldNightMoonDark"
      component={ReactionsPreviewDark}
      durationInFrames={10 * FPS}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={nightMoonDark}
    />
    {/* World reactions, milestone B: the ground cracks, then breaks into
        slabs (src/world/react/slab.ts); pass groundBreak (seconds) for the
        world event instead or as well. */}
    <Composition
      id="ReactionsPreviewCrack"
      component={ReactionsPreview}
      durationInFrames={10 * FPS}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={reactionsCrack}
    />
  </>
);
