/**
 * scene/main.ts — the browser entry for method B.
 *
 * The renderer (../renderer.ts) bundles this with three, serves it, and calls
 * window.renderAt(t) once per frame. All state is derived from t, so the same
 * frame number always produces the same pixels.
 */
import * as THREE from "three";
import { buildSea } from "./sea";

interface SceneData {
  title: string;
  fps: number;
  duration: number;
  width: number;
  height: number;
  recipe: string;
}

interface RendererWindow extends Window {
  __SCENE_DATA__: SceneData;
  __ready?: boolean;
  renderAt: (t: number) => void;
}

const w = window as unknown as RendererWindow;
const data = w.__SCENE_DATA__;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.setClearColor("#0d2634");
document.body.appendChild(renderer.domElement);

const recipes: Record<string, (duration: number) => ReturnType<typeof buildSea>> = {
  sea: buildSea,
};

const build = recipes[data.recipe];
if (!build) throw new Error(`animation: unknown recipe "${data.recipe}" (have ${Object.keys(recipes).join(", ")})`);
const built = build(data.duration);
built.camera.aspect = window.innerWidth / window.innerHeight;
built.camera.updateProjectionMatrix();

w.renderAt = (t: number) => {
  built.update(t);
  renderer.render(built.scene, built.camera);
};

// Render frame 0 before announcing readiness, so a screenshot taken the moment
// after __ready is never a blank canvas.
w.renderAt(0);
w.__ready = true;
