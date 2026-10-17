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
import { CompositionAudio } from "./audio";
import { secToFrame } from "../../generator/timing";
import { ShotSpec } from "../../generator/spec.schema";
import { AssetStage } from "../AssetStage";
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
      {/* 3D world inside ThreeCanvas */}
      <ThreeCanvas
        width={width}
        height={height}
        style={{ width, height }}
      >
        {activeScene.kit ? (
          // Asset-driven stage (game-engine style: GLB assets from the catalog)
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
      <Captions captions={spec.captions} fps={fps} />

      {/* Audio cues */}
      <CompositionAudio spec={spec} fps={fps} />
    </div>
  );
};
