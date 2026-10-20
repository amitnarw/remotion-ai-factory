/**
 * src/compositions/glb.tsx
 *
 * Shared GLB-loading machinery for every 3D stage (AssetStage, StreetStage):
 *   • One delayRender gate per model file, so still/frame captures wait until
 *     every GLB resolved (renders show real models, never the Suspense fallback).
 *   • ModelBoundary + Suspense: a missing file (setup-assets not run) degrades to
 *     a deterministic procedural stand-in instead of crashing the render.
 *   • useGltfPaint: after the model resolves, paint the real asset into the
 *     current canvas frame, then release the gate.
 */
import { Suspense, Component, useEffect } from "react";
import type { ReactNode } from "react";
import { staticFile, delayRender, continueRender } from "remotion";
import { useGLTF } from "@react-three/drei";
import { useThree } from "@react-three/fiber";

const GLB_LOAD_ERRORS = new Set<string>();

// One render gate per model file: the still/frame capture must wait until
// every GLB is resolved. Released on success (useGltfPaint) and on failure
// (boundary catch).
const PENDING_MODEL_GATES = new Map<string, number>();
const RELEASED_MODEL_GATES = new Set<string>();

function gateModelLoad(file: string) {
  // Render-body safe: once a gate was released (or failed) it must never be
  // re-created on a later re-render, or the new handle would leak forever
  // (renders stall with "model loading" never cleared).
  if (PENDING_MODEL_GATES.has(file) || RELEASED_MODEL_GATES.has(file)) return;
  const handle = delayRender(`3D model loading: ${file}`, { timeoutInMilliseconds: 60000 });
  PENDING_MODEL_GATES.set(file, handle);
}

export function releaseModelLoad(file: string) {
  const handle = PENDING_MODEL_GATES.get(file);
  RELEASED_MODEL_GATES.add(file);
  if (handle == null) return;
  continueRender(handle);
  PENDING_MODEL_GATES.delete(file);
}

/** One console warning per missing model, with the exact fix. */
function modelMissingWarning(label: string, file: string) {
  releaseModelLoad(file);
  if (GLB_LOAD_ERRORS.has(label)) return;
  GLB_LOAD_ERRORS.add(label);
  console.warn(
    `3D scene: model "${label}" is not installed — run "npm run assets" to download the free CC0 model packs (characters, city, nature), then refresh. Stand-in shapes are shown until then.`,
  );
}

/**
 * ModelBoundary: class error boundary around one GLB load. The load suspends
 * (Suspense below) and fails (this boundary catches) if the file is missing.
 */
class ModelBoundary extends Component<{ onError: (error: unknown) => void; fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { this.props.onError(error); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** Boundary + Suspense pair shared by every GLB-consuming piece. */
export function GlbSuspense({ file, label, fallback, children }: { file: string; label: string; fallback: ReactNode; children: ReactNode }) {
  gateModelLoad(file);
  return (
    <ModelBoundary onError={() => modelMissingWarning(label, file)} fallback={fallback}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </ModelBoundary>
  );
}

/**
 * Inside a GlbSuspense-resolved component: load the GLB, paint the real asset
 * into the current canvas frame, then release the load gate. Without the
 * flush the captured frame is the stale pre-load backbuffer, because R3F's
 * frame loop already advanced past the mount.
 */
export function useGltfPaint(file: string) {
  const gltf = useGLTF(staticFile(file));
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    gl.render(scene, camera);
    releaseModelLoad(file);
  }, [file, gl, scene, camera]);
  return gltf;
}
