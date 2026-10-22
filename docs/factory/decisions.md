# Decisions log

| Date | Decision | Notes |
|---|---|---|
| 2026-10-22 | **Visual style: stylized low-poly 3D only, much higher quality** | No realistic images or video, no image-generation models. Remotion + React Three Fiber stays the engine. |
| 2026-10-22 | **TTS: support both KittenTTS 2 and VoxCPM2** | The dev laptop has no NVIDIA GPU and runs Kitten only. VoxCPM2 runs on the other (GPU) machine. Kitten is the default that always works. |
| 2026-10-22 | **Audio: free CC0 libraries** | Download once and tag. No synthesized sounds, no generative audio, no paid APIs. Sonniss is excluded because of its no-AI-use clause. See [03-audio-sources.md](03-audio-sources.md). |
| 2026-10-22 | **AI provider: Ollama Pro cloud only** | Each pipeline role (writer, director, sound, critic, editor, photographer/vision) gets its own model, chosen in the UI. |
| 2026-10-22 | **Delivery: phased milestones** | Each phase ends with something runnable that the user reviews before the next phase starts. |
| 2026-10-22 | **Formats: 9:16 (15–90s), 16:9 (up to ~10 min), 1:1** | Camera framing and caption layout must adapt to the aspect ratio. Long-form stories are written act by act. |
| 2026-10-22 | **Characters: CC0 rigged low-poly** | Kenney and Quaternius/Poly Pizza packs, recoloured, with an action timeline from the director. |
| 2026-10-22 | **Editing: browser editor with live Remotion Player preview** | Edit beats, shots, captions, camera, music. "Ask AI" to change one beat. Only changed lines are re-voiced and only changed chunks re-rendered. |
| 2026-10-22 | **No off-the-shelf replacement exists, so we build it** | We borrow ideas from Cutscene Agent, FilmAgent and ClawVid. See [02-prior-art.md](02-prior-art.md). |
