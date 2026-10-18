/**
 * Generate, the Story Studio wizard. One step at a time, kid-simple.
 *
 *   ?tab=generate&step=1|3&path=ready&story=<slug>&plan=<jobId>&draft=<slug>&job=<renderId>
 *
 * Two paths through the same three steps:
 *   READY, hand-crafted videos (pick → sound design → make)
 *   NEW, your topic / your whole story → the writer drafts the storyboard →
 *           you REVIEW it (scenes, camera, narration, sounds) → approve →
 *           render with local KittenTTS voices, synthesized music + v2 SFX.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Download,
  CircleCheck,
  ArrowRight,
  Music4,
  AudioLines,
  Clapperboard,
  PenLine,
  BookText,
  BookOpen,
  Wand2,
  Eye,
  Camera,
  Megaphone,
  RefreshCw,
  ThumbsUp,
  ArrowLeft,
  Play,
  Mic,
  Smile,
  Users,
  VolumeX,
  Zap,
  Star,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import {
  getStories,
  getJob,
  getSoundDesign,
  saveSoundMap,
  generateStory,
  getStoryDrafts,
  planStory,
  getStory,
  approveStory,
  setStoryVoiceMode,
  getVoices,
  requestVoiceSample,
  Job,
  SoundDesignResponse,
  StoryInfo,
  StoryDraft,
  type VoiceInfo,
} from "../api";
import type { Storyboard } from "../../../src/whatif/storyboard/schema";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Input, Textarea } from "../components/ui/input";
import { ErrorBanner, SoundPlayer } from "../components/shared";
import { InfoTip } from "../components/InfoTip";
import { useQuery, setQuery } from "../lib/navigation";
import { cn } from "../lib/utils";

const STEP_LABELS = ["Tell your idea", "Shape the story", "Make the video"];

export default function Generate() {
  const query = useQuery();
  const step = query.get("step") ?? "1";
  const storyParam = query.get("story") ?? undefined;
  const planParam = query.get("plan") ?? undefined;
  const draftParam = query.get("draft") ?? undefined;
  const jobParam = query.get("job") ?? undefined;
  const path = query.get("path") ?? undefined;

  /* ---------------- data (once) ---------------- */
  const [stories, setStories] = useState<StoryInfo[]>([]);
  const [drafts, setDrafts] = useState<StoryDraft[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  useEffect(() => {
    getStories()
      .then((s) => setStories(s))
      .catch((e) => setLoadError(String(e)));
    getStoryDrafts()
      .then(setDrafts)
      .catch(() => setDrafts([]));
  }, []);
  useEffect(() => {
    if (step === "1") getStoryDrafts().then(setDrafts).catch(() => {});
  }, [step]);

  /* ---------------- shared job machinery (SSE + polling fallback) ------- */
  const [job, setJob] = useState<Job | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [stage, setStage] = useState<string>("music");
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [etaSec, setEta] = useState<number | null>(null);
  const pollRef = useRef<{ id: string; timer: number } | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) window.clearInterval(pollRef.current.timer);
    pollRef.current = null;
  }, []);

  const adopt = useCallback(
    (fresh: Job) => {
      setJob(fresh);
      setProgress(fresh.progress);
      if (fresh.stage) setStage(fresh.stage);
      setLogs(fresh.logs.slice(-300));
      setStatus(fresh.status === "done" || fresh.status === "failed" ? fresh.status : "running");
      return fresh.status;
    },
    [],
  );

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
          if (d.type === "log") setLogs((l) => [...l.slice(-300), d.text ?? ""]);
          else if (d.type === "progress") {
            setProgress(d.progress ?? 0);
            if (d.stage) setStage(d.stage);
            setEta(d.etaSec ?? null);
          } else if (d.type === "done" || d.type === "failed") {
            es.close();
            stopPolling();
            getJob(jobId)
              .then((fresh) => adopt(fresh))
              .catch(() => setStatus(d.type === "done" ? "done" : "failed"));
          }
        } catch {
          /* ignore */
        }
      };
      es.onerror = () => {
        es.close();
        // Polling fallback keeps the UI alive when the stream drops.
        const timer = window.setInterval(async () => {
          try {
            const fresh = await getJob(jobId);
            const st = adopt(fresh);
            if (st === "done" || st === "failed") stopPolling();
          } catch {
            stopPolling();
            setGenError("Lost track of the job, the app restarted. Start again.");
            setStatus("idle");
          }
        }, 2000) as unknown as number;
        stopPolling();
        pollRef.current = { id: jobId, timer };
      };
      // Full sync, the job may have finished before we attached.
      getJob(jobId)
        .then((fresh) => {
          const st = adopt(fresh);
          if (st === "done" || st === "failed") {
            es.close();
            stopPolling();
          }
        })
        .catch(() => {
          /* SSE still drives */
        });
    },
    [adopt, stopPolling],
  );

  /* Attach by URL: render job (step 3), plan job (review), deep-link-proof. */
  useEffect(() => {
    if (step === "3" && jobParam) {
      setStage(jobParam.includes("-t") ? "script" : "voice");
      openSSE(jobParam);
    } else if (step === "review" && planParam) {
      setStage("script");
      openSSE(planParam);
    }
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, jobParam, planParam]);

  /* Ready path: fire the render for a hand-crafted video (server reads the
     saved sound-design choices itself). */
  const startReadyRender = useCallback(
    async (slug: string) => {
      setGenError(null);
      try {
        const { jobId } = await generateStory(slug);
        setLogs([]);
        setProgress(0);
        setStatus("running");
        setStage("music");
        setEta(null);
        setQuery({ step: "3", job: jobId });
        setJob({
          id: jobId,
          status: "queued",
          progress: 0,
          stage: "music",
          premise: stories.find((s) => s.slug === slug)?.title ?? slug,
          engine: "story",
          createdAt: Date.now(),
          logs: [],
        });
        openSSE(jobId);
        toast.success("The video is being made!", { description: "Watch the progress below." });
      } catch (e) {
        setGenError(String(e));
        toast.error("Could not start the render", { description: String(e) });
      }
    },
    [openSSE, stories],
  );

  const running = status === "running";

  return (
    <div className="mx-auto max-w-2xl pb-10">
      {/* Stepper (non-clickable, back buttons below guide the way) */}
      <div className="mb-8 flex items-center justify-center gap-2">
        {([1, 2, 3] as const).map((n, i) => {
          const isCurrent =
            (n === 1 && step === "1") ||
            (n === 2 && (step === "2" || step === "review")) ||
            (n === 3 && step === "3");
          const reached =
            n === 1 || (n === 2 && running) || (typeof step === "string" && step !== "1");
          return (
            <div key={n} className="flex items-center gap-2">
              {i > 0 ? (
                <div className={cn("h-2 w-10 rounded-full sm:w-14", reached ? "bg-primary" : "bg-secondary")} />
              ) : null}
              <div
                className={cn(
                  "flex h-14 items-center gap-2.5 rounded-2xl px-4 font-bold shadow-xl shadow-black/20 transition-all",
                  isCurrent && "scale-105 bg-accent text-accent-foreground shadow-accent/25",
                  !isCurrent && reached && "bg-primary text-primary-foreground",
                  !isCurrent && !reached && "bg-secondary text-secondary-foreground",
                )}
              >
                <span
                  className={cn(
                    "grid h-8 w-8 shrink-0 place-items-center rounded-full text-base",
                    isCurrent ? "bg-accent-foreground text-accent" : "bg-black/20",
                  )}
                >
                  {running && (isCurrent || step === "3") ? <RefreshCw className="h-4 w-4 animate-spin" /> : n}
                </span>
                <span className="hidden text-sm sm:block">{STEP_LABELS[n - 1]}</span>
              </div>
            </div>
          );
        })}
      </div>

      {genError ? <ErrorBanner error={genError} fix="Start again, everything runs locally and re-runs cleanly" /> : null}

      {step === "1" ? (
        <Step1
          stories={stories}
          drafts={drafts}
          loadError={loadError}
          setError={setGenError}
          onPickReady={(slug) => setQuery({ story: slug, path: "ready", step: "2", job: undefined })}
          onResumeDraft={(slug) => setQuery({ draft: slug, step: "review", plan: undefined })}
        />
      ) : null}

      {step === "2" && path === "ready" ? (
        <Step2Ready
          storySlug={storyParam}
          stories={stories}
          onDone={() => setQuery({ step: "3" })}
          onBack={() => setQuery({ step: "1", path: undefined, story: undefined })}
        />
      ) : null}

      {step === "review" ? (
        <StoryReview
          planJobId={planParam}
          draftSlug={draftParam}
          status={status}
          job={job}
          logs={logs}
          setError={setGenError}
          onBack={() => setQuery({ step: "1", plan: undefined, draft: undefined })}
          onApproved={(jobId) => setQuery({ step: "3", job: jobId, plan: undefined, draft: undefined })}
        />
      ) : null}

      {step === "3" ? (
        <Step3OrJob
          running={running}
          status={status}
          job={job}
          logs={logs}
          progress={progress}
          etaSec={etaSec}
          stage={stage}
          readySlug={path === "ready" ? storyParam : undefined}
          readyTitle={stories.find((s) => s.slug === storyParam)?.title}
          onMakeReady={startReadyRender}
          onAgain={() => {
            setGenError(null);
            setJob(null);
            setStatus("idle");
            getStoryDrafts().then(setDrafts).catch(() => {});
            setQuery({ step: "1", job: undefined, plan: undefined, draft: undefined, path: undefined, story: undefined });
          }}
        />
      ) : null}
    </div>
  );
}

/* ==================================================================== */
/*  STEP 1, idea entry / drafts / ready videos                          */
/* ==================================================================== */
const LENGTHS = [15, 20, 30, 45, 60];

/** A model submission, beginning, flip, escalation, warm smiley payoff. */
const STORY_SAMPLE = `What if shadows could hold you?

Bruno the blob sat on his bench, sipping cocoa. His shadow stretched across the pavement, long and lazy in the sunset.

At midnight, the shadow grabbed his ankle. He pulled, but it would not let go. He ran down the street, but the shadow skated right behind him, thin as ink.

By morning he gave up, sat back down and said: "Fine. You can hold my cocoa."

The shadow let go of his ankle and steadied the mug instead.`;

function Step1({
  stories,
  drafts,
  loadError,
  setError,
  onPickReady,
  onResumeDraft,
}: {
  stories: StoryInfo[];
  drafts: StoryDraft[];
  loadError: string | null;
  setError: (s: string | null) => void;
  onPickReady: (slug: string) => void;
  onResumeDraft: (slug: string) => void;
}) {
  const [mode, setMode] = useState<"topic" | "story" | null>(null);
  const [input, setInput] = useState("");
  const [seconds, setSeconds] = useState(20);
  const [writing, setWriting] = useState(false);

  const write = async () => {
    if (!mode || input.trim().length < 3) return;
    setError(null);
    setWriting(true);
    try {
      const { jobId } = await planStory({ mode, input: input.trim(), seconds });
      setQuery({ step: "review", plan: jobId, draft: undefined });
    } catch (e) {
      setError(String(e));
    } finally {
      setWriting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* The big idea cards */}
      <div className="grid gap-4">
        {(
          [
            {
              key: "topic" as const,
              icon: <PenLine className="h-7 w-7" />,
              title: "I have an idea",
              sub: "Type what the video is about.",
            },
            {
              key: "story" as const,
              icon: <BookText className="h-7 w-7" />,
              title: "I have the whole story",
              sub: "Paste your story, and we turn it into scenes with sounds.",
            },
          ]
        ).map((c) => (
          <button
            key={c.key}
            onClick={() => setMode(mode === c.key ? null : c.key)}
            className={cn(
              "flex items-center gap-5 rounded-3xl p-6 text-left transition-all active:scale-[0.99]",
              mode === c.key
                ? "bg-primary text-primary-foreground shadow-xl shadow-primary/30"
                : "bg-card shadow-xl shadow-black/20 hover:brightness-125",
            )}
          >
            <span
              className={cn(
                "grid h-14 w-14 shrink-0 place-items-center rounded-2xl",
                mode === c.key ? "bg-black/20" : "bg-primary/20 text-primary",
              )}
            >
              {c.icon}
            </span>
            <span>
              <span className="block text-lg font-extrabold">{c.title}</span>
              <span
                className={cn(
                  "mt-0.5 block text-sm font-medium",
                  mode === c.key ? "text-white/80" : "text-muted-foreground",
                )}
              >
                {c.sub}
              </span>
            </span>
          </button>
        ))}
      </div>

      {mode ? (
        <Card className="p-6">
          <div className="space-y-4">
            {mode === "topic" ? (
              <>
                <Input
                  autoFocus
                  placeholder="What if the moon was twice as close?"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  className="text-lg"
                />
                <p className="text-xs font-medium text-muted-foreground">
                  One sentence is enough. If we need anything else we will ask while writing.
                </p>
              </>
            ) : (
              <>
                <Textarea
                  autoFocus
                  placeholder="Paste your whole story here…"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  className="min-h-40"
                />
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="secondary" size="sm" onClick={() => { setInput(STORY_SAMPLE); toast.info("This is an example, keep it, edit it, or paste your own."); }}>
                    <BookOpen className="h-4 w-4" /> Show me an example
                  </Button>
                  <p className="max-w-sm text-xs font-medium text-muted-foreground">
                    Write it any way you like, bullet points, dialogue, plain paragraphs. Tell us how
                    it starts, what goes wrong, and how it ends.
                  </p>
                </div>
              </>
            )}
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="mr-1 text-sm font-bold text-muted-foreground">
                {mode === "topic" ? "How long?" : "About how long?"}
              </span>
              {LENGTHS.map((s) => (
                <button
                  key={s}
                  onClick={() => setSeconds(s)}
                  className={cn(
                    "h-11 rounded-2xl px-4 text-sm font-extrabold transition-all active:scale-95",
                    seconds === s
                      ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25"
                      : "bg-input text-muted-foreground hover:brightness-125",
                  )}
                >
                  {s}s
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <Button variant="amber" size="lg" className="flex-1" disabled={writing || input.trim().length < 3} onClick={write}>
                <Wand2 className={cn("h-5 w-5", writing && "animate-pulse")} />
                {writing ? "Writing…" : "Write the story"}
              </Button>
              <InfoTip helpId="story-engine" />
            </div>
            <p className="text-xs font-medium text-muted-foreground">
              We show you the complete story first. Nothing renders until you say yes.
            </p>
          </div>
        </Card>
      ) : null}

      {/* Unfinished stories */}
      {drafts.filter((d) => !d.approved).length > 0 ? (
        <div className="pt-4">
          <h3 className="mb-3 text-sm font-extrabold uppercase tracking-wider text-muted-foreground">
            Unfinished stories
          </h3>
          <div className="space-y-3">
            {drafts
              .filter((d) => !d.approved)
              .slice(0, 4)
              .map((d) => (
                <button
                  key={d.slug}
                  onClick={() => onResumeDraft(d.slug)}
                  className="flex w-full items-center gap-4 rounded-2xl bg-card p-4 text-left shadow-lg shadow-black/20 transition-all hover:brightness-125"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/25 text-accent">
                    <PenLine className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-bold">{d.title}</span>
                  <Badge variant="muted">{d.seconds}s</Badge>
                  <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                </button>
              ))}
          </div>
        </div>
      ) : null}

      {/* Ready-made (hand-crafted) videos */}
      <div className="pt-4">
        <h3 className="mb-3 text-sm font-extrabold uppercase tracking-wider text-muted-foreground">
          Ready-made videos
        </h3>
        {loadError ? (
          <ErrorBanner
            error="The video list could not load."
            fix='Start the app server with "npm run server", then reload this page'
          />
        ) : stories.length === 0 ? (
          <div className="rounded-2xl bg-card px-6 py-8 text-center text-sm font-semibold text-muted-foreground shadow-lg">
            None yet.
          </div>
        ) : (
          <div className="space-y-3">
            {stories.map((s) => (
              <button
                key={s.slug}
                onClick={() => onPickReady(s.slug)}
                className="flex w-full items-center gap-4 rounded-2xl bg-card p-4 text-left shadow-lg shadow-black/20 transition-all hover:brightness-125"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/20 text-primary">
                  <Clapperboard className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1 truncate font-bold">{s.title}</span>
                <Badge variant="muted">{Math.round(s.durationSec)}s</Badge>
                <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ==================================================================== */
/*  STEP 2 (ready path), sound design                                   */
/* ==================================================================== */
function Step2Ready({
  storySlug,
  stories,
  onDone,
  onBack,
}: {
  storySlug?: string;
  stories: StoryInfo[];
  onDone: () => void;
  onBack: () => void;
}) {
  const story = stories.find((s) => s.slug === storySlug);
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
      .then(() => toast.success("Sound picked!", { duration: 1400 }))
      .catch((e) => toast.error("Could not save that sound", { description: String(e) }));
  };

  return (
    <div className="space-y-4">
      {story ? <h3 className="text-center text-lg font-extrabold">{story.title}</h3> : null}
      {!story ? (
        <ErrorBanner error="Pick a video first" fix="Go back to step 1" />
      ) : !design ? (
        <div className="rounded-3xl bg-card px-8 py-14 text-center shadow-xl">
          <Music4 className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
          <p className="text-[15px] font-semibold">Sounds are picked automatically for this video.</p>
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
                icon={<Star className="h-3.5 w-3.5" />}
                active={(choices[role.id] ?? "auto") === "auto"}
                label="Auto"
                sub="the best sound"
                onClick={() => setChoice(role.id, "auto")}
              />
              {role.variants.map((v) => (
                <VariantChip
                  key={v.id}
                  url={v.url}
                  active={choices[role.id] === v.id}
                  label={
                    v.id === "synth"
                      ? "Crafted sound"
                      : v.file.split("--")[1]?.replace(/\.wav$/, "").replace(/-/g, " ") ?? v.id
                  }
                  sub={`${v.dur}s · ${v.id === "synth" ? "studio-made" : "real recording"}`}
                  onClick={() => setChoice(role.id, v.id)}
                />
              ))}
            </div>
          </Card>
        ))
      )}
      <div className="flex justify-between">
        <Button variant="secondary" size="lg" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />Step 1
        </Button>
        <Button variant="amber" size="lg" disabled={!story} onClick={onDone}>
          Next <ArrowRight className="h-5 w-5" />
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
  icon,
}: {
  active: boolean;
  label: string;
  sub: string;
  onClick: () => void;
  url?: string;
  icon?: React.ReactNode;
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
      {icon ? (
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-black/20">{icon}</span>
      ) : null}
      {url ? <SoundPlayer url={url} title={`Play ${label}`} /> : null}
      <span>
        <span className="block text-sm font-extrabold leading-tight">{label}</span>
        <span
          className={cn(
            "block text-[11px] font-semibold",
            active ? "opacity-75" : "text-muted-foreground",
          )}
        >
          {sub}
        </span>
      </span>
    </button>
  );
}

/* ==================================================================== */
/*  STEP 2 (new path), story review                                     */
/* ==================================================================== */
const VOICE_MODES_UI = [
  { key: "both", label: "Narrator + blob", icon: <Users className="h-4 w-4" /> },
  { key: "narrator", label: "Narrator only", icon: <Mic className="h-4 w-4" /> },
  { key: "character", label: "Blob only", icon: <Smile className="h-4 w-4" /> },
  { key: "silent", label: "No voices", icon: <VolumeX className="h-4 w-4" /> },
];

const CAMERA_LABEL: Record<string, string> = {
  static: "still",
  "push-in": "zoom in",
  "pull-back": "zoom out",
  "pan-left": "pan left",
  "pan-right": "pan right",
  "truck-left": "slide left",
  "truck-right": "slide right",
  "tilt-up": "tilt up",
  "tilt-down": "tilt down",
  "crane-up": "fly up",
  "crane-down": "fly down",
  orbit: "orbit",
  dutch: "tilted",
  "crash-zoom": "CRASH zoom",
  "whip-pan": "whip pan",
  handheld: "handheld shake",
  "rack-focus": "focus pull",
};
const SCENE_LABEL: Record<string, string> = {
  "tech-void": "dark void",
  room: "cozy room",
  "city-night": "night city",
  sky: "open sky",
};
const AMBIENCE_LABEL: Record<string, string> = {
  wind_city: "city wind",
  ambient_tense: "tense air",
  none: "quiet",
};
const SFX_LABEL: Record<string, string> = {
  whoosh_dissolve: "whoosh",
  rumble_deep: "rumble",
  clothing_flutter: "flutter",
  impact_soft_bodies: "thud",
  scream_distant: "distant shout",
  pop_light: "pop",
  rise_short: "riser",
};

function StoryReview({
  planJobId,
  draftSlug,
  status,
  job,
  logs,
  setError,
  onBack,
  onApproved,
}: {
  planJobId?: string;
  draftSlug?: string;
  status: string;
  job: Job | null;
  logs: string[];
  setError: (s: string | null) => void;
  onBack: () => void;
  onApproved: (jobId: string) => void;
}) {
  const [sb, setSb] = useState<Storyboard | null>(null);
  const [slug, setSlug] = useState<string | null>(draftSlug ?? null);
  const [loadFailed, setLoadFailed] = useState<string | null>(null);
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [rewriting, setRewriting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [fetched, setFetched] = useState(false);
  const [voices, setVoices] = useState<VoiceInfo[]>([]);

  /* Voice catalog + lazy sample warming. */
  useEffect(() => {
    let alive = true;
    const load = () =>
      getVoices()
        .then((d) => alive && setVoices(d.voices))
        .catch(() => {});
    load();
    // While samples are still being recorded in the background, refresh.
    const iv = window.setInterval(() => {
      getVoices()
        .then((d) => {
          if (!alive) return;
          if (d.voices.every((v) => v.sample)) window.clearInterval(iv);
          else setVoices(d.voices);
        })
        .catch(() => {});
    }, 20000);
    return () => {
      alive = false;
      window.clearInterval(iv);
    };
  }, []);

  /* Job just finished (fresh plan) → adopt its storyboard. */
  useEffect(() => {
    if (status === "done" && job?.slug) {
      setSlug(job.slug);
      const maybe = job.storyboard as Storyboard | undefined;
      if (maybe?.beats) setSb(maybe);
      else {
        setFetched(true);
        getStory(job.slug)
          .then((d) => setSb(d.storyboard as Storyboard))
          .catch(() => setLoadFailed("The story got lost, please write it again."));
      }
    }
    if (status === "failed" && job?.error) {
      setError(job.error);
    }
  }, [status, job?.slug, job?.storyboard, job?.error, setError]);

  /* Deep-link to a draft with no plan job → fetch directly (once). */
  useEffect(() => {
    if (planJobId || fetched || !draftSlug) return;
    setFetched(true);
    getStory(draftSlug)
      .then((d) => {
        setSlug(draftSlug);
        setSb(d.storyboard as Storyboard);
      })
      .catch(() => setLoadFailed("That story doesn't exist anymore."));
  }, [planJobId, draftSlug, fetched]);

  const rewrite = async () => {
    if (!sb || !slug || !feedback.trim()) return;
    setRewriting(true);
    try {
      const mode = (sb.topic && sb.topic.length > 0 ? "topic" : "story") as "topic" | "story";
      const { jobId } = await planStory({
        mode,
        input: sb.topic || sb.sourceStory || sb.title,
        seconds: sb.targetSeconds,
        feedback: feedback.trim(),
        slug,
        previous: sb,
      });
      // New plan job, swap the plan id in the URL; the writer panel shows.
      setSb(null);
      setQuery({ plan: jobId, draft: undefined });
      toast.success("Rewriting your story…");
    } catch (e) {
      toast.error("Rewrite failed", { description: String(e) });
    } finally {
      setRewriting(false);
      setRewriteOpen(false);
      setFeedback("");
    }
  };

  const approve = async () => {
    if (!slug) return;
    setApproving(true);
    setApproveError(null);
    try {
      const { jobId } = await approveStory(slug);
      toast.success("Approved! Making the video…");
      onApproved(jobId);
    } catch (e) {
      setApproveError(String(e));
      toast.error("Could not start the render");
    } finally {
      setApproving(false);
    }
  };

  const flipVoice = async (patch: { mode?: string; narratorVoice?: string; characterVoice?: string }) => {
    if (!slug || !sb) return;
    try {
      await setStoryVoiceMode(slug, patch);
      setSb({ ...sb, voice: { ...sb.voice, ...patch } as Storyboard["voice"] });
      if (patch.mode) toast.success(`Voice changed: ${patch.mode}`, { duration: 1500 });
      if (patch.narratorVoice) toast.success(`Narrator: ${patch.narratorVoice}`, { duration: 1500 });
      if (patch.characterVoice) toast.success(`The blob now speaks as ${patch.characterVoice}`, { duration: 1500 });
    } catch (e) {
      toast.error("Could not change the voice", { description: String(e) });
    }
  };

  const audition = (v: VoiceInfo) => {
    if (v.sample) return; // SoundPlayer handles cached samples
    void requestVoiceSample(v.id).then((r) =>
      toast.info(r.url ? `${v.id} is ready, press play again` : `${v.id}: ${r.note ?? "recording…"}`, { duration: 3000 }),
    );
  };

  const stillWriting = !sb || (planJobId != null && status !== "done");

  if (stillWriting || loadFailed) {
    return (
      <div className="space-y-4">
        <Card className="p-10 text-center">
          <RefreshCw
            className={cn(
              "mx-auto mb-4 h-12 w-12 text-primary",
              status === "running" && "animate-spin",
            )}
          />
          <h3 className="text-xl font-extrabold">
            {loadFailed ? "Uh oh" : status === "failed" ? "The writer hit a problem" : "Writing your story…"}
          </h3>
          <p className="mx-auto mt-2 max-w-sm text-sm font-medium text-muted-foreground">
            {loadFailed
              ? loadFailed
              : status === "failed"
                ? "One retry usually fixes it, see the note below."
                : "Making your story, usually a minute or two."}
          </p>
          {status === "running" && !loadFailed ? (
            <div className="mx-auto mt-5 h-4 w-56 overflow-hidden rounded-full bg-input">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
            </div>
          ) : null}
        </Card>
        {status === "failed" ? (
          <ErrorBanner
            error={job?.error ?? "Writing failed"}
            fix="Go back and press “Write the story” again"
          />
        ) : null}
        <LogConsole logs={logs} />
        <Button variant="secondary" size="lg" className="w-full" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />Back
        </Button>
      </div>
    );
  }

  /* Review */
  return (
    <div className="space-y-4">
      <Card className="p-6">
        <div className="text-center">
          <p className="text-xs font-extrabold uppercase tracking-widest text-muted-foreground">
            Your story
          </p>
          <h2 className="mt-1 text-2xl font-extrabold leading-tight">{sb.title}</h2>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <Badge variant="muted">{sb.targetSeconds}s</Badge>
            <Badge variant="violet">{sb.beats.length} scenes</Badge>
            <Badge variant="muted">music: {sb.music.mood}</Badge>
          </div>
        </div>
      </Card>

      {sb.beats.map((beat, i) => (
        <Card key={i} className="p-5">
          <div className="mb-3 flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-sm font-extrabold text-primary-foreground">
              {i + 1}
            </span>
            <span className="flex flex-wrap gap-2">
              <Badge variant="secondary" className="gap-1">
                <Camera className="h-3 w-3" />
                {CAMERA_LABEL[beat.shot.move] ?? beat.shot.move}
              </Badge>
              <Badge variant="muted">{beat.seconds.toFixed(1)}s</Badge>
              <Badge variant="muted">{SCENE_LABEL[beat.scene] ?? beat.scene}</Badge>
            </span>
          </div>
          {beat.see ? (
            <p className="mb-2 flex items-start gap-2 text-sm font-semibold text-muted-foreground">
              <Eye className="mt-0.5 h-4 w-4 shrink-0" /> {beat.see}
            </p>
          ) : null}
          {beat.text ? <p className="mb-2 text-lg font-extrabold tracking-tight">“{beat.text.lines.join(" / ")}”</p> : null}
          {beat.narration || beat.dialogue ? (
            <p className="mb-2 flex items-start gap-2 text-[15px] font-semibold">
              <Megaphone className="mt-1 h-4 w-4 shrink-0 text-primary" />
              <span>
                {beat.dialogue && !beat.narration ? (
                  <>
                    The blob says: <em>“{beat.dialogue}”</em>
                  </>
                ) : (
                  beat.narration
                )}
              </span>
            </p>
          ) : null}
          {beat.sfx.length > 0 || sb.ambience !== "none" ? (
            <p className="flex items-start gap-2 text-xs font-bold text-muted-foreground">
              <AudioLines className="mt-0.5 h-4 w-4 shrink-0" />
              sounds:{" "}
              {[
                ...(beat.sfx ?? []).map((s) => SFX_LABEL[s.role] ?? s.role),
                sb.ambience !== "none" ? AMBIENCE_LABEL[sb.ambience] : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
        </Card>
      ))}

      {/* Voice choice, mode + casting */}
      <Card className="p-5">
        <p className="mb-3 flex items-center gap-2 text-sm font-extrabold">
          <Megaphone className="h-4 w-4 text-primary" /> Who tells the story?
        </p>
        <div className="mb-4 flex flex-wrap gap-2.5">
          {VOICE_MODES_UI.map((m) => (
            <button
              key={m.key}
              onClick={() => flipVoice({ mode: m.key })}
              className={cn(
                "h-11 rounded-2xl px-4 text-sm font-extrabold transition-all active:scale-95",
                (sb.voice?.mode ?? "narrator") === m.key
                  ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25"
                  : "bg-input text-muted-foreground hover:brightness-125",
              )}
            >
              {m.icon}
              {m.label}
            </button>
          ))}
        </div>
        {(sb.voice?.mode ?? "narrator") !== "silent" && voices.length > 0 ? (
          <div className="space-y-4">
            {(sb.voice?.mode ?? "narrator") !== "character" ? (
              <VoiceCastRow
                icon={<Mic className="h-3.5 w-3.5" />}
                title="The narrator's voice"
                current={sb.voice?.narratorVoice ?? "Bruno"}
                voices={voices}
                onPick={(id) => flipVoice({ narratorVoice: id })}
                onAudition={audition}
              />
            ) : null}
            {(sb.voice?.mode ?? "narrator") !== "narrator" ? (
              <VoiceCastRow
                icon={<Smile className="h-3.5 w-3.5" />}
                title="The blob's voice"
                current={sb.voice?.characterVoice ?? "Rosie"}
                voices={voices}
                onPick={(id) => flipVoice({ characterVoice: id })}
                onAudition={audition}
              />
            ) : null}
          </div>
        ) : null}
      </Card>

      {approveError ? (
        <ErrorBanner error={approveError} fix="Wait for the current render to finish, then approve again" />
      ) : null}

      <Card className="p-5">
        {rewriteOpen ? (
          <div className="space-y-3">
            <Textarea
              autoFocus
              placeholder="What should change? e.g. “make the ending funnier” or “the moon should win this time”"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              className="min-h-24"
            />
            <div className="flex gap-3">
              <Button size="lg" className="flex-1" disabled={rewriting || !feedback.trim()} onClick={rewrite}>
                <Wand2 className="h-5 w-5" /> {rewriting ? "Rewriting…" : "Rewrite the story"}
              </Button>
              <Button variant="secondary" size="lg" onClick={() => setRewriteOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            <Button variant="success" size="lg" className="flex-1" disabled={approving} onClick={approve}>
              <ThumbsUp className="h-5 w-5" /> {approving ? "Starting…" : "Approve, make the video!"}
            </Button>
            <Button variant="secondary" size="lg" onClick={() => setRewriteOpen(true)}>
              <Wand2 className="h-5 w-5" /> Rewrite…
            </Button>
          </div>
        )}
        <p className="mt-3 text-center text-xs font-semibold text-muted-foreground">
          Every detail above is exactly what gets rendered, nothing surprises you.
        </p>
      </Card>

      <Button variant="secondary" size="lg" className="w-full" onClick={onBack}>
        <ArrowLeft className="h-5 w-5" />Start a new story
      </Button>
    </div>
  );
}

/* ==================================================================== */
/*  Voice casting row, audition + pick per role                        */
/* ==================================================================== */
const PACE_LABEL: Record<VoiceInfo["pace"], string> = {
  fast: "fast talker",
  steady: "steady",
  slow: "slow & deep",
};

function VoiceCastRow({
  icon,
  title,
  current,
  voices,
  onPick,
  onAudition,
}: {
  icon: React.ReactNode;
  title: string;
  current: string;
  voices: VoiceInfo[];
  onPick: (id: string) => void;
  onAudition: (v: VoiceInfo) => void;
}) {
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-muted-foreground">
        {icon} {title}
      </p>
      <div className="flex flex-wrap gap-2.5">
        {voices.map((v) => (
          <div
            key={v.id}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("button")) return;
              onPick(v.id);
            }}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-2xl px-3 py-2 transition-all",
              current === v.id
                ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30"
                : "bg-input hover:brightness-125",
            )}
          >
            {v.sample ? (
              <SoundPlayer url={v.sample} title={`Hear ${v.id}`} className="!h-7 !w-7" />
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAudition(v);
                }}
                title="Record a sample of this voice (takes half a minute once)"
                className="grid h-7 w-7 place-items-center rounded-full bg-secondary"
              >
                <Play className="h-3.5 w-3.5" />
              </button>
            )}
            <span>
              <span className="block text-sm font-extrabold leading-tight">{v.id}</span>
              <span className={cn("block text-[10px] font-semibold", current === v.id ? "opacity-70" : "text-muted-foreground")}>
                {PACE_LABEL[v.pace]}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ==================================================================== */
/*  STEP 3, render / result                                             */
/* ==================================================================== */
const ENGINE_STAGES: Record<string, string[]> = {
  storyboard: ["voice", "music", "bundle", "render", "encode"],
  story: ["music", "bundle", "render", "encode"],
  template: ["script", "bundle", "render", "encode"],
};
const STAGE_LABELS: Record<string, string> = {
  voice: "Recording voices",
  music: "Making music",
  script: "Preparing",
  bundle: "Preparing",
  render: "Drawing frames",
  encode: "Saving the video",
  done: "Done",
  failed: "Failed",
};

function Step3OrJob({
  running,
  status,
  job,
  logs,
  progress,
  etaSec,
  stage,
  readySlug,
  readyTitle,
  onMakeReady,
  onAgain,
}: {
  running: boolean;
  status: string;
  job: Job | null;
  logs: string[];
  progress: number;
  etaSec: number | null;
  stage: string;
  readySlug?: string;
  readyTitle?: string;
  onMakeReady: (slug: string) => void;
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

  if (job && (running || status === "failed")) {
    return <JobPanel job={job} status={status} logs={logs} progress={progress} etaSec={etaSec} stage={stage} />;
  }

  if (readySlug && !running) {
    return (
      <div className="space-y-4">
        <Card className="p-8 text-center">
          <div className="mx-auto mb-5 grid h-20 w-20 place-items-center rounded-3xl bg-accent text-accent-foreground shadow-xl shadow-accent/25">
            <Sparkles className="h-10 w-10" />
          </div>
          <h3 className="text-2xl font-extrabold">Everything is set!</h3>
          <p className="mx-auto mt-2 max-w-sm text-[15px] font-medium text-muted-foreground">
            {readyTitle ?? "This video"} is ready to be made, one more button.
          </p>
          <div className="mt-6">
            <Button variant="amber" size="xl" className="w-full" onClick={() => onMakeReady(readySlug)}>
              <Zap className="h-6 w-6" /> Make the video!
            </Button>
          </div>
        </Card>
        <Button variant="secondary" size="lg" onClick={() => setQuery({ step: "2", path: "ready", story: readySlug })}>
          <ArrowLeft className="h-5 w-5" /> Change the sounds
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-8 text-center">
        <div className="mx-auto mb-5 grid h-20 w-20 place-items-center rounded-3xl bg-accent text-accent-foreground shadow-xl shadow-accent/25">
          <Sparkles className="h-10 w-10" />
        </div>
        <h3 className="text-2xl font-extrabold">Pick a story to make</h3>
        <p className="mx-auto mt-2 max-w-sm text-[15px] font-medium text-muted-foreground">
          Start a new story on step 1, or pick a ready-made video there.
        </p>
      </Card>
      <Button variant="secondary" size="lg" className="w-full" onClick={() => setQuery({ step: "1" })}>
        <ArrowLeft className="h-5 w-5" /> Back
      </Button>
    </div>
  );
}

function JobPanel({
  job,
  status,
  logs,
  progress,
  etaSec,
  stage,
}: {
  job: Job;
  status: string;
  logs: string[];
  progress: number;
  etaSec: number | null;
  stage: string;
}) {
  const stages = ENGINE_STAGES[job.engine ?? "storyboard"] ?? ENGINE_STAGES.storyboard;
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
  void stage; // pills drive current-stage display via spans

  return (
    <div className="space-y-4">
      <Card className="p-6 text-center">
        <div
          className={cn(
            "text-7xl font-extrabold tabular-nums",
            status === "failed" ? "text-destructive" : "text-primary",
          )}
        >
          {status === "done" ? 100 : Math.max(progress, 0)}
          <span className="text-2xl text-muted-foreground">%</span>
        </div>
        <p className="mt-2 text-lg font-bold">
          {status === "failed" ? "Oh no, something went wrong." : "Your video is being made"}
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
                  {st === "done" ? <Check className="h-3 w-3" /> : i + 1}
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
          error={job.error ?? "Something went wrong while making the video."}
          fix="Press “Make the video” again, if it keeps failing, the log below says which step broke"
        />
      ) : null}

      <LogConsole logs={logs} />
    </div>
  );
}

/** Autoscrolling live log (soft dark console). */
function LogConsole({ logs }: { logs: string[] }) {
  if (!logs.length) return null;
  const lines = logs.join("").split(/\r?\n/).filter((l) => l.trim()).slice(-24);
  return (
    <div className="mx-auto max-h-36 max-w-xl overflow-y-auto rounded-2xl bg-black/50 p-4 font-mono text-[11px] leading-relaxed">
      {lines.map((l, i) => (
        <div key={i} className="whitespace-pre-wrap text-foreground/80">
          {l}
        </div>
      ))}
    </div>
  );
}

