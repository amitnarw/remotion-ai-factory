/**
 * server/memory.ts
 *
 * Reports free physical RAM and free commit charge so the dashboard can tell,
 * before the user clicks Play, whether VoxCPM2 will actually load.
 *
 * The numbers come from Windows GlobalMemoryStatusEx (ullAvailPhys /
 * ullAvailPageFile) — the exact same fields the Python guard reads in
 * scripts/story-tts.py — served from a cached, lazily-spawned PowerShell
 * helper so a poll is ~1 ms instead of ~350 ms. Fall back to Node's
 * os.freemem()/os.totalmem() when PowerShell is unavailable (non-Windows);
 * commit charge is then unknown (freeCommit: null).
 */

import os from "node:os";
import { spawn } from "node:child_process";

export interface MemoryReading {
  /** Total physical RAM in bytes. */
  totalPhys: number;
  /** Free physical RAM in bytes. */
  availPhys: number;
  /** Total commit limit in bytes. */
  totalPageFile: number;
  /** Free commit charge in bytes. */
  availPageFile: number;
  /** "windows" when GlobalMemoryStatusEx answered, otherwise "node". */
  source: "windows" | "node";
}

/** The guarded-load thresholds — same env vars the Python guard reads. */
export const MIN_FREE_RAM_GB = Number(
  process.env.VOXCPM_MIN_FREE_RAM_GB ?? "3.0",
);
export const MIN_FREE_COMMIT_GB = Number(
  process.env.VOXCPM_MIN_FREE_COMMIT_GB ?? "6.0",
);

const GB = 1024 ** 3;
export { GB };

/** Base64-encoded PowerShell that reads memory over stdin/stdout and nothing else. */
const POWERSHELL_PROTOCOL_B64 = Buffer.from(
  [
    "Add-Type -TypeDefinition @'",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public class Mem {",
    "  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Auto)]",
    "  public struct MEMORYSTATUSEX { public uint dwLength; public uint dwMemoryLoad; public ulong ullTotalPhys; public ulong ullAvailPhys; public ulong ullTotalPageFile; public ulong ullAvailPageFile; public ulong ullTotalVirtual; public ulong ullAvailVirtual; public ulong ullAvailExtendedVirtual; }",
    "  [DllImport(\"kernel32.dll\", SetLastError=true)] static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX st);",
    "  public static long[] Read() {",
    "    var st = new MEMORYSTATUSEX();",
    "    st.dwLength = (uint)Marshal.SizeOf(typeof(MEMORYSTATUSEX));",
    "    GlobalMemoryStatusEx(ref st);",
    "    return new long[] { (long)st.ullTotalPhys, (long)st.ullAvailPhys, (long)st.ullTotalPageFile, (long)st.ullAvailPageFile };",
    "  }",
    "}",
    "'@",
    "while ($true) {",
    "  $line = [Console]::In.ReadLine()",
    "  if ($null -eq $line) { break }",
    "  $m = [Mem]::Read()",
    "  Write-Output (\"{0}|{1}|{2}|{3}\" -f $m[0], $m[1], $m[2], $m[3])",
    "}",
  ].join("\r\n"),
  "utf16le",
).toString("base64");

const OUTPUT_RE = /^\d+\|\d+\|\d+\|\d+$/;

/** One long-lived powershell process answering memory queries over stdin/stdout. */
class MemoryProbe {
  private child: ReturnType<typeof spawn> | null = null;
  private pending = new Array<{
    resolve: (value: MemoryReading | null) => void;
    reject: (reason?: unknown) => void;
  }>();
  private buf = "";
  private dead = false;

  /** Read once, cached for `ttlMs`. Returns null when measurement is unavailable. */
  read(ttlMs = 2000): Promise<MemoryReading | null> {
    const now = Date.now();
    if (this.cached && now - this.cached.at < ttlMs) {
      return Promise.resolve(this.cached.reading);
    }
    return this.probe();
  }

  private cached: { at: number; reading: MemoryReading | null } | null = null;

  private probe(): Promise<MemoryReading | null> {
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
      this.ensure();
      this.flush();
    });
  }

  private ensure(): void {
    if (this.child) return;
    if (this.dead) return;
    if (process.platform !== "win32") return;
    this.child = spawn("powershell", [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      POWERSHELL_PROTOCOL_B64,
    ], { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    this.child.stderr?.on("data", (d) => (stderr += d.toString()));
    this.child.on("exit", () => {
      this.dead = true;
      this.child = null;
      for (const p of this.pending.splice(0, this.pending.length)) {
        p.reject(new Error("memory probe exited"));
      }
    });
    this.child.stdout?.on("data", (d) => this.onData(d.toString()));
  }

  private flush(): void {
    if (!this.child || this.flushing) return;
    this.flushing = true;
    this.child.stdin?.write("go\n", () => {
      this.flushing = false;
    });
  }
  private flushing = false;

  private onData(text: string): void {
    this.buf += text;
    const lines = this.buf.split(/\r?\n/);
    this.buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!OUTPUT_RE.test(line)) continue;
      const [tp, ap, tf, af] = line.split("|").map(Number);
      const reading: MemoryReading = {
        totalPhys: tp,
        availPhys: ap,
        totalPageFile: tf,
        availPageFile: af,
        source: "windows",
      };
      this.cached = { at: Date.now(), reading };
      const p = this.pending.shift();
      if (p) p.resolve(reading);
    }
  }

  /** Drop the probe when the dashboard is closed (idle for a minute). */
  dispose(): void {
    this.child?.stdin?.end();
    this.child?.kill();
    this.child = null;
  }
}

export const probe = new MemoryProbe();

/** Node-only fallback (exact for RAM, unknown for commit). */
function nodeReading(): MemoryReading | null {
  try {
    return {
      totalPhys: os.totalmem(),
      availPhys: os.freemem(),
      totalPageFile: 0,
      availPageFile: 0,
      source: "node",
    };
  } catch {
    return null;
  }
}

/** Best-effort snapshot: windows probe preferred, node fallback. */
export async function readSystemMemory(): Promise<MemoryReading | null> {
  if (process.platform === "win32") {
    const r = await probe.read();
    if (r) return r;
    return nodeReading();
  }
  return nodeReading();
}

/** "ready" / "tight" / "low" — matches scripts/story-tts.py voxcpm_memory_problem(). */
export function memoryStatus(
  reading: MemoryReading | null,
): "ready" | "tight" | "low" {
  if (!reading) return "low";
  const ramGB = reading.availPhys / GB;
  const commitGB = reading.availPageFile / GB;
  if (ramGB < MIN_FREE_RAM_GB || commitGB < MIN_FREE_COMMIT_GB) {
    return ramGB < MIN_FREE_RAM_GB ? "low" : "tight";
  }
  return "ready";
}
