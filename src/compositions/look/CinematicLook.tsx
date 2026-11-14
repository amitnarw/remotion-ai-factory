/**
 * CinematicLook.tsx — the post-processing "look" layer.
 *
 *   <ThreeCanvas ...>
 *     <Stage ... />
 *     <CinematicLook preset="golden-hour" quality="final" />   // LAST child
 *   </ThreeCanvas>
 *
 * Chain:  Bloom (mipmap) -> ToneMapping -> SMAA -> Grade (+seeded grain) -> Vignette -> [ChromaticAberration]
 *         (a time-lapse from a look with another operator: ToneMix, both
 *         operators with their outputs blended, in ToneMapping's place)
 *
 * Determinism rules this file follows (renders are frame-by-frame, headless):
 *   - every effect is built once per (preset, quality) and handed to the
 *     composer as a stable <primitive>; nothing is rebuilt per frame
 *     (wrapEffect memoises on JSON.stringify(props) and the composer re-adds
 *     passes whenever its children change identity);
 *   - the only per-frame input is the grain seed = Remotion frame, pushed into
 *     a uniform from a layout effect (runs before ThreeCanvas's advance());
 *     a time-lapse scene's blend (blendFrom, blend) is pushed the same way,
 *     into uniforms only: its chain is built once for the scene;
 *   - no adaptive tone mapping, no TAA/accumulation, no NoiseEffect (all
 *     wall-clock driven); exposure is renderer.toneMappingExposure = 2^EV.
 *   - <RenderAfterMount> re-renders once after the composer is live, so the
 *     first frame / every still is not black. Render with --gl=angle.
 *
 * Note: with the composer active, R3F's renderer tone mapping is switched off
 * and ToneMapping runs as a post effect on the HDR buffer, so the scene
 * BACKGROUND colour is tone-mapped too (it is not without the look).
 *
 * TODO(look v2): N8AO ambient occlusion and depth of field were skipped on
 * purpose (iGPU cost, halo/leak artefacts); add them behind quality="final"
 * once there is GPU headroom. Avoid N8AO's temporal accumulate mode.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { EffectComposer } from "@react-three/postprocessing";
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useCurrentFrame } from "remotion";
import { HalfFloatType, WebGLRenderTarget, type Mesh } from "three";
import { lapseChainLook, mixLooks } from "./blend";
import { applyLookMix, buildChain, type LookQuality } from "./chain";
import { GradeEffect } from "./GradeEffect";
import { resolveGrade } from "./grade";
import { LOOK_PRESETS, type LookPresetId } from "./presets";
import { RenderAfterMount } from "./renderAfterMount";
import { HOLD_CONTRAST, HOLD_DESATURATE } from "../../world/warp";

export type { LookQuality };

export interface CinematicLookProps {
  preset: LookPresetId;
  /** "draft": no SMAA, half-res bloom threshold pass. Default "final". */
  quality?: LookQuality;
  /**
   * Added to the Remotion frame to seed the grain. useCurrentFrame() is
   * relative to the enclosing <Sequence>; pass the sequence start here if the
   * canvas is inside one and you want grain to never repeat.
   */
  grainSeed?: number;
  /**
   * Grain multiplier (1 = preset amount, 0 = off). Grain that changes every
   * frame is expensive for H.264: it makes files far larger and encodes slower.
   */
  grain?: number;
  /** Grain cell size in device pixels (default 1). 2 = coarser, cheaper to encode. */
  grainSize?: number;
  /**
   * A time-lapse scene's starting look (Phase 6 step 4). Everything blends
   * from this look's (blend 0) to `preset`'s (blend 1) as uniforms; where
   * the two use different tone-map operators the chain runs both from the
   * first frame and blends their outputs (a program changed mid-scene would
   * stall every render tab). Absent, or equal to `preset`: the plain preset.
   */
  blendFrom?: LookPresetId;
  /** How far the lapse's look has gone from `blendFrom` to `preset` (0..1). */
  blend?: number;
  /**
   * A bullet time's hold depth at this frame (0 outside the window, 1 in the
   * hold; docs/factory/14-bullet-time.md decision 10): the grade a little
   * less saturated and a little more contrasty with it, as uniforms. Passed
   * only by a video with a bullet time; absent, nothing changes.
   */
  hold?: number;
}

/** Pushes the grain seed into the grade uniform before ThreeCanvas advances. */
const GrainSeed: React.FC<{ effect: GradeEffect; offset: number }> = ({ effect, offset }) => {
  const frame = useCurrentFrame();
  useLayoutEffect(() => {
    effect.frame = frame + offset;
  }, [effect, frame, offset]);
  return null;
};

/**
 * Asks for every program the scene draws with before the frame draws it.
 * three compiles a program at its first use and waits for it right there,
 * one program after another; asked for all at once, the driver compiles
 * them side by side, so a scene's first frame in a render tab waits once
 * (the flight's first ground frame, six tabs: about 17 s to 11-13 s).
 * The composer draws the scene into a half-float buffer, so a target like
 * it is bound meanwhile: colour space and tone mapping are part of each
 * program, and the programs asked for are exactly the ones drawn with.
 * Again only when the scene's meshes change (a kit model arrives); it draws
 * nothing, so no pixel changes.
 */
function Precompile() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const meshes = useRef(-1);
  useFrame(() => {
    let n = 0;
    scene.traverse((o) => {
      if ((o as Mesh).isMesh) n++;
    });
    if (n === meshes.current) return;
    meshes.current = n;
    const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType });
    const prev = gl.getRenderTarget();
    gl.setRenderTarget(target);
    gl.compile(scene, camera);
    gl.setRenderTarget(prev);
    target.dispose();
  }, -1000);
  return null;
}

function CinematicLookImpl({ preset, blendFrom, blend = 1, quality = "final", grainSeed = 0, grain = 1, grainSize = 1, hold }: CinematicLookProps) {
  const look = LOOK_PRESETS[preset] ?? LOOK_PRESETS.neutral;
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);

  // A lapse's starting look, when it differs from the end's (else null, and
  // everything below is exactly the plain preset's path).
  const from = blendFrom && blendFrom !== preset ? (LOOK_PRESETS[blendFrom] ?? null) : null;
  // A lapse's chain has every effect either look uses, so it is built once
  // for the scene and no program changes as the blend moves.
  const chainLook = useMemo(() => (from ? lapseChainLook(from, look) : look), [from, look]);
  const chain = useMemo(() => buildChain(chainLook, quality), [chainLook, quality]);
  useEffect(() => () => chain.dispose(), [chain]);
  // The lapse's look at this frame: every uniform blended, the two
  // operators' outputs too.
  const mix = useMemo(() => (from ? mixLooks(from, look, blend) : null), [from, look, blend]);

  // Grain knobs are uniforms: changing them never rebuilds the chain.
  useLayoutEffect(() => {
    if (mix) applyLookMix(chain, mix, grain);
    else chain.grade.setGrade({ ...look.grade, grain: look.grade.grain * Math.max(0, grain) });
    chain.grade.grainSize = grainSize;
  }, [chain, look, mix, grain, grainSize]);
  // A bullet time's hold: the frame's grade from the look's own values (never
  // from the uniforms the frame before left), shifted by the hold's depth.
  useLayoutEffect(() => {
    if (hold === undefined) return;
    const base = mix ? { ...mix.grade, grain: mix.grade.grain * Math.max(0, grain) } : resolveGrade({ ...look.grade, grain: look.grade.grain * Math.max(0, grain) });
    chain.grade.setUniforms({ ...base, saturation: base.saturation * (1 - HOLD_DESATURATE * hold), contrast: base.contrast * (1 + HOLD_CONTRAST * hold) });
  }, [chain, look, mix, grain, hold]);

  // Exposure feeds three's tone-map functions inside ToneMappingEffect
  // (or both of ToneMixEffect's).
  const exposureEV = mix ? mix.exposureEV : look.exposureEV;
  useLayoutEffect(() => {
    const prev = gl.toneMappingExposure;
    gl.toneMappingExposure = Math.pow(2, exposureEV);
    return () => {
      gl.toneMappingExposure = prev;
    };
  }, [gl, exposureEV]);

  // Stable children: the composer rebuilds its passes when these change.
  const children = useMemo(
    () => chain.effects.map((effect, i) => <primitive key={`${i}:${effect.name}`} object={effect} dispose={null} />),
    [chain],
  );

  // New chain or new camera (=> new composer) -> render once more after mount.
  const ready = useMemo(() => chain.ready.then(() => camera.uuid), [chain, camera]);

  return (
    <>
      <EffectComposer multisampling={0} frameBufferType={HalfFloatType} depthBuffer stencilBuffer={false}>
        {children}
      </EffectComposer>
      <GrainSeed effect={chain.grade} offset={grainSeed} />
      <Precompile />
      <RenderAfterMount ready={ready} />
    </>
  );
}

export const CinematicLook = memo(CinematicLookImpl);
