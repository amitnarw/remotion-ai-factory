# Milestone 2 visual review (input for Phase 3)

**Date:** 2026-10-23. **Source:** 4 frames per video from the Phase 2 milestone run (`npm run milestone -- --fixtures`): 3 premises × 3 formats, draft quality, with the CC0 model packs installed. The frames were reviewed as a cinematographer would. Nothing was played; frames are stills from `output/milestone/<id>-1..4.png`.

Phase 2 is about story, voice, timing and sound, and its checks pass (see [PROGRESS.md](PROGRESS.md)). This file lists what the pictures get wrong. That is Phase 3 (camera, transitions, look, vision QA) and Phase 5 (worlds), or the world engine in [06-world-engine.md](06-world-engine.md) where it replaces the stages.

## The pipeline delivered the events; the stages don't show them
The timing is right. Checked in the oceans spec: `water-vanish` at 6.4 s, `water-return` at 20.6 s, the timer from 6.1 s to 20.3 s, and the cut to space at 14.5 s. The problem is what the stages can show:
- **Oceans:** the near water drains, but from beach height the empty basin still reads as a blue band against the hazy horizon. The space stage has no "Earth without oceans" state, so "Earth turns grey" shows a blue Earth. The water's return shows no wave or water mass.
- **Forest:** no tree pulls up its roots or walks. The farm frames have no trees, and "cross the hill" has no hill.
- **Money:** there is no coin and no café table. The doubling has no on-screen subject; only the HUD carries it.
- **Continuity:** windows stay lit after "the village lights go dark" (forest 16:9 and 1:1). The emissive state should follow the beat's world event, not the time of day.

## Problems, ranked by impact
1. **The camera doesn't frame the narrated subject** (every money and oceans frame; forest 9x16-2/3, 16x9-2).
   - Fix: each beat names a subject entity (coin, fisherman, walking tree, wave, Earth). The camera is solved from it: look-at on the subject, with a dolly distance that keeps it at 25–50% of the frame height.
   - QA: fail a shot when the subject's projected box is under ~8% of the frame or occluded.
   - This is where the director's `shots[]` lands.
2. **Rain radiates from the vanishing point** like a hyperspace warp, and covers the moon (oceans and forest night frames).
   - Fix: draw the streaks in screen space, or as camera-aligned billboards falling along world −Y with a slight wind slant. Keep them short, semi-transparent and denser near the lens.
3. **Props crowd or block the lens.** Umbrellas are cut off at the frame edge. Trunks and canopy fill 40–70% of the frame. A building silhouette fills half a 16:9 frame. A bird is huge next to the lens.
   - Fix: keep a 3–5 m clearance around the camera (cull or fade props inside it), and ray-cast from camera to subject, moving the camera if the ray is blocked.
4. **Night frames are nearly black** (forest night, the bottom of the money street at lights-out).
   - Fix: a cool moonlight key plus a rim light, a lit sky gradient, and an exposure floor so shadows stay above ~8% luma. Emissive windows with bloom.
5. **Composition is flat:** the horizon sits at mid-frame and 40% of the frame is bare asphalt, sand or path.
   - Fix: subject on the thirds lines and horizon at 1/3 or 2/3, using per-aspect framing presets. Camera height should vary with the subject (low for the coin and trees, high for the street and village).
6. **Forest render artifacts:** stepped, ghosted translucent layers and a milky wash.
   - Fix: alpha-tested foliage with `depthWrite`, or exponential scene fog instead of stacked fog planes.
7. **Space shot:**
   - The planet overflows the 9:16 frame. Fit it to ~60% of the short side.
   - The atmosphere is an opaque grey ring. Use a Fresnel additive glow.
   - There is no terminator and no night-side city lights.
   - The moon is cut by the frame edge and collides with the caption. Keep secondary bodies inside the safe area.
8. **Lighting and colour are flat:** a sepia-haze street, an olive or grey "golden" forest, a low-contrast pastel beach.
   - Fix: ACES/AgX tone mapping, a grade per mood, a low sun behind the subject for rim light, contact shadows and AO.
9. **Captions:**
   - The hook title overflows the right edge in 9:16 and 1:1. Wrap it inside a 90% safe width, auto-fit, at most 2 lines.
   - 9:16 captions are small (~35% of the width) and sit at ~88% height, inside the Shorts UI zone. Use about 2× the size at 65–72% height.
   - There is no stroke or scrim, so text is grey-on-grey over the road. Add a stroke or drop shadow, or a soft scrim.
   - 16:9 captions are fine.
10. **HUDs:**
    - On 1:1 the money HUD covers ~45% × 28% of the frame and overlaps the Earth. Scale HUDs per aspect ratio (at most ~30% of the width on 1:1).
    - The oceans timer is tiny and its label vanishes against a bright sky. Give it a card like the money HUD, at about 3× the size.

## Vision QA checks to build (Phase 3, photographer role)
Per sampled frame:
- Is the subject present and large enough?
- Is the lens free of occluders?
- Are mean and shadow luma above the floor?
- Is the caption inside the safe area and unclipped?
- Does the scene state match the beat's keyword (water gone, Earth grey, lights off)?
