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
 * a near plane that can film at arm's length at street level and grows with
 * the lens's height (lensNear), so the far city keeps its depth precision.
 *
 * Lens clearance lives in the anchors (generator/camera/world.ts): bounds,
 * ground and facing per subject; worldShot films the avenue down its axis.
 * solveWorldShot films a shot: in a scene whose story lifts buildings it
 * keeps the lens out of their space, and over a flood the anchors hold the
 * lens above the water.
 */
import { useMemo } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { SceneType, ShotSpec } from "../../generator/spec.schema";
import type { CameraPose } from "../../generator/camera/solve";
import { solveWorldShot, worldShotSet } from "../../generator/camera/world";
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
  // set it renders, and its own plan of the cast matches these. With the
  // spec, the lens keeps out of the buildings the story lifts and above a
  // flood (planned as GroundWorld plans them).
  const shots = useMemo(() => (resolved ? worldShotSet(scene, resolved, CLOUD_PASSAGE, spec) : null), [scene, resolved, spec]);
  const aspect = width / Math.max(1, height);

  // The camera at video time t: a pure function of the spec, used for this
  // frame and for the scene's whole path below.
  const cameraAt = useMemo(() => {
    const dur = Math.max(0.5, scene.to - scene.from);
    const style = typeof scene.camera === "string" ? (scene.camera as string) : "steady-push";
    return (t: number): { pose: GroundPose; fov: number; solved: CameraPose | null } => {
      // A shot for this moment? The subject is the actor or city spot the shot
      // names (aliases included); an unknown name falls back to the whole scene.
      const found = spec?.shots?.find((s) => t >= s.from && t < s.to);
      if (found && shots) {
        // The avenue is filmed down its axis (an "auto" side becomes "front");
        // the anchor knows the shot's size (a wide park shot rises over the
        // canopy) and span (a flood's lens floor is held for the shot); in a
        // lift scene the shot keeps its lens clear of the lifting buildings.
        const solved = solveWorldShot(shots, found, t, aspect);
        return { pose: { pos: solved.position, target: solved.target }, fov: solved.fov, solved };
      }
      // The portrait fov from the inspector view; the landscape value follows the
      // aspect-aware camera (the solver gives its own fov for solved shots).
      return { pose: worldPose(style, clamp01(t / dur)), fov: aspect < 1 ? 62 : 42, solved: null };
    };
  }, [scene, spec, shots, aspect]);
  // Every lens position the scene uses (every quarter second): the kit core
  // fixes which buildings keep their kit pieces for the whole scene, so no
  // building switches to its far card on screen (as the flights do).
  const lodPath = useMemo(() => {
    const path: Vec3[] = [];
    for (let t = scene.from; t < scene.to; t += 0.25) path.push(cameraAt(t).pose.pos);
    path.push(cameraAt(Math.max(scene.from, scene.to - 1e-3)).pose.pos);
    return path;
  }, [cameraAt, scene]);
  if (!world || !resolved) return null;
  const t = frame / (fps || 30);
  const { pose, fov, solved: cameraPose } = cameraAt(t);
  const near = cameraPose ? lensNear(cameraPose) : 0.05;

  return (
    <>
      <GroundWorld
        place={resolved}
        pose={pose}
        fov={fov}
        cloudPassage={CLOUD_PASSAGE}
        lodPath={lodPath}
        cast={shots?.castScripts}
        // The writer's mood (spec.story) drives the world's toon palette.
        mood={spec?.story?.mood}
        // The counter's reaction and the world events (react/): the place
        // physically reacts to the story.
        reaction={spec ? { spec, scene, t } : undefined}
      />
      {cameraPose && (
        // Overrides GroundWorld's own camera write afterwards each frame:
        // the solver's full pose (dutch/handheld roll included) and a near
        // plane that keeps arm's-length close-ups from clipping the subject.
        <SolvedLens pose={cameraPose} near={near} whip={whipYaw(spec?.transitions, t)} />
      )}
    </>
  );
};

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Near plane for a solved pose: 5 cm at street level (arm's-length
 * close-ups), growing with the lens's height over the city (2 %, as
 * GroundWorld's own camera) but never past a twentieth of the way to the
 * subject. A fixed 5 cm under a 70 km far plane left a high shot's far city
 * metres of depth precision: the ground layers (slab 4 cm, avenue 12 cm,
 * terrain 0) z-fought into dark blotches (Cairo at night, EWS/FS high).
 * The main canvas has no logarithmic depth buffer (the flight's has).
 */
export function lensNear(pose: CameraPose): number {
  const [x, y, z] = pose.position;
  const reach = Math.hypot(pose.target[0] - x, pose.target[1] - y, pose.target[2] - z);
  return Math.max(0.05, Math.min(Math.max(0, y) * 0.02, reach * 0.05, 10));
}

/** Applies a solved camera pose to the stage's camera, after GroundWorld's. */
function SolvedLens({ pose, near, whip }: { pose: CameraPose; near: number; whip: number }) {
  const { camera } = useThree();
  useFrame(() => {
    const cam = camera as THREE.PerspectiveCamera;
    cam.position.set(...pose.position);
    cam.quaternion.set(...pose.quaternion);
    // A whip pan between scenes turns the camera fast through the cut.
    if (whip !== 0) cam.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(UP, whip));
    if (Math.abs(cam.fov - pose.fov) > 1e-4 || cam.near !== near || cam.far !== 70_000) {
      cam.fov = pose.fov;
      cam.near = near;
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
