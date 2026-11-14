/**
 * src/world/vfx/VfxPreview.tsx
 *
 * QA compositions for the effects (docs/factory/21-vfx-effekseer.md): a
 * place through GroundWorld's real `vfx` prop (the path a video's scene
 * takes, its fog, mood and light included), graded like a video's world
 * scene (CinematicLook at the real sun's look), from a fixed lens.
 *
 *   npx remotion still src/world/index.ts VfxPreview out/agentVFX/all.png --frame=40
 *
 *  - `VfxPreview`, `VfxPreviewNight`: the six families on the place's
 *    avenue; the loops (fire, smoke, sparks) burning from the start, the
 *    one-shots one after another (explosion 1 s, impact 2 s, magic 3 s).
 *  - `VfxFamily`: one family alone at the plaza's clear ring, the lens
 *    framed to its size; the one-shots at 0.5 s, the loops lit at 0 and
 *    burning all 90 s (a loop's 80th second rendered alone and in a run).
 */
import { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { CinematicLook } from "../../compositions/look/CinematicLook";
import { lookFor } from "../../generator/look-choice";
import { generateCity } from "../city";
import { cityAnchors } from "../cityAnchors";
import { GroundWorld } from "../Ground";
import { landmarksFor } from "../landmarks";
import { resolvePlace, type Moment } from "../places";
import type { Vec3 } from "./emitter";
import { familyPreset, VFX_FAMILIES, type VfxFamily } from "./families";
import type { VfxEffect } from "./spec";

export type VfxPreviewProps = {
  place: string;
  moment: Moment;
  /** One family alone (VfxFamily); else the six (or `effects`). */
  family?: VfxFamily;
  palette?: string;
  scale?: number;
  /** Its own effects instead of the defaults. */
  effects?: VfxEffect[];
  /** The lens, from the focus spot (metres), and where it looks, from the same. */
  from?: Vec3;
  lookAt?: Vec3;
  fov?: number;
  /** Graded like a video (default), or raw. */
  graded?: boolean;
  /** The spot the effects and lens centre on. */
  spot?: string;
};

const NO_PASSAGE: [number, number] = [-75, 0];

/** The six families along a line through the spot, the one-shots in turn. */
export function previewEffects(spot: string): VfxEffect[] {
  const start: Record<VfxFamily, number> = { explosion: 1, fire: 0, smoke: 0, sparks: 0, impact: 2, magic: 3 };
  const order: VfxFamily[] = ["smoke", "explosion", "fire", "magic", "sparks", "impact"];
  return order.map((family, i) => ({
    family,
    spot,
    offset: [(i - 2.5) * 9, 0, 0] as Vec3,
    start: start[family],
    warm: familyPreset(family).loop,
  }));
}

export const VfxPreview: React.FC<VfxPreviewProps> = ({ place, moment, family, palette, scale, effects, from, lookAt, fov, graded = true, spot }) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const t = frame / fps;
  const resolved = useMemo(() => resolvePlace(place, moment), [place, moment]);
  const focusSpot = spot ?? (family ? "plaza-ring-south" : "avenue");

  // The focus (for the lens), from the layout GroundWorld draws.
  const focus = useMemo((): Vec3 => {
    const layout = generateCity(resolved.style, {
      clearings: landmarksFor(resolved.place).map((l): [number, number, number] => [l.x, l.z, l.clearRadius]),
      seed: resolved.place.id,
      season: resolved.season,
      cloudiness: resolved.place.cloudiness,
      cloudPassages: [NO_PASSAGE],
    });
    const anchors = cityAnchors(layout, resolved.style);
    const s = anchors.spot(focusSpot) ?? anchors.spot("avenue");
    return s ? ([...s.pos] as Vec3) : [0, 0, 0];
  }, [resolved, focusSpot]);

  const list = useMemo((): VfxEffect[] => {
    if (effects) return effects;
    if (!family) return previewEffects(focusSpot);
    // A loop lit at 0 burns for the whole composition (its 80th second is the loop test).
    const preset = familyPreset(family, palette);
    return [{ family, palette, scale, spot: focusSpot, start: preset.loop ? 0 : 0.5, ...(preset.loop ? { duration: durationInFrames / fps } : {}) }];
  }, [effects, family, palette, scale, focusSpot, durationInFrames, fps]);

  const pose = useMemo(() => {
    const reach = family ? familyPreset(family).reach * (scale ?? 1) : 30;
    // One family: framed to its size from the plaza's south-east; the six: a drone view over the avenue's south roofs.
    const d = 4 + 1.3 * reach;
    const dir = [0.5, 0.45, 0.75];
    const n = Math.hypot(...dir);
    const off = from ?? (family ? (dir.map((x) => (x / n) * d) as Vec3) : ([-6, 40, 30] as Vec3));
    const aim = lookAt ?? ([0, family ? 0.3 * reach : 3, 0] as Vec3);
    return {
      pos: [focus[0] + off[0], focus[1] + off[1], focus[2] + off[2]] as Vec3,
      target: [focus[0] + aim[0], focus[1] + aim[1], focus[2] + aim[2]] as Vec3,
    };
  }, [family, scale, from, lookAt, focus]);

  const vfx = useMemo(() => ({ effects: list, t }), [list, t]);
  const look = lookFor({ kit: "world", world: { place, date: moment.date, time: moment.time } });

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <ThreeCanvas width={width} height={height} shadows>
        <GroundWorld place={resolved} pose={pose} fov={fov ?? (width < height ? 62 : 42)} cloudPassage={NO_PASSAGE} vfx={vfx} />
        {graded && <CinematicLook preset={look} quality="final" grain={0.3} />}
      </ThreeCanvas>
    </AbsoluteFill>
  );
};

/** Every family, for the compositions' prop lists. */
export const PREVIEW_FAMILIES = VFX_FAMILIES;
