/**
 * scripts/storyboard-codegen.ts — turns approved storyboards into bundle-ready
 * components.
 *
 * For each storyboard under public/whatif-data/<slug>/ with an `approved`
 * marker, writes (or refreshes) src/whatif/videos/generated/<slug>.ts — a
 * tiny module inlining the storyboard JSON and wrapping the GENERIC
 * StoryboardVideo — then rewrites the generated barrel so the next `bundle`
 * picks every approved story up. Stories are DATA, never per-video code.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const DATA_DIR = join(ROOT, "public", "whatif-data");
const GEN_DIR = join(ROOT, "src", "whatif", "videos", "generated");

export interface CodegenResult {
  written: string[];
  removed: string[];
}

/** Write the wrapper for one slug + refresh the barrel. */
export function codegenStoryboard(slug: string, durationSec?: number): void {
  const sbPath = join(DATA_DIR, slug, "storyboard.json");
  const sb = JSON.parse(readFileSync(sbPath, "utf8")) as {
    title: string;
    targetSeconds: number;
    fps: number;
    music: { mood: string; seed: number };
  };
  const finalSec = durationSec ?? sb.targetSeconds;
  const durationInFrames = Math.round(finalSec * (sb.fps ?? 30));
  const moduleSrc = `/**
 * src/whatif/videos/generated/${slug}.ts — AUTO-GENERATED from
 * public/whatif-data/${slug}/storyboard.json (scripts/storyboard-codegen.ts).
 * The story is data; the renderer is the generic StoryboardVideo component.
 */
import * as React from "react";
import { StoryboardVideo } from "../../storyboard/video";
import { StoryboardSchema, type Storyboard } from "../../storyboard/schema";
import type { GeneratedStory } from "./index";

export const STORYBOARD: Storyboard = StoryboardSchema.parse(${JSON.stringify(sb)});

export const COMPONENT: GeneratedStory = {
  slug: ${JSON.stringify(slug)},
  title: ${JSON.stringify(sb.title)},
  durationInFrames: ${durationInFrames},
  fps: ${sb.fps ?? 30},
  music: ${JSON.stringify(sb.music ?? { mood: "dark-tension", seed: 1 })},
  component: () =>
    React.createElement(StoryboardVideo, { storyboard: STORYBOARD, slug: ${JSON.stringify(slug)} }),
};
`;
  mkdirSync(GEN_DIR, { recursive: true });
  writeFileSync(join(GEN_DIR, `${slug}.ts`), moduleSrc);
  refreshBarrel();
}

function refreshBarrel(): void {
  const slugs = readdirSync(GEN_DIR)
    .filter((f) => f.endsWith(".ts") && !f.startsWith("index") && f !== "index.ts")
    .map((f) => f.replace(/\.ts$/, ""));
  const head = [
    "/**",
    " * src/whatif/videos/generated/index.ts — AUTO-GENERATED barrel",
    " * (scripts/storyboard-codegen.ts). Every approved storyboard story.",
    " */",
    'import * as React from "react";',
  ];
  const body = slugs.map((s) => `import { COMPONENT as C_${s.replace(/-/g, "_")} } from "./${s}";`);
  const list = `export interface GeneratedStory {
  slug: string;
  title: string;
  durationInFrames: number;
  fps: number;
  music: { mood: string; seed: number };
  component: React.FC;
}

export const GENERATED_STORIES: GeneratedStory[] = [
${slugs.map((s) => `  C_${s.replace(/-/g, "_")},`).join("\n")}
];
`;
  writeFileSync(join(GEN_DIR, "index.ts"), `${head.join("\n")}\n${body.join("\n")}\n${body.length ? "\n" : ""}${list}`);
}

/** Codegen every approved storyboard. durationSec override = VO-timed length. */
export function codegenAllApproved(durationSec?: number): CodegenResult {
  const written: string[] = [];
  if (!existsSync(DATA_DIR)) return { written, removed: [] };
  for (const slug of readdirSync(DATA_DIR)) {
    if (!existsSync(join(DATA_DIR, slug, "approved"))) continue;
    if (!existsSync(join(DATA_DIR, slug, "storyboard.json"))) continue;
    codegenStoryboard(slug, durationSec);
    written.push(slug);
  }
  return { written, removed: [] };
}

/* CLI: npx tsx scripts/storyboard-codegen.ts [<slug>] */
if (process.argv[1] && /storyboard-codegen(\.ts)?$/.test(process.argv[1])) {
  const only = process.argv[2];
  const res = only ? (codegenStoryboard(only), { written: [only], removed: [] }) : codegenAllApproved();
  console.log(`[codegen] ${res.written.join(", ") || "(none approved yet)"}`);
}