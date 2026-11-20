/**
 * scripts/method-demo.ts — keyless demo specs for method B's gates.
 *
 * `sea` is the art-direction reference (one boat, no data). `depth` is the
 * data film: one continuous dive, six real depths, captions, no API keys.
 *
 * Every number in `depth` is checkable:
 *   40 m      PADI recreational depth limit (open water)
 *   332 m     Ahmed Gabr, deepest scuba dive, 2014 (Guinness World Records)
 *   828 m     Burj Khalifa, total height
 *   3 800 m   RMS Titanic wreck site
 *   8 849 m   Mount Everest, 2020 joint China–Nepal survey
 *   10 935 m  Challenger Deep, NOAA
 *   3 700 m   mean ocean depth, NOAA
 *
 * The caption windows come from the same depthPlan the picture uses, so the
 * words and the counter are always on the same number.
 */
import { depthPlan, type DepthBlock } from "../src/methods/animation/depth-plan";
import type { ShotSpec } from "../src/generator/spec.schema";

const base = {
  id: "demo",
  fps: 30,
  width: 1080,
  height: 1920,
  palette: "pastelDay",
  events: [],
} as const;

export function seaDemo(): ShotSpec {
  return {
    ...base,
    title: "What if the oceans vanished for ten seconds?",
    hook: { text: "What if the oceans vanished?", keywordHighlight: [], t: 0, duration: 2.5 },
    captions: [
      { text: "Right now, the sea looks calm.", from: 0.5, to: 3.2, keyword: ["calm"] },
      { text: "But 71% of the planet is water.", from: 3.4, to: 6.6, keyword: ["71%"] },
      { text: "What happens if it drains away?", from: 6.8, to: 9.6 },
    ],
    scenes: [
      { scene: "beach", kit: "ocean", from: 0, to: 4 },
      { scene: "sea", kit: "ocean", from: 4, to: 8 },
      { scene: "boat", kit: "ocean", from: 8, to: 12 },
    ],
    settings: { format: "9:16", quality: "final" },
  } as unknown as ShotSpec;
}

const DEPTH_BLOCK: DepthBlock = {
  kind: "depth",
  title: "How deep is the ocean?",
  unit: "m",
  source: "NOAA · Guinness World Records · PADI",
  items: [
    { label: "Recreational dive limit", value: 40, art: "diver", note: "PADI open-water limit" },
    { label: "Deepest scuba dive", value: 332, art: "diver", note: "Ahmed Gabr, 2014" },
    { label: "Burj Khalifa", value: 828, art: "tower", note: "The tallest building, end to end" },
    { label: "Titanic wreck", value: 3800, art: "ship", note: "North Atlantic, 3 800 m down" },
    { label: "Mount Everest", value: 8849, art: "mountain", note: "The summit, from the sea floor" },
    { label: "Challenger Deep", value: 10935, art: "trench", note: "The deepest point on Earth" },
  ],
};

/** The words for each stop, in the stops' own (ascending) order. */
const LINES = [
  "A diver can reach 40 metres.",
  "The deepest dive ever: 332 m.",
  "That is one Burj Khalifa, head down.",
  "The Titanic rests at 3,800 m.",
  "Everest would still have 2 km to go.",
  "Challenger Deep: 10,935 m.",
];
const KEYWORDS = [["40"], ["332"], ["Burj"], ["3,800"], ["2 km"], ["10,935"]];

/** Seconds of film: 28 s of story plus the schema's 2 s tail. */
const DURATION = 30;

export function depthDemo(): ShotSpec {
  const plan = depthPlan(DEPTH_BLOCK, DURATION);
  return {
    ...base,
    id: "demo-depth",
    title: "How deep is the ocean?",
    hook: { text: "How deep does it go?", keywordHighlight: [], t: 0, duration: 2.5 },
    data: DEPTH_BLOCK,
    scenes: [{ scene: "deep", kit: "ocean", from: 0, to: 28 }],
    captions: [
      { text: "The ocean is deeper than it looks.", from: 0.4, to: plan.hookEnd - 0.4 },
      ...plan.stops.map((stop, i) => ({
        text: LINES[i],
        from: stop.from + 0.25,
        to: stop.to - 0.2,
        keyword: KEYWORDS[i],
      })),
      { text: "On average, the ocean is 3.7 km deep.", from: plan.closeAt + 0.7, to: DURATION - 0.4, keyword: ["3.7"] },
    ],
    settings: { format: "9:16", quality: "final" },
  } as unknown as ShotSpec;
}

/** `--demo` / `--demo depth`: the argument is the kind, not a flag value. */
export function demoFromArgs(argv: string[]): ShotSpec {
  const i = argv.indexOf("--demo");
  const kind = i >= 0 && argv[i + 1] === "depth" ? "depth" : "sea";
  return kind === "depth" ? depthDemo() : seaDemo();
}
