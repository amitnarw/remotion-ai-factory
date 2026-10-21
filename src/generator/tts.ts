/**
 * src/generator/tts.ts — Node-side TTS stage.
 *
 * Derives narration/dialog lines from a validated ShotSpec, runs the
 * engine-agnostic scripts/story-tts.py (kitten2 or voxcpm2) for each
 * engine group, copies the resulting WAVs into public/voice/<id>/ and
 * returns a manifest that CompositionAudio consumes.
 */
import { writeFileSync, mkdirSync, copyFileSync, existsSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";

const ROOT = process.cwd();
const PUBLIC_VOICE = join(ROOT, "public", "voice");
const OUTPUT_DIR = join(ROOT, "output");

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
  const envKey = engine === "kitten2" ? "TTS_KITTEN_PYTHON" : "TTS_VOXCPM_PYTHON";
  const envPath = process.env[envKey];
  if (envPath && existsSync(envPath)) return envPath;
  const venv = join(ROOT, ".tts", engine, ".venv", "Scripts", "python.exe");
  if (existsSync(venv)) return venv;
  const legacy =
    engine === "kitten2" ? "C:/Users/Narwal/Desktop/kitten-tts-test/.venv/Scripts/python.exe" : "";
  if (legacy && existsSync(legacy)) return legacy;
  return process.platform === "win32" ? "python" : "python3";
}

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
    const voiceDesc = narration.voiceDesc;
    // Hook line (optional)
    if (spec.hook?.text) {
      lines.push({ id: "hook", text: spec.hook.text, at: 0, engine, voice, voiceDesc, kind: "narration" });
    }
    (spec.captions ?? []).forEach((c: any, i: number) => {
      if (c?.text) {
        lines.push({ id: `cap-${i}`, text: c.text, at: c.from ?? 0, engine, voice, voiceDesc, kind: "narration" });
      }
    });
  }

  if (dialogs?.enabled) {
    const engine = (dialogs.engine ?? "kitten2") as "kitten2" | "voxcpm2";
    const voices = dialogs.voices ?? {};
    (spec.captions ?? []).forEach((c: any, i: number) => {
      if (c?.speaker && c?.text) {
        const v = voices[c.speaker] ?? (engine === "kitten2" ? "Rosie" : "character-hero");
        const voiceDesc = typeof v === "string" && v.includes(" ") ? v : undefined;
        const voiceId = voiceDesc ? v : v;
        lines.push({
          id: `dlg-${i}`,
          text: c.text,
          at: c.from ?? 0,
          engine,
          voice: voiceDesc ? voiceId : voiceId,
          voiceDesc,
          kind: "dialog",
        });
      }
    });
  }

  return lines;
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

  // Group lines by engine (story-tts.py uses one engine per process).
  const groups = new Map<string, VoiceLine[]>();
  for (const l of lines) {
    if (!groups.has(l.engine)) groups.set(l.engine, []);
    groups.get(l.engine)!.push(l);
  }

  const durations: Record<string, number> = {};
  let mixed = groups.size > 1;

  for (const [engine, groupLines] of groups) {
    const jobPath = join(outDir, `job-${engine}.json`);
    const job = {
      engine,
      outDir,
      lines: groupLines.map((l) => ({
        id: l.id,
        text: l.text,
        voice: l.voice,
        voiceDesc: l.voiceDesc,
      })),
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
      throw new Error(`TTS stage failed for ${engine}: no duration summary.\n${out.slice(-1500)}`);
    }
    const summary = JSON.parse(m[1]);
    Object.assign(durations, summary.durations ?? {});
    console.log(`[voice] ${engine}: ${Object.keys(summary.durations ?? {}).length} lines`);

    // verify files exist
    for (const l of groupLines) {
      const src = join(outDir, `${l.id}.wav`);
      if (!existsSync(src)) throw new Error(`TTS did not produce ${l.id}.wav`);
    }
  }

  // Copy wavs to public/voice/<id>/ and build manifest entries.
  const entries: VoiceManifestEntry[] = lines.map((l) => {
    const src = join(outDir, `${l.id}.wav`);
    const destName = `${l.id}.wav`;
    const dest = join(destDir, destName);
    copyFileSync(src, dest);
    return {
      id: l.id,
      file: `voice/${id}/${destName}`,
      at: l.at,
      dur: durations[l.id],
      kind: l.kind,
    };
  });

  const manifest: VoiceManifest = {
    id,
    engine: mixed ? "mixed" : lines[0].engine,
    lines: entries,
  };
  writeFileSync(join(OUTPUT_DIR, `${id}-voice.json`), JSON.stringify(manifest, null, 2));
  return manifest;
}
