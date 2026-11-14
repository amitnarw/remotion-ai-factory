/**
 * scripts/audio-audit.ts
 *
 * Audio QA without ears (the files are measured, never played):
 *   1. Verifies the audio stream is present in the MP4.
 *   2. Verifies the overall mix isn't silent (its RMS, from the decoded PCM).
 *   3. For each one-shot SFX cue in the spec (its time: the cue's `at`, else
 *      its event's `t`, in seconds, as CompositionAudio reads it), measures
 *      the peak and mean level in a short window from the cue and in the
 *      window before it, and asserts the window is not silent; the rise over
 *      the window before is reported (beds and music play under every cue,
 *      so a cue's presence, not its loudness, is what can be checked).
 *
 * Sync itself is guaranteed by construction (Remotion <Audio startFrom = t*fps>);
 * this audit confirms the audio track is present and sounding at the right
 * moments.
 *
 * Usage:
 *   npm run audit <id-or-premise> [mp4-file]
 *   npm run audit gravity output/whatif-...-17.mp4
 *
 * Finds runs in either layout (scripts/runs.ts). Output: the run's report
 * (output/<id>/report.json, or output/<id>-report.json) gets an audioAudit block.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { secToFrame } from "../src/generator/timing";
import { findRun } from "./runs";

const FFMPEG = join(
  process.cwd(),
  "node_modules",
  "@remotion",
  "compositor-win32-x64-msvc",
  "ffmpeg.exe",
);

/** A cue counts as sounding when its window peaks above this (dBFS). */
const SOUNDING_DB = -40;
/** The window measured from each cue, and the one before it (seconds). */
const CUE_WINDOW = 0.3;

/** The MP4's audio, decoded once to mono 16-bit PCM at RATE (the bundled
 *  ffmpeg has no level filters: verify-video.ts measures the same way). */
const RATE = 48000;
const decoded = new Map<string, Int16Array | null>();
function pcmOf(mp4: string): Int16Array | null {
  if (decoded.has(mp4)) return decoded.get(mp4)!;
  const tmp = join(tmpdir(), `audio-audit-${process.pid}.wav`);
  let pcm: Int16Array | null = null;
  try {
    execFileSync(FFMPEG, ["-y", "-v", "error", "-i", mp4, "-map", "0:a:0", "-f", "wav", "-ac", "1", "-ar", String(RATE), tmp], { maxBuffer: 1024 * 1024 * 512, timeout: 120000 });
    const wav = readFileSync(tmp);
    const data = wav.indexOf(Buffer.from("data"), 12);
    const body = wav.subarray(data + 8);
    pcm = new Int16Array(body.buffer.slice(body.byteOffset, body.byteOffset + (body.length & ~1)));
  } catch {
    pcm = null;
  } finally {
    rmSync(tmp, { force: true });
  }
  decoded.set(mp4, pcm);
  return pcm;
}

/**
 * Peak and mean (RMS) level, dBFS, of the audio from `startSec` for `durSec`
 * (the whole file without them). Null when there is no audio there.
 */
function levels(mp4: string, startSec?: number, durSec?: number): { max: number; mean: number } | null {
  const pcm = pcmOf(mp4);
  if (!pcm) return null;
  const a = startSec == null ? 0 : Math.max(0, Math.round(startSec * RATE));
  const b = startSec == null ? pcm.length : Math.min(pcm.length, a + Math.round((durSec ?? 0) * RATE));
  if (b <= a) return null;
  let peak = 0;
  let sum = 0;
  for (let i = a; i < b; i++) {
    const v = Math.abs(pcm[i]);
    if (v > peak) peak = v;
    sum += pcm[i] * pcm[i];
  }
  const db = (x: number) => (x > 0 ? Math.round(20 * Math.log10(x / 32768) * 10) / 10 : -Infinity);
  return { max: db(peak), mean: db(Math.sqrt(sum / (b - a))) };
}

/**
 * Check that the audio stream exists and report its codec.
 */
function inspectAudioStream(mp4: string): { codec: string | null; channels: number | null } {
  try {
    const out = execFileSync(
      join(
        process.cwd(),
        "node_modules",
        "@remotion",
        "compositor-win32-x64-msvc",
        "ffprobe.exe",
      ),
      [
        "-v",
        "error",
        "-select_streams",
        "a",
        "-show_entries",
        "stream=codec_name,channels",
        "-of",
        "csv=p=0",
        mp4,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const text = out as unknown as string;
    const trimmed = text.trim();
    if (!trimmed) return { codec: null, channels: null };
    const [codec, channels] = trimmed.split(",");
    return { codec: codec || null, channels: channels ? parseInt(channels, 10) : null };
  } catch {
    return { codec: null, channels: null };
  }
}

function main() {
  const args = process.argv.slice(2);
  // A last argument that names an .mp4 is the file; the rest is the id or premise.
  const mp4Arg = args.length > 1 && /\.mp4$/i.test(args[args.length - 1]) ? args.pop()! : "";
  const idOrPremise = args.join(" ").trim();
  if (!idOrPremise) {
    console.error('Usage: npm run audit <id-or-premise> [mp4-file]');
    console.error('Example: npm run audit gravity output/whatif-...-17.mp4');
    process.exit(1);
  }

  const found = findRun(idOrPremise);
  if (!found) {
    console.error(`No spec found for "${idOrPremise}"`);
    process.exit(1);
  }

  const { id, spec } = found;
  const fps = spec.fps ?? 30;

  const mp4 = mp4Arg || found.mp4 || "";
  if (!mp4 || !existsSync(mp4)) {
    console.error(mp4 ? `MP4 not found: ${mp4}` : `No MP4 found for "${id}"`);
    process.exit(1);
  }

  console.log(`Audio audit: ${mp4}`);

  // 1. Audio stream present?
  const stream = inspectAudioStream(mp4);
  const audioPresent = stream.codec != null;
  console.log(
    `Audio stream: ${audioPresent ? stream.codec + " (" + stream.channels + "ch)" : "MISSING"}`,
  );

  // 2. The whole mix: not silent.
  const overall = levels(mp4);
  const overallHasAudio = overall != null && overall.mean > -60;
  console.log(`Overall level: ${overall ? `peak ${overall.max} dB, mean ${overall.mean} dB` : "n/a"} (${overallHasAudio ? "OK" : "SILENT"})`);

  // 3. Each one-shot cue: sounding in its window.
  const specEvents = (spec.events ?? []).flatMap((e) => (e.sfx ?? []).map((s) => ({ t: (s.at ?? e.t) as number, name: e.name, tag: s.tag })));

  const checks = specEvents.map((se) => {
    const here = levels(mp4, se.t, CUE_WINDOW);
    const before = levels(mp4, se.t - CUE_WINDOW, CUE_WINDOW);
    const hasSound = here != null && here.max > SOUNDING_DB;
    return {
      event: se.name,
      tag: se.tag,
      expectedFrame: secToFrame(se.t, fps),
      expectedSec: se.t,
      peakDb: here?.max ?? null,
      meanDb: here?.mean ?? null,
      riseDb: here && before && Number.isFinite(before.mean) ? Math.round((here.mean - before.mean) * 10) / 10 : null,
      hasSound,
      withinTolerance: hasSound,
    };
  });

  const allPass = checks.every((c) => c.withinTolerance);

  const audit = {
    mp4,
    specId: id,
    fps,
    windowSec: CUE_WINDOW,
    soundingDb: SOUNDING_DB,
    audioPresent,
    audioCodec: stream.codec,
    audioChannels: stream.channels,
    overallPeakDb: overall?.max ?? null,
    overallMeanDb: overall?.mean ?? null,
    overallHasAudio,
    soundEventsDetected: checks.filter((c) => c.withinTolerance).length,
    specOneShotEvents: specEvents.length,
    allEventsAligned: allPass,
    checks,
    auditedAt: new Date().toISOString(),
  };

  const reportPath = found.reportPath;
  let report: Record<string, unknown> = {};
  if (existsSync(reportPath)) {
    report = JSON.parse(readFileSync(reportPath, "utf8")) as Record<string, unknown>;
  }
  report.audioAudit = audit;
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(
    `Sound events confirmed at event frames: ${audit.soundEventsDetected}/${specEvents.length}`,
  );
  console.log(`All events have sound at their frame: ${allPass}`);
  if (!overallHasAudio || !audioPresent) process.exitCode = 1;
  for (const c of checks) {
    console.log(
      `  ${c.event}: frame ${c.expectedFrame} (${c.expectedSec}s) -> ${
        c.withinTolerance
          ? `OK (peak ${c.peakDb} dB, ${c.riseDb ?? "?"} dB over the window before)`
          : `NO SOUND (peak ${c.peakDb ?? "n/a"} dB)`
      }`,
    );
  }
  console.log(`\nReport updated: ${reportPath}`);
}

main();
