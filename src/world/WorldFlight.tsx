/**
 * src/world/WorldFlight.tsx
 *
 * Test composition for the one-world engine: start on a street at place A,
 * climb through the clouds, fly over the globe to place B, and drop into
 * its streets. The places and moments are props, so the same composition
 * renders any pair from the catalog.
 */
import { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import "../compositions/hud/fonts";
import { CinematicLook, type LookQuality } from "../compositions/look/CinematicLook";
import type { LookPresetId } from "../compositions/look/presets";
import { makeRng } from "./city";
import { CLOUD_PASSAGES, flightAt, groundPath, TIMING, travelCourse } from "./flight";
import { GlobeWorld } from "./Globe";
import type { ReactionSpec } from "./react/reaction";
import type { Vec3 } from "./geo";
import { GroundWorld } from "./Ground";
import { resolvePlace, type Moment, type ResolvedPlace } from "./places";
import { worldWeather } from "./weather/weather";

/** The colour grade inside the flight's canvases: the same CinematicLook the
 *  main composition grades its stage with, per end of the flight, so the
 *  picture does not change grade where the flight starts and ends. */
export type FlightLook = {
  /** Preset of the scene flown from (ground A and the globe). */
  a: LookPresetId;
  /** Preset of the scene flown to (ground B); the switch from `a` happens at
   *  the second cloud seam, where the veil is closed. */
  b: LookPresetId;
  /** A time-lapse scene at either end: the look its grade blends from and
   *  how far it has gone (CinematicLook blendFrom, blend), so the flight
   *  grades exactly as the stage beside it. */
  aFrom?: LookPresetId;
  aBlend?: number;
  bFrom?: LookPresetId;
  bBlend?: number;
  quality?: LookQuality;
  grain?: number;
  /** The enclosing Sequence's start frame, so the grain never repeats. */
  grainSeed?: number;
};

export type WorldFlightProps = {
  from: { place: string; moment: Moment };
  to: { place: string; moment: Moment };
  /** Screen time the flight occupies. The 15 s path is time-scaled to fit
   *  (a shorter window is a faster flight); default: the full 15 s. */
  dur?: number;
  /** The story's mood (writer's choice, threaded from FlightView): the
   *  world's toon palette follows it on both ends. Optional — QA callers
   *  without a story render ungraded. */
  mood?: string;
  /** The colour grade (threaded from FlightView); absent: ungraded, as the
   *  QA compositions render. */
  look?: FlightLook;
  /** The place, date, sun and distance labels (default on, for the world
   *  previews). A video turns them off: the director never chose them and
   *  they sat under the counter card. */
  labels?: boolean;
  /** The kit cities' near radius (GroundWorld kitLod; default 200 m at the
   *  portrait lens). A negative value draws every kit piece, as before the
   *  levels of detail (for comparisons). */
  kitLod?: number;
  /** The plaza market (GroundWorld market; default on). Off for comparisons. */
  market?: boolean;
  /** The story's reaction (GroundWorld reaction): the spec, the scene each
   *  side belongs to, and the video time the flight starts at, so a place
   *  blacked out or broken before the flight is still so from the air. */
  reaction?: { spec: ReactionSpec; a: { from: number; to: number }; b: { from: number; to: number }; start: number };
  /** Each side's weather (weather/weather.ts worldWeather of its scene and
   *  the spec's world events): its ground draws the rain, storm or snow its
   *  stage does. Pass the spec's own scene objects (stable), not copies. */
  weather?: { a: Parameters<typeof worldWeather>[0]; b: Parameters<typeof worldWeather>[0]; events?: Parameters<typeof worldWeather>[1] };
};

const GL ={ logarithmicDepthBuffer: true, antialias: true };

/** Soft cloud puffs that swell past the camera as the veil closes. */
function CloudVeil({ amount }: { amount: number }) {
  const puffs = useMemo(() => {
    const r = makeRng("veil");
    return Array.from({ length: 16 }, () => ({ x: r() * 100, y: r() * 100, s: 35 + r() * 45, shade: 0.9 + r() * 0.1 }));
  }, []);
  if (amount <= 0.001) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: "none", zIndex: 20 }}>
      <AbsoluteFill style={{ background: "linear-gradient(#eef2f7, #dfe6ee)", opacity: Math.pow(amount, 1.6) }} />
      {puffs.map((p, i) => {
        const spread = 1 + amount * 0.6;
        const size = p.s * (0.6 + amount * 1.6);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${50 + (p.x - 50) * spread - size / 2}%`,
              top: `${50 + (p.y - 50) * spread - size / 2}%`,
              width: `${size}%`,
              aspectRatio: "1",
              borderRadius: "50%",
              background: `radial-gradient(circle, rgba(255,255,255,${p.shade}) 0%, rgba(240,244,250,${0.75 * p.shade}) 40%, rgba(235,240,247,0) 70%)`,
              opacity: Math.min(1, amount * 1.4),
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
}

function fmtDate(m: Moment): string {
  const [y, mo, d] = m.date.split("-").map(Number);
  const month = new Date(Date.UTC(y, mo - 1, d)).toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  return `${d} ${month} ${y} · ${m.time}`;
}

function compass(az: number): string {
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(az / 45) % 8];
}

function Tag({ title, lines, opacity }: { title: string; lines: string[]; opacity: number }) {
  if (opacity <= 0.01) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: "6%",
        top: "7%",
        zIndex: 30,
        opacity,
        color: "white",
        fontFamily: "Inter, Arial, sans-serif",
        textShadow: "0 2px 12px rgba(0,0,0,0.55)",
      }}
    >
      <div style={{ fontSize: 64, fontWeight: 800, letterSpacing: 2 }}>{title}</div>
      {lines.map((l) => (
        <div key={l} style={{ fontSize: 30, fontWeight: 700, opacity: 0.9, marginTop: 6 }}>
          {l}
        </div>
      ))}
    </div>
  );
}

function placeLines(p: ResolvedPlace): string[] {
  return [
    `${p.place.country} · ${fmtDate(p.moment)}`,
    `${p.season} · sun ${Math.round(p.sun.elevation)}° ${compass(p.sun.azimuth)}`,
  ];
}

const fade = (t: number, a: number, b: number, c: number, d: number) =>
  Math.max(0, Math.min(1, (t - a) / (b - a), (d - t) / (d - c)));

/** A place resolved once per value of (place, moment). FlightView passes new
 *  `from` and `to` objects on every frame: keyed on those, every frame made a
 *  new place, and GroundWorld rebuilt its whole city, lights and kit
 *  instances (about 0.7 s, and two extra draws) for each flight frame. */
function usePlace(id: string, moment: Moment): ResolvedPlace {
  const { date, time, utcOffset } = moment;
  return useMemo(() => resolvePlace(id, { date, time, utcOffset }), [id, date, time, utcOffset]);
}

/** The grade, as the LAST child of a flight canvas. */
function FlightGrade({ look, side }: { look?: FlightLook; side: "a" | "b" }) {
  const preset = look?.[side];
  if (!look || !preset) return null;
  const blendFrom = side === "a" ? look.aFrom : look.bFrom;
  const blend = side === "a" ? look.aBlend : look.bBlend;
  return (
    <CinematicLook
      preset={preset}
      {...(blendFrom ? { blendFrom, blend } : {})}
      quality={look.quality ?? "final"}
      grain={look.grain ?? 1}
      grainSeed={look.grainSeed ?? 0}
    />
  );
}

export const WorldFlight: React.FC<WorldFlightProps> = ({ from, to, dur, mood, look, labels = true, kitLod, market, reaction, weather }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const t = (frame / fps) * (TIMING.end / (dur ?? TIMING.end));
  const a = usePlace(from.place, from.moment);
  const b = usePlace(to.place, to.moment);
  const course = useMemo(() => travelCourse(a, b), [a, b]);
  // The kit cities keep their kit pieces near each side's whole camera path.
  const pathA = useMemo(() => groundPath("a", a, b), [a, b]);
  const pathB = useMemo(() => groundPath("b", a, b), [a, b]);
  const f = flightAt(t, a, b);
  // Video seconds (the Sequence starts the frame count at the flight).
  const videoT = (reaction?.start ?? 0) + frame / fps;
  // Each side's weather, planned once (null: none chosen).
  const sceneA = weather?.a;
  const sceneB = weather?.b;
  const events = weather?.events;
  const weatherA = useMemo(() => (sceneA ? worldWeather(sceneA, events) : null), [sceneA, events]);
  const weatherB = useMemo(() => (sceneB ? worldWeather(sceneB, events) : null), [sceneB, events]);
  // In a video, each place's traffic while its ground shows (traffic.ts),
  // over the flight's window in video seconds, out of the flight's lens.
  const span = dur ?? TIMING.end;
  const start = reaction?.start;
  const traffic = useMemo(() => {
    if (start === undefined) return null;
    const scene = { from: start, to: start + span };
    // Off its own side, the lens waits where that side's ground path meets the clouds.
    const lens = (side: "a" | "b", rest: Vec3) => (tt: number): Vec3 => {
      const g = flightAt(Math.max(0, ((tt - start) * TIMING.end) / span), a, b).ground;
      return g?.side === side ? g.pose.pos : rest;
    };
    return { a: { scene, lens: lens("a", pathA[pathA.length - 1]) }, b: { scene, lens: lens("b", pathB[0]) } };
  }, [start, span, a, b, pathA, pathB]);
  const fov = width < height ? 62 : 42;
  const layer = { position: "absolute" as const, inset: 0 };

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {/* One canvas for the whole flight, its scene swapped at the cloud
          seams. A canvas per stage was a new WebGL context per stage in every
          render tab: the grade's passes and the world's programs were
          compiled again for the globe and again for place B. (The globe has
          no shadow-casting light, so the shadow map draws nothing there.) */}
      <ThreeCanvas width={width} height={height} style={layer} shadows gl={GL}>
        {f.ground?.side === "a" && (
          <GroundWorld key="a" place={a} pose={f.ground.pose} fov={fov} cloudPassage={CLOUD_PASSAGES.a} mood={mood} lodPath={pathA} kitLod={kitLod} market={market} reaction={reaction && { spec: reaction.spec, scene: reaction.a, t: videoT }} traffic={traffic ? { ...traffic.a, t: videoT } : undefined} weather={weatherA ? { plan: weatherA, t: videoT } : undefined} />
        )}
        {f.ground?.side === "b" && (
          <GroundWorld key="b" place={b} pose={f.ground.pose} fov={fov} cloudPassage={CLOUD_PASSAGES.b} mood={mood} lodPath={pathB} kitLod={kitLod} market={market} reaction={reaction && { spec: reaction.spec, scene: reaction.b, t: videoT }} traffic={traffic ? { ...traffic.b, t: videoT } : undefined} weather={weatherB ? { plan: weatherB, t: videoT } : undefined} />
        )}
        {f.globe && <GlobeWorld pose={f.globe} utcMs={f.utcMs} month={a.month} fov={fov} />}
        <FlightGrade look={look} side={f.ground?.side === "b" ? "b" : "a"} />
      </ThreeCanvas>
      <CloudVeil amount={f.veil} />
      {labels && (
        <>
          <Tag title={a.place.name.toUpperCase()} lines={placeLines(a)} opacity={fade(t, 0.3, 0.9, 2.2, 2.8)} />
          <Tag
            title={`${a.place.name} → ${b.place.name}`.toUpperCase()}
            lines={[`${Math.round(course.distanceKm).toLocaleString("en-GB")} km`]}
            opacity={fade(t, TIMING.seam1 + 0.8, TIMING.seam1 + 1.4, TIMING.seam2 - 1.4, TIMING.seam2 - 0.8)}
          />
          <Tag title={b.place.name.toUpperCase()} lines={placeLines(b)} opacity={fade(t, TIMING.descendEnd - 0.4, TIMING.descendEnd + 0.2, TIMING.end - 0.8, TIMING.end + 1)} />
        </>
      )}
    </AbsoluteFill>
  );
};
