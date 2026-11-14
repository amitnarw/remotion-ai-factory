/**
 * server/activity.ts — one activity registry for everything that can take time.
 *
 * Plan jobs, renders, variants, publish packs, TTS installs, and one-off
 * blocking calls (provider test / models, voice sample, offers, recast,
 * voice-preview warmup, voice-reference design) all register here. The UI
 * polls /api/activity and /api/activity/stream so the dashboard always shows
 * what is running and how long it has been quiet — no more "is it stuck?".
 *
 * It also captures console.log/warn/error into a ring buffer so provider
 * checks, TTS install output and other server-side noise stay visible even
 * when no structured job exists.
 */

import fs from "fs";
import { join } from "path";
import { ROOT } from "./providers";

const ACTIVITY_DIR = join(ROOT, "output", "activity");
const MAX_LOG_LINES = 2000;
const MAX_SERVER_LOG = 1000;
const STALE_MS = 60 * 1000; // quiet for a minute -> "still working"
const STUCK_MS = 5 * 60 * 1000; // quiet for five minutes -> "possibly stuck"

export type ActivityKind =
  | "plan"
  | "render"
  | "variants"
  | "publish"
  | "tts-install"
  | "provider-test"
  | "provider-models"
  | "voice-sample"
  | "voice-audition"
  | "voice-preview-warm"
  | "voice-reference"
  | "recast"
  | "offers"
  | "voice-link"
  | "editor-measure"
  | "other";

export interface Activity {
  id: string;
  kind: ActivityKind;
  label: string;
  /** Premise, provider, engine, etc. — shown under the label. */
  args?: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  progress: number;
  stage?: string;
  etaSec?: number | null;
  error?: string;
  startedAt: number;
  endedAt?: number;
  /** Last time something changed (log, progress, stage). */
  lastActivityAt: number;
  logs: string[];
}

interface Store {
  activities: Map<string, Activity>;
  listeners: Set<(id: string, act: Activity) => void>;
  serverLog: Array<{ t: number; level: "log" | "warn" | "error"; msg: string }>;
}

let store: Store | null = null;
let serverLogOrig: { log: typeof console.log; warn: typeof console.warn; error: typeof console.error } | null = null;

export function getActivityStore(): Store {
  if (!store) {
    store = { activities: new Map(), listeners: new Set(), serverLog: [] };
    loadActivitiesFromDisk();
    captureServerLog();
  }
  return store;
}

function emit(id: string, act: Activity): void {
  const s = getActivityStore();
  s.listeners.forEach((l) => { try { l(id, act); } catch { /* ignore */ } });
  persistActivity(id);
}


/** Emit to every Activity-page SSE client watching this item. */
export function broadcastActivity(id: string, data: unknown): void {
  const clients = sseClients.get(id);
  if (!clients) return;
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const c of [...clients]) {
    try { c.write(msg); } catch { /* ignore */ }
  }
}

function persistActivity(id: string): void {
  try {
    fs.mkdirSync(ACTIVITY_DIR, { recursive: true });
    const act = getActivityStore().activities.get(id);
    if (!act) return;
    fs.writeFileSync(join(ACTIVITY_DIR, `${id}.json`), JSON.stringify(act));
  } catch { /* persistence must never break anything */ }
}

function loadActivitiesFromDisk(): void {
  try {
    if (!fs.existsSync(ACTIVITY_DIR)) return;
    for (const f of fs.readdirSync(ACTIVITY_DIR)) {
      if (!/^[a-z0-9_-]+\.json$/i.test(f)) continue;
      try {
        const a = JSON.parse(fs.readFileSync(join(ACTIVITY_DIR, f), "utf8")) as Activity;
        if (!a || typeof a.id !== "string") continue;
        getActivityStore().activities.set(a.id, a);
      } catch { /* ignore bad file */ }
    }
  } catch { /* no activity dir yet */ }
}

/** Keep only the last 100 finished items on disk. */
export function evictOldActivities(): void {
  const s = getActivityStore();
  const finished = [...s.activities.values()].filter(
    (a) => a.status === "done" || a.status === "failed" || a.status === "cancelled",
  ).sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt));
  for (let i = 100; i < finished.length; i++) {
    s.activities.delete(finished[i].id);
    try { fs.rmSync(join(ACTIVITY_DIR, `${finished[i].id}.json`), { force: true }); } catch { /* ignore */ }
  }
}

/** Create or resume an activity item. */
export function createActivity({
  id,
  kind,
  label,
  args,
  status = "queued",
  stage,
}: {
  id: string;
  kind: ActivityKind;
  label: string;
  args?: string;
  status?: Activity["status"];
  stage?: string;
}): Activity {
  const s = getActivityStore();
  const now = Date.now();
  const existing = s.activities.get(id);
  const act: Activity = existing
    ? { ...existing, status, progress: existing.progress ?? 0, stage: stage ?? existing.stage }
    : {
        id,
        kind,
        label,
        args,
        status,
        progress: 0,
        stage: stage ?? "",
        startedAt: now,
        lastActivityAt: now,
        logs: [],
      };
  s.activities.set(id, act);
  emit(id, act);
  evictOldActivities();
  return act;
}

/** Update progress / stage / error. */
export function updateActivity(
  id: string,
  patch: {
    status?: Activity["status"];
    progress?: number;
    stage?: string;
    etaSec?: number | null;
    error?: string;
  },
): Activity | undefined {
  const s = getActivityStore();
  const act = s.activities.get(id);
  if (!act) return undefined;
  const now = Date.now();
  const next: Activity = { ...act, ...patch };
  if (patch.status || patch.progress !== undefined || patch.stage || patch.error) {
    next.lastActivityAt = now;
  }
  s.activities.set(id, next);
  emit(id, next);
  return next;
}

/** Append log lines. */
export function addActivityLog(id: string, ...lines: string[]): void {
  const s = getActivityStore();
  const act = s.activities.get(id);
  if (!act) return;
  const now = Date.now();
  const logs = [...(act.logs ?? []), ...lines].slice(-MAX_LOG_LINES);
  s.activities.set(id, { ...act, logs, lastActivityAt: now });
  emit(id, s.activities.get(id)!);
}

/** Finish successfully. */
export function finishActivity(id: string): void {
  const s = getActivityStore();
  const act = s.activities.get(id);
  if (!act) return;
  const next: Activity = { ...act, status: "done", progress: 100, endedAt: Date.now(), lastActivityAt: Date.now() };
  s.activities.set(id, next);
  emit(id, next);
  evictOldActivities();
}

/** Finish with an error. */
export function failActivity(id: string, error: string): void {
  const s = getActivityStore();
  const act = s.activities.get(id);
  if (!act) return;
  const next: Activity = { ...act, status: "failed", error, endedAt: Date.now(), lastActivityAt: Date.now() };
  s.activities.set(id, next);
  emit(id, next);
  evictOldActivities();
}

/** Cancel an item. */
export function cancelActivity(id: string): boolean {
  const s = getActivityStore();
  const act = s.activities.get(id);
  if (!act || (act.status !== "running" && act.status !== "queued")) return false;
  const next: Activity = { ...act, status: "cancelled", error: "Cancelled", endedAt: Date.now(), lastActivityAt: Date.now() };
  s.activities.set(id, next);
  emit(id, next);
  return true;
}

/** All activities, newest first. */
export function listActivities(): Activity[] {
  return [...getActivityStore().activities.values()].sort(
    (a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0),
  );
}

/** Get one activity. */
export function getActivity(id: string): Activity | undefined {
  return getActivityStore().activities.get(id);
}

/** Subscribe to changes on any activity (used by the Activity page SSE). */
export function subscribeActivity(cb: (id: string, act: Activity) => void): () => void {
  const s = getActivityStore();
  s.listeners.add(cb);
  return () => s.listeners.delete(cb);
}

/* --------------------------------------------------------------- */
/*  SSE clients per activity id — the Activity page opens one stream */
/* --------------------------------------------------------------- */

const sseClients = new Map<string, Set<import("http").ServerResponse>>();

export function subscribeActivitySSE(id: string, res: import("http").ServerResponse): void {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write("\n");
  const clients = sseClients.get(id) ?? new Set();
  clients.add(res);
  sseClients.set(id, clients);
  const act = getActivity(id);
  if (act) res.write(`data: ${JSON.stringify({ type: "activity", ...act })}\n\n`);
  res.on("close", () => { clients.delete(res); });
}

/* --------------------------------------------------------------- */
/*  Global server log ring buffer — captures everything the server logs */
/* --------------------------------------------------------------- */

function captureServerLog(): void {
  const origLog = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);
  serverLogOrig = { log: origLog, warn: origWarn, error: origError };
  const push = (level: "log" | "warn" | "error", ...args: unknown[]) => {
    const msg = args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(" ");
    const now = Date.now();
    const s = getActivityStore();
    s.serverLog.push({ t: now, level, msg });
    if (s.serverLog.length > MAX_SERVER_LOG) s.serverLog.shift();
    // Mirror to original console so nothing is lost.
    if (level === "error") origError(...args); else if (level === "warn") origWarn(...args); else origLog(...args);
  };
  console.log = ((...args) => push("log", ...args)) as typeof console.log;
  console.warn = ((...args) => push("warn", ...args)) as typeof console.warn;
  console.error = ((...args) => push("error", ...args)) as typeof console.error;
}

/** Restore original console methods (tests). */
export function restoreServerLog(): void {
  if (serverLogOrig) {
    console.log = serverLogOrig.log;
    console.warn = serverLogOrig.warn;
    console.error = serverLogOrig.error;
    serverLogOrig = null;
  }
}

/** The last N server log lines, newest first. */
export function serverLogLines(limit = 200): Array<{ t: number; level: "log" | "warn" | "error"; msg: string }> {
  return [...getActivityStore().serverLog].reverse().slice(0, limit);
}

/** How quiet a running item is, for the "is it stuck?" indicator. */
export function activityState(id: string): {
  status: Activity["status"] | "missing";
  progress: number;
  stage?: string;
  quietMs?: number;
  stale?: boolean;
  stuck?: boolean;
} {
  const act = getActivity(id);
  if (!act) return { status: "missing", progress: 0 };
  const now = Date.now();
  const quietMs = act.status === "running" || act.status === "queued" ? now - act.lastActivityAt : undefined;
  return {
    status: act.status,
    progress: act.progress,
    stage: act.stage,
    quietMs,
    stale: quietMs !== undefined && quietMs > STALE_MS,
    stuck: quietMs !== undefined && quietMs > STUCK_MS,
  };
}

// Watch a child process: stream its stdout/stderr into an activity's logs.
export function watchProcess(id: string, child: import("child_process").ChildProcess, prefix?: string): void {
  const tag = prefix ? `[${prefix}] ` : "";
  let pending = "";
  const flush = (text: string) => {
    pending += text;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) addActivityLog(id, `${tag}${line}`);
    }
  };
  child.stdout?.on("data", (buf) => flush(buf.toString()));
  child.stderr?.on("data", (buf) => flush(buf.toString()));
  child.on("close", () => {
    if (pending.trim()) addActivityLog(id, `${tag}${pending}`);
    pending = "";
  });
}
