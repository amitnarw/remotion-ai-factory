import { spawn } from "child_process";
import fs from "fs";
import { join } from "path";
import { ROOT } from "./providers";

export type TtsEngineId = "kitten2" | "voxcpm2";

export interface TtsEngineInfo {
  id: TtsEngineId;
  label: string;
  sizeMB: number;
  python: string | null;
  installed: boolean;
  legacyPython?: string | null;
}

const ENGINES: Record<TtsEngineId, { label: string; sizeMB: number; pip: string; repo: string; legacy: string[] }> = {
  kitten2: {
    label: "KittenTTS 2",
    sizeMB: 950,
    pip: "kittenml",
    repo: "KittenML/kitten-tts-2",
    legacy: ["C:/Users/Narwal/Desktop/kitten-tts-test/.venv/Scripts/python.exe"],
  },
  voxcpm2: {
    label: "VoxCPM2",
    sizeMB: 2000,
    pip: "voxcpm",
    repo: "openbmb/VoxCPM2",
    legacy: [],
  },
};

export const TTS_ROOT = join(ROOT, ".tts");

function venvPython(engine: TtsEngineId): string {
  return join(TTS_ROOT, engine, ".venv", "Scripts", "python.exe");
}

function venvExists(engine: TtsEngineId): boolean {
  return fs.existsSync(venvPython(engine));
}

function weightsCached(engine: TtsEngineId): boolean {
  // HF cache layout: ~/.cache/huggingface/hub/models--<org>--<name>
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const cache = join(home, ".cache", "huggingface", "hub");
  const repo = ENGINES[engine].repo.replace("/", "--");
  const dir = join(cache, `models--${repo}`);
  return fs.existsSync(dir);
}

export function engineInfo(engine: TtsEngineId): TtsEngineInfo {
  // Prefer project-local venv, then legacy, then env override.
  const envKey = engine === "kitten2" ? "TTS_KITTEN_PYTHON" : "TTS_VOXCPM_PYTHON";
  const envPath = process.env[envKey];
  let python: string | null = null;
  if (envPath && fs.existsSync(envPath)) python = envPath;
  else if (venvExists(engine)) python = venvPython(engine);
  else {
    for (const p of ENGINES[engine].legacy) {
      if (fs.existsSync(p)) { python = p; break; }
    }
  }
  const installed = !!python && weightsCached(engine);
  return {
    id: engine,
    label: ENGINES[engine].label,
    sizeMB: ENGINES[engine].sizeMB,
    python,
    installed,
    legacyPython: ENGINES[engine].legacy.find((p) => fs.existsSync(p)) ?? null,
  };
}

export function ttsStatus() {
  return {
    kitten2: engineInfo("kitten2"),
    voxcpm2: engineInfo("voxcpm2"),
  };
}

export interface TtsInstallJob {
  id: string;
  engine: TtsEngineId;
  status: "queued" | "running" | "done" | "failed";
  stage: string;
  progress: number;
  message: string;
  log: string[];
  error?: string;
  startedAt: number;
  lastActivityAt?: number;
}

const jobs = new Map<string, TtsInstallJob>();
let counter = 0;

export function getTtsJob(id: string): TtsInstallJob | undefined {
  return jobs.get(id);
}

function setProgress(job: TtsInstallJob, stage: string, progress: number, message: string) {
  job.stage = stage;
  job.progress = Math.min(100, Math.max(0, Math.round(progress)));
  job.message = message;
  job.lastActivityAt = Date.now();
}

function runCommand(cmd: string, args: string[], onLine: (line: string) => void): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let buf = "";
    const flush = (chunk: string) => {
      buf += chunk;
      // pip and `hf download` draw their progress bars with carriage returns
      // (no newline), so split on \\r as well — otherwise live % never parses.
      const parts = buf.split(/[\r\n]+/);
      buf = parts.pop() ?? "";
      for (const p of parts) if (p.trim()) onLine(p);
    };
    child.stdout?.on("data", (d) => flush(d.toString()));
    child.stderr?.on("data", (d) => flush(d.toString()));
    child.on("close", (code) => { if (buf.trim()) onLine(buf); resolve(code ?? 0); });
    child.on("error", (e) => { onLine(String(e)); resolve(1); });
  });
}

export function startInstall(engine: TtsEngineId): string {
  const id = `tts-${Date.now()}-${++counter}`;
  const job: TtsInstallJob = {
    id, engine, status: "queued", stage: "queued", progress: 0,
    message: "Queued", log: [], startedAt: Date.now(), lastActivityAt: Date.now(),
  };
  jobs.set(id, job);

  (async () => {
    job.status = "running";
    const eng = ENGINES[engine];
    const venv = join(TTS_ROOT, engine, ".venv");
    const py = venvPython(engine);
    try {
      // 1. create venv
      setProgress(job, "venv", 2, "Creating virtual environment…");
      if (!fs.existsSync(py)) {
        const sysPy = process.platform === "win32" ? "python" : "python3";
        const code = await runCommand(sysPy, ["-m", "venv", venv], (l) => { job.log.push(l); job.lastActivityAt = Date.now(); });
        if (code !== 0) throw new Error("venv creation failed — is Python 3.10+ on PATH?");
      }
      // 2. pip install
      setProgress(job, "pip", 8, "Installing packages…");
      const pip = join(venv, "Scripts", "pip.exe");
      const pipCmd = fs.existsSync(pip) ? pip : join(venv, "bin", "pip");
      let pct = 8;
      const code2 = await runCommand(pipCmd, ["install", "--upgrade", eng.pip], (l) => {
        job.log.push(l);
        job.lastActivityAt = Date.now();
        const m = l.match(/(\d{1,3})%/);
        if (m) { pct = Math.max(pct, Math.min(40, parseInt(m[1], 10) * 0.4 + 8)); setProgress(job, "pip", pct, `Installing ${eng.pip}… ${m[1]}%`); }
        else if (/Downloading/i.test(l)) setProgress(job, "pip", pct, l.slice(0, 90));
        else if (/Installing collected/i.test(l)) setProgress(job, "pip", pct, "Installing collected packages…");
      });
      if (code2 !== 0) throw new Error(`${eng.pip} install failed — see log`);
      setProgress(job, "pip", 40, "Packages installed");

      // 3. download weights
      setProgress(job, "weights", 42, `Downloading ${eng.repo} weights…`);
      const hf = join(venv, "Scripts", "hf.exe");
      const hfCmd = fs.existsSync(hf) ? hf : join(venv, "bin", "hf");
      let wPct = 42;
      const code3 = await runCommand(hfCmd, ["download", eng.repo], (l) => {
        job.log.push(l);
        job.lastActivityAt = Date.now();
        const m = l.match(/(\d{1,3})%/);
        if (m) {
          const raw = parseInt(m[1], 10);
          wPct = Math.max(wPct, Math.min(95, 42 + raw * 0.53));
          // Try to surface downloaded/total size from tqdm-style bars.
          const sizeM = l.match(/([\d.]+)\s*([GMK]i?B)\s*\/\s*([\d.]+)\s*([GMK]i?B)/i);
          const msg = sizeM
            ? `Downloading ${eng.repo}… ${raw}% · ${sizeM[1]} ${sizeM[2]} / ${sizeM[3]} ${sizeM[4]}`
            : `Downloading ${eng.repo}… ${raw}%`;
          setProgress(job, "weights", wPct, msg);
        }
        else if (/download/i.test(l)) setProgress(job, "weights", wPct, l.slice(0, 90));
      });
      if (code3 !== 0) throw new Error(`weight download failed — see log`);

      // 4. verify
      setProgress(job, "verify", 97, "Verifying install…");
      const code4 = await runCommand(py, ["-c", `import ${eng.pip}; print("OK")`], (l) => { job.log.push(l); job.lastActivityAt = Date.now(); });
      if (code4 !== 0) throw new Error("verification import failed");

      setProgress(job, "done", 100, `${ENGINES[engine].label} is ready`);
      job.status = "done";
    } catch (e) {
      job.status = "failed";
      job.error = String(e);
      job.message = String(e);
    }
  })();

  return id;
}
