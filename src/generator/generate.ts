/**
 * src/generator/generate.ts — CLI entry: premise -> shot-spec -> render -> MP4.
 *
 * 100% automated: the user supplies a premise; everything else (shot design,
 * 3D scene assembly, HUD/captions, sound design, render, encode) is handled
 * by the pipeline.
 *
 * Usage:
 *   npm run generate -- "What if gravity disappeared for just 5 seconds?"
 *   npm run generate -- "What if time stopped for just 5 seconds?"
 *   npm run generate -- "<premise>" --provider anthropic --model claude-opus-4-6
 *   npm run generate -- "<premise>" --model "openai/gpt-5-mini"
 *
 * Runs (producer phase P1, docs/factory/15-producer.md): every plan is a run
 * with its own id, output/<slug>-<6 hex>/, so the same premise never
 * overwrites an older one. The producer stops after the story (the story
 * gate) and prints the command that approves it and goes on:
 *   npm run generate -- --resume <run>          approve a waiting story / continue a stopped run
 *   npm run generate -- --status <run>          each stage's state
 *   npm run generate -- "<premise>" --no-story-gate      plan straight through
 *   npm run generate -- --story-from <run> [--format 16:9 ...]   a new run with that run's story
 *
 * Gate 2 (P4): after the story, the breakdown and the library match, the
 * producer stops again when the story needs things a download would give,
 * and prints the shopping list (output/<run>/shopping.json; nothing is
 * downloaded yet) with the commands that choose and go on:
 *   npm run generate -- --resume <run> --all-cc0        get every free (CC0) pick
 *   npm run generate -- --resume <run> --approve n6=bigsoundbank:1048 n2=close n3=build n9=skip
 *   npm run generate -- --resume <run>                  go on with what the library has
 *   npm run generate -- "<premise>" --no-shop-gate      never stop there
 *   --sources kenney,bigsoundbank | none                 the sources it searches (default: every default source)
 *
 * Variants (15-producer.md §17): several versions of one run, rendered after
 * it into output/<run>/variants/<id>/video.mp4 (variants.json lists them):
 *   npm run generate -- "<premise>" --chunked --variants hooks=3,endings=2,formats=9:16,16:9
 *   npm run generate -- variants <run> hooks=3,formats=1:1     add them to a planned run later
 *
 * Publish pack (20-publish.md): --publish writes output/<run>/publish/ after the
 * render (titles, description with chapters and credits, tags, a thumbnail).
 *
 * Supported offline families (no API key required):
 *   gravity | time-stop | spin-stop | air | water | oxygen | electrons
 *   protons | neutrons | light | sun-set
 *
 * For arbitrary premises, configure a provider in ai.config.json + .env and
 * pass --provider/--model (OpenCode-style provider switching).
 */
import { writeFileSync, mkdirSync, statSync, readFileSync, existsSync, rmSync, lstatSync, readdirSync, rmdirSync, symlinkSync, unlinkSync } from "fs";
import { dirname, join } from "path";
import { execFileSync } from "child_process";
import { FFMPEG } from "./ffmpeg";
import { validateSpec, SettingsSchema, type ShotSpec, type VideoSettings } from "./spec.schema";
import { videoFrames } from "../compositions/brand/length";
import { disposeTtsWorkers, runTtsStage, type TtsAudioConfig } from "./tts";
import { resolveAudio } from "./audio-resolve";
import { masterAudio } from "./audio-master";
import { generateSpec } from "./ai/generate-spec";
import { creditsForPlaces } from "../world/landmarks";
import { PLACES } from "../world/places";
import { canReassemble, reassemble, resumePlan, ShopGateStop, StoryGateStop, type PlanReport, type ShopDecision } from "./pipeline/run";
import { formatCheck } from "./pipeline/checker";
import { formatClaims } from "./pipeline/claims";
import { describeRun, isComplete, newRunId, nextStage, readBrief, readRun, STAGE_LABELS, waitsForShopping, waitsForStory } from "./pipeline/manifest";
import { DEFAULT_CHANNEL, listChannels, loadChannel, STORY_MODES, type ChannelProfile, type StoryMode } from "./ai/channels";
import { scriptPremise } from "./pipeline/script";
import { formatShoppingList } from "./library/shopping";
import { formatShopping, parseApprovals } from "./library/acquire/acquire";
import { SOURCES, sourceById } from "./library/acquire/sources";
import type { NeedsFile } from "./library/match";
import type { AudioConfig } from "./pipeline/voice";
import { validateAssets } from "./asset-catalog";
import { renderChunked, type ChunkStats } from "./render";
import { ensureBundle } from "./render/bundle";
import { projectRoot } from "./render/root";
import { makePublishPack } from "./publish";
import { formatVariantAsk, makeVariants, parseVariantAsk, type VariantAsk, type VariantRenderer } from "./pipeline/variants";

// Render from an EXPLICIT fresh bundle (out/render-bundle-<id>). Passing
// src/index.ts to `remotion render` triggers the CLI's auto-bundle, which
// intermittently serves a stale cached bundle on this machine — an explicit
// bundle step always builds from current code. Per-id so concurrent renders
// (the milestone pool) never write the same directory.
// The drive letter upper-cased: a `c:\` path bundles differently (render/root.ts).
const BUNDLE_SRC = join(projectRoot(), "src", "index.ts");
const COMP_ID = "WhatIfVideo";
// The Remotion CLI's own script, run with this node (portable; no remotion.cmd).
const REMOTION_CLI = join(process.cwd(), "node_modules", "@remotion", "cli", "remotion-cli.js");
const OUTPUT_DIR = join(process.cwd(), "output");
const FPS = 30;

/** Get the per-video output directory: output/<id>/ */
function videoOutputDir(id: string): string {
  return join(OUTPUT_DIR, id);
}

/** Ensure the per-video output directory exists. */
function ensureVideoOutputDir(id: string): void {
  mkdirSync(videoOutputDir(id), { recursive: true });
}

/** Duration in frames from a spec (last scene end + 2s tail; street-block
 *  scenes end with the story — only a short breather after the last frame),
 *  with a channel brand's intro and outro bumpers. */
function durationFrames(spec: ShotSpec): number {
  return videoFrames(spec, spec.fps ?? FPS);
}

/** Parse argv into { premise, provider, model, noRender, fromSpec, ... }. */
function parseArgs(argv: string[]): {
  premise: string;
  provider: string | undefined;
  model: string | undefined;
  noRender: boolean;
  fromSpec: string | undefined;
  audioFile: string | undefined;
  chunked: boolean;
  resume: string | undefined;
  status: string | undefined;
  noStoryGate: boolean;
  storyFrom: string | undefined;
  channel: string | undefined;
  scriptFile: string | undefined;
  mode: string | undefined;
  channels: boolean;
  noShopGate: boolean;
  approvals: string[];
  allFree: boolean;
  sources: string | undefined;
  variants: string | undefined;
  publish: boolean;
  settings: Partial<VideoSettings>;
} {
  const settings: Partial<VideoSettings> = {};
  let provider: string | undefined;
  let model: string | undefined;
  let noRender = false;
  let fromSpec: string | undefined;
  let audioFile: string | undefined;
  let chunked = false;
  let resume: string | undefined;
  let status: string | undefined;
  let noStoryGate = false;
  let storyFrom: string | undefined;
  let channel: string | undefined;
  let scriptFile: string | undefined;
  let mode: string | undefined;
  let channels = false;
  let noShopGate = false;
  const approvals: string[] = [];
  let allFree = false;
  let sources: string | undefined;
  let variants: string | undefined;
  let publish = false;
  const premiseParts: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-shop-gate") {
      // Plan on without stopping at the shopping list (gate 2).
      noShopGate = true;
    } else if (a === "--approve" && argv[i + 1]) {
      // Gate 2's choices: n6=bigsoundbank:1048 n2=close n3=build n9=skip (one or several, comma or space separated).
      approvals.push(...argv[++i].split(/[\s,]+/).filter(Boolean));
    } else if (/^n\d+=\S+$/.test(a)) {
      // More of gate 2's choices after --approve.
      approvals.push(a);
    } else if (a === "--all-cc0") {
      // Gate 2: approve the best free (CC0) offer of every need not named.
      allFree = true;
    } else if (a === "--sources" && argv[i + 1]) {
      // The sources gate 2 searches: kenney,bigsoundbank,... or none.
      sources = argv[++i];
    } else if (a === "--publish") {
      // The publish pack after the render (titles, description, tags, thumbnail; 20-publish.md).
      publish = true;
    } else if (a === "--variants" && argv[i + 1]) {
      // Versions of the video after its render: hooks=3,endings=2,formats=9:16,16:9.
      variants = argv[++i];
    } else if (a === "--provider" && argv[i + 1]) {
      provider = argv[++i];
    } else if (a === "--model" && argv[i + 1]) {
      model = argv[++i];
    } else if (a === "--no-render") {
      noRender = true;
    } else if (a === "--resume" && argv[i + 1]) {
      // Continue a run: approve its waiting story, or start at the stage that stopped.
      resume = argv[++i];
    } else if (a === "--status" && argv[i + 1]) {
      status = argv[++i];
    } else if (a === "--no-story-gate") {
      // Plan straight through, without stopping for the story's approval.
      noStoryGate = true;
    } else if (a === "--story-from" && argv[i + 1]) {
      // A new run that takes the story of an earlier one (no writer call).
      storyFrom = argv[++i];
    } else if (a === "--channel" && argv[i + 1]) {
      // The channel's profile: channels/<id>.json (default what-if).
      channel = argv[++i];
    } else if (a === "--script" && argv[i + 1]) {
      // The user's own story or script, a text file.
      scriptFile = argv[++i];
    } else if (a === "--mode" && argv[i + 1]) {
      // premise | adapt | as-written
      mode = argv[++i];
    } else if (a === "--channels") {
      channels = true;
    } else if (a === "--from-spec" && argv[i + 1]) {
      fromSpec = argv[++i];
    } else if (a === "--audio-file" && argv[i + 1]) {
      audioFile = argv[++i];
    } else if (a === "--chunked") {
      // Chunked, cached render (src/generator/render) instead of one `remotion render`.
      chunked = true;
    } else if (a === "--format" && argv[i + 1]) {
      settings.format = argv[++i] as VideoSettings["format"];
    } else if (a === "--duration" && argv[i + 1]) {
      settings.targetDuration = Number(argv[++i]);
    } else if (a === "--scenes" && argv[i + 1]) {
      settings.sceneCount = Number(argv[++i]);
    } else if (a === "--quality" && argv[i + 1]) {
      settings.quality = argv[++i] as VideoSettings["quality"];
    } else if (a === "--critic") {
      settings.critic = true;
    } else if (a === "--settings-json" && argv[i + 1]) {
      try {
        Object.assign(settings, JSON.parse(argv[++i]));
      } catch {
        console.error("--settings-json must be a JSON object, e.g. '{\"format\":\"16:9\"}'");
        process.exit(1);
      }
    } else if (!a.startsWith("--")) {
      premiseParts.push(a);
    }
  }
  return {
    premise: premiseParts.join(" ").trim(),
    provider,
    model,
    noRender,
    fromSpec,
    audioFile,
    chunked,
    resume,
    status,
    noStoryGate,
    storyFrom,
    channel,
    scriptFile,
    mode,
    channels,
    noShopGate,
    approvals,
    allFree,
    sources,
    variants,
    publish,
    settings,
  };
}

/** A run id on the command line (the same rule as the server's). */
function checkRunId(id: string): void {
  if (!/^[a-z0-9-]+$/.test(id)) {
    console.error(`"${id}" is not a run id (lower-case letters, digits and dashes, e.g. what-if-money-doubled-3f9a1c)`);
    process.exit(1);
  }
}

/** `--channels`: every channel, its formats and its story modes. */
function printChannels(): void {
  for (const c of listChannels()) {
    const formats = c.formats.allowed.map((a) => `${a.format} ${a.min}-${a.max}s`).join(", ");
    console.log(`${c.id.padEnd(12)} ${c.name}: ${c.genre}. Modes: ${c.writer.modes.join(", ")} (a script: ${c.writer.scriptMode}). ${formats}.`);
  }
  console.log(`Use one with --channel <id> (default ${DEFAULT_CHANNEL}); profiles are channels/<id>.json.`);
}

/** `--sources kenney,bigsoundbank` (or `none`): the sources gate 2 searches. */
function parseSources(text: string): string[] {
  if (text === "none") return [];
  const ids = text.split(",").map((s) => s.trim()).filter(Boolean);
  for (const s of ids) if (!sourceById(s)) throw new Error(`--sources: no source called "${s}" (${SOURCES.map((x) => x.id).join(", ")}, or none)`);
  return ids;
}

/** `--status <run>`: each stage's state and what comes next. */
function printStatus(id: string): void {
  const run = readRun(id);
  if (!run) {
    console.error(`No run "${id}": output/${id}/run.json is missing`);
    process.exit(1);
  }
  console.log(`[producer] ${id}: "${run.premise}"`);
  for (const line of describeRun(run)) console.log(line);
  const next = nextStage(run);
  if (!next) console.log(`The plan is complete. Render it: npm run generate -- --resume ${id}`);
  else if (waitsForStory(run)) console.log(`Next: read output/${id}/story.json, then approve it and go on: npm run generate -- --resume ${id}`);
  else if (waitsForShopping(run)) {
    console.log(`Next: read output/${id}/shopping.json, then choose and go on: npm run generate -- --resume ${id} --all-cc0`);
    console.log(`      (or --approve n6=<source>:<id> n2=close n3=build n9=skip; with neither, the plan goes on with what the library has)`);
  } else console.log(`Next: ${STAGE_LABELS[next]}. Resume: npm run generate -- --resume ${id}`);
}

/**
 * The story gate: the plan stopped after the story. Show it, and the command
 * that approves it and goes on. STORY_ID is the marker server/jobs.ts reads.
 */
function printStoryGate(stop: StoryGateStop, carry: string[]): void {
  const { id, story, length, check } = stop;
  const resume = ["npm run generate -- --resume", id, ...carry].join(" ");
  console.log("");
  console.log("═══ THE STORY IS READY FOR YOUR APPROVAL ═══");
  console.log(`Run:    ${id}`);
  console.log(`Story:  output/${id}/story.json`);
  console.log(`Title:  ${story.title}`);
  console.log(`Hook:   ${story.hook}`);
  console.log(`Length: about ${length.duration.toFixed(1)}s (target ${length.target}s)${length.revised ? "; the writer revised it once to fit" : ""}`);
  for (const c of story.characters) console.log(`Cast:   ${c.name}, ${c.gender}, ${c.age}${c.look ? `: ${c.look}` : ""}`);
  console.log("");
  for (const b of story.beats) {
    console.log(`  ${b.id.padEnd(4)} ${b.say || "(no narration)"}`);
    for (const l of b.lines) console.log(`       ${l.who}: "${l.text}"`);
    console.log(`       seen: ${b.see}`);
  }
  if (check) {
    const lines = formatCheck(check);
    console.log("");
    console.log(`The story checker (output/${id}/story.check.json; it changes nothing):`);
    for (const l of lines.length ? lines : ["no notes"]) console.log(`  ${l}`);
  }
  if (stop.claims) {
    const lines = formatClaims(stop.claims);
    console.log("");
    console.log(`The claims check (output/${id}/story.claims.json${stop.claims.fixed ? "; the writer reworded the flagged ones once" : "; it changes nothing"}):`);
    for (const l of lines.length ? lines : ["no claims"]) console.log(`  ${l}`);
  }
  console.log("");
  console.log("The producer stopped here so you can read the story before the director, the sound and the render.");
  console.log(`  Approve it and go on:  ${resume}`);
  console.log(`  Change it first:       edit output/${id}/story.json, then run the same command`);
  console.log(`  Write it again:        run your first command again (a new run)`);
  console.log(`  Skip this stop:        add --no-story-gate to the first command`);
  console.log(`STORY_ID: ${id}`);
}

/**
 * Gate 2: the plan stopped at the shopping list. Show what the library is
 * missing and the offers (nothing is downloaded yet), and the commands that
 * choose and go on. SHOP_ID is the marker server/jobs.ts reads.
 */
function printShopGate(stop: ShopGateStop, carry: string[]): void {
  const { id, shopping, open } = stop;
  const resume = ["npm run generate -- --resume", id, ...carry].join(" ");
  const waiting = shopping.needs.filter((n) => open.includes(n.need));
  const example = waiting.map((n) => `${n.need}=${n.offers[0]?.ref ?? (n.use ? "close" : "skip")}`).join(" ");
  console.log("");
  console.log("═══ THE SHOPPING LIST IS READY ═══");
  console.log(`Run:    ${id}`);
  console.log(`List:   output/${id}/shopping.json (nothing is downloaded yet)`);
  console.log("");
  console.log(formatShopping({ ...shopping, needs: waiting }));
  console.log("");
  console.log("The producer stopped here: the story needs things the library does not have.");
  console.log("Only what you approve is downloaded, and its licence is checked before it is taken in.");
  console.log(`  Get every free (CC0) pick:  ${resume} --all-cc0`);
  console.log(`  Choose need by need:        ${resume} --approve ${example}`);
  console.log("                              n2=<source>:<id> gets that offer, n2=close keeps the stand-in, n2=build files a build request,");
  console.log("                              n2=skip leaves it out; add --all-cc0 to get the free pick of every need you do not name");
  console.log(`  Go on with what you have:   ${resume}`);
  console.log(`  Skip this stop:             add --no-shop-gate to the first command`);
  console.log(`SHOP_ID: ${id}`);
}

/** The plan is written: check it, save spec.json, then stop (--no-render) or render. */
async function afterPlan(
  id: string,
  premise: string,
  planned: { spec: ShotSpec; report?: PlanReport; provider: string; model: string },
  el: () => string,
  opts: { noRender: boolean; chunked: boolean; variants?: VariantAsk; publish?: boolean },
): Promise<void> {
  if (planned.report) {
    const models = process.env.FACTORY_LLM_FIXTURES
      ? "models: fixtures"
      : Object.entries(planned.report.models).map(([role, m]) => `${role}=${m.provider}/${m.model}`).join(" ");
    console.log(`[plan] ${planned.report.duration.toFixed(1)}s (target ${planned.report.target}s)${planned.report.revised ? ", revised once" : ""}; sound by ${planned.report.soundSource}; ${models}`);
  }

  // Validate (redundant but defensive — generateSpec already validates)
  const valid = validateSpec(planned.spec);
  validateAssets(valid);
  console.log(
    `[2/5] Spec validated — PASS (${valid.scenes.length} scenes, ${(valid.events ?? []).length} events, ${valid.scenes.filter((s) => s.cast?.length).length} asset stages) at +${el()}`,
  );

  // Write spec for reference + debugging
  ensureVideoOutputDir(id);
  const videoDir = videoOutputDir(id);
  const specPath = join(videoDir, "spec.json");
  writeFileSync(specPath, JSON.stringify(valid, null, 2));
  // A run that failed before and is now planned: its old failure log is stale.
  rmSync(join(OUTPUT_DIR, `FAILED-${id}.log`), { force: true });
  // What the story needs and what the library has (P3), with gate 2's choices.
  const needsFile = join(videoDir, "needs.json");
  if (existsSync(needsFile)) console.log(`\n${formatShoppingList(JSON.parse(readFileSync(needsFile, "utf8")) as NeedsFile, valid.title)}\n`);

  // Dashboard approval flow: --no-render stops after the spec write.
  // PLAN_ID is the machine-readable marker server/jobs.ts looks for.
  if (opts.noRender) {
    console.log(`PLAN_ID: ${id}`);
    console.log(`✓ Plan ready for approval in ${el()} total`);
    // The variants' lines and specs only; `variants <run>` renders them.
    if (opts.variants) await variantsStep(id, opts.variants, { noRender: true });
    return;
  }

  await renderOnly(valid, id, el, { providerUsed: planned.provider, modelUsed: planned.model, specPath, premise, chunked: opts.chunked, publish: opts.publish });
  if (opts.variants) await variantsStep(id, opts.variants, { noRender: false });
}

/**
 * One variant's video: its sound resolved under the run's seed, rendered in
 * chunks into the run's own chunk cache (output/<run>/chunks, so every chunk
 * it shares with the run's video or another variant is reused), mastered.
 */
const renderVariant: VariantRenderer = async (spec, ctx) => {
  const resolved = resolveAudio(spec, ctx.id);
  mkdirSync(dirname(ctx.out), { recursive: true });
  console.log(`[variants] ${ctx.variant}: rendering`);
  const r = await renderChunked(resolved.spec, ctx.id, {
    quality: spec.settings?.quality ?? "final",
    out: ctx.out,
    log: (line: string) => console.log(line),
    keepRuns: ctx.keepRuns,
  });
  const master = masterAudio(ctx.out);
  console.log(`[audio] ${ctx.variant} master: ${master.applied ? `${master.before?.lufs?.toFixed(1)} → ${master.after?.lufs?.toFixed(1)} LUFS` : `skipped (${master.reason})`}`);
  return { durationSec: Number((r.frames / (spec.fps ?? FPS)).toFixed(2)), chunks: { total: r.chunks.total, rendered: r.chunks.rendered, reused: r.chunks.reused } };
};

/** Make (and, unless noRender, render) a run's variants; print what each differs in. VARIANTS_ID is the marker for the server. */
async function variantsStep(id: string, ask: VariantAsk, opts: { noRender: boolean; cli?: { provider?: string; model?: string } }): Promise<void> {
  console.log("");
  console.log(`[variants] ${id}: ${formatVariantAsk(ask)}${opts.noRender ? " (planned only, not rendered)" : ""}`);
  const file = await makeVariants(id, ask, { mode: opts.noRender ? "plan" : "render", ...(opts.noRender ? {} : { render: renderVariant }), cli: opts.cli });
  console.log("");
  console.log("═══ VARIANTS ═══");
  console.log(`Run:    ${id} (output/${id}/variants/variants.json)`);
  for (const v of file.variants) {
    const chunks = v.chunks ? `, chunks ${v.chunks.rendered} rendered and ${v.chunks.reused} reused` : "";
    console.log(`  ${v.id.padEnd(12)} ${v.differs.join(" + ").padEnd(20)} ${v.state}${v.timing ? `, timing ${v.timing}` : ""}${chunks}${v.state === "rendered" ? `: output/${id}/${v.video}` : ""}`);
    if (v.differs.includes("hook")) console.log(`               hook: "${v.hookText}"`);
    if (v.differs.includes("ending")) console.log(`               ending: "${v.endingText}"`);
    if (v.error) console.log(`               error: ${v.error}`);
  }
  if (opts.noRender) console.log(`Render them: npm run generate -- variants ${id} ${formatVariantAsk(ask)}`);
  const failed = file.variants.filter((v) => v.state === "failed");
  if (file.variants.length > 0 && failed.length === file.variants.length) throw new Error(`every variant failed: ${failed[0].error}`);
  console.log(`VARIANTS_ID: ${id}`);
}

/** `variants <run> hooks=3,endings=2,formats=9:16,16:9 [--no-render]`: versions of a planned run, made later. */
function variantsMain(argv: string[]): void {
  const id = argv[1] ?? "";
  checkRunId(id);
  const args = parseArgs(argv.slice(2));
  let ask: VariantAsk;
  try {
    ask = parseVariantAsk([args.variants ?? "", args.premise].join(" "));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
  if (!existsSync(join(videoOutputDir(id), "plan.json"))) {
    console.error(`No planned run "${id}": output/${id}/plan.json is missing`);
    process.exit(1);
  }
  console.log(`RUN_ID: ${id}`);
  (async () => {
    try {
      await variantsStep(id, ask, { noRender: args.noRender, cli: { provider: args.provider, model: args.model } });
    } catch (error) {
      console.error("");
      console.error("═══ FAILED ═══");
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    } finally {
      disposeTtsWorkers();
    }
  })();
}

/** A plan that stopped: the gate shows its story; a failure is logged with the command that resumes it. */
function planStopped(id: string, premise: string, error: unknown, carry: string[]): void {
  if (error instanceof StoryGateStop) {
    printStoryGate(error, carry);
    return;
  }
  if (error instanceof ShopGateStop) {
    printShopGate(error, carry);
    return;
  }
  const logPath = writeFailedLog(id, premise, error);
  console.error("");
  console.error("═══ FAILED ═══");
  console.error(`Premise: ${premise}`);
  console.error(`Id: ${id}`);
  console.error(`Log: ${logPath}`);
  console.error(
    `Error: ${error instanceof Error ? error.message : String(error)}`,
  );
  const run = readRun(id);
  if (run && !isComplete(run)) {
    const next = nextStage(run);
    console.error(`Resume from ${next ? STAGE_LABELS[next] : "the end"} (finished stages are kept): ${["npm run generate -- --resume", id, ...carry].join(" ")}`);
  }
  process.exit(1);
}

/** The voice settings file the dashboard writes (narration / dialogs). */
function readAudioConfig(audioFile: string | undefined): AudioConfig | null {
  if (!audioFile) return null;
  try {
    const abs = audioFile.startsWith("/") || audioFile.includes(":") ? audioFile : join(process.cwd(), audioFile);
    return JSON.parse(readFileSync(abs, "utf8")) as AudioConfig;
  } catch (e) {
    console.warn(`[voice] could not read audio config: ${e}`);
    return null;
  }
}

function writeFailedLog(id: string, premise: string, error: unknown): string {
  // output/ may not exist yet on a fresh checkout; without this the logger
  // itself crashes and hides the real error.
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const logPath = join(OUTPUT_DIR, `FAILED-${id}.log`);
  const stamp = new Date().toISOString();
  const msg =
    error instanceof Error ? error.stack ?? error.message : String(error);
  writeFileSync(
    logPath,
    [
      `AI Video Factory — FAILED`,
      `Premise: ${premise}`,
      `Id: ${id}`,
      `Time: ${stamp}`,
      ``,
      `Error:`,
      msg,
      ``,
    ].join("\n"),
  );
  return logPath;
}

function main() {
  if (process.argv[2] === "variants") {
    variantsMain(process.argv.slice(2));
    return;
  }
  const args = parseArgs(process.argv.slice(2));
  const { premise: premiseArg, provider, model, noRender, fromSpec, audioFile, chunked, resume, status, noStoryGate, storyFrom, settings: rawSettings } = args;
  if (args.channels) {
    printChannels();
    return;
  }
  if (status) {
    checkRunId(status);
    printStatus(status);
    return;
  }
  // Versions of the video after its render (checked before anything starts).
  let variants: VariantAsk | undefined;
  try {
    if (args.variants) variants = parseVariantAsk(args.variants);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
  // The flags a resume command needs again (the run itself keeps the rest).
  const carry = [...(noRender ? ["--no-render"] : []), ...(chunked ? ["--chunked"] : []), ...(variants ? ["--variants", formatVariantAsk(variants)] : []), ...(args.publish ? ["--publish"] : [])];
  // Gate 2's choices and the sources it searches, checked before anything starts.
  let shop: ShopDecision | undefined;
  let shopSources: string[] | undefined;
  try {
    if (args.approvals.length || args.allFree) shop = { approvals: parseApprovals(args.approvals), allFree: args.allFree, by: "cli" };
    if (args.sources) shopSources = parseSources(args.sources);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
  if (resume) {
    checkRunId(resume);
    if (premiseArg || Object.keys(rawSettings).length || audioFile || storyFrom || args.channel || args.scriptFile || args.mode || args.sources) {
      console.warn("[producer] a resumed run keeps the premise, settings, voices and sources it started with; the ones given here are ignored");
    }
    resumeMain(resume, { provider, model, noRender, chunked, noStoryGate, noShopGate: args.noShopGate, shop, carry, variants, publish: args.publish });
    return;
  }
  const settingsCheck = SettingsSchema.safeParse(rawSettings);
  if (!settingsCheck.success) {
    console.error(
      `Settings: ${settingsCheck.error.issues.map((i) => `${i.path.join(".") || "settings"} ${i.message}`).join("; ")}`,
    );
    process.exit(1);
  }
  if (fromSpec) {
    // --- render-only mode: an approved spec (dashboard plan → approve) ---
    (async () => {
      const t0 = Date.now();
      const el = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
      try {
        const abs = fromSpec.startsWith("/") || fromSpec.includes(":")
          ? fromSpec
          : join(process.cwd(), fromSpec);
        if (!statSync(abs)) throw new Error(`spec file not found: ${abs} — fix: run the plan step first`);
        // output/<id>/spec.json (per-video folders, what the dashboard and the
        // editor pass) -> <id> from the folder; the old output/<id>-spec.json ->
        // <id> from the file name. (Taking the file name for both made every
        // dashboard render's id "spec.json".)
        const parts = abs.replace(/\\/g, "/").split("/");
        const file = parts.pop()!;
        const id = file === "spec.json" ? parts.pop()! : file.replace(/-spec\.json$/, "");
        const valid = validateSpec(JSON.parse(readFileSync(abs, "utf8")));
        const premise = valid.title;
        console.log(`[render-only] ${id} — "${premise}" (${valid.scenes.length} scenes)`);
        await renderOnly(valid, id, el, { audioFile, chunked, publish: args.publish });
      } catch (error) {
        console.error("");
        console.error("═══ FAILED ═══");
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      } finally {
        // A persistent kitten worker (if it started) must not keep node alive.
        disposeTtsWorkers();
      }
    })();
    return;
  }
  if (storyFrom) checkRunId(storyFrom);
  // The channel, and the user's own story or script.
  let profile: ChannelProfile;
  let script: string | undefined;
  try {
    profile = loadChannel(args.channel ?? DEFAULT_CHANNEL);
    if (args.mode && !(STORY_MODES as readonly string[]).includes(args.mode)) throw new Error(`--mode is one of ${STORY_MODES.join(", ")}, not "${args.mode}"`);
    if (args.scriptFile) {
      const abs = args.scriptFile.startsWith("/") || args.scriptFile.includes(":") ? args.scriptFile : join(process.cwd(), args.scriptFile);
      if (!existsSync(abs)) throw new Error(`script not found: ${abs}`);
      script = readFileSync(abs, "utf8");
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
  // A reused story keeps its premise unless a new one is given; a script names itself.
  const premise = premiseArg || (script ? scriptPremise(script) : storyFrom ? readBrief(storyFrom)?.premise ?? "" : "");
  if (!premise) {
    console.error('Usage: npm run generate -- "<premise>" [--provider X] [--model Y] [--no-render] [--no-story-gate]');
    console.error("       npm run generate -- [--channel <id>] --script story.txt [--mode adapt|as-written]   (your own story)");
    console.error("       npm run generate -- --resume <run>   (approve the story, or continue a run that stopped)");
    console.error("       npm run generate -- --resume <run> --all-cc0 | --approve n6=<source>:<id> n2=close ...   (gate 2's shopping list)");
    console.error("       npm run generate -- --status <run>   (each stage's state)");
    console.error("       npm run generate -- --channels       (the channels and their story modes)");
    console.error("       npm run generate -- variants <run> hooks=3,endings=2,formats=9:16,16:9   (versions of a planned run)");
    console.error('       npm run generate -- "<premise>" --from-spec output/<id>/spec.json  (render approved spec)');
    console.error('Example: npm run generate -- "What if money doubled every 3 seconds?"');
    process.exit(1);
  }

  // Every run gets its own id and folder: the same premise never overwrites an older run.
  const id = newRunId(premise);
  console.log(`RUN_ID: ${id}`);

  // NOTE: generateSpec is async. We call it via the async wrapper below.
  (async () => {
    const t0 = Date.now();
    const el = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
    try {
      console.log(`[1/5] Writing the plan${process.env.FACTORY_LLM_FIXTURES ? " (recorded fixtures)" : ""}`);
      // The raw flags (checked above): generateSpec fills in the channel's format and captions.
      const result = await generateSpec(premise, provider, model, rawSettings, readAudioConfig(audioFile) ?? {}, id, {
        // On unless --no-story-gate, or the channel skips it.
        storyGate: !noStoryGate && profile.gates.story,
        // Gate 2 likewise (--no-shop-gate); choices given now are used when the plan gets there.
        shopGate: !args.noShopGate && profile.gates.shop,
        ...(shopSources ? { shopSources } : {}),
        ...(shop ? { shop } : {}),
        storyFrom,
        ...(args.channel ? { channel: profile.id } : {}),
        ...(args.mode ? { mode: args.mode as StoryMode } : {}),
        ...(script ? { script } : {}),
      });
      await afterPlan(id, premise, result, el, { noRender, chunked, variants, publish: args.publish });
    } catch (error) {
      planStopped(id, premise, error, carry);
    } finally {
      // A persistent kitten worker (if it started) must not keep node alive.
      disposeTtsWorkers();
    }
  })();
}

/**
 * `--resume <run>`: approve a story that waits at the gate (as it is on disk
 * now) and plan on from the first stage that is not done. A run whose plan
 * is complete is rendered (or, with --no-render, only reported).
 */
function resumeMain(
  id: string,
  opts: { provider?: string; model?: string; noRender: boolean; chunked: boolean; noStoryGate: boolean; noShopGate: boolean; shop?: ShopDecision; carry: string[]; variants?: VariantAsk; publish?: boolean },
): void {
  const run = readRun(id);
  const brief = readBrief(id);
  if (!run || !brief) {
    console.error(`No run "${id}" to resume: output/${id}/run.json or brief.json is missing. Plan it again.`);
    process.exit(1);
  }
  console.log(`RUN_ID: ${id}`);
  (async () => {
    const t0 = Date.now();
    const el = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
    try {
      if (isComplete(run)) {
        // Nothing left to plan: the editor owns the stage files now.
        console.log(`[producer] the plan of ${id} is complete; nothing is planned again`);
        const specPath = join(videoOutputDir(id), "spec.json");
        const spec = existsSync(specPath) ? validateSpec(JSON.parse(readFileSync(specPath, "utf8"))) : (await reassemble(id, "plan")).spec;
        await afterPlan(id, brief.premise, { spec, provider: "approved-spec", model: "" }, el, opts);
        return;
      }
      console.log(`[1/5] Resuming the plan${process.env.FACTORY_LLM_FIXTURES ? " (recorded fixtures)" : ""}`);
      if (opts.shop && !run.gates.shop.on) console.warn("[producer] gate 2 is off for this run, so the choices given are not used");
      // Gate 2: the choices given here; or, when the shopping list waits and
      // none were given, the plan goes on with what the library has.
      const shop = opts.shop ?? (waitsForShopping(run) ? { approvals: [], by: "cli" } : undefined);
      const { spec, report } = await resumePlan(id, {
        approveStory: true,
        storyGate: opts.noStoryGate ? false : undefined,
        shopGate: opts.noShopGate ? false : undefined,
        shop,
        cli: { provider: opts.provider, model: opts.model },
      });
      await afterPlan(id, brief.premise, { spec, report, provider: report.models.writer.provider, model: report.models.writer.model }, el, opts);
    } catch (error) {
      planStopped(id, brief.premise, error, opts.carry);
    } finally {
      disposeTtsWorkers();
    }
  })();
}

function isLink(p: string): boolean {
  return !!lstatSync(p, { throwIfNoEntry: false })?.isSymbolicLink();
}

/**
 * Delete a folder tree without ever going through a link: a link (a junction
 * such as a bundle's public/) is removed itself, never what it points to.
 */
function removeTree(p: string): void {
  const st = lstatSync(p, { throwIfNoEntry: false });
  if (!st) return;
  if (st.isSymbolicLink()) {
    // Junctions and directory links on Windows need rmdir; file links unlink.
    try {
      unlinkSync(p);
    } catch {
      rmdirSync(p);
    }
    return;
  }
  if (st.isDirectory()) {
    for (const f of readdirSync(p)) removeTree(join(p, f));
    rmdirSync(p);
    return;
  }
  unlinkSync(p);
}

/**
 * A fresh bundle of the current code for one render: out/render-bundle-<id>.
 * Its public/ is a directory junction to the project's public/, as the chunked
 * render's bundles have, instead of a full copy (about 900 MB). An older bundle
 * there, linked or copied, is removed first with removeTree.
 */
async function freshBundle(id: string): Promise<string> {
  const out = join(projectRoot(), "out");
  const dir = join(out, `render-bundle-${id}`);
  if (isLink(dir)) throw new Error(`refusing to replace ${dir}: it is a link, not a bundle folder`);
  removeTree(dir);
  mkdirSync(out, { recursive: true });
  const { bundle } = await import("@remotion/bundler");
  let last = -10;
  await bundle({
    entryPoint: BUNDLE_SRC,
    outDir: dir,
    rspack: true,
    // A folder that does not exist (its parent does): the bundler copies nothing.
    publicDir: join(out, ".no-public"),
    onProgress: (p) => {
      if (p - last >= 10 || p === 100) {
        last = p;
        console.log(`Bundling ${Math.round(p)}%`);
      }
    },
  });
  symlinkSync(join(projectRoot(), "public"), join(dir, "public"), "junction");
  return dir;
}

/** Render an approved/validated spec: MP4 + report (share [3/5]..[5/5] logs). */
async function renderOnly(
  planned: ShotSpec,
  id: string,
  el: () => string,
  meta?: { providerUsed?: string; modelUsed?: string; specPath?: string; premise?: string; audioFile?: string; chunked?: boolean; publish?: boolean },
): Promise<void> {
  let valid = planned;
  const premise = meta?.premise ?? valid.title;
  const providerUsed = meta?.providerUsed ?? "approved-spec";
  const modelUsed = meta?.modelUsed ?? "";
  ensureVideoOutputDir(id);
  const videoDir = videoOutputDir(id);
  const specPath = meta?.specPath ?? join(videoDir, "spec.json");

      // Duration from spec (recomputed after the voice stage re-times a planned story)
      let durFrames = durationFrames(valid);

      // Output MP4 path (in per-video folder)
      const out = join(videoDir, "video.mp4");

      console.log(`Generating: "${premise}"`);
      console.log(`Provider: ${providerUsed} / ${modelUsed}`);
      console.log(`Spec: ${specPath}`);
      console.log(`Duration: ${durFrames} frames (${(durFrames / FPS).toFixed(1)}s)`);
      console.log("");

// Voice stage — runs before bundling so the WAVs are in public/ before the render reads them.
const audioConfig = readAudioConfig(meta?.audioFile);
if (valid.story && canReassemble(id)) {
  // A pipeline plan: synthesize every planned line, measure it, and re-time the
  // whole video from the real audio (no model calls).
  console.log(`[voice] re-timing the plan from the measured voice`);
  const re = await reassemble(id, "render", audioConfig ?? undefined, valid);
  for (const w of re.warnings) console.warn(`[voice] warning: ${w}`);
  valid = re.spec;
  durFrames = durationFrames(valid);
  console.log(`[voice] done — ${(valid.audio?.voiceFiles ?? []).length} lines, ${(durFrames / FPS).toFixed(1)}s`);
} else {
// Also fall back to spec.audio for narration/dialogs config (UI-injected).
const specAudio = valid.audio ?? {};
const mergedAudio: TtsAudioConfig = {
  narration: audioConfig?.narration ?? specAudio.narration,
  dialogs: audioConfig?.dialogs ?? specAudio.dialogs,
};
if (mergedAudio.narration?.enabled || mergedAudio.dialogs?.enabled) {
  console.log(`[voice] generating voices (${mergedAudio.narration?.engine ?? mergedAudio.dialogs?.engine})`);
  try {
    const manifest = await runTtsStage(valid, mergedAudio, id);
    if (manifest) {
      valid = { ...valid, audio: { ...valid.audio, voiceFiles: manifest.lines } };
      console.log(`[voice] done — ${manifest.lines.length} lines`);
    }
  } catch (e) {
    console.error(`[voice] FAILED: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  }
}
}

      // Sound: every cue becomes a library file with a loudness gain. This runs
      // after the voice stage, so the voice files are in the props. (They used to be
      // written before, which left narration out of every render.)
      const resolved = resolveAudio(valid, id);
      const ar = resolved.report;
      console.log(
        `[audio] sfx ${ar.sfxLibrary} library / ${ar.sfxSynth} synth · beds ${ar.ambientLibrary} library / ${ar.ambientSynth} synth · ` +
          `music ${ar.music.map((m) => (m.file ? m.mood : `${m.mood} (none found)`)).join(", ") || "none"} · cuts ${ar.transitions} · voice ${ar.voiceLines}`,
      );
      // Chunked, cached render: muted chunks + one audio pass, joined (see src/generator/render).
      // The bundled CLI render below stays the default path.
      let chunkStats: ChunkStats | undefined;
      if (meta?.chunked) {
        const r = await renderChunked(resolved.spec, id, {
          quality: valid.settings?.quality ?? "final",
          out,
          log: (line: string) => console.log(line),
        });
        chunkStats = r.chunks;
      }

      // Props go to a FILE — asset-driven specs exceed the Windows ~32KB command-line limit.
      // (The chunked path passes inputProps over the Node API; the file stays for debugging.)
      const inputProps = JSON.stringify({ spec: resolved.spec });
      const propsPath = join(videoDir, "props.json");
      writeFileSync(propsPath, inputProps);

      // Fresh explicit bundle (step 3) so the render never serves stale code.
      // Per-id: two renders at once (milestone pool, parallel jobs) must not
      // write the same directory.
      // The bundle the video was rendered from (the publish pack's thumbnail reuses it).
      let bundleDir: string | undefined;
      if (!meta?.chunked) {
      bundleDir = await freshBundle(id);

      const cmdArgs = [
        "render",
        bundleDir,
        COMP_ID,
        "--props",
        propsPath,
        "--duration",
        String(durFrames),
        "--framerate",
        String(valid.fps ?? FPS),
        "--width",
        String(valid.width ?? 1080),
        "--height",
        String(valid.height ?? 1920),
        // Draft quality renders at half size for fast previews.
        ...(valid.settings?.quality === "draft" ? ["--scale", "0.5"] : []),
        "--output",
        out,
        "--overwrite",
        "--codec",
        "h264",
        "--timeout",
        "180000",
      ];

      execFileSync(process.execPath, [REMOTION_CLI, ...cmdArgs], {
        stdio: "inherit",
        // Remotion's own ffmpeg for this platform when it is there (ffmpeg.ts).
        env: { ...process.env, ...(existsSync(FFMPEG) ? { FFMPEG_PATH: FFMPEG } : {}) },
      });
      }
      console.log(`[5/5] Encode + mux finished at +${el()}`);

      const master = masterAudio(out);
      console.log(
        `[audio] master: ${master.applied ? `${master.before?.lufs?.toFixed(1)} → ${master.after?.lufs?.toFixed(1)} LUFS` : `skipped (${master.reason})`}`,
      );

      const creditsLines = creditsForPlaces(
        (valid.scenes ?? []).flatMap((s) =>
          s.world && PLACES[s.world.place] ? [PLACES[s.world.place]] : [],
        ),
      );

      const reportPath = join(videoDir, "report.json");
      writeFileSync(
        reportPath,
        JSON.stringify(
          {
            premise,
            id,
            // The director's memory is per channel (videos without a run are what-if).
            channel: readBrief(id)?.channel ?? DEFAULT_CHANNEL,
            output: "video.mp4",
            spec: "spec.json",
            provider: providerUsed,
            model: modelUsed,
            frames: durFrames,
            durationSec: (durFrames / FPS).toFixed(2),
            fps: valid.fps ?? FPS,
            scenes: valid.scenes.length,
            events: (valid.events ?? []).length,
            sounds: Array.from(
              new Set([
                ...(valid.events ?? []).flatMap((e) =>
                  (e.sfx ?? []).map((s) => s.tag),
                ),
                ...(valid.audio?.ambient?.map((a) => a.tag) ?? []),
              ]),
            ),
            worldEvents: (valid.worldEvents ?? []).map((e) => e.name),
            // CC-BY credits: only the models THIS video used (Phase 6 step 1) —
            // landmarks standing in the world scenes' places.
            ...(creditsLines.length ? { credits: creditsLines } : {}),
            ...(chunkStats ? { chunks: chunkStats } : {}),
            audio: { ...ar, master },
            generatedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      );

      // The publish pack (--publish): titles, description, tags and a thumbnail
      // in output/<id>/publish/. Nothing is uploaded, and a failure only warns.
      if (meta?.publish) {
        try {
          await makePublishPack(id, { serveUrl: bundleDir ?? (await ensureBundle()).dir });
          console.log(`PUBLISH_DIR: output/${id}/publish`);
        } catch (e) {
          console.warn(`[publish] skipped: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      console.log("");
      console.log("═══ DONE ═══");
      console.log(`Video:  ${out}`);
      console.log(`Report: ${reportPath}`);
      try {
        const mb = statSync(out).size / (1024 * 1024);
        console.log(`Size:   ${mb.toFixed(1)} MB`);
      } catch {
        /* size unavailable */
      }
      console.log(`✓ Done in ${el()} total`);
      console.log(`Upload the MP4 directly to YouTube Shorts.`);
}

main();
