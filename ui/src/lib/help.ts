/**
 * lib/help.ts, single source of truth for in-dashboard documentation.
 * Each control with an `InfoTip` pulls its copy from this registry, and the
 * global Help dialog lists all of it - one file to edit, always in sync.
 */
export interface HelpEntry {
  id: string;
  title: string;
  body: string;
  group: "Generate" | "Sound design" | "Videos" | "Providers";
}

export const HELP: HelpEntry[] = [
  {
    id: "story-engine",
    title: "Story engine",
    group: "Generate",
    body:
      "You write one \"what if\" idea. The AI reads our full real inventory " +
      "(every free model, sound and camera tool) and authors a complete plan: " +
      "the city street scene, a subject prop that grows or vanishes with the " +
      "story, the stat beats, on-screen text and every sound. Every video is a " +
      "fresh composition, never a recycled one. Nothing renders until you " +
      "approve the plan.",
  },
  {
    id: "sound-design",
    title: "Sound design step",
    group: "Sound design",
    body:
      "Every video places sounds: wind beds, whooshes, impacts. Each role has " +
      "one or more variants. Audition them here, pick per role, or leave Auto " +
      "(best). Your choices are saved for future renders.",
  },
  {
    id: "auto-best",
    title: "Auto (best)",
    group: "Sound design",
    body:
      "Auto picks the strongest sound for each role and is the default. Pick " +
      "an explicit variant only when you want a different sound.",
  },
  {
    id: "advanced-template",
    title: "Old way (advanced)",
    group: "Generate",
    body:
      "This is the older pipeline for testing extra options. You don't need it " +
      "to make videos with the story engine.",
  },
  {
    id: "job-stages",
    title: "Render stages",
    group: "Generate",
    body:
      "Story videos run four stages: music bed, packing, rendering frames, " +
      "and saving. Renders are checked automatically: every second is measured " +
      "for sound so nothing comes out silent.",
  },
  {
    id: "videos-review",
    title: "Review frames",
    group: "Videos",
    body:
      "Story renders come with one still per second so you can check every " +
      "moment. These review folders exist for the older pipeline's renders.",
  },
  {
    id: "providers-key",
    title: "Sign-in keys",
    group: "Providers",
    body:
      "Keys are saved only on this computer, never shared with anything else. " +
      "After saving, click Fetch models to load the live model list.",
  },
  {
    id: "providers-test",
    title: "Test provider",
    group: "Providers",
    body:
      "Sends one test message to the provider to check the key works. How long " +
      "it took is shown in the toast.",
  },
];

export const helpById = (id: string): HelpEntry | undefined =>
  HELP.find((h) => h.id === id);