# 02 — Prior art: does something better already exist? (checked 2026-10-22)

**Answer: no.** No open-source project lets an AI direct low-poly 3D in Remotion with only Ollama models and then edit the result. We build it, borrowing the ideas listed at the end.

| Project | What it is | Why we don't adopt it |
|---|---|---|
| [MoneyPrinterTurbo](https://news.creeta.com/en/open-source-youtube-longform-pipeline-2026/) (~100k+ stars), ShortGPT | Script → TTS → stock footage → captions | Stock clips, not 3D, no shot direction. Reportedly has no scene-pacing or narrative-timing layer |
| [OpenMontage](https://github.com/calesthio/OpenMontage) (AGPLv3) | A coding-assistant-driven studio: YAML pipelines, Python tools, 500+ skill files | Built on paid generation APIs (Veo, Kling, FLUX, ElevenLabs). **Copying its code would put AGPL obligations on ours.** Ideas only |
| [FilmAgent](https://arxiv.org/pdf/2501.12909) (HITsz-TMG) | AI agents acting as director, screenwriter, actors and cinematographer in Unity 3D: 15 locations, 21 actions, 272 predefined shots, Critique-Correct-Verify and Debate-Judge loops | Its [GitHub repo](https://github.com/HITsz-TMG/FilmAgent) now leads to **VideoClaw**, which calls generative video models (Kling, Wan, Seedance). It used Unity, not Remotion |
| [Cutscene Agent](https://arxiv.org/html/2604.25318) (Kuaishou GameMind) | Unreal Engine MCP toolkit. A director agent with animation, cinematography and sound sub-agents. A **photographer sub-agent reviews rendered screenshots**. Camera templates (over-the-shoulder, orbit…) | **No code released.** The closest design to ours |
| [Anim-Director](https://github.com/HITsz-TMG/Anim-Director), MovieAgent, AniMaker | Multi-agent storyboard pipelines | Generate images and video, not 3D |
| [Remotion agent skills](https://gaga.art/blog/remotion-skills/) (`npx skills add remotion-dev/skills`) | Official rule files that teach coding agents to write Remotion code | Knowledge files, not a pipeline. Useful when using Claude Code on this repo |
| [Blender MCP servers](https://github.com/HoldMyBeer-gg/blenderwright) ([djeada demo](https://github.com/djeada/blender-mcp-server/blob/main/docs/demos/03-animation-headless.md)) | An AI drives Blender tool by tool; headless EEVEE rendering | No story-to-video layer. Headless EEVEE depends on a GPU context. A possible future render engine, but not now |
| [ClawVid](https://medium.com/composiohq/i-built-a-faceless-ai-video-pipeline-using-openclaw-composio-remotion-clawvid-heres-05618dc79705), [claude-faceless-shorts-creator](https://github.com/topics/faceless-video), [Nova-Motion](https://github.com/topics/remotion-video) | Remotion plus fal.ai or ElevenLabs faceless pipelines | Paid APIs, 2D, and small or uneven maintenance |
| [Animato](https://github.com/otdnnc/Animato) | An AI writes Blender scripts that animate an existing rigged model | Blender only; could help with custom character animation later |
| [threejs-animation skill](https://www.typingmind.com/skills/calesthio-threejs-animation) (AGPL) | A Markdown skill teaching LLMs to write three.js animation | Knowledge only, AGPL |

## Ideas we borrow (already in [05-plan.md](05-plan.md))
- **From Cutscene Agent:** split the AI into a director with cinematographer, animation and sound sub-agents. Also the **photographer** vision role, which reviews one draft still per shot and sends failing shots back to the director (Phase 3, step 6).
- **From FilmAgent:** the Critique-Correct-Verify loop (our critic role) and a library of predefined shot templates (our camera vocabulary).
- **From ClawVid:** TTS-first timing, so scene timing comes from the real voice length (Phase 2).
