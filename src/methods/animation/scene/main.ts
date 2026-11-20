/**
 * scene/main.ts — the browser entry for method B.
 *
 * The renderer (../renderer.ts) bundles this with three, serves it, and calls
 * window.renderAt(t) once per frame. All state is derived from t, so the same
 * frame number always produces the same pixels.
 *
 * Captions live in a DOM layer above the canvas (./overlay.ts), drawn with the
 * spec's own CaptionLook — the same words and the same look the factory uses,
 * captured in the same screenshot as the 3D frame. A data film adds its own
 * readout (./depth-hud.ts) one layer below.
 */
import * as THREE from "three";
import { captionFontFaceCss, CAPTION_FACES, CAPTION_FONT_FAMILY } from "../../../generator/caption-fonts";
import { buildDepth, type DepthBlock } from "./depth";
import { mountDepthHud } from "./depth-hud";
import { mountCaptions, type SceneCaption } from "./overlay";
import { buildSea } from "./sea";

interface SceneData {
  title: string;
  fps: number;
  duration: number;
  width: number;
  height: number;
  recipe: string;
  data?: DepthBlock;
  captions?: SceneCaption[];
  captionLook?: Parameters<typeof mountCaptions>[1];
  captionPlateFont?: Parameters<typeof mountCaptions>[2];
  captionsEnabled?: boolean;
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

const built = (() => {
  if (data.recipe === "depth") {
    if (!data.data) throw new Error('animation: recipe "depth" needs spec.data (kind "depth") — see docs/factory/23-visual-methods.md Phase 3b');
    return buildDepth(data.duration, data.data);
  }
  if (data.recipe === "sea") return buildSea(data.duration);
  throw new Error(`animation: unknown recipe "${data.recipe}" (have sea, depth)`);
})();
built.camera.aspect = window.innerWidth / window.innerHeight;
built.camera.updateProjectionMatrix();

// Captions: shared content, drawn over the canvas with the shared look.
const fonts = document.createElement("style");
fonts.textContent = captionFontFaceCss("./");
document.head.appendChild(fonts);

const captions = data.captionsEnabled === false ? [] : (data.captions ?? []);
const layer = data.captionLook ? mountCaptions(captions, data.captionLook, data.captionPlateFont) : null;
const hud = data.recipe === "depth" && data.data ? mountDepthHud(data.data, data.duration) : null;

w.renderAt = (t: number) => {
  built.update(t);
  renderer.render(built.scene, built.camera);
  hud?.update(t);
  layer?.update(t);
};

// Render frame 0 before announcing readiness, so a screenshot taken the moment
// after __ready is never a blank canvas. Wait for the caption face first, then
// repaint so frame 0 carries the real font, not a fallback.
w.renderAt(0);

async function waitForFonts(): Promise<void> {
  if (!data.captionLook) return;
  const family = CAPTION_FONT_FAMILY[data.captionLook.font] ?? "Georgia";
  const faces = CAPTION_FACES.filter((f) => f.family === family);
  await Promise.allSettled(faces.map((f) => document.fonts.load(`${f.style ?? "normal"} ${f.weight} 40px "${f.family}"`)));
  await document.fonts.ready;
}

void waitForFonts().finally(() => {
  w.renderAt(0);
  w.__ready = true;
});
