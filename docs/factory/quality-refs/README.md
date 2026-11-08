# Quality references (Phase 7 — The Reference Bar)

These 8 phone screenshots, from two channels the user chose, set the quality bar for the finished videos. The checklist that uses them is in [05-plan.md, Phase 7](../05-plan.md); Milestone 7 passes only when the user says our video looks like these. (The platform UI around the picture, such as Facebook's bar and the like/comment rail, is not part of the reference.)

## "What if animations": gravity in a European town (the target look for the one-world scenes, Phase 6)

| Frame | What it shows |
|---|---|
| [ref-gravity-day-plaza.jpeg](ref-gravity-day-plaza.jpeg) | The opening: a dressed market plaza in daylight. Striped stalls, a fountain, a bell tower, colourful houses, bunting, many people. The hook "What if gravity slowly disappeared?" is a serif title over the scene, with "gravity" in gold. Small HUD on the left: "GRAVITY 100%" plus a fact line. |
| [ref-gravity-confetti.jpeg](ref-gravity-confetti.jpeg) | The world reacting: stalls, debris and confetti lift into the air; gravity 0.6%. Serif italic caption: "The ground itself is swelling." |
| [ref-gravity-night-breaking.jpeg](ref-gravity-night-breaking.jpeg) | Night under a bright moon: the plaza empties as people float off; the HUD reads "THE GROUND UNDER YOU / BREAKING". |
| [ref-gravity-night-ground.jpeg](ref-gravity-night-ground.jpeg) | Night: the paving breaks up and flies apart; "THE GROUND UNDER YOU / GONE", caption "And the Sun." |

## "What If Fun facts": toilets in New York (density, life, camera and HUD)

| Frame | What it shows |
|---|---|
| [ref-toilets-aerial.jpeg](ref-toilets-aerial.jpeg) | An aerial down a long avenue: yellow taxis, crossings, traffic lights, rooftop water tanks, people at café tables. |
| [ref-toilets-tracking.jpeg](ref-toilets-tracking.jpeg) | Street level: people walking and reacting on the sidewalk; a jogger tracked toward the camera. |
| [ref-toilets-medium.jpeg](ref-toilets-medium.jpeg) | A medium shot of a man walking toward the camera, with trash bags and a hydrant beside him. |
| [ref-toilets-closeup.jpeg](ref-toilets-closeup.jpeg) | A side close-up of a man carrying a cup indoors. |

## What both channels share (and what our videos should match)
- **Captions:** a serif italic line with a soft shadow, low in the frame (our "reference" caption preset, the default).
- **Hook:** a serif title over the live scene with the keyword in gold (also the "reference" preset).
- **HUD: text over the picture, no card.** A small spaced-capitals label ("TIME WITHOUT TOILETS"), large serif numbers ("47:11 min"), a fact line in gold or red, and, when used, a thin EKG line with a BPM figure.
  - Done 2026-10-26: with the "reference" (default) and "documentary" caption looks our counter and timer are drawn this way, and the hook sits high like the references; the other caption looks keep white cards.
- **Life and density:** many people and props in every street shot, and the world physically reacts to the number on screen.

## First gate comparison (2026-10-27, committed code b65f220)
Sheets: `out/phase7-gate/gate-gravity.png` and `out/phase7-gate/gate-toilets.png` (each reference on top, our closest 9:16 frame below; our stills are `out/phase7-gate/ours-*.png`). Our frames come from the Paris world video (`output/what-if-money-doubled-every-3-seconds-in-paris`) and the milestone 3 videos, re-rendered as stills from the committed code. The crowd and featured actors are off (the user's decision), so no world scene has people.

| Gate item | Where we are |
|---|---|
| 1. Typography | Matches: serif italic captions with the gold keyword, the serif hook high over the scene. |
| 2. Pulse/BPM | Optional director device; not in these frames. |
| 3. Dressed places (30+ props in a wide shot) | Plazas: now met (same day, below). Before: the Paris plaza wide showed a fountain, one stall, a bench and a flag, with bare paving filling the lower half. Streets: not met. The street has trees, planters, a café and cars, but no water towers, crosswalks, hydrants or taxis. |
| 4. Visible life (10+ people) | Not met in world places (the crowd is off by the user's choice). The street kit's own walkers show 3 people per frame. No close-up of a person exists. |
| 5. Camera language | Partly. Our street aerial down the avenue is close to the reference composition. The street FS/MS shots sit low and half the frame is road surface; the references frame people at eye height. |
| 6. Light and atmosphere | Partly. The golden street haze washes the aerial out (the reference is crisp and saturated); the night city is readable dark blue with lit windows but has no moon or stars; rain and storms exist. |
| 7. The world reacts | Weak on 2026-10-27: coin stacks on the sidewalk against the reference's debris and confetti filling the frame, and world places did not react at all. Since 2026-10-28 (milestone A of [11-world-reactions.md](../11-world-reactions.md)) every counter beat in a place lifts stalls and debris, bursts confetti or rains banknotes and coins within 0.5 s; the ground breaking and the night frames are milestone B. |
| 8. The verdict | The user's. Not at the reference level yet: dressing, life and the world's reaction are the big gaps, then framing and haze. |

### The plaza market (2026-10-27, after the comparison)
- `src/world/atmosphere/market.ts`: the city's main plaza holds a market of CC0 kit models from the catalog (Kenney canopy and table stalls and carts, KayKit produce crates, Kenney barrels, Kenney parasols with stools, planters round the edge; only models with small shared textures, since 2048 px PBR props cost about 15 s per render). Paris: 32 stalls, 141 pieces; Colmar: 32 stalls, 105 pieces. They are drawn instanced by `KitInstances`, so the draw call count stays low. Cairo and New York have no plaza.
- The fountain keeps a 9 m clear ring and the four compass aisles stay open, so the plaza's camera and actor spots look at the fountain over open paving; the market's random stalls give way and four benches face the fountain.
- Cameras (`generator/camera/world.ts`): a close plaza shot keeps to the ring or its aisle; any other plaza shot stays over the stalls; a wide plaza shot rises to about 9 m and looks diagonally across a quarter of the market (down an aisle, a portrait frame would show only paving), on the bearing that keeps the flag poles out of the line of sight (`marketBearing`). Tested: no plaza lens, at any size, angle or move, inside a stall in Paris or Colmar.
- Stills: `out/phase7-gate/market-before-after.png` (before, then two frames after), `out/phase7-gate/market-colmar.png`.

### The New York street pass (2026-10-28)
`src/compositions/StreetStage.tsx` and `src/compositions/street/dressing.ts`. Sheet: `out/street-pass/street-pass-sheet.png` (the four references, then before and after at five frames).
- **Dressing:** KayKit water tanks on about three in four of the near-row roofs (standing on a measured flat spot), three Quaternius crosswalks with KayKit mast-arm traffic lights on both curbs, 9 hydrants, 13 trash bags or piles, about two cars in three are yellow taxis; every new prop is a camera blocker.
- **Haze:** the fog starts at 60 m instead of 26 m, the sky fades from a pale horizon to blue overhead, cooler shadow light, a soft sun glow instead of a hard halo circle.
- **Framing:** the hero FS and MS frame the pavement to head height (the lens 1.3-1.5 m up, was 0.5 m): people and storefronts fill the frame, the road is a sliver. The skyline MS now frames a roofline instead of empty sky.
- **Still different:** pastel Kenney facades where the reference has red brick and stone with dense windows (some far towers are shop models scaled up, with huge windows); stacked tree models make big green blobs over storefronts; a ~100 m block with 9 cars against the reference's long avenue of cabs and real intersections; nobody close to the camera in FS and MS (the subject is the coins); walkers in the road pass through the parked cars and right-side walkers through the café tables; the golden grade still warms everything; the café WS is still a parasol close-up.

## Second gate comparison (2026-10-29, commit b06ce7a)
Sheets: `out/phase7-gate/v2/gate-gravity.png` and `out/phase7-gate/v2/gate-toilets.png`. Ours: the Paris video as planned (day plaza, frame 372), the same with `react: "lift"` 0.7 s after the 16x beat (confetti), with `react: "crack"` at 23:30 (night breaking, frame 410), `ReactionsPreviewCrack` 4 s after its 16x beat (night ground), and the street video after the street pass (frames 45, 260, 418).

| Gate item | Where we are now |
|---|---|
| 1. Typography | Matches (unchanged). |
| 3. Dressed places | Plaza: a market of about 30 stalls with produce, parasols and planters, real paving. Still thinner than the reference's packed rows, and the Paris blocks are all one beige where the reference has colourful houses, a bell tower and hills behind. Street: water tanks, crossings with signals, hydrants, trash bags, taxis; facades are pastel kit models, not brick and stone. |
| 4. Visible life | Unchanged: no people in world places (the crowd is off by the user's choice); the street kit's walkers are small in frame; no close-up of a person exists. |
| 5. Camera language | Street FS/MS now frame people and storefronts at head height; plaza wides look across the market from above; shots hold on a reaction. Street trees still fill the hero shots. |
| 6. Light and atmosphere | Night: a moon key with shadows, stars, lit windows, a moon disc when the shot faces it. Day street: crisp blue sky instead of the golden haze. |
| 7. The world reacts | Every counter beat in a place moves it: stalls and debris lift, confetti, money, the ground cracks and breaks into slabs (the night-ground frame now reads close to the reference), floods, snow, lights out, buildings lifting. |
| 8. The verdict | The user's. The reaction and night frames are closest; the biggest gaps left are people (a decision), house colour and landmark variety in the old towns, and the New York facades. |
