/**
 * lib/help.ts, single source of truth for in-dashboard documentation.
 * Each control with an `InfoTip` pulls its copy from this registry, and the
 * Help screen lists all of it: one file to edit, always in sync.
 */
export interface HelpEntry {
  id: string;
  title: string;
  body: string;
  group: "Create" | "Library" | "Settings";
}

export const HELP_GROUPS: HelpEntry["group"][] = ["Create", "Library", "Settings"];

export const HELP: HelpEntry[] = [
  {
    id: "story-engine",
    title: "How a video is made",
    group: "Create",
    body:
      "You write one \"what if\" idea. The AI writes a story, picks the scenes, " +
      "the camera moves and every sound from the free models and sounds that " +
      "ship with this project. You read the plan first. Nothing is made until " +
      "you approve it.",
  },
  {
    id: "formats",
    title: "Shape and length",
    group: "Create",
    body:
      "Vertical (9:16) is for Shorts, Reels and TikTok, 15 to 90 seconds. " +
      "Landscape (16:9) is for YouTube and longer videos, up to 10 minutes. " +
      "Square (1:1) is for feeds, up to 90 seconds. Leave the length on " +
      "Automatic and the AI picks a length that fits the story.",
  },
  {
    id: "quality",
    title: "Draft or final",
    group: "Create",
    body:
      "Final makes the video at full size. Draft makes it at half size, which " +
      "is much faster: good for checking a story before the real thing.",
  },
  {
    id: "review-pass",
    title: "AI review pass",
    group: "Create",
    body:
      "A second AI reads the story, points out weak moments and the writer " +
      "rewrites them before you see the plan. It costs one extra AI call. " +
      "When you read and approved the story first, it is kept as you approved " +
      "it: the notes are listed on the plan for you to act on in the editor.",
  },
  {
    id: "channels",
    title: "Channels",
    group: "Create",
    body:
      "Each channel is one kind of video, for one of your YouTube channels: " +
      "\"what if\" explainers, action shorts, dramas or documentaries. The " +
      "channel decides how the story is built, which music moods and devices " +
      "it uses, and the format, caption look and voices it starts with. You " +
      "can still change the format, voices and captions on the next steps. " +
      "Channels are the files in the channels folder.",
  },
  {
    id: "own-story",
    title: "Your own story",
    group: "Create",
    body:
      "Paste a story or a script you wrote. \"Rewrite it into beats\" keeps " +
      "your plot and characters and lets the AI cut and rephrase. \"Keep my " +
      "words\" keeps every word you wrote: the AI only adds what each beat " +
      "shows and how the characters look, and the video is as long as your " +
      "script when read aloud. Put a character's name before their line " +
      "(Ana: Where were you?), what the camera shows in [brackets], and a " +
      "line of --- between acts.",
  },
  {
    id: "story-check",
    title: "Read the story first",
    group: "Create",
    body:
      "The AI writes the story, times it, and stops. You read the hook, the " +
      "lines and the characters before anything else is planned. Approve it " +
      "and the AI plans the scenes, the camera and the sound around it; write " +
      "it again if it is not right. The story is saved, so it is never written " +
      "twice. Turn this off to go straight to the full plan.",
  },
  {
    id: "story-review",
    title: "Checking the story",
    group: "Create",
    body:
      "This is the story the AI wrote, with its length when read aloud. " +
      "Nothing else is planned yet. Approve it and the AI goes on with the " +
      "scenes, the camera and the sound, then shows you the whole plan. If a " +
      "plan stops on the way (a crash or a restart), it can resume from the " +
      "step that stopped: the finished steps are kept.",
  },
  {
    id: "shopping-list",
    title: "The shopping list",
    group: "Create",
    body:
      "After the story, the AI lists everything it needs and checks the library. " +
      "When something is missing, it stops here. For each thing, get one of the " +
      "offers, keep what stands in for it now, ask for it to be built, or leave " +
      "it out. Nothing is downloaded until you choose, and each licence is read " +
      "again first: free (CC0) items, and models that only ask for a credit. " +
      "Approve every CC0 pick gets the best free offer of everything you did not change.",
  },
  {
    id: "assets",
    title: "Assets",
    group: "Library",
    body:
      "Where the factory gets models, sounds and music, and whether each source " +
      "works without a key; the build requests (things only new code can make), " +
      "most asked first; and every item downloaded so far, with its licence and " +
      "where it came from.",
  },
  {
    id: "voices",
    title: "Narration and character voices",
    group: "Create",
    body:
      "Narration is one voice that tells the story. Character voices speak the " +
      "lines of each character. Both are optional and made on this computer. " +
      "KittenTTS 2 is fast; VoxCPM2 sounds best but is slower. After the plan is " +
      "written you can give each character a different voice.",
  },
  {
    id: "captions",
    title: "Captions",
    group: "Create",
    body:
      "The words on screen. Pick a look from the gallery; the preview shows " +
      "exactly how it will appear. Open Adjust the look to change the font, " +
      "colours, size, position and animation.",
  },
  {
    id: "plan-review",
    title: "Checking the plan",
    group: "Create",
    body:
      "The plan shows the story, the scenes and camera shots, the sound and the " +
      "settings, one part at a time. If it looks right, approve it and the video " +
      "is made. If not, go back and change your choices, or open it in the " +
      "editor to change single lines, shots and sounds.",
  },
  {
    id: "job-stages",
    title: "While the video is made",
    group: "Create",
    body:
      "Making a video has a few steps: getting ready, voices, building the 3D " +
      "world, filming every frame and saving the file. Filming takes the " +
      "longest. You can leave this screen: the status area shows the progress " +
      "and a message appears when the video is ready.",
  },
  {
    id: "editor",
    title: "The editor",
    group: "Library",
    body:
      "Change a planned video without starting over: click anything on the " +
      "timeline to change it, or ask the AI for a change. Every save is a new " +
      "version, so Undo always works. Make the video renders only the parts " +
      "that changed.",
  },
  {
    id: "videos-review",
    title: "Review frames",
    group: "Library",
    body:
      "Some videos come with one picture per second so you can check every " +
      "moment without playing it. When a video has them, Review frames shows them.",
  },
  {
    id: "library-files",
    title: "Where videos are saved",
    group: "Library",
    body:
      "Every video lives in the output folder of this project, in a folder of " +
      "its own (the video, a thumbnail and the plan). Delete removes that folder.",
  },
  {
    id: "providers-key",
    title: "Sign-in keys",
    group: "Settings",
    body:
      "Keys are saved only on this computer, never shared with anything else. " +
      "After saving one, press Get models to load the list of models.",
  },
  {
    id: "providers-test",
    title: "Check a provider",
    group: "Settings",
    body:
      "Sends one short test message to the provider to check that the key " +
      "works, and shows how long the answer took.",
  },
  {
    id: "model-roles",
    title: "Model roles",
    group: "Settings",
    body:
      "Each step of writing a plan (the writer, the director, the sound " +
      "designer, the reviewer and the editor) can use its own model. A role on " +
      "Default uses the default provider.",
  },
  {
    id: "voice-engines",
    title: "Voice engines",
    group: "Settings",
    body:
      "The voices are made on this computer by two engines that are downloaded " +
      "once: KittenTTS 2 (small and fast) and VoxCPM2 (large, best quality). " +
      "They are saved in the project's .tts folder.",
  },
];

export const helpById = (id: string): HelpEntry | undefined => HELP.find((h) => h.id === id);
