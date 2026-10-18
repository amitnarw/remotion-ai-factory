/**
 * Generate — a 3-step wizard anyone can follow. One step at a time.
 *
 *   ?tab=generate&step=1..3&story=<slug>&job=<id>
 *
 *   ① Pick a video   ② Sound design   ③ Make the video
 *
 * Step 1 auto-advances after picking; step 2 saves choices instantly; step 3
 * renders and shows the finished video with big Watch / Download buttons.
 * The legacy AI-spec pipeline lives behind a small link below the wizard.
 */
import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from "react";
import {
  Sparkles,
  Download,
  CircleCheck,
  Lock,
  Wand2,
  ArrowRight,
  Music4,
  AudioLines,
  Clapperboard,
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
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Textarea } from "../components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog";
import { ErrorBanner, SoundPlayer } from "../components/shared";
import { useQuery, setQuery } from "../lib/navigation";
import { cn } from "../lib/utils";

const STEP_LABELS = ["Pick a video", "Sound design", "Make the video"];

export default function Generate() {
  const query = useQuery();
  const storyParam = query.get("story") ?? undefined;
  const jobParam = query.get("job") ?? undefined;
  const step = Math.min(3, Math.max(1, parseInt(query.get("step") ?? "1", 10) || 1));

  /* ---------------- data ---------------- */
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [stories, setStories] = useState<StoryInfo[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    getProviders()
      .then((d) => setProviders(d.providers || []))
      .catch(() => {}); // providers only matter for the AI-spec dialog
    getStories()
      .then((s) => setStories(s))
      .catch((e) => setLoadError(String(e)));
  }, []);

  const story = useMemo(
    () => stories.find((s) => s.slug === storyParam) ?? stories[0],
    [stories, storyParam],
  );

  /* ---------------- sound design ---------------- */
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
      .then(() => toast.success(`${role} is now ${variant === "auto" ? "Auto" : variant}`, { duration: 1600 }))
      .catch((e) => toast.error("Could not save that sound choice", { description: String(e) }));
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
            setGenError("Lost track of the render — the app was probably restarted. Just start it again.");
            setStatus("idle");
          }
        }, 2500);
        stopPolling();
        pollRef.current = { id: jobId, timer };
      };
      getJob(jobId)
        .then((fresh) => {
          setJob(fresh);
          setProgress(fresh.progress);
          if (fresh.stage) setStage(fresh.stage);
          setEta(fresh.etaSec ?? null);
          setLogs(fresh.logs.slice(-400));
          setStatus(fresh.status === "done" || fresh.status === "failed" ? fresh.status : "running");
          if (fresh.status === "done" || fresh.status === "failed") {
            es.close();
            stopPolling();
          }
        })
        .catch(() => {
          /* SSE still drives */
        });
    },
    [stopPolling],
  );

  /* ?job=<id> — resume the render view on refresh. */
  useEffect(() => {
    if (jobParam) {
      setStage(jobParam.includes("-t") ? "script" : "music");
      setQuery({ step: "3" });
      openSSE(jobParam);
    }
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobParam]);

  /* step sanity: can't be past step 1 without a story. */
  useEffect(() => {
    if (stories.length && !story && step > 1) setQuery({ step: "1" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stories.length, story?.slug, step]);

  const running = status === "running";

  /* ---------------- actions ---------------- */
  const pickStory = (slug: string) => {
    if (running) return;
    setGenError(null);
    setQuery({ story: slug, job: undefined, step: "2" });
  };

  const startRender = async () => {
    if (running || !story) return;
    setGenError(null);
    try {
      const { jobId } = await generateStory(story.slug, choices);
      setLogs([]);
      setProgress(0);
      setStatus("running");
      setStage("music");
      setEta(null);
      setQuery({ job: jobId, step: "3" });
      setJob({
        id: jobId,
        status: "queued",
        progress: 0,
        stage: "music",
        premise: story.title,
        engine: "story",
        createdAt: Date.now(),
        logs: [],
      });
      openSSE(jobId);
      toast.success("The video is being made!", { description: "Step 3 shows the progress." });
    } catch (e) {
      setGenError(String(e));
      toast.error("Could not start the render");
    }
  };

  const startTemplate = async () => {
    if (running || !premise.trim()) return;
    setGenError(null);
    try {
      const { jobId } = await generateVideo(premise.trim(), provider ?? undefined, model ?? undefined);
      setSpecOpen(false);
      setLogs([]);
      setProgress(0);
      setStatus("running");
      setStage("script");
      setEta(null);
      setQuery({ job: jobId, step: "3" });
      setJob({
        id: jobId,
        status: "queued",
        progress: 0,
        stage: "script",
        premise: premise.trim(),
        engine: "template",
        createdAt: Date.now(),
        logs: [],
      });
      openSSE(jobId);
    } catch (e) {
      setGenError(String(e));
      toast.error("Could not start the render");
    }
  };

  /* ---------------- AI-spec dialog (advanced) ---------------- */
  const [specOpen, setSpecOpen] = useState(false);
  const [premise, setPremise] = useState("");
  const [provider, setProvider] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const allProviders: Array<{ name: string; keyConfigured: boolean; models: string[] }> = useMemo(
    () => [
      { name: "offline", keyConfigured: true, models: ["templates"] },
      ...providers.map((p) => ({
        name: p.name,
        keyConfigured: p.keyConfigured,
        models: p.models ?? [],
      })),
    ],
    [providers],
  );
  const provInfo = provider ? allProviders.find((p) => p.name === provider) : undefined;
  const keyMissing = provider != null && provider !== "offline" && !provInfo?.keyConfigured;

  /* ---------------- stepper ---------------- */
  const stepState = (n: number): "done" | "current" | "upcoming" => {
    if (n < step) return "done";
    if (n === step) return "current";
    return "upcoming";
  };
  const canVisit = (n: number): boolean => {
    if (running) return n === 3;
    if (n === 1) return true;
    return Boolean(story);
  };

  const renderBody = () => {
    if (step === 1) return <Step1 stories={stories} storySlug={story?.slug} onPick={pickStory} loadError={loadError} />;
    if (step === 2 && story)
      return (
        <Step2
          story={story}
          design={design}
          choices={choices}
          onPick={setChoice}
          onBack={() => setQuery({ step: "1" })}
          onNext={() => setQuery({ step: "3" })}
        />
      );
    return (
      <Step3OrJob
        running={running}
        status={status}
        job={job}
        logs={logs}
        progress={progress}
        stage={stage}
        etaSec={etaSec}
        onStart={startRender}
        onAgain={() => {
          setGenError(null);
          setQuery({ job: undefined, step: "1" });
          setStatus("idle");
          setJob(null);
        }}
      />
    );
  };

  return (
    <div className="mx-auto max-w-2xl">
      {/* Stepper header */}
      <div className="mb-8 flex items-center justify-center gap-2">
        {[1, 2, 3].map((n, i) => {
          const st = stepState(n);
          const visitable = canVisit(n);
          const isLocked = running && n !== 3;
          return (
            <Fragment key={n}>
              {i > 0 ? (
                <div
                  className={cn(
                    "h-2 w-10 rounded-full sm:w-16",
                    n <= step ? "bg-primary" : "bg-secondary",
                  )}
                />
              ) : null}
              <button
                onClick={() => visitable && setQuery({ step: String(n) })}
                disabled={!visitable}
                className={cn(
                  "flex h-14 items-center gap-2.5 rounded-2xl px-4 font-bold transition-all",
                  st === "current" && "bg-accent text-accent-foreground shadow-lg shadow-accent/25 scale-105",
                  st === "done" && visitable && "bg-primary text-primary-foreground shadow-lg shadow-primary/25 hover:brightness-110",
                  st === "done" && !visitable && "bg-primary/60 text-primary-foreground",
                  st === "upcoming" && visitable && "bg-secondary text-secondary-foreground hover:brightness-125",
                  st === "upcoming" && !visitable && "bg-secondary/60 text-secondary-foreground/50",
                  isLocked && "opacity-60",
                )}
              >
                <span
                  className={cn(
                    "grid h-8 w-8 shrink-0 place-items-center rounded-full text-base",
                    st === "current" ? "bg-accent-foreground text-accent" : "bg-black/20",
                  )}
                >
                  {isLocked ? <Lock className="h-4 w-4" /> : n}
                </span>
                <span className="hidden text-sm sm:block">{STEP_LABELS[n - 1]}</span>
              </button>
            </Fragment>
          );
        })}
      </div>

      {genError ? (
        <ErrorBanner error={genError} fix="Start the render again — everything runs locally and re-runs cleanly" />
      ) : null}

      {renderBody()}

      {/* Advanced AI-spec entry — small quiet link below the wizard. */}
      {step === 1 && !running ? (
        <div className="mt-10 text-center">
          <button
            onClick={() => setSpecOpen(true)}
            className="text-sm font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Advanced — AI spec pipeline…
          </button>
        </div>
      ) : null}

      {/* AI-spec dialog */}
      <Dialog open={specOpen} onOpenChange={setSpecOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-primary" />
              AI spec pipeline
            </DialogTitle>
            <DialogDescription>
              An AI provider writes a shot plan from your premise, then the template composition
              animates it. Needs a configured provider (or pick offline templates).
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="What if gravity disappeared for just 5 seconds?"
            value={premise}
            onChange={(e) => setPremise(e.target.value)}
            disabled={running}
          />
          <div className="grid grid-cols-2 gap-3">
            <select
              className="h-12 rounded-xl bg-input px-4 text-[15px] font-semibold shadow-inner focus:outline-none focus:ring-2 focus:ring-ring"
              value={provider ?? ""}
              onChange={(e) => {
                setProvider(e.target.value || null);
                setModel(null);
              }}
              disabled={running}
            >
              <option value="">Provider…</option>
              {allProviders.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name} {p.keyConfigured ? "✓" : "○"}
                </option>
              ))}
            </select>
            <select
              className="h-12 rounded-xl bg-input px-4 text-[15px] font-semibold shadow-inner focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-40"
              value={model ?? ""}
              onChange={(e) => setModel(e.target.value || null)}
              disabled={running || !provInfo?.models.length}
            >
              <option value="">Model…</option>
              {(provInfo?.models ?? []).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          {keyMissing && provider ? (
            <p className="rounded-xl bg-destructive/90 px-4 py-3 text-sm font-semibold text-destructive-foreground">
              No key saved for {provider} yet — open the Providers tab first, or pick “offline”.
            </p>
          ) : null}
          <Button className="w-full" size="lg" onClick={startTemplate} disabled={running || !premise.trim() || keyMissing}>
            <Sparkles className="h-5 w-5" />
            {running ? "Rendering…" : "Make this video"}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ==================================================================== */
/*  STEP 1 — pick a video                                                */
/* ==================================================================== */
function Step1({
  stories,
  storySlug,
  onPick,
  loadError,
}: {
  stories: StoryInfo[];
  storySlug?: string;
  onPick: (slug: string) => void;
  loadError: string | null;
}) {
  return (
    <div className="space-y-4">
      {loadError ? (
        <ErrorBanner
          error="The video list could not load."
          fix='Start the app server with "npm run server", then reload this page'
        />
      ) : null}
      {stories.length === 0 && !loadError ? (
        <div className="rounded-3xl bg-card px-8 py-16 text-center text-[15px] font-medium text-muted-foreground shadow-xl">
          No videos are made yet — they will show up here.
        </div>
      ) : (
        stories.map((s) => {
          const selected = s.slug === storySlug;
          return (
            <button
              key={s.slug}
              onClick={() => onPick(s.slug)}
              className={cn(
                "flex w-full items-center gap-5 rounded-3xl p-6 text-left transition-all active:scale-[0.99]",
                selected
                  ? "bg-primary text-primary-foreground shadow-xl shadow-primary/30"
                  : "bg-card shadow-xl shadow-black/20 hover:brightness-125",
              )}
            >
              <span
                className={cn(
                  "grid h-16 w-16 shrink-0 place-items-center rounded-2xl",
                  selected ? "bg-black/20" : "bg-primary/20 text-primary",
                )}
              >
                <Clapperboard className="h-7 w-7" />
              </span>
              <span className="min-w-0">
                <span className="block text-lg font-extrabold leading-snug">{s.title}</span>
                <span className={cn("mt-1 block text-sm font-bold", selected ? "opacity-80" : "text-muted-foreground")}>
                  {Math.round(s.durationSec)} seconds · sounds included
                </span>
              </span>
              <ArrowRight className={cn("ml-auto h-6 w-6 shrink-0", selected ? "" : "text-muted-foreground")} />
            </button>
          );
        })
      )}
    </div>
  );
}

/* ==================================================================== */
/*  STEP 2 — sound design                                                */
/* ==================================================================== */
function Step2({
  story,
  design,
  choices,
  onPick,
  onBack,
  onNext,
}: {
  story: StoryInfo;
  design: SoundDesignResponse | null;
  choices: Record<string, string>;
  onPick: (role: string, variant: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-4">
      <InfoTipBanner text={`Every sound in “${story.title}” — tap one to hear it, tap Select to use it. Auto already picks the best.`} />

      {!design ? (
        <div className="rounded-3xl bg-card px-8 py-14 text-center shadow-xl">
          <Music4 className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
          <p className="text-[15px] font-semibold">The sound library is not ready — the built-in sounds will be used. You can still make the video.</p>
        </div>
      ) : (
        design.roles.map((role) => (
          <Card key={role.id} className="p-6">
            <div className="mb-1 flex items-center gap-2.5">
              {role.family === "ambient" ? (
                <AudioLines className="h-5 w-5 text-primary" />
              ) : (
                <Music4 className="h-5 w-5 text-primary" />
              )}
              <span className="text-lg font-extrabold">{role.label}</span>
            </div>
            <p className="mb-4 text-sm font-medium text-muted-foreground">{role.description}</p>
            <div className="flex flex-wrap gap-2.5">
              <VariantChip
                active={(choices[role.id] ?? "auto") === "auto"}
                label="⭐ Auto"
                sub="the best sound, picked for you"
                onClick={() => onPick(role.id, "auto")}
              />
              {role.variants.map((v) => (
                <VariantChip
                  key={v.id}
                  url={v.url}
                  active={choices[role.id] === v.id}
                  label={v.id === "synth" ? "Crafted sound" : v.file.split("--")[1]?.replace(/\.wav$/, "").replace(/-/g, " ") ?? v.id}
                  sub={`${v.dur}s · ${v.id === "synth" ? "made in the studio" : "real recording (CC0)"}`}
                  onClick={() => onPick(role.id, v.id)}
                />
              ))}
            </div>
          </Card>
        ))
      )}

      <div className="flex justify-between pt-2">
        <Button variant="secondary" size="lg" onClick={onBack}>
          ◀ Step 1
        </Button>
        <Button variant="amber" size="lg" onClick={onNext}>
          Next: Make the video <ArrowRight className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}

function VariantChip({
  active,
  label,
  sub,
  onClick,
  url,
}: {
  active: boolean;
  label: string;
  sub: string;
  onClick: () => void;
  url?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-2xl px-4 py-3 text-left transition-all active:scale-[0.98]",
        active
          ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30"
          : "bg-input hover:brightness-125",
      )}
    >
      {url ? <SoundPlayer url={url} title={`Play ${label}`} /> : null}
      <span>
        <span className="block text-sm font-extrabold leading-tight">{label}</span>
        <span className={cn("block text-[11px] font-semibold", active ? "opacity-75" : "text-muted-foreground")}>
          {sub}
        </span>
      </span>
    </button>
  );
}

function InfoTipBanner({ text }: { text: string }) {
  return (
    <div className="rounded-2xl bg-secondary px-5 py-4 text-[15px] font-semibold text-secondary-foreground">
      {text}
    </div>
  );
}

/* ==================================================================== */
/*  STEP 3 — make the video / progress / result                          */
/* ==================================================================== */
function Step3OrJob({
  running,
  status,
  job,
  logs,
  progress,
  stage,
  etaSec,
  onStart,
  onAgain,
}: {
  running: boolean;
  status: string;
  job: Job | null;
  logs: string[];
  progress: number;
  stage: string;
  etaSec: number | null;
  onStart: () => void;
  onAgain: () => void;
}) {
  if (status === "done" && job?.output?.mp4) {
    return (
      <div className="space-y-5">
        <div className="rounded-3xl bg-success px-6 py-8 text-center text-success-foreground shadow-xl shadow-success/20">
          <CircleCheck className="mx-auto mb-3 h-14 w-14" />
          <h3 className="text-2xl font-extrabold">Your video is ready!</h3>
          <p className="mt-1 text-sm font-bold opacity-80">{job.premise}</p>
        </div>
        <video
          /* eslint-disable-next-line @remotion/warn-native-media-tag -- dashboard, not a composition */
          controls
          className="mx-auto max-h-[65dvh] w-full rounded-3xl bg-black shadow-2xl"
          src={`/media/${job.output.mp4}`}
        />
        <div className="flex flex-wrap justify-center gap-3">
          <Button variant="amber" size="lg" asChild>
            <a href={`/media/${job.output.mp4}`} target="_blank" rel="noreferrer" download>
              <Download className="h-5 w-5" /> Download video
            </a>
          </Button>
          <Button variant="secondary" size="lg" onClick={onAgain}>
            Make another one
          </Button>
        </div>
      </div>
    );
  }

  if (running || status === "failed") {
    return (
      <JobPanel job={job} status={status} logs={logs} progress={progress} stage={stage} etaSec={etaSec} />
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-8 text-center">
        <div className="mx-auto mb-5 grid h-20 w-20 place-items-center rounded-3xl bg-accent text-accent-foreground shadow-xl shadow-accent/25">
          <Sparkles className="h-10 w-10" />
        </div>
        <h3 className="text-2xl font-extrabold">Everything is set!</h3>
        <p className="mx-auto mt-2 max-w-sm text-[15px] font-medium text-muted-foreground">
          Press the big yellow button — your video appears here in about half a minute, with music
          and sounds already inside.
        </p>
        <div className="mt-6">
          <Button variant="amber" size="xl" className="w-full" onClick={onStart}>
            <Sparkles className="h-6 w-6" /> Make the video! ⚡
          </Button>
        </div>
      </Card>
      <Button variant="secondary" size="lg" className="w-full" onClick={() => setQuery({ step: "2" })}>
        ◀ Change the sounds
      </Button>
    </div>
  );
}

/* ==================================================================== */
/*  Job progress — colored pills per stage + live log                    */
/* ==================================================================== */
const TEMPLATE_STAGES = ["script", "bundle", "render", "encode"];
const STAGE_LABELS: Record<string, string> = {
  music: "Making music",
  script: "Writing the story",
  bundle: "Preparing",
  render: "Drawing frames",
  encode: "Saving the video",
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
  job: Job | null;
  status: string;
  logs: string[];
  progress: number;
  stage: string;
  etaSec: number | null;
}) {
  const stages = job?.engine === "template" ? TEMPLATE_STAGES : ["music", "bundle", "render", "encode"];
  const spanFor = (key: string) => job?.timeline?.find((t) => t.stage === key);
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

  return (
    <div className="space-y-4">
      <Card className="p-6 text-center">
        <div className={cn("text-7xl font-extrabold tabular-nums", status === "failed" ? "text-destructive" : "text-primary")}>
          {status === "done" ? 100 : Math.max(progress, 0)}
          <span className="text-2xl text-muted-foreground">%</span>
        </div>
        <p className="mt-2 text-lg font-bold">
          {status === "failed" ? "Oh no — something went wrong." : `${STAGE_LABELS[stage] ?? stage}…`}
          {status === "running" && etaSec != null ? (
            <span className="ml-2 text-muted-foreground">about {Math.round(etaSec)}s left</span>
          ) : null}
        </p>
        <div className="mx-auto mt-5 h-5 w-full max-w-md overflow-hidden rounded-full bg-input">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${Math.max(progress, 6)}%` }}
          />
        </div>
        <div className="mt-5 flex flex-wrap justify-center gap-2.5">
          {stages.map((s, i) => {
            const st = state(s);
            return (
              <div
                key={s}
                className={cn(
                  "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold",
                  st === "done" && "bg-success text-success-foreground",
                  st === "current" && "bg-accent text-accent-foreground",
                  st === "pending" && "bg-input text-muted-foreground",
                )}
              >
                <span className="grid h-5 w-5 place-items-center rounded-full bg-black/25 text-[10px]">
                  {st === "done" ? "✓" : i + 1}
                </span>
                {STAGE_LABELS[s] ?? s}
                {st === "done" && dur(s) > 0 ? <span className="opacity-70">{dur(s)}s</span> : null}
              </div>
            );
          })}
        </div>
      </Card>

      {status === "failed" ? (
        <ErrorBanner
          error={job?.error ?? "Something went wrong while making the video."}
          fix="Press “Make the video” again — if it keeps failing, the log below says exactly which step broke"
        />
      ) : null}

      <LogConsole logs={logs} />
    </div>
  );
}

/** Autoscrolling live log (soft dark console, no borders). */
function LogConsole({ logs }: { logs: string[] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs]);
  const lines = logs.join("").split(/\r?\n/).filter((l) => l.trim()).slice(-120);
  return (
    <div
      ref={ref}
      className="mx-auto max-h-40 max-w-xl overflow-y-auto rounded-2xl bg-black/50 p-4 font-mono text-[11px] leading-relaxed"
    >
      {lines.map((l, i) => (
        <div
          key={i}
          className={cn(
            "whitespace-pre-wrap",
            l.startsWith("(node:") || l.includes("AI_SDK") || l.includes("Deprecation")
              ? "text-muted-foreground/50"
              : l.includes("═══") || l.startsWith("✓") || l.startsWith("[sfx]")
                ? "text-emerald-300"
                : l.startsWith("[") || l.includes("/5]")
                  ? "text-sky-300"
                  : "text-foreground/80",
          )}
        >
          {l}
        </div>
      ))}
    </div>
  );
}
