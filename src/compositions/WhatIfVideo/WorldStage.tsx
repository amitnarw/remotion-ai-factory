/**
 * WorldStage.tsx — a "world" kit scene: one real place from the world
 * catalog (Phase 6 step 1). The sun, season, ground and city style are
 * re-resolved from the scene's {place, date, time} choice, so every frame
 * is a pure function of the spec — nothing derived is stored.
 *
 * The pose follows the scene's camera style with a slow deterministic dolly.
 * Phase 3's cinematic solver can take it over once the world grows anchor
 * tables.
 */
import { useMemo } from "react";
import { useCurrentFrame } from "remotion";
import type { SceneType } from "../../generator/spec.schema";
import { headingToGround, type Vec3 } from "../../world/geo";
import { GroundWorld } from "../../world/Ground";
import type { GroundPose } from "../../world/flight";
import { resolvePlace } from "../../world/places";

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const x = clamp01(v);
  return x * x * (3 - 2 * x);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale200 = (v: Vec3): Vec3 => [v[0] * 200, v[1] * 200, v[2] * 200];

/** Where the city keeps its cloud corridor (same as the inspector view). */
const CLOUD_PASSAGE: [number, number] = [-75, 0];

export const WorldStage: React.FC<{ scene: SceneType; fps?: number }> = ({ scene, fps = 30 }) => {
  const frame = useCurrentFrame();
  const world = scene.world;
  const resolved = useMemo(
    () => (world ? resolvePlace(world.place, { date: world.date, time: world.time }) : null),
    [world?.place, world?.date, world?.time],
  );
  if (!world || !resolved) return null;
  const dur = Math.max(0.5, scene.to - scene.from);
  const localT = clamp01((frame / fps) / dur);
  const style = typeof scene.camera === "string" ? (scene.camera as string) : "steady-push";
  // The portrait fov from the inspector view; the landscape value is set in
  // Phase 3 together with the aspect-aware camera.
  const fov: number = 62;
  return <GroundWorld place={resolved} pose={worldPose(style, localT)} fov={fov} cloudPassage={CLOUD_PASSAGE} />;
};

/** Camera pose for a world scene at local time u (0..1), by camera style. */
function worldPose(style: string, u: number): GroundPose {
  const view = (headingDeg: number, pitch: number, pos: Vec3): GroundPose => ({
    pos,
    target: add(pos, scale200(headingToGround(headingDeg, pitch))),
  });
  // Face along the avenue (+x); the flight's B arrival walks east, so a
  // westward dolly keeps one continuous reading of the city's depth.
  if (style === "walk-through") return view(90, 4, [-70 + 40 * u, 4.4, 3]);
  if (style === "steady-push") return view(90, 12, [-50, 16 + 5 * u, 6]);
  if (style === "crane-reveal") return view(90, lerp(8, -30, smooth(u)), [-70, 9 + 55 * smooth(u), 0]);
  if (style === "drone-top") return view(90, -55, [-55 + 12 * u, 240, 0]);
  // Unknown/absent styles: a slow high dolly, close enough to every place.
  return view(90, 10, [-60, 24 + 6 * u, 4]);
}