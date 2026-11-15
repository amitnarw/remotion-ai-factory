/**
 * ui/src/lib/memory.ts
 *
 * One app-wide poller for /api/system/memory, mirroring lib/jobs.ts.
 * Sidebar and pill read through useMemory() so they never double-request.
 * Pauses while the tab is hidden, resumes on visibilitychange.
 */
import { useSyncExternalStore } from "react";
import { getSystemMemory } from "../api";

export interface MemoryReading {
  totalRam: number;
  freeRam: number;
  totalCommit: number;
  freeCommit: number | null;
  minFreeRam: number;
  minFreeCommit: number;
  status: "ready" | "tight" | "low";
  source: string;
}

interface Store {
  loaded: boolean;
  reading: MemoryReading | null;
  status: "ready" | "tight" | "low";
}

let state: Store = { loaded: false, reading: null, status: "low" };
const listeners = new Set<() => void>();
let timer: number | null = null;
let hidden = false;

function emit(next: Store) {
  state = next;
  listeners.forEach((l) => l());
}

/** Same thresholds as the Python guard (VOXCPM_MIN_FREE_*_GB). */
export function memoryStatus(reading: MemoryReading | null): "ready" | "tight" | "low" {
  if (!reading) return "low";
  if (reading.freeRam < reading.minFreeRam) return "low";
  const commitOk = reading.freeCommit != null && reading.freeCommit >= reading.minFreeCommit;
  if (!commitOk) return "tight";
  return "ready";
}

async function poll() {
  if (hidden) return;
  let r;
  try {
    r = await getSystemMemory();
  } catch {
    r = null;
  }
  emit({
    loaded: true,
    reading: r,
    status: memoryStatus(r),
  });
}

function schedule(intervalMs: number) {
  if (timer !== null) window.clearInterval(timer);
  void poll();
  timer = window.setInterval(() => void poll(), intervalMs);
}

export function startMemoryPolling(intervalMs = 5000): () => void {
  schedule(intervalMs);
  window.addEventListener("visibilitychange", onVisibility);
  return () => {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    window.removeEventListener("visibilitychange", onVisibility);
  };
}

function onVisibility() {
  hidden = document.hidden;
  if (!hidden) schedule(5000);
}

export function useMemory(): Store {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state,
  );
}

/** Navigate to Settings → Voice engines where the thresholds are explained. */
export function openVoiceSettings(): void {
  const url = new URL(window.location.href);
  url.searchParams.set("tab", "settings");
  url.searchParams.set("section", "voice");
  window.history.pushState(null, "", url.href);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
