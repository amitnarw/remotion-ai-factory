/**
 * WorldStage.tsx — a "world" kit scene: one real place from the world
 * catalog (Phase 6 step 1). The sun, season, ground and city style are
 * re-resolved from the scene's {place, date, time} choice, so every frame
 * is a pure function of the spec — nothing derived is stored.
 *
 * Camera (Phase 3): while spec.shots has a shot for this moment, the scene
 * is filmed through the same solver the other kits use
 * (src/generator/camera/solve.ts). The subject is the featured actor the
 * shot names (a moving subject, planned with planActor/planCast so the pose
 * is frame-accurate), else one of the city's anchor spots
 * (cityAnchors.ts: avenue, sidewalks, plaza, park, landmark). An unknown
 * subject falls back to "scene"; a scene with no shots falls back to the
 * stand-in pose below — nothing crashes when there is no shot or anchor.
 *
 * The solved camera is applied AFTER GroundWorld's own camera write each
 * frame (SolvedLens below, mounted after <GroundWorld>), so the solver's
 * full pose — including dutch and handheld roll — lands on the lens, with
 * a near plane that can film at arm's length.
 */
import { useMemo } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { SceneType, ShotSpec } from "../../generator/spec.schema";
import { solveShot, type CameraPose } from "../../generator/camera/solve";
import { worldShotSet } from "../../generator/camera/world";
import { headingToGround, type Vec3 } from "../../world/geo";
import { GroundWorld } from "../../world/Ground";
import type { GroundPose } from "../../world/flight";
import { resolvePlace } from "../../world/places";
import { whipYaw } from "../TransitionOverlay";

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

export const WorldStage: React.FC<{ scene: SceneType; spec?: ShotSpec; fps?: number }> = ({ scene, spec, fps = 30 }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const world = scene.world;
  const resolved = useMemo(
    () => (world ? resolvePlace(world.place, { date: world.date, time: world.time }) : null),
    [world],
  );
  // Anchor + cast tables: the city layout is generated with exactly the
  // arguments GroundWorld draws with, so the camera's subjects sit on the
  // set it renders, and its own plan of the cast matches these.
  const shots = useMemo(() => (resolved ? worldShotSet(scene, resolved, CLOUD_PASSAGE) : null), [scene, resolved]);
  if (!world || !resolved) return null;
  const t = frame / (fps || 30);
  const dur = Math.max(0.5, scene.to - scene.from);
  const localT = clamp01(t / dur);
  const style = typeof scene.camera === "string" ? (scene.camera as string) : "steady-push";
  const aspect = width / Math.max(1, height);

  // A shot for this moment? The subject is the actor or city spot the shot
  // names (aliases included); an unknown name falls back to the whole scene.
  const specShot = spec?.shots?.find((s) => t >= s.from && t < s.to);
  const anchor = specShot && shots ? shots.subjects[specShot.subject] ?? shots.subjects.scene : undefined;

  let cameraPose: CameraPose | null = null;
  if (specShot && anchor) {
    const subject = anchor(t);
    const seconds = Math.max(0.1, specShot.to - specShot.from);
    cameraPose = solveShot(specShot, subject, {
      aspect,
      u: (t - specShot.from) / seconds,
      seconds,
      seed: `${specShot.beat ?? specShot.from}`,
      lagged: specShot.move === "follow" ? anchor(t - 0.35) : undefined,
    });
  }

  const pose: GroundPose = cameraPose
    ? { pos: cameraPose.position, target: cameraPose.target }
    : worldPose(style, localT);
  // The portrait fov from the inspector view; the landscape value follows the
  // aspect-aware camera (the solver gives its own fov for solved shots).
  const fov = cameraPose ? cameraPose.fov : aspect < 1 ? 62 : 42;

  return (
    <>
      <GroundWorld
        place={resolved}
        pose={pose}
        fov={fov}
        cloudPassage={CLOUD_PASSAGE}
        cast={shots?.castScripts}
      />
      {cameraPose && (
        // Overrides GroundWorld's own camera write afterwards each frame:
        // the solver's full pose (dutch/handheld roll included) and a near
        // plane that keeps arm's-length close-ups from clipping the subject.
        <SolvedLens pose={cameraPose} whip={whipYaw(spec?.transitions, t)} />
      )}
    </>
  );
};

const UP = new THREE.Vector3(0, 1, 0);

/** Applies a solved camera pose to the stage's camera, after GroundWorld's. */
function SolvedLens({ pose, whip }: { pose: CameraPose; whip: number }) {
  const { camera } = useThree();
  useFrame(() => {
    const cam = camera as THREE.PerspectiveCamera;
    cam.position.set(...pose.position);
    cam.quaternion.set(...pose.quaternion);
    // A whip pan between scenes turns the camera fast through the cut.
    if (whip !== 0) cam.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(UP, whip));
    if (Math.abs(cam.fov - pose.fov) > 1e-4 || cam.near !== 0.05 || cam.far !== 70_000) {
      cam.fov = pose.fov;
      cam.near = 0.05;
      cam.far = 70_000;
      cam.updateProjectionMatrix();
    }
  });
  return null;
}

/** Camera pose for a world scene at local time u (0..1), by camera style
 *  (the stand-in rig, used when no shot films the scene). */
function worldPose(style: string, u: number): GroundPose {
  const view = (headingDeg: number, pitch: number, pos: Vec3): GroundPose => ({
    pos,
    target: add(pos, scale200(headingToGround(headingDeg, pitch))),
  });
  // Face along the avenue (+x); the flight's B arrival walks east, so a
  // westward dolly keeps one continuous reading of the city's depth.
  if (style === "walk-through") return view(90, 4, [-70 + 40 * u, 4.4, 3]);
  if (style === "steady-push") return view(90, 20, [-46, 8.5 + 2.5 * u, 6]);
  if (style === "crane-reveal") return view(90, lerp(8, -30, smooth(u)), [-70, 9 + 55 * smooth(u), 0]);
  if (style === "drone-top") return view(90, -55, [-55 + 12 * u, 240, 0]);
  // Unknown/absent styles: a slow high dolly, close enough to every place.
  return view(90, 10, [-60, 24 + 6 * u, 4]);
}
