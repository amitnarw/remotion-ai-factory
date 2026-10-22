/**
 * WhatIfVideo/index.tsx — master composition.
 *
 * Renders a vertical 1080x1920 video from a ShotSpec:
 *   - 3D scene per spec.scenes[] (low-poly, pastel, simulation style, inside <ThreeCanvas>)
 *   - Hook card at spec.hook (HTML overlay)
 *   - Timer HUD + Captions synced to spec.timer / spec.captions (HTML overlays)
 *   - Audio cues from spec.events[].sfx + spec.audio.ambient (<Audio> cues)
 *
 * The timeline is driven by the same `t` values as the spec, so picture,
 * caption, timer and audio are frame-locked by construction.
 */
import { useCurrentFrame, useVideoConfig } from "remotion";
import * as React from "react";
import { Hook } from "../hud/Hook";
import { TimerHUD } from "../hud/TimerHUD";
import { Captions } from "../hud/Captions";
import { StatHud, ZoomVignette } from "../hud/StatHud";
import { CompositionAudio } from "./audio";
import { secToFrame } from "../../generator/timing";
import { ShotSpec } from "../../generator/spec.schema";
import { AssetStage } from "../AssetStage";
import { StreetStage } from "../StreetStage";
import { SpaceStage } from "../SpaceStage";
import { OceanStage } from "../OceanStage";
import { CountrysideStage } from "../CountrysideStage";
import { ForestStage } from "../ForestStage";
import { RiverStage } from "../RiverStage";
import { InteriorStage } from "../InteriorStage";
import { ThreeCanvas } from "@remotion/three";
import { CityScene } from "../scenes/CityScene";
import { FirstPersonScene } from "../scenes/FirstPersonScene";

type SceneKey = "city" | "first-person";

const sceneComponents: Record<
  SceneKey,
  React.FC<{ gravityOff: number | null; gravityOn: number | null }>
> = {
  city: CityScene,
  "first-person": FirstPersonScene,
};

/**
 * Resolve the active scene + physics modifiers at timeSec.
 */
function resolvePhysicsAt(spec: ShotSpec, timeSec: number) {
  const scene =
    spec.scenes.find((s) => timeSec >= s.from && timeSec < s.to) ??
    spec.scenes[spec.scenes.length - 1];

  const offEvents = (spec.events ?? []).filter((e) => e.name === "gravity_off");
  const onEvents = (spec.events ?? []).filter((e) => e.name === "gravity_on");
  const gravityOff = offEvents[0]?.t ?? scene.physics?.gravityOff ?? null;
  const gravityOn = onEvents[0]?.t ?? scene.physics?.gravityOn ?? null;
  return { scene, gravityOff, gravityOn };
}

interface WhatIfVideoProps {
  spec: ShotSpec;
  /** Remotion Studio preview frame; render path uses the live frame clock. */
  previewFrame?: number;
}

/* ------------------------------------------------------------------ */
/*  Cinematic texture overlays (pure HTML/CSS, zero dependencies)      */
/* ------------------------------------------------------------------ */

/** Film grain: animated SVG noise (feTurbulence) overlaid at low opacity,
 *  with a very soft color grade so blacks look crushed and highlights warm. */
function FilmGrain() {
  // The noise pattern is re-seeded from the frame number, so every frame gets
  // a different grain that is still identical on every re-render. (The old
  // CSS spin animation ran on wall-clock time and was not frame-accurate.)
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 25,
        pointerEvents: "none",
        mixBlendMode: "overlay",
        opacity: 0.12,
        filter: `contrast(1.08) saturate(1.04)`,
      }}
    >
      <svg width="100%" height="100%" style={{ display: "block" }}>
        <defs>
          <filter id="grain" x="0" y="0" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves="3"
              stitchTiles="stitch"
              seed={frame % 97}
            />
            <feComponentTransfer>
              <feFuncR type="linear" slope="0.6" intercept="0.7" />
              <feFuncG type="linear" slope="0.6" intercept="0.7" />
              <feFuncB type="linear" slope="0.6" intercept="0.7" />
            </feComponentTransfer>
          </filter>
        </defs>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>
    </div>
  );
}

/** Vignette: darkens corners and top/bottom edges so the street stays
 *  centered and the frame reads like a lens-captured shot. */
function Vignette() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 26,
        pointerEvents: "none",
        background: `radial-gradient(circle at 50% 55%, transparent 30%, rgba(0,0,0,0.35) 75%, rgba(0,0,0,0.55) 100%)`,
        mixBlendMode: "multiply",
        opacity: 0.55,
      }}
    />
  );
}

export const WhatIfVideo: React.FC<WhatIfVideoProps> = ({
  spec,
  previewFrame,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const fps = spec.fps ?? 30;
  const displayFrame = previewFrame ?? frame;
  const timeSec = displayFrame / fps;

  // --- resolve active scene ---------------------------------------------
  const { scene, gravityOff, gravityOn } = resolvePhysicsAt(spec, timeSec);
  const SceneComp = sceneComponents[scene.scene as SceneKey];
  const activeScene = scene; // SceneSchema entry — kit/cast present when asset-driven

  return (
    <div
      style={{
        width,
        height,
        background: "#000000",
        position: "relative",
        overflow: "hidden",
        display: "flex",
      }}
    >
      <ThreeCanvas
        width={width}
        height={height}
        style={{ width, height }}
        // Shadow maps: the stages already mark lights and meshes castShadow,
        // but without this flag every one of those is ignored.
        shadows
      >
        {activeScene.kit === "street-block" ? (
          // The dense populated street world (time-of-day looks + StatHud
          // escalation + traffic + crowd + human camera operator)
          <StreetStage spec={spec} scene={activeScene} />
        ) : activeScene.kit === "space" ? (
          // The cosmic world: procedural planets (earth/moon/mars), stars,
          // orbiting camera, planet-scale escalation on the beats
          <SpaceStage spec={spec} scene={activeScene} />
        ) : activeScene.kit === "ocean" ? (
          // The ocean world: waves to the horizon, beach, jetty, canoes —
          // water level reacts to stat beats + water events
          <OceanStage spec={spec} scene={activeScene} />
        ) : activeScene.kit === "countryside" ? (
          // The countryside world: rolling fields, houses, barn, windmill,
          // crop strips, dirt road, mountain ridge backdrop
          <CountrysideStage spec={spec} scene={activeScene} />
        ) : activeScene.kit === "forest" ? (
          // The forest world: dense tree scatter, ground mist, rocks, logs,
          // light shafts at golden hour
          <ForestStage spec={spec} scene={activeScene} />
        ) : activeScene.kit === "river" ? (
          // The river world: flowing water strip with optional waterfall,
          // mist, rocks, mountain ridge backdrop
          <RiverStage spec={spec} scene={activeScene} />
        ) : activeScene.kit === "interior" ? (
          // The interior world: room with window light shaft, furniture, lamp
          <InteriorStage spec={spec} scene={activeScene} />
        ) : activeScene.kit ? (
          // Asset-driven stage (GLB kits: park / pier / boardwalk / interior)
          <AssetStage scenes={[activeScene]} spec={spec} />
        ) : SceneComp ? (
          <SceneComp gravityOff={gravityOff} gravityOn={gravityOn} />
        ) : (
          // Fallback: empty pastel scene if builder missing
          <>
            <ambientLight intensity={0.5} />
          </>
        )}
      </ThreeCanvas>

      {/* Stat-panel escalation HUD + zoom vignette */}
      <ZoomVignette panel={spec.statPanel} fps={fps} />
      <StatHud panel={spec.statPanel} fps={fps} />
      {/* Cinematic texture: subtle film grain + edge vignette (always on). */}
      <FilmGrain />
      <Vignette />

      {/* Hook card */}
      <Hook
        text={spec.hook.text}
        keywordHighlight={spec.hook.keywordHighlight}
        startFrame={secToFrame(spec.hook.t, fps)}
        endFrame={secToFrame(spec.hook.t + spec.hook.duration, fps)}
      />

      {/* Timer HUD */}
      {spec.timer && (
        <TimerHUD
          label={spec.timer.label}
          startFrame={secToFrame(spec.timer.startT, fps)}
          endFrame={secToFrame(spec.timer.endT, fps)}
        />
      )}

      {/* Captions */}
      <Captions captions={spec.captions ?? []} fps={fps} />

      {/* Audio cues */}
      <CompositionAudio spec={spec} fps={fps} />
    </div>
  );
};
