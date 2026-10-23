/**
 * src/generator/tts.ts — Node-side TTS stage.
 *
 * Derives narration/dialog lines from a validated ShotSpec, runs the
 * engine-agnostic scripts/story-tts.py (kitten2 or voxcpm2) for each
 * engine group, copies the resulting WAVs into public/voice/<id>/ and
 * returns a manifest that CompositionAudio consumes.
 */
import { writeFileSync, mkdirSync, copyFileSync, existsSync, readFileSync } from "fs";
import { createHash } from "crypto";
import { join } from "path";
import { spawn } from "child_process";
import { runFfmpeg } from "./ffmpeg";
import { resolveTtsPython, envKeyFor } from "./tts-python";
import { voxDescription } from "./voices";

const ROOT = process.cwd();
const PUBLIC_VOICE = join(ROOT, "public", "voice");
const OUTPUT_DIR = join(ROOT, "output");
// Outside public/: Remotion bundles public/ into every render, so a growing cache there would slow them all.
export const CACHE_DIR = join(ROOT, ".cache", "voice");

/**
 * Run a Python script and collect its output (stdout + stderr), with a time
 * limit. `onLine` gets each complete stdout line as it arrives.
 */
function runPython(python: string, args: string[], timeoutMs: number, onLine?: (line: string) => void): Promise<string> {
  return new Promise((resolve) => {
    let out = "";
    let partial = "";
    const child = spawn(python, args, {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
    });
    const timer = setTimeout(() => {
      out += `\n[voice] timed out after ${Math.round(timeoutMs / 60000)} min`;
      child.kill();
    }, timeoutMs);
    child.stdout?.on("data", (d) => {
      const text = d.toString();
      out += text;
      const lines = (partial + text).split(/\r?\n/);
      partial = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("[voice/")) console.log(line);
        onLine?.(line);
      }
    });
    child.stderr?.on("data", (d) => (out += d.toString()));
    child.on("close", () => {
      clearTimeout(timer);
      if (partial) onLine?.(partial);
      resolve(out);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve(out + String(e));
    });
  });
}

export interface VoiceLine {
  id: string;
  text: string;
  at: number;
  engine: "kitten2" | "voxcpm2";
  voice: string;
  voiceDesc?: string;
  kind: "narration" | "dialog";
}

export interface VoiceManifestEntry {
  id: string;
  file: string;
  at: number;
  dur?: number;
  kind: "narration" | "dialog";
}

export interface VoiceManifest {
  id: string;
  engine: "kitten2" | "voxcpm2" | "mixed";
  lines: VoiceManifestEntry[];
}

function pythonFor(engine: "kitten2" | "voxcpm2"): string {
  const python = resolveTtsPython(engine);
  if (!python) {
    throw new Error(
      `${engine} is not installed. Install it in the Setup tab, or set ${envKeyFor(engine)} to a Python that has it.`,
    );
  }
  return python;
}

/**
 * Bump when the synthesis settings change (sampling, pauses, prompts). Old
 * cache entries then stop matching and everything is re-rendered once.
 */
const SYNTH_VERSION = "2";

/**
 * Derive voice lines from a spec + audio config.
 * audioConfig shape mirrors ShotSpec.audio.narration/dialogs + job.audio.
 */
export function deriveLines(spec: any, audioConfig: any): VoiceLine[] {
  const lines: VoiceLine[] = [];
  const narration = audioConfig?.narration;
  const dialogs = audioConfig?.dialogs;

  if (narration?.enabled) {
    const engine = (narration.engine ?? "voxcpm2") as "kitten2" | "voxcpm2";
    const voice = narration.voice ?? (engine === "kitten2" ? "Bruno" : "narrator-calm");
    const voiceDesc = engine === "voxcpm2" ? voxDescription(voice, narration.voiceDesc) : undefined;
    if (spec.hook?.text) {
      lines.push({ id: "hook", text: spec.hook.text, at: 0, engine, voice, voiceDesc, kind: "narration" });
    }
    // A caption with a speaker is dialogue. When character voices are on, that
    // character speaks it, so the narrator skips it. Otherwise the narrator reads
    // it, so no line goes silent.
    const charactersSpeak = !!dialogs?.enabled;
    (spec.captions ?? []).forEach((c: any, i: number) => {
      if (c?.text && !(charactersSpeak && c.speaker)) {
        lines.push({ id: `cap-${i}`, text: c.text, at: c.from ?? 0, engine, voice, voiceDesc, kind: "narration" });
      }
    });
  }

  if (dialogs?.enabled) {
    const engine = (dialogs.engine ?? "kitten2") as "kitten2" | "voxcpm2";
    const voices: Record<string, string> = dialogs.voices ?? {};
    const fallback = dialogs.defaultVoice ?? (engine === "kitten2" ? "Rosie" : "character-hero");
    (spec.captions ?? []).forEach((c: any, i: number) => {
      if (c?.speaker && c?.text) {
        const voice = voices[c.speaker] ?? fallback;
        const voiceDesc = engine === "voxcpm2" ? voxDescription(voice) : undefined;
        lines.push({ id: `dlg-${i}`, text: c.text, at: c.from ?? 0, engine, voice, voiceDesc, kind: "dialog" });
      }
    });
  }

  return lines;
}

/** Content hash of everything that changes the audio: same inputs, same file. */
export function cacheKey(l: Pick<VoiceLine, "engine" | "voice" | "voiceDesc" | "text">): string {
  return createHash("sha1")
    .update(JSON.stringify({ v: SYNTH_VERSION, engine: l.engine, voice: l.voice, voiceDesc: l.voiceDesc ?? null, text: l.text }))
    .digest("hex");
}

export async function runTtsStage(
  spec: any,
  audioConfig: any,
  id: string,
): Promise<VoiceManifest | null> {
  const lines = deriveLines(spec, audioConfig);
  if (lines.length === 0) return null;
  return synthesizeLines(lines, id);
}

/** Store a finished line in the cache, with what the duration estimator needs. */
function cacheLine(l: VoiceLine, src: string, dur: number) {
  const key = cacheKey(l);
  copyFileSync(src, join(CACHE_DIR, `${key}.wav`));
  // Word count lets the duration estimator calibrate to the real voices (per engine).
  writeFileSync(
    join(CACHE_DIR, `${key}.json`),
    JSON.stringify({ dur, words: l.text.split(/\s+/).filter(Boolean).length, engine: l.engine, voice: l.voice }),
  );
}

/**
 * Synthesize the given lines (cache first), copy them to public/voice/<id>/ and
 * return the manifest with measured durations. Used by the render stage and by
 * the Phase 2 pipeline, which plans its own lines from the story.
 * `publish: false` (auditions) leaves public/ alone: each entry's `file` is
 * then the absolute path of the cached WAV.
 */
export async function synthesizeLines(lines: VoiceLine[], id: string, opts: { publish?: boolean } = {}): Promise<VoiceManifest> {
  const publish = opts.publish ?? true;
  const outDir = join(OUTPUT_DIR, `${id}-voice`);
  mkdirSync(outDir, { recursive: true });
  const destDir = join(PUBLIC_VOICE, id);
  if (publish) mkdirSync(destDir, { recursive: true });
  mkdirSync(CACHE_DIR, { recursive: true });

  // 1. Reuse every line already synthesized with the same inputs.
  const durations: Record<string, number> = {};
  const missing: VoiceLine[] = [];
  let reused = 0;
  for (const l of lines) {
    const key = cacheKey(l);
    const wav = join(CACHE_DIR, `${key}.wav`);
    const meta = join(CACHE_DIR, `${key}.json`);
    if (existsSync(wav) && existsSync(meta)) {
      durations[l.id] = JSON.parse(readFileSync(meta, "utf8")).dur;
      reused += 1;
    } else {
      missing.push(l);
    }
  }
  if (reused > 0) console.log(`[voice] cache: ${reused} line(s) reused, ${missing.length} to synthesize`);

  // 2. Synthesize only the missing lines, one Python process per engine.
  const groups = new Map<string, VoiceLine[]>();
  for (const l of missing) {
    if (!groups.has(l.engine)) groups.set(l.engine, []);
    groups.get(l.engine)!.push(l);
  }

  for (const [engine, groupLines] of groups) {
    const jobPath = join(outDir, `job-${engine}.json`);
    const job = {
      engine,
      outDir,
      lines: groupLines.map((l) => ({ id: l.id, text: l.text, voice: l.voice, voiceDesc: l.voiceDesc })),
    };
    writeFileSync(jobPath, JSON.stringify(job, null, 2));

    const python = pythonFor(engine as "kitten2" | "voxcpm2");
    // Each line is cached the moment the engine reports it, so a crash or the
    // time limit loses only the line in progress and a retry carries on.
    const byId = new Map(groupLines.map((l) => [l.id, l]));
    const cached = new Set<string>();
    const onLine = (line: string) => {
      const m = /^\[voice\/\w+\] (\S+): ([\d.]+)s/.exec(line);
      const l = m ? byId.get(m[1]) : undefined;
      const src = l ? join(outDir, `${l.id}.wav`) : "";
      if (!l || cached.has(l.id) || !existsSync(src)) return;
      durations[l.id] = Number(m![2]);
      cacheLine(l, src, durations[l.id]);
      cached.add(l.id);
    };
    // Async, so a server calling this keeps answering other requests while the
    // engine works. Kitten 2 on a CPU takes ~40-50 s per line, plus loading.
    const limitMin = Math.max(30, groupLines.length * 3);
    const out = await runPython(python, [join(ROOT, "scripts", "story-tts.py"), jobPath, "--engine", engine], limitMin * 60 * 1000, onLine);
    const m = out.match(/@@\s*(\{.*\})/);
    if (!m) {
      throw new Error(`TTS stage failed for ${engine}: no duration summary (${cached.size} of ${groupLines.length} line(s) finished and are cached).
${out.slice(-1500)}`);
    }
    const summary = JSON.parse(m[1]);
    console.log(`[voice] ${engine}: ${Object.keys(summary.durations ?? {}).length} line(s) synthesized`);

    for (const l of groupLines) {
      if (cached.has(l.id)) continue;
      const src = join(outDir, `${l.id}.wav`);
      if (!existsSync(src)) throw new Error(`TTS did not produce ${l.id}.wav`);
      durations[l.id] = summary.durations?.[l.id];
      cacheLine(l, src, durations[l.id]);
    }
  }

  // 3. Copy every line (cached or new) into this story's public voice folder.
  const entries: VoiceManifestEntry[] = lines.map((l) => {
    const cachedWav = join(CACHE_DIR, `${cacheKey(l)}.wav`);
    if (publish) copyFileSync(cachedWav, join(destDir, `${l.id}.wav`));
    return {
      id: l.id,
      file: publish ? `voice/${id}/${l.id}.wav` : cachedWav,
      at: l.at,
      dur: durations[l.id],
      kind: l.kind,
    };
  });

  const manifest: VoiceManifest = {
    id,
    engine: new Set(lines.map((l) => l.engine)).size > 1 ? "mixed" : lines[0].engine,
    lines: entries,
  };
  if (publish) writeFileSync(join(OUTPUT_DIR, `${id}-voice.json`), JSON.stringify(manifest, null, 2));
  return manifest;
}

/** Length of a PCM WAV file in seconds, from its header. */
export function wavSeconds(path: string): number {
  const b = readFileSync(path);
  let off = 12;
  let rate = 0;
  let block = 0;
  while (off + 8 <= b.length) {
    const id = b.toString("ascii", off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === "fmt ") {
      rate = b.readUInt32LE(off + 12);
      block = b.readUInt16LE(off + 20);
    }
    if (id === "data" && rate && block) return Math.min(size, b.length - off - 8) / block / rate;
    off += 8 + size + (size % 2);
  }
  throw new Error(`not a WAV file: ${path}`);
}

/**
 * Speed a synthesized line up with the pitch kept (ffmpeg atempo), from the
 * cached original into public/<file>, so running it twice never compounds.
 * Returns the new length in seconds.
 */
export function tempoVoiceFile(l: Pick<VoiceLine, "engine" | "voice" | "voiceDesc" | "text">, file: string, tempo: number): number {
  const src = join(CACHE_DIR, `${cacheKey(l)}.wav`);
  const dest = join(ROOT, "public", file);
  if (!existsSync(src)) throw new Error(`no cached voice for ${file}`);
  const r = runFfmpeg(["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-filter:a", `atempo=${tempo}`, dest]);
  if (!r.ok) throw new Error(`could not speed up ${file}: ${r.stderr.slice(-300)}`);
  return Number(wavSeconds(dest).toFixed(3));
}
