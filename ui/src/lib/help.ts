/**
 * lib/help.ts — single source of truth for in-dashboard documentation.
 * Each control with an `InfoTip` pulls its copy from this registry, and the
 * global Help dialog lists all of it — one file to edit, always in sync.
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
      "Each story is a bespoke, human-audited composition in src/whatif/videos/<slug>/ — " +
      "real code with beats, scenes, typography, a synthesized music score and placed sound effects. " +
      "Rendering it produces the same verified 1080×1920 vertical MP4 every time.",
  },
  {
    id: "sound-design",
    title: "Sound design step",
    group: "Sound design",
    body:
      "Every video places sound cues (wind beds, whooshes, impacts…). Each role has one or more " +
      "variants: a crafted synth sound and — where available — CC0 field recordings from kenney.nl. " +
      "Audition them here, pick per role, or leave Auto (best). Your choices are saved for future renders.",
  },
  {
    id: "auto-best",
    title: "Auto (best)",
    group: "Sound design",
    body:
      "Auto keeps the strongest variant per role — usually a real CC0 recording — and is the default. " +
      "Pick an explicit variant only when you want a different character for that sound.",
  },
  {
    id: "advanced-template",
    title: "AI spec (advanced)",
    group: "Generate",
    body:
      "The legacy pipeline: an LLM writes a shot spec from your premise, then the template renderer " +
      "animates it. Needs a provider key (or the offline family templates). The story engine is the primary path.",
  },
  {
    id: "job-stages",
    title: "Render stages",
    group: "Generate",
    body:
      "Story videos run four stages: Music bed (synthesized to the story's mood + seed), Bundle " +
      "(Remotion packs the composition), Render (every frame drawn at 1080×1920) and Encode (H.264 + AAC mux). " +
      "Renders are verified automatically: per-second loudness checks with zero tolerance for dead audio.",
  },
  {
    id: "videos-review",
    title: "Review frames",
    group: "Videos",
    body:
      "Story renders ship with an extracted frame strip (one still per second) that was visually inspected " +
      "during the authoring loop. Story videos are verified at build time, so review folders only exist for " +
      "AI-spec pipeline renders.",
  },
  {
    id: "providers-key",
    title: "API keys",
    group: "Providers",
    body:
      "Keys are saved to the local .env file — never sent to the browser, never used for anything besides your own renders. " +
      "After saving, click Fetch models to load the live model list.",
  },
  {
    id: "providers-test",
    title: "Test provider",
    group: "Providers",
    body:
      "Runs a real 1-token generation against the provider to verify the key works end-to-end. " +
      "Latency and token counts are shown in the toast.",
  },
];

export const helpById = (id: string): HelpEntry | undefined =>
  HELP.find((h) => h.id === id);
