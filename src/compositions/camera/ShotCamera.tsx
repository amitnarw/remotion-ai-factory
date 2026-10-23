/**
 * ShotCamera.tsx — films a stage with the director's shots (Phase 3).
 *
 * A stage passes its anchors (the subjects it can frame, as functions of time)
 * and its own camera rig as the fallback. While a shot in spec.shots is active
 * and the stage knows its subject, the camera solver places the camera
 * (src/generator/camera/solve.ts); otherwise the stage's rig runs as before.
 * Everything is a pure function of the frame, like the rigs it replaces.
 */
import * as React from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { solveShot, type Subject } from "../../generator/camera/solve";
import type { ShotSpec, SpecShot, SpecTransition } from "../../generator/spec.schema";
import { whipYaw } from "../TransitionOverlay";

/** Subject name -> where it is (and how big) at time t in seconds. */
export type Anchors = Record<string, (t: number) => Subject>;

/** How far behind its subject a "follow" camera trails, in seconds. */
const FOLLOW_LAG = 0.35;

/** The shot on screen at time t, if any. */
export function activeShot(spec: ShotSpec, t: number): SpecShot | undefined {
  return spec.shots?.find((s) => t >= s.from && t < s.to);
}

const UP = new THREE.Vector3(0, 1, 0);

function SolvedCamera({ shot, anchor, t, transitions }: { shot: SpecShot; anchor: (t: number) => Subject; t: number; transitions?: SpecTransition[] }) {
  const { camera, size } = useThree();
  useFrame(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const seconds = Math.max(0.1, shot.to - shot.from);
    const subject = anchor(t);
    const pose = solveShot(shot, subject, {
      aspect: size.width / Math.max(1, size.height),
      u: (t - shot.from) / seconds,
      seconds,
      seed: `${shot.beat ?? shot.from}`,
      lagged: shot.move === "follow" ? anchor(t - FOLLOW_LAG) : undefined,
    });
    cam.position.set(...pose.position);
    cam.quaternion.set(...pose.quaternion);
    // A whip pan between scenes turns the camera fast through the cut.
    const whip = whipYaw(transitions, t);
    if (whip !== 0) cam.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(UP, whip));
    const far = Math.max(2200, Math.hypot(...pose.position) * 4 + subject.radius * 40);
    if (Math.abs(cam.fov - pose.fov) > 1e-4 || cam.far < far || cam.near !== 0.05) {
      cam.fov = pose.fov;
      cam.near = 0.05;
      cam.far = far;
      cam.updateProjectionMatrix();
    }
  });
  return null;
}

/**
 * The stage's camera. `fallback` is the stage's own rig, used when there is no
 * shot at this moment or the shot names a subject this stage doesn't have
 * (then "scene" is tried first).
 */
export function ShotCamera({ spec, anchors, fallback }: { spec: ShotSpec; anchors: Anchors; fallback: React.ReactNode }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / (fps || 30);
  const shot = activeShot(spec, t);
  const anchor = shot ? anchors[shot.subject] ?? anchors.scene : undefined;
  if (!shot || !anchor) return <>{fallback}</>;
  return <SolvedCamera shot={shot} anchor={anchor} t={t} transitions={spec.transitions} />;
}
