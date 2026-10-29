/**
 * Video step: the approved plan is being made (rendering), then watched
 * (done).
 *
 *   ?tab=create&step=rendering&job=<jobId>
 *   ?tab=create&step=done&job=<jobId>
 *
 * Live progress comes over server-sent events, with polling as a fallback
 * when the stream drops. Rendering moves on to done by itself.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  CircleCheck,
  Download,
  Film,
  Library,
  Loader2,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Square,
  Terminal,
  X,
} from "lucide-react";
import { cancelJob, getJob, renderSpec, type Job } from "../../api";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../../components/ui/alert-dialog";
import { EmptyState, ErrorBanner, LoadingState, ProgressBar } from "../../components/shared";
import { InfoTip } from "../../components/InfoTip";
import { formatSeconds } from "../../lib/format";
import { navigate } from "../../lib/navigation";
import { refreshJobs } from "../../lib/jobs";
import { cn } from "../../lib/utils";

// A dashboard page (not a Remotion composition): native media elements are right here.
/* eslint-disable @remotion/warn-native-media-tag */

const RENDER_STAGES: Array<{ key: string; label: string }> = [
  { key: "script", label: "Getting ready" },
  { key: "voice", label: "Voices" },
  { key: "bundle", label: "Building the world" },
  { key: "render", label: "Filming every frame" },
  { key: "encode", label: "Saving the video" },
];
/** Older engines report a music stage first; it counts as getting ready. */
const STAGE_ALIAS: Record<string, string> = { music: "script" };

/** "stopped": you pressed Stop (the server keeps it as cancelled). */
type Status = "loading" | "running" | "done" | "failed" | "stopped" | "missing";

export function RunStep({ jobId, step, onMakeAnother }: { jobId: string; step: "rendering" | "done"; onMakeAnother: () => void }) {
  const [job, setJob] = useState<Job | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [stage, setStage] = useState("script");
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [etaSec, setEta] = useState<number | null>(null);
  const pollRef = useRef<number | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) window.clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);
  const closeStream = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
  }, []);

  const adopt = useCallback((fresh: Job) => {
    setJob(fresh);
    setProgress(fresh.progress);
    if (fresh.stage) setStage(fresh.stage);
    if (fresh.etaSec !== undefined) setEta(fresh.etaSec ?? null);
    setLogs(fresh.logs.slice(-2000));
    const st: Status =
      fresh.status === "done" || fresh.status === "failed"
        ? fresh.status
        : fresh.status === "cancelled"
          ? "stopped"
          : "running";
    setStatus(st);
    return st;
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = window.setInterval(async () => {
      try {
        const st = adopt(await getJob(jobId));
        if (st !== "running") stopPolling();
      } catch {
        stopPolling();
        setStatus("missing");
      }
    }, 2000);
  }, [adopt, jobId, stopPolling]);

  useEffect(() => {
    setJob(null);
    setStatus("loading");
    setLogs([]);
    setProgress(0);
    setEta(null);
    closeStream();
    stopPolling();

    const es = new EventSource(`${window.location.origin}/api/jobs/${jobId}/events`);
    esRef.current = es;
    es.onmessage = (ev: MessageEvent) => {
      try {
        const d = JSON.parse(ev.data) as { type: string; text?: string; progress?: number; stage?: string; etaSec?: number | null };
        if (d.type === "log") setLogs((l) => [...l.slice(-300), d.text ?? ""]);
        else if (d.type === "progress") {
          setProgress(d.progress ?? 0);
          if (d.stage) setStage(d.stage);
          setEta(d.etaSec ?? null);
          setStatus((s) => (s === "loading" ? "running" : s));
        } else if (d.type === "done" || d.type === "failed") {
          closeStream();
          stopPolling();
          getJob(jobId)
            .then(adopt)
            .catch(() => setStatus(d.type === "done" ? "done" : "failed"));
          refreshJobs();
        }
      } catch {
        /* ignore a malformed event */
      }
    };
    es.onerror = () => {
      // The stream dropped (or the job is unknown): keep the screen alive by polling.
      closeStream();
      startPolling();
    };
    // Full sync: the job may have finished before we attached.
    getJob(jobId)
      .then((fresh) => {
        const st = adopt(fresh);
        if (st !== "running") {
          closeStream();
          stopPolling();
        }
      })
      .catch(() => {
        closeStream();
        stopPolling();
        setStatus("missing");
      });
    return () => {
      closeStream();
      stopPolling();
    };
  }, [jobId, adopt, closeStream, stopPolling, startPolling]);

  /* Keep the URL step in line with the job: rendering <-> done. */
  useEffect(() => {
    if (status === "done" && step === "rendering") navigate({ tab: "create", step: "done", job: jobId }, { replace: true });
    if (status === "running" && step === "done") navigate({ tab: "create", step: "rendering", job: jobId }, { replace: true });
  }, [status, step, jobId]);

  if (status === "loading") return <LoadingState title="Checking on your video..." />;

  if (status === "missing") {
    return (
      <EmptyState
        icon={<Film />}
        title="This video job is no longer here"
        body="The app may have restarted since it ran. Finished videos are always in the library."
        action={
          <>
            <Button variant="secondary" onClick={() => navigate({ tab: "library" })}>
              <Library className="h-4 w-4" /> Open the library
            </Button>
            <Button variant="amber" onClick={onMakeAnother}>
              <Plus className="h-4 w-4" /> Make a video
            </Button>
          </>
        }
      />
    );
  }

  if (status === "done" && job?.output?.mp4) {
    return <DoneView job={job} onMakeAnother={onMakeAnother} />;
  }

  return (
    <RenderingView
      job={job}
      failed={status === "failed" || status === "stopped"}
      stopped={status === "stopped"}
      stage={stage}
      progress={progress}
      etaSec={etaSec}
      logs={logs}
      onMakeAnother={onMakeAnother}
      onStopped={async () => {
        try {
          adopt(await getJob(jobId));
        } catch {
          setStatus("missing");
        }
      }}
    />
  );
}

function RenderingView({
  job,
  failed,
  stopped,
  stage,
  progress,
  etaSec,
  logs,
  onMakeAnother,
  onStopped,
}: {
  job: Job | null;
  /** The job ended without a video (failed or stopped). */
  failed: boolean;
  stopped: boolean;
  stage: string;
  progress: number;
  etaSec: number | null;
  logs: string[];
  onMakeAnother: () => void;
  onStopped: () => void;
}) {
  const [stopping, setStopping] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const reached = new Set((job?.timeline ?? []).map((t) => STAGE_ALIAS[t.stage] ?? t.stage));
  reached.add(STAGE_ALIAS[stage] ?? stage);
  const currentIndex = Math.max(
    0,
    ...RENDER_STAGES.map((s, i) => (reached.has(s.key) ? i : -1)),
  );
  const currentLabel = RENDER_STAGES[currentIndex]?.label ?? "Working";
  const pct = Math.max(0, Math.min(100, Math.round(progress)));

  const stop = async () => {
    if (!job) return;
    setStopping(true);
    try {
      await cancelJob(job.id);
    } catch {
      /* it may have just finished */
    }
    refreshJobs();
    onStopped();
    setStopping(false);
  };

  const retry = async () => {
    if (!job?.specId) return;
    setRetrying(true);
    setRetryError(null);
    try {
      const { jobId } = await renderSpec(job.specId);
      refreshJobs();
      navigate({ tab: "create", step: "rendering", job: jobId });
    } catch (e) {
      setRetryError(e instanceof Error ? e.message : String(e));
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="space-y-4">
      {failed && !stopped ? (
        <ErrorBanner
          error={job?.error ?? "Something went wrong while making the video."}
          fix="Try again. If it keeps failing, the technical log below says which step broke."
        />
      ) : null}
      {retryError ? <ErrorBanner error={retryError} /> : null}

      <Card className="p-5 sm:p-8" aria-live="polite">
        <div className="flex items-start gap-4">
          <span
            className={cn(
              "grid h-12 w-12 shrink-0 place-items-center rounded-2xl",
              stopped ? "bg-input text-muted-foreground" : failed ? "bg-destructive/20 text-destructive" : "bg-primary/20 text-primary",
            )}
          >
            {stopped ? <Square className="h-6 w-6" /> : failed ? <Film className="h-6 w-6" /> : <Loader2 className="h-6 w-6 animate-spin" />}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold tracking-tight">{stopped ? "You stopped this video" : failed ? "The video was not made" : "Making your video"}</h1>
            {job?.premise ? <p className="mt-1 break-words text-[15px] text-muted-foreground">{job.premise}</p> : null}
          </div>
          <InfoTip helpId="job-stages" />
        </div>

        <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
          <div className={cn("text-5xl font-bold tabular-nums", failed && !stopped && "text-destructive", stopped && "text-muted-foreground")}>
            {pct}
            <span className="text-2xl text-muted-foreground">%</span>
          </div>
          {!failed ? (
            <div className="text-right text-sm">
              <div className="font-semibold">{currentLabel}</div>
              {etaSec != null && etaSec > 0 ? (
                <div className="text-muted-foreground">About {formatSeconds(etaSec)} left</div>
              ) : (
                <div className="text-muted-foreground">Working out how long it takes</div>
              )}
            </div>
          ) : null}
        </div>
        <ProgressBar value={Math.max(pct, 3)} tone={failed && !stopped ? "destructive" : "primary"} className="mt-3 h-3" />

        <ol className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-5">
          {RENDER_STAGES.map((s, i) => {
            const state =
              i < currentIndex
                ? "done"
                : i === currentIndex && stopped
                  ? "pending"
                  : failed && i === currentIndex
                    ? "failed"
                    : i === currentIndex
                      ? "current"
                      : "pending";
            return (
              <li
                key={s.key}
                className={cn(
                  "flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold sm:flex-col sm:items-start sm:gap-1.5",
                  state === "done" && "bg-success/15 text-foreground",
                  state === "current" && "bg-accent/15 text-foreground",
                  state === "failed" && "bg-destructive/20 text-foreground",
                  state === "pending" && "bg-input/40 text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs",
                    state === "done" && "bg-success text-success-foreground",
                    state === "current" && "bg-accent text-accent-foreground",
                    state === "failed" && "bg-destructive text-destructive-foreground",
                    state === "pending" && "bg-secondary",
                  )}
                >
                  {state === "done" ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : state === "failed" ? (
                    <X className="h-3.5 w-3.5" />
                  ) : state === "current" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    i + 1
                  )}
                </span>
                {s.label}
              </li>
            );
          })}
        </ol>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          {failed ? (
            <>
              <Button variant="secondary" onClick={onMakeAnother}>
                <Plus className="h-4 w-4" /> Start over
              </Button>
              {job?.specId ? (
                <Button
                  variant="secondary"
                  onClick={() => navigate({ tab: "editor", film: job.specId, from: "done", job: job.id })}
                >
                  <SlidersHorizontal className="h-4 w-4" /> Open in editor
                </Button>
              ) : null}
              {job?.specId ? (
                <Button variant="amber" className="sm:ml-auto" onClick={retry} disabled={retrying}>
                  <RefreshCw className={cn("h-4 w-4", retrying && "animate-spin")} /> {stopped ? "Make it again" : "Try again"}
                </Button>
              ) : null}
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                You can leave this screen. A message appears when the video is ready.
              </p>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="secondary" className="shrink-0 sm:ml-auto" disabled={!job || stopping}>
                    <Square className="h-4 w-4" /> Stop
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Stop making this video?</AlertDialogTitle>
                    <AlertDialogDescription>
                      What was made so far is thrown away. The plan is kept, so you can make the video again later.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep going</AlertDialogCancel>
                    <AlertDialogAction onClick={stop}>Stop</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
      </Card>

      <LogConsole logs={logs} />
    </div>
  );
}

function DoneView({ job, onMakeAnother }: { job: Job; onMakeAnother: () => void }) {
  const src = `/media/${job.output!.mp4}`;
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4 rounded-2xl bg-success/15 p-5">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-success text-success-foreground">
          <CircleCheck className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Your video is ready</h1>
          <p className="break-words text-[15px] text-muted-foreground">{job.premise}</p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="grid place-items-center overflow-hidden rounded-2xl bg-black shadow-2xl shadow-black/40">
          <video controls playsInline className="max-h-[70dvh] w-full" src={src} />
        </div>
        <div className="flex flex-col gap-3">
          <Button variant="amber" size="lg" asChild>
            <a href={src} download>
              <Download className="h-5 w-5" /> Download
            </a>
          </Button>
          {job.specId ? (
            <Button
              variant="secondary"
              onClick={() => navigate({ tab: "editor", film: job.specId, from: "done", job: job.id })}
            >
              <SlidersHorizontal className="h-4 w-4" /> Open in editor
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => navigate({ tab: "library", video: job.specId })}>
            <Library className="h-4 w-4" /> See it in the library
          </Button>
          <Button variant="secondary" onClick={onMakeAnother}>
            <Plus className="h-4 w-4" /> Make another
          </Button>
          <p className="mt-1 text-sm text-muted-foreground">
            The video is saved on this computer. Open it in the editor to change a line, a shot or a sound and make it again.
          </p>
        </div>
      </div>
    </div>
  );
}

/** The technical log, folded away unless you want it. */
function LogConsole({ logs }: { logs: string[] }) {
  const [open, setOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lines = logs.join("").split(/\r?\n/).filter((l) => l.trim()).slice(-200);
  useEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [open, lines.length]);
  if (!lines.length) return null;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="overflow-hidden">
        <CollapsibleTrigger className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <Terminal className="h-4 w-4 text-muted-foreground" />
          <span className="flex-1">{open ? "Hide the technical log" : "Show the technical log"}</span>
          <span className="text-xs font-medium text-muted-foreground">{lines.length} {lines.length === 1 ? "line" : "lines"}</span>
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div ref={scrollRef} className="max-h-72 overflow-y-auto bg-black/50 p-4 font-mono text-[11px] leading-relaxed">
            {lines.map((l, i) => (
              <div key={i} className="whitespace-pre-wrap break-words text-foreground/80">
                {l}
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
