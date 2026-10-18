/**
 * Generate — the primary dashboard flow (all state in the URL).
 *
 *   ?tab=generate&engine=story&story=<slug>&job=<id>
 *   ?tab=generate&engine=template&job=<id>
 *
 * Story engine (primary): pick a story → sound-design step (per-role variant
 * audition/choice, "Auto (best)" default) → render (stages + live log) →
 * download. The legacy AI-spec template pipeline ships collapsed under
 * Advanced.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles,
  Clapperboard,
  Download,
  Music4,
  AudioLines,
  ChevronRight,
  CircleCheck,
  Settings2,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import {
  getProviders,
  getStories,
  generateVideo,
  generateStory,
  getJob,
  getSoundDesign,
  saveSoundMap,
  Job,
  ProviderInfo,
  SoundDesignResponse,
  StoryInfo,
} from "../api";
import { PlayerPreview } from "../preview/PlayerPreview";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Textarea } from "../components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../components/ui/collapsible";
import { PageHeader, ErrorBanner, MetaRow, SoundPlayer } from "../components/shared";
import { InfoTip } from "../components/InfoTip";
import { useQuery, setQuery } from "../lib/navigation";
import { cn } from "../lib/utils";

export default function Generate() {
  const query = useQuery();
  const engine = query.get("engine") === "template" ? "template" : "story";
  const storyParam = query.get("story") ?? undefined;
  const jobParam = query.get("job") ?? undefined;

  /* ---------------- load-once data ---------------- */
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [stories, setStories] = useState<StoryInfo[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    getProviders()
      .then((d) => setProviders(d.providers || []))
      .catch(() => {});
    getStories()
      .then((s) => setStories(s))
      .catch((e) => setLoadError(String(e)));
  }, []);

  /* ---------------- story selection ---------------- */
  const story = useMemo(
    () => stories.find((s) => s.slug === storyParam) ?? stories[0],
    [stories, storyParam],
  );
  useEffect(() => {
    if (stories.length && story?.slug && story.slug !== storyParam) {
      setQuery({ story: story.slug });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?.slug, stories.length]);

  /* ---------------- sound design (per story) ---------------- */
  const [design, setDesign] = useState<SoundDesignResponse | null>(null);
  useEffect(() => {
    if (!story) return;
    setDesign(null);
    getSoundDesign(story.slug)
      .then((d) => setDesign(d.available ? d : null))
      .catch(() => setDesign(null));
  }, [story?.slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const choices = design?.selection ?? {};
  const setChoice = (role: string, variant: string) => {
    const next = { ...choices, [role]: variant };
    setDesign((d) => (d ? { ...d, selection: next } : d));
    saveSoundMap(design?.slug ?? story!.slug, next)
      .then(() => toast.success("Sound design saved", { description: `${role} → ${variant}` }))
      .catch((e) => toast.error("Could not save sound design", { description: String(e) }));
  };

  /* ---------------- job runner (SSE + polling fallback) ---------------- */
  const [job, setJob] = useState<Job | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<string>("music");
  const [etaSec, setEta] = useState<number | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const pollRef = useRef<{ id: string; timer: number } | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) window.clearInterval(pollRef.current.timer);
    pollRef.current = null;
  }, []);

  /** Attach SSE for a job; restores the whole state when the job already ended. */
  const openSSE = useCallback(
    (jobId: string) => {
      stopPolling();
      const es = new EventSource(`${window.location.origin}/api/jobs/${jobId}/events`);
      es.onmessage = (ev: MessageEvent) => {
        try {
          const d = JSON.parse(ev.data) as {
            type: string;
            text?: string;
            progress?: number;
            stage?: string;
            etaSec?: number | null;
            status?: string;
            error?: string;
          };
          if (d.type === "log") setLogs((l) => [...l.slice(-400), d.text ?? ""]);
          else if (d.type === "progress") {
            setProgress(d.progress ?? 0);
            if (d.stage) setStage(d.stage);
            setEta(d.etaSec ?? null);
          } else if (d.type === "done") {
            setStatus("done");
            setStage("done");
            setProgress(100);
            es.close();
            getJob(jobId).then(setJob).catch(() => {});
          } else if (d.type === "failed") {
            setStatus("failed");
            setStage("failed");
            es.close();
            getJob(jobId).then(setJob).catch(() => {});
          } else if (d.type === "status") {
            const s = d.status as "idle" | "running" | "done" | "failed";
            setStatus((cur) => (s === "idle" ? cur : s));
          }
        } catch {
          /* ignore */
        }
      };
      es.onerror = () => {
        es.close();
        // Polling fallback keeps the UI alive if the stream drops.
        const timer = window.setInterval(async () => {
          try {
            const fresh = await getJob(jobId);
            setJob(fresh);
            setProgress(fresh.progress);
            if (fresh.stage) setStage(fresh.stage);
            setEta(fresh.etaSec ?? null);
            setLogs(fresh.logs.slice(-400));
            if (fresh.status === "done" || fresh.status === "failed") {
              setStatus(fresh.status);
              stopPolling();
            }
          } catch {
            stopPolling();
            setGenError(
              "Lost track of the job — the API server likely restarted. Start the render again.",
            );
            setStatus("idle");
          }
        }, 2500);
        stopPolling();
        pollRef.current = { id: jobId, timer };
      };
      // Restore full state once (job may have finished before we attached).
      getJob(jobId)
        .then((fresh) => {
          setJob(fresh);
          setProgress(fresh.progress);
          if (fresh.stage) setStage(fresh.stage);
          setEta(fresh.etaSec ?? null);
          setLogs(fresh.logs.slice(-400));
          if (fresh.status === "done" || fresh.status === "failed") {
            setStatus(fresh.status);
            es.close();
            stopPolling();
          } else {
            setStatus("running");
          }
        })
        .catch(() => {
          /* SSE still drives */
        });
    },
    [stopPolling],
  );

  /** ?job=<id> deep link — resume an existing render on refresh. */
  useEffect(() => {
    if (jobParam) {
      setStage(jobParam.includes("-t") ? "script" : "music");
      openSSE(jobParam);
    }
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobParam]);

  /* ---------------- generate ---------------- */
  const handleGenerate = async () => {
    if (status === "running") return;
    setGenError(null);
    const target =
      engine === "story"
        ? generateStory(story!.slug, choices)
        : generateVideo(premise.trim(), provider ?? undefined, model ?? undefined);
    try {
      const { jobId } = await target;
      setLogs([]);
      setProgress(0);
      setStatus("running");
      setStage(engine === "story" ? "music" : "script");
      setEta(null);
      setQuery({ job: jobId });
      setJob({
        id: jobId,
        status: "queued",
        progress: 0,
        stage: engine === "story" ? "music" : "script",
        premise: engine === "story" ? story!.title : premise,
        engine,
        createdAt: Date.now(),
        logs: [],
      });
      openSSE(jobId);
      toast.success("Render queued", { description: engine === "story" ? story!.title : premise });
    } catch (e) {
      setGenError(String(e));
      toast.error("Could not start the render");
    }
  };

  /* ---------------- template (advanced) ---------------- */
  const [premise, setPremise] = useState("");
  const [provider, setProvider] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const allProviders: Array<{ name: string; keyConfigured: boolean; models: string[] }> = useMemo(
    () => [
      { name: "offline", keyConfigured: true, models: ["templates"] },
      ...providers.map((p) => ({ name: p.name, keyConfigured: p.keyConfigured, models: p.models ?? [] })),
    ],
    [providers],
  );
  useEffect(() => {
    if (provider && !allProviders.some((p) => p.name === provider)) setProvider(null);
  }, [allProviders, provider]);
  const provInfo = provider ? allProviders.find((p) => p.name === provider) : undefined;
  const keyMissing = engine === "template" && provider !== "offline" && provider != null && !provInfo?.keyConfigured;

  const running = status === "running";

  return (
    <div className="space-y-6">
      <PageHeader title="Generate" hintId={engine === "story" ? "story-engine" : "advanced-template"}>
        <Badge variant={engine === "story" ? "amber" : "outline"}>
          {engine === "story" ? "Story engine" : "AI spec"}
        </Badge>
      </PageHeader>

      {loadError ? (
        <ErrorBanner
          error={`Story list unavailable — the API server is not reachable: ${loadError}`}
          fix='Start it with "npm run server" (dashboard at http://127.0.0.1:5178), then reload this page'
        />
      ) : null}

      {/* ---------- 1 · Pick the video ---------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-primary/20 text-xs font-bold text-primary">1</span>
            Pick the video
            <InfoTip helpId={engine === "story" ? "story-engine" : "advanced-template"} />
          </CardTitle>
          <CardDescription>
            {engine === "story"
              ? "Agent-authored compositions — bespoke beats, scenes and a verified audio mix."
              : "Describe a premise; the AI-spec pipeline writes and animates it."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {stories.length === 0 && !loadError ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No story videos registered yet — authored videos appear in <code>src/whatif/videos/</code>.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {stories.map((s) => (
                <button
                  key={s.slug}
                  onClick={() => !running && setQuery({ engine: "story", story: s.slug, job: undefined })}
                  disabled={running}
                  className={cn(
                    "group rounded-xl border p-4 text-left transition-all disabled:opacity-60",
                    story?.slug === s.slug
                      ? "border-primary/60 bg-primary/10 shadow-[0_0_0_1px_var(--primary)]"
                      : "border-border bg-card/50 hover:border-muted-foreground/40 hover:bg-card",
                  )}
                >
                  <div className="mb-1.5 flex items-start justify-between gap-2">
                    <Clapperboard
                      className={cn(
                        "h-5 w-5 shrink-0",
                        story?.slug === s.slug ? "text-primary" : "text-muted-foreground",
                      )}
                    />
                    <Badge variant="secondary" className="text-[10px]">
                      {Math.round(s.durationSec)}s · {s.fps}fps
                    </Badge>
                  </div>
                  <div className="text-sm font-medium leading-snug">{s.title}</div>
                  <MetaRow
                    items={[
                      { label: "soundroles", value: s.sfxRoles?.length ?? 0 },
                      { label: "engine", value: "agent-authored" },
                    ]}
                  />
                </button>
              ))}
            </div>
          )}

          {/* -------- Advanced: AI spec (template) pipeline -------- */}
          <Collapsible
            open={engine === "template"}
            onOpenChange={(o) => setQuery({ engine: o ? "template" : "story", job: running ? job?.id : undefined })}
          >
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="w-fit -mx-1 gap-1 text-muted-foreground"
                disabled={running ? false : false}
              >
                <Settings2 className="h-4 w-4" />
                Advanced — AI spec pipeline
                <ChevronRight
                  className={cn("h-4 w-4 transition-transform", engine === "template" && "rotate-90")}
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3">
              <div className="space-y-3 rounded-lg border border-border/60 bg-card/40 p-4">
                <p className="text-xs text-muted-foreground">
                  Legacy path: an LLM writes a shot spec from your premise, the template composition
                  renders it. The story engine above is the primary, verified path.
                </p>
                <Textarea
                  placeholder="What if gravity disappeared for just 5 seconds?"
                  value={premise}
                  onChange={(e) => setPremise(e.target.value)}
                  disabled={running}
                  className="min-h-[64px]"
                />
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                  <select
                    className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
                    value={provider ?? ""}
                    onChange={(e) => {
                      setProvider(e.target.value || null);
                      setModel(null);
                    }}
                    disabled={running}
                  >
                    <option value="">Provider</option>
                    {allProviders.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name} {p.keyConfigured ? "✓" : "○"}
                      </option>
                    ))}
                  </select>
                  <select
                    className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm disabled:opacity-50"
                    value={model ?? ""}
                    onChange={(e) => setModel(e.target.value || null)}
                    disabled={running || !provInfo?.models.length}
                  >
                    <option value="">Model</option>
                    {(provInfo?.models ?? []).map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <Button
                    onClick={handleGenerate}
                    disabled={running || !premise.trim() || (!provider && false) || keyMissing}
                    className="w-fit"
                  >
                    <Wand2 className="h-4 w-4" />
                    {running ? "Rendering…" : "Generate (template)"}
                  </Button>
                </div>
                {keyMissing && provider ? (
                  <p className="text-xs text-destructive">
                    No key saved for {provider} — open the Providers tab, paste the key and click Save,
                    OR pick “offline / templates”.
                  </p>
                ) : null}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      {/* ---------- 2 · Sound design ---------- */}
      {engine === "story" && story ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-primary/20 text-xs font-bold text-primary">2</span>
              Sound design
              <InfoTip helpId="sound-design" />
            </CardTitle>
            <CardDescription>
              {design
                ? "Audition each role's variants and pick per role — or leave Auto (best). Choices persist for every future render of this story."
                : design === null
                  ? "Sound library not available — the synth default mix will be used."
                  : "Loading sound catalog…"}
            </CardDescription>
          </CardHeader>
          {design ? (
            <CardContent className="space-y-5">
              {design.roles.map((role) => (
                <div key={role.id} className="rounded-lg border border-border/70 bg-card/40 p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    {role.family === "ambient" ? (
                      <AudioLines className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Music4 className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="text-sm font-semibold">{role.label}</span>
                    <code className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {role.id}
                    </code>
                  </div>
                  <p className="mb-3 text-xs text-muted-foreground">{role.description}</p>
                  <div className="flex flex-wrap gap-2">
                    <VariantChip
                      active={(choices[role.id] ?? "auto") === "auto"}
                      label="Auto (best)"
                      meta="picks the strongest variant"
                      onClick={() => setChoice(role.id, "auto")}
                    />
                    {role.variants.map((v) => (
                      <VariantChip
                        key={v.id}
                        url={v.url}
                        active={choices[role.id] === v.id}
                        label={
                          v.id === "synth"
                            ? "Synth"
                            : `Kenney · ${v.file.split("--")[1]?.replace(/\.wav$/, "") ?? v.id}`
                        }
                        meta={`${v.dur}s · ${v.source}`}
                        onClick={() => setChoice(role.id, v.id)}
                      />
                    ))}
                  </div>
                </div>
              ))}
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <InfoTip helpId="auto-best" />
                Auto keeps the strongest variant per role — usually a real CC0 recording.
              </p>
            </CardContent>
          ) : null}
        </Card>
      ) : null}

      {/* ---------- 3 · Render ---------- */}
      {engine === "story" && story ? (
        <Card className="border-primary/30 bg-gradient-to-b from-primary/[0.07] to-transparent">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-primary/20 text-xs font-bold text-primary">3</span>
              Render
            </CardTitle>
            <CardDescription>
              Music bed → bundle → render → encode → automatic audio verification. About 25s for a
              15s video.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button size="lg" className="w-full sm:w-auto" onClick={handleGenerate} disabled={running}>
              <Sparkles className="h-4 w-4" />
              {running ? "Rendering…" : `Generate “${story.title}”`}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {genError ? (
        <ErrorBanner error={genError} fix='If the API server was restarted, simply press Generate again' />
      ) : null}

      {/* ---------- Job panel ---------- */}
      {status !== "idle" && job ? (
        <JobPanel job={job} status={status} logs={logs} progress={progress} stage={stage} etaSec={etaSec} />
      ) : null}

      {/* ---------- Result ---------- */}
      {status === "done" && job ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CircleCheck className="h-5 w-5 text-emerald-400" />
              Result
            </CardTitle>
            <CardDescription>{job.premise}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {job.output?.mp4 ? (
              <>
                <video
                  /* eslint-disable-next-line @remotion/warn-native-media-tag -- dashboard, not a composition */
                  controls
                  className="mx-auto max-h-[70dvh] rounded-xl border border-border bg-black"
                  src={`/media/${job.output.mp4}`}
                />
                <div className="flex flex-wrap items-center gap-3">
                  <Button asChild>
                    <a href={`/media/${job.output.mp4}`} target="_blank" rel="noreferrer">
                      <Download className="h-4 w-4" />
                      Download MP4
                    </a>
                  </Button>
                  <code className="text-xs text-muted-foreground">{job.output.mp4}</code>
                </div>
                <p className="text-xs text-muted-foreground">
                  {engine === "story" || job.engine === "story"
                    ? "Bespoke composition: every second of audio was verified (no silent/clip seconds; events land on their beats)."
                    : "Same composition previewed from the spec."}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Render finished but no output file was registered for this job.
              </p>
            )}
            {!(engine === "story" || job.engine === "story") ? (
              <div className="overflow-hidden rounded-xl border border-border">
                <PlayerPreview spec={job.output?.spec || {}} />
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

/* ==================================================================== */
/*  Sound-design variant chip                                           */
/* ==================================================================== */
function VariantChip({
  active,
  label,
  meta,
  onClick,
  url,
}: {
  active: boolean;
  label: string;
  meta: string;
  onClick: () => void;
  url?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-all",
        active
          ? "border-primary/70 bg-primary/15 shadow-[0_0_0_1px_var(--primary)]"
          : "border-border bg-card hover:border-muted-foreground/40",
      )}
    >
      {url ? <SoundPlayer url={url} title={`Play ${label}`} /> : null}
      <span>
        <span className="block font-medium leading-tight">{label}</span>
        <span className="block text-[10px] text-muted-foreground">{meta}</span>
      </span>
    </button>
  );
}

/* ==================================================================== */
/*  Job panel — progress, stage stepper, live log                        */
/* ==================================================================== */
const STORY_STAGES = ["music", "bundle", "render", "encode"];
const TEMPLATE_STAGES = ["script", "bundle", "render", "encode"];
const STAGE_LABELS: Record<string, string> = {
  music: "Synthesizing music bed",
  script: "Writing script (AI)",
  bundle: "Bundling composition",
  render: "Rendering frames",
  encode: "Encoding + muxing",
  done: "Done",
  failed: "Failed",
};

function JobPanel({
  job,
  status,
  logs,
  progress,
  stage,
  etaSec,
}: {
  job: Job;
  status: string;
  logs: string[];
  progress: number;
  stage: string;
  etaSec: number | null;
}) {
  const stages = job.engine === "template" ? TEMPLATE_STAGES : STORY_STAGES;
  const spanFor = (key: string) => job.timeline?.find((t) => t.stage === key);
  const state = (key: string): "pending" | "current" | "done" => {
    const s = spanFor(key);
    if (!s) return "pending";
    return s.endedAt != null ? "done" : "current";
  };
  const dur = (key: string): number => {
    const s = spanFor(key);
    if (!s) return 0;
    return Math.round(((s.endedAt ?? Date.now()) - s.startedAt) / 1000);
  };
  const took = Math.round((job.timeline ?? []).reduce((a, s) => a + (s.endedAt ? s.endedAt - s.startedAt : 0), 0) / 1000);
  const fmt = (s: number) => `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s`;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-baseline justify-between gap-4">
          <CardTitle className="flex items-center gap-3 text-base">
            <span className={cn("text-3xl font-bold tabular-nums", status === "done" && "text-emerald-400")}>
              {status === "done" ? "100" : progress}
              <span className="text-sm text-muted-foreground">%</span>
            </span>
            <span className="text-sm font-normal text-muted-foreground">
              {STAGE_LABELS[stage] ?? stage}
              {status === "running" && etaSec != null ? ` · ~${fmt(etaSec)} left` : ""}
            </span>
          </CardTitle>
          <code className="hidden text-xs text-muted-foreground sm:block">{job.id}</code>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${status === "done" ? 100 : Math.max(progress, 4)}%` }}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {stages.map((s) => {
            const st = state(s);
            return (
              <Badge
                key={s}
                variant={st === "done" ? "success" : st === "current" ? "amber" : "outline"}
                className="gap-1.5"
              >
                {st === "done" ? <CircleCheck className="h-3 w-3" /> : null}
                {STAGE_LABELS[s] ?? s}
                {st === "done" && dur(s) > 0 ? ` · ${dur(s)}s` : ""}
              </Badge>
            );
          })}
          {status !== "running" && took > 0 ? (
            <span className="pt-0.5 text-xs text-muted-foreground">total {fmt(took)}</span>
          ) : null}
        </div>
        {status === "failed" ? (
          <ErrorBanner
            error={job.error ?? "Generation failed (see the log tail below)."}
            fix='Fix the reported step, then press Generate again — the render is fully local and re-runs cleanly'
          />
        ) : null}
        <LogConsole logs={logs} />
      </CardContent>
    </Card>
  );
}

/** Autoscrolling live log with severity coloring (kept from the classic UI). */
function LogConsole({ logs }: { logs: string[] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs]);
  const lines = logs.join("").split(/\r?\n/).filter((l) => l.trim()).slice(-200);
  return (
    <div
      ref={ref}
      className="mt-4 max-h-56 overflow-y-auto rounded-lg border border-border bg-black/40 p-3 font-mono text-[11px] leading-relaxed"
    >
      {lines.map((l, i) => (
        <div
          key={i}
          className={cn(
            "whitespace-pre-wrap",
            l.startsWith("(node:") || l.includes("AI_SDK") || l.includes("Deprecation")
              ? "text-muted-foreground/60"
              : l.includes("═══") || l.startsWith("✓") || l.startsWith("[sfx]")
                ? "text-emerald-300"
                : l.startsWith("[") || l.includes("/5]")
                  ? "text-sky-300"
                  : "text-foreground/90",
          )}
        >
          {l}
        </div>
      ))}
    </div>
  );
}
