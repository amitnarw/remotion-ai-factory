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
 *
 * A channel brand (spec.brand, src/compositions/brand/) adds an intro bumper
 * before the video and an outro after it, a corner watermark, and its colours
 * and fonts on the captions and the HUD. Without one, the tree is exactly the
 * one of before (VideoBody alone), so an unbranded video renders byte-identical.
 */
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import * as React from "react";
import { Hook } from "../hud/Hook";
import { TimerHUD } from "../hud/TimerHUD";
import { Captions } from "../hud/Captions";
import { StatHud, ZoomVignette, hasPulseRow } from "../hud/StatHud";
import { CompositionAudio } from "./audio";
import { secToFrame } from "../../generator/timing";
import { ShotSpec, videoSeconds } from "../../generator/spec.schema";
import { resolveCaptionStyle, resolveHudStyle } from "../../generator/caption-style";
import { hudStack, textHudMeetsHook } from "../../generator/layout";
import { AssetStage } from "../AssetStage";
import { StreetStage } from "../StreetStage";
import { SpaceStage } from "../SpaceStage";
import { OceanStage } from "../OceanStage";
import { CountrysideStage } from "../CountrysideStage";
import { ForestStage } from "../ForestStage";
import { RiverStage } from "../RiverStage";
import { InteriorStage } from "../InteriorStage";
import { ModelSetStage } from "../ModelSetStage";
import { ThreeCanvas } from "@remotion/three";
import { CityScene } from "../scenes/CityScene";
import { TransitionOverlay, whipBlur } from "../TransitionOverlay";
import { CinematicLook } from "../look/CinematicLook";
import { lapseLookFor, lookFor } from "../../generator/look-choice";
import { holdDepth, sceneClock } from "../../world/warp";
import { FirstPersonScene } from "../scenes/FirstPersonScene";
import { WorldStage } from "./WorldStage";
import { FlightView, flightScenes } from "./FlightView";
import { TIMING, veilAt } from "../../world/flight";
import { brandCaptionLook, brandHudLook, brandOf, brandTitleLook, brandTitleWeight, bumperFrames, type Brand } from "../brand/brand";
import { BrandIntro, BrandOutro, Watermark } from "../brand/Bumpers";

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

export const WhatIfVideo: React.FC<WhatIfVideoProps> = ({ spec, previewFrame }) => {
  const brand = React.useMemo(() => brandOf(spec), [spec]);
  if (!brand) return <VideoBody spec={spec} previewFrame={previewFrame} />;
  return <BrandedVideo spec={spec} brand={brand} previewFrame={previewFrame} />;
};

/**
 * A branded video: the intro bumper, the video shifted by the intro's length
 * (its picture, HUD and sound together, as one Sequence), then the outro. The
 * composition's length must hold all three (brand.ts brandedFrames).
 */
const BrandedVideo: React.FC<WhatIfVideoProps & { brand: Brand }> = ({ spec, brand, previewFrame }) => {
  const fps = spec.fps ?? 30;
  const { intro, outro } = bumperFrames(brand, fps);
  const body = secToFrame(videoSeconds(spec), fps);
  return (
    <AbsoluteFill style={{ background: brand.colors.background }}>
      {intro > 0 && (
        <Sequence durationInFrames={intro} name="Brand intro">
          <BrandIntro brand={brand} frames={intro} />
        </Sequence>
      )}
      <Sequence from={intro} durationInFrames={body} name="Video">
        <VideoBody spec={spec} brand={brand} previewFrame={previewFrame} />
      </Sequence>
      {outro > 0 && (
        <Sequence from={intro + body} durationInFrames={outro} name="Brand outro">
          <BrandOutro brand={brand} frames={outro} />
        </Sequence>
      )}
    </AbsoluteFill>
  );
};

const VideoBody: React.FC<WhatIfVideoProps & { brand?: Brand }> = ({
  spec,
  previewFrame,
  brand,
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
  // A brand's colours and caption font; without one, the look itself.
  const captionLook = brandCaptionLook(resolveCaptionStyle(spec.settings?.captions), brand);
  // The HUD follows the caption look: text over the picture on the serif
  // looks (the reference default), white cards on the others. When a video
  // has a counter and a timer, hudStack says where each one goes.
  const hudLook = brandHudLook(resolveHudStyle(spec.settings?.captions), brand);
  const hudSlots = hudStack(hudLook.kind, { counter: !!spec.statPanel, pulse: hasPulseRow(spec.statPanel), timer: !!spec.timer });
  const hookFrames = { from: secToFrame(spec.hook.t, fps), to: secToFrame(spec.hook.t + spec.hook.duration, fps) };
  // With the text HUD the hook sits high; the HUD waits for it only when its
  // column reaches that high (a counter stacked on a timer).
  const hudWaitsForHook =
    hudLook.kind === "text" && textHudMeetsHook(width, height, hudLook.caption, hudSlots.column) ? hookFrames : undefined;
  // A flight renders instead of the ground stage while its window runs (Phase 6).
  const flightWindow = (spec.flights ?? []).find((f) => timeSec >= f.from && timeSec < f.to);
  // Its opaque canvas covers the whole frame, so the stage canvas under it
  // draws nothing meanwhile: a world stage drawn and graded there was paid
  // for on every flight frame and never seen.
  const flightCovers = !!flightWindow && flightScenes(spec, flightWindow) != null;
  // The flight's cloud veil turns the frame white for a moment at each scale
  // switch (the same path time FlightView's Sequence gives WorldFlight); the
  // captions and the text HUD get a dark glow for exactly that long.
  const veil = flightWindow
    ? veilAt(((displayFrame - Math.round(flightWindow.from * fps)) / fps) * (TIMING.end / (flightWindow.to - flightWindow.from)))
    : 0;
  // A world scene with a time-lapse grades by its light: the start's look
  // blended into the end's by how far the sun has gone at this frame (their
  // two tone maps too, both in the grade from the first frame). Memoised per
  // scene: the clock and the two looks are worked out once.
  const mood = spec.story?.mood;
  const lapseLook = React.useMemo(() => lapseLookFor(activeScene, mood), [activeScene, mood]);
  // Bullet time's grade shift (docs/factory/14-bullet-time.md decision 10):
  // with the hold's depth, a little less colour and a little more contrast.
  // Only a video with a bullet time passes it to the grade.
  const bulletScene = React.useMemo(() => spec.scenes.find((s) => s.bulletTime), [spec.scenes]);
  const bulletClock = React.useMemo(() => (bulletScene ? sceneClock(bulletScene) : null), [bulletScene]);
  const hold = bulletClock ? holdDepth(bulletClock, timeSec) : undefined;

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
        {flightCovers ? null : activeScene.kit === "world" ? (
          // The one-world place scene (Phase 6 step 1): a real place with its
          // own sun, season and city style
          <WorldStage scene={activeScene} spec={spec} fps={fps} />
        ) : activeScene.kit === "street-block" ? (
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
        ) : activeScene.kit === "model-set" ? (
          // One catalog model staged as the whole set: a ship at sea, a lighthouse on its islet
          <ModelSetStage spec={spec} scene={activeScene} />
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
        {!flightCovers && (
          <CinematicLook
            preset={lapseLook ? lapseLook.to : lookFor(activeScene, mood)}
            blendFrom={lapseLook?.from}
            blend={lapseLook?.mix(timeSec)}
            quality={spec.settings?.quality === "draft" ? "draft" : "final"}
            grain={0.3}
            hold={hold}
          />
        )}
      </ThreeCanvas>

      {/* Scene-to-scene dips and flashes */}
      <TransitionOverlay transitions={spec.transitions} />

      {/* The flight between two world places replaces the picture while its window runs */}
      {flightWindow && <FlightView spec={spec} window={flightWindow} />}

      {/* Stat-panel escalation HUD + zoom vignette */}
      <ZoomVignette panel={spec.statPanel} fps={fps} />
      <StatHud
        panel={spec.statPanel}
        fps={fps}
        hud={hudLook}
        glow={veil}
        offsetY={hudSlots.counterOffsetY}
        column={hudSlots.column}
        hook={hudWaitsForHook}
      />

      {/* Hook card */}
      <Hook
        text={spec.hook.text}
        style={brandTitleLook(captionLook, brand)}
        keywordHighlight={spec.hook.keywordHighlight}
        startFrame={hookFrames.from}
        endFrame={hookFrames.to}
        hud={hudLook.kind}
        weight={brand?.fonts.title ? brandTitleWeight(brand) : undefined}
      />

      {/* Timer HUD */}
      {spec.timer && (
        <TimerHUD
          label={spec.timer.label}
          startFrame={secToFrame(spec.timer.startT, fps)}
          endFrame={secToFrame(spec.timer.endT, fps)}
          fps={fps}
          hud={hudLook}
          glow={veil}
          // Cards: below the counter card when a video has both; text: the column's base.
          offsetY={hudSlots.timerOffsetY}
          column={hudSlots.column}
          hook={hudWaitsForHook}
        />
      )}

      {/* Captions */}
      <Captions captions={spec.captions ?? []} fps={fps} style={captionLook} glow={veil} plateFont={brand?.fonts.caption} />

      {/* The channel's corner mark, once the hook has gone */}
      {brand?.watermark && <Watermark brand={brand} after={hookFrames.to} />}

      {/* Audio cues */}
      <CompositionAudio spec={spec} fps={fps} />
    </div>
  );
};
