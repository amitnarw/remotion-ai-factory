/**
 * scripts/milestone.ts — the Phase 2 milestone check: 3 premises × 3 formats.
 *
 * For each video: plan -> draft render -> measure. Nothing is played; every
 * check is a number taken from the files:
 *   length      within ±10% of the target
 *   overlap     no two voice lines overlap
 *   dead air    longest silence before, between or after the voice lines, to the
 *               end of the MP4 (pass: ≤ 4 s)
 *   captions    share of caption words that fall inside the line that says them (pass: ≥ 95%)
 *   loudness    -14 ±1 LUFS, true peak ≤ -1 dBTP, 48 kHz
 *   measured    no voice duration left as an estimate after the render
 *   voice speed shown, not judged: 1 unless the voice had to be sped up to fit (max 1.15)
 * plus 4 frames per video to look at (output/milestone/<id>-1..4.png).
 *
 * Usage:
 *   npm run milestone -- --fixtures            # recorded/hand-written replies (no key needed)
 *   npm run milestone                          # real models from Providers -> Model roles
 *   FACTORY_LLM_RECORD=test-fixtures/pipeline/real npm run milestone   # record real replies
 *   options: --only money-doubles,forest-walks  --formats 9:16,16:9  --qa (photographer stills per shot)
 *
 * Writes output/milestone/report.json and report.md (a run with --only or
 * --formats updates its own rows and keeps the rest).
 */
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { generateSpec } from "../src/generator/ai/generate-spec";
import { checkShots } from "../src/generator/qa/photographer";
import { measureLoudness, runFfmpeg } from "../src/generator/ffmpeg";
import { resetFixtureCounters } from "../src/generator/pipeline/llm";
import type { AudioConfig } from "../src/generator/pipeline/voice";
import { SettingsSchema, type ShotSpec, type VideoFormat } from "../src/generator/spec.schema";

const ROOT = process.cwd();
const OUT = join(ROOT, "output");
const REPORT_DIR = join(OUT, "milestone");
const FIXTURES = join(ROOT, "test-fixtures", "pipeline");

const PREMISES = [
  { name: "money-doubles", premise: "What if money doubled every 3 seconds?" },
  { name: "oceans-vanish", premise: "What if the oceans vanished for 10 seconds?" },
  { name: "forest-walks", premise: "What if the forest could walk?" },
];
const FORMATS: Array<{ format: VideoFormat; duration: number; set: string }> = [
  { format: "9:16", duration: 25, set: "" },
  { format: "1:1", duration: 25, set: "" },
  { format: "16:9", duration: 60, set: "-long" },
];
const DEFAULT_AUDIO: AudioConfig = {
  narration: { enabled: true, engine: "kitten2", voice: "Bruno" },
  dialogs: { enabled: true, engine: "kitten2" },
};

const args = process.argv.slice(2);
const useFixtures = args.includes("--fixtures");
/** Also run the photographer: one still per shot, checked by code (reported, not a pass/fail gate yet). */
const withQa = args.includes("--qa");
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = opt("only")?.split(",");
const formats = opt("formats")?.split(",");

interface Row {
  id: string;
  premise: string;
  format: VideoFormat;
  target: number;
  duration?: number;
  lengthOk?: boolean;
  overlaps?: number;
  maxGap?: number;
  captionSync?: number;
  lufs?: number | null;
  truePeak?: number | null;
  sampleRate?: number;
  estimatedLines?: number;
  tempo?: number;
  /** Photographer: shots checked and shots flagged (with --qa). */
  shots?: number;
  shotsFlagged?: number;
  sheet?: string;
  warnings: string[];
  error?: string;
  pass?: boolean;
}

function newestMp4(id: string): string | null {
  const files = readdirSync(OUT)
    .filter((f) => f.startsWith(`${id}-`) && f.endsWith(".mp4"))
    .map((f) => join(OUT, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0] ?? null;
}

/** How many videos plan+render at once. Fixture replay keeps a global label
 *  counter, so --fixtures stays serial. Real-model runs overlap the network
 *  planning of one video with the CPU work (synth, render) of the previous —
 *  MILESTONE_PARALLEL raises it (a value above 2 needs generate.ts to bundle
 *  per id; until that lands the default is 1). */
const POOL = useFixtures ? 1 : Math.max(1, Math.min(4, Number(process.env.MILESTONE_PARALLEL ?? 1)));

function measure(row: Row, spec: ShotSpec, mp4: string) {
  // Length from the file itself (not the plan), so a tail the render adds counts.
  const loud = measureLoudness(mp4);
  row.duration = loud.durSec;
  row.lengthOk = Math.abs(row.duration - row.target) / row.target <= 0.1;

  const voice = [...(spec.audio?.voiceFiles ?? [])].sort((a, b) => a.at - b.at);
  let overlaps = 0;
  let maxGap = 0;
  let cursor = 0;
  for (let i = 0; i < voice.length; i++) {
    const v = voice[i];
    const end = v.at + (v.dur ?? 0);
    if (i + 1 < voice.length && end > voice[i + 1].at + 0.01) overlaps += 1;
    maxGap = Math.max(maxGap, v.at - cursor);
    cursor = Math.max(cursor, end);
  }
  maxGap = Math.max(maxGap, row.duration - cursor);
  row.overlaps = overlaps;
  row.maxGap = Number(maxGap.toFixed(2));

  const words = spec.captions.flatMap((c) => c.words ?? []);
  const inside = words.filter((w) => voice.some((v) => w.from >= v.at - 0.1 && w.from <= v.at + (v.dur ?? 0) + 0.1)).length;
  row.captionSync = words.length ? Number((inside / words.length).toFixed(3)) : 1;
  row.estimatedLines = (spec.story?.beats ?? []).flatMap((b) => b.lines ?? []).filter((l) => l.estimated).length;
  const voiceFile = join(OUT, row.id, "voice.json");
  const saved = existsSync(voiceFile) ? (JSON.parse(readFileSync(voiceFile, "utf8")) as Array<{ tempo?: number }>) : [];
  row.tempo = saved[0]?.tempo ?? 1;

  row.lufs = loud.lufs;
  row.truePeak = loud.truePeakDb;
  const probe = runFfmpeg(["-hide_banner", "-i", mp4]);
  row.sampleRate = Number(/Audio:.*?(\d+) Hz/.exec(probe.stderr)?.[1] ?? 0);

  // 4 frames, one from the middle of each quarter of the video. (Remotion's
  // ffmpeg has no fps/tile filters, so they are separate images.)
  const width = row.format === "16:9" ? 480 : 270;
  const frames: string[] = [];
  for (let i = 0; i < 4; i++) {
    const frame = join(REPORT_DIR, `${row.id}-${i + 1}.png`);
    const t = ((i + 0.5) * row.duration) / 4;
    runFfmpeg(["-hide_banner", "-loglevel", "error", "-y", "-ss", t.toFixed(2), "-i", mp4, "-vf", `scale=${width}:-2`, "-frames:v", "1", frame]);
    if (existsSync(frame)) frames.push(frame);
  }
  row.sheet = frames.length ? join(REPORT_DIR, `${row.id}-1..4.png`) : undefined;

  row.pass =
    row.lengthOk &&
    overlaps === 0 &&
    row.maxGap <= 4 &&
    (row.captionSync ?? 0) >= 0.95 &&
    row.lufs !== null &&
    Math.abs((row.lufs ?? 0) + 14) <= 1 &&
    (row.truePeak ?? 0) <= -1 &&
    row.sampleRate === 48000 &&
    row.estimatedLines === 0;
}

/** One video, end to end: plan -> draft render -> measure. Any failure lands
 *  on the row so the report always comes out complete. */
async function planAndRenderOne(p: (typeof PREMISES)[number], f: (typeof FORMATS)[number], row: Row) {
  console.log(`\n=== ${row.id} (${f.format}, ${f.duration}s) ===`);
  try {
    const fixtureDir = join(FIXTURES, `${p.name}${f.set}`);
    let audio = DEFAULT_AUDIO;
    if (useFixtures) {
      if (!existsSync(fixtureDir)) throw new Error(`no fixtures at ${fixtureDir}`);
      process.env.FACTORY_LLM_FIXTURES = fixtureDir;
      resetFixtureCounters();
      const a = join(fixtureDir, "audio.json");
      if (existsSync(a)) audio = JSON.parse(readFileSync(a, "utf8")) as AudioConfig;
    } else {
      delete process.env.FACTORY_LLM_FIXTURES;
    }
    const settings = SettingsSchema.parse({ format: f.format, targetDuration: f.duration, quality: "draft" });
    const planned = await generateSpec(p.premise, undefined, undefined, settings, audio, row.id);
    row.warnings.push(...(planned.report?.warnings ?? []));
    const specPath = join(OUT, `${row.id}-spec.json`);
    writeFileSync(specPath, JSON.stringify(planned.spec, null, 2));
    const audioPath = join(REPORT_DIR, `${row.id}-audio.json`);
    writeFileSync(audioPath, JSON.stringify(audio, null, 2));

    console.log(`[milestone] rendering ${row.id}…`);
    const r = spawnSync(process.execPath, [join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), "src/generator/generate.ts", "--from-spec", specPath, "--audio-file", audioPath], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, FACTORY_LLM_FIXTURES: "" },
      maxBuffer: 256 * 1024 * 1024,
    });
    writeFileSync(join(REPORT_DIR, `${row.id}-render.log`), (r.stdout ?? "") + (r.stderr ?? ""));
    if (r.status !== 0) throw new Error(`render failed (see output/milestone/${row.id}-render.log)`);
    for (const line of ((r.stdout ?? "") + (r.stderr ?? "")).split(/\r?\n/)) {
      const w = /\[voice\] warning: (.*)/.exec(line);
      if (w) row.warnings.push(w[1]);
    }
    const props = JSON.parse(readFileSync(join(OUT, `${row.id}-props.json`), "utf8")).spec as ShotSpec;
    const mp4 = newestMp4(row.id);
    if (!mp4) throw new Error("no MP4 produced");
    measure(row, props, mp4);
    if (withQa && props.shots?.length) {
      // The render just bundled into out/render-bundle; reuse it for the stills.
      const checks = await checkShots({ spec: props, outDir: join(REPORT_DIR, `${row.id}-qa`), serveUrl: join(ROOT, "out", "render-bundle") });
      row.shots = checks.length;
      row.shotsFlagged = checks.filter((c) => c.problems.length).length;
      for (const c of checks) for (const p of c.problems) row.warnings.push(`shot ${c.beat} (${c.subject} ${c.size}): ${p}`);
    }
    console.log(`[milestone] ${row.id}: ${row.pass ? "PASS" : "FAIL"} — ${row.duration?.toFixed(1)}s, gap ${row.maxGap}s, sync ${row.captionSync}, ${row.lufs?.toFixed(1)} LUFS`);
  } catch (e) {
    row.error = e instanceof Error ? e.message : String(e);
    row.pass = false;
    console.error(`[milestone] ${row.id}: ERROR ${row.error}`);
  }
}

/** A queue of videos drained by `limit` workers. */
async function runPool(count: number, jobs: Array<{ p: (typeof PREMISES)[number]; f: (typeof FORMATS)[number]; row: Row }>) {
  const queue = [...jobs];
  const workers = Array.from({ length: count }, async () => {
    for (;;) {
      const job = queue.shift();
      if (!job) return;
      await planAndRenderOne(job.p, job.f, job.row);
    }
  });
  await Promise.all(workers);
}

async function main() {
  mkdirSync(REPORT_DIR, { recursive: true });
  const jobs = PREMISES.filter((x) => !only || only.includes(x.name)).flatMap((p) =>
    FORMATS.filter((x) => !formats || formats.includes(x.format)).map((f) => ({ p, f })),
  );
  const rows: Row[] = jobs.map(({ p, f }) => ({
    id: `milestone-${p.name}-${f.format.replace(":", "x")}`,
    premise: p.premise,
    format: f.format,
    target: f.duration,
    warnings: [],
  }));
  if (POOL > 1) console.log(`[milestone] planning/rendering ${POOL} videos at a time`);
  await runPool(POOL, jobs.map((j, i) => ({ ...j, row: rows[i] })));
  delete process.env.FACTORY_LLM_FIXTURES;

  // A partial run (--only / --formats) replaces its own rows in the last report
  // and keeps the others, so one video can be re-checked without redoing all 9.
  const reportPath = join(REPORT_DIR, "report.json");
  if ((only || formats) && existsSync(reportPath)) {
    const before = JSON.parse(readFileSync(reportPath, "utf8")) as { rows: Row[] };
    const fresh = new Set(rows.map((r) => r.id));
    rows.unshift(...before.rows.filter((r) => !fresh.has(r.id)));
    const order = (id: string) => PREMISES.findIndex((p) => id.includes(p.name)) * 10 + FORMATS.findIndex((f) => id.endsWith(f.format.replace(":", "x")));
    rows.sort((a, b) => order(a.id) - order(b.id));
  }
  writeFileSync(reportPath, JSON.stringify({ when: new Date().toISOString(), fixtures: useFixtures, rows }, null, 2));
  const md = [
    `# Milestone check (${useFixtures ? "fixtures" : "real models"}) — ${new Date().toISOString()}`,
    "",
    "| video | target | length | ±10% | overlaps | longest silence | caption sync | LUFS | true peak | Hz | estimated lines | voice speed | shots flagged | result |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...rows.map((r) =>
      r.error
        ? `| ${r.id} | ${r.target}s | — | — | — | — | — | — | — | — | — | — | — | ERROR: ${r.error} |`
        : `| ${r.id} | ${r.target}s | ${r.duration?.toFixed(1)}s | ${r.lengthOk ? "yes" : "NO"} | ${r.overlaps} | ${r.maxGap}s | ${((r.captionSync ?? 0) * 100).toFixed(0)}% | ${r.lufs?.toFixed(1)} | ${r.truePeak?.toFixed(1)} | ${r.sampleRate} | ${r.estimatedLines} | ${r.tempo}× | ${r.shots !== undefined ? `${r.shotsFlagged}/${r.shots}` : "—"} | ${r.pass ? "PASS" : "FAIL"} |`,
    ),
    "",
    "Warnings:",
    ...rows.flatMap((r) => r.warnings.map((w) => `- ${r.id}: ${w}`)),
  ].join("\n");
  writeFileSync(join(REPORT_DIR, "report.md"), md);
  console.log(`\n${md}\n\nReport: ${join(REPORT_DIR, "report.md")}`);
  process.exit(rows.every((r) => r.pass) ? 0 : 1);
}

main();
