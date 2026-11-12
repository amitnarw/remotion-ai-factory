# 22 — An automated motion-design system, compared with the factory (2026-11-05)

The user shared two things on 2026-11-05: a post listing 16 open-source tools ("Remotion, Storyboarder, Anime.js, Flubber, Pixelorama, Three.js, PlayCanvas, cannon-es, Sverchok, Effekseer, twigl, Bark, Pedalboard, OBS Studio, Shotcut, FFmpeg"; "Brief → scenes → motion → sound → render → launch"), and a link to an X article. This page records what the article says, how it compares with the factory, what we borrow and what we leave.

## What the linked article says
Read through `api.fxtwitter.com` (x.com refused automated reads). The first half was read verbatim; the second half (about 34,000 characters: its skill, sample campaign file and build prompt) only as a summary, so those details are unverified.
- **Title:** "How to Build an Automated Motion Design System that Generates $$$" (2026-10-13; the author describes themselves as a VFX supervisor). It does not contain the 16-tool list, and it says you don't need twenty GitHub repositories.
- **Pipeline:** brief → structured data → animation engine → frame review → video render → campaign variants. Six parts: a brief compiler, a scene engine, a renderer, a quality controller, a variant generator, a delivery system.
- **Claude's role:** Opus 5.5 in Claude Code writes and maintains those parts as a coding agent. It doesn't hand-animate.
- **Tools:**
  - Remotion (reusable compositions driven by data);
  - Remotion's agent skills (`github.com/remotion-dev/skills`, `npx skills add remotion-dev/skills`);
  - optionally Playwright with FFmpeg for a custom `seek(t)` renderer;
  - optionally HeyGen's HyperFrames.
- **Its rules:**
  - sound is part of the timeline;
  - review contact sheets of rendered frames, and never trust "the animation looks great";
  - performance claims must come from approved data.
- **Its example:** 18 exports from one campaign (3 hooks × 3 aspect ratios × 2 calls to action).

## How it compares
| | The article's system | The factory |
|---|---|---|
| Made for | client ad and motion-graphics campaigns (branded 2D templates) | story videos for YouTube channels in several genres (a 3D world, voices, sound design) |
| Who decides the content | the brief; templates do the rest | the AI writes the story and directs places, time, shots, actors, reactions and sound |
| Checks | contact sheets | contact sheets, the photographer's checks, loudness measurement, frame determinism |
| Output | many variants per brief, packaged for delivery | one video per run in a chosen format (until the variants work below) |
| Strengths over ours | fewer moving parts, fast 2D renders, variants, delivery packaging | everything a story channel needs that templates can't do |

For the user's goal (story channels), the factory is far ahead. The article's system is better at variants, delivery and reliability. So we borrow those ideas rather than switch.

## What we borrow (built from 2026-11-05; see HANDOFF §2)
1. **Variants:** alternative hooks, endings and formats from one run, reusing everything else (status/variants.md).
2. **A publish pack:** title options, a description with chapters and the automatic CC-BY credits, tags and a thumbnail (status/publish.md, 20-publish.md).
3. **Channel branding:** per-channel logo, colours, fonts, intro and outro bumpers. Also Flubber shape morphs for graphics (status/brand.md).
4. **Claims need support:** a story's factual claims are found and judged at the story gate; strict for documentary (status/claims.md).
5. **Room and distance in the mix:** reverb by space and distance on effects, with FFmpeg's own convolution, since Pedalboard is GPL (status/audio.md).
6. **Effekseer:** a research pass only, on licence and on whether an effect can be seeked deterministically (status/vfx.md, 21-vfx-effekseer.md).

**Offered, not done (the user's call):** installing Remotion's agent skills into the Claude setup for coding sessions.

## The 16-tool list, tool by tool
| Tool | Decision |
|---|---|
| Remotion, Three.js, FFmpeg | the factory's core already |
| Storyboarder, Shotcut | manual desktop apps; the AI director and the built-in editor do these jobs |
| Anime.js | not needed: Remotion's frame-driven interpolation does it, deterministically |
| cannon-es | not used, on purpose: a physics engine keeps state between frames, which breaks out-of-order rendering; reactions are closed-form ([11-world-reactions.md](11-world-reactions.md), decision 2026-10-28) |
| PlayCanvas | a different 3D engine; no gain in switching |
| Pixelorama, Sverchok, twigl | pixel art, a Blender add-on, a shader playground: none fit the pipeline or the look |
| OBS Studio | screen recording; only for a screen-capture channel |
| Bark | generative voices and sounds: against the audio rule (CC0 libraries, no generated sound); the voices are KittenTTS 2 and VoxCPM2 |
| Flubber | borrowed (branding agent) |
| Effekseer | researched (vfx agent) |
| Pedalboard | the idea borrowed, through FFmpeg (audio agent) |
</content>
