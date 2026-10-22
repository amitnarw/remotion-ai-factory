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
import { spawnSync } from "child_process";
import { resolveTtsPython, envKeyFor } from "./tts-python";
import { voxDescription } from "./voices";

const ROOT = process.cwd();
const PUBLIC_VOICE = join(ROOT, "public", "voice");
const OUTPUT_DIR = join(ROOT, "output");
// Outside public/: Remotion bundles public/ into every render, so a growing cache there would slow them all.
const CACHE_DIR = join(ROOT, ".cache", "voice");

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
function cacheKey(l: VoiceLine): string {
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

  const outDir = join(OUTPUT_DIR, `${id}-voice`);
  mkdirSync(outDir, { recursive: true });
  const destDir = join(PUBLIC_VOICE, id);
  mkdirSync(destDir, { recursive: true });
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
    const r = spawnSync(python, [join(ROOT, "scripts", "story-tts.py"), jobPath, "--engine", engine], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
      timeout: 10 * 60 * 1000,
    });

    const out = (r.stdout || "") + (r.stderr || "");
    const m = out.match(/@@\s*(\{.*\})/);
    if (!m) {
      throw new Error(`TTS stage failed for ${engine}: no duration summary.
${out.slice(-1500)}`);
    }
    const summary = JSON.parse(m[1]);
    console.log(`[voice] ${engine}: ${Object.keys(summary.durations ?? {}).length} line(s) synthesized`);

    for (const l of groupLines) {
      const src = join(outDir, `${l.id}.wav`);
      if (!existsSync(src)) throw new Error(`TTS did not produce ${l.id}.wav`);
      const dur = summary.durations?.[l.id];
      durations[l.id] = dur;
      const key = cacheKey(l);
      copyFileSync(src, join(CACHE_DIR, `${key}.wav`));
      writeFileSync(join(CACHE_DIR, `${key}.json`), JSON.stringify({ dur }));
    }
  }

  // 3. Copy every line (cached or new) into this story's public voice folder.
  const entries: VoiceManifestEntry[] = lines.map((l) => {
    const key = cacheKey(l);
    const dest = join(destDir, `${l.id}.wav`);
    copyFileSync(join(CACHE_DIR, `${key}.wav`), dest);
    return {
      id: l.id,
      file: `voice/${id}/${l.id}.wav`,
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
  writeFileSync(join(OUTPUT_DIR, `${id}-voice.json`), JSON.stringify(manifest, null, 2));
  return manifest;
}
