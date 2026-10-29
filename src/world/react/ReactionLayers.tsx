/**
 * src/world/react/ReactionLayers.tsx
 *
 * Every layer one reaction draws in a place (docs/factory/
 * 11-world-reactions.md §5, milestone A), mounted beside GroundWorld:
 *
 *  - lift: the debris and (optionally) the market's own pieces rise, spin
 *    and drop back on gravity-on (RigidReaction), with small chips lifting
 *    off the plaza (ReactionParticles "chips");
 *  - confetti: a burst of tumbling chips at each beat, the air staying
 *    full as the level climbs (ReactionParticles "confetti");
 *  - money: fluttering banknotes at each beat (ReactionParticles "notes"),
 *    coins raining down to stay on the paving and coin piles growing with
 *    the level (RigidReaction).
 *  - crack (milestone B): once the ground breaks, the plaza's slabs rise
 *    and tumble with dust where they part (SlabReaction), the market's
 *    pieces riding the slab under them (RigidReaction "ride"). The cracks
 *    themselves and the soil pit are the ground's (crackGround.ts).
 *  - water (milestone C): the flood plane at the water's surface and the
 *    ponds' beds once they drain (WaterLayer); the wet marks and foam are
 *    the world materials' own patch (waterShader.ts).
 *  - snow (milestone C): the snowfall round the lens (SnowLayer); the cover
 *    is the world materials' own patch (snowShader.ts).
 *
 * Everything is a pure function of (site, track, bursts, t, eye): the
 * caller passes the scene's level as a track (levelTrack over
 * `reactionAt(...)`'s level, sampled once per scene), the scene's static
 * bursts, the time and the render camera's position from the pure pose.
 * With no reaction (`react` null) nothing is mounted.
 */
import { useMemo } from "react";
import type * as THREE from "three";
import type { ReactionSite } from "./debris";
import type { Vec3 } from "./lift";
import { ReactionParticles } from "./ReactionParticles";
import { RigidReaction } from "./RigidReaction";
import { liftSet, moneySet, ridePieces, type RideFn } from "./rigid";
import { slabPlan, slabRide, type SlabGrid } from "./slab";
import { SlabReaction } from "./SlabReaction";
import { NO_BURSTS, type Burst, type LevelTrack } from "./track";
import type { Pond, WaterOptions } from "../atmosphere/water";
import type { SnowPlan } from "./snow";
import { SnowLayer } from "./snowLayer";
import type { WaterPlan } from "./water";
import { WaterLayer } from "./waterLayer";

/** The reactions drawn here (the counter's `react` choices that move a place). */
export type ReactKind = "lift" | "confetti" | "money" | "crack" | "water" | "snow";

export interface ReactionLayersProps {
  /** The scene's reaction; null or undefined: nothing. */
  react: ReactKind | null | undefined;
  /** Where it happens (debris.ts reactionSite: fixed for the scene). */
  site: ReactionSite;
  /** The place id (every seed: makeRng(`${placeId}:react:${kind}`)). */
  placeId: string;
  /** The reaction's level over the scene, sampled once (track.ts levelTrack). */
  track: LevelTrack;
  /** The scene's bursts, one per counter beat (all of them, static per scene). */
  bursts?: readonly Burst[];
  /** Seconds, in the time base of the track and the bursts. */
  t: number;
  /** The render camera's position this frame, from the scene's pure pose. */
  eye: Vec3;
  /** lift: lift the market's own pieces too; crack: they ride the slabs.
   *  The caller must then leave the market out of its own drawing
   *  (GroundWorld's KitInstances for it); at rest RigidReaction draws them
   *  exactly where KitInstances did. */
  liftMarket?: boolean;
  /** crack: the slab grid (slab.ts slabGrid) and when the break wave
   *  starts (Infinity or undefined: the ground doesn't break here). */
  slabs?: SlabGrid | null;
  breakAt?: number;
  /** confetti, money: the ambient layer (the air stays full). Default true. */
  ambient?: boolean;
  /** Extra patches (height fog, mood palette) for the particle materials. */
  patch?: (m: THREE.Material) => void;
  /** Names `patch` in the particle program's cache key. */
  patchKey?: string;
  /** water: the scene's water (water.ts waterPlan), the flood's look (the
   *  place's drawn-water options), its half-size and the place's ponds. */
  water?: { plan: WaterPlan; look: WaterOptions; half?: number; ponds?: readonly Pond[] } | null;
  /** snow: the scene's snow (snow.ts snowPlan), the other GPU particles the
   *  scene draws (the flakes keep within §5's budget) and the flakes' brightness. */
  snow?: { plan: SnowPlan; others?: number; light?: number } | null;
}

export function ReactionLayers({ react, site, placeId, track, bursts = NO_BURSTS, t, eye, liftMarket = false, slabs = null, breakAt, ambient = true, patch, patchKey, water = null, snow = null }: ReactionLayersProps) {
  const pieces = useMemo(
    () => (react === "lift" ? liftSet(site, placeId, { market: liftMarket }) : react === "money" ? moneySet(site, placeId) : []),
    [react, site, placeId, liftMarket],
  );
  // crack: the scene's slab releases (static per scene) and the market riding them.
  const slabbed = useMemo(
    () => (react === "crack" && slabs && breakAt !== undefined && Number.isFinite(breakAt) ? slabPlan(slabs, breakAt, track) : null),
    [react, slabs, breakAt, track],
  );
  const riders = useMemo(() => (slabbed && liftMarket && site.market ? ridePieces(site.market.placements, slabbed.grid.riders) : []), [slabbed, liftMarket, site]);
  const ride = useMemo((): RideFn | null => (slabbed ? (g, tt) => slabRide(slabbed, g, tt) : null), [slabbed]);
  if (!react) return null;
  const epi = site.epicentre;
  // The ambient particles fill the air as each burst spreads (their own
  // front, particles.ts); this only turns them on.
  const air = ambient ? 1 : 0;
  const particles = { placeId, epicentre: epi, t, patch, patchKey };
  return (
    <>
      {react === "lift" && (
        <>
          <RigidReaction pieces={pieces} track={track} t={t} eye={eye} />
          <ReactionParticles kind="chips" track={track} polygon={site.polygon} {...particles} />
        </>
      )}
      {react === "confetti" && <ReactionParticles kind="confetti" bursts={bursts} ambient={air} {...particles} />}
      {react === "money" && (
        <>
          <RigidReaction pieces={pieces} track={track} bursts={bursts} t={t} eye={eye} />
          <ReactionParticles kind="notes" bursts={bursts} ambient={air} {...particles} />
        </>
      )}
      {react === "crack" && slabbed && (
        <>
          <SlabReaction plan={slabbed} placeId={placeId} track={track} t={t} eye={eye} patch={patch} patchKey={patchKey} />
          {riders.length > 0 && <RigidReaction pieces={riders} ride={ride} t={t} eye={eye} />}
        </>
      )}
      {react === "water" && water && <WaterLayer plan={water.plan} t={t} look={water.look} half={water.half} ponds={water.ponds} patch={patch} patchKey={patchKey} />}
      {react === "snow" && snow && <SnowLayer plan={snow.plan} placeId={placeId} t={t} others={snow.others} light={snow.light} />}
    </>
  );
}
