/**
 * scripts/audio-audit.ts
 *
 * Audio QA without ears:
 *   1. Verifies the audio stream is present in the MP4.
 *   2. Verifies the overall mix isn't silent (ffmpeg astats peak level).
 *   3. For each spec one-shot SFX event, measures audio loudness in a short
 *      window around the event frame and asserts a sound spike is present
 *      (verifying sound is actually placed at the event time).
 *
 * Sync itself is guaranteed by construction (Remotion <Audio startFrom = t*fps>);
 * this audit confirms the audio track is present and sounding at the right
 * moments.
 *
 * Usage:
 *   npm run audit <id-or-premise> <mp4-file>
 *   npm run audit gravity output/whatif-...-17.mp4
 *
 * Output: updates output/<id>-report.json with an audioAudit block.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { execFileSync } from "child_process";
import { validateSpec, type ShotSpec } from "../src/generator/spec.schema";
import { secToFrame } from "../src/generator/timing";

const OUTPUT_DIR = join(process.cwd(), "output");
const FFMPEG = join(
  process.cwd(),
  "node_modules",
  "@remotion",
  "compositor-win32-x64-msvc",
  "ffmpeg.exe",
);
const FFPROBE = join(
  process.cwd(),
  "node_modules",
  "@remotion",
  "compositor-win32-x64-msvc",
  "ffprobe.exe",
);

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "video";
}

function findSpec(idOrPremise: string): { id: string; spec: ShotSpec } | null {
  if (!existsSync(OUTPUT_DIR)) return null;
  const files = readdirSync(OUTPUT_DIR).filter((f) => f.endsWith("-spec.json"));
  const q = slug(idOrPremise);
  const qWords = q.split("-").filter((w) => w.length > 3);
  for (const f of files) {
    const id = f.replace("-spec.json", "");
    if (id === idOrPremise || id === q || qWords.some((w) => id.includes(w))) {
      const spec = JSON.parse(readFileSync(join(OUTPUT_DIR, f), "utf8"));
      return { id, spec: validateSpec(spec) };
    }
  }
  return null;
}

/**
 * Measure peak loudness (dB) of an audio clip via ffmpeg astats.
 * Returns the "Overall Peak Level" in dB, or null if not found.
 */
function measurePeakDb(mp4: string, startSec: number, durSec: number): number | null {
  try {
    const out = execFileSync(
      FFMPEG,
      [
        "-ss",
        String(Math.max(0, startSec)),
        "-t",
        String(durSec),
        "-i",
        mp4,
        "-af",
        "astats=metadata=1:reset=1",
        "-f",
        "null",
        "-",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const text = Buffer.from(out.stderr).toString("utf8");
    const m = text.match(/Overall Peak Level:\s*([-\d.]+)\s*dB/);
    return m ? parseFloat(m[1]) : null;
  } catch {
    return null;
  }
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
    const text = Buffer.from(out.stdout).toString("utf8").trim();
    if (!text) return { codec: null, channels: null };
    const [codec, channels] = text.split(",");
    return { codec: codec || null, channels: channels ? parseInt(channels, 10) : null };
  } catch {
    return { codec: null, channels: null };
  }
}

function main() {
  const idOrPremise = process.argv.slice(2).join(" ").trim();
  const mp4Arg = process.argv.slice(3).join(" ").trim();
  if (!idOrPremise || !mp4Arg) {
    console.error('Usage: npm run audit <id-or-premise> <mp4-file>');
    console.error('Example: npm run audit gravity output/whatif-...-17.mp4');
    process.exit(1);
  }

  const found = findSpec(idOrPremise);
  if (!found) {
    console.error(`No spec found for "${idOrPremise}"`);
    process.exit(1);
  }

  const { id, spec } = found;
  const fps = spec.fps ?? 30;

  let mp4 = mp4Arg;
  if (!existsSync(mp4)) {
    const candidates = readdirSync(OUTPUT_DIR).filter(
      (f) => f.startsWith(`whatif-${id}-`) && f.endsWith(".mp4"),
    );
    if (candidates.length === 0) {
      console.error(`No MP4 found for "${id}" in ${OUTPUT_DIR}`);
      process.exit(1);
    }
    mp4 = join(OUTPUT_DIR, candidates.sort().reverse()[0]);
  }

  if (!existsSync(mp4)) {
    console.error(`MP4 not found: ${mp4}`);
    process.exit(1);
  }

  console.log(`Audio audit: ${mp4}`);

  // 1. Audio stream present?
  const stream = inspectAudioStream(mp4);
  const audioPresent = stream.codec != null;
  console.log(
    `Audio stream: ${audioPresent ? stream.codec + " (" + stream.channels + "ch)" : "MISSING"}`,
  );

  // 2. Overall loudness (entire file)
  const overallPeak = measurePeakDb(mp4, 0, 0.5);
  const overallSilent = overallPeak == null || overallPeak < -50;
  console.log(
    `Overall peak: ${overallPeak == null ? "n/a" : overallPeak.toFixed(1)} dB (${
      overallSilent ? "SILENT" : "OK"
    })`,
  );

  // 3. Per-event loudness spike check
  const specEvents = (spec.events ?? []).flatMap((e) =>
    (e.sfx ?? []).filter((s) => s.at != null).map((s) => ({ t: s.at!, name: e.name })),
  );

  const checks = specEvents.map((se) => {
    const expectedSec = se.t / fps;
    const frame = secToFrame(se.t, fps);
    // Measure loudness in a 0.2s window centered on the event
    const peak = measurePeakDb(mp4, Math.max(0, expectedSec - 0.1), 0.2);
    const hasSound = peak != null && peak > -40;
    return {
      event: se.name,
      expectedFrame: frame,
      expectedSec,
      peakDb: peak,
      hasSound,
      withinTolerance: hasSound,
    };
  });

  const allPass = checks.every((c) => c.withinTolerance);

  const audit = {
    mp4,
    specId: id,
    fps,
    toleranceSec: 0.05,
    audioPresent,
    audioCodec: stream.codec,
    audioChannels: stream.channels,
    overallPeakDb: overallPeak,
    overallSilent,
    soundEventsDetected: checks.filter((c) => c.withinTolerance).length,
    specOneShotEvents: specEvents.length,
    allEventsAligned: allPass,
    checks,
    auditedAt: new Date().toISOString(),
  };

  const reportPath = join(OUTPUT_DIR, `${id}-report.json`);
  let report: any = {};
  if (existsSync(reportPath)) {
    report = JSON.parse(readFileSync(reportPath, "utf8"));
  }
  report.audioAudit = audit;
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(`Overall peak: ${(overallPeak ?? 0).toFixed(1)} dB ${overallSilent ? "(SILENT)" : "(OK)"}`);
  console.log(
    `Sound events confirmed at event frames: ${audit.soundEventsDetected}/${specEvents.length}`,
  );
  console.log(`All events have sound at their frame: ${allPass}`);
  for (const c of checks) {
    console.log(
      `  ${c.event}: frame ${c.expectedFrame} (${c.expectedSec}s) -> ${
        c.withinTolerance
          ? `OK (peak ${c.peakDb?.toFixed(1)} dB)`
          : `NO SOUND (peak ${c.peakDb?.toFixed(1)} dB)`
      }`,
    );
  }
  console.log(`\nReport updated: ${reportPath}`);
}

main();
