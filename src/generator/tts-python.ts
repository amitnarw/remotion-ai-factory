/**
 * src/generator/tts-python.ts — the one place that decides which Python runs a
 * TTS engine. Used by the generator (tts.ts) and the server (voice audition,
 * voice list, Setup tab) so they can never disagree.
 *
 * Order: the env override (TTS_KITTEN_PYTHON / TTS_VOXCPM_PYTHON), then the
 * project venv at .tts/<engine>/.venv (created by the Setup tab). Nothing else:
 * no machine-specific paths and no system Python, so "installed" always means
 * the engine's own environment is there.
 */
import { existsSync } from "fs";
import { join } from "path";

export type TtsEngineId = "kitten2" | "voxcpm2";

const ROOT = join(__dirname, "..", "..");
export const TTS_ROOT = join(ROOT, ".tts");

export function envKeyFor(engine: TtsEngineId): string {
  return engine === "kitten2" ? "TTS_KITTEN_PYTHON" : "TTS_VOXCPM_PYTHON";
}

/** Where the project venv's Python lives (Scripts/ on Windows, bin/ elsewhere). */
export function venvPythonPath(engine: TtsEngineId): string {
  const bin = process.platform === "win32" ? join("Scripts", "python.exe") : join("bin", "python");
  return join(TTS_ROOT, engine, ".venv", bin);
}

/** The Python that runs an engine, or null when the engine is not installed. */
export function resolveTtsPython(engine: TtsEngineId): string | null {
  const override = process.env[envKeyFor(engine)];
  if (override && existsSync(override)) return override;
  const venv = venvPythonPath(engine);
  return existsSync(venv) ? venv : null;
}
