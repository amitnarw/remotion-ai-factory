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
 *
 * A time lapse (scene.world.lapse, docs/factory/13-light-and-time.md): the
 * scene's clock (world/lapse.ts) is made once, and GroundWorld builds the
 * place at the clock's start (a stable object, so the city is never rebuilt
 * on a frame) and lights it every frame from the clock at t. The camera
 * plans its light side from the start's sun too: the shots are framed for
 * the light the scene opens on.
 *
 * Weather (docs/factory/18-world-weather.md): the director's look.weather
 * (rain, storm, snow), timed by the scene's rain-start / rain-stop events,
 * is planned once per scene (world/weather/weather.ts) and drawn round the
 * lens by GroundWorld. A scene without weather passes none.
 *
 * Bullet time (scene.bulletTime, docs/factory/14-bullet-time.md): the
 * scene's clocks (world/warp.ts) are made once. The camera, the grade and
 * everything on screen over the place stay on real time t; the place lives
 * on the world clock w(t): its reaction (with the story's events and steps
 * moved onto w, so they still land on their real moments), its traffic (the
 * lens seen through the clock's inverse, the lanes round the arc kept
 * clear), its weather, and, inside GroundWorld, the sway, water, birds,
 * flags and the cast (the hero on its own faster clock). The projectiles are
 * planned once from the same cast. A scene without one passes exactly what
 * it always did.
 *
 * Effects (scene.vfx, docs/factory/21-vfx-effekseer.md): the director's
 * explosions, fires, smoke, sparks, impacts and magic, on the place's clock
 * (a bullet time slows them with the world), drawn by GroundWorld on their
 * spots. A scene that lists none passes none.
 */
import { useMemo } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { SceneType, ShotSpec } from "../../generator/spec.schema";
import type { CameraPose } from "../../generator/camera/solve";
import { castWalkers, solveWorldShot, worldShotSet } from "../../generator/camera/world";
import { cityWalls, sceneProjectiles } from "../../world/projectiles";
import { sceneClock, warpSpecTimes } from "../../world/warp";
import { headingToGround, type Vec3 } from "../../world/geo";
import { GroundWorld } from "../../world/Ground";
import type { GroundPose } from "../../world/flight";
import { lapseClock } from "../../world/lapse";
import { resolvePlace } from "../../world/places";
import { worldWeather } from "../../world/weather/weather";
import { sceneVfx, specEffects } from "../../world/vfx/spec";
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
  // A time lapse's clock (null without one), once per scene.
  const clock = useMemo(() => (world ? lapseClock(world, scene) : null), [world, scene]);
  const placeAt = useMemo(
    () => (world ? resolvePlace(world.place, { date: world.date, time: world.time }) : null),
    [world],
  );
  // The place GroundWorld builds and the camera plans with: with a lapse its
  // clock's start (the same moment, a stable object).
  const resolved = clock ? clock.start : placeAt;
  // A bullet time's clocks (null without one), and the story's world-timed
  // moments on the world's clock (the spec itself without one).
  const bullet = useMemo(() => sceneClock(scene), [scene]);
  const worldSpec = useMemo(() => (spec ? warpSpecTimes(spec, bullet) : spec), [spec, bullet]);
  // Anchor + cast tables: the city layout is generated with exactly the
  // arguments GroundWorld draws with, so the camera's subjects sit on the
  // set it renders, and its own plan of the cast matches these. With the
  // spec, the lens keeps out of the buildings the story lifts and above a
  // flood (planned as GroundWorld plans them).
  const shots = useMemo(() => (resolved ? worldShotSet(scene, resolved, CLOUD_PASSAGE, worldSpec) : null), [scene, resolved, worldSpec]);
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
  // The lens at any video time and where it looks: the traffic keeps out of
  // its way and drives wherever it can see. The traffic runs on the world's
  // clock: in a bullet time it sees the lens at the real moment its time is.
  const lensAt = useMemo(() => (bullet ? (tt: number) => cameraAt(bullet.worldToReal(tt)).pose.pos : (tt: number) => cameraAt(tt).pose.pos), [cameraAt, bullet]);
  const aimAt = useMemo(() => (bullet ? (tt: number) => cameraAt(bullet.worldToReal(tt)).pose.target : (tt: number) => cameraAt(tt).pose.target), [cameraAt, bullet]);
  // The featured actors' footprints: the cars stop for one in the road. In a
  // bullet time the arc's lens path joins them from 2 s of world time before
  // the window, so the lanes it sweeps over are clear before it comes.
  const walkers = useMemo(() => {
    const cast = shots ? castWalkers(shots.plans) : undefined;
    const arc = bullet ? spec?.shots?.find((sh) => sh.move === "arc" && sh.from >= scene.from && sh.to <= scene.to) : undefined;
    if (!bullet || !arc) return cast;
    const pts: [number, number, number][] = [];
    for (let tt = arc.from; tt < arc.to + 1e-6; tt += 0.2) {
      const p = cameraAt(Math.min(tt, arc.to - 1e-3)).pose.pos;
      pts.push([p[0], p[2], 1.2]);
    }
    const w0 = bullet.world(arc.from) - 2;
    const w1 = bullet.world(arc.to) + 0.5;
    return (tt: number) => [...(cast?.(tt) ?? []), ...(tt >= w0 && tt <= w1 ? pts : [])];
  }, [shots, bullet, spec, scene, cameraAt]);
  // The director's weather over this scene (null: none chosen), on the world's clock.
  const weather = useMemo(() => worldWeather(scene, worldSpec?.worldEvents), [scene, worldSpec]);
  // A bullet time's projectiles, planned on the same cast and walls the
  // assembler checked (none without one, or with none listed).
  const projectiles = useMemo(() => {
    if (!bullet || !resolved || !shots?.layout || !scene.bulletTime?.projectiles?.length) return null;
    const plan = sceneProjectiles(scene, resolved, { table: shots.table, walls: cityWalls(shots.layout, resolved.style.floorHeight) });
    return plan ? plan.projectiles : null;
  }, [bullet, resolved, shots, scene]);
  // The director's effects over this scene on the place's clock (null: none listed).
  const vfx = useMemo(() => {
    const list = sceneVfx(scene);
    return list.length ? specEffects(list, scene, bullet ? (tt) => bullet.world(tt) : undefined) : null;
  }, [scene, bullet]);
  if (!world || !resolved) return null;
  const t = frame / (fps || 30);
  // The place's own time (t itself without a bullet time).
  const wt = bullet ? bullet.world(t) : t;
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
        reaction={worldSpec ? { spec: worldSpec, scene, t: wt } : undefined}
        // The place's traffic over this scene (world/traffic.ts).
        traffic={{ scene, t: wt, lens: lensAt, aim: aimAt, walkers }}
        // A time lapse: the light follows the clock at t.
        lapse={clock ? { clock, t } : undefined}
        // Rain, a storm or snow, when the director chose one.
        weather={weather ? { plan: weather, t: wt } : undefined}
        // Bullet time: the place's own clocks, and the projectiles.
        bullet={bullet ? { clock: bullet, projectiles: projectiles ?? [], seed: `${resolved.place.id}:${scene.from}` } : undefined}
        // The director's effects, when the scene lists some.
        vfx={vfx ? { effects: vfx, t: wt } : undefined}
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
