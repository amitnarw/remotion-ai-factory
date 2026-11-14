/**
 * Activity page: what the factory is doing right now, everywhere it can take time.
 *
 *   ?tab=activity                 running + history + server log
 *   ?tab=activity&job=<id>        deep link to one activity's detail
 *
 * Running items show stage, progress, elapsed and how long it has been quiet
 * (amber = still working, red = possibly stuck). Finished items show duration
 * and any error. The server log tab captures provider checks, TTS installs,
 * voice samples, warnings and errors - anything the server logs.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  CheckCircle,
  Loader2,
  Logs,
  Play,
  RefreshCw,
  Square,
  Terminal,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import {
  cancelActivity,
  downloadActivityLog,
  getActivity,
  getServerLogs,
  listActivities,
  type ActivityItem,
  type ActivityList,
  type ServerLogLine,
} from "../../api";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { ProgressBar } from "../../components/shared";
import { LogConsole } from "../../components/LogConsole";
import { navigate, queryKey, setQuery } from "../../lib/navigation";
import { formatSeconds } from "../../lib/format";
import { cn } from "../../lib/utils";

const KIND_ICON: Record<string, ReactNode> = {
  plan: <Play className="h-4 w-4" />,
  render: <Play className="h-4 w-4" />,
  variants: <LayersIcon className="h-4 w-4" />,
  publish: <Download className="h-4 w-4" />,
  "tts-install": <Terminal className="h-4 w-4" />,
  "provider-test": <RefreshCw className="h-4 w-4" />,
  "provider-models": <RefreshCw className="h-4 w-4" />,
  "voice-sample": <Play className="h-4 w-4" />,
  "voice-audition": <Play className="h-4 w-4" />,
  "voice-preview-warm": <Play className="h-4 w-4" />,
  "voice-reference": <Play className="h-4 w-4" />,
  recast: <Play className="h-4 w-4" />,
  offers: <Play className="h-4 w-4" />,
  "voice-link": <Play className="h-4 w-4" />,
  "editor-measure": <Play className="h-4 w-4" />,
  other: <Play className="h-4 w-4" />,
};

function LayersIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}

const STALE_MS = 60 * 1000;
const STUCK_MS = 5 * 60 * 1000;

function quietLabel(ms?: number): { label: string; color: "default" | "destructive" } {
  if (ms === undefined) return { label: "", color: "default" };
  const s = Math.round(ms / 1000);
  if (ms > STUCK_MS) return { label: `quiet ${formatSeconds(s)} - possibly stuck`, color: "destructive" };
  if (ms > STALE_MS) return { label: `quiet ${formatSeconds(s)} - still working`, color: "default" };
  return { label: "", color: "default" };
}

function statusBadge(status: string) {
  const variant =
    status === "running" || status === "queued"
      ? "default"
      : status === "done"
        ? "secondary"
        : status === "failed"
          ? "destructive"
          : "muted";
  return (
    <Badge variant={variant} className="text-[11px] uppercase tracking-wider">
      {status}
    </Badge>
  );
}

function formatDuration(startedAt: number, endedAt?: number): string {
  const end = endedAt ?? Date.now();
  return formatSeconds(Math.max(0, Math.round((end - startedAt) / 1000)));
}

/* --------------------------------------------------------------- */
/*  One row in the running / history list                          */
/* --------------------------------------------------------------- */

interface ActivityRowProps {
  item: ActivityItem;
  onSelect: (id: string) => void;
  running?: boolean;
}

function ActivityRow({ item, onSelect, running }: ActivityRowProps) {
  const elapsed = running
    ? formatSeconds(Math.max(0, Math.round((Date.now() - item.startedAt) / 1000)))
    : formatDuration(item.startedAt, item.endedAt);
  const quiet = running ? quietLabel(Date.now() - item.lastActivityAt) : null;
  const kindIcon = KIND_ICON[item.kind] ?? KIND_ICON.other;

  return (
    <button
      key={item.id}
      type="button"
      onClick={() => onSelect(item.id)}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl bg-card p-3 text-left hover:bg-accent/50 transition-colors border border-transparent hover:border-accent/30",
        item.status === "failed" && "border-destructive/20",
      )}
    >
      <div className="flex items-center gap-2 shrink-0">
        {kindIcon}
        {running && <Loader2 className="h-3.5 w-3.5 animate-spin text-accent shrink-0" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold truncate">{item.label}</span>
          {statusBadge(item.status)}
        </div>
        {item.args ? (
          <div className="truncate text-xs text-muted-foreground">{item.args}</div>
        ) : null}
        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
          <span>{item.stage ?? "-"}</span>
          {running && item.progress ? `${item.progress}%` : ""}
          <span>{elapsed}</span>
          {quiet && <span>{quiet.label}</span>}
        </div>
        <ProgressBar value={Math.max(item.progress, running ? 4 : 0)} className="mt-2 h-1.5" />
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </button>
  );
}

/* --------------------------------------------------------------- */
/*  Activity detail view                                           */
/* --------------------------------------------------------------- */

interface ActivityDetailProps {
  id: string;
  onClose: () => void;
}

function ActivityDetail({ id, onClose }: ActivityDetailProps) {
  const [activity, setActivity] = useState<ActivityItem | null>(null);
  const [state, setState] = useState<{
    status: string;
    progress: number;
    quietMs?: number;
    stale?: boolean;
    stuck?: boolean;
  } | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [serverLogs, setServerLogs] = useState<ServerLogLine[]>([]);
  const [tab, setTab] = useState<"log" | "timeline" | "server">("log");
  const esRef = useRef<EventSource | null>(null);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { activity: a, state: s } = await getActivity(id);
        if (!alive) return;
        setActivity(a);
        setState(s);
        setLogs((a.logs ?? []).slice(-500));
      } catch {
        /* job may have been deleted */
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 3000);
    return () => {
      alive = false;
      window.clearInterval(timer);
      closeStream();
    };
  }, [id]);

  const closeStream = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
  }, []);

  useEffect(() => {
    if (!activity || (activity.status !== "running" && activity.status !== "queued")) {
      closeStream();
      return;
    }
    const es = new EventSource(`${window.location.origin}/api/activity/${id}/stream`);
    esRef.current = es;
    es.onmessage = (ev: MessageEvent) => {
      try {
        const d = JSON.parse(ev.data) as {
          type: string;
          text?: string;
          progress?: number;
          stage?: string;
          logs?: string[];
        };
        if (d.type === "activity") {
          setActivity(d as unknown as ActivityItem);
          setLogs(((d as unknown as ActivityItem).logs ?? []).slice(-500));
        } else if (d.type === "log" && d.text) {
          setLogs((l) => [...l.slice(-400), d.text].filter(Boolean) as string[]);
        }
      } catch {
        /* ignore malformed event */
      }
    };
    es.onerror = () => closeStream();
    return () => closeStream();
  }, [activity?.id, activity?.status, closeStream]);

  const cancel = async () => {
    setStopping(true);
    try {
      await cancelActivity(id);
      toast.success("Cancelled");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not cancel");
    } finally {
      setStopping(false);
    }
  };

  const handleDownload = async () => {
    try {
      const text = await downloadActivityLog(id);
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${id}.log`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not download log");
    }
  };

  const quiet = state ? quietLabel(state.quietMs) : null;
  const duration =
    activity && activity.endedAt ? formatDuration(activity.startedAt, activity.endedAt) : null;

  if (!activity) return <div className="h-full flex items-center justify-center">Loading…</div>;

  const reached = new Set((activity.timeline ?? []).map((t) => t.stage));
  const timelineEntries = [
    { key: "script", label: "Getting ready" },
    { key: "voice", label: "Timing the voices" },
    { key: "check", label: "Checking the story" },
    { key: "breakdown", label: "Listing what it needs" },
    { key: "match", label: "Checking the library" },
    { key: "shop", label: "Your shopping list" },
    { key: "director", label: "Directing the camera" },
    { key: "sound", label: "Designing the sound" },
    { key: "critic", label: "Reviewing the story" },
    { key: "assemble", label: "Putting it together" },
    { key: "bundle", label: "Building the world" },
    { key: "render", label: "Filming every frame" },
    { key: "encode", label: "Saving the video" },
    { key: "done", label: "Done" },
  ].filter((e) => reached.has(e.key) || e.key === activity.stage || e.key === "done");

  const tabClass = (active: boolean) => cn(
    "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors border border-transparent",
    active
      ? "bg-primary text-primary-foreground shadow-sm"
      : "text-muted-foreground hover:bg-secondary/50 hover:border-secondary/30",
  );

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowRight className="h-4 w-4" /> Back to activity
          </button>
          <h1 className="mt-1 text-xl font-semibold">{activity.label}</h1>
          {activity.args ? <p className="text-sm text-muted-foreground">{activity.args}</p> : null}
        </div>
        <div className="flex items-end gap-2">
          {activity.status === "running" || activity.status === "queued" ? (
            <>
              <Button variant="secondary" size="sm" onClick={cancel} disabled={stopping}>
                {stopping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />} Stop
              </Button>
              <Button variant="secondary" size="sm" onClick={handleDownload}>
                <Download className="h-3.5 w-3.5" /> Log
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" size="sm" onClick={handleDownload}>
                <Download className="h-3.5 w-3.5" /> Log
              </Button>
              {activity.status === "failed" && (
                <Button variant="secondary" size="sm" onClick={() => navigate({ tab: "create", step: "idea" })}>
                  <Play className="h-3.5 w-3.5" /> Start again
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="col-span-1 md:col-span-2">
          <div className="flex items-end justify-between gap-3 mb-2">
            <span className="text-4xl font-bold tabular-nums">{Math.max(activity.progress, 0)}</span>
            <span className="text-xl text-muted-foreground">%</span>
          </div>
          <ProgressBar value={Math.max(activity.progress, 4)} className="mt-2 h-3" />
          <div className="flex items-center gap-3 text-sm text-muted-foreground mt-2">
            <span>{activity.stage ?? "-"}</span>
            {state?.quietMs !== undefined && <span>{`${Math.round(state.quietMs / 1000)}s ago`}</span>}
            {quiet && <span className={quiet.color === "destructive" ? "text-destructive" : ""}>{quiet.label}</span>}
          </div>
        </div>
        <div className="col-span-1 md:col-span-1 space-y-3">
          <Card className="p-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</div>
            {statusBadge(activity.status)}
          </Card>
          {duration ? (
            <Card className="p-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Duration</div>
              <div className="text-sm font-semibold">{duration}</div>
            </Card>
          ) : null}
          {state?.stuck ? (
            <Card className="p-3 border-destructive/20 bg-destructive/5">
              <div className="text-xs font-semibold uppercase tracking-wider text-destructive">Stuck?</div>
              <div className="text-sm text-destructive">
                No output for {formatSeconds(Math.round(state!.quietMs! / 1000))}
              </div>
            </Card>
          ) : null}
          {state?.stale && !state?.stuck ? (
            <Card className="p-3 border-accent/20 bg-accent/5">
              <div className="text-xs font-semibold uppercase tracking-wider text-accent-foreground">
                Still working
              </div>
              <div className="text-sm text-accent-foreground">
                Waiting on the AI ({formatSeconds(Math.round(state!.quietMs! / 1000))}s quiet)
              </div>
            </Card>
          ) : null}
          {activity.error ? (
            <Card className="p-3 border-destructive/20 bg-destructive/5">
              <div className="text-xs font-semibold uppercase tracking-wider text-destructive">Error</div>
              <div className="text-sm text-destructive break-words">{activity.error}</div>
            </Card>
          ) : null}
        </div>
      </div>

      <div className="flex gap-1 mb-4">
        <button
          type="button"
          onClick={() => setTab("log")}
          className={tabClass(tab === "log")}
        >
          <Logs className="h-4 w-4" /> Live log
        </button>
        <button
          type="button"
          onClick={() => setTab("timeline")}
          className={tabClass(tab === "timeline")}
        >
          <Play className="h-4 w-4" /> Stages
        </button>
        <button
          type="button"
          onClick={() => setTab("server")}
          className={tabClass(tab === "server")}
        >
          <Terminal className="h-4 w-4" /> Server log
        </button>
      </div>

      {tab === "log" && (
        <div className="mt-2">
          <LogConsole logs={logs} title="activity log" maxLines={500} />
        </div>
      )}
      {tab === "timeline" && (
        <div className="mt-2 space-y-2">
          {timelineEntries.map((e, i) => {
            const done = i < timelineEntries.length - 1 && reached.has(e.key);
            const current = e.key === activity.stage;
            return (
              <div
                key={e.key}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5",
                  done ? "bg-success/10" : current ? "bg-accent/15" : "bg-input/30",
                )}
              >
                <span
                  className={cn(
                    "grid h-7 w-7 shrink-0 place-items-center rounded-full",
                    done ? "bg-success text-success-foreground" : current ? "bg-accent text-accent-foreground" : "bg-secondary text-muted-foreground",
                  )}
                >
                  {done ? (
                    <CheckCircle className="h-4 w-4" />
                  ) : current ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <span className="text-xs font-bold">{i + 1}</span>
                  )}
                </span>
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold">{e.label}</div>
                  {current && state?.quietMs !== undefined && (
                    <div className="text-xs text-muted-foreground">{Math.round(state!.quietMs / 1000)}s quiet</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {tab === "server" && (
        <div className="mt-2">
          <button
            type="button"
            onClick={async () => {
              try {
                const { logs } = await getServerLogs(200);
                setServerLogs(logs);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Could not load server log");
              }
            }}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-3"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh server log
          </button>
          <div className="max-h-[400px] overflow-y-auto bg-black/50 p-4 font-mono text-[11px] leading-relaxed">
            {serverLogs.map((l) => {
              const time = new Date(l.t).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              });
              return (
                <div key={`${l.t}-${l.msg}`} className="whitespace-pre-wrap break-words text-foreground/80">
                  <span className={cn("mr-2 font-bold", l.level === "error" ? "text-destructive" : l.level === "warn" ? "text-accent-foreground" : "text-muted-foreground")}>
                    [{time}] {l.level.toUpperCase()}
                  </span>
                  {l.msg}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

/* --------------------------------------------------------------- */
/*  Main page                                                      */
/* --------------------------------------------------------------- */

export default function Activity() {
  const [list, setList] = useState<ActivityList | null>(null);
  const [selected, setSelected] = useState<string | null>(queryKey("job") ?? null);
  const [refreshing, setRefreshing] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const l = await listActivities();
        setList(l);
      } catch {
        setList(null);
      }
    };
    void load();
    timerRef.current = window.setInterval(() => void load(), 4000);
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const l = await listActivities();
      setList(l);
    } catch {
      /* keep last state */
    } finally {
      setRefreshing(false);
    }
  };

  const running = list?.running ?? [];
  const finished = list?.finished ?? [];

  const openActivity = (id: string) => {
    setSelected(id);
    setQuery({ tab: "activity", job: id });
  };

  const closeActivity = () => {
    setSelected(null);
    setQuery({ tab: "activity" });
  };

  const empty = running.length === 0 && finished.length === 0 && !refreshing;

  if (selected) {
    return <ActivityDetail id={selected} onClose={closeActivity} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Activity</h1>
          <p className="text-muted-foreground">
            Everything the factory is doing right now - plans, renders, TTS
            installs, provider checks, voice samples - and what it just finished.
          </p>
        </div>
        <Button onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </Button>
      </div>

      {running.length > 0 ? (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Running ({running.length})
          </h2>
          <div className="space-y-2">
            {running.map((item) => (
              <ActivityRow key={item.id} item={item} onSelect={openActivity} running />
            ))}
          </div>
        </section>
      ) : (
        <section className="py-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle className="h-4 w-4 text-success" /> Nothing running
          </div>
        </section>
      )}

      {finished.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Recently finished
          </h2>
          <div className="space-y-2">
            {finished.slice(0, 20).map((item) => (
              <ActivityRow key={item.id} item={item} onSelect={openActivity} />
            ))}
          </div>
        </section>
      ) : null}

      {empty && !selected ? (
        <section className="py-12 text-center">
          <Logs className="h-10 w-10 mx-auto text-muted-foreground" />
          <h3 className="mt-4 text-lg font-semibold">No activity yet</h3>
          <p className="text-muted-foreground">
            Start a plan, render a video, or install a voice engine - it will show up here.
          </p>
        </section>
      ) : null}
    </div>
  );
}
