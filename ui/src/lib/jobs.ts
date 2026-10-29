/**
 * lib/jobs.ts, what the server is working on, for the status area.
 *
 * One poller (started by App) reads /api/jobs every few seconds, and the
 * details of running jobs (kind, progress, stage). Screens read it through
 * useJobs(). When a job this tab saw running finishes, a toast says so with
 * a button to open it (not when that job is already on screen).
 */
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { getJob, listJobs, type Job } from "../api";
import { navigate, queryKey } from "./navigation";

export interface ActiveJob {
  id: string;
  status: Job["status"];
  premise: string;
  /** "plan" while the AI writes; anything else is a render. */
  kind: "plan" | "render";
  progress: number;
  stage?: string;
  etaSec?: number | null;
  specId?: string;
}

interface JobsState {
  loaded: boolean;
  active: ActiveJob[];
  /** Bumps whenever a job finishes, so lists (the library) can reload. */
  finished: number;
}

let state: JobsState = { loaded: false, active: [], finished: 0 };
const listeners = new Set<() => void>();
const seenRunning = new Map<string, ActiveJob>();
let timer: number | null = null;

function emit(next: JobsState) {
  state = next;
  listeners.forEach((l) => l());
}

/** Where a job is shown in the wizard. */
export function jobScreen(job: Pick<ActiveJob, "id" | "kind">): Record<string, string> {
  return job.kind === "plan"
    ? { tab: "create", step: "writing", plan: job.id }
    : { tab: "create", step: "rendering", job: job.id };
}

function onScreen(id: string): boolean {
  return queryKey("tab") === "create" && (queryKey("plan") === id || queryKey("job") === id);
}

async function poll() {
  let list;
  try {
    list = await listJobs();
  } catch {
    return; // server restarting: keep the last state
  }
  const running = list.filter((j) => j.status === "running" || j.status === "queued");
  const details = await Promise.all(
    running.map(async (j): Promise<ActiveJob> => {
      try {
        const full = await getJob(j.id);
        return {
          id: j.id,
          status: full.status,
          premise: full.premise,
          kind: full.engine === "plan" ? "plan" : "render",
          progress: full.progress ?? 0,
          stage: full.stage,
          etaSec: full.etaSec,
          specId: full.specId,
        };
      } catch {
        return { id: j.id, status: j.status, premise: j.premise, kind: "render", progress: 0 };
      }
    }),
  );

  let finished = state.finished;
  for (const j of list) {
    const before = seenRunning.get(j.id);
    if (!before || j.status === "running" || j.status === "queued") continue;
    seenRunning.delete(j.id);
    finished += 1;
    if (onScreen(j.id)) continue;
    if (j.status === "done") {
      const isPlan = before.kind === "plan";
      toast.success(isPlan ? "Your plan is ready" : "Your video is ready", {
        description: j.premise,
        action: {
          label: isPlan ? "Review it" : "Watch it",
          onClick: () =>
            navigate(isPlan ? { tab: "create", step: "review", plan: j.id } : { tab: "create", step: "done", job: j.id }),
        },
      });
    } else if (j.status === "failed") {
      toast.error(before.kind === "plan" ? "The plan could not be written" : "The video could not be made", {
        description: j.premise,
        action: { label: "See why", onClick: () => navigate(jobScreen(before)) },
      });
    }
  }
  for (const d of details) seenRunning.set(d.id, d);
  emit({ loaded: true, active: details, finished });
}

/** Start polling (once, from App). Returns a stop function. */
export function startJobsPolling(intervalMs = 5000): () => void {
  if (timer !== null) return () => {};
  void poll();
  timer = window.setInterval(() => void poll(), intervalMs);
  return () => {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
  };
}

/** Ask for a fresh read now (after starting a job, for instance). */
export function refreshJobs(): void {
  void poll();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useJobs(): JobsState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
