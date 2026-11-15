/**
 * ui/src/components/MemoryMeter.tsx
 *
 * Sidebar meter + narrow-screen pill showing free RAM and free commit charge,
 * the two numbers the VoxCPM2 load guard checks. Click opens Settings → Voice
 * engines where the thresholds are explained.
 */
import { HardDrive } from "lucide-react";
import { useMemory, openVoiceSettings } from "../lib/memory";
import { cn } from "../lib/utils";

const TONE: Record<"ready" | "tight" | "low", string> = {
  ready: "border-success/50 bg-success/10 text-success",
  tight: "border-accent/50 bg-accent/10 text-accent-foreground",
  low: "border-destructive/50 bg-destructive/10 text-destructive",
};

function toneClass(status: "ready" | "tight" | "low") {
  return TONE[status];
}

const TONE_TEXT: Record<"ready" | "tight" | "low", string> = {
  ready: "text-success",
  tight: "text-accent-foreground",
  low: "text-destructive",
};

function statusDot(status: "ready" | "tight" | "low") {
  return (
    <span
      className={cn("w-2 h-2 rounded-full shrink-0", TONE_TEXT[status])}
      aria-hidden
    />
  );
}

function fmt(gb: number | null) {
  return gb == null ? "–" : gb.toFixed(1);
}

export function MemoryMeter() {
  const { loaded, reading, status } = useMemory();
  if (!loaded) return null;

  const pct =
    reading && reading.totalRam > 0 ? (reading.freeRam / reading.totalRam) * 100 : 0;
  const tickPct =
    reading && reading.totalRam > 0 ? (reading.minFreeRam / reading.totalRam) * 100 : 0;

  return (
    <section className="px-1 space-y-3">
      <button
        type="button"
        onClick={openVoiceSettings}
        className={cn(
          "w-full flex items-center gap-2.5 text-left border rounded-xl px-3 py-2 transition-colors",
          toneClass(status),
        )}
        aria-label={`Memory ${status ?? "unavailable"}`}
      >
        <div className="flex flex-col items-start">
          <HardDrive className="h-4 w-4 shrink-0" />
          <div className="text-sm font-semibold">Memory</div>
          <div className="text-xs text-muted-foreground">
            {reading ? `${reading.freeRam.toFixed(1)} of ${reading.totalRam.toFixed(1)} GB free` : "unavailable"}
          </div>
        </div>
        <span className={`text-xs font-semibold ${TONE_TEXT[status]}`}>
          {status ?? "–"}
        </span>
      </button>
      {reading && (
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-input px-1">
          <div
            className={cn("h-full rounded-full transition-[width] duration-500", toneClass(status))}
            style={{ width: `${Math.round(pct)}%` }}
          />
          {/* Threshold tick at the guard line. */}
          {tickPct > 0 && tickPct < 100 && (
            <div
              className="absolute top-0 bottom-0 w-px bg-black/25"
              style={{ left: `${tickPct}%` }}
              aria-hidden
            />
          )}
        </div>
      )}
      {reading && (
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>
            RAM {fmt(reading.freeRam)} GB / {reading.totalRam.toFixed(1)} GB
          </span>
          <span>
            commit {fmt(reading.freeCommit)} GB /
            {reading.totalCommit.toFixed(1)} GB
          </span>
        </div>
      )}
    </section>
  );
}

export function MemoryPill() {
  const { loaded, reading, status } = useMemory();
  if (!loaded || !reading) return null;

  return (
    <button
      type="button"
      onClick={openVoiceSettings}
      className={cn(
        "flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[10px] font-semibold transition-colors",
        toneClass(status),
      )}
      aria-label={`Memory ${status}: ${reading.freeRam.toFixed(1)} GB free`}
    >
      <HardDrive className="h-3 w-3 shrink-0" />
      <span>{reading.freeRam.toFixed(1)} GB</span>
      {statusDot(status)}
    </button>
  );
}
