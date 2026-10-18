/**
 * scripts/render-storyboard.ts — render an APPROVED storyboard story.
 *
 * Pipeline: (1) load + validate the storyboard, (2) regenerate the component
 * wrapper (codegen) so the bundle contains it, (3) [voice] render every
 * narration/dialogue line with local KittenTTS (speed-up retry on overrun),
 * (4) [music] synthesize the bed, (5) bundle + render + encode comp
 * story-<slug>, (6) report.
 *
 * Usage: npx tsx scripts/render-storyboard.ts <slug>
 */
import { spawnSync, execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  beatTimings,
  parseStoryboard,
  storyboardIssues,
} from "../src/whatif/storyboard/schema";
import { codegenAllApproved } from "./storyboard-codegen";
import { synthMusic } from "../src/whatif/audio/music";
import {
  DEFAULT_CHARACTER,
  DEFAULT_NARRATOR,
  pickVoice,
} from "../src/whatif/audio/voices";
import {
  loadCatalog,
  loadSoundDesign,
  resolveSfxMap,
  verifyResolvedFiles,
} from "../src/whatif/audio/sfx-catalog";

const ROOT = process.cwd();
const DATA = join(ROOT, "public", "whatif-data");
const PYTHON = join(
  "C:",
  "Users",
  "Narwal",
  "Desktop",
  "kitten-tts-test",
  ".venv",
  "Scripts",
  "python.exe",
);

function die(message: string, fix?: string): never {
  console.error(message + (fix ? `\n→ Fix: ${fix}` : ""));
  process.exit(1);
}

/** Voice budget check: removed — VO now drives the cut (see the voice stage). */

const slug = process.argv[2];
if (!slug) die("usage: tsx scripts/render-storyboard.ts <slug>");

async function main(): Promise<void> {
// ---------- 1. Load + validate ----------
const sbPath = join(DATA, slug, "storyboard.json");
let passTiming: number[] | undefined = undefined;
if (!existsSync(sbPath)) {
  die(
    `No storyboard at public/whatif-data/${slug}/storyboard.json`,
    "Write the story first (Generate tab) and approve it",
  );
}
if (!existsSync(join(DATA, slug, "approved"))) {
  die(
    `Storyboard "${slug}" is not approved yet`,
    "Open Generate → Step 2 review → press Approve — approval is what starts renders",
  );
}
const raw = JSON.parse(readFileSync(sbPath, "utf8"));
const sb = parseStoryboard(raw);
if (!sb) {
  die(`Storyboard "${slug}" is invalid: ${storyboardIssues(raw).join("; ")}`, "Press Rewrite on the review screen");
}
console.log(`[story] "${sb.title}" — ${sb.beats.length} beats, ${sb.targetSeconds}s, voice: ${sb.voice.mode}`);

// ---------- 2. Voice ----------
const timings = beatTimings(sb);
// Voice + music live under public/whatif-audio/<slug>/ (the component reads
// them via staticFile("whatif-audio/<slug>/…") — same as hand-authored stories).
const voiceDir = join(ROOT, "public", "whatif-audio", slug, "voice");
mkdirSync(voiceDir, { recursive: true });
const needsVoice =
  sb.voice.mode !== "silent" &&
  timings.some(({ beat }) => (beat.narration ?? beat.dialogue) != null);

/** Engine voices — shared guard (src/whatif/audio/voices.ts). */
const safeVoice = (v: string | undefined, fallback: string): string =>
  pickVoice(v, fallback);

if (needsVoice) {
  const narrator = safeVoice(sb.voice.narratorVoice, DEFAULT_NARRATOR);
  const character = safeVoice(sb.voice.characterVoice, DEFAULT_CHARACTER);
  const lines = timings.flatMap(({ beat }, i) => {
    const out: Array<{ id: string; text: string; voice: string }> = [];
    if (beat.narration) out.push({ id: `beat-${i}-n`, text: beat.narration, voice: narrator });
    if (beat.dialogue) out.push({ id: `beat-${i}-c`, text: beat.dialogue, voice: character });
    return out;
  });

  /** Content hash per line — re-record only lines whose text/voice changed. */
  const lineHash = (id: string): string => {
    const l = lines.find((x) => x.id === id);
    if (!l) return "";
    let h = 5381;
    const s = `${l.text}‖${l.voice}`;
    for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
    return (h >>> 0).toString(36);
  };
  const manifestPath = join(voiceDir, "lines.json");
  let manifest: Record<string, string> = {};
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch { /* fresh */ }

  const stale = lines.filter(
    (l) => manifest[l.id] !== lineHash(l.id) || !existsSync(join(voiceDir, `${l.id}.wav`)),
  );
  const durations: Record<string, number> = {};
  try {
    Object.assign(
      durations,
      JSON.parse(readFileSync(join(voiceDir, "durations.json"), "utf8") || "{}"),
    );
  } catch { /* none cached */ }

  if (stale.length === 0) {
    console.log(`[voice] all ${lines.length} line(s) cached — same text + voices`);
  } else {
    if (stale.length === lines.length) {
      console.log(`[voice] recording ${stale.length} line(s) with local KittenTTS…`);
    } else {
      console.log(
        `[voice] re-recording ${stale.length}/${lines.length} changed line(s) (rest cached)…`,
      );
      for (const gone of Object.keys(manifest).filter((id) => !lines.some((l) => l.id === id))) {
        delete durations[gone];
      }
    }
    const jobPath = join(voiceDir, ".tts-job.json");
    writeFileSync(jobPath, JSON.stringify({ outDir: voiceDir, lines: stale }, null, 2));
    const r = spawnSync(
      PYTHON,
      [join(ROOT, "scripts", "story-tts.py"), jobPath],
      {
        cwd: ROOT,
        encoding: "utf8",
        timeout: 12 * 60_000,
        maxBuffer: 1024 * 1024 * 64,
        env: { ...process.env, PYTHONUTF8: "1", HF_HUB_OFFLINE: "1" },
      },
    );
    const std = `${r.stdout ?? ""}`;
    for (const line of std.split(/\r?\n/)) if (line.trim()) console.log(line);
    if (r.error || r.status !== 0) {
      die(
        `KittenTTS failed: ${(r.stderr ?? "").slice(-400) || String(r.error)}`,
        "Verify the local voice engine at C:/Users/Narwal/Desktop/kitten-tts-test (set voice mode to 'silent' on the review screen to skip voices entirely)",
      );
    }
    const marker = std.split("\n").find((l) => l.startsWith("@@ "));
    if (!marker) die("KittenTTS produced no duration summary", "Retry the render");
    const fresh = JSON.parse(marker.slice(3))["durations"] as Record<string, number>;
    Object.assign(durations, fresh);
  }
  // Refresh the manifest for every needed line.
  manifest = Object.fromEntries(lines.map((l) => [l.id, lineHash(l.id)]));
  writeFileSync(join(voiceDir, "durations.json"), JSON.stringify(durations, null, 2));
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // ---------- VO DRIVES THE CUT ----------
  // Recordings define the final beat lengths. Beats with narration/dialogue
  // stretch to fit their recording (+ breathing pads); unvoiced beats absorb
  // the slack. If the voices need more total time than the target, the film
  // runs longer up to a cap ladder — beyond that, the story must be tightened.
  const weights = timings.map(({ beat }) => beat.seconds);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const baseScale = sb.targetSeconds / weightSum;

  const voFor = (i: number, pad: number): number => {
    const max = Math.max(durations[`beat-${i}-n`] ?? 0, durations[`beat-${i}-c`] ?? 0);
    return max > 0 ? max + pad : 0;
  };

  let finalDurations: number[] = [];
  let total = 0;
  let accepted = false;
  for (const [pad, multiplier] of [
    [0.45, 1.15],
    [0.3, 1.25],
  ] as const) {
    finalDurations = weights.map((w, i) => Math.max(w * baseScale, voFor(i, pad)));
    total = finalDurations.reduce((a, b) => a + b, 0);
    const cap = sb.targetSeconds * multiplier;
    if (total <= cap) {
      accepted = true;
      break;
    }
    console.log(`[voice] needs ${total.toFixed(1)}s > cap ${cap.toFixed(1)}s — trying tighter pads…`);
  }
  if (!accepted) {
    die(
      `Voices need ${total.toFixed(1)}s but the film caps at ${(sb.targetSeconds * 1.25).toFixed(1)}s (target ${sb.targetSeconds}s)`,
      "Press Rewrite and ask for shorter narration lines",
    );
  }
  // Distribute the remaining slack to unvoiced beats (keep spoken beats tight).
  const free = timings.map((_t, i) => (voFor(i, 0.3) === 0 ? i : -1)).filter((i) => i >= 0);
  const freeWeightSum = free.reduce((a, i) => a + weights[i], 0);
  if (freeWeightSum > 0 && total < sb.targetSeconds - 0.05) {
    const slack = sb.targetSeconds - total;
    finalDurations = finalDurations.map((d, i) =>
      free.includes(i) ? d + (slack * weights[i]) / freeWeightSum : d,
    );
    total = finalDurations.reduce((a, b) => a + b, 0);
  }
  if (total > sb.targetSeconds + 0.2) {
    console.log(`[voice] film runs ${total.toFixed(1)}s (voices needed more room than ${sb.targetSeconds}s)`);
  }
  writeFileSync(
    join(voiceDir, "timing.json"),
    JSON.stringify({ durations: finalDurations.map((d) => Number(d.toFixed(3))) }, null, 2),
  );
  console.log(`[voice] final timing: ${finalDurations.map((d) => d.toFixed(2)).join(" + ")} = ${total.toFixed(2)}s`);
} else {
  console.log("[voice] story is text-only — skipping voice");
}

// ---------- 3. Codegen (with the FINAL voice-driven duration) ----------
let finalTotalSec = sb.targetSeconds;
{
  const timingPath = join(DATA, slug, "voice", "timing.json");
  if (existsSync(timingPath)) {
    try {
      const t = JSON.parse(readFileSync(timingPath, "utf8")) as { durations: number[] };
      if (t.durations?.length === sb.beats.length) {
        finalTotalSec = t.durations.reduce((a, b) => a + b, 0);
        // The component must use THESE durations, not its own re-budget.
        passTiming = t.durations;
      }
    } catch { /* fall back to schema timing */ }
  }
}
codegenAllApproved(finalTotalSec);
console.log(`[codegen] component wrappers refreshed (duration ${finalTotalSec.toFixed(2)}s)`);

// ---------- 4. Music ----------
const fps = 30;
const musicPath = join(ROOT, "public", "whatif-audio", slug, "music.wav");
const wantedMood = sb.music.mood;
let needMusic = true;
if (existsSync(musicPath)) {
  try {
    const report = JSON.parse(readFileSync(join(ROOT, "public", "whatif-audio", slug, "music.meta.json"), "utf8")) as {
      mood?: string;
      seed?: number;
      dur?: number;
    };
    needMusic =
      report.mood !== wantedMood ||
      report.seed !== sb.music.seed ||
      Math.abs((report.dur ?? 0) - sb.targetSeconds) > 0.5;
  } catch {
    needMusic = true;
  }
}
if (needMusic) {
  console.log(`[music] synthesizing ${wantedMood} bed, ${finalTotalSec.toFixed(2)}s…`);
  await synthMusic({
    durationSec: finalTotalSec,
    mood: wantedMood,
    seed: sb.music.seed ?? 1,
    outputPath: musicPath,
  });
  writeFileSync(
    join(DATA, slug, "music.meta.json"),
    JSON.stringify({ mood: wantedMood, seed: sb.music.seed ?? 1, dur: finalTotalSec }),
  );
} else {
  console.log("[music] cached → music.wav");
}

// ---------- 5. Sound-design resolution (variant choices) ----------
// No stored choices → resolve every role used by this storyboard via Auto (best).
const catalog = loadCatalog();
const usedRoles = [...new Set(sb.beats.flatMap((b) => b.sfx.map((c) => c.role)))];
const design = loadSoundDesign(slug) ?? { slug, map: Object.fromEntries(usedRoles.map((r) => [r, "auto"])), updatedAt: 0 };
const resolved = resolveSfxMap(catalog, design);
const fileCheck = verifyResolvedFiles(resolved);
if (fileCheck.missing.length > 0) {
  die(
    `Missing SFX files after resolving the sound-design map: ${fileCheck.missing.join(", ")}`,
    'Run "npm run sfx" (and "npm run sfx:cc0") to rebuild public/sfx, then re-render',
  );
}
const props = {
  sfxFileMap: resolved,
  ...(passTiming ? { beatTiming: passTiming } : {}),
};
const propsPath = join(ROOT, "output", `.props-${slug}.json`);
mkdirSync(join(ROOT, "output"), { recursive: true });
writeFileSync(propsPath, JSON.stringify(props, null, 2));

// ---------- 6. Bundle + render + encode ----------
const stamp = new Date();
const pad = (n: number) => String(n).padStart(2, "0");
const outName = `${slug}-${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}-${pad(stamp.getHours())}.mp4`;
const out = join(ROOT, "output", outName);

console.log(`[render] story-${slug} → ${outName} (${Math.round(finalTotalSec * fps)} frames)`);
execFileSync(
  "npx",
  [
    "--no-install",
    "remotion",
    "render",
    join(ROOT, "src", "index.ts"),
    `story-${slug}`,
    "--output",
    out,
    "--overwrite",
    "--codec",
    "h264",
    `--props=${propsPath}`,
  ],
  { stdio: "inherit", maxBuffer: 1024 * 1024 * 64, timeout: 15 * 60_000, env: { ...process.env, ...loadEnv() } },
);

// ---------- 7. Report ----------
const frames = Math.round(finalTotalSec * fps);
const report = {
  premise: sb.title,
  engine: "storyboard",
  slug,
  output: out,
  frames,
  durationSec: finalTotalSec.toFixed(2),
  music: sb.music,
  voice: { ...sb.voice },
  soundDesign: design?.map ?? {},
  sfxFileMap: resolved,
  beats: sb.beats.map((b, i) => ({
    i,
    scene: b.scene,
    camera: `${b.shot.size}/${b.shot.angle}/${b.shot.move}`,
    seconds: Number(b.seconds.toFixed(2)),
    says: b.narration ?? b.dialogue ?? null,
    sfx: b.sfx,
  })),
  generatedAt: Date.now(),
};
writeFileSync(join(ROOT, "output", `${slug}-report.json`), JSON.stringify(report, null, 2));
console.log(`[done] ${out}`);
}

/** .env loader (parity with other scripts). */
function loadEnv(): Record<string, string> {
  const envPath = join(ROOT, ".env");
  if (!existsSync(envPath)) return {};
  const env: Record<string, string> = {};
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return env;
}

main().catch((e) => {
  die(e instanceof Error ? e.message : String(e));
});