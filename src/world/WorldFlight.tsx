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
import { makeRng } from "./city";
import { CLOUD_PASSAGES, flightAt, TIMING, travelCourse } from "./flight";
import { GlobeWorld } from "./Globe";
import { GroundWorld } from "./Ground";
import { resolvePlace, type Moment, type ResolvedPlace } from "./places";

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
};

const GL = { logarithmicDepthBuffer: true, antialias: true };

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

export const WorldFlight: React.FC<WorldFlightProps> = ({ from, to, dur, mood }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const t = (frame / fps) * (TIMING.end / (dur ?? TIMING.end));
  const a = useMemo(() => resolvePlace(from.place, from.moment), [from]);
  const b = useMemo(() => resolvePlace(to.place, to.moment), [to]);
  const course = useMemo(() => travelCourse(a, b), [a, b]);
  const f = flightAt(t, a, b);
  const fov = width < height ? 62 : 42;
  const layer = { position: "absolute" as const, inset: 0 };

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {f.ground?.side === "a" && (
        <ThreeCanvas key="a" width={width} height={height} style={layer} shadows gl={GL}>
          <GroundWorld place={a} pose={f.ground.pose} fov={fov} cloudPassage={CLOUD_PASSAGES.a} mood={mood} />
        </ThreeCanvas>
      )}
      {f.ground?.side === "b" && (
        <ThreeCanvas key="b" width={width} height={height} style={layer} shadows gl={GL}>
          <GroundWorld place={b} pose={f.ground.pose} fov={fov} cloudPassage={CLOUD_PASSAGES.b} mood={mood} />
        </ThreeCanvas>
      )}
      {f.globe && (
        <ThreeCanvas key="globe" width={width} height={height} style={layer} gl={GL}>
          <GlobeWorld pose={f.globe} utcMs={f.utcMs} month={a.month} fov={fov} />
        </ThreeCanvas>
      )}
      <CloudVeil amount={f.veil} />
      <Tag title={a.place.name.toUpperCase()} lines={placeLines(a)} opacity={fade(t, 0.3, 0.9, 2.2, 2.8)} />
      <Tag
        title={`${a.place.name} → ${b.place.name}`.toUpperCase()}
        lines={[`${Math.round(course.distanceKm).toLocaleString("en-GB")} km`]}
        opacity={fade(t, TIMING.seam1 + 0.8, TIMING.seam1 + 1.4, TIMING.seam2 - 1.4, TIMING.seam2 - 0.8)}
      />
      <Tag title={b.place.name.toUpperCase()} lines={placeLines(b)} opacity={fade(t, TIMING.descendEnd - 0.4, TIMING.descendEnd + 0.2, TIMING.end - 0.8, TIMING.end + 1)} />
    </AbsoluteFill>
  );
};
