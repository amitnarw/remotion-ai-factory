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
import { resolveCaptionStyle } from "../../generator/caption-style";
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
import { TransitionOverlay, whipBlur } from "../TransitionOverlay";
import { CinematicLook } from "../look/CinematicLook";
import { lookFor } from "../../generator/look-choice";
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
  const captionLook = resolveCaptionStyle(spec.settings?.captions);

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
        // A whip pan blurs the picture at its fastest moment.
        style={{ width, height, filter: whipBlur(spec.transitions, timeSec) > 0.3 ? `blur(${(whipBlur(spec.transitions, timeSec) * width) / 1080}px)` : undefined }}
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
        {/* The grade (Phase 3): tone mapping, bloom, colour, grain and vignette,
            chosen per scene from its time of day and the story's mood. Grain is
            kept light: per-frame grain makes the H.264 file far larger. */}
        <CinematicLook
          preset={lookFor(activeScene, spec.story?.mood)}
          quality={spec.settings?.quality === "draft" ? "draft" : "final"}
          grain={0.3}
        />
      </ThreeCanvas>

      {/* Scene-to-scene dips and flashes */}
      <TransitionOverlay transitions={spec.transitions} />

      {/* Stat-panel escalation HUD + zoom vignette */}
      <ZoomVignette panel={spec.statPanel} fps={fps} />
      <StatHud panel={spec.statPanel} fps={fps} />

      {/* Hook card */}
      <Hook
        text={spec.hook.text}
        style={captionLook}
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
          fps={fps}
          // Below the counter card when a video has both.
          offsetY={spec.statPanel ? 300 : 0}
        />
      )}

      {/* Captions */}
      <Captions captions={spec.captions ?? []} fps={fps} style={captionLook} />

      {/* Audio cues */}
      <CompositionAudio spec={spec} fps={fps} />
    </div>
  );
};
