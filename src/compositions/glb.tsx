/**
 * src/compositions/glb.tsx
 *
 * Shared GLB-loading machinery for every 3D stage (AssetStage, OceanStage, StreetStage):
 *   • One delayRender hold per GlbSuspense, from its mount until the frame was
 *     drawn with its model (or its stand-in) in the scene, so a still/frame
 *     capture never misses a model.
 *   • ModelBoundary + Suspense: a missing file (setup-assets not run) degrades to
 *     a deterministic procedural stand-in instead of crashing the render.
 *   • The draw before a release is R3F's advance(): every frame callback (the
 *     camera rig) and the grade's EffectComposer, exactly as ThreeCanvas draws
 *     a frame. It used to be a bare gl.render(scene, camera): the last model of
 *     a tab's first frame left the canvas ungraded, and that is what was
 *     captured (the first `concurrency` frames of every render looked flat).
 */
import { Suspense, Component, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { staticFile, delayRender, continueRender } from "remotion";
import { useGLTF } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import type { RenderItem } from "three";

const GLB_LOAD_ERRORS = new Set<string>();

/**
 * Opaque meshes in the order three visits the scene (React's tree order; the
 * sort is stable), instead of by material id. A model's materials are made
 * when its file arrives (or its clone mounts), which differs from tab to tab,
 * so where two meshes meet at the same depth (a lamp arm through a tree's
 * crown, a bush standing in the water) the pixel went to one or the other
 * from run to run. Transparent meshes keep three's back-to-front sort.
 */
const sceneOrder = (a: RenderItem, b: RenderItem) => a.groupOrder - b.groupOrder || a.renderOrder - b.renderOrder;
/** three's own opaque sort (setOpaqueSort's type has no null). */
const THREE_ORDER = null as unknown as typeof sceneOrder;

/** For a kit stage: its opaque meshes draw in scene order while it is mounted (a mesh that mounts
 *  mid-scene, a model that arrives late, would otherwise draw by when its material was made). */
export function useSceneDrawOrder() {
  const gl = useThree((s) => s.gl);
  useLayoutEffect(() => {
    gl.setOpaqueSort(sceneOrder);
    return () => gl.setOpaqueSort(THREE_ORDER);
  }, [gl]);
}

/**
 * Model holds retry: a fetch that fails mid-render (seen: net::ERR_NETWORK_CHANGED
 * when the laptop's network switched) can leave the GLTF loader hanging, and the
 * hold then times out. Remotion reloads the tab and tries the frame again
 * instead of failing the whole video.
 */
const MODEL_GATE = { timeoutInMilliseconds: 60000, retries: 2 };

/**
 * Draws once, then releases every hold that asked in the same go. The effects
 * of one commit run back to back and the microtask runs after the last of
 * them, so the draw has every model that commit brought (a street brings dozens
 * at once; one draw each cost a second per tab).
 */
const PAINTS = new Map<(timestamp: number) => void, Array<() => void>>();
function paintThenRelease(advance: (timestamp: number) => void, release: () => void) {
  const queued = PAINTS.get(advance);
  if (queued) {
    queued.push(release);
    return;
  }
  PAINTS.set(advance, [release]);
  queueMicrotask(() => {
    const releases = PAINTS.get(advance) ?? [];
    PAINTS.delete(advance);
    // The timestamp only feeds useFrame's delta; nothing in the stages reads it.
    advance(performance.now());
    for (const release of releases) release();
  });
}

/**
 * This boundary's hold: taken in a layout effect (it runs before ThreeCanvas
 * releases the frame, and a render React throws away takes nothing), released
 * by `paint` after the next draw, or when the boundary unmounts.
 */
function useModelHold(file: string): () => void {
  const advance = useThree((s) => s.advance);
  const hold = useRef<number | null>(null);
  useLayoutEffect(() => {
    hold.current = delayRender(`3D model loading: ${file}`, MODEL_GATE);
    return () => {
      if (hold.current !== null) continueRender(hold.current);
      hold.current = null;
    };
  }, [file]);
  return useCallback(() => {
    const handle = hold.current;
    if (handle === null) return;
    hold.current = null;
    paintThenRelease(advance, () => continueRender(handle));
    // A new file is a new hold, to be painted again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advance, file]);
}

/** One console warning per missing model, with the exact fix. */
function modelMissingWarning(label: string) {
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

type ModelStatus = "pending" | "ok" | "missing";
const MODEL_STATUS = new Map<string, "ok" | "missing">();

/**
 * Check that the file exists BEFORE the GLTF loader runs. A rejected loader
 * request is not reliably caught by React error boundaries inside the Remotion
 * render (it fails the whole render), so a missing model is detected up front
 * and simply never loaded. The boundary's hold covers the check.
 */
function useModelStatus(file: string): ModelStatus {
  const [status, setStatus] = useState<ModelStatus>(() => MODEL_STATUS.get(file) ?? "pending");
  useEffect(() => {
    const known = MODEL_STATUS.get(file);
    if (known) {
      setStatus(known);
      return;
    }
    let cancelled = false;
    fetch(staticFile(file), { cache: "no-store" })
      .then(async (res) => {
        if (res.ok) {
          await res.body?.cancel();
          return "ok" as const;
        }
        return "missing" as const;
      })
      .catch(() => "missing" as const)
      .then((result) => {
        MODEL_STATUS.set(file, result);
        if (!cancelled) setStatus(result);
      });
    return () => {
      cancelled = true;
    };
  }, [file]);
  return status;
}

/** Mounts with the boundary's content, after it: its effect runs once the model is in the scene. */
function Painted({ onPainted }: { onPainted: () => void }) {
  useEffect(() => onPainted(), [onPainted]);
  return null;
}

/**
 * Model gate shared by every GLB-consuming piece: a missing file shows the
 * fallback (with one console warning) and never reaches the GLTF loader; a
 * present file loads under its Suspense + error boundary. Either way the
 * frame is drawn with what the boundary shows before its hold is released.
 */
export function GlbSuspense({ file, label, fallback, children }: { file: string; label: string; fallback: ReactNode; children: ReactNode }) {
  const paint = useModelHold(file);
  const status = useModelStatus(file);
  const [failed, setFailed] = useState(false);
  // A missing or broken file: the stand-in is what this boundary shows.
  useEffect(() => {
    if (status === "missing" || failed) paint();
  }, [status, failed, paint]);
  if (status === "missing") {
    modelMissingWarning(label);
    return <>{fallback}</>;
  }
  if (status === "pending") return <>{fallback}</>;
  return (
    <ModelBoundary
      onError={() => {
        modelMissingWarning(label);
        setFailed(true);
      }}
      fallback={fallback}
    >
      <Suspense fallback={fallback}>
        {children}
        <Painted onPainted={paint} />
      </Suspense>
    </ModelBoundary>
  );
}

/**
 * Inside a GlbSuspense-resolved component: the loaded GLB. The boundary draws
 * the frame once the component is in the scene, then releases its hold.
 */
export function useGltfPaint(file: string) {
  return useGLTF(staticFile(file));
}
